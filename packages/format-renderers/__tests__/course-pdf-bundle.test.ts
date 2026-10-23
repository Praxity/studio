import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLesson as readBlockSource } from "@praxity/grammar";
import { build, type Metafile } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";

let directory: string;
let metafile: Metafile;
const forbidden =
	/(?:^|\/)(?:electron|react|react-dom)(?:\/|$)|(?:^|\/)apps\/desktop\/|(?:^|\/)packages\/export-pipeline\/|\/src\/viewer\/|@myriaddreamin[+/]/;

beforeAll(async () => {
	directory = await mkdtemp(path.join(tmpdir(), "course-pdf-bundle-"));
	const bundle = await build({
		absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
		entryPoints: ["@praxity/format-renderers/pipelines/course-pdf"],
		outfile: path.join(directory, "course-pdf.cjs"),
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node24",
		metafile: true,
	});
	metafile = bundle.metafile;
	const source = await readFile(
		new URL("./fixtures/course-workbook.prax", import.meta.url),
		"utf8",
	);
	await writeFile(
		path.join(directory, "course.json"),
		JSON.stringify({
			title: "Bundled course workbook",
			locale: "en",
			lessons: [
				{
					id: "lesson-en",
					title: "Practice",
					locale: "en",
					blocks: readBlockSource(source).blocks,
				},
			],
		}),
	);
});

afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

function runBundle(native: boolean) {
	return JSON.parse(
		execFileSync(
			process.execPath,
			[
				"-e",
				`
const fs = require("node:fs");
const api = require(process.argv[1]);
const options = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (typeof window !== "undefined" || process.versions.electron) throw new Error("Host UI leaked into module");
async function run() {
  if (!process.argv[3]) {
    const result = api.buildCoursePdfSource(options);
    console.log(JSON.stringify({ questionCount: result.questionCount, content: result.typstSource.includes("Choose the colour") }));
    return;
  }
  const results = [];
  for (const includeAnswerSheet of [false, true]) {
    const result = await api.exportCoursePdf({ ...options, includeAnswerSheet, executablePath: process.argv[3] });
    results.push({ signature: result.pdf.subarray(0, 5).toString(), bytes: result.pdf.length, questionCount: result.questionCount });
  }
  console.log(JSON.stringify(results));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
`,
				path.join(directory, "course-pdf.cjs"),
				path.join(directory, "course.json"),
				...(native ? [process.env.PRAXITY_TEST_TYPST as string] : []),
			],
			{
				cwd: directory,
				// No NODE_PATH or adjacent node_modules: the artifact must load in Node alone.
				env: { LANG: "C.UTF-8" },
				encoding: "utf8",
				timeout: 95_000,
			},
		),
	);
}

it("rebundles the public PDF entry without host UI or viewer dependencies", () => {
	const inputs = Object.keys(metafile.inputs).map((file) => file.replaceAll("\\", "/"));
	expect(inputs.some((file) => file.endsWith("src/pipelines/course-pdf.ts"))).toBe(true);
	for (const input of inputs) expect(input, input).not.toMatch(forbidden);
	for (const output of Object.values(metafile.outputs)) {
		for (const imported of output.imports) {
			expect(builtinModules.includes(imported.path.replace(/^node:/, "")), imported.path).toBe(
				true,
			);
		}
	}
	expect(runBundle(false)).toEqual({ questionCount: 5, content: true });
});

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"exports both real PDF variants from the isolated Node bundle",
	() => {
		const results = runBundle(true) as {
			signature: string;
			bytes: number;
			questionCount: number;
		}[];
		expect(results).toHaveLength(2);
		for (const result of results) {
			expect(result.signature).toBe("%PDF-");
			expect(result.bytes).toBeGreaterThan(1000);
			expect(result.questionCount).toBe(5);
		}
	},
	100_000,
);
