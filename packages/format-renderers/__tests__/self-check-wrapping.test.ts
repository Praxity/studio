import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSelfCheckContent } from "@praxity/grammar";
import { validateContent } from "learning-patterns/patterns/self-check/logic.js";
import { expect, it, vi } from "vitest";
import { readLessonFixture } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import {
	buildCoursePdfSource,
	type CoursePdfOptions,
	exportCoursePdf,
} from "../src/pipelines/course-pdf.ts";

// This suite also tests formatting beyond authored admission limits. Keep the real
// validator everywhere except the explicitly scoped lower-level formatting calls.
vi.mock("learning-patterns/patterns/self-check/logic.js", async (importOriginal) => {
	const library =
		await importOriginal<typeof import("learning-patterns/patterns/self-check/logic.js")>();
	return { ...library, validateContent: vi.fn(library.validateContent) };
});
async function formattingOnly<T>(run: () => Promise<T>): Promise<T> {
	const library: typeof import("learning-patterns/patterns/self-check/logic.js") =
		await vi.importActual<typeof import("learning-patterns/patterns/self-check/logic.js")>(
			"learning-patterns/patterns/self-check/logic.js",
		);
	// Only task/label maxima are bypassed at this test boundary; all actual PDF
	// text, geometry, evidence, identity, and copy checks still use the originals.
	vi.mocked(validateContent).mockImplementation((value: unknown) => {
		const content = value as import("learning-patterns/patterns/self-check/logic.js").Content;
		library.validateContent({
			...content,
			task: "Formatting scaffold.",
			parts: content.parts.map((part) => ({ ...part, label: "Formatting scaffold." })),
		});
	});
	try {
		return await run();
	} finally {
		vi.mocked(validateContent).mockImplementation(library.validateContent);
	}
}
function formattingWorkbook(model: string, parts: Part[], task: string, locale: string) {
	const input = workbook(
		"Model.",
		parts.map(() => ({})),
		"Formatting scaffold.",
		locale,
	);
	const lesson = input.lessons[0];
	const block = lesson.blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing formatting scaffold");
	const content = lesson.selfCheckContents?.get(block.id);
	if (!content) throw new Error("Missing formatting content");
	const full = {
		...content,
		task,
		model,
		parts: content.parts.map((part, index) => ({
			...part,
			label: parts[index].label ?? part.label,
			missed: parts[index].missed ?? part.missed,
			evidence: parts[index].evidence ?? null,
		})),
	};
	block.data.content = { task, parts: full.parts.map(({ id }) => ({ id })) };
	lesson.selfCheckContents = new Map([[block.id, full]]);
	return input;
}

type Part = { evidence?: string; label?: string; missed?: string };
function workbook(
	model: string,
	parts: Part[],
	task = "Explain.",
	locale = "en",
): CoursePdfOptions {
	const read = readLessonFixture(
		`# Practice\n::: self-check ${task}\nmodel: ${model}\n${parts.map((p, i) => `:: ${p.label ?? `Part ${i + 1}`}\nmissed: ${p.missed ?? "Try again."}\n${p.evidence === undefined ? "" : `evidence: ${p.evidence}\n`}`).join("")}:::\n`,
	);
	return {
		title: "Workbook",
		locale,
		includeAnswerSheet: true,
		lessons: [
			{
				id: "lesson",
				title: "Practice",
				locale,
				blocks: read.blocks,
				selfCheckContents: new Map(
					read.blocks
						.filter((b) => b.type === "selfCheck")
						.map((b) => [b.id, readSelfCheckContent(read, b.id)]),
				),
			},
		],
	};
}

async function copiedWorkbook(
	input: CoursePdfOptions,
	keepLines = false,
	inspect?: (xml: string) => void,
) {
	const root = await mkdtemp(join(tmpdir(), "self-check-wrap-"));
	try {
		const executablePath = process.env.PRAXITY_TEST_TYPST;
		if (!executablePath) throw new Error("Bundled Typst is required");
		const result = await exportCoursePdf({ ...input, executablePath });
		const file = join(root, "workbook.pdf");
		await writeFile(file, result.pdf);
		const text = execFileSync("pdftotext", ["-raw", "-nopgbrk", file, "-"], { encoding: "utf8" });
		const xml = execFileSync("pdftotext", ["-bbox-layout", file, "-"], {
			encoding: "utf8",
			maxBuffer: 20_000_000,
		});
		for (const page of xml.matchAll(/<page width="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)) {
			for (const word of page[2].matchAll(
				/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>([^<]*)/g,
			)) {
				expect(Number(word[1]), word[3]).toBeGreaterThanOrEqual((2.2 * 72) / 2.54 - 1);
				expect(Number(word[2]), word[3]).toBeLessThanOrEqual(
					Number(page[1]) - (2.2 * 72) / 2.54 + 1,
				);
			}
		}
		// These characters must never be added to an authored text layer.
		expect(text).not.toMatch(/[\u200b\u00ad\ufeff]/u);
		if (
			![...input.lessons].some((lesson) =>
				[...(lesson.selfCheckContents?.values() ?? [])].some((content) =>
					[
						content.task,
						content.model,
						...content.parts.flatMap((part) => [part.label, part.missed]),
					].some((field) => field.includes("\u2060")),
				),
			)
		)
			expect(text).not.toContain("\u2060");
		inspect?.(xml);
		return keepLines ? text : text.replace(/[\r\n]/g, "");
	} finally {
		await rm(root, { recursive: true });
	}
}

const chunks = Array.from(
	{ length: 12 },
	(_, i) => `Section${String(i).padStart(2, "0")}${"W".repeat(10)}`,
);
const dense = "ABCDEFGHIJKLMNOPQRSTUVWXYZmw@%&";
const url =
	"https://example.com/documentation/accessibility/implementation-guide/learner-support/revision-twelve/index.html";
const reviewUrl =
	"https://example.org/a/very/long/path/that/keeps/going/and/going/for/ever?query=1&x=2";
const markerSpans = ["WWW", "MMM", "QQQ", "OOO", "DDD", "GGG", "HHH", "NNN", "UUU", "CCC"];
const cases: Array<{
	name: string;
	model: string;
	parts: Part[];
	expected: string;
	task?: string;
}> = [
	{
		name: "twelve 19-character evidence spans",
		model: chunks.join(""),
		parts: chunks.map((evidence) => ({ evidence })),
		expected: chunks.map((s, i) => `${s}[${i + 1}]`).join(""),
	},
	{
		name: "30/30/30 across evidence",
		model: "a".repeat(30) + "b".repeat(30) + "c".repeat(30),
		parts: [{ evidence: "b".repeat(30) }],
		expected: "a".repeat(30) + "b".repeat(30) + "[1]" + "c".repeat(30),
	},
	{
		name: "31 characters with 31 markers",
		model: dense,
		parts: [...dense].map((evidence) => ({ evidence })),
		expected: [...dense].map((s, i) => `${s}[${i + 1}]`).join(""),
	},
	{
		name: "two copied URLs",
		model: `${url} ${url}/second`,
		parts: [{}],
		expected: `${url} ${url}/second`,
	},
	{
		name: "call punctuation after evidence",
		model: "Call getUser(id); then save;it.",
		parts: [{ evidence: "getUser" }, { evidence: "save" }],
		expected: "Call getUser[1](id); then save[2];it.",
	},
	{
		name: "combining marks",
		model: "e\u0301".repeat(30) + "X" + "e\u0301".repeat(30),
		parts: [{ evidence: "\u0301X" }],
		expected: "e\u0301".repeat(30) + "X[1]" + "e\u0301".repeat(30),
	},
	{
		name: "original copied 82-character URL in model and hint",
		model: `See ${reviewUrl} now`,
		parts: [{ evidence: "now", missed: `Read ${reviewUrl}` }],
		expected: `See ${reviewUrl} now[1]`,
	},
	{
		name: "31 characters across ten markers",
		model: `${markerSpans.join("")}W`,
		parts: markerSpans.map((evidence) => ({ evidence })),
		expected: `${markerSpans.map((span, i) => `${span}[${i + 1}]`).join("")}W`,
	},
	{
		name: "two wide 31-character tokens with evidence",
		model: `${"W".repeat(31)} ${"M".repeat(31)}`,
		parts: [{ evidence: "W".repeat(31) }, { evidence: "M".repeat(31) }],
		expected: `${"W".repeat(31)}[1] ${"M".repeat(31)}[2]`,
	},
	{
		name: "90-character runs in task, label and hint",
		task: `Explain ${"M".repeat(90)}.`,
		model: "Short model with evidence here.",
		parts: [{ evidence: "evidence", label: "Q".repeat(90), missed: "O".repeat(90) }],
		expected: "Short model with evidence[1] here.",
	},
];

it
	.skipIf(!process.env.PRAXITY_TEST_TYPST)
	.each(
		cases.flatMap((c) =>
			["a4", "letter"].map((pageSize) => ({ ...c, pageSize: pageSize as "a4" | "letter" })),
		),
	)(
	"wraps $name on $pageSize without changing copied text",
	async ({ model, parts, expected, pageSize, task }) => {
		const text = await copiedWorkbook({ ...workbook(model, parts, task), pageSize });
		if (model.includes(" "))
			expect(text.replaceAll(" ", "")).toContain(expected.replaceAll(" ", ""));
		else expect(text.normalize("NFD")).toContain(expected.normalize("NFD"));
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"])(
	"preserves calls in every %s field",
	async (locale) => {
		const call = "getUserFromStore(sessionIdentifier)";
		const text = await copiedWorkbook(
			workbook(
				`${call} returns null.`,
				[{ evidence: "null", label: `Calling ${call}`, missed: `Check ${call}.` }],
				`Why does ${call} fail?`,
				locale,
			),
		);
		for (const phrase of [
			`Why does ${call} fail?`,
			`${call} returns null[1].`,
			`Calling ${call}`,
			`Check ${call}.`,
		])
			expect(text.replaceAll(" ", "")).toContain(phrase.replaceAll(" ", ""));
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["\u00a0", "\u202f", "\u2007", "\u2060"])(
	"wraps joined runs containing %j",
	async (separator) => {
		const sentence =
			separator === "\u00a0"
				? "The final report will be sent next Tuesday after the data team has checked every regional figure carefully and the director has signed it."
				: ["W", "M", "Q", "O", "D", "G"].map((c) => c.repeat(12)).join(" ");
		const model = sentence.replaceAll(" ", separator);
		const text = await copiedWorkbook(
			workbook(model, [{}], "Explain.", separator === "\u202f" ? "fr" : "en"),
		);
		// Poppler normalizes no-break spaces and omits word joiners, including on main.
		expect(text.replace(/[ \u00a0\u202f\u2007\u2060]/g, "")).toContain(
			sentence.replaceAll(" ", ""),
		);
		if (separator !== "\u2060") expect(text).not.toContain("\u2060");
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each([19, 20, 31])(
	"wraps %i wide glyphs in task, model and bold label",
	async (length) => {
		const token = "W".repeat(length);
		const input = workbook(token, [{ label: token, missed: token }], token);
		expect(await copiedWorkbook(input)).toContain(token);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"])(
	"escapes formatted text before parentheses and semicolons in %s paragraphs",
	async (locale) => {
		const read = readLessonFixture(
			"# Practice {hideTitle}\n\n## [term]{Definition.}(see above)\n\n**getUser**(id) and `getUser`(id). **a**;b\n",
		);
		read.blocks.push({ id: "linebreak", type: "text", data: { content: "<p>Before<br>(x)</p>" } });
		const input: CoursePdfOptions = {
			title: "Workbook",
			locale,
			lessons: [{ id: "lesson", title: "Practice", locale, blocks: read.blocks }],
		};
		const text = await copiedWorkbook(input);
		expect(text.replaceAll(" ", "")).toContain("getUser(id)andgetUser(id).a;b");
		expect(text).toContain("(x)");
		expect(text.replaceAll(" ", "")).toContain("term1(seeabove)");
		expect(text).toContain("Definition.");
	},
);

it
	.skipIf(!process.env.PRAXITY_TEST_TYPST)
	.each(
		["(", ")", ";", '"', "'", "%", "&", "?"].flatMap((punctuation) =>
			[15, 16, 17].map((offset) => ({ punctuation, offset })),
		),
	)(
	"keeps $punctuation at offset $offset literal in every field and after evidence",
	async ({ punctuation, offset }) => {
		const prefix = "a".repeat(offset);
		const token = `${prefix}${punctuation}${"b".repeat(24)}`;
		const text = await copiedWorkbook(
			workbook(token, [{ evidence: prefix, label: token, missed: token }], token),
		);
		expect(text).toContain(token);
		expect(text).toContain(`${prefix}[1]${punctuation}${"b".repeat(24)}`);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"copies literal markup without executing it",
	async () => {
		const literal = '<script>#panic("SECRET")</script> **x**(id); `x`(id); & <b>literal</b>';
		const text = await copiedWorkbook(workbook(literal, [{}], literal));
		expect(text.replaceAll(" ", "")).toContain(literal.replaceAll(" ", ""));
	},
);

it("keeps grapheme clusters whole when inserting emergency breaks", () => {
	for (const cluster of ["e\u0301", "क्ष", "👩🏽‍💻", "🇨🇦"]) {
		const source = buildCoursePdfSource(workbook(cluster.repeat(40), [{}])).typstSource;
		const blocks = [...source.matchAll(/#\{([^\n]*?)\};/g)]
			.map((m) => m[1])
			.filter((s) => s.includes("box(width: 0pt)"));
		expect(blocks.length).toBeGreaterThan(0);
		for (const body of blocks) {
			for (const literal of body.matchAll(/"([^"]*)"/g))
				expect(literal[1].replaceAll(cluster, "")).toBe("");
		}
	}
});

it("keeps a combining cluster whole across an evidence boundary", () => {
	const source = buildCoursePdfSource(
		workbook(`${"e\u0301".repeat(16)}X${"e\u0301".repeat(30)}`, [{ evidence: "\u0301X" }]),
	).typstSource;
	expect(source).not.toContain('box(width: 0pt); "\u0301');
});

it("counts an evidence-split combining cluster only once", () => {
	const source = buildCoursePdfSource(
		workbook(`${"a".repeat(14)}e\u0301X`, [{ evidence: "\u0301X" }]),
	).typstSource;
	expect(source).not.toContain("box(width: 0pt)");
});

it.each([19, 20])("starts emergency breaking at 20 graphemes, length %i", (length) => {
	const source = buildCoursePdfSource(workbook("W".repeat(length), [{}])).typstSource;
	expect(source.includes("box(width: 0pt)")).toBe(length === 20);
});

it("counts evidence markers toward a short run's break threshold", () => {
	const source = buildCoursePdfSource(
		workbook(
			"ABCDE",
			[..."ABCDE"].map((evidence) => ({ evidence })),
		),
	).typstSource;
	for (let n = 1; n <= 5; n++)
		expect(source).toContain(`super("[${n}]"); if wrap0 { box(width: 0pt) }`);
});

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"copies the exact authored identifier with no added spaces or hidden characters",
	async () => {
		const token =
			"2026Q4InternationalAccessibilityImplementationEvidenceAndLearnerSupportDocumentationRevision12ApprovedForPublication";
		const text = await copiedWorkbook(workbook(`START${token}END`, [{}]));
		expect(text.match(/START(.*?)END/u)?.[1]).toBe(token);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"keeps a mixed Arabic and Latin run in bounds with every character",
	async () => {
		const arabic = "معرفنهاية";
		const text = await copiedWorkbook(workbook(`معرف${"Identifier".repeat(6)}نهاية`, [{}]));
		expect(text).toContain("Identifier".repeat(6));
		// Poppler reverses RTL text; compare the Arabic character inventory separately.
		expect([...text].filter((char) => /\p{Script=Arabic}/u.test(char)).sort()).toEqual(
			[...arabic].sort(),
		);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"keeps all four-digit evidence markers and their model in bounds",
	async () => {
		const chunks = Array.from({ length: 40 }, (_, i) => `W${String(i).padStart(2, "0")}`);
		const parts: Part[] = Array.from({ length: 960 }, () => ({}));
		parts.push(...chunks.map((evidence) => ({ evidence })));
		const text = await copiedWorkbook(workbook(chunks.join(""), parts));
		expect(text).toContain(chunks.map((chunk, i) => `${chunk}[${961 + i}]`).join(""));
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"])(
	"keeps all 24 line-sized words whole in %s prose",
	async (locale) => {
		const words = [
			"internationalization",
			"firstname.lastname@example.com",
			"Geschwindigkeitsbegrenzung",
			"anticonstitutionnellement",
		];
		const prose = Array.from(
			{ length: 24 },
			(_, i) => `${"ab ".repeat(i % 7)}${words[i % 4]}`,
		).join(" ");
		const raw = await copiedWorkbook(workbook(prose, [{}], "Explain.", locale), true);
		for (const word of words) expect(raw.split(word).length - 1, word).toBe(6);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"renders tabs and repeated spaces as markup whitespace in every field",
	async () => {
		const raw = await copiedWorkbook(
			workbook("A\tmodel.", [{ label: "Lab\tel", missed: "Try  this   now." }], "Explain\tthis."),
			true,
		);
		expect(raw).toContain("Explain this.");
		const source = buildCoursePdfSource(
			workbook("A\tmodel.", [{ label: "Lab\tel", missed: "Try  this   now." }], "Explain\tthis."),
		).typstSource;
		for (const phrase of ["A model.", "Lab el", "Try this now."]) {
			expect(source).toContain(`#{"${phrase}"};`);
			expect(raw.replaceAll(" ", "")).toContain(phrase.replaceAll(" ", ""));
		}
		expect(raw).not.toContain("  ");
	},
);

it.each(["\u0628", "\u0712", "\u07ca", "\u1820", "\u{1e900}", "\u0640"])(
	"never inserts a break box inside a joining-script run %s",
	(letter) => {
		const token = `${letter}${"Identifier".repeat(20)}${letter}`;
		const source = buildCoursePdfSource(workbook(token, [{}])).typstSource;
		expect(source).not.toContain("box(width: 0pt)");
		expect(source).toContain(token);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"keeps a long Arabic word joined and inside the page",
	async () => {
		const model =
			"\u0628".repeat(10) +
			"\u0645\u0631\u062d\u0628\u0627\u0628\u0627\u0644\u0639\u0627\u0644\u0645\u0627\u0644\u0639\u0631\u0628\u064a\u0627\u0644\u062c\u0645\u064a\u0644\u062c\u062f\u0627\u0645\u0631\u062d\u0628\u0627";
		const source = buildCoursePdfSource(workbook(model, [{}])).typstSource;
		expect(source).not.toContain("box(width: 0pt)");
		await copiedWorkbook(workbook(model, [{}]));
	},
);

it
	.skipIf(!process.env.PRAXITY_TEST_TYPST)
	.each([`${"W".repeat(18)}( `.repeat(4) + "x", "x" + ` )${"W".repeat(18)}`.repeat(4)])(
	"breaks bound parenthesis chains at their authored spaces: %j",
	async (model) => {
		const raw = await copiedWorkbook(workbook(model, [{}]), true);
		expect(raw.replace(/[\r\n ]/g, "")).toContain(model.replaceAll(" ", ""));
	},
);

it.each(["\u00a0", "\u202f", "\u2007"])(
	"puts a break after internal no-break spaces %j",
	(separator) => {
		const source = buildCoursePdfSource(
			workbook(Array(15).fill("elephant").join(separator), [{}]),
		).typstSource;
		// Removing only the separator break must violate the generated-source contract.
		expect(source).toContain(`${separator}"; if wrap0 { box(width: 0pt) }`);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"keeps fitting words whole inside a long no-break-space sentence",
	async () => {
		const words = [
			"internationalization",
			"firstname.lastname@example.com",
			"Geschwindigkeitsbegrenzung",
			"anticonstitutionnellement",
		];
		const model = Array.from(
			{ length: 24 },
			(_, i) => `${"ab\u00a0".repeat(i % 7)}${words[i % 4]}`,
		).join("\u00a0");
		const raw = await copiedWorkbook(workbook(model, [{}]), true);
		for (const word of words) expect(raw.split(word).length - 1, word).toBe(6);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"keeps the task inside the workbook's 120 mm text measure",
	async () => {
		await copiedWorkbook(workbook("Model.", [{}], "W".repeat(40)), false, (xml) => {
			const page = [...xml.matchAll(/<page[^>]*>([\s\S]*?)<\/page>/g)][1][1];
			const words = [
				...page.matchAll(/<word xMin="[\d.]+" yMin="[\d.]+" xMax="([\d.]+)"[^>]*>(W+)<\/word>/g),
			];
			expect(words.length).toBeGreaterThan(0);
			// 22 mm left page margin plus the normal 120 mm slide text block.
			for (const word of words) expect(Number(word[1])).toBeLessThanOrEqual(403.52);
		});
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"])(
	"keeps French punctuation bound to its words in %s fields",
	async (locale) => {
		const phrase = "Pourquoi ? Exemple : voici ! Oui ; non. \u00ab mot \u00bb";
		const prose = Array(14).fill(phrase).join(" ");
		const raw = await formattingOnly(() =>
			copiedWorkbook(
				formattingWorkbook(prose, [{ label: prose, missed: prose }], prose, locale),
				true,
			),
		);
		expect(raw).not.toMatch(/^[?!:;\u00bb]/m);
		expect(raw).not.toMatch(/\u00ab$/m);
		for (const space of ["\u00a0", "\u202f", "\u2007"])
			await copiedWorkbook(
				workbook(prose.replaceAll(" ", space), [{}], "Explain.", locale),
				true,
				(xml) => {
					for (const line of xml.matchAll(/<line[^>]*>([\s\S]*?)<\/line>/g)) {
						const words = [...line[1].matchAll(/<word[^>]*>([^<]*)<\/word>/g)];
						expect(words[0]?.[1]).not.toMatch(/^[?!:;\u00bb]/);
						expect(words.at(-1)?.[1]).not.toMatch(/\u00ab$/);
					}
				},
			);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"prints Unicode line and paragraph separators as breakable spaces in every field",
	async () => {
		const field = "Explain\u2028this\u2029now.";
		const raw = await copiedWorkbook(
			workbook(field, [{ label: field, missed: field }], field),
			true,
		);
		expect((raw.match(/Explain *this *now\./g) ?? []).length).toBe(5);
		const prose = Array(20).fill("ordinary words").join("\u2028");
		await copiedWorkbook(workbook(prose, [{}], prose));
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["cards", "columns"])(
	"keeps words that fit the actual %s task width whole",
	async (container) => {
		const token =
			"Donaudampfschifffahrtsgesellschaftskapitaensmuetzenabzeichenherstellungsbetrieb".slice(
				0,
				62,
			);
		const task = Array.from({ length: 8 }, (_, i) => `${"word ".repeat(i)}${token}`).join(" ");
		const selfCheck = `::: self-check ${task}\nmodel: Model.\n:: Part\nmissed: Try again.\n:::\n`;
		const source =
			container === "cards"
				? `# Practice\n::: cards {layout=slides}\n:: Card\n${selfCheck}:::\n`
				: `# Practice\n::: columns\n:: {weight=5}\n${selfCheck}\n:: {weight=1}\nSide.\n:::\n`;
		const read = readLessonFixture(source.replace(task, "Formatting scaffold."));
		const find = (blocks: typeof read.blocks): typeof read.blocks =>
			blocks.flatMap((block) => [
				block,
				...(Array.isArray(block.data.items)
					? block.data.items.flatMap((item: Record<string, unknown>) =>
							[item.children, item.front, item.back].flatMap((value) =>
								Array.isArray(value) ? find(value) : [],
							),
						)
					: []),
			]);
		const input = workbook("Model.", [{}]);
		input.lessons[0].blocks = read.blocks;
		input.lessons[0].selfCheckContents = new Map(
			find(read.blocks)
				.filter((b) => b.type === "selfCheck")
				.map((b) => {
					const full = { ...readSelfCheckContent(read, b.id), task };
					b.data.content = { task, parts: full.parts.map(({ id }) => ({ id })) };
					return [b.id, full];
				}),
		);
		const raw = await formattingOnly(() => copiedWorkbook(input, true));
		expect(raw.split(token).length - 1).toBe(16);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each([1, 9, 10])(
	"budgets the full enum body width for %i criteria",
	async (count) => {
		const label = "W".repeat(46);
		const hint = "W".repeat(48);
		const parts = Array.from({ length: count }, (_, i) => (i ? {} : { label, missed: hint }));
		const raw = await copiedWorkbook(workbook("Model.", parts));
		expect(raw).toContain(label);
		expect(raw).toContain(hint);
	},
);

it.skipIf(!process.env.PRAXITY_TEST_TYPST).each(["en", "fr"])(
	"keeps punctuation after an evidence marker on the preceding line in %s",
	async (locale) => {
		const evidence = "W".repeat(49);
		await copiedWorkbook(
			workbook(`${evidence} ?`, [{ evidence }], "Explain.", locale),
			false,
			(xml) => {
				for (const line of xml.matchAll(/<line[^>]*>\s*<word[^>]*>([^<]*)/g))
					expect(line[1]).not.toMatch(/^[?!:;\u00bb]/);
			},
		);
	},
);

// Original authored stress inputs remain intact and now explicitly refuse.
it.each(["en", "fr"])("refuses the original 671-code-point %s task and label", (locale) => {
	const phrase = "Pourquoi ? Exemple : voici ! Oui ; non. \u00ab mot \u00bb";
	const prose = Array(14).fill(phrase).join(" ");
	expect([...prose]).toHaveLength(671);
	for (const [task, label] of [
		[prose, "Part"],
		["Explain.", prose],
		[prose, prose],
	]) {
		const source = `# Practice\n::: self-check ${task}\nmodel: ${prose}\n:: ${label}\nmissed: ${prose}\n:::\n`;
		const read = readLessonFixture(source);
		expect(read.tree.root.raw).toBe(source);
		expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["self-check-invalid"]);
		expect(() => workbook(prose, [{ label, missed: prose }], task, locale)).toThrow(
			"self-check-content-invalid",
		);
	}
});
it.each(["cards", "columns"])("refuses the original 643-code-point %s task", (container) => {
	const token =
		"Donaudampfschifffahrtsgesellschaftskapitaensmuetzenabzeichenherstellungsbetrieb".slice(0, 62);
	const task = Array.from({ length: 8 }, (_, i) => `${"word ".repeat(i)}${token}`).join(" ");
	expect([...task]).toHaveLength(643);
	const selfCheck = `::: self-check ${task}\nmodel: Model.\n:: Part\nmissed: Try again.\n:::\n`;
	const source =
		container === "cards"
			? `# Practice\n::: cards {layout=slides}\n:: Card\n${selfCheck}:::\n`
			: `# Practice\n::: columns\n:: {weight=5}\n${selfCheck}\n:: {weight=1}\nSide.\n:::\n`;
	const read = readLessonFixture(source);
	expect(read.tree.root.raw).toBe(source);
	expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["self-check-invalid"]);
});

it("refuses oversized full content at the public PDF boundary before formatting", () => {
	const prose = Array(14)
		.fill("Pourquoi ? Exemple : voici ! Oui ; non. \u00ab mot \u00bb")
		.join(" ");
	const input = formattingWorkbook(prose, [{ label: prose, missed: prose }], prose, "fr");
	expect(() => buildCoursePdfSource(input)).toThrowError(
		expect.objectContaining({
			code: "ESELFCHECKPDFCONTENT",
			reason: "Invalid self-check answer-sheet content.",
		}),
	);
});
