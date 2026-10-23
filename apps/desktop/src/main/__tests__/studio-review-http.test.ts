import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { type IncomingHttpHeaders, METHODS, request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
	ReviewAnchor,
	ReviewState,
	ReviewVisibilityPolicy,
} from "@praxity/review-share/review";
import { create } from "@praxity/review-share/review";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withProjectFileTransaction } from "../project-file-transactions";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { openReviewStore, ReviewStoreError } from "../studio/review-store";
import { startStudioServer } from "../studio/server";

const roots: string[] = [];
const servers: { close(): Promise<void> }[] = [];
const editorOrigin = "http://127.0.0.1:1";
const anchor: ReviewAnchor = {
	courseId: null,
	lessonId: null,
	pageId: "page-1",
	nodeId: null,
	blockId: null,
	revision: null,
	quote: null,
	pin: null,
	tab: null,
	revealPath: [],
	cssPath: null,
	context: { pageTitle: "Page one", targetLabel: null },
};
const csp =
	"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

async function running(enabled = true, policy?: ReviewVisibilityPolicy) {
	const root = await mkdtemp(join(tmpdir(), "studio-review-http-"));
	roots.push(root);
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "assets", "sample.txt"), "sample");
	const store = await openReviewStore(root, policy);
	const capability = randomBytes(32).toString("base64url");
	const server = await startStudioReadOnlyServer({
		projectDir: root,
		getEditorOrigin: () => editorOrigin,
		...(enabled ? { review: { store, capability } } : {}),
	});
	servers.push(server);
	const route = `/api/reviews/${store.reviewId}/comments`;
	const headers = {
		"X-Praxity-Review": capability,
		Origin: server.origin,
		"Content-Type": "application/json",
	};
	const payload = { reviewId: store.reviewId, requestId: randomUUID(), anchor, body: "Comment" };
	return { root, store, server, capability, route, headers, payload };
}

function probe(
	origin: string,
	path: string,
	options: {
		method?: string;
		headers?: Record<string, string> | string[];
		body?: string | Buffer;
		chunks?: string[];
		artifactCors?: boolean;
	} = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> {
	return new Promise((resolve, reject) => {
		const req = request(
			origin,
			{ path, method: options.method ?? "GET", headers: options.headers, agent: false },
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					text += chunk;
				});
				res.on("end", () => {
					if (!options.artifactCors)
						for (const name of Object.keys(res.headers))
							expect(name).not.toMatch(/^access-control-/);
					resolve({ status: res.statusCode ?? 0, headers: res.headers, text });
				});
			},
		);
		req.on("error", reject);
		for (const chunk of options.chunks ?? []) req.write(chunk);
		req.end(options.body);
	});
}

it.each([true, false])(
	"handles a pre-upgrade C1 retry over HTTP with visibility=%s",
	async (visible) => {
		const f = await running(true, { visibleTo: () => visible });
		const principal = await f.store.principalFor("reviewer", "local-preview");
		const path = join(f.root, ".praxity/reviews", f.store.reviewId, "comments.json");
		const empty: ReviewState = JSON.parse(await readFile(path, "utf8"));
		const seeded = await create(empty, principal, f.payload, {
			now: () => "2026-10-19T00:00:00.000Z",
			uuid: randomUUID,
		});
		if (!seeded.ok) throw new Error("Could not seed receipt fixture");
		const payload = { ...f.payload, body: "Legacy\u009b comment" };
		seeded.state.threads[0].messages[0].body = payload.body;
		// Literal contract key order for this fixture's canonical create request.
		const canonical = {
			kind: "create",
			payload: {
				anchor: {
					blockId: null,
					context: { pageTitle: "Page one", targetLabel: null },
					courseId: null,
					cssPath: null,
					lessonId: null,
					nodeId: null,
					pageId: "page-1",
					pin: null,
					quote: null,
					revealPath: [],
					revision: null,
					tab: null,
				},
				body: payload.body,
				requestId: payload.requestId,
				reviewId: payload.reviewId,
			},
		};
		seeded.state.receipts[0].digest = createHash("sha256")
			.update(JSON.stringify(canonical))
			.digest("hex");
		const saved = JSON.stringify(seeded.state);
		await writeFile(path, saved);
		const result = await probe(f.server.origin, f.route, {
			method: "POST",
			headers: f.headers,
			body: JSON.stringify(payload),
		});
		expect(result.status).toBe(visible ? 200 : 404);
		if (visible) {
			expect(JSON.parse(result.text)).toMatchObject({
				ok: true,
				replayed: true,
				thread: { version: 1, messages: [{ body: "Legacy\u009b comment" }] },
			});
		} else expect(JSON.parse(result.text)).toMatchObject({ ok: false, code: "not_found" });
		expect(await readFile(path, "utf8")).toBe(saved);
	},
);

let admissionFixture: Awaited<ReturnType<typeof running>>;
beforeAll(async () => {
	// Admission refusals share an empty review; mutations use separate courses below.
	admissionFixture = await running();
});
afterAll(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

it("pins the list principal to the local reviewer and refuses author role injection", async () => {
	const { server, route, headers, store } = admissionFixture;
	const localPrincipal = await store.principalFor("reviewer", "local-preview");
	const listed = await probe(server.origin, route, {
		headers: { ...headers, "X-Role": "author", "X-Principal-Id": "other" },
	});
	expect(listed.status).toBe(200);
	expect(JSON.parse(listed.text).principal).toEqual({ id: localPrincipal.id, role: "reviewer" });
	const refused = await probe(server.origin, `${route}?role=author`, { headers });
	expect(refused.status).toBe(422);
});

it.each([
	undefined,
	"",
	randomBytes(31).toString("base64url"),
	`${randomBytes(32).toString("base64url")}=`,
	`${randomBytes(32).toString("base64url")}!`,
	`${randomBytes(32).toString("base64url")}\n`,
	`${"A".repeat(42)}B`,
])("refuses invalid caller review capability %# before binding", async (capability) => {
	let started: Awaited<ReturnType<typeof startStudioReadOnlyServer>> | undefined;
	const startup = startStudioReadOnlyServer({
		projectDir: admissionFixture.root,
		getEditorOrigin: () => editorOrigin,
		review: { store: admissionFixture.store, capability: capability as string },
	}).then((server) => {
		started = server;
		servers.push(server);
		return server;
	});
	await expect(startup.then(() => undefined)).rejects.toThrow(
		"Review capability must encode at least 32 random bytes as canonical base64url",
	);
	expect(started === undefined).toBe(true);
});

it("accepts a caller capability longer than 32 bytes", async () => {
	const capability = randomBytes(48).toString("base64url");
	const server = await startStudioReadOnlyServer({
		projectDir: admissionFixture.root,
		getEditorOrigin: () => editorOrigin,
		review: { store: admissionFixture.store, capability },
	});
	servers.push(server);
	expect(
		(
			await probe(server.origin, admissionFixture.route, {
				headers: { "X-Praxity-Review": capability },
			})
		).status,
	).toBe(200);
});

it("without the review option every review route and ordinary HTTP method preserves empty 404/405", async () => {
	const { server, route } = await running(false);
	expect(Object.hasOwn(server, "review")).toBe(false);
	const reviewRoot = route.slice(0, -"/comments".length);
	const threadId = randomUUID();
	const paths = [
		reviewRoot,
		route,
		`${route}?page=page-1&limit=1`,
		`${route}/${threadId}/reply`,
		`${route}/${threadId}/reopen`,
		`${route}/${threadId}/resolve`,
		[reviewRoot, "context"].join("/"),
		`${reviewRoot}/drafts/${randomUUID()}`,
		`${reviewRoot}/unknown`,
	];
	// CONNECT is rejected by the listener's tunnel handler before route dispatch.
	for (const method of METHODS.filter((method) => method !== "CONNECT")) {
		await Promise.all(
			paths.map(async (path) => {
				const body = JSON.stringify(admissionFixture.payload);
				await Promise.all(
					[
						{ method },
						{
							method,
							headers: {
								...admissionFixture.headers,
								Origin: server.origin,
								"Content-Length": String(Buffer.byteLength(body)),
							},
							body,
						},
					].map(async (options) => {
						const response = await probe(server.origin, path, options);
						expect(response.status, `${method} ${path}`).toBe(
							method === "GET" || method === "HEAD" ? 404 : 405,
						);
						expect(response.text).toBe("");
						expect(response.headers).toEqual({
							date: expect.any(String),
							"content-security-policy": csp,
							"referrer-policy": "no-referrer",
							"cache-control": "no-store",
							"x-content-type-options": "nosniff",
							connection: "close",
							...(method === "HEAD" ? {} : { "transfer-encoding": "chunked" }),
						});
					}),
				);
			}),
		);
	}
});

describe.each([0, 1])("serialized state byte boundary +%s", (overflow) => {
	let fixture: Awaited<ReturnType<typeof running>>;
	let path: string;
	beforeAll(async () => {
		fixture = await running();
		const { root, store, payload } = fixture;
		const principal = await store.principalFor("reviewer", "local-preview");
		const seed = await store.create(principal, { ...payload, requestId: randomUUID() });
		if (!seed.ok || !seed.thread) throw new Error("Missing byte boundary seed");
		const seedMessage = seed.thread.messages[0];
		path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
		const state: ReviewState = JSON.parse(await readFile(path, "utf8"));
		state.receipts = [];
		state.changeSeq = 1100;
		state.threads[0].version = 1100;
		state.threads[0].messages = Array.from({ length: 1100 }, () => ({
			...seedMessage,
			id: randomUUID(),
			body: "x".repeat(2000),
		}));
		const candidate = await create(state, principal, payload, {
			now: () => "2026-10-19T00:00:00.000Z",
			uuid: randomUUID,
		});
		if (!candidate.ok) throw new Error("Refused byte fixture candidate");
		let remaining = 3670016 + overflow - Buffer.byteLength(JSON.stringify(candidate.state));
		for (const message of state.threads[0].messages) {
			const extra = Math.min(remaining, 2000);
			message.body = "é".repeat(extra) + "x".repeat(2000 - extra);
			remaining -= extra;
		}
		expect(remaining).toBe(0);
		await writeFile(path, JSON.stringify(state));
	});
	it("admits 3670016 bytes and its retry, refuses 3670017 without publishing", async () => {
		const { server, route, headers, payload, store } = fixture;
		const before = await readFile(path);
		const response = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		expect(response.status).toBe(overflow === 0 ? 200 : 409);
		if (overflow) {
			expect(JSON.parse(response.text)).toEqual({
				ok: false,
				code: "limit_reached",
				detail: { path: "$.bytes" },
			});
			expect((await readFile(path)).equals(before)).toBe(true);
			const state: ReviewState = JSON.parse(before.toString("utf8"));
			const author = await store.principalFor("author", "local-cli");
			const resolved = await store.resolve(author, {
				reviewId: store.reviewId,
				threadId: state.threads[0].id,
				expectVersion: 1100,
				requestId: randomUUID(),
				body: "Author resolution ".padEnd(2000, "x"),
			});
			expect(resolved.ok).toBe(true);
			const bytes = (await readFile(path)).byteLength;
			expect(bytes).toBeGreaterThan(3670016);
			expect(bytes).toBeLessThanOrEqual(4194304);
			const visible = await probe(server.origin, route, { headers });
			expect(visible.status).toBe(200);
			expect(JSON.parse(visible.text).threads[0].status).toBe("resolved");
		} else {
			expect((await readFile(path)).byteLength).toBe(3670016);
			const retry = await probe(server.origin, route, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
			});
			expect(retry.status).toBe(200);
			expect(JSON.parse(retry.text)).toMatchObject({
				ok: true,
				replayed: true,
				receipt: JSON.parse(response.text).receipt,
			});
			expect((await readFile(path)).byteLength).toBe(3670016);
		}
	});
});

it("refuses C0 controls in all HTTP free-text fields while preserving LF and TAB", async () => {
	const { server, route, headers, payload } = await running();
	for (const [input, path] of [
		[{ ...payload, body: "x\u0000" }, "$.body"],
		[{ ...payload, anchor: { ...anchor, revision: "x\r" } }, "$.anchor.revision"],
		[{ ...payload, anchor: { ...anchor, cssPath: "x\u0001" } }, "$.anchor.cssPath"],
		[
			{
				...payload,
				anchor: {
					...anchor,
					quote: { type: "TextQuoteSelector", exact: "x\u0001", prefix: "", suffix: "" },
				},
			},
			"$.anchor.quote.exact",
		],
		[
			{ ...payload, anchor: { ...anchor, context: { pageTitle: "x\u0001", targetLabel: null } } },
			"$.anchor.context.pageTitle",
		],
		[
			{ ...payload, anchor: { ...anchor, context: { pageTitle: null, targetLabel: "x\u0001" } } },
			"$.anchor.context.targetLabel",
		],
	] as const) {
		const response = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		expect(response.status).toBe(422);
		expect(JSON.parse(response.text)).toEqual({
			ok: false,
			code: "invalid_input",
			detail: { path },
		});
	}
	const allowed = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...payload, body: "Line\n\tIndented" }),
	});
	expect(allowed.status).toBe(200);
	expect(JSON.parse(allowed.text).thread.messages[0].body).toBe("Line\n\tIndented");
});

it("persists CRLF bodies unchanged over HTTP and refuses lone CR without writes", async () => {
	const { server, route, headers, payload } = await running();
	const created = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...payload, body: "Windows\r\n\tfeedback\r\n" }),
	});
	expect(created.status).toBe(200);
	expect(JSON.parse(created.text).thread.messages[0].body).toBe("Windows\r\n\tfeedback\r\n");
	const before = await probe(server.origin, route, { headers });
	expect(JSON.parse(before.text).threads[0].messages[0].body).toBe("Windows\r\n\tfeedback\r\n");
	const refused = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...payload, requestId: randomUUID(), body: "Lone\rCR" }),
	});
	expect(refused.status).toBe(422);
	expect(JSON.parse(refused.text)).toEqual({
		ok: false,
		code: "invalid_input",
		detail: { path: "$.body" },
	});
	expect((await probe(server.origin, route, { headers })).text).toBe(before.text);
});

describe("author response at a full thread", () => {
	let fixture: Awaited<ReturnType<typeof running>>;
	let threadId: string;
	beforeAll(async () => {
		fixture = await running();
		const { store, root, payload } = fixture;
		const seed = await store.create(await store.principalFor("reviewer", "local-preview"), payload);
		if (!seed.ok || !seed.thread) throw new Error("Missing full-thread seed");
		const seedMessage = seed.thread.messages[0];
		threadId = seed.thread.id;
		const path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
		const state: ReviewState = JSON.parse(await readFile(path, "utf8"));
		state.changeSeq = 100;
		state.receipts = [];
		state.threads[0].version = 100;
		state.threads[0].messages = Array.from({ length: 100 }, () => ({
			...seedMessage,
			id: randomUUID(),
		}));
		await writeFile(path, JSON.stringify(state));
	});
	it("keeps author resolve and reply visible through HTTP at 100 messages", async () => {
		const { server, route, headers, store } = fixture;
		const before = await probe(server.origin, route, { headers });
		expect(JSON.parse(before.text).threads[0].messages).toHaveLength(100);
		const principal = await store.principalFor("author", "local-cli");
		expect(
			(
				await store.resolve(principal, {
					reviewId: store.reviewId,
					threadId,
					expectVersion: 100,
					requestId: randomUUID(),
					body: "Resolved at capacity",
				})
			).ok,
		).toBe(true);
		expect(
			(
				await store.reply(principal, {
					reviewId: store.reviewId,
					threadId,
					expectVersion: 101,
					requestId: randomUUID(),
					body: "Author context",
				})
			).ok,
		).toBe(true);
		const after = await probe(server.origin, route, { headers });
		expect(after.status).toBe(200);
		const thread = JSON.parse(after.text).threads[0];
		expect(thread).toMatchObject({ version: 102, status: "resolved" });
		expect(thread.messages).toHaveLength(102);
		expect(thread.messages.slice(-2).map((message: { body: string }) => message.body)).toEqual([
			"Resolved at capacity",
			"Author context",
		]);
	});
});

describe("durable creation", () => {
	let fixture: Awaited<ReturnType<typeof running>>;
	beforeAll(async () => {
		fixture = await running();
	});
	it("creates, lists and retries durable comments as the local reviewer", async () => {
		const { root, server, store, route, headers, payload, capability } = fixture;
		const created = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		expect(created.status).toBe(200);
		const result = JSON.parse(created.text);
		expect(result).toMatchObject({
			ok: true,
			replayed: false,
			receipt: { version: 1 },
			thread: {
				reviewId: store.reviewId,
				status: "open",
				messages: [{ body: "Comment", provenance: "local-preview", actor: { role: "reviewer" } }],
			},
		});
		expect(result.state).toBeUndefined();
		expect(created.text.includes(capability)).toBe(false);
		const principal = await store.principalFor("author", "local-cli");
		expect(result.thread.messages[0].actor.id).toBe(principal.id);
		const retry = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		expect(retry.status).toBe(200);
		expect(JSON.parse(retry.text)).toMatchObject({
			ok: true,
			replayed: true,
			receipt: result.receipt,
		});
		const listed = await probe(server.origin, `${route}?page=page-1&status=open&limit=1`, {
			headers,
		});
		expect(listed.status).toBe(200);
		expect(JSON.parse(listed.text)).toMatchObject({
			ok: true,
			threads: [{ id: result.thread.id }],
			nextCursor: null,
		});
		const persisted = await (await openReviewStore(root)).list(principal);
		expect(persisted).toMatchObject({
			threads: [{ version: 1, messages: [{ body: "Comment" }] }],
			nextCursor: null,
		});
	});
});

describe("durable lifecycle", () => {
	let fixture: Awaited<ReturnType<typeof running>>;
	let threadId: string;
	beforeAll(async () => {
		fixture = await running();
		const { store, payload } = fixture;
		const result = await store.create(
			await store.principalFor("reviewer", "local-preview"),
			payload,
		);
		if (!result.ok || !result.thread) throw new Error("Missing visible fixture thread");
		threadId = result.thread.id;
	});
	it("replies and reopens after an author resolution, visible to a reopened store", async () => {
		const { root, server, store, route, headers } = fixture;
		const principal = await store.principalFor("author", "local-cli");
		const replyPayload = {
			reviewId: store.reviewId,
			threadId,
			requestId: randomUUID(),
			expectVersion: 1,
			body: "Reply",
		};
		const reply = await probe(server.origin, `${route}/${threadId}/reply`, {
			method: "POST",
			headers,
			body: JSON.stringify(replyPayload),
		});
		expect(reply.status).toBe(200);
		expect(JSON.parse(reply.text)).toMatchObject({
			ok: true,
			thread: { version: 2, messages: [{ body: "Comment" }, { body: "Reply" }] },
		});
		expect(
			(
				await store.resolve(principal, {
					...replyPayload,
					requestId: randomUUID(),
					expectVersion: 2,
					body: "Done",
				})
			).ok,
		).toBe(true);
		const reopened = await probe(server.origin, `${route}/${threadId}/reopen`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				reviewId: store.reviewId,
				threadId,
				requestId: randomUUID(),
				expectVersion: 3,
			}),
		});
		expect(reopened.status).toBe(200);
		expect(JSON.parse(reopened.text)).toMatchObject({
			ok: true,
			thread: { status: "open", version: 4 },
		});
		const persisted = await (await openReviewStore(root)).list(principal);
		expect(persisted).toMatchObject({
			threads: [
				{ version: 4, messages: [{ body: "Comment" }, { body: "Reply" }, { body: "Done" }] },
			],
		});
	});
});

it.each(["Host", "Origin", "Authorization", "Content-Type", "X-Praxity-Review"])(
	"refuses duplicate %s before authentication",
	async (name) => {
		const { server, route, headers, payload } = admissionFixture;
		const raw = Object.entries({ Host: new URL(server.origin).host, ...headers }).flat();
		raw.push(name, name === "Host" ? new URL(server.origin).host : "duplicate");
		if (name === "Authorization") raw.push(name, "duplicate");
		const response = await probe(server.origin, route, {
			method: "POST",
			headers: raw,
			body: JSON.stringify(payload),
		});
		expect(response.status).toBe(400);
		expect(JSON.parse(response.text)).toEqual({ ok: false, code: "duplicate_header", detail: {} });
	},
);

it.each([undefined, "null", editorOrigin, "https://foreign.example"])(
	"refuses POST Origin %s",
	async (origin) => {
		const { server, route, headers, payload } = admissionFixture;
		const { Origin: _origin, ...rest } = headers;
		const response = await probe(server.origin, route, {
			method: "POST",
			headers: { ...rest, ...(origin ? { Origin: origin } : {}) },
			body: JSON.stringify(payload),
		});
		expect(response.status).toBe(403);
		expect(JSON.parse(response.text)).toEqual({ ok: false, code: "forbidden", detail: {} });
	},
);

it.each([
	"text/plain",
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"application/json; charset=iso-8859-1",
	"application/json; extra=x",
])("refuses content type %s", async (contentType) => {
	const { server, route, headers } = admissionFixture;
	const response = await probe(server.origin, route, {
		method: "POST",
		headers: { ...headers, "Content-Type": contentType },
		body: "{}",
	});
	expect(response.status).toBe(415);
	expect(JSON.parse(response.text)).toEqual({
		ok: false,
		code: "unsupported_media_type",
		detail: {},
	});
});

it("checks Host, capability, bearer refusal, read Origin and Fetch Metadata in order", async () => {
	const { server, route, headers, capability } = admissionFixture;
	for (const [extra, status, code] of [
		[{ Host: "localhost:1" }, 403, "forbidden"],
		[{ "X-Praxity-Review": "" }, 401, "unauthorized"],
		[{ "X-Praxity-Review": "A".repeat(43) }, 401, "unauthorized"],
		[{ "X-Praxity-Review": "wrong", Origin: "https://foreign.example" }, 401, "unauthorized"],
		[{ Authorization: `Bearer ${capability}` }, 403, "forbidden"],
		[{ Origin: "https://foreign.example" }, 403, "forbidden"],
		[{ Origin: editorOrigin }, 403, "forbidden"],
		[{ Origin: "null" }, 403, "forbidden"],
		[{ "Sec-Fetch-Site": "cross-site" }, 403, "forbidden"],
		[{ "Service-Worker": "script" }, 403, "forbidden"],
	] as const) {
		const response = await probe(server.origin, route, { headers: { ...headers, ...extra } });
		expect(response.status).toBe(status);
		expect(JSON.parse(response.text)).toEqual({ ok: false, code, detail: {} });
	}
	const absent = await probe(server.origin, route);
	expect(absent.status).toBe(401);
	const allowed = await probe(server.origin, route, {
		headers: { "X-Praxity-Review": capability },
	});
	expect(allowed.status).toBe(200);
	for (const [name, value] of Object.entries({
		"cache-control": "no-store",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
		"content-security-policy": csp,
		"content-type": "application/json; charset=utf-8",
	}))
		expect(allowed.headers[name]).toBe(value);
	const post = await probe(server.origin, route, {
		method: "POST",
		headers: { ...headers, "Sec-Fetch-Site": "cross-site" },
		body: "{}",
	});
	expect(post.status).toBe(403);
});

it("admits exactly 65536 bytes, refuses cap+1, invalid JSON and unknown fields", async () => {
	const { server, route, headers, payload } = await running();
	const body = JSON.stringify(payload);
	const padded = body + " ".repeat(65536 - Buffer.byteLength(body));
	expect(
		(
			await probe(server.origin, route, {
				method: "POST",
				headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
				body: padded,
			})
		).status,
	).toBe(200);
	const oversized = await probe(server.origin, route, {
		method: "POST",
		headers,
		chunks: [padded, " "],
	});
	expect(oversized.status).toBe(413);
	expect(JSON.parse(oversized.text)).toEqual({ ok: false, code: "body_too_large", detail: {} });
	const invalid = await probe(server.origin, route, { method: "POST", headers, body: "{" });
	expect(invalid.status).toBe(400);
	expect(JSON.parse(invalid.text)).toEqual({ ok: false, code: "invalid_json", detail: {} });
	const unknown = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...payload, role: "author" }),
	});
	expect(unknown.status).toBe(422);
	expect(JSON.parse(unknown.text)).toEqual({
		ok: false,
		code: "invalid_input",
		detail: { path: "$.role" },
	});
});

it("refuses oversized streaming input before the client sends its remaining body", async () => {
	const { server, route, headers } = await running();
	const response = await new Promise<number>((resolve, reject) => {
		const req = request(server.origin, { path: route, method: "POST", headers }, (res) => {
			res.resume();
			res.on("end", () => {
				resolve(res.statusCode ?? 0);
				req.destroy();
			});
		});
		req.on("error", reject);
		req.write(" ".repeat(65537));
	});
	expect(response).toBe(413);
});

it.each(["aborted upload", "malformed chunked upload"])(
	"settles %s aborted during project admission and closes within 500ms",
	async (kind) => {
		const { server, root, route, capability } = await running();
		let release!: () => void;
		let entered!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const admitted = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const transaction = withProjectFileTransaction(
			root,
			async () => {
				entered();
				await held;
			},
			"write",
			false,
		);
		await admitted;
		const socket = connect(Number(new URL(server.origin).port), "127.0.0.1");
		socket.on("error", () => {});
		socket.resume();
		try {
			await once(socket, "connect");
			const closed = once(socket, "close");
			const framing =
				kind === "aborted upload"
					? "Content-Length: 100\r\n\r\n{"
					: "Transfer-Encoding: gzip, chunked\r\n\r\nZ\r\n{";
			socket.write(
				`POST ${route} HTTP/1.1\r\nHost: ${new URL(server.origin).host}\r\nOrigin: ${server.origin}\r\nX-Praxity-Review: ${capability}\r\nContent-Type: application/json\r\n${framing}`,
			);
			await delay(100);
			if (kind === "aborted upload") socket.destroy();
			await closed;
		} finally {
			socket.destroy();
			release();
			await transaction;
		}
		// A broken close must fail this test without holding the suite's cleanup open.
		servers.splice(servers.indexOf(server), 1);
		expect(await Promise.race([server.close().then(() => true), delay(500, false)])).toBe(true);
	},
);

it("keeps paths exact and methods closed", async () => {
	const { server, route, headers } = admissionFixture;
	for (const path of [
		route.replace(/\/[^/]+\/comments$/, `/${randomUUID()}/comments`),
		`${route}/`,
		`${route}//`,
		`${route}/../comments`,
		route.replace("/comments", "/%63omments"),
		`${route}%2F`,
		`${route}/%2e%2e/comments`,
		`${route}/x/reply`,
		`${route}/${randomUUID()}/resolve`,
		[route.slice(0, -"/comments".length), "context"].join("/"),
		`${route}/drafts`,
		`${route}/../comments/${randomUUID()}/reply`,
	]) {
		const response = await probe(server.origin, path, { headers });
		expect(response.status, path).toBe(404);
		expect(JSON.parse(response.text)).toEqual({ ok: false, code: "not_found", detail: {} });
	}
	for (const method of ["PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"]) {
		const response = await probe(server.origin, route, { method, headers });
		expect(response.status).toBe(405);
		if (method !== "HEAD")
			expect(JSON.parse(response.text)).toEqual({ ok: false, code: "http_method", detail: {} });
	}
	for (const method of ["GET", "POST"])
		expect(
			(
				await probe(server.origin, `${route}/${randomUUID()}/resolve`, {
					method,
					headers,
					body: method === "POST" ? "{}" : undefined,
				})
			).status,
		).toBe(404);
});

it("maps C1 refusals without leaking state and keeps path and payload IDs aligned", async () => {
	const { server, store, route, headers, payload } = await running();
	const created = JSON.parse(
		(await probe(server.origin, route, { method: "POST", headers, body: JSON.stringify(payload) }))
			.text,
	);
	const reused = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...payload, body: "Changed" }),
	});
	expect(reused.status).toBe(409);
	expect(JSON.parse(reused.text)).toEqual({ ok: false, code: "request_id_reused", detail: {} });
	const reply = {
		reviewId: store.reviewId,
		threadId: created.thread.id,
		requestId: randomUUID(),
		expectVersion: 9,
		body: "Reply",
	};
	const stale = await probe(server.origin, `${route}/${created.thread.id}/reply`, {
		method: "POST",
		headers,
		body: JSON.stringify(reply),
	});
	expect(stale.status).toBe(409);
	expect(JSON.parse(stale.text)).toEqual({
		ok: false,
		code: "stale_version",
		detail: { currentVersion: 1 },
	});
	const mismatched = await probe(server.origin, `${route}/${randomUUID()}/reply`, {
		method: "POST",
		headers,
		body: JSON.stringify(reply),
	});
	expect(mismatched.status).toBe(422);
	const wrongReview = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...payload, reviewId: randomUUID() }),
	});
	expect(wrongReview.status).toBe(404);
	const missing = await probe(server.origin, `${route}/${reply.threadId}/reply`, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...reply, threadId: randomUUID() }),
	});
	expect(missing.status).toBe(422);
});

it("a fresh listener refuses the previous process capability for the same durable review", async () => {
	const first = await running();
	await first.server.close();
	const capability = randomBytes(32).toString("base64url");
	const server = await startStudioReadOnlyServer({
		projectDir: first.root,
		getEditorOrigin: () => editorOrigin,
		review: { store: first.store, capability },
	});
	servers.push(server);
	expect(capability === first.capability).toBe(false);
	expect(
		(await probe(server.origin, first.route, { headers: { "X-Praxity-Review": capability } }))
			.status,
	).toBe(200);
	expect(
		(await probe(server.origin, first.route, { headers: { "X-Praxity-Review": first.capability } }))
			.status,
	).toBe(401);
});

describe("visibility paging", () => {
	let fixture: Awaited<ReturnType<typeof running>>;
	beforeAll(async () => {
		fixture = await running(true, {
			visibleTo: (_principal, thread) => thread.anchor.pageId !== "hidden",
		});
		const { root, payload } = fixture;
		const store = await openReviewStore(root);
		const principal = await store.principalFor("reviewer", "local-preview");
		for (const pageId of ["hidden", "first", "second"])
			expect(
				(
					await store.create(principal, {
						...payload,
						requestId: randomUUID(),
						anchor: { ...anchor, pageId },
					})
				).ok,
			).toBe(true);
	});
	it("filters visibility in the store before HTTP paging", async () => {
		const { server, route, headers } = fixture;
		const first = JSON.parse((await probe(server.origin, `${route}?limit=1`, { headers })).text);
		expect(first.threads.map((thread: { anchor: ReviewAnchor }) => thread.anchor.pageId)).toEqual([
			"first",
		]);
		expect(first.nextCursor).toBeTypeOf("string");
		const second = JSON.parse(
			(
				await probe(
					server.origin,
					`${route}?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
					{ headers },
				)
			).text,
		);
		expect(second.threads.map((thread: { anchor: ReviewAnchor }) => thread.anchor.pageId)).toEqual([
			"second",
		]);
		expect(second.nextCursor).toBeNull();
		expect((await probe(server.origin, `${route}?page=hidden`, { headers })).text).toContain(
			'"threads":[]',
		);
	});
});

describe("hidden target admission", () => {
	let fixture: Awaited<ReturnType<typeof running>>;
	let threadId: string;
	beforeAll(async () => {
		fixture = await running(true, { visibleTo: () => false });
		const seed = await openReviewStore(fixture.root);
		const result = await seed.create(
			await seed.principalFor("reviewer", "local-preview"),
			fixture.payload,
		);
		if (!result.ok || !result.thread) throw new Error("Missing visible fixture thread");
		threadId = result.thread.id;
	});
	it("refuses hidden reply, reopen and an old successful request without writes or disclosure", async () => {
		const { root, store, server, route, headers, payload } = fixture;
		const path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
		const before = await readFile(path, "utf8");
		for (const kind of ["reply", "reopen"] as const) {
			const response = await probe(server.origin, `${route}/${threadId}/${kind}`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					reviewId: store.reviewId,
					threadId,
					requestId: randomUUID(),
					expectVersion: 99,
					...(kind === "reply" ? { body: "Hidden reply" } : {}),
				}),
			});
			expect(response.status).toBe(404);
			expect(JSON.parse(response.text)).toEqual({ ok: false, code: "not_found", detail: {} });
		}
		const retry = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		expect(retry.status).toBe(404);
		expect(JSON.parse(retry.text)).toEqual({ ok: false, code: "not_found", detail: {} });
		expect(await readFile(path, "utf8")).toBe(before);
	});
});

describe("principal-bound cursors", () => {
	let fixture: Awaited<ReturnType<typeof running>>;
	let cursor: string;
	beforeAll(async () => {
		fixture = await running();
		const { store, payload } = fixture;
		const principal = await store.principalFor("reviewer", "local-preview");
		for (let index = 0; index < 2; index++)
			expect((await store.create(principal, { ...payload, requestId: randomUUID() })).ok).toBe(
				true,
			);
		const result = await store.list({ ...principal, id: "another-principal" }, { limit: 1 });
		if ("ok" in result || !result.nextCursor) throw new Error("Missing cursor fixture");
		cursor = result.nextCursor;
	});
	it("refuses another principal's cursor with 400", async () => {
		const { server, route, headers } = fixture;
		const response = await probe(server.origin, `${route}?cursor=${encodeURIComponent(cursor)}`, {
			headers,
		});
		expect(response.status).toBe(400);
		expect(JSON.parse(response.text)).toEqual({ ok: false, code: "invalid_cursor", detail: {} });
	});
});

it("storage failures return a coded 500 without paths or message bodies", async () => {
	const { server, root, store, route, headers } = await running();
	await writeFile(join(root, ".praxity/reviews", store.reviewId, "comments.json"), "{");
	const response = await probe(server.origin, route, { headers });
	expect(response.status).toBe(500);
	expect(JSON.parse(response.text)).toEqual({ ok: false, code: "corrupt-json", detail: {} });
});

describe.each([
	["busy", 503, "1"],
	["recovery-required", 500, undefined],
	["git-unavailable", 500, undefined],
	["newer-schema", 500, undefined],
	["filesystem-unsupported", 500, undefined],
] as const)("typed store refusal %s", (code, status, retryAfter) => {
	let fixture: Awaited<ReturnType<typeof running>>;
	beforeAll(async () => {
		let fail = false;
		fixture = await running(true, {
			visibleTo: () => {
				if (fail) throw new ReviewStoreError(code, "private path");
				return true;
			},
		});
		const { store, payload } = fixture;
		expect(
			(await store.create(await store.principalFor("reviewer", "local-preview"), payload)).ok,
		).toBe(true);
		fail = true;
	});
	it("returns a coded refusal without exposing the failure path", async () => {
		const { server, route, headers } = fixture;
		const response = await probe(server.origin, route, { headers });
		expect(response.status).toBe(status);
		expect(response.headers["retry-after"]).toBe(retryAfter);
		expect(JSON.parse(response.text)).toEqual({ ok: false, code, detail: {} });
	});
});

describe.each(["threads", "messages"] as const)("HTTP %s flood bound", (kind) => {
	let fixture: Awaited<ReturnType<typeof running>>;
	let path: string;
	let route: string;
	let payload: unknown;
	beforeAll(async () => {
		fixture = await running();
		const { root, store } = fixture;
		const created = await store.create(
			await store.principalFor("reviewer", "local-preview"),
			fixture.payload,
		);
		if (!created.ok || !created.thread) throw new Error("Missing visible fixture thread");
		const thread = created.thread;
		path = join(root, ".praxity/reviews", store.reviewId, "comments.json");
		const state: ReviewState = JSON.parse(await readFile(path, "utf8"));
		state.receipts = [];
		if (kind === "threads") {
			state.changeSeq = 999;
			state.threads = Array.from({ length: 999 }, () => ({
				...thread,
				id: randomUUID(),
				messages: [{ ...thread.messages[0], id: randomUUID() }],
			}));
			route = fixture.route;
			payload = { ...fixture.payload, requestId: randomUUID() };
		} else {
			state.changeSeq = 99;
			state.threads[0].version = 99;
			state.threads[0].messages = Array.from({ length: 99 }, () => ({
				...thread.messages[0],
				id: randomUUID(),
			}));
			route = `${fixture.route}/${thread.id}/reply`;
			payload = {
				reviewId: store.reviewId,
				threadId: thread.id,
				expectVersion: 99,
				requestId: randomUUID(),
				body: "Last message",
			};
		}
		await writeFile(path, JSON.stringify(state));
	});
	it("admits the limit, refuses limit+1 without writes, and retries at capacity", async () => {
		const { server, headers } = fixture;
		const admitted = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		expect(admitted.status).toBe(200);
		const result = JSON.parse(admitted.text);
		const before = await readFile(path, "utf8");
		const next = {
			...(payload as object),
			requestId: randomUUID(),
			...(kind === "messages" ? { expectVersion: 100 } : {}),
		};
		const denied = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(next),
		});
		expect(denied.status).toBe(409);
		expect(JSON.parse(denied.text)).toEqual({
			ok: false,
			code: "limit_reached",
			detail: { path: `$.${kind}` },
		});
		expect(await readFile(path, "utf8")).toBe(before);
		const retry = await probe(server.origin, route, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
		expect(retry.status).toBe(200);
		expect(JSON.parse(retry.text)).toMatchObject({
			ok: true,
			replayed: true,
			receipt: result.receipt,
		});
	});
});

it.each([
	"limit=0",
	"limit=101",
	"limit=1.5",
	"limit=1e1",
	"limit=",
	"page=",
	"status=all",
	"page=x&page=y",
	"extra=x",
])("refuses list query %s", async (query) => {
	const { server, route, headers } = admissionFixture;
	const response = await probe(server.origin, `${route}?${query}`, { headers });
	expect(response.status).toBe(422);
	expect(JSON.parse(response.text).ok).toBe(false);
});

it("invalid cursors return a stable 400", async () => {
	const { server, route, headers } = admissionFixture;
	const response = await probe(server.origin, `${route}?cursor=invalid`, { headers });
	expect(response.status).toBe(400);
	expect(JSON.parse(response.text)).toEqual({ ok: false, code: "invalid_cursor", detail: {} });
});

it("query strings and cookies cannot substitute for the review header", async () => {
	const { server, route, capability } = admissionFixture;
	for (const path of [route, `${route}?capability=${capability}`]) {
		const response = await probe(server.origin, path, {
			headers: { Cookie: `X-Praxity-Review=${capability}` },
		});
		expect(response.status).toBe(401);
		expect(response.text.includes(capability)).toBe(false);
	}
});

describe("review isolation", () => {
	let first: Awaited<ReturnType<typeof running>>;
	let second: Awaited<ReturnType<typeof running>>;
	beforeAll(async () => {
		first = await running();
		second = await running();
	});
	it("a capability cannot access another live review", async () => {
		expect(
			(await probe(first.server.origin, second.route, { headers: first.headers })).status,
		).toBe(404);
		expect(
			(
				await probe(second.server.origin, second.route, {
					headers: { "X-Praxity-Review": first.capability },
				})
			).status,
		).toBe(401);
	});
});

it("rejects malformed UTF-8, compressed bodies and missing Content-Type", async () => {
	const { server, route, headers } = admissionFixture;
	const invalid = await probe(server.origin, route, {
		method: "POST",
		headers,
		body: Buffer.from([0x22, 0xc3, 0x28, 0x22]),
	});
	expect(invalid.status).toBe(400);
	expect(JSON.parse(invalid.text)).toEqual({ ok: false, code: "invalid_json", detail: {} });
	const compressed = await probe(server.origin, route, {
		method: "POST",
		headers: { ...headers, "Content-Encoding": "gzip" },
		body: "{}",
	});
	expect(compressed.status).toBe(415);
	const { "Content-Type": _contentType, ...rest } = headers;
	expect(
		(await probe(server.origin, route, { method: "POST", headers: rest, body: "{}" })).status,
	).toBe(415);
});

it.each([false, true])(
	"artifact headers and methods stay unchanged with review enabled=%s",
	async (enabled) => {
		const { server, headers } = await running(enabled);
		const route = new URL("assets/sample.txt", server.mediaBaseUrl).pathname;
		const response = await probe(server.origin, route, {
			headers: { Origin: editorOrigin },
			artifactCors: true,
		});
		expect(response.status).toBe(200);
		expect(response.text).toBe("sample");
		const { date: _date, connection: _connection, ...stable } = response.headers;
		expect(stable).toEqual({
			"content-security-policy": csp,
			"referrer-policy": "no-referrer",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
			"access-control-allow-origin": editorOrigin,
			vary: "Origin",
			"accept-ranges": "bytes",
			"content-length": "6",
			"content-type": "application/octet-stream",
		});
		expect((await probe(server.origin, route, { method: "POST", headers })).status).toBe(405);
		expect(
			(
				await probe(server.origin, route, {
					headers: { Authorization: `Bearer ${headers["X-Praxity-Review"]}` },
				})
			).status,
		).toBe(403);
	},
);

describe("author listener isolation", () => {
	let server: Awaited<ReturnType<typeof startStudioServer>>;
	let capability: string;
	let learnerOrigin: string;
	let commentsRoute: string;
	beforeAll(async () => {
		const root = await mkdtemp(join(tmpdir(), "studio-review-paired-"));
		roots.push(root);
		const store = await openReviewStore(root);
		const editorAssetsDir = await mkdtemp(join(tmpdir(), "studio-review-editor-"));
		roots.push(editorAssetsDir);
		await writeFile(join(root, "lesson.prax"), "---\ntitle: Test\n---\n\n# Hello\n");
		await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
		await writeFile(
			join(editorAssetsDir, "canvas.sha256"),
			"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
		);
		capability = randomBytes(32).toString("base64url");
		server = await startStudioServer({
			projectDir: root,
			editorAssetsDir,
			appVersion: "0.3.0",
			review: { store, capability },
		});
		servers.push(server);
		const entry = await probe(server.origin, "/");
		const policy = entry.headers["content-security-policy"];
		if (typeof policy !== "string") throw new Error("Missing author CSP");
		const frameSource = /(?:^|;\s*)frame-src (http:\/\/127\.0\.0\.1:\d+)(?:;|$)/.exec(policy);
		if (!frameSource) throw new Error("Missing paired learner origin in CSP");
		learnerOrigin = frameSource[1];
		commentsRoute = `/api/reviews/${store.reviewId}/comments`;
	});
	it("review capability has no authority on editor RPC, session or events", async () => {
		const admitted = await probe(learnerOrigin, commentsRoute, {
			headers: { "X-Praxity-Review": capability },
		});
		expect(admitted.status).toBe(200);
		expect(JSON.parse(admitted.text)).toMatchObject({ ok: true, threads: [] });
		// Separate from the editor bearer, including when passed under the bearer header.
		for (const path of ["/api/rpc", "/api/session", "/api/events"])
			for (const credential of [
				{ "X-Praxity-Review": capability },
				{ Authorization: `Bearer ${capability}` },
			] as Record<string, string>[]) {
				const response = await probe(server.origin, path, {
					method: path === "/api/rpc" ? "POST" : "GET",
					headers: { Origin: server.origin, "Content-Type": "application/json", ...credential },
					body: path === "/api/rpc" ? '{"method":"courseLoad","args":{}}' : undefined,
				});
				expect(response.status).toBe(401);
			}
	});
});
