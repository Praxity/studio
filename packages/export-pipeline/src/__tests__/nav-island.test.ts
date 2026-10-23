// @vitest-environment jsdom

import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
} from "@praxity/shared-blocks/self-check-consumers";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

const locationDescriptor = Object.getOwnPropertyDescriptor(window, "location");

describe("native navigation island", () => {
	it.each(["provider", "pagehide", "dispose"] as const)(
		"%s revokes an old floating-outline frame",
		async (boundary) => {
			const frames: FrameRequestCallback[] = [];
			vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
			const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
			let epoch = 0;
			Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => epoch } } });
			document.body.insertAdjacentHTML(
				"beforeend",
				'<nav data-native-floating-toc><div class="praxity-toc-tick-wrap"><a data-toc-target="one"></a></div><div class="praxity-toc-tick-wrap"><a data-toc-target="two"></a></div></nav><section id="one"></section><section id="two"></section>',
			);
			const { initializeFloatingToc } = await import("../../template/src/islands/floating-toc");
			const release = initializeFloatingToc();
			try {
				dispatchSelfCheckEvent(new Event("praxity:block-interaction"), selfCheckEpochTicket());
				if (boundary === "provider") {
					epoch++;
					document.dispatchEvent(new Event("praxity:self-check-owner"));
				} else if (boundary === "pagehide") window.dispatchEvent(new Event("pagehide"));
				else release();
				const target = document.getElementById("two");
				assert(target);
				target.hidden = true;
				frames.forEach((frame) => frame(0));
				expect(document.querySelectorAll<HTMLElement>(".praxity-toc-tick-wrap")[1]?.hidden).toBe(
					false,
				);
				expect(cancel).toHaveBeenCalledWith(1);
			} finally {
				release();
				Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
			}
		},
	);
	it.each(["provider", "return", "build"] as const)(
		"%s rejects retained floating-outline observer delivery",
		async (boundary) => {
			const callbacks: IntersectionObserverCallback[] = [];
			class Observer {
				constructor(callback: IntersectionObserverCallback) {
					callbacks.push(callback);
				}
				observe() {}
				disconnect() {}
			}
			vi.stubGlobal("IntersectionObserver", Observer);
			let epoch = 0;
			const owner = { consumers: { epoch: () => epoch } };
			Object.assign(window, { __praxitySelfCheckDocument: owner });
			document.body.insertAdjacentHTML(
				"beforeend",
				'<nav data-native-floating-toc><div class="praxity-toc-tick-wrap"><a data-toc-target="first"></a></div><div class="praxity-toc-tick-wrap"><a data-toc-target="second"></a></div></nav><section id="first"><h2>First</h2></section><section id="second"><h2>Second</h2></section>',
			);
			const release = (
				await import("../../template/src/islands/floating-toc")
			).initializeFloatingToc();
			try {
				const obsolete = callbacks[0];
				if (boundary === "build")
					Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => 0 } } });
				else epoch++;
				document.dispatchEvent(new Event("praxity:self-check-owner"));
				const record = {
					target: document.querySelector("#second h2"),
					isIntersecting: true,
					boundingClientRect: { top: 1 },
				} as IntersectionObserverEntry;
				obsolete?.([record], {} as IntersectionObserver);
				expect(
					[...document.querySelectorAll("[data-toc-target]")].map((link) =>
						link.getAttribute("aria-current"),
					),
				).toEqual(["true", null]);
				callbacks.at(-1)?.([record], {} as IntersectionObserver);
				expect(
					[...document.querySelectorAll("[data-toc-target]")].map((link) =>
						link.getAttribute("aria-current"),
					),
				).toEqual([null, "true"]);
			} finally {
				release();
				Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
				vi.unstubAllGlobals();
			}
		},
	);
	it.each(["provider", "pagehide"] as const)(
		"%s revokes an old arrival focus frame",
		async (boundary) => {
			const frames: FrameRequestCallback[] = [];
			vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
			const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
			let epoch = 0;
			Object.assign(window, { __praxitySelfCheckDocument: { consumers: { epoch: () => epoch } } });
			try {
				sessionStorage.setItem("praxity:focus-page-content", "true");
				(await import("../../template/src/islands/island-nav")).attachIsland();
				if (boundary === "provider") {
					epoch++;
					document.dispatchEvent(new Event("praxity:self-check-owner"));
				} else window.dispatchEvent(new Event("pagehide"));
				const successor = document.querySelector<HTMLButtonElement>("[data-sidebar-expand]");
				assert(successor);
				successor.focus();
				frames.forEach((frame) => frame(0));
				expect(document.activeElement).toBe(successor);
				expect(cancel).toHaveBeenCalledWith(1);
			} finally {
				Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
			}
		},
	);
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
		sessionStorage.clear();
		document.documentElement.removeAttribute("data-praxity-text-size");
		document.documentElement.removeAttribute("data-praxity-focus-mode");
		document.body.className = "praxity-layout-sidebar";
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query.includes("min-width"),
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
		Object.defineProperty(window, "requestAnimationFrame", {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
		});
		document.body.innerHTML = `
			<script id="praxity-config" type="application/json">{"courseTitle":"Course","currentPage":2,"totalPages":3,"currentSlug":"two","pageTitle":"Two","pageFocusDefault":false,"basePath":"/course","pages":[{"slug":"one"},{"slug":"two"},{"slug":"three"}],"pageIdMap":{"page-one":"one","page-two":"two","page-three":"three"}}</script>
			<div id="praxity-live-region"></div>
			<nav id="course-nav-sidebar" data-island="nav" data-native-outline>
				<button data-sidebar-collapse></button><button data-nav-menu-close></button><a data-page-id="page-two" data-page-slug="two" href="two.html" aria-current="page"><span class="praxity-nav-visited-label" hidden>Completed</span>Two</a>
			</nav>
			<button data-sidebar-expand></button><div class="praxity-top-bar-fallback"><button data-nav-menu-toggle></button></div><button data-nav-backdrop></button>
			<div class="praxity-page-nav-fallback" data-island="nav"><div data-a11y-toolbar role="toolbar"><button data-a11y-action="text"></button><button data-a11y-action="focus"></button></div></div>
			<main id="main-content"><h1>Two</h1></main>`;
	});

	afterEach(() => {
		if (locationDescriptor) Object.defineProperty(window, "location", locationDescriptor);
		delete window.__praxityTracker;
		delete window.__praxityRuntime;
	});

	it.each([
		["en", "180000", "Time spent: 2 minutes"],
		["fr", "290000", "Temps passé : moins d'une minute"],
	])(
		"labels elapsed course time in %s and retains the recorded score",
		async (locale, start, expected) => {
			vi.spyOn(document.documentElement, "lang", "get").mockReturnValue(locale);
			vi.spyOn(Date, "now").mockReturnValue(300_000);
			sessionStorage.setItem("praxity-course-session:course-1", start);
			document.body.insertAdjacentHTML(
				"beforeend",
				'<div id="praxity-course-meta" data-course-id="course-1"></div><section class="praxity-pages-completion"><p data-course-time></p><p data-course-score hidden></p></section>',
			);
			Object.assign(window, {
				__praxityRuntime: { getScore: () => ({ raw: 9, min: 0, max: 10 }) },
			});
			Object.assign(window, {
				__PRAXITY_STRINGS__: {
					courseTimeSpent: getStrings(locale).courseTimeSpent,
					courseTimeLessThanMinute: getStrings(locale).courseTimeLessThanMinute,
					courseRecordedScore: "Score: {score} / {max}",
				},
			});
			await import("../../template/src/islands/island-nav");
			document.dispatchEvent(new Event("DOMContentLoaded"));
			expect(document.querySelector("[data-course-time]")?.textContent).toBe(expected);
			expect(document.querySelector("[data-course-score]")?.textContent).toBe("Score: 9 / 10");
			expect(document.querySelector<HTMLElement>("[data-course-score]")?.hidden).toBe(false);
		},
	);

	it("preserves focus and sidebar behavior without replacing SSR DOM", async () => {
		sessionStorage.setItem("praxity:focus-page-content", "true");
		const sidebar = document.getElementById("course-nav-sidebar");
		const heading = document.querySelector<HTMLElement>("h1");
		await import("../../template/src/islands/island-nav");

		expect(document.getElementById("course-nav-sidebar")).toBe(sidebar);
		expect(document.activeElement).toBe(heading);
		expect(sessionStorage.getItem("praxity:focus-page-content")).toBeNull();
		document.querySelector<HTMLButtonElement>("[data-sidebar-collapse]")?.click();
		expect(document.body.classList.contains("praxity-sidebar-collapsed")).toBe(true);
		expect(sidebar?.hasAttribute("inert")).toBe(true);
		expect(document.activeElement).toBe(document.querySelector("[data-sidebar-expand]"));
		expect(sidebar?.hasAttribute("data-hydrated")).toBe(true);
	});

	it.each([null, "0"])(
		"restores Pages heading tabindex %s and class on blur and departure",
		async (tabindex) => {
			const heading = document.querySelector("h1");
			if (!heading) throw new Error("Missing heading");
			if (tabindex !== null) heading.setAttribute("tabindex", tabindex);
			heading.className = "authored-heading";
			sessionStorage.setItem("praxity:focus-page-content", "true");
			const { initNavigationIsland } = await import("../../template/src/islands/island-nav");
			expect(document.activeElement).toBe(heading);
			document.querySelector<HTMLButtonElement>("[data-sidebar-collapse]")?.focus();
			expect(heading.getAttribute("tabindex")).toBe(tabindex);
			expect(heading.className).toBe("authored-heading");
			sessionStorage.setItem("praxity:focus-page-content", "true");
			initNavigationIsland();
			expect(document.activeElement).toBe(heading);
			window.dispatchEvent(new Event("pagehide"));
			expect(heading.getAttribute("tabindex")).toBe(tabindex);
			expect(heading.className).toBe("authored-heading");
		},
	);

	it("focuses the content heading on ordinary arrival without a live message", async () => {
		sessionStorage.setItem("praxity:focus-page-content", "true");
		await import("../../template/src/islands/island-nav");

		expect(document.activeElement).toBe(document.querySelector("h1"));
		expect(document.getElementById("praxity-live-region")?.textContent).toBe("");
	});

	it.each(["glossary", "resources"])("keeps the %s title message on arrival", async (pageRole) => {
		const script = document.getElementById("praxity-config") as HTMLScriptElement;
		script.textContent = JSON.stringify({
			...JSON.parse(script.textContent ?? "{}"),
			currentPage: 4,
			pageTitle: "Glossary",
			pageRole,
		});
		await import("../../template/src/islands/island-nav");

		expect(document.getElementById("praxity-live-region")?.textContent).toBe("Glossary");
	});

	it("applies focus-mode geometry from the shared preference event", async () => {
		document
			.getElementById("main-content")
			?.insertAdjacentHTML(
				"beforeend",
				"<div data-focus-row>One</div><div data-focus-row>Two</div><div data-focus-row>Three</div>",
			);
		await import("../../template/src/islands/island-nav");

		document.dispatchEvent(
			new CustomEvent("praxity:focus-mode-change", { detail: { enabled: true } }),
		);

		expect(document.querySelectorAll("[data-focus-dimmed]")).toHaveLength(2);
	});

	it("moves focus into the mobile drawer and makes page content inert", async () => {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query.includes("prefers-reduced-motion"),
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
		await import("../../template/src/islands/island-nav");
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
		const main = document.getElementById("main-content");

		toggle?.click();
		expect(document.activeElement).toBe(document.querySelector('[aria-current="page"]'));
		expect(main?.hasAttribute("inert")).toBe(true);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.activeElement).toBe(toggle);
		expect(main?.hasAttribute("inert")).toBe(false);
	});

	it("wraps Tab focus inside the open mobile drawer", async () => {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query.includes("prefers-reduced-motion"),
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
		await import("../../template/src/islands/island-nav");
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
		const first = document.querySelector<HTMLButtonElement>("[data-nav-menu-close]");
		const last = document.querySelector<HTMLAnchorElement>('[aria-current="page"]');
		const main = document.getElementById("main-content");

		toggle?.click();
		expect(main?.hasAttribute("inert")).toBe(true);

		first?.focus();
		const shiftTab = new KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		first?.dispatchEvent(shiftTab);
		expect(shiftTab.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(last);
		expect(main?.hasAttribute("inert")).toBe(true);

		const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
		last?.dispatchEvent(tab);
		expect(tab.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(first);
		expect(main?.hasAttribute("inert")).toBe(true);

		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.activeElement).toBe(toggle);
		expect(main?.hasAttribute("inert")).toBe(false);
	});

	it("closes a mobile drawer before it becomes a persistent desktop sidebar", async () => {
		let desktop = false;
		let notifyDesktopChange: (() => void) | undefined;
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => {
				const desktopQuery = query.includes("min-width");
				return {
					get matches() {
						return desktopQuery ? desktop : false;
					},
					media: query,
					addEventListener: vi.fn((_type: string, listener: () => void) => {
						if (desktopQuery) notifyDesktopChange = listener;
					}),
					removeEventListener: vi.fn(),
				};
			}),
		});
		await import("../../template/src/islands/island-nav");
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
		const first = document.querySelector<HTMLButtonElement>("[data-nav-menu-close]");
		const main = document.getElementById("main-content");

		toggle?.click();
		expect(document.body.classList.contains("praxity-nav-open")).toBe(true);
		expect(main?.hasAttribute("inert")).toBe(true);

		desktop = true;
		notifyDesktopChange?.();
		expect(document.body.classList.contains("praxity-nav-open")).toBe(false);
		expect(main?.hasAttribute("inert")).toBe(false);

		first?.focus();
		const shiftTab = new KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		first?.dispatchEvent(shiftTab);
		expect(shiftTab.defaultPrevented).toBe(false);

		desktop = false;
		notifyDesktopChange?.();
		expect(document.body.classList.contains("praxity-nav-open")).toBe(false);
		expect(main?.hasAttribute("inert")).toBe(false);
		expect(document.getElementById("course-nav-sidebar")?.hasAttribute("inert")).toBe(true);
		expect(document.activeElement).toBe(toggle);
	});

	it("uses the outline as a modal drawer for desktop bottom-bar navigation", async () => {
		document.body.className = "praxity-layout-bottombar";
		await import("../../template/src/islands/island-nav");
		const sidebar = document.getElementById("course-nav-sidebar");
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
		const main = document.getElementById("main-content");
		const pageNav = document.querySelector<HTMLElement>(".praxity-page-nav-fallback");

		expect(sidebar?.hasAttribute("inert")).toBe(true);
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		toggle?.click();
		expect(document.body.classList.contains("praxity-nav-open")).toBe(true);
		expect(document.body.classList.contains("praxity-sidebar-collapsed")).toBe(false);
		expect(sidebar?.hasAttribute("inert")).toBe(false);
		expect(main?.hasAttribute("inert")).toBe(true);
		expect(pageNav?.hasAttribute("inert")).toBe(true);
		expect(document.activeElement).toBe(document.querySelector('[aria-current="page"]'));
		document.querySelector<HTMLAnchorElement>('[aria-current="page"]')?.click();
		expect(document.body.classList.contains("praxity-nav-open")).toBe(false);
		expect(document.activeElement).toBe(toggle);

		toggle?.click();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.body.classList.contains("praxity-nav-open")).toBe(false);
		expect(sidebar?.hasAttribute("inert")).toBe(true);
		expect(main?.hasAttribute("inert")).toBe(false);
		expect(pageNav?.hasAttribute("inert")).toBe(false);
		expect(document.activeElement).toBe(toggle);
	});

	it("honors a hamburger-only drawer on a desktop sidebar layout", async () => {
		const sidebar = document.getElementById("course-nav-sidebar");
		sidebar?.setAttribute("data-nav-drawer", "");
		await import("../../template/src/islands/island-nav");
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
		const main = document.getElementById("main-content");

		expect(sidebar?.hasAttribute("inert")).toBe(true);
		expect(document.body.classList.contains("praxity-sidebar-collapsed")).toBe(false);
		toggle?.click();
		expect(document.body.classList.contains("praxity-nav-open")).toBe(true);
		expect(sidebar?.hasAttribute("inert")).toBe(false);
		expect(main?.hasAttribute("inert")).toBe(true);

		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(document.body.classList.contains("praxity-nav-open")).toBe(false);
		expect(sidebar?.hasAttribute("inert")).toBe(true);
		expect(main?.hasAttribute("inert")).toBe(false);
		expect(document.activeElement).toBe(toggle);
	});

	it("keeps single-page bottom-bar reading tools operable outside the closed drawer", async () => {
		document.body.className = "praxity-layout-bottombar";
		const config = document.getElementById("praxity-config");
		if (config) {
			config.textContent =
				'{"courseTitle":"Course","currentPage":1,"totalPages":1,"currentSlug":"one","pageTitle":"One","navHamburgerMenu":true,"navOutline":false}';
		}
		const readingDock = document.querySelector<HTMLElement>(".praxity-page-nav-fallback");
		readingDock?.classList.replace("praxity-page-nav-fallback", "praxity-a11y-dock");
		await import("../../template/src/islands/island-nav");
		const textButton = readingDock?.querySelector<HTMLButtonElement>('[data-a11y-action="text"]');
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");

		expect(document.querySelector(".praxity-page-nav-fallback")).toBeNull();
		expect(readingDock?.hasAttribute("inert")).toBe(false);
		expect(textButton).not.toBeNull();

		toggle?.click();
		expect(readingDock?.hasAttribute("inert")).toBe(true);
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(readingDock?.hasAttribute("inert")).toBe(false);
		expect(document.activeElement).toBe(toggle);
	});

	it("includes sidebar reading tools in the drawer keyboard loop", async () => {
		document.body.className = "praxity-layout-bottombar";
		const sidebar = document.getElementById("course-nav-sidebar");
		const toolbar = document.querySelector<HTMLElement>("[data-a11y-toolbar]");
		if (toolbar) sidebar?.append(toolbar);
		await import("../../template/src/islands/island-nav");
		const toggle = document.querySelector<HTMLButtonElement>("[data-nav-menu-toggle]");
		const close = document.querySelector<HTMLButtonElement>("[data-nav-menu-close]");
		const textButton = toolbar?.querySelector<HTMLButtonElement>('[data-a11y-action="text"]');
		const focusButton = toolbar?.querySelector<HTMLButtonElement>('[data-a11y-action="focus"]');

		toggle?.click();
		expect(textButton).not.toBeNull();
		focusButton?.focus();
		const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
		focusButton?.dispatchEvent(tab);
		expect(tab.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(close);
	});

	it("routes an explicit go-to-page button through shared tracking and focus handoff", async () => {
		const href = vi.fn<(value: string) => void>();
		Object.defineProperty(window, "location", {
			configurable: true,
			value: {
				set href(value: string) {
					href(value);
				},
			},
		});
		const trackNavigation = vi.fn();
		window.__praxityTracker = {};
		window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };
		const button = document.createElement("button");
		button.dataset.action = "goToPage";
		button.dataset.targetPage = "page-three";
		button.dataset.blockId = "continue";
		document.body.append(button);
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction, { once: true });

		await import("../../template/src/islands/island-nav");
		button.click();

		expect(href).toHaveBeenCalledWith("/course/three.html");
		expect(trackNavigation).toHaveBeenCalledWith("page-two", "page-three", "button");
		expect(sessionStorage.getItem("praxity:focus-page-content")).toBe("true");
		expect(interaction).toHaveBeenCalledOnce();
		expect((interaction.mock.calls[0][0] as CustomEvent).detail).toEqual({
			blockId: "continue",
			blockType: "button",
		});
	});

	it("marks visited links by stable page ID", async () => {
		window.__praxityRuntime = { getVisitedPages: () => ["page-two"] };

		await import("../../template/src/islands/island-nav");

		const link = document.querySelector<HTMLElement>('[data-page-id="page-two"]');
		expect(link?.dataset.visited).toBe("true");
		expect(link?.querySelector(".praxity-nav-visited-label")?.hasAttribute("hidden")).toBe(false);
	});

	it("accepts legacy slug-based visited state", async () => {
		const link = document.querySelector<HTMLElement>('[data-page-id="page-two"]');
		link?.removeAttribute("data-page-id");
		window.__praxityRuntime = { getVisitedPages: () => ["two"] };

		await import("../../template/src/islands/island-nav");

		expect(link?.dataset.visited).toBe("true");
	});

	it("routes horizontal slide swipes through the same native page control", async () => {
		const config = document.getElementById("praxity-config");
		if (config?.textContent) {
			config.textContent = config.textContent.replace(
				'"currentSlug":"two"',
				'"currentSlug":"two","navSwipeGestures":true',
			);
		}
		const next = document.createElement("button");
		next.dataset.pageDirection = "next";
		const click = vi.fn();
		next.addEventListener("click", click);
		document.body.append(next);
		await import("../../template/src/islands/island-nav");

		const start = new Event("touchstart", { bubbles: true });
		Object.defineProperty(start, "touches", { value: [{ clientX: 180, clientY: 80 }] });
		document.getElementById("main-content")?.dispatchEvent(start);
		const end = new Event("touchend", { bubbles: true });
		Object.defineProperty(end, "changedTouches", { value: [{ clientX: 80, clientY: 84 }] });
		document.getElementById("main-content")?.dispatchEvent(end);

		expect(click).toHaveBeenCalledOnce();
	});

	it("updates native scroll progress from document scroll position", async () => {
		Object.defineProperty(window, "requestAnimationFrame", {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				callback(0);
				return 0;
			},
		});
		Object.defineProperties(document.documentElement, {
			scrollHeight: { configurable: true, value: 1200 },
		});
		Object.defineProperties(window, {
			innerHeight: { configurable: true, value: 200 },
			scrollY: { configurable: true, value: 500 },
		});
		document.body.insertAdjacentHTML(
			"beforeend",
			'<div data-native-scroll-progress role="progressbar" aria-valuenow="0"><div data-native-scroll-progress-fill></div></div>',
		);

		await import("../../template/src/islands/island-nav");

		const progress = document.querySelector<HTMLElement>("[data-native-scroll-progress]");
		const fill = document.querySelector<HTMLElement>("[data-native-scroll-progress-fill]");
		expect(fill?.style.transform).toBe("scaleX(0.5)");
		expect(fill?.style.width).toBe("");
		expect(progress?.getAttribute("aria-valuenow")).toBe("50");

		Object.defineProperty(window, "scrollY", { configurable: true, value: 1000 });
		window.dispatchEvent(new Event("scroll"));
		expect(fill?.style.transform).toBe("scaleX(1)");
		expect(progress?.getAttribute("aria-valuenow")).toBe("100");

		Object.defineProperty(window, "scrollY", { configurable: true, value: -20 });
		window.dispatchEvent(new Event("scroll"));
		expect(fill?.style.transform).toBe("scaleX(0)");
		expect(progress?.getAttribute("aria-valuenow")).toBe("0");

		Object.defineProperty(document.documentElement, "scrollHeight", {
			configurable: true,
			value: 100,
		});
		window.dispatchEvent(new Event("resize"));
		expect(fill?.style.transform).toBe("scaleX(1)");
		expect(progress?.getAttribute("aria-valuenow")).toBe("100");
	});

	it("keeps the floating TOC active, focusable, and visible as targets change", async () => {
		const callbacks: IntersectionObserverCallback[] = [];
		class MockIntersectionObserver {
			constructor(callback: IntersectionObserverCallback) {
				callbacks.push(callback);
			}
			observe(): void {}
			disconnect(): void {}
		}
		vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
		document.body.insertAdjacentHTML(
			"beforeend",
			`<nav data-native-floating-toc>
				<div class="praxity-toc-tick-wrap"><a href="#section-one" data-toc-target="section-one"><span data-toc-preview hidden>One</span></a></div>
				<div class="praxity-toc-tick-wrap"><a href="#section-two" data-toc-target="section-two"><span data-toc-preview hidden>Two</span></a></div>
			</nav>
			<section id="section-one"><h2>One</h2></section>
			<section id="section-two"><h2>Two</h2></section>`,
		);
		const secondHeading = document.querySelector<HTMLElement>("#section-two h2");
		const scrollIntoView = vi.fn();
		if (secondHeading) secondHeading.scrollIntoView = scrollIntoView;

		await import("../../template/src/islands/island-nav");

		const links = document.querySelectorAll<HTMLAnchorElement>("[data-toc-target]");
		const firstPreview = links[0]?.parentElement?.querySelector<HTMLElement>("[data-toc-preview]");
		links[0]?.focus();
		expect(firstPreview?.hidden).toBe(false);
		links[0]?.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
		expect(firstPreview?.hidden).toBe(true);

		callbacks[0]?.(
			[
				{
					target: secondHeading as Element,
					isIntersecting: true,
					boundingClientRect: { top: 20 } as DOMRect,
				} as IntersectionObserverEntry,
			],
			{} as IntersectionObserver,
		);
		expect(links[1]?.classList.contains("active")).toBe(true);
		expect(links[1]?.getAttribute("aria-current")).toBe("true");

		links[1]?.click();
		expect(document.activeElement).toBe(secondHeading);
		expect(scrollIntoView).toHaveBeenCalledOnce();

		const secondTarget = document.getElementById("section-two");
		const secondRow = links[1]?.closest<HTMLElement>(".praxity-toc-tick-wrap");
		if (secondTarget) secondTarget.hidden = true;
		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));
		expect(secondRow?.hidden).toBe(true);
		expect(document.querySelector<HTMLElement>("[data-native-floating-toc]")?.hidden).toBe(true);
	});

	it("updates the native narrative bar from the visible section", async () => {
		const callbacks: IntersectionObserverCallback[] = [];
		class MockIntersectionObserver {
			constructor(callback: IntersectionObserverCallback) {
				callbacks.push(callback);
			}
			observe(): void {}
			disconnect(): void {}
		}
		vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
		document.body.insertAdjacentHTML(
			"beforeend",
			`<div data-native-narrative-bar data-section-count="3"><p data-native-narrative-text data-read-time="4"></p></div>
			<section class="praxity-section" data-section-index="0"></section>
			<section class="praxity-section" data-section-index="1"></section>
			<section class="praxity-section" data-section-index="2"></section>`,
		);

		await import("../../template/src/islands/island-nav");

		const sections = document.querySelectorAll<HTMLElement>(".praxity-section");
		callbacks[0]?.(
			[
				{
					target: sections[1] as Element,
					isIntersecting: true,
					intersectionRatio: 0.8,
				} as IntersectionObserverEntry,
			],
			{} as IntersectionObserver,
		);
		expect(document.querySelector("[data-native-narrative-text]")?.textContent).toBe(
			"Section 2 of 3 · ~4 min",
		);
	});

	it("dispatches the button interaction but leaves unresolved page targets alone", async () => {
		const href = vi.fn<(value: string) => void>();
		Object.defineProperty(window, "location", {
			configurable: true,
			value: {
				set href(value: string) {
					href(value);
				},
			},
		});
		const trackNavigation = vi.fn();
		window.__praxityTracker = {};
		window.__praxityRuntime = { ...window.__praxityRuntime, trackNavigation };
		const button = document.createElement("button");
		button.dataset.action = "goToPage";
		button.dataset.targetPage = "missing";
		button.dataset.blockId = "broken-link";
		document.body.append(button);
		const interaction = vi.fn();
		document.addEventListener("praxity:block-interaction", interaction, { once: true });

		await import("../../template/src/islands/island-nav");
		button.click();

		expect(href).not.toHaveBeenCalled();
		expect(trackNavigation).not.toHaveBeenCalled();
		expect(sessionStorage.getItem("praxity:focus-page-content")).toBeNull();
		expect(interaction).toHaveBeenCalledOnce();
		expect((interaction.mock.calls[0][0] as CustomEvent).detail).toEqual({
			blockId: "broken-link",
			blockType: "button",
		});
	});

	it("centers the current link inside the sidebar without scrolling the document", async () => {
		const sidebar = document.getElementById("course-nav-sidebar");
		const currentLink = sidebar?.querySelector<HTMLElement>('[data-page-slug="two"]');
		expect(sidebar).not.toBeNull();
		expect(currentLink).not.toBeNull();
		Object.defineProperties(sidebar, {
			clientHeight: { configurable: true, value: 400 },
			scrollHeight: { configurable: true, value: 1000 },
			scrollTop: { configurable: true, value: 100, writable: true },
		});
		Object.defineProperty(currentLink, "offsetHeight", { configurable: true, value: 40 });
		vi.spyOn(sidebar as HTMLElement, "getBoundingClientRect").mockReturnValue({
			top: 20,
		} as DOMRect);
		vi.spyOn(currentLink as HTMLElement, "getBoundingClientRect").mockReturnValue({
			top: 520,
		} as DOMRect);
		const documentScroll = vi.fn();
		const linkScroll = vi.fn();
		Object.defineProperty(document.documentElement, "scrollTo", {
			configurable: true,
			value: documentScroll,
		});
		Object.defineProperty(currentLink, "scrollIntoView", {
			configurable: true,
			value: linkScroll,
		});

		await import("../../template/src/islands/island-nav");

		expect(sidebar?.scrollTop).toBe(420);
		expect(linkScroll).not.toHaveBeenCalled();
		expect(documentScroll).not.toHaveBeenCalled();
	});
});
