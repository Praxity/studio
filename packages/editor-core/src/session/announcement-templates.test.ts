// @vitest-environment node

import { readFileSync } from "node:fs";
import { readLesson } from "@praxity/grammar";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { BLOCK_SCHEMA, getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { createTranslator } from "use-intl/core";
import { expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { announcement, nodeNames, operationAnnouncement } from "./index";

it.each(["en", "fr"] as const)("E7 E8 inline commits announce Saved once in %s", (language) => {
	const t = createTranslator({
		locale: language,
		messages: language === "en" ? en : fr,
		onError: (error) => {
			throw error;
		},
	});
	const result = {
		ok: true as const,
		transactionId: "inline",
		files: [],
		intent: "modify" as const,
		mapping: [],
		inverse: { files: [], mapping: [], guards: [] },
		diagnostics: [],
		summary: { key: "op.editInline" as const, params: { count: 4 } },
		focus: { file: "a.prax", nodeId: "a", role: "handle" as const },
	};
	const message = operationAnnouncement("editInline", result, {}, { platform: "windows" }, (ref) =>
		t(ref.key, ref.params),
	);
	expect(t(message.key, message.params)).toBe(language === "en" ? "Saved." : "Enregistré.");
	expect(t("op.editInline")).toBe(
		language === "en"
			? "edited a link or glossary term"
			: "modifié un lien ou un terme du glossaire",
	);
	expect(t("session.actions.editInline")).toBe(language === "en" ? "save" : "enregistrer");
});

const params = {
	name: "Paragraph: Alpha",
	type: "Note",
	parent: "page Bonjour",
	oldParent: "Column 1 of 2",
	prevName: "Note: Before",
	nextName: "Note: After",
	pos: "2 of 3",
	losses: "back face",
	n: 2,
	count: 2,
	first: 2,
	last: 3,
	total: 4,
	name1: "Note: One",
	name2: "Note: Two",
	more: 1,
	otherName: "Note: Other",
	leftName: "Note: Left",
	key: "Tone",
	value: "Warning",
	narration: "Recording removed.",
	closedSuggestions: 2,
	retiredCuts: 2,
	summary: "moved blocks",
	action: "move",
	reason: "changed outside",
	message: "bad value",
	destination: "Before Note: Before",
	runName: "Check",
	p: 1,
	pages: "page 3, page 5",
	ancestorName: "Column 1 of 2",
};
const snapshots: Record<string, readonly [string, string]> = {
	saved: ["Saved.", "Enregistré."],
	savedInvalid: [
		"Saved with an error on line 2: bad value. This block won't publish until it's fixed.",
		"Enregistré avec une erreur à la ligne 2 : bad value. Ce bloc ne sera pas publié avant correction.",
	],
	notSaved: [
		"Not saved: bad value. Your draft is kept.",
		"Non enregistré : bad value. Votre brouillon est conservé.",
	],
	moved: [
		"Moved up. 2 of 3 in page Bonjour. After Note: Before. Before Note: After.",
		"Déplacé vers le haut. 2 of 3 dans page Bonjour. Après Note: Before. Avant Note: After.",
	],
	movedOut: [
		"Moved out of Column 1 of 2. 2 of 3 in page Bonjour. After Note: Before. Before Note: After.",
		"Sorti de Column 1 of 2. 2 of 3 dans page Bonjour. Après Note: Before. Avant Note: After.",
	],
	deleted: [
		"Deleted Paragraph: Alpha. Undo with Control Z.",
		"Paragraph: Alpha supprimé. Annuler avec Contrôle Z.",
	],
	inserted: ["New Note after Note: Before.", "Nouveau Note après Note: Before."],
	duplicated: ["Duplicated Paragraph: Alpha.", "Paragraph: Alpha dupliqué."],
	converted: [
		"Turned into Note. Dropped: back face. Undo with Control Z.",
		"Transformé en Note. Retiré : back face. Annuler avec Contrôle Z.",
	],
	selected: ["2 blocks selected.", "2 blocs sélectionnés."],
	selectionRemoved: [
		"Removed from selection. 2 blocks selected.",
		"Retiré de la sélection. 2 blocs sélectionnés.",
	],
	selectionPinned: [
		"Paragraph: Alpha selected. Move to other blocks and press Shift Space to add them.",
		"Paragraph: Alpha sélectionné. Allez sur d'autres blocs et appuyez sur Maj Espace pour les ajouter.",
	],
	selectionCleared: ["Selection cleared.", "Sélection effacée."],
	grabPicked: [
		"Picked up Paragraph: Alpha. Use arrows to choose where, Space to drop, Escape to cancel.",
		"Paragraph: Alpha saisi. Choisissez l'emplacement avec les flèches, Espace pour déposer, Échap pour annuler.",
	],
	grabDestination: [
		"Before Note: Before, in page Bonjour.",
		"Before Note: Before, dans page Bonjour.",
	],
	grabCancelled: ["Move cancelled.", "Déplacement annulé."],
	alreadySelected: [
		"Already selected as part of Column 1 of 2.",
		"Déjà sélectionné dans Column 1 of 2.",
	],
	movedSeveral: [
		"Moved 2 blocks up. 2 to 3 of 4 in page Bonjour. After Note: Before. Before Note: After.",
		"2 blocs déplacés vers le haut. 2 à 3 sur 4 dans page Bonjour. Après Note: Before. Avant Note: After.",
	],
	movedSeveralTo: [
		"Moved 2 blocks to page Bonjour. 2 to 3 of 4.",
		"2 blocs déplacés dans page Bonjour. 2 à 3 sur 4.",
	],
	deletedSeveral: [
		"Deleted 2 blocks: Note: One, Note: Two and 1 more. Undo with Control Z. 2 suggestions in them were closed.",
		"2 blocs supprimés : Note: One, Note: Two et 1 autres. Annuler avec Contrôle Z. 2 suggestions qu'ils contenaient ont été fermées.",
	],
	duplicatedSeveral: ["Duplicated 2 blocks.", "2 blocs dupliqués."],
	severalInColumns: ["Put 2 blocks in 2 columns.", "2 blocs placés sur 2 colonnes."],
	wrapped: ["Wrapped 2 blocks in Note.", "2 blocs regroupés dans Note."],
	convertedSeveral: [
		"Turned 2 blocks into Note. Dropped: back face. Undo with Control Z.",
		"2 blocs transformés en Note. Retiré : back face. Annuler avec Contrôle Z.",
	],
	copied: ["Copied 2 blocks.", "2 blocs copiés."],
	cut: [
		"Cut 2 blocks. Paste to move them. 2 suggestions in them were closed.",
		"2 blocs coupés. Collez-les pour les déplacer. 2 suggestions qu'ils contenaient ont été fermées.",
	],
	pastedMove: [
		"Moved 2 blocks here. After Note: Before.",
		"2 blocs déplacés ici. Après Note: Before.",
	],
	pasted: ["Pasted 2 blocks. After Note: Before.", "2 blocs collés. Après Note: Before."],
	pageInserted: ["New page after Note: Before.", "Nouvelle page apr\u00e8s Note: Before."],
	pageMoved: [
		"2 pages moved. After Note: Before. Before Note: After.",
		"2 pages d\u00e9plac\u00e9es. Apr\u00e8s Note: Before. Avant Note: After.",
	],
	pageDeleted: [
		"2 pages deleted. Undo with Control Z.",
		"2 pages supprim\u00e9es. Annuler avec Contr\u00f4le Z.",
	],
	copiedRetiringCut: [
		"Copied 2 blocks. 2 cut blocks deleted. Recording removed.",
		"2 blocs copi\u00e9s. 2 blocs coup\u00e9s supprim\u00e9s. Recording removed.",
	],
	cutReplacing: [
		"Cut 2 blocks. Paste to move them. 2 suggestions in them were closed. 2 cut blocks deleted. Recording removed.",
		"2 blocs coup\u00e9s. Collez-les pour les d\u00e9placer. 2 suggestions qu'ils contenaient ont \u00e9t\u00e9 ferm\u00e9es. 2 blocs coup\u00e9s supprim\u00e9s. Recording removed.",
	],
	cutDropped: [
		"2 cut blocks deleted. Recording removed.",
		"2 blocs coupés supprimés. Recording removed.",
	],
	suggestionsClosed: [
		"2 suggestions in them were closed.",
		"2 suggestions qu'ils contenaient ont été fermées.",
	],
	merged: ["Joined with Note: Before.", "Fusionné avec Note: Before."],
	inColumns: [
		"Put in two columns with Note: Other. Left column: Note: Left.",
		"Placé sur deux colonnes avec Note: Other. Colonne de gauche : Note: Left.",
	],
	columnsRemoved: [
		"Columns removed. 2 blocks kept in order.",
		"Colonnes retirées. 2 blocs conservés dans l'ordre.",
	],
	columnsResized: ["Column widths changed.", "Largeurs des colonnes modifiées."],
	helperApplied: ["Tone set to Warning.", "Tone : Warning."],
	undone: ["Undid: moved blocks.", "Annulé : moved blocks."],
	redone: ["Redid: moved blocks.", "Rétabli : moved blocks."],
	refused: ["Can't move: changed outside.", "Impossible de move : changed outside."],
	helperStale: [
		"This value changed while the helper was open. Nothing was applied.",
		"Cette valeur a changé pendant que l'assistant était ouvert. Rien n'a été appliqué.",
	],
	nothingInField: [
		"Nothing more to undo in this block. Leave the block to undo earlier changes.",
		"Rien d'autre à annuler dans ce bloc. Quittez le bloc pour annuler les modifications précédentes.",
	],
	accepted: [
		"Accepted. 2 suggestions left on this page.",
		"Acceptée. Il reste 2 suggestions sur cette page.",
	],
	rejected: [
		"Rejected. 2 suggestions left on this page.",
		"Refusée. Il reste 2 suggestions sur cette page.",
	],
	runArrived: ["Check: 2 suggestions on 1 page.", "Check : 2 suggestions sur 1 page."],
	focusedRemoved: [
		"The block you were on was removed outside the editor. Now on Paragraph: Alpha.",
		"Le bloc sélectionné a été supprimé hors de l'éditeur. Vous êtes sur Paragraph: Alpha.",
	],
	focusedDraftRemoved: [
		"This block was removed outside the editor. Your draft is kept.",
		"Ce bloc a été supprimé hors de l'éditeur. Votre brouillon est conservé.",
	],
	draftsRestored: [
		"2 unsaved drafts restored: page 3, page 5.",
		"2 brouillons non enregistrés restaurés : page 3, page 5.",
	],
	compileFailed: [
		"Page preview is out of date: bad value. Your text is saved.",
		"L'aperçu de la page n'est pas à jour : bad value. Votre texte est enregistré.",
	],
	itemAdded: ["New Note.", "Nouveau Note."],
	itemRemoved: [
		"Deleted Paragraph: Alpha. Undo with Control Z.",
		"Paragraph: Alpha supprimé. Annuler avec Contrôle Z.",
	],
};

it("A2 A4 A8: every template has an English and French literal snapshot", () => {
	expect(Object.keys(snapshots).sort()).toEqual(Object.keys(en.session.announcements).sort());
	expect(Object.keys(snapshots).sort()).toEqual(Object.keys(fr.session.announcements).sort());
	for (const [language, index] of [
		["en", 0],
		["fr", 1],
	] as const) {
		const t = createTranslator({
			locale: language,
			messages: language === "en" ? en : fr,
			onError: (error) => {
				throw error;
			},
		});
		for (const [event, expected] of Object.entries(snapshots)) {
			const message = announcement(event, { ...params, undo: t("session.undoHint.windows") });
			expect(t(message.key, message.params), `${event}/${language}`).toBe(expected[index]);
		}
	}
});

it("A2 G6 G7 G10: selection nouns, descriptions, refusal reasons and omitted drafts have bilingual literal snapshots", () => {
	const cases: [string, Record<string, string | number>, string, string][] = [
		["session.selection.description", {}, "Selected", "Sélectionné"],
		["session.selection.dragLabel", { n: 2, kind: "block" }, "2 blocks", "2 blocs"],
		["session.selection.dragLabel", { n: 1, kind: "item" }, "1 item", "1 élément"],
		["session.selection.dragLabel", { n: 2, kind: "page" }, "2 pages", "2 pages"],
		[
			"session.reasons.crossPageMove",
			{},
			"move up and down need blocks on the same page. Use Move to",
			"les déplacements vers le haut et le bas nécessitent des blocs sur la même page. Utilisez Déplacer vers",
		],
		[
			"session.reasons.neighbourMove",
			{},
			"move up and down need neighbouring blocks. Use Move to",
			"les déplacements vers le haut et le bas nécessitent des blocs voisins. Utilisez Déplacer vers",
		],
		[
			"session.reasons.adjacentSelection",
			{},
			"Select neighbouring blocks with the same parent",
			"Sélectionnez des blocs voisins dans le même conteneur",
		],
		[
			"session.reasons.selectionDraft",
			{ name: "Paragraph: Alpha" },
			"finish or discard the draft in Paragraph: Alpha first",
			"terminez ou abandonnez le brouillon dans Paragraph: Alpha avant de continuer",
		],
		["session.reasons.emptySelection", {}, "Select a block first", "Sélectionnez d'abord un bloc"],
		["session.actions.copy", {}, "copy", "copier"],
		[
			"op.selectionMember",
			{ name: "Paragraph: Alpha", reason: "changed" },
			"Paragraph: Alpha: changed",
			"Paragraph: Alpha: changed",
		],
		[
			"session.announcements.selected",
			{ n: 1, kind: "item" },
			"1 item selected.",
			"1 élément sélectionné.",
		],
		[
			"session.announcements.selected",
			{ n: 2, kind: "page" },
			"2 pages selected.",
			"2 pages sélectionnées.",
		],
		[
			"session.announcements.selectionRemoved",
			{ n: 0, kind: "item" },
			"Removed from selection. 0 items selected.",
			"Retiré de la sélection. 0 élément sélectionné.",
		],
		[
			"session.announcements.copied",
			{ n: 2, draftName: "Paragraph: Alpha" },
			"Copied 2 blocks. The draft in Paragraph: Alpha isn't included.",
			"2 blocs copiés. Le brouillon dans Paragraph: Alpha n'est pas inclus.",
		],
	];
	for (const language of ["en", "fr"] as const) {
		const t = createTranslator({
			locale: language,
			messages: language === "en" ? en : fr,
			onError: (error) => {
				throw error;
			},
		});
		for (const [key, values, english, french] of cases)
			expect(t(key, values), key).toBe(language === "en" ? english : french);
	}
});

it("A3: every schema label, part and item label exists in both interfaces", () => {
	for (const language of ["en", "fr"] as const) {
		const t = createTranslator({
			locale: language,
			messages: language === "en" ? en : fr,
			onError: (error) => {
				throw error;
			},
		});
		for (const definition of Object.values(BLOCK_SCHEMA)) {
			expect(t(`session.labels.${definition.labelKey.replaceAll(".", "_")}`)).toBeTruthy();
			for (const key of [
				...Object.values(definition.partLabels),
				...Object.values(definition.itemDefinition?.partLabels ?? {}),
			])
				expect(t(`session.labels.${key.replaceAll(".", "_")}`)).toBeTruthy();
			if (definition.itemDefinition)
				expect(
					t(`session.labels.${definition.itemDefinition.labelKey.replaceAll(".", "_")}`),
				).toBeTruthy();
		}
	}
});

it("A7: result speech does not repeat the name spoken by focus for move, insert, merge and columns", () => {
	const result = {
		ok: true as const,
		transactionId: "t",
		files: [],
		intent: "move" as const,
		mapping: [],
		inverse: { files: [], mapping: [], guards: [] },
		diagnostics: [],
		summary: { key: "op.moveBlocks" as const, params: { count: 1 } },
		focus: { file: "lesson.prax", nodeId: "a", role: "handle" as const },
	};
	const t = createTranslator({
		locale: "en",
		messages: en,
		onError: (error) => {
			throw error;
		},
	});
	for (const operation of [
		"moveBlocks",
		"insertBlock",
		"mergeBlocks",
		"wrapInColumns",
		"unwrapColumns",
	]) {
		const message = operationAnnouncement(
			operation,
			result,
			{ ...params, n: 1 },
			{ platform: "windows" },
			(ref) => t(ref.key, ref.params),
		);
		expect(t(message.key, message.params)).not.toContain("Paragraph: Alpha");
	}
});

it("A8 D4 D9: every grammar diagnostic returned by operations has bilingual interface copy", () => {
	const ids = new Set<string>(["invalid-source"]);
	for (const [path, names] of [
		["../../../grammar/src/v4/lex/types.ts", ["DiagnosticCode"]],
		["../../../grammar/src/v4/tree/types.ts", ["TreeDiagnosticCode", "AnalysisDiagnosticCode"]],
	] as const) {
		const source = readFileSync(new URL(path, import.meta.url), "utf8");
		for (const name of names) {
			const union = source.slice(source.indexOf(`export type ${name} =`)).split(";")[0];
			for (const match of union.matchAll(/"([a-z0-9-]+)"/gu)) ids.add(match[1]);
		}
	}
	expect(ids.size).toBeGreaterThan(40);
	for (const language of ["en", "fr"] as const) {
		const t = createTranslator({
			locale: language,
			messages: language === "en" ? en : fr,
			onError: (error) => {
				throw error;
			},
		});
		for (const code of ids)
			expect(
				t(`op.diagnostic.${code}`, {
					line: 3,
					column: 1,
					command: "praxity convert",
					name: "model",
					max: 120,
				}),
			).toBeTruthy();
	}
});

it("A3: table headers provide learner excerpts; a complete word ending at character 40 is kept", () => {
	const text = "Four beta gamma delta epsilon zeta theta";
	expect(text.length).toBe(40);
	const tree = analyzeLessonTree(
		tokenizeLesson(
			`# Lesson\n\n${text} afterwards\n\n::: table\n| Safety equipment | Value |\n| --- | --- |\n| Helmet | 1 |\n:::\n`,
		),
		{ definition: getDefinition },
	);
	const t = createTranslator({
		locale: "en",
		messages: en,
		onError: (error) => {
			throw error;
		},
	});
	const names = nodeNames(tree.root, (key, values) => t(key, values));
	const values = [...names.values()];
	expect(values).toContain(`Paragraph: ${text}`);
	expect(values).toContain("Table: Safety equipment");
});

it.each([
	["Write @icon{mail}.", "Write @icon{mail}."],
	["Write [Term]{Definition}.", "Write [Term]{Definition}."],
	["Write **bold**.", "Write **bold**."],
	["Write \\[Term\\]\\{Definition\\}.", "Write [Term]{Definition}."],
])("node names preserve decoded literal task and criterion syntax: %s", (source, expected) => {
	const lesson = readLesson(
		`# Practice\n::: self-check ${source}\nmodel: Model\n:: ${source}\nmissed: Hint\n:::\n`,
	);
	const t = createTranslator({
		locale: "en",
		messages: en,
		onError: (error) => {
			throw error;
		},
	});
	const names = nodeNames(lesson.tree.root, (key, values) => t(key, values));
	const block = lesson.tree.root.children[0].children[0];
	const criterion = block.children.find((child) => child.kind === "item");
	expect([names.get(block), criterion && names.get(criterion)]).toEqual([
		`Self-check: ${expected}`,
		`Criterion 1 of 1: ${expected}`,
	]);
});

it.each([
	["en", ["What to add, plain text: Add a date", "Model evidence, plain text: Tuesday"]],
	["fr", ["Éléments à ajouter, texte brut: Add a date", "Extrait du modèle, texte brut: Tuesday"]],
] as const)("self-check criterion parts use their own labels in %s", (language, expected) => {
	const t = createTranslator({
		locale: language,
		messages: language === "en" ? en : fr,
		onError: (error) => {
			throw error;
		},
	});
	const tree = analyzeLessonTree(
		tokenizeLesson(
			"# P\n::: self-check Task\nmodel: Tuesday\n:: Date\nmissed: Add a date\nevidence: Tuesday\n:::\n",
		),
		{ definition: getDefinition },
	);
	const names = nodeNames(tree.root, (key, values) => t(key, values));
	const criterion = tree.root.children[0].children[0].children[1];
	expect(criterion.children.map((part) => names.get(part))).toEqual(expected);
});

it.each([
	["en", "Navigation: hidden"],
	["fr", "Navigation: hidden"],
] as const)("a page nav: part uses its declared label in %s", (language, expected) => {
	const t = createTranslator({
		locale: language,
		messages: language === "en" ? en : fr,
		onError: (error) => {
			throw error;
		},
	});
	const tree = analyzeLessonTree(tokenizeLesson("# P\nnav: hidden\n"), {
		definition: getDefinition,
	});
	const names = nodeNames(tree.root, (key, values) => t(key, values));
	const nav = tree.root.children[0].children[0];
	expect(names.get(nav)).toBe(expected);
});

it("D20: replacing a cut record announces retirement in the same bilingual result", () => {
	const result = {
		ok: true as const,
		transactionId: "t",
		files: [],
		intent: "copy" as const,
		mapping: [],
		inverse: { files: [], mapping: [], guards: [] },
		diagnostics: [],
		summary: { key: "op.copyBlocks" as const, params: { count: 1, retiredCuts: 2 } },
		focus: { file: "lesson.prax", nodeId: "a", role: "handle" as const },
	};
	for (const language of ["en", "fr"] as const) {
		const t = createTranslator({
			locale: language,
			messages: language === "en" ? en : fr,
			onError: (error) => {
				throw error;
			},
		});
		const message = operationAnnouncement(
			"copyBlocks",
			result,
			{},
			{ platform: "windows" },
			(ref) => t(ref.key, ref.params),
		);
		expect(t(message.key, message.params)).toBe(
			language === "en"
				? "Copied 1 block. 2 cut blocks deleted."
				: "1 bloc copi\u00e9. 2 blocs coup\u00e9s supprim\u00e9s.",
		);
	}
});
