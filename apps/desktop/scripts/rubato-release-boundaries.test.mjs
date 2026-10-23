import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse as parsePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import * as admission from "./admit-rubato-release.mjs";
import { workflowFunction } from "./ci-test-support.mjs";

const workflow = parse(
	readFileSync(new URL("../../../.github/workflows/cli-release.yml", import.meta.url), "utf8"),
);
const sha = "1234567890abcdef1234567890abcdef12345678";
const mainSha = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const env = () => ({
	STUDIO_SOURCE_REPO: "fixture/studio",
	STUDIO_CANDIDATE_REPO: "fixture/studio",
	INPUT_REF: sha,
	PACK_VERSION: "0.1.2",
	PUBLISH_PACK: "false",
	GITHUB_REF: "refs/heads/main",
	GITHUB_REF_TYPE: "branch",
});
function api(command, args) {
	assert.equal(command, "gh");
	assert.equal(args[0], "api");
	const route = args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "");
	const responses = {
		"repos/fixture/studio/git/ref/heads/main": {
			ref: "refs/heads/main",
			object: { sha: mainSha },
		},
		[`repos/fixture/studio/compare/${sha}...${mainSha}`]: { merge_base_commit: { sha } },
		[`repos/fixture/studio/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1`]: {
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
		"repos/fixture/studio/actions/runs/123/jobs?per_page=100": {
			jobs: [{ name: "merge-gate", conclusion: "success" }],
		},
		"repos/Praxity/rubato/git/ref/heads/main": { ref: "refs/heads/main", object: { sha } },
		[`repos/Praxity/rubato/contents/skills/assessment-writing/SKILL.md?ref=${sha}`]: {
			type: "file",
			encoding: "base64",
			content: Buffer.from(
				"---\nname: assessment-writing\ndescription: Write choices.\n---\n",
			).toString("base64"),
		},
	};
	assert.ok(Object.hasOwn(responses, route), `Unqualified or unexpected ref: ${route}`);
	return JSON.stringify(args.includes("--slurp") ? [responses[route]] : responses[route]);
}

test("admission environment/API adapter resolves branch heads and compares full SHAs", () => {
	assert.deepEqual(admission.admitRelease(env(), api), { source_ref: sha, rubato_sha: sha });
});

test("formal workflow cannot fall back to private-ref admission when pack version is empty", () => {
	assert.equal(
		workflow.jobs.admit.steps.find((step) => step.id === "admit").env.FORMAL_RELEASE,
		"true",
	);
	assert.throws(
		() =>
			admission.admitRelease({ ...env(), FORMAL_RELEASE: "true", PACK_VERSION: "" }, () =>
				assert.fail("No API before version admission"),
			),
		/stable pack version/,
	);
});

test("private candidates build only a main SHA or a Studio branch head, never fork refs", () => {
	const branchSha = "f".repeat(40);
	const forkSha = "e".repeat(40);
	const privateApi = (command, args) => {
		const route = args.at(-1).replace(/&event=[^&]+(?:&branch=main)?$/, "");
		if (route === "repos/fixture/studio/git/ref/heads/feature%2Fx")
			return JSON.stringify({
				ref: "refs/heads/feature/x",
				object: { type: "commit", sha: branchSha },
			});
		if (route === `repos/fixture/studio/compare/${forkSha}...${mainSha}`)
			return JSON.stringify({ merge_base_commit: { sha: mainSha } });
		return api(command, args);
	};
	const dispatch = (INPUT_REF) =>
		admission.admitRelease(
			{ ...env(), INPUT_REF, PACK_VERSION: "", PUBLISH_PACK: "false" },
			privateApi,
		);
	assert.deepEqual(dispatch(sha), { source_ref: sha });
	assert.deepEqual(dispatch("feature/x"), { source_ref: branchSha });
	assert.deepEqual(dispatch("refs/heads/feature/x"), { source_ref: branchSha });
	assert.throws(() => dispatch(forkSha), /must belong to Studio main/);
	for (const ref of ["refs/pull/123/head", "refs/pull/123/merge", "refs/tags/v1", "../main", ""])
		assert.throws(() => dispatch(ref), /full SHA on main or a Studio branch/);
});

for (const branch of ["feature/c++", "feature/c#", "feature/日本語", "feature/percent%name"]) {
	test(`private candidate admits Git branch syntax and encodes API path: ${branch}`, () => {
		const checked = spawnSync("git", ["check-ref-format", "--branch", branch]);
		assert.equal(checked.status, 0);
		for (const INPUT_REF of [branch, `refs/heads/${branch}`]) {
			assert.deepEqual(
				admission.admitRelease({ ...env(), INPUT_REF, PACK_VERSION: "" }, (command, args) => {
					assert.equal(command, "gh");
					assert.equal(
						args.at(-1),
						`repos/fixture/studio/git/ref/heads/${encodeURIComponent(branch)}`,
					);
					return JSON.stringify({ ref: `refs/heads/${branch}`, object: { type: "commit", sha } });
				}),
				{ source_ref: sha },
			);
		}
	});
}

for (const branch of [
	"bad.lock",
	"feature/.hidden",
	"feature/end.",
	"feature//x",
	"feature@{x}",
	"-option",
	"bad name",
	"bad\\name",
]) {
	test(`private candidate refuses invalid Git branch before API: ${branch}`, () => {
		assert.throws(
			() =>
				admission.admitRelease({ ...env(), INPUT_REF: branch, PACK_VERSION: "" }, () =>
					assert.fail("No API for invalid branch"),
				),
			/full SHA on main or a Studio branch/,
		);
	});
}

for (const prefix of ["dependabot/", "gh-readonly-queue/", "copilot/", "renovate/"]) {
	test(`private candidate refuses outsider-influenced branch: ${prefix}`, () => {
		for (const INPUT_REF of [`${prefix}update`, `refs/heads/${prefix}update`])
			assert.throws(
				() =>
					admission.admitRelease({ ...env(), INPUT_REF, PACK_VERSION: "" }, () =>
						assert.fail("No API for outsider-influenced branch"),
					),
				/full SHA on main or a Studio branch/,
			);
	});
}

for (const [name, response] of [
	["different ref", { ref: "refs/heads/other", object: { type: "commit", sha } }],
	["non-commit type", { ref: "refs/heads/feature", object: { type: "tag", sha } }],
	["abbreviated SHA", { ref: "refs/heads/feature", object: { type: "commit", sha: "12345678" } }],
	["non-hex SHA", { ref: "refs/heads/feature", object: { type: "commit", sha: "z".repeat(40) } }],
	["missing object", { ref: "refs/heads/feature" }],
]) {
	test(`private candidate refuses malformed branch API response: ${name}`, () => {
		assert.throws(
			() =>
				admission.admitRelease({ ...env(), INPUT_REF: "feature", PACK_VERSION: "" }, () =>
					JSON.stringify(response),
				),
			/No Studio branch named feature/,
		);
	});
}

test("internal candidates admit the exact green main source without Rubato release access", () => {
	assert.deepEqual(
		admission.admitRelease(
			{
				...env(),
				PACK_VERSION: "",
				PUBLISH_PACK: "false",
				INTERNAL_INSTALL: "true",
				GITHUB_REF: "refs/heads/candidate",
			},
			(command, args) => {
				assert.ok(!args.at(-1).includes("/rubato/"));
				return api(command, args);
			},
		),
		{ source_ref: sha },
	);
});

for (const [name, change] of [
	[
		"off-main source",
		(route, value) => {
			if (route.includes("/compare/")) value.merge_base_commit.sha = mainSha;
		},
	],
	[
		"failed CI",
		(route, value) => {
			if (route.includes("/workflows/")) value.workflow_runs[0].conclusion = "failure";
		},
	],
	[
		"PR CI",
		(route, value) => {
			if (route.includes("/workflows/")) value.workflow_runs[0].event = "pull_request";
		},
	],
	[
		"missing merge gate",
		(route, value) => {
			if (route.includes("/jobs?")) value.jobs = [];
		},
	],
])
	test(`internal candidate refuses ${name}`, () => {
		assert.throws(() =>
			admission.admitRelease(
				{ ...env(), PACK_VERSION: "", PUBLISH_PACK: "false", INTERNAL_INSTALL: "true" },
				(command, args) => {
					const response = JSON.parse(api(command, args));
					const value = args.includes("--slurp") ? response[0] : response;
					change(args.at(-1), value);
					return JSON.stringify(args.includes("--slurp") ? [value] : value);
				},
			),
		);
	});

for (const [name, override, message] of [
	["feature dispatch", { GITHUB_REF: "refs/heads/feature" }, /main workflow only/],
	[
		"tag named main",
		{ GITHUB_REF: "refs/tags/main", GITHUB_REF_TYPE: "tag" },
		/main workflow only/,
	],
	["non-branch dispatch", { GITHUB_REF_TYPE: "tag" }, /main workflow only/],
	["invalid pack", { PACK_VERSION: "next" }, /stable pack version/],
	["abbreviated SHA", { INPUT_REF: "12345678" }, /full Studio SHA/],
])
	test(`admission refuses ${name} before any API access`, () => {
		assert.throws(
			() =>
				admission.admitRelease({ ...env(), ...override }, () =>
					assert.fail("No API on refused dispatch"),
				),
			message,
		);
	});

for (const [name, routePart, change, message] of [
	[
		"missing CI ID",
		"/workflows/",
		(value) => {
			value.workflow_runs[0].id = "123";
		},
		/No CI run/,
	],
	[
		"invalid Rubato SHA",
		"/rubato/git/",
		(value) => {
			value.object.sha = "main";
		},
		/Invalid Rubato revision/,
	],
	[
		"invalid main SHA",
		"studio/git/",
		(value) => {
			value.object.sha = "main";
		},
		/Invalid Studio main revision/,
	],
])
	test(`admission adapter refuses ${name}`, () => {
		assert.throws(
			() =>
				admission.admitRelease(env(), (command, args) => {
					const value = JSON.parse(api(command, args));
					if (args.at(-1).includes(routePart)) change(value);
					return JSON.stringify(value);
				}),
			message,
		);
	});

test("admission command refuses branch dispatch with no output", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "release-admission-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const output = join(directory, "outputs");
	const run = spawnSync(
		process.execPath,
		[fileURLToPath(new URL("admit-rubato-release.mjs", import.meta.url))],
		{
			encoding: "utf8",
			env: { ...process.env, ...env(), GITHUB_REF: "refs/heads/feature", GITHUB_OUTPUT: output },
		},
	);
	assert.equal(run.status, 1);
	assert.match(run.stderr, /main workflow only/);
	assert.equal(existsSync(output), false);
});

for (const version of ["0.1.2", "", "next"])
	for (const internal of ["true", "false"])
		test(`admission refuses publication before API access: version=${version}, internal=${internal}`, () => {
			assert.throws(
				() =>
					admission.admitRelease(
						{ ...env(), PACK_VERSION: version, PUBLISH_PACK: "true", INTERNAL_INSTALL: internal },
						() => assert.fail("Publication must be refused before any API access"),
					),
				{
					message:
						"Formal release needs the native arm64 install check on Rubato's macos-15 job; not wired yet.",
				},
			);
		});

test("publication requests always reach hosted admission, including a missing version", () => {
	assert.equal(workflow.jobs.admit["runs-on"], "ubicloud-standard-2");
	for (const pack_version of ["", "0.1.2"])
		assert.equal(
			workflowFunction(
				"github",
				"inputs",
				`return (${workflow.jobs.admit.if});`,
			)(
				{ event_name: "workflow_dispatch" },
				{ pack_version, publish_pack: true, internal_install: false },
			),
			true,
		);
});

for (const scenario of ["main", "private", "publish", "missing version", "failed gate"])
	test(`admission command with fixture GitHub API: ${scenario}`, (t) => {
		const directory = mkdtempSync(join(tmpdir(), "release-command-"));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const output = join(directory, "outputs"),
			preload = join(directory, "github.mjs");
		// Replace only the external gh process in the command's fresh Node process.
		writeFileSync(
			preload,
			`import assert from 'node:assert/strict';\nimport child from 'node:child_process';\nimport { syncBuiltinESMExports } from 'node:module';\nconst sha=${JSON.stringify(sha)}, mainSha=${JSON.stringify(mainSha)};\nconst api=${api.toString()};\nchild.execFileSync=(command,args)=>{const value=JSON.parse(api(command,args));if(process.env.MOCK_FAILED_GATE==='true'&&args.at(-1).includes('/jobs?'))value.jobs[0].conclusion='failure';return JSON.stringify(value)};\nsyncBuiltinESMExports();\n`,
		);
		const input = {
			...process.env,
			...env(),
			GITHUB_OUTPUT: output,
			MOCK_FAILED_GATE: String(scenario === "failed gate"),
		};
		if (scenario === "private")
			Object.assign(input, {
				PACK_VERSION: "",
				PUBLISH_PACK: "false",
				GITHUB_REF: "refs/heads/feature",
			});
		if (["publish", "missing version"].includes(scenario)) input.PUBLISH_PACK = "true";
		if (scenario === "missing version") input.PACK_VERSION = "";
		const run = spawnSync(
			process.execPath,
			[
				"--import",
				pathToFileURL(preload).href,
				fileURLToPath(new URL("admit-rubato-release.mjs", import.meta.url)),
			],
			{ encoding: "utf8", env: input },
		);
		assert.equal(run.status, ["main", "private"].includes(scenario) ? 0 : 1, run.stderr);
		if (["publish", "missing version"].includes(scenario))
			assert.match(run.stderr, /Formal release needs the native arm64 install check/);
		if (scenario === "main")
			assert.equal(readFileSync(output, "utf8"), `source_ref=${sha}\nrubato_sha=${sha}\n`);
		else if (scenario === "private")
			assert.equal(readFileSync(output, "utf8"), `source_ref=${sha}\n`);
		else assert.equal(existsSync(output), false);
	});

test("release jobs bind build digests, exact candidate ID, pinned Rubato and publisher-only token", () => {
	const build = workflow.jobs.build;
	for (const arch of ["arm64", "x64"]) {
		assert.equal(
			build.outputs[`${arch}_sha256`],
			`\u0024{{ steps.digests.outputs.${arch}_sha256 }}`,
		);
		assert.equal(build.outputs[`${arch}_name`], `\u0024{{ steps.digests.outputs.${arch}_name }}`);
	}
	assert.equal(
		workflow.jobs.publish.outputs.release_id,
		"${{ steps.candidate.outputs.release_id }}",
	);
	for (const name of ["native-smoke", "rubato-publish"]) {
		const job = workflow.jobs[name];
		assert.ok(job.needs.includes("build"));
		const download = job.steps.find((step) => step.name === "Download verified private candidate");
		assert.equal(download.env.CANDIDATE_RELEASE_ID, "${{ needs.publish.outputs.release_id }}");
		assert.match(download.run, /download-candidate\.mjs/);
		for (const arch of ["arm64", "x64"])
			assert.equal(
				download.env[`EXPECTED_${arch.toUpperCase()}_SHA256`],
				`\u0024{{ needs.build.outputs.${arch}_sha256 }}`,
			);
		assert.doesNotMatch(JSON.stringify(job), /CANDIDATE_TAG|gh release download/);
	}
	const publisher = workflow.jobs["rubato-publish"];
	assert.equal(publisher.environment, "rubato-release");
	assert.equal(
		publisher.steps.find((step) => step.with?.repository === "Praxity/rubato").with.ref,
		"${{ needs.admit.outputs.rubato_sha }}",
	);
	const command = publisher.steps.find((step) => step.name === "Publish verified Rubato pack");
	assert.equal(command.env.GH_TOKEN, "${{ secrets.RUBATO_RELEASE_TOKEN }}");
	for (const arch of ["arm64", "x64"]) {
		assert.equal(
			command.env[`EXPECTED_${arch.toUpperCase()}_SHA256`],
			`\u0024{{ needs.build.outputs.${arch}_sha256 }}`,
		);
		assert.match(command.run, new RegExp(`--expect-${arch}-sha256`));
	}
	for (const job of Object.values(workflow.jobs))
		for (const step of job.steps)
			if (step !== command)
				assert.doesNotMatch(JSON.stringify(step), /secrets\.RUBATO_RELEASE_TOKEN/);
});

const bash =
	process.platform === "win32"
		? join(
				process.env.ProgramFiles ??
					join(process.env.SystemDrive ?? parsePath(process.execPath).root, "Program Files"),
				"Git/bin/bash.exe",
			)
		: "/bin/bash";

test("formal publication refuses until Rubato's native arm64 install check is wired; dry runs still work", () => {
	const publisher = workflow.jobs["rubato-publish"];
	assert.equal(
		publisher.if,
		"github.repository == (vars.STUDIO_SOURCE_REPO || github.repository) && (inputs.pack_version != '')",
	);
	assert.deepEqual(publisher.needs, ["admit", "build", "publish", "native-smoke"]);
	const command = publisher.steps.find((step) => step.name === "Publish verified Rubato pack");
	assert.equal(command.env.PUBLISH_PACK, "${{ inputs.publish_pack }}");
	for (const publish of ["true", "false"]) {
		const result = spawnSync(
			bash,
			["-e", "-o", "pipefail", "-c", `node() { printf '%s\\n' "$@"; }\n${command.run}`],
			{
				encoding: "utf8",
				env: {
					...process.env,
					PUBLISH_PACK: publish,
					PACK_VERSION: "0.1.2",
					STUDIO_SHA: sha,
					EXPECTED_ARM64_SHA256: "a".repeat(64),
					EXPECTED_X64_SHA256: "b".repeat(64),
					RUNNER_TEMP: "/unused",
				},
			},
		);
		assert.equal(result.status, publish === "true" ? 1 : 0, result.stderr);
		if (publish === "true") {
			assert.match(
				result.stderr,
				/Formal release needs the native arm64 install check on Rubato's macos-15 job; not wired yet\./,
			);
			assert.equal(result.stdout, "", "Refuse before invoking the publisher");
		} else {
			assert.match(result.stdout, /publish-studio-pack\.mjs/);
			assert.match(result.stdout, /--dry-run/);
			assert.doesNotMatch(result.stdout, /--publish\b/);
		}
	}
});

const smoke = () =>
	workflow.jobs["native-smoke"].steps.find((step) => step.name === "Verify native package smoke");
for (const scenario of ["ok", "wrong arch", "bad digest", "failed CLI", "failed Typst"])
	test(`native smoke external commands: ${scenario}`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "release-smoke-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		mkdirSync(join(root, "candidate/studio-cli/typst"), { recursive: true });
		const name = "praxity-cli-0.3.0-macos-arm64.tar.gz",
			bytes = "smoke fixture";
		writeFileSync(join(root, "candidate", name), bytes);
		writeFileSync(
			join(root, "candidate", `${name}.sha256`),
			`${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
		);
		writeFileSync(
			join(root, "candidate/studio-cli/typst/typst"),
			'#!/bin/sh\nexit "$TYPST_STATUS"\n',
			{ mode: 0o755 },
		);
		const script = `node() { if [[ "$1" == -p ]]; then printf '%s\\n' "$MOCK_ARCH"; else [[ "$CLI_STATUS" == 0 ]]; fi; }\ntar() { :; }\nshasum() { shift 2; sha256sum "$@"; }\n${smoke().run}`;
		const result = spawnSync(bash, ["-e", "-o", "pipefail", "-c", script], {
			encoding: "utf8",
			env: {
				...process.env,
				RUNNER_TEMP: root.replaceAll("\\", "/"),
				NATIVE_ARCH: "arm64",
				EXPECTED_SHA256:
					scenario === "bad digest"
						? "0".repeat(64)
						: createHash("sha256").update(bytes).digest("hex"),
				MOCK_ARCH: scenario === "wrong arch" ? "x64" : "arm64",
				CLI_STATUS: scenario === "failed CLI" ? "1" : "0",
				TYPST_STATUS: scenario === "failed Typst" ? "1" : "0",
			},
		});
		assert.equal(result.status === 0, scenario === "ok", result.stderr);
	});

for (const scenario of ["ok", "missing", "duplicate", "invalid digest"])
	test(`build digest capture before mutable handoff: ${scenario}`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "release-digest-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		mkdirSync(join(root, "apps/desktop/release"), { recursive: true });
		for (const arch of ["arm64", "x64"])
			writeFileSync(
				join(root, `apps/desktop/release/praxity-cli-0.3.0-macos-${arch}.tar.gz`),
				arch,
			);
		if (scenario === "missing")
			rmSync(join(root, "apps/desktop/release/praxity-cli-0.3.0-macos-x64.tar.gz"));
		if (scenario === "duplicate")
			writeFileSync(
				join(root, "apps/desktop/release/praxity-cli-0.3.1-macos-x64.tar.gz"),
				"duplicate",
			);
		const step = workflow.jobs.build.steps.find((step) => step.id === "digests");
		assert.ok(step);
		const output = join(root, "outputs");
		const run = spawnSync(
			bash,
			[
				"-e",
				"-o",
				"pipefail",
				"-c",
				`${scenario === "invalid digest" ? "shasum() { printf 'bad archive\\n'; }" : 'shasum() { shift 2; sha256sum "$@"; }'}\n${step.run}`,
			],
			{
				cwd: root,
				encoding: "utf8",
				env: { ...process.env, GITHUB_OUTPUT: output.replaceAll("\\", "/") },
			},
		);
		assert.equal(run.status === 0, scenario === "ok", run.stderr);
		if (scenario === "ok")
			for (const arch of ["arm64", "x64"])
				assert.match(
					readFileSync(output, "utf8"),
					new RegExp(`${arch}_sha256=${createHash("sha256").update(arch).digest("hex")}`),
				);
	});
