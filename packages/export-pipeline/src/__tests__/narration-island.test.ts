// @vitest-environment jsdom

import { MantineProvider } from "@mantine/core";
import { PreviewAssessmentBlock } from "@praxity/shared-blocks/blocks/assessment";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { initDomLogicRuntime } from "@praxity/shared-blocks/logic";
import type { AssessmentBlockData } from "@praxity/shared-blocks/types";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountDeckNarration } from "../../template/src/islands/deck-narration";
import {
	activeStopPositions,
	initNarrationIsland,
	isNarrationEligible,
} from "../../template/src/islands/island-narration";
import { narrationPlaylistFromConfig } from "../narration-playlist";
import { renderBlockHtml } from "../render-block-html";

const strings = {
	play: "Play",
	pause: "Pause",
	seek: "Position in narration",
	durationLoading: "Loading narration duration…",
	durationUnavailable: "Narration duration unavailable",
	speed: "Playback speed",
	narrationLabel: "Narration",
	narrationOptions: "Narration options",
	noNarration: "No narration on this slide",
	listen: "Listen",
	previousSentence: "Previous sentence",
	nextSentence: "Next sentence",
	followNarration: "Follow narration",
};

function renderPage(): HTMLElement {
	window.__PRAXITY_STRINGS__ = strings;
	document.body.innerHTML = `
		<script id="praxity-config" type="application/json">${JSON.stringify({
			pageTitle: "Narrated page",
			currentPage: 1,
			sourceLocale: "en",
			narrationEnabled: true,
			narrationPlaylist: {
				items: [
					{ id: "page-title", src: "audio/title.mp3", duration: 2, authoredIndex: 0 },
					{
						id: "body",
						src: "audio/body.mp3",
						timingsSrc: "audio/body.vtt",
						blockId: "body",
						duration: 4,
						authoredIndex: 1,
					},
				],
				stops: [],
			},
			pages: [
				{
					narrationEnabled: true,
					data: {
						narrationAudio: "audio/title.mp3",
						narrationDuration: 2,
					},
				},
			],
			blocks: [
				{
					id: "body",
					type: "text",
					data: {
						content: "Narrated body.",
						narrationAudio: "audio/body.mp3",
						narrationTimings: "audio/body.vtt",
						narrationDuration: 4,
					},
				},
			],
		})}</script>
		<div id="praxity-a11y-preferences"><div data-island="narration"></div></div>
		<main id="main-content"><p class="praxity-block" data-block-id="body">Narrated body.</p><video></video></main>`;
	return document.getElementById("main-content") as HTMLElement;
}

describe("narration island", () => {
	it.each([false, true])(
		"mounts standalone block audio without a course playlist, autoplay=%s",
		async (autoplay) => {
			window.__PRAXITY_STRINGS__ = strings;
			document.body.innerHTML = `<main id="main-content">${renderBlockHtml(
				{
					id: "standalone-audio",
					type: "audio",
					data: {
						src: "audio/episode.mp3",
						title: "Episode",
						transcript: "Spoken words",
						autoplay,
					},
				},
				{ enabledIslands: new Set(["narration"]) },
			)}</main>`;
			const cleanup = initNarrationIsland();
			try {
				const player = document.querySelector('.praxity-narration-controls[aria-label="Episode"]');
				expect(player).not.toBeNull();
				expect(document.querySelector("audio[controls]")).toBeNull();
				const audio = document.querySelector("audio");
				if (!audio) throw new Error("Missing standalone audio player");
				Object.defineProperty(audio, "readyState", {
					configurable: true,
					value: HTMLMediaElement.HAVE_METADATA,
				});
				await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
				if (autoplay) expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
				else expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
				const transcript = document.querySelector<HTMLButtonElement>("[data-disclosure-trigger]");
				if (!transcript) throw new Error("Missing transcript control");
				expect(transcript.getAttribute("aria-expanded")).toBe("false");
				transcript.click();
				expect(transcript.getAttribute("aria-expanded")).toBe("true");
			} finally {
				await act(async () => cleanup());
			}
		},
	);
	it("stops at a narration-disabled question between narrated intro and outro", async () => {
		window.__PRAXITY_STRINGS__ = strings;
		const config = {
			narrationEnabled: true,
			blocks: [
				{ id: "intro", type: "text", data: { content: "Start", narrationAudio: "intro.mp3" } },
				{
					id: "question",
					type: "assessment",
					data: {
						question: "Choose",
						options: [{ text: "Yes", correct: true }],
						narrationDisabled: true,
						narrationAudio: "question.mp3",
					},
				},
				{ id: "outro", type: "text", data: { content: "End", narrationAudio: "outro.mp3" } },
			],
		};
		const playlist = narrationPlaylistFromConfig(config);
		expect(playlist.items.map(({ id }) => id)).toEqual(["intro", "outro"]);
		expect(playlist.stops).toEqual([{ after: 2, blockId: "question" }]);
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ ...config, narrationPlaylist: playlist })}</script><div data-island="narration"></div><main id="main-content"><p data-block-id="intro">Start</p><div data-block-id="question">Choose</div><p data-block-id="outro">End</p></main>`;
		const cleanup = initNarrationIsland();
		try {
			await act(async () =>
				document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
			);
			const audio = document.querySelector("audio");
			if (!audio) throw new Error("Missing player");
			await vi.waitFor(() => expect(audio.getAttribute("src")).toBe("intro.mp3"));
			Object.defineProperty(audio, "readyState", {
				configurable: true,
				value: HTMLMediaElement.HAVE_METADATA,
			});
			await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
			await act(async () =>
				document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
			);
			expect(audio.getAttribute("src")).toBe("intro.mp3");
			expect(document.querySelector('[aria-label="Pause"]')).not.toBeNull();
			const play = vi.mocked(HTMLMediaElement.prototype.play);
			play.mockClear();
			await act(async () => audio.dispatchEvent(new Event("ended")));
			expect(document.querySelector('[aria-label="Play"]')).not.toBeNull();
			expect(play).not.toHaveBeenCalled();
			expect(audio.getAttribute("src")).toBe("intro.mp3");
			Object.defineProperty(audio, "readyState", { value: HTMLMediaElement.HAVE_NOTHING });
			await act(async () =>
				document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
			);
			await vi.waitFor(() => expect(audio.getAttribute("src")).toBe("outro.mp3"));
			expect(play).not.toHaveBeenCalled();
			Object.defineProperty(audio, "readyState", { value: HTMLMediaElement.HAVE_METADATA });
			await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
			expect(play).toHaveBeenCalledOnce();
		} finally {
			await act(async () => cleanup());
		}
	});

	it("keeps a conditional no-audio assessment stop inactive while hidden", () => {
		const { items, stops } = narrationPlaylistFromConfig({
			narrationEnabled: true,
			blocks: [
				{ id: "intro", type: "text", data: { content: "Start", narrationAudio: "intro.mp3" } },
				{
					id: "rule",
					type: "logic",
					data: {
						conditions: { operator: "and", rules: [] },
						actions: [{ type: "show", targets: ["@hidden-check"] }],
					},
				},
				{
					id: "hidden-check",
					type: "assessment",
					data: {
						name: "hidden-check",
						visible: "variable:ready is true",
						assessmentType: "single",
						question: "Choose",
						options: [{ text: "Yes", correct: true }],
					},
				},
			],
		});
		expect(items).toHaveLength(1);
		expect(items[0].pauseAfter).toBe(false);
		expect(stops).toEqual([
			{ after: 2, blockId: "hidden-check", conditionalBlockId: "hidden-check" },
		]);
	});

	it.each(["assessment", "video"] as const)(
		"keeps an unconditional %s stop after hidden audio",
		(type) => {
			const { items, stops } = narrationPlaylistFromConfig({
				narrationEnabled: true,
				blocks: [
					{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
					{
						id: "rule",
						type: "logic",
						data: {
							conditions: { operator: "and", rules: [] },
							actions: [{ type: "show", targets: ["@branch"] }],
						},
					},
					{
						id: "branch",
						type: "text",
						data: { name: "branch", hide: true, content: "Hidden", narrationAudio: "branch.mp3" },
					},
					type === "assessment"
						? {
								id: "question",
								type,
								data: { question: "Choose", options: [{ text: "Yes", correct: true }] },
							}
						: { id: "media", type, data: { src: "video.mp4" } },
					{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
				],
			});
			expect(items.map(({ id }) => id)).toEqual(["intro", "branch", "outro"]);
			expect(stops).toEqual([
				{
					after: items[2].authoredIndex,
					blockId: type === "assessment" ? "question" : "media",
					conditionalBlockId: undefined,
				},
			]);
		},
	);

	it("keeps a trailing native video stop without a following segment", () => {
		const { items, stops } = narrationPlaylistFromConfig({
			narrationEnabled: true,
			blocks: [
				{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
				{ id: "media", type: "video", data: { src: "video.mp4" } },
			],
		});
		expect(items.map(({ id }) => id)).toEqual(["intro"]);
		expect(stops).toEqual([{ after: 1, blockId: "media", conditionalBlockId: undefined }]);
	});

	it("attributes an aggregated tab assessment stop to the assessment", () => {
		const { stops } = narrationPlaylistFromConfig({
			narrationEnabled: true,
			blocks: [
				{
					id: "tabs",
					type: "tabs",
					data: {
						items: [
							{
								id: "one",
								label: "Details",
								children: [
									{
										id: "check",
										type: "assessment",
										data: {
											question: "Choose",
											options: [{ text: "Yes", correct: true }],
										},
									},
								],
							},
						],
					},
				},
			],
		});
		expect(stops.map(({ blockId }) => blockId)).toEqual(["check"]);
	});

	beforeEach(() => {
		sessionStorage.clear();
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
		HTMLElement.prototype.scrollIntoView = vi.fn();
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn(() => ({
				matches: false,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
	});

	afterEach(() => {
		delete window.__PRAXITY_STRINGS__;
		delete window.__praxityBlockState;
		document.documentElement.removeAttribute("data-praxity-focus-mode");
		document.body.replaceChildren();
		vi.restoreAllMocks();
	});

	it.each([undefined, 12])(
		"omits unknown duration from deck Tools, duration=%s",
		async (duration) => {
			vi.stubGlobal(
				"ResizeObserver",
				class {
					observe() {}
					disconnect() {}
				},
			);
			document.body.innerHTML =
				'<div id="transport"></div><div id="tools"></div><main id="main-content"></main>';
			const mount = document.getElementById("transport")!;
			const tools = document.getElementById("tools")!;
			const player = mountDeckNarration({
				mount,
				settingsContainer: document.body,
				settingsMount: { element: tools, timeLabel: "Time", speedLabel: "Playback speed" },
				items: [{ id: "intro", src: "intro.mp3", duration }],
				strings,
				contentRoot: document.getElementById("main-content"),
			});
			try {
				if (duration !== undefined) {
					const audio = mount.querySelector("audio")!;
					Object.defineProperty(audio, "duration", { configurable: true, value: duration });
					await act(async () => audio.dispatchEvent(new Event("loadedmetadata")));
				}
				expect(tools.querySelector('[role="timer"]')?.textContent ?? null).toBe(
					duration === undefined ? null : "0:00 / 0:12",
				);
				expect(tools.querySelector("button")?.getAttribute("aria-label")).toBe(
					"Playback speed: 1\u00d7",
				);
			} finally {
				await act(async () => player.destroy());
				vi.unstubAllGlobals();
			}
		},
	);

	it("counts only logic-controlled hidden wrappers as concealment", () => {
		document.body.innerHTML = `<main id="main-content">
			<div class="praxity-block" data-block-id="tabs">
				<div role="tabpanel" hidden><div class="praxity-block" data-block-id="tab-line"></div></div>
			</div>
			<div class="praxity-block" data-block-id="accordion">
				<details><div class="praxity-block" data-block-id="accordion-line"></div></details>
			</div>
			<div class="praxity-block" data-block-id="card">
				<div data-card-side="back"><div class="praxity-block" data-block-id="back-line"></div></div>
			</div>
			<div class="praxity-block" data-block-id="shown">
				<div class="praxity-block" data-block-id="hidden-child" hidden></div>
			</div>
			<div class="praxity-section" hidden><div class="praxity-block" data-block-id="section-line"></div></div>
		</main>`;
		const root = document.getElementById("main-content") as HTMLElement;
		for (const id of ["tab-line", "accordion-line", "back-line"])
			expect(isNarrationEligible(root, id)).toBe(true);
		for (const id of ["hidden-child", "section-line"])
			expect(isNarrationEligible(root, id)).toBe(false);
	});

	it("keeps a segment eligible when its block has no DOM wrapper", () => {
		document.body.innerHTML = '<main id="main-content"></main>';
		const root = document.getElementById("main-content") as HTMLElement;
		expect(isNarrationEligible(root, "wrapperless")).toBe(true);
	});

	it("checks serialized ancestors for a wrapperless stop", () => {
		document.body.innerHTML = `<main id="main-content">
			<section class="praxity-section"><div data-block-id="parent" hidden></div></section>
		</main>`;
		const root = document.getElementById("main-content") as HTMLElement;
		const parent = root.querySelector<HTMLElement>("[data-block-id]") as HTMLElement;
		const section = root.querySelector<HTMLElement>("section") as HTMLElement;
		const stops = [{ after: 1, blockId: "wrapperless", ancestorBlockIds: ["parent"] }];
		expect(activeStopPositions(root, stops)).toEqual(new Set());
		parent.hidden = false;
		expect(activeStopPositions(root, stops)).toEqual(new Set([1]));
		section.hidden = true;
		expect(activeStopPositions(root, stops)).toEqual(new Set());
	});

	it.each(["assessment", "aggregated assessment", "trailing video", "video before outro"])(
		"preserves serialized ancestors for a nested %s stop",
		(kind) => {
			const child = kind.includes("assessment")
				? {
						id: "check",
						type: "assessment",
						data: {
							question: "Choose",
							options: [{ text: "Yes", correct: true }],
							...(kind === "assessment" ? { narrationAudio: "check.mp3" } : {}),
						},
					}
				: { id: "check", type: "video", data: { src: "video.mp4", narrationDisabled: true } };
			const playlist = narrationPlaylistFromConfig({
				narrationEnabled: true,
				blocks: [
					{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
					{
						id: "columns",
						type: "columns",
						data: {
							columns: [
								{
									children: [
										{
											id: "tabs",
											type: "tabs",
											data: { items: [{ id: "one", label: "Details", children: [child] }] },
										},
									],
								},
							],
						},
					},
					...(kind === "video before outro"
						? [
								{
									id: "outro",
									type: "text",
									data: { content: "Outro", narrationAudio: "outro.mp3" },
								},
							]
						: []),
				],
			});
			const serialized: typeof playlist = JSON.parse(JSON.stringify(playlist));
			const stop = serialized.stops.find((entry) => entry.blockId === "check");
			expect(stop?.ancestorBlockIds).toEqual(["columns", "tabs"]);
			if (!stop) return;
			document.body.innerHTML = `<main id="main-content">
				<div data-block-id="columns"><div data-block-id="tabs"></div></div>
			</main>`;
			const root = document.getElementById("main-content") as HTMLElement;
			for (const id of ["columns", "tabs"]) {
				const ancestor = root.querySelector<HTMLElement>(`[data-block-id="${id}"]`) as HTMLElement;
				expect(activeStopPositions(root, [stop])).toEqual(new Set([stop.after]));
				ancestor.hidden = true;
				expect(activeStopPositions(root, [stop])).toEqual(new Set());
				ancestor.hidden = false;
			}
		},
	);

	it("tracks a wrapperless child's ancestor when logic hides and shows it", async () => {
		const blocks = [
			{ id: "rating", type: "rating", data: {} },
			{
				id: "tabs",
				type: "tabs",
				data: {
					items: [
						{
							id: "one",
							label: "Details",
							children: [
								{
									id: "child",
									type: "text",
									data: { content: "Child", narrationAudio: "audio/child.mp3" },
								},
							],
						},
					],
				},
			},
		];
		const config = {
			narrationEnabled: true,
			blocks,
			logic: {
				variables: [],
				visibility: [],
				rules: [
					{
						blockId: "hide-tabs",
						conditions: {
							operator: "and",
							rules: [{ source: "block:rating", field: "ratingScore", comparison: "lt", value: 3 }],
						},
						actions: [{ type: "hide", target: "tabs" }],
					},
				],
			},
		};
		const playlist = narrationPlaylistFromConfig(config);
		const child = playlist.items.find((item) => item.id === "child");
		expect(child?.ancestorBlockIds).toEqual(["tabs"]);
		window.__PRAXITY_STRINGS__ = strings;
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ ...config, narrationPlaylist: playlist })}</script>
			<div data-island="narration"></div><main id="main-content">
			<div class="praxity-block" data-block-id="rating" data-rating-value="5"></div>
			<section class="praxity-section"><div class="praxity-block" data-block-id="tabs"></div></section>
			</main>`;
		const root = document.getElementById("main-content") as HTMLElement;
		const rating = root.querySelector<HTMLElement>('[data-block-id="rating"]') as HTMLElement;
		const section = root.querySelector<HTMLElement>(".praxity-section") as HTMLElement;
		const logic = initDomLogicRuntime(config);
		const cleanup = initNarrationIsland();
		expect(isNarrationEligible(root, "child", child?.ancestorBlockIds)).toBe(true);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
		);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
		);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
		vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
		rating.dataset.ratingValue = "1";
		await act(async () => logic?.evaluate());
		expect(root.querySelector<HTMLElement>('[data-block-id="tabs"]')?.hidden).toBe(true);
		expect(section.hidden).toBe(true);
		expect(isNarrationEligible(root, "child", child?.ancestorBlockIds)).toBe(false);
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
		vi.mocked(HTMLMediaElement.prototype.play).mockClear();
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
		);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		rating.dataset.ratingValue = "5";
		await act(async () => logic?.evaluate());
		expect(section.hidden).toBe(false);
		expect(isNarrationEligible(root, "child", child?.ancestorBlockIds)).toBe(true);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Narration options"]')?.click(),
		);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Previous sentence"]')?.click(),
		);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
		);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
		await act(async () => cleanup());
		logic?.destroy();
	});

	it.each([false, true])("deactivates a rule-hidden assessment stop: nested=%s", (nested) => {
		const check = {
			id: "check",
			type: "assessment",
			data: {
				question: "Choose",
				options: [{ text: "Yes", correct: true }],
			},
		};
		const parent = {
			id: "tabs",
			type: "tabs",
			data: { hide: true, items: [{ id: "one", label: "Details", children: [check] }] },
		};
		const conditions = {
			operator: "and",
			rules: [{ source: "variable:ready", comparison: "is", value: true }],
		};
		const blocks = [
			{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
			...(nested
				? [
						{
							id: "show-tabs-rule",
							type: "logic",
							data: {
								conditions,
								actions: [{ type: "show", targets: ["@tabs"] }],
							},
						},
					]
				: []),
			{
				id: "hide-check-rule",
				type: "logic",
				data: {
					conditions,
					actions: [{ type: "hide", targets: ["@check"] }],
				},
			},
			...(nested ? [parent] : [check]),
			{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
		];
		const rules = [
			...(nested
				? [
						{
							blockId: "show-tabs",
							conditions,
							actions: [{ type: "show", target: "tabs" }],
						},
					]
				: []),
			{
				blockId: "hide-check",
				conditions,
				actions: [{ type: "hide", target: "check" }],
			},
		];
		document.body.innerHTML = `<main id="main-content">
			<div class="praxity-block" data-block-id="intro"></div>
			${nested ? '<div class="praxity-block" data-block-id="tabs" hidden>' : ""}
			<div class="praxity-block" data-block-id="check"></div>
			${nested ? "</div>" : ""}
			<div class="praxity-block" data-block-id="outro"></div></main>`;
		const root = document.getElementById("main-content") as HTMLElement;
		const assessment = root.querySelector<HTMLElement>('[data-block-id="check"]') as HTMLElement;
		const stop = narrationPlaylistFromConfig({ narrationEnabled: true, blocks }).stops.find(
			(value) => value.blockId === "check",
		);
		expect(stop).toBeDefined();
		if (!stop) return;
		expect(stop.blockId).toBe("check");
		expect(stop.conditionalBlockId).toBe(nested ? "tabs" : undefined);
		expect(activeStopPositions(root, [stop])).toEqual(nested ? new Set() : new Set([stop.after]));
		const logic = initDomLogicRuntime({
			courseId: "stop-test",
			pageId: "page-1",
			pageIdMap: {},
			blocks,
			logic: {
				variables: [{ name: "ready", dataType: "boolean", defaultValue: true }],
				visibility: [],
				rules,
			},
		});
		if (nested)
			expect(root.querySelector<HTMLElement>('[data-block-id="tabs"]')?.hidden).toBe(false);
		expect(assessment.hidden).toBe(true);
		expect(activeStopPositions(root, [stop])).toEqual(new Set());
		assessment.hidden = false;
		expect(activeStopPositions(root, [stop])).toEqual(new Set([stop.after]));
		logic?.destroy();
	});

	it("plays a nested dialogue in an inactive tab", async () => {
		window.__PRAXITY_STRINGS__ = strings;
		const config = {
			narrationEnabled: true,
			blocks: [
				{
					id: "tabs",
					type: "tabs",
					data: {
						items: [
							{
								id: "details",
								label: "Details",
								children: [
									{
										id: "dialogue",
										type: "dialogue",
										data: {
											turns: [
												{
													id: "item-0",
													speaker: "Roger",
													paragraphs: ["Inside tab."],
													narrationAudio: "audio/tab.mp3",
												},
											],
										},
									},
								],
							},
						],
					},
				},
			],
		};
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify(
			{ ...config, narrationPlaylist: narrationPlaylistFromConfig(config) },
		)}</script>
			 <div data-island="narration"></div><main id="main-content">
			 <div class="praxity-block" data-block-id="tabs"><div role="tabpanel" hidden
			   data-narration-reveal="details"><div class="praxity-block" data-block-id="dialogue">
			   <div data-turn-index="0">Inside tab.</div></div></div></div></main>`;
		const cleanup = initNarrationIsland();
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
		);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
		);
		expect(document.querySelector("audio")?.getAttribute("src")).toBe("audio/tab.mp3");
		await act(async () => cleanup());
	});

	it("hydrates a saved assessment silently and offers its revealed dialogue", async () => {
		const choiceData: AssessmentBlockData = {
			assessmentType: "choice",
			stem: [{ id: "stem", type: "text", data: { content: "Choose" } }],
			response: {
				type: "choice",
				selectionMode: "single",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [
					{ id: "a", label: "Wrong", isCorrect: false },
					{ id: "b", label: "Right", isCorrect: true },
				],
			},
			feedback: { correct: [], incorrect: [] },
			feedbackEnabled: true,
			gradingMode: "exact",
		};
		const saved = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 1,
			checked: true,
			correct: true,
			completed: true,
			interacted: true,
			answer: ["b"],
		};
		window.__praxityBlockState = { get: (id) => (id === "gate" ? saved : undefined), set: vi.fn() };
		const rule = {
			blockId: "rule",
			conditions: {
				operator: "and",
				rules: [{ source: "block:gate", field: "result", comparison: "is", value: "correct" }],
			},
			actions: [{ type: "show", target: "branch" }],
		};
		const blocks = [
			{ id: "gate", type: "assessment", data: choiceData },
			{
				id: "rule",
				type: "logic",
				data: { conditions: rule.conditions, actions: [{ type: "show", targets: ["@branch"] }] },
			},
			{
				id: "branch",
				type: "dialogue",
				data: {
					name: "branch",
					hide: true,
					turns: [
						{
							id: "item-0",
							speaker: "Roger",
							paragraphs: ["Hello."],
							narrationAudio: "audio/branch.mp3",
						},
					],
				},
			},
		];
		const config = {
			narrationEnabled: true,
			blocks,
			logic: {
				rules: [rule],
				variables: [],
				visibility: [],
			},
		};
		window.__PRAXITY_STRINGS__ = strings;
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify(
			{ ...config, narrationPlaylist: narrationPlaylistFromConfig(config) },
		)}</script>
			 <div data-island="narration"></div>
			 <main id="main-content"><div class="praxity-block" data-block-id="gate"></div>
			 <div class="praxity-block" data-block-id="branch" hidden>Hello.</div>
			 <button id="focus-anchor">Anchor</button></main>`;
		const logic = initDomLogicRuntime(config);
		const cleanupNarration = initNarrationIsland();
		const anchor = document.getElementById("focus-anchor") as HTMLElement;
		anchor.focus();
		const assessmentRoot = createRoot(
			document.querySelector<HTMLElement>('.praxity-block[data-block-id="gate"]') as HTMLElement,
		);
		await act(async () =>
			assessmentRoot.render(
				createElement(
					MantineProvider,
					null,
					createElement(PreviewAssessmentBlock, { blockId: "gate", data: choiceData }),
				),
			),
		);
		expect(
			document.querySelector('[data-assessment-display][data-result="correct"]'),
		).not.toBeNull();
		document
			.querySelector<HTMLElement>('.praxity-block[data-block-id="gate"]')
			?.setAttribute("data-hydrated", "");
		await vi.waitFor(() =>
			expect(
				document.querySelector<HTMLElement>('.praxity-block[data-block-id="branch"]')?.hidden,
			).toBe(false),
		);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(anchor);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
		);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
		);
		const branch = document.querySelector<HTMLElement>(
			'.praxity-block[data-block-id="branch"]',
		) as HTMLElement;
		const audio = document.querySelector("audio") as HTMLAudioElement;
		const active = document.activeElement;
		expect(audio.getAttribute("src")).toBe("audio/branch.mp3");
		expect(document.querySelector('[aria-label="Pause"]')).not.toBeNull();
		vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
		branch.hidden = true;
		await act(async () => document.dispatchEvent(new Event("praxity:visibility-change")));
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
		expect(document.querySelector('[aria-label="Play"]')).not.toBeNull();
		expect(audio.getAttribute("src")).toBe("audio/branch.mp3");
		expect(document.activeElement).toBe(active);
		await act(async () => assessmentRoot.unmount());
		await act(async () => cleanupNarration());
		logic?.destroy();
	});

	it.each(["praxity:assessment-response", "praxity:assessment-group-complete"])(
		"pauses active audio on %s",
		async (eventName) => {
			renderPage();
			const cleanup = initNarrationIsland();
			const anchor = document.querySelector<HTMLElement>('[data-block-id="body"]') as HTMLElement;
			anchor.tabIndex = -1;
			anchor.focus();
			await act(async () =>
				document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
			);
			await act(async () =>
				document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
			);
			expect(document.querySelector('[aria-label="Pause"]')).not.toBeNull();
			vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
			await act(async () => document.dispatchEvent(new Event(eventName)));
			expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
			expect(document.querySelector('[aria-label="Play"]')).not.toBeNull();
			expect(document.activeElement).toBe(anchor);
			await act(async () => cleanup());
		},
	);

	it("builds the page playlist from the existing viewer config", () => {
		const { items, stops } = narrationPlaylistFromConfig({
			pageTitle: "Page",
			currentPage: 1,
			narrationEnabled: true,
			pages: [
				{
					data: {
						narrationAudio: "audio/title.mp3",
						narrationDuration: 1,
					},
				},
			],
			blocks: [
				{
					id: "body",
					type: "text",
					data: {
						content: "Body",
						narrationAudio: "audio/body.mp3",
						narrationTimings: "audio/body.vtt",
						narrationDuration: 2,
					},
				},
				{ id: "action", type: "button", data: { text: "Continue" } },
			],
		});

		expect(items).toEqual([
			{
				id: "page-title",
				src: "audio/title.mp3",
				duration: 1,
				pauseAfter: false,
				authoredIndex: 0,
			},
			{
				id: "body",
				src: "audio/body.mp3",
				timingsSrc: "audio/body.vtt",
				blockId: "body",
				duration: 2,
				pauseAfter: false,
				authoredIndex: 1,
			},
		]);
		expect(stops).toEqual([{ after: 3, blockId: "action" }]);
	});

	it("plays container items as separate clips in authored order after adaptation", () => {
		const { items } = narrationPlaylistFromConfig({
			pageTitle: "Cards",
			narrationEnabled: true,
			blocks: adaptGrammarPreviewBlocks([
				{
					id: "cards",
					type: "card",
					data: {
						layout: "grid",
						items: [
							{
								id: "first-card",
								backId: "first-card-back",
								label: "First",
								front: [{ id: "first-text", type: "text", data: { content: "First content" } }],
								back: [{ id: "first-back", type: "text", data: { content: "Back content" } }],
								narrationBack: { narrationAudio: "audio/back.mp3", narrationDuration: 30 },
								narrationAudio: "audio/first.mp3",
								narrationTimings: "audio/first.vtt",
								narrationDuration: 80,
							},
							{
								id: "second-card",
								label: "Second",
								front: [{ id: "second-text", type: "text", data: { content: "Second content" } }],
								narrationAudio: "audio/second.mp3",
								narrationTimings: "audio/second.vtt",
								narrationDuration: 90,
							},
						],
					},
				},
			]),
		});
		expect(items.map((item) => item.src)).toEqual([
			"audio/first.mp3",
			"audio/back.mp3",
			"audio/second.mp3",
		]);
		expect(items.map((item) => item.timingsSrc)).toEqual([
			"audio/first.vtt",
			undefined,
			"audio/second.vtt",
		]);
		expect(items.map((item) => item.duration)).toEqual([80, 30, 90]);
		expect(items.map((item) => item.cardTargets)).toEqual([
			[{ containerId: "cards", itemIndex: 0, side: "front" }],
			[{ containerId: "cards", itemIndex: 0, side: "back" }],
			[{ containerId: "cards", itemIndex: 1, side: "front" }],
		]);
		expect(new Set(items.map((item) => item.id)).size).toBe(3);
	});

	it("keeps dialogue turn positions in narration items", () => {
		const config = {
			pageTitle: "Dialogue",
			narrationEnabled: true,
			blocks: [
				{
					id: "d1",
					type: "dialogue",
					data: {
						turns: [
							{ speaker: "roger", paragraphs: ["Hi."], narrationAudio: "a.mp3" },
							"junk",
							{ speaker: "roxanne", paragraphs: ["Yo."], narrationAudio: "b.mp3" },
						],
					},
				},
			],
		};
		expect(
			narrationPlaylistFromConfig(config).items.map((item) => [
				item.id,
				item.blockId,
				item.turnIndex,
			]),
		).toEqual([
			["d1:item:0", "d1", 0],
			["d1:item:2", "d1", 2],
		]);
	});

	it.each([false, true])("includes assessment audio with grouped=%s", (grouped) => {
		const { items, stops } = narrationPlaylistFromConfig({
			pageTitle: "Questions",
			narrationEnabled: true,
			blocks: adaptGrammarPreviewBlocks([
				...(grouped
					? [
							{
								id: "group",
								type: "assessmentGroup" as const,
								data: { memberBlockIds: ["question"] },
							},
						]
					: []),
				{
					id: "question",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [
							{
								id: "question-stem",
								type: "text",
								data: { content: "<p>Which answer is correct?</p>" },
							},
						],
						response: {
							type: "choice",
							selectionMode: "single",
							options: [{ id: "answer", label: "Yes", isCorrect: true }],
						},
						narration: "Consider the question.",
						narrationAudio: "audio/question.mp3",
						narrationTimings: "audio/question.vtt",
						narrationDuration: 3,
					},
				},
			]),
		});

		expect(items).toEqual([
			{
				id: "question",
				src: "audio/question.mp3",
				timingsSrc: "audio/question.vtt",
				blockId: "question",
				duration: 3,
				pauseAfter: true,
				authoredIndex: 1,
			},
		]);
		expect(stops).toEqual([{ after: 2, blockId: "question" }]);
	});

	it("plays an audio-only group introduction before its question", () => {
		const { items, stops } = narrationPlaylistFromConfig({
			pageTitle: "Questions",
			narrationEnabled: true,
			blocks: adaptGrammarPreviewBlocks([
				{
					id: "group",
					type: "assessmentGroup",
					data: { memberBlockIds: ["question"], narrationAudio: "group.mp3" },
				},
				{
					id: "question",
					type: "assessment",
					data: {
						assessmentType: "choice",
						stem: [{ id: "question-stem", type: "text", data: { content: "<p>Choose</p>" } }],
						response: {
							type: "choice",
							selectionMode: "single",
							options: [{ id: "yes", label: "Yes", isCorrect: true }],
						},
						narrationAudio: "question.mp3",
					},
				},
			]),
		});
		expect(
			items.map(({ id, src, authoredIndex, pauseAfter }) => [id, src, authoredIndex, pauseAfter]),
		).toEqual([
			["group", "group.mp3", 1, false],
			["question", "question.mp3", 2, true],
		]);
		expect(stops).toEqual([{ after: 3, blockId: "question" }]);
	});

	it.each([false, true])("counts a decorative image only when it has audio=%s", (audio) => {
		const { items, stops } = narrationPlaylistFromConfig({
			narrationEnabled: true,
			blocks: [
				{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
				{
					id: "decoration",
					type: "image",
					data: {
						src: "decoration.png",
						decorative: true,
						...(audio ? { narrationAudio: "decoration.mp3" } : {}),
					},
				},
				{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
			],
		});
		expect(items.map(({ id, src, authoredIndex }) => [id, src, authoredIndex])).toEqual(
			audio
				? [
						["intro", "intro.mp3", 0],
						["decoration", "decoration.mp3", 1],
						["outro", "outro.mp3", 2],
					]
				: [
						["intro", "intro.mp3", 0],
						["outro", "outro.mp3", 1],
					],
		);
		expect(stops).toEqual([]);
	});

	it.each(["image", "assessmentGroup"] as const)(
		"preserves stops before and after an empty %s target",
		(type) => {
			const { items, stops } = narrationPlaylistFromConfig({
				narrationEnabled: true,
				blocks: [
					{ id: "intro", type: "text", data: { content: "Intro", narrationAudio: "intro.mp3" } },
					{ id: "before", type: "video", data: { src: "before.mp4" } },
					{
						id: "empty",
						type,
						data: { src: "decoration.png", decorative: true, memberBlockIds: [] },
					},
					{ id: "outro", type: "text", data: { content: "Outro", narrationAudio: "outro.mp3" } },
					{
						id: "trailing-empty",
						type,
						data: { src: "decoration.png", decorative: true, memberBlockIds: [] },
					},
					{ id: "after", type: "video", data: { src: "after.mp4" } },
				],
			});
			expect(items.map(({ id, authoredIndex }) => [id, authoredIndex])).toEqual([
				["intro", 0],
				["outro", 1],
			]);
			expect(stops).toEqual([
				{ after: 1, blockId: "before", conditionalBlockId: undefined },
				{ after: 2, blockId: "after", conditionalBlockId: undefined },
			]);
		},
	);

	it("mounts only inside its controls root and preserves playback behavior", async () => {
		const content = renderPage();
		const paragraph = content.querySelector("p");
		document.documentElement.dataset.praxityFocusMode = "true";
		const cleanup = initNarrationIsland();

		expect(content.querySelector("p")).toBe(paragraph);
		const listen = document.querySelector<HTMLButtonElement>('[aria-label="Listen"]');
		expect(listen?.getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector("audio")?.getAttribute("src")).toBe("audio/title.mp3");
		await act(async () => listen?.click());
		const play = document.querySelector<HTMLButtonElement>('[aria-label="Play"]');
		await act(async () => play?.click());
		await vi.waitFor(() =>
			expect(document.documentElement.hasAttribute("data-praxity-focus-mode")).toBe(false),
		);

		vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
		content.querySelector("video")?.dispatchEvent(new Event("play"));
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce();

		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Playback speed: 1×"]')?.click(),
		);
		expect(sessionStorage.getItem("praxity-narration-rate")).toBe("1.25");
		await act(async () => cleanup());
		expect(document.documentElement.dataset.praxityFocusMode).toBe("true");

		renderPage();
		const cleanupNextPage = initNarrationIsland();
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
		);
		expect(
			document.querySelector<HTMLButtonElement>('[aria-label="Playback speed: 1.25×"]'),
		).not.toBeNull();
		await act(async () => cleanupNextPage());
	});

	it("mounts a serialized playlist without source blocks", async () => {
		window.__PRAXITY_STRINGS__ = strings;
		document.body.innerHTML = `
			<script id="praxity-config" type="application/json">${JSON.stringify({
				narrationPlaylist: {
					items: [{ id: "saved", src: "audio/saved.mp3", blockId: "saved", authoredIndex: 0 }],
					stops: [],
				},
			})}</script>
			<div data-island="narration"></div><main id="main-content"></main>`;
		const cleanup = initNarrationIsland();
		expect(document.querySelector("audio")?.getAttribute("src")).toBe("audio/saved.mp3");
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Listen"]')?.click(),
		);
		await act(async () =>
			document.querySelector<HTMLButtonElement>('[aria-label="Play"]')?.click(),
		);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
		await act(async () => cleanup());
	});
});
