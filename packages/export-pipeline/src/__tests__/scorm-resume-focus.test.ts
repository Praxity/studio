// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	focusScormResumePage,
	presentScormResumeCue,
	removeScormResumeCue,
	resumeFocusTarget,
} from "../../template/src/components/scorm-resume-focus";

const pageCue = {
	pageTitle: "Build from a composition",
	positionPrefix: "Resumed at page 4 of 6: ",
	summary: "Resumed at page 4 of 6: Build from a composition",
};

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("SCORM resume cue", () => {
	it("removes the Pages cue on departure before a browser history return", () => {
		document.body.innerHTML = "<main><h1>Build from a composition</h1></main>";
		focusScormResumePage(document, pageCue);
		window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
		expect(document.querySelector(".praxity-resume-prefix,.praxity-resume-summary")).toBeNull();
		expect(document.querySelector("h1")?.textContent).toBe("Build from a composition");
	});
	it.each([
		pageCue,
		{
			pageTitle: "Créer à partir d’une composition",
			positionPrefix: "Reprise à la page 4 sur 6 : ",
			summary: "Reprise à la page 4 sur 6 : Créer à partir d’une composition",
		},
		{
			pageTitle: "Build from a composition",
			positionPrefix: "Resumed at slide 4 of 6: ",
			summary: "Resumed at slide 4 of 6: Build from a composition",
		},
		{
			pageTitle: "Créer à partir d’une composition",
			positionPrefix: "Reprise à la diapositive 4 sur 6 : ",
			summary: "Reprise à la diapositive 4 sur 6 : Créer à partir d’une composition",
		},
	])("focuses the complete visible cue: $summary", (cue) => {
		document.body.innerHTML = `<main><h1>${cue.pageTitle}</h1></main>`;
		focusScormResumePage(document, cue);
		const heading = document.querySelector("h1");
		expect(document.activeElement).toBe(heading);
		expect(heading?.textContent).toBe(cue.summary);
		expect(heading?.firstElementChild?.textContent).toBe(cue.positionPrefix);
		expect(heading?.firstElementChild?.hasAttribute("hidden")).toBe(false);
		expect(heading?.firstElementChild?.hasAttribute("aria-hidden")).toBe(false);
		expect(heading?.getAttribute("tabindex")).toBe("-1");
	});

	it("preserves authored title nodes, heading level, IDs and descriptions", () => {
		document.body.innerHTML =
			'<main><h2 id="author-title" aria-describedby="description">Build from a <em id="term">composition</em></h2><p id="description">Authored description</p></main>';
		const main = document.querySelector("main") as HTMLElement;
		const heading = document.querySelector("h2") as HTMLElement;
		const authoredNodes = [...heading.childNodes];
		const focus = vi.spyOn(heading, "focus");
		expect(presentScormResumeCue(main, pageCue)).toBe(heading);
		expect(focus).not.toHaveBeenCalled();
		expect(heading.hasAttribute("tabindex")).toBe(false);
		expect([...heading.childNodes].slice(1)).toEqual(authoredNodes);
		expect(heading.id).toBe("author-title");
		expect(heading.getAttribute("aria-describedby")).toBe("description");
		expect(heading.querySelector("em")).toBe(authoredNodes[1]);
	});

	it.each([
		'<h1 aria-label="Author name">Build from a composition</h1>',
		'<h1 aria-labelledby="author-name">Build from a composition</h1><span id="author-name">Author name</span>',
		"<h1>Transcript</h1>",
		"<p>Content without a heading</p>",
	])("uses a sole visible summary fallback and preserves author content: %s", (content) => {
		document.body.innerHTML = `<main>${content}</main>`;
		const main = document.querySelector("main") as HTMLElement;
		const authoredNodes = [...main.childNodes];
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		focusScormResumePage(document, pageCue);
		const summary = main.firstElementChild as HTMLElement;
		expect(summary.tagName).toBe("P");
		expect(summary.textContent).toBe("Resumed at page 4 of 6: Build from a composition");
		expect(summary.firstChild?.textContent).toBe("Resumed at page 4 of 6");
		expect(summary.querySelector(".praxity-a11y-sr-only")?.textContent).toBe(
			": Build from a composition",
		);
		expect(summary.getAttribute("tabindex")).toBe("-1");
		expect(summary.hasAttribute("role")).toBe(false);
		expect(document.activeElement).toBe(summary);
		expect(focus).toHaveBeenCalledTimes(1);
		expect([...main.childNodes].slice(1)).toEqual(authoredNodes);
		expect(main.querySelector("h1")?.textContent ?? "").not.toContain("Resumed");
	});

	it.each([
		{
			pageTitle: "Un titre long : avec une autre ponctuation",
			positionPrefix: "Reprise à la page 4 sur 6\u00a0: ",
			summary: "Reprise à la page 4 sur 6\u00a0: Un titre long : avec une autre ponctuation",
			visible: "Reprise à la page 4 sur 6",
		},
		{
			pageTitle: "Un titre long : avec une autre ponctuation",
			positionPrefix: "Reprise à la diapositive 4 sur 6\u00a0: ",
			summary: "Reprise à la diapositive 4 sur 6\u00a0: Un titre long : avec une autre ponctuation",
			visible: "Reprise à la diapositive 4 sur 6",
		},
	])("keeps the localized separator and complete title in fallback text: $visible", (cue) => {
		document.body.innerHTML = '<main><h1 aria-label="Author name">Author title</h1></main>';
		focusScormResumePage(document, cue);
		const summary = document.activeElement as HTMLElement;
		expect(summary.textContent).toBe(cue.summary);
		expect(summary.firstChild?.textContent).toBe(cue.visible);
		expect(summary.querySelector(".praxity-a11y-sr-only")?.textContent).toBe(
			"\u00a0: Un titre long : avec une autre ponctuation",
		);
	});

	it.each([
		"<div hidden><h1>Hidden heading</h1></div>",
		"<div inert><h1>Hidden heading</h1></div>",
		'<div aria-hidden="true"><h1>Hidden heading</h1></div>',
		'<h1 class="praxity-sr-only">Hidden heading</h1>',
		"<details><summary>Details</summary><h1>Hidden heading</h1></details>",
		'<div style="display:none"><h1>Hidden heading</h1></div>',
		'<div style="visibility:hidden"><h1>Hidden heading</h1></div>',
		'<h1 style="display:none">Hidden heading</h1>',
	])("skips unavailable headings when choosing the cue: %s", (hiddenHeading) => {
		document.body.innerHTML = `<main>${hiddenHeading}<h2>Build from a composition</h2></main>`;
		focusScormResumePage(document, pageCue);
		expect(document.activeElement).toBe(document.querySelector("h2"));
		expect(document.querySelector("h1")?.textContent).toBe("Hidden heading");
		expect(document.querySelector("h2")?.textContent).toBe(
			"Resumed at page 4 of 6: Build from a composition",
		);
	});

	it("skips a heading the browser reports as invisible", () => {
		document.body.innerHTML =
			"<main><h1>Hidden heading</h1><h2>Build from a composition</h2></main>";
		Object.assign(document.querySelector("h1") as HTMLElement, { checkVisibility: () => false });
		focusScormResumePage(document, pageCue);
		expect(document.activeElement).toBe(document.querySelector("h2"));
	});

	it("keeps a visible summary when every authored heading is unavailable", () => {
		document.body.innerHTML =
			'<main><h1 class="praxity-sr-only">Build from a composition</h1><p>Visible content</p></main>';
		focusScormResumePage(document, pageCue);
		expect(document.activeElement?.tagName).toBe("P");
		expect(document.activeElement?.textContent).toBe(
			"Resumed at page 4 of 6: Build from a composition",
		);
	});

	it("places the summary inside the learner's visible replacing panel", () => {
		document.body.innerHTML =
			'<main inert><h1>Build from a composition</h1></main><div id="deck"><div id="panel"><h2>Transcript</h2><p>Transcript content</p></div></div>';
		const panel = document.getElementById("panel") as HTMLElement;
		const original = panel.innerHTML;
		const target = presentScormResumeCue(panel, pageCue);
		target.tabIndex = -1;
		target.focus();
		expect(document.activeElement).toBe(panel.firstElementChild);
		expect(target.textContent).toBe("Resumed at page 4 of 6: Build from a composition");
		expect(document.querySelector("main")?.hasAttribute("inert")).toBe(true);
		expect(document.querySelector("main h1")?.textContent).toBe("Build from a composition");
		expect(panel.querySelector("h2")?.textContent).toBe("Transcript");
		removeScormResumeCue(document.getElementById("deck") as HTMLElement);
		expect(panel.innerHTML).toBe(original);
	});

	it("prepares once, focuses once and never mutates the existing live region", () => {
		document.body.innerHTML =
			'<main><h1>Build from a composition</h1></main><div id="praxity-live-region" role="status">Existing status</div>';
		const main = document.querySelector("main") as HTMLElement;
		const liveRegion = document.getElementById("praxity-live-region") as HTMLElement;
		const observer = new MutationObserver(() => {});
		observer.observe(liveRegion, { childList: true, subtree: true, characterData: true });
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		const target = presentScormResumeCue(main, pageCue);
		expect(presentScormResumeCue(main, pageCue)).toBe(target);
		focusScormResumePage(document, pageCue);
		focusScormResumePage(document, pageCue);
		expect(target.textContent).toBe("Resumed at page 4 of 6: Build from a composition");
		expect(target.children).toHaveLength(1);
		expect(focus).toHaveBeenCalledTimes(1);
		expect(liveRegion.textContent).toBe("Existing status");
		expect(observer.takeRecords()).toEqual([]);
		observer.disconnect();
	});

	it("does not duplicate a fallback summary on repeated presentation and focus", () => {
		document.body.innerHTML = "<main><h1>Transcript</h1></main>";
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		focusScormResumePage(document, pageCue);
		const target = document.activeElement;
		focusScormResumePage(document, pageCue);
		expect(document.activeElement).toBe(target);
		expect(document.querySelectorAll("main p")).toHaveLength(1);
		expect(focus).toHaveBeenCalledTimes(1);
	});

	it("keeps the cue after blur and removes only its own prefix on navigation", () => {
		document.body.innerHTML =
			'<main><h1>Build from a composition</h1><span class="praxity-resume-prefix">Author content</span><button>Next</button></main>';
		const main = document.querySelector("main") as HTMLElement;
		const heading = document.querySelector("h1") as HTMLElement;
		const authoredTitle = heading.firstChild;
		focusScormResumePage(document, pageCue);
		document.querySelector("button")?.focus();
		expect(heading.textContent).toBe("Resumed at page 4 of 6: Build from a composition");
		removeScormResumeCue(main);
		removeScormResumeCue(main);
		expect(heading.textContent).toBe("Build from a composition");
		expect(heading.firstChild).toBe(authoredTitle);
		expect(main.querySelector("span")?.textContent).toBe("Author content");
		expect(resumeFocusTarget(main)).toBe(heading);
		// Ordinary navigation can return to the original heading without a resume cue.
		resumeFocusTarget(main).focus();
		expect(document.activeElement?.textContent).toBe("Build from a composition");
	});

	it("removes the fallback summary and can present a later confirmed resume", () => {
		document.body.innerHTML = "<main><h1>Transcript</h1><p>Authored content</p></main>";
		const main = document.querySelector("main") as HTMLElement;
		const original = main.innerHTML;
		focusScormResumePage(document, pageCue);
		removeScormResumeCue(main);
		expect(main.innerHTML).toBe(original);
		const focus = vi.spyOn(HTMLElement.prototype, "focus");
		focusScormResumePage(document, pageCue);
		expect(focus).toHaveBeenCalledTimes(1);
		expect(document.activeElement?.textContent).toBe(
			"Resumed at page 4 of 6: Build from a composition",
		);
	});

	it("preserves authored containers that share cue classes during root cleanup", () => {
		document.body.innerHTML =
			'<div id="deck"><section class="praxity-resume-summary"><h1>Build from a composition</h1><p>Authored content</p></section></div>';
		const root = document.getElementById("deck") as HTMLElement;
		const content = root.firstElementChild as HTMLElement;
		const original = root.innerHTML;
		presentScormResumeCue(content, pageCue);
		removeScormResumeCue(root);
		expect(root.firstElementChild).toBe(content);
		expect(root.innerHTML).toBe(original);
	});
});
