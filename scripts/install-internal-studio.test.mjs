import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { digest, first, fixture, next } from "./fixtures/internal-studio.mjs";
import { installInternalStudio } from "./install-internal-studio.mjs";

for (const variable of ["STUDIO_SOURCE_REPO", "STUDIO_CANDIDATE_REPO"])
	for (const [name, remote, expected] of [
		["https", "https://github.com/fixture/origin-only.git\n", "fixture/origin-only"],
		["ssh", "git@github.com:fixture/origin-only.git\n", "fixture/origin-only"],
		["ssh URL", "ssh://git@github.com/fixture/origin-only.git\n", "fixture/origin-only"],
		["missing", null, "<owner>/<name>"],
		["unparsable", "not-a-github-remote", "<owner>/<name>"],
		["foreign host", "https://example.com/fixture/origin-only.git", "<owner>/<name>"],
		["shell text", "git@github.com:fixture/repo;echo-secret.git", "<owner>/<name>"],
	])
		test(`missing ${variable} prints explicit setup from ${name} origin`, async () => {
			const env = {
				GITHUB_ACTIONS: "false",
				STUDIO_SOURCE_REPO: "fixture/configured-source",
				STUDIO_CANDIDATE_REPO: "fixture/configured-candidate",
			};
			delete env[variable];
			const output = [];
			const calls = [];
			const code = await installInternalStudio(
				{ env, cwd: "/unrelated-course" },
				{
					print: (line) => output.push(line),
					execute: (command, args) => {
						calls.push([command, args]);
						assert.equal(command, "git");
						assert.deepEqual(args.slice(2), ["remote", "get-url", "origin"]);
						assert.equal(args[0], "-C");
						assert.equal(args[1], fileURLToPath(new URL("..", import.meta.url)));
						if (remote === null) throw new Error("untrusted remote stderr");
						return remote;
					},
				},
			);
			assert.equal(code, 1);
			assert.equal(calls.length, 1);
			const message = output.join("\n");
			assert.match(message, new RegExp(`${variable} is required`));
			for (const key of ["STUDIO_SOURCE_REPO", "STUDIO_CANDIDATE_REPO"])
				assert.ok(message.split("\n").includes(`export ${key}=${expected}`), message);
			assert.match(message, /same until the go-public cutover/);
			assert.match(message, /candidate repo is the private CI repo/);
			assert.match(message, /scripts\/install-internal-studio\.md/);
			// Any concrete repository in the message must come from origin, never a baked-in default.
			assert.deepEqual(
				[...message.matchAll(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g)]
					.map((match) => match[0])
					.filter(
						(value) => value !== "owner/name" && value !== "scripts/install-internal-studio.md",
					),
				expected === "<owner>/<name>" ? [] : [expected, expected],
			);
			assert.doesNotMatch(message, /untrusted remote stderr|echo-secret/);
			if (expected === "<owner>/<name>") assert.match(message, /could not derive/i);
		});

for (const status of ["queued", "in_progress"])
	test(`installer skips ${status} dispatched discovery without a source title`, async (t) => {
		const f = fixture(t);
		f.state.runs = [
			{
				id: 43,
				event: "workflow_dispatch",
				head_sha: "b".repeat(40),
				head_branch: "main",
				path: ".github/workflows/cli-candidate.yml",
				display_title: "Scheduled candidate",
				status,
			},
		];
		f.state.candidateJobsByRun = {
			43: { jobs: [{ name: "webkit", conclusion: null, steps: [] }] },
		};
		assert.equal(await f.run(), 0, f.output.join("\n"));
	});

test("installer reads source CI separately from candidate runs and draft releases", async (t) => {
	const f = fixture(t);
	assert.equal(
		await f.run({
			env: {
				...process.env,
				STUDIO_SOURCE_REPO: "fixture/source",
				STUDIO_CANDIDATE_REPO: "fixture/candidates",
			},
		}),
		0,
	);
	for (const call of f.calls) {
		const route = call.find((arg) => typeof arg === "string" && arg.startsWith("repos/"));
		if (!route) continue;
		if (/cli-candidate.yml|releases|runs\/(?:41|42)\//.test(route))
			assert.match(route, /^repos\/fixture\/candidates\//);
		if (/ci.yml|runs\/99\//.test(route)) assert.match(route, /^repos\/fixture\/source\//);
	}
	assert.match(
		f.installations[0].tools[0].archives["darwin-arm64"].url,
		/^https:\/\/github.com\/fixture\/candidates\//,
	);
});

test("installer reuses dispatched candidate titles with a different tooling SHA", async (t) => {
	const f = fixture(t);
	f.state.dispatch = false;
	Object.assign(f.completed, {
		event: "workflow_dispatch",
		head_sha: "b".repeat(40),
		display_title: `CLI candidate ${first}`,
	});
	f.state.selectorRuns = [{ ...f.completed }];
	f.state.candidateJobs = {
		jobs: [
			{
				name: "webkit",
				conclusion: "success",
			},
		],
	};
	assert.equal(await f.run(), 0);
	assert.ok(
		!f.calls.some((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("dispatches")),
		),
	);
});

for (const event of ["push", "workflow_dispatch"])
	test(`installer reuses ${event} title source without probing unrelated run jobs`, async (t) => {
		const f = fixture(t);
		f.state.dispatch = false;
		Object.assign(f.completed, {
			event,
			head_sha: event === "push" ? first : "b".repeat(40),
			display_title: `CLI candidate ${first}`,
		});
		f.state.runs = [
			{ ...f.completed, id: 44, display_title: `CLI candidate ${next}` },
			{ ...f.completed, id: 43, display_title: "CLI candidate main" },
			{ ...f.completed },
		];
		f.state.selectorRuns = [...f.state.runs];
		assert.equal(await f.run(), 0, f.output.join("\n"));
		const jobRoutes = f.calls
			.flat()
			.filter((arg) => typeof arg === "string" && /actions\/runs\/(43|44)\/jobs/.test(arg));
		assert.deepEqual(jobRoutes, []);
		assert.ok(
			!f.calls.flat().some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
		);
	});

test("one command installs, skips the same SHA, then updates while retaining rollback", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	assert.equal(f.installations[0].version, `0.1.1-internal.${first}.${"b".repeat(40)}.42`);
	assert.equal(f.installations[0].tools[0].sourceRevision, first);
	assert.equal(f.installations[0].tools[0].archives["darwin-arm64"].sha256, digest(f.state.bytes));
	assert.match(
		f.installations[0].tools[0].archives["darwin-arm64"].url,
		/^https:\/\/github.com\/fixture\/studio\/releases\/download\/cli-candidate-42\//,
	);
	const count = f.calls.length;
	assert.equal(await f.run(), 0);
	assert.equal(f.installations.length, 1);
	assert.ok(
		!f.calls
			.slice(count)
			.some((call) =>
				call.some((arg) => typeof arg === "string" && /dispatches|releases|archive/.test(arg)),
			),
	);
	f.state.sha = next;
	f.state.runId = 43;
	f.releases[0].tag_name = "cli-candidate-43";
	f.releases[0].target_commitish = next;
	f.releases[0].body = `Studio SHA: ${next}`;
	assert.equal(await f.run(), 0);
	assert.equal(f.retained.get(`0.1.1-internal.${first}.${"b".repeat(40)}.42`), first);
	assert.equal(f.installations.length, 2);
	assert.equal(
		readFileSync(f.active, "utf8"),
		`0.1.1-internal.${next}.${"b".repeat(40)}.43\n0.1.1-internal.${first}.${"b".repeat(40)}.42\n`,
	);
	assert.deepEqual(readdirSync(f.temporary), []);
	const results = f.output.filter(
		(line) => !line.includes(": waiting") && !line.includes(": selected"),
	);
	assert.deepEqual(results, [
		`main ${first}: installed; version=0.1.1-internal.${first}.${"b".repeat(40)}.42 studioSha=${first}`,
		`main ${first}: already current; version=0.1.1-internal.${first}.${"b".repeat(40)}.42 studioSha=${first}`,
		`main ${next}: installed; version=0.1.1-internal.${next}.${"b".repeat(40)}.43 studioSha=${next}`,
	]);
	for (const line of results) t.diagnostic(line);
});

for (const [name, mutate, message] of [
	[
		"corrupt archive",
		(f) => {
			f.state.downloadBytes = Buffer.from("TAMPERED");
		},
		/digest mismatch/,
	],
	[
		"checksum disagrees",
		(f) => {
			f.assets[0].digest = `sha256:${"0".repeat(64)}`;
		},
		/checksum disagrees/,
	],
	[
		"missing native archive",
		(f) => {
			f.assets.shift();
		},
		/Missing or duplicate native archive/,
	],
	[
		"missing checksum",
		(f) => {
			f.assets.pop();
		},
		/Missing candidate checksum/,
	],
	[
		"different draft SHA",
		(f) => {
			f.releases[0].target_commitish = next;
			f.releases[0].body = `Studio SHA: ${next}`;
		},
		/different SHA/,
	],
	[
		"different inventory SHA",
		(f) => {
			f.state.inventorySha = next;
		},
		/Untested or dirty/,
	],
	[
		"published draft",
		(f) => {
			f.releases[0].draft = false;
		},
		/private draft prerelease/,
	],
	[
		"wrong workflow",
		(f) => {
			f.completed.path = ".github/workflows/ci.yml";
		},
		/Candidate tooling or source is not admitted/,
	],
	[
		"failed workflow",
		(f) => {
			f.completed.conclusion = "failure";
		},
		/candidate build failed/,
	],
	[
		"invalid main",
		(f) => {
			f.state.sha = "main";
		},
		/Invalid main SHA/,
	],
	[
		"low free space",
		(f) => {
			f.state.space = 8n * 1024n ** 3n - 1n;
		},
		/Less than 8 GiB/,
	],
	[
		"running Studio",
		(f) => {
			f.state.busy = true;
		},
		/Save or copy/,
	],
	[
		"dirty Rubato",
		(f) => {
			f.state.dirty = true;
		},
		/Rubato has tracked edits/,
	],
	[
		"GitHub failure",
		(f) => {
			f.state.networkFailure = true;
		},
		/Check gh auth status/,
	],
	[
		"duplicate archive",
		(f) => {
			f.assets.push({ ...f.assets[0] });
		},
		/Missing or duplicate native archive/,
	],
	[
		"duplicate checksum",
		(f) => {
			f.assets.push({ ...f.assets[1] });
		},
		/Missing candidate checksum/,
	],
	[
		"invalid checksum asset ID",
		(f) => {
			f.assets[1].id = 0;
		},
		/Missing candidate checksum/,
	],
	[
		"missing draft",
		(f) => {
			f.releases.pop();
		},
		/Missing or duplicate candidate draft/,
	],
	[
		"duplicate draft",
		(f) => {
			f.releases.push({ ...f.releases[0] });
		},
		/Missing or duplicate candidate draft/,
	],
	[
		"invalid draft ID",
		(f) => {
			f.releases[0].id = 0;
		},
		/Invalid draft ID/,
	],
	[
		"invalid dispatch ID",
		(f) => {
			f.state.runId = 0;
		},
		/Dispatch returned no run ID/,
	],
	[
		"malformed ownership record",
		(f) => {
			mkdirSync(join(f.home, ".praxity"));
			writeFileSync(
				join(f.home, ".praxity/internal-studio-candidates.json"),
				'[{"runId":0,"sha":"main"}]',
			);
		},
		/Invalid candidate ownership record/,
	],
])
	test(`${name} refuses without activation`, async (t) => {
		const f = fixture(t);
		mutate(f);
		assert.equal(await f.run(), 1);
		assert.equal(f.installations.length, 0);
		assert.equal(existsSync(f.active), false);
		assert.match(f.output.at(-1), message);
		assert.match(f.output.at(-1), /refused:.*version=none studioSha=none/);
		if (name === "running Studio") assert.ok(f.output.at(-1).startsWith(`main ${first}: refused:`));
		assert.deepEqual(readdirSync(f.temporary), []);
		if (["low free space", "running Studio"].includes(name))
			assert.ok(
				!f.calls.some((call) =>
					call.some((arg) => typeof arg === "string" && /dispatches|releases/.test(arg)),
				),
			);
	});

test("a successful candidate for current main is reused without dispatch", async (t) => {
	const f = fixture(t);
	f.state.dispatch = false;
	assert.equal(await f.run(), 0);
	assert.ok(
		!f.calls.some((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("dispatches")),
		),
	);
	assert.ok(!existsSync(join(f.home, ".praxity/internal-studio-candidates.json")));
});

for (const conclusion of ["failure", "skipped", "cancelled", "absent"]) {
	test(`candidate selection refuses ${conclusion} WebKit before installing`, async (t) => {
		const f = fixture(t);
		f.state.candidateJobs = {
			jobs: conclusion === "absent" ? [] : [{ name: "webkit", conclusion }],
		};
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /candidate WebKit/);
		assert.equal(f.installations.length, 0);
	});
}

test("a legacy candidate cannot replace another candidate's WebKit success", async (t) => {
	const f = fixture(t);
	f.state.dispatch = false;
	f.state.candidateJobsByRun = { 42: { jobs: [] } };
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /candidate 42 requires a successful WebKit/);
	assert.equal(f.installations.length, 0);
});

test("the installer admits the exact candidate's WebKit job on page two", async (t) => {
	const f = fixture(t);
	f.state.candidateJobsByRun = {
		42: [
			{ jobs: [{ name: "build", conclusion: "success" }] },
			{ jobs: [{ name: "webkit", conclusion: "success" }] },
		],
	};
	assert.equal(await f.run(), 0);
	assert.equal(f.installations.length, 1);
	assert.equal(f.installations[0].tools[0].sourceRevision, first);
});

test("a verified build-ahead candidate is downloaded without dispatch or waiting", async (t) => {
	const f = fixture(t);
	f.state.dispatch = false;
	f.completed.event = "push";
	assert.equal(await f.run(), 0);
	assert.equal(f.installations.length, 1);
	assert.ok(
		!f.calls.some(
			(call) =>
				call.includes("watch") ||
				call.some((arg) => typeof arg === "string" && arg.includes("dispatches")),
		),
	);
});

test("the installer shares squash admission and reuses a main-push internal draft", async (t) => {
	const f = fixture(t);
	const head = "2222222222222222222222222222222222222222";
	const parent = "3333333333333333333333333333333333333333";
	const tree = "4444444444444444444444444444444444444444";
	f.state.dispatch = false;
	f.completed.event = "push";
	f.state.commitMetadata = {
		[first]: {
			sha: first,
			tree_sha: tree,
			parents: [{ sha: parent }],
			commit: { committer: { date: "2026-10-15T09:54:49Z" } },
		},
		[head]: { sha: head, tree_sha: tree },
	};
	f.state.pulls = [
		{
			number: 42,
			merged_at: "2026-10-18T10:00:00Z",
			merge_commit_sha: first,
			base: { ref: "main" },
			head: { sha: head },
		},
	];
	f.state.ciRuns = [
		{
			id: 99,
			head_sha: head,
			head_branch: "fix/branch",
			event: "workflow_dispatch",
			display_title: `CI candidate ${head}`,
			status: "completed",
			conclusion: "success",
		},
	];
	f.state.ciJobs = {
		jobs: [
			{ name: "merge-gate", conclusion: "success" },
			{
				name: "changes",
				conclusion: "success",
				steps: [{ name: `Candidate base ${parent}`, conclusion: "success" }],
			},
		],
	};
	assert.equal(await f.run(), 0, f.output.join("\n"));
	assert.equal(f.installations[0].tools[0].sourceRevision, first);
	assert.ok(
		!f.calls.some(
			(call) => call.includes("watch") || call.some((arg) => String(arg).includes("dispatches")),
		),
	);
});

for (const [name, change] of [
	[
		"push from another branch",
		(f) => {
			f.completed.head_branch = "feature";
		},
	],
	[
		"push for another source",
		(f) => {
			f.completed.head_sha = next;
		},
	],
	[
		"non-internal draft",
		(f) => {
			f.releases[0].draft = false;
		},
	],
])
	test(`push candidate refuses ${name}`, async (t) => {
		const f = fixture(t);
		f.state.dispatch = false;
		f.completed.event = "push";
		change(f);
		assert.equal(await f.run(), 1, f.output.join("\n"));
		assert.equal(f.installations.length, 0);
	});

test("a ready candidate wins over a newer build that is still running", async (t) => {
	const f = fixture(t);
	f.state.dispatch = false;
	f.completed.event = "push";
	f.state.runs = [
		{ ...f.completed, id: 43, head_sha: first, status: "in_progress" },
		{ ...f.completed, head_sha: first },
	];
	assert.equal(await f.run(), 0);
	assert.ok(!f.calls.some((call) => call.includes("watch")));
	assert.equal(f.installations[0].version, `0.1.1-internal.${first}.${"b".repeat(40)}.42`);
});

for (const [name, change] of [
	[
		"different source",
		(f) => {
			f.state.completedTitle = `CLI candidate ${next}`;
		},
	],
	[
		"off-main tooling",
		(f) => {
			f.completed.head_sha = "c".repeat(40);
			f.state.offMainTooling = "c".repeat(40);
		},
	],
])
	test(`build-ahead refuses ${name}`, async (t) => {
		const f = fixture(t);
		f.state.dispatch = false;
		f.completed.event = "push";
		change(f);
		assert.equal(await f.run(), 1);
		assert.equal(f.installations.length, 0);
		assert.match(f.output.at(-1), /Candidate tooling or source is not admitted/);
	});

test("an old installed CLI uses its original version subcommand", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.oldVersion = true;
	assert.equal(await f.run(), 0);
	assert.match(f.output.at(-1), /already current/);
	assert.ok(f.calls.some((call) => call[0] === "sh" && call.at(-1) === "version"));
});

test("failed activation reports installer rollback and preserves the installed pack", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.sha = next;
	f.state.runId = 43;
	f.releases[0].tag_name = "cli-candidate-43";
	f.releases[0].target_commitish = next;
	f.releases[0].body = `Studio SHA: ${next}`;
	f.state.activationFailure = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /refused: Activation failed; rolled back.*studioSha=12345678/);
	assert.equal(f.state.installed.studioSha, first);
	assert.equal(f.output.at(-1).includes("\n"), false);
	assert.deepEqual(readdirSync(f.temporary), []);
});

test("skill refresh failure exits nonzero while reporting the new active version", async (t) => {
	const f = fixture(t);
	f.state.refreshFailure = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /skill refresh failed.*studioSha=12345678/);
});

test("cleanup uses source metadata across tooling targets and preserves every other draft", async (t) => {
	const f = fixture(t);
	f.state.newRelease = f.releases.shift();
	mkdirSync(join(f.home, ".praxity"));
	writeFileSync(
		join(f.home, ".praxity/internal-studio-candidates.json"),
		JSON.stringify([10, 20, 30].map((runId) => ({ runId, sha: first }))),
	);
	for (const runId of [10, 20, 30, 40])
		f.releases.push({
			id: runId,
			tag_name: `cli-candidate-${runId}`,
			target_commitish: "b".repeat(40),
			body: `Studio SHA: ${first}`,
			draft: true,
			prerelease: true,
		});
	f.releases.push({ id: 99, tag_name: "unrelated", draft: true });
	assert.equal(await f.run(), 0);
	assert.deepEqual(
		f.calls
			.filter((call) => call.includes("DELETE"))
			.map((call) => call.find((arg) => arg.startsWith("repos/"))),
		["repos/fixture/studio/releases/20", "repos/fixture/studio/releases/10"],
	);
	assert.deepEqual(
		JSON.parse(readFileSync(join(f.home, ".praxity/internal-studio-candidates.json"))).map(
			(record) => record.runId,
		),
		[30, 42],
	);
});

for (const volume of ["homeSpace", "tempSpace"])
	test("independent low disk refusal " + volume, async (t) => {
		const f = fixture(t);
		f.state[volume] = 8n * 1024n ** 3n - 1n;
		assert.equal(await f.run(), 1);
		assert.equal(f.installations.length, 0);
		assert.match(f.output.at(-1), /Less than 8 GiB/);
		assert.deepEqual(readdirSync(f.temporary), []);
	});
test("candidate still running refuses after watch without activation", async (t) => {
	const f = fixture(t);
	f.completed.status = "in_progress";
	assert.equal(await f.run(), 1);
	assert.equal(f.installations.length, 0);
	assert.match(f.output.at(-1), /candidate build did not finish/);
	assert.deepEqual(readdirSync(f.temporary), []);
});
test("cleanup rechecks owned draft before deletion", async (t) => {
	const f = fixture(t);
	mkdirSync(join(f.home, ".praxity"));
	writeFileSync(
		join(f.home, ".praxity/internal-studio-candidates.json"),
		JSON.stringify([10, 20, 30].map((runId) => ({ runId, sha: first }))),
	);
	for (const runId of [10, 20, 30])
		f.releases.push({
			id: runId,
			tag_name: "cli-candidate-" + runId,
			target_commitish: first,
			body: `Studio SHA: ${first}`,
			draft: true,
			prerelease: true,
		});
	// getters expose the listed object unchanged, but mutate a freshly fetched release.
	const oldFind = f.releases.find.bind(f.releases);
	let reads = 0;
	f.releases.find = (cb) => {
		const value = oldFind(cb);
		if (value?.id === 20 && ++reads === 1) return { ...value, draft: false };
		return value;
	};
	assert.equal(await f.run(), 1);
	assert.ok(!f.calls.some((c) => c.includes("DELETE")));
	assert.match(f.output.at(-1), /Owned candidate changed/);
	assert.deepEqual(readdirSync(f.temporary), []);
});

for (const [label, alter, message] of [
	["wrong activated SHA", (f) => (f.state.activatedSha = next), /Installed version does not match/],
	[
		"wrong activated pack",
		(f) => (f.state.activatedPack = "9.9.9"),
		/Installed version does not match/,
	],
	[
		"wrong workflow event",
		(f) => (f.completed.event = "pull_request"),
		/Candidate tooling or source is not admitted/,
	],
	["not prerelease", (f) => (f.releases[0].prerelease = false), /private draft prerelease/],
	["wrong checksum name", (f) => (f.state.checksumName = "other.tar.gz"), /checksum disagrees/],
	[
		"invalid reused candidate ID",
		(f) => {
			f.state.dispatch = false;
			f.completed.id = 0;
			f.releases[0].tag_name = "cli-candidate-0";
		},
		/Invalid candidate run ID/,
	],
])
	test("strengthened guard " + label, async (t) => {
		const f = fixture(t);
		alter(f);
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), message);
	});
for (const [key, value] of [
	["id", 999],
	["tag_name", "other"],
	["prerelease", false],
	["body", `Studio SHA: ${next}`],
])
	test("fresh cleanup identity " + key, async (t) => {
		const f = fixture(t);
		mkdirSync(join(f.home, ".praxity"));
		writeFileSync(
			join(f.home, ".praxity/internal-studio-candidates.json"),
			JSON.stringify([10, 20, 30].map((runId) => ({ runId, sha: first }))),
		);
		for (const runId of [10, 20, 30])
			f.releases.push({
				id: runId,
				tag_name: "cli-candidate-" + runId,
				target_commitish: first,
				body: `Studio SHA: ${first}`,
				draft: true,
				prerelease: true,
			});
		f.state.freshDraftOverrides = { [key]: value };
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /Owned candidate changed/);
		assert.ok(!f.calls.some((c) => c.includes("DELETE")));
	});
test("reject unsupported platform explicitly", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run({ platform: "linux-x64" }), 1);
	assert.match(f.output.at(-1), /Use this command on macOS/);
});
test("require checkout explicitly", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run({ rubatoRoot: undefined }), 1);
	assert.match(f.output.at(-1), /Supply --rubato/);
});
test("reject missing external API explicitly", async (t) => {
	const f = fixture(t),
		root = join(f.root, "rubato");
	for (const dir of ["src", "scripts"]) mkdirSync(join(root, dir));
	for (const file of [
		"src/manifest.mjs",
		"src/cli.mjs",
		"scripts/publish-studio-pack.mjs",
		"src/tools.mjs",
	])
		writeFileSync(join(root, file), "export {};");
	writeFileSync(
		join(root, "src/update.mjs"),
		"export const installVerifiedPack=()=>0; export const assertStudioClosed=()=>{};",
	);
	f.state.external = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /needs the verified local installation API/);
});

for (const [label, alter, message] of [
	["feature checkout", (f) => (f.state.branch = "feature"), /main.*pull|switch.*main/],
	["detached checkout", (f) => (f.state.branch = ""), /main.*pull|switch.*main/],
	["behind checkout", (f) => (f.state.remoteSha = "c".repeat(40)), /pull.*ff-only/],
	["wrong installed inventory", (f) => (f.state.activeInventorySha = next), /inventory|candidate/],
])
	test(label + " refuses", async (t) => {
		const f = fixture(t);
		alter(f);
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), message);
	});

test("the active pack platform chooses the candidate under translated Node", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.sha = next;
	f.state.runId = 43;
	f.releases[0].tag_name = "cli-candidate-43";
	f.releases[0].target_commitish = next;
	f.releases[0].body = `Studio SHA: ${next}`;
	assert.equal(await f.run({ platform: "darwin-x64" }), 0);
	assert.equal(f.installations[1].tools[0].archives["darwin-arm64"].sha256, digest(f.state.bytes));
});
test("same main refuses uncertified active pack", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.doctorFailure = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /doctor.*rollback/);
});
test("same main applies a newer reviewed Rubato commit", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.rubatoSha = "c".repeat(40);
	assert.equal(await f.run(), 0);
	assert.equal(f.installations.length, 2);
	assert.notEqual(f.installations[0].version, f.installations[1].version);
});
test("same main retries a failed activation with an identical manifest", async (t) => {
	const f = fixture(t);
	f.state.activationFailure = true;
	assert.equal(await f.run(), 1);
	f.state.activationFailure = false;
	assert.equal(await f.run(), 0);
	assert.deepEqual(f.installations[0], f.installations[1]);
});
test("same main retries a skills refusal with its exact scope and path", async (t) => {
	const f = fixture(t);
	f.state.refreshFailure = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /prax-format.*SKILL.md/);
	assert.match(f.output.at(-1), /--scope user/);
	assert.equal(await f.run(), 1);
	f.state.refreshFailure = false;
	assert.equal(await f.run(), 0);
	assert.equal(f.installations.length, 1);
});
for (const [label, overrides] of [
	["failed run", { conclusion: "failure" }],
	["different input", { display_title: `CLI candidate ${next}` }],
])
	test("reuse skips " + label, async (t) => {
		const f = fixture(t);
		f.state.runs = [{ ...f.completed, head_sha: first, ...overrides }];
		assert.equal(await f.run(), 0);
		assert.ok(
			f.calls.some((call) =>
				call.some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
			),
		);
	});
for (const invalid of [
	{ runId: 0, sha: first },
	{ runId: 1.5, sha: first },
])
	test("invalid ownership ID " + invalid.runId, async (t) => {
		const f = fixture(t);
		mkdirSync(join(f.home, ".praxity"));
		writeFileSync(
			join(f.home, ".praxity/internal-studio-candidates.json"),
			JSON.stringify([invalid]),
		);
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /Invalid candidate ownership record/);
	});
test("owned cleanup skips an old draft built for a different SHA", async (t) => {
	const f = fixture(t);
	mkdirSync(join(f.home, ".praxity"));
	writeFileSync(
		join(f.home, ".praxity/internal-studio-candidates.json"),
		JSON.stringify([10, 20, 30].map((runId) => ({ runId, sha: first }))),
	);
	for (const runId of [10, 20, 30])
		f.releases.push({
			id: runId,
			tag_name: `cli-candidate-${runId}`,
			target_commitish: runId === 20 ? next : first,
			body: `Studio SHA: ${runId === 20 ? next : first}`,
			draft: true,
			prerelease: true,
		});
	assert.equal(await f.run(), 0);
	assert.ok(
		!f.calls.some(
			(call) => call.includes("DELETE") && call.includes("repos/fixture/studio/releases/20"),
		),
	);
});
test("installer stack reports its Error reason", async (t) => {
	const f = fixture(t);
	f.state.activationFailure = true;
	// Replace the external failure with the Node-style diagnostic seen in review.
	f.state.stackFailure = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /different manifest/);
});

test("reuse skips a successful run whose built SHA differs", async (t) => {
	const f = fixture(t);
	f.state.runs = [{ ...f.completed, id: 99, head_sha: first }];
	f.releases.push({
		id: 99,
		tag_name: "cli-candidate-99",
		target_commitish: next,
		body: `Studio SHA: ${next}`,
		draft: true,
		prerelease: true,
	});
	assert.equal(await f.run(), 0);
	assert.ok(
		f.calls.some((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
		),
	);
});

for (const [name, field, value, message] of [
	["untracked checkout", "untracked", true, /tracked edits|untracked/],
	["invalid bootstrap SHA", "rubatoSha", "bad", /Invalid Rubato revision/],
	["dirty installed inventory", "activeDirty", true, /inventory/],
	["wrong installed arch", "activeArch", "x64", /inventory/],
	["wrong installed OS", "activePlatform", "linux", /inventory/],
	["wrong installed archive digest", "activeDigest", "0".repeat(64), /digest/],
	["different active pointer", "activePointer", "0.0.0", /active pointer/],
])
	test(name, async (t) => {
		const f = fixture(t);
		f.state[field] = value;
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), message);
	});
test("a pending activation cannot use the already-current shortcut", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	writeFileSync(join(f.home, ".praxity/toolkit/.activation-pending"), "pending");
	assert.equal(await f.run(), 0);
	assert.equal(f.installations.length, 2);
	assert.match(f.output.at(-1), /: installed;/);
});

test("an unsupported active platform refuses before candidate work", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.installedPlatform = "linux-x64";
	const count = f.calls.length;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /Unsupported installed pack platform/);
	assert.ok(
		!f.calls
			.slice(count)
			.some((call) => call.some((arg) => typeof arg === "string" && arg.includes("/releases"))),
	);
});

for (const boundary of ["session check", "watch"])
	test(`bootstrap stays at the admitted Rubato commit when HEAD moves during ${boundary}`, async (t) => {
		const f = fixture(t),
			repo = f.rubatoRoot;
		const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
		git("init", "-b", "main");
		git("config", "user.name", "Fixture");
		git("config", "user.email", "fixture@example.invalid");
		git("config", "core.autocrlf", "false");
		for (const dir of ["src", "scripts", "schemas", "skills", "fixtures"]) {
			mkdirSync(join(repo, dir));
			writeFileSync(join(repo, dir, "marker"), "admitted");
		}
		for (const file of ["install.sh", "LICENSE", "package.json"])
			writeFileSync(join(repo, file), "admitted");
		writeFileSync(
			join(repo, "pack.json"),
			JSON.stringify({ version: "0.1.1", tools: [{ id: "studio", archives: {} }] }),
		);
		git("add", ".");
		git("commit", "-m", "admitted");
		const admitted = git("rev-parse", "HEAD").trim();
		git("remote", "add", "origin", repo);
		git("fetch", "origin");
		f.state.realGit = true;
		const moveHead = () => {
			git("switch", "-c", "later");
			writeFileSync(join(repo, "src/marker"), "unadmitted");
			writeFileSync(
				join(repo, "pack.json"),
				JSON.stringify({ version: "9.9.9", tools: [{ id: "studio", archives: {} }] }),
			);
			git("add", ".");
			git("commit", "-m", "later");
		};
		if (boundary === "watch") f.state.onWatch = moveHead;
		else {
			const check = f.rubato.assertStudioClosed;
			let moved = false;
			f.rubato.assertStudioClosed = () => {
				check();
				if (!moved) {
					moved = true;
					moveHead();
				}
			};
		}
		assert.equal(await f.run(), 0, f.output.join("\n"));
		assert.equal(f.installations[0].version, `0.1.1-internal.${first}.${admitted}.42`);
		assert.equal(
			readFileSync(
				join(f.home, ".praxity/toolkit", f.state.installed.pack, "bootstrap-marker"),
				"utf8",
			),
			"admitted",
		);
	});

test("a missing admitted Rubato commit refuses rather than exporting the new HEAD", async (t) => {
	const f = fixture(t);
	f.state.missingRevision = true;
	assert.equal(await f.run(), 1);
	assert.equal(f.installations.length, 0);
	assert.match(f.output.at(-1), /commit.*unavailable/);
	assert.deepEqual(readdirSync(f.temporary), []);
});

test("same main refuses an installed inventory that disagrees with its manifest", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	const inventory = join(
		f.home,
		".praxity/toolkit",
		f.state.installed.pack,
		"tools/studio/inventory.json",
	);
	const changed = JSON.parse(readFileSync(inventory));
	changed.sourceRevision = next;
	writeFileSync(inventory, JSON.stringify(changed));
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /inventory/);
	assert.equal(f.installations.length, 1);
});

test("the external API must provide skill refresh before the first installation", async (t) => {
	const f = fixture(t),
		root = f.rubatoRoot;
	for (const dir of ["src", "scripts"]) mkdirSync(join(root, dir));
	for (const file of ["src/manifest.mjs", "src/cli.mjs", "src/tools.mjs"])
		writeFileSync(join(root, file), "export {};");
	writeFileSync(
		join(root, "scripts/publish-studio-pack.mjs"),
		"export const verifyStudioArchive=()=>{};",
	);
	writeFileSync(
		join(root, "src/update.mjs"),
		"export const installVerifiedPack=()=>0; export const assertStudioClosed=()=>{};",
	);
	f.state.external = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /needs the verified local installation API/);
});

test("a single uncertified pack gives a reinstall recovery path", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	f.state.doctorFailure = true;
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /reinstall|installer/);
});

for (const signal of ["SIGINT", "SIGTERM"])
	for (const failed of [false, true])
		test(`command ${signal} waits for its installer and removes scratch, failed=${failed}`, {
			skip: process.platform === "win32",
		}, (t) => {
			const root = mkdtempSync(join(tmpdir(), "internal-signal-"));
			t.after(() => rmSync(root, { recursive: true }));
			const helper = new URL("./fixtures/internal-studio.mjs", import.meta.url).href;
			const script = `import {fixture} from ${JSON.stringify(helper)};
 import {execFileSync} from 'node:child_process';
 import {writeFileSync} from 'node:fs';
 const f=fixture({after:()=>{}});writeFileSync(process.argv[1],JSON.stringify({root:f.root,temporary:f.temporary}));
 f.state.onInstall=()=>{execFileSync(process.execPath,['-e',\`process.kill(\${process.pid},${JSON.stringify(signal)});require('node:fs').writeFileSync(process.argv[1],'settled')\`,process.argv[2]]);if(${failed})throw new Error('installer failed after settling');};
 process.exitCode=await f.run();
 console.log(f.output.join(String.fromCharCode(10)));`;
			const record = join(root, "fixture.json"),
				settled = join(root, "settled");
			const result = spawnSync(
				process.execPath,
				["--input-type=module", "-e", script, record, settled],
				{ encoding: "utf8", timeout: 10000 },
			);
			assert.ok(existsSync(record), result.stderr);
			const f = JSON.parse(readFileSync(record));
			t.after(() => rmSync(f.root, { recursive: true }));
			assert.equal(result.status, signal === "SIGINT" ? 130 : 143, result.stderr);
			assert.equal(readFileSync(settled, "utf8"), "settled");
			assert.deepEqual(readdirSync(f.temporary), []);
			assert.doesNotMatch(result.stdout, /: installed;/);
			assert.match(result.stdout, /refused:.*interrupted/);
		});

test("invalid pinned manifest refuses before installing", async (t) => {
	const f = fixture(t);
	f.state.manifestErrors = ["Invalid pinned manifest"];
	assert.equal(await f.run(), 1);
	assert.match(f.output.at(-1), /Invalid pack manifest/);
	assert.equal(f.installations.length, 0);
});

test("select newest green main commit rather than failed head", async (t) => {
	const f = fixture(t);
	f.state.mainSha = next;
	f.state.commits = [{ sha: next }, { sha: first }];
	f.state.ciRuns = [
		{
			id: 100,
			head_sha: next,
			head_branch: "main",
			event: "schedule",
			status: "completed",
			conclusion: "failure",
		},
		{
			id: 99,
			head_sha: first,
			head_branch: "main",
			event: "schedule",
			status: "completed",
			conclusion: "success",
		},
	];
	assert.equal(await f.run(), 0, f.output.join("\n"));
	assert.match(f.output[0], /selected.*newest.*full Ubicloud CI.*99/);
	assert.equal(f.installations[0].tools[0].sourceRevision, first);
	assert.ok(
		f.calls.some((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
		),
	);
});

test("the newest admitted main revision wins over a newer CI run for older source", async (t) => {
	const f = fixture(t);
	f.state.sha = next;
	f.state.commits = [{ sha: next }, { sha: first }];
	f.state.ciRuns = [
		{
			id: 101,
			head_sha: first,
			head_branch: "main",
			event: "workflow_dispatch",
			status: "completed",
			conclusion: "success",
		},
		{
			id: 99,
			head_sha: next,
			head_branch: "main",
			event: "workflow_dispatch",
			status: "completed",
			conclusion: "success",
		},
	];
	f.releases[0].target_commitish = next;
	f.releases[0].body = `Studio SHA: ${next}`;
	assert.equal(await f.run(), 0, f.output.join("\n"));
	assert.equal(f.installations[0].tools[0].sourceRevision, next);
	assert.match(f.output[0], /full Ubicloud CI run 99/);
});

test("the installer refuses source that fails main reachability before choosing a build", async (t) => {
	const f = fixture(t);
	f.state.comparisons = { [`${first}...${first}`]: { merge_base_commit: { sha: next } } };
	assert.equal(await f.run(), 1);
	assert.equal(f.installations.length, 0);
	assert.ok(!f.calls.some((call) => call.some((arg) => String(arg).includes("dispatches"))));
});

for (const bad of [
	"missing",
	"failed",
	"pending",
	"pull request",
	"no merge gate",
	"newer failure",
]) {
	test(`refuse main without full CI: ${bad}`, async (t) => {
		const f = fixture(t);
		const green = {
			id: 99,
			head_sha: first,
			head_branch: "main",
			event: "schedule",
			status: "completed",
			conclusion: "success",
		};
		f.state.ciRuns = [green];
		if (bad === "missing") f.state.ciRuns = [];
		if (bad === "failed") green.conclusion = "failure";
		if (bad === "pending") green.status = "in_progress";
		if (bad === "pull request") green.event = "pull_request";
		if (bad === "no merge gate") f.state.ciJobs = { jobs: [] };
		if (bad === "newer failure")
			f.state.ciRuns.unshift({ ...green, id: 100, conclusion: "failure" });
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /No main SHA in the last 100 commits.*full Ubicloud CI/);
		assert.equal(f.installations.length, 0);
		assert.ok(!f.calls.some((call) => call.some((arg) => String(arg).includes("dispatches"))));
	});
}

test("failed candidate watch reports workflow, run and URL rather than auth", async (t) => {
	const f = fixture(t);
	f.state.watchFailure = true;
	f.completed.conclusion = "failure";
	assert.equal(await f.run(), 1);
	assert.match(
		f.output.at(-1),
		/refused: candidate build failed: cli-candidate.yml run 42 https:\/\/github.com\/fixture\/studio\/actions\/runs\/42/,
	);
	assert.doesNotMatch(f.output.at(-1), /auth/);
	assert.equal(f.installations.length, 0);
});

for (const status of ["completed", "in_progress"])
	test(`older green source reuses its internal candidate built by newer main tooling (${status})`, async (t) => {
		const f = fixture(t);
		f.state.mainSha = next;
		f.state.runs = [{ ...f.completed, head_sha: next, status }];
		assert.equal(await f.run(), 0);
		assert.ok(!f.calls.some((call) => call.some((arg) => String(arg).includes("/dispatches"))));
		const query = f.calls.find((call) =>
			call.some((arg) => String(arg).includes("/workflows/cli-candidate.yml/runs?")),
		);
		assert.ok(!query.some((arg) => String(arg).includes("head_sha=")));
	});

test("internal command does not reuse legacy internal-install titles", async (t) => {
	const f = fixture(t);
	f.state.runs = [
		{
			...f.completed,
			head_sha: first,
			status: "in_progress",
			display_title: `CLI candidate ${first} internal install`,
		},
	];
	assert.equal(await f.run(), 0);
	assert.ok(
		f.calls.some((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
		),
	);
});

test("fallback identifies captured main, selected commit date and age", async (t) => {
	const f = fixture(t);
	f.state.mainSha = next;
	f.state.commits = [
		{ sha: next, commit: { committer: { date: "2026-10-17T21:06:22Z" } } },
		{ sha: first, commit: { committer: { date: "2026-10-15T09:54:49Z" } } },
	];
	assert.equal(await f.run(), 0, f.output.join("\n"));
	assert.match(f.output.join("\n"), /committed 2026-10-15T09:54:49.000Z; age 72h/);
	assert.match(
		f.output.join("\n"),
		new RegExp(
			`older than current main ${next}.*recent features require a newer admitted main revision`,
		),
	);
});

test("older green fallback refuses to downgrade the active Studio", async (t) => {
	const f = fixture(t);
	f.state.sha = next;
	f.releases[0].target_commitish = next;
	f.releases[0].body = `Studio SHA: ${next}`;
	assert.equal(await f.run(), 0);
	const active = readFileSync(f.active, "utf8"),
		installed = { ...f.state.installed };
	const count = f.calls.length;
	f.state.sha = first;
	f.state.mainSha = next;
	f.state.installedComparison = "ahead";
	f.releases[0].target_commitish = first;
	f.releases[0].body = `Studio SHA: ${first}`;
	assert.equal(await f.run(), 1);
	assert.match(
		f.output.at(-1),
		/refused:.*older than installed Studio.*Run full ci.yml successfully on current main/,
	);
	assert.deepEqual(f.state.installed, installed);
	assert.equal(readFileSync(f.active, "utf8"), active);
	assert.equal(f.installations.length, 1);
	assert.ok(
		!f.calls
			.slice(count)
			.some((call) => call.some((arg) => /dispatches|releases/.test(String(arg)))),
	);
});

for (const status of ["completed", "in_progress"]) {
	test(`run dispatched from an unreviewed branch is not reused (${status})`, async (t) => {
		const f = fixture(t);
		f.state.runs = [
			{
				...f.completed,
				head_branch: "feature/unreviewed-build-script",
				head_sha: "c".repeat(40),
				status,
			},
		];
		Object.assign(f.completed, {
			head_branch: "feature/unreviewed-build-script",
			head_sha: "c".repeat(40),
		});
		const code = await f.run();
		const dispatched = f.calls.some((call) =>
			call.some((arg) => String(arg).includes("/dispatches")),
		);
		assert.ok(
			dispatched || code !== 0,
			"installed a branch-built candidate without dispatching from main",
		);
		assert.equal(f.installations.length, 0);
	});
	for (const bad of ["off-main tooling", "wrong source"]) {
		test(`candidate reuse rejects ${bad} (${status})`, async (t) => {
			const f = fixture(t);
			f.state.runs = [{ ...f.completed, head_branch: "main", head_sha: "c".repeat(40), status }];
			if (bad === "off-main tooling") f.state.offMainTooling = "c".repeat(40);
			else f.state.runs[0].display_title = `CLI candidate ${next}`;
			assert.equal(await f.run(), 0, f.output.join("\n"));
			assert.ok(
				f.calls.some((call) =>
					call.some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
				),
			);
		});
	}
}

for (const bad of ["branch tooling", "off-main tooling", "wrong source"]) {
	test(`post-wait candidate admission refuses ${bad}`, async (t) => {
		const f = fixture(t);
		if (bad === "branch tooling") f.completed.head_branch = "feature/unreviewed";
		if (bad === "off-main tooling") {
			f.completed.head_sha = "c".repeat(40);
			f.state.offMainTooling = "c".repeat(40);
		}
		if (bad === "wrong source") f.completed.display_title = `CLI candidate ${next}`;
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /Candidate tooling or source is not admitted/);
		assert.equal(f.installations.length, 0);
	});
}

for (const date of [undefined, "invalid date"]) {
	test(`missing or invalid selected commit date refuses: ${date}`, async (t) => {
		const f = fixture(t);
		f.state.commits = [{ sha: first, commit: { committer: { date } } }];
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /no valid commit date/);
		assert.equal(f.installations.length, 0);
	});
}

for (const status of ["diverged", undefined]) {
	test(`unproven installed source order refuses: ${status}`, async (t) => {
		const f = fixture(t);
		assert.equal(await f.run(), 0);
		f.state.sha = next;
		f.state.installedComparison = status ?? "unknown";
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /Cannot establish the selected source's order/);
		assert.equal(f.installations.length, 1);
	});
}

for (const status of ["completed", "in_progress"]) {
	test(`built source must exactly match selected source (${status})`, async (t) => {
		const f = fixture(t);
		f.state.runs = [{ ...f.completed, head_sha: first, status }];
		f.state.inventorySha = next;
		assert.equal(await f.run(), 1);
		assert.match(f.output.at(-1), /Untested or dirty/);
		assert.equal(f.installations.length, 0);
	});
}

test("main moving during candidate wait admits its new tooling with the pinned source", async (t) => {
	const f = fixture(t);
	const newer = "e".repeat(40);
	f.state.onWatch = () => {
		f.state.mainSha = newer;
		f.completed.head_sha = newer;
		f.state.comparisons = {
			[`${newer}...${first}`]: { merge_base_commit: { sha: first } },
			[`${newer}...main`]: { merge_base_commit: { sha: newer } },
		};
	};
	assert.equal(await f.run(), 0, f.output.join("\n"));
	assert.equal(f.installations[0].tools[0].sourceRevision, first);
	assert.ok(f.calls.some((call) => call.includes(`repos/fixture/studio/compare/${newer}...main`)));
});

for (const status of ["completed", "in_progress"]) {
	test(`candidate reuse checks main at admission time (${status})`, async (t) => {
		const f = fixture(t);
		const newer = "e".repeat(40);
		f.completed.head_sha = newer;
		f.state.runs = [{ ...f.completed, status }];
		f.state.comparisons = {
			[`${newer}...${first}`]: { merge_base_commit: { sha: first } },
			[`${newer}...main`]: { merge_base_commit: { sha: newer } },
		};
		assert.equal(await f.run(), 0, f.output.join("\n"));
		assert.equal(f.installations[0].tools[0].sourceRevision, first);
		assert.ok(
			!f.calls.some((call) =>
				call.some((arg) => typeof arg === "string" && arg.includes("/dispatches")),
			),
		);
	});
}

for (const missing of [undefined, null]) {
	test(`legacy pack without studioSha reports the downgrade-check gap: ${missing}`, async (t) => {
		const f = fixture(t);
		assert.equal(await f.run(), 0);
		f.state.installed = { pack: "0.1.0", studioSha: missing };
		f.state.oldVersion = true;
		const offset = f.output.length;
		assert.equal(await f.run(), 0, f.output.join("\n"));
		assert.ok(
			f.output
				.slice(offset)
				.includes(
					`main ${first}: note: installed pack 0.1.0 has no studioSha; downgrade check unavailable.`,
				),
		);
	});
}

for (const target of [first, "b".repeat(40)])
	test(`draft source metadata accepts source independently of target ${target}`, async (t) => {
		const f = fixture(t);
		f.state.dispatch = false;
		f.releases[0].target_commitish = target;
		f.releases[0].body = `Studio SHA: ${first}`;
		assert.equal(await f.run(), 0, f.output.join("\n"));
		assert.equal(f.installations[0].tools[0].sourceRevision, first);
		assert.ok(!f.calls.flat().some((arg) => String(arg).includes("/dispatches")));
	});

for (const body of [
	undefined,
	"",
	`Studio SHA: ${next}`,
	"Studio SHA: main",
	`Studio SHA: ${first}\n`,
	`Studio SHA: ${first} ${next}`,
	`Studio SHA: ${first.slice(1)}`,
	`Studio SHA: ${first}0`,
])
	test(`draft source metadata refuses missing or malformed source ${JSON.stringify(body)}`, async (t) => {
		const f = fixture(t);
		f.releases[0].body = body;
		assert.equal(await f.run(), 1);
		assert.equal(f.installations.length, 0);
		assert.match(f.output.at(-1), /different SHA|source metadata/);
	});

test("installer dispatch explicitly requests the install queue", async (t) => {
	const f = fixture(t);
	assert.equal(await f.run(), 0);
	const dispatch = f.calls.find((call) => call.some((arg) => String(arg).includes("/dispatches")));
	assert.ok(dispatch.includes("inputs[purpose]=install"));
});
