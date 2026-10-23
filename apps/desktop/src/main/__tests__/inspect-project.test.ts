import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLesson } from "@praxity/grammar";
import { afterEach, describe, expect, it } from "vitest";
import { persistFixtureIdentity, readIdentityFixture } from "../../test-utils/identity-fixture";
import { narrationFixture } from "../../test-utils/narration-fixture";
import { runPraxityCli } from "../cli";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import {
	type CourseInspectionV1,
	projectDialogue,
	projectText,
} from "../export/inspect-project-v1";
import { assessmentEvidence, assetInspector } from "../export/inspection-evidence";

const tempDirs: string[] = [];
const runtime = { appVersion: "0.2.0", exportAssetsDir: "/studio/export-assets" };

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const LESSON =
	"---\ntitle: Before You Start\n---\n\n# Welcome {hideTitle}\n\n## Welcome\n\nRun this routine before starting work.\n\n![Checklist on a clipboard](/assets/checklist.png)\n\n# Check the exits {hideTitle}\n\n## Check the exits\n\nConfirm emergency exits are clear.\n";

describe("praxity inspect", () => {
	it("migrates a saved pre-Next Clear course without Inspect or export font warnings", async () => {
		const projectDir = await typedProject("---\ntitle: Clear lesson\n---\n# Read\n\nBody\n");
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Clear course\nlessons: [start.prax]\ndesign:\n  typography:\n    pairing: clear\n    fontDisplay: swap\n    code:\n      fontFamily: [monospace]\n    body:\n      fontFamily: [Atkinson Hyperlegible, sans-serif]\n      fontWeight: 400\n      fontStyle: normal\n    headings:\n      fontFamily: [Atkinson Hyperlegible, sans-serif]\n      fontWeight: 600\n      fontStyle: normal\n",
		);
		for (const schema of ["0", "1"]) {
			const result = await runPraxityCli(["inspect", projectDir, "--schema", schema], runtime);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout).warnings).toEqual([]);
		}
		await persistFixtureIdentity(projectDir);
		const versionPath = path.join(projectDir, "viewer-version.json");
		await writeFile(versionPath, JSON.stringify({ version: "clear-test" }));
		const exported = await buildCourseExportInput({
			projectDir,
			completionThreshold: 0,
			viewerVersionPath: versionPath,
		});
		expect(exported.designWarnings).toEqual([]);
	});
	it.each(["0", "1"])(
		"reports untitled lessons through author diagnostics in schema %s",
		async (schema) => {
			const projectDir = await typedProject("# Read\n\nBody\n");
			for (const [locale, message, hint] of [
				["en", "Lesson has no title", "Add title: to the lesson frontmatter."],
				["fr", "La leçon n'a pas de titre", "Ajoutez title: aux métadonnées de la leçon."],
			]) {
				await writeFile(
					path.join(projectDir, "course.yaml"),
					`title: Course\nlocale: ${locale}\nlessons: [start.prax]\n`,
				);
				const result = await runPraxityCli(["inspect", projectDir, "--schema", schema], runtime);
				expect(result.exitCode, result.stderr).toBe(0);
				expect(JSON.parse(result.stdout).warnings).toContainEqual({
					code: "lesson-title",
					severity: "warning",
					file: "start.prax",
					message,
					hint,
				});
			}
		},
	);
	it.each(["0", "1"])(
		"refuses unsupported free-response descriptions with a source location in schema %s",
		async (schema) => {
			const projectDir = await typedProject(
				"# Reflection\n::: free-response Reflect.\n::: note\nDESCRIPTIONMARK\n:::\n:::\n",
			);
			const result = await runPraxityCli(["inspect", projectDir, "--schema", schema], runtime);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout)).toEqual({
				ok: false,
				error: { code: "project_invalid", message: "start.prax:3:1: grammar.v4.disallowed-child" },
			});
			expect(result.stdout).not.toContain("DESCRIPTIONMARK");
		},
	);

	it.each(["0", "1"])("reports each authored radius once through CLI schema %s", async (schema) => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-radius-warnings-"));
		tempDirs.push(projectDir);
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Corners\nlessons: [en.prax, fr.prax]\ndesign:\n  borderRadius: 3\n",
		);
		for (const locale of ["en", "fr"])
			await writeFile(
				path.join(projectDir, `${locale}.prax`),
				`---\ntitle: Lesson\nlang: ${locale}\ndesign:\n  borderRadius: 10\n---\n\n# Read\n\nRead your notes.\n`,
			);
		const result = await runPraxityCli(["inspect", projectDir, "--schema", schema], runtime);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(
			JSON.parse(result.stdout).warnings.map(
				({
					blockId,
					code,
					path,
					message,
				}: {
					blockId: string;
					code: string;
					path: string;
					message: string;
				}) => ({ blockId, code, path, message }),
			),
		).toEqual([
			{
				blockId: "course.yaml",
				code: "ignored-radius-setting",
				path: "design.borderRadius",
				message: "design.borderRadius is ignored. Courses use look v2 corner radii.",
			},
			{
				blockId: "en.prax",
				code: "ignored-radius-setting",
				path: "design.borderRadius",
				message: "design.borderRadius is ignored. Courses use look v2 corner radii.",
			},
			{
				blockId: "fr.prax",
				code: "ignored-radius-setting",
				path: "design.borderRadius",
				message:
					"design.borderRadius est ignoré. Les cours utilisent les rayons de coin du look v2.",
			},
		]);
	});
	it("omits inline classification metadata from opaque schema 0 data", async () => {
		const projectDir = await typedProject(
			"# Practice\n\n::: match Match\n- Hazard -> Control\n:::\n\n::: rating Confidence\n1. Low\n2. High\n:::\n",
		);
		const execution = await runPraxityCli(["inspect", projectDir], runtime);
		expect(execution.exitCode, execution.stderr).toBe(0);
		const result = JSON.parse(execution.stdout);
		const blocks = result.lessons[0].pages[0].blocks;
		expect(
			blocks.find((block: { type: string }) => block.type === "assessment").data.response.pairs[0],
		).toMatchObject({ prompt: "Hazard", correctMatch: "Control" });
		expect(blocks.find((block: { type: string }) => block.type === "rating").data.label).toBe(
			"Confidence",
		);
		expect(execution.stdout).not.toContain("_htmlFields");
	});
	it.each(["0", "1"])(
		"reports each course font setting once across lesson languages in schema %s",
		async (schema) => {
			const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-font-warnings-"));
			tempDirs.push(projectDir);
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Fonts\nlessons: [en.prax, fr.prax]\ndesign:\n  typography:\n    body:\n      fontFamily: [Poppins, sans-serif]\n",
			);
			for (const locale of ["en", "fr"])
				await writeFile(
					path.join(projectDir, `${locale}.prax`),
					`---\ntitle: Lesson\nlang: ${locale}\ndesign:\n  typography:\n    headings:\n      fontFamily: [Inter]\n---\n\n# Read\n\n## Read\n\nRead your notes.\n`,
				);
			const result = await runPraxityCli(["inspect", projectDir, "--schema", schema], runtime);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(
				JSON.parse(result.stdout).warnings.map(
					({ blockId, code, path }: { blockId: string; code: string; path: string }) => ({
						blockId,
						code,
						path,
					}),
				),
			).toEqual([
				{
					blockId: "course.yaml",
					code: "ignored-font-setting",
					path: "design.typography.body.fontFamily",
				},
				{
					blockId: "en.prax",
					code: "ignored-font-setting",
					path: "design.typography.headings.fontFamily",
				},
				{
					blockId: "fr.prax",
					code: "ignored-font-setting",
					path: "design.typography.headings.fontFamily",
				},
			]);
		},
	);
	it("keeps authored region shapes and coordinates in schema 0", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-inspect-"));
		tempDirs.push(projectDir);
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Safety\nlessons:\n  - start.prax\n",
		);
		await writeFile(
			path.join(projectDir, "start.prax"),
			"# Fixture {hideTitle}\n\n::: hotspot Locate the valve\n![Diagram](/assets/diagram.png)\n- Valve {shape=rect x=10 y=20 w=30 h=15 correct}\n:::\n",
		);
		const execution = await runPraxityCli(["inspect", projectDir], runtime);
		expect(execution.exitCode).toBe(0);
		const blocks = JSON.parse(execution.stdout).lessons[0].pages[0].blocks;
		expect(
			blocks
				.find((block: { type: string }) => block.type === "assessment")
				?.data.response.hotspots.map(
					(spot: { label: string; shape: string; coords: number[]; isCorrect: boolean }) => ({
						label: spot.label,
						shape: spot.shape,
						region: spot.coords,
						correct: spot.isCorrect,
					}),
				),
		).toEqual([{ label: "Valve", shape: "rect", region: [10, 20, 30, 15], correct: true }]);
	});
	it("prints lessons, pages and source lines without writing to the project", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-inspect-"));
		tempDirs.push(projectDir);
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Safety\nid: course-1\nlocale: en\nlessons:\n  - start.prax\n",
		);
		await writeFile(path.join(projectDir, "start.prax"), LESSON);
		const before = await readdir(projectDir);

		const execution = await runPraxityCli(["inspect", projectDir], runtime);

		expect(execution.exitCode).toBe(0);
		const result = JSON.parse(execution.stdout);
		expect(result).toMatchObject({
			ok: true,
			schema: "praxity-inspect/0",
			studioVersion: "0.2.0",
			course: { id: expect.stringMatching(/^rt-[0-9a-f]{32}$/), title: "Safety", locale: "en" },
		});
		const [lesson] = result.lessons;
		expect(lesson).toMatchObject({ file: "start.prax", title: "Before You Start" });
		expect(lesson.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(
			lesson.pages.map((page: { title: string; blocks: { type: string; line: number }[] }) => ({
				title: page.title,
				blocks: page.blocks.map(({ type, line }) => [type, line]),
			})),
		).toEqual([
			{
				title: "Welcome",
				blocks: [
					["heading", 7],
					["text", 9],
					["image", 11],
				],
			},
			{
				title: "Check the exits",
				blocks: [
					["heading", 15],
					["text", 17],
				],
			},
		]);
		expect(await readdir(projectDir)).toEqual(before);
	});

	it("reports a missing course manifest as an invalid project", async () => {
		const projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-inspect-"));
		tempDirs.push(projectDir);

		const execution = await runPraxityCli(["inspect", projectDir], runtime);

		expect(execution.exitCode).toBe(1);
		expect(JSON.parse(execution.stdout).error.code).toBe("project_invalid");
	});
});

const TYPED_LESSON =
	"---\ntitle: Café safety\n---\n\n# Évacuation 🧯 {hideTitle}\n\n## Évacuation 🧯\n\n::: cards Card\n:: Card {level=3}\nFront [PPE]{Personal protective equipment}.\n\n::: back\nBack café 🧯.\n\n::: choice Which exit? {level=5}\n(x) Clear exit\nfeedback: Bien joué.\n( ) Locked exit\nfeedback: Try again.\n:::\n:::\n:::\n\n![Exit sign](/assets/exit.png)\n";

async function typedProject(source = TYPED_LESSON) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "praxity-inspect-v1-"));
	tempDirs.push(dir);
	await writeFile(
		path.join(dir, "course.yaml"),
		"title: Safety\nlocale: fr\nlessons:\n  - start.prax\n",
	);
	await writeFile(path.join(dir, "start.prax"), source);
	return dir;
}

async function inspectV1(dir: string): Promise<CourseInspectionV1> {
	const execution = await runPraxityCli(["inspect", dir, "--schema", "1"], runtime);
	expect(execution.exitCode, execution.stderr).toBe(0);
	return JSON.parse(execution.stdout);
}

describe("praxity inspect schema 1", () => {
	it.each([
		{
			name: "authored English",
			manifest: "locale: en\n",
			lesson: "lang: en\n",
			expected: {
				locale: "en",
				course: { declared: "en", source: "manifest", workspaceContext: "unavailable" },
				lesson: { value: "en", source: "lesson" },
			},
		},
		{
			name: "missing locale defaults explicitly",
			manifest: "",
			lesson: "",
			expected: {
				locale: "en",
				course: { declared: null, source: "default", workspaceContext: "unavailable" },
				lesson: { value: "en", source: "default" },
			},
		},
		{
			name: "French course",
			manifest: "locale: fr\n",
			lesson: "",
			expected: {
				locale: "fr",
				course: { declared: "fr", source: "manifest", workspaceContext: "unavailable" },
				lesson: { value: "fr", source: "course" },
			},
		},
		{
			name: "French lesson overrides English course",
			manifest: "locale: en\n",
			lesson: "lang: fr\n",
			expected: {
				locale: "en",
				course: { declared: "en", source: "manifest", workspaceContext: "unavailable" },
				lesson: { value: "fr", source: "lesson" },
			},
		},
		{
			name: "lesson inherits authored English",
			manifest: "locale: en\n",
			lesson: "",
			expected: {
				locale: "en",
				course: { declared: "en", source: "manifest", workspaceContext: "unavailable" },
				lesson: { value: "en", source: "course" },
			},
		},
		{
			name: "lesson declaration without a course locale",
			manifest: "",
			lesson: "lang: fr\n",
			expected: {
				locale: "en",
				course: { declared: null, source: "default", workspaceContext: "unavailable" },
				lesson: { value: "fr", source: "lesson" },
			},
		},
	])("reports language provenance for $name", async ({ manifest, lesson, expected }) => {
		const dir = await typedProject(`---\ntitle: Lesson\n${lesson}---\n# Read\n\nBody.\n`);
		await writeFile(
			path.join(dir, "course.yaml"),
			`title: Course\n${manifest}lessons: [start.prax]\n`,
		);
		const result = await inspectV1(dir);
		expect(result.projectionVersion).toBe(2);
		expect({
			locale: result.course.locale,
			course: result.course.language,
			lesson: result.lessons[0].language,
		}).toEqual(expected);
	});

	it("reports unavailable workspace context even inside a configured workspace", async () => {
		const workspace = await mkdtemp(path.join(os.tmpdir(), "praxity-inspect-workspace-"));
		tempDirs.push(workspace);
		const dir = path.join(workspace, "course");
		await mkdir(dir);
		await writeFile(path.join(workspace, "workspace.praxity.yaml"), "defaultLocale: fr\n");
		await writeFile(path.join(dir, "course.yaml"), "title: Course\nlessons: [start.prax]\n");
		await writeFile(path.join(dir, "start.prax"), "# Read\n\nBody.\n");
		const result = await inspectV1(dir);
		expect(result.course.language).toEqual({
			declared: null,
			source: "default",
			workspaceContext: "unavailable",
		});
		expect(result.lessons[0].language).toEqual({ value: "en", source: "default" });
	});

	it("binds language declarations to the inspection revision and each lesson", async () => {
		const source = "---\ntitle: First\n---\n# Read\n\nBody.\n";
		const dir = await typedProject(source);
		await writeFile(path.join(dir, "other.prax"), "# Other\n\nMore.\n");
		const manifest = "title: Course\nlessons: [start.prax, other.prax]\n";
		await writeFile(path.join(dir, "course.yaml"), manifest);
		const defaulted = await inspectV1(dir);
		await writeFile(path.join(dir, "course.yaml"), `${manifest}locale: en\n`);
		const declared = await inspectV1(dir);
		expect(declared.course.locale).toBe(defaulted.course.locale);
		expect(declared.course.language).toEqual({
			declared: "en",
			source: "manifest",
			workspaceContext: "unavailable",
		});
		expect(declared.revision).not.toBe(defaulted.revision);
		expect(declared.lessons.map(({ sha256 }) => sha256)).toEqual(
			defaulted.lessons.map(({ sha256 }) => sha256),
		);
		await writeFile(
			path.join(dir, "start.prax"),
			source.replace("title: First", "title: First\nlang: fr"),
		);
		const overridden = await inspectV1(dir);
		expect(overridden.revision).not.toBe(declared.revision);
		expect(overridden.lessons[0].sha256).not.toBe(declared.lessons[0].sha256);
		expect(overridden.lessons[1].sha256).toBe(declared.lessons[1].sha256);
		expect(overridden.lessons.map(({ file, language }) => ({ file, language }))).toEqual([
			{ file: "start.prax", language: { value: "fr", source: "lesson" } },
			{ file: "other.prax", language: { value: "en", source: "course" } },
		]);
	});

	it("reports invalid cast entries in both inspect schemas", async () => {
		const dir = await typedProject(
			"---\n{ cast: { good: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- good: Hi\n:::\n",
		);
		await writeFile(
			path.join(dir, "course.yaml"),
			"title: Safety\nlessons: [start.prax]\ncast:\n  good:\n    name: Good\n  nameless:\n    avatar: assets/missing.png\n",
		);
		const schema1 = await inspectV1(dir);
		expect(schema1.warnings).toContainEqual({
			blockId: "course.yaml",
			message: expect.stringContaining("nameless"),
		});
		const schema0 = await runPraxityCli(["inspect", dir], runtime);
		expect(schema0.exitCode).toBe(0);
		expect(JSON.parse(schema0.stdout).warnings).toContainEqual({
			blockId: "course.yaml",
			message: expect.stringContaining("nameless"),
		});
	});
	it("projects dialogue turns, resolved speakers, source lines, and warnings", async () => {
		const dir = await typedProject(
			"---\n{ cast: { roger: {}, zed: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue {style=script}\n- roger: Hi\n- zed: Hey\n:::\n",
		);
		await writeFile(
			path.join(dir, "course.yaml"),
			"title: Safety\nlessons:\n  - start.prax\ncast:\n  roger:\n    name: Roger\n    avatar: assets/roger.png\n    side: end\n",
		);
		const result = await inspectV1(dir);
		const dialogue = result.lessons[0].pages[0].blocks.find((block) => block.type === "dialogue");
		expect(dialogue).toMatchObject({
			coverage: "text",
			style: "script",
			speakers: [
				{ key: "roger", name: "Roger", avatar: true, voice: false },
				{ key: "zed", name: "zed", avatar: false, voice: false },
			],
			turns: [
				{ speaker: "roger", text: "Hi", line: 8 },
				{ speaker: "zed", text: "Hey", line: 9 },
			],
		});
		expect(dialogue?.texts.map((text) => text.value)).toEqual(["Hi", "Hey"]);
		expect(dialogue?.speakers?.[0].side).toBe("end");
		expect(dialogue?.turns?.[0].side).toBe("end");
		expect(result.warnings).toContainEqual({
			blockId: dialogue?.id,
			message: `Unknown speaker "zed" in dialogue ${dialogue?.id}`,
		});
		const schema0 = await runPraxityCli(["inspect", dir], runtime);
		expect(schema0.exitCode).toBe(0);
		const block = JSON.parse(schema0.stdout).lessons[0].pages[0].blocks[0];
		expect(block.type).toBe("dialogue");
		expect(block.data.turns).toHaveLength(2);
		expect(block.data.turns[0].side).toBe("end");
		expect(JSON.parse(schema0.stdout).warnings).toContainEqual({
			blockId: block.id,
			message: `Unknown speaker "zed" in dialogue ${block.id}`,
		});
	});

	it("localizes unknown dialogue speakers in both inspect schemas for a French course", async () => {
		const dir = await typedProject(
			"---\n{ cast: { zed: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- zed: Salut\n:::\n",
		);
		const result = await inspectV1(dir);
		const dialogue = result.lessons[0].pages[0].blocks.find((block) => block.type === "dialogue");
		expect(result.warnings).toContainEqual({
			blockId: dialogue?.id,
			message: `Interlocuteur inconnu « zed » dans le dialogue ${dialogue?.id}`,
		});
		const schema0 = await runPraxityCli(["inspect", dir], runtime);
		expect(schema0.exitCode).toBe(0);
		const block = JSON.parse(schema0.stdout).lessons[0].pages[0].blocks[0];
		expect(JSON.parse(schema0.stdout).warnings).toContainEqual({
			blockId: block.id,
			message: `Interlocuteur inconnu « zed » dans le dialogue ${block.id}`,
		});
	});

	it("keeps unattributed dialogue turns and maps lines after multiline turns", async () => {
		const source =
			"---\ntitle: Dialogue\n---\n\n# Scene {hideTitle}\n\n::: dialogue\n- roger: First\n\n  Second.\n- anonymous: Just words\n- ROGER: Again\n:::\n";
		const read = readLesson(source);
		expect(read.hasErrors).toBe(false);
		const block = read.blocks.find((block) => block.type === "dialogue");
		if (!block) throw new Error("Missing dialogue fixture");
		// The renderer model still accepts unattributed legacy turns until X1d.
		const turns = block.data.turns as Array<Record<string, unknown>>;
		delete turns[1].speaker;
		const dialogue = projectDialogue(
			block,
			{ file: "start.prax", startLine: 7, endLine: 13 },
			source,
		);

		expect(dialogue?.turns).toEqual([
			{ speaker: "roger", text: "First\n\nSecond.", line: 8 },
			{ text: "Just words", line: 11 },
			{ speaker: "ROGER", text: "Again", line: 12 },
		]);
		expect(dialogue?.speakers).toEqual([
			{ key: "roger", name: "roger", avatar: false, voice: false },
		]);
	});

	it.each([
		[":: Hazard Identification {level=3}\nBody.", ["Safety Concepts", "Hazard Identification"]],
		["Body.", ["Safety Concepts"]],
		[
			":: Safety Concepts {level=3}\nBody.\n\n:: Other {level=3}\nMore.",
			["Safety Concepts", "Safety Concepts", "Other"],
		],
	])(
		"preserves card group headings and suppresses only a duplicate sole-item title (%s)",
		async (body, headings) => {
			const dir = await typedProject(
				`# Fixture {hideTitle}\n\n::: cards Safety Concepts\n${body === "Body." ? ":: Safety Concepts\n" : ""}${body}\n:::\n`,
			);
			const result = await inspectV1(dir);
			const card = result.lessons[0].pages[0].blocks.find((block) => block.type === "card");
			expect(
				card?.texts.filter((text) => text.role === "heading").map((text) => text.value),
			).toEqual(headings);
		},
	);

	it.each(["\n", "\r\n"])(
		"projects nested text and choice roles against original Unicode and legacy-ID source lines (%j)",
		async (newline) => {
			const source = TYPED_LESSON.replaceAll("\n", newline);
			const dir = await typedProject(source);
			const result = await inspectV1(dir);
			expect(result.schema).toBe("praxity-inspect/1");
			const [lesson] = result.lessons;
			expect(lesson.sha256).toBe(createHash("sha256").update(Buffer.from(source)).digest("hex"));
			expect(await readFile(path.join(dir, "start.prax"), "utf8")).toBe(source);
			const blocks = lesson.pages.flatMap((page) => page.blocks);
			const texts = blocks.flatMap((block) => block.texts);
			const front = blocks.find((block) =>
				block.texts.some((text) => text.value.includes("Front")),
			);
			const back = blocks.find((block) =>
				block.texts.some((text) => text.value.includes("Back café")),
			);
			expect(front?.parentRef).toBe(blocks.find((block) => block.type === "card")?.ref);
			expect(back?.parentRef).toBe(front?.parentRef);
			for (const [block, authored] of [
				[front, "Front [PPE]"],
				[back, "Back café"],
			] as const) {
				expect(block?.location?.startLine).toBe(
					TYPED_LESSON.split("\n").findIndex((line) => line.startsWith(authored)) + 1,
				);
				expect(block?.location?.endLine).toBeGreaterThanOrEqual(block?.location?.startLine ?? 0);
			}
			expect(texts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						role: "heading",
						value: "<p>Évacuation 🧯</p>",
						format: "html",
						location: { file: "start.prax", startLine: 7, endLine: 7 },
					}),
					expect.objectContaining({
						role: "prompt",
						value: expect.stringContaining("Which exit?"),
						format: "html",
					}),
					expect.objectContaining({ role: "option", value: "Clear exit", format: "markdown" }),
					expect.objectContaining({ role: "feedback", value: "Bien joué.", format: "markdown" }),
					expect.objectContaining({
						role: "glossary-definition",
						value: "Personal protective equipment",
						format: "html",
					}),
				]),
			);
			const assessment = blocks.find((block) => block.type === "assessment");
			expect(assessment?.parentRef).toBe(front?.parentRef);
			expect(assessment?.location?.startLine).toBe(
				TYPED_LESSON.split("\n").indexOf("::: choice Which exit? {level=5}") + 1,
			);
			expect(assessment?.id).toMatch(/^rt-[0-9a-f]{32}$/);
			expect(blocks.find((block) => block.type === "image")?.coverage).toBe("text");
			expect(new Set(texts.map((text) => text.ref)).size).toBe(texts.length);
		},
	);

	it("keeps snapshots deterministic without persisted IDs and does not write any project files", async () => {
		const source =
			"# Welcome {hideTitle}\n\n## Welcome\n\n::: choice Ready?\n(x) Yes\n( ) No\n:::\n";
		const a = await typedProject(source);
		const b = await typedProject(source);
		const manifest = await readFile(path.join(a, "course.yaml"), "utf8");
		const first = await inspectV1(a);
		const second = await inspectV1(b);
		expect(first.revision).toBe(second.revision);
		expect(first.course.id).toMatch(/^rt-[0-9a-f]{32}$/);
		expect(first.lessons[0].pages[0].id).not.toBe(second.lessons[0].pages[0].id);
		expect(first.lessons[0].pages[0].blocks.map((block) => block.ref)).toEqual(
			second.lessons[0].pages[0].blocks.map((block) => block.ref),
		);
		expect(await readdir(a)).toEqual(["course.yaml", "start.prax"]);
		expect(await readFile(path.join(a, "course.yaml"), "utf8")).toBe(manifest);
		expect(await readFile(path.join(a, "start.prax"), "utf8")).toBe(source);
		await runPraxityCli(["inspect", a], runtime);
		expect(await readFile(path.join(a, "course.yaml"), "utf8")).toBe(manifest);
	});

	it("hashes sidecar and manifest changes separately from the lesson and preserves identity sidecars", async () => {
		const dir = await typedProject("# Welcome {hideTitle}\n\n## Welcome\n\nBody.\n");
		await persistFixtureIdentity(dir);
		const identity = await readIdentityFixture(dir);
		const fixture = await narrationFixture(dir, "start.prax");
		const title = fixture.items.find((item) => item.segment.target.role === "title");
		if (!title) throw new Error("Missing page title narration");
		const before = await inspectV1(dir);
		expect(before.lessons[0].pages[0].id).toBe(identity.pageIds["start.prax"][0]);
		const narration = `version: 2
courseId: ${fixture.read.courseId}
lessons:
  ${fixture.read.lessonId}:
    enabled: true
    segments:
      - target:
          id: ${title.segment.target.id}
          role: title
        script: |
          **Bonjour** narration.
          - Listen carefully.
`;
		await writeFile(path.join(dir, "narration.yaml"), narration);
		const narrated = await inspectV1(dir);
		expect(narrated.revision).not.toBe(before.revision);
		expect(narrated.lessons[0].sha256).toBe(before.lessons[0].sha256);
		expect(narrated.lessons[0].narration).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "narration",
					value: "Bonjour narration.\n\nListen carefully.",
					origin: "sidecar",
					location: { file: "narration.yaml", startLine: 7, endLine: 12 },
				}),
			]),
		);
		await writeFile(
			path.join(dir, "course.yaml"),
			"title: Updated title\nlocale: fr\nlessons:\n  - start.prax\n",
		);
		const renamed = await inspectV1(dir);
		expect(renamed.revision).not.toBe(narrated.revision);
		expect(renamed.lessons[0].sha256).toBe(before.lessons[0].sha256);
		expect((await readIdentityFixture(dir)).files).toEqual(identity.files);
		expect(await readFile(path.join(dir, "narration.yaml"), "utf8")).toBe(narration);
	});

	it.each([
		["--schema", "2"],
		["--schema"],
		["--schema", "01"],
		["--schema", "1", "--schema", "1"],
		["--schema=1"],
	])("rejects unsupported or malformed schema arguments: $0 $1 $2 $3", async (...options) => {
		const execution = await runPraxityCli(["inspect", "/unused", ...options], runtime);
		expect(execution.exitCode).toBe(2);
		expect(JSON.parse(execution.stdout).error.code).toBe("invalid_arguments");
	});
});

describe("expanded schema 1 evidence", () => {
	it.each([
		{ settings: "scored shuffle", shuffle: true, scored: true },
		{ settings: "scored shuffle=false", shuffle: false, scored: true },
		{ settings: "scored", shuffle: false, scored: true },
		{ settings: "shuffle", shuffle: true, scored: false },
	])(
		"reports choice shuffle through inspect JSON: $settings",
		async ({ settings, shuffle, scored }) => {
			const dir = await typedProject(
				`# Check\n::: choice Choose {${settings}}\n(x) First\n( ) Second\n:::\n`,
			);
			const result = await inspectV1(dir);
			expect(result.schema).toBe("praxity-inspect/1");
			expect(result.projectionVersion).toBe(2);
			const assessment = result.lessons[0].pages
				.flatMap((page) => page.blocks)
				.find((block) => block.assessment)?.assessment;
			expect(assessment).toMatchObject({
				responseType: "choice",
				correctness: "keyed",
				shuffle,
				scoring: { scored },
				options: [
					{ label: "First", correct: true },
					{ label: "Second", correct: false },
				],
			});
		},
	);

	it.each([
		{ course: false, question: false },
		{ course: false, question: true },
		{ course: true, question: false },
		{ course: true, question: true },
	])(
		"reports question shuffle over course default: $course / $question",
		async ({ course, question }) => {
			const dir = await typedProject(
				`# Check\n::: choice Choose {shuffle=${question}}\n(x) First\n( ) Second\n:::\n`,
			);
			await writeFile(
				path.join(dir, "course.yaml"),
				`title: Defaults\nlessons: [start.prax]\ndesign:\n  componentDefaults:\n    choose-one:\n      scored: true\n      shuffle: ${course}\n`,
			);
			const result = await inspectV1(dir);
			expect(
				result.lessons[0].pages.flatMap((page) => page.blocks).find((block) => block.assessment)
					?.assessment,
			).toMatchObject({
				responseType: "choice",
				shuffle: question,
				scoring: { scored: true },
			});
		},
	);

	it.each([
		{ course: false, lesson: true, question: "", expected: true },
		{ course: true, lesson: false, question: "", expected: false },
		{ course: true, lesson: true, question: "shuffle=false", expected: false },
		{ course: false, lesson: false, question: "shuffle=true", expected: true },
	])(
		"resolves lesson choice defaults: $course / $lesson / $question",
		async ({ course, lesson, question, expected }) => {
			const dir = await typedProject(
				`---\ndesign:\n  componentDefaults:\n    choose-one:\n      shuffle: ${lesson}\n---\n# Check\n::: choice Choose {scored ${question}}\n(x) First\n( ) Second\n:::\n`,
			);
			await writeFile(
				path.join(dir, "course.yaml"),
				`title: Defaults\nlessons: [start.prax]\ndesign:\n  componentDefaults:\n    choose-one:\n      scored: true\n      shuffle: ${course}\n`,
			);
			const result = await inspectV1(dir);
			expect(
				result.lessons[0].pages.flatMap((page) => page.blocks).find((block) => block.assessment)
					?.assessment,
			).toMatchObject({ responseType: "choice", shuffle: expected, scoring: { scored: true } });
		},
	);

	it("projects response families and scoring without counting answer keys or feedback as visible prose", async () => {
		const dir = await typedProject(
			'# Checkpoint {hideTitle}\n\n::: group Checkpoint {mode=oneOf passingScore=80 requireAll}\n::: choice Choose {scored points=3}\n[x] First\n[ ] Second\nfeedback: Response feedback only.\n:::\n::: match Match\n- Left -> Right\n- Other -> Alternative\n:::\n::: order Order\n1. Start\n2. Finish\n:::\n::: categorize Sort\n:: Tools\n- Hammer\n:: Clothes\n- Coat\n:::\n::: fill-blank Blank {scored}\nSecret {answerkey} then ____.\n:::\n::: fill-blank Open blank {scored}\nWrite ____.\n:::\n::: fill-blank Dropdown {style=dropdown}\nSelect {red|*blue}.\n:::\n::: fill-blank Bank {style=word-bank}\nChoose {blue}.\nbank: red | blue | blue\n:::\n::: free-response Reflect {scored}\nThink carefully.\n:::\n::: matrix Survey\n1. Low\n2. High\n- Confidence\n:::\n:::\n\n::: hotspot Find the pin\n![Map](/assets/map.png)\n- Pin {shape=rect x=10 y=20 w=30 h=15 correct}\n- Other {shape=polygon points="30 40, 50 40, 50 60"}\n:::\n',
		);
		const result = await inspectV1(dir);
		expect(result.projectionVersion).toBe(2);
		const blocks = result.lessons[0].pages.flatMap((p) => p.blocks);
		const assessments = blocks.flatMap((b) => (b.assessment ? [b.assessment] : []));
		expect(assessments.map((a) => a.responseType)).toEqual([
			"choice",
			"matching",
			"sequence",
			"categorize",
			"fillBlank",
			"fillBlank",
			"fillBlank",
			"fillBlank",
			"textResponse",
			"matrix",
			"hotspot",
		]);
		expect(assessments[0]).toMatchObject({
			correctness: "keyed",
			selectionMode: "multiple",
			scoring: { scored: true, points: 3, gradingMode: "exact" },
			options: [{ correct: true }, { correct: false }],
		});
		expect(assessments[1].pairs?.[0]).toMatchObject({ prompt: "Left", correctMatch: "Right" });
		expect(assessments.slice(1).every((assessment) => !("shuffle" in assessment))).toBe(true);
		expect(assessments[2].items?.map((i) => i.correctPosition)).toEqual([0, 1]);
		expect(assessments[3].categories?.[0]).toMatchObject({ label: "Tools", items: ["Hammer"] });
		expect(assessments[4].blanks?.map((b) => b.answers)).toEqual([["answerkey"], []]);
		expect(assessments[5]).toMatchObject({
			correctness: "open",
			scoring: { gradingMode: "exact", scored: false },
		});
		expect(assessments[6]).toMatchObject({
			blankStyle: "dropdown",
			blanks: [{ answers: ["blue"], choices: ["red", "blue"] }],
		});
		expect(assessments[7].wordBank).toEqual(["red", "blue", "blue"]);
		expect(assessments[8]).toMatchObject({ correctness: "open", scoring: { scored: false } });
		expect(assessments[9].correctness).toBe("open");
		expect(assessments[10].hotspots?.[0]).toMatchObject({
			correct: true,
			shape: "rect",
			coordinates: [10, 20, 30, 15],
		});
		expect(assessments[10].hotspots?.[1]).toMatchObject({
			shape: "polygon",
			coordinates: [30, 40, 50, 40, 50, 60],
		});
		const group = blocks.find((b) => b.assessmentGroup)?.assessmentGroup;
		expect(group).toMatchObject({
			mode: "oneOf",
			passingScore: 80,
			requireAll: true,
			unresolvedMemberCount: 0,
		});
		expect(group?.memberRefs).toHaveLength(10);
		const visible = blocks
			.flatMap((b) => b.texts)
			.filter((t) => ["heading", "body", "prompt", "option"].includes(t.role))
			.map((t) => t.value)
			.join(" ");
		expect(visible).not.toContain("answerkey");
		expect(visible).not.toContain("Response feedback only");
		expect(visible).toContain("Secret ____ then ____.");
	});

	it("fingerprints referenced media and preserves sidecar locations, provenance and unresolved links", async () => {
		const dir = await typedProject(
			"# Welcome {hideTitle}\n\n## Welcome\n\n::: figure\n![A diagram](/assets/photo.png)\nVisible caption\n:::\n\n::: audio /assets/sound.mp3\ntranscript: Spoken transcript.\n:::\n\n::: video https://example.com/movie.mp4 {captions=/assets/captions.vtt}\n:::\n\n![Missing](/assets/missing.png)\n\n![Blocked symlink](/assets/escape.png)\n",
		);
		await mkdir(path.join(dir, "assets"));
		await writeFile(path.join(dir, "assets/photo.png"), "first image");
		await writeFile(path.join(dir, "assets/sound.mp3"), "audio");
		await writeFile(path.join(dir, "assets/captions.vtt"), "WEBVTT\n");
		await symlink(
			path.join(dir, "../outside-inspection-file"),
			path.join(dir, "assets/escape.png"),
		);
		const fixture = await narrationFixture(dir, "start.prax");
		const title = fixture.items.find((item) => item.segment.target.role === "title");
		if (!title) throw new Error("Missing page title narration");
		await writeFile(
			path.join(dir, "narration.yaml"),
			`version: 2
courseId: ${fixture.read.courseId}
lessons:
  ${fixture.read.lessonId}:
    segments:
      - target:
          id: ${title.segment.target.id}
          role: title
        script: Recorded words.
        audio: /assets/sound.mp3
        duration: 2.4
        audioFor:
          script: Recorded words.
          language: en
          voice: Maya
          speed: 1
      - target:
          id: 11111111-1111-4111-8111-111111111111
          role: body
        script: Unlinked words.
        audio: /assets/missing.mp3
`,
		);

		const before = await inspectV1(dir);
		const media = before.lessons[0].pages.flatMap((p) => p.blocks).flatMap((b) => b.media ?? []);
		expect(media.find((m) => m.source?.uri === "/assets/photo.png")).toMatchObject({
			alt: "A diagram",
			source: { availability: "present", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
		});
		expect(media.find((m) => m.kind === "audio")?.transcript).toEqual({
			value: "Spoken transcript.",
			format: "plain",
		});
		expect(media.find((m) => m.kind === "video")).toMatchObject({
			source: { availability: "remote" },
			captionTracks: [{ source: { availability: "present" } }],
		});
		expect(media.find((m) => m.source?.uri === "/assets/missing.png")?.source?.availability).toBe(
			"missing",
		);
		const narration = before.lessons[0].narration.find((n) => n.origin === "sidecar");
		expect(narration).toMatchObject({
			location: { file: "narration.yaml", startLine: 6, endLine: 16 },
			audio: { availability: "present" },
			duration: {
				seconds: 2.4,
				provenance: "sidecar-recorded",
				measurement: "unknown",
				isFullFileDuration: false,
			},
		});
		expect(before.lessons[0].unlinkedNarration[0]).toMatchObject({
			blockRef: null,
			pageRef: null,
			value: "Unlinked words.",
			unresolvedTarget: { id: "11111111-1111-4111-8111-111111111111", role: "body" },
			location: { file: "narration.yaml", startLine: 17, endLine: 21 },
			audio: { availability: "missing" },
			duration: null,
		});
		await writeFile(path.join(dir, "assets/photo.png"), "second image");
		const after = await inspectV1(dir);
		expect(after.lessons[0].sha256).toBe(before.lessons[0].sha256);
		expect(after.revision).not.toBe(before.revision);
		expect((await inspectV1(dir)).revision).toBe(after.revision);
		await writeFile(path.join(dir, "assets/missing.png"), "now present");
		expect((await inspectV1(dir)).revision).not.toBe(after.revision);
	});
});

it("projects supported field families with declared formats and excludes metadata/descendants", () => {
	const cases: Array<
		[Parameters<typeof projectText>[0]["type"], Record<string, unknown>, string[]]
	> = [
		["note", { title: "Note", content: "<p>Body</p>" }, ["Note", "<p>Body</p>"]],
		[
			"quote",
			{ text: "<p>Quote</p>", speaker: "Speaker", work: "Work", sourceUrl: "secret-url" },
			["<p>Quote</p>", "Speaker", "Work"],
		],
		[
			"table",
			{
				rows: [
					["A", "B"],
					["C", "D"],
				],
			},
			["A", "B", "C", "D"],
		],
		["stats", { items: [{ id: "secret-id", value: "42", label: "People" }] }, ["42", "People"]],
		["checklist", { title: "Check", items: [{ text: "Confirm" }] }, ["Check", "Confirm"]],
		["rating", { label: "Rate", scale: [{ value: 1, label: "Low" }] }, ["Rate", "Low"]],
		["signature", { label: "Sign", sublabel: "Your name" }, ["Sign", "Your name"]],
		["code", { title: "Code", code: "a < b [term]{literal}" }, ["Code", "a < b [term]{literal}"]],
		["equation", { latex: "x=1" }, ["x=1"]],
		["button", { text: "Continue", href: "secret-url" }, ["Continue"]],
		["divider", { label: "Break" }, ["Break"]],
		[
			"selfCheck",
			{
				content: {
					task: "Explain <the> delay",
					model: "Hidden model",
					parts: [{ id: "c", label: "Hidden label", missed: "Hidden hint", evidence: null }],
				},
			},
			["Explain <the> delay"],
		],
		[
			"video",
			{ title: "Watch", caption: "Caption", transcript: "Not visible prose", src: "secret-url" },
			["Watch", "Caption"],
		],
		...["columns", "accordion", "tabs", "sequence"].map(
			(type) =>
				[
					type,
					{
						items: [
							{
								label: "Section",
								children: [{ id: "child", type: "text", data: { content: "Count at child only" } }],
							},
						],
					},
					["Section"],
				] as [Parameters<typeof projectText>[0]["type"], Record<string, unknown>, string[]],
		),
	];
	for (const [type, data, expected] of cases) {
		const projected = projectText({ id: "b", type, data }, "block/0", null);
		expect(projected.coverage, type).not.toBe("unsupported");
		expect(
			projected.texts.map((t) => t.value),
			type,
		).toEqual(expected);
		expect(projected.texts.every((t) => ["plain", "html", "markdown"].includes(t.format))).toBe(
			true,
		);
	}
	expect(
		projectText(
			{ id: "b", type: "assessment", data: { assessmentType: "future" } },
			"block/0",
			null,
		).coverage,
	).toBe("unsupported");
});

it("confines asset evidence and applies course assessment defaults", async () => {
	const dir = await typedProject(
		"# Untitled {hideTitle}\n\n::: choice Choice {level=3}\n(x) Yes\n( ) No\n:::\n",
	);
	const outside = await typedProject("Outside");
	await symlink(path.join(outside, "start.prax"), path.join(dir, "escape.txt"));
	const inspector = assetInspector(dir);
	for (const uri of ["../outside", "/escape.txt", "file:///etc/passwd", "assets\\escape.txt"]) {
		expect(await inspector.read(uri)).toMatchObject({ availability: "blocked", sha256: null });
	}
	await writeFile(
		path.join(dir, "course.yaml"),
		"title: Defaults\nlessons:\n  - start.prax\ndesign:\n  componentDefaults:\n    choose-one:\n      scored: true\n      points: 7\n",
	);
	const result = await inspectV1(dir);
	expect(
		result.lessons[0].pages[0].blocks.find((b) => b.assessment)?.assessment?.scoring,
	).toMatchObject({ gradingMode: "exact", scored: true, points: 7 });
});

it("distinguishes typed wildcard rules from escaped and selectable literal answers", () => {
	const typed = assessmentEvidence(
		{
			response: {
				type: "fillBlank",
				blanks: [
					{ answer: "~literal", answerSources: [String.raw`\~literal`] },
					{ answer: "~a*", answerSources: [String.raw`~a\*`] },
					{ answer: "~a*" },
				],
			},
		},
		"block/0",
	);
	expect(typed.blanks?.flatMap((b) => b.answerRules)).toEqual([
		{ value: "~literal", match: "literal", pattern: null },
		{ value: "~a*", match: "wildcard", pattern: String.raw`a\*` },
		{ value: "~a*", match: "wildcard", pattern: "a*" },
	]);
	const dropdown = assessmentEvidence(
		{
			response: {
				type: "fillBlank",
				style: "dropdown",
				blanks: [{ answer: "~a*", choices: ["~a*", "other"] }],
			},
		},
		"block/0",
	);
	expect(dropdown.blanks?.[0].answerRules).toEqual([
		{ value: "~a*", match: "literal", pattern: null },
	]);
});

it("applies course and lesson group defaults to evidence and projected action labels", async () => {
	const body =
		"# Group {hideTitle}\n\n::: group Group\n::: choice Choice\n(x) Yes\n( ) No\n:::\n:::\n";
	const dir = await typedProject(body);
	await writeFile(
		path.join(dir, "course.yaml"),
		`title: Defaults
lessons:
  - start.prax
design:
  componentDefaults:
    assessment-group:
      requireAll: true
      passingScore: 80
      buttonLabel: Course submit
`,
	);
	const courseResult = await inspectV1(dir);
	const courseGroup = courseResult.lessons[0].pages
		.flatMap((page) => page.blocks)
		.find((block) => block.assessmentGroup);
	expect(courseGroup?.assessmentGroup).toMatchObject({ requireAll: true, passingScore: 80 });
	expect(courseGroup?.texts).toContainEqual(
		expect.objectContaining({ role: "option", value: "Course submit" }),
	);

	await writeFile(
		path.join(dir, "start.prax"),
		`---
design:
  componentDefaults:
    assessment-group:
      requireAll: false
      passingScore: 60
      buttonLabel: Lesson submit
---
${body}`,
	);
	const lessonResult = await inspectV1(dir);
	const lessonGroup = lessonResult.lessons[0].pages
		.flatMap((page) => page.blocks)
		.find((block) => block.assessmentGroup);
	expect(lessonGroup?.assessmentGroup).toMatchObject({ requireAll: false, passingScore: 60 });
	expect(lessonGroup?.texts).toContainEqual(
		expect.objectContaining({ role: "option", value: "Lesson submit" }),
	);
	expect(lessonResult.revision).not.toBe(courseResult.revision);

	await writeFile(
		path.join(dir, "start.prax"),
		body.replace(
			"::: group Group",
			"::: group Group {requireAll=false passingScore=40}\nbutton: Authored submit",
		),
	);
	const authoredResult = await inspectV1(dir);
	const authoredGroup = authoredResult.lessons[0].pages
		.flatMap((page) => page.blocks)
		.find((block) => block.assessmentGroup);
	expect(authoredGroup?.assessmentGroup).toMatchObject({ requireAll: false, passingScore: 40 });
	expect(authoredGroup?.texts).toContainEqual(
		expect.objectContaining({ role: "option", value: "Authored submit" }),
	);
});

it("keeps narration sidecar locations aligned across aliased anchors", async () => {
	const dir = await typedProject("# Welcome {hideTitle}\n\n## Welcome\n");
	const fixture = await narrationFixture(dir, "start.prax");
	const title = fixture.items.find((item) => item.segment.target.role === "title");
	if (!title) throw new Error("Missing title narration");
	await writeFile(
		path.join(dir, "narration.yaml"),
		`version: 2
courseId: ${fixture.read.courseId}
lessons:
  ${fixture.read.lessonId}:
    segments:
      - target:
          id: &a ${title.segment.target.id}
          role: title
        script: First script.
      - target:
          id: *a
          role: body
        script: Aliased script.
      - target:
          id: 11111111-1111-4111-8111-111111111111
          role: body
        script: Later script.
`,
	);

	const lesson = (await inspectV1(dir)).lessons[0];
	const scripts = [...lesson.narration, ...lesson.unlinkedNarration];
	for (const [value, startLine, endLine] of [
		["First script.", 6, 9],
		["Aliased script.", 10, 13],
		["Later script.", 14, 17],
	] as const) {
		expect(scripts.find((item) => item.value === value)?.location).toEqual({
			file: "narration.yaml",
			startLine,
			endLine,
		});
	}
});

it("hashes encoded local filenames and blocks decoded traversal and malformed paths", async () => {
	const dir = await typedProject(
		"# Untitled {hideTitle}\n\n![Encoded filename](/assets/photo%20one.png)\n",
	);
	await mkdir(path.join(dir, "assets"));
	await writeFile(path.join(dir, "assets/photo one.png"), "first image");
	const first = await inspectV1(dir);
	expect(
		first.lessons[0].pages[0].blocks.flatMap((block) => block.media ?? [])[0].source,
	).toMatchObject({
		uri: "/assets/photo%20one.png",
		availability: "present",
		sha256: createHash("sha256").update("first image").digest("hex"),
	});
	await writeFile(path.join(dir, "assets/photo one.png"), "replacement image");
	expect((await inspectV1(dir)).revision).not.toBe(first.revision);
	const inspector = assetInspector(dir);
	for (const uri of [
		"/%2e%2e/outside.png",
		"/assets/%2e%2e/%2e%2e/outside.png",
		"/assets/photo%5cone.png",
		"/assets/photo%00one.png",
		"/assets/photo%ZZ.png",
	]) {
		expect(await inspector.read(uri)).toMatchObject({ availability: "blocked", sha256: null });
	}
});

it("inspects retrieval sheets as literal title, questions and intentionally public answers", async () => {
	const dir = await typedProject(
		"# P\n::: retrieval-sheet <b>Title</b>\n:: [term]{definition} @icon{star}\nanswer: <em>Answer</em> @footer{note}\n:::\n",
	);
	const result = await runPraxityCli(["inspect", dir, "--schema", "1"], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	const inspection = JSON.parse(result.stdout) as CourseInspectionV1;
	const blocks = inspection.lessons.flatMap((l) => l.pages.flatMap((p) => p.blocks));
	const sheet = blocks.find((b) => b.type === "retrievalSheet");
	expect(sheet).toMatchObject({
		type: "retrievalSheet",
		coverage: "text",
		texts: [
			{ role: "heading", format: "plain", value: "<b>Title</b>" },
			{ role: "prompt", format: "plain", value: "[term]{definition} @icon{star}" },
			{ role: "body", format: "plain", value: "<em>Answer</em> @footer{note}" },
		],
	});
});

it.each(["0", "1"])(
	"keeps distractor answers, labels and options out of inspect schema %s",
	async (schema) => {
		const source =
			"# P\n::: write-distractors PromptControl\nanswer: HiddenRightMarker\n:: HiddenLabelMarker\noption: HiddenOptionMarker\n:::\n";
		const dir = await typedProject(source);
		const result = await runPraxityCli(["inspect", dir, "--schema", schema], runtime);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain("PromptControl");
		const read = readLesson(source);
		for (const marker of ["HiddenRightMarker", "HiddenLabelMarker", "HiddenOptionMarker"]) {
			expect(result.stdout).not.toContain(marker);
			expect(JSON.stringify(read.blocks)).not.toContain(marker);
			expect(JSON.stringify(read.errors)).not.toContain(marker);
		}
	},
);

it("inspects highlight title, question, grouped passages and public notes as literal text", async () => {
	const dir = await typedProject(
		"# P\n::: highlight <b>Title</b>\nquestion: Which passage?\n:: [term]\\{definition} @icon{star} {key=true}\nnote: <script>note()</script> @footer{note}\n:: Other {paragraph=true}\n:::\n",
	);
	const result = await runPraxityCli(["inspect", dir, "--schema", "1"], runtime);
	expect(result.exitCode, result.stderr).toBe(0);
	const inspection = JSON.parse(result.stdout) as CourseInspectionV1;
	const blocks = inspection.lessons.flatMap((l) => l.pages.flatMap((p) => p.blocks));
	expect(blocks.find((b) => b.type === "highlight")).toMatchObject({
		type: "highlight",
		coverage: "text",
		texts: [
			{ role: "heading", format: "plain", value: "<b>Title</b>" },
			{ role: "prompt", format: "plain", value: "Which passage?" },
			{ role: "body", format: "plain", value: "[term]{definition} @icon{star}" },
			{ role: "body", format: "plain", value: "<script>note()</script> @footer{note}" },
			{ role: "body", format: "plain", value: "Other" },
		],
	});
});
