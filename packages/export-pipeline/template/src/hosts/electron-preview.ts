import {
	coursePreviewKeyEvent,
	frameEdgeFocus,
	renderLogicAnnotations,
} from "@praxity/shared-blocks/course-preview-frame";
import {
	COURSE_PREVIEW_PROTOCOL_VERSION,
	type CoursePreviewEvent,
	type CoursePreviewIdentity,
	isCoursePreviewCommand,
	isSafeExternalUrl,
	isSmallPreviewDocument,
	readCoursePreviewChannel,
	readCoursePreviewParentOrigin,
} from "@praxity/shared-blocks/course-preview-protocol";
import { parseLearnerState } from "@praxity/shared-blocks/learner-state";
import { resolveScormResumeTarget } from "../../../src/scorm/api-discovery";
import { LocalStorageRuntime } from "../../../src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../../../src/scorm/types";
import {
	composeScormResumeUrl,
	initializeCourseHost,
	readBasicCourseDeploymentConfig,
	readCourseHostConfig,
	resolveBookmarkSlug,
} from "./course-host";

const MUTATING_METHODS = new Set<PropertyKey>([
	"trackPageVisit",
	"trackInteraction",
	"setCompletion",
	"setScore",
	"setBookmark",
	"setSuspendData",
	"trackNavigation",
	"trackObjective",
	"setBlockState",
	"resetState",
]);

function readOnlyRuntime(runtime: SCORMRuntime): SCORMRuntime {
	return new Proxy(runtime, {
		get(target, property) {
			if (MUTATING_METHODS.has(property)) return () => undefined;
			if (property === "commit") return () => true;
			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

class PreviewStateStorage implements Storage {
	private readonly values = new Map<string, string>();

	constructor(
		private readonly stateKey: string,
		state: string,
		private writable: boolean,
		private readonly persist: (state: string) => void,
	) {
		this.values.set(stateKey, state);
	}

	get length(): number {
		return this.values.size;
	}

	clear(): void {
		if (!this.writable) return;
		this.values.clear();
	}

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		if (!this.writable) return;
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		if (!this.writable) throw new Error("EPREVIEWREADONLY");
		this.values.set(key, value);
		if (key === this.stateKey) this.persist(value);
	}

	freeze(): string {
		this.writable = false;
		return this.values.get(this.stateKey) ?? "";
	}

	resume(state: string): void {
		this.values.set(this.stateKey, state);
		this.writable = true;
	}

	state(): string {
		return this.values.get(this.stateKey) ?? "";
	}
}

export function initializeElectronPreviewHost(): boolean {
	if (typeof window === "undefined" || typeof document === "undefined") return false;
	const page = readCourseHostConfig(document);
	const deployment = readBasicCourseDeploymentConfig(document);
	if (!page || deployment?.format !== "electron-preview" || !deployment.revision) return false;

	const params = new URLSearchParams(window.location.search);
	if (isSmallPreviewDocument(window.location.search)) return false;
	const mode = params.get("praxity-inspect") === "1" ? "inspection" : "learner";
	const channel = readCoursePreviewChannel(window.location.search);
	const parentOrigin = readCoursePreviewParentOrigin(window.location.search);
	const inPageUtilities = params.get("praxity-in-page-utilities") === "1";
	let utilityTrigger: HTMLAnchorElement | null = null;
	if (inPageUtilities)
		for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[data-nav-utility]")) {
			anchor.target = "_self";
			anchor.setAttribute("aria-label", anchor.textContent?.trim() ?? "");
			anchor.querySelector("svg")?.remove();
		}
	if (!channel || !parentOrigin || window.parent === window) return false;
	document.documentElement.dataset.praxityLearnerState = "pending";
	window.addEventListener(
		"praxity:runtime-ready",
		() => delete document.documentElement.dataset.praxityLearnerState,
		{ once: true },
	);

	window.__praxityDecoratePageHref = (href) => {
		const url = new URL(href, window.location.href);
		if (url.protocol !== window.location.protocol || url.host !== window.location.host) return href;
		url.searchParams.set("praxity-channel", channel);
		url.searchParams.set("praxity-parent-origin", parentOrigin);
		if (inPageUtilities) url.searchParams.set("praxity-in-page-utilities", "1");
		if (mode === "inspection") url.searchParams.set("praxity-inspect", "1");
		return url.href;
	};

	const identity: CoursePreviewIdentity = {
		channel,
		courseId: page.courseId,
		revision: deployment.revision,
		pageId: page.pageId,
	};
	let activePageId = page.pageId;
	let port: MessagePort | null = null;
	let stateStorage: PreviewStateStorage | null = null;
	let mutableRuntime: LocalStorageRuntime | null = null;
	let started = false;
	let showLogic = false;
	let navigationPending = false;
	let runtimeReady = false;
	let islandsReady = false;
	let runtimeFailed = false;
	const send = (event: CoursePreviewEvent) => port?.postMessage(event);
	window.addEventListener("praxity:active-page-change", (event) => {
		const pageId = (event as CustomEvent<{ pageId?: unknown }>).detail?.pageId;
		if (
			typeof pageId !== "string" ||
			![...document.querySelectorAll<HTMLElement>("[data-deck-slide]")].some(
				(slide) => slide.dataset.deckSlide === pageId,
			)
		)
			return;
		activePageId = pageId;
		if (started)
			send({
				source: "praxity-course",
				version: COURSE_PREVIEW_PROTOCOL_VERSION,
				event: "active-page",
				activePageId,
				...identity,
			});
	});
	const sendFatal = (code: "invalid-state" | "runtime-start") => {
		document.documentElement.dataset.praxityFallback = "";
		send({
			source: "praxity-course",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			event: "fatal",
			code,
			...identity,
		});
	};
	const stateKey = `praxity:${encodeURIComponent(page.courseId)}:studio-preview:state`;
	const requestNavigation = (rawUrl: string): boolean => {
		if (!stateStorage) return false;
		const target = new URL(rawUrl, window.location.href);
		if (
			target.protocol !== window.location.protocol ||
			target.host !== window.location.host ||
			!target.pathname.endsWith(".html")
		) {
			return false;
		}
		if (navigationPending) return true;
		navigationPending = true;
		if (mode === "learner") mutableRuntime?.commit();
		send({
			source: "praxity-course",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			event: "navigate",
			state: stateStorage.freeze(),
			url: target.href,
			...identity,
		});
		return true;
	};
	window.__praxityNavigatePageHref = requestNavigation;

	const startCourse = (state: string, writable: boolean) => {
		if (started) return;
		if (!parseLearnerState(state, { courseId: page.courseId, attemptId: "studio-preview" })) {
			sendFatal("invalid-state");
			return;
		}
		stateStorage = new PreviewStateStorage(stateKey, state, writable, (nextState) =>
			send({
				source: "praxity-course",
				version: COURSE_PREVIEW_PROTOCOL_VERSION,
				event: "persist",
				state: nextState,
				...identity,
			}),
		);
		mutableRuntime = new LocalStorageRuntime(
			stateStorage,
			page.courseId,
			"studio-preview",
			deployment.revision,
		);
		const runtime = mode === "inspection" ? readOnlyRuntime(mutableRuntime) : mutableRuntime;
		islandsReady =
			!document.documentElement.dataset.praxityIslands ||
			![...document.scripts].some((script) => script.src.includes("island-loader")) ||
			document.documentElement.dataset.praxityIslandsReady === "true";
		const announceReady = () => {
			if (started || runtimeFailed || navigationPending || !runtimeReady || !islandsReady) return;
			started = true;
			if (showLogic) renderLogicAnnotations(true);
			send({
				source: "praxity-course",
				version: COURSE_PREVIEW_PROTOCOL_VERSION,
				event: "ready",
				activePageId,
				mode,
				...identity,
			});
		};
		window.addEventListener(
			"praxity:islands-ready",
			() => {
				islandsReady = true;
				announceReady();
			},
			{ once: true },
		);
		window.addEventListener(
			"praxity:islands-failed",
			() => {
				runtimeFailed = true;
				sendFatal("runtime-start");
			},
			{ once: true },
		);
		window.addEventListener(
			"praxity:runtime-ready",
			() => {
				runtimeReady = true;
				void Promise.resolve().then(announceReady);
			},
			{ once: true },
		);
		if (
			!initializeCourseHost(
				{
					format: "electron-preview",
					deviceStateRuntime: runtime,
					createRuntime: () => runtime,
					prepareResume: (environment) => (restoredRuntime, restoredPage) => {
						if (mode !== "learner" || params.get("praxity-entry") !== "1") return null;
						if (["0", "1"].includes(params.get("praxity-resume") ?? "")) {
							const restoredUrl = new URL(environment.location.href);
							restoredUrl.searchParams.delete("praxity-resume");
							try {
								environment.history.replaceState(environment.history.state, "", restoredUrl.href);
							} catch {
								// A blocked history update must not prevent restored preview readiness.
							}
							return null;
						}
						const target = resolveScormResumeTarget(
							resolveBookmarkSlug(restoredRuntime.getBookmark(), restoredPage.pageIdMap),
							restoredPage.currentSlug,
							restoredPage.availableSlugs,
						);
						if (!target) return null;
						environment.location.replace(composeScormResumeUrl(environment.location.href, target));
						return "redirect";
					},
				},
				{
					win: window,
					doc: document,
					location: {
						href: window.location.href,
						search: window.location.search,
						replace: (url) => {
							if (!requestNavigation(String(url))) window.location.replace(url);
						},
					},
					history: window.history,
				},
			)
		) {
			sendFatal("runtime-start");
		}
	};

	const focusEdge = frameEdgeFocus(window);
	const handlePortMessage = (event: MessageEvent<unknown>) => {
		if (!isCoursePreviewCommand(event.data, identity)) return;
		const command = event.data;
		if (command.action === "restore") {
			startCourse(command.state, command.writable);
			return;
		}
		if (command.action === "logic") {
			showLogic = command.enabled;
			renderLogicAnnotations(showLogic);
			return;
		}
		if (command.action === "focus") {
			focusEdge(command.edge);
			return;
		}
		if (command.action === "utility-closed") {
			utilityTrigger?.focus();
			utilityTrigger = null;
			return;
		}
		if (!stateStorage || mode !== "learner") return;
		if (command.action === "freeze") {
			mutableRuntime?.commit();
			send({
				source: "praxity-course",
				version: COURSE_PREVIEW_PROTOCOL_VERSION,
				event: "frozen",
				state: stateStorage.freeze(),
				...identity,
			});
			return;
		}
		if (command.action === "resume") {
			if (
				!parseLearnerState(command.state, { courseId: page.courseId, attemptId: "studio-preview" })
			) {
				sendFatal("invalid-state");
				return;
			}
			navigationPending = false;
			stateStorage.resume(command.state);
		}
	};

	const handleConnect = (event: MessageEvent<unknown>) => {
		const requestedPageId = (event.data as Partial<CoursePreviewIdentity> | null)?.pageId;
		const documentPage =
			requestedPageId === page.pageId ||
			[...document.querySelectorAll<HTMLElement>("[data-deck-slide]")].some(
				(slide) => slide.dataset.deckSlide === requestedPageId,
			);
		const expected = {
			...identity,
			pageId: typeof requestedPageId === "string" ? requestedPageId : identity.pageId,
		};
		if (
			event.source !== window.parent ||
			event.origin !== parentOrigin ||
			event.ports.length !== 1 ||
			!documentPage ||
			!isCoursePreviewCommand(event.data, expected) ||
			event.data.action !== "connect"
		) {
			return;
		}
		identity.pageId = expected.pageId;
		window.removeEventListener("message", handleConnect);
		port = event.ports[0];
		port.onmessage = handlePortMessage;
		port.start();
		send({
			source: "praxity-course",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			event: "connected",
			...identity,
		});
	};
	window.addEventListener("message", handleConnect);

	window.addEventListener("keydown", (event) => {
		const body = coursePreviewKeyEvent(event, document);
		if (body)
			send({
				source: "praxity-course",
				version: COURSE_PREVIEW_PROTOCOL_VERSION,
				...body,
				...identity,
			});
	});

	document.addEventListener("click", (event) => {
		const anchor = (event.target as Element | null)?.closest?.(
			"a[href]",
		) as HTMLAnchorElement | null;
		if (!anchor) return;
		let url: URL;
		try {
			url = new URL(anchor.href, window.location.href);
		} catch {
			return;
		}
		if (url.protocol === window.location.protocol && url.host === window.location.host) {
			const href = window.__praxityDecoratePageHref?.(url.href) ?? url.href;
			anchor.href = href;
			if (event.defaultPrevented) return;
			if (inPageUtilities && /\/(?:glossary|resources)\.html$/.test(url.pathname)) {
				event.preventDefault();
				utilityTrigger = anchor;
				send({
					source: "praxity-course",
					version: COURSE_PREVIEW_PROTOCOL_VERSION,
					event: "open-utility",
					url: href,
					...identity,
				});
				return;
			}
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}
			const target = new URL(href);
			const current = new URL(window.location.href);
			if (target.pathname === current.pathname && target.search === current.search) return;
			if (
				!anchor.download &&
				(!anchor.target || anchor.target === "_self") &&
				requestNavigation(href)
			) {
				event.preventDefault();
			}
			return;
		}
		if (event.defaultPrevented || !isSafeExternalUrl(url.href)) return;
		event.preventDefault();
		send({
			source: "praxity-course",
			version: COURSE_PREVIEW_PROTOCOL_VERSION,
			event: "open-external",
			url: url.href,
			...identity,
		});
	});
	window.addEventListener(
		"pagehide",
		() => {
			if (stateStorage && mode === "learner") {
				send({
					source: "praxity-course",
					version: COURSE_PREVIEW_PROTOCOL_VERSION,
					event: "persist",
					state: stateStorage.state(),
					...identity,
				});
			}
			port?.close();
		},
		{ once: true },
	);
	return true;
}

initializeElectronPreviewHost();
