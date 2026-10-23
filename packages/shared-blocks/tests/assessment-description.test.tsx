import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { readBlockFixture } from "../../grammar/__tests__/helpers/lesson-fixture.ts";
import { PreviewAssessmentBlock } from "../src/blocks/AssessmentBlock";
import { adaptGrammarPreviewBlocks } from "../src/grammar-adapter";
import type { AssessmentBlockData, PraxityBlock } from "../src/types";

function Wrapper({ children }: { children: ReactNode }) {
	return <MantineProvider>{children}</MantineProvider>;
}

function adaptOne(data: Record<string, unknown>): PraxityBlock {
	return adaptGrammarPreviewBlocks([
		{
			id: "blk1",
			type: "assessment",
			data: { stem: [{ id: "prompt", type: "text", data: { content: "<p>Q</p>" } }], ...data },
		},
	])[0];
}
const responses = [
	[
		"single",
		{
			type: "choice",
			selectionMode: "single",
			options: [{ id: "option", label: "A", isCorrect: true }],
		},
	],
	[
		"multi",
		{
			type: "choice",
			selectionMode: "multiple",
			options: [{ id: "option", label: "A", isCorrect: true }],
		},
	],
	[
		"matching",
		{ type: "matching", pairs: [{ id: "pair", matchId: "match", prompt: "L", correctMatch: "R" }] },
	],
	["sequence", { type: "sequence", items: [{ id: "step", text: "One" }] }],
	["freeText", { type: "textResponse" }],
	[
		"fillBlank",
		{ type: "fillBlank", template: "A {word} here.", blanks: [{ id: "blank", answer: "word" }] },
	],
	[
		"categorize",
		{
			type: "categorize",
			categories: [{ id: "category", name: "C", items: ["i"], itemIds: ["item"] }],
		},
	],
	[
		"hotspot",
		{
			type: "hotspot",
			image: "/i.png",
			hotspots: [{ id: "spot", shape: "ellipse", coords: [1, 2, 3] }],
		},
	],
] as const;
describe("grammar adapter — canonical assessment description", () => {
	it.each(responses)("preserves rich description on %s", (_label, response) => {
		const block = adaptOne({
			response,
			description: [
				{
					id: "description",
					type: "text",
					data: { content: "<p>Read the <strong>policy</strong> first.</p>" },
				},
			],
		});
		const description = (block.data as unknown as AssessmentBlockData).description;
		expect(description).toBeDefined();
		expect(description?.[0]?.data.content).toBe("<p>Read the <strong>policy</strong> first.</p>");
	});
	it("omits description when the param is absent", () => {
		const block = adaptOne({ response: { type: "textResponse" } });
		expect((block.data as unknown as AssessmentBlockData).description).toBeUndefined();
	});
	it("preserves scenario display metadata", () => {
		const block = adaptOne({
			response: responses[0][1],
			display: "scenario",
			description: [
				{
					id: "description",
					type: "text",
					data: { content: "An observatory prioritizes instrument maintenance." },
				},
			],
		});
		expect((block.data as unknown as AssessmentBlockData).display).toBe("scenario");
	});
	it("keeps escaped HTML in a description", () => {
		const source = "::: free-response Q\n<img src=x onerror=alert(1)>\n:::\n";
		const [block] = adaptGrammarPreviewBlocks(readBlockFixture(source).blocks);
		const html = String(
			(block.data as unknown as AssessmentBlockData).description?.[0]?.data.content,
		);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});
	it.each([responses[4], responses[5], responses[2]])(
		"preserves placeholder on the %s response config",
		(_label, base) => {
			const block = adaptOne({ response: { ...base, placeholder: "Custom hint" } });
			const response = (block.data as unknown as AssessmentBlockData).response as {
				type: string;
				placeholder?: string;
			};
			expect(response.type).toBe(base.type);
			expect(response.placeholder).toBe("Custom hint");
		},
	);
});

describe("AssessmentBlock — description rendering", () => {
	function renderChoice(description?: PraxityBlock[], display?: "scenario") {
		const data = {
			assessmentType: "choice",
			stem: [{ id: "s1", type: "text", data: { content: "Which PPE is required?" } }],
			...(description ? { description } : {}),
			...(display ? { display } : {}),
			response: {
				type: "choice",
				selectionMode: "single",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [
					{ id: "a", label: "Hard hat", isCorrect: true },
					{ id: "b", label: "Nothing", isCorrect: false },
				],
			},
			feedback: {},
			gradingMode: "none",
		} as unknown as AssessmentBlockData;
		return render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="blk1" />
			</Wrapper>,
		);
	}

	it("renders the description and associates it with the response group", () => {
		const { container } = renderChoice([
			{
				id: "d1",
				type: "text",
				data: { content: "<p>You arrive at a <strong>live</strong> site.</p>" },
			},
		]);

		const description = container.querySelector("#assessment-description-blk1");
		expect(description).not.toBeNull();
		expect(description?.textContent).toContain("You arrive at a live site.");
		expect(description?.querySelector("strong")).not.toBeNull();

		// Adjacency is not association — the fieldset must point at it.
		const fieldset = container.querySelector("fieldset");
		expect(fieldset?.getAttribute("aria-describedby")).toBe("assessment-description-blk1");
	});

	it("emits no description node and no aria-describedby when unset", () => {
		const { container } = renderChoice();
		expect(container.querySelector("#assessment-description-blk1")).toBeNull();
		expect(container.querySelector("fieldset")?.getAttribute("aria-describedby")).toBeNull();
	});

	it("keeps scenario context and its question in one card, in reading order", () => {
		const { container } = renderChoice(
			[{ id: "d1", type: "text", data: { content: "<p>A telescope needs support.</p>" } }],
			"scenario",
		);
		const card = container.querySelector("[data-block-id='blk1']");
		const description = card?.querySelector(".praxity-assessment-description");
		const question = card?.querySelector(".praxity-assessment-question-header");

		expect(card?.getAttribute("data-assessment-display")).toBe("scenario");
		expect(description?.nextElementSibling).toBe(question);
	});
});

describe("AssessmentBlock — placeholder override", () => {
	function renderTextResponse(placeholder?: string) {
		const data = {
			assessmentType: "textResponse",
			stem: [{ id: "s1", type: "text", data: { content: "Describe three improvements." } }],
			description: [{ id: "d1", type: "text", data: { content: "<p>Be specific.</p>" } }],
			response: {
				// "short" rather than "long": Mantine's autosize Textarea needs layout
				// APIs jsdom does not provide. Both paths share the placeholder logic.
				type: "textResponse",
				inputType: "short",
				...(placeholder ? { placeholder } : {}),
			},
			feedback: {},
			gradingMode: "none",
		} as unknown as AssessmentBlockData;
		return render(
			<Wrapper>
				<PreviewAssessmentBlock data={data} blockId="blk2" />
			</Wrapper>,
		);
	}

	it("uses the author placeholder and wires the description to the input", () => {
		renderTextResponse("Type your three ideas here");
		const input = screen.getByRole("textbox");
		expect(input).toHaveAttribute("placeholder", "Type your three ideas here");
		expect(input).toHaveAttribute("aria-describedby", "assessment-description-blk2");
		// A placeholder is not a label: it must never become the accessible name.
		expect(input.getAttribute("aria-label")).not.toBe("Type your three ideas here");
		expect(input.getAttribute("aria-label")).toBeTruthy();
	});

	it("falls back to the localized default when unset", () => {
		renderTextResponse();
		expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Type your answer...");
	});
});

describe("AssessmentBlock — mapped controls", () => {
	const description = [{ id: "d1", type: "text", data: { content: "<p>Read carefully.</p>" } }];

	function renderBlock(data: Record<string, unknown>) {
		return render(
			<Wrapper>
				<PreviewAssessmentBlock data={data as unknown as AssessmentBlockData} blockId="blk3" />
			</Wrapper>,
		);
	}

	it("wires every fill-blank input to the description", () => {
		renderBlock({
			assessmentType: "fillBlank",
			stem: [{ id: "s1", type: "text", data: { content: "Complete the procedure." } }],
			description,
			response: {
				type: "fillBlank",
				placeholder: "One word",
				blanks: [
					{ id: "b1", answer: "permit" },
					{ id: "b2", answer: "oxygen" },
				],
			},
			feedback: {},
			gradingMode: "none",
		});

		const inputs = screen.getAllByRole("textbox");
		expect(inputs).toHaveLength(2);
		for (const input of inputs) {
			expect(input).toHaveAttribute("aria-describedby", "assessment-description-blk3");
			expect(input).toHaveAttribute("placeholder", "One word");
		}
	});

	it("wires every match dropdown to the description", () => {
		renderBlock({
			assessmentType: "matching",
			stem: [{ id: "s1", type: "text", data: { content: "Match each hazard." } }],
			description,
			response: {
				type: "matching",
				inputMethod: "dropdown",
				placeholder: "Pick a control",
				pairs: [
					{ id: "p1", prompt: "Chemical spill", correctMatch: "Containment kit" },
					{ id: "p2", prompt: "Fall risk", correctMatch: "Harness" },
				],
			},
			feedback: {},
			gradingMode: "none",
		});

		const selects = screen.getAllByRole("combobox");
		expect(selects).toHaveLength(2);
		for (const select of selects) {
			expect(select).toHaveAttribute("aria-describedby", "assessment-description-blk3");
			expect(select).toHaveValue("");
			expect(select).toHaveAttribute("placeholder", "Pick a control");
		}
	});
});
