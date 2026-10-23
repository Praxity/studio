import type {
	PreviewCompileDiagnostic,
	PreviewDraftRender,
	PreviewHtmlFragment,
	PreviewNodeRender,
	PreviewPatch,
} from "@praxity/shared-blocks/course-preview-protocol";
import { findEditorShortcut } from "../shortcuts/registry";
import { createEscapeDispatcher } from "./escape";
import { listenFrameMessages, listenPrivatePort } from "./listeners";
import { mountPageLens } from "./page-lens";
import { createFramePatcher, type DraftGesture } from "./patch";
import {
	checkedOrigin,
	type FrameCommandBody,
	type FrameEventBody,
	type FrameFocus,
	type FrameFocusOptions,
	type FrameIdentity,
	type FrameView,
	isFrameCommand,
	isFrameEvent,
	isFrameView,
	isPresentationEvent,
} from "./protocol";

const FOCUS_TIMEOUT_MS = 5000;

export function startInspectionFrame(
	options: FrameIdentity & { window: Window; parentOrigin: string },
) {
	const { window: frameWindow, channel, pageId } = options;
	if (new URL(frameWindow.location.href).searchParams.get("praxity-inspect") !== "1") return null;
	const origin = checkedOrigin(options.parentOrigin);
	let lens: ReturnType<typeof mountPageLens> | null = null;
	let patcher: ReturnType<typeof createFramePatcher> | null = null;
	const paints = new Set<number>();
	const height = () =>
		emit({ event: "height", height: Math.ceil(frameWindow.document.body.scrollHeight) });
	const painted = (seq: number, draft = false) => {
		const first = frameWindow.requestAnimationFrame(() => {
			paints.delete(first);
			const second = frameWindow.requestAnimationFrame(() => {
				paints.delete(second);
				height();
				emit({ event: "painted", seq, draft });
			});
			paints.add(second);
		});
		paints.add(first);
	};
	let focusRetry: number | undefined;
	let focusRetryTask: ReturnType<typeof setTimeout> | undefined;
	let presenting = true;
	let presentationId = 0;
	let focusGeneration = 0;
	const cancelFocus = () => {
		focusGeneration++;
		if (focusRetry !== undefined) frameWindow.cancelAnimationFrame(focusRetry);
		clearTimeout(focusRetryTask);
		focusRetry = undefined;
		focusRetryTask = undefined;
	};
	// Every event after `ready` travels on this private port, never as a window message.
	const keys = new MessageChannel();
	const emit = (event: FrameEventBody) => {
		if (!presenting && isPresentationEvent(event)) return;
		const message = {
			source: "praxity-frame",
			version: 1,
			channel,
			pageId,
			...event,
			...(isPresentationEvent(event) ? { presentationId } : {}),
		};
		if (event.event === "ready") frameWindow.parent.postMessage(message, origin, [keys.port2]);
		else keys.port1.postMessage(message);
	};
	const receive = (event: MessageEvent) => {
		if (!isFrameCommand(event.data, options)) return;
		const command = event.data;
		switch (command.action) {
			case "suspend":
				presenting = false;
				cancelFocus();
				lens?.suspend();
				// Port order releases native focus even if an earlier focus command just landed.
				if (frameWindow.document.hasFocus()) frameWindow.parent.focus();
				// WebKit needs the child root inert as well as the host iframe.
				// The nonce CSP keeps course scripts from clearing or replacing this root.
				frameWindow.document.documentElement.inert = true;
				break;
			case "resume":
			case "render":
				if (command.action === "resume") {
					cancelFocus();
					presentationId = command.presentationId;
					presenting = true;
					frameWindow.document.documentElement.inert = false;
					lens?.suspend();
				}
				if (lens) {
					if (command.action === "resume") lens.resume(command.view);
					else lens.render(command.view);
				} else {
					lens = mountPageLens({
						document: frameWindow.document,
						view: command.view,
						onEvent: emit,
						presenting,
					});
					patcher = createFramePatcher({
						document: frameWindow.document,
						pageId,
						lens,
						onFeedback: (feedback) => emit({ event: "renderFeedback", feedback }),
					});
				}
				height();
				break;
			case "patch":
				patcher?.patch(command.patch, command.documentRegions);
				painted(command.patch.seq);
				break;
			case "nodes":
				patcher?.nodes(command.render);
				painted(command.render.seq);
				break;
			case "beginDraft":
				patcher?.beginDraft(command.request);
				break;
			case "draft":
				patcher?.draft(command.render, command.epoch);
				painted(command.render.seq, true);
				break;
			case "draftEpoch":
				patcher?.resetDraftEpoch(command.epoch);
				break;
			case "compileFailed":
				patcher?.failed({ seq: command.seq, pageId, diagnostics: command.diagnostics });
				break;
			case "focus": {
				if (!presenting) break;
				// A newer focus supersedes the old one, which the host has already settled.
				cancelFocus();
				const generation = focusGeneration;
				const report = (success: boolean) => {
					emit({
						event: "focusResult",
						focus: command.target,
						success,
						requestId: command.requestId,
					});
					if (!success && !command.preserveFocus && !command.expect)
						emit({ event: "missing", nodeIds: [command.target.nodeId] });
				};
				const expires = frameWindow.performance.now() + FOCUS_TIMEOUT_MS;
				let hadFocus = frameWindow.document.hasFocus();
				const initialActiveElement = frameWindow.document.activeElement;
				const attempt = () => {
					if (generation !== focusGeneration) return;
					const success = lens?.focus(command.target, command) ?? false;
					if (success || command.preserveFocus || command.expect || !lens?.canFocus(command.target))
						report(success);
					else {
						// WebKit may refuse an available control across several frame-entry paints.
						focusRetry = frameWindow.requestAnimationFrame(() => {
							if (generation !== focusGeneration) return;
							focusRetryTask = setTimeout(() => {
								if (generation !== focusGeneration) return;
								const hasFocus = frameWindow.document.hasFocus();
								if (
									(hadFocus && !hasFocus) ||
									frameWindow.document.activeElement !== initialActiveElement ||
									frameWindow.performance.now() >= expires
								)
									report(false);
								else {
									hadFocus ||= hasFocus;
									attempt();
								}
							}, 0);
						});
					}
				};
				attempt();
				break;
			}
			case "refresh":
				lens?.refresh();
				break;
		}
	};
	// Commands arrive only on the port the host admitted, never as window messages.
	const removeCommands = listenPrivatePort(keys.port1, receive);
	const unloading = () => emit({ event: "unloading" });
	frameWindow.addEventListener("pagehide", unloading);
	// A document still waiting for subresources may leave without pagehide.
	const beforeUnload = () => {
		if (frameWindow.document.readyState !== "complete") unloading();
	};
	frameWindow.addEventListener("beforeunload", beforeUnload);
	emit({ event: "ready" });
	return {
		dispose() {
			frameWindow.removeEventListener("pagehide", unloading);
			frameWindow.removeEventListener("beforeunload", beforeUnload);
			cancelFocus();
			removeCommands();
			keys.port1.close();
			keys.port2.close();
			for (const paint of paints) frameWindow.cancelAnimationFrame(paint);
			patcher?.dispose();
			lens?.dispose();
		},
	};
}

/** Retained by the editor shell across frame loads; the session owns view and focus. */
export function connectPageFrame(
	options: FrameIdentity & {
		window: Window;
		frame: HTMLIFrameElement;
		frameOrigin: string;
		view: FrameView;
		onEvent: (event: FrameEventBody) => void;
		onEscape?: (command: { type: "escape" }) => boolean;
	},
) {
	// "null" describes the sandboxed realm; it is never an identity. Admission
	// still requires the current WindowProxy, fresh channel and one private port.
	const origin = options.frameOrigin === "null" ? "null" : checkedOrigin(options.frameOrigin);
	let identity: FrameIdentity = { channel: options.channel, pageId: options.pageId };
	let view = structuredClone(options.view);
	if (!isFrameView(view) || view.pageId !== options.pageId) throw new Error("Invalid frame view");
	let connected = false;
	let queued: FrameCommandBody[] = [];
	let keyPort: MessagePort | null = null;
	let removePort: (() => void) | null = null;
	let restoreAfterSwap = false;
	let presenting = true;
	let presentationId = 0;
	let focusSequence = 0;
	let pendingFocus: FrameFocus | null = null;
	let focusRequest:
		| (FrameFocusOptions & {
				requestId: number;
				target: FrameFocus;
				opener: Element | null;
				resolve: (success: boolean) => void;
				timer: ReturnType<typeof setTimeout>;
		  })
		| null = null;
	const finishFocus = (success: boolean) => {
		const request = focusRequest;
		focusRequest = null;
		pendingFocus = null;
		if (request) {
			clearTimeout(request.timer);
			request.resolve(success);
		}
	};
	// Only the admitted document holds the other end. A window message would reach
	// whatever document the frame navigated to.
	const send = (command: FrameCommandBody) =>
		keyPort?.postMessage({
			source: "praxity-editor",
			version: 1,
			channel: identity.channel,
			pageId: options.pageId,
			...command,
		});
	const receive = (event: MessageEvent) => {
		if (!isFrameEvent(event.data, identity)) return;
		const message = event.data;
		// Only the private bridge port carries editor authority. A correctly
		// shaped postMessage from the authentic course window is insufficient.
		if (message.event !== "ready") return;
		if (message.event === "ready") {
			if (connected || event.ports.length !== 1) return;
			connected = true;
			keyPort = event.ports[0] ?? null;
			if (keyPort) {
				removePort = listenPrivatePort(keyPort, (captured: MessageEvent) => {
					if (!isFrameEvent(captured.data, identity)) return;
					const command = captured.data;
					if (
						isPresentationEvent(command) &&
						(!presenting ||
							!("presentationId" in command) ||
							command.presentationId !== presentationId)
					)
						return;
					if (command.event === "focusResult") {
						if (
							focusRequest &&
							command.requestId === focusRequest.requestId &&
							command.focus.file === focusRequest.target.file &&
							command.focus.nodeId === focusRequest.target.nodeId &&
							command.focus.role === focusRequest.target.role
						)
							finishFocus(
								command.success && options.window.document.activeElement === options.frame,
							);
						return;
					}
					if (command.event === "region") {
						if (options.window.document.activeElement !== options.frame) return;
						const entry = findEditorShortcut(command.key, "global", view.platform ?? "windows");
						if (entry?.action !== (command.direction === 1 ? "nextRegion" : "previousRegion"))
							return;
					} else if (command.event === "shortcut") {
						if (options.window.document.activeElement !== options.frame) return;
						const focused = command.focus;
						if (
							focused.role !== "handle" ||
							focused.file !== view.file ||
							view.focus?.role !== "handle" ||
							view.focus.nodeId !== focused.nodeId ||
							!view.nodes.some((node) => node.id === focused.nodeId)
						)
							return;
						const entry = findEditorShortcut(command.key, "handle", view.platform ?? "windows");
						if (entry?.context !== "handle" || entry.action !== command.action) return;
					} else if (command.event === "sourceChanged" || command.event === "sourceAction") {
						if (
							(command.event === "sourceAction" &&
								options.window.document.activeElement !== options.frame) ||
							view.readOnly ||
							command.draftId !== view.source?.draftId ||
							command.focus.file !== view.file ||
							command.focus.nodeId !== view.source.nodeId ||
							(command.event === "sourceAction" &&
								(view.focus?.role !== "source" || view.focus.nodeId !== command.focus.nodeId))
						)
							return;
						if (command.event === "sourceAction") {
							const entry = findEditorShortcut(command.key, "field", view.platform ?? "windows");
							if (entry?.context !== "field" || entry.action !== command.action) return;
						}
					} else if (command.event === "ready") return;
					if (
						"finalInput" in command &&
						command.finalInput &&
						(view.readOnly || command.finalInput.draftId !== view.source?.draftId)
					) {
						const { finalInput: _retired, ...action } = command;
						options.onEvent(action);
					} else options.onEvent(command);
				});
			}
			if (!presenting) send({ action: "suspend" });
			send(
				presenting && presentationId > 0
					? { action: "resume", view, presentationId }
					: { action: "render", view },
			);
			for (const command of queued) send(command);
			queued = [];
			const target = pendingFocus ?? (restoreAfterSwap ? view.focus : null);
			if (
				target &&
				(options.window.document.activeElement === options.frame ||
					(focusRequest && options.window.document.activeElement === focusRequest.opener))
			)
				send({
					action: "focus",
					target,
					requestId: focusRequest?.requestId ?? ++focusSequence,
					...(focusRequest?.preserveFocus ? { preserveFocus: true } : {}),
					...(focusRequest?.expect ? { expect: focusRequest.expect } : {}),
				});
			else if (focusRequest) finishFocus(false);
			pendingFocus = null;
			restoreAfterSwap = false;
		}
		options.onEvent(message);
	};
	const escapeDispatcher = options.onEscape
		? createEscapeDispatcher((command) => presenting && options.onEscape?.(command) === true)
		: null;
	escapeDispatcher?.attach(options.window.document);
	const removeMessages = listenFrameMessages(
		options.window,
		origin,
		() => options.frame.contentWindow,
		receive,
	);
	return {
		patch(patch: PreviewPatch, documentRegions: PreviewHtmlFragment[] = []) {
			dispatch({ action: "patch", patch, documentRegions });
		},
		nodes(render: PreviewNodeRender) {
			dispatch({ action: "nodes", render });
		},
		beginDraft(request: DraftGesture) {
			dispatch({ action: "beginDraft", request });
		},
		draft(render: PreviewDraftRender, epoch: number) {
			dispatch({ action: "draft", render, epoch });
		},
		resetDraftEpoch(epoch: number) {
			dispatch({ action: "draftEpoch", epoch });
		},
		compileFailed(seq: number, diagnostics: PreviewCompileDiagnostic[]) {
			dispatch({ action: "compileFailed", seq, diagnostics });
		},
		render(next: FrameView) {
			if (!isFrameView(next) || next.pageId !== options.pageId)
				throw new Error("Invalid frame view");
			view = structuredClone(next);
			if (connected) send({ action: "render", view });
		},
		/** Bind a fresh presentation explicitly; data-only renders cannot grant authority. */
		resume(next: FrameView) {
			if (!isFrameView(next) || next.pageId !== options.pageId)
				throw new Error("Invalid frame view");
			view = structuredClone(next);
			finishFocus(false);
			presentationId++;
			presenting = true;
			if (connected) send({ action: "resume", view, presentationId });
		},
		/** End presentation without ending document admission. */
		suspend() {
			presenting = false;
			finishFocus(false);
			restoreAfterSwap = false;
			// Relinquish native frame focus without inventing a controller focus target.
			if (options.window.document.activeElement === options.frame) options.frame.blur();
			if (connected) send({ action: "suspend" });
		},
		focus(target: FrameFocus, focusOptions: FrameFocusOptions = {}): Promise<boolean> {
			finishFocus(false);
			if (!presenting) return Promise.resolve(false);
			const requestId = ++focusSequence;
			const result = new Promise<boolean>((resolve) => {
				focusRequest = {
					requestId,
					target: structuredClone(target),
					opener: options.window.document.activeElement,
					...focusOptions,
					resolve,
					timer: setTimeout(() => finishFocus(false), FOCUS_TIMEOUT_MS),
				};
			});
			if (connected) send({ action: "focus", target, requestId, ...focusOptions });
			else pendingFocus = structuredClone(target);
			return result;
		},
		refresh() {
			if (connected) send({ action: "refresh" });
		},
		prepareSwap() {
			finishFocus(false);
			restoreAfterSwap = presenting && options.window.document.activeElement === options.frame;
			connected = false;
			queued = [];
			removePort?.();
			removePort = null;
			keyPort?.close();
			keyPort = null;
			// A WindowProxy survives navigation. The old document can still queue
			// ready envelopes during a swap, so it must not know the next channel.
			identity = { ...identity, channel: options.window.crypto.randomUUID() };
			return identity.channel;
		},
		dispose() {
			finishFocus(false);
			removePort?.();
			keyPort?.close();
			removeMessages();
			queued = [];
			escapeDispatcher?.dispose();
		},
	};
	function dispatch(command: FrameCommandBody) {
		if (connected) send(command);
		else queued.push(structuredClone(command));
	}
}
