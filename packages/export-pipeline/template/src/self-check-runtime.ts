import { getSelfCheckActivationStrings } from "@praxity/shared-blocks/i18n/self-check-host-strings";
import { reportLearnerBlockResponse } from "@praxity/shared-blocks/learner-block-response";
import {
	type LearnerBlockStateRuntime,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import type { SelfCheckConsumers } from "@praxity/shared-blocks/self-check-consumers";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
} from "@praxity/shared-blocks/self-check-consumers";
import { createSelfCheckDraft } from "@praxity/shared-blocks/self-check-draft";
import {
	createSelfCheckSession,
	type SelfCheckCommand,
	type SelfCheckReference,
	type SelfCheckSession,
	type SelfCheckTicket,
} from "@praxity/shared-blocks/self-check-session";
import type { SelfCheckStateResult } from "@praxity/shared-blocks/self-check-state";
import { createCompletionEffects } from "@praxity/shared-blocks/viewer/completion-effects";
import { navigatePage } from "@praxity/shared-blocks/viewer/navigate-page";
import { showRequiredValidation } from "@praxity/shared-blocks/viewer/required-blocks";
import { loadBrowserModule } from "./island-loader";
import type { selfCheckSupport } from "./islands/self-check-support";
import {
	type SelfCheckAttachment,
	type SelfCheckDocument,
	selfCheckDocument,
} from "./self-check-document";

declare const __PRAXITY_SELF_CHECK_SUPPORT__: string;
export interface SelfCheckEffectTicket extends SelfCheckTicket {
	call<T>(effect: () => T): T | undefined;
}
export interface SelfCheckRuntime {
	session: SelfCheckSession;
	results: Map<string, SelfCheckStateResult>;
	provider: Window["__praxityBlockState"];
	support(retry?: boolean): Promise<typeof selfCheckSupport>;
	ticket(mounted?: () => boolean): SelfCheckEffectTicket;
	refresh(): void;
	subscribe(
		project: (ticket: SelfCheckEffectTicket, command?: SelfCheckCommand) => void,
		finish?: (ticket: SelfCheckEffectTicket, command: SelfCheckCommand) => void,
	): () => void;
}
declare global {
	interface Window {
		__praxitySelfCheckSession?: SelfCheckRuntime;
	}
}
function createRuntime(
	doc: Document,
	provider: LearnerBlockStateRuntime | undefined,
	epoch: () => number,
	owned: (cancelled?: boolean) => boolean,
	cancelled: () => void,
	edited: (blockId: string) => void,
	finalize: (ticket: SelfCheckEffectTicket, command?: SelfCheckCommand) => void,
): SelfCheckRuntime {
	const view = doc.defaultView;
	if (!view) throw new Error("ESELFCHECKDOCUMENT");
	const authority = selfCheckEpochTicket(doc);
	const results = new Map<string, SelfCheckStateResult>();
	let loading: Promise<typeof selfCheckSupport> | undefined;
	let failed = false,
		attempt = 0;
	const support = (retry = false) => {
		if (retry && failed) {
			loading = undefined;
			failed = false;
			++attempt;
		}
		if (!loading) {
			const url = new URL(__PRAXITY_SELF_CHECK_SUPPORT__, doc.baseURI);
			// Browsers cache failed ESM imports. A deliberate retry needs a new request.
			const classic = doc.location.protocol === "file:";
			if (attempt && !classic) url.searchParams.set("retry", String(attempt));
			loading = loadBrowserModule(url.href, classic, doc)
				.then((module) => {
					const adapter = classic
						? view.__praxitySelfCheckSupport
						: (module as { selfCheckSupport?: typeof selfCheckSupport })?.selfCheckSupport;
					if (!adapter) throw new Error("ESELFCHECKLOAD");
					return adapter;
				})
				.catch(() => {
					failed = true;
					throw new Error("ESELFCHECKLOAD");
				});
		}
		return loading;
	};

	const roots = [...doc.querySelectorAll<HTMLElement>("[data-self-check]")];
	const rootFor = (blockId: string) => roots.find((root) => root.dataset.selfCheckId === blockId);
	let references: SelfCheckReference[] = roots
		.filter((root) => !root.hasAttribute("data-self-check-context-pending"))
		.map((root) => ({
			blockId: root.dataset.selfCheckId ?? "",
			contentRevision: root.dataset.selfCheckRevision ?? "",
			path: root.dataset.selfCheckSrc ?? "",
		}));
	const config = JSON.parse(doc.getElementById("praxity-config")?.textContent || "{}");
	if (Array.isArray(config.selfChecks?.references))
		references = config.selfChecks.references.filter(
			(reference: SelfCheckReference) =>
				!rootFor(reference.blockId)?.hasAttribute("data-self-check-context-pending"),
		);
	const storageHeld = (blockId: string) => {
		const result = provider?.getSaveResult?.(blockId);
		return result?.status === "not-saved" && result.code === "unreadable-state";
	};
	const requireReadableStorage = (blockId: string) => {
		if (storageHeld(blockId)) throw new Error("ESELFCHECKNOTREADY");
	};
	const session = createSelfCheckSession(references, {
		deferStart: true,
		startupPending: true,
		current: (cancelled) =>
			owned(cancelled) && (cancelled || provider === view.__praxityBlockState),
		read: (blockId) => {
			const value = provider?.get(blockId);
			// An empty held draft still needs admission so its unavailable notice stays visible.
			return value === undefined && storageHeld(blockId) ? { ...createSelfCheckDraft() } : value;
		},
		write: (blockId, value) => {
			const current = () => owned() && provider === view.__praxityBlockState;
			writeLearnerBlockState(blockId, value as LearnerStateValue, current, doc);
		},
		admit: async (reference, retry) => {
			requireReadableStorage(reference.blockId);
			const generation = epoch();
			await window.__praxitySelfCheckCore.implementation(doc);
			if (generation !== epoch() || !owned()) throw new Error("ESELFCHECKCANCELLED");
			const adapter = await support(retry);
			if (generation !== epoch() || !owned() || provider !== view.__praxityBlockState)
				throw new Error("ESELFCHECKCANCELLED");
			// Held storage already refuses admission; save receipts must follow the state write.
			return adapter.admit(reference, doc);
		},
		project: (blockId, result) => {
			results.set(blockId, result);
		},
	});
	const subscribers = new Set<{
		project: Parameters<SelfCheckRuntime["subscribe"]>[0];
		finish?: Parameters<SelfCheckRuntime["subscribe"]>[1];
	}>();
	const wrap = (
		pass: SelfCheckTicket,
		mounted = () => true,
		cancelled = false,
	): SelfCheckEffectTicket => {
		const generation = epoch();
		const current = () => generation === epoch() && owned(cancelled) && pass.current() && mounted();
		return {
			revision: pass.revision,
			current,
			call: (effect) => {
				if (!current()) return;
				const value = effect();
				return current() ? value : undefined;
			},
		};
	};
	const runtime: SelfCheckRuntime = {
		session,
		results,
		provider,
		support,
		refresh: session.refresh,
		ticket: (mounted) => wrap(session.ticket(), mounted),
		subscribe(project, finish) {
			const subscriber = { project, finish };
			subscribers.add(subscriber);
			subscriberEffect(runtime.ticket(), () => project(runtime.ticket()));
			return () => {
				subscribers.delete(subscriber);
			};
		},
	};
	const subscriberEffect = (pass: SelfCheckEffectTicket, effect: () => void) => {
		try {
			pass.call(effect);
		} catch (error) {
			view.reportError(error);
		}
	};
	const cancelledRuntime = cancelled;
	const published = new Map<string, string>();
	const capture = (event: Event) => {
		const answer = event.target;
		if (!owned() || !(answer instanceof view.HTMLTextAreaElement)) return;
		const root = answer.closest<HTMLElement>("[data-self-check]");
		if (!root || root.hasAttribute("data-self-check-context-pending")) return;
		const value = answer.value;
		const active = selfCheckRuntime(doc);
		if (!active.ticket().current()) return;
		const blockId = root.dataset.selfCheckId ?? "";
		edited(blockId);
		void active.session.dispatch({
			type: "edit",
			blockId,
			answer: value,
		});
	};
	// The document drains UI projection, completion, interaction, reporting and status in that order.
	session.subscribe((snapshot, committed, command) => {
		const cancelled = snapshot.activities.every((activity) => activity.outcome === "cancelled");
		const pass = wrap(committed, () => true, cancelled);
		if (!pass.current()) {
			if (cancelled) cancelledRuntime();
			return;
		}
		if (command?.type === "edit" || command?.type === "start-over") edited(command.blockId);
		for (const activity of snapshot.activities) {
			if (activity.outcome === "cancelled") continue;
			const value = session.draftAnswer(activity.blockId);
			const answer = rootFor(activity.blockId)?.querySelector("textarea");
			if (answer && value !== undefined && answer.value !== value)
				pass.call(() => {
					answer.value = value;
				});
			if (!pass.current()) return;
		}
		if (cancelled) doc.removeEventListener("input", capture, true);
		if (snapshot.ready) {
			for (const activity of snapshot.activities) {
				if (!pass.current()) return;
				const root = rootFor(activity.blockId);
				const wrapper = root?.closest<HTMLElement>("[data-block-id]") ?? root;
				if (!wrapper) continue;
				pass.call(() => {
					if (activity.completed) {
						wrapper.dataset.attempted = "true";
						wrapper.dataset.completed = "true";
					} else {
						delete wrapper.dataset.attempted;
						delete wrapper.dataset.completed;
					}
					if (activity.outcome !== "empty" || activity.origin !== "fresh")
						wrapper.setAttribute("data-hydrated", "");
				});
			}
		}
		if (!cancelled)
			for (const subscriber of subscribers) {
				subscriberEffect(pass, () => subscriber.project(pass, command));
				if (!pass.current()) return;
			}
		if (!cancelled) {
			pass.call(() => finalize(pass, command));
			if (!pass.current()) return;
		}
		if (snapshot.ready)
			for (const activity of snapshot.activities) {
				if (!pass.current()) return;
				const publication = `${activity.completed}:${activity.generation}`;
				if (published.get(activity.blockId) === publication) continue;
				published.set(activity.blockId, publication);
				pass.call(() =>
					dispatchSelfCheckEvent(
						new CustomEvent("praxity:self-check-completion", {
							detail: { blockId: activity.blockId, completed: activity.completed },
						}),
						// Cancellation may project controls, but cannot authorize learner writes.
						() => pass.current() && authority(),
						doc,
						doc,
						cancelled ? pass.current : undefined,
					),
				);
				if (!pass.current()) return;
			}
		if (cancelled && pass.current()) {
			pass.call(cancelledRuntime);
			return;
		}
		if (!command || !pass.current()) return;
		if (command.type === "show-feedback") {
			pass.call(() =>
				dispatchSelfCheckEvent(
					new CustomEvent("praxity:block-interaction", {
						detail: { blockId: command.blockId, blockType: "selfCheck" },
					}),
					pass.current,
					doc,
				),
			);
			if (!pass.current()) return;
			const result = results.get(command.blockId);
			const policy = pass.call(() => provider?.getPolicy?.(command.blockId));
			if (!pass.current()) return;
			const response = result?.response;
			if (response && policy === "lms")
				pass.call(() =>
					reportLearnerBlockResponse(
						{ ...response },
						{ document: doc, provider, current: pass.current },
					),
				);
			if (!pass.current()) return;
		}
		for (const subscriber of subscribers) {
			subscriberEffect(pass, () => subscriber.finish?.(pass, command));
			if (!pass.current()) return;
		}
	});
	view.__praxitySelfCheckSession = runtime;
	doc.addEventListener("input", capture, true);
	return runtime;
}
/** Domain projection attaches only after the lightweight owner has registered. */
function createDocumentAttachment(doc: Document, owner: SelfCheckDocument): SelfCheckAttachment {
	const view = doc.defaultView;
	if (!view) throw new Error("ESELFCHECKDOCUMENT");
	let current: SelfCheckRuntime;
	let finishCancellation: (() => void) | undefined;
	let suspendedFocus:
		| { element: HTMLElement; id: string; blockId: string; provider: SelfCheckRuntime["provider"] }
		| undefined;
	const epoch = () => owner.epoch();
	const retained = new Map<string, { answer: string; replay: boolean }>();
	const retainedLayout = new Map<
		HTMLElement,
		{ height: number; value: string; priority: string }
	>();
	const releaseLayout = () => {
		for (const [root, layout] of retainedLayout)
			root.style.setProperty("min-height", layout.value, layout.priority);
		retainedLayout.clear();
	};
	const edits = new Set<string>();
	const mounts = new Set<(runtime?: SelfCheckRuntime) => void>();
	let islandsAttached = doc.documentElement.dataset.praxityIslandsReady === "true";
	let finalized: SelfCheckTicket | undefined;
	const effects = new Set<Parameters<SelfCheckConsumers["subscribe"]>[0]>();
	const tracking = new Set<Parameters<SelfCheckConsumers["subscribe"]>[0]>();
	const settled = new Set<Parameters<SelfCheckConsumers["subscribe"]>[0]>();
	const dependencyIds = (doc.documentElement.getAttribute("data-self-check-dependencies") ?? "")
		.split(/\s+/)
		.filter(Boolean);
	const config = JSON.parse(doc.getElementById("praxity-config")?.textContent || "{}");
	const nativeLinks = dependencyIds.length
		? [...doc.querySelectorAll<HTMLElement>("a[data-page-number]")]
		: [];
	const presentation = dependencyIds.length
		? createCompletionEffects(config.currentPage ?? 1, doc)
		: undefined;
	let logicBlocked = false,
		logicReasons: string[] = [];
	const ui = getSelfCheckActivationStrings(doc.documentElement.lang);
	const recovery = doc.createElement("span");
	const retry = doc.createElement("button"),
		reset = doc.createElement("button");
	const returnLink = doc.createElement("a");
	returnLink.textContent = ui.selfCheckReturn;
	retry.type = reset.type = "button";
	retry.textContent = ui.selfCheckRetry;
	reset.textContent = view.__PRAXITY_STRINGS__?.selfCheckStartOver ?? ui.selfCheckStartOver;
	retry.dataset.selfCheckGateRetry = "";
	reset.dataset.selfCheckGateReset = "";
	recovery.append(retry, reset, returnLink);
	let failedId: string | undefined;
	let announcedFailure: string | undefined;
	const recover = (type: "retry" | "start-over") => {
		if (!failedId || !owner.active()) return;
		if (type === "retry" && current.session.startup() === "unavailable")
			view.__praxitySelfCheckCore.retry(doc);
		else void current.session.dispatch({ type, blockId: failedId });
	};
	retry.addEventListener("click", () => recover("retry"));
	reset.addEventListener("click", () => recover("start-over"));
	const syncGate = () => {
		if (!presentation) return;
		const failure = dependencyIds
			.map((id) => current.session.read(id))
			.find((activity) => activity?.code);
		failedId = failure?.blockId;
		const blocked = !owner.consumers.forwardReady();
		const reason =
			failure?.code === "activity-changed"
				? ui.selfCheckChanged
				: failure?.code === "saved-state-invalid"
					? ui.selfCheckInvalidState
					: failure
						? `${ui.selfCheckUnavailable} ${ui.selfCheckContact}`
						: ui.selfCheckRestoring;
		presentation.sync(blocked || logicBlocked, [...(blocked ? [reason] : []), ...logicReasons]);
		if (failure && !doc.querySelector(`[data-self-check-id="${failure.blockId}"]`)) {
			const key = `${epoch()}:${failure.blockId}:${failure.generation}:${failure.code}`;
			if (key !== announcedFailure) {
				announcedFailure = key;
				const region =
					doc.getElementById("praxity-live-region") ?? doc.getElementById("deck-announcement");
				if (region) region.textContent = reason;
			}
		}
		// Keep the selected recovery control in place while its request is pending.
		recovery.hidden = !(blocked && failure) && !recovery.contains(doc.activeElement);
		if (blocked && failure) {
			const reference = config.selfChecks?.references.find(
				(reference: { blockId: string }) => reference.blockId === failedId,
			);
			returnLink.hidden =
				!!doc.querySelector(`[data-self-check-id="${failedId}"]`) || !reference?.ownerHref;
			if (reference?.ownerHref) returnLink.href = reference.ownerHref;
			retry.hidden = failure.code !== "comparison-unavailable";
			presentation.description.append(recovery);
		}
	};
	const finalizeConsumers = (pass: SelfCheckEffectTicket, command?: SelfCheckCommand) => {
		finalized = undefined;
		if (
			!current ||
			!islandsAttached ||
			!owner.active() ||
			!pass.current() ||
			dependencyIds.some((id) => current.session.read(id)?.ready !== true)
		) {
			syncGate();
			return;
		}
		for (const effect of effects) {
			pass.call(() => effect(pass, command));
			if (!pass.current()) return;
		}
		finalized = pass;
		if (
			suspendedFocus &&
			current.session.read(suspendedFocus.blockId)?.ready &&
			(doc.getElementById(suspendedFocus.id) ||
				!current.session.read(suspendedFocus.blockId)?.admitted)
		) {
			const focused = suspendedFocus;
			suspendedFocus = undefined;
			const target = doc.getElementById(focused.id);
			if (
				current.provider === focused.provider &&
				!focused.element.isConnected &&
				doc.activeElement === doc.body &&
				target &&
				!target.closest("[hidden]")
			)
				pass.call(() => target.focus({ preventScroll: true }));
		}
		syncGate();
		for (const effect of settled) {
			pass.call(() => effect(pass, command));
			if (!pass.current()) return;
		}
		syncGate();
		finalizeTracking(pass, command);
	};
	const finalizeTracking = (pass: SelfCheckEffectTicket, command?: SelfCheckCommand) => {
		if (!pass.current() || !owner.consumers.forwardReady() || logicBlocked) return;
		const visit = current.provider?.finalizeLearner;
		if (visit && current.provider) {
			current.provider.finalizeLearner = undefined;
			pass.call(() => visit(pass));
		}
		if (!pass.current()) return;
		for (const effect of tracking) {
			pass.call(() => effect(pass, command));
			if (!pass.current()) return;
		}
	};
	const initialize = (runtime: SelfCheckRuntime) => {
		const generation = epoch();
		const owned = () => current === runtime && generation === epoch() && runtime.ticket().current();
		if (!owned()) return;
		for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
			const answer = root.querySelector("textarea");
			if (answer?.hasAttribute("data-self-check-edited")) {
				retained.set(root.dataset.selfCheckId ?? "", { answer: answer.value, replay: true });
				answer.removeAttribute("data-self-check-edited");
			}
		}
		// Read the captured provider before any replay can replace opaque comparison bytes.
		runtime.session.initialize();
		if (!owned()) return;
		for (const [blockId, draft] of retained) {
			retained.delete(blockId);
			if (
				runtime.session.read(blockId) &&
				(draft.replay || runtime.session.draftAnswer(blockId) !== draft.answer)
			)
				void runtime.session.dispatch({ type: "edit", blockId, answer: draft.answer });
			if (!owned()) return;
		}
	};
	const replace = () => {
		finalized = undefined;
		const generation = epoch();
		let runtime!: SelfCheckRuntime;
		runtime = createRuntime(
			doc,
			owner.lifetime()?.provider,
			epoch,
			(cancelled) =>
				current !== undefined &&
				current === runtime &&
				view.__praxitySelfCheckDocument === owner &&
				(cancelled === true || owner.loadTicket()()),
			() => {
				const complete = finishCancellation;
				finishCancellation = undefined;
				complete?.();
			},
			(blockId) => {
				retained.delete(blockId);
				edits.add(blockId);
			},
			finalizeConsumers,
		);
		current = runtime;
		if (owner.lifetime()?.reason === "return") {
			for (const [root, layout] of retainedLayout)
				root.style.setProperty("min-height", `${layout.height}px`);
			const owned = owner.loadTicket();
			// Keep the cached document's geometry until current controls finish reattaching.
			void runtime.session.ready.then(() =>
				view.requestAnimationFrame(() => {
					if (owned()) releaseLayout();
				}),
			);
		} else releaseLayout();
		for (const mount of mounts) {
			if (generation !== epoch() || !owner.active()) return;
			mount(runtime);
			if (generation !== epoch() || !owner.active()) return;
		}
		initialize(runtime);
	};
	const finalize = () => {
		const generation = epoch();
		releaseLayout();
		for (const mount of mounts) {
			mount();
			if (generation !== epoch() || view.__praxitySelfCheckDocument !== owner) return;
		}
		mounts.clear();
		presentation?.destroy();
		view.removeEventListener("beforeprint", beforePrint);
		view.removeEventListener("afterprint", afterPrint);
		for (const link of nativeLinks) link.removeEventListener("click", nativeForward);
		view.removeEventListener("praxity:active-page-change", syncGate);
		doc.removeEventListener("focusin", printFocusChanged);
		for (const output of printAnswers.values()) output.remove();
		printAnswers.clear();
		printFocus = null;
		if (view.__praxitySelfCheckSession === current) delete view.__praxitySelfCheckSession;
	};
	// Enhanced navigation prevents its own click. Native file links join the same action owner.
	const nativeForward = (event: MouseEvent) => {
		if (!dependencyIds.length || event.defaultPrevented || !(event.target instanceof view.Element))
			return;
		const link = event.target.closest<HTMLElement>("a[data-page-number]");
		if (!link?.dataset.pageSlug || Number(link.dataset.pageNumber) <= (config.currentPage ?? 1))
			return;
		event.preventDefault();
		navigatePage({
			targetSlug: link.dataset.pageSlug,
			direction: "forward",
			currentSlug: config.currentSlug,
		});
	};
	const retainDrafts = (replay = false) => {
		for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
			const id = root.dataset.selfCheckId ?? "";
			if (!edits.has(id)) continue;
			const answer = current.session.draftAnswer(id);
			if (answer !== undefined) retained.set(id, { answer, replay });
		}
	};
	const attachment = {
		consumers: {
			epoch: epoch,
			read: (blockId: string) => current.session.read(blockId),
			validateForward: (): boolean => owner.consumers.forwardReady() && !showRequiredValidation(),
			forwardReady: (): boolean =>
				owner.active() &&
				finalized?.current() === true &&
				dependencyIds.every((id) => current.session.read(id)?.available === true),
			settled: (): boolean => owner.active() && finalized?.current() === true,
			subscribe(
				effect: Parameters<SelfCheckConsumers["subscribe"]>[0],
				phase: "effects" | "settled" | "tracking" = "effects",
			) {
				const set = phase === "effects" ? effects : phase === "settled" ? settled : tracking;
				set.add(effect);
				if (phase === "effects") current.refresh();
				else if (phase === "settled" ? owner.consumers.settled() : owner.consumers.forwardReady())
					finalized && effect(finalized);
				return () => {
					set.delete(effect);
				};
			},
			finalize() {
				islandsAttached = true;
				current.refresh();
			},
			presentLogicGate(blocked: boolean, reasons: string[]) {
				const released = logicBlocked && !blocked;
				logicBlocked = blocked;
				logicReasons = reasons;
				syncGate();
				if (released && finalized) {
					const pass = current.ticket();
					// Finish the caller's DOM effects before any visit can check completion.
					queueMicrotask(() => finalizeTracking(pass));
				}
			},
		} satisfies SelfCheckConsumers,
		printFocus(replacement?: HTMLElement) {
			if (replacement) {
				const root = replacement.closest<HTMLElement>("[data-self-check]");
				printFocus = root
					? { root, element: replacement, action: replacement.dataset.selfCheckAction }
					: null;
			}
			return printFocus?.action
				? printFocus.root.querySelector<HTMLElement>(
						`[data-self-check-action="${printFocus.action}"]`,
					)
				: (printFocus?.element ?? null);
		},
		get current() {
			return current;
		},
		mount(listener: (runtime?: SelfCheckRuntime) => void) {
			mounts.add(listener);
			const pass = current.ticket();
			pass.call(() => listener(current));
			return () => {
				if (!mounts.delete(listener)) return;
				listener();
				if (!mounts.size) owner.dispose();
			};
		},
		activate: replace,
		revoke(reason, complete) {
			finishCancellation = complete;
			if (reason === "hide")
				for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
					const previous = retainedLayout.get(root);
					retainedLayout.set(root, {
						height: root.getBoundingClientRect().height,
						value: previous?.value ?? root.style.getPropertyValue("min-height"),
						priority: previous?.priority ?? root.style.getPropertyPriority("min-height"),
					});
					root.style.setProperty("min-height", `${retainedLayout.get(root)?.height}px`);
				}
			if (reason === "hide" && doc.activeElement instanceof view.HTMLElement) {
				const element = doc.activeElement;
				const blockId = element.closest<HTMLElement>("[data-self-check]")?.dataset.selfCheckId;
				suspendedFocus =
					blockId && element.id
						? { element, id: element.id, blockId, provider: current?.provider }
						: undefined;
			} else if (reason !== "hide") suspendedFocus = undefined;
			finalized = undefined;
			islandsAttached = false;
			if (!current) {
				complete?.();
				return;
			}
			if (reason === "reset") {
				retained.clear();
				edits.clear();
				for (const answer of doc.querySelectorAll<HTMLTextAreaElement>(
					"[data-self-check] textarea",
				)) {
					answer.removeAttribute("data-self-check-edited");
					answer.value = "";
				}
			} else if (reason === "hide" || current.session.startup() !== "ready")
				retainDrafts(reason !== "hide");
			if (reason === "provider") edits.clear();
			// UI leases end before a replacement owner can attach, even when cancellation is queued.
			if (reason === "dispose") finalize();
			else if (reason !== "hide") for (const mount of mounts) mount();
			current.session.dispose();
		},
		destroy: finalize,
	} satisfies SelfCheckAttachment;
	// Printing belongs to the permanent owner, so canonical attachment keeps its output and focus.
	const printAnswers = new Map<HTMLElement, HTMLDivElement>();
	// Keep the activity and intended action before remounts remove the captured control.
	let printFocus: { root: HTMLElement; element: HTMLElement; action?: string } | null = null;
	const printFocusChanged = (event: FocusEvent) => {
		if (suspendedFocus && event.target !== suspendedFocus.element && event.target !== doc.body)
			suspendedFocus = undefined;
		if (printFocus && event.target !== owner.printFocus()) printFocus = null;
	};
	const beforePrint = () => {
		const pass = current.ticket();
		if (!owner.active() || !pass.current()) return;
		printFocus = null;
		if (doc.activeElement instanceof view.HTMLElement) owner.printFocus(doc.activeElement);
		for (const [root, output] of printAnswers) {
			pass.call(() => {
				output.textContent = root.querySelector("textarea")?.value ?? "";
			});
			if (!pass.current()) return;
		}
	};
	const afterPrint = () => {
		const pass = current.ticket();
		if (!owner.active() || !pass.current()) return;
		for (const output of printAnswers.values()) {
			pass.call(() => {
				output.textContent = "";
			});
			if (!pass.current()) return;
		}
		const target = owner.printFocus();
		if (target?.isConnected && !target.hidden && doc.activeElement === doc.body)
			pass.call(() => target.focus({ preventScroll: true }));
		printFocus = null;
	};
	for (const link of nativeLinks) link.addEventListener("click", nativeForward);
	view.addEventListener("praxity:active-page-change", syncGate);
	for (const root of doc.querySelectorAll<HTMLElement>("[data-self-check]")) {
		const answer = root.querySelector("textarea");
		if (!answer) continue;
		const output = doc.createElement("div");
		output.dataset.selfCheckPrintAnswer = "";
		answer.after(output);
		printAnswers.set(root, output);
	}
	view.addEventListener("beforeprint", beforePrint);
	view.addEventListener("afterprint", afterPrint);
	doc.addEventListener("focusin", printFocusChanged);
	return attachment;
}
function documentOwner(doc: Document) {
	const owner = selfCheckDocument(doc);
	owner.attach(() => createDocumentAttachment(doc, owner));
	return owner;
}
export function selfCheckRuntime(doc: Document): SelfCheckRuntime {
	return documentOwner(doc).current;
}
export function mountSelfCheckRuntime(
	doc: Document,
	listener: (runtime?: SelfCheckRuntime) => void,
) {
	return documentOwner(doc).mount(listener);
}
export function disposeSelfCheckDocument(doc: Document = document) {
	doc.defaultView?.__praxitySelfCheckDocument?.dispose();
}
