import type { ActivityEffectTicket } from "./activity-effects";
import {
	type DistractorOption,
	type DistractorValue,
	type FieldError,
	MAX_ANSWER,
	MAX_CUSTOM,
	MAX_OPTION,
	validateDistractorAnswer,
	type WriteDistractorsRules,
} from "./write-distractors-content";

export type { DistractorOption, DistractorValue } from "./write-distractors-content";
export interface DistractorReference {
	contentRevision: string;
	count: number;
	itemIds: readonly string[];
}
export interface SavedWriteDistractors {
	version: 1;
	kind: "write-distractors";
	contentRevision: string;
	value: DistractorValue;
}
export interface DistractorRecoveryField {
	path: string;
	text: string;
}
export type DistractorRestoreStatus = "pending" | "empty" | "valid" | "invalid" | "out-of-date";
export interface DistractorDecodedState {
	status: DistractorRestoreStatus;
	state: SavedWriteDistractors | null;
	recovery: DistractorRecoveryField[];
	writeBlocked: DistractorWriteBlocked | null;
}
export type DistractorWriteBlocked =
	| { reason: "restore-pending" | "restore-held" | "content-unavailable" | "invalid-state" }
	| {
			reason: "validation";
			field: string;
			code: "longAnswer" | "longText" | "longCustom" | "choose";
	  };
export interface DistractorEncoding {
	state: SavedWriteDistractors | null;
	writeBlocked: DistractorWriteBlocked | null;
}
interface AsyncDistractorCommand {
	generation: number;
	/** W08 supplies the existing W06 effect ticket for provider/document authority. */
	ticket?: ActivityEffectTicket;
}
export type DistractorEdit =
	| { type: "edit-answer"; answer: string }
	| { type: "edit-option"; index: number; field: keyof DistractorOption; text: string };
export type DistractorCommand =
	| DistractorEdit
	| { type: "check" | "compare" | "start-over" | "flush" }
	| { type: "rate"; hadIt: boolean }
	| { type: "revision-change"; reference: DistractorReference }
	| ({ type: "restore"; value: unknown } & AsyncDistractorCommand)
	| ({ type: "restore-unavailable" | "retry" } & AsyncDistractorCommand)
	| ({
			type: "write-result";
			writeId: number;
			outcome: "saved" | "failed";
	  } & AsyncDistractorCommand);
export type DistractorError =
	| "emptyAnswer"
	| "longAnswer"
	| "content-unavailable"
	| "rating-required"
	| "invalid-draft"
	| FieldError[];
export interface DistractorMount {
	reference: DistractorReference;
	value: DistractorValue;
	checkedAnswer: boolean;
	restoreWriteHold: boolean;
	restoreStatus: DistractorRestoreStatus | "conflict" | "unavailable";
	generation: number;
	readDone: boolean;
	saved: unknown;
	heldEdits: DistractorEdit[];
	recovery: DistractorRecoveryField[];
	localRecovery: DistractorRecoveryField[];
	notSaved: boolean;
	error: DistractorError | null;
	writeBlocked: DistractorWriteBlocked | null;
	/** Only a confirmed receipt updates saved; a proposal is never durable evidence. */
	pendingWrite: SavedWriteDistractors | null;
	writeSequence: number;
	/** An executed write without a receipt is not evidence of an empty store. */
	storageUncertain?: boolean;
}
export interface DistractorReduction {
	mount: DistractorMount;
	write: SavedWriteDistractors | null;
	response: null;
	notice: "practiceNotSaved" | null;
	writeBlocked: DistractorWriteBlocked | null;
	writeId: number | null;
}

const revisionPattern = /^sha256:[a-f0-9]{64}$/;
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		![Object.prototype, null].includes(Object.getPrototypeOf(value))
	)
		return false;
	const own = Reflect.ownKeys(value);
	return (
		own.length === keys.length &&
		own.every((key) => typeof key === "string" && keys.includes(key)) &&
		keys.every((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return descriptor?.enumerable && "value" in descriptor;
		})
	);
}
function array(value: unknown): value is unknown[] {
	if (
		!Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Array.prototype ||
		value.length < 1 ||
		value.length > 5 ||
		Reflect.ownKeys(value).length !== value.length + 1
	)
		return false;
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !("value" in descriptor)) return false;
	}
	return true;
}
/** Recovery follows only named own data properties, never getters or recursive walks. */
export function recoverWriteDistractorsText(value: unknown): DistractorRecoveryField[] {
	const own = (parent: unknown, key: string): unknown => {
		if (!parent || typeof parent !== "object") return undefined;
		const descriptor = Object.getOwnPropertyDescriptor(parent, key);
		return descriptor && "value" in descriptor ? descriptor.value : undefined;
	};
	const result: DistractorRecoveryField[] = [];
	const add = (path: string, text: unknown) => {
		if (typeof text === "string") result.push({ path, text });
	};
	const saved = own(value, "value");
	add("value.answer", own(saved, "answer"));
	const options = own(saved, "options");
	for (let index = 0; index < 5; index++) {
		const option = own(options, String(index));
		for (const field of ["text", "custom"])
			add(`value.options[${index}].${field}`, own(option, field));
	}
	return result;
}
function copyValue(value: DistractorValue): DistractorValue {
	return { ...value, options: value.options.map((option) => ({ ...option })) };
}
function sameReference(reference: DistractorReference, other: DistractorReference): boolean {
	return (
		other.contentRevision === reference.contentRevision &&
		other.count === reference.count &&
		other.itemIds.length === reference.itemIds.length &&
		other.itemIds.every((id, index) => id === reference.itemIds[index])
	);
}
function authority(reference: DistractorReference, rules?: WriteDistractorsRules): boolean {
	return rules !== undefined && sameReference(reference, rules);
}
/** Provider JSON parsing is outside the codec. Only plain records are envelopes. */
export function decodeWriteDistractorsState(
	value: unknown,
	reference: DistractorReference,
	rules?: WriteDistractorsRules,
): DistractorDecodedState {
	const recovery = recoverWriteDistractorsText(value);
	const result = (
		status: DistractorRestoreStatus,
		writeBlocked: DistractorWriteBlocked | null = status === "pending"
			? { reason: "content-unavailable" }
			: status === "empty"
				? null
				: { reason: "invalid-state" },
	): DistractorDecodedState => ({
		status,
		state: null,
		recovery,
		writeBlocked,
	});
	if (value === undefined) return result("empty");
	if (
		!record(value, ["version", "kind", "contentRevision", "value"]) ||
		value.version !== 1 ||
		value.kind !== "write-distractors" ||
		typeof value.contentRevision !== "string" ||
		!revisionPattern.test(value.contentRevision)
	)
		return result("invalid");
	const draft = value.value;
	if (
		!record(draft, ["answer", "hadIt", "options", "shown"]) ||
		typeof draft.answer !== "string" ||
		(draft.hadIt !== null && typeof draft.hadIt !== "boolean") ||
		typeof draft.shown !== "boolean" ||
		(draft.hadIt !== null && !draft.answer.trim()) ||
		(draft.shown && draft.hadIt === null) ||
		!array(draft.options)
	)
		return result("invalid");
	if (draft.answer.trim().length > MAX_ANSWER)
		return result("invalid", { reason: "validation", field: "value.answer", code: "longAnswer" });
	const options: DistractorOption[] = [];
	for (const option of draft.options) {
		if (
			!record(option, ["text", "misconception", "custom"]) ||
			typeof option.text !== "string" ||
			typeof option.misconception !== "string" ||
			typeof option.custom !== "string"
		)
			return result("invalid");
		if (option.text.trim().length > MAX_OPTION)
			return result("invalid", {
				reason: "validation",
				field: `value.options[${options.length}].text`,
				code: "longText",
			});
		if (option.custom.trim().length > MAX_CUSTOM)
			return result("invalid", {
				reason: "validation",
				field: `value.options[${options.length}].custom`,
				code: "longCustom",
			});
		options.push({ text: option.text, misconception: option.misconception, custom: option.custom });
	}
	// Old counts and IDs describe the old revision. Never test them against new Content.
	if (value.contentRevision !== reference.contentRevision) return result("out-of-date");
	if (options.length !== reference.count) return result("invalid");
	const unknownId = options.findIndex(
		(option) =>
			option.misconception !== "" &&
			option.misconception !== "other" &&
			!reference.itemIds.includes(option.misconception),
	);
	if (unknownId !== -1)
		return result("invalid", {
			reason: "validation",
			field: `value.options[${unknownId}].misconception`,
			code: "choose",
		});
	const copied: DistractorValue = {
		answer: draft.answer,
		hadIt: draft.hadIt as boolean | null,
		options,
		shown: draft.shown,
	};
	if (copied.hadIt !== null || copied.shown) {
		if (!authority(reference, rules)) return result("pending");
		if (!rules?.validateValue(copied)) return result("invalid");
	}
	return {
		status: "valid",
		state: {
			version: 1,
			kind: "write-distractors",
			contentRevision: reference.contentRevision,
			value: copied,
		},
		recovery,
		writeBlocked: null,
	};
}

export function createDistractorMount(reference: DistractorReference): DistractorMount {
	if (
		!revisionPattern.test(reference.contentRevision) ||
		!Number.isInteger(reference.count) ||
		reference.count < 1 ||
		reference.count > 5
	)
		throw new Error("EWRITEDISTRACTORSREFERENCE");
	return {
		reference: { ...reference, itemIds: [...reference.itemIds] },
		value: {
			answer: "",
			hadIt: null,
			options: Array.from({ length: reference.count }, () => ({
				text: "",
				misconception: "",
				custom: "",
			})),
			shown: false,
		},
		checkedAnswer: false,
		restoreWriteHold: true,
		restoreStatus: "pending",
		generation: 0,
		readDone: false,
		saved: undefined,
		heldEdits: [],
		recovery: [],
		localRecovery: [],
		notSaved: false,
		error: null,
		writeBlocked: null,
		pendingWrite: null,
		writeSequence: 0,
	};
}
/** Every adapter write, including pagehide/flush, must use this guarded encoder. */
export function encodeWriteDistractorsState(
	mount: DistractorMount,
	rules?: WriteDistractorsRules,
): DistractorEncoding {
	if (mount.restoreWriteHold || !mount.readDone)
		return {
			state: null,
			writeBlocked: { reason: mount.readDone ? "restore-held" : "restore-pending" },
		};
	const decoded = decodeWriteDistractorsState(
		{
			version: 1,
			kind: "write-distractors",
			contentRevision: mount.reference.contentRevision,
			value: mount.value,
		},
		mount.reference,
		rules,
	);
	return { state: decoded.state, writeBlocked: decoded.writeBlocked };
}

function edit(value: DistractorValue, command: DistractorEdit): DistractorValue {
	const next = copyValue(value);
	if (command.type === "edit-answer") next.answer = command.answer;
	else if (next.options[command.index]) next.options[command.index][command.field] = command.text;
	return next;
}
function conflicts(value: DistractorValue, command: DistractorEdit): boolean {
	return command.type === "edit-answer"
		? value.answer !== command.answer
		: value.options[command.index]?.[command.field] !== command.text;
}

/** Pure activity reduction. W08 owns FIFO jobs, provider effects and callback lifetime. */
export function reduceWriteDistractors(
	previous: DistractorMount,
	command: DistractorCommand,
	rules?: WriteDistractorsRules,
): DistractorReduction {
	let mount = { ...previous };
	let write: SavedWriteDistractors | null = null,
		writeId: number | null = null;
	let notice: DistractorReduction["notice"] = null;
	const finish = (): DistractorReduction => ({
		mount,
		write,
		writeId,
		response: null,
		notice,
		writeBlocked: mount.writeBlocked,
	});
	const unsaved = () => {
		if (!mount.notSaved) notice = "practiceNotSaved";
		mount.notSaved = true;
	};
	const save = () => {
		const encoded = encodeWriteDistractorsState(mount, rules);
		mount.writeBlocked = encoded.writeBlocked;
		// A changed unencodable value retires the prior proposal. Its late receipt
		// cannot certify that this newer text was saved.
		mount.pendingWrite = encoded.state;
		if (encoded.state) {
			write = encoded.state;
			writeId = ++mount.writeSequence;
		} else if (!mount.restoreWriteHold || mount.heldEdits.length) unsaved();
	};
	// W06 owns external lifetime authority. This reducer only retains each
	// activity's existing generation and the identity of its latest write request.
	if (
		"generation" in command &&
		(command.generation !== mount.generation || command.ticket?.current() === false)
	)
		return finish();
	if (command.type === "write-result") {
		if (!mount.pendingWrite || command.writeId !== mount.writeSequence) return finish();
		if (command.outcome === "saved") {
			mount.saved = mount.pendingWrite;
			mount.notSaved = false;
			mount.writeBlocked = null;
		} else unsaved();
		mount.pendingWrite = null;
		return finish();
	}
	if (command.type === "start-over") {
		// A pending read holds writes (:462); failed admission permits the learner's
		// explicit discard (:463 and the failed passive-restore UI row).
		if (!mount.readDone && mount.restoreStatus !== "unavailable") return finish();
		mount = {
			...createDistractorMount(mount.reference),
			generation: mount.generation + 1,
			readDone: true,
			restoreWriteHold: false,
			restoreStatus: "empty",
			saved: mount.saved,
		};
		save();
		return finish();
	}
	if (command.type === "revision-change") {
		if (sameReference(mount.reference, command.reference)) return finish();
		const next = createDistractorMount(command.reference);
		next.generation = mount.generation + 1;
		next.readDone = mount.readDone;
		next.saved = mount.saved;
		next.notSaved = mount.notSaved;
		next.localRecovery =
			mount.heldEdits.length ||
			mount.value.answer ||
			mount.value.options.some((o) => o.text || o.custom)
				? recoverWriteDistractorsText({ value: mount.value })
				: mount.localRecovery;
		// Only an observed read or confirmed write is evidence of stored bytes.
		// Unsaved memory and proposed writes remain separately labelled local text.
		if (mount.readDone && mount.storageUncertain) {
			next.restoreStatus = "unavailable";
			next.recovery = recoverWriteDistractorsText(mount.saved);
		} else if (mount.readDone && mount.saved === undefined) {
			next.restoreStatus = "empty";
			next.restoreWriteHold = false;
		} else if (mount.saved !== undefined) {
			const decoded = decodeWriteDistractorsState(mount.saved, next.reference);
			next.readDone = true;
			next.restoreStatus = decoded.status === "valid" ? "pending" : decoded.status;
			next.recovery = decoded.recovery;
		}
		mount = next;
		return finish();
	}
	if (command.type === "retry") {
		if (!mount.restoreWriteHold || mount.restoreStatus !== "unavailable") return finish();
		++mount.generation;
		mount.restoreStatus = "pending";
		return finish();
	}
	if (command.type === "restore-unavailable") {
		// A settled admission is terminal for these callbacks, including a failure
		// carrying the same generation. Only a new provider/mount can acquire again.
		if (!mount.restoreWriteHold || mount.restoreStatus === "conflict") return finish();
		mount.restoreStatus = "unavailable";
		return finish();
	}
	if (command.type === "restore") {
		if (!mount.restoreWriteHold || mount.restoreStatus === "conflict") return finish();
		const saved = mount.readDone && mount.saved !== undefined ? mount.saved : command.value;
		const decoded = decodeWriteDistractorsState(saved, mount.reference, rules);
		mount.saved = saved;
		mount.readDone = true;
		mount.restoreStatus = decoded.status;
		mount.recovery = decoded.recovery;
		if (decoded.status === "empty") {
			mount.restoreWriteHold = false;
			mount.heldEdits = [];
			mount.writeBlocked = null;
		} else if (decoded.state) {
			const restored = decoded.state.value;
			if (mount.heldEdits.some((change) => conflicts(restored, change))) {
				mount.restoreStatus = "conflict";
				return finish();
			}
			mount.value = copyValue(restored);
			mount.checkedAnswer = restored.hadIt !== null;
			mount.restoreWriteHold = false;
			mount.heldEdits = [];
			mount.error = null;
			mount.notSaved = false;
			mount.writeBlocked = null;
		}
		// No admission flush, including an empty read beneath a newer in-memory edit.
		return finish();
	}
	if (command.type === "flush") {
		save();
		return finish();
	}
	if (command.type === "edit-answer" || command.type === "edit-option") {
		if (mount.value.shown || (command.type === "edit-answer" && mount.checkedAnswer))
			return finish();
		// The option builder appears only after rating. Held/recovery states expose
		// memory-only answer entry, never hidden option editors (table :482,:488-493).
		if (
			command.type === "edit-option" &&
			(mount.restoreWriteHold ||
				mount.value.hadIt === null ||
				!Number.isInteger(command.index) ||
				!mount.value.options[command.index])
		)
			return finish();
		mount.value = edit(mount.value, command);
		mount.error = null;
		if (mount.restoreWriteHold) {
			mount.heldEdits = mount.heldEdits.filter(
				(held) =>
					held.type !== command.type ||
					(held.type === "edit-option" &&
						command.type === "edit-option" &&
						(held.index !== command.index || held.field !== command.field)),
			);
			mount.heldEdits.push({ ...command });
			mount.writeBlocked = { reason: mount.readDone ? "restore-held" : "restore-pending" };
			unsaved();
		} else save();
		return finish();
	}
	// CONTRACTS.md:475,488-493 permit no reveal, self-rating or comparison while
	// admission is held. This also makes later progress impossible to discard.
	if (mount.restoreWriteHold) return finish();
	if (mount.value.shown) return finish();
	if (command.type === "check" && mount.checkedAnswer) return finish();
	if (command.type !== "check" && !mount.checkedAnswer) return finish();
	if (command.type === "compare" && mount.value.hadIt === null) return finish();
	const answer = validateDistractorAnswer(mount.value.answer);
	if (!answer.ok) {
		mount.error = answer.error;
		return finish();
	}
	if (!authority(mount.reference, rules) || !rules) {
		mount.error = "content-unavailable";
		return finish();
	}
	if (command.type === "check") {
		if (!rules.validateValue(mount.value)) {
			mount.error = "invalid-draft";
			return finish();
		}
		mount.checkedAnswer = true;
		mount.error = null;
		return finish();
	}
	if (command.type === "rate") {
		if (!rules.validateValue(mount.value)) return finish();
		mount.value = { ...mount.value, hadIt: command.hadIt };
		mount.error = null;
		save();
		return finish();
	}
	const compared = rules.compare(mount.value.options);
	if (!compared.ok) {
		mount.error = compared.errors;
		return finish();
	}
	const value = { ...mount.value, options: compared.options, shown: true };
	if (!rules.validateValue(value)) {
		mount.error = "invalid-draft";
		return finish();
	}
	mount.value = value;
	mount.error = null;
	save();
	return finish();
}
