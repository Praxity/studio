export const LIMITS = { pageId: 200, pageTitle: 200, quote: 300, body: 2000 } as const;
export const WRITES_PER_MINUTE = 10;
export const WRITES_PER_DAY = 100;
export const STAFF_RECENT_THREADS = 200;

export interface Reply {
	id: number;
	body: string;
	fromStaff: boolean;
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

function threads(rows: Row[]): StaffThread[] {
	const replies = new Map<number, Reply[]>();
	for (const row of rows) {
		if (row.thread_id === null) continue;
		const list = replies.get(row.thread_id) ?? [];
		list.push({
			id: row.id,
			body: row.body,
			fromStaff: row.from_staff === 1,
			read: row.read_at !== null,
			createdAt: row.created_at,
		});
		replies.set(row.thread_id, list);
	}
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
			replies: replies.get(question.id) ?? [],
		}));
}

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
const sinceDay = (now: Date) => new Date(now.getTime() - 86_400_000).toISOString();
const UNDER_LIMIT = `(SELECT COUNT(*) FROM help_messages WHERE learner_id = ? AND from_staff = 0 AND created_at > ?) < ${WRITES_PER_MINUTE}
	AND (SELECT COUNT(*) FROM help_messages WHERE learner_id = ? AND from_staff = 0 AND created_at > ?) < ${WRITES_PER_DAY}`;

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
			learner.id,
			sinceDay(now),
		)
		.first();
	return inserted !== null;
}

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
			learner.id,
			sinceDay(now),
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

const WAITING = `(SELECT from_staff FROM help_messages m WHERE m.id = q.id OR m.thread_id = q.id ORDER BY m.id DESC LIMIT 1) = 0`;

export async function allThreads(db: D1Database): Promise<StaffThread[]> {
	const { results } = await db
		.prepare(
			`WITH shown AS (
				SELECT q.id FROM help_messages q WHERE q.thread_id IS NULL AND (${WAITING}
					OR q.id IN (SELECT id FROM help_messages WHERE thread_id IS NULL ORDER BY id DESC LIMIT ?)))
			SELECT ${COLUMNS} FROM help_messages WHERE id IN shown OR thread_id IN shown ORDER BY id`,
		)
		.bind(STAFF_RECENT_THREADS)
		.all<Row>();
	return threads(results);
}

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

export const needsReply = (thread: Thread): boolean => !thread.replies.at(-1)?.fromStaff;
