import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, useState } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { PanelColorField } from "../panel-color-field";

function renderWithMantine(ui: ReactElement) {
	return render(
		<IntlProvider locale="en" messages={messages}>
			<MantineProvider env="test">{ui}</MantineProvider>
		</IntlProvider>,
	);
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

describe("PanelColorField", () => {
	it.each(["#fff", "fff", " #FFF "])("expands %s before committing it", (value) => {
		const onChange = vi.fn();
		renderWithMantine(<PanelColorField value="#ff0000" onChange={onChange} />);
		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value } });
		fireEvent.blur(input);
		expect(onChange).toHaveBeenCalledWith("#ffffff");
	});
	it.each(["en", "fr"] as const)("refuses alpha with a localized explanation in %s", (locale) => {
		const onChange = vi.fn();
		renderWithMantine(
			<IntlProvider locale={locale} messages={locale === "en" ? messages : fr}>
				<PanelColorField value="#ff0000" onChange={onChange} />
			</IntlProvider>,
		);
		const input = screen.getByRole("textbox");
		for (const value of ["#ffffff80", "#fff8"]) {
			fireEvent.change(input, { target: { value } });
			fireEvent.blur(input);
			expect(onChange).not.toHaveBeenCalled();
			expect((input as HTMLInputElement).value).toBe(value);
			expect(input.getAttribute("aria-invalid")).toBe("true");
			expect(
				document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent,
			).toBe(
				locale === "en"
					? "Transparency isn't supported here. Use a 6-digit colour like #1a2b3c."
					: "La transparence n'est pas prise en charge ici. Utilisez une couleur à 6 chiffres comme #1a2b3c.",
			);
		}
	});
	it("renders color swatch and hex input", () => {
		renderWithMantine(<PanelColorField value="#ff0000" onChange={() => {}} />);
		const input = screen.getByDisplayValue("#ff0000");
		expect(input).toBeTruthy();
	});

	it("calls onChange when hex input is changed and blurred", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		renderWithMantine(<PanelColorField value="#ff0000" onChange={onChange} />);
		const input = screen.getByDisplayValue("#ff0000");
		await user.clear(input);
		await user.type(input, "#00ff00");
		await user.tab();
		expect(onChange).toHaveBeenCalledWith("#00ff00");
	});

	it("opens color picker popover when swatch is clicked", async () => {
		const user = userEvent.setup();
		renderWithMantine(<PanelColorField value="#ff0000" onChange={() => {}} />);
		const swatch = screen.getByRole("button", { name: /pick color/i });
		await user.click(swatch);
		expect(swatch.getAttribute("aria-expanded")).toBe("true");
	});

	it("dismisses on an outside press without stealing focus from the pressed field", async () => {
		const user = userEvent.setup();
		renderWithMantine(
			<>
				<PanelColorField value="#ff0000" onChange={() => {}} />
				<input aria-label="Another field" />
			</>,
		);
		const swatch = screen.getByRole("button", { name: /pick color/i });
		await user.click(swatch);
		const outside = screen.getByRole("textbox", { name: "Another field" });
		await user.click(outside);
		expect(swatch.getAttribute("aria-expanded")).toBe("false");
		await waitFor(() =>
			expect(screen.queryByRole("dialog", { name: "Color picker", exact: true })).toBeNull(),
		);
		expect(document.activeElement).toBe(outside);
	});

	it("dismisses on outside touch and still toggles closed from the swatch", async () => {
		const user = userEvent.setup();
		renderWithMantine(<PanelColorField value="#ff0000" onChange={() => {}} />);
		const swatch = screen.getByRole("button", { name: /pick color/i });
		await user.click(swatch);
		fireEvent.touchStart(document.body);
		expect(swatch.getAttribute("aria-expanded")).toBe("false");
		await user.click(swatch);
		expect(swatch.getAttribute("aria-expanded")).toBe("true");
		await user.click(swatch);
		expect(swatch.getAttribute("aria-expanded")).toBe("false");
	});

	it("keeps inside interactions open and returns focus on Escape without losing the color", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		function ControlledField() {
			const [value, setValue] = useState("#ff0000");
			return (
				<PanelColorField
					value={value}
					onChange={(color) => {
						onChange(color);
						setValue(color);
					}}
				/>
			);
		}
		renderWithMantine(<ControlledField />);
		const swatch = screen.getByRole("button", { name: /pick color/i });
		await user.click(swatch);
		await user.click(screen.getByRole("dialog", { name: "Color picker", exact: true }));
		expect(swatch.getAttribute("aria-expanded")).toBe("true");
		const slider = screen.getAllByRole("slider")[0];
		slider.focus();
		await user.keyboard("{ArrowLeft}");
		expect(onChange).toHaveBeenCalled();
		const selectedColor = onChange.mock.lastCall?.[0];
		expect(selectedColor).not.toBe("#ff0000");
		expect(swatch.getAttribute("aria-expanded")).toBe("true");
		await user.keyboard("{Escape}");
		expect(swatch.getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(swatch);
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(selectedColor);
		await user.click(swatch);
		expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(selectedColor);
	});

	it("uses the field label to distinguish its controls without duplicating label text", () => {
		renderWithMantine(
			<PanelColorField value="#ff0000" label="Warning · Light" onChange={() => {}} />,
		);
		expect(screen.getByRole("button", { name: "Pick color for Warning · Light" })).toBeTruthy();
		expect(screen.getByRole("textbox", { name: "Warning · Light hex color value" })).toBeTruthy();
		expect(screen.queryByText("Warning · Light")).toBeNull();
	});
});
