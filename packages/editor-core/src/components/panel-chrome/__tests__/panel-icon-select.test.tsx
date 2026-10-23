import { MantineProvider } from "@mantine/core";
import { IconLayoutBottombar, IconLayoutSidebar } from "@tabler/icons-react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelIconSelect } from "../panel-icon-select";

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
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		writable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
});

describe("PanelIconSelect", () => {
	const options = [
		{
			value: "sidebar",
			label: "Sidebar",
			icon: <IconLayoutSidebar size={16} />,
		},
		{
			value: "bottom",
			label: "Bottom bar",
			icon: <IconLayoutBottombar size={16} />,
		},
	];

	it("renders with the selected value displayed", () => {
		renderWithMantine(<PanelIconSelect data={options} value="sidebar" onChange={() => {}} />);
		expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("Sidebar");
	});

	it("calls onChange when a new option is selected", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithMantine(<PanelIconSelect data={options} value="sidebar" onChange={onChange} />);
		await user.click(screen.getByRole("combobox"));
		await user.click(screen.getByText("Bottom bar"));
		expect(onChange).toHaveBeenCalledWith("bottom");
	});

	it("searches options and applies preview styling to font names", async () => {
		const user = userEvent.setup();
		const onDropdownOpen = vi.fn();
		renderWithMantine(
			<PanelIconSelect
				data={[
					{ value: "inter", label: "Inter", labelStyle: { fontFamily: "Inter, sans-serif" } },
					{
						value: "merriweather",
						label: "Merriweather",
						labelStyle: { fontFamily: "Merriweather, serif" },
					},
				]}
				value="inter"
				onChange={() => {}}
				searchable
				onDropdownOpen={onDropdownOpen}
			/>,
		);

		const input = screen.getByRole("combobox") as HTMLInputElement;
		expect(input.style.fontFamily).toContain("Inter");
		await user.click(input);
		expect(onDropdownOpen).toHaveBeenCalledOnce();
		await user.clear(input);
		await user.type(input, "Merri");

		const option = screen.getByText("Merriweather");
		expect(option.style.fontFamily).toContain("Merriweather");
		expect(screen.queryByText("Inter")).toBeNull();
	});
});
