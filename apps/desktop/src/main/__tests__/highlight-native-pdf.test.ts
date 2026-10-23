import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { exportProject } from "../export/export-project";
import { resolveLessonSources } from "../lesson-source";

// Simulate the later publication lift. Parsing, identity, projection, asset
// preparation and the native PDF preflight stay real.
vi.mock("@praxity/grammar", async (original) => ({
	...(await original<typeof import("@praxity/grammar")>()),
	assertCoursePracticeAdmission: vi.fn(),
}));

let scratch: string;
let cli: string;
const cases = [
	...["en", "fr"].flatMap((locale) =>
		[false, true].map((includeAnswerSheet) => ({
			locale,
			adviceLocale: locale,
			includeAnswerSheet,
		})),
	),
	{ locale: "en", adviceLocale: "fr", includeAnswerSheet: false },
	{ locale: "fr", adviceLocale: "en", includeAnswerSheet: false },
];
const narrationCase = {
	locale: "en",
	adviceLocale: "en",
	includeAnswerSheet: false,
	narration: true,
};
type FixtureCase = (typeof cases)[number] | typeof narrationCase;
const caseId = (row: FixtureCase) =>
	`${row.locale}-${row.adviceLocale}-${row.includeAnswerSheet}-${"narration" in row}`;
const fixtures = new Map<
	string,
	{ root: string; temporaryRoot: string; before: string[]; lessonId: string; highlightId: string }
>();
beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), "highlight-native-pdf-"));
	cli = join(scratch, "cli.mjs");
	const runtimeRequire = createRequire(
		new URL("../../../../../packages/shared-blocks/package.json", import.meta.url),
	);
	// Build the actual standalone CLI once. Only temporary publication admission
	// is lifted in this test bundle, so native PDF must supply its own refusal.
	await build({
		entryPoints: [fileURLToPath(new URL("../standalone-cli.ts", import.meta.url))],
		outfile: cli,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
		},
		plugins: [
			{
				name: "native-pdf-after-publication-lift",
				setup(builder) {
					builder.onLoad(
						{ filter: /packages[/\\]grammar[/\\]src[/\\]practice-admission\.ts$/ },
						async ({ path }) => {
							const source = await readFile(path, "utf8");
							const admission =
								"const diagnostics = practiceAdmissionDiagnostics(lessons, locale, format);";
							if (!source.includes(admission))
								throw new Error("Publication admission seam changed");
							return {
								contents: source.replace(
									admission,
									'const diagnostics = format === "native-pdf" ? [] : practiceAdmissionDiagnostics(lessons, locale, format);',
								),
								loader: "ts",
							};
						},
					);
					builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
						path: pathToFileURL(runtimeRequire.resolve(args.path)).href,
						external: true,
					}));
				},
			},
		],
	});
});

async function fixture(row: FixtureCase) {
	// Keep setup local to each case instead of charging every fixture to beforeAll.
	const cached = fixtures.get(caseId(row));
	if (cached) return cached;
	const { locale } = row;
	const root = join(scratch, caseId(row));
	const temporaryRoot = join(root, "pdf-scratch");
	await mkdir(temporaryRoot, { recursive: true });
	await writeFile(
		join(root, "course.yaml"),
		`title: Practice\nlang: ${locale}\nlessons: [lesson.prax]\n`,
	);
	await writeFile(
		join(root, "lesson.prax"),
		`---\nlang: ${locale}\n---\n# P\n::: accordion {hide}\n:: Panel\n::: highlight Title {hide}\n:: Target {key}\n:::\n:::\n`,
	);
	await persistFixtureIdentity(root);
	const source = await resolveLessonSources(root);
	const lesson = source.lessons.get("lesson.prax");
	const highlightId = flattenLogicBlocks(lesson?.blocks ?? []).find(
		(block) => block.type === "highlight",
	)?.id;
	if (!highlightId) throw new Error("Missing highlight fixture identity");
	const lessonId = source.identity.snapshots.find(
		(snapshot) => snapshot.nodes[highlightId],
	)?.lessonId;
	if (!lessonId) throw new Error("Missing lesson fixture identity");
	if ("narration" in row) {
		await writeFile(
			join(root, "narration.yaml"),
			JSON.stringify({
				version: 2,
				courseId: source.identity.course.courseId,
				lessons: { [lessonId]: { segments: [{ target: { id: highlightId, role: "body" } }] } },
			}),
		);
	}
	const before = await readdir(root);
	const result = {
		root,
		temporaryRoot,
		before,
		lessonId,
		highlightId,
	};
	fixtures.set(caseId(row), result);
	return result;
}

async function runCli(row: FixtureCase): Promise<{ code: number; stdout: string; stderr: string }> {
	const { root } = await fixture(row);
	const error = await promisify(execFile)(process.execPath, [
		cli,
		"export",
		root,
		"--format",
		"pdf",
		"--output",
		join(root, "output.pdf"),
		"--lang",
		row.adviceLocale,
		...(row.includeAnswerSheet ? ["--include-answer-sheet"] : []),
	]).then(
		() => {
			throw new Error("CLI unexpectedly produced a workbook");
		},
		(error) => error,
	);
	return error;
}

afterAll(async () => {
	await rm(scratch, { recursive: true });
});

it.each(cases)(
	"Studio preserves permanent native refusal for course=$locale, advice=$adviceLocale, answers=$includeAnswerSheet",
	async (row) => {
		const { adviceLocale, includeAnswerSheet } = row;
		const { root, temporaryRoot, before, lessonId, highlightId } = await fixture(row);
		await expect(
			exportProject({
				projectDir: root,
				exportAssetsDir: join(root, "missing-assets"),
				manifestPolicy: "read-only",
				scope: "course",
				format: "pdf",
				includeAnswerSheet,
				adviceLocale: adviceLocale as "en" | "fr",
				temporaryRoot,
				fallbackCompletionThreshold: 0.8,
				enforceAccessibility: false,
				inheritWorkspaceSettings: false,
			}),
		).rejects.toMatchObject({
			code: "highlight-native-pdf-unsupported",
			cause: expect.objectContaining({
				lessonId,
				blockId: highlightId,
				reason:
					adviceLocale === "en"
						? "Highlight is not supported in native PDF export. Use your browser's Print or Save as PDF."
						: "Le surlignage n'est pas pris en charge dans l'export PDF natif. Utilisez Imprimer ou Enregistrer au format PDF dans votre navigateur.",
			}),
		});
		expect(await readdir(root)).toEqual(before);
		expect(await readdir(temporaryRoot)).toEqual([]);
	},
);
it.each(cases)(
	"built CLI preserves permanent native refusal for course=$locale, advice=$adviceLocale, answers=$includeAnswerSheet",
	async (row) => {
		const { adviceLocale } = row;
		const { root, temporaryRoot, before, lessonId, highlightId } = await fixture(row);
		const output = join(root, "output.pdf");
		const error = await runCli(row);
		expect(error.code).toBe(1);
		const result = JSON.parse(error.stdout);
		expect(result.error.code).toBe("highlight-native-pdf-unsupported");
		expect(result.error.message).toContain(lessonId);
		expect(result.error.message).toContain(highlightId);
		expect(error.stderr).toContain(
			adviceLocale === "en"
				? "Highlight is not supported in native PDF export. Use your browser's Print or Save as PDF."
				: "Le surlignage n'est pas pris en charge dans l'export PDF natif. Utilisez Imprimer ou Enregistrer au format PDF dans votre navigateur.",
		);
		await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readdir(root)).toEqual(before);
		expect(await readdir(temporaryRoot)).toEqual([]);
	},
);

it("Studio preserves the typed highlight sidecar refusal after publication lifts", async () => {
	const { root, highlightId, before, temporaryRoot } = await fixture(narrationCase);
	await expect(
		exportProject({
			projectDir: root,
			exportAssetsDir: join(root, "missing-assets"),
			manifestPolicy: "read-only",
			scope: "course",
			format: "pdf",
			fallbackCompletionThreshold: 0.8,
			enforceAccessibility: false,
			inheritWorkspaceSettings: false,
		}),
	).rejects.toMatchObject({
		code: "highlight-narration-unsupported",
		message: `${highlightId}: Highlight does not support block narration.`,
		cause: expect.objectContaining({
			code: "highlight-narration-unsupported",
			blockId: highlightId,
		}),
	});
	expect(await readdir(root)).toEqual(before);
	expect(await readdir(temporaryRoot)).toEqual([]);
});
it("built CLI preserves the highlight sidecar refusal code and block", async () => {
	const { highlightId } = await fixture(narrationCase);
	const error = await runCli(narrationCase);
	expect(error.code).toBe(1);
	expect(JSON.parse(error.stdout).error).toEqual({
		code: "highlight-narration-unsupported",
		message: `${highlightId}: Highlight does not support block narration.`,
	});
	expect(error.stderr).toContain(`${highlightId}: Highlight does not support block narration.`);
});
