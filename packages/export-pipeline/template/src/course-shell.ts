import { isSmallPreviewDocument } from "@praxity/shared-blocks/course-preview-protocol";
import { isSelfCheckForwardBlocked } from "@praxity/shared-blocks/self-check-consumers";
import {
	applyA11yPreferences,
	applyReducedMotion,
	readA11yPreferences,
	writeA11yPreferences,
} from "@praxity/shared-blocks/viewer/a11y-preferences-store";
import { rememberGlossaryFocusReturn } from "@praxity/shared-blocks/viewer/glossary-focus-return";
import { navigateFallbackPageHref } from "@praxity/shared-blocks/viewer/navigate-page";
import { scrollElementIntoView } from "@praxity/shared-blocks/viewer/scroll-into-view";

import { resetScormSessions } from "../../src/scorm/api/session";
import type { ScormResumeCueOptions } from "./components/scorm-resume-focus";
import type { CourseHostConfig } from "./hosts/course-host";

type PageShellConfig = {
	version: 1;
	kind: "page";
	colorMode: "light" | "dark" | "auto";
	pageFocusDefault: boolean;
	enableJsNav: boolean;
	entrance: "none" | "fade" | "slide" | "scale";
	stagger: "none" | "sequential";
	keyboardArrows: boolean;
	previousHref?: string;
	nextHref?: string;
	currentPage: number;
	slugs: string[];
	sidebarPreferenceKey?: string;
	resumeFilename?: string;
};

type RedirectShellConfig = {
	version: 1;
	kind: "redirect";
	target: string;
	prefix?: string;
	pageIdMap?: Record<string, string>;
};

type CourseShellConfig = PageShellConfig | RedirectShellConfig;

declare global {
	interface Window {
		__PRAXITY_INIT_ENTRANCE_MOTION__?: (root: HTMLElement) => void;
		__PRAXITY_STRINGS__?: Record<string, string>;
		__praxitySmallPreviewDecorations?: Promise<unknown>;
		__PRAXITY_FOCUS_SCORM_RESUME__?: (doc: Document, options: ScormResumeCueOptions) => void;
	}
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function readConfig(): CourseShellConfig | null {
	const node = document.getElementById("praxity-shell-config");
	if (!node?.textContent) return null;
	try {
		const value = JSON.parse(node.textContent) as Record<string, unknown>;
		if (value.version !== 1) return null;
		if (value.kind === "redirect" && typeof value.target === "string") {
			return {
				version: 1,
				kind: "redirect",
				target: value.target,
				prefix: typeof value.prefix === "string" ? value.prefix : undefined,
				pageIdMap: stringRecord(value.pageIdMap),
			};
		}
		if (value.kind !== "page") return null;
		const colorMode =
			value.colorMode === "dark" || value.colorMode === "auto" ? value.colorMode : "light";
		const entrance =
			value.entrance === "fade" || value.entrance === "slide" || value.entrance === "scale"
				? value.entrance
				: "none";
		return {
			version: 1,
			kind: "page",
			colorMode,
			pageFocusDefault: value.pageFocusDefault === true,
			enableJsNav: value.enableJsNav === true,
			entrance,
			stagger: value.stagger === "sequential" ? "sequential" : "none",
			keyboardArrows: value.keyboardArrows === true,
			previousHref: typeof value.previousHref === "string" ? value.previousHref : undefined,
			nextHref: typeof value.nextHref === "string" ? value.nextHref : undefined,
			currentPage:
				typeof value.currentPage === "number" && Number.isInteger(value.currentPage)
					? value.currentPage
					: 1,
			slugs: Array.isArray(value.slugs)
				? value.slugs.filter((slug): slug is string => typeof slug === "string")
				: [],
			sidebarPreferenceKey:
				typeof value.sidebarPreferenceKey === "string" ? value.sidebarPreferenceKey : undefined,
			resumeFilename: typeof value.resumeFilename === "string" ? value.resumeFilename : undefined,
		};
	} catch {
		return null;
	}
}

function redirect(config: RedirectShellConfig): void {
	const params = new URLSearchParams(location.search);
	const pageId = params.get("praxity-page");
	let target = config.target;
	if (pageId && config.pageIdMap && Object.hasOwn(config.pageIdMap, pageId)) {
		target = `${config.prefix ?? ""}${config.pageIdMap[pageId]}.html`;
		params.delete("praxity-page");
		// The stable-ID route stays in this SCO, including native GET forms.
		params.set("praxity-resume", "0");
	} else if (config.pageIdMap) {
		// Only the launch entry without a selected page resets communication bookkeeping.
		resetScormSessions(window);
	}
	const url = new URL(target, location.href);
	url.search = params.toString();
	url.hash = location.hash || url.hash;
	location.replace(url.href);
}

function applyColorMode(mode: PageShellConfig["colorMode"]): void {
	const media = mode === "auto" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
	const apply = (dark: boolean) => {
		document.documentElement.dataset.praxityMode = dark ? "dark" : "light";
		document.documentElement.classList.toggle("praxity-theme-dark", dark);
		document.documentElement.classList.toggle("praxity-theme-light", !dark);
	};
	apply(media ? media.matches : mode === "dark");
	media?.addEventListener("change", (event) => apply(event.matches));
}

function applyFirstPaintPreferences(config: PageShellConfig, smallPreview = false): void {
	const stored = smallPreview
		? { textSize: "default" as const, focusChoice: null }
		: readA11yPreferences();
	applyA11yPreferences(
		stored.textSize ?? "default",
		smallPreview ? false : (stored.focusChoice ?? config.pageFocusDefault),
	);
	const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
	applyReducedMotion(motion?.matches ?? false);
	motion?.addEventListener("change", (event) => applyReducedMotion(event.matches));
	applyColorMode(config.colorMode);
	document.documentElement.classList.add("praxity-shell-ready");
	if (document.documentElement.dataset.praxityIslands?.split(",").includes("assessmentGroup"))
		document.documentElement.classList.add("praxity-assessment-group-ready");
	if (!smallPreview && config.enableJsNav) document.documentElement.classList.add("praxity-js");
	if (!smallPreview && (config.entrance !== "none" || config.stagger !== "none")) {
		document.documentElement.dataset.praxityMotionEntrance = config.entrance;
		document.documentElement.dataset.praxityMotionStagger = config.stagger;
	}
}

function restoreFallbackWhenRuntimeFails(config: PageShellConfig): void {
	const failed = () => {
		document.documentElement.dataset.praxityFallback = "";
		document.documentElement.classList.remove("praxity-assessment-group-ready");
	};
	window.addEventListener("praxity:islands-failed", failed);
	window.addEventListener("unhandledrejection", failed);
	window.addEventListener(
		"error",
		(event: Event) => {
			if (event instanceof ErrorEvent || event.target instanceof HTMLScriptElement) failed();
		},
		true,
	);
	if (!config.enableJsNav) return;
	document.addEventListener(
		"DOMContentLoaded",
		() => {
			if (document.documentElement.classList.contains("praxity-js-loaded")) return;
			document.documentElement.classList.remove("praxity-js");
			document.body.classList.remove("praxity-nav-open", "praxity-sidebar-collapsed");
			document.querySelectorAll<HTMLElement>('[data-island="nav"]').forEach((element) => {
				element.removeAttribute("inert");
			});
		},
		{ once: true },
	);
}

function applyBodyState(config: PageShellConfig, smallPreview = false): boolean {
	if (!document.body) return false;
	const params = new URLSearchParams(location.search);
	if (smallPreview || params.get("minimal") === "1" || params.get("embed") === "1") {
		document.body.classList.add("praxity-minimal");
	}
	if (smallPreview) {
		document.body.classList.add("praxity-small-preview");
		return true;
	}
	if (config.sidebarPreferenceKey) {
		try {
			if (localStorage.getItem(config.sidebarPreferenceKey) === "collapsed") {
				document.body.classList.add("praxity-sidebar-collapsed");
			}
		} catch {
			// Locked-down LMS frames may deny web storage.
		}
	}
	return true;
}

function installBodyState(config: PageShellConfig, smallPreview = false): void {
	if (applyBodyState(config, smallPreview)) return;
	const observer = new MutationObserver(() => {
		if (!applyBodyState(config, smallPreview)) return;
		observer.disconnect();
	});
	observer.observe(document.documentElement, { childList: true });
}

function installSmallPreviewPresentation(): void {
	const projectSlide = () => {
		const slides = [...document.querySelectorAll<HTMLElement>("[data-deck-slide]")];
		if (!slides.length) return;
		let requested = location.hash.slice(1);
		try {
			requested = decodeURIComponent(requested);
		} catch {
			/* Use the first slide for malformed fragments. */
		}
		const selected = slides.find((slide) => slide.dataset.deckSlide === requested) ?? slides[0];
		for (const slide of slides) slide.hidden = slide !== selected;
		document
			.querySelectorAll<HTMLElement>(
				"#deck-script,.deck-panels,[data-deck-enhanced],.deck-utilities,.deck-module-links,#main-content > .praxity-page-title",
			)
			.forEach((node) => {
				node.hidden = true;
			});
	};
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", projectSlide, { once: true });
	else projectSlide();
	window.addEventListener("hashchange", projectSlide);
	document.documentElement.dataset.praxitySmallPreview = "true";
	const reportReady = async () => {
		await window.__praxitySmallPreviewDecorations;
		await document.fonts?.ready;
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				document.documentElement.dataset.praxitySmallPreviewReady = "true";
				window.parent.postMessage({ type: "praxity-small-preview-ready", url: location.href }, "*");
			});
		});
	};
	if (document.readyState === "complete") void reportReady();
	else window.addEventListener("load", () => void reportReady(), { once: true });
	if (new URLSearchParams(location.search).get("praxity-preview-expand") === "1") {
		document.documentElement.dataset.praxityPreviewExpand = "true";
		const observeHeight = () => {
			const main = document.getElementById("main-content");
			if (!main || window.parent === window) return;
			let previousHeight = -1;
			const observer = new ResizeObserver(() => {
				const height = Math.ceil(main.getBoundingClientRect().height);
				if (height === previousHeight) return;
				previousHeight = height;
				// Geometry only; the desktop accepts messages only from its current frame.
				window.parent.postMessage(
					{ type: "praxity-small-preview-height", url: location.href, height },
					"*",
				);
			});
			observer.observe(main);
		};
		if (document.readyState === "loading")
			document.addEventListener("DOMContentLoaded", observeHeight, { once: true });
		else observeHeight();
	}

	const preventInteraction = (event: Event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest("a,button,summary,input,select,textarea,[role=button]")) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};
	document.addEventListener("click", preventInteraction, true);
	document.addEventListener("submit", preventInteraction, true);

	const guardMedia = (media: HTMLMediaElement) => {
		if (media.dataset.praxitySmallPreviewGuarded === "true") return;
		media.dataset.praxitySmallPreviewGuarded = "true";
		media.autoplay = false;
		media.removeAttribute("autoplay");
		media.preload = "none";
		try {
			media.pause();
		} catch {
			// A locked-down document may not expose media controls.
		}
		media.addEventListener(
			"play",
			() => {
				try {
					media.pause();
				} catch {
					// Keep the static preview usable when pause is unavailable.
				}
			},
			true,
		);
	};
	const preventMediaPlayback = (event: Event) => {
		const target = event.target;
		if (!(target instanceof HTMLMediaElement)) return;
		guardMedia(target);
		try {
			target.pause();
		} catch {
			// Keep a static preview usable when media controls are unavailable.
		}
	};
	const ownerDocument = document;
	const guardCurrentMedia = () => {
		ownerDocument.querySelectorAll<HTMLMediaElement>("audio,video").forEach(guardMedia);
	};
	document.addEventListener("play", preventMediaPlayback, true);
	guardCurrentMedia();
	const observer = new MutationObserver(guardCurrentMedia);
	if (ownerDocument.documentElement) {
		observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });
	}
}

function installStrings(): void {
	const node = document.getElementById("praxity-config");
	if (!node?.textContent) return;
	try {
		const value = JSON.parse(node.textContent) as { strings?: unknown };
		const strings = stringRecord(value.strings);
		if (strings) window.__PRAXITY_STRINGS__ = strings;
	} catch {
		// The UI runtime will keep its built-in strings when config is invalid.
	}
}

function installReadingPreferences(config: PageShellConfig): void {
	const initialize = () => {
		const toolbar = document.querySelector<HTMLElement>("[data-a11y-toolbar]");
		if (!toolbar) return;
		const textButton = toolbar.querySelector<HTMLButtonElement>('[data-a11y-action="text"]');
		const focusButton = toolbar.querySelector<HTMLButtonElement>('[data-a11y-action="focus"]');
		const stored = readA11yPreferences();
		let textSize = stored.textSize ?? "default";
		let focusChoice = stored.focusChoice;

		const sync = () => {
			const focusMode = focusChoice ?? config.pageFocusDefault;
			applyA11yPreferences(textSize, focusMode);
			writeA11yPreferences({ textSize, focusChoice });
			for (const [button, active] of [
				[textButton, textSize === "large"],
				[focusButton, focusMode],
			] as const) {
				button?.setAttribute("aria-pressed", String(active));
				if (active) button?.setAttribute("data-active", "");
				else button?.removeAttribute("data-active");
			}
			document.dispatchEvent(
				new CustomEvent("praxity:focus-mode-change", { detail: { enabled: focusMode } }),
			);
		};

		textButton?.addEventListener("click", () => {
			textSize = textSize === "large" ? "default" : "large";
			sync();
		});
		focusButton?.addEventListener("click", () => {
			focusChoice = !(focusChoice ?? config.pageFocusDefault);
			sync();
		});
		toolbar.addEventListener("keydown", (event) => {
			const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button"));
			const current = buttons.indexOf(event.target as HTMLButtonElement);
			if (current < 0) return;
			const next =
				event.key === "ArrowRight" || event.key === "ArrowDown"
					? (current + 1) % buttons.length
					: event.key === "ArrowLeft" || event.key === "ArrowUp"
						? (current - 1 + buttons.length) % buttons.length
						: event.key === "Home"
							? 0
							: event.key === "End"
								? buttons.length - 1
								: -1;
			if (next < 0) return;
			event.preventDefault();
			buttons[next]?.focus();
		});
		sync();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initialize, { once: true });
	} else initialize();
}

function installPageDeeplink(config: PageShellConfig): boolean {
	const params = new URLSearchParams(location.search);
	const requested = Number.parseInt(params.get("page") ?? "", 10);
	if (
		!Number.isInteger(requested) ||
		requested === config.currentPage ||
		requested < 1 ||
		requested > config.slugs.length
	) {
		return false;
	}
	params.delete("page");
	const url = new URL(`${config.slugs[requested - 1]}.html`, location.href);
	url.search = params.toString();
	url.hash = location.hash;
	location.replace(url.href);
	return true;
}

function installBlockDeeplink(): void {
	const focusTarget = () => {
		if (!location.hash.startsWith("#block-")) return;
		const target = document.getElementById(location.hash.slice(1));
		if (!target) return;
		target.tabIndex = -1;
		target.focus({ preventScroll: true });
		scrollElementIntoView(target, { block: "center" });
	};
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", focusTarget, { once: true });
	} else {
		focusTarget();
	}
}

function installKeyboardNavigation(config: PageShellConfig): void {
	if (document.documentElement.hasAttribute("data-self-check-dependencies"))
		for (const link of document.querySelectorAll<HTMLElement>("a[data-page-number]"))
			link.addEventListener(
				"click",
				(event) => {
					if (Number(link.dataset.pageNumber) > config.currentPage && isSelfCheckForwardBlocked())
						event.preventDefault();
				},
				true,
			);
	if (!config.keyboardArrows) return;
	document.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		if (
			event.defaultPrevented ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey ||
			event.shiftKey
		) {
			return;
		}
		const active =
			event.target instanceof Element
				? event.target
				: document.activeElement instanceof Element
					? document.activeElement
					: null;
		const tag = active?.tagName.toLowerCase();
		if (active?.closest('nav,form,a,button,summary,audio,video,[role="button"]')) return;
		if (tag === "input" || tag === "textarea" || tag === "select") return;
		if (
			active?.closest(
				'[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="spinbutton"],[role="radiogroup"],[role="radio"],[role="listbox"],[role="combobox"],[role="menu"],[role="menubar"],[role="tablist"],[role="tree"],[role="treegrid"],[role="grid"],[role="scrollbar"],[role="toolbar"],[data-praxity-swipe-ignore]',
			)
		) {
			return;
		}
		if (active?.closest(".praxity-block[data-block-type]")) return;
		const rtl = document.documentElement.dir === "rtl";
		const previous = rtl ? event.key === "ArrowRight" : event.key === "ArrowLeft";
		const button = document.querySelector<HTMLButtonElement>(
			`[data-page-direction="${previous ? "previous" : "next"}"]:not([disabled])`,
		);
		const href = previous ? config.previousHref : config.nextHref;
		if (button) {
			event.preventDefault();
			button.click();
		} else if (href) {
			event.preventDefault();
			navigateFallbackPageHref(href, previous ? "backward" : "forward");
		}
	});
}

function installEntranceMotion(config: PageShellConfig): void {
	if (config.entrance === "none" && config.stagger === "none") return;
	const initialize = () => {
		try {
			if (window.__PRAXITY_INIT_ENTRANCE_MOTION__) {
				window.__PRAXITY_INIT_ENTRANCE_MOTION__(document.documentElement);
				return;
			}
		} catch {
			// Reveal content below when the optional motion runtime fails.
		}
		document.querySelectorAll<HTMLElement>("[data-entrance]").forEach((element) => {
			element.dataset.entrance = "visible";
		});
	};
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
	else initialize();
}

export function initializeCourseShell(): void {
	const config = readConfig();
	const smallPreview = isSmallPreviewDocument(location.search);
	if (config?.kind === "redirect") {
		redirect(config);
		return;
	}
	if (config?.kind !== "page") return;
	applyFirstPaintPreferences(config, smallPreview);
	if (smallPreview) document.documentElement.dataset.praxitySmallPreview = "true";
	installBodyState(config, smallPreview);
	installStrings();
	if (smallPreview) {
		installSmallPreviewPresentation();
		return;
	}
	// The host publishes one resolved arrival per document, including static Pages.
	const bindGlossaryLinks = () => {
		for (const link of document.querySelectorAll<HTMLAnchorElement>(
			'a[href="glossary.html"][target="_blank"]',
		)) {
			link.addEventListener("click", () => rememberGlossaryFocusReturn(link));
		}
	};
	if (document.readyState === "loading")
		document.addEventListener("DOMContentLoaded", bindGlossaryLinks, { once: true });
	else bindGlossaryLinks();
	let resumeScript: HTMLScriptElement | undefined;
	let departed = false;
	window.addEventListener("pagehide", () => {
		departed = true;
	});
	window.addEventListener("praxity:runtime-ready", (event) => {
		const page = (event as CustomEvent<CourseHostConfig>).detail;
		if (!window.__praxityResume || page.deck) return;
		const focus = () => {
			if (!departed)
				// biome-ignore lint/style/noNonNullAssertion: the warm-path guard or classic entry load guarantees registration; a broken entry must throw.
				window.__PRAXITY_FOCUS_SCORM_RESUME__!(document, {
					pageTitle: page.pageTitle,
					positionPrefix: page.strings.scormResumePositionPrefix,
					summary: page.strings.scormResumeAnnouncement,
				});
		};
		if (window.__PRAXITY_FOCUS_SCORM_RESUME__) focus();
		else if (!resumeScript && config.resumeFilename) {
			// Classic scripts keep static Pages resume usable in local file exports.
			resumeScript = document.createElement("script");
			resumeScript.src = config.resumeFilename;
			resumeScript.addEventListener("load", focus, { once: true });
			document.head.append(resumeScript);
		}
	});
	restoreFallbackWhenRuntimeFails(config);
	if (installPageDeeplink(config)) return;
	installBlockDeeplink();
	installReadingPreferences(config);
	installKeyboardNavigation(config);
	installEntranceMotion(config);
}

initializeCourseShell();
