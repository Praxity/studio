import { execFileSync } from "node:child_process";
import { posix } from "node:path";

// Prefix every segment in both operands so glob wildcards also match dotfiles.
// Keeping ** intact in the glob preserves its directory traversal semantics.
const visible = (path, glob = false) =>
	path
		.split("/")
		.map((part) => (glob && part === "**" ? part : `_${part}`))
		.join("/");

export function candidateDiff(
	git = (...args) =>
		execFileSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}),
	recordMain = () => {},
) {
	git("fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main");
	const main = git("rev-parse", "origin/main").trim();
	if (!/^[0-9a-f]{40}$/.test(main)) throw new Error("Candidate main revision unavailable");
	recordMain(main);
	const base = git("merge-base", "origin/main", "HEAD").trim();
	if (!/^[0-9a-f]{40}$/.test(base)) throw new Error("Candidate merge base unavailable");
	return git("diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--");
}

export function browserRequired(
	skipGlobs,
	readDiff = () =>
		execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD", "--"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}),
) {
	try {
		if (
			!Array.isArray(skipGlobs) ||
			!skipGlobs.length ||
			skipGlobs.some((glob) => typeof glob !== "string" || !glob)
		)
			throw new Error("Missing or invalid browser skip globs");
		const diff = readDiff();
		if (typeof diff !== "string" || (diff && !diff.endsWith("\0")))
			throw new Error("Incomplete browser diff");
		const files = diff.split("\0").filter(Boolean);
		return (
			!files.length ||
			files.some(
				(file) => !skipGlobs.some((glob) => posix.matchesGlob(visible(file), visible(glob, true))),
			)
		);
	} catch (error) {
		console.warn(`Browser diff unavailable; running all suites: ${error.message}`);
		return true;
	}
}
