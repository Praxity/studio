import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelSection } from "../panel-section";

describe("PanelSection", () => {
	it("renders title as an h3 heading", () => {
		render(
			<PanelSection title="Colors">
				<p>Fields here</p>
			</PanelSection>,
		);
		const heading = screen.getByRole("heading", { level: 3 });
		expect(heading.textContent).toBe("Colors");
	});

	it("renders children", () => {
		render(
			<PanelSection title="Theme">
				<p>Theme content</p>
			</PanelSection>,
		);
		expect(screen.getByText("Theme content")).toBeTruthy();
	});

	it("renders optional description", () => {
		render(
			<PanelSection title="Brand" description="Upload your logo">
				<p>Content</p>
			</PanelSection>,
		);
		expect(screen.getByText("Upload your logo")).toBeTruthy();
	});

	it("shows divider by default", () => {
		const { container } = render(
			<PanelSection title="Typography">
				<p>Content</p>
			</PanelSection>,
		);
		expect(container.querySelector("[class*='divider']")).toBeTruthy();
	});

	it("hides divider when first prop is true", () => {
		const { container } = render(
			<PanelSection title="Theme" first>
				<p>Content</p>
			</PanelSection>,
		);
		expect(container.querySelector("[class*='divider']")).toBeNull();
	});
});
