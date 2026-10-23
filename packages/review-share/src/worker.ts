import { ARTIFACT_MEDIA_TYPES } from "@praxity/export-pipeline/artifact-media-types";
import { getComments, postComment } from "./comments";
import { DAY_MS, DEFAULT_EXPIRY_DAYS, normalizeExpiryDays, validRelativePath } from "./protocol";
import { json } from "./response";

declare global {
	// Vitest also loads DOM declarations, which hide Workers' default cache property.
	interface CacheStorage {
		readonly default: Cache;
	}
}

const SLUG_BYTES = 18;
const SHARE_KEY_PREFIX = "share:";

const EXPIRED_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<title>Review link expired</title>
	</head>
	<body>
		<main><h1>This review link has expired</h1></main>
	</body>
</html>`;

export interface Env {
	REVIEW_KV: KVNamespace;
	REVIEW_FILES: R2Bucket;
	UPLOAD_TOKEN: string;
}

export interface ShareMetadata {
	slug: string;
	expiresAt: string;
	title: string;
}

type ShareLookup =
	| { state: "active"; share: ShareMetadata }
	| { state: "expired"; share: ShareMetadata }
	| { state: "missing" };

interface RequestTiming {
	shareHash: string | null;
	kvMs: number;
	r2Ms: number;
	cacheMs: number;
	cache: "bypass" | "miss" | "hit";
	cacheMatchFailed?: boolean;
}

async function measure<T>(
	timing: RequestTiming,
	field: "kvMs" | "r2Ms" | "cacheMs",
	operation: () => Promise<T>,
): Promise<T> {
	const start = performance.now();
	try {
		return await operation();
	} finally {
		timing[field] += performance.now() - start;
	}
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function immutableFile(path: string): boolean {
	// Match exporter fingerprints, never ordinary authored filenames or HTML.
	return (
		/^assets\/__praxity-[a-f0-9]{24}\.webp$/u.test(path) ||
		/^[a-z0-9_-]+\.[a-f0-9]{12}\.css$/u.test(path) ||
		/^(?:islands\/(?:chunks\/)?|chunks\/|privacy-chunks\/)?[a-z0-9_-]+-[A-Z0-9]{8}(?:\.classic)?\.js$/u.test(
			path,
		)
	);
}

function methodNotAllowed(allowed: string[]): Response {
	return json({ error: "Method not allowed" }, 405, { Allow: allowed.join(", ") });
}

function parseBearer(header: string | null): string {
	if (header === null) return "";
	const match = /^Bearer[ \t]+(.+)$/i.exec(header);
	return match?.[1] ?? "";
}

export async function constantTimeTokenEqual(provided: string, expected: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [providedDigest, expectedDigest] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(provided)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	const providedBytes = new Uint8Array(providedDigest);
	const expectedBytes = new Uint8Array(expectedDigest);
	let difference = 0;
	for (let index = 0; index < expectedBytes.length; index += 1) {
		difference |= providedBytes[index] ^ expectedBytes[index];
	}
	return difference === 0;
}

async function requireUploadAuth(request: Request, env: Env): Promise<Response | null> {
	if (typeof env.UPLOAD_TOKEN !== "string" || env.UPLOAD_TOKEN.length === 0) {
		return json({ error: "Worker upload token is not configured" }, 500);
	}
	const provided = parseBearer(request.headers.get("Authorization"));
	return (await constantTimeTokenEqual(provided, env.UPLOAD_TOKEN))
		? null
		: json({ error: "Unauthorized" }, 401);
}

function randomSlug(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(SLUG_BYTES));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function uniqueSlug(kv: KVNamespace, timing: RequestTiming): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const slug = randomSlug();
		if ((await measure(timing, "kvMs", () => kv.get(`${SHARE_KEY_PREFIX}${slug}`))) === null)
			return slug;
	}
	throw new Error("Unable to allocate a unique share slug");
}

function expiryDays(header: string | null): number {
	if (header === null || header.trim() === "") return DEFAULT_EXPIRY_DAYS;
	return normalizeExpiryDays(Number(header));
}

async function lookupShare(
	kv: KVNamespace,
	slug: string,
	timing: RequestTiming,
	now = Date.now(),
): Promise<ShareLookup> {
	timing.shareHash = await sha256(`review-share-log:${slug}`);
	// KV defaults to 60 s, minimum 30 s; the explicit TTL preserves that existing window.
	// Revocation or shortened expiry can take up to 60 s to reach this edge.
	const stored = await measure(timing, "kvMs", () =>
		kv.get(`${SHARE_KEY_PREFIX}${slug}`, { cacheTtl: 60 }),
	);
	if (stored === null) return { state: "missing" };

	try {
		const share = JSON.parse(stored) as ShareMetadata;
		if (
			share.slug !== slug ||
			typeof share.expiresAt !== "string" ||
			typeof share.title !== "string"
		) {
			return { state: "missing" };
		}
		const expiry = Date.parse(share.expiresAt);
		if (!Number.isFinite(expiry)) return { state: "missing" };
		return expiry <= now ? { state: "expired", share } : { state: "active", share };
	} catch {
		return { state: "missing" };
	}
}

function apiShareError(lookup: ShareLookup): Response | null {
	if (lookup.state === "missing") return json({ error: "Review share not found" }, 404);
	if (lookup.state === "expired") return json({ error: "Review link has expired" }, 410);
	return null;
}

function decodePath(path: string): string | null {
	try {
		const decoded = decodeURIComponent(path);
		return validRelativePath(decoded) ? decoded : null;
	} catch {
		return null;
	}
}

function contentType(path: string): string {
	const dot = path.lastIndexOf(".");
	const extension = dot === -1 ? "" : path.slice(dot).toLowerCase();
	return ARTIFACT_MEDIA_TYPES[extension] ?? "application/octet-stream";
}

async function createShare(request: Request, env: Env, timing: RequestTiming): Promise<Response> {
	const authError = await requireUploadAuth(request, env);
	if (authError !== null) return authError;

	const slug = await uniqueSlug(env.REVIEW_KV, timing);
	const days = expiryDays(request.headers.get("X-Praxity-Expiry-Days"));
	const share: ShareMetadata = {
		slug,
		expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(),
		title: (request.headers.get("X-Praxity-Title") ?? "").slice(0, 200),
	};
	await env.REVIEW_KV.put(`${SHARE_KEY_PREFIX}${slug}`, JSON.stringify(share));

	const uploadUrl = new URL(`/api/publish/${slug}/file`, request.url).toString();
	// Return the server-computed expiry so clients render the authoritative
	// date rather than recomputing it (avoids build/upload clock skew).
	return json({ slug, uploadUrl, expiresAt: share.expiresAt }, 201);
}

async function uploadFile(
	request: Request,
	env: Env,
	slug: string,
	url: URL,
	timing: RequestTiming,
): Promise<Response> {
	const authError = await requireUploadAuth(request, env);
	if (authError !== null) return authError;

	const lookup = await lookupShare(env.REVIEW_KV, slug, timing);
	const shareError = apiShareError(lookup);
	if (shareError !== null) return shareError;

	const path = url.searchParams.get("path");
	if (path === null || !validRelativePath(path)) {
		return json({ error: "A valid relative path query parameter is required" }, 400);
	}

	await env.REVIEW_FILES.put(`${slug}/${path}`, request.body ?? new Uint8Array());
	return json({ ok: true, path }, 201);
}

function byteRange(
	header: string,
	size: number,
): { offset: number; length: number } | null | undefined {
	const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
	if (!match || (!match[1] && !match[2])) return undefined;
	const first = Number(match[1]);
	const last = Number(match[2]);
	if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return undefined;
	if (match[1] && match[2] && first > last) return undefined;
	const offset = match[1] ? first : Math.max(0, size - last);
	const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
	return offset > end ? null : { offset, length: end - offset + 1 };
}

async function serveFile(
	request: Request,
	env: Env,
	slug: string,
	encodedPath: string | undefined,
	timing: RequestTiming,
	ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
	const lookup = await lookupShare(env.REVIEW_KV, slug, timing);
	if (lookup.state === "missing") return json({ error: "Review share not found" }, 404);
	if (lookup.state === "expired") {
		return new Response(EXPIRED_PAGE, {
			status: 410,
			headers: {
				"Cache-Control": "no-store",
				"Content-Type": "text/html; charset=utf-8",
				"X-Content-Type-Options": "nosniff",
			},
		});
	}
	if (encodedPath === undefined) {
		const url = new URL(request.url);
		url.pathname += "/";
		return Response.redirect(url, 308);
	}

	const path = encodedPath === "" ? "index.html" : decodePath(encodedPath);
	if (path === null) return json({ error: "Invalid file path" }, 400);

	// Preserve R2's existing range and conditional semantics, including If-Range.
	const conditional = [...request.headers.keys()].some((name) => name.startsWith("if-"));
	const cacheKey =
		ctx && immutableFile(path) && !request.headers.has("Range") && !conditional
			? new Request(
					`${new URL(request.url).origin}/.review-cache/v1/${await sha256(lookup.share.slug)}/${await sha256(path)}`,
				)
			: null;
	if (cacheKey) {
		let cached: Response | undefined;
		try {
			cached = await measure(timing, "cacheMs", () => caches.default.match(cacheKey));
			timing.cache = cached ? "hit" : "miss";
		} catch {
			timing.cache = "bypass";
			timing.cacheMatchFailed = true;
		}
		if (cached) {
			// Cached bytes must not bypass R2 retention or manual deletion.
			const exists = await measure(timing, "r2Ms", () => env.REVIEW_FILES.head(`${slug}/${path}`));
			if (exists) return cached;
			return json({ error: "File not found" }, 404);
		}
	}

	const key = `${slug}/${path}`;
	const ifNoneMatch = request.headers.get("If-None-Match");
	const onlyIf = ifNoneMatch ? new Headers({ "If-None-Match": ifNoneMatch }) : undefined;
	const rangeHeader = request.headers.get("Range");
	let range: ReturnType<typeof byteRange>;
	let metadata: R2Object | null = null;
	if (rangeHeader) {
		metadata = await measure(timing, "r2Ms", () => env.REVIEW_FILES.head(key));
		if (metadata === null) return json({ error: "File not found" }, 404);
		const ifRange = request.headers.get("If-Range");
		// Date and weak validators cannot establish an exact representation match here.
		if (!ifRange || ifRange === metadata.httpEtag) range = byteRange(rangeHeader, metadata.size);
	}
	let object = await measure(timing, "r2Ms", () =>
		env.REVIEW_FILES.get(key, {
			onlyIf,
			// A minimal read lets R2 evaluate If-None-Match before a 416 response.
			range: range === null && metadata?.size ? { offset: 0, length: 1 } : (range ?? undefined),
		}),
	);
	if (object === null) return json({ error: "File not found" }, 404);
	if (range !== undefined && object.httpEtag !== metadata?.httpEtag) {
		if ("body" in object) await object.body.cancel();
		range = undefined;
		object = await measure(timing, "r2Ms", () => env.REVIEW_FILES.get(key, { onlyIf }));
		if (object === null) return json({ error: "File not found" }, 404);
	}

	const headers = new Headers({
		"Cache-Control": path.endsWith(".html")
			? "public, max-age=300"
			: "public, max-age=31536000, immutable",
		"Content-Type": contentType(path),
		ETag: object.httpEtag,
		"X-Content-Type-Options": "nosniff",
	});
	headers.set("Accept-Ranges", "bytes");
	if (!("body" in object)) return new Response(null, { status: 304, headers });
	if (range === null) {
		await object.body.cancel();
		headers.set("Content-Range", `bytes */${object.size}`);
		return new Response(null, { status: 416, headers });
	}
	headers.set("Content-Length", String(range?.length ?? object.size));
	if (range) {
		headers.set(
			"Content-Range",
			`bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
		);
	}
	const response = new Response(object.body, { status: range ? 206 : 200, headers });
	if (cacheKey && ctx && response.status === 200) {
		const cacheResponse = response.clone();
		ctx.waitUntil(
			Promise.resolve()
				.then(() => caches.default.put(cacheKey, cacheResponse))
				.catch(() => {
					console.log(
						JSON.stringify({ event: "review_share_cache_put_failed", shareHash: timing.shareHash }),
					);
				}),
		);
	}
	return response;
}

async function handleComments(
	request: Request,
	env: Env,
	slug: string,
	url: URL,
	timing: RequestTiming,
): Promise<Response> {
	const lookup = await lookupShare(env.REVIEW_KV, slug, timing);
	const shareError = apiShareError(lookup);
	if (shareError !== null) return shareError;

	if (request.method === "POST") return postComment(request, env.REVIEW_KV, slug);
	if (request.method === "GET")
		return getComments(env.REVIEW_KV, slug, url.searchParams.get("page"));
	return methodNotAllowed(["GET", "POST"]);
}

async function routeRequest(
	request: Request,
	env: Env,
	timing: RequestTiming,
	ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/api/publish") {
		return request.method === "POST"
			? createShare(request, env, timing)
			: methodNotAllowed(["POST"]);
	}

	const uploadMatch = /^\/api\/publish\/([A-Za-z0-9_-]{16,})\/file$/u.exec(url.pathname);
	if (uploadMatch !== null) {
		return request.method === "PUT"
			? uploadFile(request, env, uploadMatch[1], url, timing)
			: methodNotAllowed(["PUT"]);
	}

	const shareMatch = /^\/s\/([A-Za-z0-9_-]{16,})(?:\/(.*))?$/u.exec(url.pathname);
	if (shareMatch !== null) {
		if (shareMatch[2] === "comments") {
			return handleComments(request, env, shareMatch[1], url, timing);
		}
		return request.method === "GET"
			? serveFile(request, env, shareMatch[1], shareMatch[2], timing, ctx)
			: methodNotAllowed(["GET"]);
	}

	return json({ error: "Not found" }, 404);
}

export async function handleRequest(
	request: Request,
	env: Env,
	ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
	const timing: RequestTiming = { shareHash: null, kvMs: 0, r2Ms: 0, cacheMs: 0, cache: "bypass" };
	const start = performance.now();
	let status = 500;
	try {
		const response = await routeRequest(request, env, timing, ctx);
		status = response.status;
		return response;
	} catch {
		return json({ error: "Internal server error" }, 500);
	} finally {
		console.log(
			JSON.stringify({
				event: "review_share_request",
				...timing,
				status,
				totalMs: performance.now() - start,
			}),
		);
	}
}

const worker = {
	fetch: handleRequest,
};

export default worker;
