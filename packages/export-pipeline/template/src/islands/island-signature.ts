import { forcedPalette } from "@praxity/shared-blocks/forced-palette";
import {
	readLearnerBlockState,
	writeLearnerBlockState,
} from "@praxity/shared-blocks/learner-block-state";
import {
	dispatchSelfCheckEvent,
	selfCheckEpochTicket,
	setSelfCheckTimeout,
	shouldAttachIslandAutomatically,
} from "@praxity/shared-blocks/self-check-consumers";

const MIN_WIDTH = 1.5;
const MAX_WIDTH = 5;
const SPEED_THIN = 1.5;

type SignatureMethod = "draw" | "type";
type Point = { x: number; y: number };
type SignatureBlockState = {
	completed: boolean;
	method: SignatureMethod;
	typedValue: string;
};

function readRestoredSignatureState(blockId: string): SignatureBlockState | undefined {
	if (!blockId) return undefined;
	const state = readLearnerBlockState(blockId);
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const method = (state as { method?: unknown }).method;
	if (method !== "draw" && method !== "type") return undefined;
	const typedValue = (state as { typedValue?: unknown }).typedValue;
	if (typeof typedValue !== "string") return undefined;
	const completed = (state as { completed?: unknown }).completed;
	return {
		completed: completed === true && method === "type" && typedValue.length > 0,
		method,
		typedValue: method === "type" ? typedValue : "",
	};
}

function enhanceSignatureRoot(root: HTMLElement): () => void {
	const mounted = selfCheckEpochTicket(root.ownerDocument);
	if (root.dataset.signatureEnhanced === "true") return () => {};
	const signature = root.querySelector<HTMLElement>(":scope > .praxity-signature");
	const canvas = signature?.querySelector<HTMLCanvasElement>(".praxity-signature-canvas");
	const input = signature?.querySelector<HTMLInputElement>(".praxity-signature-typed-input");
	const tabs = Array.from(signature?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
	const panels = Array.from(
		signature?.querySelectorAll<HTMLElement>("[data-signature-panel]") ?? [],
	);
	const clearButtons = Array.from(
		signature?.querySelectorAll<HTMLButtonElement>("[data-signature-clear]") ?? [],
	);
	const statuses = Array.from(
		signature?.querySelectorAll<HTMLElement>("[data-signature-status]") ?? [],
	);
	const lockReason = signature?.querySelector<HTMLElement>("[data-signature-lock-reason]");
	if (!signature || !canvas || !input || tabs.length !== 2 || panels.length !== 2) return () => {};

	const blockId = root.dataset.blockId?.trim() ?? "";
	const restored = readRestoredSignatureState(blockId);
	let activeMethod: SignatureMethod =
		restored?.method ?? (signature.dataset.initialMethod === "type" ? "type" : "draw");
	let signed = restored?.completed ?? signature.dataset.signed === "true";
	let focusMethod = activeMethod;
	if (restored) input.value = restored.typedValue;
	let completedTimer: ReturnType<typeof setSelfCheckTimeout> | undefined;
	let completionGeneration = 0;
	let disposed = false;
	let drawing = false;
	let pointerId: number | undefined;
	let lastPoint: Point | undefined;
	let previousPoint: Point | undefined;
	let lastTime = 0;
	let lastWidth = MAX_WIDTH;
	let strokeColor = "#111827";
	const cleanups: Array<() => void> = [];

	const setStatus = (text?: string) => {
		for (const status of statuses) {
			status.textContent = text ?? status.dataset.sublabel ?? "";
		}
	};
	const cancelCompletionTimer = () => {
		++completionGeneration;
		if (completedTimer !== undefined) clearTimeout(completedTimer);
		completedTimer = undefined;
	};
	const scheduleCompletionTime = (current: () => boolean) => {
		cancelCompletionTimer();
		const generation = completionGeneration;
		completedTimer = setSelfCheckTimeout(
			() => {
				if (disposed || generation !== completionGeneration || !current()) return;
				const locale = document.documentElement.lang || undefined;
				const date = new Date().toLocaleString(locale, {
					dateStyle: "medium",
					timeStyle: "short",
				});
				setStatus((signature.dataset.signedAtTemplate ?? "{date}").replaceAll("{date}", date));
			},
			1500,
			current,
		);
	};
	const persist = (current: () => boolean) => {
		if (!blockId) return;
		writeLearnerBlockState(
			blockId,
			{
				completed: signed,
				method: activeMethod,
				typedValue: input.value,
			} satisfies SignatureBlockState,
			current,
		);
	};
	const syncSignedState = () => {
		root.dataset.signed = String(signed);
		root.dataset.completed = String(signed);
		root.dataset.attempted = String(signed);
		signature.dataset.signed = String(signed);
		signature.dataset.completed = String(signed);
		for (const tab of tabs) {
			tab.classList.toggle("praxity-signature-tab-disabled", signed);
			if (signed) {
				tab.setAttribute("aria-disabled", "true");
				if (lockReason) tab.setAttribute("aria-describedby", lockReason.id);
			} else {
				tab.removeAttribute("aria-disabled");
				tab.removeAttribute("aria-describedby");
			}
			tab.tabIndex = tab === tabs[focusMethod === "draw" ? 0 : 1] ? 0 : -1;
		}
		if (lockReason) lockReason.hidden = !signed;
		for (const button of clearButtons) button.hidden = !signed;
		canvas.setAttribute(
			"aria-label",
			signed
				? (signature.dataset.signedLabel ?? canvas.getAttribute("aria-label") ?? "")
				: (signature.dataset.drawLabel ?? canvas.getAttribute("aria-label") ?? ""),
		);
	};
	const setSigned = (next: boolean, announceInteraction = false) => {
		const current = selfCheckEpochTicket(root.ownerDocument);
		const transitioned = !signed && next;
		if (signed !== next) focusMethod = activeMethod;
		signed = next;
		if (!signed) {
			cancelCompletionTimer();
			setStatus();
		}
		syncSignedState();
		if (transitioned && announceInteraction) {
			dispatchSelfCheckEvent(
				new CustomEvent("praxity:block-interaction", {
					detail: { blockId: root.dataset.blockId, blockType: "signature" },
				}),
				current,
				document,
			);
		}
	};
	const selectMethod = (method: SignatureMethod, moveFocus = false, shouldPersist = false) => {
		const current = selfCheckEpochTicket(root.ownerDocument);
		if (signed) return;
		activeMethod = method;
		focusMethod = method;
		const panelId = panels.find((panel) => panel.dataset.signaturePanel === method)?.id;
		for (const tab of tabs) {
			const selected = tab.getAttribute("aria-controls") === panelId;
			tab.setAttribute("aria-selected", String(selected));
			tab.tabIndex = selected ? 0 : -1;
			if (selected && moveFocus) tab.focus();
		}
		for (const panel of panels) panel.hidden = panel.dataset.signaturePanel !== method;
		if (shouldPersist) persist(current);
	};
	const clear = () => {
		const current = selfCheckEpochTicket(root.ownerDocument);
		drawing = false;
		pointerId = undefined;
		lastPoint = undefined;
		previousPoint = undefined;
		input.value = "";
		canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
		setSigned(false);
		persist(current);
		(activeMethod === "type" ? input : canvas).focus();
	};

	for (const [index, tab] of tabs.entries()) {
		const method = index === 0 ? "draw" : "type";
		const click = () => {
			if (!signed) selectMethod(method, false, true);
		};
		const keydown = (event: KeyboardEvent) => {
			let next: SignatureMethod | undefined;
			if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
				next = method === "draw" ? "type" : "draw";
			} else if (event.key === "Home") {
				next = "draw";
			} else if (event.key === "End") {
				next = "type";
			}
			if (!next) return;
			event.preventDefault();
			if (signed) {
				// Inspect locked methods without selecting a different panel or saving state.
				focusMethod = next;
				syncSignedState();
				tabs[next === "draw" ? 0 : 1].focus();
			} else {
				selectMethod(next, true, true);
			}
		};
		tab.addEventListener("click", click);
		tab.addEventListener("keydown", keydown);
		cleanups.push(() => tab.removeEventListener("click", click));
		cleanups.push(() => tab.removeEventListener("keydown", keydown));
	}

	const getPoint = (event: PointerEvent): Point => {
		const rect = canvas.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left) * (rect.width ? canvas.width / rect.width : 1),
			y: (event.clientY - rect.top) * (rect.height ? canvas.height / rect.height : 1),
		};
	};
	const pointerDown = (event: PointerEvent) => {
		if (drawing || (event.pointerType === "mouse" && event.button !== 0)) return;
		const context = canvas.getContext("2d");
		if (!context) return;
		const computed = getComputedStyle(canvas);
		const forcedColors = forcedPalette();
		strokeColor = forcedColors
			? computed.color
			: computed.getPropertyValue("--praxity-color-text").trim() || computed.color;
		const point = getPoint(event);
		context.fillStyle = strokeColor;
		context.beginPath();
		context.arc(point.x, point.y, MAX_WIDTH / 2, 0, Math.PI * 2);
		context.fill();
		drawing = true;
		pointerId = event.pointerId;
		lastPoint = point;
		previousPoint = point;
		lastTime = performance.now();
		lastWidth = MAX_WIDTH;
		canvas.setPointerCapture?.(event.pointerId);
		setSigned(true, true);
	};
	const pointerMove = (event: PointerEvent) => {
		if (!drawing || !lastPoint || (pointerId !== undefined && event.pointerId !== pointerId))
			return;
		const context = canvas.getContext("2d");
		if (!context) return;
		const point = getPoint(event);
		const now = performance.now();
		const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
		const targetWidth = Math.max(
			MIN_WIDTH,
			MAX_WIDTH - (distance / Math.max(now - lastTime, 1) / SPEED_THIN) * (MAX_WIDTH - MIN_WIDTH),
		);
		lastWidth += (targetWidth - lastWidth) * 0.15;
		const previous = previousPoint ?? lastPoint;
		const midpoint = { x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2 };
		context.strokeStyle = strokeColor;
		context.lineWidth = lastWidth;
		context.lineCap = "round";
		context.lineJoin = "round";
		context.beginPath();
		context.moveTo(lastPoint.x, lastPoint.y);
		context.quadraticCurveTo(previous.x, previous.y, midpoint.x, midpoint.y);
		context.stroke();
		previousPoint = point;
		lastPoint = midpoint;
		lastTime = now;
	};
	const pointerUp = (event: PointerEvent) => {
		const current = selfCheckEpochTicket(root.ownerDocument);
		if (!drawing || (pointerId !== undefined && event.pointerId !== pointerId)) return;
		drawing = false;
		lastPoint = undefined;
		previousPoint = undefined;
		pointerId = undefined;
		scheduleCompletionTime(current);
		persist(current);
	};
	const canvasKeydown = (event: KeyboardEvent) => {
		if (signed || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		selectMethod("type", false, true);
		input.focus();
	};
	const inputChanged = () => {
		const current = selfCheckEpochTicket(root.ownerDocument);
		const hasValue = input.value.length > 0;
		setSigned(hasValue, hasValue);
		if (hasValue) scheduleCompletionTime(current);
		persist(current);
	};

	canvas.addEventListener("pointerdown", pointerDown);
	document.addEventListener("pointermove", pointerMove);
	document.addEventListener("pointerup", pointerUp);
	document.addEventListener("pointercancel", pointerUp);
	canvas.addEventListener("keydown", canvasKeydown);
	input.addEventListener("input", inputChanged);
	for (const button of clearButtons) button.addEventListener("click", clear);
	cleanups.push(() => canvas.removeEventListener("pointerdown", pointerDown));
	cleanups.push(() => document.removeEventListener("pointermove", pointerMove));
	cleanups.push(() => document.removeEventListener("pointerup", pointerUp));
	cleanups.push(() => document.removeEventListener("pointercancel", pointerUp));
	cleanups.push(() => canvas.removeEventListener("keydown", canvasKeydown));
	cleanups.push(() => input.removeEventListener("input", inputChanged));
	cleanups.push(() => clearButtons.forEach((button) => button.removeEventListener("click", clear)));

	// Restore the selected panel before applying its signed lock.
	const restoredSigned = signed;
	signed = false;
	selectMethod(activeMethod);
	signed = restoredSigned;
	syncSignedState();
	if (signed && !restored) {
		setStatus(signature.dataset.signedLabel);
		scheduleCompletionTime(mounted);
	}
	root.dataset.signatureEnhanced = "true";
	root.setAttribute("data-hydrated", "");
	return () => {
		disposed = true;
		cancelCompletionTimer();
		cleanups.forEach((cleanup) => cleanup());
		delete root.dataset.signatureEnhanced;
	};
}

export function initSignatureEnhancements(scope: ParentNode = document): () => void {
	const cleanups = Array.from(scope.querySelectorAll<HTMLElement>('[data-island="signature"]')).map(
		enhanceSignatureRoot,
	);
	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}

export { initSignatureEnhancements as attachIsland };

if (shouldAttachIslandAutomatically()) initSignatureEnhancements();
