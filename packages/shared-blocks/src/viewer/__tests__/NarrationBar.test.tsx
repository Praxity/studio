/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import {
	NarrationBar,
	type NarrationController,
	type NarrationPlaylistItem,
	type NarrationStrings,
} from "../NarrationBar";

const strings: NarrationStrings = {
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

const items: NarrationPlaylistItem[] = [
	{ id: "title", src: "audio/title.mp3" },
	{ id: "body", src: "audio/body.mp3", blockId: "body" },
];

const recordedItems: NarrationPlaylistItem[] = [
	{ id: "page-title", src: "audio/page-title.mp3", duration: 0.854 },
	{ id: "heading", src: "audio/heading.mp3", duration: 1.195 },
	{ id: "text", src: "audio/text.mp3", duration: 10.752 },
	{ id: "note", src: "audio/note.mp3", duration: 6.23 },
];

const threeItems: NarrationPlaylistItem[] = [
	{
		id: "first",
		src: "audio/first.mp3",
		timingsSrc: "timings/first.vtt",
		blockId: "first",
	},
	{
		id: "second",
		src: "audio/second.mp3",
		timingsSrc: "timings/second.vtt",
		blockId: "second",
	},
	{
		id: "third",
		src: "audio/third.mp3",
		timingsSrc: "timings/third.vtt",
		blockId: "third",
	},
];

const branchItems: NarrationPlaylistItem[] = [
	{ id: "intro", src: "audio/intro.mp3", duration: 10 },
	{ id: "old", src: "audio/old.mp3", duration: 20, blockId: "old" },
	{ id: "new", src: "audio/new.mp3", duration: 30, blockId: "new" },
];

function NarrationAccordion({
	markup,
	children,
}: {
	markup: "native" | "custom";
	children: ReactNode;
}) {
	return (
		<div data-island="accordion" data-block-id="accordion">
			<div className="praxity-accordion-static">
				{markup === "native" ? (
					<details data-accordion-item data-narration-reveal="item-0">
						<summary>Details</summary>
						<div data-narration-reveal="item-0">{children}</div>
					</details>
				) : (
					<div data-accordion-item data-narration-reveal="item-0">
						<h3 className="praxity-disclosure-heading">
							<span id="accordion-summary-item-0-label" data-disclosure-label>
								Details
							</span>
							<button
								type="button"
								id="accordion-summary-item-0"
								aria-controls="accordion-panel-item-0"
								aria-expanded="true"
								hidden
							/>
						</h3>
						<section
							id="accordion-panel-item-0"
							data-disclosure-panel
							aria-labelledby="accordion-summary-item-0-label"
							data-narration-reveal="item-0"
						>
							{children}
						</section>
					</div>
				)}
			</div>
		</div>
	);
}

function mockAudioProbes(): HTMLAudioElement[] {
	const probes: HTMLAudioElement[] = [];
	vi.stubGlobal(
		"Audio",
		vi.fn(function AudioProbe() {
			const probe = document.createElement("audio");
			probes.push(probe);
			return probe;
		}),
	);
	return probes;
}

async function loadDurations(probes: HTMLAudioElement[], durations: number[]): Promise<void> {
	for (const [index, duration] of durations.entries()) {
		await waitFor(() => expect(probes).toHaveLength(index + 1));
		Object.defineProperty(probes[index], "duration", {
			configurable: true,
			value: duration,
		});
		fireEvent.loadedMetadata(probes[index]);
	}
}

function loadPlayerMetadata(audio: HTMLAudioElement): void {
	Object.defineProperty(audio, "readyState", {
		configurable: true,
		value: HTMLMediaElement.HAVE_METADATA,
	});
	fireEvent.loadedMetadata(audio);
}

function mockThreeItemCues(): ReturnType<typeof vi.fn> {
	const cueText: Record<string, string> = {
		"timings/first.vtt": "First cue",
		"timings/second.vtt": "Second cue",
		"timings/third.vtt": "Third cue",
	};
	const fetchMock = vi.fn(async (src: string) => ({
		ok: true,
		text: async () => `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${cueText[src]}`,
	}));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function renderThreeItemNarration(
	onFollowActiveChange?: (active: boolean) => void,
	eligibleIds?: ReadonlySet<string>,
) {
	return render(
		<div className="praxity-viewer-shell">
			<main id="main-content">
				<p data-block-id="first">First cue</p>
				<p data-block-id="second">Second cue</p>
				<p data-block-id="third">Third cue</p>
			</main>
			<NarrationBar
				items={threeItems}
				strings={strings}
				onFollowActiveChange={onFollowActiveChange}
				eligibleIds={eligibleIds}
			/>
		</div>,
	);
}

async function loadThreeItemCues(fetchMock: ReturnType<typeof vi.fn>): Promise<void> {
	await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	await act(async () => undefined);
}

function clickCue(root: HTMLElement, y: number): void {
	fireEvent.pointerDown(root, { clientX: 50, clientY: y });
	fireEvent.pointerUp(root, { clientX: 50, clientY: y });
}

function mockMediaSession() {
	const handlers = new Map<string, (() => void) | null>();
	const setActionHandler = vi.fn((action: string, handler: (() => void) | null) => {
		handlers.set(action, handler);
	});
	vi.stubGlobal("navigator", { mediaSession: { setActionHandler } });
	return { handlers, setActionHandler };
}

async function renderSentenceNavigation() {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: true,
		text: async () =>
			"WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nFirst sentence.\n\n00:00:04.000 --> 00:00:06.000\nSecond sentence.",
	});
	vi.stubGlobal("fetch", fetchMock);
	render(
		<div className="praxity-viewer-shell">
			<main id="main-content">
				<p data-block-id="body">First sentence. Second sentence.</p>
			</main>
			<NarrationBar
				items={[
					{
						id: "body",
						src: "audio/body.mp3",
						timingsSrc: "timings/body.vtt",
						blockId: "body",
						duration: 10,
					},
				]}
				strings={strings}
			/>
		</div>,
	);
	fireEvent.click(screen.getByRole("button", { name: strings.listen }));
	await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
	await act(async () => undefined);
	const audio = document.querySelector("audio") as HTMLAudioElement;
	Object.defineProperty(audio, "duration", { configurable: true, value: 10 });
	fireEvent.loadedMetadata(audio);
	return audio;
}

describe("NarrationBar", () => {
	beforeEach(() => {
		vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
		vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
		HTMLElement.prototype.scrollIntoView = vi.fn(); // jsdom does not implement it
		Object.defineProperty(Range.prototype, "getBoundingClientRect", {
			configurable: true,
			value: vi.fn(() => ({ top: 200, bottom: 220 })),
		});
		Object.defineProperty(Range.prototype, "getClientRects", {
			configurable: true,
			value: vi.fn(function cueRects(this: Range) {
				const top = this.toString().includes("Second")
					? 100
					: this.toString().includes("Third")
						? 200
						: 0;
				return [{ left: 0, right: 100, top, bottom: top + 20 }] as unknown as DOMRectList;
			}),
		});
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	for (const command of ["button", "controller"] as const) {
		it(`starts the next recorded target on this slide through ${command}`, async () => {
			const playlist = [
				{ id: "unrecorded-opening", src: "", pageId: "slide-one" },
				{ id: "first-recorded", src: "audio/first.mp3", pageId: "slide-one" },
				{ id: "unrecorded-middle", src: "", pageId: "slide-one" },
				{ id: "later-recorded", src: "audio/later.mp3", pageId: "slide-one" },
				{ id: "unrecorded-tail", src: "", pageId: "slide-one" },
				{ id: "next-slide-recorded", src: "audio/next.mp3", pageId: "slide-two" },
			];
			const controller = createRef<NarrationController>();
			const activeId = vi.fn();
			const { container } = render(
				<NarrationBar
					items={playlist}
					strings={strings}
					alwaysExpanded
					controllerRef={controller}
					onActiveSegment={(index) => activeId(playlist[index].id)}
				/>,
			);
			const start = () => {
				if (command === "button") fireEvent.click(screen.getByRole("button", { name: "Play" }));
				else act(() => expect(controller.current?.togglePlayback()).toBe(true));
			};
			start();
			await waitFor(() => expect(activeId).toHaveBeenLastCalledWith("first-recorded"));
			const audio = container.querySelector("audio") as HTMLAudioElement;
			loadPlayerMetadata(audio);
			await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
			expect(container.querySelector("audio")).toHaveAttribute("src", "audio/first.mp3");
			await screen.findByRole("button", { name: "Pause" });
			fireEvent.ended(audio);
			expect(activeId).toHaveBeenLastCalledWith("unrecorded-middle");
			expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
			start();
			await waitFor(() => expect(activeId).toHaveBeenLastCalledWith("later-recorded"));
			expect(container.querySelector("audio")).toHaveAttribute("src", "audio/later.mp3");
			act(() => {
				controller.current?.pause();
				controller.current?.selectSegment(4);
			});
			expect(screen.getByRole("button", { name: strings.noNarration })).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			act(() => expect(controller.current?.togglePlayback()).toBe(false));
			expect(activeId).not.toHaveBeenCalledWith("next-slide-recorded");
		});
	}

	it("keeps the first recorded target behind its selection guard", () => {
		const playlist = [
			{ id: "unrecorded", src: "", pageId: "guarded-slide" },
			{ id: "guarded-recording", src: "audio/guarded.mp3", pageId: "guarded-slide" },
			{ id: "later-recording", src: "audio/later.mp3", pageId: "guarded-slide" },
		];
		const beforeSelect = vi.fn(() => false);
		const activeId = vi.fn();
		render(
			<NarrationBar
				items={playlist}
				strings={strings}
				alwaysExpanded
				beforeSelect={beforeSelect}
				onActiveSegment={(index) => activeId(playlist[index].id)}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Play" }));
		expect(beforeSelect).toHaveBeenCalledWith(1, "play", 0);
		expect(activeId).not.toHaveBeenCalledWith("guarded-recording");
		expect(activeId).not.toHaveBeenCalledWith("later-recording");
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
	});

	it("keeps a slide without recordings unavailable even when another slide has audio", () => {
		const playlist = [
			{ id: "silent-opening", src: "", pageId: "silent-slide" },
			{ id: "silent-body", src: "", pageId: "silent-slide" },
			{ id: "other-recording", src: "audio/other.mp3", pageId: "other-slide" },
		];
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar items={playlist} strings={strings} alwaysExpanded controllerRef={controller} />,
		);
		const unavailable = screen.getByRole("button", { name: strings.noNarration });
		expect(unavailable).toHaveAttribute("aria-disabled", "true");
		fireEvent.click(unavailable);
		act(() => expect(controller.current?.togglePlayback()).toBe(false));
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
	});

	it("shares opening playback state, focus and position with the transport", async () => {
		const mount = document.createElement("div");
		document.body.append(mount);
		const { container, unmount } = render(
			<NarrationBar
				items={[{ id: "missing", src: "" }, ...items]}
				strings={strings}
				alwaysExpanded
				openingControl={{
					mount,
					play: "Play narration",
					pause: "Pause narration",
					firstPlayable: 1,
				}}
			/>,
		);
		const opening = screen.getByRole("button", { name: "Play narration" });
		opening.focus();
		fireEvent.click(opening);
		const audio = container.querySelector("audio");
		assert(audio);
		loadPlayerMetadata(audio);
		await waitFor(() => expect(opening).toHaveTextContent("Pause narration"));
		expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
		expect(opening).toHaveFocus();
		audio.currentTime = 3;
		fireEvent.click(opening);
		expect(opening).toHaveTextContent("Play narration");
		expect(audio.currentTime).toBe(3);
		expect(opening).toHaveFocus();
		fireEvent.click(screen.getByRole("button", { name: "Play" }));
		await waitFor(() => expect(opening).toHaveTextContent("Pause narration"));
		fireEvent.pause(audio);
		expect(opening).toHaveTextContent("Play narration");
		expect(audio.currentTime).toBe(3);
		unmount();
		mount.remove();
	});

	it("keeps authored silence focusable, explains it on hover/focus, and restores Play", async () => {
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar
				items={[
					{ id: "silent", src: "", silent: true },
					{ id: "missing", src: "" },
					{ id: "recorded", src: "audio/recorded.mp3" },
				]}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		const silent = screen.getByRole("button", { name: strings.noNarration });
		expect(silent).toHaveAttribute("aria-disabled", "true");
		expect(silent).not.toBeDisabled();
		act(() => silent.focus());
		expect(silent).toHaveFocus();
		expect(screen.getByRole("tooltip")).toHaveTextContent(strings.noNarration);
		fireEvent.keyDown(silent, { key: "Escape" });
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		fireEvent.mouseEnter(silent);
		expect(screen.getByRole("tooltip")).toHaveTextContent(strings.noNarration);
		fireEvent.click(silent);
		expect(controller.current?.togglePlayback()).toBe(false);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		act(() => {
			controller.current?.selectSegment(1);
		});
		expect(screen.getByRole("button", { name: strings.play })).not.toHaveAttribute("aria-disabled");
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		act(() => {
			controller.current?.selectSegment(2);
		});
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
	});

	it("keeps a paused seek position through native clock settling, then follows playback", async () => {
		render(
			<NarrationBar
				items={[{ id: "body", src: "audio/body.mp3", duration: 8 }]}
				strings={strings}
				alwaysExpanded
			/>,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		Object.defineProperty(audio, "duration", { configurable: true, value: 8 });
		loadPlayerMetadata(audio);
		const slider = screen.getByRole("slider", { name: strings.seek });
		fireEvent.change(slider, { target: { value: "0.79942168" } });
		expect(slider).toHaveValue("0.79942168");
		// Native decoders may settle a paused seek at a slightly different media time.
		audio.currentTime = 0.8094216;
		fireEvent.timeUpdate(audio);
		expect(slider).toHaveValue("0.79942168");
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		audio.currentTime = 0.9;
		fireEvent.timeUpdate(audio);
		expect(slider).toHaveValue("0.9");
	});

	it("gates controller, timeline, sentence, MediaSession and automatic deck selection", async () => {
		const controller = createRef<NarrationController>();
		const beforeSelect = vi.fn((index: number) => index === 0);
		const onActiveSegment = vi.fn();
		const { handlers } = mockMediaSession();
		render(
			<NarrationBar
				items={recordedItems}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
				beforeSelect={beforeSelect}
				onActiveSegment={onActiveSegment}
			/>,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		expect(screen.queryByRole("button", { name: strings.listen })).not.toBeInTheDocument();
		act(() => expect(controller.current?.selectSegment(1)).toBe(false));
		fireEvent.change(screen.getByRole("slider"), { target: { value: 1 } });
		fireEvent.click(screen.getByRole("button", { name: strings.nextSentence }));
		act(() => handlers.get("nexttrack")?.());
		expect(beforeSelect).toHaveBeenCalledWith(1, "select", 0);
		expect(beforeSelect).toHaveBeenCalledWith(1, "seek", 0);
		expect(onActiveSegment).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.ended(audio);
		expect(beforeSelect).toHaveBeenCalledWith(1, "advance", 0);
		expect(audio.getAttribute("src")).toBe(recordedItems[0].src);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
	});

	it("keeps the mounted deck audio and playback intent across selections and missing audio", async () => {
		const controller = createRef<NarrationController>();
		const playlist = [
			recordedItems[0],
			recordedItems[1],
			{ id: "missing", src: "" },
			recordedItems[2],
		];
		render(
			<NarrationBar items={playlist} strings={strings} alwaysExpanded controllerRef={controller} />,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		act(() => {
			controller.current?.selectSegment(1);
		});
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		act(() => {
			controller.current?.selectSegment(0);
		});
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
		expect(document.querySelector("audio")).toBe(audio);
		act(() => {
			controller.current?.selectSegment(2);
		});
		expect(audio).not.toHaveAttribute("src");
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
	});

	it("keeps an authored deck stop current and resumes only the permitted next item", async () => {
		const beforeSelect = vi.fn(() => true);
		render(
			<NarrationBar
				items={[{ ...recordedItems[0], pauseAfter: true }, recordedItems[1]]}
				strings={strings}
				alwaysExpanded
				beforeSelect={beforeSelect}
			/>,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.ended(audio);
		expect(audio.getAttribute("src")).toBe(recordedItems[0].src);
		beforeSelect.mockReturnValue(false);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(audio.getAttribute("src")).toBe(recordedItems[0].src);
		beforeSelect.mockReturnValue(true);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		expect(audio.getAttribute("src")).toBe(recordedItems[1].src);
		expect(beforeSelect).toHaveBeenCalledWith(1, "play", 0);
		fireEvent.ended(audio);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
	});

	it("replays a terminal authored stop only after an allowed Play request", async () => {
		const beforeSelect = vi.fn(() => true);
		render(
			<NarrationBar
				items={[{ ...recordedItems[0], pauseAfter: true }]}
				strings={strings}
				alwaysExpanded
				beforeSelect={beforeSelect}
			/>,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		audio.currentTime = recordedItems[0].duration ?? 0;
		fireEvent.ended(audio);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
		beforeSelect.mockReturnValue(false);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
		beforeSelect.mockReturnValue(true);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		expect(beforeSelect).toHaveBeenLastCalledWith(0, "play", 0);
		expect(audio.currentTime).toBe(0);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
	});

	it("keeps narration playing when the page scrolls, then pauses on deliberate navigation", async () => {
		const onFollowSuspendedChange = vi.fn();
		const { container } = render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<p data-block-id="passage">Spoken passage</p>
				</main>
				<NarrationBar
					items={[{ ...recordedItems[0], blockId: "passage" }]}
					strings={strings}
					alwaysExpanded
					onFollowSuspendedChange={onFollowSuspendedChange}
				/>
			</div>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.narrationOptions }));
		const follow = screen.getByRole("button", { name: strings.followNarration });
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		await act(async () => {
			await new Promise(requestAnimationFrame);
		});
		const main = container.querySelector("main") as HTMLElement;
		fireEvent.scroll(main);
		expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
		fireEvent.wheel(main, { deltaY: 100 });
		fireEvent.scroll(main);
		expect(follow).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
		expect(onFollowSuspendedChange).toHaveBeenLastCalledWith(true);
		fireEvent(main, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		expect(follow).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
	});

	it.each(["main", ".deck-workspace"])(
		"keeps narration playing while scrolling slide content in %s",
		async (selector) => {
			const workspace = document.createElement("div");
			workspace.className = "deck-workspace";
			workspace.innerHTML =
				'<main id="main-content"><div id="deck-slides"><p>Slide content</p><svg><path d="M0 0L1 1" /></svg></div></main><aside>Transcript</aside><div id="unrelated">Other controls</div>';
			document.body.append(workspace);
			const mediaRoot = workspace.querySelector<HTMLElement>("#deck-slides") as HTMLElement;
			const transcript = workspace.querySelector<HTMLElement>("aside") as HTMLElement;
			const unrelated = workspace.querySelector<HTMLElement>("#unrelated") as HTMLElement;
			const scrollport =
				selector === "main"
					? (workspace.querySelector<HTMLElement>("main") as HTMLElement)
					: workspace;
			const onFollowSuspendedChange = vi.fn();
			const { unmount } = render(
				<NarrationBar
					items={recordedItems}
					strings={strings}
					alwaysExpanded
					contentRoot={transcript}
					scrollContainer={transcript}
					mediaRoot={mediaRoot}
					onFollowSuspendedChange={onFollowSuspendedChange}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await screen.findByRole("button", { name: strings.pause });
			fireEvent.scroll(scrollport);
			expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
			fireEvent.wheel(unrelated, { deltaY: 100 });
			fireEvent.scroll(scrollport);
			expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
			const path = mediaRoot.querySelector("path");
			assert(path);
			fireEvent.wheel(path, { deltaY: 100 });
			fireEvent.scroll(unrelated);
			expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
			fireEvent.scroll(scrollport);
			expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
			expect(onFollowSuspendedChange).toHaveBeenLastCalledWith(true);
			expect(screen.getByRole("button", { name: strings.followNarration })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			fireEvent(
				mediaRoot,
				new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }),
			);
			expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await screen.findByRole("button", { name: strings.pause });
			fireEvent.scroll(scrollport);
			expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
			unmount();
			workspace.remove();
		},
	);

	it("follows untimed deck passages only inside the supplied transcript scroll container", async () => {
		const controller = createRef<NarrationController>();
		const transcript = document.createElement("aside");
		transcript.innerHTML = '<p data-block-id="passage">Untimed passage</p>';
		document.body.append(transcript);
		const passage = transcript.firstElementChild as HTMLElement;
		Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 100 });
		vi.spyOn(transcript, "getBoundingClientRect").mockReturnValue({
			top: 0,
			height: 100,
		} as DOMRect);
		vi.spyOn(passage, "getBoundingClientRect").mockReturnValue({
			top: 200,
			bottom: 220,
			height: 20,
		} as DOMRect);
		transcript.scrollBy = vi.fn();
		const onFollowChange = vi.fn();
		const onFollowSuspendedChange = vi.fn();
		render(
			<NarrationBar
				items={[{ ...recordedItems[0], blockId: "passage" }]}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
				contentRoot={transcript}
				scrollContainer={transcript}
				onFollowChange={onFollowChange}
				onFollowSuspendedChange={onFollowSuspendedChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		expect(transcript.scrollBy).toHaveBeenCalledWith({ top: 200 - 100 / 3, behavior: "auto" });
		expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
		expect(passage.dataset.narrationActive).toBe("true");
		await act(async () => {
			await new Promise(requestAnimationFrame);
		});
		document.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
		fireEvent.keyDown(transcript, { key: " " });
		await act(async () => {
			await Promise.resolve();
		});
		expect(onFollowChange).toHaveBeenLastCalledWith(true);
		// A delayed programmatic scroll must not look like manual scrolling.
		fireEvent.scroll(transcript);
		expect(onFollowChange).toHaveBeenLastCalledWith(true);
		fireEvent.pointerDown(transcript);
		expect(onFollowSuspendedChange).toHaveBeenLastCalledWith(false);
		fireEvent.pointerUp(transcript);
		fireEvent.wheel(transcript, { deltaY: 100 });
		expect(onFollowSuspendedChange).toHaveBeenLastCalledWith(false);
		transcript.scrollTop = 100;
		fireEvent.scroll(transcript);
		expect(onFollowSuspendedChange).toHaveBeenLastCalledWith(true);
		expect(onFollowChange).toHaveBeenLastCalledWith(true);
		expect(passage.dataset.narrationActive).toBeUndefined();
		act(() => controller.current?.setFollow(true));
		expect(onFollowChange).toHaveBeenLastCalledWith(true);
		transcript.tabIndex = 0;
		act(() => transcript.focus());
		expect(onFollowChange).toHaveBeenLastCalledWith(true);
		expect(passage.dataset.narrationActive).toBeUndefined();
		expect(document.activeElement).toBe(transcript);
		act(() => controller.current?.setFollow(true));
		const range = document.createRange();
		range.selectNodeContents(passage);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		fireEvent(document, new Event("selectionchange"));
		expect(onFollowChange).toHaveBeenLastCalledWith(true);
		expect(passage.dataset.narrationActive).toBeUndefined();
		expect(window.getSelection()?.toString()).toBe("Untimed passage");
		window.getSelection()?.removeAllRanges();
		vi.mocked(passage.getBoundingClientRect).mockReturnValue({
			top: 200,
			bottom: 500,
			height: 300,
		} as DOMRect);
		act(() => controller.current?.setFollow(true));
		expect(transcript.scrollBy).toHaveBeenLastCalledWith({ top: 200 - 100 / 3, behavior: "auto" });
		fireEvent.wheel(transcript, { deltaY: 100 });
		transcript.scrollTop = 200;
		fireEvent.scroll(transcript);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		const audio = document.querySelector("audio") as HTMLAudioElement;
		const time = audio.currentTime;
		const plays = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
		vi.mocked(transcript.scrollBy).mockClear();
		act(() => controller.current?.resumeFollow());
		expect(onFollowSuspendedChange).toHaveBeenLastCalledWith(false);
		expect(transcript.scrollBy).toHaveBeenCalledOnce();
		expect(audio.currentTime).toBe(time);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		transcript.remove();
	});

	it.each([
		{ top: 220, height: 240, delta: 60, description: "tall but able to fit the viewport" },
		{ top: 150, height: 20, delta: 0, description: "inside the safe band" },
		{ top: 330, height: 20, delta: 130, description: "visible below the safe band" },
		{ top: 390, height: 20, delta: 190, description: "partially visible at the bottom" },
		{ top: 90, height: 20, delta: -110, description: "partially visible at the top" },
		{ top: 150, height: 400, delta: 0, description: "oversized with its start in the band" },
		{ top: 380, height: 400, delta: 180, description: "oversized with its start below the band" },
	])("follows transcript text $description", async ({ top, height, delta }) => {
		const transcript = document.createElement("aside");
		transcript.innerHTML = '<p data-block-id="passage">Spoken passage</p>';
		document.body.append(transcript);
		Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 300 });
		vi.spyOn(transcript, "getBoundingClientRect").mockReturnValue({
			top: 100,
			height: 300,
		} as DOMRect);
		const scrollBy = vi.fn();
		transcript.scrollBy = scrollBy;
		// Keep the paragraph visible; it is the timed range that must drive scrolling.
		vi.spyOn(transcript.firstElementChild as HTMLElement, "getBoundingClientRect").mockReturnValue({
			top: 150,
			bottom: 170,
			height: 20,
		} as DOMRect);
		vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({
			top,
			bottom: top + height,
			height,
		} as DOMRect);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nSpoken passage",
			})),
		);
		render(
			<NarrationBar
				items={[{ ...recordedItems[0], blockId: "passage", timingsSrc: "passage.vtt" }]}
				strings={strings}
				alwaysExpanded
				contentRoot={transcript}
				scrollContainer={transcript}
			/>,
		);
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		if (delta)
			await waitFor(() =>
				expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: delta, behavior: "auto" }),
			);
		else expect(scrollBy).not.toHaveBeenCalled();
		const audio = document.querySelector("audio") as HTMLAudioElement;
		scrollBy.mockClear();
		audio.currentTime = 0.5;
		fireEvent.timeUpdate(audio);
		expect(scrollBy).not.toHaveBeenCalled();
		expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
		transcript.remove();
	});

	it.each([true, false])(
		"preserves follow preference %s when seeking from a focused transcript control",
		async (following) => {
			const controller = createRef<NarrationController>();
			const transcript = document.createElement("aside");
			transcript.innerHTML =
				'<p data-block-id="first">First slide</p><p data-block-id="second">Second slide</p><button>Go here</button>';
			document.body.append(transcript);
			const target = transcript.querySelector<HTMLElement>('[data-block-id="second"]');
			const seek = transcript.querySelector("button");
			if (!target || !seek) throw new Error("Expected transcript controls");
			Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 100 });
			vi.spyOn(transcript, "getBoundingClientRect").mockReturnValue({
				top: 0,
				height: 100,
			} as DOMRect);
			vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
				top: 200,
				bottom: 220,
				height: 20,
			} as DOMRect);
			transcript.scrollBy = vi.fn();
			const onFollowChange = vi.fn();
			const beforeSelect = vi.fn(() => true);
			render(
				<NarrationBar
					items={recordedItems.map((item, index) => ({
						...item,
						blockId: index === 0 ? "first" : "second",
					}))}
					strings={strings}
					alwaysExpanded
					controllerRef={controller}
					contentRoot={transcript}
					scrollContainer={transcript}
					onFollowChange={onFollowChange}
					beforeSelect={beforeSelect}
				/>,
			);
			const follow = screen.getByRole("button", { name: strings.followNarration });
			if (!following) fireEvent.click(follow);
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await screen.findByRole("button", { name: strings.pause });
			act(() => seek.focus());
			fireEvent.wheel(transcript, { deltaY: 100 });
			expect(follow).toHaveAttribute("aria-pressed", String(following));
			vi.mocked(transcript.scrollBy).mockClear();
			seek.addEventListener("click", () => controller.current?.selectSegment(1));
			fireEvent.click(seek);
			const audio = document.querySelector("audio") as HTMLAudioElement;
			await waitFor(() => expect(audio).toHaveAttribute("src", recordedItems[1].src));
			loadPlayerMetadata(audio);
			expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
			expect(beforeSelect).toHaveBeenLastCalledWith(1, "select", 0);
			expect(onFollowChange).toHaveBeenLastCalledWith(following);
			expect(follow).toHaveAttribute("aria-pressed", String(following));
			expect(document.activeElement).toBe(seek);
			if (following) {
				expect(target.dataset.narrationActive).toBe("true");
				expect(transcript.scrollBy).toHaveBeenCalledWith({ top: 200 - 100 / 3, behavior: "auto" });
			} else {
				expect(target.dataset.narrationActive).toBeUndefined();
				expect(transcript.scrollBy).not.toHaveBeenCalled();
			}
			transcript.remove();
		},
	);

	it("coordinates slide media separately from the transcript root", async () => {
		const mediaRoot = document.createElement("main");
		const video = document.createElement("video");
		Object.defineProperty(video, "paused", { configurable: true, value: false });
		const pauseVideo = vi.fn();
		video.pause = pauseVideo;
		mediaRoot.append(video);
		render(
			<NarrationBar
				items={recordedItems}
				strings={strings}
				alwaysExpanded
				mediaRoot={mediaRoot}
				contentRoot={document.createElement("aside")}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		expect(pauseVideo).toHaveBeenCalledOnce();
		fireEvent.play(video);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
	});

	it("marks only the playing dialogue turn on the slide while audio plays", async () => {
		const slides = document.createElement("div");
		slides.innerHTML =
			'<div data-block-id="d1"><ol><li data-turn-index="0">Hi.</li><li data-turn-index="2">Hello.</li></ol></div>';
		const transcript = document.createElement("div");
		transcript.innerHTML =
			'<div data-block-id="p:d1:item:0">Hi.</div><div data-block-id="p:d1:item:2">Hello.</div>';
		document.body.append(slides, transcript);
		const dialogueItems = [
			{
				id: "p:d1:item:0",
				src: "a.mp3",
				blockId: "p:d1:item:0",
				sourceBlockId: "d1",
				turnIndex: 0,
			},
			{
				id: "p:d1:item:2",
				src: "b.mp3",
				blockId: "p:d1:item:2",
				sourceBlockId: "d1",
				turnIndex: 2,
			},
		];
		const [first, second] = slides.querySelectorAll("li");
		try {
			render(
				<NarrationBar
					items={dialogueItems}
					strings={strings}
					alwaysExpanded
					mediaRoot={slides}
					contentRoot={transcript}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await waitFor(() => expect(first).toHaveAttribute("aria-current", "true"));
			fireEvent.ended(document.querySelector("audio") as HTMLAudioElement);
			await waitFor(() => expect(second).toHaveAttribute("aria-current", "true"));
			expect(first).not.toHaveAttribute("aria-current");
			fireEvent.click(screen.getByRole("button", { name: strings.pause }));
			await waitFor(() => expect(second).not.toHaveAttribute("aria-current"));
			expect(document.activeElement).not.toBe(second);
		} finally {
			slides.remove();
			transcript.remove();
		}
	});

	it("reveals nested native details for an untimed dialogue without moving transport focus", async () => {
		const onReveal = vi.fn();
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<details>
						<summary>Outer</summary>
						<details data-narration-reveal="item-0">
							<summary>Closed</summary>
							<div data-narration-reveal="item-0">
								<div data-block-id="d1">
									<ol>
										<li data-turn-index="0">Hi.</li>
									</ol>
								</div>
							</div>
						</details>
					</details>
				</main>
				<NarrationBar
					items={[{ id: "d1:item:0", src: "a.mp3", blockId: "d1", turnIndex: 0 }]}
					strings={strings}
				/>
			</div>,
		);
		const target = document.querySelector("details > div[data-narration-reveal]");
		if (!target) throw new Error("Missing reveal target");
		target.addEventListener("praxity:narration-reveal", onReveal);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		const play = screen.getByRole("button", { name: strings.play });
		play.focus();
		fireEvent.click(play);
		await waitFor(() => expect(onReveal).toHaveBeenCalledOnce());
		for (const details of document.querySelectorAll("details")) expect(details.open).toBe(true);
		expect(play).toHaveFocus();
	});

	it.each([
		["native", true],
		["native", false],
		["custom", true],
		["custom", false],
	] as const)(
		"reveals untimed conditional text in a closed %s accordion with Follow %s",
		async (markup, following) => {
			const controller = createRef<NarrationController>();
			const playlist = [{ id: "conditional", blockId: "conditional", src: "uploaded.mp3" }];
			const { container } = render(
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<NarrationAccordion markup={markup}>
							<p data-block-id="conditional">Visible conditional words.</p>
						</NarrationAccordion>
					</main>
					<NarrationBar
						items={playlist}
						eligibleIds={new Set(["conditional"])}
						strings={strings}
						controllerRef={controller}
					/>
				</div>,
			);
			vi.resetModules();
			await import("../../../../export-pipeline/template/src/islands/island-accordion");
			const accordion = container.querySelector("details");
			const trigger = container.querySelector("#accordion-summary-item-0");
			const panel = container.querySelector<HTMLElement>("[data-disclosure-panel]");
			const expectExpanded = (expanded: boolean) => {
				if (markup === "native") {
					assert(accordion);
					expect(accordion.open).toBe(expanded);
				} else {
					expect(trigger).toHaveAttribute("aria-expanded", String(expanded));
					expect(panel?.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", String(!expanded));
				}
			};
			expectExpanded(false);
			act(() => controller.current?.setFollow(following));
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			expectExpanded(false);
			const play = screen.getByRole("button", { name: strings.play });
			play.focus();
			// Pause renders before the Follow effect opens its panel. Flush the play
			// promise and effects instead of relying on waitFor's incidental timer drain.
			await act(async () => {
				fireEvent.click(play);
			});
			expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
			expectExpanded(following);
			expect(play).toHaveFocus();
			expect(container.querySelector("[data-block-id=conditional]")).not.toHaveAttribute("hidden");
		},
	);

	it.each(["native", "custom"] as const)(
		"does not reopen a concealed dialogue's %s accordion when Follow resumes",
		async (markup) => {
			const controller = createRef<NarrationController>();
			const playlist = [{ id: "d1:item:0", blockId: "d1", turnIndex: 0, src: "dialogue.mp3" }];
			const view = (eligibleIds: ReadonlySet<string>) => (
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<NarrationAccordion markup={markup}>
							<div data-block-id="d1" hidden={!eligibleIds.has("d1:item:0")}>
								<p data-turn-index="0">Obsolete words.</p>
							</div>
						</NarrationAccordion>
					</main>
					<NarrationBar
						items={playlist}
						eligibleIds={eligibleIds}
						strings={strings}
						controllerRef={controller}
					/>
				</div>
			);
			const { container, rerender } = render(view(new Set(["d1:item:0"])));
			vi.resetModules();
			await import("../../../../export-pipeline/template/src/islands/island-accordion");
			const accordion = container.querySelector("details");
			const trigger = container.querySelector<HTMLButtonElement>("#accordion-summary-item-0");
			const panel = container.querySelector<HTMLElement>("[data-disclosure-panel]");
			const expectExpanded = (expanded: boolean) => {
				if (markup === "native") {
					assert(accordion);
					expect(accordion.open).toBe(expanded);
				} else {
					expect(trigger).toHaveAttribute("aria-expanded", String(expanded));
					expect(panel?.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", String(!expanded));
				}
			};
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await waitFor(() => expectExpanded(true));
			rerender(view(new Set()));
			await waitFor(() =>
				expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument(),
			);
			if (accordion) accordion.open = false;
			else {
				assert(trigger);
				fireEvent.click(trigger);
			}
			const play = screen.getByRole("button", { name: strings.play });
			play.focus();
			const onReveal = vi.fn();
			container
				.querySelector("[data-island=accordion]")
				?.addEventListener("praxity:narration-reveal", onReveal);
			act(() => controller.current?.setFollow(false));
			act(() => controller.current?.setFollow(true));
			expectExpanded(false);
			expect(onReveal).not.toHaveBeenCalled();
			expect(container.querySelector("[data-block-id=d1]")).toHaveAttribute("hidden");
			expect(play).toHaveFocus();
			expect(container.querySelector("[data-narration-active]")).toBeNull();
			expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		},
	);

	it("reports rejected playback and media errors, but ignores stale play failures", async () => {
		const onPlaybackError = vi.fn();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
			new Error("Playback unavailable"),
		);
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar
				items={recordedItems}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
				onPlaybackError={onPlaybackError}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(onPlaybackError).toHaveBeenCalledOnce());
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		const audio = document.querySelector("audio") as HTMLAudioElement;
		fireEvent.error(audio);
		expect(onPlaybackError).toHaveBeenCalledTimes(2);
		let rejectPlay: (reason: Error) => void = () => undefined;
		vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectPlay = reject;
				}),
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		act(() => {
			controller.current?.selectSegment(1);
		});
		await act(async () => {
			rejectPlay(new Error("Previous request cancelled"));
		});
		expect(onPlaybackError).toHaveBeenCalledTimes(2);
	});

	it("resets the secondary disclosure when narration closes", () => {
		render(<NarrationBar items={items} strings={strings} />);
		const listen = screen.getByRole("button", { name: strings.listen });
		fireEvent.click(listen);
		const options = screen.getByRole("button", { name: strings.narrationOptions });
		expect(options).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(options);
		expect(options).toHaveAttribute("aria-expanded", "true");
		expect(document.getElementById(options.getAttribute("aria-controls") ?? "")).toContainElement(
			screen.getByRole("button", { name: strings.nextSentence }),
		);
		fireEvent.click(listen);
		fireEvent.click(listen);
		expect(screen.getByRole("button", { name: strings.narrationOptions })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});

	it("starts collapsed and never autoplays", () => {
		const { container } = render(<NarrationBar items={items} strings={strings} />);
		const disclosure = screen.getByRole("button", { name: strings.listen });
		expect(disclosure).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("region", { name: strings.narrationLabel })).not.toBeInTheDocument();
		expect(container.querySelectorAll(".praxity-narration-controls button, input")).toHaveLength(0);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

		fireEvent.click(disclosure);
		expect(disclosure).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("region", { name: strings.narrationLabel })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: strings.previousSentence })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: strings.nextSentence })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: strings.play }).querySelector("svg")).not.toBeNull();
		expect(
			screen.getByRole("button", { name: strings.previousSentence }).querySelector("svg"),
		).not.toBeNull();
		expect(document.querySelector("audio")).not.toHaveAttribute("autoplay");
	});

	it("preloads the first source before the controls are disclosed", () => {
		const { container } = render(<NarrationBar items={recordedItems} strings={strings} />);

		expect(container.querySelector(".praxity-narration-controls")).toBeNull();
		expect(container.querySelector("audio")).toHaveAttribute("src", "audio/page-title.mp3");
		expect(container.querySelector("audio")).toHaveAttribute("preload", "metadata");
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
	});

	it("loads only the active deck cues and queues unknown metadata after load", async () => {
		const probes = mockAudioProbes();
		const fetchMock = mockThreeItemCues();
		const idle = vi.fn((callback: IdleRequestCallback) => {
			callback({ didTimeout: false, timeRemaining: () => 50 });
			return 1;
		});
		vi.stubGlobal("requestIdleCallback", idle);
		vi.stubGlobal("cancelIdleCallback", vi.fn());
		const { unmount } = render(
			<NarrationBar
				items={threeItems}
				strings={strings}
				alwaysExpanded
				showSentenceControls={false}
			/>,
		);
		fireEvent.load(window);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(fetchMock.mock.calls[0][0]).toBe("timings/first.vtt");
		await waitFor(() => expect(probes).toHaveLength(1));
		expect(probes[0]).toHaveAttribute("src", "audio/first.mp3");
		expect(document.querySelector("audio[data-narration-player]")).toHaveAttribute(
			"src",
			"audio/first.mp3",
		);
		Object.defineProperty(probes[0], "duration", { configurable: true, value: 20 });
		fireEvent.loadedMetadata(probes[0]);
		expect(probes).toHaveLength(2);
		expect(probes[1]).toHaveAttribute("src", "audio/second.mp3");
		unmount();
		fireEvent.loadedMetadata(probes[1]);
		expect(probes).toHaveLength(2);
	});

	it("retains the full duration when navigation changes the player before metadata", async () => {
		const probes = mockAudioProbes();
		let begin: IdleRequestCallback = () => undefined;
		vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
			begin = callback;
			return 1;
		});
		vi.stubGlobal("cancelIdleCallback", vi.fn());
		const controller = createRef<NarrationController>();
		const { unmount } = render(
			<NarrationBar items={items} strings={strings} alwaysExpanded controllerRef={controller} />,
		);
		fireEvent.load(window);
		act(() => controller.current?.selectSegment(1));
		act(() => begin({ didTimeout: false, timeRemaining: () => 50 }));
		expect(probes[0]).toHaveAttribute("src", "audio/title.mp3");
		await loadDurations(probes, [10, 20]);
		expect(screen.getByText("0:10 / 0:30")).toBeInTheDocument();
		unmount();
	});

	it("continues the metadata queue when a clip never responds", () => {
		vi.useFakeTimers();
		try {
			const probes = mockAudioProbes();
			vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
				callback({ didTimeout: false, timeRemaining: () => 50 });
				return 1;
			});
			vi.stubGlobal("cancelIdleCallback", vi.fn());
			const { unmount } = render(<NarrationBar items={items} strings={strings} />);
			fireEvent.load(window);
			expect(probes).toHaveLength(1);
			act(() => vi.advanceTimersByTime(10000));
			expect(probes).toHaveLength(2);
			unmount();
		} finally {
			vi.useRealTimers();
		}
	});

	it("maps nexttrack to the next-sentence button position", async () => {
		const mediaSession = mockMediaSession();
		const audio = await renderSentenceNavigation();
		expect(mediaSession.handlers.get("nexttrack")).toEqual(expect.any(Function));

		act(() => mediaSession.handlers.get("nexttrack")?.());
		const mediaKeyPosition = audio.currentTime;
		fireEvent.change(screen.getByRole("slider", { name: strings.seek }), {
			target: { value: "0" },
		});
		fireEvent.click(screen.getByRole("button", { name: strings.nextSentence }));

		expect(mediaKeyPosition).toBe(4);
		expect(audio.currentTime).toBe(mediaKeyPosition);
		act(() => mediaSession.handlers.get("nexttrack")?.());
		expect(audio.currentTime).toBe(10);
	});

	it("maps previoustrack to the previous-sentence button position", async () => {
		const mediaSession = mockMediaSession();
		const audio = await renderSentenceNavigation();
		expect(mediaSession.handlers.get("previoustrack")).toEqual(expect.any(Function));

		fireEvent.change(screen.getByRole("slider", { name: strings.seek }), {
			target: { value: "5" },
		});
		act(() => mediaSession.handlers.get("previoustrack")?.());
		const mediaKeyPosition = audio.currentTime;
		fireEvent.change(screen.getByRole("slider", { name: strings.seek }), {
			target: { value: "5" },
		});
		fireEvent.click(screen.getByRole("button", { name: strings.previousSentence }));

		expect(mediaKeyPosition).toBe(4);
		expect(audio.currentTime).toBe(mediaKeyPosition);
		act(() => mediaSession.handlers.get("previoustrack")?.());
		expect(audio.currentTime).toBe(0);
	});

	it("registers media handlers only while active and clears them on unmount", () => {
		const mediaSession = mockMediaSession();
		const { unmount } = render(<NarrationBar items={recordedItems} strings={strings} />);
		expect(mediaSession.setActionHandler).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		for (const action of ["previoustrack", "nexttrack", "play", "pause"]) {
			expect(mediaSession.handlers.get(action)).toEqual(expect.any(Function));
		}
		unmount();

		for (const action of ["previoustrack", "nexttrack", "play", "pause"]) {
			expect(mediaSession.handlers.get(action)).toBeNull();
		}
	});

	it("does not require the Media Session API", () => {
		vi.stubGlobal("navigator", {});
		const { unmount } = render(<NarrationBar items={recordedItems} strings={strings} />);

		expect(() =>
			fireEvent.click(screen.getByRole("button", { name: strings.listen })),
		).not.toThrow();
		expect(unmount).not.toThrow();
	});

	it("plays a playlist and stops at the page end", async () => {
		const onEnded = vi.fn();
		render(<NarrationBar items={items} strings={strings} onEnded={onEnded} />);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(await screen.findByRole("button", { name: strings.pause })).toBeInTheDocument();

		const audio = document.querySelector("audio") as HTMLAudioElement;
		fireEvent.ended(audio);
		expect(audio).toHaveAttribute("src", "audio/body.mp3");
		loadPlayerMetadata(audio);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
		fireEvent.ended(audio);
		expect(onEnded).toHaveBeenCalledOnce();
	});

	it("keeps the verified total stable when playback metadata arrives later", async () => {
		const probes = mockAudioProbes();
		render(<NarrationBar items={recordedItems} strings={strings} />);

		expect(probes).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		expect(screen.getByText(strings.durationLoading)).toBeInTheDocument();
		await loadDurations(probes, [2, 3, 11, 7]);
		expect(screen.getByText("0:00 / 0:23")).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: strings.seek })).toBeEnabled();

		const audio = document.querySelector("audio") as HTMLAudioElement;
		Object.defineProperty(audio, "duration", { configurable: true, value: 20.472 });
		fireEvent.loadedMetadata(audio);
		expect(screen.getByText("0:00 / 0:23")).toBeInTheDocument();

		for (const src of ["audio/heading.mp3", "audio/text.mp3", "audio/note.mp3"]) {
			fireEvent.ended(audio);
			await waitFor(() => expect(audio).toHaveAttribute("src", src));
			loadPlayerMetadata(audio);
		}
		audio.currentTime = 7;
		fireEvent.timeUpdate(audio);

		expect(screen.getByText("0:23 / 0:23")).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: strings.seek })).toHaveAttribute(
			"aria-valuetext",
			"0:23 / 0:23",
		);
	});

	it("loads desktop asset audio as a data URL", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(new Uint8Array([73, 68, 51]), {
				headers: { "Content-Type": "audio/mpeg" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		render(
			<NarrationBar
				items={[
					{
						id: "desktop-audio",
						src: "praxity-asset://assets/narration/desktop.mp3",
						duration: 1,
					},
				]}
				strings={strings}
			/>,
		);

		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "data:audio/mpeg;base64,SUQz"),
		);
		expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
			"praxity-asset://assets/narration/desktop.mp3",
		);
	});

	it("probes missing and invalid durations without producing a NaN total", async () => {
		const probes = mockAudioProbes();
		render(
			<NarrationBar
				items={[
					{ id: "missing", src: "audio/missing.mp3" },
					{ id: "zero", src: "audio/zero.mp3", duration: 0 },
					{ id: "negative", src: "audio/negative.mp3", duration: -1 },
					{ id: "infinite", src: "audio/infinite.mp3", duration: Number.POSITIVE_INFINITY },
					{ id: "nan", src: "audio/nan.mp3", duration: Number.NaN },
				]}
				strings={strings}
			/>,
		);

		expect(probes).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		expect(screen.getByText(strings.durationLoading)).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: strings.seek })).toBeDisabled();
		expect(screen.getByRole("slider", { name: strings.seek })).toHaveAttribute(
			"aria-valuetext",
			strings.durationLoading,
		);

		for (const [index, duration] of [1, 2, 3, 4, 5].entries()) {
			await waitFor(() => expect(probes).toHaveLength(index + 1));
			Object.defineProperty(probes[index], "duration", { configurable: true, value: duration });
			fireEvent.loadedMetadata(probes[index]);
			if (index < 4) {
				expect(screen.getByText(strings.durationLoading)).toBeInTheDocument();
				expect(screen.getByRole("slider", { name: strings.seek })).toBeDisabled();
			}
		}
		expect(probes).toHaveLength(5);
		expect(screen.getByText("0:00 / 0:15")).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: strings.seek })).toBeEnabled();
	});

	it("excludes stale duration metadata from a silent reading segment", async () => {
		const probes = mockAudioProbes();
		render(
			<NarrationBar
				items={[
					{ id: "reading-only", src: "", silent: true, duration: 120 },
					{ id: "recording", src: "audio/recording.mp3", duration: 1 },
				]}
				strings={strings}
				alwaysExpanded
			/>,
		);
		expect(screen.getByText(strings.durationLoading)).toBeInTheDocument();
		await loadDurations(probes, [2]);
		expect(screen.getByText("0:00 / 0:02")).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: strings.seek })).toHaveAttribute("max", "2");
	});

	it("keeps follow active while a playing cue click changes segments", async () => {
		const onFollowActiveChange = vi.fn();
		const fetchMock = mockThreeItemCues();
		renderThreeItemNarration(onFollowActiveChange);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		await waitFor(() => expect(onFollowActiveChange).toHaveBeenLastCalledWith(true));
		onFollowActiveChange.mockClear();

		const root = document.querySelector("#main-content") as HTMLElement;
		const audio = document.querySelector("audio") as HTMLAudioElement;
		clickCue(root, 110);

		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/second.mp3"));
		await screen.findByRole("button", { name: strings.pause });
		expect(onFollowActiveChange).not.toHaveBeenCalledWith(false);
	});

	it("keeps follow active during natural segment advance", async () => {
		const onFollowActiveChange = vi.fn();
		render(
			<NarrationBar items={items} strings={strings} onFollowActiveChange={onFollowActiveChange} />,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		// The transport can render before its startup effect notifies the host.
		await waitFor(() => expect(onFollowActiveChange).toHaveBeenLastCalledWith(true));
		onFollowActiveChange.mockClear();

		const audio = document.querySelector("audio") as HTMLAudioElement;
		fireEvent.ended(audio);

		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/body.mp3"));
		loadPlayerMetadata(audio);
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
		await screen.findByRole("button", { name: strings.pause });
		expect(onFollowActiveChange).not.toHaveBeenCalledWith(false);
	});

	it("selects the second item directly when its first cue is clicked", async () => {
		const probes = mockAudioProbes();
		const fetchMock = mockThreeItemCues();
		renderThreeItemNarration();
		await loadDurations(probes, [10, 0, 30]);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);

		const root = document.querySelector("#main-content") as HTMLElement;
		const audio = document.querySelector("audio") as HTMLAudioElement;
		clickCue(root, 110);

		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/second.mp3"));
		expect(audio).not.toHaveAttribute("src", "audio/first.mp3");
		expect(audio.currentTime).toBe(0);
	});

	it("selects a clicked cue while probe durations are still zero", async () => {
		mockAudioProbes();
		const fetchMock = mockThreeItemCues();
		renderThreeItemNarration();
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);

		const root = document.querySelector("#main-content") as HTMLElement;
		const audio = document.querySelector("audio") as HTMLAudioElement;
		clickCue(root, 110);

		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/second.mp3"));
		expect(audio.currentTime).toBe(0);
	});

	it.each([false, true])(
		"resolves a future cue on demand without a stale seek after navigation %s",
		async (navigateAway) => {
			let resolveThird: (response: { ok: boolean; text: () => Promise<string> }) => void = () =>
				undefined;
			const fetchMock = vi.fn((src: string) =>
				src === "timings/third.vtt"
					? new Promise<{ ok: boolean; text: () => Promise<string> }>((resolve) => {
							resolveThird = resolve;
						})
					: Promise.resolve({
							ok: true,
							text: async () =>
								`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${src.includes("first") ? "First" : "Second"} cue`,
						}),
			);
			vi.stubGlobal("fetch", fetchMock);
			renderThreeItemNarration();
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
			await act(async () => undefined);
			const root = document.querySelector("#main-content") as HTMLElement;
			const third = root.querySelector('[data-block-id="third"]') as HTMLElement;
			fireEvent.pointerDown(third, { clientX: 50, clientY: 210 });
			fireEvent.pointerUp(third, { clientX: 50, clientY: 210 });
			expect(fetchMock).toHaveBeenCalledTimes(3);
			if (navigateAway) clickCue(root, 110);
			resolveThird({
				ok: true,
				text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThird cue",
			});
			const audio = document.querySelector("audio") as HTMLAudioElement;
			await waitFor(() =>
				expect(audio).toHaveAttribute("src", navigateAway ? "audio/second.mp3" : "audio/third.mp3"),
			);
		},
	);

	it("ignores a delayed cue click after its branch becomes ineligible", async () => {
		let resolveThird: (response: { ok: boolean; text: () => Promise<string> }) => void = () =>
			undefined;
		const fetchMock = vi.fn((src: string) =>
			src === "timings/third.vtt"
				? new Promise<{ ok: boolean; text: () => Promise<string> }>((resolve) => {
						resolveThird = resolve;
					})
				: Promise.resolve({
						ok: true,
						text: async () =>
							`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${src.includes("first") ? "First" : "Second"} cue`,
					}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const onActiveSegment = vi.fn();
		const view = (eligibleIds: ReadonlySet<string>) => (
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<p data-block-id="first">First cue</p>
					<p data-block-id="second">Second cue</p>
					<p data-block-id="third">Third cue</p>
				</main>
				<NarrationBar
					items={threeItems}
					strings={strings}
					eligibleIds={eligibleIds}
					onActiveSegment={onActiveSegment}
				/>
			</div>
		);
		const { rerender } = render(view(new Set(["first", "second", "third"])));
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await act(async () => undefined);
		const third = document.querySelector('[data-block-id="third"]') as HTMLElement;
		fireEvent.pointerDown(third, { clientX: 50, clientY: 210 });
		fireEvent.pointerUp(third, { clientX: 50, clientY: 210 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		rerender(view(new Set(["first", "second"])));
		await act(async () =>
			resolveThird({
				ok: true,
				text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThird cue",
			}),
		);
		expect(document.querySelector("audio")).toHaveAttribute("src", "audio/first.mp3");
		expect(onActiveSegment).not.toHaveBeenCalled();
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
	});

	it("loads a committed answer when both faces share one block", async () => {
		const fetchMock = vi.fn(async (src: string) => ({
			ok: true,
			text: async () =>
				`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${src.includes("back") ? "Second" : "First"} cue`,
		}));
		vi.stubGlobal("fetch", fetchMock);
		const playlist: NarrationPlaylistItem[] = ["front", "back"].map((side) => ({
			id: side,
			src: `audio/${side}.mp3`,
			timingsSrc: `timings/${side}.vtt`,
			blockId: "cards",
			cardTargets: [{ containerId: "cards", itemIndex: 0, side: side as "front" | "back" }],
		}));
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<div data-card-root data-block-id="cards">
						<div data-card-index="0" data-card-item data-flipped="true">
							<div data-card-side="front">First cue</div>
							<div data-card-side="back">Second cue</div>
						</div>
					</div>
				</main>
				<NarrationBar
					items={playlist}
					strings={strings}
					alwaysExpanded
					showSentenceControls={false}
				/>
			</div>,
		);
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		const back = document.querySelector('[data-card-side="back"]') as HTMLElement;
		fireEvent.pointerDown(back, { clientX: 50, clientY: 110 });
		fireEvent.pointerUp(back, { clientX: 50, clientY: 110 });
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/back.mp3"),
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("waits for metadata before applying a non-zero cross-segment seek and play", async () => {
		const probes = mockAudioProbes();
		const fetchMock = vi.fn(async (src: string) => ({
			ok: true,
			text: async () =>
				`WEBVTT\n\n${src.includes("second") ? "00:00:03.500 --> 00:00:04.500" : "00:00:00.000 --> 00:00:01.000"}\n${src.includes("second") ? "Second cue" : src.includes("third") ? "Third cue" : "First cue"}`,
		}));
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<p data-block-id="first">First cue</p>
					<p data-block-id="second">Second cue</p>
					<p data-block-id="third">Third cue</p>
				</main>
				<NarrationBar
					items={threeItems.map((item) => ({ ...item, duration: 10 }))}
					strings={strings}
				/>
			</div>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);
		await loadDurations(probes, [10, 10, 10]);

		const audio = document.querySelector("audio") as HTMLAudioElement;
		let readyState: number = HTMLMediaElement.HAVE_NOTHING;
		let currentTime = 0;
		Object.defineProperty(audio, "readyState", {
			configurable: true,
			get: () => readyState,
		});
		Object.defineProperty(audio, "currentTime", {
			configurable: true,
			get: () => currentTime,
			set: (value: number) => {
				if (readyState >= HTMLMediaElement.HAVE_METADATA) currentTime = value;
			},
		});
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });

		clickCue(document.querySelector("#main-content") as HTMLElement, 110);
		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/second.mp3"));
		expect(audio.currentTime).toBe(0);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
		expect((screen.getByRole("slider", { name: strings.seek }) as HTMLInputElement).value).toBe(
			"13.5",
		);
		fireEvent.timeUpdate(audio);
		expect((screen.getByRole("slider", { name: strings.seek }) as HTMLInputElement).value).toBe(
			"13.5",
		);

		readyState = HTMLMediaElement.HAVE_METADATA;
		fireEvent.loadedMetadata(audio);
		expect(audio.currentTime).toBe(3.5);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
	});

	it("selects the second item when the slider seeks to its exact boundary", async () => {
		const probes = mockAudioProbes();
		mockThreeItemCues();
		renderThreeItemNarration();
		await loadDurations(probes, [10, 20, 30]);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));

		const audio = document.querySelector("audio") as HTMLAudioElement;
		fireEvent.change(screen.getByRole("slider", { name: strings.seek }), {
			target: { value: "10" },
		});

		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/second.mp3"));
		expect(audio.currentTime).toBe(0);
	});

	it("continues from the second item to the third item", async () => {
		const probes = mockAudioProbes();
		mockThreeItemCues();
		renderThreeItemNarration();
		await loadDurations(probes, [10, 20, 30]);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));

		const audio = document.querySelector("audio") as HTMLAudioElement;
		fireEvent.change(screen.getByRole("slider", { name: strings.seek }), {
			target: { value: "11" },
		});
		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/second.mp3"));
		fireEvent.ended(audio);

		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/third.mp3"));
		loadPlayerMetadata(audio);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
	});

	it("waits for item four metadata after item three ends", async () => {
		const onEnded = vi.fn();
		render(<NarrationBar items={recordedItems} strings={strings} onEnded={onEnded} />);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));

		const audio = document.querySelector("audio") as HTMLAudioElement;
		let readyState: number = HTMLMediaElement.HAVE_METADATA;
		Object.defineProperty(audio, "readyState", {
			configurable: true,
			get: () => readyState,
		});
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });

		for (const src of ["audio/heading.mp3", "audio/text.mp3"]) {
			fireEvent.ended(audio);
			await waitFor(() => expect(audio).toHaveAttribute("src", src));
		}
		readyState = HTMLMediaElement.HAVE_NOTHING;
		fireEvent.ended(audio);
		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/note.mp3"));
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
		expect(onEnded).not.toHaveBeenCalled();

		readyState = HTMLMediaElement.HAVE_METADATA;
		fireEvent.loadedMetadata(audio);
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(4));
		expect(onEnded).not.toHaveBeenCalled();
	});

	it("ignores a rejected play promise after the source has changed", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let rejectFirstPlay: ((reason?: unknown) => void) | undefined;
		vi.mocked(HTMLMediaElement.prototype.play)
			.mockImplementationOnce(
				() =>
					new Promise<void>((_resolve, reject) => {
						rejectFirstPlay = reject;
					}),
			)
			.mockResolvedValueOnce();
		const probes = mockAudioProbes();
		mockThreeItemCues();
		renderThreeItemNarration();
		await loadDurations(probes, [10, 20, 30]);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));

		const audio = document.querySelector("audio") as HTMLAudioElement;
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		fireEvent.play(audio);
		fireEvent.ended(audio);
		await screen.findByRole("button", { name: strings.pause });
		await act(async () => rejectFirstPlay?.(new Error("obsolete source")));

		expect(screen.getByRole("button", { name: strings.pause })).toBeInTheDocument();
		expect(consoleError).toHaveBeenCalledWith(
			"[NarrationBar] Failed to play narration",
			expect.stringContaining("audio/first.mp3"),
			expect.objectContaining({ message: "obsolete source" }),
		);
	});

	it("logs media errors with source context", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(<NarrationBar items={[recordedItems[0]]} strings={strings} />);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		const audio = document.querySelector("audio") as HTMLAudioElement;
		const mediaError = { code: 4, message: "Unsupported source" };
		Object.defineProperty(audio, "error", { configurable: true, value: mediaError });

		fireEvent.error(audio);

		expect(consoleError).toHaveBeenCalledWith(
			"[NarrationBar] Media error",
			expect.stringContaining("audio/page-title.mp3"),
			mediaError,
		);
	});

	it("logs metadata probe errors with source context and continues", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const probes = mockAudioProbes();
		render(
			<NarrationBar
				items={[items[0], items[1], { id: "last", src: "audio/last.mp3" }]}
				strings={strings}
			/>,
		);
		await waitFor(() => expect(probes).toHaveLength(1));
		const mediaError = { code: 4, message: "Unsupported source" };
		Object.defineProperty(probes[0], "error", { configurable: true, value: mediaError });

		fireEvent.error(probes[0]);
		await waitFor(() => expect(probes).toHaveLength(2));
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		expect(screen.getByText(strings.durationUnavailable)).toBeInTheDocument();
		expect(screen.getByRole("slider", { name: strings.seek })).toBeDisabled();

		expect(consoleError).toHaveBeenCalledWith(
			"[NarrationBar] Metadata probe error",
			"audio/title.mp3",
			mediaError,
		);
	});

	it("invalidates cue hit rectangles when an ancestor scrollport scrolls", async () => {
		mockAudioProbes();
		const fetchMock = mockThreeItemCues();
		render(
			<div className="praxity-viewer-shell">
				<div data-testid="ancestor-scrollport" style={{ overflowY: "auto" }}>
					<main id="main-content">
						<p data-block-id="first">First cue</p>
						<p data-block-id="second">Second cue</p>
						<p data-block-id="third">Third cue</p>
					</main>
				</div>
				<NarrationBar items={threeItems} strings={strings} />
			</div>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);

		const root = document.querySelector("#main-content") as HTMLElement;
		const getClientRects = vi.mocked(Range.prototype.getClientRects);
		fireEvent.pointerMove(root, { clientX: 50, clientY: 110 });
		expect(getClientRects).toHaveBeenCalledTimes(2);
		fireEvent.scroll(screen.getByTestId("ancestor-scrollport"));
		fireEvent.pointerMove(root, { clientX: 50, clientY: 110 });

		expect(getClientRects).toHaveBeenCalledTimes(4);
	});

	it("pauses at an authored interaction boundary", async () => {
		render(
			<NarrationBar items={[{ ...items[0], pauseAfter: true }, items[1]]} strings={strings} />,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.ended(document.querySelector("audio") as HTMLAudioElement);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
	});

	it("keeps one virtual timeline and learner playback speed", async () => {
		const probes = mockAudioProbes();
		const onRateChange = vi.fn();
		render(
			<NarrationBar
				items={[
					{ ...items[0], duration: 35 },
					{ ...items[1], duration: 30 },
				]}
				strings={strings}
				defaultRate={1}
				onRateChange={onRateChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadDurations(probes, [35, 30]);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		Object.defineProperty(audio, "duration", { configurable: true, value: 65 });
		fireEvent.loadedMetadata(audio);
		fireEvent.change(screen.getByRole("slider", { name: strings.seek }), {
			target: { value: "12" },
		});
		expect(audio.currentTime).toBe(12);
		expect(screen.getByText("0:12 / 1:05")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: `${strings.speed}: 1×` }));
		expect(audio.playbackRate).toBe(1.25);
		expect(onRateChange).toHaveBeenCalledWith(1.25);
	});

	it("keeps one working timeline when the shell moves seeking into Tools", async () => {
		const probes = mockAudioProbes();
		const tools = document.createElement("div");
		document.body.append(tools);
		try {
			const { rerender } = render(
				<NarrationBar items={items} strings={strings} alwaysExpanded seekMount={tools} />,
			);
			const slider = screen.getByRole("slider", { name: strings.seek });
			expect(tools.contains(slider)).toBe(true);
			expect(slider).toBeDisabled();
			expect(slider).toHaveAttribute("aria-valuetext", strings.durationLoading);
			await loadDurations(probes, [35, 30]);
			expect(slider).toBeEnabled();
			fireEvent.change(slider, { target: { value: "12" } });
			const audio = document.querySelector("audio");
			assert(audio);
			expect(audio.currentTime).toBe(12);
			expect(slider).toHaveAttribute("aria-valuetext", "0:12 / 1:05");
			rerender(<NarrationBar items={items} strings={strings} alwaysExpanded />);
			expect(tools.querySelector("input")).toBeNull();
			expect(screen.getAllByRole("slider", { name: strings.seek })).toHaveLength(1);
			expect(screen.getByRole("slider", { name: strings.seek })).toHaveValue("12");
		} finally {
			tools.remove();
		}
	});

	it("uses a stable follow toggle and no dead-end status line", () => {
		const onFollowActiveChange = vi.fn();
		render(
			<NarrationBar
				items={[items[0]]}
				strings={strings}
				onFollowActiveChange={onFollowActiveChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		const follow = screen.getByRole("button", { name: strings.followNarration });
		expect(follow).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(follow);
		expect(follow).toHaveAttribute("aria-pressed", "false");
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		expect(screen.queryByText("Transcript")).not.toBeInTheDocument();
	});

	it("keeps the Listen toggle before grouped transport controls", () => {
		const { container } = render(<NarrationBar items={items} strings={strings} />);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		const bar = container.querySelector(".praxity-narration") as HTMLElement;
		expect([...bar.children].map((child) => child.className)).toEqual([
			"praxity-narration-toggle",
			"praxity-narration-controls",
		]);
		const controls = bar.querySelector(".praxity-narration-controls") as HTMLElement;
		expect([...controls.children].map((child) => child.className)).toEqual([
			"praxity-narration-transport",
			"praxity-narration-position",
			"praxity-narration-options-toggle",
			"praxity-narration-options",
		]);
		expect(
			[...controls.querySelectorAll("button, input")].map((control) =>
				control.getAttribute("aria-label"),
			),
		).toEqual([
			strings.play,
			strings.seek,
			strings.narrationOptions,
			strings.previousSentence,
			strings.nextSentence,
			`${strings.speed}: 1×`,
			strings.followNarration,
		]);
		expect(getComputedStyle(controls).position).not.toBe("absolute");
	});

	it("never marks the page root as the active narration block", async () => {
		HTMLElement.prototype.scrollIntoView = vi.fn(); // jsdom does not implement it
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<p data-block-id="body">Body</p>
				</main>
				{/* items[0] is a page-title segment: no blockId */}
				<NarrationBar items={[items[0]]} strings={strings} />
			</div>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		expect(document.querySelectorAll("[data-narration-active]")).toHaveLength(0);
	});
	it.each(["MODEL_SECRET", "PRIVATE_ANSWER"])(
		"self-check task Follow never searches a revealed comparison for %s",
		async (cue) => {
			const ranges: Range[] = [];
			vi.stubGlobal("CSS", { escape: CSS.escape.bind(CSS), highlights: new Map() });
			vi.stubGlobal(
				"Highlight",
				class {
					constructor(...highlightRanges: Range[]) {
						ranges.push(...highlightRanges);
					}
				},
			);
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: async () => `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${cue}`,
				}),
			);
			render(
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<div data-block-id="task" data-block-type="selfCheck">
							<div data-self-check>
								<h2 className="praxity-assessment-stem">Explain the delay.</h2>
								<div data-self-check-comparison>
									<p>MODEL_SECRET</p>
									<p>PRIVATE_ANSWER</p>
								</div>
							</div>
						</div>
					</main>
					<NarrationBar
						items={[{ id: "task:title", blockId: "task", src: "task.mp3", timingsSrc: "task.vtt" }]}
						strings={strings}
					/>
				</div>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			await act(async () => fireEvent.click(screen.getByRole("button", { name: strings.play })));
			await screen.findByRole("button", { name: strings.pause });
			expect(ranges.map((range) => range.toString())).not.toContain(cue);
			expect(screen.getByRole("heading", { name: "Explain the delay." })).toHaveAttribute(
				"data-narration-active",
				"true",
			);
		},
	);

	it.each([
		["Observing the Night Sky", "Observing the Night Sky.", true],
		["Observing the Night Sky", "[sincerely] Observing the Night Sky.", true],
		["Observing the Night Sky", "Observing the Night Sky?!", true],
		["Observing the Night Sky today", "Observing the Night Sky.", false],
		["Read Observing the Night Sky", "Observing the Night Sky.", false],
	])(
		"matches optional spoken ending only across the entire block: %s, cue %s",
		async (visible, cue, matches) => {
			const ranges: Range[] = [];
			vi.stubGlobal("CSS", { escape: CSS.escape.bind(CSS), highlights: new Map() });
			vi.stubGlobal(
				"Highlight",
				class {
					constructor(...highlightRanges: Range[]) {
						ranges.push(...highlightRanges);
					}
				},
			);
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: async () => `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${cue}`,
				}),
			);
			render(
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<div data-block-id="heading">
							<h1>{visible}</h1>
						</div>
					</main>
					<NarrationBar
						items={[
							{ id: "heading", blockId: "heading", src: "heading.mp3", timingsSrc: "heading.vtt" },
						]}
						strings={strings}
					/>
				</div>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			await act(async () => fireEvent.click(screen.getByRole("button", { name: strings.play })));
			await screen.findByRole("button", { name: strings.pause });
			expect(ranges.some((range) => range.toString() === visible)).toBe(matches);
		},
	);

	it.each([false, true])(
		"maps formatted list cue to exact DOM endpoints (punctuation: %s)",
		async (punctuation) => {
			const cue = punctuation
				? "Target sentence: read carefully."
				: "Target sentence read carefully.";
			const highlights = new Map<string, Set<Range>>();
			vi.stubGlobal("CSS", { escape: CSS.escape.bind(CSS), highlights });
			vi.stubGlobal(
				"Highlight",
				class extends Set<Range> {
					constructor(...ranges: Range[]) {
						super(ranges);
					}
				},
			);
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: async () => `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${cue}`,
				}),
			);
			render(
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<ul data-block-id="body">
							<li data-testid="previous">
								<span aria-hidden="true">✓</span>
								<strong>Previous</strong>
								{"  sentence with "}
								<span>annotations</span>
								{" and its tail.\n"}
							</li>
							{"\n  "}
							<li data-testid="target">
								<span aria-hidden="true">✓</span>
								{"\n  "}
								<strong>Target sentence</strong>
								{punctuation ? ": read\n   " : " read\n   "}
								<span>{punctuation ? "carefully" : "carefully."}</span>
								{punctuation ? ".  " : "  "}
							</li>
						</ul>
					</main>
					<NarrationBar
						items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]}
						strings={strings}
					/>
				</div>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await waitFor(() => expect(highlights.has("praxity-narration-current")).toBe(true));
			const range = [...(highlights.get("praxity-narration-current") ?? [])][0];
			expect(range.toString()).toBe(
				punctuation
					? "Target sentence: read\n   carefully."
					: "Target sentence read\n   carefully.",
			);
			expect(screen.getByTestId("target").contains(range.startContainer)).toBe(true);
			expect(screen.getByTestId("target").contains(range.endContainer)).toBe(true);
			expect(range.intersectsNode(screen.getByTestId("previous"))).toBe(false);
			expect(range.startOffset).toBe(0);
			expect(range.endOffset).toBe(punctuation ? 1 : 10);
		},
	);

	it.each(["tooltip", "enhanced tooltip", "footnote", "icon"])(
		"matches narration across supplemental inline text (%s)",
		async (feature) => {
			const enhanced = feature === "enhanced tooltip";
			const cue = "For the next observation, tracking adjustments compensate for drift.";
			const highlights = new Map<string, Set<Range>>();
			vi.stubGlobal("CSS", { escape: CSS.escape.bind(CSS), highlights });
			vi.stubGlobal(
				"Highlight",
				class extends Set<Range> {
					constructor(...ranges: Range[]) {
						super(ranges);
					}
				},
			);
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: async () => `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${cue}`,
				}),
			);
			render(
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<p data-block-id="body">
							{"For the next observation, "}
							<span
								className="inline-tooltip-trigger"
								data-tooltip-enhanced={enhanced ? "" : undefined}
							>
								tracking adjustments
								{feature.includes("tooltip") && (
									<span className="inline-tooltip-fallback">
										{" "}
										(Settings that guide the telescope.)
									</span>
								)}
								{feature === "footnote" && (
									<sup className="praxity-footnote-ref">
										<span className="praxity-sr-only">Footnote </span>[1]
									</sup>
								)}
								{feature === "icon" && (
									<svg data-praxity-inline-icon="check" aria-hidden="true" focusable="false">
										<title>Check</title>
										<path d="M1 1 L2 2" />
									</svg>
								)}
								{enhanced && (
									<span className="praxity-sr-only praxity-definition-cue"> has definition</span>
								)}
							</span>
							{" compensate for drift. These adjustments keep distant stars in view."}
						</p>
					</main>
					<NarrationBar
						items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]}
						strings={strings}
					/>
				</div>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await waitFor(() => expect(highlights.has("praxity-narration-current")).toBe(true));
			const range = [...(highlights.get("praxity-narration-current") ?? [])][0];
			const selected = range.cloneContents();
			for (const supplemental of selected.querySelectorAll(
				".inline-tooltip-fallback, .praxity-definition-cue, .praxity-footnote-ref, svg",
			))
				supplemental.remove();
			expect(selected.textContent).toBe(cue);
			expect(range.startOffset).toBe(0);
			expect(range.endOffset).toBe(" compensate for drift.".length);
			expect(range.endContainer.textContent).toContain(
				"These adjustments keep distant stars in view.",
			);
		},
	);

	it.each(["mark", "doodle", "highlight-doodle"])(
		"preserves authored %s while following timed cues",
		async (feature) => {
			const highlights = new Map<string, Set<Range>>();
			vi.stubGlobal("CSS", { escape: CSS.escape.bind(CSS), highlights });
			vi.stubGlobal(
				"Highlight",
				class extends Set<Range> {
					constructor(...ranges: Range[]) {
						super(ranges);
					}
				},
			);
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					text: async () =>
						"WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBefore.\n\n00:00:02.000 --> 00:00:04.000\nRead marked words.\n\n00:00:04.000 --> 00:00:06.000\nAfter.\n\n00:00:06.000 --> 00:00:08.000\nmarked words.",
				}),
			);
			render(
				<div className="praxity-viewer-shell">
					<main id="main-content">
						<p data-block-id="body">
							{"Before.Read "}
							{feature === "mark" ? (
								<mark>marked</mark>
							) : (
								<span
									className="praxity-doodle"
									data-doodle={feature === "highlight-doodle" ? "highlight" : "underline"}
								>
									marked
									<svg data-praxity-doodle-decoration="" aria-hidden="true">
										<path d="M0 0 L10 0" />
									</svg>
								</span>
							)}
							{" words.After."}
						</p>
					</main>
					<NarrationBar
						items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]}
						strings={strings}
					/>
				</div>,
			);
			fireEvent.click(screen.getByRole("button", { name: strings.listen }));
			fireEvent.click(screen.getByRole("button", { name: strings.play }));
			await waitFor(() => expect(highlights.has("praxity-narration-current")).toBe(true));
			const block = document.querySelector('[data-block-id="body"]');
			const audio = document.querySelector("audio") as HTMLAudioElement;
			for (const [time, text] of [
				[2, "Read marked words."],
				[4, "After."],
				[6, "marked words."],
			] as const) {
				audio.currentTime = time;
				fireEvent.timeUpdate(audio);
				await waitFor(() => expect(highlights.has("praxity-narration-current")).toBe(true));
				expect([...(highlights.get("praxity-narration-current") ?? [])][0].toString()).toBe(text);
				expect(block).not.toHaveAttribute("data-narration-active");
			}
		},
	);

	it("highlights content only while playback and following are active", async () => {
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<p data-block-id="body">Body</p>
				</main>
				<NarrationBar items={[items[1]]} strings={strings} />
			</div>,
		);
		const block = screen.getByText("Body");
		vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 200,
			width: 100,
			height: 20,
			top: 200,
			right: 100,
			bottom: 220,
			left: 0,
			toJSON: () => ({}),
		});

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		expect(block).not.toHaveAttribute("data-narration-active");
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));
		fireEvent.click(screen.getByRole("button", { name: strings.pause }));
		await waitFor(() => expect(block).not.toHaveAttribute("data-narration-active"));
	});

	it("places the fallback marker on the dialogue turn", async () => {
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<div data-block-id="d1">
						<ol>
							<li data-turn-index="0">Hi.</li>
						</ol>
					</div>
				</main>
				<NarrationBar
					items={[{ id: "d1:item:0", src: "a.mp3", blockId: "d1", turnIndex: 0 }]}
					strings={strings}
				/>
			</div>,
		);
		const turn = document.querySelector("#main-content [data-turn-index='0']");
		if (!turn) throw new Error("Missing dialogue turn");
		const block = turn.closest("[data-block-id='d1']");
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(turn).toHaveAttribute("data-narration-active", "true"));
		expect(block).not.toHaveAttribute("data-narration-active");
	});

	it("does not flash the fallback marker during a timing gap", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFirst sentence.\n\n00:00:01.010 --> 00:00:02.000\nSecond sentence.",
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<p data-block-id="body">First sentence. Second sentence.</p>
				</main>
				<NarrationBar
					items={[{ ...items[1], timingsSrc: "timings/body.vtt", duration: 3 }]}
					strings={strings}
				/>
			</div>,
		);
		const block = screen.getByText("First sentence. Second sentence.");
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));

		const audio = document.querySelector("audio") as HTMLAudioElement;
		audio.currentTime = 1.005;
		fireEvent.timeUpdate(audio);
		await waitFor(() => expect(block).not.toHaveAttribute("data-narration-active"));

		audio.currentTime = 1.01;
		fireEvent.timeUpdate(audio);
		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));
	});

	it("does not scroll an oversized block when its active sentence is visible", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBody",
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<div data-testid="scrollport" style={{ overflowY: "auto" }}>
					<main id="main-content">
						<p data-block-id="body">Body</p>
					</main>
				</div>
				<NarrationBar items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]} strings={strings} />
			</div>,
		);
		const scrollport = screen.getByTestId("scrollport");
		const block = screen.getByText("Body");
		const scrollBy = vi.fn();
		scrollport.scrollBy = scrollBy;
		Object.defineProperty(scrollport, "scrollHeight", { configurable: true, value: 500 });
		Object.defineProperty(scrollport, "clientHeight", { configurable: true, value: 200 });
		vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			width: 400,
			height: 200,
			top: 100,
			right: 400,
			bottom: 300,
			left: 0,
			toJSON: () => ({}),
		});
		vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			width: 100,
			height: 500,
			top: 0,
			right: 100,
			bottom: 500,
			left: 0,
			toJSON: () => ({}),
		});
		vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({
			x: 0,
			y: 150,
			width: 100,
			height: 20,
			top: 150,
			right: 100,
			bottom: 170,
			left: 0,
			toJSON: () => ({}),
		});

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));

		expect(scrollBy).not.toHaveBeenCalled();
		expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
	});

	it("scrolls an oversized block once toward its active sentence", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBody",
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<div data-testid="scrollport" style={{ overflowY: "auto" }}>
					<main id="main-content">
						<p data-block-id="body">Body</p>
					</main>
				</div>
				<NarrationBar items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]} strings={strings} />
			</div>,
		);
		const scrollport = screen.getByTestId("scrollport");
		const block = screen.getByText("Body");
		const scrollBy = vi.fn();
		scrollport.scrollBy = scrollBy;
		Object.defineProperty(scrollport, "scrollHeight", { configurable: true, value: 500 });
		Object.defineProperty(scrollport, "clientHeight", { configurable: true, value: 200 });
		vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			width: 400,
			height: 200,
			top: 100,
			right: 400,
			bottom: 300,
			left: 0,
			toJSON: () => ({}),
		});
		vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			width: 100,
			height: 500,
			top: 0,
			right: 100,
			bottom: 500,
			left: 0,
			toJSON: () => ({}),
		});
		vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({
			x: 0,
			y: 350,
			width: 100,
			height: 20,
			top: 350,
			right: 100,
			bottom: 370,
			left: 0,
			toJSON: () => ({}),
		});

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));

		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));
		expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 160, behavior: "auto" });
	});

	it("skips a non-scrollable clipped wrapper for the real scrollport", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBody",
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<div data-testid="scrollport" style={{ overflowY: "auto" }}>
					<div data-testid="clipped-wrapper" style={{ overflowY: "hidden" }}>
						<main id="main-content">
							<p data-block-id="body">Body</p>
						</main>
					</div>
				</div>
				<NarrationBar items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]} strings={strings} />
			</div>,
		);
		const scrollport = screen.getByTestId("scrollport");
		const clippedWrapper = screen.getByTestId("clipped-wrapper");
		const block = screen.getByText("Body");
		const scrollBy = vi.fn();
		const clippedScrollBy = vi.fn();
		scrollport.scrollBy = scrollBy;
		clippedWrapper.scrollBy = clippedScrollBy;
		Object.defineProperty(scrollport, "scrollHeight", { configurable: true, value: 800 });
		Object.defineProperty(scrollport, "clientHeight", { configurable: true, value: 200 });
		Object.defineProperty(clippedWrapper, "scrollHeight", { configurable: true, value: 100 });
		Object.defineProperty(clippedWrapper, "clientHeight", { configurable: true, value: 100 });
		vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			width: 400,
			height: 200,
			top: 100,
			right: 400,
			bottom: 300,
			left: 0,
			toJSON: () => ({}),
		});
		vi.spyOn(clippedWrapper, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 300,
			width: 400,
			height: 100,
			top: 300,
			right: 400,
			bottom: 400,
			left: 0,
			toJSON: () => ({}),
		});
		vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({
			x: 0,
			y: 350,
			width: 100,
			height: 20,
			top: 350,
			right: 100,
			bottom: 370,
			left: 0,
			toJSON: () => ({}),
		});

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));

		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));
		expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 160, behavior: "auto" });
		expect(clippedScrollBy).not.toHaveBeenCalled();
	});

	it("uses a genuinely scrollable overflow-hidden container", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nBody",
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<div data-testid="ancestor-scrollport" style={{ overflowY: "auto" }}>
					<div data-testid="hidden-scrollport" style={{ overflowY: "hidden" }}>
						<main id="main-content">
							<p data-block-id="body">Body</p>
						</main>
					</div>
				</div>
				<NarrationBar items={[{ ...items[1], timingsSrc: "timings/body.vtt" }]} strings={strings} />
			</div>,
		);
		const ancestor = screen.getByTestId("ancestor-scrollport");
		const hiddenScrollport = screen.getByTestId("hidden-scrollport");
		const block = screen.getByText("Body");
		const ancestorScrollBy = vi.fn();
		const hiddenScrollBy = vi.fn();
		ancestor.scrollBy = ancestorScrollBy;
		hiddenScrollport.scrollBy = hiddenScrollBy;
		Object.defineProperty(ancestor, "scrollHeight", { configurable: true, value: 1000 });
		Object.defineProperty(ancestor, "clientHeight", { configurable: true, value: 500 });
		Object.defineProperty(hiddenScrollport, "scrollHeight", { configurable: true, value: 600 });
		Object.defineProperty(hiddenScrollport, "clientHeight", { configurable: true, value: 200 });
		vi.spyOn(hiddenScrollport, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			width: 400,
			height: 200,
			top: 100,
			right: 400,
			bottom: 300,
			left: 0,
			toJSON: () => ({}),
		});
		vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({
			x: 0,
			y: 350,
			width: 100,
			height: 20,
			top: 350,
			right: 100,
			bottom: 370,
			left: 0,
			toJSON: () => ({}),
		});

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));

		await waitFor(() => expect(block).toHaveAttribute("data-narration-active", "true"));
		expect(hiddenScrollBy).toHaveBeenCalledExactlyOnceWith({ top: 160, behavior: "auto" });
		expect(ancestorScrollBy).not.toHaveBeenCalled();
	});

	it("uses the narration scope itself as the scrollport", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nPage title",
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<div className="praxity-viewer-shell">
				<div data-testid="ancestor-scrollport" style={{ overflowY: "auto" }}>
					<main id="main-content" style={{ overflowY: "auto" }}>
						Page title
					</main>
				</div>
				<NarrationBar
					items={[{ ...items[0], timingsSrc: "timings/title.vtt" }]}
					strings={strings}
				/>
			</div>,
		);
		const scope = document.querySelector("#main-content") as HTMLElement;
		const ancestor = screen.getByTestId("ancestor-scrollport");
		Object.defineProperty(scope, "scrollHeight", { configurable: true, value: 500 });
		Object.defineProperty(scope, "clientHeight", { configurable: true, value: 200 });
		Object.defineProperty(ancestor, "scrollHeight", { configurable: true, value: 1000 });
		Object.defineProperty(ancestor, "clientHeight", { configurable: true, value: 500 });
		const scopeRect = vi.spyOn(scope, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 100,
			width: 400,
			height: 200,
			top: 100,
			right: 400,
			bottom: 300,
			left: 0,
			toJSON: () => ({}),
		});
		const ancestorRect = vi.spyOn(ancestor, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			width: 500,
			height: 500,
			top: 0,
			right: 500,
			bottom: 500,
			left: 0,
			toJSON: () => ({}),
		});
		vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue({
			x: 0,
			y: 150,
			width: 100,
			height: 20,
			top: 150,
			right: 100,
			bottom: 170,
			left: 0,
			toJSON: () => ({}),
		});

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });

		expect(scopeRect).toHaveBeenCalledOnce();
		expect(ancestorRect).not.toHaveBeenCalled();
	});

	it("reveals a hidden carousel slide while following its cue", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSecond slide",
			}),
		);
		const { container } = render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<section data-block-id="cards">
						<div className="praxity-slides-item" data-active="true" data-narration-reveal="0">
							First slide
						</div>
						<div className="praxity-slides-item" data-active="false" data-narration-reveal="1">
							Second slide
						</div>
					</section>
				</main>
				<NarrationBar
					items={[{ id: "cards", src: "cards.mp3", timingsSrc: "cards.vtt", blockId: "cards" }]}
					strings={strings}
				/>
			</div>,
		);
		const hiddenSlide = container.querySelector<HTMLElement>(
			'.praxity-slides-item[data-active="false"]',
		);
		const onReveal = vi.fn(() => {
			if (hiddenSlide) hiddenSlide.dataset.active = "true";
		});
		hiddenSlide?.addEventListener("praxity:narration-reveal", onReveal);

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));

		await waitFor(() => expect(onReveal).toHaveBeenCalledOnce());
	});

	it("reveals a tab when its cue spans the separated tab label and panel", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nDetails Details body.",
			}),
		);
		const onReveal = vi.fn();
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<section data-block-id="tabs">
						<button type="button" data-narration-reveal="overview">
							Overview
						</button>
						<button type="button" data-narration-reveal="details">
							Details
						</button>
						<div data-narration-reveal="overview">Overview body.</div>
						<div data-narration-reveal="details">Details body.</div>
					</section>
				</main>
				<NarrationBar
					items={[{ id: "tabs", src: "tabs.mp3", timingsSrc: "tabs.vtt", blockId: "tabs" }]}
					strings={strings}
				/>
			</div>,
		);
		const details = screen.getByRole("button", { name: "Details" });
		details.addEventListener("praxity:narration-reveal", onReveal);

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));

		await waitFor(() => expect(onReveal).toHaveBeenCalledOnce());
	});

	it("does not match narration cues against component style text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nVisible words",
			}),
		);
		const setStart = vi.spyOn(Range.prototype, "setStart");
		render(
			<div className="praxity-viewer-shell">
				<main id="main-content">
					<section data-block-id="styled">
						<style>{"Visible words"}</style>
						<p>Visible words</p>
					</section>
				</main>
				<NarrationBar
					items={[{ id: "styled", src: "styled.mp3", timingsSrc: "styled.vtt", blockId: "styled" }]}
					strings={strings}
				/>
			</div>,
		);

		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));

		await waitFor(() => expect(setStart).toHaveBeenCalled());
		expect(
			setStart.mock.calls.every(([node]) => (node as Text).parentElement?.tagName !== "STYLE"),
		).toBe(true);
	});

	it("pauses when collapsed or unmounted", async () => {
		const { unmount } = render(<NarrationBar items={items} strings={strings} />);
		const disclosure = screen.getByRole("button", { name: strings.listen });
		fireEvent.click(disclosure);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.click(disclosure);
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
		unmount();
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
	});
	it("toggles the shared player and declines a segment without audio", async () => {
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar
				items={[recordedItems[0], { id: "silent", src: "" }]}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		act(() => expect(controller.current?.togglePlayback()).toBe(true));
		await screen.findByRole("button", { name: strings.pause });
		act(() => expect(controller.current?.togglePlayback()).toBe(true));
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		act(() => {
			controller.current?.selectSegment(1);
		});
		act(() => expect(controller.current?.togglePlayback()).toBe(false));
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
	});
	it("narrates the prompt but refuses answer playback and seeking until learner commitment", async () => {
		const root = document.createElement("main");
		root.innerHTML =
			'<div data-card-root data-block-id="cards"><div data-card-item data-card-index="0" data-flipped="false"><button aria-expanded="false">I have my answer</button></div></div>';
		document.body.append(root);
		const card = root.querySelector<HTMLElement>("[data-card-item]");
		assert(card);
		const controller = createRef<NarrationController>();
		const playlist: NarrationPlaylistItem[] = ["front", "back"].map((side, index) => ({
			id: String(index),
			src: `audio/${index}.mp3`,
			duration: 5,
			cardTargets: [{ containerId: "cards", itemIndex: 0, side: side as "front" | "back" }],
		}));
		const { container } = render(
			<NarrationBar
				items={playlist}
				strings={strings}
				contentRoot={root}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		act(() => {
			expect(controller.current?.selectSegment(1)).toBe(false);
		});
		act(() => {
			controller.current?.togglePlayback();
		});
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce());
		const audio = container.querySelector("audio");
		assert(audio);
		fireEvent.ended(audio);
		await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeVisible());
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
		card.dataset.flipped = "true";
		act(() => {
			expect(controller.current?.selectSegment(1)).toBe(true);
		});
		act(() => {
			controller.current?.togglePlayback();
		});
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
	});

	it("refuses an initially selected uncommitted answer, then permits it after commitment", async () => {
		const root = document.createElement("main");
		root.innerHTML =
			'<div data-card-root data-block-id="cards"><div data-card-index="0" data-card-item data-flipped="false"></div></div>';
		document.body.append(root);
		const card = root.querySelector<HTMLElement>("[data-card-item]");
		assert(card);
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar
				items={[
					{
						id: "answer",
						src: "audio/answer.mp3",
						duration: 5,
						cardTargets: [{ containerId: "cards", itemIndex: 0, side: "back" }],
					},
				]}
				strings={strings}
				contentRoot={root}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		act(() => {
			controller.current?.togglePlayback();
		});
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		card.dataset.flipped = "true";
		act(() => {
			controller.current?.togglePlayback();
		});
		await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce());
	});

	it("reveals exact card paths without timings on paused seek and holds timers with Follow off", async () => {
		const root = document.createElement("main");
		root.innerHTML =
			'<div data-block-id="cards"><div data-card-root data-block-id="cards"></div></div>';
		document.body.append(root);
		const card = root.querySelector<HTMLElement>("[data-card-root]");
		assert(card);
		const reveal = vi.fn();
		card.addEventListener("praxity:narration-reveal", reveal);
		const controller = createRef<NarrationController>();
		const playlist: NarrationPlaylistItem[] = ["front", "back"].map((side, index) => ({
			id: String(index),
			src: `audio/${index}.mp3`,
			duration: 5,
			cardTargets: [{ containerId: "cards", itemIndex: 1, side: side as "front" | "back" }],
		}));
		const { unmount } = render(
			<NarrationBar
				items={playlist}
				strings={strings}
				contentRoot={root}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		act(() => {
			controller.current?.selectSegment(1);
		});
		expect(reveal).toHaveBeenCalledOnce();
		expect(reveal.mock.calls[0][0].detail.cardTarget).toEqual(playlist[1].cardTargets?.[0]);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		act(() => {
			controller.current?.togglePlayback();
		});
		await waitFor(() => expect(card.dataset.narrationPlaying).toBe("true"));
		fireEvent(card, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
		const count = reveal.mock.calls.length;
		act(() => {
			controller.current?.selectSegment(0);
		});
		expect(reveal).toHaveBeenCalledTimes(count + 1);
		expect(card.dataset.narrationPlaying).toBeUndefined();
		act(() => {
			controller.current?.pause();
		});
		expect(card.dataset.narrationPlaying).toBeUndefined();
		act(() => {
			controller.current?.setFollow(true);
		});
		expect(reveal).toHaveBeenCalledTimes(count + 2);
		unmount();
		expect(card.dataset.narrationPlaying).toBeUndefined();
		root.remove();
	});
	it.each([false, true])(
		"holds the source card timer for untargeted narration with separate transcript %s",
		async (separateTranscript) => {
			const root = document.createElement("main");
			root.innerHTML =
				'<div data-block-id="transcript">Intro</div><div data-block-id="cards"><div data-card-root data-block-id="cards"><div data-block-id="child">Body</div></div></div>';
			document.body.append(root);
			const card = root.querySelector<HTMLElement>("[data-card-root]") as HTMLElement;
			const reveal = vi.fn();
			card.addEventListener("praxity:narration-reveal", reveal);
			const controller = createRef<NarrationController>();
			const playlist: NarrationPlaylistItem[] = ["cards", "child"].map((source) => ({
				id: source,
				src: `audio/${source}.mp3`,
				duration: 5,
				blockId: separateTranscript ? "transcript" : source,
				sourceBlockId: separateTranscript ? source : undefined,
			}));
			const { unmount } = render(
				<NarrationBar
					items={playlist}
					strings={strings}
					contentRoot={root}
					mediaRoot={root}
					alwaysExpanded
					controllerRef={controller}
				/>,
			);
			act(() => {
				controller.current?.togglePlayback();
			});
			await waitFor(() => expect(card.dataset.narrationPlaying).toBe("true"));
			act(() => {
				controller.current?.setFollow(false);
				controller.current?.selectSegment(1);
			});
			expect(card.dataset.narrationPlaying).toBe("true");
			expect(reveal).not.toHaveBeenCalled();
			act(() => {
				controller.current?.pause();
			});
			expect(card.dataset.narrationPlaying).toBeUndefined();
			unmount();
			root.remove();
		},
	);
	it("retains the latest paused target for delayed activation and cancels it on Follow off", () => {
		const root = document.createElement("main");
		root.innerHTML = '<div data-card-root data-block-id="cards"></div>';
		document.body.append(root);
		const card = root.firstElementChild as HTMLElement;
		const controller = createRef<NarrationController>();
		const playlist: NarrationPlaylistItem[] = ["front", "back"].map((side, index) => ({
			id: String(index),
			src: `audio/${index}.mp3`,
			duration: 5,
			cardTargets: [{ containerId: "cards", itemIndex: 1, side: side as "front" | "back" }],
		}));
		const { unmount } = render(
			<NarrationBar
				items={playlist}
				strings={strings}
				contentRoot={root}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		act(() => {
			controller.current?.selectSegment(0);
		});
		expect(card.dataset.narrationPendingSide).toBe("front");
		act(() => {
			controller.current?.selectSegment(1);
		});
		expect(card.dataset.narrationPendingSide).toBe("back");
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		act(() => {
			controller.current?.setFollow(false);
		});
		expect(card.dataset.narrationPendingIndex).toBeUndefined();
		act(() => {
			controller.current?.setFollow(true);
		});
		expect(card.dataset.narrationPendingSide).toBe("back");
		fireEvent(card, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
		expect(card.dataset.narrationPendingSide).toBeUndefined();
		unmount();
		root.remove();
	});
	it.each([true, false])(
		"pauses card browsing and resumes at the audio position with Follow %s",
		async (following) => {
			const root = document.createElement("main");
			root.innerHTML = '<div data-card-root data-block-id="cards"></div>';
			document.body.append(root);
			const card = root.firstElementChild as HTMLElement;
			const reveal = vi.fn();
			card.addEventListener("praxity:narration-reveal", reveal);
			const controller = createRef<NarrationController>();
			const beforeSelect = vi.fn(() => true);
			const { unmount } = render(
				<NarrationBar
					items={[
						{
							id: "front",
							src: "audio/front.mp3",
							duration: 5,
							cardTargets: [{ containerId: "cards", itemIndex: 0, side: "front" }],
						},
					]}
					strings={strings}
					contentRoot={root}
					alwaysExpanded
					controllerRef={controller}
					beforeSelect={beforeSelect}
				/>,
			);
			act(() => controller.current?.setFollow(following));
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: strings.play }));
			});
			await screen.findByRole("button", { name: strings.pause });
			const audio = document.querySelector("audio") as HTMLAudioElement;
			await act(async () => {
				audio.currentTime = 2;
				fireEvent.timeUpdate(audio);
			});
			reveal.mockClear();
			fireEvent(card, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
			expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: strings.followNarration })).toHaveAttribute(
				"aria-pressed",
				String(following),
			);
			fireEvent.timeUpdate(audio);
			expect(reveal).not.toHaveBeenCalled();
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: strings.play }));
			});
			await screen.findByRole("button", { name: strings.pause });
			expect(audio.currentTime).toBe(2);
			expect(beforeSelect).toHaveBeenLastCalledWith(0, "play", 2);
			await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
			expect(reveal).toHaveBeenCalledTimes(following ? 1 : 0);
			unmount();
			root.remove();
		},
	);

	it("cancels pending cross-segment playback when cards are browsed", async () => {
		const root = document.createElement("main");
		document.body.append(root);
		const controller = createRef<NarrationController>();
		const { unmount } = render(
			<NarrationBar
				items={recordedItems}
				strings={strings}
				contentRoot={root}
				alwaysExpanded
				controllerRef={controller}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		act(() => controller.current?.selectSegment(1));
		fireEvent(root, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
		loadPlayerMetadata(document.querySelector("audio") as HTMLAudioElement);
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: strings.followNarration })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		unmount();
		root.remove();
	});

	it("keeps default Follow when cards are browsed before narration opens", async () => {
		const root = document.createElement("main");
		root.innerHTML = '<div data-card-root data-block-id="cards"></div>';
		document.body.append(root);
		const card = root.firstElementChild as HTMLElement;
		const reveal = vi.fn();
		card.addEventListener("praxity:narration-reveal", reveal);
		const following = vi.fn();
		const playlist: NarrationPlaylistItem[] = [
			{
				id: "front",
				src: "audio/front.mp3",
				duration: 5,
				cardTargets: [{ containerId: "cards", itemIndex: 0, side: "front" }],
			},
		];
		const { unmount } = render(
			<NarrationBar
				items={playlist}
				strings={strings}
				contentRoot={root}
				onFollowChange={following}
			/>,
		);
		card.dataset.narrationPendingIndex = "0";
		card.dataset.narrationPendingSide = "back";
		fireEvent(card, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
		expect(card.dataset.narrationPendingSide).toBeUndefined();
		expect(following).toHaveBeenLastCalledWith(true);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(reveal).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: strings.pause }));
		fireEvent(card, new CustomEvent("praxity:narration-manual-navigation", { bubbles: true }));
		expect(following).toHaveBeenLastCalledWith(true);
		unmount();
		root.remove();
	});

	it("keeps authored order and omits hidden branch time from seeking", async () => {
		const probes = mockAudioProbes();
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar
				items={branchItems}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "new"])}
				controllerRef={controller}
			/>,
		);
		await loadDurations(probes, [10, 20, 30]);
		const seek = screen.getByRole("slider", { name: strings.seek });
		expect(seek).toHaveAttribute("max", "40");
		expect(controller.current?.selectSegment(1)).toBe(false);
		fireEvent.change(seek, { target: { value: "11" } });
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/new.mp3"),
		);
		expect(document.querySelector("audio")).not.toHaveAttribute("src", "audio/old.mp3");
	});

	it("waits for an eligible first segment without starting on reveal", async () => {
		const { rerender } = render(
			<NarrationBar items={branchItems} strings={strings} alwaysExpanded eligibleIds={new Set()} />,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		rerender(
			<NarrationBar
				items={branchItems}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro"])}
			/>,
		);
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
	});

	it("pauses a disappearing segment and keeps time and Follow until Play skips it", async () => {
		const controller = createRef<NarrationController>();
		const { rerender } = render(
			<NarrationBar
				items={branchItems}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "old"])}
				controllerRef={controller}
			/>,
		);
		await act(async () => expect(controller.current?.selectSegment(1)).toBe(true));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/old.mp3"),
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		audio.currentTime = 4;
		fireEvent.timeUpdate(audio);
		fireEvent.click(screen.getByRole("button", { name: strings.narrationOptions }));
		fireEvent.click(screen.getByRole("button", { name: strings.followNarration }));
		expect(screen.getByRole("button", { name: strings.followNarration })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		rerender(
			<NarrationBar
				items={branchItems}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "new"])}
				controllerRef={controller}
			/>,
		);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
		expect(screen.getByRole("button", { name: strings.followNarration })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(audio.currentTime).toBe(4);
		expect(document.querySelector("audio")).toHaveAttribute("src", "audio/old.mp3");
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/new.mp3"),
		);
	});

	it("continues forward after retry; an earlier revealed branch needs explicit selection", async () => {
		const earlier = [branchItems[0], branchItems[2], branchItems[1]];
		const controller = createRef<NarrationController>();
		const { rerender } = render(
			<NarrationBar
				items={earlier}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "old"])}
				controllerRef={controller}
			/>,
		);
		await act(async () => expect(controller.current?.selectSegment(2)).toBe(true));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/old.mp3"),
		);
		loadPlayerMetadata(document.querySelector("audio") as HTMLAudioElement);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		rerender(
			<NarrationBar
				items={earlier}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro"])}
				controllerRef={controller}
			/>,
		);
		rerender(
			<NarrationBar
				items={earlier}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "new"])}
				controllerRef={controller}
			/>,
		);
		vi.mocked(HTMLMediaElement.prototype.play).mockClear();
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		expect(document.querySelector("audio")).toHaveAttribute("src", "audio/old.mp3");
		await act(async () => expect(controller.current?.selectSegment(1)).toBe(true));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/new.mp3"),
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
	});

	it.each(["End", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "pointer release"])(
		"seeks an earlier eligible branch with %s when the current segment is hidden",
		async (key) => {
			const probes = mockAudioProbes();
			const earlier = [branchItems[0], branchItems[2], branchItems[1]];
			const controller = createRef<NarrationController>();
			const { rerender } = render(
				<NarrationBar
					items={earlier}
					strings={strings}
					alwaysExpanded
					eligibleIds={new Set(["intro", "old"])}
					controllerRef={controller}
				/>,
			);
			await loadDurations(probes, [10, 30, 20]);
			await act(async () => expect(controller.current?.selectSegment(2)).toBe(true));
			const audio = document.querySelector("audio") as HTMLAudioElement;
			await waitFor(() => expect(audio).toHaveAttribute("src", "audio/old.mp3"));
			loadPlayerMetadata(audio);
			audio.currentTime = 4;
			fireEvent.timeUpdate(audio);
			rerender(
				<NarrationBar
					items={earlier}
					strings={strings}
					alwaysExpanded
					eligibleIds={new Set(["intro", "new"])}
					controllerRef={controller}
				/>,
			);
			const seek = screen.getByRole("slider", { name: strings.seek }) as HTMLInputElement;
			expect(seek).toBeEnabled();
			expect(seek).toHaveAttribute("max", "40");
			expect(seek.value).toBe("40");
			expect(audio).toHaveAttribute("src", "audio/old.mp3");
			seek.focus();
			if (key === "pointer release") fireEvent.pointerUp(seek);
			else {
				fireEvent.keyDown(seek, { key });
				// jsdom has no native range-key action; model its value change separately.
				if (key === "Home") fireEvent.change(seek, { target: { value: "0" } });
				if (key === "ArrowLeft" || key === "ArrowDown")
					fireEvent.change(seek, { target: { value: "39.6" } });
				fireEvent.keyUp(seek, { key });
			}
			await waitFor(() =>
				expect(audio).toHaveAttribute("src", key === "Home" ? "audio/intro.mp3" : "audio/new.mp3"),
			);
			if (key === "End") {
				loadPlayerMetadata(audio);
				fireEvent.keyDown(seek, { key: "ArrowLeft" });
				fireEvent.change(seek, { target: { value: "39.6" } });
				fireEvent.keyUp(seek, { key: "ArrowLeft" });
				expect(audio.currentTime).toBeCloseTo(29.6);
				expect(audio).toHaveAttribute("src", "audio/new.mp3");
			}
			expect(seek).toHaveFocus();
			expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
		},
	);

	it("takes an already eligible authored successor before any earlier newly revealed branch", async () => {
		const ordered = [
			branchItems[0],
			branchItems[2],
			branchItems[1],
			{ id: "outro", src: "audio/outro.mp3", duration: 5 },
		];
		const controller = createRef<NarrationController>();
		const { rerender } = render(
			<NarrationBar
				items={ordered}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "old", "outro"])}
				controllerRef={controller}
			/>,
		);
		await act(async () => expect(controller.current?.selectSegment(2)).toBe(true));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/old.mp3"),
		);
		loadPlayerMetadata(document.querySelector("audio") as HTMLAudioElement);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		rerender(
			<NarrationBar
				items={ordered}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "new", "outro"])}
				controllerRef={controller}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/outro.mp3"),
		);
	});

	it("stops after the nearest eligible predecessor of an authored question or media boundary", async () => {
		const playlist = [
			{ ...branchItems[0], authoredIndex: 0 },
			{ ...branchItems[1], authoredIndex: 1 },
			{ ...branchItems[2], authoredIndex: 3 },
		];
		const controller = createRef<NarrationController>();
		render(
			<NarrationBar
				items={playlist}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
				eligibleIds={new Set(["intro", "new"])}
				stopAfter={new Set([3])}
			/>,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.ended(audio);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		expect(audio).toHaveAttribute("src", "audio/intro.mp3");
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/new.mp3"));
	});

	it("keeps a terminal question stop until submission reveals a branch", async () => {
		const items = [
			{ ...branchItems[0], authoredIndex: 0 },
			{ id: "question", src: "audio/question.mp3", authoredIndex: 1 },
			{ ...branchItems[2], authoredIndex: 2 },
		];
		const controller = createRef<NarrationController>();
		const { rerender } = render(
			<NarrationBar
				items={items}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
				eligibleIds={new Set(["intro", "question"])}
				stopAfter={new Set([2])}
			/>,
		);
		await act(async () => expect(controller.current?.selectSegment(1)).toBe(true));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/question.mp3"),
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.ended(audio);
		expect(screen.getByRole("button", { name: strings.play })).toBeInTheDocument();
		rerender(
			<NarrationBar
				items={items}
				strings={strings}
				alwaysExpanded
				controllerRef={controller}
				eligibleIds={new Set(["intro", "question", "new"])}
				stopAfter={new Set([2])}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/new.mp3"));
	});

	it("ignores an authored stop while its conditional owner is hidden", async () => {
		render(
			<NarrationBar
				items={[
					{ ...branchItems[0], authoredIndex: 0 },
					{ ...branchItems[2], authoredIndex: 2 },
				]}
				strings={strings}
				alwaysExpanded
				eligibleIds={new Set(["intro", "new"])}
				stopAfter={new Set()}
			/>,
		);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		loadPlayerMetadata(audio);
		fireEvent.click(screen.getByRole("button", { name: strings.play }));
		await screen.findByRole("button", { name: strings.pause });
		fireEvent.ended(audio);
		await waitFor(() => expect(audio).toHaveAttribute("src", "audio/new.mp3"));
	});

	it("ignores pointer cues in an ineligible branch", async () => {
		mockAudioProbes();
		const fetchMock = mockThreeItemCues();
		renderThreeItemNarration(undefined, new Set(["first", "third"]));
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);
		const audio = document.querySelector("audio") as HTMLAudioElement;
		clickCue(document.querySelector("#main-content") as HTMLElement, 110);
		expect(audio).toHaveAttribute("src", "audio/first.mp3");
	});

	it("moves Next sentence past an ineligible branch", async () => {
		const probes = mockAudioProbes();
		const fetchMock = mockThreeItemCues();
		renderThreeItemNarration(undefined, new Set(["first", "third"]));
		await loadDurations(probes, [10, 20, 30]);
		fireEvent.click(screen.getByRole("button", { name: strings.listen }));
		await loadThreeItemCues(fetchMock);
		fireEvent.click(screen.getByRole("button", { name: strings.nextSentence }));
		await waitFor(() =>
			expect(document.querySelector("audio")).toHaveAttribute("src", "audio/third.mp3"),
		);
	});
});
