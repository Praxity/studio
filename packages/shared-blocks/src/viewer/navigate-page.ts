"use client";

import { finishLearnerCourse, learnerRuntime, learnerTracker } from "../learner-block-state";
import {
	isSelfCheckForwardBlocked,
	selfCheckConsumers,
	selfCheckEpochTicket,
} from "../self-check-consumers";
import { clearRequiredValidation, showRequiredValidation } from "./required-blocks";

const PAGE_NAVIGATION_FOCUS_KEY = "praxity:focus-page-content";

export function markPageNavigationFocus(): void {
	try {
		sessionStorage.setItem(PAGE_NAVIGATION_FOCUS_KEY, "true");
	} catch {
		// Storage can be unavailable in locked-down LMS frames.
	}
}

export function consumePageNavigationFocus(): boolean {
	try {
		const shouldFocus = sessionStorage.getItem(PAGE_NAVIGATION_FOCUS_KEY) === "true";
		sessionStorage.removeItem(PAGE_NAVIGATION_FOCUS_KEY);
		return shouldFocus;
	} catch {
		return false;
	}
}

declare global {
	interface Window {
		__praxityDecoratePageHref?: (href: string) => string;
		__praxityNavigatePageHref?: (href: string) => boolean;
		__praxityLogicEngine?: {
			evaluate: () => void;
			getJumpTarget: () => string | null;
			isCompletionBlocked?: () => boolean;
		};
		__praxityPageIdMap?: Record<string, string>;
		__PRAXITY_STRINGS__?: Record<string, string>;
	}
}

function navigateHref(href: string): void {
	if (window.__praxityNavigatePageHref?.(href)) return;
	window.location.href = href;
}

function runtimePageHref(slug: string, basePath?: string): string {
	const href = pageHref(slug, basePath);
	return window.__praxityDecoratePageHref?.(href) ?? href;
}

function isForwardProgressBlocked(): boolean {
	if (isSelfCheckForwardBlocked()) return true;
	const engine = window.__praxityLogicEngine;
	engine?.evaluate();
	return engine?.isCompletionBlocked?.() ?? false;
}

/**
 * Early shell navigation when no enhanced control is installed. Keep this path
 * independent of required-block presentation so first paint stays within the
 * shell's size budget; enhanced controls use navigatePage's full validation.
 */
export function navigateFallbackPageHref(href: string, direction: "forward" | "backward"): boolean {
	if (direction === "forward" && isForwardProgressBlocked()) return false;
	if (direction === "forward" && selfCheckConsumers()?.validateForward?.() === false) return false;
	navigateHref(window.__praxityDecoratePageHref?.(href) ?? href);
	return true;
}

/**
 * Href for a page in the published output.
 *
 * Without a base path the link MUST stay relative: an export opened from
 * `file://` or served from a subdirectory resolves `/glossary.html` against the
 * filesystem or site root and 404s. Every control builds links through here —
 * the copies that predated it drifted, which is how the course menu shipped
 * root-absolute hrefs while Next/Previous stayed relative.
 */
export function pageHref(slug: string, basePath?: string): string {
	const base = basePath?.replace(/\/$/, "") ?? "";
	return base ? `${base}/${slug}.html` : `./${slug}.html`;
}

export interface NavigatePageOptions {
	targetSlug: string;
	direction: "forward" | "backward";
	currentSlug?: string;
	basePath?: string;
	trigger?: "linear" | "button" | "module";
	pageIdMap?: Record<string, string>;
}

function pageIdForSlug(slug: string, pageIdMap?: Record<string, string>): string {
	const entries = Object.entries(pageIdMap ?? window.__praxityPageIdMap ?? {});
	return entries.find(([, mappedSlug]) => mappedSlug === slug)?.[0] ?? slug;
}

export function navigateUtilityPage(targetSlug: string, basePath?: string): void {
	if (typeof window === "undefined") return;
	clearRequiredValidation();
	markPageNavigationFocus();
	navigateHref(runtimePageHref(targetSlug, basePath));
}

/**
 * The one page-navigation path every learner control shares: required-block
 * validation, logic-engine jumps, visit tracking, then the href.
 *
 * Each control used to carry its own copy, which is how they drifted — a control
 * added later could silently skip the logic engine or the required-block gate.
 */
export function navigatePage({
	targetSlug,
	direction,
	currentSlug,
	basePath,
	trigger = "linear",
	pageIdMap,
}: NavigatePageOptions): boolean {
	if (typeof window === "undefined") return false;
	const current = selfCheckEpochTicket();
	if (direction === "forward" && isSelfCheckForwardBlocked()) return false;

	clearRequiredValidation();
	if (direction === "forward" && trigger !== "module" && showRequiredValidation()) return false;

	let resolvedSlug = targetSlug;
	let jumpTarget: string | null = null;
	const engine = window.__praxityLogicEngine;
	if (direction === "forward" && isForwardProgressBlocked()) return false;
	if (engine && direction === "forward" && trigger === "linear") {
		jumpTarget = engine.getJumpTarget();
		if (jumpTarget) {
			if (jumpTarget === "__end_lesson__") {
				return finishLearnerCourse(current);
			}
			if (jumpTarget !== "__next_page__") {
				const mapped = window.__praxityPageIdMap?.[jumpTarget];
				if (mapped) resolvedSlug = mapped;
			}
		}
	}

	if (learnerTracker(current) && currentSlug) {
		const trackingTrigger = direction === "forward" && jumpTarget ? "logic-rule" : trigger;
		learnerRuntime(current)?.trackNavigation?.(
			pageIdForSlug(currentSlug, pageIdMap),
			pageIdForSlug(resolvedSlug, pageIdMap),
			trackingTrigger,
		);
	}

	markPageNavigationFocus();
	navigateHref(runtimePageHref(resolvedSlug, basePath));
	return true;
}

interface PageActionConfig {
	currentPage: number;
	currentSlug: string;
	basePath?: string;
	pages: string[];
	pageIdMap: Record<string, string>;
}

function readPageActionConfig(rawConfig?: unknown): PageActionConfig | null {
	let value = rawConfig;
	if (value === undefined) {
		const text = document.getElementById("praxity-config")?.textContent;
		if (!text) return null;
		try {
			value = JSON.parse(text);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;

	const config = value as Record<string, unknown>;
	if (
		typeof config.currentPage !== "number" ||
		!Number.isInteger(config.currentPage) ||
		config.currentPage < 1 ||
		typeof config.currentSlug !== "string" ||
		!Array.isArray(config.pages) ||
		!config.pageIdMap ||
		typeof config.pageIdMap !== "object" ||
		Array.isArray(config.pageIdMap)
	) {
		return null;
	}

	const pages: string[] = [];
	for (const page of config.pages) {
		if (
			!page ||
			typeof page !== "object" ||
			typeof (page as { slug?: unknown }).slug !== "string"
		) {
			return null;
		}
		pages.push((page as { slug: string }).slug);
	}
	const pageIdMap: Record<string, string> = {};
	for (const [pageId, slug] of Object.entries(config.pageIdMap)) {
		if (typeof slug === "string") pageIdMap[pageId] = slug;
	}

	return {
		currentPage: config.currentPage,
		currentSlug: config.currentSlug,
		basePath: typeof config.basePath === "string" ? config.basePath : undefined,
		pages,
		pageIdMap,
	};
}

/** Run a published goToPage button action through the shared navigation path. */
export function navigatePageAction(targetPageId: string, rawConfig?: unknown): boolean {
	if (typeof window === "undefined" || typeof document === "undefined") return false;
	const current = selfCheckEpochTicket();
	const config = readPageActionConfig(rawConfig);
	if (!config) return false;

	if (targetPageId === "__end_lesson__") {
		if (isSelfCheckForwardBlocked()) return false;
		clearRequiredValidation();
		if (showRequiredValidation()) return false;
		if (isForwardProgressBlocked()) return false;
		return finishLearnerCourse(current);
	}

	const currentIndex = config.pages.indexOf(config.currentSlug);
	const resolvedCurrentIndex = currentIndex >= 0 ? currentIndex : config.currentPage - 1;
	const targetSlug =
		targetPageId === "__next_page__"
			? config.pages[resolvedCurrentIndex + 1]
			: Object.hasOwn(config.pageIdMap, targetPageId)
				? config.pageIdMap[targetPageId]
				: undefined;
	const targetIndex = targetSlug ? config.pages.indexOf(targetSlug) : -1;
	if (!targetSlug || targetSlug === config.currentSlug || targetIndex < 0) return false;

	return navigatePage({
		targetSlug,
		direction: targetIndex > resolvedCurrentIndex ? "forward" : "backward",
		currentSlug: config.currentSlug,
		basePath: config.basePath,
		trigger: "button",
		pageIdMap: config.pageIdMap,
	});
}
