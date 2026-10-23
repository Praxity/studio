import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statfsSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	admitInternalCandidateRun,
	internalCandidateReleaseSource,
	isAdmittedInternalCandidateRun,
	selectNewestInternalStudioRevision,
} from "../apps/desktop/scripts/admit-rubato-release.mjs";
import { downloadCandidate } from "../apps/desktop/scripts/download-candidate.mjs";

import {
	studioRepositories,
	studioRepositoryFromRemote,
} from "../apps/desktop/scripts/studio-repositories.mjs";

const workflow = "cli-candidate.yml";
const minimumFree = 8n * 1024n ** 3n;
const requireValue = (ok, message) => {
	if (!ok) throw new Error(message);
};

async function loadRubato(root) {
	const load = (path) => import(pathToFileURL(join(root, path)).href);
	const [update, manifest, cli, publisher, tools] = await Promise.all([
		load("src/update.mjs"),
		load("src/manifest.mjs"),
		load("src/cli.mjs"),
		load("scripts/publish-studio-pack.mjs"),
		load("src/tools.mjs"),
	]);
	requireValue(
		update.installVerifiedPack &&
			update.assertStudioClosed &&
			publisher.verifyStudioArchive &&
			update.refreshInstalledSkills,
		"Rubato checkout needs the verified local installation API. Update the reviewed checkout.",
	);
	return { ...update, ...manifest, ...cli, ...publisher, ...tools };
}

// Subprocesses, disk admission and the reviewed Rubato checkout are external seams.
export async function installInternalStudio(options, dependencies = {}) {
	const home = options.home ?? homedir();
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const print = dependencies.print ?? console.log;
	const execute = dependencies.execute ?? execFileSync;
	let repositories;
	try {
		repositories = studioRepositories(env);
	} catch (error) {
		if (error.code !== "STUDIO_REPOSITORY_REQUIRED") throw error;
		let derived;
		try {
			derived = studioRepositoryFromRemote(
				String(
					execute(
						"git",
						["-C", fileURLToPath(new URL("..", import.meta.url)), "remote", "get-url", "origin"],
						{
							env,
							stdio: ["ignore", "pipe", "pipe"],
						},
					),
				),
			);
		} catch {
			// A missing origin still gets explicit setup instructions, without leaking Git stderr.
		}
		print(`refused: ${error.message}`);
		print(
			derived
				? "Derived from the Studio checkout's origin:"
				: "Could not derive a GitHub repository from the Studio checkout's origin; replace the placeholders:",
		);
		print(`export STUDIO_SOURCE_REPO=${derived ?? "<owner>/<name>"}`);
		print(`export STUDIO_CANDIDATE_REPO=${derived ?? "<owner>/<name>"}`);
		print(
			"They're the same until the go-public cutover, when the candidate repo is the private CI repo; see scripts/install-internal-studio.md.",
		);
		return 1;
	}
	const { source, candidate: repository } = repositories;
	const route = `repos/${repository}`;
	let platform = options.platform ?? `${process.platform}-${process.arch}`;
	const temporary = options.temporary ?? tmpdir();
	const run = (command, args, extra = {}) =>
		execute(command, args, { env, cwd, maxBuffer: 512 * 1024 * 1024, ...extra });
	const gh = (args) => {
		try {
			return run("gh", args);
		} catch {
			throw new Error(
				"GitHub request failed. Check gh auth status and Actions/repository access, then rerun.",
			);
		}
	};
	const api = (path, args = []) => {
		const response = gh([
			"api",
			"--hostname",
			"github.com",
			"-H",
			"X-GitHub-Api-Version: 2026-03-10",
			path,
			...args,
		]);
		return String(response).trim() ? JSON.parse(response) : null;
	};
	const pages = (path) => api(path, ["--paginate", "--slurp"]).flat();
	const active = join(home, ".praxity/toolkit/active");
	const version = () => {
		if (!existsSync(active)) return { pack: "none", studioSha: "none" };
		try {
			return JSON.parse(run("sh", [join(home, ".praxity/bin/praxity"), "--version"]));
		} catch {
			// Older installed packs expose only the original version subcommand.
			return JSON.parse(run("sh", [join(home, ".praxity/bin/praxity"), "version"]));
		}
	};
	let interrupted;
	const onInterrupt = (signal) => {
		interrupted ??= signal;
	};
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, onInterrupt);
	// Synchronous children finish their own recovery before scratch is removed.
	const settled = async () => {
		await setImmediate();
		requireValue(!interrupted, "Rerun after the installer has recovered.");
	};
	let sha = "unknown",
		scratch;
	try {
		requireValue(
			["darwin-arm64", "darwin-x64"].includes(platform),
			"Use this command on macOS with Node 24.",
		);
		requireValue(options.rubatoRoot, "Supply --rubato <reviewed Rubato checkout>.");
		const rubatoRoot = resolve(options.rubatoRoot);
		requireValue(
			!String(
				run("git", ["-C", rubatoRoot, "status", "--porcelain", "--untracked-files=normal"]),
			).trim(),
			"Rubato has tracked edits or untracked files. Commit, restore or move them before installing.",
		);
		run("git", ["-C", rubatoRoot, "fetch", "--quiet", "origin", "main"]);
		const rubatoRevision = String(run("git", ["-C", rubatoRoot, "rev-parse", "HEAD"])).trim();
		requireValue(
			String(run("git", ["-C", rubatoRoot, "branch", "--show-current"])).trim() === "main" &&
				rubatoRevision ===
					String(run("git", ["-C", rubatoRoot, "rev-parse", "origin/main"])).trim(),
			"Use a clean Rubato main checkout. Run git switch main and git pull --ff-only, then rerun.",
		);
		requireValue(
			/^[a-f0-9]{40}$/.test(rubatoRevision),
			"Invalid Rubato revision. Fetch origin/main and rerun.",
		);
		const rubato = dependencies.rubato ?? (await loadRubato(rubatoRoot));
		const context = existsSync(active)
			? {
					...rubato.loadContext(
						join(home, ".praxity/toolkit", readFileSync(active, "utf8").split("\n")[0]),
					),
					home,
					cwd,
					env,
				}
			: { home, cwd, env, state: { platform } };
		platform = context.state.platform;
		requireValue(
			["darwin-arm64", "darwin-x64"].includes(platform),
			"Unsupported installed pack platform. Inspect state.json before retrying.",
		);
		const {
			sha: selectedSha,
			mainSha,
			commit: selected,
			run: admitted,
		} = selectNewestInternalStudioRevision((_command, args) => gh(args), env);
		sha = selectedSha;
		const committed = Date.parse(selected.commit?.committer?.date);
		requireValue(
			Number.isFinite(committed),
			"Selected commit has no valid commit date. Inspect GitHub commit metadata and rerun.",
		);
		const age = Math.max(0, Math.floor(((dependencies.now ?? Date.now)() - committed) / 3_600_000));
		print(
			`main ${sha}: selected newest main SHA with successful full Ubicloud CI run ${admitted.id} https://github.com/${source}/actions/runs/${admitted.id}; committed ${new Date(committed).toISOString()}; age ${age}h`,
		);
		if (sha !== mainSha)
			print(
				`main ${sha}: older than current main ${mainSha}; recent features require a newer admitted main revision.`,
			);
		rubato.assertStudioClosed(context, dependencies.updateProcess);
		const current = version();
		if (current.pack !== "none" && (!current.studioSha || current.studioSha === "none"))
			print(
				`main ${sha}: note: installed pack ${current.pack} has no studioSha; downgrade check unavailable.`,
			);
		if (current.studioSha && current.studioSha !== "none" && current.studioSha !== sha) {
			const comparison = api(`repos/${source}/compare/${sha}...${current.studioSha}`);
			requireValue(
				comparison.status !== "ahead",
				`Selected SHA ${sha} is older than installed Studio ${current.studioSha}. Run full ci.yml successfully on current main, then rerun; the active pack is unchanged.`,
			);
			requireValue(
				["behind", "identical"].includes(comparison.status),
				"Cannot establish the selected source's order relative to installed Studio. Inspect the installed source and run full ci.yml successfully on current main before rerunning.",
			);
		}
		const basePack = JSON.parse(
			run("git", ["-C", rubatoRoot, "show", `${rubatoRevision}:pack.json`]),
		);
		const errors = rubato.validateManifest(basePack);
		requireValue(errors.length === 0, `Invalid pack manifest: ${errors.join("; ")}`);
		const prefix = `${basePack.version.split("-")[0]}-internal.${sha}.${rubatoRevision}.`;
		const verifyActive = (installed, expectedPack, expectedDigest) => {
			requireValue(
				installed.studioSha === sha && installed.pack === expectedPack,
				"Installed version does not match the candidate. Inspect praxity --version before retrying.",
			);
			const activeVersion = readFileSync(active, "utf8").split("\n")[0];
			requireValue(
				activeVersion === expectedPack,
				"Installed active pointer does not match the candidate. Run praxity rollback.",
			);
			const root = join(home, ".praxity/toolkit", activeVersion);
			const manifest = JSON.parse(readFileSync(join(root, "pack.json"), "utf8"));
			const studio = manifest.tools.find((tool) => tool.id === "studio");
			const inventory = JSON.parse(readFileSync(join(root, "tools/studio/inventory.json"), "utf8"));
			requireValue(
				inventory.sourceRevision === sha &&
					inventory.sourceTreeDirty === false &&
					inventory.platform === "darwin" &&
					inventory.arch === platform.slice(7) &&
					(expectedDigest === undefined || studio.archives[platform].sha256 === expectedDigest),
				"Installed Studio inventory or archive digest does not match the candidate. Run praxity rollback and inspect the installed pack.",
			);
		};
		if (
			current.studioSha === sha &&
			current.pack.startsWith(`${basePack.version.split("-")[0]}-internal.`) &&
			current.pack.split(".").at(-2) === rubatoRevision &&
			!existsSync(join(home, ".praxity/toolkit/.activation-pending"))
		) {
			verifyActive(current, current.pack);
			try {
				run("sh", [join(home, ".praxity/bin/praxity"), "doctor"]);
			} catch {
				throw new Error(
					"Active pack doctor failed or was interrupted. Resolve the doctor error and rerun. Run praxity rollback if a previous pack exists; otherwise rerun the reviewed Rubato installer to recertify, or uninstall and reinstall.",
				);
			}
			const diagnostics = [];
			const code = rubato.refreshInstalledSkills(
				context,
				{
					updateProcess:
						dependencies.updateProcess ??
						((invocation, extra) => rubato.probeProcess(invocation, { ...extra, stdio: "pipe" })),
					print: (line) => diagnostics.push(line),
				},
				true,
			);
			requireValue(code === 0, `Skill refresh failed. ${diagnostics.join(" ")}`);
			await settled();
			print(`main ${sha}: already current; version=${current.pack} studioSha=${current.studioSha}`);
			return 0;
		}
		const free =
			dependencies.freeBytes ??
			((path) => {
				const disk = statfsSync(path, { bigint: true });
				return disk.bavail * disk.bsize;
			});
		for (const path of [home, temporary])
			requireValue(
				free(path) >= minimumFree,
				"Less than 8 GiB free on the home or temporary volume. Free space and rerun.",
			);

		const recordsFile = join(home, ".praxity/internal-studio-candidates.json");
		let records = existsSync(recordsFile) ? JSON.parse(readFileSync(recordsFile, "utf8")) : [];
		requireValue(
			Array.isArray(records) &&
				records.every(
					(item) =>
						Number.isSafeInteger(item.runId) && item.runId > 0 && /^[a-f0-9]{40}$/.test(item.sha),
				),
			"Invalid candidate ownership record. Inspect internal-studio-candidates.json before rerunning.",
		);
		const saveRecords = () => {
			mkdirSync(join(home, ".praxity"), { recursive: true });
			writeFileSync(recordsFile, `${JSON.stringify(records, null, 2)}\n`);
		};
		const runs = pages(`${route}/actions/workflows/${workflow}/runs?per_page=100`).flatMap(
			(page) => page.workflow_runs,
		);
		const releases = pages(`${route}/releases?per_page=100`);
		const admittedCandidate = (item) => isAdmittedInternalCandidateRun(item, sha, api, repository);
		let candidate = runs
			.filter(
				(item) =>
					(item.status !== "completed" ||
						releases.some(
							(release) =>
								release.tag_name === `cli-candidate-${item.id}` &&
								internalCandidateReleaseSource(release) === sha &&
								release.draft === true &&
								release.prerelease === true,
						)) &&
					(item.status !== "completed" || item.conclusion === "success"),
			)
			.sort(
				(a, b) =>
					Number(b.status === "completed") - Number(a.status === "completed") || b.id - a.id,
			)
			.find(admittedCandidate);
		if (!candidate) {
			const dispatched = api(`${route}/actions/workflows/${workflow}/dispatches`, [
				"--method",
				"POST",
				"-f",
				"ref=main",
				"-f",
				`inputs[ref]=${sha}`,
				"-f",
				"inputs[purpose]=install",
			]);
			requireValue(
				Number.isSafeInteger(dispatched.workflow_run_id) && dispatched.workflow_run_id > 0,
				"Dispatch returned no run ID. Inspect CLI candidate runs before rerunning.",
			);
			candidate = { id: dispatched.workflow_run_id };
			records.push({ runId: candidate.id, sha });
			saveRecords();
		}
		requireValue(
			Number.isSafeInteger(candidate.id) && candidate.id > 0,
			"Invalid candidate run ID. Inspect Actions before rerunning.",
		);
		if (candidate.status !== "completed") {
			print(`main ${sha}: waiting for CLI candidate ${candidate.id}`);
			gh([
				"run",
				"watch",
				String(candidate.id),
				"--repo",
				`github.com/${repository}`,
				"--interval",
				"30",
			]);
		}
		await settled();
		const completed = api(`${route}/actions/runs/${candidate.id}`);
		requireValue(
			admittedCandidate(completed),
			"Candidate tooling or source is not admitted. Require a main workflow commit and the exact selected source SHA; inspect the run and rerun from reviewed main.",
		);
		requireValue(
			completed.status === "completed",
			`candidate build did not finish: ${workflow} run ${candidate.id} https://github.com/${repository}/actions/runs/${candidate.id}`,
		);
		requireValue(
			completed.conclusion === "success",
			`candidate build failed: ${workflow} run ${candidate.id} https://github.com/${repository}/actions/runs/${candidate.id}`,
		);
		admitInternalCandidateRun(completed, {
			jobs: pages(`${route}/actions/runs/${candidate.id}/jobs?per_page=100`).flatMap(
				(page) => page.jobs,
			),
		});
		const candidateReleases = pages(`${route}/releases?per_page=100`);
		const matching = candidateReleases.filter(
			(release) => release.tag_name === `cli-candidate-${candidate.id}`,
		);
		requireValue(
			matching.length === 1,
			"Missing or duplicate candidate draft. Inspect the Actions run and rerun.",
		);
		const release = matching[0];
		requireValue(
			release.draft === true &&
				release.prerelease === true &&
				internalCandidateReleaseSource(release) === sha,
			"Candidate draft has a different SHA or is not a private draft prerelease. Inspect it before rerunning.",
		);
		requireValue(
			Number.isSafeInteger(release.id) && release.id > 0,
			"Invalid draft ID. Inspect the candidate release.",
		);
		const assets = pages(`${route}/releases/${release.id}/assets?per_page=100`);
		const arch = platform.slice("darwin-".length);
		const archives = assets.filter((asset) =>
			new RegExp(`^praxity-cli-[A-Za-z0-9.-]+-macos-${arch}\\.tar\\.gz$`).test(asset.name),
		);
		requireValue(
			archives.length === 1,
			"Missing or duplicate native archive. Inspect the candidate assets and rerun.",
		);
		const archive = archives[0];
		const sums = assets.filter((asset) => asset.name === `${archive.name}.sha256`);
		requireValue(
			sums.length === 1 && Number.isSafeInteger(sums[0].id) && sums[0].id > 0,
			"Missing candidate checksum asset. Inspect the draft and rerun.",
		);
		const checksum = String(
			gh([
				"api",
				"--hostname",
				"github.com",
				"-H",
				"Accept: application/octet-stream",
				`${route}/releases/assets/${sums[0].id}`,
			]),
		).trim();
		const parsed = checksum.match(/^([a-f0-9]{64}) [ *]([^\r\n]+)$/);
		requireValue(
			parsed?.[2] === archive.name && archive.digest === `sha256:${parsed?.[1]}`,
			"Candidate checksum disagrees with the asset digest. Inspect the draft and rerun.",
		);
		scratch = mkdtempSync(join(temporary, "praxity-internal-"));
		const downloads = join(scratch, "downloads");
		downloadCandidate(
			{
				releaseId: String(release.id),
				repository,
				outputDir: downloads,
				arch,
				names: { [arch]: archive.name },
				digests: { [arch]: parsed[1] },
			},
			(command, args, extra) =>
				command === "gh"
					? gh([args[0], "--hostname", "github.com", ...args.slice(1)])
					: run(command, args, extra),
		);
		const pack = basePack;
		const studio = pack.tools.find((tool) => tool.id === "studio");
		const file = join(downloads, archive.name);
		const verified = rubato.verifyStudioArchive(file, arch, sha, parsed[1], studio);
		pack.version = `${prefix}${candidate.id}`;
		studio.version = `${verified.version.split("-")[0]}-main.${sha.slice(0, 8)}`;
		studio.sourceRevision = sha;
		studio.archives[platform] = {
			status: "published",
			url: `https://github.com/${repository}/releases/download/cli-candidate-${candidate.id}/${archive.name}`,
			sha256: verified.digest,
			format: "tar.gz",
			stripComponents: 1,
		};
		const bootstrap = join(scratch, "bootstrap");
		mkdirSync(bootstrap);
		const exported = run("git", [
			"-C",
			rubatoRoot,
			"archive",
			"--format=tar",
			rubatoRevision,
			"install.sh",
			"LICENSE",
			"package.json",
			"src",
			"scripts",
			"schemas",
			"skills",
			"fixtures",
		]);
		run("tar", ["-xf", "-", "-C", bootstrap], { input: exported });
		mkdirSync(join(bootstrap, "archives"));
		copyFileSync(file, join(bootstrap, "archives", `${verified.digest}.tar.gz`));
		const manifest = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`);
		writeFileSync(join(bootstrap, "pack.json"), manifest);
		const diagnostics = [];
		await settled();
		const code = rubato.installVerifiedPack(
			context,
			{ bootstrap, manifest },
			{
				updateProcess:
					dependencies.updateProcess ??
					((invocation, extra) => rubato.probeProcess(invocation, { ...extra, stdio: "pipe" })),
				print: (line) => diagnostics.push(line),
			},
		);
		await settled();
		requireValue(code === 0, `Pack activated but skill refresh failed. ${diagnostics.join(" ")}`);
		const installed = version();
		verifyActive(installed, pack.version, verified.digest);
		const owned = records
			.filter((record) =>
				candidateReleases.some(
					(item) =>
						item.tag_name === `cli-candidate-${record.runId}` &&
						item.draft === true &&
						item.prerelease === true &&
						internalCandidateReleaseSource(item) === record.sha,
				),
			)
			.sort((a, b) => b.runId - a.runId);
		for (const record of owned.slice(2)) {
			const draft = candidateReleases.find(
				(item) => item.tag_name === `cli-candidate-${record.runId}`,
			);
			const fresh = api(`${route}/releases/${draft.id}`);
			requireValue(
				fresh.id === draft.id &&
					fresh.tag_name === draft.tag_name &&
					fresh.draft === true &&
					fresh.prerelease === true &&
					internalCandidateReleaseSource(fresh) === record.sha,
				"Owned candidate changed before cleanup. Inspect the draft and rerun.",
			);
			api(`${route}/releases/${draft.id}`, ["--method", "DELETE"]);
			records = records.filter((item) => item.runId !== record.runId);
			saveRecords();
		}
		await settled();
		print(`main ${sha}: installed; version=${installed.pack} studioSha=${installed.studioSha}`);
		return 0;
	} catch (error) {
		await setImmediate();
		let installed = { pack: "unavailable", studioSha: "unavailable" };
		try {
			installed = version();
		} catch {
			/* The refusal still reports that version inspection failed. */
		}
		const message = [error.message, error.stderr?.toString()].filter(Boolean).join("\n");
		const detail =
			message.match(/Activation failed; rolled back[^\r\n]*/)?.[0] ??
			(message.includes("Owned adapter changed")
				? `${message.includes("Pack activated") ? "Pack activated but skill refresh failed. " : "Skill refresh failed. "}${message.match(/Owned adapter changed[^\r\n]*/)[0]} ${[...message.matchAll(/praxity skills refresh --scope (?:user|project)/g)].map((match) => match[0]).join("; ")}`
				: (message.match(/(?:^|\n)Error: ([^\r\n]+)/)?.[1] ??
					message
						.split(/\r?\n/)
						.filter((line) => line.trim())
						.at(-1)));

		const reason = interrupted ? `Command interrupted by ${interrupted}. ${detail}` : detail;
		print(
			`main ${sha}: refused: ${reason} Resolve the error and rerun this command; version=${installed.pack} studioSha=${installed.studioSha}`,
		);
		return interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : 1;
	} finally {
		if (scratch) rmSync(scratch, { recursive: true });
		for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, onInterrupt);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const { values } = parseArgs({ options: { rubato: { type: "string" } } });
		process.exitCode = await installInternalStudio({ rubatoRoot: values.rubato });
	} catch (error) {
		console.error(`refused: ${error.message}. Use --rubato <reviewed Rubato checkout>.`);
		process.exitCode = 1;
	}
}
