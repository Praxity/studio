import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PreviewAssessmentBlock } from "../src/blocks/AssessmentBlock";
import { LocaleContext } from "../src/i18n";
import { getStrings } from "../src/i18n/strings";
import type { AssessmentBlockData, ChoiceResponse, PraxityBlock } from "../src/types";
import { initAssessmentGroups } from "../src/viewer/assessment-group-runtime";

function Wrapper({ children }: { children: ReactNode }) {
	return <MantineProvider>{children}</MantineProvider>;
}

function expectValidAssessmentIds() {
	const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
	for (const element of document.querySelectorAll(".praxity-block-assessment [id], [id^='rs-']"))
		expect(element.id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
	expect(new Set(ids).size).toBe(ids.length);
	for (const element of document.querySelectorAll(
		"[aria-labelledby], [aria-describedby], [aria-controls], label[for]",
	)) {
		for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls", "for"]) {
			for (const id of element.getAttribute(attribute)?.split(/\s+/) ?? []) {
				expect(document.getElementById(id), `${attribute}=${id}`).toBeTruthy();
			}
		}
	}
}

describe("Assessment element ids", () => {
	it("keeps categorize ids valid, unique and stable for shuffled repeated French text", () => {
		const text = `J'ai besoin du rapport ["été"] maintenant`;
		const data = {
			...choiceData,
			assessmentType: "categorize",
			shuffle: true,
			response: {
				type: "categorize",
				categories: [
					{ id: "a", name: "Urgent", items: [text, text] },
					{ id: "b", name: "Plus tard", items: [text] },
				],
			},
		} as AssessmentBlockData;
		const content = (
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="categorize_a" />
				<PreviewAssessmentBlock data={data} blockId="categorize_5f_a" />
			</Wrapper>
		);
		const { container, rerender } = render(content);
		const rowIds = () =>
			Array.from(container.querySelectorAll('tbody th[scope="row"]'), (element) => element.id);
		expect(rowIds()).toHaveLength(6);
		expect(
			Array.from(container.querySelectorAll("tbody td"), (cell) =>
				cell.getAttribute("data-category"),
			),
		).toEqual([
			"Urgent",
			"Plus tard",
			"Urgent",
			"Plus tard",
			"Urgent",
			"Plus tard",
			"Urgent",
			"Plus tard",
			"Urgent",
			"Plus tard",
			"Urgent",
			"Plus tard",
		]);
		expectValidAssessmentIds();
		const before = rowIds();
		fireEvent.click(screen.getAllByRole("radio")[0]);
		rerender(content);
		expect(rowIds()).toEqual(before);
		expectValidAssessmentIds();
		const names = Array.from(
			container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
			(input) => input.name,
		);
		expect(new Set(names).size).toBe(6);
		for (const name of names) expect(name).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
	});

	it("resolves matching labels and open dropdown controls with older arbitrary pair ids", async () => {
		const data = {
			...choiceData,
			assessmentType: "matching",
			response: {
				type: "matching",
				pairs: [{ id: `pair ["été"]`, prompt: "Rapport", correctMatch: "Urgent" }],
			},
		} as AssessmentBlockData;
		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="matching" />
			</Wrapper>,
		);
		const input = screen.getByRole("combobox", { name: "Match for: Rapport" });
		fireEvent.click(input);
		await waitFor(() => expect(input).toHaveAttribute("aria-controls"));
		expect(document.getElementById(input.getAttribute("aria-controls") ?? "")).toBe(
			await screen.findByRole("listbox", { hidden: true }),
		);
		expectValidAssessmentIds();
	});

	it("scopes fill-blank result references by block instead of the persisted blank id", () => {
		const data = {
			...choiceData,
			assessmentType: "fillBlank",
			feedbackMode: "reveal",
			response: { type: "fillBlank", blanks: [{ id: `blank ["été"]`, answer: "rapport" }] },
		} as AssessmentBlockData;
		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="fill-a" />
				<PreviewAssessmentBlock data={data} blockId="fill-b" />
			</Wrapper>,
		);
		for (const input of screen.getAllByRole("textbox"))
			fireEvent.change(input, { target: { value: "rapport" } });
		for (const button of screen.getAllByRole("button", { name: "Check" })) fireEvent.click(button);
		expect(document.querySelectorAll(".praxity-fill-blank-status")).toHaveLength(2);
		expectValidAssessmentIds();
	});
});

const choiceData: AssessmentBlockData = {
	assessmentType: "choice",
	stem: [{ id: "s1", type: "text", data: { content: "What is the capital of France?" } }],
	response: {
		type: "choice",
		selectionMode: "single",
		inputMethod: "click",
		display: "list",
		shuffle: false,
		options: [
			{ id: "a", label: "Paris", isCorrect: true },
			{ id: "b", label: "London", isCorrect: false },
		],
	} satisfies ChoiceResponse,
	feedback: {
		correct: [{ id: "fc", type: "text", data: { content: "Well done!" } }],
		incorrect: [{ id: "fi", type: "text", data: { content: "Try again." } }],
	},
	feedbackEnabled: true,
	gradingMode: "none",
} as AssessmentBlockData;

describe("Assessment hotspot buttons", () => {
	it("renders region controls in source order with names and shape bounds", () => {
		const data = {
			assessmentType: "hotspot",
			response: {
				image: "/diagram.png",
				imageAlt: "Diagram",
				mode: "select",
				hotspots: [
					{ id: "rect", shape: "rect", coords: [10, 20, 30, 15], label: "Valve" },
					{
						id: "polygon",
						shape: "polygon",
						coords: [10, 10, 40, 10, 40, 30, 10, 30],
						label: "Panel",
					},
				],
			},
			stem: [{ type: "text", text: "Select the valve" }],
		};
		render(
			<Wrapper>
				<PreviewAssessmentBlock data={data as unknown as AssessmentBlockData} blockId="regions" />
			</Wrapper>,
		);
		const buttons = screen.getAllByRole("button", { name: /Valve|Panel/ });
		expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Valve", "Panel"]);
		expect(buttons[0].parentElement).toHaveAttribute("data-shape", "rect");
		expect(buttons[0].parentElement).toHaveStyle({
			left: "10%",
			top: "20%",
			width: "30%",
			height: "15%",
		});
		expect(buttons[1].parentElement).toHaveAttribute("data-shape", "polygon");
		expect(buttons[1]).toHaveStyle({ clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)" });
		// The number sits outside the clipped button so a concave polygon cannot hide it.
		expect(buttons[1]).toHaveTextContent("");
		expect(buttons[1].parentElement).toHaveTextContent("2");
		fireEvent.click(buttons[0]);
		expect(buttons[0].parentElement).toHaveTextContent("✓ 1");
	});
	it("hotspot buttons have aria-label and aria-pressed", () => {
		const hotspotData = {
			assessmentType: "hotspot" as const,
			response: {
				image: "/test.png",
				imageAlt: "Test image",
				hotspots: [
					{
						id: "h1",
						coords: [50, 50],
						label: "Capital city",
						indicator: { type: "number" },
					},
					{
						id: "h2",
						coords: [25, 75],
						label: "",
						indicator: { type: "number" },
					},
				],
			},
			stem: [{ type: "text", text: "Click the capital" }],
		};

		render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={hotspotData as any} blockId="blk_h1" />
			</Wrapper>,
		);

		const btn1 = screen.getByRole("button", { name: "Capital city" });
		expect(btn1).toHaveAttribute("aria-pressed", "false");

		// Fallback label when no custom label set
		const btn2 = screen.getByRole("button", { name: "Hotspot 2" });
		expect(btn2).toBeInTheDocument();
	});
});

describe("Assessment text inputs", () => {
	it("TextInput has aria-label from stem text", () => {
		const textData = {
			assessmentType: "textResponse" as const,
			response: { inputType: "short" },
			stem: [{ type: "text", text: "What year was it founded?" }],
		};

		render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={textData as any} blockId="blk_t1" />
			</Wrapper>,
		);

		const input = screen.getByRole("textbox");
		expect(input).toHaveAttribute("aria-label");
	});
});

describe("Assessment choice fieldset", () => {
	it("wraps choice options in a group with accessible name", () => {
		render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={choiceData as any} blockId="blk_c1" />
			</Wrapper>,
		);

		const group = screen.getByRole("radiogroup", { name: /select an answer/i });
		expect(group).toBeInTheDocument();
	});
});

describe("Assessment matching accessibility", () => {
	it("uses labelled comboboxes for matching", () => {
		const matchingData = {
			assessmentType: "matching" as const,
			required: true,
			response: {
				type: "matching" as const,
				pairs: [
					{ id: "p1", prompt: "Capital of France", correctMatch: "Paris" },
					{ id: "p2", prompt: "Capital of Spain", correctMatch: "Madrid" },
				],
				distractors: ["Rome"],
			},
			stem: [{ type: "text", text: "Match each country to its capital." }],
		};

		render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={matchingData as any} blockId="blk_match" />
			</Wrapper>,
		);

		const france = screen.getByRole("combobox", {
			name: /match for:\s*capital of france/i,
		});
		expect(france.tagName).toBe("INPUT");
		expect(france).toBeRequired();
		expect(france).toHaveAttribute("aria-expanded", "false");
		expect(france).not.toHaveAttribute("aria-controls");
		expect(
			screen.getByRole("combobox", { name: /match for:\s*capital of spain/i }),
		).toBeInTheDocument();
		expect(france).toHaveClass("praxity-assessment-select-input");
	});

	it("ignores malformed persisted matching pairs", () => {
		render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={
						{
							assessmentType: "matching",
							response: { type: "matching", pairs: { legacy: true } },
							stem: [],
							feedback: {},
						} as unknown as AssessmentBlockData
					}
					blockId="blk_legacy_match"
				/>
			</Wrapper>,
		);

		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});
});

describe("Assessment sequence progress", () => {
	it.each([
		["down", 2, 0, 1, "up"],
		["up", 2, 1, 0, "down"],
		["down", 3, 1, 2, "up"],
		["up", 3, 1, 0, "down"],
	] as const)(
		"keeps focus on the moved item at the %s boundary with %i items",
		(direction, count, from, to, remaining) => {
			const data = {
				assessmentType: "sequence",
				response: {
					type: "sequence",
					items: [
						{ id: "i1", label: "First", correctPosition: 0 },
						{ id: "i2", label: "Second", correctPosition: 1 },
						{ id: "i3", label: "Third", correctPosition: 2 },
					].slice(0, count),
				},
				stem: [{ id: "stem", type: "text", data: { content: "Put these in order." } }],
			} as AssessmentBlockData;
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId={`focus-${direction}`} />
				</Wrapper>,
			);
			const rows = () => Array.from(container.querySelectorAll(".praxity-order-item"));
			const pressed = rows()[from].querySelector<HTMLButtonElement>(
				`button[aria-label$=" ${direction}"]`,
			);
			expect(pressed).not.toBeNull();
			if (!pressed) return;
			const label = pressed
				.getAttribute("aria-label")
				?.replace(new RegExp(`^Move | ${direction}$`, "g"), "");
			if (!label) throw new Error("Missing move button label");
			const button = screen.getByRole("button", { name: `Move ${label} ${direction}` });
			button.focus();
			// jsdom does not perform the browser's default click for Enter.
			fireEvent.keyDown(button, { key: "Enter" });
			fireEvent.click(button, { detail: 0 });
			fireEvent.keyUp(button, { key: "Enter" });

			expect(rows()[to]).toHaveTextContent(label);
			expect(rows()[from]).not.toHaveTextContent(label);
			expect(
				screen.queryByRole("button", { name: `Move ${label} ${direction}` }),
			).not.toBeInTheDocument();
			expect(screen.getByRole("button", { name: `Move ${label} ${remaining}` })).toHaveFocus();
			expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
				`${label} moved to position ${to + 1} of ${count}`,
			);
			expect(container.querySelector('[aria-live="polite"]')).not.toHaveTextContent(
				/score|correct/i,
			);
		},
	);

	it("announces the move, never how many are already correct", () => {
		const sequenceData = {
			assessmentType: "sequence" as const,
			response: {
				items: [
					{ id: "i1", label: "First", correctPosition: 0 },
					{ id: "i2", label: "Second", correctPosition: 1 },
				],
			},
			stem: [{ type: "text", text: "Put these in order." }],
		};

		render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={sequenceData as any} blockId="blk_seq" />
			</Wrapper>,
		);

		// Live-announcing correctness during the attempt hands the learner the answer
		// and fires on every move; the announcement is now the move itself.
		expect(screen.queryByText(/in correct order/i)).not.toBeInTheDocument();

		// Presentation order is shuffled, so drive whatever landed in the second row
		// rather than assuming which item is where.
		const secondRowLabel = screen
			.getAllByRole("button", { name: /^Move .* up$/ })[0]
			.getAttribute("aria-label")
			?.replace(/^Move | up$/g, "");
		fireEvent.click(screen.getByRole("button", { name: `Move ${secondRowLabel} up` }));
		expect(screen.getByText(`${secondRowLabel} moved to position 1 of 2`)).toBeInTheDocument();
	});

	it("exposes each item's position to assistive tech", () => {
		const sequenceData = {
			assessmentType: "sequence" as const,
			response: {
				items: [
					{ id: "i1", label: "First", correctPosition: 0 },
					{ id: "i2", label: "Second", correctPosition: 1 },
				],
			},
			stem: [{ type: "text", text: "Put these in order." }],
		};

		render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={sequenceData as any} blockId="blk_seq_pos" />
			</Wrapper>,
		);

		expect(screen.getByText(/Position 1 of 2/)).toBeInTheDocument();
		expect(screen.getByText(/Position 2 of 2/)).toBeInTheDocument();
	});
});

describe("AssessmentBlock feedback ARIA", () => {
	it("describes Retry with rich feedback in reading order and clears it on retry", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					blockId="rich-retry"
					data={{
						...choiceData,
						attempts: 2,
						feedback: {
							incorrect: "<p></p><p>First explanation.</p><p>More explanation.</p>",
						},
					}}
				/>
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("radio", { name: "London" }));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		const retry = screen.getByRole("button", { name: "Try again", exact: true });
		expect(retry).toHaveFocus();
		expect(retry).toHaveAccessibleName("Try again");
		expect(retry).toHaveAccessibleDescription("Not quite First explanation. More explanation.");
		expect(retry.getAttribute("aria-describedby")?.split(/\s+/)).toHaveLength(2);
		const feedback = container.querySelector("[data-assessment-feedback]");
		for (const attribute of ["role", "aria-label", "aria-labelledby", "tabindex", "aria-live"])
			expect(feedback).not.toHaveAttribute(attribute);
		fireEvent.click(retry);
		expect(retry).not.toHaveAttribute("aria-describedby");
		expect(container.querySelector('[aria-describedby*="feedback-rich-retry"]')).toBeNull();
		expect(screen.getByRole("radio", { name: "Paris" })).toHaveFocus();
		for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveAccessibleDescription("");
	});
	it.each([
		["en", "Answer checked. Review the results above."],
		["fr", "Réponse vérifiée. Consultez les résultats ci-dessus."],
	] as const)("focuses a meaningful inline-only fill-blank summary in %s", (locale, summary) => {
		const { container } = render(
			<Wrapper>
				<LocaleContext.Provider value={locale}>
					<PreviewAssessmentBlock
						blockId="inline-review"
						data={{
							...choiceData,
							assessmentType: "fillBlank",
							feedbackEnabled: false,
							feedback: {},
							response: { type: "fillBlank", blanks: [{ id: "a", answer: "Paris" }] },
						}}
					/>
				</LocaleContext.Provider>
			</Wrapper>,
		);
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "London" } });
		fireEvent.click(
			screen.getByRole("button", { name: locale === "en" ? "Check" : getStrings("fr").check }),
		);
		const feedback = container.querySelector("[data-assessment-feedback]");
		expect(feedback?.querySelector(".praxity-assessment-result")?.textContent).toBe(summary);
		expect(screen.getByRole("button", { name: getStrings(locale).tryAgain })).toHaveFocus();
		expect(
			screen.getByRole("button", { name: getStrings(locale).tryAgain }),
		).toHaveAccessibleDescription("");
		expect(feedback).not.toHaveAttribute("role");
		expect(feedback).not.toHaveAttribute("tabindex");
		expect(feedback).not.toHaveAttribute("aria-live");
		expect(feedback).not.toHaveAttribute("role", "status");
		expect(container.querySelector(".praxity-fill-blank-status")).toHaveTextContent("Incorrect");
		const retry = screen.getByRole("button", { name: getStrings(locale).tryAgain });
		expect(feedback).toContainElement(retry);
		fireEvent.click(retry);
		expect(screen.getByRole("textbox")).toHaveFocus();
		expect(screen.getByRole("textbox")).not.toHaveAttribute("readonly");
		expect(container.querySelector('[aria-describedby*="feedback-inline-review"]')).toBeNull();
	});
	it.each(["Paris", "London"])("separates the status from authored feedback for %s", (answer) => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={choiceData} blockId="feedback-separator" />
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("radio", { name: answer }));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		const feedback = container.querySelector("[data-assessment-feedback]");
		expect(feedback?.textContent).toMatch(/^Feedback: /);
		const label = feedback?.querySelector(".praxity-sr-only");
		expect(label?.textContent).toBe("Feedback: ");
		expect(label?.childNodes).toHaveLength(1);
		expect(feedback?.textContent).not.toMatch(/(Correct|Not quite)Feedback/);
	});

	it.each([true, false])(
		"keeps Completed feedback correct with authored feedback %s",
		(authored) => {
			const data: AssessmentBlockData = {
				...choiceData,
				assessmentType: "textResponse",
				response: { type: "textResponse", inputType: "short" },
				feedback: authored ? choiceData.feedback : {},
			};
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={data} blockId="completed-separator" />
				</Wrapper>,
			);
			fireEvent.change(screen.getByRole("textbox"), { target: { value: "My answer" } });
			fireEvent.click(screen.getByRole("button", { name: "Submit" }));
			expect(container.querySelector("[data-assessment-feedback]")?.textContent).toBe(
				authored ? "Completed. Feedback: Well done!" : "Completed",
			);
		},
	);

	it.each(["Paris", "London"])(
		"keeps the %s status correct without authored feedback",
		(answer) => {
			const { container } = render(
				<Wrapper>
					<PreviewAssessmentBlock data={{ ...choiceData, feedback: {} }} blockId="status-only" />
				</Wrapper>,
			);
			fireEvent.click(screen.getByRole("radio", { name: answer }));
			fireEvent.click(screen.getByRole("button", { name: "Check" }));
			expect(container.querySelector(".praxity-choice-status")?.textContent).toBe(
				answer === "Paris" ? "Correct" : "Not quite",
			);
		},
	);

	it("moves focus to feedback without a second live announcement channel", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={choiceData} blockId="blk_1" />
			</Wrapper>,
		);
		const feedback = container.querySelector<HTMLElement>("[data-assessment-feedback]");
		expect(feedback).not.toBeNull();
		if (!feedback) return;
		expect(feedback).toBeEmptyDOMElement();
		expect(feedback).not.toHaveAttribute("role", "status");
		expect(feedback).not.toHaveAttribute("aria-live");

		const radio = screen.getByRole("radio", { name: "Paris" });
		fireEvent.click(radio);
		const submitBtn = screen.getByRole("button", { name: /check|submit/i });
		fireEvent.click(submitBtn);

		expect(container.querySelector(".praxity-choice-status")).toHaveTextContent("Correct");
		expect(feedback).not.toHaveTextContent("Correct");
		expect(feedback).toHaveTextContent(/well done/i);
		expect(feedback.querySelector("[data-feedback-details] > span:last-child")).toHaveFocus();
		expect(feedback).not.toHaveAttribute("role");
		expect(feedback).not.toHaveAttribute("tabindex");
	});

	it("focuses the first nonempty feedback paragraph when no next action exists", () => {
		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock
					data={{
						...choiceData,
						feedback: { correct: "<p></p><p>First explanation.</p><p>More explanation.</p>" },
					}}
					blockId="paragraph-feedback"
				/>
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("radio", { name: "Paris" }));
		fireEvent.click(screen.getByRole("button", { name: "Check" }));
		const paragraph = screen.getByText("First explanation.");
		const feedback = container.querySelector("[data-assessment-feedback]");
		expect(paragraph).toHaveFocus();
		expect(paragraph).toHaveAttribute("tabindex", "-1");
		expect(feedback).not.toHaveAttribute("role");
		expect(feedback).not.toHaveAttribute("tabindex");
		expect(container.querySelector("[data-assessment-feedback]")).not.toHaveAttribute("aria-label");
	});
});

describe("Assessment retry focus", () => {
	const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"scrollIntoView",
	);
	// Mantine's autosizing textarea subscribes to the browser FontFaceSet.
	beforeAll(() => {
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		// jsdom does not implement scrolling; browser specs check viewport visibility.
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
	});
	afterAll(() => {
		Reflect.deleteProperty(document, "fonts");
		if (scrollIntoViewDescriptor) {
			Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
		} else {
			Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
		}
	});

	const cases: {
		name: string;
		type: AssessmentBlockData["assessmentType"];
		response: AssessmentBlockData["response"];
		answer: () => void | Promise<void>;
		target: () => HTMLElement;
	}[] = [
		...(["single", "multiple"] as const).map((selectionMode) => ({
			name: `${selectionMode} choice`,
			type: "choice" as const,
			response: { ...(choiceData.response as ChoiceResponse), selectionMode },
			answer: () => {
				fireEvent.click(
					screen.getByRole(selectionMode === "single" ? "radio" : "checkbox", { name: "London" }),
				);
			},
			target: () =>
				screen.getByRole(selectionMode === "single" ? "radio" : "checkbox", { name: "Paris" }),
		})),
		{
			name: "matching",
			type: "matching",
			response: {
				type: "matching",
				inputMethod: "dropdown",
				pairs: [{ id: "a", prompt: "France", correctMatch: "Paris" }],
				distractors: ["London"],
			},
			answer: async () => {
				fireEvent.click(screen.getByRole("combobox"));
				fireEvent.click(await screen.findByRole("option", { name: "London" }));
			},
			target: () => screen.getByRole("combobox", { name: "Match for: France" }),
		},
		{
			name: "sequence",
			type: "sequence",
			response: {
				type: "sequence",
				inputMethod: "drag",
				items: [
					{ id: "a", label: "First", correctPosition: 0 },
					{ id: "b", label: "Second", correctPosition: 1 },
				],
			},
			answer: () => {
				fireEvent.click(screen.getByRole("button", { name: "Move First down" }));
			},
			target: () => screen.getByRole("button", { name: "Move First down" }),
		},
		{
			name: "categorize",
			type: "categorize",
			response: {
				type: "categorize",
				categories: [
					{ id: "a", name: "France", items: ["Paris"] },
					{ id: "b", name: "England", items: [] },
				],
			},
			answer: () => {
				fireEvent.click(screen.getByRole("radio", { name: "Paris: England" }));
			},
			target: () => screen.getByRole("radio", { name: "Paris: France" }),
		},
		{
			name: "hotspot",
			type: "hotspot",
			response: {
				type: "hotspot",
				mode: "select",
				image: "/map.png",
				imageAlt: "Map",
				hotspots: [
					{ id: "a", label: "Paris", shape: "ellipse", coords: [50, 50], isCorrect: true },
					{ id: "b", label: "London", shape: "ellipse", coords: [20, 20], isCorrect: false },
				],
			},
			answer: () => {
				fireEvent.click(screen.getByRole("button", { name: "London" }));
			},
			target: () => screen.getByRole("button", { name: "Paris" }),
		},
		...(["inline-inputs", "dropdown", "word-bank"] as const).map((style) => ({
			name: `fillBlank ${style}`,
			type: "fillBlank" as const,
			response: {
				type: "fillBlank" as const,
				style,
				blanks: [{ id: "a", answer: "Paris", choices: ["Paris", "London"] }],
				wordBank: ["Paris", "London"],
			},
			answer: () => {
				fireEvent.change(screen.getByRole(style === "inline-inputs" ? "textbox" : "combobox"), {
					target: { value: "London" },
				});
			},
			target: () => screen.getByRole(style === "inline-inputs" ? "textbox" : "combobox"),
		})),
		...(["short", "long", "numeric"] as const).map((inputType) => ({
			name: `textResponse ${inputType}`,
			type: "textResponse" as const,
			response: { type: "textResponse" as const, inputType },
			answer: () => {
				fireEvent.change(screen.getByRole(inputType === "numeric" ? "spinbutton" : "textbox"), {
					target: { value: inputType === "numeric" ? "42" : "My answer" },
				});
			},
			target: () => screen.getByRole(inputType === "numeric" ? "spinbutton" : "textbox"),
		})),
		...(["matrix", "likert"] as const).map((type) => ({
			name: type,
			type,
			response: {
				type: "matrix" as const,
				statements: [{ id: "a", text: "The course helped" }],
				scalePoints: [
					{ value: 1, label: "Disagree" },
					{ value: 2, label: "Agree" },
				],
			},
			answer: () => {
				fireEvent.click(screen.getByRole("radio", { name: "The course helped: Agree" }));
			},
			target: () => screen.getByRole("radio", { name: "The course helped: Disagree" }),
		})),
		{
			name: "fileUpload without an enabled response control",
			type: "fileUpload",
			response: { type: "fileUpload", acceptedTypes: [".txt"], maxFileSize: 10, maxFiles: 1 },
			answer: () => {},
			target: () => screen.getByText("What is the capital of France?").closest("p") as HTMLElement,
		},
	];

	it.each(cases)(
		"returns focus to the response area for $name",
		async ({ type, response, answer, target }) => {
			const random =
				type === "sequence" ? vi.spyOn(Math, "random").mockReturnValue(0.99) : undefined;
			try {
				const data = {
					...choiceData,
					assessmentType: type,
					response,
					attempts: 3,
				} as AssessmentBlockData;
				render(
					<Wrapper>
						<PreviewAssessmentBlock data={data} blockId="retry" />
					</Wrapper>,
				);
				await answer();
				fireEvent.click(screen.getByRole("button", { name: /^(Check|Submit)$/ }));
				const retry = screen.getByRole("button", { name: "Try again" });
				retry.focus();
				expect(retry).toHaveFocus();
				const focusAtRemoval: (Element | null)[] = [];
				const removeChild = Node.prototype.removeChild;
				// Observe the synchronous removal itself, before effects can restore focus.
				const removal = vi.spyOn(Node.prototype, "removeChild").mockImplementation(function <
					T extends Node,
				>(this: Node, child: T): T {
					const removesRetry = child === retry || child.contains(retry);
					const removed = removeChild.call(this, child) as T;
					if (removesRetry) focusAtRemoval.push(document.activeElement);
					return removed;
				});
				try {
					fireEvent.click(retry);
				} finally {
					removal.mockRestore();
				}
				expect(focusAtRemoval).toEqual([target()]);
				expect(retry).not.toBeInTheDocument();
				expect(target()).toHaveFocus();
				expect(target()).not.toBeDisabled();
				expect(document.activeElement).not.toBe(document.body);
				if (type === "choice") expect(target()).not.toBeChecked();
			} finally {
				random?.mockRestore();
			}
		},
	);

	it("uses the French attempt counter from the strings table", () => {
		const s = getStrings("fr");
		render(
			<Wrapper>
				<LocaleContext.Provider value="fr">
					<PreviewAssessmentBlock
						data={{ ...choiceData, attempts: 3, feedback: {} }}
						blockId="retry-fr"
					/>
				</LocaleContext.Provider>
			</Wrapper>,
		);
		fireEvent.click(screen.getByRole("radio", { name: "London" }));
		fireEvent.click(screen.getByRole("button", { name: s.check }));
		expect(screen.getByText("Tentatives utilisées : 1 sur 3").textContent).toBe(
			"Tentatives utilisées\u00a0: 1 sur 3",
		);
	});
});

describe("Assessment matrix table headers", () => {
	it("has scope attributes on table headers", () => {
		const matrixData = {
			assessmentType: "likert" as const,
			response: {
				statements: [{ id: "s1", text: "I enjoyed the course" }],
				scalePoints: [
					{ value: 1, label: "Disagree" },
					{ value: 2, label: "Agree" },
				],
			},
			stem: [{ type: "text", text: "Rate the following:" }],
		};

		const { container } = render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={matrixData as any} blockId="blk_m1" />
			</Wrapper>,
		);

		const ths = container.querySelectorAll("th");
		const colHeaders = Array.from(ths).filter((th) => th.getAttribute("scope") === "col");
		expect(colHeaders.length).toBeGreaterThan(0);

		const rowHeaders = Array.from(ths).filter((th) => th.getAttribute("scope") === "row");
		expect(rowHeaders.length).toBeGreaterThan(0);
		expect(rowHeaders[0]).toHaveTextContent("I enjoyed the course");
	});

	it("scopes native radio names per matrix instance and row", () => {
		const matrixData = {
			assessmentType: "matrix" as const,
			response: {
				type: "matrix" as const,
				statements: [{ id: "shared-row", text: "I enjoyed the course" }],
				scalePoints: [
					{ value: 1, label: "Disagree" },
					{ value: 2, label: "Agree" },
				],
			},
			stem: [{ type: "text", text: "Rate the following:" }],
		};
		const { container } = render(
			<Wrapper>
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={matrixData as any} blockId="matrix-1" />
				{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
				<PreviewAssessmentBlock data={matrixData as any} blockId="matrix-2" />
			</Wrapper>,
		);
		const matrices = Array.from(container.querySelectorAll(".praxity-matrix-table"));
		const names = matrices.map((matrix) =>
			Array.from(matrix.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(
				(radio) => radio.name,
			),
		);

		expect(new Set(names[0]).size).toBe(1);
		expect(names[0][0]).not.toBe("");
		expect(names[1][0]).not.toBe(names[0][0]);
	});
});

describe("Assessment submit button marker", () => {
	it("submit button has data-assessment-submit attribute", () => {
		const gradedChoiceData: AssessmentBlockData = {
			assessmentType: "choice",
			stem: [{ id: "s1", type: "text", data: { content: "Pick one" } }],
			response: {
				type: "choice",
				selectionMode: "single",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [
					{ id: "a", label: "A", isCorrect: true },
					{ id: "b", label: "B", isCorrect: false },
				],
			} satisfies ChoiceResponse,
			feedback: {},
			gradingMode: "exact",
			points: 1,
			attempts: 1,
		} as AssessmentBlockData;

		const { container } = render(
			<Wrapper>
				<PreviewAssessmentBlock data={gradedChoiceData} blockId="test-submit" />
			</Wrapper>,
		);
		// Select an option to make the submit button appear
		const options = container.querySelectorAll('input[type="radio"]');
		expect(options.length).toBeGreaterThan(0);
		fireEvent.click(options[0]);
		const submitBtn = container.querySelector('[data-assessment-submit="true"]');
		expect(submitBtn).toBeTruthy();
	});
});

describe("Assessment stem is a labelled paragraph", () => {
	const data = (extra: Record<string, unknown> = {}) => ({
		assessmentType: "choice" as const,
		response: {
			type: "choice",
			selectionMode: "single",
			options: [{ id: "a", text: "A", isCorrect: true }],
		},
		stem: [{ type: "text", data: { content: "<p>What does ARIA stand for?</p>" } }],
		...extra,
	});

	it.each([{ stemLevel: 2 }, { stemLevel: 3, headingOffset: 1 }])(
		"keeps source heading metadata out of the learner outline: %j",
		(metadata) => {
			render(
				<Wrapper>
					{/* biome-ignore lint/suspicious/noExplicitAny: partial test data */}
					<PreviewAssessmentBlock data={data(metadata) as any} blockId="blk_question" />
				</Wrapper>,
			);
			expect(document.querySelector("p.praxity-assessment-stem")).toHaveTextContent(
				"What does ARIA stand for?",
			);
			expect(screen.queryByRole("heading", { name: /What does ARIA stand for/ })).toBeNull();
			expect(
				screen.getByRole("radiogroup", { name: /What does ARIA stand for.*Select an answer/i }),
			).toBeInTheDocument();
			expect(screen.queryByRole("region")).not.toBeInTheDocument();
		},
	);
});

const requiredResponses = [
	[
		"single choice",
		{
			type: "choice",
			selectionMode: "single",
			options: [{ id: "a", label: "Answer", isCorrect: true }],
		},
	],
	[
		"multiple choice",
		{
			type: "choice",
			selectionMode: "multiple",
			options: [{ id: "a", label: "Answer", isCorrect: true }],
		},
	],
	[
		"matching",
		{ type: "matching", pairs: [{ id: "a", prompt: "Prompt", correctMatch: "Answer" }] },
	],
	[
		"categorize",
		{ type: "categorize", categories: [{ id: "a", name: "Answer", items: ["Item"] }] },
	],
	[
		"typed blank",
		{ type: "fillBlank", template: "Say {Answer}", blanks: [{ id: "a", answer: "Answer" }] },
	],
	[
		"dropdown blank",
		{
			type: "fillBlank",
			style: "dropdown",
			template: "Say {Answer}",
			blanks: [{ id: "a", answer: "Answer", choices: ["Answer", "Other"] }],
		},
	],
	[
		"matrix",
		{
			type: "matrix",
			statements: [{ id: "a", text: "Statement" }],
			scalePoints: [{ value: 1, label: "Answer" }],
		},
	],
	["text response", { type: "textResponse", inputType: "short" }],
] as const;

function RequiredQuestion({ response }: { response: AssessmentBlockData["response"] }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const data = {
		assessmentType: response?.type,
		response,
		stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
		description: "Read these instructions.",
		feedback: {},
		gradingMode: "none",
		required: true,
	} as AssessmentBlockData;
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { mode: "all", memberBlockIds: ["question"], requireAll: true },
		},
		{ id: "question", type: "assessment", data },
	] as PraxityBlock[];
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		return initAssessmentGroups({ blocks, root, labels: getStrings("en") });
	}, [blocks]);
	return (
		<Wrapper>
			<div ref={rootRef}>
				<div data-assessment-group-header="group">
					<h2>Questions</h2>
				</div>
				<div className="praxity-block" data-block-id="question">
					<PreviewAssessmentBlock data={data} blockId="question" />
				</div>
			</div>
		</Wrapper>
	);
}

describe("Required question validation timing", () => {
	it.each(requiredResponses)(
		"%s is valid until submit, then associates and clears the error",
		async (_name, response) => {
			Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
				configurable: true,
				value: vi.fn(),
			});
			const { container } = render(
				<RequiredQuestion response={response as unknown as AssessmentBlockData["response"]} />,
			);
			const submit = await screen.findByRole("button", { name: "Check all" });
			const controls = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
				"input:not([type=hidden]), select",
			);
			expect(controls.length).toBeGreaterThan(0);
			for (const control of controls) {
				expect(control).not.toHaveAttribute("required");
				expect(control.matches(":invalid")).toBe(false);
				expect(control).not.toHaveAttribute("aria-invalid", "true");
			}
			expect(container.querySelector(".praxity-required-indicator")).toHaveTextContent("Required");
			fireEvent.click(submit);
			const invalid = container.querySelector('[aria-invalid="true"]');
			expect(invalid).toHaveFocus();
			const error = screen.getByRole("alert");
			expect(error).toHaveTextContent("Answer all required questions before submitting.");
			expect(invalid?.getAttribute("aria-describedby")?.split(/\s+/)).toContain(error.id);
			if (
				response.type === "matching" ||
				response.type === "fillBlank" ||
				response.type === "textResponse"
			)
				expect(invalid).toHaveAttribute(
					"aria-describedby",
					expect.stringContaining("assessment-description-question"),
				);
			const control = controls[0];
			if (control.getAttribute("role") === "combobox") {
				fireEvent.click(control);
				fireEvent.click(await screen.findByRole("option", { name: "Answer" }));
			} else if (control.type === "radio" || control.type === "checkbox") {
				fireEvent.click(control);
			} else {
				fireEvent.change(control, { target: { value: "Answer" } });
			}
			fireEvent.click(submit);
			await waitFor(() =>
				expect(container.querySelector('[data-completed="true"]')).not.toBeNull(),
			);
			expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
			expect(screen.queryByRole("alert")).toBeNull();
			if (
				response.type === "matching" ||
				response.type === "fillBlank" ||
				response.type === "textResponse"
			) {
				expect(control).toHaveAttribute("aria-required", "true");
				expect(control).toHaveAttribute(
					"aria-describedby",
					expect.stringContaining("assessment-description-question"),
				);
			}
		},
	);
});
