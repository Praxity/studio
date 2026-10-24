import { MantineProvider } from "@mantine/core";
import { assessmentOffersDontKnow, validFillBlankSelections } from "@praxity/content-model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
import { choiceContentSignature, choiceStateQuestion } from "../assessment-choice";
import { adaptGrammarPreviewBlocks } from "../grammar-adapter";
import { LocaleContext } from "../i18n/locale-context";
import { preparePageFootnotes } from "../page-footnotes";
import type { AssessmentBlockData, ChoiceResponse, FillBlankResponse } from "../types";
import { PreviewAssessmentBlock } from "./AssessmentBlock";
import auditQuestions from "./free-response-description-audit.json" with { type: "json" };

it("uses the compiled policy while an editor mount retains its local fallback", () => {
	const data: AssessmentBlockData = {
		assessmentType: "choice",
		gradingMode: "none",
		dontKnow: false,
		feedback: {},
		stem: [{ id: "stem", type: "text", data: { content: "Pick" } }],
		response: {
			type: "choice",
			selectionMode: "single",
			inputMethod: "click",
			display: "list",
			shuffle: false,
			options: [
				{ id: "a", label: "Yes" },
				{ id: "b", label: "No" },
			],
		},
	};
	const published = render(
		<PreviewAssessmentBlock
			blockId="published"
			data={data}
			compiledChoiceFacts={{
				question: choiceStateQuestion(data, true),
				signature: choiceContentSignature(data, true),
			}}
		/>,
		{ wrapper: Wrapper },
	);
	expect(screen.getAllByRole("radio")).toHaveLength(3);
	published.unmount();
	render(<PreviewAssessmentBlock blockId="editor" data={data} />, { wrapper: Wrapper });
	expect(screen.getAllByRole("radio")).toHaveLength(2);
});

it.each(["maxAttempts", "graded", "canAutoScore"] as const)(
	"uses the compiled policy for %s instead of the editor fallback",
	(field) => {
		const data = makeChoiceData({
			attempts: field === "maxAttempts" ? 1 : 2,
			...(field === "graded" ? { gradingMode: "exact" } : {}),
		});
		const question = {
			...choiceStateQuestion(data, false),
			[field]: field === "maxAttempts" ? 2 : false,
		};
		for (const published of [true, false]) {
			const view = render(
				<PreviewAssessmentBlock
					blockId={published ? "published" : "editor"}
					data={data}
					compiledChoiceFacts={
						published ? { question, signature: choiceContentSignature(data, false) } : undefined
					}
				/>,
				{ wrapper: Wrapper },
			);
			fireEvent.click(getRadio("Wrong answer"));
			if (field === "graded") {
				expect(screen.getByRole("button", { name: published ? "Check" : "Submit" })).toBeEnabled();
			} else {
				fireEvent.click(screen.getByRole("button", { name: "Check" }));
				if (field === "maxAttempts")
					expect(Boolean(screen.queryByRole("button", { name: "Try again" }))).toBe(published);
				else
					expect(Boolean(view.container.querySelector('[data-completed="true"]'))).toBe(published);
			}
			view.unmount();
		}
	},
);

it.each([
	{ course: false, question: false, labels: ["First", "Second"] },
	{ course: false, question: true, labels: ["Second", "First"] },
	{ course: true, question: false, labels: ["First", "Second"] },
	{ course: true, question: true, labels: ["Second", "First"] },
])(
	"renders question shuffle over course default: $course / $question",
	({ course, question, labels }) => {
		const random = vi.spyOn(Math, "random").mockReturnValue(0);
		try {
			const block = adaptGrammarPreviewBlocks(
				readBlockSource(
					`::: choice Choose {scored shuffle=${question} dontKnow=false}\n(x) First\n( ) Second\n:::\n`,
				).blocks,
				{ "choose-one": { shuffle: course } },
			)[0];
			render(
				<PreviewAssessmentBlock
					blockId={block.id}
					data={block.data as unknown as AssessmentBlockData}
				/>,
				{ wrapper: Wrapper },
			);
			const radios = screen.getAllByRole("radio");
			expect(radios).toHaveLength(2);
			radios.forEach((radio, index) => expect(radio).toHaveAccessibleName(labels[index]));
		} finally {
			random.mockRestore();
		}
	},
);

it("dates a journal only when saved, preserves its date at restore, and keeps it out of reporting", () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-08T14:05:00.000Z"));
	try {
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		const state = installLearnerBlockState();
		const report = vi.fn();
		document.addEventListener("praxity:assessment-response", report);
		const data = {
			assessmentType: "textResponse",
			gradingMode: "none",
			private: true,
			feedback: {},
			stem: [{ id: "stem", type: "text", data: { content: "Reflect" } }],
			response: { type: "textResponse", inputType: "long", downloadAs: "both" },
		} as AssessmentBlockData;
		const mount = () =>
			render(<PreviewAssessmentBlock blockId="dated-journal" data={data} />, { wrapper: Wrapper });
		const view = mount();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "My reflection" } });
		expect(view.container.querySelector("[data-journal-saved-date]")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Save|Complete reflection/i }));
		expect(state.write).toHaveBeenCalledWith(
			"dated-journal",
			expect.objectContaining({ answer: "My reflection" }),
		);
		expect(state.values.get("dated-journal")).toMatchObject({
			savedAt: "2026-10-08T14:05:00.000Z",
			answer: "My reflection",
		});
		expect(view.container.querySelector("[data-journal-saved-date]")?.textContent).toMatch(
			/^Saved /,
		);
		expect(report).not.toHaveBeenCalled();
		view.unmount();
		vi.setSystemTime(new Date("2026-10-09T18:00:00.000Z"));
		const restored = mount();
		expect(
			restored.container.querySelector("[data-journal-saved-date]")?.getAttribute("data-saved-at"),
		).toBe("2026-10-08T14:05:00.000Z");
		expect(screen.getByRole("textbox")).toHaveValue("My reflection");
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "My revised reflection" } });
		expect(restored.container.querySelector("[data-journal-saved-date]")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /Save|Complete reflection/i }));
		expect(state.values.get("dated-journal")).toMatchObject({
			savedAt: "2026-10-09T18:00:00.000Z",
			answer: "My revised reflection",
		});
		document.removeEventListener("praxity:assessment-response", report);
	} finally {
		vi.useRealTimers();
	}
});

afterEach(() => {
	cleanup();
	delete window.__praxityBlockState;
});

it.each([
	["en", "1,000,000 points"],
	["fr", "1\u202f000\u202f000 points"],
])("renders grouped points in the %s assessment projection", (locale, label) => {
	const view = render(
		<LocaleContext.Provider value={locale}>
			<PreviewAssessmentBlock
				blockId="grouped-points"
				data={makeChoiceData({ gradingMode: "exact" as const, points: 1000000 })}
			/>
		</LocaleContext.Provider>,
		{ wrapper: Wrapper },
	);
	expect(view.container.querySelector(".praxity-assessment-points")?.textContent).toBe(label);
});

function installLearnerBlockState(initial: Record<string, unknown> = {}) {
	const values = new Map<string, unknown>(Object.entries(initial));
	const write = vi.fn((blockId: string, value: unknown) => values.set(blockId, value));
	window.__praxityBlockState = {
		get: (blockId) => values.get(blockId) as never,
		set: write,
	};
	return { values, write };
}

function Wrapper({ children }: { children: ReactNode }) {
	return <MantineProvider>{children}</MantineProvider>;
}

it("refuses selection persistence after its dispatch revokes authority, then accepts a fresh action", () => {
	installLearnerBlockState();
	const successor = vi.fn();
	const replace = () => {
		window.__praxityBlockState = { get: () => undefined, set: successor };
	};
	document.addEventListener("praxity:block-interaction", replace, { once: true });
	try {
		render(<PreviewAssessmentBlock blockId="cause-ticket" data={makeChoiceData()} />, {
			wrapper: Wrapper,
		});
		const options = screen.getAllByRole("radio");
		fireEvent.click(options[0]);
		expect(successor).not.toHaveBeenCalled();
		fireEvent.click(options[1]);
		expect(successor).toHaveBeenCalledExactlyOnceWith(
			"cause-ticket",
			expect.objectContaining({ interacted: true, checked: false, answer: ["b"] }),
		);
	} finally {
		document.removeEventListener("praxity:block-interaction", replace);
	}
});

it("persists a text edit with fresh authority after provider replacement", () => {
	installLearnerBlockState();
	render(
		<PreviewAssessmentBlock
			blockId="text-ticket"
			data={makeChoiceData({
				assessmentType: "textResponse",
				response: { type: "textResponse", inputType: "short" },
			})}
		/>,
		{ wrapper: Wrapper },
	);
	const successor = installLearnerBlockState();
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Tuesday" } });
	expect(successor.write).toHaveBeenCalledExactlyOnceWith(
		"text-ticket",
		expect.objectContaining({ answer: "Tuesday", interacted: true, checked: false }),
	);
});

it("persists Check with fresh authority after provider replacement", () => {
	installLearnerBlockState();
	render(<PreviewAssessmentBlock blockId="check-ticket" data={makeChoiceData()} />, {
		wrapper: Wrapper,
	});
	fireEvent.click(getRadio("Wrong answer"));
	const successor = installLearnerBlockState();
	fireEvent.click(screen.getByRole("button", { name: "Check" }));
	expect(successor.write).toHaveBeenCalledExactlyOnceWith(
		"check-ticket",
		expect.objectContaining({ answer: ["a"], attemptCount: 1, checked: true }),
	);
});

it("persists Try again with fresh authority after provider replacement", () => {
	installLearnerBlockState();
	render(<PreviewAssessmentBlock blockId="retry-ticket" data={makeChoiceData({ attempts: 2 })} />, {
		wrapper: Wrapper,
	});
	fireEvent.click(getRadio("Wrong answer"));
	fireEvent.click(screen.getByRole("button", { name: "Check" }));
	const successor = installLearnerBlockState();
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(successor.write).toHaveBeenCalledExactlyOnceWith(
		"retry-ticket",
		expect.objectContaining({ answer: [], attemptCount: 1, checked: false, interacted: false }),
	);
});

it.each(auditQuestions)("retains all four paragraphs captured for $id", ({ id, data }) => {
	Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
	const view = render(
		<LocaleContext.Provider value="fr">
			<PreviewAssessmentBlock blockId={id} data={data as AssessmentBlockData} />
		</LocaleContext.Provider>,
		{ wrapper: Wrapper },
	);
	const paragraphs = view.container.querySelectorAll(".praxity-assessment-description p");
	expect(paragraphs).toHaveLength(4);
	for (const [index, paragraph] of paragraphs.entries()) {
		const expected = document.createElement("div");
		expected.innerHTML = data.description[index].data.content;
		expect(paragraph.textContent).toBe(expected.textContent);
	}
});

it.each([
	["en", "First paragraph.", "Second paragraph.", "Final paragraph."],
	["fr", "Premier paragraphe.", "Deuxième paragraphe.", "Dernier paragraphe."],
])("renders and reports every description block in %s", (locale, first, second, last) => {
	Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
	const report = vi.fn();
	document.addEventListener("praxity:assessment-response", report);
	try {
		const view = render(
			<LocaleContext.Provider value={locale}>
				<PreviewAssessmentBlock
					blockId="complete-description"
					data={
						{
							assessmentType: "textResponse",
							gradingMode: "none",
							stem: [{ id: "stem", type: "text", data: { content: "<p>Reflect.</p>" } }],
							description: [
								{ id: "first", type: "text", data: { content: `<p>${first}</p>` } },
								{ id: "second", type: "text", data: { content: `<p>${second}</p>` } },
								{
									id: "list",
									type: "text",
									data: {
										content:
											'<ul><li><strong>First idea.</strong><ol><li><em>Nested idea.</em> <a href="https://example.com/guide">Guide</a></li></ol></li></ul>',
									},
								},
								{ id: "last", type: "text", data: { content: `<p>${last}</p>` } },
							],
							feedback: {},
							response: { type: "textResponse", inputType: "long" },
						} as AssessmentBlockData
					}
				/>
			</LocaleContext.Provider>,
			{ wrapper: Wrapper },
		);
		const description = view.container.querySelector(".praxity-assessment-description");
		expect(description?.querySelectorAll("p")).toHaveLength(3);
		expect(description).toHaveTextContent(first);
		expect(description).toHaveTextContent(second);
		expect(description).toHaveTextContent(last);
		expect(description?.querySelector("ul ol em")).toHaveTextContent("Nested idea.");
		expect(description?.querySelector("strong")).toHaveTextContent("First idea.");
		expect(description?.querySelector("a")).toHaveAttribute("href", "https://example.com/guide");
		expect(screen.getByRole("textbox")).toHaveAccessibleDescription(
			`${first} ${second} First idea. Nested idea. Guide ${last}`,
		);
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "My answer" } });
		fireEvent.click(screen.getByRole("button", { name: /Submit|Soumettre/ }));
		expect(report).toHaveBeenCalledOnce();
		expect((report.mock.calls[0][0] as CustomEvent).detail.questionText).toBe(
			`Reflect. ${first} ${second} First idea. Nested idea. Guide ${last}`,
		);
	} finally {
		document.removeEventListener("praxity:assessment-response", report);
	}
});

function makeChoiceData(overrides: Partial<AssessmentBlockData> = {}): AssessmentBlockData {
	return {
		assessmentType: "choice",
		stem: [{ id: "s1", type: "text", data: { content: "Pick the right answer" } }],
		response: {
			type: "choice",
			selectionMode: "single",
			inputMethod: "click",
			display: "list",
			shuffle: false,
			options: [
				{ id: "a", label: "Wrong answer", isCorrect: false },
				{ id: "b", label: "Right answer", isCorrect: true },
			],
		} satisfies ChoiceResponse,
		feedback: {
			correct: [{ id: "fc", type: "text", data: { content: "Well done!" } }],
			incorrect: [{ id: "fi", type: "text", data: { content: "Not quite." } }],
		},
		feedbackEnabled: true,
		gradingMode: "none",
		...overrides,
	} as AssessmentBlockData;
}

function getRadio(label: string): HTMLInputElement {
	return screen.getByRole("radio", { name: label }) as HTMLInputElement;
}

it.each([
	["en", "Select all that apply"],
	["fr", "Sélectionner toutes les réponses applicables"],
])("shows the %s multiple-choice instruction below the stem", (locale, expected) => {
	const data = makeChoiceData();
	(data.response as ChoiceResponse).selectionMode = "multiple";
	const view = render(
		<LocaleContext.Provider value={locale}>
			<PreviewAssessmentBlock blockId="multiple-hint" data={data} />
		</LocaleContext.Provider>,
		{ wrapper: Wrapper },
	);
	expect(view.container.querySelector(".praxity-assessment-choice-hint")).toHaveTextContent(
		expected,
	);
});

it.each([
	["en", "1 of 1,284 attempts used"],
	["fr", "Tentatives utilisées\u00a0: 1 sur 1\u202f284"],
])("renders grouped %s attempts after Check", (locale, expected) => {
	const view = render(
		<LocaleContext.Provider value={locale}>
			<PreviewAssessmentBlock
				blockId="grouped-attempts"
				data={makeChoiceData({ gradingMode: "exact", attempts: 1284, feedback: {} })}
			/>
		</LocaleContext.Provider>,
		{ wrapper: Wrapper },
	);
	fireEvent.click(getRadio("Wrong answer"));
	fireEvent.click(screen.getByRole("button", { name: /Submit|Check|Soumettre|Vérifier/ }));
	expect(view.container.querySelector("[data-assessment-status]")?.textContent).toBe(expected);
});

describe("I don't know", () => {
	it("editor preview reads the resolved group default and preserves explicit overrides", () => {
		for (const explicit of [undefined, true, false]) {
			const blocks = adaptGrammarPreviewBlocks([
				{ id: "group", type: "assessmentGroup", data: { deckGate: "pass", memberBlockIds: ["q"] } },
				{
					id: "q",
					type: "assessment",
					data: makeChoiceData({ dontKnow: explicit }) as unknown as Record<string, unknown>,
				},
			]);
			const q = blocks.find((block) => block.id === "q");
			if (!q) throw new Error("Missing question");
			const view = render(
				<PreviewAssessmentBlock data={q.data as unknown as AssessmentBlockData} blockId="q" />,
				{ wrapper: Wrapper },
			);
			expect(screen.queryByRole("radio", { name: "I don't know" }) !== null).toBe(
				explicit === true,
			);
			view.unmount();
		}
	});
	it.each([
		[{}, true],
		[{ scored: true }, false],
		[{ gradingMode: "exact" }, false],
		[{ deckGate: "pass" }, false],
		[{ dontKnow: false }, false],
		[{ scored: true, dontKnow: true }, true],
	])("derives the default from scoring and pass gates %j", (settings, offered) => {
		expect(assessmentOffersDontKnow({ ...makeChoiceData(), ...settings })).toBe(offered);
	});
	it("renders an unkeyed last radio and submits unknown as answered, incorrect, and retryable", () => {
		const state = installLearnerBlockState();
		const report = vi.fn();
		document.addEventListener("praxity:assessment-response", report);
		const data = makeChoiceData({
			feedback: { incorrect: [{ id: "fi", type: "text", data: { content: "Here is why." } }] },
		});
		const mount = () =>
			render(<PreviewAssessmentBlock data={data} blockId="unknown" />, { wrapper: Wrapper });
		const view = mount();
		const radio = getRadio("I don't know");
		expect(screen.getAllByRole("radio").at(-1)).toBe(radio);
		expect(radio.closest("label")?.querySelector(".praxity-choice-key")).toBeNull();
		expect(radio.closest("label")?.querySelector(".praxity-choice-key-spacer")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
		fireEvent.click(radio);
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(view.container.querySelector('[data-choice-result="unknown"]')?.textContent).toContain(
			'You chose "I don\'t know"',
		);
		expect(screen.queryByText("Not quite")).toBeNull();
		expect(screen.getByText("Correct answer")).toBeTruthy();
		expect(screen.getByText("Here is why.")).toBeTruthy();
		expect(view.container.querySelector('[data-result="unknown"]')).toHaveAttribute(
			"data-assessment-answered",
			"true",
		);
		expect(state.values.get("unknown")).toMatchObject({
			answer: ["dont-know"],
			correct: false,
			checked: true,
		});
		expect(report.mock.calls[0]?.[0].detail).toMatchObject({
			responseText: "dont-know",
			correct: false,
			result: "neutral",
			choiceDefinition: {
				interactionType: "choice",
				choices: [
					{ id: "wrong-answer", description: { en: "Wrong answer" } },
					{ id: "right-answer", description: { en: "Right answer" } },
					{ id: "dont-know", description: { en: "I don't know", fr: "Je ne sais pas" } },
				],
			},
		});
		view.unmount();
		mount();
		expect(getRadio("I don't know")).toBeChecked();
		fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
		expect(getRadio("I don't know")).not.toBeChecked();
		document.removeEventListener("praxity:assessment-response", report);
	});
});

describe("assessment review states", () => {
	it("keeps promoted option feedback HTML identical to the grammar projection", () => {
		const block = adaptGrammarPreviewBlocks(
			readBlockSource(
				"::: choice Choose an answer\n(x) Right answer\nfeedback: [x](javascript:alert(1)) advice.\n( ) Wrong answer\nfeedback: Try again.\n:::\n",
			).blocks,
		)[0];
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={block.data as unknown as AssessmentBlockData}
					blockId={block.id}
				/>
			</Wrapper>,
		);
		fireEvent.click(getRadio("Right answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(container.querySelector(".praxity-choice-feedback")?.innerHTML).toBe(
			"<p><a>x</a> advice.</p>",
		);
	});

	it.each(["single", "multiple"] as const)(
		"uses one attempt status for %s feedback without authored text",
		(selectionMode) => {
			const data = makeChoiceData({ gradingMode: "exact", attempts: 2, feedback: {} });
			(data.response as ChoiceResponse).selectionMode = selectionMode;
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="attempt-status" />
				</Wrapper>,
			);
			fireEvent.click(
				screen.getByRole(selectionMode === "single" ? "radio" : "checkbox", {
					name: "Wrong answer",
				}),
			);
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));
			const summary = container.querySelector("[data-assessment-feedback]");
			expect(summary).toHaveTextContent(/^1 of 2 attempts usedTry again$/);
			expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
			expect(screen.getByRole("button", { name: "Try again" })).toHaveAccessibleDescription(
				"Not quite",
			);
			expect(document.querySelector("[data-option-feedback]")).toHaveTextContent("Not quite");
		},
	);
	it("reveals the verdict without authored option feedback when feedback is disabled", () => {
		const data = makeChoiceData({ feedbackEnabled: false, feedbackMode: "reveal" });
		(data.response as ChoiceResponse).options[0].feedback = "Compare the two responses.";
		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="disabled-option-feedback" />
			</Wrapper>,
		);
		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(screen.getAllByText("Not quite")).toHaveLength(1);
		expect(screen.queryByText("Compare the two responses.")).not.toBeInTheDocument();
	});
	it.each([false, true])(
		"Continue reaches the following activity with inert controls %s",
		(inert) => {
			const { container } = render(
				<Wrapper>
					<main id="main-content">
						<PreviewAssessmentBlock data={makeChoiceData()} blockId="continue" />
						<div data-block-type="assessment" aria-label="Following question">
							<button type="button" disabled={inert}>
								Following activity
							</button>
						</div>
					</main>
				</Wrapper>,
			);
			fireEvent.click(getRadio("Right answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));
			expect(container.querySelector("[data-assessment-submit]")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Continue" }));
			expect(
				inert
					? screen.getByLabelText("Following question")
					: screen.getByRole("button", { name: "Following activity" }),
			).toHaveFocus();
		},
	);
	it("restores the wrong mark while retrying without inventing a selected answer", () => {
		installLearnerBlockState();
		const data = makeChoiceData({ attempts: 2 });
		const first = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="saved-retry" />
			</Wrapper>,
		);
		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		first.unmount();
		const restored = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="saved-retry" />
			</Wrapper>,
		);
		expect(
			restored.container.querySelector('[data-node-id="a"] [data-option-feedback]'),
		).toHaveTextContent("Not quite");
		expect(getRadio("Wrong answer")).not.toBeChecked();
		expect(getRadio("Wrong answer")).not.toBeDisabled();
	});
	it("keeps a wrong option's feedback while retrying and reveals the answer on exhaustion", () => {
		const data = makeChoiceData({ attempts: 2 });
		(data.response as ChoiceResponse).options[0].feedback = "Compare the two responses.";
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="retry-marks" />
			</Wrapper>,
		);
		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		const wrong = container.querySelector('[data-node-id="a"]');
		expect(wrong).toHaveTextContent("Not quite");
		expect(wrong).toHaveTextContent("Compare the two responses.");
		expect(container.querySelector('[data-node-id="b"]')).not.toHaveTextContent("Correct answer");
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(wrong).toHaveTextContent("Not quite");
		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(container.querySelector('[data-node-id="b"]')).toHaveTextContent("Correct answer");
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	});
	it("marks a correct chosen option with its word and icon", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={makeChoiceData()} blockId="correct-mark" />
			</Wrapper>,
		);
		fireEvent.click(getRadio("Right answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		const option = container.querySelector('[data-node-id="b"]');
		expect(option).toHaveTextContent("Correct");
		expect(option?.querySelector("svg")).not.toBeNull();
	});
	it("puts the result before retry and attempt actions", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={makeChoiceData({ attempts: 2 })} blockId="review" />
			</Wrapper>,
		);
		expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		const feedback = container.querySelector("[data-assessment-feedback]");
		expect(feedback).toHaveTextContent("Feedback: Not quite.");
		const retry = screen.getByRole("button", { name: "Try again" });
		expect(feedback?.contains(retry)).toBe(true);
	});

	it.each([
		["matrix", "single"],
		["matrix", "multiple"],
		["likert", "single"],
	] as const)("locks submitted %s %s selections until retry", (assessmentType, selectionMode) => {
		render(
			<Wrapper>
				<PreviewAssessmentBlock
					blockId="matrix-review"
					data={makeChoiceData({
						assessmentType,
						attempts: 2,
						response: {
							type: "matrix",
							selectionMode,
							statements: [{ id: "a", text: "The course helped" }],
							scalePoints: [
								{ value: 1, label: "Disagree" },
								{ value: 2, label: "Agree" },
							],
						},
					})}
				/>
			</Wrapper>,
		);
		const role = selectionMode === "single" ? "radio" : "checkbox";
		fireEvent.click(screen.getByRole(role, { name: "The course helped: Agree" }));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		for (const control of screen.getAllByRole(role)) expect(control).toBeDisabled();
		expect(screen.getByRole(role, { name: "The course helped: Agree" })).toBeChecked();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		const first = screen.getByRole(role, { name: "The course helped: Disagree" });
		expect(first).toBeEnabled();
		expect(first).toHaveFocus();
	});
});

describe("parsed assessment feedback", () => {
	it("keeps rich feedback focused across rerenders and refreshes changed markup", () => {
		const data = makeChoiceData({ attempts: 2 });
		data.feedback = {
			incorrect: [{ id: "explanation", type: "text", data: { content: "<p>First reply.</p>" } }],
		};
		const view = render(<PreviewAssessmentBlock data={data} blockId="rich-feedback" />, {
			wrapper: Wrapper,
		});
		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
		expect(screen.getByRole("button", { name: "Try again" })).toHaveAccessibleDescription(
			"Not quite First reply.",
		);
		view.rerender(
			<PreviewAssessmentBlock data={{ ...data, attempts: 3 }} blockId="rich-feedback" />,
		);
		expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
		expect(screen.getByRole("button", { name: "Try again" })).toHaveAccessibleDescription(
			"Not quite First reply.",
		);
		data.feedback.incorrect = [
			{ id: "explanation", type: "text", data: { content: "<p>Other reply.</p>" } },
		];
		view.rerender(<PreviewAssessmentBlock data={data} blockId="rich-feedback" />);
		expect(screen.getByText("Other reply.")).toBeVisible();
		expect(screen.getByRole("button", { name: "Try again" })).toHaveAccessibleDescription(
			"Not quite Other reply.",
		);
		expect(screen.queryByText("First reply.")).toBeNull();
	});

	it.each(["correct", "incorrect", "feedback", "option"])(
		"renders inline markup from %s feedback after answering",
		(field) => {
			const feedback =
				'@highlight.purple{Review "The calibration of a telescope".} **Evidence** [Guide](https://example.com) @source{Optics source} <img src=x onerror=alert(1)>';
			const source = [
				"# Fixture {hideTitle}",
				"",
				"::: choice Choose an answer",
				...(field === "option" ? [] : [`${field}: ${feedback}`]),
				"",
				"(x) Right answer",
				"( ) Wrong answer",
				...(field === "option" ? [`feedback: ${feedback}`] : []),
				":::",
			].join("\n");
			const blocks = preparePageFootnotes(
				adaptGrammarPreviewBlocks(readBlockSource(source).blocks),
				"page",
				{ footnote: "Footnote", footnotes: "Sources" },
			);
			const block = blocks[0];
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock
						data={block.data as unknown as AssessmentBlockData}
						blockId={block.id}
					/>
				</Wrapper>,
			);
			expect(container.querySelector('[data-doodle="highlight"]')).toBeNull();
			fireEvent.click(getRadio(field === "correct" ? "Right answer" : "Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));
			const highlight = container.querySelector('[data-doodle="highlight"]');
			expect(highlight).toHaveAttribute("data-doodle-mods", "purple");
			expect(highlight).toHaveTextContent('Review "The calibration of a telescope".');
			expect(container.querySelector("strong")).toHaveTextContent("Evidence");
			expect(screen.getByRole("link", { name: /Guide/ })).toHaveAttribute(
				"href",
				"https://example.com",
			);
			expect(container.querySelector(".praxity-footnote-ref")).toHaveTextContent(
				field === "feedback" ? "[2]" : "[1]",
			);
			expect(blocks.at(-1)?.data.content).toContain("<li>Optics source</li>");
			expect(container.querySelector("img")).toBeNull();
			expect(container.textContent).not.toContain("@highlight");
		},
	);
});

describe("reveal answers across assessment types", () => {
	it("reveals only incorrect matching pairs after a partial response", () => {
		const initial = {
			version: 1,
			kind: "assessment",
			assessmentType: "matching",
			attemptCount: 0,
			checked: false,
			correct: false,
			completed: false,
			interacted: true,
			answer: { a: "Control", b: "Wrong" },
		};
		const { values } = installLearnerBlockState({ matching: initial });
		const data = {
			assessmentType: "matching",
			stem: [{ id: "stem", type: "text", data: { content: "Match the pairs" } }],
			response: {
				type: "matching",
				inputMethod: "dropdown",
				pairs: [
					{ id: "a", prompt: "Hazard", correctMatch: "Control" },
					{ id: "b", prompt: "Risk", correctMatch: "Mitigation" },
				],
				distractors: ["Wrong"],
			},
			feedback: {},
			feedbackMode: "reveal",
			gradingMode: "exact",
			attempts: 0,
		} as AssessmentBlockData;
		const { container, unmount } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="matching" />
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(
			Array.from(
				container.querySelectorAll("[data-assessment-correct-answers] li"),
				(item) => item.textContent,
			),
		).toEqual(["Risk: Mitigation"]);
		expect(
			container.querySelectorAll('.praxity-matching-result[data-result="correct"]'),
		).toHaveLength(1);
		expect(
			container.querySelectorAll('.praxity-matching-result[data-result="incorrect"]'),
		).toHaveLength(1);
		expect(container.querySelector("[data-block-id='matching']")).toHaveAttribute(
			"data-score",
			"0",
		);
		unmount();
		values.set("matching", { ...initial, answer: { a: "Control", b: "Mitigation" } });
		const correct = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="matching" />
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(correct.container.querySelector("[data-assessment-correct-answers]")).toBeNull();
		expect(
			correct.container.querySelectorAll('.praxity-matching-result[data-result="correct"]'),
		).toHaveLength(2);
		expect(correct.container.querySelector("[data-block-id='matching']")).toHaveAttribute(
			"data-score",
			"100",
		);
	});

	const examples: Array<{
		response: AssessmentBlockData["response"];
		answer: unknown;
		expected: string[];
	}> = [
		{
			response: {
				type: "matching",
				inputMethod: "dropdown",
				pairs: [{ id: "a", prompt: "Hazard", correctMatch: "Control" }],
				distractors: ["Wrong"],
			},
			answer: { a: "Wrong" },
			expected: ["Hazard: Control"],
		},
		{
			response: {
				type: "sequence",
				inputMethod: "drag",
				items: [
					{ id: "a", label: "First", correctPosition: 0 },
					{ id: "b", label: "Second", correctPosition: 1 },
				],
			},
			answer: ["b", "a"],
			expected: ["First", "Second"],
		},
		{
			response: { type: "fillBlank", blanks: [{ id: "a", answer: "permit" }] },
			answer: { a: "wrong" },
			expected: ["permit"],
		},
		{
			response: {
				type: "categorize",
				categories: [
					{ id: "a", name: "Head", items: ["Hard hat"] },
					{ id: "b", name: "Eyes", items: ["Goggles"] },
				],
			},
			answer: { '["Hard hat",0]': "b", '["Goggles",0]': "a" },
			expected: ["Hard hat: Head", "Goggles: Eyes"],
		},
	];
	it.each(examples)(
		"reveals $response.type while preserving and locking the submitted response",
		({ response, answer, expected }) => {
			const { values } = installLearnerBlockState({
				reveal: {
					version: 1,
					kind: "assessment",
					assessmentType: response.type,
					attemptCount: 0,
					checked: false,
					correct: false,
					completed: false,
					interacted: true,
					answer,
				},
			});
			const data = {
				assessmentType: response.type,
				stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
				response,
				feedback: {},
				feedbackMode: "reveal",
				gradingMode: "exact",
				attempts: 0,
			} as AssessmentBlockData;
			const first = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="reveal" />
				</Wrapper>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));
			const verify = (container: HTMLElement) => {
				expect(container.querySelector("[data-block-id='reveal']")).toHaveAttribute(
					"data-score",
					"0",
				);
				expect(container.querySelector("[data-block-id='reveal']")).toHaveAttribute(
					"data-completed",
					"true",
				);
				expect(
					Array.from(
						container.querySelectorAll("[data-assessment-correct-answers] li"),
						(item) => item.textContent,
					),
				).toEqual(expected);
				expect(
					container.querySelector("[data-assessment-correct-answers] > :last-child")?.tagName,
				).toBe(response.type === "sequence" ? "OL" : "UL");
				expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
				for (const control of container.querySelectorAll("input, select, button"))
					if (control.hasAttribute("readonly")) expect(control).toHaveAttribute("readonly");
					else expect(control).toBeDisabled();
			};
			verify(first.container);
			expect(values.get("reveal")).toMatchObject({
				checked: true,
				correct: false,
				completed: true,
				answer,
			});
			first.unmount();
			const restored = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="reveal" />
				</Wrapper>,
			);
			verify(restored.container);
		},
	);
});

describe("PreviewAssessmentBlock — choice", () => {
	it.each(["single", "multiple"] as const)(
		"reveals %s answers after one attempt and restores the locked result",
		(selectionMode) => {
			const { values } = installLearnerBlockState();
			const data = makeChoiceData({
				feedbackMode: "reveal",
				gradingMode: "exact",
				attempts: 0,
				points: 2,
			});
			data.response = {
				...(data.response as ChoiceResponse),
				selectionMode,
				options: [
					{ id: "a", label: "Wrong answer", isCorrect: false },
					{ id: "b", label: "Right answer", isCorrect: true },
					...(selectionMode === "multiple"
						? [{ id: "c", label: "Another right answer", isCorrect: true }]
						: []),
				],
			};
			const first = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="reveal" />
				</Wrapper>,
			);
			const role = selectionMode === "single" ? "radio" : "checkbox";
			expect(first.container.querySelector("[data-assessment-correct-answers]")).toBeNull();
			fireEvent.click(screen.getByRole(role, { name: "Wrong answer" }));
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));
			const verify = (container: HTMLElement) => {
				expect(screen.getByRole(role, { name: "Wrong answer" })).toBeChecked();
				expect(screen.getByRole(role, { name: "Right answer" })).not.toBeChecked();
				expect(screen.getByRole(role, { name: "Right answer" })).toBeDisabled();
				expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
				expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent(
					"Not quite.",
				);
				expect(container.querySelector("[data-assessment-correct-answers]")).toHaveTextContent(
					"Right answer",
				);
				expect(container.querySelector("[data-assessment-correct-answers] ul")).not.toBeNull();
				expect(container.querySelector("[data-assessment-correct-answers] ol")).toBeNull();
				if (selectionMode === "multiple")
					expect(container.querySelector("[data-assessment-correct-answers]")).toHaveTextContent(
						"Another right answer",
					);
				expect(container.querySelector("[data-completed='true']")).toHaveAttribute(
					"data-score",
					"0",
				);
				expect(container.querySelector("[data-completed='true']")).toHaveAttribute(
					"data-passed",
					"false",
				);
			};
			verify(first.container);
			expect(values.get("reveal")).toMatchObject({
				attemptCount: 1,
				checked: true,
				completed: true,
				correct: false,
				answer: ["a"],
			});
			first.unmount();
			const second = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="reveal" />
				</Wrapper>,
			);
			verify(second.container);
			second.unmount();
			values.clear();
			const reset = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="reveal" />
				</Wrapper>,
			);
			expect(screen.getByRole(role, { name: "Wrong answer" })).toBeEnabled();
			expect(reset.container.querySelector("[data-assessment-correct-answers]")).toBeNull();
		},
	);

	it("confirms a correct response without repeating its answer when no feedback is authored", () => {
		const data = makeChoiceData({ feedbackMode: "reveal", feedback: {}, feedbackEnabled: false });
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="reveal" />
			</Wrapper>,
		);
		fireEvent.click(getRadio("Right answer"));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent(
			/^1 of 1 attempts used$/,
		);
		expect(screen.getAllByText("Correct")).toHaveLength(1);
		expect(container.querySelector(".praxity-choice-status")).toHaveTextContent("Correct");
		expect(container.querySelector("[data-feedback-details]")).toBeNull();
		expect(container.querySelector(".praxity-choice-status svg")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
		expect(
			container.querySelector("[data-assessment-status], [data-feedback-explanation]"),
		).toHaveFocus();
		expect(container.querySelector("[data-assessment-correct-answers]")).toBeNull();
		expect(container.querySelector("[data-completed='true']")).not.toHaveAttribute("data-score");
	});

	it.each(["single", "multiple"] as const)(
		"keeps authored feedback without repeating a correct %s response",
		(selectionMode) => {
			const data = makeChoiceData({ feedbackMode: "reveal" });
			data.response = {
				...(data.response as ChoiceResponse),
				selectionMode,
			};
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="reveal" />
				</Wrapper>,
			);
			const role = selectionMode === "single" ? "radio" : "checkbox";
			fireEvent.click(screen.getByRole(role, { name: "Right answer" }));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));
			expect(screen.getByRole(role, { name: "Right answer" })).toBeChecked();
			expect(container.querySelector(".praxity-choice-status")).toHaveTextContent("Correct");
			expect(container.querySelector("[data-feedback-details]")).not.toBeNull();
			expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent(
				"Feedback: Well done!",
			);
			expect(
				container.querySelector("[data-assessment-status], [data-feedback-explanation]"),
			).toHaveFocus();
			expect(container.querySelector("[data-assessment-correct-answers]")).toBeNull();
		},
	);

	it("reveals every correct answer when only some correct options were selected", () => {
		const data = makeChoiceData({ feedbackMode: "reveal" });
		data.response = {
			...(data.response as ChoiceResponse),
			selectionMode: "multiple",
			options: [
				{ id: "a", label: "First answer", isCorrect: true },
				{ id: "b", label: "Second answer", isCorrect: true },
			],
		};
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="reveal" />
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "First answer" }));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent("Not quite");
		expect(
			Array.from(
				container.querySelectorAll("[data-assessment-correct-answers] ul li"),
				(item) => item.textContent,
			),
		).toEqual(["First answer", "Second answer"]);
	});

	it("restores a submitted attempt without another event, attempt, or focus change", () => {
		const { values, write } = installLearnerBlockState();
		const data = makeChoiceData({ gradingMode: "exact", attempts: 2 });
		const onResponse = vi.fn();
		const onInteraction = vi.fn();
		document.addEventListener("praxity:assessment-response", onResponse);
		document.addEventListener("praxity:block-interaction", onInteraction);
		const first = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="durable-choice" />
			</Wrapper>,
		);

		fireEvent.click(getRadio("Wrong answer"));
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(onResponse).toHaveBeenCalledTimes(1);
		expect((onResponse.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
			submitted: true,
			attemptsUsed: 1,
			maxAttempts: 2,
		});
		expect(onInteraction).toHaveBeenCalledTimes(2);
		expect(values.get("durable-choice")).toMatchObject({
			attemptCount: 1,
			checked: true,
			correct: false,
			completed: false,
			answer: ["a"],
		});
		first.unmount();
		write.mockClear();

		const focusTarget = document.createElement("button");
		document.body.append(focusTarget);
		focusTarget.focus();
		const restored = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="durable-choice" />
			</Wrapper>,
		);

		expect(getRadio("Wrong answer")).toBeChecked();
		expect(getRadio("Wrong answer")).toBeDisabled();
		expect(restored.container.querySelector("[data-assessment-feedback]")).toHaveTextContent(
			"Not quite",
		);
		expect(screen.queryByText("Attempt 1 of 2")).not.toBeInTheDocument();
		expect(document.activeElement).toBe(focusTarget);
		expect(onResponse).toHaveBeenCalledTimes(1);
		expect(onInteraction).toHaveBeenCalledTimes(2);
		expect(write).not.toHaveBeenCalled();

		document.removeEventListener("praxity:assessment-response", onResponse);
		document.removeEventListener("praxity:block-interaction", onInteraction);
		delete window.__praxityBlockState;
	});

	it.each([
		[
			"incompatible",
			{
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				attemptCount: 1,
				checked: true,
				correct: true,
				completed: true,
				interacted: true,
				answer: ["removed-option"],
			},
		],
		["corrupt", "not assessment state"],
	])("ignores %s learner state", (_label, saved) => {
		installLearnerBlockState({ "durable-choice": saved });
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={makeChoiceData()} blockId="durable-choice" />
			</Wrapper>,
		);

		expect(getRadio("Wrong answer")).not.toBeChecked();
		expect(getRadio("Right answer")).not.toBeChecked();
		expect(container.querySelector("[data-attempted]")).toBeNull();
		expect(container.querySelector("[data-assessment-feedback]")).toBeEmptyDOMElement();
		delete window.__praxityBlockState;
	});

	it("gives each native radio group a shared, instance-unique name", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={makeChoiceData()} blockId="repeated-question" />
				<PreviewAssessmentBlock data={makeChoiceData()} blockId="repeated-question" />
			</Wrapper>,
		);
		const groups = Array.from(container.querySelectorAll("fieldset")).map((fieldset) =>
			Array.from(fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]')),
		);

		expect(groups).toHaveLength(2);
		expect(new Set(groups[0].map((radio) => radio.name)).size).toBe(1);
		expect(groups[0][0].name).not.toBe("");
		expect(groups[1][0].name).not.toBe(groups[0][0].name);
	});

	it("renders inline Prax markup in option labels", () => {
		const data = makeChoiceData({
			response: {
				type: "choice",
				selectionMode: "single",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [{ id: "a", label: "@highlight.red{Urgent answer}", isCorrect: true }],
			} satisfies ChoiceResponse,
		});
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="inline-option" />
			</Wrapper>,
		);

		expect(screen.getByRole("radio", { name: "Urgent answer" })).toBeInTheDocument();
		expect(
			container.querySelector('[data-doodle="highlight"][data-doodle-mods="red"]'),
		).toHaveTextContent("Urgent answer");
		expect(container).not.toHaveTextContent("@highlight.red");
	});

	it("pluralizes learner-facing point labels", () => {
		const { container, rerender } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeChoiceData({ gradingMode: "exact" as const, points: 1 })}
					blockId="q-points"
				/>
			</Wrapper>,
		);
		expect(screen.getByText("1 point")).toBeInTheDocument();
		expect(container.querySelector(".praxity-assessment-points")).toBeTruthy();
		expect(container.querySelector(".mantine-Badge-root")).toBeNull();

		rerender(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeChoiceData({ gradingMode: "exact" as const, points: 2 })}
					blockId="q-points"
				/>
			</Wrapper>,
		);
		expect(screen.getByText("2 points")).toBeInTheDocument();
	});

	it("uses a plain localized required marker beside the question", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeChoiceData({ gradingMode: "exact" })}
					blockId="q-required"
				/>
			</Wrapper>,
		);
		const indicator = container.querySelector(".praxity-required-indicator");
		expect(indicator?.textContent).toBe("Required");
		expect(indicator?.querySelector("svg")).toBeNull();
		expect(indicator?.querySelector(".praxity-required-marker")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
		expect(getRadio("Wrong answer")).not.toHaveAttribute("required");
		expect(getRadio("Wrong answer").matches(":invalid")).toBe(false);
		expect(getRadio("Wrong answer")).not.toHaveAttribute("aria-invalid", "true");
		expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-required", "true");
	});

	it("expresses required multi-select semantics on the group, not each checkbox", () => {
		const data = makeChoiceData({
			required: true,
			response: {
				type: "choice",
				selectionMode: "multiple",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [
					{ id: "a", label: "Option A", isCorrect: true },
					{ id: "b", label: "Option B", isCorrect: false },
				],
			} satisfies ChoiceResponse,
		});
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="q-required-multiple" />
			</Wrapper>,
		);

		expect(container.querySelector("legend")).toHaveTextContent("Required");
		for (const checkbox of screen.getAllByRole("checkbox")) {
			expect(checkbox).not.toHaveAttribute("aria-required");
			expect(checkbox).not.toHaveAttribute("required");
		}
	});

	it("renders the assessment title and extra instructions as separate stem elements", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeChoiceData({
						stem: [
							{
								id: "s1",
								type: "text",
								data: {
									content:
										"<p>Choose the <em>best</em> response</p><p>Use the scenario above to decide.</p><ul><li>Keep this list.</li></ul>",
								},
							},
						],
					})}
					blockId="q-stem"
				/>
			</Wrapper>,
		);

		const stem = container.querySelector(".praxity-assessment-stem-content");
		expect(stem).toBeTruthy();
		expect(stem?.closest("p.praxity-assessment-stem")?.querySelector("p, ul")).toBeNull();
		expect(stem?.querySelector("em")).toHaveTextContent("best");
		expect(stem).toHaveTextContent("Choose the best response");
		const body = container.querySelector(".praxity-assessment-stem-body");
		expect(body?.querySelector("p")).toHaveTextContent("Use the scenario above to decide.");
		expect(body?.querySelector("li")).toHaveTextContent("Keep this list.");
	});

	it.each([
		["Choose <em>carefully</em><p>Read the supporting text.</p>", "Choose carefully"],
		["<ul><li>First instruction.</li><li>Second instruction.</li></ul>", "Question"],
		[
			"Choose carefully<hr><dl><dt>Context</dt><dd>Keep the definition.</dd></dl>",
			"Choose carefully",
		],
	])("keeps mixed or block-first stems outside the question paragraph: %s", (content, title) => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeChoiceData({ stem: [{ id: "s1", type: "text", data: { content } }] })}
					blockId="mixed-stem"
				/>
			</Wrapper>,
		);
		const stem = container.querySelector("p.praxity-assessment-stem");
		expect(stem).toHaveTextContent(title);
		expect(stem?.querySelector("p, ul, li, hr, dl, dt, dd")).toBeNull();
		const body = container.querySelector(".praxity-assessment-stem-body");
		expect(body).toBeTruthy();
		expect(stem?.textContent).not.toContain(body?.textContent);
	});

	it("renders scenario display with stable choice option wrapper classes", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeChoiceData({ display: "scenario" })}
					blockId="q-scenario"
				/>
			</Wrapper>,
		);

		const card = container.querySelector("[data-block-id='q-scenario']");
		expect(card?.getAttribute("data-assessment-display")).toBe("scenario");
		expect(container.querySelector(".praxity-assessment-choice-option")).toBeTruthy();
	});

	it("renders reflection privacy copy outside the stem content", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={
						{
							assessmentType: "textResponse",
							stem: [
								{
									id: "s1",
									type: "text",
									data: { content: "<p>What did you notice?</p>" },
								},
							],
							response: { type: "textResponse", inputType: "short" },
							feedback: {},
							gradingMode: "none",
							private: true,
						} as AssessmentBlockData
					}
					blockId="q-reflection"
				/>
			</Wrapper>,
		);

		const stem = container.querySelector(".praxity-assessment-stem-content");
		const privacyLabel = container.querySelector(".praxity-assessment-reflection-label");
		expect(stem).toBeTruthy();
		expect(privacyLabel).toBeTruthy();
		expect(stem?.contains(privacyLabel)).toBe(false);
		expect(privacyLabel?.textContent).toBe("Your reflection is private");
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "A private thought" } });
		expect(screen.getByRole("button", { name: "Complete reflection" })).toBeInTheDocument();
	});

	it("uses an authored reflection button label", () => {
		render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={
						{
							assessmentType: "textResponse",
							stem: [{ id: "s1", type: "text", data: { content: "<p>Pause here</p>" } }],
							response: { type: "textResponse", inputType: "short" },
							feedback: {},
							gradingMode: "none",
							private: true,
							buttonLabel: "Keep this in mind",
						} as AssessmentBlockData
					}
					blockId="q-custom-reflection"
				/>
			</Wrapper>,
		);

		fireEvent.change(screen.getByRole("textbox"), { target: { value: "A private thought" } });
		expect(screen.getByRole("button", { name: "Keep this in mind" })).toBeInTheDocument();
	});

	it("offers configured response downloads after the learner writes", () => {
		render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={
						{
							assessmentType: "textResponse",
							stem: [{ id: "s1", type: "text", data: { content: "<p>Pause here</p>" } }],
							response: { type: "textResponse", inputType: "short", downloadAs: "both" },
							feedback: {},
							gradingMode: "none",
							private: true,
							buttonLabel: "Keep this in mind",
						} as AssessmentBlockData
					}
					blockId="q-download-reflection"
				/>
			</Wrapper>,
		);

		const txt = screen.getByRole("button", { name: "Download as text" });
		const docx = screen.getByRole("button", { name: "Download as Word" });
		expect(screen.getByRole("group", { name: "Download response as" })).toBeInTheDocument();
		expect(txt).toHaveTextContent("Download as text");
		expect(docx).toHaveTextContent("Download as Word");
		expect(txt).toHaveAttribute("data-variant", "subtle");
		expect(docx).toHaveAttribute("data-variant", "subtle");
		expect(txt).toBeDisabled();
		expect(docx).toBeDisabled();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "My response" } });
		expect(txt).toBeEnabled();
		expect(docx).toBeEnabled();
		expect(screen.queryByRole("button", { name: "Keep this in mind" })).not.toBeInTheDocument();
		expect(document.querySelector('[data-assessment-submit="true"]')).toBeNull();
	});

	it("submits an unscored survey as neutral instead of marking it incorrect", () => {
		let submitted: Record<string, unknown> | undefined;
		document.addEventListener(
			"praxity:assessment-response",
			(event) => {
				submitted = (event as CustomEvent<Record<string, unknown>>).detail;
			},
			{ once: true },
		);
		const data = makeChoiceData({
			feedback: {},
			feedbackEnabled: false,
			response: {
				type: "choice",
				selectionMode: "multiple",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [
					{ id: "optics", label: "Optics", isCorrect: false },
					{ id: "services", label: "Services", isCorrect: false },
				],
			},
			buttonLabel: "Submit response",
		});
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="survey" />
			</Wrapper>,
		);

		fireEvent.click(screen.getByRole("checkbox", { name: "Optics" }));
		fireEvent.click(screen.getByRole("button", { name: "Submit response" }));

		expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent(
			"1 of 1 attempts used",
		);
		expect(screen.queryByText("Not quite")).not.toBeInTheDocument();
		expect(container.querySelector("[data-block-id='survey']")).toHaveAttribute(
			"data-completed",
			"true",
		);
		expect(submitted).toMatchObject({
			blockId: "survey",
			responseText: "optics",
			assessmentType: "choice",
		});
		expect(submitted).not.toHaveProperty("correct", false);
	});

	it("keeps unchanged description markup mounted while typing", () => {
		const data = {
			assessmentType: "textResponse",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Comments</p>" } }],
			description: [
				{
					id: "description",
					type: "text",
					data: { content: '<p><span class="praxity-doodle">Visible prompt</span></p>' },
				},
			],
			response: { type: "textResponse", inputType: "short" },
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="comments" />
			</Wrapper>,
		);
		const description = container.querySelector(".praxity-assessment-description");

		fireEvent.change(screen.getByRole("textbox"), { target: { value: "A comment" } });

		expect(container.querySelector(".praxity-assessment-description")).toBe(description);
	});

	describe("inputs disabled after submit", () => {
		it("disables radio buttons after clicking Check", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q1" />
				</Wrapper>,
			);

			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			expect(getRadio("Wrong answer").disabled).toBe(true);
			expect(getRadio("Right answer").disabled).toBe(true);
		});

		it("disables checkboxes after clicking Check (multi-select)", () => {
			const data = makeChoiceData({
				response: {
					type: "choice",
					selectionMode: "multiple",
					inputMethod: "click",
					display: "list",
					shuffle: false,
					options: [
						{ id: "a", label: "Option A", isCorrect: true },
						{ id: "b", label: "Option B", isCorrect: false },
						{ id: "c", label: "Option C", isCorrect: true },
					],
				} satisfies ChoiceResponse,
			});

			render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="q2" />
				</Wrapper>,
			);

			const checkboxA = screen.getByRole("checkbox", {
				name: "Option A",
			}) as HTMLInputElement;
			fireEvent.click(checkboxA);
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			expect(
				(screen.getByRole("checkbox", { name: "Option A" }) as HTMLInputElement).disabled,
			).toBe(true);
			expect(
				(screen.getByRole("checkbox", { name: "Option B" }) as HTMLInputElement).disabled,
			).toBe(true);
			expect(
				(screen.getByRole("checkbox", { name: "Option C" }) as HTMLInputElement).disabled,
			).toBe(true);
		});
	});

	describe("knowledge check retry flow", () => {
		it("shows Try again button when wrong answer submitted", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q3" />
				</Wrapper>,
			);

			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		});

		it("shows Incorrect feedback for wrong answer", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q4" />
				</Wrapper>,
			);

			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			expect(screen.getAllByText("Not quite")).toHaveLength(1);
			expect(screen.getByText("Not quite.")).toBeTruthy();
		});

		it("shows Correct feedback for right answer", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q5" />
				</Wrapper>,
			);

			fireEvent.click(getRadio("Right answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			expect(screen.getAllByText("Correct")[0]).toBeTruthy();
			expect(screen.getByText("Well done!")).toBeTruthy();
			// No try again when correct
			expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		});

		it("re-enables inputs after clicking Try again", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q6" />
				</Wrapper>,
			);

			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			// Inputs disabled
			expect(getRadio("Wrong answer").disabled).toBe(true);

			// Click try again
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));

			// Inputs re-enabled
			expect(getRadio("Wrong answer").disabled).toBe(false);
			expect(getRadio("Right answer").disabled).toBe(false);

			// Check button should be gone (need to interact first)
			expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
		});

		it("does not mark data-completed until correct answer", () => {
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q7" />
				</Wrapper>,
			);
			const card = container.querySelector("[data-block-id='q7']") as Element;

			// Submit wrong answer
			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));
			expect(card.getAttribute("data-completed")).toBeNull();

			// Try again, submit correct answer
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));
			fireEvent.click(getRadio("Right answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));
			expect(card.getAttribute("data-completed")).toBe("true");
		});

		it("allows unlimited retries by default for knowledge checks", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q8" />
				</Wrapper>,
			);

			// Submit wrong 5 times — should always get Try again
			for (let i = 0; i < 5; i++) {
				fireEvent.click(getRadio("Wrong answer"));
				fireEvent.click(screen.getByRole("button", { name: "Check" }));
				expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
				fireEvent.click(screen.getByRole("button", { name: "Try again" }));
			}
		});

		it("does not show attempt counter for infinite attempts", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q9" />
				</Wrapper>,
			);

			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));

			// Should not show "Attempt X of Y"
			expect(screen.queryByText(/Attempt \d+ of/)).toBeNull();
		});
	});

	describe("graded behavior unchanged", () => {
		it("allows unlimited retries when a graded assessment sets attempts to 0", () => {
			render(
				<Wrapper>
					<PreviewAssessmentBlock
						data={makeChoiceData({ gradingMode: "exact", attempts: 0 })}
						blockId="q-unlimited-graded"
					/>
				</Wrapper>,
			);

			for (let attempt = 0; attempt < 3; attempt++) {
				fireEvent.click(getRadio("Wrong answer"));
				fireEvent.click(screen.getByRole("button", { name: "Submit" }));
				fireEvent.click(screen.getByRole("button", { name: "Try again" }));
			}
		});

		it("renders a result when authored feedback is empty", () => {
			const data = makeChoiceData({
				gradingMode: "exact",
				feedback: {},
				feedbackEnabled: undefined,
			});

			render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="q-result-without-feedback" />
				</Wrapper>,
			);
			const feedback = document.querySelector("[data-assessment-feedback]");
			expect(feedback).toBeEmptyDOMElement();

			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));

			expect(feedback).toHaveTextContent("1 of 1 attempts used");
			expect(document.querySelector("[data-option-feedback]")).toHaveTextContent("Not quite");
			expect(feedback?.querySelector("[data-feedback-details]")).toBeNull();
			expect(feedback).not.toHaveTextContent("Not quite.");
		});

		it("completes after single attempt when graded with default attempts", () => {
			const data = makeChoiceData({
				gradingMode: "exact",
				feedbackEnabled: undefined,
			});

			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="q10" />
				</Wrapper>,
			);
			const card = container.querySelector("[data-block-id='q10']") as Element;

			// Submit wrong answer with 1 attempt (default for graded)
			fireEvent.click(getRadio("Wrong answer"));
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));

			// Should complete (out of attempts) and NOT show try again
			expect(card.getAttribute("data-completed")).toBe("true");
			expect(card.getAttribute("data-passed")).toBe("false");
			expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		});

		it("sets data-score and data-passed for graded assessments", () => {
			const data = makeChoiceData({
				gradingMode: "exact",
				points: 50,
			});

			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="q11" />
				</Wrapper>,
			);
			const card = container.querySelector("[data-block-id='q11']") as Element;

			// Initial state has scoring attributes
			expect(card.getAttribute("data-score")).toBe("0");
			expect(card.getAttribute("data-passed")).toBe("false");
		});

		it("does not render data-score/data-passed for knowledge checks", () => {
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={makeChoiceData()} blockId="q12" />
				</Wrapper>,
			);
			const card = container.querySelector("[data-block-id='q12']") as Element;

			expect(card.getAttribute("data-score")).toBeNull();
			expect(card.getAttribute("data-passed")).toBeNull();
		});
	});
});

describe("PreviewAssessmentBlock — hotspot", () => {
	it.each([
		["", "Equipment controls with a valve and gauge"],
		["Select the valve.", "Select the valve."],
	])("names a hotspot with question %j without an author placeholder", (question, name) => {
		const source = `# Fixture {hideTitle}

::: hotspot ${question || "Controls"} {scored points=10 attempts=2}
![Equipment controls with a valve and gauge](/assets/controls.png)
- Valve {x=30 y=40 correct}
- Gauge {x=60 y=50}
:::
`;
		const block = adaptGrammarPreviewBlocks(readBlockSource(source).blocks)[0];
		if (!question) block.data.stem = [];
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={block.data as unknown as AssessmentBlockData}
					blockId={block.id}
				/>
			</Wrapper>,
		);
		expect(screen.getByRole("group", { name })).toBeInTheDocument();
		expect(screen.queryByText("No question text")).toBeNull();
		expect(container.querySelector(".praxity-required-indicator")).toHaveTextContent("Required");
		expect(container.querySelector("[data-max-score]")).toHaveAttribute("data-max-score", "10");
		fireEvent.click(screen.getByRole("button", { name: "Valve" }));
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
		expect(container.querySelector("[data-score]")).toHaveAttribute("data-score", "10");
		expect(container.querySelector("[data-passed]")).toHaveAttribute("data-passed", "true");
	});

	it("discards a completed answer when its hotspot was removed", () => {
		installLearnerBlockState({
			"edited-hotspot": {
				version: 1,
				kind: "assessment",
				assessmentType: "hotspot",
				attemptCount: 1,
				checked: true,
				correct: true,
				completed: true,
				interacted: true,
				answer: ["removed"],
			},
		});
		const data: AssessmentBlockData = {
			assessmentType: "hotspot",
			stem: [{ id: "prompt", type: "text", data: { content: "Select the valve" } }],
			response: {
				type: "hotspot",
				image: "/diagram.png",
				imageAlt: "Diagram",
				mode: "select",
				hotspots: [
					{
						id: "valve",
						label: "Valve",
						shape: "ellipse",
						coords: [50, 50, 10, 10],
						isCorrect: true,
					},
				],
			},
			feedback: {},
			gradingMode: "exact",
		};
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="edited-hotspot" />
			</Wrapper>,
		);

		expect(screen.getByRole("button", { name: "Valve" })).toHaveAttribute("aria-pressed", "false");
		const assessment = container.querySelector("[data-block-id='edited-hotspot']");
		expect(assessment).toHaveAttribute("data-assessment-answered", "false");
		expect(assessment).not.toHaveAttribute("data-attempted");
		expect(assessment).not.toHaveAttribute("data-result");
		expect(assessment).not.toHaveAttribute("data-completed");
		expect(assessment).toHaveAttribute("data-score", "0");
		expect(container.querySelector("[data-assessment-feedback]")).toBeEmptyDOMElement();
	});
});

describe("PreviewAssessmentBlock — fill blank", () => {
	function makeFillBlankData(
		blanks: FillBlankResponse["blanks"],
		overrides: Partial<AssessmentBlockData> = {},
	): AssessmentBlockData {
		return {
			assessmentType: "fillBlank",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Complete the sentence</p>" } }],
			response: { type: "fillBlank", blanks },
			feedback: {},
			gradingMode: "exact",
			points: 25,
			...overrides,
		} as AssessmentBlockData;
	}

	function submitFillBlank(values: string[]) {
		const inputs = screen.getAllByRole("textbox");
		values.forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
	}

	it("renders fill-blank inputs from response blanks", () => {
		const data = {
			assessmentType: "fillBlank",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Complete the sentence</p>" } }],
			response: {
				type: "fillBlank",
				blanks: [
					{ id: "b1", answer: "permit" },
					{ id: "b2", answer: "oxygen" },
				],
			} satisfies FillBlankResponse,
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;

		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="fill-blank-1" />
			</Wrapper>,
		);

		expect(screen.getAllByRole("textbox")).toHaveLength(2);
		expect(screen.queryByText("No response configured")).toBeNull();
		expect(screen.queryByText("No question text")).toBeNull();
	});

	it("renders the authored sentence with underscore blanks inline", () => {
		const data = {
			assessmentType: "fillBlank",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Finish these sentences</p>" } }],
			response: {
				type: "fillBlank",
				template: "I feel ____. Today I will ____.",
				blanks: [
					{ id: "b1", answer: "" },
					{ id: "b2", answer: "" },
				],
			} satisfies FillBlankResponse,
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;

		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="fill-blank-inline" />
			</Wrapper>,
		);

		expect(container.querySelector(".praxity-fill-blank-template")?.textContent).toContain(
			"I feel ",
		);
		expect(screen.getAllByRole("textbox")).toHaveLength(2);
		expect(
			screen.getByRole("textbox", { name: /Blank 1 of 2, after “I feel”/ }),
		).not.toHaveAttribute("placeholder");
		expect(
			screen.getByRole("textbox", { name: /Blank 2 of 2, after “Today I will”/ }),
		).toBeInTheDocument();
		expect(container.querySelectorAll(".praxity-fill-blank-unit")).toHaveLength(2);
	});

	it("renders only the authored prompt when response configuration is missing", () => {
		const data = {
			assessmentType: "fillBlank",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Authored prompt</p>" } }],
			feedback: {},
			gradingMode: "none",
		} as unknown as AssessmentBlockData;

		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="missing-response" />
			</Wrapper>,
		);

		expect(screen.getByText("Authored prompt")).toBeTruthy();
		expect(screen.queryByText("No response configured")).toBeNull();
	});

	it("scores a correct known answer above zero", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeFillBlankData([{ id: "b1", answer: "permit" }])}
					blockId="fill-blank-correct"
				/>
			</Wrapper>,
		);

		submitFillBlank(["permit"]);

		const card = container.querySelector("[data-block-id='fill-blank-correct']");
		expect(card).toHaveAttribute("data-score", "25");
		expect(card).toHaveAttribute("data-passed", "true");
		expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent("Correct");
	});

	it("scores a wrong known answer as zero", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeFillBlankData([{ id: "b1", answer: "permit" }])}
					blockId="fill-blank-wrong"
				/>
			</Wrapper>,
		);

		submitFillBlank(["deny"]);

		const card = container.querySelector("[data-block-id='fill-blank-wrong']");
		expect(card).toHaveAttribute("data-score", "0");
		expect(card).toHaveAttribute("data-passed", "false");
		expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
		expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent("Not quite");
	});

	it("normalizes case, surrounding and internal whitespace, and canonical Unicode", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeFillBlankData([{ id: "b1", answer: "Café au lait" }])}
					blockId="fill-blank-normalized"
				/>
			</Wrapper>,
		);

		submitFillBlank(["  CAFE\u0301   AU\tLAIT  "]);

		expect(container.querySelector("[data-block-id='fill-blank-normalized']")).toHaveAttribute(
			"data-passed",
			"true",
		);
	});

	it("accepts a configured alternative", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeFillBlankData([{ id: "b1", answer: "oxygen", alternatives: ["O2"] }])}
					blockId="fill-blank-alternative"
				/>
			</Wrapper>,
		);

		submitFillBlank([" o2 "]);

		expect(container.querySelector("[data-block-id='fill-blank-alternative']")).toHaveAttribute(
			"data-passed",
			"true",
		);
	});

	it("scores mixed known and open blanks against known answers only", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeFillBlankData([
						{ id: "known", answer: "permit" },
						{ id: "open", answer: "" },
					])}
					blockId="fill-blank-mixed"
				/>
			</Wrapper>,
		);

		submitFillBlank(["PERMIT", "My reflection"]);

		const card = container.querySelector("[data-block-id='fill-blank-mixed']");
		expect(card).toHaveAttribute("data-score", "25");
		expect(card).toHaveAttribute("data-passed", "true");
		expect(card).toHaveAttribute("data-assessment-answered", "true");
		expect(container.querySelectorAll(".praxity-fill-blank-status")).toHaveLength(1);
	});

	it("treats an all-open scored block as completion-only", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={makeFillBlankData([
						{ id: "open-1", answer: "" },
						{ id: "open-2", answer: "" },
					])}
					blockId="fill-blank-open"
				/>
			</Wrapper>,
		);
		const card = container.querySelector("[data-block-id='fill-blank-open']");

		expect(card).not.toHaveAttribute("data-score");
		expect(card).not.toHaveAttribute("data-passed");
		submitFillBlank(["One", "Two"]);
		expect(card).toHaveAttribute("data-completed", "true");
		expect(card).toHaveAttribute("data-assessment-answered", "true");
		expect(card).not.toHaveAttribute("data-score");
		expect(container.querySelector(".praxity-fill-blank-status")).toBeNull();
		expect(container.querySelector("[data-assessment-feedback]")).toHaveTextContent("Completed");
		expect(container.querySelector("[data-assessment-feedback]")).not.toHaveTextContent(
			/Correct|Incorrect/,
		);
	});
});

describe("PreviewAssessmentBlock — matrix", () => {
	it("names the table with its question while keeping statement and scale radio names", () => {
		const question = "How clearly could you locate each constellation?";
		const data = {
			assessmentType: "matrix",
			stem: [{ id: "stem", type: "text", data: { content: `<p>${question}</p>` } }],
			response: {
				type: "matrix",
				statements: [{ id: "quality", text: "Clarity of star maps" }],
				scalePoints: [
					{ value: 1, label: "Perfectly clear" },
					{ value: 2, label: "Mostly clear" },
				],
			},
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;

		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="matrix-question" />
			</Wrapper>,
		);

		const table = screen.getByRole("table", { name: question });
		const stem = document.getElementById(table.getAttribute("aria-labelledby") ?? "");
		expect(stem).toMatchObject({ tagName: "P" });
		expect(stem).toHaveTextContent(question);
		expect(
			screen.getByRole("radio", { name: "Clarity of star maps: Perfectly clear" }),
		).toBeVisible();
		expect(screen.getByRole("radio", { name: "Clarity of star maps: Mostly clear" })).toBeVisible();
	});

	it.each([
		["adds a statement", ["quality", "speed"], { quality: [1] }],
		["removes a statement", ["quality"], { quality: [1], speed: [2] }],
		["has an unanswered statement", ["quality"], { quality: [] }],
	])("ignores saved answers when the author %s", (_label, statementIds, answer) => {
		installLearnerBlockState({
			"matrix-compatibility": {
				version: 1,
				kind: "assessment",
				assessmentType: "matrix",
				attemptCount: 1,
				checked: true,
				correct: false,
				completed: true,
				interacted: true,
				answer,
			},
		});
		const data = {
			assessmentType: "matrix",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Rate the star maps</p>" } }],
			response: {
				type: "matrix",
				statements: statementIds.map((id) => ({ id, text: id })),
				scalePoints: [
					{ value: 1, label: "Mostly clear" },
					{ value: 2, label: "Mostly unclear" },
				],
			},
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;

		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="matrix-compatibility" />
			</Wrapper>,
		);

		expect(
			container.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked'),
		).toHaveLength(0);
		expect(container.querySelector("[data-attempted]")).toBeNull();
	});

	it("reserves minimum space for scale columns", () => {
		const data = {
			assessmentType: "matrix",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Rate the star maps</p>" } }],
			response: {
				type: "matrix",
				statements: [{ id: "quality", text: "Clarity of star maps" }],
				scalePoints: [
					{ value: 1, label: "Perfectly clear" },
					{ value: 2, label: "Mostly clear" },
					{ value: 3, label: "Partly clear" },
					{ value: 4, label: "Mostly unclear" },
					{ value: 5, label: "Completely unclear" },
				],
			},
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="matrix-1" />
			</Wrapper>,
		);
		const table = container.querySelector<HTMLElement>(".praxity-matrix-table");

		expect(table?.style.getPropertyValue("--praxity-matrix-min-width")).toBe("51.5rem");
		expect(table?.querySelectorAll("col")).toHaveLength(6);
		expect(table?.querySelectorAll("col:not(.praxity-matrix-statement-column)")).toHaveLength(5);
	});
});

describe("PreviewAssessmentBlock — categorize", () => {
	it("restores legacy text keys for repeated items independently of DOM ids", () => {
		const text = `J'ai besoin du rapport ["été"]`;
		const answer = { [JSON.stringify([text, 0])]: "a", [JSON.stringify([text, 1])]: "b" };
		const { values } = installLearnerBlockState({
			"legacy-categorize": {
				version: 1,
				kind: "assessment",
				assessmentType: "categorize",
				attemptCount: 0,
				checked: false,
				correct: false,
				completed: false,
				interacted: true,
				answer,
			},
		});
		const data = {
			assessmentType: "categorize",
			shuffle: true,
			response: {
				type: "categorize",
				categories: [
					{ id: "a", name: "Urgent", items: [text] },
					{ id: "b", name: "Plus tard", items: [text] },
				],
			},
			gradingMode: "exact",
		} as AssessmentBlockData;
		const content = (
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="legacy-categorize" />
			</Wrapper>
		);
		const first = render(content);
		const ids = () =>
			Array.from(document.querySelectorAll("tbody th[id]"), (element) => element.id).sort();
		const before = ids();
		expect(document.querySelectorAll("input:checked")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(values.get("legacy-categorize")).toMatchObject({ answer, correct: true, checked: true });
		first.unmount();
		render(content);
		expect(ids()).toEqual(before);
		expect(document.querySelectorAll("input:checked")).toHaveLength(2);
		expect(document.querySelector('[data-result="correct"]')).toBeTruthy();
	});

	it("renders items in an accessible category matrix", () => {
		const data = {
			assessmentType: "categorize",
			stem: [{ id: "stem", type: "text", data: { content: "<p>Sort by PPE type</p>" } }],
			response: {
				type: "categorize",
				categories: [
					{
						id: "c1",
						name: "Head Protection",
						image: "/assets/head.jpg",
						imageAlt: "Hard hat and helmet",
						items: ["Hard hat"],
					},
					{ id: "c2", name: "Eye Protection", items: ["Safety goggles"] },
				],
			},
			feedback: {},
			gradingMode: "none",
		} as AssessmentBlockData;

		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="categorize-1" />
			</Wrapper>,
		);

		expect(screen.getByText("Hard hat")).toBeTruthy();
		expect(screen.getByText("Safety goggles")).toBeTruthy();
		expect(container.querySelector(".praxity-categorize-table")).toBeTruthy();
		expect(screen.getByRole("columnheader", { name: /Head Protection/ })).toBeTruthy();
		expect(screen.getByRole("rowheader", { name: "Hard hat" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Hard hat: Head Protection" })).toBeTruthy();
		expect(screen.getByAltText("Hard hat and helmet")).toBeTruthy();
		expect(screen.queryByText("No response configured")).toBeNull();
	});
});

describe("fill-blank native selections", () => {
	function data(style: "dropdown" | "word-bank", extra = ""): AssessmentBlockData {
		return adaptGrammarPreviewBlocks(
			readBlockSource(
				`# Fixture {hideTitle}\n\n::: fill-blank Complete {style=${style} scored attempts=2}\n${style === "word-bank" ? "bank: red | blue | red | green\n" : ""}${extra}\n${style === "dropdown" ? "Choose {red|*blue|green} and {*fast|slow|quick}." : "Choose {red} then {red} then {blue}."}\n:::\n`,
			).blocks,
		)[0].data as unknown as AssessmentBlockData;
	}
	it("grades distractors, retries and restores native dropdown answers", () => {
		const { values } = installLearnerBlockState();
		const config = data("dropdown");
		const { container, unmount } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={config} blockId="selects" />
			</Wrapper>,
		);
		const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
		expect(Array.from(selects[0].options).map((option) => option.value)).toEqual([
			"",
			"red",
			"blue",
			"green",
		]);
		fireEvent.change(selects[0], { target: { value: "red" } });
		fireEvent.change(selects[1], { target: { value: "fast" } });
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
		expect(container.querySelector('[data-block-id="selects"]')).toHaveAttribute("data-score", "0");
		expect(selects[0]).toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
		fireEvent.change(selects[0], { target: { value: "blue" } });
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
		expect(container.querySelector('[data-block-id="selects"]')).toHaveAttribute(
			"data-score",
			"100",
		);
		expect(values.get("selects")).toMatchObject({ checked: true });
		unmount();
		render(
			<Wrapper>
				<PreviewAssessmentBlock data={config} blockId="selects" />
			</Wrapper>,
		);
		expect(screen.getAllByRole("combobox")[0]).toHaveValue("blue");
		expect(screen.getAllByRole("combobox")[0]).toBeDisabled();
	});
	it("allocates repeated bank words, releases them and rejects over-allocation", () => {
		const config = data("word-bank");
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={config} blockId="bank" />
			</Wrapper>,
		);
		const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
		const red = () => Array.from(selects[2].options).find((option) => option.value === "red");
		fireEvent.change(selects[0], { target: { value: "red" } });
		expect(red()).not.toBeDisabled();
		fireEvent.change(selects[1], { target: { value: "red" } });
		expect(red()).toBeDisabled();
		fireEvent.change(selects[2], { target: { value: "red" } });
		expect(selects[2]).toHaveValue("");
		fireEvent.change(selects[0], { target: { value: "" } });
		expect(red()).not.toBeDisabled();
		fireEvent.change(selects[0], { target: { value: "red" } });
		fireEvent.change(selects[2], { target: { value: "blue" } });
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
		expect(container.querySelector('[data-block-id="bank"]')).toHaveAttribute("data-score", "100");
	});
	it.each(["dropdown", "word-bank"] as const)("discards invalid restored %s answers", (style) => {
		const config = data(style);
		const blanks = (config.response as FillBlankResponse).blanks;
		installLearnerBlockState({
			invalid: {
				version: 1,
				kind: "assessment",
				assessmentType: "fillBlank",
				answer: Object.fromEntries(
					blanks.map((blank) => [blank.id, style === "word-bank" ? "red" : "missing"]),
				),
				checked: false,
				attemptCount: 0,
				correct: false,
				completed: false,
				interacted: true,
			},
		});
		render(
			<Wrapper>
				<PreviewAssessmentBlock data={config} blockId="invalid" />
			</Wrapper>,
		);
		for (const select of screen.getAllByRole("combobox")) expect(select).toHaveValue("");
	});
});

it("rejects malformed persisted blank collections without throwing", () => {
	for (const blanks of [null, {}, [null], [{ answer: "blue" }]]) {
		expect(
			validFillBlankSelections(
				{ type: "fillBlank", style: "dropdown", blanks } as unknown as FillBlankResponse,
				{},
			),
		).toBe(false);
	}
});

it.each(["dropdown", "word-bank"] as const)(
	"uses exact %s choices for feedback, score and restored results",
	(style) => {
		const { values } = installLearnerBlockState();
		const config = adaptGrammarPreviewBlocks(
			readBlockSource(
				`# Fixture {hideTitle}\n\n::: fill-blank Choose {style=${style} scored}\n${style === "word-bank" ? "bank: US | us\n" : ""}\nSelect ${style === "dropdown" ? "{*US|us}" : "{US}"}.\n:::\n`,
			).blocks,
		)[0].data as unknown as AssessmentBlockData;
		const { container, unmount } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={config} blockId="case" />
			</Wrapper>,
		);
		fireEvent.change(screen.getByRole("combobox"), { target: { value: "us" } });
		fireEvent.click(screen.getByRole("button", { name: /Submit|Check/ }));
		expect(container.querySelector('[data-block-id="case"]')).toHaveAttribute("data-score", "0");
		expect(container.querySelector(".praxity-fill-blank-status")).toHaveAttribute(
			"data-result",
			"incorrect",
		);
		expect(values.get("case")).toMatchObject({ correct: false });
		unmount();
		const restored = render(
			<Wrapper>
				<PreviewAssessmentBlock data={config} blockId="case" />
			</Wrapper>,
		);
		expect(screen.getByRole("combobox")).toHaveValue("us");
		expect(restored.container.querySelector(".praxity-fill-blank-status")).toHaveAttribute(
			"data-result",
			"incorrect",
		);
	},
);

it("private choices save selection, Check and retry through existing authority and restore silently", () => {
	const state = installLearnerBlockState();
	const reported = vi.fn();
	document.addEventListener("praxity:assessment-response", reported);
	const data = makeChoiceData({ private: true, attempts: 2 });
	try {
		const view = render(<PreviewAssessmentBlock blockId="private-choice" data={data} />, {
			wrapper: Wrapper,
		});
		expect(state.write).not.toHaveBeenCalled();
		fireEvent.click(getRadio("Wrong answer"));
		expect(state.values.get("private-choice")).toMatchObject({
			answer: ["a"],
			attemptCount: 0,
			checked: false,
			interacted: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		expect(state.values.get("private-choice")).toMatchObject({
			answer: ["a"],
			attemptCount: 1,
			checked: true,
			reviewedChoiceIds: ["a"],
		});
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(state.values.get("private-choice")).toMatchObject({
			answer: [],
			attemptCount: 1,
			checked: false,
			interacted: false,
			reviewedChoiceIds: ["a"],
		});
		view.unmount();
		state.write.mockClear();
		const restored = render(<PreviewAssessmentBlock blockId="private-choice" data={data} />, {
			wrapper: Wrapper,
		});
		expect(state.write).not.toHaveBeenCalled();
		expect(reported).not.toHaveBeenCalled();
		restored.unmount();
		state.values.clear();
		render(<PreviewAssessmentBlock blockId="private-choice" data={data} />, { wrapper: Wrapper });
		expect(
			screen.getAllByRole("radio").every((input) => !(input as HTMLInputElement).checked),
		).toBe(true);
		expect(state.write).not.toHaveBeenCalled();
	} finally {
		document.removeEventListener("praxity:assessment-response", reported);
	}
});

// Print media can hide a focused action before beforeprint/afterprint arrive.
it.each([
	"media-only",
	"events-only",
	"beforeprint-first",
	"media-first",
	"afterprint-before-screen",
])("restores the checked choice action after %s without changing learner state", (order) => {
	const media = Object.assign(new EventTarget(), { matches: false, media: "print" });
	const originalMatchMedia = window.matchMedia;
	vi.spyOn(window, "matchMedia").mockImplementation((query) =>
		query === "print" ? (media as MediaQueryList) : originalMatchMedia(query),
	);
	const state = installLearnerBlockState();
	const view = render(
		<PreviewAssessmentBlock
			blockId="print-choice"
			data={makeChoiceData({ private: true, attempts: 2 })}
		/>,
		{ wrapper: Wrapper },
	);
	fireEvent.click(getRadio("Wrong answer"));
	fireEvent.click(screen.getByRole("button", { name: "Check" }));
	const retry = screen.getByRole("button", { name: "Try again" });
	expect(retry).toHaveFocus();
	state.write.mockClear();
	const change = (matches: boolean) => {
		media.matches = matches;
		media.dispatchEvent(Object.assign(new Event("change"), { matches }));
	};
	try {
		if (order === "beforeprint-first" || order === "events-only")
			window.dispatchEvent(new Event("beforeprint"));
		if (order !== "events-only") change(true);
		retry.blur();
		if (order === "media-first") window.dispatchEvent(new Event("beforeprint"));
		if (order === "afterprint-before-screen") {
			window.dispatchEvent(new Event("afterprint"));
			expect(retry).not.toHaveFocus();
		}
		if (order !== "events-only") change(false);
		window.dispatchEvent(new Event("afterprint"));
		expect(retry).toHaveFocus();
		expect(getRadio("Wrong answer")).toBeChecked();
		expect(
			view.container.querySelector("[data-option-feedback], [data-feedback-explanation]")
				?.textContent,
		).toContain("Not quite");
		expect(state.write).not.toHaveBeenCalled();
	} finally {
		view.unmount();
		vi.restoreAllMocks();
	}
});

it.each([
	"unchanged",
	"other",
	"other-then-body",
	"pointerdown",
	"keydown",
	"pagehide",
	"unmount",
	"removed",
	"hidden",
	"inert",
	"disabled",
])("does not reclaim choice print focus after %s", (mode) => {
	const media = Object.assign(new EventTarget(), { matches: false, media: "print" });
	const originalMatchMedia = window.matchMedia;
	vi.spyOn(window, "matchMedia").mockImplementation((query) =>
		query === "print" ? (media as MediaQueryList) : originalMatchMedia(query),
	);
	const view = render(<PreviewAssessmentBlock blockId="print-choice" data={makeChoiceData()} />, {
		wrapper: Wrapper,
	});
	const control = getRadio("Wrong answer");
	const other = document.createElement("button");
	document.body.append(other);
	control.focus();
	const focus = vi.spyOn(control, "focus");
	try {
		window.dispatchEvent(new Event("beforeprint"));
		if (mode !== "unchanged") control.blur();
		if (mode.startsWith("other")) other.focus();
		if (mode === "other-then-body") other.blur();
		if (mode === "pointerdown" || mode === "keydown") document.dispatchEvent(new Event(mode));
		if (mode === "pagehide") window.dispatchEvent(new Event("pagehide"));
		if (mode === "unmount") view.unmount();
		if (mode === "removed") control.remove();
		if (["hidden", "inert", "disabled"].includes(mode)) control.setAttribute(mode, "");
		window.dispatchEvent(new Event("afterprint"));
		expect(focus).not.toHaveBeenCalled();
		if (mode === "other") expect(other).toHaveFocus();
	} finally {
		view.unmount();
		other.remove();
		vi.restoreAllMocks();
	}
});
