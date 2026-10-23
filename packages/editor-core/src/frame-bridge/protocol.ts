import type { FocusTarget } from "@praxity/grammar/src/operations/contract.ts";
import type {
	PreviewCompileDiagnostic,
	PreviewDraftRender,
	PreviewHtmlFragment,
	PreviewNodeRender,
	PreviewPatch,
} from "@praxity/shared-blocks/course-preview-protocol";
import type { FrameShortcutAction } from "../shortcuts/session-commands";
import type { DraftGesture, RenderFeedback } from "./patch";

export type FrameFocus = FocusTarget & { nodeId: string; selection?: readonly [number, number] };
export interface FrameFocusOptions {
	preserveFocus?: true;
	expect?: readonly Pick<FrameFocus, "file" | "nodeId">[];
}
export interface FrameNode {
	id: string;
	kind: "page" | "block" | "item";
	parentId: string | null;
	name: string;
	description: string;
}
/** Host projection of one admitted draft, never learner HTML or a DOM selector. */
export interface FrameSource {
	draftId: string;
	nodeId: string;
	value: string;
	name: string;
	caption: string;
	description?: string;
	closer: boolean;
	baseText?: string;
	diagnostic?: string;
	invalid?: boolean;
}
export interface FrameView {
	file: string;
	pageId: string;
	language: "en" | "fr";
	alwaysShowHandles: boolean;
	platform?: "windows" | "mac";
	escapeEnabled?: boolean;
	/** A page view with no editor controls: learner Tab stops, clicks and hidden content stay as served. */
	readOnly?: boolean;
	nodes: FrameNode[];
	selected: string[];
	expanded: string[];
	focus: FrameFocus | null;
	source?: FrameSource;
}
export interface FrameIdentity {
	channel: string;
	pageId: string;
}
export type FrameKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
export interface FrameSourceInput {
	draftId: string;
	text: string;
	selection: readonly [number, number];
}
export type FrameCommandBody =
	| { action: "render"; view: FrameView }
	| { action: "resume"; view: FrameView; presentationId: number }
	| ({ action: "focus"; target: FrameFocus; requestId: number } & FrameFocusOptions)
	| { action: "suspend" }
	| { action: "patch"; patch: PreviewPatch; documentRegions: PreviewHtmlFragment[] }
	| { action: "nodes"; render: PreviewNodeRender }
	| { action: "beginDraft"; request: DraftGesture }
	| { action: "draft"; render: PreviewDraftRender; epoch: number }
	| { action: "draftEpoch"; epoch: number }
	| { action: "compileFailed"; seq: number; diagnostics: PreviewCompileDiagnostic[] }
	| { action: "refresh" };
type DocumentEventBody =
	| { event: "ready" }
	| { event: "unloading" }
	| { event: "renderFeedback"; feedback: RenderFeedback }
	| { event: "painted"; seq: number; draft: boolean }
	| { event: "height"; height: number };
type PresentationEventBody =
	| { event: "sourceChanged"; draftId: string; focus: FrameFocus; text: string }
	| {
			event: "sourceAction";
			draftId: string;
			focus: FrameFocus;
			action: "commitSource" | "saveSource" | "undoSource";
			key: FrameKey;
			finalInput?: FrameSourceInput;
	  }
	| { event: "focusResult"; focus: FrameFocus; success: boolean; requestId: number }
	| { event: "escape"; finalInput?: FrameSourceInput }
	| { event: "region"; direction: 1 | -1; key: FrameKey }
	| { event: "shortcut"; action: FrameShortcutAction; focus: FrameFocus; key: FrameKey }
	| { event: "focusChanged"; focus: FrameFocus }
	| {
			event: "select";
			focus: FrameFocus;
			mode: "single" | "range" | "toggle";
			finalInput?: FrameSourceInput;
	  }
	| {
			event: "intent";
			intent: "actions" | "source";
			focus: FrameFocus;
			finalInput?: FrameSourceInput;
	  }
	| { event: "navigate"; direction: "previous" | "next" | "start" | "end"; extend: boolean }
	| { event: "missing"; nodeIds: string[] };
export type FrameEventBody = DocumentEventBody | PresentationEventBody;
export function isPresentationEvent(event: { event: string }) {
	return !["ready", "unloading", "height", "renderFeedback", "painted"].includes(event.event);
}
export type FrameCommand = FrameIdentity &
	FrameCommandBody & { source: "praxity-editor"; version: 1 };
export type FrameEvent = FrameIdentity &
	(DocumentEventBody | (PresentationEventBody & { presentationId: number })) & {
		source: "praxity-frame";
		version: 1;
	};

const MAX_NODES = 5000;
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 8192): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= max;
const keys = (value: Record<string, unknown>, expected: string[]) => {
	const actual = Reflect.ownKeys(value);
	return (
		actual.length === expected.length &&
		actual.every((key) => typeof key === "string" && expected.includes(key))
	);
};
const ids = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length <= MAX_NODES &&
	value.every((id) => text(id, 1024)) &&
	new Set(value).size === value.length;
function focus(value: unknown): value is FrameFocus {
	return (
		record(value) &&
		keys(value, [
			"file",
			"nodeId",
			"role",
			...(value.selection === undefined ? [] : ["selection"]),
		]) &&
		text(value.file, 1024) &&
		text(value.nodeId, 1024) &&
		typeof value.role === "string" &&
		(["handle", "source", "outline", "bubble"].includes(value.role) ||
			/^chip:.{1,128}$/u.test(value.role)) &&
		(value.selection === undefined ||
			(Array.isArray(value.selection) &&
				value.selection.length === 2 &&
				value.selection.every((offset) => Number.isSafeInteger(offset) && offset >= 0) &&
				value.selection[1] >= value.selection[0]))
	);
}
export function isFrameView(value: unknown): value is FrameView {
	if (
		!record(value) ||
		!keys(value, [
			"file",
			"pageId",
			"language",
			"alwaysShowHandles",
			...(value.platform === undefined ? [] : ["platform"]),
			...(value.escapeEnabled === undefined ? [] : ["escapeEnabled"]),
			...(value.readOnly === undefined ? [] : ["readOnly"]),
			"nodes",
			"selected",
			"expanded",
			"focus",
			...(value.source === undefined ? [] : ["source"]),
		]) ||
		!text(value.file, 1024) ||
		!text(value.pageId, 1024) ||
		(value.language !== "en" && value.language !== "fr") ||
		typeof value.alwaysShowHandles !== "boolean" ||
		(value.platform !== undefined && value.platform !== "windows" && value.platform !== "mac") ||
		(value.escapeEnabled !== undefined && typeof value.escapeEnabled !== "boolean") ||
		(value.readOnly !== undefined && typeof value.readOnly !== "boolean") ||
		!Array.isArray(value.nodes) ||
		value.nodes.length > MAX_NODES ||
		!ids(value.selected) ||
		!ids(value.expanded) ||
		(value.focus !== null && !focus(value.focus))
	)
		return false;
	const known = new Set<string>();
	for (const node of value.nodes) {
		if (
			!record(node) ||
			!keys(node, ["id", "kind", "parentId", "name", "description"]) ||
			!text(node.id, 1024) ||
			typeof node.kind !== "string" ||
			!["page", "block", "item"].includes(node.kind) ||
			!text(node.name) ||
			!text(node.description) ||
			known.has(node.id) ||
			(node.parentId !== null && (typeof node.parentId !== "string" || !known.has(node.parentId)))
		)
			return false;
		known.add(node.id);
	}
	return (
		[...value.selected, ...value.expanded].every((id) => known.has(id)) &&
		(value.source === undefined ||
			(value.readOnly !== true &&
				record(value.source) &&
				keys(value.source, [
					"draftId",
					"nodeId",
					"value",
					"name",
					"caption",
					"closer",
					...(value.source.description === undefined ? [] : ["description"]),
					...(value.source.baseText === undefined ? [] : ["baseText"]),
					...(value.source.diagnostic === undefined ? [] : ["diagnostic"]),
					...(value.source.invalid === undefined ? [] : ["invalid"]),
				]) &&
				(value.source.baseText === undefined ||
					(typeof value.source.baseText === "string" &&
						value.source.baseText.length <= 10_000_000)) &&
				(value.source.diagnostic === undefined || text(value.source.diagnostic)) &&
				(value.source.description === undefined || text(value.source.description)) &&
				(value.source.invalid === undefined || typeof value.source.invalid === "boolean") &&
				text(value.source.draftId, 1024) &&
				text(value.source.nodeId, 1024) &&
				known.has(value.source.nodeId) &&
				typeof value.source.value === "string" &&
				value.source.value.length <= 10_000_000 &&
				text(value.source.name) &&
				text(value.source.caption) &&
				typeof value.source.closer === "boolean")) &&
		(value.focus === null || (value.focus.file === value.file && known.has(value.focus.nodeId)))
	);
}
function envelope(
	value: unknown,
	identity: FrameIdentity,
	source: string,
): value is Record<string, unknown> {
	return (
		record(value) &&
		value.version === 1 &&
		value.source === source &&
		value.channel === identity.channel &&
		value.pageId === identity.pageId
	);
}
const commandKeys = (value: Record<string, unknown>, fields: string[]) =>
	keys(value, ["source", "version", "channel", "pageId", "action", ...fields]);
const eventKeys = (value: Record<string, unknown>, fields: string[]) => {
	const presentation = isPresentationEvent({ event: String(value.event) });
	const capturesInput = ["escape", "sourceAction", "select", "intent"].includes(
		String(value.event),
	);
	return (
		(!presentation || sequence(value.presentationId)) &&
		(!capturesInput || value.finalInput === undefined || sourceInput(value.finalInput)) &&
		keys(value, [
			"source",
			"version",
			"channel",
			"pageId",
			"event",
			...fields,
			...(capturesInput && value.finalInput !== undefined ? ["finalInput"] : []),
			...(presentation ? ["presentationId"] : []),
		])
	);
};
function sourceInput(value: unknown): value is FrameSourceInput {
	if (!record(value) || typeof value.text !== "string") return false;
	const length = value.text.length;
	return (
		keys(value, ["draftId", "text", "selection"]) &&
		text(value.draftId, 1024) &&
		length <= 10_000_000 &&
		Array.isArray(value.selection) &&
		value.selection.length === 2 &&
		value.selection.every(
			(offset) => Number.isSafeInteger(offset) && offset >= 0 && offset <= length,
		) &&
		value.selection[1] >= value.selection[0]
	);
}
function frameKey(value: unknown): value is FrameKey {
	return (
		record(value) &&
		keys(value, ["key", "ctrlKey", "metaKey", "altKey", "shiftKey"]) &&
		text(value.key, 64) &&
		["ctrlKey", "metaKey", "altKey", "shiftKey"].every(
			(modifier) => typeof value[modifier] === "boolean",
		)
	);
}
const sequence = (value: unknown): value is number =>
	Number.isSafeInteger(value) && Number(value) >= 0;
function fragments(value: unknown): value is PreviewHtmlFragment[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_NODES &&
		value.every(
			(f) =>
				record(f) &&
				keys(f, ["id", "html", ...(f.island === undefined ? [] : ["island"])]) &&
				text(f.id, 1024) &&
				typeof f.html === "string" &&
				f.html.length <= 10_000_000 &&
				(f.island === undefined || text(f.island, 128)),
		) &&
		new Set(value.map((f) => f.id)).size === value.length
	);
}
function render(value: unknown, pageId: string, kind: "nodes" | "draft" | "patch") {
	return (
		record(value) &&
		keys(value, [
			"seq",
			"pageId",
			"fragments",
			...(kind === "draft"
				? ["transactionId", "state"]
				: kind === "patch"
					? ["order", "shellStale"]
					: []),
		]) &&
		sequence(value.seq) &&
		value.pageId === pageId &&
		fragments(value.fragments) &&
		(kind !== "draft" ||
			(text(value.transactionId, 1024) &&
				typeof value.state === "string" &&
				["draft", "saved", "reverted"].includes(value.state))) &&
		(kind !== "patch" || (ids(value.order) && typeof value.shellStale === "boolean"))
	);
}
function diagnostics(value: unknown): value is PreviewCompileDiagnostic[] {
	return (
		Array.isArray(value) &&
		value.length <= MAX_NODES &&
		value.every(
			(d) =>
				record(d) &&
				keys(d, [
					"message",
					...(d.code === undefined ? [] : ["code"]),
					...(d.column === undefined ? [] : ["column"]),
					...(d.span === undefined ? [] : ["span"]),
					...(d.line === undefined ? [] : ["line"]),
					...(d.file === undefined ? [] : ["file"]),
					...(d.messageRef === undefined ? [] : ["messageRef"]),
				]) &&
				text(d.message) &&
				(d.code === undefined || text(d.code, 1024)) &&
				(d.column === undefined || (sequence(d.column) && d.column > 0)) &&
				(d.span === undefined ||
					(record(d.span) &&
						keys(d.span, ["start", "end"]) &&
						sequence(d.span.start) &&
						sequence(d.span.end) &&
						d.span.end >= d.span.start)) &&
				(d.line === undefined || sequence(d.line)) &&
				(d.file === undefined || text(d.file, 1024)) &&
				(d.messageRef === undefined ||
					(record(d.messageRef) &&
						keys(d.messageRef, ["key", "args"]) &&
						text(d.messageRef.key) &&
						record(d.messageRef.args))),
		)
	);
}
function renderFeedback(value: unknown): value is RenderFeedback {
	return (
		record(value) &&
		keys(value, ["nodes", "failure"]) &&
		record(value.nodes) &&
		Object.keys(value.nodes).length <= MAX_NODES &&
		Object.values(value.nodes).every(
			(n) =>
				record(n) &&
				(n.state === "updating"
					? keys(n, ["state"])
					: n.state === "failed" && keys(n, ["state", "message"]) && text(n.message)),
		) &&
		(value.failure === null || diagnostics(value.failure))
	);
}
export function isFrameCommand(value: unknown, identity: FrameIdentity): value is FrameCommand {
	if (!envelope(value, identity, "praxity-editor")) return false;
	switch (value.action) {
		case "patch":
			return (
				commandKeys(value, ["patch", "documentRegions"]) &&
				render(value.patch, identity.pageId, "patch") &&
				fragments(value.documentRegions)
			);
		case "nodes":
			return commandKeys(value, ["render"]) && render(value.render, identity.pageId, "nodes");
		case "draft":
			return (
				commandKeys(value, ["render", "epoch"]) &&
				sequence(value.epoch) &&
				render(value.render, identity.pageId, "draft")
			);
		case "draftEpoch":
			return commandKeys(value, ["epoch"]) && sequence(value.epoch);
		case "beginDraft":
			return (
				commandKeys(value, ["request"]) &&
				record(value.request) &&
				keys(value.request, ["seq", "epoch", "transactionId", "nodeIds"]) &&
				sequence(value.request.seq) &&
				sequence(value.request.epoch) &&
				text(value.request.transactionId, 1024) &&
				ids(value.request.nodeIds)
			);
		case "compileFailed":
			return (
				commandKeys(value, ["seq", "diagnostics"]) &&
				sequence(value.seq) &&
				diagnostics(value.diagnostics)
			);
		case "render":
		case "resume":
			return (
				commandKeys(value, ["view", ...(value.action === "resume" ? ["presentationId"] : [])]) &&
				(value.action !== "resume" || sequence(value.presentationId)) &&
				isFrameView(value.view) &&
				value.view.pageId === identity.pageId
			);
		case "focus":
			return (
				commandKeys(value, [
					"target",
					"requestId",
					...("preserveFocus" in value ? ["preserveFocus"] : []),
					...("expect" in value ? ["expect"] : []),
				]) &&
				(value.preserveFocus === undefined || value.preserveFocus === true) &&
				(value.expect === undefined ||
					(Array.isArray(value.expect) &&
						value.expect.length <= MAX_NODES &&
						value.expect.every(
							(owner) =>
								record(owner) &&
								keys(owner, ["file", "nodeId"]) &&
								text(owner.file, 1024) &&
								text(owner.nodeId, 1024),
						))) &&
				focus(value.target) &&
				sequence(value.requestId)
			);
		case "suspend":
		case "refresh":
			return commandKeys(value, []);
		default:
			return false;
	}
}
export function isFrameEvent(value: unknown, identity: FrameIdentity): value is FrameEvent {
	if (!envelope(value, identity, "praxity-frame")) return false;
	switch (value.event) {
		case "sourceChanged": {
			return (
				eventKeys(value, ["draftId", "focus", "text"]) &&
				focus(value.focus) &&
				value.focus.role === "source" &&
				sourceInput({ draftId: value.draftId, text: value.text, selection: value.focus.selection })
			);
		}
		case "sourceAction":
			return (
				eventKeys(value, ["draftId", "focus", "action", "key"]) &&
				text(value.draftId, 1024) &&
				focus(value.focus) &&
				value.focus.role === "source" &&
				frameKey(value.key) &&
				["commitSource", "saveSource", "undoSource"].includes(String(value.action))
			);
		case "height":
			return eventKeys(value, ["height"]) && sequence(value.height);
		case "renderFeedback":
			return eventKeys(value, ["feedback"]) && renderFeedback(value.feedback);
		case "painted":
			return (
				eventKeys(value, ["seq", "draft"]) &&
				sequence(value.seq) &&
				typeof value.draft === "boolean"
			);
		case "region":
			return (
				eventKeys(value, ["direction", "key"]) &&
				frameKey(value.key) &&
				(value.direction === 1 || value.direction === -1)
			);
		case "shortcut":
			return (
				eventKeys(value, ["action", "focus", "key"]) &&
				focus(value.focus) &&
				frameKey(value.key) &&
				typeof value.action === "string" &&
				["toggle", "selectAll", "moveUp", "moveDown", "delete"].includes(String(value.action))
			);
		case "escape":
		case "ready":
		case "unloading":
			return eventKeys(value, []);
		case "focusChanged":
			return eventKeys(value, ["focus"]) && focus(value.focus);
		case "focusResult":
			return (
				eventKeys(value, ["focus", "success", "requestId"]) &&
				sequence(value.requestId) &&
				focus(value.focus) &&
				typeof value.success === "boolean"
			);
		case "select":
			return (
				eventKeys(value, ["focus", "mode"]) &&
				focus(value.focus) &&
				typeof value.mode === "string" &&
				["single", "range", "toggle"].includes(value.mode)
			);
		case "intent":
			return (
				eventKeys(value, ["focus", "intent"]) &&
				focus(value.focus) &&
				typeof value.intent === "string" &&
				["actions", "source"].includes(value.intent)
			);
		case "navigate":
			return (
				eventKeys(value, ["direction", "extend"]) &&
				typeof value.direction === "string" &&
				["previous", "next", "start", "end"].includes(value.direction) &&
				typeof value.extend === "boolean"
			);
		case "missing":
			return eventKeys(value, ["nodeIds"]) && ids(value.nodeIds);
		default:
			return false;
	}
}
/** The browser editor uses explicit HTTP origins. Opaque/file origins cannot authenticate this bridge. */
export function checkedOrigin(origin: string): string {
	const parsed = new URL(origin);
	if (
		!["http:", "https:"].includes(parsed.protocol) ||
		parsed.origin !== origin ||
		parsed.username ||
		parsed.password
	)
		throw new Error("Frame bridge requires an exact HTTP origin");
	return origin;
}
