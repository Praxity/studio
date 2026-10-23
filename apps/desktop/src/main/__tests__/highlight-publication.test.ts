import { type ChildProcess, execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { type BuildOptions, build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { exportProject } from "../export/export-project";

// Parsing, identity reads, project export and both CLI owners remain real.
let scratch: string;
let cli: string;
let sourceHtml: string;
let sourceStdout: string;
const roots = new Map<string, string>();
const source = (nested: boolean) =>
	`# P\n${nested ? "::: accordion {hide}\n:: Panel\n" : ""}::: highlight Title {hide}\n:: Target {key}\n:::\n${nested ? ":::\n" : ""}`;
const children = new Map<ChildProcess, Promise<void>>();
function runCli(args: string[]) {
	const result = promisify(execFile)(process.execPath, args);
	const settled = result.then(
		() => {},
		() => {},
	);
	children.set(result.child, settled);
	void settled.then(() => children.delete(result.child));
	return result;
}
async function stopClis() {
	await Promise.all(
		[...children].map(async ([child, settled]) => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await settled;
		}),
	);
}
afterEach(stopClis);
beforeAll(async () => {
	scratch = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "highlight-publication-"),
	);
	for (const nested of [false, true]) {
		const root = join(scratch, String(nested));
		roots.set(String(nested), root);
		await mkdir(root);
		await writeFile(join(root, "course.yaml"), "title: Practice\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), source(nested));
		await persistFixtureIdentity(root);
	}
	cli = join(scratch, "praxity-cli.mjs");
	const script = new URL(
		"../../../../../packages/export-pipeline/scripts/build-course-html.ts",
		import.meta.url,
	);
	const runtimeRequire = createRequire(
		new URL("../../../../../packages/shared-blocks/package.json", import.meta.url),
	);
	const bundleOptions: BuildOptions = {
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: `import {createRequire as createBundleRequire} from "node:module"; const require=createBundleRequire(${JSON.stringify(new URL("../../../../../package.json", import.meta.url).href)});`,
		},
		plugins: [
			{
				name: "external-dom-runtime",
				setup(builder) {
					builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
						path: pathToFileURL(runtimeRequire.resolve(args.path)).href,
						external: true,
					}));
				},
			},
		],
	};
	await build({
		...bundleOptions,
		stdin: {
			resolveDir: fileURLToPath(new URL("../../../../../", import.meta.url)),
			contents: `import {runPraxityCli} from "./apps/desktop/src/main/cli"; const r=await runPraxityCli(process.argv.slice(2),{appVersion:"0.3.0",exportAssetsDir:${JSON.stringify(fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)))}});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.exitCode;`,
		},
		outfile: cli,
	});
	const sourceCli = join(scratch, "build-course-html.mjs");
	await build({
		...bundleOptions,
		entryPoints: [fileURLToPath(script)],
		outfile: sourceCli,
		// Keep the real script's prebuilt-asset lookup while avoiding tsx startup.
		define: { "import.meta.dirname": JSON.stringify(fileURLToPath(new URL(".", script))) },
	});
	const sourceOutput = join(scratch, "source-html-output");
	const sourceRoot = roots.get("true")!;
	const result = await runCli([sourceCli, join(sourceRoot, "lesson.prax"), sourceOutput]);
	sourceStdout = result.stdout;
	sourceHtml = (
		await Promise.all(
			(
				await readdir(sourceOutput)
			)
				.filter((f) => f.endsWith(".html"))
				.map((f) => readFile(join(sourceOutput, f), "utf8")),
		)
	).join("");
});
afterAll(async () => {
	await stopClis();
	await rm(scratch, { recursive: true });
});
const formats = ["html", "scorm-1.2", "scorm-2004", "xapi", "pdf"] as const;
it.each(formats.flatMap((format) => [false, true].map((nested) => ({ format, nested }))))(
	"Studio publishes $format or retains native PDF refusal, hidden nested=$nested",
	async ({ format, nested }) => {
		const root = roots.get(String(nested));
		if (!root) throw new Error("Missing fixture");
		const before = await readdir(root);
		const run = () =>
			exportProject({
				projectDir: root,
				exportAssetsDir: fileURLToPath(
					new URL("../../../resources/export-assets/", import.meta.url),
				),
				manifestPolicy: "write",
				scope: "course",
				format,
				fallbackCompletionThreshold: 0.8,
				enforceAccessibility: false,
				inheritWorkspaceSettings: false,
			});
		if (format === "pdf") {
			await expect(run()).rejects.toMatchObject({
				code: "highlight-native-pdf-unsupported",
				diagnostics: [
					expect.objectContaining({
						file: "lesson.prax",
						line: nested ? 4 : 2,
						column: 1,
						span: {
							start: source(nested).indexOf("::: highlight"),
							end: source(nested).indexOf(":: Target"),
						},
					}),
				],
			});
		} else {
			const result = await run();
			if (!("zip" in result)) throw new Error("Expected runtime package");
			const zip = new AdmZip(result.zip);
			expect(zip.getEntries().some((e) => e.entryName.endsWith(".html"))).toBe(true);
			// Hidden practice still ships its authored baseline for public show/hide.
			expect(
				zip
					.getEntries()
					.filter((e) => e.entryName.endsWith(".html"))
					.map((e) => zip.readAsText(e))
					.join(""),
			).toContain("data-highlight-fallback");
		}
		expect(await readdir(root)).toEqual(before);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source(nested));
	},
);
it.each([false, true])(
	"native input preparation refuses with answer sheet=%s",
	async (includeAnswerSheet) => {
		const root = roots.get("true");
		if (!root) throw new Error("Missing fixture");
		await expect(
			buildCourseExportInput({
				projectDir: root,
				scope: "course",
				manifestPolicy: "read-only",
				completionThreshold: 0,
				viewerVersionPath: join(root, "missing"),
				preparePdf: true,
				includeAnswerSheet,
				loadAssets: false,
				inheritWorkspaceSettings: false,
			}),
		).rejects.toMatchObject({ code: "highlight-native-pdf-unsupported" });
	},
);
it.each(["en", "fr"] as const)(
	"real CLI PDF refusal keeps its code and %s copy with both answer modes",
	async (locale) => {
		const root = roots.get("true");
		if (!root) throw new Error("Missing fixture");
		const output = join(scratch, `preserved-${locale}.pdf`);
		await writeFile(output, "PREVIOUS OUTPUT");
		for (const answers of [false, true]) {
			const result = await runPraxityCli(
				[
					"export",
					root,
					"--format",
					"pdf",
					"--output",
					output,
					"--lang",
					locale,
					...(answers ? ["--include-answer-sheet"] : []),
				],
				{
					appVersion: "0.3.0",
					exportAssetsDir: join(root, "missing"),
					typstExecutablePath: join(root, "missing-typst"),
				},
			);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({
				ok: false,
				error: { code: "highlight-native-pdf-unsupported" },
			});
			expect(result.stderr).toContain(
				locale === "en"
					? "Highlight is not supported in native PDF export."
					: "Le surlignage n'est pas pris en charge dans l'export PDF natif.",
			);
			expect(await readFile(output, "utf8")).toBe("PREVIOUS OUTPUT");
		}
	},
);
it("the built CLI publishes source to an HTML ZIP", async () => {
	const root = roots.get("true");
	if (!root) throw new Error("Missing fixture");
	const output = join(scratch, "html-output.zip");
	const result = await runCli([cli, "export", root, "--format", "html", "--output", output]);
	expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
	const zip = new AdmZip(await readFile(output));
	expect(
		zip
			.getEntries()
			.filter((e) => e.entryName.endsWith(".html"))
			.map((e) => zip.readAsText(e))
			.join(""),
	).toContain("data-highlight-fallback");
});

it("the source HTML CLI publishes the passage and native Answer", () => {
	expect(sourceStdout).toContain("pages");
	expect(sourceHtml).toContain("data-highlight-fallback");
	expect(sourceHtml).toContain("Target");
});
