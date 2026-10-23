import { interpolate } from "@praxity/shared-blocks/i18n/interpolate";
import { learnerRuntime, learnerTracker } from "@praxity/shared-blocks/learner-block-state";
import {
	createSelfCheckIntersectionObserver,
	dispatchSelfCheckEvent,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";
import { announcePreference } from "@praxity/shared-blocks/viewer/a11y-preferences-store";
import {
	type FocusModeSession,
	installFocusMode,
} from "@praxity/shared-blocks/viewer/focus-mode-runtime";
import {
	consumePageNavigationFocus,
	navigatePage,
	navigatePageAction,
	navigateUtilityPage,
} from "@praxity/shared-blocks/viewer/navigate-page";
import { observePageScrollPadding } from "@praxity/shared-blocks/viewer/scroll-into-view";
import { readCourseSessionTime } from "../../../src/course-session-time";
import {
	formatCourseSessionTime,
	renderCourseCompletionResult,
} from "../components/course-completion-result";
import { focusNavigationContent, resumeFocusTarget } from "../components/navigation-content-focus";
import { initializeFloatingToc } from "./floating-toc";

interface ViewerConfigLike {
	courseTitle?: string;
	currentPage?: number;
	currentSlug?: string;
	pageIdMap?: Record<string, string>;
	pageTitle?: string;
	basePath?: string;
	pageFocusDefault?: boolean;
	pageRole?: string;
	navSwipeGestures?: boolean;
	navEdgeArrows?: boolean;
}

function readConfig(): ViewerConfigLike {
	const config = document.getElementById("praxity-config")?.textContent;
	if (!config) return {};
	try {
		return JSON.parse(config) as ViewerConfigLike;
	} catch {
		return {};
	}
}

const config = readConfig();
const strings = window.__PRAXITY_STRINGS__ ?? {};
const message = (key: string, fallback: string) => strings[key] ?? fallback;
const currentPage = Number(config.currentPage ?? 1);
const pendingFrames = new Set<number>();
let navigationEpoch = 0;
const cancelNavigationFrames = () => {
	++navigationEpoch;
	for (const frame of pendingFrames) cancelAnimationFrame(frame);
	pendingFrames.clear();
};
window.addEventListener("pagehide", cancelNavigationFrames);
document.addEventListener("praxity:self-check-owner", cancelNavigationFrames);
function scheduleNavigationFrame(effect: () => void): number {
	const current = selfCheckEpochTicket();
	const epoch = navigationEpoch;
	let frame: number | undefined;
	frame = requestSelfCheckFrame(() => {
		if (frame !== undefined) pendingFrames.delete(frame);
		if (epoch === navigationEpoch && current()) effect();
	}, current);
	pendingFrames.add(frame);
	return frame;
}

function focusPageContent(): void {
	const main = document.getElementById("main-content");
	if (!main) return;
	const target = resumeFocusTarget(main, "h1, h2, h3, h4, h5, h6");
	focusNavigationContent(target, main);
}

function initializePageFocus(): void {
	const mount = selfCheckEpochTicket();
	if (
		!learnerRuntime(mount) &&
		config.pageRole !== "glossary" &&
		document.getElementById("praxity-deployment-config")
	) {
		window.addEventListener("praxity:runtime-ready", initializePageFocus, { once: true });
		return;
	}
	if (window.__praxityResume) {
		consumePageNavigationFocus();
		return;
	}
	if (consumePageNavigationFocus()) scheduleNavigationFrame(focusPageContent);
	// A content page writes nothing on arrival. Its focused heading names the page,
	// and the counter and outline expose position. A separate position-plus-title
	// message repeated the heading and competed with focus (NVDA dropped it on one
	// of three arrivals); see "Pages arrival orientation" in
	// docs/context/published-output-runtime.md. Utility pages keep their title.
	if (config.pageRole !== "glossary" && config.pageRole !== "resources") return;
	const title = config.pageTitle ?? "";
	scheduleNavigationFrame(() => announcePreference(title));
}

function initializeLinks(): void {
	const mount = selfCheckEpochTicket();
	document.querySelectorAll<HTMLAnchorElement>("[data-page-slug]").forEach((link) => {
		link.addEventListener("click", (event) => {
			if (event.defaultPrevented || link.target === "_blank") return;
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}
			const targetSlug = link.dataset.pageSlug;
			if (!targetSlug) return;
			event.preventDefault();
			if (targetSlug === config.currentSlug) return;
			if (link.hasAttribute("data-nav-utility")) {
				navigateUtilityPage(targetSlug, config.basePath);
				return;
			}
			const targetPage = Number(link.dataset.pageNumber ?? currentPage);
			navigatePage({
				targetSlug,
				direction: targetPage > currentPage ? "forward" : "backward",
				currentSlug: config.currentSlug,
				basePath: config.basePath,
				pageIdMap: config.pageIdMap,
				trigger: link.hasAttribute("data-module-pages") ? "module" : "linear",
			});
		});
	});

	const visited = new Set(learnerRuntime(mount)?.getVisitedPages?.() ?? []);
	document.querySelectorAll<HTMLElement>("[data-module-pages]").forEach((link) => {
		const ids = JSON.parse(link.dataset.modulePages ?? "[]") as string[];
		if (
			ids.length &&
			ids.every((id) => visited.has(id) || visited.has(config.pageIdMap?.[id] ?? ""))
		) {
			link.dataset.visited = "true";
			link.querySelector<HTMLElement>(".praxity-nav-visited-label")?.removeAttribute("hidden");
		}
	});
	document
		.querySelectorAll<HTMLElement>("[data-page-slug],.praxity-progress-dot[data-page-id]")
		.forEach((link) => {
			const pageId = link.dataset.pageId;
			const slug = link.dataset.pageSlug;
			if (!(pageId && visited.has(pageId)) && !(slug && visited.has(slug))) return;
			link.dataset.visited = "true";
			if (link.classList.contains("praxity-progress-dot")) link.classList.add("is-visited");
			link.querySelector<HTMLElement>(".praxity-nav-visited-label")?.removeAttribute("hidden");
		});

	document
		.querySelectorAll<HTMLButtonElement>('[data-action="goToPage"][data-target-page]')
		.forEach((button) => {
			button.addEventListener("click", () => {
				const current = selfCheckEpochTicket();
				const targetPageId = button.dataset.targetPage;
				if (!targetPageId) return;
				navigatePageAction(targetPageId, config);
				dispatchSelfCheckEvent(
					new CustomEvent("praxity:block-interaction", {
						detail: { blockId: button.dataset.blockId, blockType: "button" },
					}),
					current,
					document,
				);
			});
		});
}

function initializeSwipe(): void {
	if (config.navSwipeGestures !== true && config.navEdgeArrows !== true) return;
	let startX: number | undefined;
	let startY: number | undefined;
	let ignored = false;
	const reset = () => {
		startX = undefined;
		startY = undefined;
		ignored = false;
	};
	document.addEventListener(
		"touchstart",
		(event) => {
			const target = event.target;
			const touch = event.touches[0];
			ignored =
				!(target instanceof Element) ||
				target.closest(
					'[data-praxity-swipe-ignore],[role="slider"],[role="scrollbar"],[role="listbox"]',
				) !== null;
			if (ignored || !touch) return;
			startX = touch.clientX;
			startY = touch.clientY;
		},
		{ passive: true },
	);
	document.addEventListener(
		"touchend",
		(event) => {
			const touch = event.changedTouches[0];
			if (ignored || startX === undefined || startY === undefined || !touch) {
				reset();
				return;
			}
			const deltaX = touch.clientX - startX;
			const deltaY = touch.clientY - startY;
			reset();
			if (Math.abs(deltaX) < 50 || Math.abs(deltaY) > Math.abs(deltaX)) return;
			document
				.querySelector<HTMLElement>(
					`[data-page-direction="${deltaX < 0 ? "next" : "previous"}"]:not([disabled])`,
				)
				?.click();
		},
		{ passive: true },
	);
	document.addEventListener("touchcancel", reset, { passive: true });
}

function initializeScrollProgress(): void {
	const progress = document.querySelector<HTMLElement>("[data-native-scroll-progress]");
	const fill = progress?.querySelector<HTMLElement>("[data-native-scroll-progress-fill]");
	if (!progress || !fill) return;
	let frame = 0;
	const update = () => {
		if (frame) return;
		frame = scheduleNavigationFrame(() => {
			frame = 0;
			const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
			const value =
				maxScroll > 0 ? Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100)) : 100;
			fill.style.transform = `scaleX(${value / 100})`;
			progress.setAttribute("aria-valuenow", String(Math.round(value)));
		});
	};
	window.addEventListener("scroll", update, { passive: true });
	window.addEventListener("resize", update);
	const cancelProgress = () => {
		frame = 0;
	};
	window.addEventListener("pagehide", cancelProgress);
	document.addEventListener("praxity:self-check-owner", cancelProgress);
	update();
}

function initializeNarrativeBar(): void {
	const bar = document.querySelector<HTMLElement>("[data-native-narrative-bar]");
	const text = bar?.querySelector<HTMLElement>("[data-native-narrative-text]");
	const sectionCount = Number(bar?.dataset.sectionCount ?? 0);
	if (!bar || !text || sectionCount <= 1 || typeof IntersectionObserver === "undefined") return;
	const readTime = Number(text.dataset.readTime ?? 0);
	const render = (currentSection: number) => {
		const section = message("narrativeSectionPosition", "Section {current} of {total}")
			.replaceAll("{current}", String(currentSection))
			.replaceAll("{total}", String(sectionCount));
		const duration =
			readTime > 0
				? message("narrativeReadTime", "~{minutes} min").replaceAll("{minutes}", String(readTime))
				: "";
		text.textContent = [section, duration].filter(Boolean).join(" · ");
	};
	const sections = Array.from(
		document.querySelectorAll<HTMLElement>(".praxity-section[data-section-index]"),
	);
	observeSelfCheckLifetime((current) => {
		const observer = createSelfCheckIntersectionObserver(
			current,
			(entries) => {
				if (!current()) return;
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
				if (!visible) return;
				const index = Number((visible.target as HTMLElement).dataset.sectionIndex ?? 0);
				render(Math.min(sectionCount, Math.max(1, index + 1)));
			},
			{ rootMargin: "-12% 0px -55% 0px", threshold: [0.25, 0.5, 0.75] },
		);
		for (const section of sections) observer.observe(section);
		return () => observer.disconnect();
	});
}

function initializeFocusMode(): void {
	const scope = document.getElementById("main-content");
	if (!scope) return;
	const session: FocusModeSession = {};
	let active: boolean | undefined;
	let stop: () => void = () => undefined;
	const sync = (enabled: boolean) => {
		if (enabled === active) return;
		stop();
		stop = installFocusMode(enabled, scope, session, String(currentPage));
		active = enabled;
	};
	sync(document.documentElement.dataset.praxityFocusMode === "true");
	document.addEventListener("praxity:focus-mode-change", (event) => {
		const enabled = (event as CustomEvent<{ enabled?: unknown }>).detail?.enabled;
		if (typeof enabled === "boolean") sync(enabled);
	});
}

function centerLinkInSidebar(sidebar: HTMLElement, link: HTMLElement | null): void {
	if (!link || sidebar.clientHeight <= 0) return;
	const sidebarTop = sidebar.getBoundingClientRect().top;
	const linkTop = link.getBoundingClientRect().top;
	const centered =
		sidebar.scrollTop + linkTop - sidebarTop - sidebar.clientHeight / 2 + link.offsetHeight / 2;
	const maxScroll = Math.max(0, sidebar.scrollHeight - sidebar.clientHeight);
	sidebar.scrollTop = Math.min(maxScroll, Math.max(0, centered));
}

function initializeMenu(): void {
	const sidebar = document.querySelector<HTMLElement>("[data-native-outline]");
	if (!sidebar) return;
	const syncHeaderDivider = () => {
		sidebar.toggleAttribute("data-outline-scrolled", sidebar.scrollTop > 0);
	};
	sidebar.addEventListener("scroll", syncHeaderDivider, { passive: true });
	syncHeaderDivider();
	const mobileToggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
	const mobileClose = sidebar.querySelector<HTMLButtonElement>("[data-nav-menu-close]");
	const backdrop = document.querySelector<HTMLButtonElement>("[data-nav-backdrop]");
	const collapse = sidebar.querySelector<HTMLButtonElement>("[data-sidebar-collapse]");
	const expand = document.querySelector<HTMLButtonElement>("[data-sidebar-expand]");
	const currentLink = sidebar.querySelector<HTMLElement>('[aria-current="page"]');
	const desktop = window.matchMedia("(min-width: 768px)");
	const background = Array.from(
		document.querySelectorAll<HTMLElement>(
			".praxity-skip-link,#main-content,.praxity-top-bar-fallback,.praxity-page-nav-fallback,.praxity-a11y-dock",
		),
	).filter((element) => !sidebar.contains(element));
	let drawerOpen = false;
	let collapsed = false;
	if (collapse && expand) {
		try {
			collapsed =
				localStorage.getItem(`praxity-sidebar-${config.courseTitle ?? ""}`) === "collapsed";
		} catch {
			// Storage can be unavailable in LMS frames.
		}
	}
	const isPersistentDesktop = () =>
		desktop.matches &&
		document.body.classList.contains("praxity-layout-sidebar") &&
		!sidebar.hasAttribute("data-nav-drawer");

	const sync = () => {
		const persistent = isPersistentDesktop();
		document.body.classList.toggle("praxity-sidebar-collapsed", persistent && collapsed);
		document.body.classList.toggle("praxity-nav-open", !persistent && drawerOpen);
		for (const element of background) {
			if (!persistent && drawerOpen) element.setAttribute("inert", "");
			else element.removeAttribute("inert");
		}
		mobileToggle?.setAttribute("aria-expanded", String(!persistent && drawerOpen));
		collapse?.setAttribute("aria-expanded", String(persistent && !collapsed));
		expand?.setAttribute("aria-expanded", String(persistent && !collapsed));
		if ((persistent && collapsed) || (!persistent && !drawerOpen)) {
			sidebar.setAttribute("inert", "");
		} else sidebar.removeAttribute("inert");
	};
	const handleDesktopChange = () => {
		const focusWasInsideSidebar = sidebar.contains(document.activeElement);
		if (isPersistentDesktop()) drawerOpen = false;
		sync();
		if (focusWasInsideSidebar && sidebar.hasAttribute("inert")) mobileToggle?.focus();
	};
	const closeDrawer = () => {
		drawerOpen = false;
		sync();
	};
	mobileToggle?.addEventListener("click", () => {
		drawerOpen = !drawerOpen;
		sync();
		if (drawerOpen) {
			centerLinkInSidebar(sidebar, currentLink);
			scheduleNavigationFrame(() => {
				if (drawerOpen) (currentLink ?? mobileClose)?.focus({ preventScroll: true });
			});
		}
	});
	mobileClose?.addEventListener("click", () => {
		closeDrawer();
		mobileToggle?.focus();
	});
	backdrop?.addEventListener("click", () => {
		closeDrawer();
		mobileToggle?.focus();
	});
	sidebar.addEventListener("click", (event) => {
		if (!drawerOpen || !(event.target instanceof Element) || !event.target.closest("a[href]")) {
			return;
		}
		closeDrawer();
		mobileToggle?.focus();
	});
	const toggleDesktop = (moveFocus = false) => {
		if (!isPersistentDesktop()) return;
		const focusWasInsideSidebar = sidebar.contains(document.activeElement);
		collapsed = !collapsed;
		try {
			localStorage.setItem(
				`praxity-sidebar-${config.courseTitle ?? ""}`,
				collapsed ? "collapsed" : "expanded",
			);
		} catch {
			// Storage can be unavailable in LMS frames.
		}
		sync();
		if (moveFocus || (collapsed && focusWasInsideSidebar)) {
			(collapsed ? expand : collapse)?.focus();
		}
	};
	collapse?.addEventListener("click", () => toggleDesktop(true));
	expand?.addEventListener("click", () => toggleDesktop(true));
	desktop.addEventListener("change", handleDesktopChange);
	document.addEventListener("keydown", (event) => {
		const target = event.target as HTMLElement | null;
		if (event.key === "Tab" && drawerOpen && !isPersistentDesktop()) {
			const focusable = Array.from(
				sidebar.querySelectorAll<HTMLElement>(
					'a[href],button:not([disabled]):not([data-sidebar-collapse]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
				),
			).filter((element) => !element.closest('[hidden],[inert],[aria-hidden="true"]'));
			const first = focusable[0];
			const last = focusable.at(-1);
			if (first && last && event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
				return;
			}
			if (first && last && !event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
				return;
			}
		}
		if (event.key === "Escape" && drawerOpen) {
			event.preventDefault();
			closeDrawer();
			mobileToggle?.focus();
			return;
		}
		if (
			event.key === "[" &&
			collapse !== null &&
			expand !== null &&
			isPersistentDesktop() &&
			!target?.matches("input,textarea,select") &&
			!target?.isContentEditable
		) {
			event.preventDefault();
			toggleDesktop(false);
		}
	});
	sync();
	scheduleNavigationFrame(() => centerLinkInSidebar(sidebar, currentLink));
}

export function initNavigationIsland(): void {
	const mount = selfCheckEpochTicket();
	observePageScrollPadding(document);
	const updateCompletion = () => {
		if (!mount()) return;
		if (document.body.classList.contains("praxity-layout-slides")) return;
		const courseId = document.getElementById("praxity-course-meta")?.dataset.courseId;
		if (!courseId) return;
		const time = readCourseSessionTime(courseId, Date.now(), () => window.sessionStorage);
		const label = document.querySelector<HTMLElement>("[data-course-time]");
		const strings = window.__PRAXITY_STRINGS__;
		if (label && strings) {
			label.textContent =
				"error" in time
					? strings.courseTimeUnavailable
					: formatCourseSessionTime(time, document.documentElement.lang || "en", strings);
		}
		if (strings)
			renderCourseCompletionResult(
				document,
				strings,
				learnerTracker(mount)?.getOutcome?.(),
				learnerRuntime(mount)?.getScore?.(),
			);
	};
	updateCompletion();
	window.addEventListener("praxity:runtime-ready", updateCompletion);
	for (const type of document.querySelector("[data-course-outcome]")
		? ["praxity:block-interaction", "praxity:assessment-group-complete"]
		: []) {
		document.addEventListener(type, (event) => {
			const current = selfCheckEpochTicket(document, event);
			// Assessment effects save final answer state after the submission dispatch.
			if (current())
				scheduleNavigationFrame(() => {
					if (current()) updateCompletion();
				});
		});
	}

	initializeLinks();
	initializeSwipe();
	initializeScrollProgress();
	initializeFloatingToc();
	initializeNarrativeBar();
	initializeFocusMode();
	initializeMenu();
	initializePageFocus();
	document.querySelectorAll<HTMLElement>('[data-island="nav"]').forEach((root) => {
		root.setAttribute("data-hydrated", "");
	});
	document.documentElement.classList.add("praxity-js-loaded");
}

export { initNavigationIsland as attachIsland };

if (shouldAttachIslandAutomatically()) initNavigationIsland();
