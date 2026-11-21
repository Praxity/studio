import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerView } from "../src/threads";
import { type Env, handleRequest, MAX_REQUEST_BYTES } from "../src/worker";

type View = LearnerView & { error?: string };

const TEAM = "example-team.cloudflareaccess.com";
const AUD = "course-help-aud";
const ORIGIN = "https://courses.example.org";
const schema = readFileSync(new URL("../migrations/0001_course_help.sql", import.meta.url), "utf8");

// A D1 stand-in over node:sqlite, so the tests run the real schema and SQL.
function d1(db: DatabaseSync): D1Database {
	const prepare = (sql: string) => {
		let params: (string | number | null)[] = [];
		const statement = {
			bind(...values: (string | number | null)[]) {
				params = values;
				return statement;
			},
			first: async () => db.prepare(sql).get(...params) ?? null,
			all: async () => ({ results: db.prepare(sql).all(...params) }),
			run: async () => ({ meta: { changes: db.prepare(sql).run(...params).changes } }),
		};
		return statement;
	};
	return { prepare } as unknown as D1Database;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
let signingKey: CryptoKey;
let strangerKey: CryptoKey;

async function sign(key: CryptoKey, claims: Record<string, unknown>, header = {}): Promise<string> {
	const unsigned = `${encode({ alg: "RS256", kid: "key-1", ...header })}.${encode(claims)}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(unsigned),
	);
	return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
}

const now = () => Math.floor(Date.now() / 1000);
const claims = (sub: string, email: string, extra: Record<string, unknown> = {}) => ({
	iss: `https://${TEAM}`,
	aud: [AUD],
	sub,
	email,
	exp: now() + 600,
	...extra,
});

let env: Env;
let tokens: Record<"ana" | "ben" | "staff", string>;

beforeAll(async () => {
	const generate = () =>
		crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		);
	const pair = await generate();
	signingKey = pair.privateKey;
	strangerKey = (await generate()).privateKey;
	const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "key-1" };
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			url === `https://${TEAM}/cdn-cgi/access/certs`
				? Response.json({ keys: [jwk] })
				: new Response("unexpected", { status: 500 }),
		),
	);
	tokens = {
		ana: await sign(signingKey, claims("user-ana", "ana@example.org")),
		ben: await sign(signingKey, claims("user-ben", "ben@example.org")),
		staff: await sign(signingKey, claims("user-staff", "Tutor@Example.org")),
	};
});

beforeEach(() => {
	const db = new DatabaseSync(":memory:");
	db.exec(schema);
	env = {
		DB: d1(db),
		ACCESS_TEAM_DOMAIN: TEAM,
		ACCESS_AUD: AUD,
		STAFF_EMAILS: "tutor@example.org, lead@example.org",
		COURSE_ORIGINS: "https://pages.example.net",
	};
});

afterEach(() => vi.useRealTimers());

function call(
	path: string,
	options: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {},
) {
	const headers = new Headers(options.headers);
	if (options.token !== null) headers.set("Cf-Access-Jwt-Assertion", options.token ?? tokens.ana);
	let body: string | undefined;
	if (options.body !== undefined) {
		body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
		if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	}
	return handleRequest(
		new Request(`${ORIGIN}/help${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers,
			body,
		}),
		env,
	);
}

const question = { pageId: "page-1", pageTitle: "Lifting safely", body: "Why bend the knees?" };

describe("Access identity", () => {
	it.each([
		["missing", null],
		["malformed", "not.a-token"],
		[
			"unsigned",
			`${encode({ alg: "none", kid: "key-1" })}.${encode(claims("x", "x@example.org"))}.`,
		],
	])("refuses a %s token", async (_, token) => {
		expect((await call("/threads", { token })).status).toBe(401);
	});

	it.each([
		["expired", () => sign(signingKey, claims("user-ana", "ana@example.org", { exp: now() - 5 }))],
		[
			"not yet valid",
			() => sign(signingKey, claims("user-ana", "ana@example.org", { nbf: now() + 300 })),
		],
		[
			"for another application",
			() => sign(signingKey, claims("user-ana", "ana@example.org", { aud: ["other"] })),
		],
		[
			"from another team",
			() =>
				sign(signingKey, claims("user-ana", "ana@example.org", { iss: "https://evil.example" })),
		],
		["signed by another key", () => sign(strangerKey, claims("user-ana", "ana@example.org"))],
		["without an email", () => sign(signingKey, claims("service-token", ""))],
		[
			"naming an unknown key",
			() => sign(signingKey, claims("user-ana", "ana@example.org"), { kid: "key-2" }),
		],
	])("refuses a token %s", async (_, token) => {
		const response = await call("/threads", { token: await token() });
		expect(response.status).toBe(401);
		expect(await response.json<View>()).toEqual({ error: "unauthenticated" });
	});

	it("checks identity before revealing whether a path exists", async () => {
		expect((await call("/nowhere", { token: null })).status).toBe(401);
		expect((await call("/nowhere")).status).toBe(404);
	});
});

describe("learner threads", () => {
	it("asks, replies and lists only the learner's own threads", async () => {
		const asked = await call("/threads", {
			body: { ...question, quote: "  Keep your back straight  " },
		});
		expect(asked.status).toBe(201);
		const { threads } = await asked.json<View>();
		expect(threads).toEqual([
			expect.objectContaining({
				pageId: "page-1",
				pageTitle: "Lifting safely",
				quote: "Keep your back straight",
				body: "Why bend the knees?",
				replies: [],
			}),
		]);
		const replied = await call(`/threads/${threads[0].id}/replies`, {
			body: { body: "Also, how far?" },
		});
		expect(replied.status).toBe(201);
		expect((await replied.json<View>()).threads[0].replies).toEqual([
			expect.objectContaining({ body: "Also, how far?", fromStaff: false }),
		]);

		expect(await (await call("/threads", { token: tokens.ben })).json<View>()).toEqual({
			threads: [],
			unread: 0,
		});
	});

	it("refuses a reply to another learner's thread without saving it", async () => {
		const { threads } = await (await call("/threads", { body: question })).json<View>();
		const response = await call(`/threads/${threads[0].id}/replies`, {
			token: tokens.ben,
			body: { body: "Hijack" },
		});
		expect(response.status).toBe(404);
		expect((await (await call("/threads")).json<View>()).threads[0].replies).toEqual([]);
		expect(await (await call("/threads", { token: tokens.ben })).json<View>()).toEqual({
			threads: [],
			unread: 0,
		});
	});

	it.each([
		["a body over 2,000 characters", { ...question, body: "x".repeat(2001) }, 413],
		["a quote over 300 characters", { ...question, quote: "x".repeat(301) }, 413],
		["a request over 16 KiB", `{"pageId":"p","body":"${"x".repeat(MAX_REQUEST_BYTES)}"}`, 413],
		["an empty body", { ...question, body: "   " }, 400],
		["no page", { body: "Hello" }, 400],
		["an unknown field", { ...question, email: "staff@example.org" }, 400],
		["malformed JSON", "{", 400],
	])("refuses %s", async (_, body, status) => {
		expect((await call("/threads", { body })).status).toBe(status);
		expect((await (await call("/threads")).json<View>()).threads).toEqual([]);
	});

	it("refuses form posts, which a cross-site page could send without a preflight", async () => {
		const response = await call("/threads", {
			body: "body=hi",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		});
		expect(response.status).toBe(415);
	});

	it("allows 10 messages a minute per learner, then 429 until the minute passes", async () => {
		const start = Date.now();
		vi.useFakeTimers({ now: start, toFake: ["Date"] });
		const token = await sign(signingKey, claims("user-ana", "ana@example.org"));
		for (let i = 0; i < 10; i++) {
			expect((await call("/threads", { token, body: { ...question, body: `Q${i}` } })).status).toBe(
				201,
			);
		}
		const limited = await call("/threads", { token, body: question });
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		const { threads } = await (await call("/threads", { token })).json<View>();
		expect(
			(await call(`/threads/${threads[0].id}/replies`, { token, body: { body: "more" } })).status,
		).toBe(429);
		expect((await call("/threads", { token: tokens.ben, body: question })).status).toBe(201);
		vi.setSystemTime(start + 61_000);
		expect((await call("/threads", { token, body: question })).status).toBe(201);
	});
});

describe("staff", () => {
	it("lets staff see every thread and reply; the learner sees the reply as unread until read", async () => {
		const asked = await call("/threads", {
			body: { ...question, body: "<script>alert(1)</script>" },
		});
		const threadId = (await asked.json<View>()).threads[0].id;
		await call("/threads", { token: tokens.ben, body: { ...question, body: "Ben's question" } });

		const page = await call("/staff", { token: tokens.staff });
		expect(page.status).toBe(200);
		expect(page.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
		const markup = await page.text();
		expect(markup).toContain("ana@example.org");
		expect(markup).toContain("ben@example.org");
		expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(markup).not.toContain("<script>alert");
		expect(markup).toContain(`action="/help/staff/threads/${threadId}/replies"`);

		const reply = await call(`/staff/threads/${threadId}/replies`, {
			token: tokens.staff,
			body: "body=Bend+to+protect+your+back",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN },
		});
		expect(reply.status).toBe(303);
		expect(reply.headers.get("Location")).toBe(`/help/staff#thread-${threadId}`);

		const view = await (await call("/threads")).json<View>();
		expect(view.unread).toBe(1);
		expect(view.threads[0].replies).toEqual([
			expect.objectContaining({ body: "Bend to protect your back", fromStaff: true, read: false }),
		]);
		const read = await call("/read", { body: {} });
		expect((await read.json<View>()).unread).toBe(0);
		expect((await (await call("/threads", { token: tokens.ben })).json<View>()).unread).toBe(0);
	});

	it("refuses the staff page and replies to learners and cross-site posts", async () => {
		const { threads } = await (await call("/threads", { body: question })).json<View>();
		expect((await call("/staff", { token: tokens.ana })).status).toBe(403);
		const form = { "Content-Type": "application/x-www-form-urlencoded" };
		expect(
			(
				await call(`/staff/threads/${threads[0].id}/replies`, {
					token: tokens.ana,
					body: "body=x",
					headers: form,
				})
			).status,
		).toBe(403);
		expect(
			(
				await call(`/staff/threads/${threads[0].id}/replies`, {
					token: tokens.staff,
					body: "body=x",
					headers: { ...form, Origin: "https://evil.example" },
				})
			).status,
		).toBe(403);
		expect((await (await call("/threads")).json<View>()).threads[0].replies).toEqual([]);
	});
});

describe("cross-origin course pages", () => {
	it("gives listed course origins credentialed CORS and refuses others", async () => {
		const listed = await call("/threads", { headers: { Origin: "https://pages.example.net" } });
		expect(listed.status).toBe(200);
		expect(listed.headers.get("Access-Control-Allow-Origin")).toBe("https://pages.example.net");
		expect(listed.headers.get("Access-Control-Allow-Credentials")).toBe("true");

		const preflight = await handleRequest(
			new Request(`${ORIGIN}/help/threads`, {
				method: "OPTIONS",
				headers: { Origin: "https://pages.example.net" },
			}),
			env,
		);
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");

		const unlisted = await call("/threads", {
			body: question,
			headers: { Origin: "https://evil.example" },
		});
		expect(unlisted.status).toBe(403);
		expect(unlisted.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(
			(
				await call("/staff", {
					token: tokens.staff,
					headers: { Origin: "https://pages.example.net" },
				})
			).status,
		).toBe(403);
	});
});
