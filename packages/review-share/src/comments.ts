import { json } from "./response";
import { MAX_COMMENT_LENGTH, MAX_NAME_LENGTH } from "./review";

export { MAX_COMMENT_LENGTH, MAX_NAME_LENGTH } from "./review";

export const MAX_PAGE_LENGTH = 200;
export const MAX_PAGE_HEADING_LENGTH = 500;
export const COMMENTS_PER_MINUTE = 10;

const RATE_LIMIT_TTL_SECONDS = 120;

export interface ReviewComment {
	page: string;
	pageHeading?: string;
	name: string;
	text: string;
	at: string;
}

interface CommentBody {
	page?: unknown;
	pageHeading?: unknown;
	name?: unknown;
	text?: unknown;
}

function clampString(value: unknown, maxLength: number): string | null {
	if (typeof value !== "string" || value.length === 0) return null;
	return value.slice(0, maxLength);
}

async function loadComments(kv: KVNamespace, slug: string): Promise<ReviewComment[]> {
	const stored = await kv.get(`comments:${slug}`);
	if (stored === null) return [];

	try {
		const parsed: unknown = JSON.parse(stored);
		return Array.isArray(parsed) ? (parsed as ReviewComment[]) : [];
	} catch {
		return [];
	}
}

async function hashIp(ip: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(
	kv: KVNamespace,
	slug: string,
	request: Request,
	now: number,
): Promise<boolean> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const ipHash = await hashIp(ip);
	const minute = Math.floor(now / 60_000);
	const key = `rate:${slug}:${ipHash}:${minute}`;
	const stored = await kv.get(key);
	const count = stored === null ? 0 : Number.parseInt(stored, 10);
	const normalizedCount = Number.isFinite(count) && count >= 0 ? count : 0;

	if (normalizedCount >= COMMENTS_PER_MINUTE) return false;

	await kv.put(key, String(normalizedCount + 1), {
		expirationTtl: RATE_LIMIT_TTL_SECONDS,
	});
	return true;
}

export async function postComment(
	request: Request,
	kv: KVNamespace,
	slug: string,
	now = Date.now(),
): Promise<Response> {
	let body: CommentBody;
	try {
		body = (await request.json()) as CommentBody;
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}

	if (body === null || typeof body !== "object") {
		return json({ error: "Invalid comment body" }, 400);
	}
	const pageHeading = clampString(body.pageHeading, MAX_PAGE_HEADING_LENGTH);
	if (body.pageHeading !== undefined && pageHeading === null) {
		return json({ error: "pageHeading must be a non-empty string" }, 400);
	}
	const page = clampString(body.page, MAX_PAGE_LENGTH);
	const name = clampString(body.name, MAX_NAME_LENGTH);
	const text = clampString(body.text, MAX_COMMENT_LENGTH);
	if (page === null || name === null || text === null) {
		return json({ error: "page, name, and text must be non-empty strings" }, 400);
	}

	if (!(await consumeRateLimit(kv, slug, request, now))) {
		return json({ error: "Too many comments; try again next minute" }, 429);
	}

	const comment: ReviewComment = {
		page,
		...(pageHeading === null ? {} : { pageHeading }),
		name,
		text,
		at: new Date(now).toISOString(),
	};
	const comments = await loadComments(kv, slug);
	comments.push(comment);
	await kv.put(`comments:${slug}`, JSON.stringify(comments));

	return json(comment, 201);
}

export async function getComments(
	kv: KVNamespace,
	slug: string,
	pageValue: string | null,
): Promise<Response> {
	const page = clampString(pageValue, MAX_PAGE_LENGTH);
	if (page === null) return json({ error: "page query parameter is required" }, 400);

	const comments = await loadComments(kv, slug);
	return json(comments.filter((comment) => comment.page === page));
}
