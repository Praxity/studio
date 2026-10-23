import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { buildScormPackage, type CourseExportInput } from "../src/build";
import { resolveAdlManifestTools, validateAdlManifest } from "./adl-manifest-validator";

const tools = resolveAdlManifestTools();
if (!tools) {
	process.stderr.write(
		"[adl-manifest] Skipping official ADL Manifest Tester: set PRAXITY_JAVA and PRAXITY_ADL_VALIDATOR. PRAXITY_GATE=1 requires both tools.\n",
	);
}

const course: CourseExportInput = {
	id: "adl-manifest-metadata",
	title: "ADL manifest metadata",
	sourceLocale: "en",
	description: "Metadata fixture for the official ADL Manifest Tester.",
	content: [
		{
			id: "intro",
			title: "Intro",
			blocks: [{ id: "text", type: "text", data: { content: "<p>Introduction</p>" } }],
		},
	],
};

describe.skipIf(!tools)("Official ADL 2004 4th-edition Manifest Tester", () => {
	it.each([
		["4th", "4th-edition manifest conformance"],
		["3rd", "3rd-edition compatibility evidence against the 4th-edition validator"],
	] as const)(
		"validates %s export: %s",
		async (edition, _evidence) => {
			if (!tools) throw new Error("ADL Manifest Tester tools unavailable");
			const dir = await mkdtemp(join(tmpdir(), "praxity-adl-manifest-"));
			try {
				const result = await buildScormPackage(course, {
					format: "scorm2004",
					scorm2004Edition: edition,
				});
				const packagePath = join(dir, `metadata-${edition}.zip`);
				await writeFile(packagePath, result.zip);
				process.stdout.write(validateAdlManifest(packagePath, tools));
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
		90_000,
	);
});
