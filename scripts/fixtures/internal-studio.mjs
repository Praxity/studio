import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installInternalStudio } from "../install-internal-studio.mjs";

export const first = "1234567890abcdef1234567890abcdef12345678";
export const next = "abcdef0123456789abcdef0123456789abcdef01";
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "internal-studio-test-"));
	t.after(() => rmSync(root, { recursive: true }));
	const home = join(root, "home"),
		temporary = join(root, "temporary"),
		rubatoRoot = join(root, "rubato");
	for (const path of [home, temporary, rubatoRoot]) mkdirSync(path);
	const active = join(home, ".praxity/toolkit/active");
	const state = {
		sha: first,
		bytes: Buffer.from("fixture archive"),
		installed: null,
		busy: false,
		space: 10n * 1024n ** 3n,
		runId: 42,
		dispatch: true,
		rubatoSha: "b".repeat(40),
		branch: "main",
		now: Date.parse("2026-10-18T09:54:49Z"),
	};
	const basePack = { version: "0.1.1", tools: [{ id: "studio", archives: {} }] };
	const calls = [],
		output = [],
		installations = [],
		retained = new Map();
	const name = "praxity-cli-0.3.0-macos-arm64.tar.gz";
	const assets = [
		{ id: 100, name, digest: `sha256:${digest(state.bytes)}` },
		{ id: 101, name: `${name}.sha256` },
	];
	const releases = [
		{
			id: 7,
			tag_name: "cli-candidate-42",
			target_commitish: first,
			body: `Studio SHA: ${first}`,
			draft: true,
			prerelease: true,
		},
	];
	const completed = {
		id: 42,
		event: "workflow_dispatch",
		path: ".github/workflows/cli-candidate.yml",
		display_title: `CLI candidate ${first}`,
		status: "completed",
		conclusion: "success",
		head_branch: "main",
	};
	const rubato = {
		loadContext: () => ({ state: { platform: state.installedPlatform ?? "darwin-arm64" } }),
		readManifest: () => {
			if (state.manifestErrors) throw new Error("Invalid pack manifest");
			return structuredClone(basePack);
		},
		validateManifest: () => state.manifestErrors ?? [],
		refreshInstalledSkills: (_context, deps) => {
			if (state.refreshFailure) {
				deps.print(
					"Progress\nOwned adapter changed: /fixture/.claude/skills/prax-format/SKILL.md\nHost skills were not refreshed. Run praxity skills refresh --scope user",
				);
				return 1;
			}
			return 0;
		},
		assertStudioClosed: () => {
			calls.push(["session guard"]);
			if (state.busy)
				throw new Error("Studio may hold unsaved text. Save or copy text, close Studio and rerun.");
		},
		verifyStudioArchive: (file, arch, sha, expected) => {
			assert.equal(arch, "arm64");
			assert.equal(sha, state.sha);
			assert.equal(digest(readFileSync(file)), expected);
			if (state.inventorySha && state.inventorySha !== sha)
				throw new Error("Untested or dirty Studio revision");
			return { digest: expected, version: "0.3.0" };
		},
		installVerifiedPack: (context, { bootstrap, manifest }, dependencies) => {
			state.onInstall?.();
			rubato.assertStudioClosed();
			assert.equal(context.home, home);
			assert.deepEqual(readFileSync(join(bootstrap, "pack.json")), manifest);
			const pack = JSON.parse(manifest);
			installations.push(pack);
			const installedRoot = join(home, ".praxity/toolkit", pack.version);
			mkdirSync(join(installedRoot, "tools/studio"), { recursive: true });
			if (state.realGit)
				writeFileSync(
					join(installedRoot, "bootstrap-marker"),
					readFileSync(join(bootstrap, "src/marker")),
				);
			const actualManifest = JSON.parse(manifest);
			if (state.activeDigest)
				actualManifest.tools[0].archives[context.state.platform].sha256 = state.activeDigest;
			writeFileSync(join(installedRoot, "pack.json"), JSON.stringify(actualManifest));
			writeFileSync(
				join(installedRoot, "tools/studio/inventory.json"),
				JSON.stringify({
					sourceRevision: state.activeInventorySha ?? pack.tools[0].sourceRevision,
					arch: state.activeArch ?? state.installedPlatform?.slice(7) ?? "arm64",
					platform: state.activePlatform ?? "darwin",
					sourceTreeDirty: state.activeDirty ?? false,
				}),
			);
			if (state.stackFailure)
				throw new Error(
					"file:///fixture/install.mjs:37\n    throw new Error(...)\nError: Pack version already exists with a different manifest\n    at install",
				);
			if (state.activationFailure)
				throw new Error(
					"Installer exited 1.\nTransfer progress.\nActivation failed; rolled back to previous pack. Resolve the doctor error and rerun.\nInstaller cleanup finished.\n",
				);
			if (state.installed) retained.set(state.installed.pack, state.installed.studioSha);
			state.installed = {
				pack: state.activatedPack ?? pack.version,
				studioSha: state.activatedSha ?? pack.tools[0].sourceRevision,
			};
			mkdirSync(join(home, ".praxity/toolkit"), { recursive: true });
			writeFileSync(
				active,
				`${state.activePointer ?? pack.version}\n${[...retained.keys()].at(-1) ?? ""}\n`,
			);
			if (state.refreshFailure)
				dependencies.print(
					"Progress\nOwned adapter changed: /fixture/.claude/skills/prax-format/SKILL.md\nHost skills were not refreshed. Run praxity skills refresh --scope user",
				);
			return state.refreshFailure ? 1 : 0;
		},
	};
	const execute = (command, args, extra) => {
		calls.push([command, ...args]);
		if ((command === "git" || command === "tar") && state.realGit)
			return execFileSync(command, args, extra);

		if (
			command === "git" &&
			(state.dirty || (state.untracked && args.includes("--untracked-files=normal"))) &&
			args.includes("status")
		)
			return Buffer.from(" M pack.json");
		if (command === "git" && args.includes("branch")) return Buffer.from(state.branch);
		if (command === "git" && args.includes("rev-parse"))
			return Buffer.from(
				args.includes("origin/main") ? (state.remoteSha ?? state.rubatoSha) : state.rubatoSha,
			);
		if (command === "git" && args.includes("show")) return Buffer.from(JSON.stringify(basePack));
		if (
			command === "git" &&
			args.includes("archive") &&
			state.missingRevision &&
			args.includes(state.rubatoSha)
		)
			throw new Error("Admitted Rubato commit is unavailable. Fetch origin/main and rerun.");
		if (command === "git")
			return Buffer.from(args.includes("archive") ? "git archive fixture" : "");
		if (command === "tar") return Buffer.from("");
		if (command === "sh") {
			if (args.at(-1) === "doctor") {
				if (state.doctorFailure) throw new Error("doctor failed; run praxity rollback");
				return Buffer.from("");
			}
			if (args.includes("refresh")) {
				if (state.refreshFailure)
					throw new Error(
						"Progress\nOwned adapter changed: /fixture/.claude/skills/prax-format/SKILL.md\nHost skills were not refreshed. Run praxity skills refresh --scope user",
					);
				return Buffer.from("");
			}
			if (state.oldVersion && args.includes("--version")) throw new Error("old pack");
			return Buffer.from(JSON.stringify(state.installed));
		}
		assert.equal(command, "gh");
		if (args[0] === "run") {
			state.onWatch?.();
			if (state.watchFailure && args.includes("--exit-status")) throw new Error("run failed");
			return Buffer.from("");
		}
		assert.ok(args.includes("github.com"));
		const path = args.find((arg) => arg.startsWith("repos/"));
		if (state.networkFailure) throw new Error("secret in external stderr");
		let response;
		if (path.endsWith("/git/ref/heads/main"))
			response = { object: { sha: state.mainSha ?? state.sha } };
		else if (/\/commits\/[a-f0-9]{40}$/.test(path)) {
			const sha = path.split("/").at(-1);
			const commits = state.commits ?? [{ sha: state.sha }];
			const index = commits.findIndex((commit) => commit.sha === sha);
			response = state.commitMetadata?.[sha] ?? {
				sha,
				commit: { committer: { date: "2026-10-15T09:54:49Z" } },
				parents: commits[index + 1] ? [{ sha: commits[index + 1].sha }] : [],
				...commits[index],
			};
		} else if (path.includes("/pulls?")) response = state.pulls ?? [];
		else if (path.endsWith("/commits/main")) response = { sha: state.mainSha ?? state.sha };
		else if (path.includes("/commits?"))
			response = (state.commits ?? [{ sha: state.sha }]).map((commit) => ({
				commit: { committer: { date: "2026-10-15T09:54:49Z" } },
				...commit,
			}));
		else if (path.includes("/compare/")) {
			const base = path.split("/compare/")[1].split("...")[0];
			response = state.comparisons?.[path.split("/compare/")[1]] ?? {
				merge_base_commit: { sha: base === state.offMainTooling ? "d".repeat(40) : base },
				status: state.installedComparison ?? "behind",
			};
		} else if (path.includes("/workflows/ci.yml/runs?")) {
			const requested = new URLSearchParams(path.split("?")[1]).get("head_sha");
			response = {
				workflow_runs: (
					state.ciRuns ?? [
						{
							id: 99,
							head_sha: state.sha,
							head_branch: "main",
							event: "schedule",
							status: "completed",
							conclusion: "success",
						},
					]
				)
					.filter((item) => !requested || item.head_sha === requested)
					.slice(0, 1),
			};
		} else if (path.includes("/actions/runs/") && path.includes("/jobs?"))
			response =
				path.includes("/runs/99/") || path.includes("/runs/100/") || path.includes("/runs/101/")
					? (state.ciJobs ?? { jobs: [{ name: "merge-gate", conclusion: "success" }] })
					: (state.candidateJobsByRun?.[path.split("/runs/")[1].split("/")[0]] ??
						state.candidateJobs ?? { jobs: [{ name: "webkit", conclusion: "success" }] });
		else if (path.includes("/workflows/cli-candidate.yml/runs?branch=main"))
			response = [
				{
					workflow_runs: state.selectorRuns ?? [
						{
							event: "workflow_dispatch",
							head_branch: "main",
							path: ".github/workflows/cli-candidate.yml",
							id: 41,
							head_sha: state.mainSha ?? state.sha,
							display_title: `CLI candidate ${state.sha}`,
						},
					],
				},
			];
		else if (path.includes("/dispatches")) {
			assert.ok(args.includes("ref=main"));
			assert.ok(args.includes(`inputs[ref]=${state.sha}`));
			assert.ok(args.includes("inputs[purpose]=install"));
			assert.ok(!args.some((arg) => arg.includes("internal_install")));
			assert.ok(!args.some((arg) => arg.includes("pack_version")));
			if (state.newRelease) releases.push(state.newRelease);
			response = { workflow_run_id: state.runId };
		} else if (path.includes("/workflows/") && path.includes("/runs?"))
			response = [
				{
					workflow_runs:
						state.runs ?? (state.dispatch ? [] : [{ ...completed, head_sha: state.sha }]),
				},
			];
		else if (path.includes("/actions/runs/"))
			response = {
				head_sha: state.mainSha ?? state.sha,
				...completed,
				display_title: state.completedTitle ?? completed.display_title.replace(first, state.sha),
			};
		else if (path.endsWith("/releases?per_page=100")) response = [releases];
		else if (path.includes("/assets?per_page=100")) response = [assets];
		else if (path.endsWith("/releases/assets/100")) return state.downloadBytes ?? state.bytes;
		else if (path.endsWith("/releases/assets/101"))
			return Buffer.from(`${digest(state.bytes)}  ${state.checksumName ?? name}\n`);
		else if (args.includes("DELETE")) return Buffer.from("");
		else if (/\/releases\/\d+$/.test(path))
			response = {
				...releases.find((item) => path.endsWith(`/${item.id}`)),
				...state.freshDraftOverrides,
			};
		else assert.fail(`Unexpected gh call ${args.join(" ")}`);
		if (args.includes("--slurp") && path.includes("/jobs?") && !Array.isArray(response))
			response = [response];
		if (args.includes("--slurp") && path.includes("/pulls?")) response = [response];
		return Buffer.from(JSON.stringify(response));
	};
	const run = (options = {}) =>
		installInternalStudio(
			{
				home,
				temporary,
				rubatoRoot,
				cwd: home,
				platform: "darwin-arm64",
				env: {
					...process.env,
					STUDIO_SOURCE_REPO: "fixture/studio",
					STUDIO_CANDIDATE_REPO: "fixture/studio",
				},
				...options,
			},
			{
				execute,
				rubato: state.external ? undefined : rubato,
				print: (line) => output.push(line),
				freeBytes: (path) => (path === home ? state.homeSpace : state.tempSpace) ?? state.space,
				now: () => state.now,
			},
		);
	return {
		root,
		rubatoRoot,
		rubato,
		home,
		temporary,
		active,
		state,
		calls,
		output,
		installations,
		retained,
		releases,
		assets,
		completed,
		run,
	};
}
