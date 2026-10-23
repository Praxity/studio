export const MAX_NAME_LENGTH = 60;
export const MAX_COMMENT_LENGTH = 2_000;

/** String bounds count UTF-16 code units. HTTP adapters enforce requestBodyBytes. */
export const REVIEW_LIMITS = Object.freeze({
	name: MAX_NAME_LENGTH,
	body: MAX_COMMENT_LENGTH,
	quoteExact: 2_000,
	quoteContext: 32,
	requestBodyBytes: 65_536,
	stateBytes: 4_194_304,
	authorReserveBytes: 524_288,
	id: 200,
	revision: 500,
	title: 500,
	pinPath: 512,
	pinDepth: 16,
	revealDepth: 16,
	cssPath: 2_048,
	listLimit: 100,
	cursor: 2_048,
	threadsPerReview: 1_000,
	messagesPerThread: 100,
	mutationsPerReview: 100_000,
});

export type ReviewRole = "reviewer" | "author";
export type ReviewProvenance = "local-preview" | "local-cli" | "share";
export type ThreadStatus = "open" | "resolved";
export interface ReviewPrincipal {
	id: string;
	displayName: string;
	role: ReviewRole;
	provenance: ReviewProvenance;
}
export interface ReviewAnchor {
	courseId: string | null;
	lessonId: string | null;
	pageId: string | null;
	nodeId: string | null;
	blockId: string | null;
	revision: string | null;
	quote: { type: "TextQuoteSelector"; exact: string; prefix: string; suffix: string } | null;
	pin: { path: string; x: number; y: number } | null;
	tab: string | null;
	revealPath: string[];
	cssPath: string | null;
	context: { pageTitle: string | null; targetLabel: string | null };
}
export interface ReviewMessage {
	id: string;
	body: string;
	actor: { id: string; displayName: string; role: ReviewRole };
	at: string;
	provenance: ReviewProvenance;
}
export interface ReviewResolution {
	actorId: string;
	at: string;
}
export interface ReviewThread {
	id: string;
	reviewId: string;
	anchor: ReviewAnchor;
	status: ThreadStatus;
	version: number;
	createdAt: string;
	updatedAt: string;
	messages: ReviewMessage[];
	resolution: ReviewResolution | null;
}
/** Original mutation outcome; current lifecycle facts always come from the thread. */
export interface ReviewOutcome {
	threadId: string;
	version: number;
	messageId: string | null;
}
export interface ReviewReceipt extends ReviewOutcome {
	actorId: string;
	requestId: string;
	digest: string;
}
export interface ReviewState {
	schema: 1;
	reviewId: string;
	course: { namespace: string | null; bound: boolean };
	changeSeq: number;
	threads: ReviewThread[];
	receipts: ReviewReceipt[];
}

/** Serialize an admitted state once, before an adapter publishes it. */
export function serializeReviewState(state: ReviewState, role: ReviewRole): ParseResult<string> {
	const value = JSON.stringify(state);
	const limit =
		REVIEW_LIMITS.stateBytes - (role === "author" ? 0 : REVIEW_LIMITS.authorReserveBytes);
	if (new TextEncoder().encode(value).length > limit)
		return refusal("limit_reached", { path: "$.bytes" });
	return { ok: true, value };
}
export interface ReviewPayloads {
	create: { reviewId: string; requestId: string; anchor: ReviewAnchor; body: string };
	reply: {
		reviewId: string;
		threadId: string;
		expectVersion: number;
		requestId: string;
		body: string;
	};
	resolve: ReviewPayloads["reply"];
	reopen: { reviewId: string; threadId: string; expectVersion: number; requestId: string };
}
export type ReviewCommandKind = keyof ReviewPayloads;
export type ReviewRefusalCode =
	| "invalid_input"
	| "forbidden"
	| "wrong_review"
	| "not_found"
	| "stale_version"
	| "request_id_reused"
	| "snapshot_changed"
	| "invalid_cursor"
	| "limit_reached";
export interface ReviewRefusal {
	ok: false;
	code: ReviewRefusalCode;
	detail: { path?: string; message?: string; currentVersion?: number };
}
export type ParseResult<T> = { ok: true; value: T } | ReviewRefusal;
export type ReviewCommandResult =
	| {
			ok: true;
			state: ReviewState;
			thread: ReviewThread;
			receipt: ReviewOutcome;
			replayed: boolean;
	  }
	| ReviewRefusal;
export interface ReviewDeps {
	now(): string;
	uuid(): string;
	/** Local adapters set this only after matching the principal to its stored manifest identity. */
	storedPrincipal?: boolean;
}

type Parser<T> = (value: unknown, path: string, stored?: boolean) => T;
class InvalidField extends Error {
	constructor(readonly path: string) {
		super("Invalid field");
	}
}
function invalid(path: string): never {
	throw new InvalidField(path);
}
function refusal(code: ReviewRefusalCode, detail: ReviewRefusal["detail"] = {}): ReviewRefusal {
	return { ok: false, code, detail };
}
function parse<T>(parser: Parser<T>, value: unknown): ParseResult<T> {
	try {
		return { ok: true, value: parser(value, "$") };
	} catch (error) {
		if (error instanceof InvalidField) return refusal("invalid_input", { path: error.path });
		throw error;
	}
}
function object<T>(fields: { [K in keyof T]: Parser<T[K]> }): Parser<T> {
	return (value, path, stored) => {
		if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path);
		const record = value as Record<string, unknown>;
		for (const key of Reflect.ownKeys(record)) {
			if (typeof key !== "string" || !Object.hasOwn(fields, key)) invalid(`${path}.${String(key)}`);
		}
		const result = {} as T;
		for (const key of Object.keys(fields) as (keyof T & string)[]) {
			if (!Object.hasOwn(record, key)) invalid(`${path}.${key}`);
			result[key] = fields[key](record[key], `${path}.${key}`, stored);
		}
		return result;
	};
}
/** Serialized into the local review bootstrap so the browser and C1 use one text rule. */
export const REVIEW_TEXT_RULES = Object.freeze({
	controls: /[\u0000-\u0008\u000b-\u001f\u0080-\u009f]/u.source,
	bodyControls:
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u0080-\u009f\u202a-\u202e\u2066-\u2069]|\r(?!\n)/u
			.source,
	surrogates: /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.source,
});
function text(max: number, nonempty = true, allowCrLf = false): Parser<string> {
	const controls = new RegExp(
		allowCrLf ? REVIEW_TEXT_RULES.bodyControls : REVIEW_TEXT_RULES.controls,
		"u",
	);
	const surrogates = new RegExp(REVIEW_TEXT_RULES.surrogates, "u");
	// Read existing records under their original text rules; only new input gets stricter admission.
	const storedControls = allowCrLf
		? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\r(?!\n)/u
		: /[\u0000-\u0008\u000b-\u001f]/u;
	return (value, path, stored) => {
		if (
			typeof value !== "string" ||
			value.length > max ||
			(nonempty && value.trim().length === 0) ||
			(stored ? storedControls : controls).test(value) ||
			surrogates.test(value)
		)
			invalid(path);
		return value;
	};
}
function oneOf<T extends string | number | boolean>(...values: T[]): Parser<T> {
	return (value, path) => {
		if (!values.includes(value as T)) invalid(path);
		return value as T;
	};
}
function nullable<T>(parser: Parser<T>): Parser<T | null> {
	return (value, path, stored) => (value === null ? null : parser(value, path, stored));
}
function integer(min: number, max = Number.MAX_SAFE_INTEGER): Parser<number> {
	return (value, path) => {
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
			invalid(path);
		return value;
	};
}
function array<T>(parser: Parser<T>, min = 0, max = Number.MAX_SAFE_INTEGER): Parser<T[]> {
	return (value, path, stored) => {
		if (!Array.isArray(value) || value.length < min || value.length > max) invalid(path);
		return Array.from(value, (item, index) => parser(item, `${path}[${index}]`, stored));
	};
}
const id: Parser<string> = (value, path, stored) => {
	const result = text(REVIEW_LIMITS.id)(value, path, stored);
	if (result !== result.trim() || /[\u0000-\u001f]/.test(result)) invalid(path);
	return result;
};
const uuid: Parser<string> = (value, path) => {
	if (
		typeof value !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
	)
		invalid(path);
	return value;
};
/** Adapters use the same canonical UUID admission as command payloads. */
export function parseReviewUuid(value: unknown): ParseResult<string> {
	return parse(uuid, value);
}
const timestamp: Parser<string> = (value, path) => {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString() !== value
	)
		invalid(path);
	return value;
};
const fraction: Parser<number> = (value, path) => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid(path);
	return value;
};
const pinPath: Parser<string> = (value, path, stored) => {
	const result = text(REVIEW_LIMITS.pinPath, false)(value, path, stored);
	// Empty means the node itself; every other step is a direct element child.
	if (result === "") return result;
	const steps = result.split(" > ");
	if (
		steps.length > REVIEW_LIMITS.pinDepth ||
		steps.some(
			(step) =>
				!/^[a-z][a-z0-9-]*:nth-of-type\([1-9][0-9]*\)$/.test(step) ||
				!Number.isSafeInteger(Number(step.slice(step.indexOf("(") + 1, -1))),
		)
	)
		invalid(path);
	return result;
};
const role = oneOf<ReviewRole>("reviewer", "author");
const provenance = oneOf<ReviewProvenance>("local-preview", "local-cli", "share");
const status = oneOf<ThreadStatus>("open", "resolved");
const resolution = nullable(object<ReviewResolution>({ actorId: id, at: timestamp }));
const anchorShape = object<ReviewAnchor>({
	courseId: nullable(id),
	lessonId: nullable(id),
	pageId: nullable(id),
	nodeId: nullable(id),
	blockId: nullable(id),
	revision: nullable(text(REVIEW_LIMITS.revision)),
	quote: nullable(
		object({
			type: oneOf("TextQuoteSelector"),
			exact: text(REVIEW_LIMITS.quoteExact),
			prefix: text(REVIEW_LIMITS.quoteContext, false),
			suffix: text(REVIEW_LIMITS.quoteContext, false),
		}),
	),
	pin: nullable(object({ path: pinPath, x: fraction, y: fraction })),
	tab: nullable(id),
	revealPath: array(id, 0, REVIEW_LIMITS.revealDepth),
	cssPath: nullable(text(REVIEW_LIMITS.cssPath)),
	context: object({
		pageTitle: nullable(text(REVIEW_LIMITS.title)),
		targetLabel: nullable(text(REVIEW_LIMITS.title)),
	}),
});
const anchor: Parser<ReviewAnchor> = (value, path, stored) => {
	const result = anchorShape(value, path, stored);
	if (result.nodeId === null && result.blockId !== null) invalid(`${path}.blockId`);
	if (result.pin !== null && result.nodeId === null) invalid(`${path}.pin`);
	return result;
};
// Windows reply files retain their CRLF bytes; other free text keeps the stricter rule.
const messageBody = text(REVIEW_LIMITS.body, true, true);
const message = object<ReviewMessage>({
	id: uuid,
	body: messageBody,
	actor: object({ id, displayName: text(REVIEW_LIMITS.name), role }),
	at: timestamp,
	provenance,
});
const thread = object<ReviewThread>({
	id: uuid,
	reviewId: uuid,
	anchor,
	status,
	version: integer(1),
	createdAt: timestamp,
	updatedAt: timestamp,
	messages: array(message, 1),
	resolution,
});
const receipt = object<ReviewReceipt>({
	actorId: id,
	requestId: uuid,
	digest: (value, path) => {
		if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) invalid(path);
		return value;
	},
	threadId: uuid,
	version: integer(1),
	messageId: nullable(uuid),
});
const stateShape = object<ReviewState>({
	schema: oneOf(1),
	reviewId: uuid,
	course: object({ namespace: nullable(id), bound: oneOf(true, false) }),
	changeSeq: integer(0),
	threads: array(thread),
	receipts: array(receipt),
});
function scopedAnchor(state: ReviewState, target: ReviewAnchor): boolean {
	return (
		target.courseId === null || (state.course.bound && target.courseId === state.course.namespace)
	);
}
function checkLifecycle(
	value: { status: ThreadStatus; resolution: ReviewResolution | null },
	path: string,
) {
	if ((value.status === "resolved") !== (value.resolution !== null)) invalid(`${path}.resolution`);
}
/** Parse persisted bytes before using them; no repair, clamping or identity invention. */
export function parseReviewState(value: unknown): ParseResult<ReviewState> {
	return parse((input, path) => {
		const result = stateShape(input, path, true);
		if (result.course.bound && result.course.namespace === null) invalid("$.course.namespace");
		const ids = new Set<string>([result.reviewId]);
		const threads = new Map<string, ReviewThread>();
		for (const [index, item] of result.threads.entries()) {
			const p = `$.threads[${index}]`;
			if (ids.has(item.id)) invalid(`${p}.id`);
			ids.add(item.id);
			threads.set(item.id, item);
			if (item.reviewId !== result.reviewId) invalid(`${p}.reviewId`);
			if (!scopedAnchor(result, item.anchor)) invalid(`${p}.anchor.courseId`);
			if (item.version < item.messages.length || item.version > result.changeSeq)
				invalid(`${p}.version`);
			checkLifecycle(item, p);
			for (const [j, msg] of item.messages.entries()) {
				if (ids.has(msg.id)) invalid(`${p}.messages[${j}].id`);
				ids.add(msg.id);
			}
		}
		const requests = new Set<string>();
		for (const [index, item] of result.receipts.entries()) {
			const p = `$.receipts[${index}]`;
			const target = threads.get(item.threadId);
			if (!target) invalid(`${p}.threadId`);
			if (item.version > target.version) invalid(`${p}.version`);
			if (
				item.messageId !== null &&
				!target.messages.some((message) => message.id === item.messageId)
			)
				invalid(`${p}.messageId`);
			const key = JSON.stringify([item.actorId, item.requestId]);
			if (requests.has(key)) invalid(`${p}.requestId`);
			requests.add(key);
		}
		return result;
	}, value);
}
const versioned = { reviewId: uuid, threadId: uuid, expectVersion: integer(1), requestId: uuid };
const payloadParsers: { [K in ReviewCommandKind]: Parser<ReviewPayloads[K]> } = {
	create: object({ reviewId: uuid, requestId: uuid, anchor, body: messageBody }),
	reply: object({ ...versioned, body: messageBody }),
	resolve: object({ ...versioned, body: messageBody }),
	reopen: object(versioned),
};
export function parseCommandPayload<K extends ReviewCommandKind>(
	kind: K,
	value: unknown,
	stored = false,
): ParseResult<ReviewPayloads[K]> {
	if (!Object.hasOwn(payloadParsers, kind)) return refusal("invalid_input", { path: "$.kind" });
	return parse((input, path) => payloadParsers[kind](input, path, stored), value);
}
const principalParser = object<ReviewPrincipal>({
	id,
	displayName: text(REVIEW_LIMITS.name),
	role,
	provenance,
});
export function parseReviewPrincipal(value: unknown, stored = false): ParseResult<ReviewPrincipal> {
	return parse((input, path) => principalParser(input, path, stored), value);
}

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	return `{${Object.entries(value)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
		.join(",")}}`;
}
async function digestValue(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonical(value));
	return Array.from(
		new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}
async function command(
	kind: ReviewCommandKind,
	state: ReviewState,
	principal: ReviewPrincipal,
	input: unknown,
	deps: ReviewDeps,
): Promise<ReviewCommandResult> {
	if (principal?.role !== "reviewer" && principal?.role !== "author") return refusal("forbidden");
	if (kind === "resolve" && principal.role !== "author") return refusal("forbidden");
	const requestId =
		input !== null && typeof input === "object" && "requestId" in input
			? input.requestId
			: undefined;
	const prior = state.receipts.find(
		(item) => item.actorId === principal.id && item.requestId === requestId,
	);
	const admitted = parseReviewPrincipal(principal, deps.storedPrincipal || prior !== undefined);
	if (!admitted.ok) return admitted;
	// A receipt admits historical text only for replay; the digest still requires the exact request.
	const parsed = parseCommandPayload(kind, input, prior !== undefined);
	if (!parsed.ok) return parsed;
	const payload = parsed.value;
	if (payload.reviewId !== state.reviewId) return refusal("wrong_review");
	const digest = await digestValue({ kind, payload });
	if (prior) {
		if (prior.digest !== digest) return refusal("request_id_reused");
		const original = state.threads.find((item) => item.id === prior.threadId);
		if (!original) throw new Error("Receipt references missing thread");
		return {
			ok: true,
			state,
			replayed: true,
			thread: structuredClone(original),
			receipt: { threadId: prior.threadId, version: prior.version, messageId: prior.messageId },
		};
	}
	let target: ReviewThread | undefined;
	if ("threadId" in payload) {
		target = state.threads.find((item) => item.id === payload.threadId);
		if (!target) return refusal("not_found");
		if (target.version !== payload.expectVersion)
			return refusal("stale_version", { currentVersion: target.version });
	} else if (!scopedAnchor(state, payload.anchor)) {
		return refusal("wrong_review", { path: "$.anchor.courseId" });
	}
	if (!target && state.threads.length >= REVIEW_LIMITS.threadsPerReview)
		return refusal("limit_reached", { path: "$.threads" });
	const authorResponse =
		admitted.value.role === "author" && (kind === "reply" || kind === "resolve");
	if (
		!authorResponse &&
		target &&
		"body" in payload &&
		target.messages.length >= REVIEW_LIMITS.messagesPerThread
	)
		return refusal("limit_reached", { path: "$.messages" });
	if (!authorResponse && state.receipts.length >= REVIEW_LIMITS.mutationsPerReview)
		return refusal("limit_reached", { path: "$.receipts" });
	const at = timestamp(deps.now(), "deps.now");
	const used = new Set([
		state.reviewId,
		...state.threads.flatMap((item) => [item.id, ...item.messages.map((msg) => msg.id)]),
	]);
	const mint = () => {
		const next = uuid(deps.uuid(), "deps.uuid");
		if (used.has(next)) throw new Error("ID dependency returned a duplicate UUID");
		used.add(next);
		return next;
	};
	const next: ReviewThread = target
		? structuredClone(target)
		: {
				id: mint(),
				reviewId: state.reviewId,
				anchor: structuredClone((payload as ReviewPayloads["create"]).anchor),
				status: "open",
				version: 0,
				createdAt: at,
				updatedAt: at,
				messages: [],
				resolution: null,
			};
	let messageId: string | null = null;
	if ("body" in payload) {
		const actor = admitted.value;
		messageId = mint();
		next.messages.push({
			id: messageId,
			body: payload.body,
			actor: { id: actor.id, displayName: actor.displayName, role: actor.role },
			at,
			provenance: actor.provenance,
		});
	}
	if (kind === "resolve") {
		next.status = "resolved";
		next.resolution = { actorId: admitted.value.id, at };
	} else if (kind === "reopen" || (kind === "reply" && admitted.value.role === "reviewer")) {
		next.status = "open";
		next.resolution = null;
	}
	next.version += 1;
	next.updatedAt = at;
	const changeSeq = state.changeSeq + 1;
	const savedReceipt: ReviewReceipt = {
		actorId: admitted.value.id,
		requestId: payload.requestId,
		digest,
		threadId: next.id,
		version: next.version,
		messageId,
	};
	return {
		ok: true,
		replayed: false,
		thread: structuredClone(next),
		receipt: { threadId: next.id, version: next.version, messageId },
		state: {
			...state,
			changeSeq,
			threads: target
				? state.threads.map((item) => (item.id === next.id ? next : item))
				: [...state.threads, next],
			receipts: [...state.receipts, savedReceipt],
		},
	};
}
export function create(
	state: ReviewState,
	principal: ReviewPrincipal,
	payload: unknown,
	deps: ReviewDeps,
) {
	return command("create", state, principal, payload, deps);
}
export function reply(
	state: ReviewState,
	principal: ReviewPrincipal,
	payload: unknown,
	deps: ReviewDeps,
) {
	return command("reply", state, principal, payload, deps);
}
export function resolve(
	state: ReviewState,
	principal: ReviewPrincipal,
	payload: unknown,
	deps: ReviewDeps,
) {
	return command("resolve", state, principal, payload, deps);
}
export function reopen(
	state: ReviewState,
	principal: ReviewPrincipal,
	payload: unknown,
	deps: ReviewDeps,
) {
	return command("reopen", state, principal, payload, deps);
}

export interface ListThreadsOptions {
	pageId?: string;
	status?: ThreadStatus;
	cursor?: string;
	limit?: number;
}
export interface ReviewVisibilityPolicy {
	visibleTo(principal: ReviewPrincipal, thread: ReviewThread, state: ReviewState): boolean;
}
export const reviewVisibility: ReviewVisibilityPolicy = Object.freeze({
	visibleTo: (_principal: ReviewPrincipal, thread: ReviewThread, state: ReviewState) =>
		thread.reviewId === state.reviewId,
});
export interface ReviewThreadList {
	reviewId: string;
	changeSeq: number;
	threads: ReviewThread[];
	nextCursor: string | null;
}
const cursorParser = object({
	principalDigest: text(64),
	visibilityDigest: text(64),
	reviewId: uuid,
	changeSeq: integer(0),
	offset: integer(0),
	pageId: nullable(id),
	status: nullable(status),
});
export async function listThreads(
	state: ReviewState,
	principal: ReviewPrincipal,
	options: ListThreadsOptions = {},
	policy: ReviewVisibilityPolicy = reviewVisibility,
	storedPrincipal = false,
): Promise<ReviewThreadList | ReviewRefusal> {
	const admitted = parseReviewPrincipal(principal, storedPrincipal);
	if (!admitted.ok) return admitted;
	const parsed = parse(
		object({
			pageId: nullable(id),
			status: nullable(status),
			cursor: nullable(text(REVIEW_LIMITS.cursor)),
			limit: integer(1, REVIEW_LIMITS.listLimit),
		}),
		{
			...options,
			pageId: options.pageId ?? null,
			status: options.status ?? null,
			cursor: options.cursor ?? null,
			limit: options.limit === undefined ? 50 : options.limit,
		},
	);
	if (!parsed.ok) return parsed;
	const filters = parsed.value;
	const visible = state.threads.filter((item) => policy.visibleTo(admitted.value, item, state));
	const principalDigest = await digestValue({
		principalId: admitted.value.id,
		role: admitted.value.role,
	});
	const visibilityDigest = await digestValue(visible.map((item) => item.id));
	let offset = 0;
	if (filters.cursor !== null) {
		let raw: unknown;
		try {
			raw = JSON.parse(decodeURIComponent(filters.cursor));
		} catch {
			return refusal("invalid_cursor");
		}
		const cursor = parse(cursorParser, raw);
		if (!cursor.ok) return refusal("invalid_cursor");
		const value = cursor.value;
		if (
			value.reviewId !== state.reviewId ||
			value.principalDigest !== principalDigest ||
			value.pageId !== filters.pageId ||
			value.status !== filters.status
		)
			return refusal("invalid_cursor");
		if (value.changeSeq !== state.changeSeq) return refusal("snapshot_changed");
		if (value.visibilityDigest !== visibilityDigest) return refusal("invalid_cursor");
		offset = value.offset;
	}
	const matching = visible.filter(
		(item) =>
			(filters.pageId === null || item.anchor.pageId === filters.pageId) &&
			(filters.status === null || item.status === filters.status),
	);
	if (offset > matching.length) return refusal("invalid_cursor");
	const end = offset + filters.limit;
	return {
		reviewId: state.reviewId,
		changeSeq: state.changeSeq,
		threads: structuredClone(matching.slice(offset, end)),
		nextCursor:
			end < matching.length
				? encodeURIComponent(
						JSON.stringify({
							principalDigest,
							visibilityDigest,
							reviewId: state.reviewId,
							changeSeq: state.changeSeq,
							offset: end,
							pageId: filters.pageId,
							status: filters.status,
						}),
					)
				: null,
	};
}
