import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewAssessmentBlock } from "../src/blocks/AssessmentBlock";
import type { AssessmentBlockData } from "../src/types";

function renderResponse(response: AssessmentBlockData["response"]) {
	return render(
		<MantineProvider>
			<PreviewAssessmentBlock
				blockId="response"
				data={{
					assessmentType: "textResponse",
					stem: [{ id: "prompt", type: "text", data: { content: "Your answer" } }],
					response,
					feedback: {},
					gradingMode: "none",
				}}
			/>
		</MantineProvider>,
	);
}

describe("text response submission", () => {
	it("requires a nonblank answer before submitting a reflection", () => {
		const { container } = renderResponse({ type: "textResponse", inputType: "short" });
		const input = screen.getByRole("textbox", { name: "Your answer" });
		expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();

		fireEvent.change(input, { target: { value: "   " } });
		expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
		fireEvent.change(input, { target: { value: "My reflection" } });
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(container.querySelector("[data-block-id='response']")).toHaveAttribute(
			"data-completed",
			"true",
		);
	});

	it("rejects an out-of-range number and accepts one within the range", () => {
		const { container } = renderResponse({
			type: "textResponse",
			inputType: "numeric",
			numericRange: { min: 10, max: 100 },
		});
		const input = screen.getByRole("spinbutton", { name: "Your answer" });

		fireEvent.change(input, { target: { value: "5" } });
		expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
		fireEvent.change(input, { target: { value: "50" } });
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(container.querySelector("[data-block-id='response']")).toHaveAttribute(
			"data-completed",
			"true",
		);
	});
});
