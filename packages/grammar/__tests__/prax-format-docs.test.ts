import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readLesson } from "../src/read-lesson";
import {
	type CourseValidationOptions,
	generateBlocksIndex,
	validateCourse,
} from "../src/v4/schema";
import type { TreeNode } from "../src/v4/tree";

const docsDir = resolve(__dirname, "../../../docs/prax-format");
const read = (relative: string) => readFileSync(resolve(docsDir, relative), "utf8");
const parse = (source: string) => {
	let nextId = 0;
	return readLesson(source, { ids: () => `doc-node-${nextId++}` });
};

const generated = JSON.parse(read("reference/blocks.json")) as {
	grammarVersion: number;
	blocks: { id: string; insertTemplate: string; settings: Record<string, unknown> }[];
};

// Compile each example once before the block coverage assertions.
const compiledExamples = new Map<
	string,
	ReturnType<typeof parse> & { courseDiagnostics: ReturnType<typeof validateCourse>["diagnostics"] }
>();
const compiledCourses = new Map<
	string,
	{ lessons: string[]; diagnostics: ReturnType<typeof validateCourse>["diagnostics"] }
>();
beforeAll(() => {
	for (const entry of readdirSync(resolve(docsDir, "examples"), { recursive: true })) {
		// Markdown links keep forward slashes on Windows.
		const file = entry.replaceAll("\\", "/");
		if (!file.endsWith(".prax")) continue;
		const lesson = parse(read(`examples/${file}`));
		compiledExamples.set(`examples/${file}`, {
			...lesson,
			courseDiagnostics: [],
		});
	}
	const manifests = new Map<string, CourseValidationOptions & { lessons?: string[] }>();
	for (const file of compiledExamples.keys()) {
		const folder = dirname(file);
		const manifest = resolve(docsDir, folder, "course.yaml");
		const context: CourseValidationOptions & { lessons?: string[] } =
			manifests.get(manifest) ??
			(existsSync(manifest) ? parseYaml(readFileSync(manifest, "utf8")) : {});
		manifests.set(manifest, context);
		// A folder may also hold independent examples outside the manifest's lesson list.
		const courseLessons = context.lessons?.includes(basename(file))
			? context.lessons.map((lesson) => `${folder}/${lesson}`)
			: [file];
		const course = courseLessons.length > 1 ? folder : file;
		if (compiledCourses.has(course)) continue;
		const examples = courseLessons.map((path) => {
			const compiled = compiledExamples.get(path);
			if (!compiled) throw new Error(`Course example ${path} must exist`);
			return { path, compiled };
		});
		const { diagnostics } = validateCourse(
			examples.map(({ path, compiled }) => ({ path, tree: compiled.tree })),
			context,
		);
		compiledCourses.set(course, { lessons: courseLessons, diagnostics });
		for (const { compiled } of examples) compiled.courseDiagnostics = diagnostics;
	}
});
const blockTypes = (node: TreeNode): string[] => [
	...(node.kind === "block" && node.status === "resolved" && node.type ? [node.type] : []),
	...node.children.flatMap(blockTypes),
];

describe("prax-format published spec", () => {
	it.each(generated.blocks)("$id has matching skill and reference introductions", ({ id }) => {
		const row = read("SKILL.md")
			.split("\n")
			.find((line) => line.startsWith(`| \`${id}\` |`));
		const [, , description, link] = row?.split("|").map((cell) => cell.trim()) ?? [];
		const example = link?.match(/\]\((examples\/[^)]+\.prax)\)/)?.[1];
		expect(example, `${id} needs an example in SKILL.md`).toBeDefined();
		const introductions = readdirSync(resolve(docsDir, "reference"))
			.filter((file) => /^blocks-.*\.md$/.test(file))
			.flatMap((file) => [...read(`reference/${file}`).matchAll(/^## ([\w-]+)\n\n([^\n]+)/gm)])
			.filter(([, block]) => block === id);
		expect(introductions, `${id} needs one reference entry`).toHaveLength(1);
		expect(introductions[0]?.[2]).toBe(`${description} See the [example](../${example}).`);
	});

	it("validates both highlight lessons together as one course", () => {
		const course = compiledCourses.get("examples/highlight");
		expect(course?.lessons).toEqual(["examples/highlight/en.prax", "examples/highlight/fr.prax"]);
		expect(course?.diagnostics).toEqual([]);
	});

	it.each(generated.blocks.filter((block) => block.insertTemplate.startsWith(":::")))(
		"$id has a linked example that compiles with zero diagnostics",
		({ id }) => {
			const row = read("SKILL.md")
				.split("\n")
				.find((line) => line.startsWith(`| \`${id}\` |`));
			const example = row?.match(/\]\((examples\/[^)]+\.prax)\)/)?.[1];
			expect(example, `${id} needs an example in SKILL.md`).toBeDefined();
			const compiled = compiledExamples.get(example ?? "");
			expect(compiled, `${id}: ${example} must exist`).toBeDefined();
			expect(compiled?.diagnostics, example).toEqual([]);
			expect(compiled?.warnings, example).toEqual([]);
			expect(compiled?.courseDiagnostics, example).toEqual([]);
			expect(blockTypes(compiled!.tree.root), `${example} must contain ::: ${id}`).toContain(id);
		},
	);

	it("parses every public example without grammar or blocking validation issues", () => {
		for (const [file, parsed] of compiledExamples) {
			expect(parsed.warnings, file).toEqual([]);
			expect(parsed.diagnostics, file).toEqual([]);
			expect(parsed.courseDiagnostics, file).toEqual([]);
		}
	});

	it("preserves every public example's source and semantics through the lossless reader", () => {
		const files = readdirSync(resolve(docsDir, "examples"), { recursive: true });
		for (const file of files.filter((file) => file.endsWith(".prax"))) {
			const source = read(`examples/${file}`);
			const first = parse(source);
			expect(first.tree.root.raw, file).toBe(source);
			const second = parse(first.tree.root.raw);
			expect(second.diagnostics, file).toEqual([]);
			expect(second.frontmatter, file).toEqual(first.frontmatter);
			expect(
				second.blocks.map(({ type, data }) => ({ type, data })),
				file,
			).toEqual(first.blocks.map(({ type, data }) => ({ type, data })));
		}
	});

	it("keeps example containers and conditional feedback within their intended boundaries", () => {
		const blocks = (file: string) => parse(read(`examples/${file}.prax`)).blocks;
		expect(blocks("interactive-module").filter((block) => block.type === "columns")).toHaveLength(
			1,
		);
		expect(blocks("full-featured").filter((block) => block.type === "columns")).toHaveLength(2);
		expect(
			blocks("patterns/guided-reading").find((block) => block.type === "sequence")?.data.items,
		).toHaveLength(3);
		expect(
			blocks("patterns/image-comparison").find((block) => block.type === "columns")?.data.items,
		).toHaveLength(2);

		const scenario = blocks("patterns/scenario-feedback");
		expect(scenario.find((block) => block.type === "assessment")?.name).toBe("spillResponse");
		expect(scenario.filter((block) => block.type === "logic").map((block) => block.data)).toEqual(
			["correct", "incorrect"].map((result) => ({
				conditions: {
					operator: "and",
					rules: [
						{ source: "block:spillResponse", field: "result", comparison: "is", value: result },
					],
				},
				actions: [
					{ type: "show", targets: [`${result}FollowUp`] },
					{ type: "hide", targets: [`${result === "correct" ? "incorrect" : "correct"}FollowUp`] },
				],
			})),
		);
		expect(
			scenario
				.filter((block) => block.type === "card" && block.data.hide === true)
				.map((block) => block.name),
		).toEqual(["correctFollowUp", "incorrectFollowUp"]);
	});

	it("keeps branching dialogue tied to a submitted scored choice", () => {
		const source = read("examples/patterns/dialogue-branching.prax");
		const parsed = parse(source);
		expect(parsed.warnings).toEqual([]);
		expect(parsed.blocks.filter((block) => block.type === "dialogue")).toHaveLength(3);
		const choice = parsed.blocks.find((block) => block.type === "assessment");
		expect(choice?.name).toBe("reply");
		expect(choice?.data).toMatchObject({ scored: true, attempts: 2 });
		const actions = parsed.blocks
			.filter((block) => block.type === "logic")
			.flatMap((block) => block.data.actions as Array<{ type: string; targets: string[] }>);
		expect(actions).toEqual([
			{ type: "show", targets: ["calm-path"] },
			{ type: "show", targets: ["tense-path"] },
		]);
		expect(parse(parsed.tree.root.raw).diagnostics).toEqual([]);
	});

	it("preserves the published Continue gate reason and assessment field reference", () => {
		const parsed = parse(read("examples/patterns/continue-gate.prax"));
		expect(parsed.blocks.find((block) => block.type === "logic")?.data).toEqual({
			conditions: {
				operator: "and",
				rules: [
					{
						source: "block:safetyCheck",
						field: "result",
						comparison: "isNot",
						value: "correct",
					},
				],
			},
			actions: [
				{
					type: "disableCompletion",
					targets: [],
					reason: "Submit a correct answer before continuing.",
				},
			],
		});
	});

	// docs/prax-format is mirrored at release to github.com/Praxity/prax-format, so a
	// stale blocks.json ships a spec that disagrees with the parser. These assertions
	// fail the build instead, pointing at the generator.
	it("blocks.json is regenerated from the grammar-4 schema", () => {
		expect(generated).toEqual(generateBlocksIndex());
		expect(generated.grammarVersion).toBe(4);
	});

	it("runs the block index generator and reproduces the committed reference files", () => {
		const outputDir = mkdtempSync(resolve(tmpdir(), "prax-format-index-"));
		try {
			execFileSync(
				process.execPath,
				[resolve(docsDir, "scripts/generate-block-index.mjs"), outputDir],
				{ encoding: "utf8", timeout: 10_000 },
			);
			for (const file of ["blocks.json"]) {
				expect(readFileSync(resolve(outputDir, file)), `${file} is stale`).toEqual(
					readFileSync(resolve(docsDir, "reference", file)),
				);
			}
		} finally {
			rmSync(outputDir, { recursive: true, force: true });
		}
	});

	it("no longer documents a per-question pass threshold", () => {
		// `pass` duplicated `passingScore` and was the half nothing read. The spec
		// must not teach it, or authors will set a value that never applies.
		for (const file of [
			"skill/assessments.md",
			"reference/blocks-assessments.md",
			"reference/blocks.md",
		]) {
			expect(read(file), `${file} still documents pass`).not.toMatch(/^\|\s*`pass`\s*\|/m);
		}
		expect(read("reference/blocks.json")).not.toMatch(/"pass"\s*:/);
	});

	it("keeps passingScore documented on group", () => {
		const group = generated.blocks.find((block) => block.id === "group");
		expect(Object.keys(group?.settings ?? {})).toContain("passingScore");
	});
});
