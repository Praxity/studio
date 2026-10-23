import { constants } from "node:fs";
import { access, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { preserveLineEndings } from "@praxity/grammar";
import { resolveExistingPathWithin } from "./path-security";

export class PrivateProjectPathError extends Error {
	constructor(
		readonly path: string,
		readonly reason: "link" | "parent" | "alias" | "plain" | "read-only",
	) {
		super(`Private project path refused: ${reason} at ${path}`);
	}
}

/** Fixed private paths retain their spelling and never traverse links. */
export async function checkPrivateProjectPath(
	root: string,
	relative: string,
	options: { allowAbsentCaseAlias?: boolean; plain?: boolean; writable?: boolean } = {},
): Promise<{ missing: string[] }> {
	const missing: string[] = [];
	let caseAlias = false;
	const parts = relative.split("/");
	for (let index = 0; index < parts.length; index++) {
		const path = parts.slice(0, index + 1).join("/");
		if (missing.length) {
			missing.push(path);
			continue;
		}
		try {
			const parent = join(root, ...parts.slice(0, index));
			// Strict stores also refuse an absent spelling with a case-folded sibling.
			if (options.plain) {
				const names = await readdir(parent);
				if (
					!names.includes(parts[index]) &&
					names.some((name) => name.toLowerCase() === parts[index].toLowerCase())
				)
					throw new PrivateProjectPathError(path, "alias");
			}
			const target = join(root, path);
			const entry = await lstat(target);
			if (entry.isSymbolicLink()) throw new PrivateProjectPathError(path, "link");
			if (index < parts.length - 1 && !entry.isDirectory())
				throw new PrivateProjectPathError(path, "parent");
			if (!(await readdir(parent)).includes(parts[index])) {
				caseAlias = true;
				if (!options.allowAbsentCaseAlias) throw new PrivateProjectPathError(path, "alias");
			}
			const resolved = await resolveExistingPathWithin(root, target);
			if (
				options.plain &&
				((!entry.isDirectory() && !entry.isFile()) ||
					(entry.isFile() && entry.nlink > 1) ||
					resolved !== target)
			)
				throw new PrivateProjectPathError(path, "plain");
			if (options.writable) {
				// Windows directory READONLY is decorative; it does not deny writes.
				if (entry.isFile() && !(entry.mode & 0o222))
					throw new PrivateProjectPathError(path, "read-only");
				await access(target, constants.W_OK);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			missing.push(path);
		}
	}
	if (caseAlias && !missing.length) throw new PrivateProjectPathError(relative, "alias");
	return { missing };
}

/** The last wildcard must override earlier negations; preserve the owner's bytes. */
export function privateFolderIgnoreContent(source: string | null): string | null {
	if (source !== null && /(?:^|\r?\n)\*(?:\r?\n)*$/u.test(source)) return null;
	const separator = source && !/[\r\n]$/u.test(source) ? "\n" : "";
	return (source ?? "") + preserveLineEndings(`${separator}*\n`, source ?? undefined);
}
