// Learner questions and staff replies. Every learner read and write is scoped by the verified
// Access user ID; only staff read across learners.

export const LIMITS = { pageId: 200, pageTitle: 200, quote: 300, body: 2000 } as const;
/** Learner messages (questions and replies) allowed per learner per minute. */
export const WRITES_PER_MINUTE = 10;

export interface Reply {
	id: number;
	body: string;
	fromStaff: boolean;
	/** For staff replies: whether the learner has opened the panel since. */
	read: boolean;
	createdAt: string;
}

export interface Thread {
	id: number;
	pageId: string;
	pageTitle: string;
	quote: string;
	body: string;
	createdAt: string;
	replies: Reply[];
}

export interface StaffThread extends Thread {
	learnerEmail: string;
}

export interface LearnerView {
	threads: Thread[];
	unread: number;
}

export interface Learner {
	id: string;
	email: string;
}

interface Row {
	id: number;
	learner_id: string;
	learner_email: string;
	thread_id: number | null;
	page_id: string | null;
	page_title: string | null;
	quote: string | null;
	body: string;
	from_staff: number;
	read_at: string | null;
	created_at: string;
}

export type Invalid = "invalid" | "too_large";

const COLUMNS =
	"id, learner_id, learner_email, thread_id, page_id, page_title, quote, body, from_staff, read_at, created_at";

// Newest question first; replies oldest first under their question.
function threads(rows: Row[]): StaffThread[] {
	return rows
		.filter((row) => row.thread_id === null)
		.reverse()
		.map((question) => ({
			id: question.id,
			learnerEmail: question.learner_email,
			pageId: question.page_id ?? "",
			pageTitle: question.page_title ?? "",
			quote: question.quote ?? "",
			body: question.body,
			createdAt: question.created_at,
			replies: rows
				.filter((row) => row.thread_id === question.id)
				.map((row) => ({
					id: row.id,
					body: row.body,
					fromStaff: row.from_staff === 1,
					read: row.read_at !== null,
					createdAt: row.created_at,
				})),
		}));
}

/** Trimmed text within `max` characters; undefined input passes when optional. */
function text(value: unknown, max: number, required: boolean): string | undefined | Invalid {
	if (value === undefined && !required) return undefined;
	if (typeof value !== "string") return "invalid";
	const trimmed = value.trim();
	if (required && !trimmed) return "invalid";
	if (trimmed.length > max) return "too_large";
	return trimmed || undefined;
}

function exactKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).every((key) => allowed.includes(key))
	);
}

export interface NewQuestion {
	pageId: string;
	pageTitle?: string;
	quote?: string;
	body: string;
}

export function parseQuestion(value: unknown): NewQuestion | Invalid {
	if (!exactKeys(value, ["pageId", "pageTitle", "quote", "body"])) return "invalid";
	const fields = {
		pageId: text(value.pageId, LIMITS.pageId, true),
		pageTitle: text(value.pageTitle, LIMITS.pageTitle, false),
		quote: text(value.quote, LIMITS.quote, false),
		body: text(value.body, LIMITS.body, true),
	};
	const values = Object.values(fields);
	if (values.includes("invalid")) return "invalid";
	if (values.includes("too_large")) return "too_large";
	return fields as NewQuestion;
}

export function parseReply(value: unknown): string | Invalid {
	if (!exactKeys(value, ["body"])) return "invalid";
	return text(value.body, LIMITS.body, true) as string | Invalid;
}

export async function learnerView(db: D1Database, learnerId: string): Promise<LearnerView> {
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM help_messages WHERE learner_id = ? ORDER BY id`)
		.bind(learnerId)
		.all<Row>();
	return {
		threads: threads(results).map(({ learnerEmail: _, ...thread }) => thread),
		unread: results.filter((row) => row.from_staff === 1 && row.read_at === null).length,
	};
}

const sinceMinute = (now: Date) => new Date(now.getTime() - 60_000).toISOString();
// The count and the insert are one statement, so concurrent requests can't overshoot the limit.
const UNDER_LIMIT = `(SELECT COUNT(*) FROM help_messages WHERE learner_id = ? AND from_staff = 0 AND created_at > ?) < ${WRITES_PER_MINUTE}`;

/** Returns false when the learner is over the write limit. */
export async function ask(
	db: D1Database,
	learner: Learner,
	question: NewQuestion,
	now = new Date(),
): Promise<boolean> {
	const inserted = await db
		.prepare(
			`INSERT INTO help_messages (learner_id, learner_email, page_id, page_title, quote, body, created_at)
			SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${UNDER_LIMIT} RETURNING id`,
		)
		.bind(
			learner.id,
			learner.email,
			question.pageId,
			question.pageTitle ?? null,
			question.quote ?? null,
			question.body,
			now.toISOString(),
			learner.id,
			sinceMinute(now),
		)
		.first();
	return inserted !== null;
}

/** A learner's follow-up in their own thread. */
export async function learnerReply(
	db: D1Database,
	learner: Learner,
	threadId: number,
	body: string,
	now = new Date(),
): Promise<"saved" | "not_found" | "rate_limited"> {
	const inserted = await db
		.prepare(
			`INSERT INTO help_messages (learner_id, learner_email, thread_id, body, created_at)
			SELECT ?, ?, ?, ?, ?
			WHERE EXISTS (SELECT 1 FROM help_messages WHERE id = ? AND thread_id IS NULL AND learner_id = ?)
			AND ${UNDER_LIMIT} RETURNING id`,
		)
		.bind(
			learner.id,
			learner.email,
			threadId,
			body,
			now.toISOString(),
			threadId,
			learner.id,
			learner.id,
			sinceMinute(now),
		)
		.first();
	if (inserted) return "saved";
	const owned = await db
		.prepare(
			"SELECT 1 AS found FROM help_messages WHERE id = ? AND thread_id IS NULL AND learner_id = ?",
		)
		.bind(threadId, learner.id)
		.first();
	return owned ? "rate_limited" : "not_found";
}

export async function markRead(db: D1Database, learnerId: string, now = new Date()): Promise<void> {
	await db
		.prepare(
			"UPDATE help_messages SET read_at = ? WHERE learner_id = ? AND from_staff = 1 AND read_at IS NULL",
		)
		.bind(now.toISOString(), learnerId)
		.run();
}

export async function allThreads(db: D1Database): Promise<StaffThread[]> {
	const { results } = await db
		.prepare(`SELECT ${COLUMNS} FROM help_messages ORDER BY id`)
		.all<Row>();
	return threads(results);
}

/** Returns false when the thread doesn't exist. */
export async function staffReply(
	db: D1Database,
	threadId: number,
	body: string,
	now = new Date(),
): Promise<boolean> {
	const inserted = await db
		.prepare(
			`INSERT INTO help_messages (learner_id, learner_email, thread_id, body, from_staff, created_at)
			SELECT learner_id, learner_email, id, ?, 1, ? FROM help_messages WHERE id = ? AND thread_id IS NULL
			RETURNING id`,
		)
		.bind(body, now.toISOString(), threadId)
		.first();
	return inserted !== null;
}

/** A thread needs staff when nothing has answered the learner's last message. */
export const needsReply = (thread: Thread): boolean => !thread.replies.at(-1)?.fromStaff;
