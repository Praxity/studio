import { readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

/** Include empty folders and every byte, so refused writes cannot leave hidden debris. */
export async function directorySnapshot(root: string) {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return Promise.all(
		entries
			.map((entry) => ({ entry, path: join(entry.parentPath, entry.name) }))
			.sort((a, b) => a.path.localeCompare(b.path))
			.map(async ({ entry, path }) => [
				relative(root, path),
				entry.isDirectory()
					? "directory"
					: entry.isSymbolicLink()
						? `link:${await readlink(path)}`
						: (await readFile(path)).toString("hex"),
			]),
	);
}
