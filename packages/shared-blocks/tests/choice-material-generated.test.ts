import { setImmediate } from "node:timers/promises";
import type { InlineIconCatalogs } from "@praxity/content-model/inline-icons";
import { materialInlineTree, renderInlineTree } from "@praxity/content-model/inline-tree";
import { afterEach, expect, it } from "vitest";
import {
	choiceContentSignature,
	choiceMaterialContent,
	choiceStateQuestion,
} from "../src/assessment-choice";
import { assessmentMaterialContent } from "../src/assessment-content";
import { compiled, fieldQuestion, producers } from "./fixtures/choice-material";
import { type IconField, preparedIconQuestion } from "./fixtures/choice-material-icons";

// Let jsdom finish queued document work so each case's detached DOM can be collected.
afterEach(() => setImmediate());

type Tree =
	| { kind: "text" | "code"; text: string }
	| { kind: "link" | "strike" | "strong" | "emphasis"; children: Tree[] };
type Position = { path: number[]; boundary: number } | { path: number[]; character: number };
function generate(seed: number): Tree {
	let state = seed >>> 0;
	const random = (limit: number) => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state % limit;
	};
	const kinds = ["link", "strike", "strong", "emphasis"] as const;
	const branch = (depth: number, ancestors: string[]): Tree => {
		if (!depth || random(3) === 0)
			return { kind: "text", text: ["Alpha", "Café", "世界", "Oui"][random(4)] };
		const allowed = kinds.filter(
			(kind) => !ancestors.includes(kind) && !(ancestors.includes("emphasis") && kind === "strong"),
		);
		if (!allowed.length) return { kind: "text", text: "Leaf" };
		const kind = allowed[random(allowed.length)];
		return {
			kind,
			children: [
				{ kind: "text", text: "Inner" },
				...Array.from({ length: 1 + random(2) }, () => branch(depth - 1, [...ancestors, kind])),
				{ kind: "text", text: "tail" },
			],
		};
	};
	const kind = seed % 2 ? "link" : "strike";
	return {
		kind,
		children: [
			{ kind: "text", text: "Anchor" },
			branch(1 + (seed % 3), [kind]),
			{ kind: "code", text: "a  b @source{literal}" },
		],
	};
}
function positions(tree: Tree, path: number[] = []): Position[] {
	if (tree.kind === "code") return [];
	if (tree.kind === "text")
		return Array.from({ length: Math.max(0, tree.text.length - 1) }, (_, character) => ({
			path,
			character: character + 1,
		}));
	return [
		...Array.from({ length: tree.children.length + 1 }, (_, boundary) => ({ path, boundary })),
		...tree.children.flatMap((child, index) => positions(child, [...path, index])),
	];
}
function render(tree: Tree, position?: Position, insertion = "", path: number[] = []): string {
	const here = position && JSON.stringify(path) === JSON.stringify(position.path);
	if (tree.kind === "code") return `\`${tree.text}\``;
	if (tree.kind === "text")
		return here && "character" in position
			? tree.text.slice(0, position.character) + insertion + tree.text.slice(position.character)
			: tree.text;
	const values = tree.children.map((child, index) =>
		render(child, position, insertion, [...path, index]),
	);
	if (here && "boundary" in position) values.splice(position.boundary, 0, insertion);
	const inner = values.join(" ");
	switch (tree.kind) {
		case "link":
			return `[${inner}](https://example.org)`;
		case "strike":
			return `~~${inner}~~`;
		case "strong":
			return `**${inner}**`;
		case "emphasis":
			return `*${inner}*`;
	}
}

for (const producer of producers)
	for (let seed = 1; seed <= 16; seed++) {
		const tree = generate(seed),
			plain = render(tree);
		for (const [index, position] of positions(tree).entries())
			it(`${producer.name} insertion seed ${seed} position ${index}`, () => {
				const pristine = fieldQuestion(plain, "stem", producer);
				const before = choiceStateQuestion(pristine, false),
					beforeHash = choiceContentSignature(pristine, false);
				for (const ancillary of [
					producer.note,
					`${producer.note}${producer.note}`,
					producer.sources,
					"==Aside==",
					"@circle{Aside}",
					"[Aside]{Definition}",
				]) {
					// Grammar's list token requires a word boundary; an interior spelling is literal text.
					if (
						producer.name === "grammar" &&
						ancillary === producer.sources &&
						"character" in position
					)
						continue;
					const source = render(tree, position, ancillary),
						context = JSON.stringify({ seed, tree, position, ancillary, source });
					const decorated = fieldQuestion(source, "stem", producer);
					expect(choiceStateQuestion(decorated, false), context).toEqual(before);
					expect(choiceContentSignature(decorated, false), context).toBe(beforeHash);
					const erased = materialInlineTree(producer.parse(source), true);
					expect(choiceMaterialContent(erased ? renderInlineTree(erased) : ""), context).toEqual(
						choiceMaterialContent(renderInlineTree(producer.parse(plain))),
					);
					// Serialization must preserve the producer's ownership through page preparation.
					if (producer.name === "grammar")
						expect(choiceContentSignature(compiled(source), false), context).toBe(
							choiceContentSignature(compiled(plain), false),
						);
					else
						expect(choiceContentSignature(compiled("Pick", "", source), false), context).toBe(
							choiceContentSignature(compiled("Pick", "", plain), false),
						);
				}
				const mutated = structuredClone(tree);
				if (!("children" in mutated) || mutated.children[0].kind !== "text")
					throw new Error("Missing retained mutation word");
				mutated.children[0].text = "Changed";
				const changed = fieldQuestion(render(mutated, position, producer.note), "stem", producer);
				expect(
					choiceStateQuestion(changed, false),
					JSON.stringify({ seed, tree, position }),
				).not.toEqual(before);
				expect(choiceContentSignature(changed, false)).not.toBe(beforeHash);
			});
	}

for (const producer of producers)
	for (const seed of [1, 2, 3])
		it.each(["@source{Note}", "@footer{Note}", "@sources", "@footer.insert"])(
			`${producer.name} valid material spelling seed ${seed}: %s`,
			(note) => {
				const tree = generate(seed),
					plain = render(tree);
				const expected = choiceContentSignature(fieldQuestion(plain, "stem", producer), false);
				const expectedCompiled = choiceContentSignature(compiled("Pick", "", plain), false);
				for (const position of positions(tree)
					.filter((position) => note.endsWith("}") || !("character" in position))
					.slice(0, 8)) {
					const source = render(tree, position, note);
					expect(choiceContentSignature(fieldQuestion(source, "stem", producer), false)).toBe(
						expected,
					);
					expect(choiceContentSignature(compiled("Pick", "", source), false)).toBe(
						expectedCompiled,
					);
				}
			},
		);

it.each(producers)("$name inserts into a pristine empty inline sequence", (producer) => {
	const empty = producer.parse("");
	expect(choiceMaterialContent(renderInlineTree(empty))).toEqual([]);
	for (const source of [
		producer.note,
		producer.sources,
		`${producer.note} ${producer.sources}`,
		`**${producer.note}**`,
	]) {
		const material = materialInlineTree(producer.parse(source));
		expect(material ? renderInlineTree(material) : "").toBe("");
		expect(choiceMaterialContent(material ? renderInlineTree(material) : "")).toEqual(
			choiceMaterialContent(renderInlineTree(empty)),
		);
	}
});

// Existing wrappers are part of the pristine tree. The amendment drops partial
// marks, keeps whole stem/label words, and always drops definition bodies.
for (const producer of producers)
	for (let seed = 1; seed <= 18; seed++) {
		const kinds = ["highlight", "doodle", "term"] as const;
		const kind = kinds[(seed - 1) % 3];
		const container = seed % 2 ? "link" : "strike";
		const word = ["Yes", "Café", "世界"][seed % 3];
		const mark = (text: string, definition = "Definition") =>
			kind === "highlight"
				? `==${text}==`
				: kind === "doodle"
					? `@circle{${text}}`
					: `[${text}]{${definition}}`;
		const wrap = (text: string) =>
			container === "link" ? `[${text}](https://x.test)` : `~~${text}~~`;
		const tree = {
			kind: container,
			children: [{ kind, children: [{ kind: "text", text: word }] }],
		};
		for (const field of ["stem", "option"] as const)
			it(`${producer.name} existing whole mark seed ${seed} ${field}`, () => {
				const pristine = fieldQuestion(wrap(mark(word)), field, producer);
				const expected = choiceStateQuestion(pristine, false);
				for (const source of [
					wrap(`${producer.note} ${mark(word)}`),
					wrap(`${producer.note} ${producer.note} ${mark(word)} ${producer.note}`),
					wrap(
						`${producer.note} ${mark(`${producer.note} ${word} ${producer.note}`)} ${producer.note}`,
					),
					wrap(`**${mark(word)}**`),
					wrap(mark(word, "Edited definition")),
				]) {
					const context = JSON.stringify({ seed, tree, field, source });
					const decorated = fieldQuestion(source, field, producer);
					expect(choiceStateQuestion(decorated, false), context).toEqual(expected);
					expect(choiceContentSignature(decorated, false), context).toBe(
						choiceContentSignature(pristine, false),
					);
					if (
						(producer.name === "grammar" && field === "stem") ||
						(producer.name === "display" && field === "option")
					) {
						const read = (value: string) =>
							field === "stem" ? compiled(value) : compiled("Pick", "", value);
						expect(choiceContentSignature(read(source), false), context).toBe(
							choiceContentSignature(read(wrap(mark(word))), false),
						);
					}
				}
				expect(
					choiceContentSignature(fieldQuestion(wrap(mark("Changed")), field, producer), false),
					JSON.stringify({ seed, tree }),
				).not.toBe(choiceContentSignature(pristine, false));
			});
		it(`${producer.name} existing partial mark seed ${seed}`, () => {
			const pristine = fieldQuestion(wrap(`Anchor ${mark(word)} tail`), "stem", producer);
			for (const source of [
				wrap(`Anchor ${mark("Changed", "Edited definition")} tail`),
				wrap(`${producer.note} Anchor ${mark(word)} tail ${producer.note}`),
				wrap(`**Anchor** ${mark(word)} *tail*`),
			])
				expect(
					choiceStateQuestion(fieldQuestion(source, "stem", producer), false),
					JSON.stringify({ seed, tree, source }),
				).toEqual(choiceStateQuestion(pristine, false));
		});
		it(`${producer.name} ancillary paragraph beside whole stem seed ${seed}`, () => {
			const pristine = fieldQuestion(mark(word), "stem", producer);
			const decorated = structuredClone(pristine);
			(decorated.stem as unknown[]).push(
				...(fieldQuestion(producer.note, "description", producer).description as unknown[]),
			);
			expect(choiceStateQuestion(decorated, false), JSON.stringify({ seed, tree })).toEqual(
				choiceStateQuestion(pristine, false),
			);
			expect(choiceContentSignature(decorated, false)).not.toBe(
				choiceContentSignature(fieldQuestion(mark("Changed"), "stem", producer), false),
			);
		});
	}

// Keep the original non-icon corpus; exercise icon names in every container.
for (const producer of producers)
	for (const container of ["link", "strike", "strong", "emphasis"] as const)
		for (const field of ["stem", "description", "option"] as const)
			for (let seed = 1; seed <= 4; seed++)
				it(`${producer.name} generated icon ${container} ${field} seed ${seed}`, () => {
					const wrap = (text: string) =>
						container === "link"
							? `[${text}](https://example.org)`
							: container === "strike"
								? `~~${text}~~`
								: container === "strong"
									? `**${text}**`
									: `*${text}*`;
					const nested = (text: string) =>
						Array.from({ length: seed }, (_, i) => i).reduce(
							(text, i) => (i % 2 ? `~~${text}~~` : `[${text}](https://example.org)`),
							wrap(text),
						);
					const prepare = (source: string, path = "M1 1L2 2") =>
						preparedIconQuestion(producer.name, field, source, {
							outline: { mail: [["path", { d: path }]], phone: [["path", { d: "M1 1L3 3" }]] },
							filled: {},
						});
					const source = wrap(
						`Anchor @icon{mail} ${seed % 2 ? "@icon{phone}" : "@icon{mail}"} tail`,
					);
					const plain = prepare(source);
					const signature = choiceContentSignature(plain, false);
					expect(signature).toMatch(/^sha256:[0-9a-f]{64}$/);
					for (const aside of [producer.note, "==Aside==", "@circle{Aside}", "[Aside]{Definition}"])
						expect(
							choiceContentSignature(
								prepare(
									wrap(
										`Anchor ${aside} @icon{mail} ${seed % 2 ? "@icon{phone}" : "@icon{mail}"} tail`,
									),
								),
								false,
							),
							JSON.stringify({ seed, container, field, source, aside }),
						).toBe(signature);
					expect(choiceContentSignature(prepare(source, "M1 1L8 8"), false)).toBe(signature);
					for (const edited of [
						source.replace("@icon{mail}", "@icon{phone}"),
						source.replace("@icon{mail}", "@icon{mail} @icon{phone}"),
						source.replace("@icon{mail}", ""),
					])
						expect(choiceContentSignature(prepare(edited), false), edited).not.toBe(signature);
					expect(
						choiceContentSignature(
							preparedIconQuestion(producer.name, field, source, { outline: {}, filled: {} }),
							false,
						),
					).toBe(signature);
					expect(
						choiceContentSignature(prepare(source.replace("Anchor", "Changed")), false),
					).not.toBe(signature);
					// Nested names stay independent of catalog resolution too.
					const deeper = prepare(nested("Anchor @icon{mail} tail"));
					expect(choiceContentSignature(deeper, false)).toBe(
						choiceContentSignature(prepare(nested("Anchor @icon{mail} tail"), "M1 1L8 8"), false),
					);
					expect(choiceContentSignature(deeper, false)).not.toBe(
						choiceContentSignature(prepare(nested("Anchor @icon{phone} tail")), false),
					);
				});

const iconCatalogs: InlineIconCatalogs[] = [
	{
		outline: { mail: [["path", { d: "M1 1L2 2" }]], phone: [["path", { d: "M3 3L4 4" }]] },
		filled: {},
	},
	{
		outline: {
			mail: [["path", { d: "M8 8L9 9", fill: "currentColor" }]],
			phone: [["path", { d: "M6 6L7 7" }]],
		},
		filled: {},
	},
	{ outline: {}, filled: {} },
];
const iconMarks = ["highlight", "doodle", "term"] as const;
const markIcon = (kind: (typeof iconMarks)[number], text: string) =>
	kind === "highlight"
		? `==${text}==`
		: kind === "doodle"
			? `@circle{${text}}`
			: `[${text}]{Definition}`;
const nestedIcon = (name: string, depth: number) =>
	Array.from({ length: depth }, (_, index) => index).reduce(
		(text, index) => (index % 2 ? `~~${text}~~` : `[${text}](https://example.org)`),
		`@icon{${name}}`,
	);

for (const producer of producers) {
	const prepare = (field: IconField, source: string, catalog = iconCatalogs[0]) =>
		preparedIconQuestion(producer.name, field, source, catalog);
	for (const kind of iconMarks)
		for (const field of ["stem", "description", "option"] as const)
			for (let seed = 1; seed <= 4; seed++)
				it(`${producer.name} generated marked icon ${kind} ${field} seed ${seed}`, () => {
					const source = (name: string) => markIcon(kind, nestedIcon(name, seed - 1));
					for (const context of ["whole", "partial"] as const) {
						const wrap = (text: string) => (context === "whole" ? text : `Anchor ${text} tail`);
						const signature = (name: string, catalog = iconCatalogs[0]) =>
							choiceContentSignature(prepare(field, wrap(source(name)), catalog), false);
						const first = signature("mail");
						expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
						for (const catalog of iconCatalogs) expect(signature("mail", catalog)).toBe(first);
						if (context === "whole" && field !== "description")
							expect(signature("phone")).not.toBe(first);
						else expect(signature("phone")).toBe(first);
					}
					if (field === "description") {
						const later = (name: string) =>
							choiceContentSignature(prepare(field, `First paragraph.\n\n${source(name)}`), false);
						expect(later("phone")).toBe(later("mail"));
					}
				});
	for (let seed = 1; seed <= 4; seed++) {
		it(`${producer.name} generated heading and body icons seed ${seed}`, () => {
			const data = (heading: string, body: string, catalog = iconCatalogs[0]) => {
				const question = prepare("stem", `Heading @icon{${heading}}`, catalog);
				const later = prepare("stem", `Body ${nestedIcon(body, seed)}`, catalog);
				(question.stem as unknown[]).push(...(later.stem as unknown[]));
				return question;
			};
			const first = data("mail", "phone");
			const material = assessmentMaterialContent(first).stemContent;
			expect(material.heading).toContain('data-praxity-inline-icon="mail"');
			expect(material.body).toContain('data-praxity-inline-icon="phone"');
			const signature = choiceContentSignature(first, false);
			for (const catalog of iconCatalogs)
				expect(choiceContentSignature(data("mail", "phone", catalog), false)).toBe(signature);
			expect(choiceContentSignature(data("phone", "phone"), false)).not.toBe(signature);
			expect(choiceContentSignature(data("mail", "mail"), false)).not.toBe(signature);
		});
		it(`${producer.name} generated later description icon seed ${seed}`, () => {
			const data = (name: string, catalog = iconCatalogs[0]) =>
				prepare("description", `First paragraph.\n\nLater ${nestedIcon(name, seed)}.`, catalog);
			const first = data("mail");
			expect(assessmentMaterialContent(first).descriptionHtml).toContain("</p><p>Later ");
			const signature = choiceContentSignature(first, false);
			for (const catalog of iconCatalogs)
				expect(choiceContentSignature(data("mail", catalog), false)).toBe(signature);
			expect(choiceContentSignature(data("phone"), false)).not.toBe(signature);
		});
		for (const field of ["stem", "description", "option"] as const)
			it(`${producer.name} generated opaque icon ${field} seed ${seed}`, () => {
				const data = (name: string, catalog = iconCatalogs[0]) => {
					const question = prepare(field, `Anchor ${nestedIcon(name, seed)} tail`, catalog);
					const owner =
						field === "option"
							? (question.response as { options: Record<string, unknown>[] }).options[0]
							: (question[field] as { data: Record<string, unknown> }[])[0].data;
					// Legacy HTML can carry display markers without a compiler tree binding.
					delete owner._inlineTrees;
					return question;
				};
				const signature = choiceContentSignature(data("mail"), false);
				expect(signature).toMatch(/^sha256:[0-9a-f]{64}$/);
				expect(choiceContentSignature(data("phone"), false)).not.toBe(signature);
				// Opaque SVG paths follow ordinary learner material, unlike compiler nodes.
				expect(choiceContentSignature(data("mail", iconCatalogs[1]), false)).not.toBe(signature);
				expect(choiceContentSignature(data("mail", iconCatalogs[2]), false)).not.toBe(signature);
			});
	}
}
