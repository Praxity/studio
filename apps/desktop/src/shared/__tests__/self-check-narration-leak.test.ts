import { createHash } from "node:crypto";
import {
	compileDocument,
	createCourseContext,
	selfCheckContentInput,
} from "@praxity/export-pipeline";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { describe, expect, it } from "vitest";
import { resolveLessonNarration } from "../narration-sidecar";

const places = ["TOP", "ACC", "TAB", "FRONT", "BACK"];
const selfCheck = (place: string) =>
	`::: self-check Task ${place}TASK here.\nmodel: Model **${place}MODEL** with ${place}EVID.\n:: Label ${place}LABEL\nmissed: Hint **${place}HINT**.\nevidence: ${place}EVID\n:::\n`;
const source = `# Practice

${selfCheck("TOP")}
::: accordion Open me
:: Panel
${selfCheck("ACC")}:::

# Second page

::: tabs
:: Tab one
${selfCheck("TAB")}:: Tab two
Other.
:::

::: cards Deck
:: Card one
${selfCheck("FRONT")}::: back
${selfCheck("BACK")}:::
:: Card two
Text.
:::
`;
const hidden = places.flatMap((place) =>
	["MODEL", "EVID", "LABEL", "HINT"].map((part) => `${place}${part}`),
);

function narrate(enabled: boolean, read = readLesson(source)) {
	return resolveLessonNarration({
		read,
		courseId: "course",
		lessonId: "lesson",
		sidecar: { version: 2, courseId: "course", lessons: {} },
		locale: "en",
		enabled,
		digest: (text) => createHash("sha256").update(text).digest("hex"),
	});
}

describe("self-check content in narration and page output", () => {
	it.each(["en", "fr-CA", "FR-ca"])(
		"warns without quoting hidden text in an explicit %s script",
		(locale) => {
			const read = readLesson(source);
			const options = {
				read,
				courseId: "course",
				lessonId: "lesson",
				locale,
				enabled: true,
				digest: (text: string) => createHash("sha256").update(text).digest("hex"),
			};
			const sidecar = { version: 2 as const, courseId: "course", lessons: {} };
			const natural = resolveLessonNarration({ ...options, sidecar });
			const top = natural.items.find((item) => item.segment.sourceContent.includes("TOPTASK"));
			if (!top) throw new Error("Missing task segment");
			for (const script of [
				"Model TOPMODEL with TOPEVID.",
				"Hint TOPHINT.",
				"TOPMODEL",
				'The model says "TOPMODEL".',
				"Le modèle dit « TOPMODEL ».",
			]) {
				const entry = {
					target: top.segment.target,
					script,
					reviewedRevision: top.segment.revision,
				};
				const custom = resolveLessonNarration({
					...options,
					sidecar: { ...sidecar, lessons: { lesson: { segments: [entry] } } },
				});
				expect(
					custom.items.find((item) => item.segment.blockId === top.segment.blockId)?.segment.script,
				).toBe(script);
				expect(custom.warnings).toEqual([{ code: "ENARRATIONSELFCHECKSPOILER", line: 3 }]);
				for (const marker of hidden) expect(JSON.stringify(custom.warnings)).not.toContain(marker);
			}
			expect(natural.warnings).toEqual([]);
			const safe = resolveLessonNarration({
				...options,
				sidecar: {
					...sidecar,
					lessons: {
						lesson: {
							segments: [
								{ target: top.segment.target, script: "Read the task and write your own answer." },
							],
						},
					},
				},
			});
			expect(safe.warnings).toEqual([]);
		},
	);
	it.each(["The", "answer", 'Say "is" aloud.', "TOPEVID"])("skips short excerpt %s", (script) => {
		expect(override(source, "TOPTASK", script).warnings).toEqual([]);
	});
	it.each([
		"model topmodel with topevid.",
		"The model says ‘TOPMODEL’.",
		"The model says “TOPMODEL”.",
	])("normalizes %s", (script) => {
		expect(override(source, "TOPTASK", script).warnings).toEqual([
			{ code: "ENARRATIONSELFCHECKSPOILER", line: 3 },
		]);
	});
	it.each(["ACC", "TAB", "FRONT", "BACK"])(
		"warns for nested %s with its own opening line",
		(place) => {
			const custom = override(source, `${place}TASK`, `Model ${place}MODEL with ${place}EVID.`);
			const line = { ACC: 12, TAB: 24, FRONT: 36, BACK: 43 }[place];
			expect(custom.warnings).toEqual([{ code: "ENARRATIONSELFCHECKSPOILER", line }]);
		},
	);
	it.each(["sequence", "note"])("warns through a %s override", (container) => {
		const nested = `# Practice\n\n::: ${container}\n${container === "note" ? "" : ":: Panel\n"}${selfCheck("FIRST")}${selfCheck("SECOND")}:::\n`;
		const read = readLesson(nested);
		const block = read.blocks.find(
			(block) => block.type !== "pageBreak" && block.type !== "heading",
		);
		if (!block) throw new Error("Missing container");
		const result = resolveLessonNarration({
			read,
			courseId: "course",
			lessonId: "lesson",
			locale: "en",
			enabled: true,
			digest,
			sidecar: {
				version: 2,
				courseId: "course",
				lessons: {
					lesson: {
						segments: [
							{
								target: { id: block.id, role: "body" },
								script: "Model FIRSTMODEL with FIRSTEVID. Model SECONDMODEL with SECONDEVID.",
							},
						],
					},
				},
			},
		});
		expect(result.warnings).toEqual([
			{ code: "ENARRATIONSELFCHECKSPOILER", line: container === "note" ? 4 : 5 },
			{ code: "ENARRATIONSELFCHECKSPOILER", line: container === "note" ? 10 : 11 },
		]);
	});
	it.each(["columns", "comparison"])("warns for the self-check segment inside %s", (container) => {
		const nested = `# Practice\n\n::: ${container}\n:: Panel\n${selfCheck("FIRST")}:::\n`;
		expect(override(nested, "FIRSTTASK", "Model FIRSTMODEL with FIRSTEVID.").warnings).toEqual([
			{ code: "ENARRATIONSELFCHECKSPOILER", line: 5 },
		]);
	});
	it("warns once when both card sides quote the same self-check", () => {
		const read = readLesson(source);
		const card = read.blocks.find((block) => block.type === "card");
		if (!card) throw new Error("Missing card fixture");
		const backId = (card.data.items as { backId: string }[])[0].backId;
		const options = {
			read,
			courseId: "course",
			lessonId: "lesson",
			locale: "en",
			enabled: true,
			digest,
		};
		// The task has its own segment now; retain the older empty back-face target.
		const sidecar = {
			version: 2 as const,
			courseId: "course",
			lessons: { lesson: { segments: [{ target: { id: backId, role: "back" as const } }] } },
		};
		const natural = resolveLessonNarration({ ...options, sidecar });
		const faces = natural.items.filter(
			({ segment }) =>
				segment.blockType === "card" &&
				segment.itemIndex === 0 &&
				["front", "back"].includes(segment.target.role),
		);
		expect(faces.map(({ segment }) => segment.target.role)).toEqual(["front", "back"]);
		const custom = resolveLessonNarration({
			...options,
			sidecar: {
				...sidecar,
				lessons: {
					lesson: {
						segments: faces.map(({ segment }) => ({
							target: segment.target,
							script: "Model FRONTMODEL with FRONTEVID.",
						})),
					},
				},
			},
		});
		expect(custom.warnings).toEqual([{ code: "ENARRATIONSELFCHECKSPOILER", line: 36 }]);
	});

	it("leaves invalid self-check drafts available with an explicit script", () => {
		const invalid = source.replace("evidence: TOPEVID", "evidence: NOT_IN_MODEL");
		expect(
			override(invalid, "TOPTASK", "Read the task and write your own answer.").warnings,
		).toEqual([]);
	});
	it.each(["segment", "course", "lesson"])(
		"skips advice when %s narration is disabled",
		(scope) => {
			expect(override(source, "TOPTASK", "Model TOPMODEL with TOPEVID.", scope).warnings).toEqual(
				[],
			);
		},
	);

	it("narration segments carry only the task", () => {
		const segments = JSON.stringify(narrate(true).items);
		for (const marker of hidden) expect(segments).not.toContain(marker);
		const top = narrate(true).items.find((item) => item.segment.sourceContent.includes("TOPTASK"));
		expect(top?.segment.script).toBe("Task TOPTASK here.");
	});

	it.each([true, false])(
		"page HTML and JSON never carry the model, hints, evidence or labels (narration %s)",
		async (enabled) => {
			const read = readLesson(source);
			const narration = narrate(enabled, read);
			const blocks = adaptGrammarPreviewBlocks(narration.blocks, undefined, "en");
			const pages = splitBlocksIntoPages(blocks, "Course");
			expect(pages.map((page) => page.title)).toEqual(["Practice", "Second page"]);
			const context = await createCourseContext({
				id: "course",
				title: "Course",
				sourceLocale: "en",
				content: pages,
				selfCheckContents: [...read.nodes.values()]
					.filter((record) => !record.role && record.node.type === "self-check")
					.map((record) => selfCheckContentInput(record.id, readSelfCheckContent(read, record.id))),
				htmlOutput: {
					islandAssets: {
						loaderFilename: "loader.js",
						islandFilenames: {
							nav: "nav.js",
							accordion: "accordion.js",
							tabs: "tabs.js",
							card: "card.js",
							narration: "narration.js",
							selfCheck: "self-check.js",
						},
					},
				},
			});
			const htmls = context.documents.map(
				(document) => compileDocument(context, document.slug).html,
			);
			// This page's playlist is the learner-facing narration; navigation entries never carry raw segments.
			for (const page of htmls) {
				const json = page.match(
					/<script id="praxity-config" type="application\/json">(.*?)<\/script>/s,
				);
				const navigation = JSON.parse(json?.[1] ?? "null").pages as { data?: object }[];
				expect(navigation.length).toBe(2);
				for (const entry of navigation) expect(entry.data).not.toHaveProperty("_narrationSegments");
			}
			const html = htmls.join("\n");
			for (const place of places) expect(html).toContain(`Task ${place}TASK here.`);
			for (const marker of hidden) expect(html).not.toContain(marker);
		},
	);
});

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function override(text: string, task: string, script: string, off?: string) {
	const read = readLesson(text);
	const options = {
		read,
		courseId: "course",
		lessonId: "lesson",
		locale: "en",
		enabled: off !== "course",
		digest,
	};
	const sidecar = { version: 2 as const, courseId: "course", lessons: {} };
	const natural = resolveLessonNarration({ ...options, sidecar });
	const segment = natural.items.find(({ segment }) =>
		segment.derivedScript.includes(task),
	)?.segment;
	if (!segment) throw new Error("Missing override target");
	return resolveLessonNarration({
		...options,
		sidecar: {
			...sidecar,
			lessons: {
				lesson: {
					enabled: off === "lesson" ? false : undefined,
					segments: [{ target: segment.target, script, disabled: off === "segment" }],
				},
			},
		},
	});
}
