import {
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
import {
	NarrationBar,
	type NarrationController,
	type NarrationPlaylistItem,
	type NarrationStrings,
} from "@praxity/shared-blocks/viewer/narration-bar";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { mountAudioPlayer } from "./media-audio-player";

declare global {
	interface Window {
		__PRAXITY_STRINGS__?: Record<string, string>;
	}
}

interface NarrationConfig {
	narrationPlaylist?: {
		items?: NarrationPlaylistItem[];
		stops?: Array<{
			after: number;
			blockId: string;
			ancestorBlockIds?: string[];
			conditionalBlockId?: string;
		}>;
	};
}

const RATE_STORAGE_KEY = "praxity-narration-rate";
const stringKeys = [
	"play",
	"pause",
	"seek",
	"durationLoading",
	"durationUnavailable",
	"speed",
	"narrationLabel",
	"narrationOptions",
	"noNarration",
	"listen",
	"previousSentence",
	"nextSentence",
	"followNarration",
] as const satisfies readonly (keyof NarrationStrings)[];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readConfig(): NarrationConfig {
	const raw = document.getElementById("praxity-config")?.textContent;
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		return isRecord(parsed) ? (parsed as NarrationConfig) : {};
	} catch {
		return {};
	}
}

function readStrings(): NarrationStrings | null {
	const source = window.__PRAXITY_STRINGS__;
	if (!source || stringKeys.some((key) => typeof source[key] !== "string")) return null;
	return Object.fromEntries(
		stringKeys.map((key) => [key, source[key]]),
	) as unknown as NarrationStrings;
}

function readRate(): number {
	try {
		return Number(sessionStorage.getItem(RATE_STORAGE_KEY)) || 1;
	} catch {
		return 1;
	}
}

function writeRate(rate: number): void {
	try {
		sessionStorage.setItem(RATE_STORAGE_KEY, String(rate));
	} catch {
		// Playback still works when an LMS blocks storage.
	}
}

function focusTargets(): HTMLElement[] {
	return [
		...new Set([
			document.documentElement,
			...document.querySelectorAll<HTMLElement>("[data-praxity-root]"),
		]),
	];
}

export function isNarrationEligible(
	root: HTMLElement,
	blockId: string,
	ancestorBlockIds: readonly string[] = [],
): boolean {
	for (const id of [blockId, ...ancestorBlockIds]) {
		const block = root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
		for (
			let node: HTMLElement | null = block;
			node && root.contains(node);
			node = node.parentElement
		) {
			if (node.hidden && node.matches("[data-block-id], .praxity-section")) return false;
		}
	}
	return true;
}

export function activeStopPositions(
	root: HTMLElement,
	stops: ReadonlyArray<{
		after: number;
		blockId: string;
		ancestorBlockIds?: readonly string[];
		conditionalBlockId?: string;
	}>,
): ReadonlySet<number> {
	return new Set(
		stops
			.filter(
				(stop) =>
					isNarrationEligible(root, stop.blockId, stop.ancestorBlockIds) &&
					(!stop.conditionalBlockId || isNarrationEligible(root, stop.conditionalBlockId)),
			)
			.map((stop) => stop.after),
	);
}

export function initNarrationIsland(scope: ParentNode = document): () => void {
	const config = readConfig();
	const strings = readStrings();
	if (!strings) return () => {};
	const cleanups: Array<() => void> = [];
	for (const mount of scope.querySelectorAll<HTMLElement>("[data-audio-player]")) {
		const src = mount.dataset.audioSrc;
		if (!src || mount.dataset.audioEnhanced === "true") continue;
		mount.dataset.audioEnhanced = "true";
		const unmount = mountAudioPlayer(mount, src, strings);
		cleanups.push(() => {
			unmount();
			delete mount.dataset.audioEnhanced;
		});
	}
	const items = Array.isArray(config.narrationPlaylist?.items)
		? config.narrationPlaylist.items.filter(
				(item) =>
					isRecord(item) &&
					typeof item.id === "string" &&
					typeof item.src === "string" &&
					(item.blockId === undefined || typeof item.blockId === "string") &&
					(item.ancestorBlockIds === undefined ||
						(Array.isArray(item.ancestorBlockIds) &&
							item.ancestorBlockIds.every((id) => typeof id === "string"))) &&
					(item.conditionalBlockId === undefined || typeof item.conditionalBlockId === "string"),
			)
		: [];
	const stops = Array.isArray(config.narrationPlaylist?.stops)
		? config.narrationPlaylist.stops.filter(
				(stop) =>
					isRecord(stop) &&
					Number.isInteger(stop.after) &&
					stop.after >= 0 &&
					typeof stop.blockId === "string" &&
					(stop.ancestorBlockIds === undefined ||
						(Array.isArray(stop.ancestorBlockIds) &&
							stop.ancestorBlockIds.every((id) => typeof id === "string"))) &&
					(stop.conditionalBlockId === undefined || typeof stop.conditionalBlockId === "string"),
			)
		: [];
	const contentRoot = document.getElementById("main-content");
	if (items.length === 0 || !contentRoot) return () => cleanups.forEach((cleanup) => cleanup());
	const suppressedFocusTargets = new Set<HTMLElement>();
	const setFollowActive = (active: boolean) => {
		if (active) {
			for (const target of focusTargets()) {
				if (target.dataset.praxityFocusMode === "true") suppressedFocusTargets.add(target);
				delete target.dataset.praxityFocusMode;
			}
			return;
		}
		for (const target of suppressedFocusTargets) target.dataset.praxityFocusMode = "true";
		suppressedFocusTargets.clear();
	};

	for (const mount of scope.querySelectorAll<HTMLElement>('[data-island="narration"]')) {
		if (mount.dataset.blockType === "audio") continue;
		if (mount.dataset.narrationEnhanced === "true") continue;
		mount.dataset.narrationEnhanced = "true";
		const root = createRoot(mount);
		const controller = createRef<NarrationController>();
		const renderPlayer = () =>
			flushSync(() => {
				const eligibleIds = new Set(
					items
						.filter(
							(item) =>
								item.id === "page-title" ||
								(typeof item.blockId === "string" &&
									isNarrationEligible(contentRoot, item.blockId, item.ancestorBlockIds) &&
									(!item.conditionalBlockId ||
										isNarrationEligible(contentRoot, item.conditionalBlockId))),
						)
						.map((item) => item.id),
				);
				root.render(
					<NarrationBar
						items={items}
						eligibleIds={eligibleIds}
						stopAfter={activeStopPositions(contentRoot, stops)}
						controllerRef={controller}
						strings={strings}
						contentRoot={contentRoot}
						defaultRate={readRate()}
						onRateChange={writeRate}
						onFollowActiveChange={setFollowActive}
					/>,
				);
			});
		renderPlayer();
		const onVisibilityChange = () => renderPlayer();
		const onAssessmentSubmit = (event: Event) => {
			const current = selfCheckEpochTicket(document, event);
			if (current()) controller.current?.pause();
		};
		document.addEventListener("praxity:visibility-change", onVisibilityChange);
		document.addEventListener("praxity:assessment-response", onAssessmentSubmit);
		document.addEventListener("praxity:assessment-group-complete", onAssessmentSubmit);
		mount.setAttribute("data-hydrated", "");
		cleanups.push(() => {
			document.removeEventListener("praxity:visibility-change", onVisibilityChange);
			document.removeEventListener("praxity:assessment-response", onAssessmentSubmit);
			document.removeEventListener("praxity:assessment-group-complete", onAssessmentSubmit);
			root.unmount();
			delete mount.dataset.narrationEnhanced;
		});
	}

	return () => {
		for (const cleanup of cleanups) cleanup();
		setFollowActive(false);
	};
}

export { initNarrationIsland as attachIsland };

if (shouldAttachIslandAutomatically()) initNarrationIsland();
