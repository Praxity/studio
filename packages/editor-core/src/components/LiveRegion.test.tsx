import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { createTranslator } from "use-intl/core";
import { afterEach, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { type AnnouncementEffect, SessionLiveRegion } from "./LiveRegion";

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});
const effect: AnnouncementEffect = {
	type: "announce",
	message: {
		key: "session.announcements.deleted",
		params: { name: "Note: Votre journal", narration: "", undo: "Undo with Control Z." },
	},
	level: "polite",
	delayMs: 150,
	interfaceLanguage: "en",
	courseLanguage: "fr",
	courseParams: ["name"],
};
const translate = (key: string, params: Record<string, string | number>, language: "en" | "fr") =>
	createTranslator({ locale: language, messages: language === "en" ? en : fr })(key, params);
it("A1/A6/A8 speaks only the controller effect, after focus, with course language spans", () => {
	vi.useFakeTimers();
	const { container, rerender } = render(
		<SessionLiveRegion announcement={effect} translate={translate} />,
	);
	expect(container.querySelector("[aria-live]")?.textContent).toBe("");
	act(() => {
		vi.advanceTimersByTime(149);
	});
	expect(container.textContent).toBe("");
	act(() => {
		vi.advanceTimersByTime(1);
	});
	expect(container.querySelector("[aria-live]")?.getAttribute("lang")).toBe("en");
	expect(container.querySelector('span[lang="fr"]')?.textContent).toBe("Note: Votre journal");
	expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
	rerender(<SessionLiveRegion announcement={{ ...effect }} translate={translate} />);
	expect(container.textContent).toBe("");
	act(() => {
		vi.advanceTimersByTime(150);
	});
	expect(container.textContent).toContain("Votre journal");
	rerender(
		<SessionLiveRegion
			announcement={{ ...effect, interfaceLanguage: "fr", level: "assertive" }}
			translate={translate}
		/>,
	);
	act(() => {
		vi.advanceTimersByTime(150);
	});
	expect(container.querySelector("[aria-live]")?.getAttribute("aria-live")).toBe("assertive");
	expect(container.querySelector("[aria-live]")?.getAttribute("lang")).toBe("fr");
});

const base: AnnouncementEffect = {
	type: "announce",
	message: { key: "first", params: {} },
	level: "polite",
	delayMs: 150,
	interfaceLanguage: "en",
	courseLanguage: "en",
	courseParams: [],
};
const keyTranslator = (key: string) => key;

it("A1 F9 delayed speech uses current presentation authority at delivery", () => {
	vi.useFakeTimers();
	let active = true;
	const { container } = render(
		<SessionLiveRegion announcement={base} translate={keyTranslator} isActive={() => active} />,
	);
	active = false;
	act(() => vi.advanceTimersByTime(150));
	expect(container.textContent).toBe("");
});

it("retains both operations arriving within 150ms", () => {
	vi.useFakeTimers();
	const { container, rerender } = render(
		<SessionLiveRegion announcement={base} translate={keyTranslator} />,
	);
	act(() => vi.advanceTimersByTime(100));
	rerender(
		<SessionLiveRegion
			announcement={{ ...base, message: { key: "second", params: {} } }}
			translate={keyTranslator}
		/>,
	);
	const timeline: string[] = [];
	for (let t = 150; t <= 1000; t += 50) {
		act(() => vi.advanceTimersByTime(50));
		timeline.push(container.textContent ?? "");
	}
	expect(timeline).toContain("first");
	expect(timeline.filter((text, index) => text && text !== timeline[index - 1])).toEqual([
		"first",
		"second",
	]);
});
it("does not repeat the same effect when its translator gets a fresh reference", () => {
	vi.useFakeTimers();
	const { container, rerender } = render(
		<SessionLiveRegion announcement={base} translate={keyTranslator} />,
	);
	act(() => vi.advanceTimersByTime(150));
	expect(container.textContent).toBe("first");
	rerender(<SessionLiveRegion announcement={base} translate={(key) => key} />);
	expect(container.textContent).toBe("first");
	act(() => vi.advanceTimersByTime(1000));
	expect(container.textContent).toBe("first");
});

it("queues urgency and language with each operation, including repeated wording", () => {
	vi.useFakeTimers();
	const { container, rerender } = render(
		<SessionLiveRegion announcement={base} translate={keyTranslator} />,
	);
	act(() => vi.advanceTimersByTime(50));
	rerender(
		<SessionLiveRegion
			announcement={{
				...base,
				message: { key: "second", params: {} },
				interfaceLanguage: "fr",
				level: "assertive",
			}}
			translate={keyTranslator}
		/>,
	);
	act(() => vi.advanceTimersByTime(50));
	rerender(<SessionLiveRegion announcement={{ ...base }} translate={keyTranslator} />);
	const delivered: string[] = [];
	let previous = "";
	for (let elapsed = 100; elapsed < 1000; elapsed += 50) {
		act(() => vi.advanceTimersByTime(50));
		const text = container.textContent ?? "";
		if (text && text !== previous) {
			const live = container.querySelector("[aria-live]");
			delivered.push(`${text}/${live?.getAttribute("lang")}/${live?.getAttribute("aria-live")}`);
		}
		previous = text;
	}
	expect(delivered).toEqual(["first/en/polite", "second/fr/assertive", "first/en/polite"]);
});

it("delivers once under StrictMode and cancels pending work on unmount", () => {
	vi.useFakeTimers();
	const { container, unmount } = render(
		<StrictMode>
			<SessionLiveRegion announcement={base} translate={keyTranslator} />
		</StrictMode>,
	);
	act(() => vi.advanceTimersByTime(150));
	expect(container.textContent).toBe("first");
	unmount();
	expect(vi.getTimerCount()).toBe(0);
});

it("A1 delivery callback observes committed text and does not repeat on an active predicate rebind", () => {
	vi.useFakeTimers();
	const observations: string[] = [];
	const delivered = () =>
		observations.push(container.querySelector("[aria-live]")?.textContent ?? "");
	const { container, rerender } = render(
		<SessionLiveRegion
			announcement={base}
			translate={keyTranslator}
			isActive={() => true}
			onDelivered={delivered}
		/>,
	);
	expect(observations).toEqual([]);
	act(() => vi.advanceTimersByTime(149));
	expect(observations).toEqual([]);
	act(() => vi.advanceTimersByTime(1));
	expect(observations).toEqual(["first"]);
	rerender(
		<SessionLiveRegion
			announcement={base}
			translate={keyTranslator}
			isActive={() => true}
			onDelivered={delivered}
		/>,
	);
	expect(observations).toEqual(["first"]);
	act(() => vi.advanceTimersByTime(150));
	expect(observations).toEqual(["first"]);
});

it("A1 hide before speech DOM commit sends no delivery callback", () => {
	vi.useFakeTimers();
	let active = true;
	const delivered = vi.fn();
	const { container } = render(
		<SessionLiveRegion
			announcement={base}
			translate={keyTranslator}
			isActive={() => active}
			onDelivered={delivered}
		/>,
	);
	active = false;
	act(() => vi.advanceTimersByTime(150));
	expect(container.textContent).toBe("");
	expect(delivered).not.toHaveBeenCalled();
});
