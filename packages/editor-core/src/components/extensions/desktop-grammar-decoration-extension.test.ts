import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import {
	createDesktopGrammarDecorationExtension,
	setDesktopNarrationControlsVisible,
	setDesktopNarrationMarkers,
} from "./desktop-grammar-decoration-extension";

describe("narration gutter marker", () => {
	it("renders the supplied state label and opens its source line", () => {
		const element = document.createElement("div");
		document.body.append(element);
		const onMarker = vi.fn();
		window.addEventListener("praxity:narration-marker", onMarker);
		const editor = new Editor({
			element,
			extensions: [
				StarterKit,
				createDesktopGrammarDecorationExtension({
					showNarrationControls: true,
					narrationMarkers: {
						0: { state: "stale", label: "Narration for Heading: Audio out of date" },
					},
				}),
			],
			content: "<p>## Heading</p>",
		});

		const marker = element.querySelector<HTMLButtonElement>(".praxity-narration-disclosure");
		if (!marker) throw new Error("Expected narration gutter marker");
		expect(marker?.dataset.state).toBe("stale");
		expect(marker?.getAttribute("aria-label")).toBe("Narration for Heading: Audio out of date");
		expect(marker?.getAttribute("contenteditable")).toBe("false");
		expect(marker?.tabIndex).toBe(0);
		expect(marker?.style.getPropertyValue("--praxity-narration-icon")).not.toBe("");
		expect(marker?.style.getPropertyValue("--praxity-narration-badge-icon")).toBe("");
		marker.click();
		expect(onMarker).toHaveBeenCalledOnce();
		const event = onMarker.mock.calls[0]?.[0];
		if (!(event instanceof CustomEvent)) throw new Error("Expected narration marker event");
		expect(event.detail).toEqual({ lineNumber: 0 });

		marker.focus();
		setDesktopNarrationMarkers(editor.view, {
			0: { state: "ready", label: "Narration for Heading: Audio current" },
		});
		const updatedMarker = element.querySelector<HTMLButtonElement>(".praxity-narration-disclosure");
		expect(updatedMarker).not.toBe(marker);
		expect(document.activeElement).toBe(updatedMarker);
		expect(updatedMarker?.dataset.state).toBe("ready");
		expect(updatedMarker?.getAttribute("aria-label")).toBe("Narration for Heading: Audio current");
		setDesktopNarrationMarkers(editor.view, {
			0: { state: "stale", label: "Narration for Heading: Audio out of date" },
		});
		const staleMarker = element.querySelector<HTMLButtonElement>(".praxity-narration-disclosure");
		expect(document.activeElement).toBe(staleMarker);
		expect(staleMarker?.dataset.state).toBe("stale");

		editor.destroy();
		window.removeEventListener("praxity:narration-marker", onMarker);
		element.remove();
	});

	it("keeps one marker tabbable and moves between markers with arrow keys", () => {
		const element = document.createElement("div");
		document.body.append(element);
		const editor = new Editor({
			element,
			extensions: [
				StarterKit,
				createDesktopGrammarDecorationExtension({
					showNarrationControls: true,
					narrationMarkers: {
						0: { state: "missing", label: "Narration for First: Not generated" },
						2: { state: "ready", label: "Narration for Third: Audio current" },
					},
				}),
			],
			content: "<p>First</p><p>Second</p><p>Third</p>",
		});
		const markers = element.querySelectorAll<HTMLButtonElement>(".praxity-narration-disclosure");
		const first = markers[0];
		const third = markers[1];
		if (!first || !third) throw new Error("Expected two narration markers");
		expect(first.tabIndex).toBe(0);
		expect(third.tabIndex).toBe(-1);

		first.focus();
		const down = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			cancelable: true,
		});
		first.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		expect(first.tabIndex).toBe(-1);
		expect(third.tabIndex).toBe(0);
		expect(document.activeElement).toBe(third);

		third.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
		expect(document.activeElement).toBe(first);
		editor.destroy();
		element.remove();
	});

	it("marks the selected marker independently of roving tabindex", () => {
		const element = document.createElement("div");
		document.body.append(element);
		const editor = new Editor({
			element,
			extensions: [
				StarterKit,
				createDesktopGrammarDecorationExtension({
					showNarrationControls: true,
					narrationMarkers: {
						0: { state: "missing", label: "Narration for First: Not generated" },
						2: {
							state: "ready",
							label: "Narration for Third: Audio current",
							selected: true,
						},
					},
				}),
			],
			content: "<p>First</p><p>Second</p><p>Third</p>",
		});
		const markers = element.querySelectorAll<HTMLButtonElement>(".praxity-narration-disclosure");
		const first = markers[0];
		const third = markers[1];
		if (!first || !third) throw new Error("Expected two narration markers");

		expect(first.tabIndex).toBe(0);
		expect(first.hasAttribute("aria-current")).toBe(false);
		expect(third.tabIndex).toBe(-1);
		expect(third.getAttribute("aria-current")).toBe("true");
		expect(third.style.getPropertyValue("--praxity-narration-icon")).toContain("icon-tabler-check");

		setDesktopNarrationMarkers(editor.view, {
			0: { state: "missing", label: "Narration for First: Not generated", selected: true },
			2: { state: "ready", label: "Narration for Third: Audio current" },
		});
		const updatedMarkers = element.querySelectorAll<HTMLButtonElement>(
			".praxity-narration-disclosure",
		);
		expect(updatedMarkers[0]?.tabIndex).toBe(0);
		expect(updatedMarkers[0]?.getAttribute("aria-current")).toBe("true");
		expect(updatedMarkers[1]?.tabIndex).toBe(-1);
		expect(updatedMarkers[1]?.hasAttribute("aria-current")).toBe(false);
		expect(updatedMarkers[0]?.style.getPropertyValue("--praxity-narration-icon")).toContain(
			"icon-tabler-wave-sine",
		);
		expect(updatedMarkers[1]?.style.getPropertyValue("--praxity-narration-icon")).toContain(
			"icon-tabler-check",
		);
		setDesktopNarrationControlsVisible(editor.view, false);
		expect(element.querySelectorAll(".praxity-narration-disclosure")).toHaveLength(0);

		editor.destroy();
		element.remove();
	});
});
