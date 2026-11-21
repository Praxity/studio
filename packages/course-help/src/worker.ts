import { type AccessIdentity, verifyAccessJwt } from "./access";
import { staffPage } from "./staff-page";
import {
	allThreads,
	ask,
	type Invalid,
	type Learner,
	learnerReply,
	learnerView,
	markRead,
	parseQuestion,
	parseReply,
	staffReply,
} from "./threads";

export interface Env {
	DB: D1Database;
	ACCESS_TEAM_DOMAIN: string;
	ACCESS_AUD: string;
	/** Comma-separated staff email addresses. */
	STAFF_EMAILS?: string;
	/** Comma-separated origins of course pages served from another origin. */
	COURSE_ORIGINS?: string;
	STAFF_LOCALE?: string;
}

/** Largest accepted request body, in bytes. */
export const MAX_REQUEST_BYTES = 16 * 1024;

const list = (value: string | undefined) =>
	(value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const SECURITY_HEADERS = {
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
};

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
	const response = new Response(JSON.stringify(body), { status, headers });
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	response.headers.set("Content-Type", "application/json; charset=utf-8");
	return response;
}

function html(body: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: {
			...SECURITY_HEADERS,
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy":
				"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
		},
	});
}

const failure = (error: Invalid) =>
	error === "too_large" ? json({ error }, 413) : json({ error }, 400);

// Reads at most MAX_REQUEST_BYTES, stopping early, so a body sent without Content-Length can't be buffered whole.
async function readBody(request: Request): Promise<string | null> {
	if (Number(request.headers.get("Content-Length") ?? 0) > MAX_REQUEST_BYTES) return null;
	if (!request.body) return "";
	const reader = request.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_REQUEST_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

/** Same-origin requests need no CORS headers; listed course origins get credentialed CORS. */
function crossOrigin(request: Request, env: Env): { allowed: boolean; origin: string | null } {
	const origin = request.headers.get("Origin");
	if (!origin || origin === new URL(request.url).origin) return { allowed: true, origin: null };
	// "null" is the origin of file:// pages and sandboxed frames on any site, so it is never allowed.
	return { allowed: origin !== "null" && list(env.COURSE_ORIGINS).includes(origin), origin };
}

function withCors(response: Response, origin: string | null): Response {
	if (!origin) return response;
	response.headers.set("Access-Control-Allow-Origin", origin);
	response.headers.set("Access-Control-Allow-Credentials", "true");
	response.headers.append("Vary", "Origin");
	return response;
}

async function learnerRoute(
	request: Request,
	env: Env,
	learner: Learner,
	route: { action: "threads" | "read" | "reply"; threadId?: number },
): Promise<Response> {
	if (route.action === "threads" && request.method === "GET") {
		return json(await learnerView(env.DB, learner.id));
	}
	if (request.method !== "POST")
		return json({ error: "method_not_allowed" }, 405, { Allow: "GET, POST" });
	// JSON writes can't come from a cross-site form, and a cross-origin script needs a CORS preflight.
	if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
		return json({ error: "unsupported_media_type" }, 415);
	}
	const raw = await readBody(request);
	if (raw === null) return json({ error: "too_large" }, 413);
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return json({ error: "invalid" }, 400);
	}
	if (route.action === "read") {
		await markRead(env.DB, learner.id);
		return json(await learnerView(env.DB, learner.id));
	}
	if (route.action === "threads") {
		const question = parseQuestion(value);
		if (typeof question === "string") return failure(question);
		if (!(await ask(env.DB, learner, question))) {
			return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
		}
		return json(await learnerView(env.DB, learner.id), 201);
	}
	const body = parseReply(value);
	if (body === "invalid" || body === "too_large") return failure(body);
	const saved = await learnerReply(env.DB, learner, route.threadId as number, body);
	if (saved === "not_found") return json({ error: "not_found" }, 404);
	if (saved === "rate_limited")
		return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
	return json(await learnerView(env.DB, learner.id), 201);
}

async function staffRoute(
	request: Request,
	env: Env,
	prefix: string,
	threadId: number | null,
): Promise<Response> {
	const locale = env.STAFF_LOCALE === "fr" ? "fr" : "en";
	if (threadId === null) {
		if (request.method !== "GET")
			return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
		return html(staffPage(await allThreads(env.DB), prefix, locale));
	}
	if (request.method !== "POST")
		return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
	const origin = request.headers.get("Origin");
	if (
		(origin && origin !== new URL(request.url).origin) ||
		request.headers.get("Sec-Fetch-Site") === "cross-site"
	) {
		return json({ error: "forbidden" }, 403);
	}
	if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
		return json({ error: "unsupported_media_type" }, 415);
	}
	const raw = await readBody(request);
	if (raw === null) return json({ error: "too_large" }, 413);
	const body = parseReply({ body: new URLSearchParams(raw).get("body") ?? "" });
	if (body === "invalid" || body === "too_large") return failure(body);
	if (!(await staffReply(env.DB, threadId, body))) return json({ error: "not_found" }, 404);
	return new Response(null, {
		status: 303,
		headers: { ...SECURITY_HEADERS, Location: `${prefix}/staff#thread-${threadId}` },
	});
}

// The Worker can be mounted under any path, such as /help/*, so routes match the path's end.
const ROUTES: [RegExp, (match: RegExpMatchArray) => Route][] = [
	[/^(.*)\/staff\/?$/u, (m) => ({ kind: "staff", prefix: m[1] ?? "", threadId: null })],
	[
		/^(.*)\/staff\/threads\/(\d{1,15})\/replies$/u,
		(m) => ({ kind: "staff", prefix: m[1] ?? "", threadId: Number(m[2]) }),
	],
	[/^.*\/threads$/u, () => ({ kind: "learner", action: "threads" })],
	[
		/^.*\/threads\/(\d{1,15})\/replies$/u,
		(m) => ({ kind: "learner", action: "reply", threadId: Number(m[1]) }),
	],
	[/^.*\/read$/u, () => ({ kind: "learner", action: "read" })],
];

type Route =
	| { kind: "staff"; prefix: string; threadId: number | null }
	| { kind: "learner"; action: "threads" | "read" | "reply"; threadId?: number };

function matchRoute(pathname: string): Route | null {
	// A path starting "//" would make the route prefix a protocol-relative URL in the staff form and redirect.
	if (pathname.startsWith("//")) return null;
	for (const [pattern, build] of ROUTES) {
		const match = pathname.match(pattern);
		if (match) return build(match);
	}
	return null;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
	const { allowed, origin } = crossOrigin(request, env);
	if (!allowed) return json({ error: "forbidden" }, 403);
	if (request.method === "OPTIONS") {
		// Preflights carry no credentials; Access must be set to let them through.
		return withCors(
			new Response(null, {
				status: 204,
				headers: {
					"Access-Control-Allow-Methods": "GET, POST",
					"Access-Control-Allow-Headers": "Accept, Content-Type",
					"Access-Control-Max-Age": "600",
				},
			}),
			origin,
		);
	}
	// Verify identity before routing, so unknown paths reveal nothing either.
	let identity: AccessIdentity | null;
	try {
		identity = await verifyAccessJwt(request.headers.get("Cf-Access-Jwt-Assertion"), env);
	} catch (error) {
		console.error("[course-help] Access key fetch failed:", error);
		return withCors(json({ error: "unavailable" }, 503), origin);
	}
	if (!identity) return withCors(json({ error: "unauthenticated" }, 401), origin);
	const route = matchRoute(new URL(request.url).pathname);
	if (!route) return withCors(json({ error: "not_found" }, 404), origin);
	if (route.kind === "staff") {
		// The staff page is same-origin only and never gets CORS headers.
		if (origin || !list(env.STAFF_EMAILS).some((email) => email.toLowerCase() === identity.email)) {
			return json({ error: "forbidden" }, 403);
		}
		return staffRoute(request, env, route.prefix, route.threadId);
	}
	const learner = { id: identity.sub, email: identity.email };
	return withCors(await learnerRoute(request, env, learner, route), origin);
}

export default {
	fetch: handleRequest,
} satisfies ExportedHandler<Env>;
