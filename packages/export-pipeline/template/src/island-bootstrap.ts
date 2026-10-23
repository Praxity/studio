import { isSmallPreviewDocument } from "@praxity/shared-blocks/course-preview-protocol";
import { installEntranceMotionGlobal } from "@praxity/shared-blocks/motion";
import { islandNamesForPreview, loadBrowserModule } from "./island-loader";
import type {} from "./islands/island-highlight";
import type {} from "./islands/island-logic";
import type {} from "./self-check-runtime";

let owner = window.__praxitySelfCheckDocument;
const smallPreview = typeof location !== "undefined" && isSmallPreviewDocument(location.search);

if (!smallPreview) installEntranceMotionGlobal();

(() => {
	var islands = document.querySelectorAll<HTMLElement>("[data-island]");
	var needed = new Set<string>();
	var planned = document.documentElement.dataset.praxityIslands || "";
	planned.split(",").forEach((name) => {
		if (name) needed.add(name);
	});
	islands.forEach((el) => {
		var islandEl = el;
		var type = islandEl.dataset ? islandEl.dataset.island : null;
		if (type) needed.add(type);
	});
	needed = new Set(islandNamesForPreview(needed, smallPreview));
	if (!needed.size) return;

	document.documentElement.classList.add("praxity-js-loaded");

	var scripts = document.getElementsByTagName("script");
	var basePath = "";
	for (var i = 0; i < scripts.length; i++) {
		var src = scripts[i].getAttribute("src") || "";
		if (src.indexOf("island-loader") !== -1) {
			basePath = src.substring(0, src.lastIndexOf("/") + 1);
			break;
		}
	}

	function loadScript(src: string, name: string) {
		const moduleUrl = new URL(basePath + src, document.baseURI).href;
		return loadBrowserModule(
			moduleUrl,
			location.protocol === "file:" &&
				(name === "deck" ||
					name === "selfCheck" ||
					name === "logic" ||
					name === "rating" ||
					name === "writeDistractors" ||
					name === "highlight"),
		);
	}

	var loaded = new Map<string, Promise<unknown>>();
	const attached = new Map<string, (() => void) | undefined>();
	const restoresState = new Set([
		"rating",
		"signature",
		"checklist",
		"assessment",
		"assessmentGroup",
	]);
	function load(name: string, required: boolean, owned = owner?.loadTicket() ?? (() => true)) {
		if (!owned()) return Promise.resolve();
		var kebab = name.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`);
		var chunkSrc =
			document.documentElement.getAttribute(`data-island-${kebab}`) || `island-${kebab}.js`;
		let resource = loaded.get(name);
		if (!resource) {
			resource = loadScript(chunkSrc, name);
			loaded.set(name, resource);
		}
		return resource
			.then((module) => {
				if (!owned()) return;
				if (owner || name === "highlight") {
					if (name === "selfCheck") {
						window.__praxitySelfCheckCore.start(
							new URL(basePath + chunkSrc, document.baseURI).href,
						);
					} else if (!attached.has(name)) {
						const adapter = (module ??
							(name === "rating"
								? window.PraxityRatingIsland
								: name === "deck"
									? window.PraxityDeckIsland
									: name === "writeDistractors"
										? window.PraxityDistractorsIsland
										: name === "highlight"
											? window.PraxityHighlightIsland
											: window.PraxityLogicIsland)) as {
							attachIsland(): (() => void) | undefined;
						};
						const release =
							name === "highlight" ? adapter.attachIsland() : adapter?.attachIsland?.();
						if (!owned()) {
							release?.();
							return;
						}
						attached.set(name, release ?? undefined);
					}
				}
				requestAnimationFrame(() => {
					if (!owned()) return;
					document.querySelectorAll(`[data-island="${name}"]`).forEach((mount) => {
						mount.setAttribute("data-hydrated", "");
					});
				});
			})
			.catch((error) => {
				if (!owned()) return;
				// The baseline already owns one empty live region and localized failure copy.
				// A rejected chunk cannot import its enhancer to report the failure.
				if (name === "retrievalSheet" || name === "highlight") {
					const pattern = name === "retrievalSheet" ? "retrieval" : name;
					document
						.querySelectorAll<HTMLElement>(`[data-island="${name}"] [data-${pattern}-unavailable]`)
						.forEach((status) => {
							if (status.textContent || status.closest(`[data-${pattern}-enhanced]`)) return;
							status.classList.replace(
								"praxity-sr-only",
								name === "highlight"
									? "praxity-assessment-choice-hint"
									: "praxity-retrieval-sheet-secondary",
							);
							status.textContent = status.getAttribute(`data-${pattern}-unavailable`) ?? "";
						});
				}
				// Keep SSR fallback content when an island script fails.
				if (name === "deck" || name === "assessment" || name === "assessmentGroup")
					window.dispatchEvent(new CustomEvent("praxity:islands-failed"));
				if (name === "nav") {
					document.documentElement.classList.remove("praxity-js");
					document.body.classList.remove("praxity-nav-open", "praxity-sidebar-collapsed");
					document.querySelectorAll('[data-island="nav"]').forEach((mount) => {
						mount.removeAttribute("inert");
					});
				}
				if (required && name !== "highlight") throw error;
			});
	}

	const observers = new Set<IntersectionObserver>();
	let activation = owner?.lifetime();
	const revoke = () => {
		const next = window.__praxitySelfCheckDocument;
		const lifetime = next?.lifetime();
		if (next === owner && lifetime === activation) return;
		owner = next;
		activation = lifetime;
		for (const observer of observers) observer.disconnect();
		observers.clear();
		delete document.documentElement.dataset.praxityIslandsReady;
		if (lifetime?.reason === "provider" || lifetime?.reason === "reset")
			for (const name of restoresState) {
				attached.get(name)?.();
				attached.delete(name);
			}
	};
	document.addEventListener("praxity:self-check-owner", revoke);

	function loadNeeded(eager: boolean) {
		const owned = owner?.loadTicket() ?? (() => true);
		var loading: Promise<unknown>[] = [];
		needed.forEach((name) => {
			var eagerMedia =
				name === "media" &&
				document.querySelector(
					'[data-island="media"] [data-autoplay="true"], [data-island="media"] .praxity-embed-iframe',
				) !== null;
			if (
				eager ||
				smallPreview ||
				name === "deck" ||
				name === "nav" ||
				name === "logic" ||
				name === "selfCheck" ||
				name === "code" ||
				name === "table" ||
				name === "tooltip" ||
				eagerMedia ||
				typeof IntersectionObserver === "undefined"
			) {
				loading.push(
					load(name, eager && !(location.protocol === "file:" && name === "nav"), owned),
				);
				return;
			}
			var mounts = document.querySelectorAll(`[data-island="${name}"]`);
			if (!mounts.length) return;
			var observer = new IntersectionObserver(
				(entries) => {
					if (!owned()) return;
					if (!entries.some((entry) => entry.isIntersecting)) return;
					observer.disconnect();
					void load(name, false, owned);
				},
				{ rootMargin: "800px 0px" },
			);
			observers.add(observer);
			mounts.forEach((mount) => observer.observe(mount));
		});
		return Promise.all(loading);
	}

	let starting: ReturnType<NonNullable<typeof owner>["lifetime"]>;
	if (owner || document.documentElement.dataset.praxityLearnerState === "pending") {
		const ready = () => {
			revoke();
			const lifetime = owner?.lifetime();
			if (owner && (!lifetime?.current() || starting === lifetime)) return;
			starting = lifetime;
			const owned = owner?.loadTicket() ?? (() => true);
			loadNeeded(true).then(
				() => {
					if (!owned()) return;
					document.documentElement.dataset.praxityIslandsReady = "true";
					owner?.consumers.finalize();
					if (owned()) window.dispatchEvent(new CustomEvent("praxity:islands-ready"));
				},
				() => {
					if (!owned()) return;
					if (location.protocol === "file:" && needed.has("selfCheck") && !needed.has("logic")) {
						document.documentElement.dataset.praxityIslandsReady = "true";
						owner?.consumers.finalize();
					}
					if (owned()) window.dispatchEvent(new CustomEvent("praxity:islands-failed"));
				},
			);
		};
		window.addEventListener("praxity:runtime-ready", ready);
		// The host can finish before this deferred script arrives. Join its captured admission.
		if (owner?.isAdmitted()) ready();
	} else {
		const owned = () => true;
		const loading = loadNeeded(false);
		if (smallPreview) window.__praxitySmallPreviewDecorations = loading;
		else
			void loading.then(() => {
				if (owned()) window.__praxitySelfCheckDocument?.consumers.finalize();
			});
	}
})();
