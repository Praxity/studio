import { MantineProvider } from "@mantine/core";
import { IconAlignCenter, IconAlignLeft, IconAlignRight } from "@tabler/icons-react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelIconToggle } from "../panel-icon-toggle";

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
	class ResizeObserverMock {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	Object.defineProperty(window, "ResizeObserver", {
		writable: true,
		value: ResizeObserverMock,
	});
});

afterEach(() => {
	cleanup();
});

describe("PanelIconToggle", () => {
	const options = [
		{ value: "left", icon: <IconAlignLeft size={16} />, label: "Align left" },
		{
			value: "center",
			icon: <IconAlignCenter size={16} />,
			label: "Align center",
		},
		{
			value: "right",
			icon: <IconAlignRight size={16} />,
			label: "Align right",
		},
	];

	it("renders a radiogroup with correct role", () => {
		renderWithMantine(<PanelIconToggle value="left" onChange={() => {}} options={options} />);
		expect(screen.getByRole("radiogroup")).toBeTruthy();
	});

	it("marks the selected option with aria-checked", () => {
		renderWithMantine(<PanelIconToggle value="center" onChange={() => {}} options={options} />);
		const selected = screen.getByRole("radio", { name: "Align center" });
		expect(selected.getAttribute("aria-checked")).toBe("true");
	});

	it("calls onChange when a different option is clicked", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithMantine(<PanelIconToggle value="left" onChange={onChange} options={options} />);
		await user.click(screen.getByRole("radio", { name: "Align right" }));
		expect(onChange).toHaveBeenCalledWith("right");
	});

	it("supports arrow key navigation", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithMantine(<PanelIconToggle value="left" onChange={onChange} options={options} />);
		const selected = screen.getByRole("radio", { name: "Align left" });
		selected.focus();
		await user.keyboard("{ArrowRight}");
		expect(onChange).toHaveBeenCalledWith("center");
	});
});
