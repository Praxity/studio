import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Publish each real CLI variant once in shared setup, leaving assertions under the test budget.
const publications: {
	format: string;
	locale: string;
	result: Awaited<ReturnType<typeof runPraxityCli>>;
	bytes: Buffer;
	source: string;
}[] = [];
let publicationRoot: string;
const retrievalSource =
	"# Practice\n::: retrieval-sheet Recall\n:: Question\nanswer: Answer\n:::\n";
beforeAll(async () => {
	publicationRoot = await mkdtemp(join(tmpdir(), "cli-retrieval-publication-"));
	await writeFile(join(publicationRoot, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await writeFile(join(publicationRoot, "lesson.prax"), retrievalSource);
	await persistFixtureIdentity(publicationRoot);
	for (const format of ["html", "scorm-1.2", "scorm-2004", "pdf"]) {
		for (const locale of ["en", "fr"]) {
			const output = join(
				publicationRoot,
				`${format}-${locale}.${format === "pdf" ? "pdf" : "zip"}`,
			);
			const result = await runPraxityCli(
				["export", publicationRoot, "--format", format, "--output", output, "--lang", locale],
				{
					appVersion: "0.3.0",
					exportAssetsDir: resolve(import.meta.dirname, "../../../resources/export-assets"),
					typstExecutablePath: process.env.PRAXITY_TEST_TYPST,
				},
			);
			publications.push({
				format,
				locale,
				result,
				bytes: result.exitCode === 0 ? await readFile(output) : Buffer.alloc(0),
				source: await readFile(join(publicationRoot, "lesson.prax"), "utf8"),
			});
		}
	}
});
afterAll(async () => {
	if (publicationRoot) await rm(publicationRoot, { recursive: true, force: true });
});
for (const format of ["html", "scorm-1.2", "scorm-2004", "pdf"]) {
	it.each(["en", "fr"])(`CLI ${format} publishes a retrieval sheet in %s`, (locale) => {
		const output = publications.find(
			(output) => output.format === format && output.locale === locale,
		);
		if (!output) throw new Error("Missing shared CLI publication");
		expect(output.result.exitCode, output.result.stderr).toBe(0);
		expect(JSON.parse(output.result.stdout)).toMatchObject({ ok: true });
		expect(output.bytes.subarray(0, format === "pdf" ? 4 : 2).toString()).toBe(
			format === "pdf" ? "%PDF" : "PK",
		);
		expect(output.source).toBe(retrievalSource);
		if (format !== "pdf") {
			const html = new AdmZip(output.bytes)
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))
				.map((entry) => entry.getData().toString())
				.join("\n");
			expect(html).toContain('data-retrieval-side="front"');
			expect(html).toContain('data-retrieval-side="back"');
			expect(html).toContain("<p>Question</p>");
			expect(html).toContain("<p>Answer</p>");
		}
	});
}

it.each(["html", "scorm-1.2", "scorm-2004", "pdf"])(
	"CLI %s retains the located private-choice refusal",
	async (format) => {
		const root = await mkdtemp(join(tmpdir(), "cli-private-refusal-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
		await writeFile(
			join(root, "lesson.prax"),
			"# Practice\n::: choice Question {private required}\n(x) Answer\n( ) Other\n:::\n",
		);
		const result = await runPraxityCli(
			[
				"export",
				root,
				"--format",
				format,
				"--output",
				join(root, format === "pdf" ? "output.pdf" : "output.zip"),
			],
			{
				appVersion: "0.3.0",
				exportAssetsDir: resolve(import.meta.dirname, "../../../resources/export-assets"),
			},
		);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.message).toBe(
			"lesson.prax:2:1: private-choice-practice-only: A private choice must be optional, unscored, outside assessment groups and without a gate.",
		);
	},
);
