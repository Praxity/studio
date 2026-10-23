import { join, resolve } from "node:path";

export const RUSTICI_FILES = ["indexAPI.html", "scormdriver.js", "blank.html"] as const;

export function resolveXmllint(env: NodeJS.ProcessEnv = process.env): string {
	return env.PRAXITY_XMLLINT ?? "xmllint";
}

/**
 * Rustici's licence forbids redistribution, so the drivers are never committed.
 * PRAXITY_RUSTICI_DRIVERS names a folder holding scorm12/ and scorm2004/, which
 * lets every worktree share one local copy; otherwise the gitignored folder is used.
 */
export function rusticiDriverDir(
	format: "scorm12" | "scorm2004",
	env: NodeJS.ProcessEnv = process.env,
): string {
	return env.PRAXITY_RUSTICI_DRIVERS
		? join(env.PRAXITY_RUSTICI_DRIVERS, format)
		: resolve(import.meta.dirname, "scorm-local/drivers", format);
}
