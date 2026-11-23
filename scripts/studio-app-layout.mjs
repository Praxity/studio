import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const oldPrefix = "apps/desktop/";
const newPrefix = "apps/cli/";

export function renamedStudioAppReferences(value) {
	return value.replaceAll(oldPrefix, newPrefix);
}

export function priorStudioAppPath(file, previous, current) {
	if (previous.has(file)) return file;
	if (!file.startsWith(newPrefix)) return undefined;
	const prior = oldPrefix + file.slice(newPrefix.length);
	return previous.has(prior) && !current.has(prior) ? prior : undefined;
}

export async function studioAppDirectory(root) {
	const layouts = ["desktop", "cli"].filter((app) => existsSync(path.join(root, "apps", app)));
	if (layouts.length === 0)
		throw new Error("Missing Studio app layout: expected apps/desktop or apps/cli");
	if (layouts.length !== 1)
		throw new Error("Ambiguous Studio app layout: apps/desktop and apps/cli both exist");
	const app = layouts[0];
	const directory = `apps/${app}`;
	const expected = `@praxity/${app}`;
	const manifest = JSON.parse(await readFile(path.join(root, directory, "package.json"), "utf8"));
	if (manifest.name !== expected)
		throw new Error(`Expected ${expected} in ${directory}/package.json`);
	return directory;
}
