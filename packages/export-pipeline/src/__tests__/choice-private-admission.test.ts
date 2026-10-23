import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import {
	compileBlockStatePolicy,
	filterPrivateSuspendData,
} from "@praxity/shared-blocks/block-state-policy";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { buildScormPackage, createCourseContext, renderNode } from "../build";
import {
	assertPracticeLogic,
	type CourseConfig,
	generateCourseCss,
	generateHtmlPage,
	prepareHtmlCourse,
	renderPageFragments,
} from "../html-gen";
import { validateModuleDeck } from "../module-deck";
import { renderBlockHtml } from "../render-block-html";

const privateChoice: PraxityBlock = {
	id: "private-id",
	name: "priv",
	type: "assessment",
	data: {
		assessmentType: "choice",
		private: true,
		gradingMode: "none",
		stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
		response: {
			type: "choice",
			selectionMode: "single",
			options: [
				{ id: "a", label: "Yes", isCorrect: true },
				{ id: "b", label: "No" },
			],
		},
	},
};
const container: PraxityBlock = {
	id: "outer-id",
	name: "outer",
	type: "accordion",
	data: {
		items: [
			{
				id: "item",
				title: "Item",
				blocks: [privateChoice, { id: "ordinary", type: "text", data: { content: "Sibling" } }],
			},
		],
	},
};
const page = (blocks: PraxityBlock[]): PraxityPage => ({ id: "page", title: "Page", blocks });
const config = (blocks: PraxityBlock[], locale = "en"): CourseConfig => ({
	id: "course",
	title: "Course",
	sourceLocale: locale,
	totalPages: 1,
	pages: [page(blocks)],
});
const logic = (data: Record<string, unknown>): PraxityBlock => ({
	id: "rule",
	type: "logic",
	data,
});
const condition = (ref: string) => ({
	operator: "and",
	rules: [{ source: `block:${ref}`, field: "isCompleted", comparison: "is", value: true }],
});
const error = (path: string, blockId = "rule") => ({
	code: "practice-no-tracking",
	blockId,
	referencePath: path,
});

describe("compiled private choice boundary", () => {
	it.each(["name", "data.name", "id"])(
		"cannot shadow a practice %s with a public block on another page",
		(key) => {
			const publicBlock = {
				id: key === "id" ? "private-id" : "public-id",
				type: "text",
				name: key === "name" ? "priv" : undefined,
				data: { name: key === "data.name" ? "priv" : undefined },
			} as PraxityBlock;
			const ref = key === "id" ? "private-id" : "priv";
			const privateBlock =
				key === "data.name"
					? { ...privateChoice, name: undefined, data: { ...privateChoice.data, name: "priv" } }
					: privateChoice;
			for (const data of [
				{ conditions: condition(ref) },
				{ actions: [{ type: "require", targets: [ref] }] },
			])
				expect(() =>
					assertPracticeLogic([
						page([publicBlock]),
						{ ...page([privateBlock, logic(data)]), id: "private-page" },
					]),
				).toThrowError(expect.objectContaining({ code: "practice-no-tracking" }));
		},
	);
	it.each([
		{ type: "requireCompletion", target: "outer" },
		{ type: "require", target: "@outer-id" },
		{ type: "requireCompletion", targets: ["private-id"] },
		{ type: "require", targets: [0], target: "priv" },
		{ type: "require", targets: "x", target: "priv" },
		{ type: "requireCompletion", targets: [null], target: "@priv" },
	])("normalizes legacy and singular require actions: %j", (action) => {
		expect(() =>
			assertPracticeLogic([page([container, logic({ actions: [action] })])]),
		).toThrowError(expect.objectContaining({ code: "practice-no-tracking" }));
	});
	it.each([
		'<span data-mention="blockOutput:private-id:selectedOption"></span>',
		"<span data-mention='blockOutput:priv:isCompleted'></span>",
		'<span DATA-MENTION = "blockOutput&#58;private-id&#58;score"></span>',
		"<span data-mention=blockOutput:private-id:score></span>",
	])("refuses mentions in arbitrary nested HTML fields: %s", (html) => {
		expect(() =>
			assertPracticeLogic([
				page([privateChoice, { id: "text", type: "text", data: { nested: [{ feedback: html }] } }]),
			]),
		).toThrowError(
			expect.objectContaining(error("pages[0].blocks[1].data.nested[0].feedback", "text")),
		);
	});
	it("refuses @identity-ID references emitted from real source", () => {
		let nextId = 0;
		const read = readLesson(
			"# Page\n::: choice Q {private}\n(x) Yes\n( ) No\n:::\n::: rule\nif: @private-id.isCompleted is true\nthen: disableCompletion\n:::\n",
			{ ids: (node, role) => (node.type === "choice" && !role ? "private-id" : `id-${nextId++}`) },
		);
		expect(() => assertPracticeLogic([page(read.blocks)])).toThrowError(
			expect.objectContaining({ code: "practice-no-tracking" }),
		);
	});
	it("also checks compiled HTML on the page outside its block list", () => {
		const input = {
			...page([privateChoice]),
			data: { footer: '<span data-mention="blockOutput:private-id:score"></span>' },
		};
		expect(() => assertPracticeLogic([input])).toThrowError(
			expect.objectContaining(error("pages[0].data.footer", "page")),
		);
	});
	it.each(["priv", "private-id", "@priv"])(
		"refuses every condition read via %s without completion options",
		(ref) => {
			for (const type of [
				"show",
				"hide",
				"setVariable",
				"require",
				"jumpToPage",
				"disableCompletion",
			])
				expect(() =>
					assertPracticeLogic([
						page([
							container,
							logic({ conditions: condition(ref), actions: [{ type, targets: ["ordinary"] }] }),
						]),
					]),
				).toThrowError(
					expect.objectContaining(error("pages[0].blocks[1].data.conditions.rules[0].source")),
				);
		},
	);
	it("refuses parsed visibility and object operands in arbitrary action lists", () => {
		const fixtures = [
			[logic({ visible: "@priv.isAttempted is true" }), "visible"],
			[
				logic({
					rules: [
						{
							actions: [
								{
									type: "setVariable",
									targets: ["picked"],
									value: { operation: "add", operand: { ref: "block:priv", field: "score" } },
								},
							],
						},
					],
				}),
				"rules[0].actions[0].value.operand.ref",
			],
		] as const;
		for (const [block, path] of fixtures)
			expect(() => assertPracticeLogic([page([container, block])])).toThrowError(
				expect.objectContaining(error(`pages[0].blocks[1].data.${path}`)),
			);
	});
	it("refuses public/unconditional require of private choices and mixed containers", () => {
		for (const target of ["priv", "private-id", "outer", "outer-id"])
			for (const conditions of [
				undefined,
				{ operator: "and", rules: [{ source: "variable:public", comparison: "is", value: true }] },
			])
				expect(() =>
					assertPracticeLogic([
						page([
							container,
							logic({ conditions, actions: [{ type: "require", targets: [target] }] }),
						]),
					]),
				).toThrowError(
					expect.objectContaining(error("pages[0].blocks[1].data.actions[0].targets[0]")),
				);
	});
	it("refuses compiled required containers with the actual nested structural path", () => {
		const nested = {
			...container,
			id: "nested",
			data: {
				items: [{ blocks: [{ ...container, data: { ...container.data, required: true } }] }],
			},
		};
		expect(() => assertPracticeLogic([page([nested])])).toThrowError(
			expect.objectContaining(
				error("pages[0].blocks[0].data.items[0].blocks[0].data.required", "outer-id"),
			),
		);
	});
	it("checks across pages and keeps EN/FR diagnostics content-free without invented source coordinates", () => {
		for (const locale of ["en", "fr"]) {
			try {
				assertPracticeLogic(
					[page([container]), { ...page([logic({ conditions: condition("priv") })]), id: "other" }],
					locale,
				);
				throw new Error("Expected refusal");
			} catch (e) {
				expect(e).toMatchObject({
					code: "practice-no-tracking",
					blockId: "rule",
					referencePath: "pages[1].blocks[0].data.conditions.rules[0].source",
					message:
						locale === "fr"
							? "Cette activité de pratique ne peut être lue par la logique du cours, modifier l’état du cours, fournir un score ou une condition de progression, ni être obligatoire directement ou par l’intermédiaire d’un conteneur."
							: "This practice activity cannot be read by course logic, write course state, supply a score or progression condition, or be required directly or through a container.",
				});
				expect(e).not.toHaveProperty("line");
			}
		}
	});
	it("allows public show/hide targets and literal operands; ordinary and free-response private rules retain their behavior", () => {
		for (const target of ["priv", "outer"])
			expect(() =>
				assertPracticeLogic([
					page([
						container,
						logic({
							conditions: {
								operator: "and",
								rules: [{ source: "variable:flag", comparison: "is", value: true }],
							},
							actions: [
								{ type: "show", targets: [target] },
								{ type: "hide", targets: [target] },
								{
									type: "setVariable",
									targets: ["picked"],
									value: { operation: "add", operand: "block:priv.score" },
								},
							],
						}),
					]),
				]),
			).not.toThrow();
		for (const data of [
			{ ...privateChoice.data, private: false },
			{ ...privateChoice.data, assessmentType: "textResponse" },
		])
			expect(() =>
				assertPracticeLogic([
					page([
						{ ...privateChoice, data },
						logic({
							conditions: condition("priv"),
							actions: [{ type: "require", targets: ["priv"] }],
						}),
					]),
				]),
			).not.toThrow();
	});
});

describe("compiled private choice policy admission", () => {
	it("adds print suppression only for device-private choices, retaining ordinary CSS bytes", () => {
		const plain = generateCourseCss({});
		for (const privacy of [undefined, false])
			expect(
				generateCourseCss({
					content: [
						page([{ ...privateChoice, data: { ...privateChoice.data, private: privacy } }]),
					],
				}),
			).toBe(plain);
		expect(generateCourseCss({ content: [page([privateChoice])] })).toContain(
			"[data-practice-save]",
		);
	});

	const unsupportedChoice = {
		...privateChoice,
		data: { ...privateChoice.data, response: { type: "choice", options: [] } },
	} as PraxityBlock;
	const unsupportedContainer = {
		...container,
		data: { items: [{ id: "item", title: "Item", blocks: [unsupportedChoice] }] },
	} as PraxityBlock;
	it("publishes source-admitted single private choices, retaining the exact device policy", () => {
		const read = readLesson(
			"# Practice\n::: choice Question {private dontKnow}\n(x) Yes\n( ) No\n:::\n",
		);
		expect(read.hasErrors).toBe(false);
		expect(() => prepareHtmlCourse(config(read.blocks))).not.toThrow();
		const choice = read.blocks.find((block) => block.type === "assessment");
		if (!choice) throw new Error("Missing choice");
		expect(compileBlockStatePolicy(read.blocks)).toEqual({ [choice.id]: "device" });
	});
	it.each([undefined, "multiple"])("refuses private compiled selectionMode %s", (selectionMode) => {
		const block = {
			...privateChoice,
			data: {
				...privateChoice.data,
				response: { ...(privateChoice.data.response as object), selectionMode },
			},
		};
		expect(compileBlockStatePolicy([block])).toEqual({});
		expect(() => prepareHtmlCourse(config([block]))).toThrowError(
			expect.objectContaining({ code: "unsupported-runtime", blockId: block.id }),
		);
	});
	it.each([
		["required", { required: true }],
		["scored", { gradingMode: "exact" }],
		["legacy scored", { gradingMode: undefined, graded: true }],
		["deck gate", { _deckGate: "attempt" }],
	] as const)("refuses compiled private %s at every HTML entry", (_name, settings) => {
		const cfg = config([{ ...privateChoice, data: { ...privateChoice.data, ...settings } }]);
		for (const call of [
			() => prepareHtmlCourse(cfg),
			() => renderPageFragments(cfg, cfg.pages[0], new Set()),
			() =>
				generateHtmlPage({
					config: cfg,
					page: cfg.pages[0],
					index: 0,
					currentSlug: "page",
					slugList: [],
					slugMap: new Map(),
				}),
		])
			expect(call).toThrowError(
				expect.objectContaining({ code: "private-choice-practice-only", blockId: "private-id" }),
			);
	});
	it("refuses referenced private group members before HTML or LMS package admission", async () => {
		const group: PraxityBlock = {
			id: "group",
			type: "assessmentGroup",
			data: { memberBlockIds: ["private-id"] },
		};
		const cfg = config([group, privateChoice]);
		const expected = expect.objectContaining({
			code: "private-choice-practice-only",
			blockId: "private-id",
		});
		expect(() => prepareHtmlCourse(cfg)).toThrowError(expected);
		expect(() => renderPageFragments(cfg, cfg.pages[0], new Set())).toThrowError(expected);
		for (const format of ["html", "scorm12", "scorm2004"] as const)
			await expect(
				buildScormPackage(
					{ id: "course", title: "Course", sourceLocale: "en", content: cfg.pages },
					{ mode: "source", format },
				),
			).rejects.toThrowError(expected);
	});
	it("loads the notice asset only on a document containing a private choice", () => {
		const privatePage = page([privateChoice]);
		const ordinaryPage = {
			...page([
				{
					...privateChoice,
					id: "ordinary-choice",
					data: { ...privateChoice.data, private: false },
				},
			]),
			id: "ordinary-page",
		};
		const cfg = { ...config([]), pages: [privatePage, ordinaryPage] };
		const html = (selected: PraxityPage) =>
			generateHtmlPage({
				config: cfg,
				page: selected,
				index: 0,
				currentSlug: "page",
				slugList: [],
				slugMap: new Map(),
				islandAssets: {
					loaderFilename: "loader.js",
					islandFilenames: { assessment: "assessment.js", nav: "nav.js" },
					privacy: { bootstrap: "privacy.js", support: "support.js" },
					privateChoice: "private-choice.js",
				},
			});
		expect(html(privatePage)).toContain('<script defer src="private-choice.js"></script>');
		expect(html(ordinaryPage)).not.toContain('src="private-choice.js"');
		expect(html(ordinaryPage)).not.toContain("data-practice-mode");
	});
	it("fragments inspect their page while documents validate course-wide facts", () => {
		const publicPage = page([{ id: "text", type: "text", data: { content: "Public" } }]);
		const cfg = {
			...config([]),
			pages: [publicPage, { ...page([unsupportedChoice]), id: "other" }],
		};
		expect(() => prepareHtmlCourse(cfg)).toThrowError(
			expect.objectContaining({ code: "unsupported-runtime" }),
		);
		expect(() => renderPageFragments(cfg, publicPage, new Set())).not.toThrow();
		expect(() =>
			generateHtmlPage({
				config: cfg,
				page: publicPage,
				index: 0,
				currentSlug: "page",
				islandAssets: { loaderFilename: "loader.js", islandFilenames: { nav: "nav.js" } },
				slugList: [],
				slugMap: new Map(),
			}),
		).toThrow('Invalid choice fact for block "private-id": selectionMode');
	});
	it.each(["en", "fr"])("localizes deck override refusals in %s", (locale) => {
		expect(() =>
			validateModuleDeck(
				{ gates: { "private-id": "attempt" } },
				[page([unsupportedChoice])],
				locale,
			),
		).toThrowError(
			expect.objectContaining({
				code: "private-choice-practice-only",
				blockId: "private-id",
				messageRef: { key: "grammar.v4.private-choice-practice-only", args: {} },
				message:
					locale === "fr"
						? "Un choix privé doit être facultatif, sans score, hors des groupes d’évaluations et sans condition de progression."
						: "A private choice must be optional, unscored, outside assessment groups and without a gate.",
			}),
		);
	});
	it("refuses every HTML entry before rendering configuration, independent of completion settings", () => {
		const cfg = config([unsupportedContainer]);
		const expected = expect.objectContaining({
			code: "unsupported-runtime",
			blockId: "private-id",
			referencePath: "pages[0].blocks[0].data.items[0].blocks[0].data.private",
		});
		for (const call of [
			() => prepareHtmlCourse(cfg),
			() => renderPageFragments({ ...cfg, pages: [] }, cfg.pages[0], new Set()),
			() =>
				generateHtmlPage({
					config: { ...cfg, pages: [] },
					page: cfg.pages[0],
					index: 0,
					currentSlug: "page",
					slugList: [],
					slugMap: new Map(),
				}),
			() => renderPageFragments(cfg, cfg.pages[0], new Set()),
			() =>
				generateHtmlPage({
					config: cfg,
					page: cfg.pages[0],
					index: 0,
					currentSlug: "page",
					slugList: [],
					slugMap: new Map(),
				}),
		])
			expect(call).toThrowError(expected);
	});
	it.each(["en", "fr"])(
		"refuses real preview contexts and HTML/SCORM package preparation in %s",
		async (locale) => {
			const course = {
				id: "course",
				title: "Course",
				sourceLocale: locale,
				content: [page([unsupportedContainer])],
			};
			const expected = {
				code: "unsupported-runtime",
				message:
					locale === "fr"
						? "Un choix privé nécessite une sélection explicite à réponse unique et un stockage sur l’appareil uniquement."
						: "A private choice needs explicit single-answer selection and device-only storage.",
			};
			await expect(createCourseContext(course)).rejects.toMatchObject(expected);
			for (const format of ["html", "scorm12", "scorm2004"] as const)
				await expect(buildScormPackage(course, { mode: "source", format })).rejects.toMatchObject(
					expected,
				);
		},
	);
	it("renders a valid private draft when its existing preview context already admits the device policy", async () => {
		const context = await createCourseContext({
			id: "course",
			title: "Course",
			sourceLocale: "en",
			content: [page([privateChoice])],
		});
		const fragment = renderNode(context, "page", "private-id", privateChoice);
		expect(fragment.html).toContain(
			"Your answers stay in this browser and aren’t sent to the LMS.",
		);
		expect(fragment.html).toContain("data-practice-status");
	});
	it("refuses a private draft substituted into an ordinary preview", async () => {
		const publicChoice = {
			...privateChoice,
			data: { ...privateChoice.data, private: false },
		};
		const context = await createCourseContext({
			id: "course",
			title: "Course",
			sourceLocale: "en",
			content: [page([publicChoice])],
		});
		expect(() => renderNode(context, "page", "private-id", privateChoice)).toThrowError(
			expect.objectContaining({ code: "private-choice-practice-only" }),
		);
	});
});

it("keeps absent/false choice policy and free-response private storage and output byte-identical", () => {
	for (const privacy of [undefined, false]) {
		const block = { ...privateChoice, data: { ...privateChoice.data, private: privacy } };
		expect(compileBlockStatePolicy([block])).toEqual({});
	}
	let next = 0;
	const read = readLesson(
		"# P\n::: free-response Reflect {private}\nWrite **freely**.\nplaceholder: Your answer\n:::\n",
		{ ids: () => `id-${next++}` },
	);
	expect(read.hasErrors).toBe(false);
	const policy = compileBlockStatePolicy(read.blocks);
	expect(policy).toEqual({});
	const raw =
		'{ "blockState": { "reflection": { "answer": "PRIVATE RESPONSE", "checked": true } }, "interactions": [] }';
	expect(filterPrivateSuspendData(raw, policy)).toBe(raw);
	const block = read.blocks.find((block) => block.type === "assessment");
	if (!block) throw new Error("Missing free-response fixture");
	expect(createHash("sha256").update(renderBlockHtml(block)).digest("hex")).toBe(
		"c46ad2e7606b90003ab6d9d261e63306ca289edd89d8d1b6624d9102394035c3",
	);
});

it.each(["choice", "container", "nested container"])(
	"keeps the existing private %s refusal when only deckGate is authored",
	(kind) => {
		const target =
			kind === "choice"
				? privateChoice
				: kind === "container"
					? container
					: {
							...container,
							id: "ancestor-id",
							data: { items: [{ blocks: [container] }] },
						};
		const block = { ...target, data: { ...target.data, deckGate: "attempt" } };
		const cfg = config([block]);
		expect(() => assertPracticeLogic(cfg.pages)).not.toThrow();
		for (const call of [
			() => prepareHtmlCourse(cfg),
			() => renderPageFragments(cfg, cfg.pages[0], new Set()),
			() =>
				generateHtmlPage({
					config: cfg,
					page: cfg.pages[0],
					index: 0,
					currentSlug: "page",
					slugList: [],
					slugMap: new Map(),
				}),
		])
			expect(call).toThrowError(
				expect.objectContaining({ code: "private-choice-practice-only", blockId: "private-id" }),
			);
	},
);

it.each([
	["required", { required: true }],
	["pass gate", { deckGate: "pass" }],
	["legacy gate", { _deckGate: "attempt" }],
] as const)(
	"refuses a compiled private choice under a %s ancestor at every HTML entry",
	(_name, settings) => {
		for (const position of ["direct", "outer", "inner"]) {
			const constrained = { ...container, data: { ...container.data, ...settings } };
			const block =
				position === "direct"
					? constrained
					: {
							...container,
							id: "ancestor-id",
							data: {
								...(position === "outer" ? settings : {}),
								items: [{ blocks: [position === "outer" ? container : constrained] }],
							},
						};
			const cfg = config([block]);
			for (const call of [
				() => prepareHtmlCourse(cfg),
				() => renderPageFragments({ ...cfg, pages: [] }, cfg.pages[0], new Set()),
				() =>
					generateHtmlPage({
						config: { ...cfg, pages: [] },
						page: cfg.pages[0],
						index: 0,
						currentSlug: "page",
						slugList: [],
						slugMap: new Map(),
					}),
			])
				expect(call).toThrowError(
					expect.objectContaining({ code: "private-choice-practice-only", blockId: "private-id" }),
				);
		}
	},
);

it("keeps optional private containers publishable beside an unrelated gated container", () => {
	const publicChoice = {
		...privateChoice,
		id: "public-id",
		data: { ...privateChoice.data, private: false },
	};
	const publicContainer = {
		...container,
		id: "public-container",
		data: { required: true, deckGate: "attempt", items: [{ blocks: [publicChoice] }] },
	};
	const cfg = config([
		publicContainer,
		{ ...container, id: "ancestor-id", data: { items: [{ blocks: [container] }] } },
	]);
	for (const call of [
		() => prepareHtmlCourse(cfg),
		() => renderPageFragments(cfg, cfg.pages[0], new Set(["assessment", "accordion", "nav"])),
		() =>
			generateHtmlPage({
				config: cfg,
				page: cfg.pages[0],
				index: 0,
				currentSlug: "page",
				slugList: [],
				slugMap: new Map(),
				islandAssets: {
					loaderFilename: "loader.js",
					islandFilenames: {
						assessment: "assessment.js",
						accordion: "accordion.js",
						nav: "nav.js",
					},
				},
			}),
	])
		expect(call).not.toThrow();
});
