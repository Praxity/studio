import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { workflowFunction } from "./ci-test-support.mjs";
import { buildVitestPlan, loadContext } from "./test-affected.mjs";

const ci = parse(
	readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
);
const condition = (expression, github, needs = {}, cancelled = false, inputs = {}) =>
	workflowFunction(
		"github",
		"needs",
		"cancelled",
		"inputs",
		"format",
		`return (${(expression ?? "true").replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`,
	)(
		github,
		needs,
		() => cancelled,
		inputs,
		(template, value) => template.replace("{0}", value),
	);
const event = (draft, event_name = "pull_request") => ({
	event_name,
	event: { pull_request: { draft } },
});
const browserJobs = ["published-output-a11y", "published-output-deck", "browser-editor"];
const fastJobs = ["changes", "fast-checks", "node-checks", "affected-test", "merge-gate"];
const fullJobs = ["changes", "fast-checks", "node-checks", "test", ...browserJobs, "merge-gate"];
const events = [
	["PR draft", event(true), {}, fastJobs],
	["PR ready", event(false), {}, fastJobs],
	[
		"candidate",
		event(false, "workflow_dispatch"),
		{ gate: "candidate", head_sha: "a".repeat(40) },
		fullJobs,
	],
	["plain dispatch", event(false, "workflow_dispatch"), { gate: "all" }, fullJobs],
	["schedule", event(false, "schedule"), {}, fullJobs],
];
const snapshot = (github = event(false, "schedule"), browser = "true") => ({
	changes: {
		result: "success",
		outputs: {
			code: "true",
			format: "true",
			browser,
			output: browser,
			browser_editor: browser,
			vitest: github.event_name === "pull_request" ? "affected" : "full",
		},
	},
	...Object.fromEntries(
		["fast-checks", "node-checks", "test", "affected-test", ...browserJobs, "format-contracts"].map(
			(name) => [
				name,
				{
					result:
						name === "format-contracts" ||
						(github.event_name === "pull_request"
							? name === "test" || browserJobs.includes(name)
							: name === "affected-test")
							? "skipped"
							: "success",
				},
			],
		),
	),
});
const nodeScript = (step) => {
	const script = step.run.match(/<<'NODE'\n([\s\S]*)\nNODE\s*$/)?.[1];
	assert.ok(script, "Execute the actual workflow script");
	return script;
};
const verdict = (needs, github, inputs = {}) => {
	const job = ci.jobs["merge-gate"];
	assert.deepEqual(job.needs.slice().sort(), Object.keys(needs).sort());
	const step = job.steps[0];
	assert.equal(step.env.CI_NEEDS, "${{ toJSON(needs) }}");
	const env = Object.fromEntries(
		Object.entries(step.env).map(([name, expression]) => [
			name,
			name === "CI_NEEDS"
				? JSON.stringify(needs)
				: String(condition(expression, github, needs, false, inputs)),
		]),
	);
	return spawnSync(process.execPath, ["--input-type=module", "-e", nodeScript(step)], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
};

for (const [label, github, inputs, expected] of events) {
	test(`${label}: real job conditions select the exact gate`, () => {
		const needs = snapshot(github);
		assert.deepEqual(
			Object.entries(ci.jobs)
				.filter(([, job]) => condition(job.if, github, needs, false, inputs))
				.map(([name]) => name)
				.sort(),
			[...expected].sort(),
		);
		// Even a stale true browser output cannot allocate a PR browser runner.
		if (github.event_name === "pull_request")
			for (const job of browserJobs)
				assert.equal(condition(ci.jobs[job].if, github, needs, false, inputs), false);
		assert.equal(verdict(needs, github, inputs).status, 0);
	});
	test(`${label}: merge verdict rejects every required skip, failure or cancellation`, () => {
		for (const name of Object.keys(snapshot(github))) {
			for (const result of ["skipped", "failure", "cancelled"]) {
				const needs = snapshot(github);
				const required = needs[name].result === "success";
				needs[name].result = result;
				const run = verdict(needs, github, inputs);
				assert.equal(
					run.status,
					!required && result === "skipped" ? 0 : 1,
					`${name}: ${result} ${run.stderr}`,
				);
			}
		}
	});
}

test("candidate SHA guard is the first step and binds the dispatched 40-hex head", () => {
	const step = ci.jobs.changes.steps[0];
	assert.equal(step.name, "Verify candidate SHA");
	for (const [label, github, inputs] of events)
		assert.equal(condition(step.if, github, {}, false, inputs), label === "candidate");
	assert.equal(step.env.EXPECTED_SHA, "${{ inputs.head_sha }}");
	assert.equal(step.env.ACTUAL_SHA, "${{ github.sha }}");
	for (const [actual, expected, status] of [
		["a".repeat(40), "a".repeat(40), 0],
		["b".repeat(40), "a".repeat(40), 1],
		["", "", 1],
		["abc", "abc", 1],
		["z".repeat(40), "z".repeat(40), 1],
	]) {
		const run = spawnSync(process.execPath, ["--input-type=module", "-e", nodeScript(step)], {
			encoding: "utf8",
			env: { ...process.env, ACTUAL_SHA: actual, EXPECTED_SHA: expected },
		});
		assert.equal(run.status, status, run.stderr);
	}
});

test("only candidate dispatches get the exact candidate run name", () => {
	assert.equal(ci.on.workflow_dispatch.inputs.gate.default, "all");
	assert.deepEqual(ci.on.workflow_dispatch.inputs.gate.options, ["all", "candidate"]);
	assert.equal(ci.on.workflow_dispatch.inputs.head_sha.default, "");
	for (const [label, github, inputs] of events)
		assert.equal(
			condition(ci["run-name"], github, {}, false, inputs),
			label === "candidate" ? `CI candidate ${inputs.head_sha}` : "",
		);
});

test("PR Vitest invokes the existing selector alone against the pinned PR base", async () => {
	const job = ci.jobs["affected-test"];
	assert.equal(job.strategy, undefined, "Affected files run once, without repeated shard setup");
	const selection = ci.jobs.changes.steps.find((step) => step.id === "vitest");
	for (const [, github, inputs] of events)
		assert.equal(
			condition(selection.if, github, {}, false, inputs),
			github.event_name === "pull_request",
		);
	assert.ok(
		!ci.jobs.changes.steps
			.slice(0, ci.jobs.changes.steps.indexOf(selection))
			.some((step) => /apt-get|prebuild|prepare:typst/.test(step.run ?? "")),
	);
	assert.equal(selection.env.AFFECTED_BASE, "${{ github.event.pull_request.base.sha }}");
	assert.equal(
		selection.run,
		'pnpm test:affected --vitest-only --select-only --base "$AFFECTED_BASE"',
	);
	const step = job.steps.find((step) => step.name === "Affected Vitest");
	assert.equal(step.env.AFFECTED_BASE, "${{ github.event.pull_request.base.sha }}");
	assert.equal(
		step.run,
		'bash scripts/run-vitest-isolated.sh pnpm test:affected --vitest-only --affected-only --base "$AFFECTED_BASE"',
	);
	assert.ok(!job.steps.some((step) => /playwright|node --test/.test(step.run ?? "")));
	const context = await loadContext(fileURLToPath(new URL("../../../", import.meta.url)));
	for (const path of [
		"pnpm-lock.yaml",
		"vitest.workspace.ts",
		"tsconfig.base.json",
		"package.json",
		"apps/desktop/scripts/test-affected.mjs",
	])
		assert.ok(
			buildVitestPlan([path], context).some((step) => step.id === "vitest-all"),
			path,
		);
	assert.ok(
		buildVitestPlan(["src/x.ts"], { ...context, filters: {} }).some(
			(step) => step.id === "vitest-all",
		),
	);
	assert.deepEqual(buildVitestPlan([], context), []);
});

for (const [mode, expected] of [
	["full", ["changes", "fast-checks", "node-checks", "test", "merge-gate"]],
	["affected", fastJobs],
	["empty", ["changes", "fast-checks", "node-checks", "merge-gate"]],
]) {
	test(`PR selection ${mode} allocates exactly its jobs and requires their success`, () => {
		for (const draft of [true, false]) {
			const github = event(draft);
			const needs = snapshot(github, "false");
			needs.changes.outputs.vitest = mode;
			for (const name of ["test", "affected-test"])
				needs[name].result = expected.includes(name) ? "success" : "skipped";
			assert.deepEqual(
				Object.entries(ci.jobs)
					.filter(([, job]) => condition(job.if, github, needs))
					.map(([name]) => name)
					.sort(),
				[...expected].sort(),
			);
			assert.equal(verdict(needs, github).status, 0);
			for (const name of ["test", "affected-test"]) {
				const result = needs[name].result;
				needs[name].result = "skipped";
				assert.equal(verdict(needs, github).status, expected.includes(name) ? 1 : 0);
				needs[name].result = result;
			}
		}
	});
}

test("invalid PR selection refuses acceptance; missing selector output selects full Vitest", () => {
	for (const mode of [undefined, "", "unexpected"]) {
		const needs = snapshot(event(false));
		needs.changes.outputs.vitest = mode;
		for (const name of ["test", "affected-test"]) needs[name].result = "skipped";
		assert.equal(verdict(needs, event(false)).status, 1);
	}
	assert.equal(
		workflowFunction(
			"steps",
			`return (${ci.jobs.changes.outputs.vitest.slice(3, -2)});`,
		)({ vitest: { outputs: {} } }),
		"full",
	);
});

test("candidate concurrency is separate from ordinary dispatches and other candidate heads", () => {
	const github = { event_name: "workflow_dispatch", ref: "refs/heads/candidate" };
	const group = (inputs) =>
		ci.concurrency.group.replace(
			/\$\{\{(.*?)\}\}/g,
			(_, expression) => condition(expression, github, {}, false, inputs) ?? "",
		);
	assert.notEqual(group({ gate: "candidate", head_sha: "a".repeat(40) }), group({ gate: "all" }));
	assert.notEqual(
		group({ gate: "candidate", head_sha: "a".repeat(40) }),
		group({ gate: "candidate", head_sha: "b".repeat(40) }),
	);
});

test("local affected filters retain workspace and dependency patch admission", () => {
	const filter = parse(ci.jobs.changes.steps.find((step) => step.id === "filter").with.filters);
	assert.ok(filter.code.includes("pnpm-workspace.yaml"));
	assert.ok(filter.code.includes("patches/**"));
});

test("candidate browser skip-list permits only deliberately unselected browser skips", () => {
	const github = event(false, "workflow_dispatch");
	const inputs = { gate: "candidate" };
	for (const selected of ["false", "true"]) {
		const needs = snapshot(github, selected);
		for (const name of browserJobs) {
			needs[name].result = selected === "true" ? "success" : "skipped";
			assert.equal(condition(ci.jobs[name].if, github, needs, false, inputs), selected === "true");
		}
		assert.equal(verdict(needs, github, inputs).status, 0);
		for (const name of browserJobs) {
			needs[name].result = "failure";
			assert.equal(verdict(needs, github, inputs).status, 1);
			needs[name].result = selected === "true" ? "success" : "skipped";
		}
	}
});

test("browser events reject missing or invalid decisions; PR verdicts do not require them", () => {
	for (const [, github, inputs] of events) {
		for (const browser of [undefined, "", "unexpected", "TRUE", true, false, "true "]) {
			const needs = snapshot(github);
			needs.changes.outputs.browser = browser;
			for (const name of browserJobs) needs[name].result = "skipped";
			assert.equal(
				verdict(needs, github, inputs).status,
				github.event_name === "pull_request" ? 0 : 1,
				`${github.event_name} gate=${inputs.gate} browser=${JSON.stringify(browser)}`,
			);
		}
	}
});

test("workflow cancellation stops every admitted job and failure diagnostics", () => {
	assert.equal(ci.concurrency["cancel-in-progress"], true);
	for (const [, github, inputs] of events) {
		for (const [name, job] of Object.entries(ci.jobs)) {
			assert.equal(job.concurrency, undefined);
			if (job.if?.includes("cancelled()"))
				assert.equal(condition(job.if, github, snapshot(github), true, inputs), false, name);
			for (const step of job.steps ?? []) {
				assert.ok(!step.if?.includes("always()"));
				if (step.if?.includes("failure()")) assert.match(step.if, /!cancelled\(\)/);
			}
		}
	}
});

test("combined fast checks retain independent commands and failure verdicts", () => {
	assert.equal(ci.jobs.setup, undefined);
	assert.equal(ci.jobs.lint, undefined);
	assert.equal(ci.jobs.typecheck, undefined);
	const job = ci.jobs["fast-checks"];
	assert.ok(job);
	const commands = {
		actionlint: job.steps.find((step) => step.id === "actionlint")?.run,
		"editor-ownership": "node scripts/check-editor-ownership.mjs",
		"source-owners": "node scripts/check-source-owners.mjs",
		"timeout-evidence":
			'node scripts/fetch-timeout-base.mjs --base "$TIMEOUT_BASE"\nnode scripts/check-test-timeouts.mjs --base "$TIMEOUT_BASE"\n',
		lint: "pnpm exec biome check .",
		typecheck: "pnpm typecheck",
	};
	assert.equal(
		job.steps.find((step) => step.uses?.startsWith("actions/checkout@")).with["fetch-depth"],
		1,
	);
	assert.equal(
		job.steps.find((step) => step.id === "timeout-evidence").env.TIMEOUT_BASE,
		"${{ github.event.pull_request.base.sha || github.event.before || github.sha }}",
	);
	for (const [id, command] of Object.entries(commands)) {
		const step = job.steps.find((step) => step.id === id);
		assert.equal(step.run, command);
		assert.equal(step["continue-on-error"], true);
		const run = workflowFunction("steps", "cancelled", `return (${step.if.slice(3, -2)});`);
		assert.equal(
			run({ install: { outcome: "success" }, lint: { outcome: "failure" } }, () => false),
			true,
		);
		assert.equal(
			run({ install: { outcome: "failure" } }, () => false),
			false,
		);
		assert.equal(
			run({ install: { outcome: "success" } }, () => true),
			false,
		);
	}
	for (const name of ["test", "published-output-a11y", "published-output-deck", "browser-editor"])
		assert.deepEqual([ci.jobs[name].needs].flat(), ["changes"], `${name} survives a lint failure`);
	const script = job.steps
		.find((step) => step.id === "verdict")
		.run.match(/<<'NODE'\n([\s\S]*)\nNODE\s*$/)?.[1];
	assert.ok(script);
	const steps = Object.fromEntries(
		["install", ...Object.keys(commands)].map((id) => [id, { outcome: "success" }]),
	);
	const verdict = () =>
		spawnSync(process.execPath, ["--input-type=module", "-e", script], {
			encoding: "utf8",
			env: { ...process.env, CI_STEPS: JSON.stringify(steps) },
		});
	assert.equal(verdict().status, 0);
	for (const id of Object.keys(steps)) {
		for (const outcome of ["failure", "cancelled", "skipped"]) {
			steps[id].outcome = outcome;
			const result = verdict();
			assert.equal(result.status, 1, `${id}: ${outcome}`);
			assert.match(result.stdout, new RegExp(`${id}: ${outcome}`));
		}
		steps[id].outcome = "success";
	}
});
