import type {
	OperationRefusal,
	OperationResult,
} from "@praxity/grammar/src/operations/contract.ts";
import type { AnnouncementContext, Message, Session } from "./types";

/** Message files own every sentence, including optional clauses and plurals. */
export function announcement(event: string, params: Record<string, string | number> = {}): Message {
	const values = {
		name: "",
		type: "",
		parent: "",
		oldParent: "",
		prevName: "",
		nextName: "",
		pos: "",
		losses: "",
		undo: "",
		direction: "up",
		count: 1,
		retiredCuts: 0,
		n: 1,
		first: 1,
		last: 1,
		total: 1,
		name1: "",
		name2: "",
		more: 0,
		otherName: "",
		leftName: "",
		narration: "",
		closedSuggestions: 0,
		draftName: "undefined",
		kind: "block",
		key: "",
		value: "",
		...params,
	};
	for (const key of [
		"prevName",
		"nextName",
		"pos",
		"losses",
		"undo",
		"name2",
		"narration",
	] as const) {
		if (!values[key]) values[key] = "undefined";
	}
	return {
		key: `session.announcements.${event}`,
		params: values,
	};
}

/** Explicit registry-name coverage makes new operations require a speech decision. */
export const operationEvents: Readonly<Record<string, string>> = {
	editSource: "saved",
	setProperty: "helperApplied",
	setText: "saved",
	editInline: "saved",
	moveBlocks: "moved",
	deleteBlocks: "deleted",
	insertBlock: "inserted",
	duplicateBlocks: "duplicated",
	turnInto: "converted",
	wrapIn: "wrapped",
	mergeBlocks: "merged",
	wrapInColumns: "inColumns",
	unwrapColumns: "columnsRemoved",
	setColumnWeights: "columnsResized",
	addItem: "itemAdded",
	removeItem: "itemRemoved",
	moveItem: "moved",
	copyBlocks: "copied",
	discardCut: "cutDropped",
	insertPage: "pageInserted",
	movePage: "pageMoved",
	setPageTitle: "saved",
	mergePage: "merged",
	deletePage: "pageDeleted",
	applyInverse: "undone",
	cutBlocks: "cut",
	pasteBlocks: "pasted",
	replaceBlock: "inserted",
	acceptSuggestion: "accepted",
	rejectSuggestion: "rejected",
};

export function operationAnnouncement(
	operation: string,
	result: OperationResult | OperationRefusal,
	context: AnnouncementContext,
	session: Pick<Session, "platform">,
	translate: (message: Message) => string,
): Message {
	const undo = translate({ key: `session.undoHint.${session.platform}`, params: {} });
	if (!result.ok) {
		const reason = translate(result.message);
		return result.code === "escapes-range" && operation === "editSource"
			? announcement("notSaved", { message: reason })
			: announcement("refused", {
					action: translate({ key: `session.actions.${operation}`, params: {} }),
					reason,
				});
	}
	let event = operationEvents[operation];
	if (!event) throw new Error(`Missing announcement template for ${operation}`);
	const count = context.n ?? context.count ?? Number(result.summary.params.count ?? 1);
	if (operation === "editSource" && result.diagnostics.some((d) => d.severity === "error")) {
		const diagnostic = result.diagnostics.find((d) => d.severity === "error");
		return announcement("savedInvalid", {
			n: Number(diagnostic?.message.params.line ?? 1),
			message: diagnostic ? translate(diagnostic.message) : "",
		});
	}
	if (operation === "moveBlocks" && context.oldParent) event = "movedOut";
	if (operation === "moveBlocks" && context.positionMove) event = "movedSeveralTo";
	if (operation === "pasteBlocks" && result.intent === "move") event = "pastedMove";
	if (Number(result.summary.params.retiredCuts ?? 0) > 0 && operation === "copyBlocks")
		event = "copiedRetiringCut";
	if (Number(result.summary.params.retiredCuts ?? 0) > 0 && operation === "cutBlocks")
		event = "cutReplacing";
	if (count > 1) {
		const many: Record<string, string> = {
			moved: "movedSeveral",
			deleted: "deletedSeveral",
			duplicated: "duplicatedSeveral",
			converted: "convertedSeveral",
			inColumns: "severalInColumns",
		};
		event = many[event] ?? event;
	}
	return announcement(event, {
		...context,
		n: count,
		retiredCuts: Number(result.summary.params.retiredCuts ?? 0),
		count,
		undo,
		...(operation === "applyInverse" ? { summary: translate(result.summary) } : {}),
	});
}
