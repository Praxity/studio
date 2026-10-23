"use client";

import {
	IconArrowAutofitDown,
	IconDots,
	IconHeadphones,
	IconHeadphonesOff,
	IconPlayerPause,
	IconPlayerPlay,
	IconPlayerSkipBack,
	IconPlayerSkipForward,
} from "@tabler/icons-react";
import type { JSX, Ref } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { forcedPalette } from "../forced-palette";
import { type NarrationCardTarget, type NarrationVttCue, parseNarrationVtt } from "../narration";
import {
	createSelfCheckMutationObserver,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	setSelfCheckTimeout,
} from "../self-check-consumers";

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const HIGHLIGHT_NAME = "praxity-narration-current";
const HOVER_HIGHLIGHT_NAME = "praxity-narration-hover";

export interface NarrationStrings {
	play: string;
	pause: string;
	seek: string;
	durationLoading: string;
	durationUnavailable: string;
	speed: string;
	narrationLabel: string;
	narrationOptions: string;
	noNarration: string;
	listen: string;
	previousSentence: string;
	nextSentence: string;
	followNarration: string;
}

export interface NarrationPlaylistItem {
	id: string;
	src: string;
	/** Explicit Play skips unrecorded targets within this logical page. */
	pageId?: string;
	/** Authored silence, not missing or failed audio. */
	silent?: boolean;
	timingsSrc?: string;
	blockId?: string;
	ancestorBlockIds?: string[];
	/** Actual slide content owner when blockId identifies a separate transcript passage. */
	sourceBlockId?: string;
	/** Dialogue turn in the source block; marked current while it plays. */
	turnIndex?: number;
	duration?: number;
	pauseAfter?: boolean;
	authoredIndex?: number;
	conditionalBlockId?: string;
	cardTargets?: NarrationCardTarget[];
}

export type NarrationSelectionReason = "select" | "seek" | "advance" | "play";

export interface NarrationController {
	selectSegment(index: number): boolean;
	togglePlayback(): boolean;
	pause(): void;
	setFollow(enabled: boolean): void;
	resumeFollow(): void;
}

export interface NarrationBarProps {
	items: readonly NarrationPlaylistItem[];
	eligibleIds?: ReadonlySet<string>;
	stopAfter?: ReadonlySet<number>;
	strings: NarrationStrings;
	/** Published islands pass their server-rendered main element directly. */
	contentRoot?: HTMLElement | null;
	/** Keep the shared transport open when its surrounding shell owns disclosure. */
	alwaysExpanded?: boolean;
	/** Omit controls supplied by an integrating course shell. */
	showSentenceControls?: boolean;
	showFollowControl?: boolean;
	/** The integrating shell can place secondary playback settings in its disclosure. */
	settingsMount?: { element: HTMLElement; timeLabel: string; speedLabel: string } | null;
	/** Keep seeking reachable when the shell hides its inline timeline. */
	seekMount?: HTMLElement | null;
	controllerRef?: Ref<NarrationController>;
	/** A shell-owned opening-slide location for the shared playback command. */
	openingControl?: { mount: HTMLElement; play: string; pause: string; firstPlayable: number };
	beforeSelect?: (index: number, reason: NarrationSelectionReason, localTime?: number) => boolean;
	onActiveSegment?: (index: number) => void;
	onPlaybackError?: () => void;
	/** Playback state, independent of Follow and its temporary suspension. */
	onPlaybackChange?: (playing: boolean) => void;
	/** The learner's preference, independent of temporary reading/scroll suspension. */
	onFollowChange?: (following: boolean) => void;
	onFollowSuspendedChange?: (suspended: boolean) => void;
	mediaRoot?: HTMLElement | null;
	scrollContainer?: HTMLElement | null;
	/** An authored pause boundary was reached, before selecting the next item. */
	onStop?: () => void;
	onEnded?: () => void;
	defaultRate?: number;
	onRateChange?: (rate: number) => void;
	onFollowActiveChange?: (active: boolean) => void;
}

interface ItemCue extends NarrationVttCue {
	itemIndex: number;
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const wholeSeconds = Math.floor(seconds);
	const minutes = Math.floor(wholeSeconds / 60);
	return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function initialRate(defaultRate: number | undefined): number {
	return PLAYBACK_RATES.includes(defaultRate as (typeof PLAYBACK_RATES)[number])
		? (defaultRate as number)
		: 1;
}

// Persisted durations can be cue end times; browser metadata is authoritative.
function estimatedDuration(item: NarrationPlaylistItem): number {
	return item.src &&
		typeof item.duration === "number" &&
		Number.isFinite(item.duration) &&
		item.duration > 0
		? item.duration
		: 0;
}

function dataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") resolve(reader.result);
			else reject(new Error("Audio data could not be read"));
		});
		reader.addEventListener("error", () => reject(reader.error));
		reader.readAsDataURL(blob);
	});
}

function textRange(root: Element, text: string): Range | null {
	const needle = text.replace(/\s+/gu, " ").trim();
	if (!needle) return null;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	const positions: Array<{ node: Text; offset: number }> = [];
	let normalized = "";
	let previousBlock: Element | null = null;
	let lineBreak = false;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node instanceof Element && node.tagName === "BR") lineBreak = true;
		if (
			!(node instanceof Text) ||
			node.parentElement?.closest(
				'style, script, noscript, template, svg, [aria-hidden="true"], .inline-tooltip-fallback, .praxity-definition-cue, .praxity-footnote-ref',
			)
		)
			continue;
		const block =
			node.parentElement?.closest(
				"p, li, dt, dd, h1, h2, h3, h4, h5, h6, td, th, div, section, article, blockquote, figcaption",
			) ?? root;
		// Inline spans stay adjacent; block boundaries and line breaks separate words.
		if (
			normalized &&
			(lineBreak || (previousBlock && block !== previousBlock)) &&
			!normalized.endsWith(" ")
		) {
			normalized += " ";
			positions.push({ node, offset: 0 });
		}
		previousBlock = block;
		lineBreak = false;
		for (let offset = 0; offset < node.data.length; offset++) {
			const character = /\s/u.test(node.data[offset]) ? " " : node.data[offset];
			if (character === " " && (!normalized || normalized.endsWith(" "))) continue;
			normalized += character;
			positions.push({ node, offset });
		}
	}
	// Keep normalized character positions tied to original DOM offsets, including
	// collapsed whitespace. Case-insensitive matching must not change their length.
	let match = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").exec(normalized);
	// Spoken headings may add sentence punctuation absent from the visible text.
	// Only relax an entire block match, never a phrase inside other content.
	if (!match) {
		const withoutEnding = needle.replace(/[.!?]+$/u, "");
		if (withoutEnding && withoutEnding !== needle)
			match = new RegExp(
				`^${withoutEnding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s*$)`,
				"iu",
			).exec(normalized);
	}
	if (!match) return null;
	const start = positions[match.index];
	const end = positions[match.index + match[0].length - 1];
	if (!start || !end) return null;
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset + 1);
	return range;
}

function revealTarget(root: Element, text: string, range: Range | null): HTMLElement | null {
	const direct =
		range?.startContainer.parentElement?.closest<HTMLElement>("[data-narration-reveal]");
	if (direct) return direct;

	const needle = text.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
	const groups = new Map<string, HTMLElement[]>();
	for (const element of root.querySelectorAll<HTMLElement>("[data-narration-reveal]")) {
		const key = element.dataset.narrationReveal ?? "";
		groups.set(key, [...(groups.get(key) ?? []), element]);
	}
	for (const elements of groups.values()) {
		const itemText = [...elements]
			.map((element) => element.textContent ?? "")
			.join(" ")
			.replace(/\s+/gu, " ")
			.trim()
			.toLocaleLowerCase();
		if (needle && itemText.includes(needle)) return elements[0] ?? null;
	}
	return null;
}

function revealNarratedTarget(target: HTMLElement, cardTarget?: NarrationCardTarget): void {
	// Older content can still wrap narrated blocks in native disclosures. Open
	// their ancestors without moving focus; enhanced panels remain island-owned.
	for (
		let details = target.closest("details");
		details;
		details = details.parentElement?.closest("details") ?? null
	) {
		details.open = true;
	}
	target.dispatchEvent(
		new CustomEvent("praxity:narration-reveal", {
			bubbles: true,
			detail: cardTarget ? { cardTarget } : null,
		}),
	);
}

function highlightRegistry(): {
	set(name: string, value: unknown): void;
	delete(name: string): void;
} | null {
	return (
		(
			globalThis.CSS as unknown as {
				highlights?: { set(name: string, value: unknown): void; delete(name: string): void };
			}
		)?.highlights ?? null
	);
}

function highlightConstructor(): (new (...ranges: Range[]) => unknown) | null {
	return (
		(globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight ?? null
	);
}

// Returns null when the playlist item has no real block (page-title segments):
// callers that only need a search scope fall back to root, but the visual
// active-block marker must never land on root and stripe the whole page.
function closestBlock(root: HTMLElement, blockId: string | undefined): HTMLElement | null {
	if (!blockId) return null;
	return root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
}

function cardContainer(root: HTMLElement, blockId: string): HTMLElement | null {
	return (
		root.querySelector<HTMLElement>(`[data-card-root][data-block-id="${CSS.escape(blockId)}"]`) ??
		closestBlock(root, blockId)
	);
}

function narrationScope(root: HTMLElement, item: NarrationPlaylistItem): HTMLElement {
	const block = closestBlock(root, item.blockId);
	// A task clip cannot follow model/hint cues or the learner's rendered answer.
	if (block?.dataset.blockType === "selfCheck")
		return block.querySelector<HTMLElement>(".praxity-assessment-stem") ?? block;
	const turn =
		item.turnIndex !== undefined
			? block?.querySelector<HTMLElement>(`[data-turn-index="${item.turnIndex}"]`)
			: null;
	if (turn) return turn;
	const target = item.cardTargets?.at(-1);
	const container = target ? cardContainer(root, target.containerId) : null;
	const card =
		container && target
			? [
					...container.querySelectorAll<HTMLElement>(`[data-card-index="${target.itemIndex}"]`),
				].find((candidate) => candidate.closest("[data-card-root]") === container)
			: null;
	const face = card
		? ([...card.querySelectorAll<HTMLElement>(`[data-card-side="${target?.side}"]`)].find(
				(candidate) => candidate.closest("[data-card-item]") === card,
			) ?? card)
		: null;
	return face && (!block || block.contains(face)) ? face : (block ?? root);
}

function hasUncommittedAnswer(
	root: HTMLElement | null | undefined,
	item: NarrationPlaylistItem | undefined,
): boolean {
	return (item?.cardTargets ?? []).some((target) => {
		if (target.side !== "back" || !root) return false;
		const container = cardContainer(root, target.containerId);
		const card = [
			...(container?.querySelectorAll<HTMLElement>(`[data-card-index="${target.itemIndex}"]`) ??
				[]),
		].find((candidate) => candidate.closest("[data-card-root]") === container);
		return Boolean(card && card.dataset.flipped !== "true");
	});
}

function nearestScrollport(element: HTMLElement): HTMLElement | null {
	for (let current: HTMLElement | null = element; current; current = current.parentElement) {
		if (
			["auto", "scroll", "hidden"].includes(getComputedStyle(current).overflowY) &&
			current.scrollHeight > current.clientHeight
		)
			return current;
	}
	return document.scrollingElement as HTMLElement | null;
}

export function NarrationBar({
	items,
	eligibleIds,
	stopAfter,
	strings,
	contentRoot,
	alwaysExpanded = false,
	showSentenceControls = true,
	showFollowControl = true,
	settingsMount,
	seekMount,
	controllerRef,
	openingControl,
	beforeSelect,
	onActiveSegment,
	onPlaybackError,
	onPlaybackChange,
	onFollowChange,
	onFollowSuspendedChange,
	mediaRoot,
	scrollContainer,
	onEnded,
	onStop,
	defaultRate,
	onRateChange,
	onFollowActiveChange,
}: NarrationBarProps): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const audioRef = useRef<HTMLAudioElement>(null);
	const playingRef = useRef(false);
	const pausedSeekRef = useRef(false);
	const stoppedAtEndRef = useRef(false);
	const pendingPlayRef = useRef(false);
	const pendingSeekRef = useRef<number | null>(null);
	const playRequestRef = useRef(0);
	const programmaticScrollRef = useRef(false);
	const browseUntilRef = useRef(0);
	const mediaBrowseUntilRef = useRef(0);
	const lastRevealRequestRef = useRef(0);
	const [revealRequest, setRevealRequest] = useState(0);
	const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
	const hitCacheRef = useRef(
		new Map<
			string,
			{ range: Range; rects: Array<{ left: number; right: number; top: number; bottom: number }> }
		>(),
	);
	const controlsId = useId();
	const optionsId = useId();
	const [silenceTooltipOpen, setSilenceTooltipOpen] = useState(false);
	const [optionsExpanded, setOptionsExpanded] = useState(false);
	const [expanded, setExpanded] = useState(alwaysExpanded);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [localTime, setLocalTime] = useState(0);
	const [media, setMedia] = useState(() => {
		const source = items[0]?.src;
		return source && !source.startsWith("praxity-asset:") ? { itemSrc: source, src: source } : null;
	});
	const [durations, setDurations] = useState<number[]>(() => items.map(estimatedDuration));
	const [verifiedDurations, setVerifiedDurations] = useState<boolean[]>(() =>
		items.map((item) => !item.src),
	);
	const [durationProbeFailed, setDurationProbeFailed] = useState(false);
	const [cues, setCues] = useState<ItemCue[]>([]);
	const verifiedDurationsRef = useRef(verifiedDurations);
	const cueRequestsRef = useRef(new Map<number, Promise<ItemCue[]>>());
	const cueAbortRef = useRef(new AbortController());
	const cueClickRef = useRef(0);
	const eligibleIdsRef = useRef(eligibleIds);
	eligibleIdsRef.current = eligibleIds;
	verifiedDurationsRef.current = verifiedDurations;
	const [playbackRate, setPlaybackRate] = useState(() => initialRate(defaultRate));
	const [followOn, setFollowOn] = useState(true);
	const [followSuspended, setFollowSuspended] = useState(false);
	const [hoveredCue, setHoveredCue] = useState<ItemCue | null>(null);
	const eligible = useCallback(
		(index: number) =>
			index >= 0 &&
			index < items.length &&
			(eligibleIds === undefined || eligibleIds.has(items[index].id)),
		[eligibleIds, items],
	);
	const nextEligible = useCallback(
		(start: number) => items.findIndex((_, index) => index >= start && eligible(index)),
		[eligible, items],
	);
	const nextPlayable = useCallback(
		(start: number) =>
			items[start]?.silent
				? -1
				: items.findIndex(
						(item, index) =>
							index >= start &&
							eligible(index) &&
							item.src &&
							!item.silent &&
							item.pageId === items[start]?.pageId,
					),
		[eligible, items],
	);

	const offsets = useMemo(() => {
		let elapsed = 0;
		return durations.map((duration, index) => {
			const start = elapsed;
			if (eligible(index)) elapsed += duration;
			return start;
		});
	}, [durations, eligible]);
	const totalDuration = durations.reduce(
		(total, duration, index) => total + (eligible(index) ? duration : 0),
		0,
	);
	const durationKnown = items.every(
		(item, index) => !eligible(index) || !item.src || verifiedDurations[index],
	);
	const durationStatus = durationProbeFailed
		? strings.durationUnavailable
		: strings.durationLoading;
	const pageTime = Math.min(
		(offsets[currentIndex] ?? 0) + (eligible(currentIndex) ? localTime : 0),
		totalDuration || Number.POSITIVE_INFINITY,
	);
	const currentItem = items[currentIndex];
	const silent =
		currentItem?.silent === true ||
		(currentItem?.pageId !== undefined && nextPlayable(currentIndex) < 0);
	useEffect(() => {
		if (!silent || !silenceTooltipOpen) return;
		const dismiss = (event: KeyboardEvent) => {
			if (event.key === "Escape") setSilenceTooltipOpen(false);
		};
		document.addEventListener("keydown", dismiss);
		return () => document.removeEventListener("keydown", dismiss);
	}, [silent, silenceTooltipOpen]);
	const mediaSrc = media?.itemSrc === currentItem?.src ? media.src : undefined;
	const recordActualDuration = useCallback((index: number, duration: number) => {
		if (!Number.isFinite(duration) || duration <= 0 || verifiedDurationsRef.current[index]) return;
		const nextVerified = verifiedDurationsRef.current.map((value, position) =>
			position === index ? true : value,
		);
		verifiedDurationsRef.current = nextVerified;
		setVerifiedDurations(nextVerified);
		setDurations((current) =>
			current.map((value, position) => (position === index ? duration : value)),
		);
	}, []);
	const currentCues = cues.filter((cue) => cue.itemIndex === currentIndex);
	const hasTimedCues = currentCues.length > 0;
	const activeCue = currentCues.find((cue) => localTime >= cue.start && localTime < cue.end);
	const root =
		contentRoot ??
		containerRef.current
			?.closest(".praxity-viewer-shell")
			?.querySelector<HTMLElement>("#main-content");
	const hitForCue = useCallback(
		(cue: ItemCue) => {
			if (!root || !eligible(cue.itemIndex)) return null;
			const key = `${cue.itemIndex}:${cue.start}:${cue.end}:${cue.text}`;
			const cached = hitCacheRef.current.get(key);
			if (cached) return cached;
			const item = items[cue.itemIndex];
			const range = item ? textRange(narrationScope(root, item), cue.text) : null;
			if (!range) return null;
			const hit = {
				range,
				rects: [...range.getClientRects()].map(({ left, right, top, bottom }) => ({
					left,
					right,
					top,
					bottom,
				})),
			};
			hitCacheRef.current.set(key, hit);
			return hit;
		},
		[eligible, items, root],
	);

	const pause = useCallback(() => {
		playRequestRef.current += 1;
		audioRef.current?.pause();
		playingRef.current = false;
		pendingPlayRef.current = false;
		setIsPlaying(false);
	}, []);

	const pauseForBrowsing = useCallback(() => {
		pause();
		setFollowSuspended(true);
	}, [pause]);

	const play = useCallback(() => {
		const audio = audioRef.current;
		if (hasUncommittedAnswer(mediaRoot ?? root, currentItem)) {
			pause();
			return;
		}
		if (eligibleIds !== undefined && !eligible(currentIndex)) return;
		if (currentItem?.silent || !currentItem?.src) {
			pause();
			return;
		}
		if (!audio || !mediaSrc) {
			pendingPlayRef.current = true;
			return;
		}
		for (const media of (mediaRoot ?? root)?.querySelectorAll<HTMLMediaElement>("audio, video") ??
			[]) {
			if (media !== audio && !media.paused) media.pause();
		}
		const request = ++playRequestRef.current;
		const source = currentItem?.src ?? audio.currentSrc ?? audio.src;
		audio.playbackRate = playbackRate;
		void audio
			.play()
			.then(() => {
				if (request !== playRequestRef.current) return;
				pausedSeekRef.current = false;
				playingRef.current = true;
				setIsPlaying(true);
			})
			.catch((error: unknown) => {
				console.error("[NarrationBar] Failed to play narration", source, error);
				if (request === playRequestRef.current) {
					pause();
					onPlaybackError?.();
				}
			});
	}, [
		currentItem,
		currentItem?.silent,
		currentItem?.src,
		currentIndex,
		eligible,
		eligibleIds,
		mediaRoot,
		mediaSrc,
		onPlaybackError,
		pause,
		playbackRate,
		root,
	]);

	const applyPendingMediaState = useCallback(
		(audio: HTMLAudioElement) => {
			if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
			if (pendingSeekRef.current !== null) {
				audio.currentTime = pendingSeekRef.current;
				pendingSeekRef.current = null;
			}
			if (pendingPlayRef.current) {
				pendingPlayRef.current = false;
				play();
			}
		},
		[play],
	);

	const selectSegment = useCallback(
		(
			index: number,
			nextLocalTime: number,
			shouldPlay: boolean,
			reason: NarrationSelectionReason = "seek",
		) => {
			cueClickRef.current += 1;
			if (!Number.isInteger(index) || !eligible(index)) return false;
			if (hasUncommittedAnswer(mediaRoot ?? root, items[index])) {
				if (reason === "advance") {
					stoppedAtEndRef.current = true;
					pause();
				}
				return false;
			}
			if (beforeSelect?.(index, reason, nextLocalTime) === false) {
				if (reason === "advance") {
					stoppedAtEndRef.current = true;
					pause();
				}
				return false;
			}
			stoppedAtEndRef.current = false;
			if (reason !== "advance") {
				setFollowSuspended(false);
				setRevealRequest((value) => value + 1);
			}
			shouldPlay = shouldPlay && Boolean(items[index]?.src);
			// Keep the chosen paused position while the native decoder settles its clock.
			pausedSeekRef.current = !shouldPlay;
			const nextIndex = Math.max(0, Math.min(index, items.length - 1));
			const nextLocal = Math.max(0, nextLocalTime);
			if (nextIndex === currentIndex) {
				if (audioRef.current) audioRef.current.currentTime = nextLocal;
				setLocalTime(nextLocal);
				if (shouldPlay && !playingRef.current) play();
				if (!shouldPlay) pause();
				onActiveSegment?.(nextIndex);
				return true;
			}
			playRequestRef.current += 1;
			if (!shouldPlay) pause();
			pendingSeekRef.current = nextLocal;
			pendingPlayRef.current = shouldPlay;
			if (!shouldPlay) {
				playingRef.current = false;
				setIsPlaying(false);
			}
			setCurrentIndex(nextIndex);
			setLocalTime(nextLocal);
			onActiveSegment?.(nextIndex);
			return true;
		},
		[beforeSelect, currentIndex, eligible, items, mediaRoot, root, onActiveSegment, pause, play],
	);

	const requestPlay = useCallback(() => {
		setFollowSuspended(false);
		browseUntilRef.current = 0;
		mediaBrowseUntilRef.current = 0;
		if (currentItem?.pageId !== undefined && (stoppedAtEndRef.current || !currentItem.src)) {
			const start = stoppedAtEndRef.current
				? Math.min(currentIndex + 1, items.length - 1)
				: currentIndex;
			const target = nextPlayable(start);
			if (target >= 0) selectSegment(target, 0, true, "play");
			return;
		}
		if (eligibleIds !== undefined && (stoppedAtEndRef.current || !eligible(currentIndex))) {
			const target = nextEligible(currentIndex + 1);
			if (target < 0) return;
			selectSegment(target, 0, true, "play");
			return;
		}
		if (stoppedAtEndRef.current) {
			selectSegment(Math.min(currentIndex + 1, items.length - 1), 0, true, "play");
			return;
		}
		if (
			beforeSelect?.(
				currentIndex,
				"play",
				pendingSeekRef.current ?? audioRef.current?.currentTime ?? localTime,
			) !== false
		)
			play();
	}, [
		beforeSelect,
		currentIndex,
		currentItem?.pageId,
		currentItem?.src,
		eligible,
		eligibleIds,
		items.length,
		localTime,
		nextEligible,
		nextPlayable,
		play,
		selectSegment,
	]);

	const resumeFollow = useCallback(() => {
		setFollowSuspended(false);
		browseUntilRef.current = 0;
		mediaBrowseUntilRef.current = 0;
		setRevealRequest((value) => value + 1);
	}, []);

	useImperativeHandle(
		controllerRef,
		() => ({
			selectSegment: (index) =>
				selectSegment(index, 0, playingRef.current || pendingPlayRef.current, "select"),
			pause,
			togglePlayback: () => {
				if (silent || (!currentItem?.src && currentItem?.pageId === undefined)) return false;
				if (playingRef.current || pendingPlayRef.current) pause();
				else requestPlay();
				return true;
			},
			setFollow: (enabled) => {
				setFollowOn(enabled);
				if (enabled) resumeFollow();
				else setFollowSuspended(false);
			},
			resumeFollow,
		}),
		[
			currentItem?.src,
			currentItem?.pageId,
			silent,
			pause,
			requestPlay,
			resumeFollow,
			selectSegment,
		],
	);

	useEffect(() => {
		onFollowChange?.(followOn);
	}, [followOn, onFollowChange]);

	useEffect(() => {
		if (!eligible(currentIndex) && (playingRef.current || pendingPlayRef.current)) {
			pause();
			stoppedAtEndRef.current = true;
		}
	}, [currentIndex, eligible, pause]);

	useEffect(() => {
		onFollowSuspendedChange?.(followOn && followSuspended);
	}, [followOn, followSuspended, onFollowSuspendedChange]);

	useEffect(() => {
		const source = currentItem?.src;
		if (!source?.startsWith("praxity-asset:")) {
			setMedia(source ? { itemSrc: source, src: source } : null);
			return;
		}

		let cancelled = false;
		setMedia(null);
		// ponytail: Narration clips are small; drop this copy when Electron fixes
		// protocol.handle() streaming for local media.
		void fetch(source)
			.then((response) => {
				if (!response.ok) throw new Error(`Audio request failed with ${response.status}`);
				return response.blob();
			})
			.then(dataUrl)
			.then((resolvedSource) => {
				if (!cancelled) setMedia({ itemSrc: source, src: resolvedSource });
			})
			.catch((error: unknown) => {
				if (!cancelled) console.error("[NarrationBar] Failed to load narration", source, error);
			});
		return () => {
			cancelled = true;
		};
	}, [currentItem?.src]);

	useEffect(() => {
		const initialDurations = items.map(estimatedDuration);
		const initialVerified = items.map((item) => !item.src);
		verifiedDurationsRef.current = initialVerified;
		setDurations(initialDurations);
		setVerifiedDurations(initialVerified);
		setDurationProbeFailed(false);
		setCurrentIndex(0);
		setLocalTime(0);
		setExpanded(alwaysExpanded);
		pausedSeekRef.current = false;
		stoppedAtEndRef.current = false;
		setFollowOn(true);
		setFollowSuspended(false);
		pause();

		return observeSelfCheckLifetime((current) => {
			let cancelled = false;
			let probe: HTMLAudioElement | null = null;
			let finishProbe: (() => void) | undefined;
			let probeTimer: ReturnType<typeof setSelfCheckTimeout> | undefined;
			let idleHandle: number | undefined;
			let fallbackTimer: ReturnType<typeof setSelfCheckTimeout> | undefined;
			let index = 0;
			const next = () => {
				if (cancelled || !current()) return;
				while (index < items.length && verifiedDurationsRef.current[index]) index += 1;
				if (index >= items.length) return;
				const itemIndex = index++;
				const item = items[itemIndex];
				probe = new Audio();
				probe.preload = "metadata";
				const currentProbe = probe;
				const finish = (failed = false) => {
					if (probe !== currentProbe) return;
					if (failed && !cancelled && current()) setDurationProbeFailed(true);
					clearTimeout(probeTimer);
					currentProbe.removeEventListener("loadedmetadata", update);
					currentProbe.removeEventListener("error", reportError);
					currentProbe.removeAttribute("src");
					probe = null;
					finishProbe = undefined;
					next();
				};
				const update = () => {
					const duration = currentProbe.duration;
					const valid = Number.isFinite(duration) && duration > 0;
					if (!cancelled && current() && valid) recordActualDuration(itemIndex, duration);
					finish(!valid);
				};
				const reportError = () => {
					console.error("[NarrationBar] Metadata probe error", item.src, currentProbe.error);
					finish(true);
				};
				currentProbe.addEventListener("loadedmetadata", update);
				currentProbe.addEventListener("error", reportError);
				finishProbe = finish;
				probeTimer = setSelfCheckTimeout(() => finish(true), 10000, current);
				currentProbe.src = item.src;
			};
			const schedule = () => {
				if (window.requestIdleCallback)
					idleHandle = window.requestIdleCallback(next, { timeout: 3000 });
				else fallbackTimer = setSelfCheckTimeout(next, 0, current);
			};
			if (document.readyState === "complete") schedule();
			else window.addEventListener("load", schedule, { once: true });
			return () => {
				cancelled = true;
				window.removeEventListener("load", schedule);
				if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
				clearTimeout(fallbackTimer);
				finishProbe?.();
			};
		});
	}, [alwaysExpanded, items, pause, recordActualDuration]);

	const loadItemCues = useCallback(
		(itemIndex: number): Promise<ItemCue[]> => {
			const pending = cueRequestsRef.current.get(itemIndex);
			if (pending) return pending;
			const item = items[itemIndex];
			if (!item?.timingsSrc) return Promise.resolve([]);
			const signal = cueAbortRef.current.signal;
			const request = fetch(item.timingsSrc, { signal })
				.then(async (response) =>
					response.ok ? (parseNarrationVtt(await response.text()) ?? []) : [],
				)
				.then((result) => result.map((cue) => ({ ...cue, itemIndex })))
				.catch(() => [] as ItemCue[])
				.then((result) => {
					if (!signal.aborted) setCues((current) => [...current, ...result]);
					return signal.aborted ? [] : result;
				});
			cueRequestsRef.current.set(itemIndex, request);
			return request;
		},
		[items],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new playlist must abort and clear old cue requests.
	useEffect(() => {
		cueAbortRef.current.abort();
		cueClickRef.current += 1;
		cueAbortRef.current = new AbortController();
		cueRequestsRef.current.clear();
		setCues([]);
		return () => {
			cueClickRef.current += 1;
			cueAbortRef.current.abort();
		};
	}, [items]);

	useEffect(() => {
		if (!expanded) cueClickRef.current += 1;
	}, [expanded]);

	useEffect(() => {
		eligibleIdsRef.current = eligibleIds;
		cueClickRef.current += 1;
	}, [eligibleIds]);

	useEffect(() => {
		if (!expanded) return;
		void loadItemCues(currentIndex);
		if (showSentenceControls) {
			void loadItemCues(currentIndex - 1);
			void loadItemCues(currentIndex + 1);
		}
	}, [currentIndex, expanded, loadItemCues, showSentenceControls]);

	useEffect(() => {
		const clear = () => hitCacheRef.current.clear();
		clear();
		window.addEventListener("resize", clear);
		window.visualViewport?.addEventListener("resize", clear);
		const releaseObserver = observeSelfCheckLifetime((current) => {
			const observer = root ? createSelfCheckMutationObserver(current, clear) : null;
			if (root) {
				observer?.observe(root, { childList: true, subtree: true, characterData: true });
				observer?.observe(document.documentElement, {
					attributes: true,
					attributeFilter: ["class", "style", "data-praxity-text-size"],
				});
			}
			void document.fonts?.ready.then(() => {
				if (current()) clear();
			});
			return () => observer?.disconnect();
		});
		return () => {
			window.removeEventListener("resize", clear);
			window.visualViewport?.removeEventListener("resize", clear);
			releaseObserver();
		};
	}, [root]);

	useEffect(() => {
		if (!expanded || !currentItem) return;
		const audio = audioRef.current;
		if (!audio || !mediaSrc) return;
		audio.playbackRate = playbackRate;
		applyPendingMediaState(audio);
	}, [applyPendingMediaState, currentItem, expanded, mediaSrc, playbackRate]);

	useEffect(() => {
		return () => pause();
	}, [pause]);

	useEffect(() => {
		onFollowActiveChange?.(isPlaying && followOn && !followSuspended);
		return () => onFollowActiveChange?.(false);
	}, [followOn, followSuspended, isPlaying, onFollowActiveChange]);
	useEffect(() => {
		onPlaybackChange?.(isPlaying);
	}, [isPlaying, onPlaybackChange]);

	useEffect(() => {
		const markers = (currentItem?.cardTargets ?? []).flatMap((target) => {
			const scope = mediaRoot ?? root;
			const container = scope ? cardContainer(scope, target.containerId) : null;
			return container ? [container] : [];
		});
		const scope = mediaRoot ?? root;
		const sourceId = currentItem?.sourceBlockId ?? currentItem?.blockId;
		const source = scope && sourceId ? cardContainer(scope, sourceId) : null;
		const owner =
			source?.closest<HTMLElement>("[data-card-root]") ??
			source?.querySelector<HTMLElement>("[data-card-root]");
		if (owner) markers.push(owner);
		if (isPlaying) for (const container of markers) container.dataset.narrationPlaying = "true";
		return () => {
			for (const container of markers) delete container.dataset.narrationPlaying;
		};
	}, [currentItem, isPlaying, mediaRoot, root]);

	useEffect(() => {
		const scope = mediaRoot ?? root;
		const blockId = currentItem?.sourceBlockId ?? currentItem?.blockId;
		if (!isPlaying || !scope || !blockId || currentItem?.turnIndex === undefined) return;
		const turn = closestBlock(scope, blockId)?.querySelector<HTMLElement>(
			`[data-turn-index="${currentItem.turnIndex}"]`,
		);
		if (!turn) return;
		turn.setAttribute("aria-current", "true");
		return () => turn.removeAttribute("aria-current");
	}, [currentItem, isPlaying, mediaRoot, root]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: playback and Follow transitions invalidate a deferred reveal.
	useEffect(() => {
		const scope = mediaRoot ?? root;
		return () => {
			for (const target of currentItem?.cardTargets ?? []) {
				const container = scope ? cardContainer(scope, target.containerId) : null;
				if (!container) continue;
				delete container.dataset.narrationPendingIndex;
				delete container.dataset.narrationPendingSide;
			}
		};
	}, [currentItem, followOn, followSuspended, isPlaying, mediaRoot, root]);

	useEffect(() => {
		const scope = mediaRoot ?? root;
		if (!scope) return;
		const manual = () => {
			for (const container of scope.querySelectorAll<HTMLElement>(
				"[data-narration-pending-index]",
			)) {
				delete container.dataset.narrationPendingIndex;
				delete container.dataset.narrationPendingSide;
			}
			if (!expanded) return;
			pauseForBrowsing();
		};
		scope.addEventListener("praxity:narration-manual-navigation", manual);
		return () => scope.removeEventListener("praxity:narration-manual-navigation", manual);
	}, [expanded, mediaRoot, pauseForBrowsing, root]);

	useEffect(() => {
		return observeSelfCheckLifetime((current) => {
			const registry = highlightRegistry();
			registry?.delete(HIGHLIGHT_NAME);
			if (!root) return () => {};
			let marker: HTMLElement | null = null;
			const clear = () => {
				registry?.delete(HIGHLIGHT_NAME);
				if (marker) delete marker.dataset.narrationActive;
				for (const element of root.querySelectorAll<HTMLElement>("[data-narration-active]")) {
					delete element.dataset.narrationActive;
				}
			};
			clear();
			const revealRequested = revealRequest !== lastRevealRequestRef.current;
			lastRevealRequestRef.current = revealRequest;
			if (
				!expanded ||
				(!isPlaying && !revealRequested) ||
				!currentItem ||
				!eligible(currentIndex) ||
				!followOn
			)
				return clear;

			const block = closestBlock(root, currentItem.blockId);
			const scope = narrationScope(root, currentItem);
			marker =
				(currentItem.turnIndex !== undefined || block?.dataset.blockType === "selfCheck") &&
				scope !== root
					? scope
					: block;
			let frame: number | null = null;
			const highlightAndScroll = () => {
				// A timing file can contain a short silence between cues. Keep the
				// document neutral there instead of flashing the block fallback marker.
				if (!activeCue && hasTimedCues) return;
				const range = activeCue ? textRange(scope, activeCue.text) : null;
				const forcedColors = forcedPalette();
				const HighlightCtor = highlightConstructor();
				if (range && registry && HighlightCtor && !forcedColors) {
					registry.set(HIGHLIGHT_NAME, new HighlightCtor(range));
				} else if (marker) {
					marker.dataset.narrationActive = "true";
				}

				if (followSuspended) return;
				const rect = range?.getBoundingClientRect() ?? scope.getBoundingClientRect();
				const selection = window.getSelection();
				// A bounded transcript suspends on focus; an explicit seek resumes it
				// while leaving focus on the seek control.
				if (
					(selection && !selection.isCollapsed) ||
					(!scrollContainer &&
						root.contains(document.activeElement) &&
						document.activeElement !== root)
				)
					return;
				const scrollport = scrollContainer ?? nearestScrollport(scope);
				if (scrollContainer && scrollContainer.clientHeight === 0) return;
				const scrollportRect = scrollport
					? scrollport === document.scrollingElement || scrollport === document.documentElement
						? { top: 0, height: scrollport.clientHeight || window.innerHeight }
						: scrollport.getBoundingClientRect()
					: null;
				if (scrollContainer && scrollportRect) {
					const height = scrollContainer.clientHeight;
					const top = scrollportRect.top + scrollContainer.clientTop;
					// Without finer timing, follow the beginning of a passage that cannot
					// fit in the reading band. Do not invent progress through its lines.
					const bottom = rect.height > height * 0.6 ? rect.top : rect.bottom;
					if (
						rect.top >= top + height * 0.15 &&
						bottom <= top + height * 0.75 &&
						(rect.height > height || rect.bottom <= top + height)
					)
						return;
					// The browser clamps to the real start/end without extra blank space.
					const target =
						rect.height <= height ? Math.min(height / 3, height - rect.height) : height / 3;
					browseUntilRef.current = 0;
					mediaBrowseUntilRef.current = 0;
					scrollContainer.scrollBy({ top: rect.top - top - target, behavior: "auto" });
					return;
				}
				if (
					scrollportRect &&
					rect.top >= scrollportRect.top &&
					rect.bottom <= scrollportRect.top + scrollportRect.height
				)
					return;
				browseUntilRef.current = 0;
				mediaBrowseUntilRef.current = 0;
				programmaticScrollRef.current = true;
				if (scrollport && scrollportRect) {
					const delta =
						rect.height > scrollportRect.height
							? rect.top - scrollportRect.top
							: rect.top + rect.height / 2 - (scrollportRect.top + scrollportRect.height / 2);
					scrollport.scrollBy({ top: delta, behavior: "auto" });
				} else {
					scope.scrollIntoView({ block: "center", behavior: "auto" });
				}
				requestSelfCheckFrame(() => {
					programmaticScrollRef.current = false;
				}, current);
			};

			const range = activeCue ? textRange(scope, activeCue.text) : null;
			const source = closestBlock(
				mediaRoot ?? root,
				currentItem.sourceBlockId ?? currentItem.blockId,
			);
			const selectedBlock =
				currentItem.turnIndex === undefined
					? source
					: source?.querySelector<HTMLElement>(`[data-turn-index="${currentItem.turnIndex}"]`);
			const target =
				(activeCue ? revealTarget(scope, activeCue.text, range) : null) ??
				selectedBlock?.closest<HTMLElement>("[data-narration-reveal]");
			const cardTargets = currentItem.cardTargets ?? [];
			if (!followSuspended && cardTargets.length) {
				for (const cardTarget of cardTargets) {
					const container = cardContainer(mediaRoot ?? root, cardTarget.containerId);
					if (container && container.dataset.cardEnhanced !== "true") {
						container.dataset.narrationPendingIndex = String(cardTarget.itemIndex);
						container.dataset.narrationPendingSide = cardTarget.side;
					}
					if (container) revealNarratedTarget(container, cardTarget);
				}
				if (
					target &&
					(scope.contains(target) || (selectedBlock && target.contains(selectedBlock))) &&
					!target.matches("[data-card-index], .praxity-slides-item")
				) {
					revealNarratedTarget(target);
				}
				frame = requestSelfCheckFrame(highlightAndScroll, current);
			} else if (!followSuspended && target && !cardTargets.length) {
				revealNarratedTarget(target);
				frame = requestSelfCheckFrame(highlightAndScroll, current);
			} else {
				highlightAndScroll();
			}
			return () => {
				if (frame !== null) cancelAnimationFrame(frame);
				clear();
			};
		});
	}, [
		activeCue,
		currentIndex,
		currentItem,
		eligible,
		expanded,
		followOn,
		followSuspended,
		hasTimedCues,
		isPlaying,
		root,
		revealRequest,
		mediaRoot,
		scrollContainer,
	]);

	useEffect(() => {
		const registry = highlightRegistry();
		registry?.delete(HOVER_HIGHLIGHT_NAME);
		if (!expanded || !hoveredCue || !root || forcedPalette()) {
			return;
		}
		const hit = hitForCue(hoveredCue);
		const HighlightCtor = highlightConstructor();
		if (hit && registry && HighlightCtor) {
			registry.set(HOVER_HIGHLIGHT_NAME, new HighlightCtor(hit.range));
		}
		return () => registry?.delete(HOVER_HIGHLIGHT_NAME);
	}, [expanded, hitForCue, hoveredCue, root]);

	useEffect(() => {
		if (!root || !expanded) return;
		const inputRoot = scrollContainer ?? root;
		let lastTop = scrollContainer?.scrollTop;
		let pointerDown = false;
		const suspend = scrollContainer ? pauseForBrowsing : () => setFollowSuspended(true);
		const onScroll = (event: Event) => {
			hitCacheRef.current.clear();
			if (scrollContainer) {
				if (event.target !== scrollContainer) return;
				const moved = lastTop !== scrollContainer.scrollTop;
				lastTop = scrollContainer.scrollTop;
				if (moved && performance.now() < browseUntilRef.current) suspend();
			} else if (!programmaticScrollRef.current && performance.now() < browseUntilRef.current) {
				suspend();
			}
		};
		const onInput = () => {
			browseUntilRef.current = performance.now() + 1000;
		};
		const onFocus = () => {
			if (scrollContainer && !pointerDown) suspend();
		};
		const onScrollKey = (event: KeyboardEvent) => {
			if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key))
				queueMicrotask(() => {
					if (!event.defaultPrevented) {
						onInput();
						onFocus();
					}
				});
		};
		const onPointerDown = () => {
			pointerDown = true;
			onInput();
		};
		const onPointerUp = () => {
			pointerDown = false;
		};
		const onSelection = () => {
			const selection = window.getSelection();
			if (
				scrollContainer &&
				selection &&
				!selection.isCollapsed &&
				root.contains(selection.anchorNode)
			)
				suspend();
		};
		document.addEventListener("scroll", onScroll, { capture: true, passive: true });
		inputRoot.addEventListener("wheel", onInput, { passive: true });
		inputRoot.addEventListener("touchmove", onInput, { passive: true });
		inputRoot.addEventListener("keydown", onScrollKey);
		inputRoot.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("pointerup", onPointerUp);
		root.addEventListener("focusin", onFocus);
		document.addEventListener("selectionchange", onSelection);
		return () => {
			document.removeEventListener("scroll", onScroll, true);
			inputRoot.removeEventListener("wheel", onInput);
			inputRoot.removeEventListener("touchmove", onInput);
			inputRoot.removeEventListener("keydown", onScrollKey);
			inputRoot.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("pointerup", onPointerUp);
			root.removeEventListener("focusin", onFocus);
			document.removeEventListener("selectionchange", onSelection);
		};
	}, [expanded, pauseForBrowsing, root, scrollContainer]);

	useEffect(() => {
		if (!expanded || !mediaRoot || mediaRoot === root) return;
		const inSlideContent = (target: EventTarget | null) =>
			target instanceof Element &&
			target !== document.body &&
			target !== document.documentElement &&
			(mediaRoot.contains(target) || target.contains(mediaRoot));
		const onInput = (event: Event) => {
			if (!inSlideContent(event.target)) return;
			if (
				event instanceof KeyboardEvent &&
				!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
			)
				return;
			if (!event.defaultPrevented) mediaBrowseUntilRef.current = performance.now() + 1000;
		};
		const onScroll = (event: Event) => {
			if (inSlideContent(event.target) && performance.now() < mediaBrowseUntilRef.current)
				setFollowSuspended(true);
		};
		// Slide content can scroll inside main or its workspace ancestor after reflow.
		for (const type of ["wheel", "touchmove", "pointerdown", "keydown"])
			document.addEventListener(type, onInput);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			for (const type of ["wheel", "touchmove", "pointerdown", "keydown"])
				document.removeEventListener(type, onInput);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [expanded, mediaRoot, root]);

	const seekPage = useCallback(
		(nextPageTime: number, keepPlaying = playingRef.current) => {
			const first = nextEligible(0);
			if (first < 0) return;
			if (totalDuration === 0) {
				selectSegment(eligible(currentIndex) ? currentIndex : first, nextPageTime, keepPlaying);
				return;
			}
			const bounded = Math.max(0, Math.min(nextPageTime, totalDuration || nextPageTime));
			let nextIndex = first;
			for (let index = 0; index < items.length; index += 1) {
				if (!eligible(index)) continue;
				nextIndex = index;
				if (bounded < (offsets[index] ?? 0) + (durations[index] ?? 0)) break;
			}
			const nextLocal = Math.max(0, bounded - (offsets[nextIndex] ?? 0));
			selectSegment(nextIndex, nextLocal, keepPlaying);
		},
		[
			currentIndex,
			durations,
			eligible,
			items.length,
			nextEligible,
			offsets,
			selectSegment,
			totalDuration,
		],
	);

	// ponytail: Numeric page-time points cannot disambiguate partially loaded durations;
	// use structured { pageTime, itemIndex, localTime } points if that navigation must work.
	const sentencePoints = useMemo(() => {
		const points: number[] = [];
		for (let index = 0; index < items.length; index += 1) {
			if (!eligible(index)) continue;
			const itemCues = cues.filter((cue) => cue.itemIndex === index);
			if (itemCues.length === 0) points.push(offsets[index] ?? 0);
			else for (const cue of itemCues) points.push((offsets[index] ?? 0) + cue.start);
		}
		return points;
	}, [cues, eligible, items.length, offsets]);
	const previousSentence = useCallback(
		() => seekPage([...sentencePoints].reverse().find((time) => time < pageTime - 0.25) ?? 0),
		[pageTime, seekPage, sentencePoints],
	);
	const nextSentence = useCallback(
		() => seekPage(sentencePoints.find((time) => time > pageTime + 0.05) ?? totalDuration),
		[pageTime, seekPage, sentencePoints, totalDuration],
	);

	useEffect(() => {
		const mediaSession = navigator.mediaSession;
		if (!expanded || !mediaSession) return;
		const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
			["previoustrack", previousSentence],
			["nexttrack", nextSentence],
			["play", requestPlay],
			["pause", pause],
		];
		for (const [action, handler] of handlers) mediaSession.setActionHandler(action, handler);
		return () => {
			for (const [action] of handlers) mediaSession.setActionHandler(action, null);
		};
	}, [expanded, nextSentence, pause, requestPlay, previousSentence]);

	useEffect(() => {
		if (!root || !expanded) return;
		const blockedTarget = (target: EventTarget | null) =>
			target instanceof Element &&
			Boolean(
				target.closest(
					"a, button, input, textarea, select, [role='button'], [role='link'], [role='option'], [data-block-type='assessment']",
				),
			);
		const cueAt = (x: number, y: number, available = cues) =>
			available.find(
				(cue) =>
					eligible(cue.itemIndex) &&
					hitForCue(cue)?.rects.some(
						(rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
					),
			);
		const onPointerDown = (event: PointerEvent) => {
			pointerStartRef.current = { x: event.clientX, y: event.clientY };
		};
		const onPointerMove = (event: PointerEvent) => {
			setHoveredCue(
				blockedTarget(event.target) || !window.getSelection()?.isCollapsed
					? null
					: (cueAt(event.clientX, event.clientY) ?? null),
			);
		};
		const onPointerLeave = () => setHoveredCue(null);
		const onPointerUp = (event: PointerEvent) => {
			const start = pointerStartRef.current;
			pointerStartRef.current = null;
			if (
				!start ||
				Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 ||
				!(event.target instanceof Element) ||
				blockedTarget(event.target) ||
				!window.getSelection()?.isCollapsed
			) {
				return;
			}
			const click = ++cueClickRef.current;
			const cue = cueAt(event.clientX, event.clientY);
			if (cue) {
				selectSegment(cue.itemIndex, cue.start, playingRef.current);
				return;
			}
			const target = event.target;
			const candidates = items.flatMap((item, index) => {
				if (!eligible(index)) return [];
				const scope = narrationScope(root, item);
				return item.timingsSrc && scope !== root && scope.contains(target) ? [index] : [];
			});
			if (candidates.length === 0) return;
			void Promise.all(candidates.map(loadItemCues)).then((loaded) => {
				if (cueClickRef.current !== click) return;
				const found = cueAt(event.clientX, event.clientY, loaded.flat());
				if (
					found &&
					(eligibleIdsRef.current === undefined ||
						eligibleIdsRef.current.has(items[found.itemIndex].id))
				)
					selectSegment(found.itemIndex, found.start, playingRef.current);
			});
		};
		root.addEventListener("pointerdown", onPointerDown);
		root.addEventListener("pointermove", onPointerMove, { passive: true });
		root.addEventListener("pointerup", onPointerUp);
		root.addEventListener("pointerleave", onPointerLeave);
		return () => {
			root.removeEventListener("pointerdown", onPointerDown);
			root.removeEventListener("pointermove", onPointerMove);
			root.removeEventListener("pointerup", onPointerUp);
			root.removeEventListener("pointerleave", onPointerLeave);
			setHoveredCue(null);
		};
	}, [cues, eligible, expanded, hitForCue, items, loadItemCues, root, selectSegment]);

	useEffect(() => {
		const coordinationRoot = mediaRoot ?? root;
		if (!coordinationRoot) return;
		const stopForPageMedia = (event: Event) => {
			if (event.target instanceof HTMLMediaElement && event.target !== audioRef.current) pause();
		};
		coordinationRoot.addEventListener("play", stopForPageMedia, true);
		return () => coordinationRoot.removeEventListener("play", stopForPageMedia, true);
	}, [mediaRoot, pause, root]);

	const handleEnded = useCallback(() => {
		if (eligibleIds !== undefined) {
			if (!eligible(currentIndex)) {
				pause();
				stoppedAtEndRef.current = true;
				return;
			}
			const authoredIndex = (index: number) => items[index]?.authoredIndex ?? index;
			const stopBefore = (from: number, to: number) =>
				stopAfter !== undefined &&
				[...stopAfter].some(
					(position) => position > authoredIndex(from) && position <= authoredIndex(to),
				);
			const next = nextEligible(currentIndex + 1);
			if (next >= 0 && stopBefore(currentIndex, next)) {
				onStop?.();
				stoppedAtEndRef.current = true;
				pause();
				setLocalTime(durations[currentIndex] ?? localTime);
				return;
			}
			if (next >= 0) {
				selectSegment(next, 0, true, "advance");
				return;
			}
			if (stopAfter && [...stopAfter].some((position) => position > authoredIndex(currentIndex))) {
				onStop?.();
				stoppedAtEndRef.current = true;
				pause();
				setLocalTime(durations[currentIndex] ?? localTime);
				return;
			}
			pause();
			setLocalTime(durations[currentIndex] ?? localTime);
			onEnded?.();
			return;
		}
		if (alwaysExpanded && currentItem?.pauseAfter) {
			onStop?.();
			stoppedAtEndRef.current = true;
			pause();
			setLocalTime(durations[currentIndex] ?? localTime);
			return;
		}
		if (!currentItem || currentIndex >= items.length - 1) {
			pause();
			setLocalTime(durations[currentIndex] ?? localTime);
			onEnded?.();
			return;
		}
		selectSegment(currentIndex + 1, 0, !currentItem.pauseAfter, "advance");
	}, [
		alwaysExpanded,
		currentIndex,
		currentItem,
		durations,
		eligible,
		eligibleIds,
		items,
		items.length,
		localTime,
		nextEligible,
		onEnded,
		onStop,
		pause,
		selectSegment,
		stopAfter,
	]);

	const cyclePlaybackRate = useCallback(() => {
		const current = PLAYBACK_RATES.indexOf(playbackRate as (typeof PLAYBACK_RATES)[number]);
		const next = PLAYBACK_RATES[(current + 1) % PLAYBACK_RATES.length];
		setPlaybackRate(next);
		onRateChange?.(next);
	}, [onRateChange, playbackRate]);

	/*
	 * Narration disclosure — settled 2026-08-31
	 * SHIPPED: reading-tools icon before grouped transport controls in the same
	 * bar; playback-only highlighting. DOM order matches the responsive visual
	 * order: Listen, play, position, then options. On narrow screens, an inline
	 * disclosure keeps secondary controls out of the primary playback row.
	 * Guided chrome, 2026-10-01: its shell supplies sentence/follow controls, so
	 * speed stays inline and the shell retains the only options disclosure.
	 * Opening Play and transport Play retain their existing shared command and
	 * reading-protection stops. Pages retains Listen and inline narration options.
	 * REJECTED: floating popover card; hidden slab after main; full script in a
	 * live region; a status note for missing cue timings; controls before the
	 * Listen toggle (the narrow layout splits the player into header and row).
	 * VERIFIED: published Chromium and WebKit accessibility tests.
	 */

	const timeDisplay = (
		<span
			role="timer"
			className={`praxity-narration-time${durationKnown ? "" : " praxity-narration-time-status"}`}
			aria-label={settingsMount?.timeLabel}
		>
			{durationKnown ? `${formatTime(pageTime)} / ${formatTime(totalDuration)}` : durationStatus}
		</span>
	);
	const seekControl = (
		<input
			type="range"
			min={0}
			max={durationKnown ? totalDuration : 1}
			step="any"
			value={durationKnown ? Math.min(pageTime, totalDuration) : 0}
			disabled={!durationKnown}
			onChange={(event) => seekPage(Number(event.currentTarget.value))}
			// Native range controls emit no change at an unchanged boundary.
			onKeyUp={(event) => {
				if (
					!eligible(currentIndex) &&
					["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
				)
					seekPage(Number(event.currentTarget.value));
			}}
			onPointerUp={(event) => {
				if (!eligible(currentIndex)) seekPage(Number(event.currentTarget.value));
			}}
			aria-label={strings.seek}
			aria-valuetext={
				durationKnown ? `${formatTime(pageTime)} / ${formatTime(totalDuration)}` : durationStatus
			}
		/>
	);
	const speedLabel = settingsMount?.speedLabel ?? strings.speed;
	const speedControl = (
		<button
			type="button"
			className="praxity-narration-speed"
			onClick={cyclePlaybackRate}
			aria-label={`${speedLabel}: ${playbackRate}×`}
			title={`${speedLabel}: ${playbackRate}×`}
		>
			{settingsMount && <span>{speedLabel}</span>}
			<span>{playbackRate}×</span>
		</button>
	);
	return (
		<>
			{seekMount &&
				createPortal(<div className="praxity-narration-position">{seekControl}</div>, seekMount)}
			{settingsMount &&
				createPortal(
					<div className="praxity-narration-settings">
						{durationKnown && timeDisplay}
						{speedControl}
					</div>,
					settingsMount.element,
				)}
			{openingControl &&
				createPortal(
					<button
						type="button"
						className="deck-opening-narration"
						style={{
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							gap: "0.5rem",
							minHeight: 48,
							maxWidth: "100%",
							padding: "0.625rem 1.25rem",
							border:
								"1.5px solid var(--praxity-color-button-outline, var(--praxity-color-button-background, #4269d0))",
							borderRadius: "var(--praxity-radius-action, 40px)",
							background: "var(--praxity-color-button-background, #4269d0)",
							color: "var(--praxity-color-button-text, #fff)",
							font: "inherit",
							lineHeight: 1.4,
							cursor: "pointer",
						}}
						onClick={() => {
							if (isPlaying) pause();
							else if (!currentItem?.src)
								selectSegment(openingControl.firstPlayable, 0, true, "play");
							else requestPlay();
						}}
					>
						{isPlaying ? (
							<IconPlayerPause size={20} stroke={1.75} aria-hidden="true" />
						) : (
							<IconPlayerPlay size={20} stroke={1.75} aria-hidden="true" />
						)}
						{isPlaying ? openingControl.pause : openingControl.play}
					</button>,
					openingControl.mount,
				)}
			<div ref={containerRef} className="praxity-narration">
				{!alwaysExpanded && (
					<button
						type="button"
						className="praxity-narration-toggle"
						aria-label={strings.listen}
						title={strings.listen}
						aria-expanded={expanded}
						aria-controls={controlsId}
						data-active={expanded || undefined}
						onClick={() => {
							if (expanded) pause();
							setOptionsExpanded(false);
							setExpanded((open) => !open);
						}}
					>
						<IconHeadphones size={20} stroke={1.75} aria-hidden="true" />
					</button>
				)}
				{expanded ? (
					<section
						id={controlsId}
						className="praxity-narration-controls"
						aria-label={strings.narrationLabel}
					>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: hover persistence complements the button focus handlers */}
						<div
							className="praxity-narration-transport"
							style={{ position: "relative" }}
							onMouseLeave={(event) => {
								if (!event.currentTarget.contains(document.activeElement))
									setSilenceTooltipOpen(false);
							}}
						>
							<button
								type="button"
								onClick={silent ? undefined : isPlaying ? pause : requestPlay}
								aria-disabled={silent || undefined}
								style={
									silent
										? {
												background: "var(--praxity-color-surface, #fff)",
												color: "var(--praxity-color-text, #1f2900)",
												cursor: "default",
											}
										: undefined
								}
								aria-label={silent ? strings.noNarration : isPlaying ? strings.pause : strings.play}
								title={silent ? undefined : isPlaying ? strings.pause : strings.play}
								onMouseEnter={() => setSilenceTooltipOpen(true)}
								onFocus={() => setSilenceTooltipOpen(true)}
								onBlur={() => setSilenceTooltipOpen(false)}
							>
								{silent ? (
									<IconHeadphonesOff size={20} stroke={1.75} opacity={0.5} aria-hidden="true" />
								) : isPlaying ? (
									<IconPlayerPause size={20} stroke={1.75} aria-hidden="true" />
								) : (
									<IconPlayerPlay size={20} stroke={1.75} aria-hidden="true" />
								)}
							</button>
							{silent && silenceTooltipOpen && (
								<div
									role="tooltip"
									className="inline-tooltip-popover praxity-floating-layer"
									data-visible=""
									style={{
										bottom: "100%",
										insetInlineStart: 0,
										width: "max-content",
										maxWidth: "min(320px, calc(100vw - 32px))",
									}}
								>
									{strings.noNarration}
								</div>
							)}
						</div>
						<div className="praxity-narration-position">
							{!seekMount && seekControl}
							{!settingsMount && timeDisplay}
						</div>
						<button
							type="button"
							className="praxity-narration-options-toggle"
							aria-label={strings.narrationOptions}
							title={strings.narrationOptions}
							aria-expanded={optionsExpanded}
							aria-controls={optionsId}
							onClick={() => setOptionsExpanded((open) => !open)}
						>
							<IconDots size={20} stroke={1.75} aria-hidden="true" />
						</button>
						<div id={optionsId} className="praxity-narration-options">
							{showSentenceControls && (
								<>
									<button
										type="button"
										onClick={previousSentence}
										aria-label={strings.previousSentence}
										title={strings.previousSentence}
									>
										<IconPlayerSkipBack size={20} stroke={1.75} aria-hidden="true" />
									</button>
									<button
										type="button"
										onClick={nextSentence}
										aria-label={strings.nextSentence}
										title={strings.nextSentence}
									>
										<IconPlayerSkipForward size={20} stroke={1.75} aria-hidden="true" />
									</button>
								</>
							)}
							{!settingsMount && speedControl}
							{showFollowControl && (
								<button
									type="button"
									onClick={() => {
										setFollowOn((value) => !value);
										if (!followOn) resumeFollow();
										else setFollowSuspended(false);
									}}
									aria-pressed={followOn}
									aria-label={strings.followNarration}
									title={strings.followNarration}
									data-active={followOn || undefined}
								>
									<IconArrowAutofitDown size={20} stroke={1.75} aria-hidden="true" />
								</button>
							)}
						</div>
					</section>
				) : null}
			</div>
			{/* biome-ignore lint/a11y/useMediaCaption: VTT drives navigation and highlighting, not captions. */}
			<audio
				ref={audioRef}
				src={mediaSrc}
				preload="metadata"
				hidden
				data-narration-player="true"
				onPlay={() => {
					pausedSeekRef.current = false;
					playingRef.current = true;
					setIsPlaying(true);
				}}
				onPause={() => {
					playingRef.current = false;
					setIsPlaying(false);
				}}
				onEnded={handleEnded}
				onError={(event) => {
					pause();
					if (currentItem?.src) onPlaybackError?.();
					console.error(
						"[NarrationBar] Media error",
						currentItem?.src ?? event.currentTarget.currentSrc ?? event.currentTarget.src,
						event.currentTarget.error,
					);
				}}
				onLoadedMetadata={(event) => {
					recordActualDuration(currentIndex, event.currentTarget.duration);
					applyPendingMediaState(event.currentTarget);
				}}
				onTimeUpdate={(event) => {
					if (pendingSeekRef.current === null && !pausedSeekRef.current)
						setLocalTime(event.currentTarget.currentTime);
				}}
			/>
		</>
	);
}
