import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { type RuntimeNotices, readPackageNotice } from "../../src/third-party-notices.ts";

const require = createRequire(import.meta.url);

/** Empty fixture runtimes have no dependencies; generated CSS and note icons keep real terms. */
export async function fixtureRuntimeNotices(
	shell: string,
	hosts: string[],
	islands: string[],
	resume: string,
): Promise<RuntimeNotices> {
	return {
		packages: {
			"@mantine/core": await readPackageNotice(require.resolve("@mantine/core/styles.css")),
			"@tabler/icons": await readPackageNotice(require.resolve("@tabler/icons/outline/bulb.svg")),
		},
		outputs: Object.fromEntries(
			[
				"viewer.css",
				"deck-shell.css",
				"retrieval-sheet.css",
				"highlight.css",
				shell,
				resume,
				...hosts,
				...islands.map((file) => `islands/${file}`),
			].map((file) => [file, []]),
		),
	};
}

export function fixtureCourseRuntimeLicense(): Promise<string> {
	return readFile(new URL("../../template/COURSE-RUNTIME-LICENSE.txt", import.meta.url), "utf8");
}
