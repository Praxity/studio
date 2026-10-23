import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const gatePaths = [
	"scripts/equivalence",
	"scripts/equivalence.test.mjs",
	"scripts/equivalence-nonvisual.test.mjs",
];

export async function checkoutState(checkout) {
	const status = git(checkout, "status", "--porcelain=v1", "-z");
	const diff = git(checkout, "diff", "--binary", "HEAD");
	const untracked = git(checkout, "ls-files", "--others", "--exclude-standard", "-z")
		.split("\0")
		.filter(Boolean)
		.sort();
	const untrackedHashes = [];
	for (const file of untracked)
		untrackedHashes.push([file, hash(await readFile(path.join(checkout, file)))]);
	return {
		commit: git(checkout, "rev-parse", "HEAD").trim(),
		dirty: Boolean(status),
		status,
		diffSha256: hash(diff),
		untrackedSha256: hash(JSON.stringify(untrackedHashes)),
	};
}

// Only these trusted entry points may select a dependency closure. CLI callers
// bind their own literal entry; the pixel gate retains its original default.
const entryModules = {
	"pixel-gate": ["build", "capture", "compare", "inventory", "provenance"],
	"nonvisual-gate": [
		"build",
		"nonvisual-build",
		"nonvisual-compare",
		"nonvisual-isolation",
		"provenance",
		"verify-inputs",
	],
};

export async function validateCheckouts(
	base,
	candidate,
	script,
	{
		control = false,
		allowGateChange = false,
		allowDirtyBase = false,
		existing = false,
		entryPoint = "pixel-gate",
	} = {},
) {
	base = await realpath(base);
	candidate = await realpath(candidate);
	const running = await realpath(script);
	if (!Object.hasOwn(entryModules, entryPoint))
		throw new Error(`Unknown gate entry: ${entryPoint}`);
	if (running !== (await realpath(path.join(base, `scripts/equivalence/${entryPoint}.mjs`))))
		throw new Error("Run the exact --base entry point (trusted tooling realpath)");
	// Node resolves these relative imports beside the admitted entry point. Refuse
	// module symlinks escaping that directory, including a candidate nested in base.
	for (const name of entryModules[entryPoint]) {
		const modulePath = path.join(base, `scripts/equivalence/${name}.mjs`);
		if ((await realpath(modulePath)) !== modulePath)
			throw new Error(`Untrusted gate module realpath: ${modulePath}`);
	}
	const states = { base: await checkoutState(base), candidate: await checkoutState(candidate) };
	for (const [side, state] of Object.entries(states))
		console.log(`${side}: ${state.commit} ${state.dirty ? "dirty" : "clean"}`);
	if (states.base.dirty && !allowDirtyBase)
		throw new Error("Dirty base refused; review and acknowledge with --allow-dirty-base");
	if (states.base.dirty) console.log(`ACKNOWLEDGED dirty base: ${states.base.status}`);
	const main = execFileSync("git", ["rev-parse", "--verify", "refs/remotes/origin/main"], {
		cwd: base,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	const originMain = main.trim();
	const baseIsOriginMain = states.base.commit === originMain;
	let baseIsAncestor = false;
	try {
		execFileSync(
			"git",
			["merge-base", "--is-ancestor", states.base.commit, states.candidate.commit],
			{
				cwd: candidate,
				stdio: "ignore",
			},
		);
		baseIsAncestor = true;
	} catch (error) {
		if (error.status !== 1) throw error;
	}
	console.log(
		`base equals origin/main: ${baseIsOriginMain}; base ancestor of candidate: ${baseIsAncestor}`,
	);
	if (!control && !baseIsAncestor)
		throw new Error("Base must be an ancestor of candidate (except --control)");
	if (
		!existing &&
		!control &&
		(base === candidate ||
			(states.base.commit === states.candidate.commit &&
				!states.base.dirty &&
				!states.candidate.dirty))
	)
		throw new Error("Same code/checkouts require --control");
	const committed = git(
		candidate,
		"diff",
		"--stat",
		states.base.commit,
		states.candidate.commit,
		"--",
		...gatePaths,
	);
	const working = git(candidate, "diff", "--stat", "HEAD", "--", ...gatePaths);
	const untracked = git(
		candidate,
		"ls-files",
		"--others",
		"--exclude-standard",
		"--",
		...gatePaths,
	);
	const gateDiff = [committed, working, untracked].filter(Boolean).join("\n");
	if (gateDiff && !allowGateChange)
		throw new Error(
			`Candidate edits equivalence tooling; review and acknowledge with --allow-gate-change:\n${gateDiff}`,
		);
	if (gateDiff) console.log(`ACKNOWLEDGED gate change:\n${gateDiff}`);
	return {
		states,
		control,
		allowGateChange,
		allowDirtyBase,
		originMain,
		baseIsOriginMain,
		baseIsAncestor,
		gateDiff,
	};
}

// Every process starts with empty, private persistent and compiler caches.
export async function freshBuildEnvironment(root) {
	await mkdir(root);
	const locations = {
		HOME: path.join(root, "home"),
		XDG_CACHE_HOME: path.join(root, "xdg-cache"),
		XDG_CONFIG_HOME: path.join(root, "xdg-config"),
		XDG_DATA_HOME: path.join(root, "xdg-data"),
		LOCALAPPDATA: path.join(root, "local"),
		APPDATA: path.join(root, "roaming"),
		TMPDIR: path.join(root, "tmp"),
	};
	for (const directory of Object.values(locations)) await mkdir(directory, { recursive: true });
	const env = {
		...process.env,
		...locations,
		USERPROFILE: locations.HOME,
		TMP: locations.TMPDIR,
		TEMP: locations.TMPDIR,
		TZ: "UTC",
		TSX_DISABLE_CACHE: "1",
		NODE_DISABLE_COMPILE_CACHE: "1",
	};
	delete env.NODE_COMPILE_CACHE;
	return env;
}
