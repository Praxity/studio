import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { resolveDialogueSpeakers } from "@praxity/grammar";
import { expect, it } from "vitest";
import { readLessonFixture as readBlockSource } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import { buildCoursePdfSource, exportCoursePdf } from "../src/pipelines/course-pdf.ts";
import { parsePdfStructure, structureNodes } from "./helpers/pdf-structure.ts";

function decodedPdf(pdf: Buffer): string {
	const raw = pdf.toString("latin1");
	return (
		raw +
		[...raw.matchAll(/(?<!end)stream\r?\n/g)]
			.map((match) => {
				const length = [
					...raw.slice(Math.max(0, match.index - 500), match.index).matchAll(/\/Length\s*(\d+)/g),
				].at(-1);
				if (!length) throw new Error("Native fixture PDF stream has no direct length.");
				const start = match.index + match[0].length;
				const bytes = pdf.subarray(start, start + Number(length[1]));
				try {
					return inflateSync(bytes).toString("latin1");
				} catch {
					return bytes.toString("latin1");
				}
			})
			.join("\n")
	);
}

// Native checks require the bundled compiler and Poppler. A supplied path must work.
it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"exports marked matching and rating blocks with the native compiler",
	async () => {
		const blocks = readBlockSource(
			"# Practice {hideTitle}\n\n::: match Match controls\n- **Hazard** -> **Control**\nfeedback: MATCHRATIONALE\n- Risk -> Mitigation\n:::\n\n::: rating Rate confidence\n1. **Low**\n2. **High**\n:::\n",
		).blocks;
		const root = await mkdtemp(path.join(tmpdir(), "course-pdf-metadata-"));
		try {
			for (const includeAnswerSheet of [false, true]) {
				const { pdf, questionCount } = await exportCoursePdf({
					title: "Workbook",
					locale: "en",
					lessons: [{ id: "lesson", title: "Practice", locale: "en", blocks }],
					includeAnswerSheet,
					executablePath: process.env.PRAXITY_TEST_TYPST as string,
				});
				expect(questionCount).toBe(2);
				expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
				const file = path.join(root, `${includeAnswerSheet}.pdf`);
				await writeFile(file, pdf);
				const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
				for (const label of ["Hazard", "Control", "Rate confidence", "Low", "High"])
					expect(text).toContain(label);
				expect(text.includes("MATCHRATIONALE")).toBe(includeAnswerSheet);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"compiles both workbook variants with real Typst and retains content",
	async () => {
		const fixture = await readFile(
			new URL("./fixtures/course-workbook.prax", import.meta.url),
			"utf8",
		);
		const root = await mkdtemp(path.join(tmpdir(), "course-pdf-native-"));
		const blocks = readBlockSource(fixture).blocks;
		const dialogue = resolveDialogueSpeakers(
			readBlockSource(
				"---\n{ cast: { roger: {}, roxanne: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- roger: Hi there\n- roxanne: Second turn\ncaption: At the office\n:::\n",
			).blocks,
			{ roger: { name: "Roger" }, roxanne: { name: "Roxanne" } },
		).blocks.find((block) => block.type === "dialogue");
		if (!dialogue) throw new Error("Native dialogue fixture did not parse.");
		(dialogue.data.turns as Array<{ id: string }>).forEach((turn, index) => {
			turn.id = index === 0 ? "native-roger" : "native-roxanne";
		});
		blocks.push({ ...dialogue, id: "native-dialogue" });
		const narrated = blocks.find((block) => block.type === "text");
		if (narrated) narrated.data.narration = "NARRATIONSCRIPT for the notes column.";
		try {
			for (const includeAnswerSheet of [false, true]) {
				const { pdf, questionCount } = await exportCoursePdf({
					title: "Workbook",
					locale: "en",
					lessons: [
						{
							id: "en",
							title: "Practice",
							locale: "en",
							blocks,
							design: { typography: { body: { fontFamily: ["Atkinson Hyperlegible"] } } },
						},
						{
							id: "fr",
							title: "Français",
							locale: "fr-CA",
							blocks: readBlockSource("# Sécurité\n\nRévision française.\n").blocks,
						},
					],
					includeAnswerSheet,
					executablePath: process.env.PRAXITY_TEST_TYPST as string,
				});
				expect(questionCount).toBe(5);
				expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
				const file = path.join(root, `${includeAnswerSheet}.pdf`);
				await writeFile(file, pdf);
				const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
				expect(text).toMatch(/Roger:\s+Hi there[\s\S]*Roxanne:\s+Second turn/);
				// The bundled engine directory supplies theme fonts converted at build time.
				expect(execFileSync("pdffonts", [file], { encoding: "utf8" })).toContain(
					"AtkinsonHyperlegibleNext",
				);
				for (const marker of [
					"Introduction",
					"Choose the colour",
					"Write",
					"Choose",
					"a|b",
					"*star",
					"{literal}",
					"red; blue; red; green",
					"Explain your reasoning",
					"Révision française",
					"NARRATIONSCRIPT",
				])
					expect(text).toContain(marker);
				for (const marker of [
					"ANSWERONLY",
					"OPTIONEXPLANATION",
					"CORRECTEXPLANATION",
					"Answer sheet",
				])
					expect(text.includes(marker)).toBe(includeAnswerSheet);
				expect(text).not.toContain("RETRYONLY");
				const tree = parsePdfStructure(
					execFileSync("pdfinfo", ["-struct", file], { encoding: "utf8" }),
				);
				expect(structureNodes(tree).some((node) => node.tag === "H1")).toBe(true);
				const objects = decodedPdf(pdf);
				expect(objects).not.toContain("/EmbeddedFiles");
				expect(objects).not.toContain("/Users/");
				if (!includeAnswerSheet)
					for (const secret of ["ANSWERONLY", "OPTIONEXPLANATION", "CORRECTEXPLANATION"]) {
						expect(objects).not.toContain(secret);
						expect(objects.toLowerCase()).not.toContain(Buffer.from(secret).toString("hex"));
						expect(objects.toLowerCase()).not.toContain(
							[...secret].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join(""),
						);
					}
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	30_000,
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"preserves expanded container reading order and image accessibility in PDF tags",
	async () => {
		const blocks = readBlockSource(
			"# Untitled {hideTitle}\n\n::: accordion {style=shaded}\n:: Panel A {level=3}\nOne.\n\n:: Panel B {level=3}\nTwo.\n:::\n\n# Tabs {hideTitle}\n\n::: tabs {orientation=vertical}\n:: Tab A {level=3}\nThree.\n\n:: Tab B {level=3}\nFour.\n:::\n\n# Steps {hideTitle}\n\n::: sequence\n:: Step A {level=3}\nFive.\n\n:: Step B {level=3}\nSix.\n:::\n\n# Timeline {hideTitle}\n\n::: sequence {style=timeline orientation=horizontal}\n:: 1948 {level=3}\nSeven.\n\n:: 2019 {level=3}\nEight.\n:::\n\n# Cards {hideTitle}\n\n::: cards Terms {layout=slides}\n:: Front\nFront content.\n\n:: Back\nBack content.\n:::\n\n# Compare {hideTitle}\n\n::: comparison {layout=side-by-side}\n:: Option A {level=3}\nNine.\n\n:: Option B {level=3}\nTen.\n:::\n\n# Images {hideTitle}\n\n![Accessible valve diagram](/assets/valve.svg)\n\n![](/assets/divider.svg){decorative}\n",
		).blocks;
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="red"/></svg>',
		);
		const { pdf } = await exportCoursePdf({
			title: "Workbook",
			locale: "en",
			lessons: [{ id: "lesson", title: "Lesson", locale: "en", blocks }],
			resolvedAssets: new Map([
				["/assets/valve.svg", svg],
				["/assets/divider.svg", svg],
			]),
			executablePath: process.env.PRAXITY_TEST_TYPST as string,
		});
		const root = await mkdtemp(path.join(tmpdir(), "course-pdf-order-"));
		try {
			const file = path.join(root, "workbook.pdf");
			await writeFile(file, pdf);
			const text = execFileSync("pdftotext", ["-raw", file, "-"], { encoding: "utf8" });
			const markers = [
				"Panel A",
				"One.",
				"Panel B",
				"Two.",
				"Tab A",
				"Three.",
				"Tab B",
				"Four.",
				"Step A",
				"Five.",
				"Step B",
				"Six.",
				"1948",
				"Seven.",
				"2019",
				"Eight.",
				"Terms",
				"Front content.",
				"Back content.",
				"Option A",
				"Nine.",
				"Option B",
				"Ten.",
			];
			let previous = -1;
			for (const marker of markers) {
				const position = text.indexOf(marker, previous + 1);
				expect(position, `${marker} follows the preceding authored item`).toBeGreaterThan(previous);
				previous = position;
			}
			// The Figure element carries the exact alt, with nothing after the text.
			expect(decodedPdf(pdf)).toMatch(
				/<<\/Type\/StructElem\/S\/Figure\b[^>]*\/Alt\(Accessible valve diagram\)/,
			);
			const tags = execFileSync("pdfinfo", ["-struct", file], { encoding: "utf8" });
			const nodes = structureNodes(parsePdfStructure(tags));
			// Poppler 24.02 omits alt text; the exact /Alt assertion above reads the PDF itself.
			expect(nodes.filter((node) => node.tag === "Figure")).toHaveLength(1);
			// #1295 restored the card group heading; its faces nest below it, as in HTML.
			for (const [tag, title] of [
				["H2", "Terms"],
				["H3", "Front"],
				["H3", "Back"],
			]) {
				expect(nodes.filter((node) => node.title === title)).toEqual([
					{ tag, title, children: [] },
				]);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	30_000,
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"exports the public full-featured grammar example with images, math, containers and assessments",
	async () => {
		const dynamicSource = await readFile(
			new URL("../../../docs/prax-format/examples/full-featured.prax", import.meta.url),
			"utf8",
		);
		const dynamic = readBlockSource(dynamicSource.replaceAll(".png", ".svg"));
		expect(() =>
			buildCoursePdfSource({
				title: "Dynamic grammar",
				locale: "en",
				lessons: [{ id: "dynamic", title: "Feature tour", locale: "en", blocks: dynamic.blocks }],
			}),
		).toThrow("Logic needs a static version");
		// The static workbook fixes the example's initial passedCheckpoint=false
		// state, revealing remediation while retaining all authored questions.
		const source = await readFile(
			new URL("../../../docs/test-fixtures/pdf-full-featured.prax", import.meta.url),
			"utf8",
		);

		const parsed = readBlockSource(source.replaceAll(".png", ".svg"));
		const root = await mkdtemp(path.join(tmpdir(), "course-pdf-full-"));
		try {
			for (const pageSize of ["a4", "letter"] as const)
				for (const includeAnswerSheet of [false, true]) {
					const options = {
						title: "Full grammar workbook",
						locale: "en",
						pageSize,
						includeAnswerSheet,
						lessons: [{ id: "full", title: "Feature tour", locale: "en", blocks: parsed.blocks }],
					};
					const prepared = buildCoursePdfSource(options);
					const svg = Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="white"/><rect x="1" y="1" width="598" height="298" fill="none" stroke="black"/><path d="M0 0 L600 300 M0 300 L600 0" stroke="black"/></svg>',
					);
					const { pdf, questionCount } = await exportCoursePdf({
						...options,
						resolvedAssets: new Map(
							[...prepared.assetSources.keys()].map((reference) => [reference, svg]),
						),
						executablePath: process.env.PRAXITY_TEST_TYPST as string,
					});
					expect(questionCount).toBe(9);
					const file = path.join(root, `${pageSize}-${includeAnswerSheet}.pdf`);
					await writeFile(file, pdf);
					const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
					for (const marker of [
						"Feature tour",
						"Contents",
						"Inspection",
						"hazard",
						"select the pull pin",
						"this module was reviewed",
					])
						expect(text.toLowerCase()).toContain(marker.toLowerCase());
					expect(text.includes("Answer sheet")).toBe(includeAnswerSheet);
					const tree = parsePdfStructure(
						execFileSync("pdfinfo", ["-struct", file], { encoding: "utf8" }),
					);
					for (const tag of ["Table", "TH", "Figure", "Formula"])
						expect(structureNodes(tree).some((node) => node.tag === tag)).toBe(true);
					expect(decodedPdf(pdf)).toContain("/Outlines");
				}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
	30000,
);
