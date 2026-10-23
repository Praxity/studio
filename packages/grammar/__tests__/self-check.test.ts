import { readFileSync } from "node:fs";
import { validateContent } from "learning-patterns/patterns/self-check/logic.js";
import { describe, expect, it } from "vitest";
import { readLesson, readSelfCheckContent, withLessonIds } from "../src/index";
import { lineColumn } from "../src/v4/lex";
import { BLOCK_SCHEMA, TURN_INTO, validateCourse, WRAP_IN } from "../src/v4/schema";

const en =
	"# Practice\n\n::: self-check Explain the delay. {required deckGate=attempt}\nmodel: The data arrived late.\n  Please wait.\n\n:: Reason\nmissed: Explain the cause.\nevidence: The data arrived late.\n\n:: Respect\nmissed: Ask politely.\n:::\n";
const fr =
	"# Pratique\n\n::: self-check Expliquez le retard. {required deckGate=attempt}\nmodel: Les données sont arrivées en retard.\n  Veuillez patienter.\n\n:: Raison\nmissed: Expliquez la cause.\nevidence: Les données sont arrivées en retard.\n\n:: Respect\nmissed: Demandez poliment.\n:::\n";
const source = (body: string, settings = "", task = "Task") =>
	`# P\n::: self-check ${task}${settings}\n${body}\n:::\n`;
const validBody = "model: Model\n:: Criterion\nmissed: Hint";
const copy = JSON.parse(
	readFileSync(new URL("../../editor-core/src/messages/en.json", import.meta.url), "utf8"),
).op.diagnostic;
const read = (text: string) =>
	readLesson(text, {
		formatMessage: (message) =>
			String(copy[message.key.replace("grammar.v4.", "")]).replace(/\{(\w+)\}/g, (_, name) =>
				String(message.args[name]),
			),
	});
// Every error and warning, ordered by line then message, so extra diagnostics fail.
const errors = (text: string) =>
	read(text)
		.errors.map((error) => ({ message: error.message, line: error.line }))
		.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.message.localeCompare(b.message));
const byLine = (...expected: { message: string; line: number }[]) =>
	expected.sort((a, b) => a.line - b.line || a.message.localeCompare(b.message));

describe("self-check declaration through the public reader", () => {
	it.each(["score", "passed", "isCorrect", "result"])(
		"rejects %s predicates at their source line across lessons",
		(field) => {
			const activity = readLesson(source(validBody, " {name=practice}"));
			const rule = readLesson(
				`# Next\n::: rule\nif: practice.${field} is true\nthen: disableCompletion\n:::\n`,
			);
			for (const lessons of [
				[
					{ path: "activity.prax", tree: activity.tree },
					{ path: "rule.prax", tree: rule.tree },
				],
				[
					{ path: "rule.prax", tree: rule.tree },
					{ path: "activity.prax", tree: activity.tree },
				],
			]) {
				const result = validateCourse(lessons);
				expect(
					result.diagnostics.filter((d) => d.code === "self-check-no-correctness"),
				).toMatchObject([{ path: "rule.prax", line: 3, column: 1, severity: "error" }]);
			}
		},
	);
	it.each(["practice", "@practice", "block:practice"])(
		"checks %s in visibility and compound rule conditions without admitting completion logic",
		(reference) => {
			const activity = readLesson(source(validBody, " {name=practice}"));
			const rule = readLesson(
				`# Next\n::: text {visible="${reference}.passed is true"}\nHidden\n:::\n::: rule\nif: ${reference}.isCompleted is true\nand: ${reference}.score >= 50\nthen: disableCompletion\n:::\n::: rule\nif: ${reference}.isAttempted is true\nor: ${reference}.isCorrect isNot true\nthen: disableCompletion\n:::\n`,
			);
			const result = validateCourse([
				{ path: "activity.prax", tree: activity.tree },
				{ path: "rule.prax", tree: rule.tree },
			]);
			expect(
				result.diagnostics.filter((d) => d.code === "self-check-no-correctness"),
			).toMatchObject([
				{ path: "rule.prax", line: 2, severity: "error" },
				{ path: "rule.prax", line: 7, severity: "error" },
				{ path: "rule.prax", line: 12, severity: "error" },
			]);
		},
	);
	it.each([
		[
			"en",
			"Self-check has no correctness or score. Remove this condition.",
			"A setting has an invalid value",
		],
		[
			"fr",
			"L'autoévaluation n'a ni résultat correct ni score. Retirez cette condition.",
			"Un réglage contient une valeur invalide",
		],
	])("%s diagnostics are localized and content-free", (locale, correctness, pass) => {
		const catalog = JSON.parse(
			readFileSync(
				new URL(`../../editor-core/src/messages/${locale}.json`, import.meta.url),
				"utf8",
			),
		).op.diagnostic;
		const lesson = readLesson(
			`${source(
				"model: MODEL_SECRET\n:: LABEL_SECRET\nmissed: HINT_SECRET",
				" {name=PRIVATE-NAME deckGate=pass}",
				"TASK_SECRET",
			)}::: rule\nif: PRIVATE-NAME.score >= 50\nthen: disableCompletion\n:::\n`,
		);
		const result = validateCourse([{ path: "lesson.prax", tree: lesson.tree }]);
		const diagnostics = result.diagnostics.filter(
			(d) => d.code === "self-check-no-correctness" || d.code === "bad-setting-value",
		);
		expect(
			diagnostics.map((d) => ({
				code: d.code,
				line: d.line,
				message: catalog[d.message.key.replace("grammar.v4.", "")],
			})),
		).toEqual([
			{ code: "bad-setting-value", line: 2, message: pass },
			{ code: "self-check-no-correctness", line: 8, message: correctness },
		]);
		expect(diagnostics.map((d) => d.message.args)).toEqual([
			{
				line: 2,
				column: 47,
				name: "deckGate",
				value: "pass",
				type: "self-check",
				allowed: ["attempt"],
			},
			{ line: 8, column: 1 },
		]);
		expect(JSON.stringify(diagnostics)).not.toMatch(
			/TASK_SECRET|MODEL_SECRET|LABEL_SECRET|HINT_SECRET|PRIVATE-NAME/,
		);
	});
	it("keeps correctness predicates for ordinary assessments and variables", () => {
		const lesson = readLesson(
			"# P\n::: choice Question {name=quiz scored}\n(x) Yes\n( ) No\n:::\n::: rule\nif: quiz.isCorrect is true\nand: quiz.score >= 50\nthen: disableCompletion\n:::\n::: rule\nif: score >= 50\nthen: disableCompletion\n:::\n",
		);
		expect(
			validateCourse([{ path: "lesson.prax", tree: lesson.tree }], {
				variables: { score: 50 },
			}).diagnostics,
		).toEqual([]);
	});
	it.each([
		[
			"EN",
			en,
			"Explain the delay.",
			"The data arrived late.\n  Please wait.",
			["Reason", "Respect"],
			["Explain the cause.", "Ask politely."],
			"The data arrived late.",
			[
				[12, 228],
				[74, 119],
				[120, 190],
				[130, 157],
				[157, 190],
				[191, 224],
				[202, 224],
			],
		],
		[
			"FR",
			fr,
			"Expliquez le retard.",
			"Les données sont arrivées en retard.\n  Veuillez patienter.",
			["Raison", "Respect"],
			["Expliquez la cause.", "Demandez poliment."],
			"Les données sont arrivées en retard.",
			[
				[12, 271],
				[76, 142],
				[143, 228],
				[153, 181],
				[181, 228],
				[229, 267],
				[240, 267],
			],
		],
	] as const)(
		"%s has the declared nodes, text and ranges",
		(_, text, task, model, labels, hints, evidence, ranges) => {
			const lesson = read(text);
			expect(lesson.hasErrors).toBe(false);
			expect(errors(text)).toEqual([]);
			const block = lesson.tree.root.children[0].children[0];
			expect(block).toMatchObject({
				kind: "block",
				type: "self-check",
				subject: { value: task },
				settings: [
					{ name: "required", value: { value: true } },
					{ name: "deckGate", value: { value: "attempt" } },
				],
			});
			const [modelPart, first, second] = block.children;
			expect(modelPart).toMatchObject({ kind: "part", name: "model", value: { value: model } });
			expect(first).toMatchObject({
				kind: "item",
				subject: { value: labels[0] },
				children: [
					{ kind: "part", name: "missed", value: { value: hints[0] } },
					{ kind: "part", name: "evidence", value: { value: evidence } },
				],
			});
			expect(second).toMatchObject({
				kind: "item",
				subject: { value: labels[1] },
				children: [{ kind: "part", name: "missed", value: { value: hints[1] } }],
			});
			expect(
				[block, modelPart, first, ...first.children, second, ...second.children].map((node) => [
					node.span.start,
					node.span.end,
				]),
			).toEqual(ranges);
			expect(
				[block, modelPart, first, ...first.children, second, ...second.children].map(
					(node) => lineColumn(text, node.span.start).line,
				),
			).toEqual([3, 4, 7, 8, 9, 11, 12]);
			expect(lesson.tree.stream.tokens.map((token) => token.raw).join("")).toBe(text);
			expect(readLesson(lesson.tree.root.raw).tree.root.raw).toBe(text);
		},
	);
	it("declares a private default, no conversions and no group wrapping", () => {
		expect(BLOCK_SCHEMA["self-check"].settings.private.default).toBe(true);
		expect(BLOCK_SCHEMA["free-response"].settings.private.default).toBeUndefined();
		expect(TURN_INTO["self-check"]).toEqual([]);
		expect(WRAP_IN["self-check"]).not.toContain("group");
	});
	it.each([
		"",
		" {private}",
		" {private=true}",
		" {private=false}",
		// Criteria are checkbox labels, not headings, so a deep level must not clamp them.
		" {level=6}",
		' {width=wide name=reflection hide entrance=fade level=3 required=false deckGate=attempt visible="ready is true"}',
	])("accepts the permitted settings %s", (settings) => {
		expect(errors(source(validBody, settings))).toEqual([]);
	});
	it.each([
		[source(validBody, "", ""), "The block needs a title or subject", 2],
		[source(":: Criterion\nmissed: Hint"), "Add the required model: part", 2],
		[source("model:\n:: Criterion\nmissed: Hint"), "The model: part must contain text", 3],
		[source("model:   \n:: Criterion\nmissed: Hint"), "The model: part must contain text", 3],
		[source("model: Model"), "The block has the wrong number of items", 2],
		[source("model: Model\n:: Criterion"), "Add the required missed: part", 4],
		[source("model: Model\n:: Criterion\nmissed:"), "The missed: part must contain text", 5],
		[source(`${validBody}\nevidence:`), "The evidence: part must contain text", 6],
		[source(`${validBody}\nevidence:   `), "The evidence: part must contain text", 6],
		[source(validBody, " {unknown=true}"), "Unknown setting", 2],
		[source(validBody, " {private private=false}"), "The setting is repeated", 2],
		[source(validBody, " {deckGate=pass}"), "A setting has an invalid value", 2],
		[source(validBody, " {private=maybe}"), "A setting has an invalid value", 2],
		[source(validBody, " {required=maybe}"), "A setting has an invalid value", 2],
		[
			source("model: Model\nmodel: Again\n:: Criterion\nmissed: Hint"),
			"Write the model: part only once",
			4,
		],
		[source(`${validBody}\nmissed: Again`), "Write the missed: part only once", 6],
		[
			source(`${validBody}\nevidence: Model\nevidence: Again`),
			"Write the evidence: part only once",
			7,
		],
		[source(`${validBody}\nFree prose`), "This content is not allowed in its parent", 6],
		[
			source(`${validBody}\n::: note Nested\nText\n:::`),
			"This content is not allowed in its parent",
			6,
		],
		[source("model: Model\n::\nmissed: Hint"), "The block needs a title or subject", 4],
		[source("model: Model\n:: Criterion {level=3}\nmissed: Hint"), "Unknown setting", 4],
		[source("model: Model\n:: Criterion {private}\nmissed: Hint"), "Unknown setting", 4],
		[source(`${validBody}\nmodel: Later`), "Put model: before the first criterion", 6],
		[source(`${validBody}\ncontext: email`), "This content is not allowed in its parent", 6],
		[
			source("model: Model\nFree prose\n:: Criterion\nmissed: Hint"),
			"This content is not allowed in its parent",
			4,
		],
	])("rejects invalid source with its message and line: %s", (text, message, line) => {
		const lesson = read(text);
		expect(lesson.hasErrors).toBe(true);
		expect(lesson.tree.root.status).toBe("unresolved");
		expect(errors(text)).toEqual(byLine({ message, line }));
		expect(lesson.tree.root.raw).toBe(text);
	});
	it.each([
		"scored",
		"points=1",
		"attempts=2",
		"shuffle",
		"feedbackMode=reveal",
		"display=scenario",
		"download=txt",
		"downloadAs=txt",
		"correct=true",
		"incorrect=true",
		"passingScore=50",
		"pointsOverride=1",
		"placeholder=Answer",
		"to=Pat",
		"initials=AB",
		"subject=Email",
	])("rejects unsupported setting %s", (setting) => {
		expect(errors(source(validBody, ` {${setting}}`))).toEqual(
			byLine({ message: "Unknown setting", line: 2 }),
		);
	});
	it.each([
		"correct: Yes",
		"incorrect: No",
		"feedback: Hint",
		"placeholder: Answer",
		"button: Show",
		"context: Email",
		"to: Pat",
		"initials: AB",
		"subject: Email",
	])("rejects unsupported named part %s", (part) => {
		expect(errors(source(`${validBody}\n${part}`))).toEqual(
			byLine({ message: "This content is not allowed in its parent", line: 6 }),
		);
	});
	it("refuses assessment-group nesting at the self-check opener", () => {
		const text =
			"# P\n::: group Check\n::: choice Q\n(x) Yes\n( ) No\n:::\n::: self-check Task\nmodel: Model\n:: Criterion\nmissed: Hint\n:::\n:::\n";
		expect(errors(text)).toEqual(
			byLine({ message: "A self-check can’t go inside an assessment group", line: 7 }),
		);
	});
	it("keeps inline-looking text literal in both lesson and course validation", () => {
		const text = source(
			"model: [word]{definition} {{missing}} **bold** <b>HTML</b> @icon{star}\n  as: literal\n  [word]{different definition}\n:: [unknown]{}\nmissed: {{alsoMissing}}\nevidence: [word]{definition}",
			"",
			"[unknown]{} **task**",
		);
		const lesson = read(text);
		expect(errors(text)).toEqual([]);
		const course = validateCourse([{ path: "literal.prax", tree: lesson.tree }]);
		expect(course.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
		expect(course.glossary).toEqual(new Map());
	});
	it.each([en, fr])("keeps CRLF and paragraph continuations lossless: %s", (text) => {
		const crlf = text.replace("\n  ", "\n\n  ").replaceAll("\n", "\r\n");
		expect(errors(crlf)).toEqual([]);
		expect(read(crlf).tree.root.raw).toBe(crlf);
	});
	it("keeps backslashes that escape nothing", () => {
		const text = source(`${String.raw`model: \d+ and a\b \q \*`}\n:: Criterion\nmissed: Hint`);
		expect(read(text).tree.root.children[0].children[0].children[0].value?.value).toBe(
			String.raw`\d+ and a\b \q *`,
		);
	});
	it("accepts the block and item declaration templates", () => {
		expect(errors(`# P\n${BLOCK_SCHEMA["self-check"].insertTemplate}`)).toEqual([]);
		expect(
			errors(
				`# P\n::: self-check Task\nmodel: Model\n${BLOCK_SCHEMA["self-check"].itemDefinition?.insertTemplate}:::\n`,
			),
		).toEqual([]);
	});
});

describe("self-check author content and prompt projection", () => {
	const withIds = (text: string) =>
		readLesson(text, {
			ids: (node, role) => `id-${node.span.start}${role ? `-${role}` : ""}`,
		});
	it.each([
		[
			"EN",
			en,
			{
				task: "Explain the delay.",
				model: "The data arrived late.\nPlease wait.",
				parts: [
					{
						id: "id-120",
						label: "Reason",
						missed: "Explain the cause.",
						evidence: "The data arrived late.",
					},
					{ id: "id-191", label: "Respect", missed: "Ask politely.", evidence: null },
				],
			},
		],
		[
			"FR",
			fr,
			{
				task: "Expliquez le retard.",
				model: "Les données sont arrivées en retard.\nVeuillez patienter.",
				parts: [
					{
						id: "id-143",
						label: "Raison",
						missed: "Expliquez la cause.",
						evidence: "Les données sont arrivées en retard.",
					},
					{ id: "id-229", label: "Respect", missed: "Demandez poliment.", evidence: null },
				],
			},
		],
	] as const)(
		"%s exposes exact author content with only the prompt in blocks",
		(_, text, content) => {
			const lesson = withIds(text);
			const block = lesson.pages[0].blocks[1];
			expect(block).toEqual({
				id: "id-12",
				type: "selfCheck",
				data: {
					level: 2,
					required: true,
					deckGate: "attempt",
					private: true,
					content: { task: content.task, parts: content.parts.map(({ id }) => ({ id })) },
				},
			});
			expect(readSelfCheckContent(lesson, block.id)).toEqual(content);
			expect(() => validateContent(readSelfCheckContent(lesson, block.id))).not.toThrow();
			expect(lesson.errors).toEqual([]);
		},
	);
	it("decodes escapes once and normalizes CRLF continuations", () => {
		const text = String.raw`# P
::: self-check Rate \*this\* {private=false}
model: Use \*stars\*, \\* and \{braces\} \d
  second line

  new paragraph
:: Stars \*
missed: Name \*one\*
evidence: \\* and
:::
`.replaceAll("\n", "\r\n");
		const lesson = readLesson(text, {
			ids: (node, role) => `${node.kind}${role ? `-${role}` : ""}`,
		});
		expect(lesson.pages[0].blocks[1].data).toEqual({
			level: 2,
			required: false,
			private: false,
			content: { task: "Rate *this*", parts: [{ id: "item" }] },
		});
		expect(readSelfCheckContent(lesson, "block")).toEqual({
			task: "Rate *this*",
			model: String.raw`Use *stars*, \* and {braces} \d` + "\nsecond line\n\nnew paragraph",
			parts: [{ id: "item", label: "Stars *", missed: "Name *one*", evidence: String.raw`\* and` }],
		});
	});
	it.each([
		[
			"twice, in a later criterion",
			"model: late or late?\n:: A\nmissed: H\n:: B\nmissed: H\nevidence: late",
			8,
		],
		["overlapping itself", "model: aaa\n:: A\nmissed: H\nevidence: aa", 6],
		["nowhere", "model: Model\n:: A\nmissed: H\nevidence: Missing", 6],
	])("evidence found %s is refused at its line", (_, body, line) => {
		expect(errors(source(body))).toEqual(
			byLine({
				message: "The evidence: text must appear exactly once in the model",
				line,
			}),
		);
	});
	it("a read without host identity gives each criterion a transient ID", () => {
		const lesson = readLesson(en);
		expect(lesson.transientIds).toBe(true);
		const { parts } = lesson.pages[0].blocks[1].data.content as { parts: { id: string }[] };
		expect(parts).toHaveLength(2);
		for (const part of parts) expect(lesson.nodes.get(part.id)?.node.subject?.value).toBeTruthy();
		expect(
			readSelfCheckContent(lesson, lesson.pages[0].blocks[1].id).parts.map(({ id }) => id),
		).toEqual(parts.map(({ id }) => id));
	});
	it("rebuilds accessor identities from the same source with withLessonIds", () => {
		const first = withIds(en);
		const second = withLessonIds(
			first,
			(node, role) => `new-${node.span.start}${role ? `-${role}` : ""}`,
		);
		expect(readSelfCheckContent(second, "new-12")).toEqual({
			task: "Explain the delay.",
			model: "The data arrived late.\nPlease wait.",
			parts: [
				{
					id: "new-120",
					label: "Reason",
					missed: "Explain the cause.",
					evidence: "The data arrived late.",
				},
				{ id: "new-191", label: "Respect", missed: "Ask politely.", evidence: null },
			],
		});
		expect(second.tree.stream.source).toBe(en);
		expect(readSelfCheckContent(first, "id-12").parts.map(({ id }) => id)).toEqual([
			"id-120",
			"id-191",
		]);
	});
	it.each(["missing", "id-0", "id-120"])(
		"refuses a missing or wrong owner %s without authored content",
		(id) => {
			expect(() => readSelfCheckContent(withIds(en), id)).toThrowError(
				expect.objectContaining({ code: "self-check-not-found", message: "self-check-not-found" }),
			);
		},
	);
	it("refuses missing criterion records with a content-free code", () => {
		const lesson = withIds(en);
		lesson.nodes.delete("id-120");
		expect(() => readSelfCheckContent(lesson, "id-12")).toThrowError(
			expect.objectContaining({
				code: "self-check-identity-invalid",
				message: "self-check-identity-invalid",
			}),
		);
	});
	it("refuses criterion IDs the library does not accept", () => {
		const lesson = readLesson(source(validBody), {
			ids: (node, role) => `bad id ${node.span.start} ${role ?? ""}`,
		});
		expect(() => readSelfCheckContent(lesson, lesson.pages[0].blocks[1].id)).toThrowError(
			expect.objectContaining({
				code: "self-check-content-invalid",
				message: "self-check-content-invalid",
			}),
		);
	});
	it.each([
		"model: aaa\n:: A\nmissed: H\nevidence: aa",
		"model: Model\n:: A\nmissed: H\nevidence: Missing",
		"model: Model\n:: A\nmissed: H\nevidence: Model\nevidence: Model",
	])(
		"refuses invalid author content without forwarding the source or library error: %s",
		(body) => {
			const lesson = withIds(source(body));
			expect(() => readSelfCheckContent(lesson, lesson.pages[0].blocks[1].id)).toThrowError(
				expect.objectContaining({
					code: "self-check-content-invalid",
					message: "self-check-content-invalid",
				}),
			);
		},
	);
});
