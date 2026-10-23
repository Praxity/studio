import { readLesson } from "@praxity/grammar";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { useGrammarDocumentStore } from "../grammar-document-store";
import { useAuditData } from "./use-audit-data";

afterEach(() => {
	cleanup();
	useGrammarDocumentStore.setState({ grammarSource: "", parsedBlocks: [], parsedSpans: new Map() });
});

const source =
	"---\ntitle: Practice\n---\n# Practice\n::: self-check Explain the delay.\nmodel: The data arrived late.\n:: Reason\nmissed: Try again.\nevidence: data arrived late\n:::\n";

it.each([
	["en", en, "Lesson has no title", "Add title: to the lesson frontmatter."],
	["fr", fr, "La leçon n'a pas de titre", "Ajoutez title: aux métadonnées de la leçon."],
])("Check reports the untitled file and fix hint in %s", (locale, messages, title, description) => {
	const read = readLesson("# Read\n\nBody\n");
	useGrammarDocumentStore.setState({
		parseError: null,
		grammarSource: "# Read\n\nBody\n",
		frontmatter: read.frontmatter,
		parsedBlocks: read.blocks,
		parsedSpans: read.spans,
	});
	const { result } = renderHook(() => useAuditData({ lessonFilename: "draft.prax" }), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<IntlProvider locale={locale} messages={messages}>
				{children}
			</IntlProvider>
		),
	});
	expect(result.current.issues.filter((issue) => issue.rule === "lesson-title")).toMatchObject([
		{
			title,
			description,
			documentId: "draft.prax",
			displaySeverity: "minor",
			isFallback: false,
		},
	]);
});

it.each([
	[
		"en",
		en,
		"Hint needs a next step",
		"A hint repeats the criterion or only asks the learner to try again. Explain what to add or change.",
	],
	[
		"fr",
		fr,
		"Indice sans prochaine étape",
		"Un indice répète le critère ou demande seulement de réessayer. Expliquez quoi ajouter ou modifier.",
	],
])(
	"shows localized source advice in %s and refreshes hidden edits",
	(locale, messages, title, description) => {
		const read = readLesson(source);
		useGrammarDocumentStore.setState({
			grammarSource: source,
			parsedBlocks: read.blocks,
			parsedSpans: read.spans,
			frontmatter: { title: "Practice" },
			parseError: null,
		});
		const { result } = renderHook(() => useAuditData(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<IntlProvider locale={locale} messages={messages}>
					{children}
				</IntlProvider>
			),
		});
		expect(result.current.issues).toHaveLength(1);
		expect(result.current.issues[0]).toMatchObject({
			rule: "self-check-hint-actionable",
			title,
			description,
			isFallback: false,
			blockId: read.blocks.find((block) => block.type === "selfCheck")?.id,
		});
		expect(JSON.stringify(result.current.issues)).not.toContain("The data arrived late.");
		act(() =>
			useGrammarDocumentStore
				.getState()
				.setGrammarSource(source.replace("Try again.", "Explain the cause.")),
		);
		expect(result.current.issues).toEqual([]);
		// Prompt blocks and their editor identities did not need to change.
		expect(useGrammarDocumentStore.getState().parsedBlocks).toBe(read.blocks);
	},
);

it("uses each document's explicit source without leaking hidden fields into pages", () => {
	const read = readLesson(source);
	const documents = [
		{ id: "lesson.prax", title: "Practice", blocks: read.blocks, selfCheckSource: { read } },
	];
	const { result } = renderHook(() => useAuditData({ documents }), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<IntlProvider locale="en" messages={en}>
				{children}
			</IntlProvider>
		),
	});
	expect(result.current.issues).toHaveLength(1);
	expect(result.current.issues[0]).toMatchObject({
		rule: "self-check-hint-actionable",
		documentId: "lesson.prax",
		isFallback: false,
	});
	expect(JSON.stringify(read.pages)).not.toMatch(/The data arrived late|Try again|Reason/);
});

it.each([
	[
		"en",
		en,
		"This wrong option matches the right answer. Review it.",
		"Keep the wrong option to 300 Unicode code points or fewer.",
	],
	[
		"fr",
		fr,
		"Cette mauvaise réponse correspond à la bonne réponse. Revoyez-la.",
		"Limitez la mauvaise réponse à 300 points de code Unicode.",
	],
] as const)(
	"Check reuses exact grammar copy in %s and refreshes hidden-only edits",
	(locale, messages, warning, limit) => {
		const text =
			"---\ntitle: Practice\n---\n# Practice\n::: write-distractors Public question\nanswer: HIDDEN_RIGHT\n:: HIDDEN_LABEL\noption: HIDDEN_RIGHT\n:::\n";
		const read = readLesson(text);
		useGrammarDocumentStore.setState({
			parseError: null,
			grammarSource: text,
			frontmatter: read.frontmatter,
			parsedBlocks: read.blocks,
			parsedSpans: read.spans,
		});
		const { result } = renderHook(() => useAuditData(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<IntlProvider locale={locale} messages={messages}>
					{children}
				</IntlProvider>
			),
		});
		expect(result.current.issues).toEqual([
			expect.objectContaining({
				rule: "write-distractors-author-right",
				description: warning,
				isFallback: false,
			}),
		]);
		expect(JSON.stringify(result.current.issues)).not.toMatch(/HIDDEN_/);
		act(() =>
			useGrammarDocumentStore
				.getState()
				.setGrammarSource(text.replace("option: HIDDEN_RIGHT", "option: HIDDEN_OPTION")),
		);
		expect(result.current.issues).toEqual([]);
		act(() =>
			useGrammarDocumentStore
				.getState()
				.setGrammarSource(
					text.replace("option: HIDDEN_RIGHT", `option: HIDDEN_OPTION${"😀".repeat(301)}`),
				),
		);
		expect(result.current.issues).toEqual([
			expect.objectContaining({
				rule: "practice-option-too-long",
				description: limit,
				isFallback: false,
			}),
		]);
		expect(JSON.stringify(result.current.issues)).not.toMatch(/HIDDEN_/);
	},
);

it.each([
	["en", en, "Write distractors - Unnamed block", "Retrieval sheet - Unnamed block"],
	["fr", fr, "Rédaction de mauvaises réponses - Bloc sans nom", "Fiche de rappel - Bloc sans nom"],
] as const)(
	"Check references localize both practice block names in %s",
	(locale, messages, distractorReference, retrievalReference) => {
		const text =
			"---\ntitle: Practice\n---\n# Practice\n::: write-distractors Public question\nanswer: HIDDEN_RIGHT\n:: HIDDEN_LABEL\noption: HIDDEN_RIGHT\n:::\n::: retrieval-sheet Public sheet\n:: Public recall\nanswer: Public recall\n:::\n";
		const read = readLesson(text);
		useGrammarDocumentStore.setState({
			parseError: null,
			grammarSource: text,
			frontmatter: read.frontmatter,
			parsedBlocks: read.blocks,
			parsedSpans: read.spans,
		});
		const { result } = renderHook(() => useAuditData(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<IntlProvider locale={locale} messages={messages}>
					{children}
				</IntlProvider>
			),
		});
		expect(
			result.current.issues.find((issue) => issue.rule === "write-distractors-author-right")
				?.blockReference,
		).toBe(distractorReference);
		expect(
			result.current.issues.find(
				(issue) => issue.rule === "retrieval-sheet-answer-repeats-question",
			)?.blockReference,
		).toBe(retrievalReference);
		expect(JSON.stringify(result.current.issues)).not.toContain("HIDDEN_");
	},
);
