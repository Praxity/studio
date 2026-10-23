import type { AdmittedChoiceStateFacts } from "@praxity/shared-blocks/choice-state-facts";
import { isSmallPreviewDocument } from "@praxity/shared-blocks/course-preview-protocol";
import type { LearnerBlockResponseTruncated } from "@praxity/shared-blocks/learner-block-response";
import {
	type LearnerBlockStateRuntime,
	withLearnerStateAuthority,
} from "@praxity/shared-blocks/learner-block-state";
import { selfCheckEpochTicket } from "@praxity/shared-blocks/self-check-consumers";
import { isAbsoluteIri } from "../../../src/scorm/activity-id";
import { getSessionState, readSessionState } from "../../../src/scorm/api/session";
import type { XapiConfig } from "../../../src/scorm/api/xapi";
import { findScormApi } from "../../../src/scorm/api-discovery";
import type {} from "../../../src/scorm/privacy-capability";
import { CourseTracker } from "../../../src/scorm/tracking";
import {
	assessmentReportingOptions,
	isNonemptyString,
	isString,
	type SCORMRuntime,
} from "../../../src/scorm/types";
import { createBlockStateRuntime } from "./block-state-runtime";
import { readCourseHostConfig } from "./course-config";

export { readCourseHostConfig } from "./course-config";

import { isRecord, readJsonElement } from "./host-json";
import { createPrivateBlockStateRuntime } from "./private-block-state";

export type CourseHostFormat = "electron-preview" | "standalone" | "scorm12" | "scorm2004" | "xapi";

export interface CourseHostConfig extends Partial<AdmittedChoiceStateFacts> {
	version: 1;
	deck?: boolean;
	deferVisits?: boolean;
	courseId: string;
	pageId: string;
	pageTitle: string;
	currentPage: number;
	totalPages: number;
	currentSlug: string;
	availableSlugs: string[];
	pageIdMap: Record<string, string>;
	completionMethod: "allPages" | "percentage" | "quiz";
	completionThreshold?: number;
	requiredAssessmentIds?: string[];
	/** Course pass mark (0-100) and the questions whose score it applies to. */
	passMark?: number;
	scoredAssessmentIds?: string[];
	pageRole: "content" | "glossary" | "resources";
	strings: Record<string, string>;
	/** Compiled for the whole course, including blocks on other documents. */
	blockStatePolicy?: Record<string, "device" | "lms">;
}

export interface CourseDeploymentConfig {
	format: CourseHostFormat;
	revision?: string;
	xapiConfig?: XapiConfig;
	courseActivityId?: string;
}

export interface CourseHostAdapter {
	format: CourseHostFormat;
	/** Preview already owns local persistence, reset, freeze and inspection. */
	deviceStateRuntime?: SCORMRuntime;
	/** Formats with additional configuration validate it before constructing their runtime. */
	readDeploymentConfig?: (doc: Document) => CourseDeploymentConfig | null;
	createRuntime: (
		page: CourseHostConfig,
		deployment: CourseDeploymentConfig,
		win: Window,
	) => SCORMRuntime;
	isFallback?: (runtime: SCORMRuntime) => boolean;
	canStartGlossary?: (environment: CourseHostEnvironment) => boolean;
	installLifecycle?: (
		runtime: SCORMRuntime,
		page: CourseHostConfig,
		environment: CourseHostEnvironment,
	) => boolean;
	prepareResume?: (
		environment: CourseHostEnvironment,
	) => (runtime: SCORMRuntime, page: CourseHostConfig) => "redirect" | null;
}

export interface ScormCourseHostAdapter extends CourseHostAdapter {
	readEntry: (win: Window) => string | null;
}

export interface CourseHostEnvironment {
	win: Window;
	doc: Document;
	location: Pick<Location, "href" | "search" | "replace">;
	history: Pick<History, "state" | "replaceState">;
}

type CourseHostWindow = {
	__praxityHostStarted?: CourseHostFormat;
	__praxityBlockState?: LearnerBlockStateRuntime;
	__praxityRuntime?: SCORMRuntime;
	__praxityTracker?: CourseTracker;
};

/** A confirmed return, resolved by the host before navigation initializes. */
export interface ConfirmedCourseResume {
	pageId: string;
}

declare global {
	interface Window {
		__praxityResume?: ConfirmedCourseResume;
	}
}

export function initializeCourseHost(
	adapter: CourseHostAdapter,
	environment = browserEnvironment(),
): boolean {
	if (!environment) return false;
	if (isSmallPreviewDocument(environment.location.search)) return false;
	const deployment = (adapter.readDeploymentConfig ?? readBasicCourseDeploymentConfig)(
		environment.doc,
	);
	if (!deployment || deployment.format !== adapter.format) return false;
	const page = readCourseHostConfig(environment.doc);
	if (!page) return false;
	const blockStatePolicy =
		globalThis.__praxityPrivateState !== false ? { ...page.blockStatePolicy } : {};
	if (page.pageRole === "glossary" && !adapter.canStartGlossary?.(environment)) return false;

	const hostView = environment.win as Window & typeof globalThis;
	const hostWindow = hostView as CourseHostWindow;
	if (hostWindow.__praxityHostStarted) return false;
	hostWindow.__praxityHostStarted = adapter.format;

	let owner = hostView.__praxitySelfCheckDocument;
	let admitted = false,
		preparing = false,
		privacySettled = !hostView.__praxityPrivacyReady;
	let announcing: ReturnType<NonNullable<typeof owner>["lifetime"]>;
	let trackerLifetime: typeof announcing;
	const bindCommitPreparation = (
		runtime: SCORMRuntime,
		tracker: CourseTracker,
		current: () => boolean,
	) =>
		runtime.setCommitPreparation?.(() => {
			if (current() && hostWindow.__praxityRuntime === runtime) tracker.prepareCommit();
		});
	const createTracker = (
		runtime: SCORMRuntime,
		current: () => boolean,
		provider: LearnerBlockStateRuntime,
	) =>
		new CourseTracker(withLearnerStateAuthority(runtime, current), {
			...provider.getChoiceReporting?.(current),
			totalPages: page.totalPages,
			completionMethod: page.completionMethod,
			completionThreshold: page.completionThreshold,
			requiredAssessmentIds: page.requiredAssessmentIds,
			passMark: page.passMark,
			scoredAssessmentIds: page.scoredAssessmentIds,
			...(adapter.format === "standalone"
				? {
						reportOutcome: false,
						getAssessmentState: (id: string) => hostWindow.__praxityBlockState?.get(id),
					}
				: {}),
			pageAliases: Object.fromEntries(
				Object.entries(page.pageIdMap).map(([id, slug]) => [slug, id]),
			),
			deferRetryableFailure:
				(adapter.format === "scorm12" || adapter.format === "scorm2004") &&
				!adapter.isFallback?.(runtime),
		});

	const announce = (lifetime = owner?.lifetime()) => {
		const authority = owner;
		if (authority && (!lifetime?.current() || announcing === lifetime)) return;
		announcing = lifetime;
		const provider = hostWindow.__praxityBlockState;
		const runtime = hostWindow.__praxityRuntime;
		if (provider && runtime && hostWindow.__praxityTracker && trackerLifetime !== lifetime) {
			const current = () =>
				(!authority || lifetime?.current() === true) && hostWindow.__praxityBlockState === provider;
			const tracker = createTracker(runtime, current, provider);
			hostWindow.__praxityTracker = tracker;
			bindCommitPreparation(runtime, tracker, current);
			trackerLifetime = lifetime;
		}
		if (provider && page.deferVisits && page.pageRole === "content" && !page.deck) {
			const tracker = hostWindow.__praxityTracker;
			const bookmark =
				adapter.format === "standalone" ||
				adapter.format === "xapi" ||
				(runtime && adapter.isFallback?.(runtime))
					? page.pageId
					: `index.html?praxity-page=${encodeURIComponent(page.pageId)}`;
			provider.finalizeLearner = (pass) => {
				if ((!authority || lifetime?.current()) && pass.current())
					tracker?.trackPageVisit(page.pageId, bookmark);
			};
		}
		const publish = () => {
			if ((!authority || lifetime?.current()) && hostWindow.__praxityBlockState === provider) {
				if (lifetime) authority?.admit(lifetime);
				if (authority && !lifetime?.current()) return;
				hostView.dispatchEvent(new hostView.CustomEvent("praxity:runtime-ready", { detail: page }));
			}
		};
		if (privacySettled) publish();
		else
			void hostView.__praxityPrivacyReady?.then(() => {
				privacySettled = true;
				publish();
			});
	};
	const run = (runtime: SCORMRuntime, discovered = owner?.loadTicket() ?? (() => true)) => {
		if (!discovered()) return;
		preparing = true;
		try {
			const resume =
				owner?.lifetime()?.reason === "return" ? undefined : adapter.prepareResume?.(environment);
			if (globalThis.__praxityPrivateState !== false)
				runtime.setBlockStatePolicy?.(blockStatePolicy);
			// Let the shell restore readable content if the host cannot initialize.
			if (!runtime.initialize()) throw new Error();
			if (!discovered()) {
				preparing = false;
				return;
			}
			hostWindow.__praxityRuntime = runtime;
			const requestedProvider =
				globalThis.__praxityPrivateState === true ||
				(globalThis.__praxityPrivateState !== false &&
					page.blockStatePolicy &&
					Object.keys(page.blockStatePolicy).length)
					? createPrivateBlockStateRuntime(
							runtime,
							page,
							hostView,
							adapter.deviceStateRuntime,
							adapter.format,
						)
					: createBlockStateRuntime(runtime);
			if (!discovered()) {
				preparing = false;
				return;
			}
			const admittedOwner = owner;
			const installationEpoch = admittedOwner ? admittedOwner.epoch() + 1 : undefined;
			hostWindow.__praxityBlockState = requestedProvider;
			// An injected accessor can retain or wrap the provider during installation.
			const provider = hostWindow.__praxityBlockState;
			const admittedLifetime = admittedOwner?.lifetime();
			const owned = () =>
				(!admittedOwner ||
					(admittedOwner.epoch() === installationEpoch && admittedLifetime?.current() === true)) &&
				hostWindow.__praxityBlockState === provider;
			preparing = false;
			if (!provider || !owned()) return;
			const tracker = createTracker(runtime, owned, provider);
			bindCommitPreparation(runtime, tracker, owned);
			const scormSession = adapter.installLifecycle?.(runtime, page, environment) === true;
			if (!scormSession) {
				hostView.addEventListener("beforeunload", () => hostWindow.__praxityRuntime?.commit());
			}
			if (!owned() || resume?.(runtime, page) === "redirect" || !owned()) return;

			// Utility documents use the launch's exit policy without evaluating their own course rule.
			if (!(scormSession && page.pageRole !== "content")) {
				trackerLifetime = admittedLifetime;
				if (!owned()) return;
				hostWindow.__praxityTracker = tracker;
				if (!scormSession)
					hostView.__praxityFinishCourse = (current = selfCheckEpochTicket(environment.doc)) => {
						const active = hostWindow.__praxityTracker ?? tracker;
						const runtime = hostWindow.__praxityRuntime;
						if (runtime) active.finish(false, withLearnerStateAuthority(runtime, current));
						return current();
					};
				if (page.pageRole === "content" && !page.deck) {
					const bookmark =
						adapter.format === "standalone" ||
						adapter.format === "xapi" ||
						adapter.isFallback?.(runtime) === true
							? page.pageId
							: `index.html?praxity-page=${encodeURIComponent(page.pageId)}`;
					// Every self-check policy, including LMS reporting, selects the enriched host.
					if (globalThis.__praxityPrivateState === false || !page.deferVisits)
						tracker.trackPageVisit(page.pageId, bookmark);
					else {
						provider.finalizeLearner = (pass) => {
							if (owned() && pass.current()) tracker.trackPageVisit(page.pageId, bookmark);
						};
					}
				}
			}
			admitted = true;
			preparing = false;
			// Re-admission joins the shared support result under a fresh captured lifetime.
			if (owner) announce();
			else {
				let provider: LearnerBlockStateRuntime | null | undefined =
					globalThis.__praxityPrivateState === true ? hostWindow.__praxityBlockState : undefined;
				const publishReady = () =>
					(globalThis.__praxityPrivateState !== true ||
						(provider && hostWindow.__praxityBlockState === provider)) &&
					hostView.dispatchEvent(
						new hostView.CustomEvent("praxity:runtime-ready", { detail: page }),
					);
				if (globalThis.__praxityPrivateState === true) {
					hostView.addEventListener("pagehide", () => (provider = null));
					void (hostView.__praxityPrivacyReady?.then(publishReady) ?? publishReady());
				} else publishReady();
			}
		} finally {
			preparing = false;
		}
	};

	let stopDiscovery = () => {};
	const ready = () => {
		const owned = owner?.loadTicket() ?? (() => true);
		if (!owned()) return;
		const runtime = adapter.createRuntime(page, deployment, hostView);
		if (!owned()) return;
		if (!adapter.isFallback?.(runtime) || !hostView.opener) {
			run(runtime, owned);
			return;
		}
		let attempts = 0;
		const timer = hostView.setInterval(() => {
			if (!owned()) return;
			attempts++;
			const candidate = adapter.createRuntime(page, deployment, hostView);
			if (!owned()) return;
			if (!adapter.isFallback?.(candidate) || attempts >= 5) {
				hostView.clearInterval(timer);
				run(candidate, owned);
			}
		}, 200);
		stopDiscovery = () => hostView.clearInterval(timer);
	};
	const start = () => {
		const owned = owner?.loadTicket() ?? (() => true);
		const onDomReady = () => {
			if (owned()) ready();
		};
		if (environment.doc.readyState === "loading") {
			environment.doc.addEventListener("DOMContentLoaded", onDomReady, { once: true });
			stopDiscovery = () => environment.doc.removeEventListener("DOMContentLoaded", onDomReady);
		} else ready();
	};
	if (owner) {
		let observed = owner.lifetime();
		const rearm = () => {
			const next = hostView.__praxitySelfCheckDocument;
			const lifetime = next?.lifetime();
			if (next === owner && lifetime === observed) return;
			owner = next;
			observed = lifetime;
			stopDiscovery();
			if (!lifetime || preparing) return;
			if (lifetime.reason === "return") delete hostView.__praxityResume;
			if (admitted) announce(lifetime);
			else start();
		};
		environment.doc.addEventListener("praxity:self-check-owner", rearm);
		start();
	} else start();

	// Capture before any response consumer, including listeners installed before this host.
	if (globalThis.__praxityPrivateState !== false)
		hostView.addEventListener(
			"praxity:assessment-response",
			(event) => {
				const current = selfCheckEpochTicket(environment.doc, event);
				const detail = (event as CustomEvent<Record<string, unknown>>).detail;
				if (!current() || (detail && blockStatePolicy[String(detail.blockId)] === "device"))
					event.stopImmediatePropagation();
			},
			true,
		);

	environment.doc.addEventListener("praxity:assessment-response", (event) => {
		const owned = selfCheckEpochTicket(environment.doc, event);
		const tracker = hostWindow.__praxityTracker;
		const runtime = hostWindow.__praxityRuntime;
		if (!tracker || !owned()) return;
		const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
		const blockId = String(detail.blockId ?? "");
		const options = assessmentReportingOptions(detail, page.pageTitle);
		if (globalThis.__praxityPrivateState !== false && blockStatePolicy[blockId] === "lms")
			options.onResponseTruncated = (responseLimit) =>
				owned() &&
				environment.doc.dispatchEvent(
					new hostView.CustomEvent("praxity:assessment-response-truncated", {
						detail: { blockId, responseLimit } satisfies LearnerBlockResponseTruncated,
					}),
				);
		const score = Number(detail.score);
		const maxScore = Number(detail.maxScore);
		try {
			tracker.trackInteraction(
				blockId,
				String(detail.responseText ?? ""),
				typeof detail.correct === "boolean" ? detail.correct : undefined,
				Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
					? (score / maxScore) * 100
					: undefined,
				options,
			);
		} catch (error) {
			if (runtime?.getBlockSaveResult?.(blockId)?.status === "not-saved") return;
			throw error;
		}
		if (owned() && hostWindow.__praxityRuntime === runtime) runtime?.commit();
	});

	environment.doc.addEventListener("praxity:assessment-group-complete", (event) => {
		const owned = selfCheckEpochTicket(environment.doc, event);
		const tracker = hostWindow.__praxityTracker;
		const runtime = hostWindow.__praxityRuntime;
		if (!tracker || !owned()) return;
		const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
		const score = detail.score as number;
		const hasScore = Number.isFinite(score);
		const passed = detail.passed === true;
		const groupId = String(detail.groupId ?? "");
		// Keep the event's existing adapter and ticket; tracker writes have their own lifetime.
		if (hasScore && runtime) {
			const accepted = tracker.trackGroupObjective(
				groupId,
				score,
				passed,
				runtime,
				typeof detail.contentSignature === "string" ? detail.contentSignature : undefined,
			);
			if (!accepted) event.preventDefault();
		}
		if (!owned()) return;
		tracker.trackInteraction(
			groupId,
			hasScore ? `${score}%` : "",
			typeof detail.correct === "boolean" ? detail.correct : hasScore ? passed : undefined,
			hasScore ? score : undefined,
			assessmentReportingOptions(detail, page.pageTitle),
		);
		if (owned() && hostWindow.__praxityRuntime === runtime) runtime?.commit();
	});

	return true;
}

/** SCORM owns utility participation and communication; other hosts keep their lifecycle. */
export function initializeScormCourseHost(
	adapter: ScormCourseHostAdapter,
	environment = browserEnvironment(),
): boolean {
	return initializeCourseHost(
		{
			...adapter,
			canStartGlossary: (environment) =>
				readSessionState(
					findScormApi(environment.win, adapter.format === "scorm12" ? "1.2" : "2004")?.api as
						| object
						| null,
					environment.win,
				),
			installLifecycle: (runtime, page, environment) => {
				if (adapter.isFallback?.(runtime)) return false;
				installScormLifecycle(runtime, page, adapter.format, environment);
				return true;
			},
			prepareResume: (environment) => prepareScormResume(adapter, environment),
		},
		environment,
	);
}

/** Document exits save progress. Only an authored End action may close communication. */
function installScormLifecycle(
	runtime: SCORMRuntime,
	page: CourseHostConfig,
	format: CourseHostFormat,
	environment: CourseHostEnvironment,
): void {
	const api = findScormApi(environment.win, format === "scorm12" ? "1.2" : "2004")?.api as
		| object
		| null;
	const session = getSessionState(api, environment.win);
	// Finish retains the launch adapter through reentrant host teardown.
	const finishTracker = new CourseTracker(runtime, page);
	let finished = false;
	const commit = () => {
		if (!finished && !session?.closed) runtime.commit();
	};
	environment.win.addEventListener("beforeunload", commit);
	environment.win.addEventListener("pagehide", commit);
	if (page.pageRole !== "content") return;
	environment.win.__praxityFinishCourse = () => {
		if (finished || session?.closed) return finished || session?.terminationSucceeded === true;
		try {
			// The adapter owns completion preparation inside the shared reentry guard.
			finished = finishTracker.finish(true);
			return finished;
		} finally {
			if (finished || session?.closed) {
				const hostWindow = environment.win as CourseHostWindow;
				hostWindow.__praxityRuntime = undefined;
				hostWindow.__praxityTracker = undefined;
				hostWindow.__praxityBlockState = undefined;
			}
		}
	};
}

export function readBasicCourseDeploymentConfig(doc: Document): CourseDeploymentConfig | null {
	const value = readJsonElement(doc, "praxity-deployment-config");
	if (!value) return null;
	if (value.format === "electron-preview") {
		return isSha256(value.revision)
			? { format: "electron-preview", revision: value.revision }
			: null;
	}
	if (value.format === "standalone" || value.format === "scorm12" || value.format === "scorm2004") {
		return { format: value.format };
	}
	return null;
}

/** The xAPI host opts into this reader; SCORM hosts need only the common deployment fields. */
export function readCourseDeploymentConfig(doc: Document): CourseDeploymentConfig | null {
	const basic = readBasicCourseDeploymentConfig(doc);
	if (basic) return basic;
	const value = readJsonElement(doc, "praxity-deployment-config");
	if (!value) return null;
	if (value.format !== "xapi") return null;
	const courseActivityId = isAbsoluteIri(value.courseActivityId)
		? value.courseActivityId
		: undefined;
	if (value.xapiConfig === undefined)
		return { format: "xapi", ...(courseActivityId ? { courseActivityId } : {}) };
	const xapiConfig = readXapiConfig(value.xapiConfig);
	return xapiConfig
		? { format: "xapi", xapiConfig, ...(courseActivityId ? { courseActivityId } : {}) }
		: null;
}

export function composeScormResumeUrl(href: string, targetSlug: string): string {
	const url = new URL(href);
	url.pathname = url.pathname.replace(/[^/]*$/, `${encodeURIComponent(targetSlug)}.html`);
	url.searchParams.set("praxity-resume", "1");
	return url.href;
}

/** Capture communication state before Initialize, then resolve entry after it. */
export function prepareScormResume(
	adapter: ScormCourseHostAdapter,
	environment: CourseHostEnvironment,
): (runtime: SCORMRuntime, page: CourseHostConfig) => "redirect" | null {
	const freshEntry = isFreshResumeEntry(environment.win.performance);
	const continuingSession = readSessionState(
		findScormApi(environment.win, adapter.format === "scorm12" ? "1.2" : "2004")?.api as
			| object
			| null,
		environment.win,
	);
	return (runtime, page) =>
		handleCourseResume(
			runtime,
			page,
			environment,
			continuingSession,
			() =>
				freshEntry &&
				!adapter.isFallback?.(runtime) &&
				adapter.readEntry(environment.win) === "resume",
		);
}

/** Local storage supplies the bookmark only for fresh course entry. */
export function prepareStandaloneResume(
	environment: CourseHostEnvironment,
): (runtime: SCORMRuntime, page: CourseHostConfig) => "redirect" | null {
	let freshEntry = isFreshResumeEntry(environment.win.performance);
	environment.win.addEventListener("pageshow", (event) => {
		if (!event.persisted) return;
		freshEntry = false;
		delete environment.win.__praxityResume;
	});
	return (runtime, page) => handleCourseResume(runtime, page, environment, false, () => freshEntry);
}

/** Reload and Back/Forward keep the browser's destination. */
function isFreshResumeEntry(performance: Performance): boolean {
	const navigation = performance.getEntriesByType?.("navigation")?.[0] as
		| PerformanceNavigationTiming
		| undefined;
	// Firefox may not expose the navigation entry before load. Its legacy timing
	// object already distinguishes reload and history traversal before tracking.
	return !["reload", "back_forward", 1, 2].includes(
		navigation?.type ?? performance.navigation?.type,
	);
}

/** Both transports resolve the same destination before tracking can replace the bookmark. */
function handleCourseResume(
	runtime: SCORMRuntime,
	page: CourseHostConfig,
	environment: CourseHostEnvironment,
	continuingSession: boolean,
	admit: () => boolean,
): "redirect" | null {
	if (page.pageRole !== "content" || !admit()) return null;
	const params = new URLSearchParams(environment.location.search);
	const arrival = params.get("praxity-resume");
	const redirected = arrival === "1";
	if (redirected || arrival === "0") {
		try {
			const cleanUrl = new URL(environment.location.href);
			cleanUrl.searchParams.delete("praxity-resume");
			environment.history.replaceState(environment.history.state, "", cleanUrl.href);
		} catch {
			// Focus still needs to be restored when the host blocks history changes.
		}
	}
	if (arrival === "0") return null;
	// Entry stays "resume" throughout a SCO session. Internal navigation and
	// explicit deck fragments keep their own arrival policy.
	if (!redirected && (continuingSession || page.currentPage !== 1)) return null;
	let bookmark: string | null = null;
	try {
		bookmark = runtime.getBookmark();
	} catch {
		// Keep the current page when the storage adapter rejects bookmark access.
	}
	const savedSlug = resolveBookmarkSlug(bookmark, page.pageIdMap);
	if (!savedSlug || !page.availableSlugs.includes(savedSlug)) return null;
	const deckPageId = page.deck
		? Object.entries(page.pageIdMap).find(([, slug]) => slug === savedSlug)?.[0]
		: undefined;
	const fragment = environment.location.href.split("#")[1];
	// The deck owns matching restored fragments and gate redirects to its slides.
	if (page.deck && fragment) {
		if (!redirected) return null;
	} else if (redirected && savedSlug !== page.currentSlug) return null;
	if (savedSlug === page.currentSlug || redirected) {
		environment.win.__praxityResume = {
			pageId: deckPageId ?? page.pageId,
		};
		return null;
	}
	environment.location.replace(composeScormResumeUrl(environment.location.href, savedSlug));
	return "redirect";
}

/** Current stable IDs and index URLs, plus legacy slug bookmarks. */
export function resolveBookmarkSlug(
	bookmark: string | null,
	pageIdMap: Record<string, string>,
): string | null {
	if (!bookmark) return null;
	let pageId = bookmark;
	try {
		pageId =
			new URL(bookmark, "https://praxity.invalid/").searchParams.get("praxity-page") || bookmark;
	} catch {
		// Malformed legacy URLs can still be plain slugs.
	}
	return Object.hasOwn(pageIdMap, pageId) ? pageIdMap[pageId] : bookmark;
}

function browserEnvironment(): CourseHostEnvironment | null {
	if (typeof window === "undefined" || typeof document === "undefined") return null;
	return { win: window, doc: document, location: window.location, history: window.history };
}

function readXapiConfig(value: unknown): XapiConfig | null {
	if (
		!isRecord(value) ||
		!isNonemptyString(value.endpoint) ||
		!isNonemptyString(value.auth) ||
		!(value.actorMode === "lms" || value.actorMode === "manual") ||
		!(value.activityBase === undefined || isString(value.activityBase))
	) {
		return null;
	}
	const actor = value.actor;
	if (
		actor !== undefined &&
		(!isRecord(actor) || !isNonemptyString(actor.name) || !isNonemptyString(actor.mbox))
	) {
		return null;
	}
	return {
		endpoint: value.endpoint,
		auth: value.auth,
		actorMode: value.actorMode,
		...(value.activityBase ? { activityBase: value.activityBase } : {}),
		...(actor ? { actor: { name: actor.name as string, mbox: actor.mbox as string } } : {}),
	};
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
