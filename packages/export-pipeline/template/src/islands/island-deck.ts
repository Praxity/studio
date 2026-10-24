import { type DeckDesign, resolveDeckDesign } from "@praxity/grammar/src/deck-design.ts";
import { getStrings, interpolate } from "@praxity/shared-blocks/i18n/strings";
import {
	learnerRuntime,
	learnerTracker,
	readLearnerBlockPolicy,
} from "@praxity/shared-blocks/learner-block-state";
import {
	createSelfCheckResizeObserver,
	dispatchSelfCheckEvent,
	isSelfCheckForwardBlocked,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckConsumers,
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
import { afterSelfCheckFinalization } from "@praxity/shared-blocks/self-check-finalization";
import type {
	NarrationPlaylistItem,
	NarrationStrings,
} from "@praxity/shared-blocks/viewer/narration-bar";
import {
	consumePageNavigationFocus,
	markPageNavigationFocus,
} from "@praxity/shared-blocks/viewer/navigate-page";
import { showRequiredValidation } from "@praxity/shared-blocks/viewer/required-blocks";
import { DEFAULT_COURSE_HOME_URL } from "../../../src/course-home";
import { readCourseSessionTime } from "../../../src/course-session-time";
import type { DeckPage } from "../../../src/module-deck";
import { deckStrings, nextModuleLabel } from "../../../src/module-deck-strings";
import type { SCORMRuntime } from "../../../src/scorm/types";
import {
	formatCourseSessionTime,
	renderCourseCompletionResult,
} from "../components/course-completion-result";
import {
	bindDeckControls,
	type DeckControlActivation,
} from "../components/deck-control-activation";
import { updateBoundaryNavigation } from "../components/navigation-boundary-focus";
import { focusNavigationContent, resumeFocusTarget } from "../components/navigation-content-focus";
import { presentScormResumeCue, removeScormResumeCue } from "../components/scorm-resume-focus";
import { warmPaneImages } from "../components/warm-pane-images";
import { enhanceDisclosure } from "../disclosure";
import { mountDeckNarration } from "./deck-narration";
import { initializeFloatingToc } from "./floating-toc";

const ACCESS_NOTICE_PARAM = "praxity-deck-redirect";

type AccessNotice = "gate" | "sequence";

enum MoveReason {
	Navigation = "navigation",
	NarrationSelection = "select",
	NarrationSeek = "seek",
	NarrationPlay = "play",
	AutomaticAdvance = "advance",
	Restore = "restore",
}

const narrationMoveReason = {
	select: MoveReason.NarrationSelection,
	seek: MoveReason.NarrationSeek,
	play: MoveReason.NarrationPlay,
	advance: MoveReason.AutomaticAdvance,
};

/** Deck access never uses listening time. */
export function gateSatisfied(
	rule: "attempt" | "pass",
	correct: boolean | undefined,
	exhausted = false,
): boolean {
	return rule === "attempt" || correct === true || exhausted;
}

export function initDeck(): (() => void) | undefined {
	const mount = selfCheckEpochTicket();
	if (
		document.documentElement.hasAttribute("data-self-check-dependencies") &&
		!selfCheckConsumers()?.settled()
	) {
		let cleanup: (() => void) | undefined;
		let initialized = false;
		const release = afterSelfCheckFinalization(
			document,
			(ticket) => {
				if (initialized || !ticket.current()) return;
				initialized = true;
				cleanup = initDeck();
			},
			"settled",
		);
		return () => {
			release();
			cleanup?.();
		};
	}
	const hashId = () => {
		try {
			return decodeURIComponent(location.hash.slice(1));
		} catch {
			return "";
		}
	};
	const root = document.querySelector<HTMLElement>(".praxity-deck");
	if (!root || root.dataset.ready) return;
	const raw = document.getElementById("praxity-config")?.textContent;
	if (!raw) return;
	let config: {
		deckPages?: DeckPage[];
		deckDesign?: DeckDesign;
		courseId?: string;
		sourceLocale: string;
		navKeyboardArrows?: boolean;
	};
	try {
		config = JSON.parse(raw);
	} catch {
		return;
	}
	const design = resolveDeckDesign(config.deckDesign);
	const pages = config.deckPages;
	if (!pages?.length) return;
	const panelPreferenceKey =
		typeof config.courseId === "string" && config.courseId
			? `praxity:deck-panel:${encodeURIComponent(config.courseId)}`
			: null;
	const readPanelPreference = () => {
		if (!panelPreferenceKey) return null;
		try {
			const value = localStorage.getItem(panelPreferenceKey);
			if (value === "script" || value === "outline" || value === "closed") return value;
		} catch {
			// Locked-down LMS frames may deny web storage.
		}
		return null;
	};
	const savePanelPreference = (panel: "script" | "outline" | null) => {
		if (!panelPreferenceKey) return;
		try {
			localStorage.setItem(panelPreferenceKey, panel ?? "closed");
		} catch {
			// Keep the panel usable when storage is unavailable.
		}
	};
	const inspection = new URL(location.href).searchParams.get("praxity-inspect") === "1";
	const resume = inspection ? undefined : window.__praxityResume;
	if (!inspection && (!learnerRuntime(mount) || !learnerTracker(mount))) return;
	const navigationArrival = consumePageNavigationFocus();
	const t = deckStrings(config.sourceLocale);
	const localeStrings = getStrings(config.sourceLocale);
	const find = <T extends HTMLElement>(id: string): T => {
		const element = root.querySelector<T>(`#deck-${id}`);
		if (!element) throw new Error(`Missing deck control: ${id}`);
		return element;
	};
	const scrollContainer = find("script-scroll");
	const readings = [...scrollContainer.querySelectorAll<HTMLElement>("[data-deck-reading]")];
	const status = find("status");
	const setStatus = (message: string, kind?: "paused" | "gate" | "error") => {
		if (kind === "paused" && status.dataset.kind === "gate") return;
		if (kind) status.dataset.kind = kind;
		else delete status.dataset.kind;
		status.textContent = message;
		updateGateNotice();
	};
	const follow = find<HTMLButtonElement>("follow");
	const advance = find<HTMLButtonElement>("advance");
	const resumeFollow = find<HTMLButtonElement>("resume-follow");
	const resumeRow = find("resume-follow-row");
	const resumeHome = document.createElement("template");
	resumeRow.before(resumeHome);
	resumeRow.hidden = false;
	resumeRow.inert = true;
	resumeRow.setAttribute("aria-hidden", "true");
	const followStatus = find("follow-status");
	follow.setAttribute("aria-pressed", String(design.followNarration));
	advance.setAttribute("aria-checked", String(design.autoAdvance));
	const advanceStatus = find("advance-status");
	const syncAdvanceStatus = () => {
		advanceStatus.hidden = advance.getAttribute("aria-checked") !== "true";
	};
	syncAdvanceStatus();
	find("position").hidden = !design.slideCounter;
	const slides = [...root.querySelectorAll<HTMLElement>("[data-deck-slide]")];
	const localIds = new Set(slides.map((slide) => slide.dataset.deckSlide ?? ""));
	const localPages = pages.filter((page) => localIds.has(page.id));
	const slidePosition = (page: DeckPage) =>
		interpolate(localeStrings.slideAnnouncement, {
			current: localPages.indexOf(page) + 1,
			total: localPages.length,
		});
	const firstLocal = pages.findIndex((page) => localIds.has(page.id));
	const lastLocal = firstLocal + localPages.length - 1;
	if (firstLocal < 0) return;
	const released = new Set<string>();
	const validGates = new Set(pages.flatMap((page) => page.gates.map((gate) => gate.id)));
	const selfCheckIds = new Set(
		[...root.querySelectorAll<HTMLElement>('[data-block-type="selfCheck"]')].map(
			(block) => block.dataset.blockId,
		),
	);
	for (const page of pages)
		for (const gate of page.gates)
			if (selfCheckConsumers()?.read(gate.id)) selfCheckIds.add(gate.id);
	const canPersistGate = (id: string) => {
		const policy = readLearnerBlockPolicy(id);
		// Self-check reporting requires explicit host permission, including missing-provider paths.
		return policy !== "device" && (!selfCheckIds.has(id) || policy === "lms");
	};
	try {
		const saved = JSON.parse(learnerRuntime(mount)?.getSuspendData?.() || "{}");
		if (Array.isArray(saved?.deck?.released))
			for (const id of saved.deck.released)
				if (typeof id === "string" && validGates.has(id) && canPersistGate(id)) released.add(id);
	} catch {
		/* Invalid saved state starts with locked gates. */
	}
	const visited = new Set(
		(learnerRuntime(mount)?.getVisitedPages?.() ?? []).filter((id) =>
			pages.some((page) => page.id === id),
		),
	);
	// Existing recorded responses can restore earned access without inventing attempts.
	for (const response of (learnerRuntime(mount) as SCORMRuntime | undefined)?.getInteractions() ??
		[]) {
		const gate = pages.flatMap((page) => page.gates).find((item) => item.id === response.id);
		if (gate && canPersistGate(gate.id) && gateSatisfied(gate.rule, response.correct, false))
			released.add(gate.id);
	}
	// The self-check asset can restore before this chunk installs its listener.
	for (const block of root.querySelectorAll<HTMLElement>(
		'[data-block-type="selfCheck"][data-completed="true"]',
	)) {
		const gate = pages
			.flatMap((page) => page.gates)
			.find((item) => item.id === block.dataset.blockId);
		if (gate?.rule === "attempt") released.add(gate.id);
	}
	let current = firstLocal;
	let completing = false;
	const completion = root.querySelector<HTMLElement>("#deck-completion");
	// A group can own the authored H1. The frame puts it in the same title row
	// while retaining its ID and the activity's aria-labelledby relationship.
	for (const slide of slides) {
		const title = slide.querySelector<HTMLElement>(".praxity-assessment-group-card h1");
		if (title) {
			title.classList.add("deck-stage-title");
			slide.querySelector(".praxity-slide")?.prepend(title);
		}
	}
	const sessionId = config.courseId
		? `${config.courseId}:module:${pages[firstLocal].moduleSlug}`
		: undefined;
	if (sessionId) readCourseSessionTime(sessionId, Date.now(), () => sessionStorage);
	let player: ReturnType<typeof mountDeckNarration> | undefined;
	const playlist = localPages.flatMap((page) => {
		const segments: DeckPage["segments"] = page.segments.length
			? page.segments
			: [
					{
						id: `${page.id}:empty`,
						kind: "block",
						script: "",
						src: undefined,
						timings: undefined,
						duration: undefined,
						blockId: undefined,
						cardTargets: undefined,
						pauseAfter: false,
					},
				];
		return segments.map((item, index) => ({
			pageIndex: pages.indexOf(page),
			segmentIndex: index,
			item: {
				id: item.id,
				pageId: page.id,
				silent: page.narrationSilent,
				src: item.src ?? "",
				timingsSrc: item.timings,
				duration: item.duration,
				blockId: item.id,
				sourceBlockId: item.blockId,
				turnIndex: item.turnIndex,
				cardTargets: item.cardTargets,
				pauseAfter: item.pauseAfter || (page.stop && index === segments.length - 1),
			} satisfies NarrationPlaylistItem,
		}));
	});
	let narrationPlaying = false;
	let narrationIndex = 0;
	const syncCardPlayback = () => {
		const owned = selfCheckEpochTicket();
		const active = playlist[narrationIndex];
		for (const slide of slides) {
			const pageIndex = pages.findIndex((page) => page.id === slide.dataset.deckSlide);
			const entries = playlist.filter(
				(entry) => entry.pageIndex === pageIndex && entry.item.src && !entry.item.silent,
			);
			for (const card of slide.querySelectorAll<HTMLElement>("[data-card-root]")) {
				card.dataset.cardPlaythroughMode = entries.some((entry) =>
					entry.item.cardTargets?.some((target) => target.containerId === card.dataset.blockId),
				)
					? "cue"
					: entries.length
						? "narration"
						: "manual";
				card.dataset.cardPlaythroughPlaying = String(
					narrationPlaying &&
						active?.pageIndex === pageIndex &&
						!!active.item.src &&
						!active.item.silent &&
						advance.getAttribute("aria-checked") === "true",
				);
				dispatchSelfCheckEvent(new Event("praxity:card-playthrough"), owned, document, card);
			}
		}
	};
	// Persist the state before lazy card activation, then notify already active cards.
	syncCardPlayback();
	const listeners = new AbortController();
	let frameEpoch = 0;
	const deferFrame = (effect: () => void) => {
		const current = selfCheckEpochTicket();
		const epoch = frameEpoch;
		return requestSelfCheckFrame(() => {
			if (!listeners.signal.aborted && epoch === frameEpoch && current()) effect();
		}, current);
	};
	const on = (target: EventTarget, event: string, handler: EventListener) =>
		target.addEventListener(event, handler, { signal: listeners.signal });
	// Module links and browser history leave the document without a local slide move.
	on(window, "pagehide", () => removeScormResumeCue(root));
	const gateReleased = (gate: DeckPage["gates"][number]) => {
		const id = gate.id;
		if (!selfCheckIds.has(id)) return released.has(id);
		const activity = selfCheckConsumers()?.read(id);
		return activity?.ready === true && activity.available && activity.completed;
	};
	const gateLimit = () => {
		const locked = pages.findIndex((page) => page.gates.some((gate) => !gateReleased(gate)));
		return locked < 0 ? pages.length - 1 : locked;
	};
	const reachLimit = (destination: number) => {
		if (inspection) return pages.length - 1;
		if (!pages[destination]?.sequentialLessons) return gateLimit();
		let reached = -1;
		for (let i = 0; i < pages.length; i++) {
			if (!visited.has(pages[i].id)) break;
			reached = i;
		}
		return Math.min(reached + 1, gateLimit(), pages.length - 1);
	};
	const accessNotice = (destination: number): AccessNotice =>
		pages[reachLimit(destination)].gates.some((gate) => !gateReleased(gate)) ? "gate" : "sequence";
	const showAccessNotice = (reason: AccessNotice) =>
		setStatus(
			reason === "gate" ? t.locked : t.visitEarlier,
			reason === "gate" ? "gate" : undefined,
		);
	const gateNotice = document.createElement("button");
	gateNotice.type = "button";
	gateNotice.className = "deck-gate-notice";
	gateNotice.hidden = true;
	status.before(gateNotice);
	let gateTarget: HTMLElement | undefined;
	const gateHeading = () =>
		gateTarget?.querySelector<HTMLElement>(
			".praxity-assessment-stem, .praxity-assessment-group-title, h1, h2, h3, h4, h5, h6",
		) ?? gateTarget;
	const updateGateNotice = () => {
		const gate =
			status.dataset.kind === "gate"
				? pages[current].gates.find((item) => !gateReleased(item))
				: undefined;
		gateTarget = gate
			? Array.from(
					slides
						.find((slide) => slide.dataset.deckSlide === pages[current].id)
						?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [],
				).find((block) => block.dataset.blockId === gate.id)
			: undefined;
		gateNotice.hidden = !gateTarget;
		if (gateTarget) {
			const heading = gateHeading();
			const title = (
				heading?.querySelector(".praxity-assessment-stem-content") ?? heading
			)?.textContent?.trim();
			gateNotice.textContent = `${t.goToRequiredActivity}${title ? `: ${title}` : ""}`;
		}
	};
	on(gateNotice, "click", () => {
		const heading = gateHeading();
		if (!heading) return;
		heading.tabIndex = -1;
		heading.focus({ preventScroll: true });
		heading.scrollIntoView({ block: "center", behavior: "instant" });
	});

	const save = (current: () => boolean) => {
		if (!current()) return;
		const runtime = learnerRuntime(current) as SCORMRuntime | undefined;
		if (inspection || !runtime) return;
		try {
			let saved: Record<string, unknown> = {};
			try {
				const value = JSON.parse(runtime?.getSuspendData() || "{}");
				if (value && typeof value === "object" && !Array.isArray(value)) saved = value;
			} catch {
				/* Preserve valid unrelated state only. */
			}
			runtime.setSuspendData(
				JSON.stringify({
					...saved,
					deck: { released: [...released].filter(canPersistGate) },
				}),
			);
			const committed = runtime.commit();
			if (current() && !committed) setStatus(t.saved, "error");
		} catch {
			setStatus(t.saved, "error");
		}
	};
	let releaseNavigationFocus = () => {};
	const focusSlide = () => {
		const slide = slides.find((element) => element.dataset.deckSlide === pages[current].id);
		const main = root.querySelector<HTMLElement>("#main-content");
		if (!slide || !main) return false;
		const heading = resumeFocusTarget(slide, "h1, h2, h3, h4, h5, h6");
		const target = heading === slide ? main : heading;
		releaseNavigationFocus();
		releaseNavigationFocus = focusNavigationContent(target, main);
		return target !== main && document.activeElement === target;
	};
	const refresh = () => {
		root.dataset.narration = String(
			!completing && !pages[current].narrationSilent && pages[current].segments.some((s) => s.src),
		);
		find("narration").hidden = completing || !player;
		find("more-playback").hidden = completing || !player;
		const nextLabel = nextModuleLabel(config.sourceLocale, pages[lastLocal + 1]);
		updateGateNotice();
		if (status.dataset.kind === "gate" && pages[current].gates.every((gate) => gateReleased(gate)))
			setStatus("");
		for (const [id, label] of [
			[
				"previous",
				!completing && current === firstLocal && current > 0 ? t.previousModule : t.previous,
			],
			[
				"next",
				completing
					? current < pages.length - 1
						? nextLabel
						: t.backToCourse
					: current === lastLocal
						? t.finishModule
						: t.next,
			],
		] as const) {
			const button = find<HTMLButtonElement>(id);
			button.setAttribute("aria-label", label);
			button.title = label;
			const visibleLabel = button.querySelector<HTMLElement>(".deck-navigation-label");
			if (visibleLabel)
				visibleLabel.textContent =
					id === "previous"
						? t.previousLabel
						: completing && current < pages.length - 1
							? t.nextModule
							: current === lastLocal
								? label
								: t.nextLabel;
			const adjacentTitle = button.querySelector<HTMLElement>(".deck-adjacent-title");
			if (adjacentTitle)
				adjacentTitle.textContent =
					id === "next" && current === lastLocal
						? ""
						: (pages[current + (id === "previous" ? (completing ? 0 : -1) : 1)]?.title ?? "");
			if (adjacentTitle?.textContent) button.title = `${label}: ${adjacentTitle.textContent}`;
			if (id === "next") button.classList.toggle("deck-finish", current === lastLocal);
		}
		updateBoundaryNavigation(
			find<HTMLButtonElement>("previous"),
			find<HTMLButtonElement>("next"),
			current === 0 && !completing,
			false,
			root.querySelector<HTMLElement>("#main-content")?.inert
				? find(`${root.dataset.panel === "script" ? "script" : "outline"}-title`)
				: (slides.find((slide) => slide.dataset.deckSlide === pages[current].id) ?? null),
		);
		find("position").textContent =
			`${localPages.indexOf(pages[current]) + 1} / ${localPages.length}`;
		root.style.setProperty(
			"--deck-progress",
			`${((localPages.indexOf(pages[current]) + 1) / localPages.length) * 100}%`,
		);
		find("position-label").textContent =
			`${t.position} ${localPages.indexOf(pages[current]) + 1} ${t.of} ${localPages.length}`;
		find("more-position").textContent = find("position-label").textContent;
		for (const reading of readings) {
			reading.hidden = reading.dataset.deckReading !== pages[current].id;
			reading.inert = reading.hidden;
		}
		for (const button of root.querySelectorAll<HTMLButtonElement>("[data-deck-seek]")) {
			const destination = pages.findIndex((page) => page.id === button.dataset.deckSeek);
			button.disabled = destination > reachLimit(destination);
		}
		for (const link of root.querySelectorAll<HTMLAnchorElement>(
			"[data-deck-module], [data-deck-page]",
		)) {
			const destination = link.dataset.pageNumber
				? Number(link.dataset.pageNumber) - 1
				: link.dataset.deckPage
					? pages.findIndex((page) => page.id === link.dataset.deckPage)
					: pages.findIndex((page) => new URL(link.href).pathname.endsWith(`/${page.slug}.html`));
			if (link.hasAttribute("data-deck-module"))
				link.hidden = destination < firstLocal ? current !== firstLocal : current !== lastLocal;
			if (destination === current) link.setAttribute("aria-current", "page");
			else link.removeAttribute("aria-current");
			const locked =
				destination > reachLimit(destination) ||
				(destination > current && isSelfCheckForwardBlocked());
			// Module links represent a whole module; a slide visit cannot mark it visited.
			const wasVisited =
				link.closest("#deck-outline") !== null &&
				!link.classList.contains("deck-module-link") &&
				visited.has(pages[destination]?.id ?? "");
			link.dataset.visited = String(wasVisited);
			link.setAttribute("aria-disabled", String(locked));
			link.dataset.label ??= link.getAttribute("aria-label") ?? link.textContent ?? "";
			link.setAttribute(
				"aria-label",
				`${link.dataset.label}${wasVisited ? `, ${localeStrings.visitedPage}` : ""}${locked ? `, ${t.lockedLabel}` : ""}`,
			);
			const lock = link.querySelector<HTMLElement>("[data-deck-lock]");
			if (lock) {
				lock.hidden = !locked;
				lock.title = t.lockedLabel;
			}
		}
	};
	const highlight = (index: number) => {
		narrationIndex = index;
		syncCardPlayback();
		const active = playlist[index]?.item;
		for (const element of root.querySelectorAll<HTMLElement>("[data-deck-segment]")) {
			if (element.dataset.deckSegment === active?.id) element.setAttribute("aria-current", "true");
			else element.removeAttribute("aria-current");
		}
	};
	const address = () => {
		const url = new URL(location.href);
		url.hash = pages[current].id;
		return url;
	};
	const activate = (
		index: number,
		reason: MoveReason,
		replace = false,
		redirectNotice?: AccessNotice,
	): boolean => {
		const owned = selfCheckEpochTicket();
		if (!owned()) return false;
		if (!inspection && index > current && (isSelfCheckForwardBlocked() || showRequiredValidation()))
			return false;
		if (index < 0 || index >= pages.length || index > reachLimit(index)) {
			showAccessNotice(accessNotice(index));
			if (replace) history.replaceState(null, "", address());
			return false;
		}
		const target = pages[index];
		setStatus("");
		if (!localIds.has(target.id)) {
			releaseNavigationFocus();
			player?.pause();
			save(owned);
			let search = location.search;
			if (redirectNotice) {
				const params = new URLSearchParams(search);
				params.set(ACCESS_NOTICE_PARAM, redirectNotice);
				if (resuming) params.set("praxity-resume", "1");
				search = `?${params}`;
			}
			const href = `${target.moduleSlug}.html${search}#${encodeURIComponent(target.id)}`;
			if (reason === MoveReason.Navigation || navigationArrival) markPageNavigationFocus();
			const decorated = window.__praxityDecoratePageHref?.(href) ?? href;
			if (!window.__praxityNavigatePageHref?.(decorated)) location.assign(decorated);
			return true;
		}
		const changedSlide = index !== current;
		if (changedSlide || completing) releaseNavigationFocus();
		const active = document.activeElement;
		const leaving = slides.find((slide) => slide.dataset.deckSlide === pages[current].id);
		const orientContent = reason === MoveReason.Navigation && (changedSlide || completing);
		const recoverReadingFocus =
			changedSlide && readings.some((reading) => reading.contains(active));
		const recoverPanelFocus =
			changedSlide &&
			active instanceof HTMLElement &&
			active.matches(".praxity-resume-summary") &&
			!leaving?.contains(active);
		// Capture focus before removing a summary that may own it. The cue belongs
		// to the restored slide, including any replacing panel.
		if (changedSlide) {
			// Group feedback describes this action only while its slide is visible.
			find("next").removeAttribute("aria-describedby");
			removeScormResumeCue(root);
		}
		for (const media of leaving?.querySelectorAll<HTMLMediaElement>("audio,video") ?? [])
			media.pause();
		current = index;
		// Compiler-owned, decoded slide titles use the same pattern as static Pages.
		document.title = target.title;
		completing = false;
		if (completion) completion.hidden = true;
		const entering = slides.find((slide) => slide.dataset.deckSlide === target.id);
		const priorityImage = entering?.querySelector<HTMLImageElement>("img[src]");
		if (priorityImage && priorityImage.getAttribute("fetchpriority") !== "high") {
			priorityImage.setAttribute("fetchpriority", "high");
			priorityImage.setAttribute("loading", "eager");
		}
		for (const slide of slides) {
			slide.hidden = slide.dataset.deckSlide !== target.id;
			slide.inert = slide.hidden;
			if (!slide.hidden) slide.setAttribute("aria-label", slidePosition(target));
		}
		warmPaneImages(slides, entering ? slides.indexOf(entering) : -1);
		if (changedSlide) {
			scrollContainer.scrollTop = 0;
			const main = root.querySelector<HTMLElement>("#main-content");
			if (main) main.scrollTop = 0;
			const workspace = root.querySelector<HTMLElement>(".deck-workspace");
			if (workspace && /^(auto|scroll)$/.test(getComputedStyle(workspace).overflowY))
				workspace.scrollTop = 0;
		}
		if (!inspection && !isSelfCheckForwardBlocked()) {
			visited.add(target.id);
			learnerTracker(owned)?.trackPageVisit?.(
				target.id,
				`index.html?praxity-page=${encodeURIComponent(target.id)}`,
			);
		}
		window.dispatchEvent(
			new CustomEvent("praxity:active-page-change", { detail: { pageId: target.id } }),
		);
		let focusedHeading = false;
		if (orientContent) {
			if (root.querySelector<HTMLElement>("#main-content")?.inert) showPanel(null, false, true);
			focusedHeading = focusSlide();
		}
		refresh();
		if (!orientContent && recoverReadingFocus) scrollContainer.focus({ preventScroll: true });
		if (!orientContent && recoverPanelFocus)
			find(`${root.dataset.panel === "script" ? "script" : "outline"}-title`).focus({
				preventScroll: true,
			});
		if (replace) history.replaceState(null, "", address());
		else history.pushState(null, "", address());
		// Heading focus speaks the named position region and title; do not also announce.
		if (!focusedHeading) {
			find("announcement").textContent =
				reason === MoveReason.Restore ? "" : `${slidePosition(target)}: ${target.title}`;
		}
		save(owned);
		return true;
	};
	const move = (
		index: number,
		reason: MoveReason,
		replace = false,
		segmentIndex = 0,
		redirectNotice?: AccessNotice,
	): boolean => {
		const destination = playlist.findIndex(
			(entry) => entry.pageIndex === index && entry.segmentIndex === segmentIndex,
		);
		if (!activate(index, reason, replace, redirectNotice)) return false;
		if (destination >= 0) {
			if (reason === MoveReason.Navigation && follow.getAttribute("aria-pressed") === "true")
				player?.pause();
			if (player) return player.selectSegment(destination);
			highlight(destination);
		}
		return true;
	};
	const strings = window.__PRAXITY_STRINGS__;
	if (playlist.some((entry) => entry.item.src) && strings) {
		player = mountDeckNarration({
			mount: find("narration"),
			settingsContainer: root,
			settingsMount: { element: find("more-playback"), timeLabel: t.time, speedLabel: t.speed },
			items: playlist.map((entry) => entry.item),
			strings: strings as unknown as NarrationStrings,
			contentRoot: scrollContainer,
			mediaRoot: find("slides"),
			scrollContainer,
			beforeSelect(index, reason, localTime = 0) {
				const entry = playlist[index];
				if (!entry) return false;
				if (reason === "advance") {
					const slide = slides.find((element) => element.dataset.deckSlide === pages[current].id);
					if (
						(advance.getAttribute("aria-checked") !== "true" && entry.pageIndex !== current) ||
						slide?.contains(document.activeElement)
					) {
						setStatus(t.stopped, "paused");
						return false;
					}
				}
				if (entry.pageIndex > reachLimit(entry.pageIndex)) {
					showAccessNotice(accessNotice(entry.pageIndex));
					if (reason !== "advance" && gateNotice.isConnected)
						gateNotice.scrollIntoView({ block: "center", behavior: "instant" });
					return false;
				}
				if (entry.pageIndex !== current && !activate(entry.pageIndex, narrationMoveReason[reason]))
					return false;
				if (
					entry.segmentIndex === 0 &&
					localTime === 0 &&
					follow.getAttribute("aria-pressed") === "true"
				) {
					const slide = slides.find((element) => element.dataset.deckSlide === pages[current].id);
					for (const card of slide?.querySelectorAll<HTMLElement>("[data-card-root]") ?? []) {
						if (
							card.dataset.cardPlaythroughMode === "narration" &&
							Number(card.dataset.advance) > 0
						)
							continue;
						if (card.contains(document.activeElement)) continue;
						card.dataset.narrationPendingReset = "true";
						card.dispatchEvent(
							new CustomEvent("praxity:narration-reveal", {
								bubbles: true,
								detail: { resetCards: true },
							}),
						);
					}
				}
				return true;
			},
			onActiveSegment: highlight,
			onPlaybackChange: (playing) => {
				narrationPlaying = playing;
				syncCardPlayback();
			},
			onFollowChange: (following) => {
				follow.setAttribute("aria-pressed", String(following));
				if (!following)
					for (const card of root.querySelectorAll<HTMLElement>("[data-narration-pending-reset]"))
						delete card.dataset.narrationPendingReset;
			},
			onFollowSuspendedChange: (suspended) => {
				if (!suspended && document.activeElement === resumeFollow)
					follow.focus({ preventScroll: true });
				resumeRow.inert = !suspended;
				resumeRow.setAttribute("aria-hidden", String(!suspended));
				if (suspended) follow.setAttribute("aria-describedby", followStatus.id);
				else follow.removeAttribute("aria-describedby");
				followStatus.textContent = suspended ? t.followSuspended : "";
			},
			onPlaybackError: () => {
				setStatus(t.failed, "error");
			},
			onStop: () => {
				setStatus(t.stopped, "paused");
			},
			onEnded: () => {
				setStatus(t.stopped, "paused");
			},
		});
	}
	player?.setFollow(design.followNarration);
	const sidebar = root.querySelector<HTMLElement>("#deck-sidebar");
	const outlineSidebar = root.querySelector<HTMLElement>("#deck-outline-sidebar");
	const scriptToggle = root.querySelector<HTMLButtonElement>("#deck-script-toggle");
	const outlineToggle = root.querySelector<HTMLButtonElement>("#deck-outline-toggle");
	const hasOutline = design.outline || !!root.querySelector(".deck-glossary-link");
	const drawerLayout = window.matchMedia("(max-width: 949.99px), (max-height: 35.99rem)");
	const compactTools = true;
	let syncMore = () => {};
	const more = root.querySelector<HTMLElement>("#deck-more");
	const moreButton = more?.querySelector<HTMLButtonElement>("#deck-more-toggle");
	const morePanel = more?.querySelector<HTMLElement>("#deck-more-panel");
	const moreDisclosure =
		moreButton && morePanel ? enhanceDisclosure(moreButton, morePanel) : undefined;
	if (more && moreDisclosure) {
		syncMore = () => {
			if (compactTools && more.contains(document.activeElement)) moreButton?.focus();
			moreDisclosure.setExpanded(false);
		};
		syncMore();
		on(more, "keydown", (event) => {
			if (
				compactTools &&
				(event as KeyboardEvent).key === "Escape" &&
				moreButton?.getAttribute("aria-expanded") === "true"
			) {
				moreDisclosure.setExpanded(false);
				moreButton?.focus();
			}
		});
		const collapseMore = (outside: EventTarget | null) => {
			if (
				compactTools &&
				moreButton?.getAttribute("aria-expanded") === "true" &&
				outside instanceof Node &&
				!more.contains(outside)
			) {
				if (more.contains(document.activeElement)) moreButton?.focus();
				moreDisclosure.setExpanded(false);
			}
		};
		// Chromium attributes document click listeners to the document element and
		// exposes the whole course as clickable; pointerdown is not a mouse-button
		// event there. Keyboard users leave More by moving focus, so focusout
		// replaces the keyboard clicks the old listener also caught. Escape remains.
		on(document, "pointerdown", (event) => collapseMore(event.target));
		on(more, "focusout", (event) => {
			const next = (event as FocusEvent).relatedTarget;
			// WebKit does not focus a pressed button; it focuses the nearest focusable
			// ancestor, here the controls landmark. pointerdown owns pointer dismissal.
			if (next instanceof Node && next.contains(more)) return;
			collapseMore(next);
		});
	}
	const main = root.querySelector<HTMLElement>("#main-content");
	const workspace = root.querySelector<HTMLElement>(".deck-workspace");
	const moreBelow = find("more-below");
	const controls = find("controls");
	let stageFrame = 0;
	const updateStage = () => {
		stageFrame = 0;
		if (!main) return;
		const footerHeight = `${controls.getBoundingClientRect().height}px`;
		const padding = Number.parseFloat(getComputedStyle(main).paddingBottom) || 0;
		const unseen = main.scrollHeight - padding - main.clientHeight - main.scrollTop > 1;
		if (root.style.getPropertyValue("--deck-footer-height") !== footerHeight)
			root.style.setProperty("--deck-footer-height", footerHeight);
		moreBelow.hidden = main.inert || !unseen;
		if (moreBelow.hidden && document.activeElement === moreBelow)
			main.focus({ preventScroll: true });
	};
	const scheduleStage = () => {
		if (!stageFrame) stageFrame = deferFrame(updateStage);
	};
	const releaseStageObserver = observeSelfCheckLifetime((current) => {
		const stageObserver = createSelfCheckResizeObserver(current, () => {
			if (current()) scheduleStage();
		});
		// Feedback, media and text preferences can resize content without a slide change.
		stageObserver.observe(controls);
		if (main) {
			stageObserver.observe(main);
		}
		for (const slide of slides) stageObserver.observe(slide);
		return () => stageObserver.disconnect();
	});
	if (main) {
		on(moreBelow, "click", () => main.scrollBy({ top: main.clientHeight, behavior: "instant" }));
		on(main, "scroll", scheduleStage);
	}
	on(window, "praxity:active-page-change", scheduleStage);
	const sheet = document.createElement("dialog");
	sheet.className = "praxity-dialog-sheet deck-transcript-sheet praxity-floating-layer";
	sheet.setAttribute("aria-labelledby", "deck-script-title");
	const sidebarHome = document.createElement("template");
	sidebar?.before(sidebarHome);
	sidebarHome.after(sheet);
	let sheetLayout = root.getBoundingClientRect().width < 600;
	let initialSheetPending = true;
	let sheetFocusTarget: HTMLElement | null = null;
	const closeSidebarIcon = find("sidebar-close").innerHTML;
	let focusInMain = !!main?.contains(document.activeElement);
	const printLayout = window.matchMedia("print");
	on(root, "focusin", () => {
		focusInMain = !!main?.contains(document.activeElement);
	});
	const syncPanelLayout = () => {
		// Printed workspace bounds describe the full document, not the screen sheet.
		if (printLayout.matches) return;
		const bounds = workspace?.getBoundingClientRect();
		// The title and footer can grow without changing the outer shell's size.
		if (morePanel)
			morePanel.style.maxHeight =
				compactTools && bounds ? `${Math.max(44, bounds.height - 8)}px` : "";
		const modal = sheetLayout && root.dataset.panel === "script";
		if (modal && sidebar) {
			if (sidebar.parentElement !== sheet) sheet.append(sidebar);
			// Resume is a reading action: let it scroll with the text in a short sheet.
			if (resumeRow.parentElement !== scrollContainer) scrollContainer.prepend(resumeRow);
			sidebar.removeAttribute("role");
			if (bounds) {
				sheet.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px`;
			}
			find("sidebar-close").setAttribute("aria-label", t.closeSheet);
			find("sidebar-close").innerHTML = closeSidebarIcon;
			if (find("script-title").nextElementSibling !== find("sidebar-close"))
				find("script-title").after(find("sidebar-close"));
			if (!sheet.open && !initialSheetPending) {
				const target = sheetFocusTarget ?? find("script-title");
				target.setAttribute("autofocus", "");
				sheet.showModal();
				target.removeAttribute("autofocus");
			}
		} else {
			if (sheet.open) sheet.close();
			if (sidebar && sidebar.parentElement === sheet) sidebarHome.after(sidebar);
			if (resumeRow.parentElement === scrollContainer) resumeHome.after(resumeRow);
			find("sidebar-close").setAttribute("aria-label", t.closeSidebar);
			find("sidebar-close").innerHTML = closeSidebarIcon;
			const heading = find("script-title").parentElement;
			if (heading) heading.append(find("sidebar-close"));
		}
		const drawer = drawerLayout.matches && !!root.dataset.panel;
		const recoverFocus =
			drawer &&
			(main?.contains(document.activeElement) ||
				(focusInMain && (!document.activeElement || document.activeElement === document.body)));
		if (main) main.inert = drawer;
		for (const panel of [sidebar, outlineSidebar]) {
			if (panel === sidebar && modal) continue;
			if (drawer && panel && !panel.hidden) {
				panel.setAttribute("role", "dialog");
				if (panel === outlineSidebar) panel.setAttribute("aria-labelledby", "deck-outline-title");
			} else if (panel === outlineSidebar) {
				panel?.removeAttribute("role");
				panel?.removeAttribute("aria-labelledby");
			} else panel?.setAttribute("role", "complementary");
		}
		if (recoverFocus)
			find(`${root.dataset.panel === "script" ? "script" : "outline"}-title`).focus();
	};
	on(drawerLayout, "change", syncPanelLayout);
	on(printLayout, "change", syncPanelLayout);
	const releasePanelObserver = observeSelfCheckLifetime((current) => {
		const panelObserver = createSelfCheckResizeObserver(current, () => {
			if (!current()) return;
			const width = root.getBoundingClientRect().width;
			sheetLayout = width < 600;
			syncPanelLayout();
		});
		panelObserver.observe(root);
		if (workspace) panelObserver.observe(workspace);
		return () => panelObserver.disconnect();
	});
	on(sheet, "cancel", (event) => {
		event.preventDefault();
		closePanel();
	});
	on(sheet, "keydown", (event) => {
		const key = event as KeyboardEvent;
		if (key.key !== "Tab" || !sheet.open) return;
		const targets = [
			...sheet.querySelectorAll<HTMLElement>(
				"button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']",
			),
		].filter(
			(element) =>
				element.getClientRects().length &&
				!element.closest("[inert]") &&
				getComputedStyle(element).visibility !== "hidden",
		);
		const first = targets[0],
			last = targets.at(-1);
		if (
			key.shiftKey &&
			(document.activeElement === first || document.activeElement === find("script-title"))
		) {
			key.preventDefault();
			last?.focus();
		} else if (!key.shiftKey && document.activeElement === last) {
			key.preventDefault();
			first?.focus();
		}
	});
	let panelTrigger: HTMLButtonElement | null = null;
	let pendingSheetFocus: HTMLButtonElement | null = null;
	let focusReturnFrame = 0;
	const cancelFrames = () => {
		++frameEpoch;
		cancelAnimationFrame(stageFrame);
		stageFrame = 0;
		cancelAnimationFrame(focusReturnFrame);
		focusReturnFrame = 0;
	};
	on(window, "pagehide", cancelFrames);
	on(document, "praxity:self-check-owner", cancelFrames);
	on(sheet, "close", () => {
		const target = pendingSheetFocus;
		pendingSheetFocus = null;
		if (!target) return;
		// WebKit can finish native focus restoration after close() returns. More
		// also hides the trigger while the sheet is open. Wait for close and layout.
		const restoreFocus = () => {
			if (listeners.signal.aborted || sheet.open || root.dataset.panel) return;
			if (compactTools && more?.contains(target)) moreDisclosure?.setExpanded(true);
			if (!target.getClientRects().length || getComputedStyle(target).visibility !== "visible") {
				focusReturnFrame = deferFrame(restoreFocus);
				return;
			}
			target.focus({ preventScroll: true });
		};
		focusReturnFrame = deferFrame(restoreFocus);
	});
	const showPanel = (panel: "script" | "outline" | null, focus = true, remember = false) => {
		if (panel === "outline" && !hasOutline) panel = null;
		if (!sidebar) return;
		if (panel && compactTools) moreDisclosure?.setExpanded(false);
		sidebar.hidden = panel !== "script";
		if (outlineSidebar) outlineSidebar.hidden = panel !== "outline";
		root.dataset.panel = panel ?? "";
		syncPanelLayout();

		scriptToggle?.setAttribute("aria-expanded", String(panel === "script"));
		outlineToggle?.setAttribute("aria-expanded", String(panel === "outline"));
		if (panel && focus) find(`${panel === "script" ? "script" : "outline"}-title`).focus();
		if (remember) savePanelPreference(panel);
	};
	if (scriptToggle)
		on(scriptToggle, "click", () => {
			panelTrigger = scriptToggle;
			if (root.dataset.panel === "script") closePanel();
			else showPanel("script", true, true);
		});
	if (outlineToggle)
		on(outlineToggle, "click", () => {
			panelTrigger = outlineToggle;
			if (root.dataset.panel === "outline") closePanel();
			else showPanel("outline", true, true);
		});
	const closeSidebar = root.querySelector("#deck-sidebar-close");
	const closePanel = (event?: Event) => {
		event?.stopPropagation();
		const closingSheet = sheet.open;
		if (closingSheet) pendingSheetFocus = panelTrigger;
		showPanel(null, true, true);
		if (compactTools && panelTrigger && more?.contains(panelTrigger))
			moreDisclosure?.setExpanded(true);
		if (!closingSheet) panelTrigger?.focus();
	};
	if (closeSidebar) on(closeSidebar, "click", closePanel);
	const closeOutline = root.querySelector("#deck-outline-close");
	if (closeOutline) on(closeOutline, "click", closePanel);
	for (const panel of [sidebar, outlineSidebar])
		if (panel)
			on(panel, "keydown", (event) => {
				if ((event as KeyboardEvent).key === "Escape") {
					event.preventDefault();
					closePanel();
				}
			});
	on(find("previous"), "click", () => {
		move(completing ? current : current - 1, MoveReason.Navigation);
	});
	const goNext = () => {
		if (!inspection && (isSelfCheckForwardBlocked() || showRequiredValidation())) return;
		if (completing) {
			if (current < pages.length - 1) move(current + 1, MoveReason.Navigation);
			else {
				const href =
					root.dataset.praxityCourseHome ??
					window.__praxityDecoratePageHref?.(DEFAULT_COURSE_HOME_URL) ??
					DEFAULT_COURSE_HOME_URL;
				if (!window.__praxityNavigatePageHref?.(href)) location.assign(href);
			}
		} else if (current === lastLocal && completion) {
			if (pages[current].gates.some((gate) => !gateReleased(gate))) {
				showAccessNotice("gate");
				return;
			}
			player?.pause();
			showPanel(null);
			releaseNavigationFocus();
			find("next").removeAttribute("aria-describedby");
			removeScormResumeCue(root);
			completing = true;
			document.title = t.moduleComplete;
			for (const slide of slides) {
				slide.hidden = true;
				slide.inert = true;
			}
			completion.hidden = false;
			if (main) main.scrollTop = 0;
			const labels = window.__PRAXITY_STRINGS__;
			const time = sessionId
				? readCourseSessionTime(sessionId, Date.now(), () => sessionStorage)
				: undefined;
			const timeLabel = root.querySelector<HTMLElement>("#deck-completion-time");
			if (timeLabel && labels && time && !("error" in time))
				timeLabel.textContent = formatCourseSessionTime(
					time,
					document.documentElement.lang || "en",
					labels,
				);
			if (labels)
				renderCourseCompletionResult(
					root,
					labels,
					learnerTracker(mount)?.getOutcome?.(),
					learnerRuntime(mount)?.getScore?.(),
				);
			refresh();
			completion.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
			scheduleStage();
		} else move(current + 1, MoveReason.Navigation);
	};
	on(find("next"), "click", goNext);
	const review = root.querySelector("#deck-review");
	if (review)
		on(review, "click", () => {
			move(firstLocal, MoveReason.Navigation);
		});
	on(resumeFollow, "click", () => player?.resumeFollow());
	on(follow, "click", () => {
		const enabled = follow.getAttribute("aria-pressed") !== "true";
		follow.setAttribute("aria-pressed", String(enabled));
		player?.setFollow(enabled);
	});
	on(advance, "click", () => {
		advance.setAttribute("aria-checked", String(advance.getAttribute("aria-checked") !== "true"));
		syncAdvanceStatus();
		syncCardPlayback();
	});
	const seekTo = (seek: HTMLElement) => {
		move(
			pages.findIndex((page) => page.id === seek.dataset.deckSeek),
			MoveReason.NarrationSeek,
			false,
			Number(seek.dataset.segmentIndex),
		);
	};
	const followCourseLink = (link: HTMLAnchorElement, event: Event) => {
		const url = new URL(link.href);
		if (url.origin !== location.origin) return;
		const documentPage = pages.find(
			(page) =>
				url.pathname === new URL(`${page.slug}.html`, location.href).pathname ||
				url.pathname === new URL(`${page.moduleSlug}.html`, location.href).pathname,
		);
		// Resolve fragments within their module; leave section anchors to the browser.
		const target = link.dataset.deckPage
			? pages.findIndex((page) => page.id === link.dataset.deckPage)
			: url.hash
				? pages.findIndex(
						(page) =>
							url.hash === `#${encodeURIComponent(page.id)}` &&
							(documentPage
								? page.moduleSlug === documentPage.moduleSlug
								: url.pathname === location.pathname && localIds.has(page.id)),
					)
				: documentPage
					? pages.indexOf(documentPage)
					: -1;
		if (target >= 0) {
			event.preventDefault();
			move(target, MoveReason.Navigation);
		}
	};
	// A click can reach both a control's own listener and its React root's
	// delegation; nested controls also bubble through each other. Act once.
	const activated = new WeakSet<Event>();
	const activateControl: DeckControlActivation = (control, event) => {
		if (activated.has(event)) return;
		activated.add(event);
		if (control.matches("[data-deck-seek]")) seekTo(control);
		if (control.matches("a[href]")) followCourseLink(control as HTMLAnchorElement, event);
	};
	window.__praxityActivateDeckControl = activateControl;
	bindDeckControls(root, listeners.signal);
	on(window, "popstate", () => {
		const target = pages.findIndex((page) => page.id === hashId());
		if (target >= 0) move(target, MoveReason.Restore, true);
	});
	on(window, "hashchange", () => {
		const target = pages.findIndex((page) => page.id === hashId());
		if (target >= 0 && target !== current) move(target, MoveReason.Restore, true);
	});
	on(document, "keydown", (event) => {
		const key = event as KeyboardEvent;
		if (
			key.defaultPrevented ||
			key.altKey ||
			key.ctrlKey ||
			key.metaKey ||
			key.shiftKey ||
			!(key.target instanceof Element) ||
			key.target.closest(
				'nav,form,input,textarea,select,button,a,summary,audio,video,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[role="slider"],[role="spinbutton"],[role="radiogroup"],[role="radio"],[role="listbox"],[role="combobox"],[role="menu"],[role="menubar"],[role="tablist"],[role="tree"],[role="treegrid"],[role="grid"],[role="scrollbar"],[role="toolbar"],[data-praxity-swipe-ignore]',
			)
		)
			return;
		if (key.key === " ") {
			if (!completing && !key.repeat && player?.togglePlayback()) key.preventDefault();
			return;
		}
		if (config.navKeyboardArrows === false) return;
		const rtl = document.documentElement.dir === "rtl";
		if (key.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
			key.preventDefault();
			goNext();
		}
		if (key.key === (rtl ? "ArrowRight" : "ArrowLeft") && (current > 0 || completing)) {
			key.preventDefault();
			move(completing ? current : current - 1, MoveReason.Navigation);
		}
	});
	on(document, "praxity:self-check-completion", (event) => {
		const owned = selfCheckEpochTicket(document, event);
		if (!owned()) return;
		if (inspection) return;
		const detail = (event as CustomEvent<{ blockId: string; completed: boolean }>).detail;
		const gate = pages.flatMap((page) => page.gates).find((item) => item.id === detail?.blockId);
		if (gate?.rule !== "attempt") return;
		const changed = released.has(gate.id) !== detail.completed;
		if (detail.completed) released.add(gate.id);
		else released.delete(gate.id);
		if (changed && canPersistGate(gate.id)) save(owned);
		refresh();
	});
	on(document, "praxity:assessment-response", (event) => {
		const owned = selfCheckEpochTicket(document, event);
		if (!owned()) return;
		if (inspection) return;
		const detail = (event as CustomEvent).detail;
		const gate = pages[current].gates.find((item) => item.id === detail?.blockId);
		const exhausted =
			detail?.submitted === true &&
			Number.isSafeInteger(detail.attemptsUsed) &&
			Number.isFinite(detail.maxAttempts) &&
			detail.maxAttempts > 0 &&
			detail.attemptsUsed >= detail.maxAttempts;
		if (gate && gateSatisfied(gate.rule, detail.correct, exhausted)) {
			released.add(gate.id);
			save(owned);
			refresh();
		}
		player?.pause(); // Feedback remains until explicit continuation.
	});
	on(document, "praxity:assessment-group-complete", (event) => {
		const owned = selfCheckEpochTicket(document, event);
		if (!owned()) return;
		if (inspection) return;
		const detail = (event as CustomEvent).detail;
		const gate = pages[current].gates.find((item) => item.id === detail?.groupId);
		if (gate && gateSatisfied(gate.rule, detail.passed, detail?.completed === true)) {
			released.add(gate.id);
			save(owned);
			refresh();
		}
		player?.pause();
	});
	root.dataset.ready = "true";
	scheduleStage();
	const cleanupToc = initializeFloatingToc();
	for (const element of root.querySelectorAll<HTMLElement>("[data-deck-enhanced]"))
		element.hidden = false;
	if (outlineToggle) outlineToggle.hidden = !hasOutline;
	const preferredPanel = readPanelPreference();
	// Fresh replacing layouts expose the lesson. Only an explicit learner choice
	// opens a panel here; leave storage untouched so wide visits keep authored defaults.
	const initialPanel =
		preferredPanel === "closed" || (preferredPanel === null && drawerLayout.matches)
			? null
			: (preferredPanel ??
				(design.initialPanel === "transcript"
					? "script"
					: design.initialPanel === "outline"
						? "outline"
						: null));
	panelTrigger =
		initialPanel === "script" ? scriptToggle : initialPanel === "outline" ? outlineToggle : null;
	if (!player) {
		if (follow.parentElement) follow.parentElement.hidden = true;
		advance.hidden = true;
		resumeRow.hidden = true;
	}
	let requested = pages.findIndex((page) => page.id === hashId());
	const params = new URLSearchParams(location.search);
	const carriedNotice = params.get(ACCESS_NOTICE_PARAM);
	if (carriedNotice !== null) {
		params.delete(ACCESS_NOTICE_PARAM);
		const url = new URL(location.href);
		url.search = params.toString();
		history.replaceState(null, "", url);
	}
	const resuming =
		!!resume && (requested < 0 || pages[requested].id === resume.pageId || !!carriedNotice);
	showPanel(
		initialPanel,
		!!initialPanel && preferredPanel !== null && drawerLayout.matches && !resuming,
	);
	if (requested < 0 && resume) requested = pages.findIndex((page) => page.id === resume.pageId);
	if (requested < 0) requested = current;
	const denied = requested > reachLimit(requested);
	const notice = denied
		? accessNotice(requested)
		: carriedNotice === "gate" || carriedNotice === "sequence"
			? carriedNotice
			: undefined;
	if (denied) requested = reachLimit(requested);
	const localDestination = localIds.has(pages[requested].id);
	move(requested, MoveReason.Restore, true, 0, notice);
	if (localDestination && notice) showAccessNotice(notice);
	if (localDestination && resuming) {
		const slide = slides.find((element) => element.dataset.deckSlide === pages[current].id);
		// Honor an intentionally opened replacing panel. Set arrival focus once,
		// after the restored slide and its transcript have both been resolved.
		const content = main?.inert
			? find(root.dataset.panel === "script" ? "script" : "outline")
			: slide;
		if (content) {
			const position = {
				current: localPages.indexOf(pages[current]) + 1,
				total: localPages.length,
				title: pages[current].title,
			};
			const target = presentScormResumeCue(content, {
				pageTitle: pages[current].title,
				positionPrefix: interpolate(
					window.__PRAXITY_STRINGS__?.deckResumePositionPrefix ?? "",
					position,
				),
				summary: interpolate(window.__PRAXITY_STRINGS__?.deckResumeAnnouncement ?? "", position),
			});
			target.tabIndex = -1;
			// Open the initial modal directly on the restored cue, preserving one
			// arrival focus instead of visiting Close and the heading first.
			sheetFocusTarget = target;
			initialSheetPending = false;
			syncPanelLayout();
			target.focus({ preventScroll: true });
		}
	}
	if (localDestination && navigationArrival && !resuming) {
		if (main?.inert) showPanel(null, false, true);
		focusSlide();
	}
	initialSheetPending = false;
	syncPanelLayout();
	sheetFocusTarget = null;
	const releaseStage = afterSelfCheckFinalization(document, scheduleStage, "settled");
	return () => {
		releaseStage();
		cancelFrames();
		releaseNavigationFocus();
		cancelAnimationFrame(stageFrame);
		releaseStageObserver();
		moreBelow.hidden = true;
		root.style.removeProperty("--deck-footer-height");
		cancelAnimationFrame(focusReturnFrame);
		pendingSheetFocus = null;
		releasePanelObserver();
		if (sheet.open) sheet.close();
		if (sidebar?.parentElement === sheet) sidebarHome.after(sidebar);
		if (resumeRow.parentElement === scrollContainer) resumeHome.after(resumeRow);
		resumeHome.remove();
		sheet.remove();
		sidebarHome.remove();
		removeScormResumeCue(root);
		gateNotice.remove();
		cleanupToc();
		player?.destroy();
		narrationPlaying = false;
		syncCardPlayback();
		listeners.abort();
		if (window.__praxityActivateDeckControl === activateControl)
			delete window.__praxityActivateDeckControl;
		moreDisclosure?.destroy();
		for (const reading of readings) {
			reading.hidden = false;
			reading.inert = false;
		}
		delete root.dataset.ready;
	};
}

export { initDeck as attachIsland };

declare global {
	interface Window {
		PraxityDeckIsland?: { attachIsland: typeof initDeck };
	}
}
if (typeof document !== "undefined" && shouldAttachIslandAutomatically()) {
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", () => initDeck(), { once: true });
	else initDeck();
	window.addEventListener("praxity:runtime-ready", () => initDeck(), {
		once: true,
	});
}
