import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { AuditSeverityFilter } from "../audit-severity-filter";
import type { DisplaySeverity } from "../types";

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

afterEach(cleanup);

it("moves focus across severity filters and announces the selected filter", () => {
	function Filter() {
		const [active, setActive] = useState<Set<DisplaySeverity>>(new Set(["critical"]));
		const [dismissed, setDismissed] = useState(false);
		return (
			<AuditSeverityFilter
				counts={{ critical: 1, recommended: 1, minor: 0, dismissed: 2, total: 4 }}
				filterMode={dismissed ? "dismissed" : "severity"}
				activeSeverities={active}
				onToggleSeverity={(severity) => {
					setDismissed(false);
					setActive((current) => {
						const next = new Set(current);
						if (next.has(severity)) next.delete(severity);
						else next.add(severity);
						return next;
					});
				}}
				onSetDismissedMode={() => setDismissed(true)}
			/>
		);
	}
	renderWithProviders(<Filter />);
	const critical = screen.getByRole("button", { name: "Critical 1" });
	const recommended = screen.getByRole("button", { name: "Recommended 1" });
	const dismissed = screen.getByRole("button", { name: "Dismissed 2" });
	critical.focus();
	expect(critical.getAttribute("aria-pressed")).toBe("true");
	fireEvent.keyDown(critical, { key: "ArrowRight" });
	expect(document.activeElement).toBe(recommended);
	fireEvent.click(recommended);
	expect(recommended.getAttribute("aria-pressed")).toBe("true");
	fireEvent.keyDown(recommended, { key: "End" });
	expect(document.activeElement).toBe(dismissed);
	fireEvent.click(dismissed);
	expect(dismissed.getAttribute("aria-pressed")).toBe("true");
	expect(recommended.getAttribute("aria-pressed")).toBe("false");
	fireEvent.keyDown(dismissed, { key: "Home" });
	expect(document.activeElement).toBe(critical);
	fireEvent.keyDown(critical, { key: "ArrowLeft" });
	expect(document.activeElement).toBe(dismissed);
});
