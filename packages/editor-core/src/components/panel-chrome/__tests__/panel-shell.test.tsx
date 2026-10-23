import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PanelShell } from "../panel-shell";
import styles from "../panel-shell.module.css";

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

describe("PanelShell", () => {
	it("renders children inside a scrollable container", () => {
		renderWithMantine(
			<PanelShell>
				<p>Test content</p>
			</PanelShell>,
		);
		expect(screen.getByText("Test content")).toBeTruthy();
	});

	it("applies panelChrome class for focus ring scoping", () => {
		const { container } = renderWithMantine(
			<PanelShell>
				<p>Content</p>
			</PanelShell>,
		);
		expect(container.querySelector(".panelChrome")).toBeTruthy();
	});

	it("renders optional header slot", () => {
		renderWithMantine(
			<PanelShell header={<div>Panel Header</div>}>
				<p>Content</p>
			</PanelShell>,
		);
		expect(screen.getByText("Panel Header")).toBeTruthy();
	});

	it("renders the optional title as an h2 in the header", () => {
		const { container } = renderWithMantine(
			<PanelShell title="Accessibility audit">
				<p>Title content</p>
			</PanelShell>,
		);
		const heading = container.querySelector("h2");
		// Sentence case, not uppercased in markup — CSS must not transform it either.
		expect(heading?.textContent).toBe("Accessibility audit");
		expect(container.querySelector(`.${styles.header}`)?.contains(heading)).toBe(true);
	});

	it("does not turn a titled panel into a nested region landmark", () => {
		const { container } = renderWithMantine(
			<PanelShell title="Audit region">
				<p>Region content</p>
			</PanelShell>,
		);
		expect(screen.getByRole("heading", { level: 2, name: "Audit region" })).toBeTruthy();
		expect(screen.queryByRole("region")).toBeNull();
		expect(container.querySelector("section")).toBeNull();
	});

	it("renders title and header slot together", () => {
		const { container } = renderWithMantine(
			<PanelShell title="Audit with filters" header={<div>Filters</div>}>
				<p>Filter content</p>
			</PanelShell>,
		);
		expect(container.querySelector("h2")?.textContent).toBe("Audit with filters");
		expect(screen.getByText("Filters")).toBeTruthy();
	});

	it("stays a plain div with no header when no title or header is given", () => {
		const { container } = renderWithMantine(
			<PanelShell>
				<p>Content</p>
			</PanelShell>,
		);
		expect(container.querySelector("section")).toBeNull();
		expect(container.querySelector(`.${styles.header}`)).toBeNull();
	});

	it("supports disabling content padding", () => {
		const { container } = renderWithMantine(
			<PanelShell noPadding>
				<p>Content</p>
			</PanelShell>,
		);
		const content = container.querySelector(`.${styles.content}`);
		expect(content).toBeTruthy();
		expect(content?.className).toContain(styles.contentNoPadding);
	});
});
