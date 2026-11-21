import type { IdentityReadView } from "@praxity/content-identity";
import type {
	FocusTarget,
	IdentityMapping,
	InsertionPoint,
	MessageRef,
	NodeRef,
	OperationDiagnostic,
	OperationFileBase,
	OperationRefusal,
	OperationRequest,
	OperationResult,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";

export type { FocusTarget, OperationRefusal, OperationRequest, OperationResult };
export type AuthorOperationResult =
	| (OperationResult & {
			historyId: string;
			seq?: number;
			correspondence?: IdentityReadView["correspondence"];
	  })
	| OperationRefusal;
export interface HistoryApplyRequest {
	transactionId: string;
	historyId: string;
	direction: "undo" | "redo";
}
export type Lens = "page" | "print" | "playback" | "source";
export interface Message {
	key: string;
	params: Record<string, string | number>;
}
export interface Focus extends Omit<FocusTarget, "role"> {
	role: FocusTarget["role"] | "run-summary" | "menu-item" | "dialog";
	selection?: readonly [number, number];
	control?: string;
}
export type FocusOwner = Pick<Focus, "file" | "nodeId" | "role">;
export interface SelectionNode {
	id: string;
	file: string;
	lessonId: string;
	pageId: string;
	parentId: string | null;
	kind: "block" | "item" | "page";
}
export interface Selection {
	anchor: string | null;
	focus: string | null;
	extended: boolean;
	allScope: "siblings" | "page" | null;
}
export interface SelectionSnapshot {
	selected: string[];
	selection: Selection;
	focus: Focus | null;
}
export interface SelectionDestination {
	target: OperationTarget & { ref: InsertionPoint };
	baseRevision: string;
}
export interface ReviewSuggestion {
	id: string;
	nodeId: string;
	focus: Focus;
}
export interface DraftSeed {
	file: string;
	target: NodeRef | InsertionPoint;
	baseRevision: string;
	expectedText: string;
	editableText: string;
	scope?: "node" | "file";
}
export interface Draft extends DraftSeed {
	id: string;
	baseText: string;
	text: string;
	selection: [number, number];
	generation: number;
	status: "clean" | "dirty" | "invalid" | "held" | "conflict" | "orphaned";
	diagnostics: OperationDiagnostic[];
	changedAt: number;
	validatedGeneration: number;
	persistedGeneration: number;
	persistenceVersion?: number;
	persistedVersion?: number;
	resolutionEpoch?: number;
	outside?: DraftSeed;
}
export interface TargetSnapshot {
	target: OperationTarget;
	revision: string;
	draftId: string | null;
	selection?: {
		targets: OperationTarget[];
		files: OperationFileBase[];
		before: SelectionSnapshot;
	};
}
export interface HelperToken {
	key: string;
	line: string;
	range: readonly [number, number];
	text: string;
}
export interface HelperSnapshot extends HelperToken {
	draftId: string;
	generation: number;
}
export type PopupKind =
	| "actions"
	| "submenu"
	| "insert-slash"
	| "insert"
	| "helper"
	| "completion"
	| "drag";
export type Layer =
	| { kind: "page" }
	| { kind: "selected" }
	| { kind: "source"; draftId: string }
	| { kind: "margin"; handle: Focus }
	| {
			kind: "popup";
			popup: PopupKind;
			opener: Focus;
			target: TargetSnapshot;
			helper?: HelperSnapshot;
	  }
	| { kind: "dialog"; dialog: string; opener: Focus; target: TargetSnapshot };
export type Exit =
	| { kind: "stay" }
	| { kind: "leave" }
	| { kind: "select"; focus: Focus }
	| { kind: "selection"; focus: Focus; mode: "range" | "toggle" }
	| { kind: "open"; seed: DraftSeed; displayId?: string }
	| { kind: "lens"; lens: Lens; seed?: DraftSeed };
export type FocusRule =
	| { kind: "result" }
	| { kind: "insert"; seed: DraftSeed; selection?: readonly [number, number] }
	| { kind: "merge"; earlier: Focus; join: number }
	| { kind: "add-item"; item: Focus }
	| { kind: "helper"; opener: Focus }
	| { kind: "review"; next: Focus }
	| { kind: "delete"; candidates: readonly Focus[] };
export interface AnnouncementContext {
	name?: string;
	type?: string;
	parent?: string;
	oldParent?: string;
	prevName?: string;
	nextName?: string;
	pos?: string;
	losses?: string;
	otherName?: string;
	leftName?: string;
	direction?: "up" | "down";
	count?: number;
	n?: number;
	first?: number;
	last?: number;
	total?: number;
	name1?: string;
	name2?: string;
	more?: number;
	key?: string;
	value?: string;
	narration?: string;
	closedSuggestions?: number;
	positionMove?: number;
}
export interface HistoryEntry {
	id: string;
	kind: "operation" | "discard";
	summary: Message;
	operations: OperationResult[];
	historyIds: string[];
	draft?: Draft;
	sessionId?: string;
	epoch: number;
	focus: Focus;
	blocked?: Message;
	selectionBefore?: SelectionSnapshot;
	selectionAfter?: SelectionSnapshot;
}
export type Pending = (
	| { kind: "commit"; request: OperationRequest; draft: Draft; exit: Exit }
	| {
			kind: "operation";
			request: OperationRequest;
			focus: FocusRule;
			context: AnnouncementContext;
			draft?: Draft;
			suggestionIds?: string[];
	  }
	| (HistoryApplyRequest & { kind: "history"; entryId: string })
) & { expect: FocusOwner[]; selectionBefore?: SelectionSnapshot };
export interface QueuedAnnouncement {
	message: Message;
	due: number;
	courseParams: string[];
}
export interface Session {
	lens: Lens;
	layers: Layer[];
	focus: Focus | null;
	selected: string[];
	selection: Selection;
	drafts: Record<string, Draft>;
	draftDisplayIds: Record<string, string>;
	draftAbsences: Record<string, { revision: string; focus: Focus }>;
	restoredDraftVersions?: Record<string, number>;
	draftAcknowledgements: Record<
		string,
		{
			revision: string;
			generation: number;
			focus: Focus;
			receiptRevision: string;
			receiptText?: string;
			target?: DraftSeed["target"];
			expectedText?: string;
		}
	>;
	pendingDraftPersistence: Record<
		string,
		{
			requestId: string | null;
			generation: number;
			version: number;
			expectedVersion: number;
		}
	>;
	activeDraft: string | null;
	history: HistoryEntry[];
	cursor: number;
	epoch: number;
	sequence: number;
	draftNamespace: string;
	pending: Pending | null;
	replyFocus?: { requestId: string; snapshot: SelectionSnapshot; historyEntryId?: string };
	revisions: Record<string, string>;
	revisionSeqs: Record<string, number>;
	interfaceLanguage: "en" | "fr";
	courseLanguage: string;
	platform: "windows" | "mac";
	lastKeyAt: number | null;
	background: QueuedAnnouncement[];
}
export type Resolution =
	| { kind: "unchanged" | "changed"; seed: DraftSeed }
	| { kind: "removed" }
	| { kind: "refused"; message: Message };
export interface Dependencies {
	now: number;
	validateDraft: (draft: Draft) => { diagnostics: OperationDiagnostic[]; escapes: boolean };
	helperTokens: (draft: Draft) => readonly HelperToken[];
	focusNeighbours: (focus: Focus) => {
		next?: Focus;
		previous?: Focus;
		parent?: Focus;
		page: Focus;
	};
	nameOfFocus: (focus: Focus) => string;
	readDraft: (focus: Focus, scope?: "node" | "file") => DraftSeed;
	translate: (message: Message | MessageRef) => string;
	selectionNodes?: () => readonly SelectionNode[];
	reviewSuggestions?: () => readonly ReviewSuggestion[];
	selectionAllowed?: (
		operation: string,
		targets: readonly OperationTarget[],
		args: Record<string, unknown>,
	) => Message | null;
}
export type Effect =
	| { type: "clipboard"; text: string; targets: OperationTarget[] }
	| { type: "reviewReplaced"; transactionId: string; suggestionIds: string[] }
	| { type: "post"; method: "operationApply"; request: OperationRequest }
	| (HistoryApplyRequest & {
			type: "post";
			method: "historyApply";
	  })
	| { type: "post"; method: "draftResolve"; draft: Draft; epoch: number }
	| {
			type: "persistDraft";
			action: "put";
			requestId: string;
			draft: Draft;
			expectedVersion: number;
	  }
	| { type: "persistDraft"; action: "remove"; id: string; file: string; expectedDraft?: Draft }
	| {
			type: "focus";
			target: Focus;
			reason?: "settlement";
			expect?: FocusOwner[];
			requestId?: string;
	  }
	| {
			type: "announce";
			message: Message;
			level: "polite" | "assertive";
			delayMs: number;
			interfaceLanguage: "en" | "fr";
			courseLanguage: string;
			courseParams: string[];
	  }
	| { type: "nativeText"; action: "undo" | "redo" }
	| {
			type: "nativeText";
			action: "insert";
			draftId: string;
			generation: number;
			range: readonly [number, number];
			text: string;
	  }
	| { type: "render" };
export type Command =
	| { type: "select"; focus: Focus; mode?: "range" | "toggle" }
	| {
			type: "selectionKey";
			extend?: boolean;
			key:
				| "previous"
				| "next"
				| "start"
				| "end"
				| "toggle"
				| "membership"
				| "all"
				| "clear"
				| "level";
	  }
	| {
			type: "selectionOperation";
			operation: string;
			args: Record<string, unknown>;
			destination?: SelectionDestination;
			focus?: FocusRule;
			context?: AnnouncementContext;
	  }
	| { type: "reviewSelection" }
	| { type: "focusChanged"; focus: Focus }
	| { type: "focusResult"; requestId: string; success: boolean }
	| { type: "openSource"; seed: DraftSeed; displayId?: string }
	| { type: "changeDraft"; text: string; selection: [number, number] }
	| {
			type: "openPopup";
			popup: PopupKind;
			opener: Focus;
			target: TargetSnapshot;
			helper?: HelperToken;
	  }
	| {
			type: "openDialog";
			dialog: string;
			opener: Focus;
			target?: TargetSnapshot;
			replaceMenu?: boolean;
	  }
	| { type: "escape" }
	| { type: "completeLayer" }
	| { type: "pointer"; insideGroup: boolean; insideLayer: boolean; focus?: Focus }
	| { type: "focusLeave"; insideGroup: boolean; focus: Focus }
	| { type: "blur" }
	| { type: "prepareDraftPersistence" }
	| {
			type: "draftPersistenceReply";
			id: string;
			requestId: string;
			generation: number;
			ok: boolean;
	  }
	| { type: "retryDraftPersistence"; id: string }
	| { type: "commit"; trigger: "save" | "enter" }
	| { type: "switchLens"; lens: Lens; seed?: DraftSeed }
	| { type: "tick" }
	| { type: "applyHelper"; text: string }
	| {
			type: "implicitEdit";
			seed: DraftSeed;
			text: string;
			opener: Focus;
			context?: AnnouncementContext;
	  }
	| {
			type: "menuOperation";
			operation: string;
			args: Record<string, unknown>;
			focus?: FocusRule;
			context?: AnnouncementContext;
	  }
	| {
			type: "operation";
			request: OperationRequest;
			focus?: FocusRule;
			context?: AnnouncementContext;
	  }
	| { type: "operationReply"; result: AuthorOperationResult }
	| { type: "undo" | "redo"; inTextField: boolean }
	| { type: "historyReply"; transactionId: string; result: AuthorOperationResult }
	| { type: "sourceSnapshot"; file: string; revision: string; seq: number }
	| { type: "historyAvailability"; entryId: string; blocked?: Message }
	| { type: "discardDraft"; id: string }
	| {
			type: "outsideChange";
			file: string;
			revision: string;
			focusedRemoved?: boolean;
			mapping?: IdentityMapping[];
	  }
	| { type: "draftResolved"; id: string; generation: number; epoch: number; resolution: Resolution }
	| { type: "keepDraft" }
	| { type: "useNewVersion" }
	| { type: "putDraftBack"; seed: DraftSeed }
	| { type: "compareDraft"; opener: Focus }
	| {
			type: "restoreDrafts";
			drafts: { draft: Draft; resolution: Resolution; page: string; origin?: "retained" }[];
	  }
	| { type: "background"; message: Message; courseParams?: string[] }
	| { type: "pageReplaced" }
	| { type: "enterMargin"; bubble: Focus; handle: Focus }
	| { type: "restoreFocus"; lost: boolean }
	| { type: "setLanguage"; language: "en" | "fr" };
