import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { checkCandidateFreshness, checkMainCandidate } from "./check-candidate-freshness.mjs";

process.env.STUDIO_SOURCE_REPO = "fixture/studio";
process.env.STUDIO_CANDIDATE_REPO = "fixture/studio";

const sha = "1111111111111111111111111111111111111111";
const fixture = () => ({
	head: { sha, commit: { committer: { date: "2026-10-18T10:00:00Z" } } },
	activity: [
		{
			id: 1,
			ref: "refs/heads/main",
			after: sha,
			timestamp: "2026-10-18T10:00:00Z",
			activity_type: "pr_merge",
		},
	],
	runs: { workflow_runs: [] },
	now: Date.parse("2026-10-18T13:00:00Z"),
});

test("stale main with no build-ahead fails and names its SHA", () => {
	assert.throws(() => checkCandidateFreshness(fixture()), new RegExp(sha));
});

test("freshness reads source activity and candidate run titles from separate repositories", () => {
	const routes = {
		"repos/fixture/source/git/ref/heads/main": { object: { sha } },
		"repos/fixture/source/activity?ref=refs/heads/main&time_period=year&per_page=100": [
			fixture().activity,
		],
		"repos/fixture/candidates/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=100": [
			{
				workflow_runs: [
					{
						id: 42,
						event: "workflow_dispatch",
						head_branch: "main",
						head_sha: "b".repeat(40),
						display_title: `CLI candidate ${sha}`,
						status: "in_progress",
					},
				],
			},
		],
	};
	assert.equal(
		checkMainCandidate(
			(_command, args) => {
				assert.ok(Object.hasOwn(routes, args.at(-1)), args.at(-1));
				return JSON.stringify(routes[args.at(-1)]);
			},
			{ STUDIO_SOURCE_REPO: "fixture/source", STUDIO_CANDIDATE_REPO: "fixture/candidates" },
		),
		sha,
	);
});

test("a malformed candidate title cannot hide a valid build", () => {
	assert.equal(
		checkMainCandidate((_command, args) => {
			const path = args.at(-1);
			if (path.includes("/git/ref/")) return JSON.stringify({ object: { sha } });
			if (path.includes("/activity?")) return JSON.stringify([fixture().activity]);
			assert.ok(!path.includes("/jobs?"), "Source discovery must use run titles");
			return JSON.stringify([
				{
					workflow_runs: [
						{
							id: 43,
							event: "workflow_dispatch",
							head_branch: "main",
							status: "completed",
							conclusion: "success",
						},
						{
							id: 42,
							event: "push",
							head_branch: "main",
							head_sha: sha,
							display_title: `CLI candidate ${sha}`,
							status: "completed",
							conclusion: "success",
						},
					],
				},
			]);
		}),
		sha,
	);
});

test("dispatched build-ahead covers its title source SHA, not its private tooling SHA", () => {
	const input = fixture();
	input.runs.workflow_runs = [
		{
			event: "workflow_dispatch",
			head_branch: "main",
			head_sha: "b".repeat(40),
			display_title: `CLI candidate ${sha}`,
			status: "in_progress",
		},
	];
	assert.equal(checkCandidateFreshness(input), sha);
	input.runs.workflow_runs[0].display_title = `CLI candidate ${"c".repeat(40)}`;
	assert.throws(() => checkCandidateFreshness(input), new RegExp(sha));
});

for (const [status, conclusion] of [
	["in_progress", null],
	["completed", "success"],
])
	test(`${status} build-ahead passes for stale main`, () => {
		const input = fixture();
		input.runs.workflow_runs = [
			{
				head_sha: sha,
				display_title: `CLI candidate ${sha}`,
				head_branch: "main",
				event: "push",
				status,
				conclusion,
			},
		];
		assert.equal(checkCandidateFreshness(input), sha);
	});

test("fresh head and exact two-hour boundary pass without a candidate", () => {
	for (const now of ["2026-10-18T11:00:00Z", "2026-10-18T12:00:00Z"])
		assert.equal(checkCandidateFreshness({ ...fixture(), now: Date.parse(now) }), sha);
	assert.throws(
		() =>
			checkCandidateFreshness({
				...fixture(),
				now: Date.parse("2026-10-18T12:00:00.001Z"),
			}),
		new RegExp(sha),
	);
});

for (const run of [
	{
		head_sha: "2222222222222222222222222222222222222222",
		head_branch: "main",
		event: "push",
		status: "completed",
		conclusion: "success",
	},
	{
		head_sha: sha,
		display_title: `CLI candidate ${sha}`,
		head_branch: "feature",
		event: "push",
		status: "completed",
		conclusion: "success",
	},
	{
		head_sha: sha,
		head_branch: "main",
		event: "workflow_dispatch",
		status: "completed",
		conclusion: "success",
	},
	{
		head_sha: sha,
		display_title: `CLI candidate ${sha}`,
		head_branch: "main",
		event: "push",
		status: "completed",
		conclusion: "failure",
	},
	{
		head_sha: sha,
		display_title: `CLI candidate ${sha}`,
		head_branch: "main",
		event: "push",
		status: "queued",
		conclusion: null,
	},
])
	test(`stale main refuses unrelated or unfinished run ${JSON.stringify(run)}`, () => {
		assert.throws(
			() => checkCandidateFreshness({ ...fixture(), runs: { workflow_runs: [run] } }),
			new RegExp(sha),
		);
	});

test("invalid server timestamp fails closed", () => {
	const input = fixture();
	input.activity[0].timestamp = "invalid";
	assert.throws(() => checkCandidateFreshness(input), /Invalid main push\/merge timestamp/);
});

test("freshness adapter pins main SHA and paginates main activity and workflow push runs", () => {
	const responses = {
		"repos/fixture/studio/git/ref/heads/main": { object: { sha } },
		"repos/fixture/studio/activity?ref=refs/heads/main&time_period=year&per_page=100": [
			[],
			fixture().activity,
		],
		"repos/fixture/studio/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=100": [
			{ workflow_runs: [] },
			{
				workflow_runs: [
					{
						head_sha: sha,
						display_title: `CLI candidate ${sha}`,
						head_branch: "main",
						event: "push",
						status: "completed",
						conclusion: "success",
					},
				],
			},
		],
	};
	assert.equal(
		checkMainCandidate((command, args) => {
			assert.equal(command, "gh");
			assert.ok(Object.hasOwn(responses, args.at(-1)), args.at(-1));
			if (args.at(-1).includes("per_page")) {
				assert.ok(args.includes("--paginate"));
				assert.ok(args.includes("--slurp"));
			}
			return JSON.stringify(responses[args.at(-1)]);
		}),
		sha,
	);
});

test("continuous fresh merges cannot reset an older uncovered main update's deadline", () => {
	const input = fixture();
	input.activity.unshift({
		id: 2,
		ref: "refs/heads/main",
		after: "2222222222222222222222222222222222222222",
		timestamp: "2026-10-18T12:30:00Z",
		activity_type: "pr_merge",
	});
	input.head.sha = "2222222222222222222222222222222222222222";
	input.head.commit.committer.date = "2026-10-18T12:30:00Z";
	assert.throws(() => checkCandidateFreshness(input), /2222222222222222222222222222222222222222/);
	input.runs.workflow_runs.push({
		head_sha: input.head.sha,
		display_title: `CLI candidate ${input.head.sha}`,
		head_branch: "main",
		event: "push",
		status: "in_progress",
	});
	assert.equal(checkCandidateFreshness(input), input.head.sha);
});

test("a newer backed main update clears the old gap while giving the next push its budget", () => {
	const input = fixture();
	const newer = "2222222222222222222222222222222222222222";
	input.activity.unshift({
		id: 2,
		ref: "refs/heads/main",
		after: newer,
		timestamp: "2026-10-18T12:30:00Z",
	});
	input.head.sha = newer;
	input.runs.workflow_runs.push({
		head_sha: sha,
		display_title: `CLI candidate ${sha}`,
		head_branch: "main",
		event: "push",
		status: "completed",
		conclusion: "success",
	});
	assert.equal(checkCandidateFreshness(input), newer);
});

test("future committer dates cannot conceal stale build-ahead", () => {
	const input = fixture();
	input.head.commit.committer.date = "2099-01-01T00:00:00Z";
	assert.throws(() => checkCandidateFreshness(input), new RegExp(sha));
	input.activity[0].timestamp = "2099-01-01T00:00:00Z";
	assert.throws(() => checkCandidateFreshness(input), /Invalid main push\/merge timestamp/);
});
