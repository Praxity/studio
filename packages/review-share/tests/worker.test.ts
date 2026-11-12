import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MAX_COMMENT_LENGTH,
	MAX_NAME_LENGTH,
	MAX_PAGE_HEADING_LENGTH,
	MAX_PAGE_LENGTH,
} from "../src/comments";
import worker, { type Env, handleRequest, type ShareMetadata } from "../src/worker";

const BASE_URL = "https://review.example.test";
const UPLOAD_TOKEN = "test-upload-token-that-must-stay-secret";
const FIXED_SLUG = "abcdefghijklmnopqrstuvwx";
const IMMUTABLE_PATH = "assets/__praxity-0123456789abcdef01234567.webp";

interface TestState {
	kv: Map<string, string>;
	files: Map<string, ArrayBuffer>;
	env: Env;
	cache: { match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
	ctx: Pick<ExecutionContext, "waitUntil">;
	drain: () => Promise<unknown[]>;
	delays: { kv: number; r2: number };
}

function makeState(): TestState {
	const kv = new Map<string, string>();
	const files = new Map<string, ArrayBuffer>();
	const cached = new Map<string, Response>();
	const pending: Promise<unknown>[] = [];
	const delays = { kv: 0, r2: 0 };
	const cache = {
		match: vi.fn(async (request: Request) => cached.get(request.url)?.clone()),
		put: vi.fn(async (request: Request, response: Response) => {
			cached.set(request.url, response.clone());
		}),
	};
	vi.stubGlobal("caches", { default: cache });
	const kvStub = {
		get: async (key: string) => {
			vi.advanceTimersByTime(delays.kv);
			return kv.get(key) ?? null;
		},
		put: async (key: string, value: string) => {
			kv.set(key, value);
		},
	};
	const r2Stub = {
		put: async (key: string, value: BodyInit) => {
			files.set(key, await new Response(value).arrayBuffer());
			return {};
		},
		head: async (key: string) => {
			vi.advanceTimersByTime(delays.r2);
			const value = files.get(key);
			return value === undefined
				? null
				: { size: value.byteLength, httpEtag: `"${value.byteLength.toString(16)}"` };
		},
		get: async (
			key: string,
			options?: { onlyIf?: Headers; range?: { offset: number; length: number } },
		) => {
			vi.advanceTimersByTime(delays.r2);
			const value = files.get(key);
			if (value === undefined) return null;
			const httpEtag = `"${value.byteLength.toString(16)}"`;
			const metadata = { httpEtag, size: value.byteLength };
			const range = options?.range;
			return options?.onlyIf?.get("If-None-Match") === httpEtag
				? metadata
				: {
						body: new Response(
							range ? value.slice(range.offset, range.offset + range.length) : value,
						).body,
						...metadata,
					};
		},
	};

	return {
		kv,
		files,
		cache,
		ctx: { waitUntil: (promise) => pending.push(promise) },
		drain: () => Promise.all(pending),
		delays,
		env: {
			REVIEW_KV: kvStub as unknown as KVNamespace,
			REVIEW_FILES: r2Stub as unknown as R2Bucket,
			UPLOAD_TOKEN,
		},
	};
}

function activeShare(slug = FIXED_SLUG): ShareMetadata {
	return {
		slug,
		title: "Review title",
		expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
	};
}

function addShare(state: TestState, share = activeShare()): void {
	state.kv.set(`share:${share.slug}`, JSON.stringify(share));
}

async function publish(state: TestState, expiryDays?: string): Promise<Response> {
	const headers = new Headers({
		Authorization: `Bearer ${UPLOAD_TOKEN}`,
		"X-Praxity-Title": "Course review",
	});
	if (expiryDays !== undefined) headers.set("X-Praxity-Expiry-Days", expiryDays);
	return handleRequest(
		new Request(`${BASE_URL}/api/publish`, { method: "POST", headers }),
		state.env,
	);
}

describe("review-share worker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T16:00:00.000Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("requires a bearer token for both upload endpoints without echoing it", async () => {
		const state = makeState();
		const createResponse = await handleRequest(
			new Request(`${BASE_URL}/api/publish`, {
				method: "POST",
				headers: { Authorization: "Bearer wrong-token" },
			}),
			state.env,
		);
		expect(createResponse.status).toBe(401);
		expect(await createResponse.text()).not.toContain(UPLOAD_TOKEN);

		addShare(state);
		const uploadResponse = await handleRequest(
			new Request(`${BASE_URL}/api/publish/${FIXED_SLUG}/file?path=index.html`, {
				method: "PUT",
				body: "content",
			}),
			state.env,
		);
		expect(uploadResponse.status).toBe(401);
		expect(state.files.size).toBe(0);
		expect(await uploadResponse.text()).not.toContain(UPLOAD_TOKEN);
	});

	it("creates a random url-safe share and clamps expiry to 60 days", async () => {
		const state = makeState();
		const response = await publish(state, "90");
		expect(response.status).toBe(201);
		const body = (await response.json()) as {
			slug: string;
			uploadUrl: string;
			expiresAt: string;
		};
		expect(body.slug).toMatch(/^[A-Za-z0-9_-]{16,}$/u);
		expect(body.slug).toHaveLength(24);
		expect(body.uploadUrl).toBe(`${BASE_URL}/api/publish/${body.slug}/file`);
		expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
		expect(JSON.stringify(body)).not.toContain(UPLOAD_TOKEN);

		const metadata = JSON.parse(state.kv.get(`share:${body.slug}`) ?? "") as ShareMetadata;
		expect(metadata).toEqual({
			slug: body.slug,
			title: "Course review",
			expiresAt: "2026-09-20T16:00:00.000Z",
		});
	});

	it.each([
		["  ", "2026-08-05T16:00:00.000Z"],
		["invalid", "2026-08-05T16:00:00.000Z"],
		["Infinity", "2026-08-05T16:00:00.000Z"],
		["0", "2026-07-23T16:00:00.000Z"],
		["-2", "2026-07-23T16:00:00.000Z"],
		["2.9", "2026-07-24T16:00:00.000Z"],
	])("normalizes expiry header %j to %s", async (header, expiresAt) => {
		const response = await publish(makeState(), header);
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual(expect.objectContaining({ expiresAt }));
	});

	it("defaults expiry to 14 days and uploads only safe relative paths", async () => {
		const state = makeState();
		const createResponse = await publish(state);
		const { slug } = (await createResponse.json()) as { slug: string };
		const metadata = JSON.parse(state.kv.get(`share:${slug}`) ?? "") as ShareMetadata;
		expect(metadata.expiresAt).toBe("2026-08-05T16:00:00.000Z");
		const emptyHeaderResponse = await publish(state, "");
		const emptyHeaderBody = (await emptyHeaderResponse.json()) as { slug: string };
		const emptyHeaderMetadata = JSON.parse(
			state.kv.get(`share:${emptyHeaderBody.slug}`) ?? "",
		) as ShareMetadata;
		expect(emptyHeaderMetadata.expiresAt).toBe("2026-08-05T16:00:00.000Z");

		const uploadResponse = await handleRequest(
			new Request(`${BASE_URL}/api/publish/${slug}/file?path=assets%2Fapp.js`, {
				method: "PUT",
				headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
				body: "console.log('ok')",
			}),
			state.env,
		);
		expect(uploadResponse.status).toBe(201);
		expect(new TextDecoder().decode(state.files.get(`${slug}/assets/app.js`))).toBe(
			"console.log('ok')",
		);

		const traversalResponse = await handleRequest(
			new Request(`${BASE_URL}/api/publish/${slug}/file?path=..%2Fsecret`, {
				method: "PUT",
				headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
				body: "no",
			}),
			state.env,
		);
		expect(traversalResponse.status).toBe(400);
	});

	it.each([
		"../secret",
		"assets/../secret",
		"./index.html",
		"assets//app.js",
		"assets\\app.js",
		"assets/\0app.js",
	])("rejects unsafe upload path %j without storing files", async (path) => {
		const state = makeState();
		addShare(state);
		const response = await handleRequest(
			new Request(`${BASE_URL}/api/publish/${FIXED_SLUG}/file?path=${encodeURIComponent(path)}`, {
				method: "PUT",
				headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
				body: "no",
			}),
			state.env,
		);
		expect(response.status).toBe(400);
		expect(state.files.size).toBe(0);
	});

	it.each([
		"assets%2f..%2fsecret",
		"assets%2f.%2fapp.js",
		"assets//app.js",
		"assets%5capp.js",
		"assets/%00app.js",
		"assets/%",
	])("rejects unsafe encoded serving path %j", async (path) => {
		const state = makeState();
		addShare(state);
		const response = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${path}`),
			state.env,
		);
		expect(response.status).toBe(400);
	});

	it.each([
		["/api/publish", "GET", "POST"],
		[`/s/${FIXED_SLUG}/comments`, "PUT", "GET, POST"],
	])("preserves JSON response policy and Allow for %s", async (path, method, allow) => {
		const state = makeState();
		addShare(state);
		const response = await handleRequest(new Request(`${BASE_URL}${path}`, { method }), state.env);
		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe(allow);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await response.json()).toEqual({ error: "Method not allowed" });
	});

	it.each([
		["index.html", "text/html; charset=utf-8"],
		["app.js", "text/javascript; charset=utf-8"],
		["app.css", "text/css; charset=utf-8"],
		["audio.mp3", "audio/mpeg"],
		["captions.vtt", "text/vtt; charset=utf-8"],
		["image.png", "image/png"],
		["photo.jpg", "image/jpeg"],
		["photo.jpeg", "image/jpeg"],
		["photo.webp", "image/webp"],
		["photo.WEBP", "image/webp"],
		["animation.gif", "image/gif"],
		["photo.avif", "image/avif"],
		["data.json", "application/json; charset=utf-8"],
		["guide.pdf", "application/pdf"],
		["video.mp4", "video/mp4"],
		["icon.svg", "image/svg+xml"],
		["font.woff2", "font/woff2"],
		["module.mjs", "text/javascript; charset=utf-8"],
		["module.wasm", "application/wasm"],
		["video.webm", "video/webm"],
		["font.woff", "font/woff"],
		["audio.m4a", "audio/mp4"],
		["audio.ogg", "audio/ogg"],
		["video.ogv", "video/ogg"],
		["audio.opus", "audio/ogg"],
		["video.mov", "video/quicktime"],
		["audio.wav", "audio/wav"],
		["audio.flac", "audio/flac"],
		["audio.aac", "audio/aac"],
		["notes.txt", "text/plain; charset=utf-8"],
		["manifest.xml", "application/xml; charset=utf-8"],
		["data.bin", "application/octet-stream"],
		["LICENSE", "application/octet-stream"],
	])("serves %s with %s and nosniff", async (path, expectedType) => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${path}`, new TextEncoder().encode("file body").buffer);

		const suffix = path === "index.html" ? "" : path;
		const response = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${suffix}`),
			state.env,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe(expectedType);
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Cache-Control")).toBe(
			path.endsWith(".html") ? "public, max-age=300" : "public, max-age=31536000, immutable",
		);
		expect(response.headers.get("ETag")).toBe('"9"');
		expect(await response.text()).toBe("file body");
	});

	it("returns 304 when the R2 ETag matches", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/app.js`, new TextEncoder().encode("asset").buffer);

		const response = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/app.js`, {
				headers: { "If-None-Match": '"5"' },
			}),
			state.env,
		);

		expect(response.status).toBe(304);
		expect(response.headers.get("ETag")).toBe('"5"');
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
		expect(await response.text()).toBe("");
	});

	it.each(["expired", "revoked"])(
		"checks a %s share before consulting a warm cache",
		async (stateName) => {
			const state = makeState();
			addShare(state);
			state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
			const request = new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`);
			expect((await worker.fetch(request, state.env, state.ctx)).status).toBe(200);
			await state.drain();
			expect(state.cache.put).toHaveBeenCalledOnce();
			state.cache.match.mockClear();
			const get = vi.spyOn(state.env.REVIEW_FILES, "get");
			if (stateName === "expired") {
				addShare(state, { ...activeShare(), expiresAt: "2026-07-22T16:00:00.000Z" });
			} else {
				state.kv.delete(`share:${FIXED_SLUG}`);
			}
			const response = await worker.fetch(request, state.env, state.ctx);
			expect(response.status).toBe(stateName === "expired" ? 410 : 404);
			expect(state.cache.match).not.toHaveBeenCalled();
			expect(get).not.toHaveBeenCalled();
		},
	);

	it("checks KV on every cache hit, skips R2, and preserves fresh headers and bytes", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
		const request = new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`);
		const get = vi.spyOn(state.env.REVIEW_FILES, "get");
		const kvGet = vi.spyOn(state.env.REVIEW_KV, "get");
		const fresh = await worker.fetch(request, state.env, state.ctx);
		await state.drain();
		const freshBody = await fresh.text();
		expect(freshBody).toBe("image");
		expect(fresh.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(state.cache.put).toHaveBeenCalledOnce();
		get.mockClear();
		const hit = await worker.fetch(request, state.env, state.ctx);
		expect(hit.status).toBe(200);
		expect(await hit.text()).toBe(freshBody);
		expect([...hit.headers]).toEqual([...fresh.headers]);
		expect(get).not.toHaveBeenCalled();
		expect(kvGet).toHaveBeenCalledTimes(2);
		expect(kvGet).toHaveBeenNthCalledWith(1, `share:${FIXED_SLUG}`, { cacheTtl: 60 });
		expect(kvGet).toHaveBeenNthCalledWith(2, `share:${FIXED_SLUG}`, { cacheTtl: 60 });
	});

	it.each([
		"assets/__praxity-0123456789abcdef01234567.webp",
		"course-shell-ABCDEFG2.js",
		"islands/island-loader-ABCDEFG2.js",
		"islands/chunks/chunk-ABCDEFG2.js",
		"chunks/chunk-ABCDEFG2.js",
		"islands/chunks/support-ABCDEFG2.classic.js",
		"privacy-chunks/chunk-ABCDEFG2.js",
		"viewer.0123456789ab.css",
	])("caches compiler fingerprinted file %s", async (path) => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${path}`, new TextEncoder().encode("file").buffer);
		const request = new Request(`${BASE_URL}/s/${FIXED_SLUG}/${path}`);
		expect((await worker.fetch(request, state.env, state.ctx)).status).toBe(200);
		await state.drain();
		expect(state.cache.put).toHaveBeenCalledOnce();
		const get = vi.spyOn(state.env.REVIEW_FILES, "get");
		expect(await (await worker.fetch(request, state.env, state.ctx)).text()).toBe("file");
		expect(get).not.toHaveBeenCalled();
	});

	it.each([
		"",
		"index.html",
		"page.HTML",
		"page-ABCDEFG2.html",
		"viewer.css",
		"app.js",
		"assets/photo.webp",
		"data.json",
		"viewer.0123456789ab.HTML",
		"assets/__praxity-0123456789abcdef01234567.html",
	])("never reads or writes the edge cache for mutable path %j", async (path) => {
		const state = makeState();
		addShare(state);
		const key = `${FIXED_SLUG}/${path || "index.html"}`;
		state.files.set(key, new TextEncoder().encode("first").buffer);
		const request = new Request(`${BASE_URL}/s/${FIXED_SLUG}/${path}`);
		expect(await (await worker.fetch(request, state.env, state.ctx)).text()).toBe("first");
		state.files.set(key, new TextEncoder().encode("later").buffer);
		expect(await (await worker.fetch(request, state.env, state.ctx)).text()).toBe("later");
		expect(state.cache.match).not.toHaveBeenCalled();
		expect(state.cache.put).not.toHaveBeenCalled();
	});

	it("isolates shares and removes capabilities, queries and headers from cache keys", async () => {
		const state = makeState();
		const otherSlug = "zyxwvutsrqponmlkjihgfedc";
		for (const slug of [FIXED_SLUG, otherSlug]) {
			addShare(state, activeShare(slug));
			state.files.set(`${slug}/${IMMUTABLE_PATH}`, new TextEncoder().encode(slug).buffer);
			const response = await worker.fetch(
				new Request(`${BASE_URL}/s/${slug}/${IMMUTABLE_PATH}?token=${UPLOAD_TOKEN}`, {
					headers: {
						Authorization: `Bearer ${UPLOAD_TOKEN}`,
						Cookie: `capability=${UPLOAD_TOKEN}`,
					},
				}),
				state.env,
				state.ctx,
			);
			expect(await response.text()).toBe(slug);
			await state.drain();
		}
		const keys = state.cache.match.mock.calls.map(([request]) => request as Request);
		expect(keys[0].url).not.toBe(keys[1].url);
		for (const key of keys) {
			expect(key.url).toMatch(
				/^https:\/\/review\.example\.test\/\.review-cache\/v1\/[a-f0-9]{64}\/[a-f0-9]{64}$/,
			);
			expect(key.url).not.toContain(FIXED_SLUG);
			expect(key.url).not.toContain(otherSlug);
			expect(key.url).not.toContain(UPLOAD_TOKEN);
			expect([...key.headers]).toEqual([]);
		}
		const hit = await worker.fetch(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}?different=1`),
			state.env,
			state.ctx,
		);
		expect(await hit.text()).toBe(FIXED_SLUG);
		expect(state.cache.match.mock.calls[2][0].url).toBe(keys[0].url);
	});

	it.each([
		[{ Range: "bytes=1-2" }, 206, "12"],
		[{ Range: "bytes=99-" }, 416, ""],
		[{ Range: "bytes=1-2", "If-Range": '"old"' }, 200, "01234"],
		[{ "If-None-Match": '"5"' }, 304, ""],
		[{ "If-None-Match": '"old"' }, 200, "01234"],
	])(
		"keeps conditional/range behavior with a warm edge cache: %j",
		async (headers, status, body) => {
			const state = makeState();
			addShare(state);
			state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("01234").buffer);
			const url = `${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`;
			await worker.fetch(new Request(url), state.env, state.ctx);
			await state.drain();
			state.cache.match.mockClear();
			state.cache.put.mockClear();
			const response = await worker.fetch(new Request(url, { headers }), state.env, state.ctx);
			expect(response.status).toBe(status);
			expect(await response.text()).toBe(body);
			expect(state.cache.match).not.toHaveBeenCalled();
			expect(state.cache.put).not.toHaveBeenCalled();
		},
	);

	it("keeps HEAD refusal and never caches missing files", async () => {
		const state = makeState();
		addShare(state);
		const url = `${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`;
		const head = await worker.fetch(new Request(url, { method: "HEAD" }), state.env, state.ctx);
		expect(head.status).toBe(405);
		expect(head.headers.get("Allow")).toBe("GET");
		expect(state.cache.match).not.toHaveBeenCalled();
		expect((await worker.fetch(new Request(url), state.env, state.ctx)).status).toBe(404);
		expect(state.cache.put).not.toHaveBeenCalled();
	});

	it("writes the cache through waitUntil without holding the response", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
		let finishWrite = () => {};
		const writing = new Promise<void>((resolve) => {
			finishWrite = resolve;
		});
		state.cache.put.mockReturnValue(writing);
		const waitUntil = vi.spyOn(state.ctx, "waitUntil");
		const response = await worker.fetch(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`),
			state.env,
			state.ctx,
		);
		expect(await response.text()).toBe("image");
		expect(waitUntil).toHaveBeenCalledOnce();
		finishWrite();
		await state.drain();
	});

	it("derives the cache identity from the admitted share independently of the log ID", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const response = await worker.fetch(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`),
			state.env,
			state.ctx,
		);
		expect(response.status).toBe(200);
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FIXED_SLUG));
		const expected = Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		const key = new URL(state.cache.match.mock.calls[0][0].url);
		expect(key.pathname.split("/")[3]).toBe(expected);
		expect(JSON.parse(log.mock.calls[0][0] as string).shareHash).not.toBe(expected);
	});

	it("refuses a mismatched metadata slug before consulting another share's cache entry", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("first").buffer);
		await worker.fetch(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`),
			state.env,
			state.ctx,
		);
		await state.drain();
		const otherSlug = "zyxwvutsrqponmlkjihgfedc";
		state.kv.set(`share:${otherSlug}`, JSON.stringify(activeShare()));
		state.files.set(`${otherSlug}/${IMMUTABLE_PATH}`, new TextEncoder().encode("other").buffer);
		state.cache.match.mockClear();
		const response = await worker.fetch(
			new Request(`${BASE_URL}/s/${otherSlug}/${IMMUTABLE_PATH}`),
			state.env,
			state.ctx,
		);
		expect(response.status).toBe(404);
		expect(state.cache.match).not.toHaveBeenCalled();
	});

	it("falls back to guarded R2 reads when cache matching fails", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
		state.cache.match.mockRejectedValue(new Error(`${FIXED_SLUG}: ${UPLOAD_TOKEN}`));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const response = await worker.fetch(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`),
			state.env,
			state.ctx,
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("image");
		expect(log).toHaveBeenCalledOnce();
		expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(
			expect.objectContaining({ cache: "bypass", cacheMatchFailed: true }),
		);
		expect(JSON.stringify(log.mock.calls)).not.toContain(UPLOAD_TOKEN);
		expect(JSON.stringify(log.mock.calls)).not.toContain(FIXED_SLUG);
	});

	it.each(["reject", "throw"])(
		"logs a safe follow-up when cache put fails with %s",
		async (failure) => {
			const state = makeState();
			addShare(state);
			state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
			state.cache.put.mockImplementation(() => {
				const error = new Error(`${FIXED_SLUG}: ${UPLOAD_TOKEN}`);
				if (failure === "throw") throw error;
				return Promise.reject(error);
			});
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			const response = await worker.fetch(
				new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`),
				state.env,
				state.ctx,
			);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe("image");
			await expect(state.drain()).resolves.toEqual([undefined]);
			const entries = log.mock.calls.map(([line]) => JSON.parse(line as string));
			expect(entries).toHaveLength(2);
			expect(entries).toContainEqual(
				expect.objectContaining({
					event: "review_share_cache_put_failed",
					shareHash: expect.stringMatching(/^[a-f0-9]{64}$/),
				}),
			);
			expect(JSON.stringify(entries)).not.toContain(UPLOAD_TOKEN);
			expect(JSON.stringify(entries)).not.toContain(FIXED_SLUG);
		},
	);

	it("refuses a cached object deleted by R2 retention while its share is still admitted", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
		const request = new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`);
		await worker.fetch(request, state.env, state.ctx);
		await state.drain();
		state.files.delete(`${FIXED_SLUG}/${IMMUTABLE_PATH}`);
		const get = vi.spyOn(state.env.REVIEW_FILES, "get");
		const response = await worker.fetch(request, state.env, state.ctx);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "File not found" });
		expect(get).not.toHaveBeenCalled();
	});

	it("logs one structured timing line per request without share IDs or capabilities", async () => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/${IMMUTABLE_PATH}`, new TextEncoder().encode("image").buffer);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		state.delays.kv = 7;
		state.delays.r2 = 11;
		const request = new Request(
			`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}?token=${UPLOAD_TOKEN}`,
			{
				headers: { Authorization: `Bearer ${UPLOAD_TOKEN}` },
			},
		);
		await worker.fetch(request, state.env, state.ctx);
		await state.drain();
		await worker.fetch(request, state.env, state.ctx);
		expect(log).toHaveBeenCalledTimes(2);
		for (const [index, [line]] of log.mock.calls.entries()) {
			expect(line).not.toContain(FIXED_SLUG);
			expect(line).not.toContain(UPLOAD_TOKEN);
			expect(JSON.parse(line as string)).toEqual(
				expect.objectContaining({
					event: "review_share_request",
					shareHash: expect.stringMatching(/^[a-f0-9]{64}$/),
					kvMs: 7,
					r2Ms: 11,
					cacheMs: expect.any(Number),
					cache: index === 0 ? "miss" : "hit",
					status: 200,
				}),
			);
		}
	});

	it.each(["kv", "r2"])(
		"logs failed %s reads once and returns a token-free 500",
		async (binding) => {
			const state = makeState();
			addShare(state);
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			if (binding === "kv") {
				vi.spyOn(state.env.REVIEW_KV, "get").mockImplementation(async () => {
					vi.advanceTimersByTime(7);
					throw new Error(`${FIXED_SLUG}: ${UPLOAD_TOKEN}`);
				});
			} else {
				vi.spyOn(state.env.REVIEW_FILES, "get").mockImplementation(async () => {
					vi.advanceTimersByTime(11);
					throw new Error(`${FIXED_SLUG}: ${UPLOAD_TOKEN}`);
				});
			}
			const response = await worker.fetch(
				new Request(`${BASE_URL}/s/${FIXED_SLUG}/${IMMUTABLE_PATH}`),
				state.env,
				state.ctx,
			);
			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({ error: "Internal server error" });
			expect(state.cache.put).not.toHaveBeenCalled();
			expect(log).toHaveBeenCalledOnce();
			const line = log.mock.calls[0][0] as string;
			expect(line).not.toContain(FIXED_SLUG);
			expect(line).not.toContain(UPLOAD_TOKEN);
			expect(JSON.parse(line)).toEqual(
				expect.objectContaining({
					status: 500,
					kvMs: binding === "kv" ? 7 : 0,
					r2Ms: binding === "r2" ? 11 : 0,
				}),
			);
		},
	);

	it.each(["expired", "revoked"])(
		"checks %s slashless shares before redirecting",
		async (stateName) => {
			const state = makeState();
			if (stateName === "expired")
				addShare(state, { ...activeShare(), expiresAt: "2026-07-22T16:00:00.000Z" });
			const response = await worker.fetch(
				new Request(`${BASE_URL}/s/${FIXED_SLUG}`),
				state.env,
				state.ctx,
			);
			expect(response.status).toBe(stateName === "expired" ? 410 : 404);
			expect(state.cache.match).not.toHaveBeenCalled();
		},
	);

	it.each([
		["bytes=2-4", 206, "234", "bytes 2-4/10"],
		["bytes=7-", 206, "789", "bytes 7-9/10"],
		["bytes=-3", 206, "789", "bytes 7-9/10"],
		["bytes=7-99", 206, "789", "bytes 7-9/10"],
		["bytes=-99", 206, "0123456789", "bytes 0-9/10"],
		["bytes=10-", 416, "", "bytes */10"],
		["bytes=-0", 416, "", "bytes */10"],
		["bytes=4-2", 200, "0123456789", null],
		["bytes=0-1,4-5", 200, "0123456789", null],
		["bytes=-", 200, "0123456789", null],
		["bytes=9007199254740992-", 200, "0123456789", null],
	])("serves audio range %s with status %i", async (range, status, body, contentRange) => {
		const state = makeState();
		addShare(state);
		state.files.set(`${FIXED_SLUG}/audio.mp3`, new TextEncoder().encode("0123456789").buffer);
		const get = vi.spyOn(state.env.REVIEW_FILES, "get");
		const response = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/audio.mp3`, {
				headers: { Range: range },
			}),
			state.env,
		);
		expect(response.status).toBe(status);
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(response.headers.get("Content-Range")).toBe(contentRange);
		if (status !== 416) expect(response.headers.get("Content-Length")).toBe(String(body.length));
		expect(await response.text()).toBe(body);
		if (status === 206)
			expect(get).toHaveBeenCalledWith(`${FIXED_SLUG}/audio.mp3`, {
				onlyIf: undefined,
				range: { offset: Number(body[0]), length: body.length },
			});
	});

	it.each(['"a"', '"old"', 'W/"a"', "Wed, 22 Jul 2026 16:00:00 GMT"])(
		"respects If-Range %s",
		async (ifRange) => {
			const state = makeState();
			addShare(state);
			state.files.set(`${FIXED_SLUG}/audio.mp3`, new TextEncoder().encode("0123456789").buffer);
			const response = await handleRequest(
				new Request(`${BASE_URL}/s/${FIXED_SLUG}/audio.mp3`, {
					headers: { Range: "bytes=2-4", "If-Range": ifRange },
				}),
				state.env,
			);
			expect(response.status).toBe(ifRange === '"a"' ? 206 : 200);
			expect(await response.text()).toBe(ifRange === '"a"' ? "234" : "0123456789");
		},
	);

	it.each(["bytes=2-4", "bytes=99-"])(
		"evaluates conditional GET before range %s",
		async (range) => {
			const state = makeState();
			addShare(state);
			state.files.set(`${FIXED_SLUG}/audio.mp3`, new TextEncoder().encode("0123456789").buffer);
			const response = await handleRequest(
				new Request(`${BASE_URL}/s/${FIXED_SLUG}/audio.mp3`, {
					headers: { Range: range, "If-None-Match": '"a"' },
				}),
				state.env,
			);
			expect(response.status).toBe(304);
			expect(await response.text()).toBe("");
		},
	);

	it("rejects ranges of empty files and preserves missing-file responses", async () => {
		const state = makeState();
		addShare(state);
		const request = new Request(`${BASE_URL}/s/${FIXED_SLUG}/audio.mp3`, {
			headers: { Range: "bytes=0-" },
		});
		expect((await handleRequest(request, state.env)).status).toBe(404);
		state.files.set(`${FIXED_SLUG}/audio.mp3`, new ArrayBuffer(0));
		const response = await handleRequest(request, state.env);
		expect(response.status).toBe(416);
		expect(response.headers.get("Content-Range")).toBe("bytes */0");
	});

	it("returns the plain 410 expiry page without reading R2", async () => {
		const state = makeState();
		addShare(state, {
			...activeShare(),
			expiresAt: "2026-07-22T15:59:59.999Z",
			title: UPLOAD_TOKEN,
		});
		state.files.set(`${FIXED_SLUG}/index.html`, new TextEncoder().encode("not served").buffer);

		const response = await handleRequest(new Request(`${BASE_URL}/s/${FIXED_SLUG}/`), state.env);
		const html = await response.text();
		expect(response.status).toBe(410);
		expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(html).toContain("This review link has expired");
		expect(html).not.toContain(UPLOAD_TOKEN);
	});

	it("redirects slashless share entry to the canonical directory without losing its query", async () => {
		const state = makeState();
		addShare(state);
		const response = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}?embed=1&praxity-page=slide-2`),
			state.env,
		);
		expect(response.status).toBe(308);
		expect(response.headers.get("Location")).toBe(
			`${BASE_URL}/s/${FIXED_SLUG}/?embed=1&praxity-page=slide-2`,
		);
		expect(new URL("course-shell.js", response.headers.get("Location") ?? "").pathname).toBe(
			`/s/${FIXED_SLUG}/course-shell.js`,
		);
		expect(state.files.size).toBe(0);
	});

	it("stores raw comments with clamped fields and filters them per page", async () => {
		const state = makeState();
		addShare(state);
		const rawName = `<b>${"n".repeat(MAX_NAME_LENGTH)}</b>`;
		const rawText = `<script>alert(1)</script>${"x".repeat(MAX_COMMENT_LENGTH)}`;
		const rawPage = `page-${"p".repeat(MAX_PAGE_LENGTH)}`;
		const postResponse = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments`, {
				method: "POST",
				headers: {
					"CF-Connecting-IP": "203.0.113.10",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					page: rawPage,
					pageHeading: "h".repeat(MAX_PAGE_HEADING_LENGTH + 1),
					name: rawName,
					text: rawText,
				}),
			}),
			state.env,
		);
		expect(postResponse.status).toBe(201);
		expect(postResponse.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
		expect(postResponse.headers.get("Cache-Control")).toBe("no-store");
		expect(postResponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
		const postedText = await postResponse.text();
		expect(postedText).toContain("<script>alert(1)</script>");
		expect(postedText).not.toContain(UPLOAD_TOKEN);
		const posted = JSON.parse(postedText) as {
			page: string;
			pageHeading: string;
			name: string;
			text: string;
			at: string;
		};
		expect(posted.page).toHaveLength(MAX_PAGE_LENGTH);
		expect(posted.pageHeading).toHaveLength(MAX_PAGE_HEADING_LENGTH);
		expect(posted.name).toHaveLength(MAX_NAME_LENGTH);
		expect(posted.text).toHaveLength(MAX_COMMENT_LENGTH);
		expect(posted.at).toBe("2026-07-22T16:00:00.000Z");

		const getResponse = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments?page=${encodeURIComponent(posted.page)}`),
			state.env,
		);
		expect(getResponse.status).toBe(200);
		expect(getResponse.headers.get("Cache-Control")).toBe("no-store");
		expect(await getResponse.json()).toEqual([posted]);

		const otherPageResponse = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments?page=another-page`),
			state.env,
		);
		expect(await otherPageResponse.json()).toEqual([]);
	});

	it("preserves legacy comments and validates optional heading snapshots", async () => {
		const state = makeState();
		addShare(state);
		const legacy = { page: "one", name: "Old", text: "Existing", at: "2026-07-22" };
		state.kv.set(`comments:${FIXED_SLUG}`, JSON.stringify([legacy]));
		for (const pageHeading of [null, 1, {}, ""]) {
			const result = await handleRequest(
				new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments`, {
					method: "POST",
					body: JSON.stringify({ page: "one", name: "Reviewer", text: "Note", pageHeading }),
				}),
				state.env,
			);
			expect(result.status).toBe(400);
		}
		const result = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments`, {
				method: "POST",
				body: JSON.stringify({ page: "one", name: "Reviewer", text: "Note" }),
			}),
			state.env,
		);
		expect(result.status).toBe(201);
		expect(await result.json()).not.toHaveProperty("pageHeading");
		const loaded = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments?page=one`),
			state.env,
		);
		expect(await loaded.json()).toEqual([legacy, expect.objectContaining({ text: "Note" })]);
	});

	it("limits each IP hash to ten comments per slug per minute", async () => {
		const state = makeState();
		addShare(state);
		const makeRequest = () =>
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments`, {
				method: "POST",
				headers: {
					"CF-Connecting-IP": "198.51.100.42",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ page: "page-1", name: "Reviewer", text: "Feedback" }),
			});

		for (let count = 0; count < 10; count += 1) {
			expect((await handleRequest(makeRequest(), state.env)).status).toBe(201);
		}
		const limited = await handleRequest(makeRequest(), state.env);
		expect(limited.status).toBe(429);
		expect(await limited.json()).toEqual({ error: "Too many comments; try again next minute" });
		const rateKeys = [...state.kv.keys()].filter((key) => key.startsWith("rate:"));
		expect(rateKeys).toHaveLength(1);
		expect(rateKeys[0]).not.toContain("198.51.100.42");
	});

	it("returns JSON errors for comments on missing and expired shares", async () => {
		const state = makeState();
		const missing = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments?page=page-1`),
			state.env,
		);
		expect(missing.status).toBe(404);
		expect(missing.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
		expect(missing.headers.get("Cache-Control")).toBe("no-store");

		addShare(state, { ...activeShare(), expiresAt: "2026-07-22T16:00:00.000Z" });
		const expired = await handleRequest(
			new Request(`${BASE_URL}/s/${FIXED_SLUG}/comments?page=page-1`),
			state.env,
		);
		expect(expired.status).toBe(410);
		expect(expired.headers.get("Cache-Control")).toBe("no-store");
		expect(await expired.json()).toEqual({ error: "Review link has expired" });
	});
});
