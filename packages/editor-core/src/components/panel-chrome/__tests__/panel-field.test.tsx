import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { IntlProvider } from "use-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";
import { PanelField } from "../panel-field";
import styles from "../panel-field.module.css";
import { PanelFieldRow } from "../panel-field-row";

function renderWithMantine(ui: ReactElement) {
	return render(
		<IntlProvider locale="en" messages={messages}>
			<MantineProvider>{ui}</MantineProvider>
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

describe("PanelField", () => {
	it("renders label and child control", () => {
		renderWithMantine(
			<PanelField label="Heading font" htmlFor="font-select">
				<select id="font-select">
					<option>DM Sans</option>
				</select>
			</PanelField>,
		);
		expect(screen.getByText("Heading font")).toBeTruthy();
		expect(screen.getByRole("combobox")).toBeTruthy();
	});

	it("names help for its field and exposes the description before opening", () => {
		renderWithMantine(
			<PanelField label="Accent" tooltip="Primary interactive color">
				<input />
			</PanelField>,
		);
		const infoButton = screen.getByRole("button", {
			name: "Accent: More information",
			description: "Primary interactive color",
		});
		const helpId = infoButton.getAttribute("aria-describedby");
		expect(helpId).toBeTruthy();
		expect(document.getElementById(helpId ?? "")?.textContent).toBe("Primary interactive color");
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("opens help on keyboard focus and dismisses it with Escape without moving focus", async () => {
		const user = userEvent.setup();
		renderWithMantine(<PanelField label="Accent" tooltip="Primary interactive color" />);
		const infoButton = screen.getByRole("button", {
			name: "Accent: More information",
			description: "Primary interactive color",
		});
		const helpId = infoButton.getAttribute("aria-describedby");

		await user.tab();
		expect(document.activeElement).toBe(infoButton);
		expect((await screen.findByRole("tooltip")).textContent).toBe("Primary interactive color");
		expect(infoButton.getAttribute("aria-describedby")).toBe(helpId);

		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
		expect(document.activeElement).toBe(infoButton);
		expect(infoButton.getAttribute("aria-describedby")).toBe(helpId);
	});

	it("does not render tooltip button when no tooltip prop", () => {
		renderWithMantine(
			<PanelField label="Name">
				<input />
			</PanelField>,
		);
		expect(screen.queryByRole("button", { name: /more information/i })).toBeNull();
	});

	it("supports row direction layout", () => {
		const { container } = renderWithMantine(
			<PanelField label="Name" direction="row">
				<input />
			</PanelField>,
		);
		const fieldRoot = container.querySelector(`.${styles.root}`);
		expect(fieldRoot).toBeTruthy();
		expect(fieldRoot?.className).toContain(styles.rootRow);
	});

	it("renders a right-aligned tabular value on the label row", () => {
		renderWithMantine(
			<PanelField label="Content width" valueLabel="680px">
				<input />
			</PanelField>,
		);
		expect(screen.getByText("680px").className).toContain(styles.valueLabel);
	});
});

describe("PanelFieldRow", () => {
	it("renders children in a 2-column grid by default", () => {
		const { container } = renderWithMantine(
			<PanelFieldRow>
				<PanelField label="A">
					<input />
				</PanelField>
				<PanelField label="B">
					<input />
				</PanelField>
			</PanelFieldRow>,
		);
		const grid = container.querySelector("[style*='grid-template-columns']") as HTMLElement;
		expect(grid.style.gridTemplateColumns).toBe("repeat(2, 1fr)");
	});

	it("supports 3-column layout", () => {
		const { container } = renderWithMantine(
			<PanelFieldRow columns={3}>
				<PanelField label="A">
					<input />
				</PanelField>
				<PanelField label="B">
					<input />
				</PanelField>
				<PanelField label="C">
					<input />
				</PanelField>
			</PanelFieldRow>,
		);
		const grid = container.querySelector("[style*='grid-template-columns']") as HTMLElement;
		expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
	});
});
