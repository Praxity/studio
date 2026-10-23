// @vitest-environment jsdom

import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { checkRequiredBlocks } from "@praxity/shared-blocks/viewer/required-blocks";
import { afterEach, expect, it, vi } from "vitest";
import { initNarrationIsland } from "../../template/src/islands/island-narration";
import { renderBlockHtml } from "../render-block-html";

let cleanupAudio: (() => void) | undefined;

afterEach(() => {
	cleanupAudio?.();
	cleanupAudio = undefined;
	delete window.__PRAXITY_STRINGS__;
	document.body.replaceChildren();
	vi.resetModules();
});

it("reveals transcript content for initial and changing authored fragments", async () => {
	window.__PRAXITY_STRINGS__ = { ...getStrings("en") };
	history.replaceState(null, "", "#spoken-anchor");
	document.body.innerHTML = renderBlockHtml(
		{
			id: "audio",
			type: "audio",
			data: { src: "assets/audio.mp3", transcript: '<p id="spoken-anchor">Spoken words</p>' },
		} as PraxityBlock,
		{ enabledIslands: new Set(["narration"]) },
	);
	cleanupAudio = initNarrationIsland();
	const button = document.getElementById("audio-transcript-trigger") as HTMLButtonElement;
	expect(button.getAttribute("aria-expanded")).toBe("true");
	button.click();
	expect(button.getAttribute("aria-expanded")).toBe("false");
	window.dispatchEvent(new Event("hashchange"));
	expect(button.getAttribute("aria-expanded")).toBe("true");
	expect(document.getElementById("audio-transcript-panel")?.style.display).toBe("");
	history.replaceState(null, "", "#");
});

it("keeps a focused fallback transcript expanded when enhancement arrives", async () => {
	window.__PRAXITY_STRINGS__ = { ...getStrings("en") };
	document.body.innerHTML = renderBlockHtml(
		{
			id: "audio",
			type: "audio",
			data: {
				src: "assets/audio.mp3",
				transcript: '<a id="lesson-link" href="#destination">Lesson link</a>',
			},
		} as PraxityBlock,
		{ enabledIslands: new Set(["narration"]) },
	);
	const link = document.getElementById("lesson-link");
	link?.focus();
	cleanupAudio = initNarrationIsland();
	expect(document.activeElement).toBe(link);
	expect(document.getElementById("audio-transcript-trigger")?.getAttribute("aria-expanded")).toBe(
		"true",
	);
	expect(document.getElementById("audio-transcript-panel")?.style.display).toBe("");
});

function accordion(multiple: boolean): PraxityBlock {
	return {
		id: "accordion",
		type: "accordion",
		data: {
			allowMultipleOpen: multiple,
			items: [
				{ id: "one", label: "First", children: [] },
				{
					id: "two",
					label: "Second",
					children: [
						{
							id: "nested",
							type: "accordion",
							data: { items: [{ id: "child", label: "Child", children: [] }] },
						},
					],
				},
			],
		},
	} as PraxityBlock;
}

it.each([false, true])(
	"preserves multiple=%s and isolates nested narration reveals",
	async (multiple) => {
		document.body.innerHTML = renderBlockHtml(accordion(multiple), {
			enabledIslands: new Set(["accordion"]),
		});
		await import("../../template/src/islands/island-accordion");
		const first = document.getElementById("accordion-summary-one") as HTMLButtonElement;
		const second = document.getElementById("accordion-summary-two") as HTMLButtonElement;
		const child = document.getElementById("nested-summary-child") as HTMLButtonElement;
		first.click();
		second.click();
		expect(first.getAttribute("aria-expanded")).toBe(String(multiple));
		expect(second.getAttribute("aria-expanded")).toBe("true");
		second.click();
		expect(second.getAttribute("aria-expanded")).toBe("false");
		child.dispatchEvent(new CustomEvent("praxity:narration-reveal", { bubbles: true }));
		expect(child.getAttribute("aria-expanded")).toBe("true");
		expect(second.getAttribute("aria-expanded")).toBe("true");
		expect(first.getAttribute("aria-expanded")).toBe(String(multiple));
	},
);

it("retains one authored label anchor before and after enhancement", async () => {
	const block = accordion(false);
	(block.data as { items: Array<{ label: string }> }).items[0].label =
		'<span id="authored-label">First</span>';
	document.body.innerHTML = renderBlockHtml(block, { enabledIslands: new Set(["accordion"]) });
	expect(document.querySelectorAll("#authored-label")).toHaveLength(1);
	await import("../../template/src/islands/island-accordion");
	expect(document.querySelectorAll("#authored-label")).toHaveLength(1);
	expect(document.getElementById("authored-label")?.closest("button")?.id).toBe(
		"accordion-summary-one",
	);
});

it("keeps required activities eligible while collapsed and recovers focus on collapse", async () => {
	document.body.innerHTML = renderBlockHtml(accordion(false), {
		enabledIslands: new Set(["accordion"]),
	});
	const panel = document.getElementById("accordion-panel-one");
	expect(panel).not.toBeNull();
	const activity = document.createElement("div");
	activity.dataset.required = "true";
	activity.dataset.blockType = "checklist";
	activity.innerHTML = '<button type="button">Complete activity</button>';
	panel?.append(activity);
	await import("../../template/src/islands/island-accordion");
	expect(checkRequiredBlocks().valid).toBe(false);
	const trigger = document.getElementById("accordion-summary-one") as HTMLButtonElement;
	trigger.click();
	activity.querySelector("button")?.focus();
	trigger.click();
	expect(document.activeElement).toBe(trigger);
	expect(trigger.getAttribute("aria-expanded")).toBe("false");
	expect(checkRequiredBlocks().valid).toBe(false);
	activity.hidden = true;
	expect(checkRequiredBlocks().valid).toBe(true);
});
