import assert from "node:assert/strict";
import test from "node:test";
import {
	admitRelease,
	admitStudioRevision,
	internalCandidateSource,
} from "./admit-rubato-release.mjs";

test("admission filters fork PR runs while retaining the newest failure within trusted CI events", async () => {
	const { admitInternalStudioRevision } = await import("./admit-rubato-release.mjs");
	const sha = "a".repeat(40);
	for (const conclusion of ["success", "failure"]) {
		const execute = (_command, args) => {
			const path = args.at(-1);
			if (path.includes("/git/ref/")) return JSON.stringify({ object: { sha } });
			if (path.includes("/compare/")) return JSON.stringify({ merge_base_commit: { sha } });
			if (path.includes("/jobs?"))
				return JSON.stringify([{ jobs: [{ name: "merge-gate", conclusion: "success" }] }]);
			const params = new URLSearchParams(path.split("?")[1]);
			assert.ok(["push", "schedule", "workflow_dispatch"].includes(params.get("event")), path);
			if (params.get("event") !== "workflow_dispatch") assert.equal(params.get("branch"), "main");
			return JSON.stringify({
				workflow_runs: [
					{ id: 99, event: "pull_request", head_branch: "fork", head_sha: sha, status: "queued" },
					{
						id: 42,
						event: "workflow_dispatch",
						head_branch: "main",
						head_sha: sha,
						status: "completed",
						conclusion,
					},
					{
						id: 41,
						event: "workflow_dispatch",
						head_branch: "main",
						head_sha: sha,
						status: "completed",
						conclusion: "success",
					},
				],
			});
		};
		const settings = {
			STUDIO_SOURCE_REPO: "fixture/source",
			STUDIO_CANDIDATE_REPO: "fixture/candidates",
		};
		if (conclusion === "success")
			assert.equal(admitInternalStudioRevision(sha, execute, settings).run.id, 42);
		else assert.throws(() => admitInternalStudioRevision(sha, execute, settings), /candidate gate/);
	}
});

test("candidate source titles identify push and dispatch sources without job receipts", async () => {
	const { admitInternalCandidateRun } = await import("./admit-rubato-release.mjs");
	const source = "a".repeat(40);
	for (const event of ["push", "workflow_dispatch"]) {
		const run = {
			id: 42,
			event,
			head_sha: event === "push" ? source : "b".repeat(40),
			display_title: `CLI candidate ${source}`,
		};
		assert.equal(internalCandidateSource(run), source);
		assert.equal(
			admitInternalCandidateRun(run, { jobs: [{ name: "webkit", conclusion: "success" }] }),
			run,
		);
		assert.throws(() => admitInternalCandidateRun(run, { jobs: [] }), /WebKit/);
	}
});

test("candidate source titles require exactly one full SHA, strictly for selected candidates", () => {
	for (const display_title of [
		undefined,
		"",
		"CLI candidate main",
		`CLI candidate ${"a".repeat(40)}\n`,
		`CLI candidate ${"A".repeat(40)}`,
		`CLI candidate ${"a".repeat(39)}`,
		`CLI candidate ${"a".repeat(41)}`,
		`CLI candidate ${"a".repeat(40)} trailing`,
		`prefix CLI candidate ${"a".repeat(40)}`,
		`CLI candidate ${"a".repeat(40)} ${"b".repeat(40)}`,
	]) {
		const run = { display_title, event: "workflow_dispatch", head_sha: "a".repeat(40) };
		assert.equal(internalCandidateSource(run, { strict: false }), undefined);
		assert.throws(() => internalCandidateSource(run), /source SHA/);
	}
	assert.throws(
		() =>
			internalCandidateSource({
				event: "push",
				head_sha: "b".repeat(40),
				display_title: `CLI candidate ${"a".repeat(40)}`,
			}),
		/source SHA/,
	);
});

process.env.STUDIO_SOURCE_REPO = "fixture/studio";
process.env.STUDIO_CANDIDATE_REPO = "fixture/studio";

const main = "1111111111111111111111111111111111111111";
const head = "2222222222222222222222222222222222222222";
const parent = "3333333333333333333333333333333333333333";
const tree = "4444444444444444444444444444444444444444";
const fixture = () => ({
	studioSha: main,
	internal: true,
	comparison: { merge_base_commit: { sha: main } },
	candidate: {
		source: { sha: main, tree_sha: tree, parents: [{ sha: parent }] },
		head: { sha: head, tree_sha: tree },
		comparison: { merge_base_commit: { sha: parent }, behind_by: 0 },
	},
	runs: {
		workflow_runs: [
			{
				id: 123,
				head_sha: head,
				head_branch: "fix/candidate",
				event: "workflow_dispatch",
				display_title: "CI candidate 2222222222222222222222222222222222222222",
				status: "completed",
				conclusion: "success",
			},
		],
	},
	jobs: {
		jobs: [
			{ name: "merge-gate", conclusion: "success" },
			{
				name: "changes",
				conclusion: "success",
				steps: [
					{
						name: "Candidate base 3333333333333333333333333333333333333333",
						conclusion: "success",
					},
				],
			},
		],
	},
});

test("internal admission accepts a squash SHA with the candidate tree and tested main parent", () => {
	assert.equal(admitStudioRevision(fixture()), main);
});

for (const [name, mutate] of [
	[
		"different trees",
		(e) => {
			e.candidate.head.tree_sha = parent;
		},
	],
	[
		"different main base",
		(e) => {
			e.candidate.comparison.merge_base_commit.sha = head;
		},
	],
	[
		"different recorded main base despite both parents being ancestors",
		(e) => {
			e.candidate.source.parents[0].sha = "5555555555555555555555555555555555555555";
			e.candidate.comparison.merge_base_commit.sha = "5555555555555555555555555555555555555555";
		},
	],
	[
		"off-main squash",
		(e) => {
			e.comparison.merge_base_commit.sha = parent;
		},
	],
	[
		"different head",
		(e) => {
			e.runs.workflow_runs[0].head_sha = parent;
		},
	],
	[
		"ordinary PR-branch dispatch",
		(e) => {
			e.runs.workflow_runs[0].display_title = "CI";
		},
	],
	[
		"candidate title names a different SHA",
		(e) => {
			e.runs.workflow_runs[0].display_title =
				"CI candidate 3333333333333333333333333333333333333333";
		},
	],
	[
		"PR event",
		(e) => {
			e.runs.workflow_runs[0].event = "pull_request";
		},
	],
	[
		"missing merge gate",
		(e) => {
			e.jobs.jobs = [];
		},
	],
	[
		"failed merge gate",
		(e) => {
			e.jobs.jobs[0].conclusion = "failure";
		},
	],
	[
		"formal dry run",
		(e) => {
			e.internal = false;
		},
	],
	[
		"missing tree",
		(e) => {
			delete e.candidate.source.tree_sha;
			delete e.candidate.head.tree_sha;
		},
	],
	[
		"newer failure",
		(e) => {
			e.runs.workflow_runs.unshift({ ...e.runs.workflow_runs[0], id: 124, conclusion: "failure" });
		},
	],
])
	test(`internal admission refuses ${name}`, () => {
		const input = fixture();
		mutate(input);
		assert.throws(() => admitStudioRevision(input));
	});

test("existing successful main dispatch and schedule paths still admit", () => {
	for (const event of ["workflow_dispatch", "schedule"]) {
		const input = fixture();
		input.internal = false;
		input.runs.workflow_runs = [
			{
				id: 456,
				head_sha: main,
				head_branch: "main",
				event,
				status: "completed",
				conclusion: "success",
			},
		];
		assert.equal(admitStudioRevision(input), main);
	}
});

test("the existing main-dispatch path admits an exact main SHA even with a candidate title and no base marker", () => {
	const input = fixture();
	input.runs.workflow_runs[0].head_sha = main;
	input.runs.workflow_runs[0].head_branch = "main";
	input.runs.workflow_runs[0].display_title = `CI candidate ${main}`;
	input.jobs.jobs.pop();
	assert.equal(admitStudioRevision(input), main);
});

test("candidate admission also accepts the exact tested SHA already on main", () => {
	const input = fixture();
	input.studioSha = head;
	input.comparison.merge_base_commit.sha = head;
	delete input.candidate;
	assert.equal(admitStudioRevision(input), head);
});

function apiFixture() {
	const e = fixture();
	const repo = "repos/fixture/studio";
	return {
		[`${repo}/git/ref/heads/main`]: { object: { sha: main } },
		[`${repo}/compare/${main}...${main}`]: e.comparison,
		[`${repo}/actions/workflows/ci.yml/runs?head_sha=${main}&per_page=1`]: { workflow_runs: [] },
		[`${repo}/commits/${main}`]: e.candidate.source,
		[`${repo}/commits/${main}/pulls?per_page=100`]: [
			{
				number: 42,
				merged_at: "2026-10-18T12:00:00Z",
				merge_commit_sha: main,
				base: { ref: "main" },
				head: { sha: head },
			},
		],
		[`${repo}/commits/${head}`]: e.candidate.head,
		[`${repo}/compare/${parent}...${head}`]: e.candidate.comparison,
		[`${repo}/actions/workflows/ci.yml/runs?head_sha=${head}&per_page=1`]: e.runs,
		[`${repo}/actions/runs/123/jobs?per_page=100`]: e.jobs,
	};
}

function admitFromApi(responses) {
	return admitRelease(
		{
			...process.env,
			INPUT_REF: main,
			INTERNAL_INSTALL: "true",
			PACK_VERSION: "",
			PUBLISH_PACK: "false",
		},
		(command, args) => {
			assert.equal(command, "gh");
			assert.equal(args[0], "api");
			if (
				/\/(commits|compare)\//.test(args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")) &&
				!args
					.at(-1)
					.replace(/&event=[^&]+(?:&branch=main)?$/, "")
					.includes("/pulls?")
			)
				assert.equal(
					args.includes("--jq"),
					true,
					"Commit and compare patches must not fill the subprocess buffer",
				);
			assert.ok(
				Object.hasOwn(responses, args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")),
				`Unexpected API: ${args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")}`,
			);
			const value = responses[args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "")];
			return JSON.stringify(args.includes("--slurp") ? (value.pages ?? [value]) : value);
		},
	);
}

test("internal API adapter finds the merged PR head and returns the squash SHA", () => {
	assert.deepEqual(admitFromApi(apiFixture()), { source_ref: main });
});

for (const [name, mutate] of [
	[
		"different trees",
		(responses) => {
			responses[`repos/fixture/studio/commits/${head}`].tree_sha = parent;
		},
	],
	[
		"wrong main parent",
		(responses) => {
			responses[`repos/fixture/studio/compare/${parent}...${head}`].merge_base_commit.sha = head;
		},
	],
])
	test(`API adapter refuses ${name}`, () => {
		const responses = apiFixture();
		mutate(responses);
		assert.throws(
			() => admitFromApi(responses),
			/No merge candidate with matching tree and main parent/,
		);
	});

test("internal API adapter checks the head's newest CI even when an older candidate succeeded", () => {
	const responses = apiFixture();
	const runs =
		responses[`repos/fixture/studio/actions/workflows/ci.yml/runs?head_sha=${head}&per_page=1`];
	runs.workflow_runs.unshift({ ...runs.workflow_runs[0], conclusion: "failure" });
	assert.throws(
		() => admitFromApi(responses),
		/candidate gate.*2222222222222222222222222222222222222222/,
	);
});

test("missing PR association refuses and names the main CI route without dispatch discovery", () => {
	const responses = apiFixture();
	responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`] = [];
	assert.throws(() => admitFromApi(responses), /Dispatch full ci.yml on main/);
});

test("a candidate predating recorded-base evidence is refused with the existing main dispatch route", () => {
	const input = fixture();
	input.jobs.jobs.pop();
	assert.throws(
		() => admitStudioRevision(input),
		/2222222222222222222222222222222222222222.*no unique recorded main base.*workflow_dispatch/,
	);
});

test("closed unmerged associated PRs cannot supply candidate heads", () => {
	const responses = apiFixture();
	responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`][0].merged_at = null;
	assert.throws(() => admitFromApi(responses), /No merge candidate/);
});

for (const [name, change] of [
	[
		"another merge commit",
		(pr) => {
			pr.merge_commit_sha = parent;
		},
	],
	[
		"another base branch",
		(pr) => {
			pr.base.ref = "feature";
		},
	],
])
	test(`associated PR for ${name} cannot supply the candidate head`, () => {
		const responses = apiFixture();
		change(responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`][0]);
		assert.throws(() => admitFromApi(responses), /No merge candidate/);
	});

for (const [name, change] of [
	[
		"failed changes job",
		(job) => {
			job.conclusion = "failure";
		},
	],
	[
		"failed marker step",
		(job) => {
			job.steps[0].conclusion = "failure";
		},
	],
	[
		"duplicate markers",
		(job) => {
			job.steps.push({ ...job.steps[0] });
		},
	],
])
	test(`recorded-base evidence refuses ${name}`, () => {
		const input = fixture();
		change(input.jobs.jobs[1]);
		assert.throws(() => admitStudioRevision(input), /no unique recorded main base/);
	});

test("qualifying PR association order cannot hide the matching tree", () => {
	const responses = apiFixture();
	const other = "5555555555555555555555555555555555555555";
	const pulls = responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`];
	const irrelevant = { ...pulls[0], number: 99, head: { sha: other } };
	responses[`repos/fixture/studio/commits/${other}`] = { sha: other, tree_sha: parent };
	responses[`repos/fixture/studio/compare/${parent}...${other}`] = fixture().candidate.comparison;
	for (const associated of [
		[irrelevant, pulls[0]],
		[pulls[0], irrelevant],
	]) {
		responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`] = associated;
		assert.deepEqual(admitFromApi(responses), { source_ref: main });
	}
});

test("associated PRs and merge-gate jobs are read beyond page one", () => {
	const responses = apiFixture();
	const pulls = responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`];
	responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`] = {
		pages: [Array.from({ length: 100 }, (_, number) => ({ number, merged_at: null })), pulls],
	};
	responses["repos/fixture/studio/actions/runs/123/jobs?per_page=100"] = {
		pages: [
			{ jobs: Array.from({ length: 100 }, () => ({ name: "other", conclusion: "success" })) },
			fixture().jobs,
		],
	};
	assert.deepEqual(admitFromApi(responses), { source_ref: main });
});

test("two same-tree associated heads do not hide a newer selected head's failed candidate", () => {
	const responses = apiFixture();
	const other = "5555555555555555555555555555555555555555";
	const pulls = responses[`repos/fixture/studio/commits/${main}/pulls?per_page=100`];
	pulls.push({ ...pulls[0], number: 99, head: { sha: other } });
	responses[`repos/fixture/studio/commits/${other}`] = { sha: other, tree_sha: tree };
	responses[`repos/fixture/studio/compare/${parent}...${other}`] = fixture().candidate.comparison;
	responses[`repos/fixture/studio/actions/workflows/ci.yml/runs?head_sha=${other}&per_page=1`] = {
		workflow_runs: [
			{
				...fixture().runs.workflow_runs[0],
				head_sha: other,
				display_title: `CI candidate ${other}`,
				conclusion: "failure",
			},
		],
	};
	assert.throws(() => admitFromApi(responses), new RegExp(`candidate gate.*${other}`));
});
