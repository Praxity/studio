import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelSwitch } from "../panel-switch";

function renderWithMantine(ui: ReactElement) {
	return render(<MantineProvider>{ui}</MantineProvider>);
}

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
});

afterEach(() => {
	cleanup();
});

describe("PanelSwitch", () => {
	it("exposes the switch role and checked state", () => {
		renderWithMantine(<PanelSwitch checked onChange={() => {}} aria-label="Praxity badge" />);
		expect(screen.getByRole("switch", { name: "Praxity badge" }).getAttribute("checked")).not.toBe(
			"false",
		);
		expect((screen.getByRole("switch") as HTMLInputElement).checked).toBe(true);
	});

	it("uses Mantine's plain dot thumb", () => {
		const { container } = renderWithMantine(
			<PanelSwitch checked onChange={() => {}} aria-label="On" />,
		);
		const thumb = container.querySelector(".mantine-Switch-thumb");
		expect(thumb).toBeTruthy();
		expect(thumb?.querySelector("svg")).toBeNull();
	});

	// 46x24 at "md" clears the 24x24 CSS-pixel floor of WCAG 2.5.8 without
	// leaning on the spacing exception; Mantine's app-wide default is "xs".
	it("defaults to the md size", () => {
		const { container } = renderWithMantine(
			<PanelSwitch checked={false} onChange={() => {}} aria-label="Off" />,
		);
		const root = container.querySelector<HTMLElement>(".mantine-Switch-root");
		expect(root?.style.getPropertyValue("--switch-height")).toBe("var(--switch-height-md)");
	});

	it("toggles on click", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithMantine(<PanelSwitch checked={false} onChange={onChange} aria-label="Toggle" />);
		await user.click(screen.getByRole("switch", { name: "Toggle" }));
		expect(onChange).toHaveBeenCalled();
	});

	it("associates its left label and preserves keyboard toggling", async () => {
		const user = userEvent.setup();
		renderWithMantine(<PanelSwitch label="Stop after this slide" defaultChecked={false} />);
		const control = screen.getByRole("switch", { name: "Stop after this slide" });
		expect(control.closest(".mantine-Switch-root")?.getAttribute("data-label-position")).toBe(
			"left",
		);
		await user.click(screen.getByText("Stop after this slide"));
		expect((control as HTMLInputElement).checked).toBe(true);
		control.focus();
		await user.keyboard(" ");
		expect((control as HTMLInputElement).checked).toBe(false);
	});

	it("keeps an externally labeled switch independently named", async () => {
		const user = userEvent.setup();
		renderWithMantine(
			<>
				<label htmlFor="outline-switch">Course outline</label>
				<PanelSwitch id="outline-switch" defaultChecked={false} />
			</>,
		);
		const control = screen.getByRole("switch", { name: "Course outline" });
		await user.click(screen.getByText("Course outline"));
		expect((control as HTMLInputElement).checked).toBe(true);
	});
});
