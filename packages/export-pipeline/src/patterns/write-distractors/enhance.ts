import type { getDistractorPresentationStrings } from "@praxity/shared-blocks/i18n/practice-host-strings";
import { captureLearnerBlockState } from "@praxity/shared-blocks/learner-block-state";
import { requestSelfCheckFrame } from "@praxity/shared-blocks/self-check-consumers";
import {
	MAX_ANSWER,
	validateDistractorAnswer,
	type WriteDistractorsRules,
} from "@praxity/shared-blocks/write-distractors-content";
import type {
	createWriteDistractorsSession,
	WriteDistractorsCommand,
	WriteDistractorsReference,
	WriteDistractorsView,
} from "@praxity/shared-blocks/write-distractors-session";
import { loadBrowserModule } from "../../../template/src/island-loader";
import type { SelfCheckLifetime } from "../../../template/src/self-check-document";
import type * as AssetSupport from "../../../template/src/write-distractors-asset";
import type * as DraftSupport from "../../../template/src/write-distractors-draft";
import { privatePracticeState } from "../private-practice-scope";
import { projectDistractorRecovery } from "./recovery";

declare const __PRAXITY_DISTRACTORS_SUPPORT__: string;
declare const __PRAXITY_DISTRACTORS_DRAFT__: string;
declare global {
	interface Window {
		PraxityDistractorsIsland?: { attachIsland(): () => void };
		__praxityDistractorsSupport?: typeof AssetSupport;
		__praxityDistractorsDraft?: typeof DraftSupport;
	}
}

type Session = ReturnType<typeof createWriteDistractorsSession>;
const documents = new WeakMap<Document, { release(): void; consumers: number }>();
// A released mount leaves a native field, but its bytes still belong to that provider.
const nativeScopes = new WeakMap<
	HTMLElement,
	{ provider: SelfCheckLifetime["provider"]; owned: boolean }
>();

/** Controls retain the typed adapter and existing document/provider lifetime. */
export function attachWriteDistractors(doc: Document = document): () => void {
	let mounted = documents.get(doc);
	if (!mounted) {
		const owner = doc.defaultView?.__praxitySelfCheckDocument;
		if (!owner) throw new Error("EWRITEDISTRACTORSDOCUMENT");
		let support: Promise<typeof DraftSupport> | undefined;
		let supportApi: typeof AssetSupport | undefined;
		let attempts = 0,
			supportFailed = false;
		const loadSupport = (retry: boolean) => {
			if (retry && supportFailed) {
				support = undefined;
				supportFailed = false;
				++attempts;
			}
			if (!support) {
				const url = new URL(__PRAXITY_DISTRACTORS_DRAFT__, doc.baseURI);
				const classic = doc.location.protocol === "file:";
				if (attempts && !classic) url.searchParams.set("retry", String(attempts));
				support = loadBrowserModule(url.href, classic, doc)
					.then((value) => {
						const loaded = classic
							? doc.defaultView?.__praxityDistractorsDraft
							: (value as typeof DraftSupport);
						if (!loaded) throw new Error("EWRITEDISTRACTORSSUPPORT");
						return loaded;
					})
					.catch((error) => {
						supportFailed = true;
						throw error;
					});
			}
			return support;
		};
		let checkSupport: Promise<typeof AssetSupport> | undefined;
		let checkFailed = false,
			checkAttempts = 0;
		const loadCheckSupport = (retry: boolean) => {
			if (retry && checkFailed) {
				checkSupport = undefined;
				checkFailed = false;
				++checkAttempts;
			}
			const url = new URL(__PRAXITY_DISTRACTORS_SUPPORT__, doc.baseURI);
			const classic = doc.location.protocol === "file:";
			if (checkAttempts && !classic) url.searchParams.set("retry", String(checkAttempts));
			checkSupport ??= loadBrowserModule(url.href, classic, doc)
				.then((value) => {
					const api =
						doc.location.protocol === "file:"
							? doc.defaultView?.__praxityDistractorsSupport
							: (value as typeof AssetSupport);
					if (!api) throw new Error("EWRITEDISTRACTORSSUPPORT");
					supportApi = api;
					return api;
				})
				.catch((error) => {
					checkFailed = true;
					throw error;
				});
			return checkSupport;
		};
		const roots = [...doc.querySelectorAll<HTMLElement>("[data-write-distractors]")];
		let disposed = false;
		let session: Session | undefined;
		let lifetime: SelfCheckLifetime | undefined;
		const activeLifetime = (
			captured: SelfCheckLifetime | undefined,
		): captured is SelfCheckLifetime =>
			!!captured && !disposed && lifetime === captured && captured.current();
		let starting: Promise<Session | undefined> | undefined;
		let start: (next: SelfCheckLifetime, retry?: boolean) => Promise<Session | undefined>;
		const presentations = new Map<string, WriteDistractorsRules>();
		const dispatch = async (command: WriteDistractorsCommand) => {
			const captured = lifetime;
			if (!activeLifetime(captured) || !owner.isAdmitted()) return;
			const attached = session;
			const active = attached ?? (await start(captured, command.type === "retry"));
			// Startup captures the latest native field once, including an explicit empty edit.
			// Replaying older input events after that capture would reorder the learner's draft.
			if (!attached && command.type === "edit-answer") return;
			if (active && activeLifetime(captured) && active === session) await active.dispatch(command);
			else if (activeLifetime(captured) && (command.type === "check" || command.type === "retry"))
				controls.find((control) => control.blockId === command.blockId)?.unavailable(true);
		};
		const controls = roots.map((root) => {
			const answer = root.querySelector<HTMLTextAreaElement>("[data-distractor-answer]");
			const ui = JSON.parse(root.dataset.distractorStrings ?? "{}") as ReturnType<
				typeof getDistractorPresentationStrings
			>;
			const host = ui,
				activation = ui;
			const blockId = root.dataset.distractorId;
			const baseline = root.querySelector<HTMLElement>("[data-distractor-baseline]");
			const container = root.querySelector<HTMLElement>("[data-distractor-controls]");
			const error = root.querySelector<HTMLElement>("[data-distractor-error]");
			const notice = root.querySelector<HTMLElement>("[data-distractor-notice]");
			const status = root.querySelector<HTMLElement>("[data-distractor-status]");
			if (!answer || !blockId || !baseline || !container || !error || !notice || !status)
				throw new Error("EWRITEDISTRACTORSMARKUP");
			if (answer.getAttribute("aria-describedby") === baseline.id)
				answer.removeAttribute("aria-describedby");
			const button = (label: string, action: string) => {
				const node = doc.createElement("button");
				node.type = "button";
				node.textContent = label;
				node.className = "praxity-button";
				node.dataset.variant = action === "check" ? "filled" : "outline";
				node.dataset.distractorAction = action;
				return node;
			};
			const check = button(ui.check, "check"),
				retry = button(activation.selfCheckRetry, "retry"),
				reset = button(ui.clear, "start-over");
			const destination = doc.createElement("p");
			destination.className = "praxity-text-dimmed";
			destination.dataset.distractorDestination = "";
			destination.textContent = host.practiceDeviceMode;
			const recovery = doc.createElement("div"),
				notSaved = doc.createElement("p");
			recovery.dataset.distractorRecovery = "";
			notSaved.dataset.distractorSave = "";
			notSaved.className = "praxity-text-error";
			notSaved.textContent = host.practiceNotSaved;
			notSaved.hidden = true;
			const resetHint = doc.createElement("p");
			resetHint.id = `${answer.id}-reset-hint`;
			resetHint.className = "praxity-assessment-choice-hint";
			resetHint.textContent = ui.distractorsResetHint;
			reset.setAttribute("aria-describedby", resetHint.id);
			container.append(check, retry, reset);
			container.before(recovery);
			container.after(notice, notSaved, status, resetHint, destination);
			const positionNotice = () => {
				if (recovery.childElementCount > 0) {
					if (notice.nextElementSibling !== recovery) recovery.before(notice);
				} else if (container.nextElementSibling !== notice) container.after(notice);
			};
			const setNoticeText = (text: string) => {
				if (notice.textContent !== text) notice.textContent = text;
			};
			const projectScope = () => {
				const captured = lifetime;
				const { pending, identified } = privatePracticeState(captured?.provider, blockId);
				if (!activeLifetime(captured)) return false;
				destination.textContent = pending
					? host.practiceDeviceMode
					: `${host.practiceDeviceMode} ${identified ? host.practiceIdentifiedScope : host.practiceSharedDeviceScope}`;
				return true;
			};
			let announcement = 0;
			const announce = (text: string) => {
				const id = ++announcement;
				status.textContent = "";
				const captured = lifetime;
				requestSelfCheckFrame(
					() => {
						status.textContent = text;
					},
					() => id === announcement && activeLifetime(captured),
				);
			};
			let resultGesture: SelfCheckLifetime | undefined;
			let suppressedFailure = false;
			const announceResult = (text: string) => {
				announce(`${text}${suppressedFailure ? ` ${host.practiceNotSaved}` : ""}`);
				suppressedFailure = false;
			};
			const dispatchAction = async (command: WriteDistractorsCommand) => {
				if (command.type !== "compare" && command.type !== "start-over") return dispatch(command);
				const captured = lifetime;
				resultGesture = captured;
				suppressedFailure = false;
				try {
					await dispatch(command);
				} finally {
					if (resultGesture === captured) resultGesture = undefined;
				}
			};

			let replayRefusal = false;
			let rebindView = !error.hidden;
			let currentView: WriteDistractorsView | undefined;
			let acceptUnmarkedNative = true;
			let wantsCheck = false;
			let retrying = false;
			let suspendedFocus: HTMLElement | undefined;
			const releaseFocus = () => {
				suspendedFocus = undefined;
				for (const type of ["focusin", "pointerdown", "keydown"])
					doc.removeEventListener(type, focusMoved, true);
			};
			const focusMoved = (event: Event) => {
				if (
					event.type === "focusin" &&
					(event.target === doc.body || event.target === suspendedFocus)
				)
					return;
				releaseFocus();
			};
			const listeners: Array<() => void> = [];
			const bind = (node: HTMLElement, type: string, action: () => void) => {
				const capture = (event: Event) => owner.captureEvent(event, owner.loadTicket());
				const handle = (event: Event) => {
					if (owner.eventTicket(event)?.()) action();
				};
				node.addEventListener(type, capture, true);
				node.addEventListener(type, handle);
				return () => {
					node.removeEventListener(type, capture, true);
					node.removeEventListener(type, handle);
				};
			};
			const listen = (node: HTMLElement, type: string, action: () => void) => {
				listeners.push(bind(node, type, action));
			};
			const input = () => {
				wantsCheck = false;
				replayRefusal = false;
				if (!activeLifetime(lifetime) || !owner.isAdmitted()) {
					answer.setAttribute("data-self-check-edited", "");
					return;
				}
				const captured = lifetime,
					active = session,
					value = answer.value;
				if (active) answer.removeAttribute("data-self-check-edited");
				void dispatch({ type: "edit-answer", blockId, answer: value }).then(() => {
					if (
						activeLifetime(captured) &&
						active === session &&
						active?.read(blockId)?.mount.notSaved
					)
						answer.setAttribute("data-self-check-edited", "");
				});
			};
			listen(answer, "input", input);
			const checkAnswer = () => {
				const captured = lifetime;
				if (!activeLifetime(captured)) return;
				wantsCheck = validateDistractorAnswer(answer.value).ok;
				void dispatch({ type: "check", blockId }).then(() => {
					if (!activeLifetime(captured)) return;
					const error = session?.read(blockId)?.mount.error;
					if (error === "emptyAnswer" || error === "longAnswer") {
						announce(ui.errorsOne);
						answer.focus();
					} else if (session?.read(blockId)?.mount.checkedAnswer) {
						wantsCheck = false;
						announce(host.distractorsAnswerRevealed);
					}
				});
			};
			listen(check, "click", () => {
				if (check.getAttribute("aria-disabled") !== "true") {
					check.focus();
					checkAnswer();
				}
			});
			listen(retry, "click", () => {
				if (retry.getAttribute("aria-disabled") === "true") return;
				retry.focus();
				const captured = lifetime;
				if (
					session &&
					!validateDistractorAnswer(answer.value).ok &&
					!currentView?.mount.restoreWriteHold
				) {
					checkAnswer();
					return;
				}
				retrying = true;
				void dispatch({ type: "retry", blockId })
					.then(() => {
						if (
							activeLifetime(captured) &&
							session &&
							wantsCheck &&
							!session.read(blockId)?.mount.restoreWriteHold &&
							!session.read(blockId)?.notice &&
							!session.read(blockId)?.mount.checkedAnswer
						) {
							check.focus();
							checkAnswer();
						}
					})
					.finally(() => {
						if (!activeLifetime(captured)) return;
						const heldFocus = doc.activeElement === retry;
						retrying = false;
						const current = session?.read(blockId);
						if (current) project(current);
						if (retry.hidden && heldFocus) check.focus();
					});
			});
			listen(reset, "click", () => {
				if (reset.getAttribute("aria-disabled") === "true") return;
				wantsCheck = false;
				const captured = lifetime;
				void dispatchAction({ type: "start-over", blockId }).then(() => {
					if (activeLifetime(captured)) {
						announceResult(ui.cleared);
						answer.focus();
					}
				});
			});
			let revealed: ReturnType<typeof AssetSupport.installDistractorReveal> | undefined;
			const project = (view: WriteDistractorsView) => {
				const focused = doc.activeElement as HTMLElement | null;
				currentView = view;
				acceptUnmarkedNative = false;
				const mount = view.mount;
				if (!projectScope()) return;
				notSaved.hidden = !mount.notSaved;
				// A result gesture composes one live update after its save receipt settles.
				if (view.announcement === "practiceNotSaved" && resultGesture === lifetime)
					suppressedFailure = true;
				else if (view.announcement)
					announce(
						view.announcement === "selfCheckUnavailable"
							? activation.selfCheckUnavailable
							: host[view.announcement],
					);
				const held = mount.restoreWriteHold;
				projectDistractorRecovery(
					recovery,
					held ? mount.recovery : [],
					ui,
					root.lang,
					`${answer.id}-saved`,
				);
				positionNotice();
				// Keep mounted controls and actual focus until current saved-state admission settles.
				if (
					(!mount.readDone && mount.restoreStatus !== "unavailable") ||
					(mount.restoreStatus === "pending" && revealed)
				) {
					revealed?.suspend();
					for (const button of [check, retry, reset]) button.setAttribute("aria-disabled", "true");
					notice.hidden = false;
					setNoticeText(host.practiceRestoring);
					return;
				}
				rebindView = false;
				if (replayRefusal) {
					replayRefusal = false;
					void dispatch({ type: "check", blockId });
					return;
				}
				const ready = mount.readDone || mount.restoreStatus === "unavailable";
				baseline.hidden = true;
				container.hidden = !ready;
				const checked = mount.checkedAnswer && !mount.restoreWriteHold;
				answer.readOnly = checked;
				if (answer.value !== mount.value.answer) answer.value = mount.value.answer;
				check.setAttribute(
					"aria-disabled",
					String(view.loading || checked || mount.restoreWriteHold),
				);
				retry.hidden = !retrying && view.notice !== "selfCheckUnavailable";
				const hadCheckFocus = doc.activeElement === check;
				check.hidden = !retry.hidden;
				if (check.hidden && hadCheckFocus) retry.focus();
				retry.setAttribute(
					"aria-disabled",
					String(view.loading || retrying || mount.restoreStatus === "conflict"),
				);
				reset.hidden = !checked && !mount.restoreWriteHold;
				resetHint.hidden = reset.hidden;
				reset.setAttribute("aria-disabled", "false");
				const presentation = presentations.get(blockId);
				if (checked && presentation && supportApi) {
					revealed ??= supportApi.installDistractorReveal(
						root,
						reset,
						dispatchAction,
						bind,
						announceResult,
						() => {
							const captured = lifetime;
							return () => activeLifetime(captured);
						},
					);
					revealed.project(
						view,
						presentation.firstHalf(),
						mount.value.shown ? presentation.comparison(mount.value.options) : undefined,
					);
				} else {
					revealed?.destroy();
					revealed = undefined;
				}
				const displaced =
					focused && !focused.isConnected
						? focused
						: doc.activeElement === doc.body
							? suspendedFocus
							: undefined;
				releaseFocus();
				if (displaced) {
					const equivalent = displaced.id
						? doc.getElementById(displaced.id)
						: [...root.querySelectorAll<HTMLElement>("[data-distractor-action]")].find(
								(node) => node.dataset.distractorAction === displaced.dataset.distractorAction,
							);
					(equivalent && !equivalent.closest("[hidden]") ? equivalent : answer).focus();
				}
				const answerError =
					mount.error === "emptyAnswer" || mount.error === "longAnswer"
						? ui[mount.error].replace("{max}", String(MAX_ANSWER))
						: "";
				error.hidden = !answerError;
				error.textContent = answerError;
				if (answerError) {
					answer.setAttribute("aria-invalid", "true");
					answer.setAttribute("aria-describedby", error.id);
				} else {
					answer.removeAttribute("aria-invalid");
					answer.removeAttribute("aria-describedby");
				}
				notice.hidden =
					ready && !view.loading && !view.notice && mount.restoreStatus !== "conflict";
				setNoticeText(
					!ready
						? host.practiceRestoring
						: view.loading
							? held
								? host.practiceRestoring
								: host.distractorsLoading
							: view.notice
								? ui[view.notice]
								: mount.restoreStatus === "conflict"
									? activation.selfCheckUnavailable
									: "",
				);
			};
			const pending = (resetIntent = false) => {
				positionNotice();
				baseline.hidden = true;
				const focused = doc.activeElement as HTMLElement | null;
				if (!suspendedFocus && revealed && focused && root.contains(focused)) {
					// Disabling a native select displaces focus. A later learner gesture
					// retires this witness before current admission may restore it.
					suspendedFocus = focused;
					for (const type of ["focusin", "pointerdown", "keydown"])
						doc.addEventListener(type, focusMoved, true);
				}
				// A replacement suspends the former provider's editor until its read settles.
				if (currentView || rebindView) answer.readOnly = true;
				if (resetIntent) {
					wantsCheck = false;
					replayRefusal =
						currentView?.mount.error === "emptyAnswer" || currentView?.mount.error === "longAnswer";
				}
				revealed?.suspend();
				for (const button of [check, retry, reset]) button.setAttribute("aria-disabled", "true");
				notice.hidden = false;
				setNoticeText(host.practiceRestoring);
			};
			return {
				ready() {
					if (!projectScope()) return;
					answer.readOnly = false;
					baseline.hidden = true;
					container.hidden = false;
					answer.removeAttribute("aria-describedby");
					check.hidden = false;
					check.setAttribute("aria-disabled", "false");
					retry.hidden = true;
					reset.hidden = resetHint.hidden = true;
					notice.hidden = true;
					notSaved.hidden = true;
					recovery.replaceChildren();
					positionNotice();
				},
				unavailable(deliberate = false) {
					if (!projectScope()) return;
					positionNotice();
					baseline.hidden = true;
					container.hidden = false;
					check.hidden = true;
					retry.hidden = false;
					if (doc.activeElement === check) retry.focus();
					retry.setAttribute("aria-disabled", "false");
					reset.hidden = resetHint.hidden = true;
					notice.hidden = false;
					setNoticeText(activation.selfCheckUnavailable);
					if (deliberate) announce(activation.selfCheckUnavailable);
				},
				hasNativeDraft() {
					return (
						answer.hasAttribute("data-self-check-edited") ||
						(acceptUnmarkedNative && answer.value !== "")
					);
				},
				needsSession() {
					return replayRefusal || rebindView;
				},
				discardNative() {
					rebindView ||= currentView !== undefined;
					replayRefusal = false;
					currentView = undefined;
					answer.removeAttribute("data-self-check-edited");
					acceptUnmarkedNative = false;
				},
				retainDirtyNative() {
					if (currentView?.mount.notSaved) answer.setAttribute("data-self-check-edited", "");
				},
				root,
				blockId,
				answer,
				project,
				pending,
				destroy() {
					releaseFocus();
					for (const remove of listeners) remove();
					revealed?.destroy();
					container.after(notice);
					destination.remove();
					recovery.remove();
					resetHint.remove();
					notSaved.remove();
					container.replaceChildren();
					container.hidden = true;
					baseline.hidden = false;
					notice.hidden = true;
					status.textContent = "";
					answer.readOnly = false;
					answer.setAttribute("aria-describedby", baseline.id);
				},
				get view() {
					return currentView;
				},
			};
		});
		// Print reads only mounted fields. It never asks the session or asset loader for content.
		const printNodes: HTMLElement[] = [];
		let printFocus: HTMLElement | undefined;
		const clearPrint = (event?: Event) => {
			for (const node of printNodes.splice(0)) node.remove();
			// Print CSS can blur a native field. Later focused controls keep their focus.
			if (event?.type === "afterprint" && doc.activeElement === doc.body && printFocus?.isConnected)
				printFocus.focus({ preventScroll: true });
			if (event) printFocus = undefined;
		};
		const projectPrint = () => {
			printFocus ??= doc.activeElement as HTMLElement;
			clearPrint();
			for (const root of roots)
				for (const field of root.querySelectorAll<
					HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
				>("textarea,input,select")) {
					if (field.closest("[hidden]")) continue;
					const text = doc.createElement("div");
					text.className = "praxity-distractor-print";
					text.textContent =
						field.tagName === "SELECT"
							? field.value
								? ((field as HTMLSelectElement).selectedOptions[0]?.textContent ?? "")
								: ""
							: field.value;
					field.after(text);
					printNodes.push(text);
				}
		};
		const printView = doc.defaultView;
		printView?.addEventListener("beforeprint", projectPrint);
		printView?.addEventListener("afterprint", clearPrint);
		printView?.addEventListener("pagehide", clearPrint);
		const references: WriteDistractorsReference[] = controls.map(({ root, blockId }) => ({
			blockId,
			path: root.dataset.distractorSrc ?? "",
			contentRevision: root.dataset.distractorRevision ?? "",
			count: Number(root.dataset.distractorCount),
			itemIds: JSON.parse(root.dataset.distractorItems ?? "[]"),
		}));
		start = (next, retry = false) => {
			if (!activeLifetime(next) || !owner.isAdmitted()) return Promise.resolve(undefined);
			if (session) return Promise.resolve(session);
			if (starting) return starting;
			for (const control of controls) control.pending();
			starting = loadSupport(retry)
				.then((adapter) => {
					if (!activeLifetime(next) || lifetime !== next) return undefined;
					const active = adapter.createWriteDistractorsSession(references, {
						provider: next.provider,
						current: () => activeLifetime(next),
						deferStart: true,
						async admit(reference, _retry, ticket) {
							const adapter = await loadCheckSupport(_retry);
							if (!activeLifetime(next) || !ticket.current())
								throw new Error("EWRITEDISTRACTORSCANCELLED");
							const rules = await adapter.loadWriteDistractorsAsset(reference, doc);
							if (!activeLifetime(next) || !ticket.current())
								throw new Error("EWRITEDISTRACTORSCANCELLED");
							presentations.set(reference.blockId, rules);
							return rules;
						},
					});
					const nativeDrafts = new Map(
						controls
							.filter((control) => control.hasNativeDraft())
							.map((control) => [control.blockId, control.answer.value]),
					);
					session = active;
					active.subscribe((snapshot, ticket) => {
						if (!activeLifetime(next) || !ticket.current() || active !== session) return;
						for (const control of controls) {
							const view = snapshot.activities.find((view) => view.blockId === control.blockId);
							if (view) control.project(view);
							if (!ticket.current()) return;
						}
					});
					for (const control of controls) {
						if (nativeDrafts.has(control.blockId)) {
							control.answer.removeAttribute("data-self-check-edited");
							void active.dispatch({
								type: "edit-answer",
								blockId: control.blockId,
								answer: nativeDrafts.get(control.blockId) ?? "",
							});
						}
					}
					active.initialize();
					return active;
				})
				.catch(() => {
					if (activeLifetime(next)) for (const control of controls) control.unavailable();
					return undefined;
				})
				.finally(() => {
					if (activeLifetime(next)) starting = undefined;
				});
			return starting;
		};
		const release = owner.observe((next) => {
			if (next) {
				for (const control of controls) {
					const previous = nativeScopes.get(control.root);
					if (
						previous &&
						(next.reason === "reset" || (previous.owned && previous.provider !== next.provider))
					)
						control.discardNative();
					nativeScopes.set(control.root, {
						provider: next.provider,
						owned: previous?.owned === true || next.provider !== undefined,
					});
				}
			} else for (const control of controls) control.retainDirtyNative();
			if (next === lifetime && (session || starting)) return;
			session?.dispose();
			session = undefined;
			starting = undefined;
			lifetime = next;
			for (const control of controls) control.pending(true);
			if (!activeLifetime(next) || !owner.isAdmitted()) return;
			presentations.clear();
			const access = captureLearnerBlockState(next.provider, next.current);
			let needsSession = false;
			try {
				needsSession = controls.some(
					(control) =>
						access.read(control.blockId, next).value !== undefined ||
						control.answer.hasAttribute("data-self-check-edited") ||
						control.answer.value !== "" ||
						control.needsSession(),
				);
			} catch {
				needsSession = true;
			}
			if (needsSession) void start(next);
			else for (const control of controls) control.ready();
		});
		mounted = {
			consumers: 0,
			release() {
				disposed = true;
				lifetime = undefined;
				starting = undefined;
				release();
				session?.dispose();
				controls.forEach((control) => control.destroy());
				printView?.removeEventListener("beforeprint", projectPrint);
				printView?.removeEventListener("afterprint", clearPrint);
				printView?.removeEventListener("pagehide", clearPrint);
				clearPrint();
			},
		};
		documents.set(doc, mounted);
	}
	mounted.consumers++;
	let released = false;
	const entry = mounted;
	return () => {
		if (released) return;
		released = true;
		if (--entry.consumers) return;
		if (documents.get(doc) === entry) documents.delete(doc);
		entry.release();
	};
}
