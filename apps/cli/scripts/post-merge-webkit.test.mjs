import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";
import test from "node:test";
import { parse } from "yaml";

process.env.STUDIO_SOURCE_REPO = "fixture/studio";
process.env.STUDIO_CANDIDATE_REPO = "fixture/studio";

test("source CI and internal candidates can live in different repositories", async () => {
	const { selectNewestInternalStudioRevision } = await import("./admit-rubato-release.mjs");
	const sha = "a".repeat(40);
	const routes = {
		"repos/fixture/source/git/ref/heads/main": { object: { sha } },
		[`repos/fixture/source/commits/${sha}`]: { sha, parents: [] },
		[`repos/fixture/source/compare/${sha}...${sha}`]: { merge_base_commit: { sha } },
		[`repos/fixture/source/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1`]: {
			workflow_runs: [
				{
					id: 12,
					head_sha: sha,
					head_branch: "main",
					event: "schedule",
					status: "completed",
					conclusion: "success",
				},
			],
		},
		"repos/fixture/source/actions/runs/12/jobs?per_page=100": [
			{ jobs: [{ name: "merge-gate", conclusion: "success" }] },
		],
		"repos/fixture/candidates/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=100": [
			{
				workflow_runs: [
					{
						id: 42,
						event: "workflow_dispatch",
						head_branch: "main",
						head_sha: sha,
						path: ".github/workflows/cli-candidate.yml",
						display_title: `CLI candidate ${sha}`,
					},
				],
			},
		],
		[`repos/fixture/candidates/compare/${sha}...main`]: { merge_base_commit: { sha } },
		"repos/fixture/candidates/actions/runs/42/jobs?per_page=100": [
			{ jobs: [{ name: "webkit", conclusion: "success" }] },
		],
	};
	const selected = selectNewestInternalStudioRevision(
		(_command, args) => {
			assert.ok(
				Object.hasOwn(routes, args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")),
				`Wrong repository: ${args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")}`,
			);
			return JSON.stringify(routes[args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")]);
		},
		{ STUDIO_SOURCE_REPO: "fixture/source", STUDIO_CANDIDATE_REPO: "fixture/candidates" },
	);
	assert.equal(selected.sha, sha);
});

test("candidate admission refuses every non-successful or absent WebKit job", async () => {
	const { admitInternalCandidateRun } = await import("./admit-rubato-release.mjs");
	const run = {
		id: 42,
		event: "workflow_dispatch",
		display_title: `CLI candidate ${"a".repeat(40)}`,
	};
	assert.equal(
		admitInternalCandidateRun(run, { jobs: [{ name: "webkit", conclusion: "success" }] }),
		run,
	);
	for (const conclusion of ["failure", "skipped", "cancelled", null]) {
		assert.throws(
			() => admitInternalCandidateRun(run, { jobs: [{ name: "webkit", conclusion }] }),
			/WebKit/,
		);
	}
	assert.throws(() => admitInternalCandidateRun(run, { jobs: [] }), /WebKit/);
});

test("the shared selector requires candidate WebKit and paginates its jobs", async () => {
	const { selectNewestInternalStudioRevision } = await import("./admit-rubato-release.mjs");
	const sha = "a".repeat(40);
	const repo = "repos/fixture/studio";
	for (const conclusion of ["success", "failure", "skipped", "cancelled", "absent"]) {
		const routes = {
			[`${repo}/git/ref/heads/main`]: { object: { sha } },
			[`${repo}/commits/${sha}`]: { sha, parents: [] },
			[`${repo}/compare/${sha}...${sha}`]: { merge_base_commit: { sha } },
			[`${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1`]: {
				workflow_runs: [
					{
						id: 12,
						head_sha: sha,
						head_branch: "main",
						event: "schedule",
						status: "completed",
						conclusion: "success",
					},
				],
			},
			[`${repo}/actions/runs/12/jobs?per_page=100`]: [
				{ jobs: [{ name: "merge-gate", conclusion: "success" }] },
			],
			[`${repo}/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=100`]: [
				{ workflow_runs: [] },
				{
					workflow_runs: [
						{
							id: 43,
							event: "workflow_dispatch",
							head_branch: "main",
							head_sha: sha,
							path: ".github/workflows/cli-candidate.yml",
							display_title: `CLI candidate ${"b".repeat(40)}`,
						},
						{
							id: 42,
							event: "workflow_dispatch",
							head_branch: "main",
							head_sha: sha,
							path: ".github/workflows/cli-candidate.yml",
							display_title: `CLI candidate ${sha}`,
						},
					],
				},
			],
			[`${repo}/compare/${sha}...main`]: { merge_base_commit: { sha } },
			[`${repo}/actions/runs/43/jobs?per_page=100`]: [
				{ jobs: [{ name: "webkit", conclusion: "success" }] },
			],
			[`${repo}/actions/runs/42/jobs?per_page=100`]: [
				{ jobs: [] },
				{ jobs: conclusion === "absent" ? [] : [{ name: "webkit", conclusion }] },
			],
		};
		const execute = (_command, args) => {
			assert.ok(
				Object.hasOwn(routes, args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")),
				args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, ""),
			);
			if (
				args
					.at(-1)
					.replace(/&event=[^&]+(?:&branch=main)?$/, "")
					.includes("per_page=100")
			) {
				assert.ok(args.includes("--paginate"));
				assert.ok(args.includes("--slurp"));
			}
			return JSON.stringify(routes[args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")]);
		};
		if (conclusion === "success")
			assert.equal(selectNewestInternalStudioRevision(execute).sha, sha);
		else assert.throws(() => selectNewestInternalStudioRevision(execute), /candidate WebKit/);
	}
});

test("failure summary reports no earlier pass plainly", async () => {
	const { webkitFailureSummary } = await import("./webkit-failure-summary.mjs");
	for (const runs of [[], [{ id: 41, event: "push", head_branch: "main" }]]) {
		const summary = webkitFailureSummary({ runId: 42, sha: "a".repeat(40) }, (_command, args) =>
			JSON.stringify(
				args.at(-1).includes("/jobs?")
					? [{ jobs: [] }]
					: { workflow_runs: runs, total_count: runs.length },
			),
		);
		assert.equal(summary, "no earlier WebKit pass; every candidate is refused until one passes\n");
	}
});

test("failure summary finds the newest earlier passing candidate across job pages", async () => {
	const { webkitFailureSummary } = await import("./webkit-failure-summary.mjs");
	const repo = "repos/fixture/studio";
	const run = (id, sha, event = "push") => ({
		id,
		head_sha: sha.repeat(40),
		event,
		head_branch: "main",
		display_title: `CLI candidate ${sha.repeat(40)}`,
	});
	const routes = {
		[`${repo}/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=20`]: {
			workflow_runs: [
				run(43, "f"),
				run(41, "e"),
				run(40, "d", "workflow_dispatch"),
				run(39, "c"),
				run(38, "b"),
			],
			total_count: 5,
		},
		[`${repo}/actions/runs/41/jobs?per_page=100`]: [
			{ jobs: [{ name: "webkit", conclusion: "failure" }] },
		],
		[`${repo}/actions/runs/40/jobs?per_page=100`]: [
			{ jobs: [{ name: "webkit", conclusion: "failure" }] },
		],
		[`${repo}/actions/runs/39/jobs?per_page=100`]: [
			{ jobs: [] },
			{ jobs: [{ name: "webkit", conclusion: "success" }] },
		],
	};
	const summary = webkitFailureSummary({ runId: 42, sha: "a".repeat(40) }, (_command, args) => {
		assert.equal(args.includes("--paginate"), args.at(-1).includes("/jobs?"));
		assert.equal(args.includes("--slurp"), args.at(-1).includes("/jobs?"));
		assert.ok(Object.hasOwn(routes, args.at(-1)), args.at(-1));
		return JSON.stringify(routes[args.at(-1)]);
	});
	assert.match(summary, /actions\/runs\/39/);
	assert.ok(summary.includes("c".repeat(40)));
	assert.ok(summary.includes(`/compare/${"c".repeat(40)}..${"a".repeat(40)}`));
});

test("failure summary bounds history to 20 runs and qualifies a truncated search", async () => {
	const { webkitFailureSummary } = await import("./webkit-failure-summary.mjs");
	const runs = Array.from({ length: 20 }, (_, index) => ({
		id: 99 - index,
		event: "push",
		head_branch: "main",
		head_sha: "b".repeat(40),
		display_title: `CLI candidate ${"b".repeat(40)}`,
	}));
	const requests = [];
	const summary = webkitFailureSummary({ runId: 100, sha: "a".repeat(40) }, (_command, args) => {
		requests.push(args);
		return JSON.stringify(
			args.at(-1).includes("/jobs?")
				? [{ jobs: [{ name: "webkit", conclusion: "failure" }] }]
				: { workflow_runs: runs, total_count: 200 },
		);
	});
	assert.equal(
		summary,
		"no earlier WebKit pass in the last 20 runs; older runs were not checked\n",
	);
	assert.equal(requests.length, 21);
	assert.ok(requests[0].at(-1).endsWith("per_page=20"));
	assert.ok(!requests[0].includes("--paginate"));
});

test("failure summary skips non-candidate titles without job lookups", async () => {
	const { webkitFailureSummary } = await import("./webkit-failure-summary.mjs");
	const summary = webkitFailureSummary({ runId: 42, sha: "a".repeat(40) }, (_command, args) => {
		assert.ok(!args.at(-1).includes("/jobs?"));
		return JSON.stringify({
			total_count: 1,
			workflow_runs: [
				{
					id: 41,
					event: "push",
					head_branch: "main",
					head_sha: "b".repeat(40),
					display_title: "Legacy private candidate",
				},
			],
		});
	});
	assert.equal(summary, "no earlier WebKit pass; every candidate is refused until one passes\n");
});

test("failure summary uses dispatched source identity across repositories", async (t) => {
	const { webkitFailureSummary } = await import("./webkit-failure-summary.mjs");
	process.env.STUDIO_SOURCE_REPO = "fixture/source";
	process.env.STUDIO_CANDIDATE_REPO = "fixture/candidates";
	t.after(() => {
		process.env.STUDIO_SOURCE_REPO = "fixture/studio";
		process.env.STUDIO_CANDIDATE_REPO = "fixture/studio";
	});
	const source = "b".repeat(40);
	const tooling = "c".repeat(40);
	const summary = webkitFailureSummary({ runId: 42, sha: "a".repeat(40) }, (_command, args) => {
		assert.match(args.at(-1), /^repos\/fixture\/candidates\//);
		return JSON.stringify(
			args.at(-1).includes("/jobs?")
				? [{ jobs: [{ name: "webkit", conclusion: "success" }] }]
				: {
						total_count: 1,
						workflow_runs: [
							{
								id: 41,
								event: "workflow_dispatch",
								head_branch: "main",
								head_sha: tooling,
								display_title: `CLI candidate ${source}`,
							},
						],
					},
		);
	});
	assert.match(summary, /github\.com\/fixture\/candidates\/actions\/runs\/41/);
	assert.ok(summary.includes(`github.com/fixture/source/compare/${source}..${"a".repeat(40)}`));
	assert.ok(!summary.includes(tooling));
});

test("failure-summary API errors are printed instead of hiding the missing range", async () => {
	const { webkitFailureSummary } = await import("./webkit-failure-summary.mjs");
	assert.match(
		webkitFailureSummary({ runId: 42, sha: "a".repeat(40) }, () => {
			throw new Error("API unavailable");
		}),
		/lookup failed: API unavailable/,
	);
});

for (const violation of [
	"valid dispatch",
	"valid push",
	"wrong branch",
	"wrong event",
	"wrong path",
	"invalid tooling SHA",
	"push source mismatch",
	"wrong title",
	"off-main tooling",
])
	test(`selection uses the shared admitted-candidate predicate: ${violation}`, async () => {
		const { selectNewestInternalStudioRevision } = await import("./admit-rubato-release.mjs");
		const sha = "a".repeat(40);
		const candidate = {
			id: 42,
			event: "workflow_dispatch",
			head_branch: "main",
			head_sha: "b".repeat(40),
			path: ".github/workflows/cli-candidate.yml",
			display_title: `CLI candidate ${sha}`,
		};
		if (violation === "valid push") Object.assign(candidate, { event: "push", head_sha: sha });
		if (violation === "wrong branch") candidate.head_branch = "unreviewed";
		if (violation === "wrong event") candidate.event = "pull_request";
		if (violation === "wrong path") candidate.path = ".github/workflows/fake.yml";
		if (violation === "invalid tooling SHA") candidate.head_sha = "main";
		if (violation === "push source mismatch") candidate.event = "push";
		if (violation === "wrong title") candidate.display_title = `CLI candidate ${"c".repeat(40)}`;
		const calls = [];
		const execute = (_command, args) => {
			const path = args.at(-1);
			calls.push(path);
			if (path.includes("/git/ref/")) return JSON.stringify({ object: { sha } });
			if (path.includes("/commits/")) return JSON.stringify({ sha, parents: [] });
			if (path.startsWith("repos/fixture/candidates/compare/"))
				return JSON.stringify({
					merge_base_commit: {
						sha: violation === "off-main tooling" ? "d".repeat(40) : candidate.head_sha,
					},
				});
			if (path.includes("/compare/")) return JSON.stringify({ merge_base_commit: { sha } });
			if (path.includes("/workflows/cli-candidate.yml/"))
				return JSON.stringify([{ workflow_runs: [candidate] }]);
			if (path.includes("/workflows/ci.yml/"))
				return JSON.stringify({
					workflow_runs: [
						{
							id: 12,
							head_sha: sha,
							event: "push",
							head_branch: "main",
							status: "completed",
							conclusion: "success",
						},
					],
				});
			if (path.includes("/runs/12/jobs?"))
				return JSON.stringify([{ jobs: [{ name: "merge-gate", conclusion: "success" }] }]);
			assert.match(path, /repos\/fixture\/candidates\/actions\/runs\/42\/jobs/);
			return JSON.stringify([{ jobs: [{ name: "webkit", conclusion: "success" }] }]);
		};
		const env = {
			STUDIO_SOURCE_REPO: "fixture/source",
			STUDIO_CANDIDATE_REPO: "fixture/candidates",
		};
		if (violation.startsWith("valid"))
			assert.equal(selectNewestInternalStudioRevision(execute, env).sha, sha);
		else {
			assert.throws(() => selectNewestInternalStudioRevision(execute, env), /No main SHA/);
			assert.ok(
				!calls.some((path) => path.includes("/runs/42/jobs")),
				"Unadmitted runs must not supply a WebKit success",
			);
		}
	});
