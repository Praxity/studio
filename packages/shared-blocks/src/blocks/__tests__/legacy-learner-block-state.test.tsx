/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerStateValue } from "../../learner-state";

import type { AssessmentBlockData, PraxityBlock } from "../../types";
import { PreviewAssessmentBlock } from "../AssessmentBlock";

const state = new Map<string, LearnerStateValue>();
const writeState = vi.fn((blockId: string, value: LearnerStateValue) => state.set(blockId, value));

function renderBlock(block: React.ReactNode) {
	return render(<MantineProvider>{block}</MantineProvider>);
}

function text(id: string, content: string): PraxityBlock {
	return { id, type: "text", data: { content } };
}

beforeEach(() => {
	state.clear();
	writeState.mockClear();
	HTMLElement.prototype.scrollIntoView = vi.fn();
	window.__praxityBlockState = {
		get: (blockId) => state.get(blockId),
		set: writeState,
	};
});

afterEach(() => {
	cleanup();
	delete window.__praxityBlockState;
});

describe("legacy learner block-state rehydration", () => {
	it("keeps categorize answers attached to their item when authored items move", () => {
		state.set("categorize", {
			version: 1,
			kind: "assessment",
			assessmentType: "categorize",
			attemptCount: 1,
			checked: true,
			correct: true,
			completed: true,
			interacted: true,
			answer: {
				[JSON.stringify(["Hard hat", 0])]: "head",
				[JSON.stringify(["Safety goggles", 0])]: "eyes",
			},
		});
		const data: AssessmentBlockData = {
			assessmentType: "categorize",
			stem: [text("stem", "Sort the equipment")],
			response: {
				type: "categorize",
				categories: [
					{ id: "eyes", name: "Eyes", items: ["Safety goggles"] },
					{ id: "head", name: "Head", items: ["Hard hat"] },
				],
			},
			feedback: { correct: [], incorrect: [] },
			feedbackEnabled: true,
			gradingMode: "none",
		};

		const { container } = renderBlock(<PreviewAssessmentBlock blockId="categorize" data={data} />);

		expect(screen.getByRole("radio", { name: "Hard hat: Head" })).toBeChecked();
		expect(screen.getByRole("radio", { name: "Safety goggles: Eyes" })).toBeChecked();
		expect(container.querySelector('[data-completed="true"]')).not.toBeNull();
		expect(writeState).not.toHaveBeenCalled();
	});
});
