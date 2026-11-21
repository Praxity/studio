import { join, resolve } from "node:path";

export const RUSTICI_FILES = ["indexAPI.html", "scormdriver.js", "blank.html"] as const;

export function resolveXmllint(env: NodeJS.ProcessEnv = process.env): string {
	return env.PRAXITY_XMLLINT ?? "xmllint";
}

export function rusticiDriverDir(
	format: "scorm12" | "scorm2004",
	env: NodeJS.ProcessEnv = process.env,
): string {
	return env.PRAXITY_RUSTICI_DRIVERS
		? join(env.PRAXITY_RUSTICI_DRIVERS, format)
		: resolve(import.meta.dirname, "scorm-local/drivers", format);
}
