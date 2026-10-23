import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { admitStudioRevision } from "./admit-rubato-release.mjs";
import { workflowFunction } from "./ci-test-support.mjs";

const sha = "1234567890abcdef1234567890abcdef12345678";
const evidence = () => ({
	studioSha: sha,
	comparison: { merge_base_commit: { sha } },
	runs: {
		workflow_runs: [
			{
				id: 123,
				head_sha: sha,
				head_branch: "main",
				event: "workflow_dispatch",
				status: "completed",
				conclusion: "success",
			},
		],
	},
	jobs: { jobs: [{ name: "merge-gate", conclusion: "success" }] },
});

test("release admission accepts an exact green main SHA", () => {
	assert.equal(admitStudioRevision(evidence()), sha);
});

test("formal release accepts a green candidate on the exact source SHA, never a different candidate", () => {
	const input = evidence();
	Object.assign(input.runs.workflow_runs[0], {
		head_branch: "candidate",
		display_title: `CI candidate ${sha}`,
	});
	assert.equal(admitStudioRevision(input), sha);
	input.runs.workflow_runs[0].head_sha = "f".repeat(40);
	input.runs.workflow_runs[0].display_title = `CI candidate ${"f".repeat(40)}`;
	assert.throws(() => admitStudioRevision(input));
});

test("full SHA admission cannot be replaced by mutually agreeing branch names", () => {
	const input = evidence();
	input.studioSha = "main";
	input.comparison.merge_base_commit.sha = "main";
	input.runs.workflow_runs[0].head_sha = "main";
	assert.throws(() => admitStudioRevision(input), /full Studio SHA/);
});

for (const [name, mutate] of [
	[
		"branch name",
		(e) => {
			e.studioSha = "main";
		},
	],
	[
		"off-main SHA",
		(e) => {
			e.comparison.merge_base_commit.sha = "f".repeat(40);
		},
	],
	[
		"absent CI",
		(e) => {
			e.runs.workflow_runs = [];
		},
	],
	[
		"stale SHA",
		(e) => {
			e.runs.workflow_runs[0].head_sha = "f".repeat(40);
		},
	],
	[
		"other branch",
		(e) => {
			e.runs.workflow_runs[0].head_branch = "feature";
		},
	],
	[
		"PR CI",
		(e) => {
			e.runs.workflow_runs[0].event = "pull_request";
		},
	],
	[
		"failed verification",
		(e) => {
			e.runs.workflow_runs[0].conclusion = "failure";
		},
	],
	[
		"cancelled verification",
		(e) => {
			e.runs.workflow_runs[0].conclusion = "cancelled";
		},
	],
	[
		"running verification",
		(e) => {
			e.runs.workflow_runs[0].status = "in_progress";
		},
	],
	[
		"skipped merge gate",
		(e) => {
			e.jobs.jobs[0].conclusion = "skipped";
		},
	],
	[
		"missing merge gate",
		(e) => {
			e.jobs.jobs = [];
		},
	],
])
	test(`release admission refuses ${name}`, () => {
		const input = evidence();
		mutate(input);
		assert.throws(() => admitStudioRevision(input));
	});

test("public publisher stays manual and depends on every verification job", () => {
	const workflow = parse(
		readFileSync(new URL("../../../.github/workflows/cli-release.yml", import.meta.url), "utf8"),
	);
	assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
	assert.equal(workflow.on.pull_request, undefined);
	assert.equal(workflow.on.push, undefined);
	assert.equal(workflow.jobs.admit["runs-on"], "ubicloud-standard-2");
	assert.equal(workflow.jobs.build.needs, "admit");
	const smoke = workflow.jobs["native-smoke"];
	assert.deepEqual(smoke.needs, ["build", "publish"]);
	assert.deepEqual(
		smoke.strategy.matrix.include.map((item) => item.runner),
		["macos-15", "macos-15-intel"],
	);
	const publisher = workflow.jobs["rubato-publish"];
	assert.deepEqual(publisher.needs, ["admit", "build", "publish", "native-smoke"]);
	assert.equal(publisher["runs-on"], "ubuntu-24.04");
	assert.equal(publisher.environment, "rubato-release");
	assert.match(publisher.if, /inputs\.pack_version != ''/);
	assert.equal(
		workflowFunction("inputs", `return (${publisher.if})`)({ pack_version: "" }),
		false,
		"Build-ahead cannot publish a public pack",
	);
	assert.doesNotMatch(publisher.if, /always\(|failure\(|cancelled\(/);
	const command = publisher.steps.find((step) => step.name === "Publish verified Rubato pack");
	assert.match(command.run, /publish-studio-pack\.mjs/);
	assert.match(command.run, /--dry-run/);
	assert.doesNotMatch(command.run, /--publish/);
	assert.doesNotMatch(command.run, /\$\{\{ inputs\./);
	for (const job of Object.values(workflow.jobs)) {
		assert.equal(job["continue-on-error"], undefined);
		for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
	}
});

test("every candidate build requires admission, private candidates included", () => {
	const workflow = parse(
		readFileSync(new URL("../../../.github/workflows/cli-release.yml", import.meta.url), "utf8"),
	);
	const ci = parse(
		readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
	);
	assert.ok(ci.jobs.changes["runs-on"].endsWith(`'${workflow.jobs.admit["runs-on"]}' }}`));
	assert.equal(
		workflow.jobs.admit.if,
		"github.repository == (vars.STUDIO_SOURCE_REPO || github.repository) && (github.event_name == 'workflow_dispatch')",
	);
	assert.equal(workflow.jobs.build.needs, "admit");
	const enabled = (job, inputs, result) =>
		workflowFunction(
			"inputs",
			"needs",
			"cancelled",
			"github",
			`return (${job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "")});`,
		)(inputs, { admit: { result }, webkit: { result: "success" } }, () => result === "cancelled", {
			event_name: "workflow_dispatch",
		});
	for (const result of ["skipped", "success", "failure", "cancelled"]) {
		assert.equal(
			enabled(workflow.jobs.build, { pack_version: "", publish_pack: false }, result),
			result === "success",
		);
		assert.equal(
			enabled(workflow.jobs.build, { pack_version: "0.1.2", publish_pack: false }, result),
			result === "success",
		);
		assert.equal(
			enabled(
				workflow.jobs.build,
				{ internal_install: true, pack_version: "", publish_pack: false },
				result,
			),
			result === "success",
		);
	}
	const privateInputs = { pack_version: "", publish_pack: false };
	const active = Object.entries(workflow.jobs)
		.filter(([, job]) => !job.if || enabled(job, privateInputs, "success"))
		.map(([name, job]) => [
			name,
			(Array.isArray(job.needs) ? job.needs : [job.needs]).filter((need) => Boolean(need)),
		]);
	assert.deepEqual(active, [
		["admit", []],
		["build", ["admit"]],
		["publish", ["build"]],
	]);
	assert.equal(
		enabled(workflow.jobs.build, { pack_version: "", publish_pack: true }, "skipped"),
		false,
	);
});

test("archive capture explicitly exits on failed count and digest guards", () => {
	const workflow = parse(
		readFileSync(new URL("../../../.github/workflows/cli-release.yml", import.meta.url), "utf8"),
	);
	const capture = workflow.jobs.build.steps.find((step) => step.id === "digests").run;
	assert.match(capture, /\[\[ \$\{#archives\[@\]\} == 1 \]\] \|\| exit 1/);
	assert.match(capture, /\[\[ "\$digest" =~ \^\[a-f0-9\]\{64\}\$ \]\] \|\| exit 1/);
});
