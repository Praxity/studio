import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PanelAccordion } from "../panel-accordion";

describe("PanelAccordion", () => {
	afterEach(() => {
		cleanup();
	});

	it("opens only the first section by default", () => {
		render(
			<PanelAccordion
				sections={[
					{ id: "basic", label: "Basic", content: <p>Basic content</p> },
					{
						id: "advanced",
						label: "Advanced",
						content: <p>Advanced content</p>,
					},
				]}
			/>,
		);
		expect(screen.getByText("Basic content")).toBeTruthy();
		const advancedButton = screen.getByRole("button", { name: "Advanced" });
		expect(advancedButton.getAttribute("aria-expanded")).toBe("false");
		const advancedPanel = document.getElementById(
			advancedButton.getAttribute("aria-controls") ?? "",
		);
		expect(advancedPanel?.parentElement?.hasAttribute("hidden")).toBe(true);
		expect(screen.queryByRole("region")).toBeNull();
	});

	it("opens one section at a time", async () => {
		const user = userEvent.setup();
		render(
			<PanelAccordion
				sections={[
					{ id: "basic", label: "Basic", content: <p>Basic content</p> },
					{ id: "advanced", label: "Advanced", content: <p>Advanced content</p> },
				]}
			/>,
		);
		const basicButton = screen.getByRole("button", { name: "Basic" });
		const advancedButton = screen.getByRole("button", { name: "Advanced" });
		expect(basicButton.getAttribute("aria-expanded")).toBe("true");
		expect(advancedButton.getAttribute("aria-expanded")).toBe("false");

		await user.click(advancedButton);
		expect(advancedButton.getAttribute("aria-expanded")).toBe("true");
		expect(basicButton.getAttribute("aria-expanded")).toBe("false");
		const advancedPanel = document.getElementById(
			advancedButton.getAttribute("aria-controls") ?? "",
		);
		const basicPanel = document.getElementById(basicButton.getAttribute("aria-controls") ?? "");
		expect(advancedPanel?.parentElement?.hasAttribute("hidden")).toBe(false);
		expect(basicPanel?.parentElement?.hasAttribute("hidden")).toBe(true);
		expect(screen.queryByRole("region")).toBeNull();
	});

	it("uses aria-controls to link the header to its content", () => {
		render(
			<PanelAccordion sections={[{ id: "basic", label: "Basic", content: <p>Content</p> }]} />,
		);
		const button = screen.getByRole("button", { name: "Basic" });
		const panelId = button.getAttribute("aria-controls");
		expect(panelId).toBeTruthy();
		expect(document.getElementById(panelId ?? "")).toBeTruthy();
	});

	it("keeps accordion content generic", () => {
		render(
			<PanelAccordion sections={[{ id: "basic", label: "Basic", content: <p>Content</p> }]} />,
		);
		expect(screen.queryByRole("region")).toBeNull();
	});
});
