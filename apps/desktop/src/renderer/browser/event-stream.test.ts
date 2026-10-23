// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openBrowserEventStream } from "./event-stream";

class Request {
	static HEADERS_RECEIVED = 2;
	readyState = 0;
	status = 200;
	responseText = "";
	onreadystatechange: (() => void) | null = null;
	onprogress: (() => void) | null = null;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	open = vi.fn();
	setRequestHeader = vi.fn();
	overrideMimeType = vi.fn();
	send = vi.fn();
	abort = vi.fn(() => this.onabort?.());
}
let request: Request;
let abort: AbortController;
beforeEach(() => {
	request = new Request();
	abort = new AbortController();
	vi.stubGlobal(
		"XMLHttpRequest",
		class extends Request {
			constructor() {
				super();
				return request;
			}
		},
	);
});
afterEach(() => {
	abort.abort();
	vi.unstubAllGlobals();
});

function headers() {
	request.readyState = 2;
	request.onreadystatechange?.();
}
function progress(text: string) {
	request.responseText = text;
	request.onprogress?.();
}

it("uses the explicit editor event URL independently of the course base", async () => {
	const response = openBrowserEventStream(
		"token",
		abort.signal,
		10,
		"http://127.0.0.1:4000/api/events",
	);
	expect(request.open).toHaveBeenCalledWith("GET", "http://127.0.0.1:4000/api/events");
	headers();
	expect((await response).status).toBe(200);
});

it("delivers bytes on progress, including split UTF-8, without waiting for completion", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	headers();
	const reader = (await response).body?.getReader();
	if (!reader) throw new Error("Missing response body");
	progress("\uf7c3");
	expect((await reader.read()).value).toEqual(new Uint8Array([0xc3]));
	progress("\uf7c3\uf7a9");
	expect((await reader.read()).value).toEqual(new Uint8Array([0xa9]));
	request.onload?.();
	expect((await reader.read()).done).toBe(true);
	expect(request.open).toHaveBeenCalledWith("GET", "/api/events");
	expect(request.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer token");
	expect(request.overrideMimeType).toHaveBeenCalledWith("text/plain; charset=x-user-defined");
});

it("bounds retained text even after earlier bytes have been consumed", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	headers();
	const reader = (await response).body?.getReader();
	if (!reader) throw new Error("Missing response body");
	progress("ready\n");
	expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n");
	progress("ready\nnext\n");
	await expect(reader.read()).rejects.toThrow("Event stream exceeded its limit");
	expect(request.abort).toHaveBeenCalledOnce();
});

it("returns an HTTP refusal rather than admitting it as a successful stream", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	request.status = 401;
	headers();
	expect((await response).status).toBe(401);
	expect((await response).ok).toBe(false);
});

it.each(["before headers", "before request"])("rejects an abort %s", async (when) => {
	if (when === "before request") abort.abort();
	const response = openBrowserEventStream("token", abort.signal, 10);
	abort.abort();
	await expect(response).rejects.toMatchObject({ name: "AbortError" });
	expect(request.abort).toHaveBeenCalledOnce();
	if (when === "before request") expect(request.send).not.toHaveBeenCalled();
});

it("fails pending reads on a network error", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	headers();
	const reader = (await response).body?.getReader();
	if (!reader) throw new Error("Missing response body");
	request.onerror?.();
	await expect(reader.read()).rejects.toThrow("Event stream unavailable");
});

it("cancels the request and ignores captured late progress after reader disposal", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	headers();
	const reader = (await response).body?.getReader();
	if (!reader) throw new Error("Missing response body");
	const late = request.onprogress;
	await reader.cancel();
	request.responseText = "late";
	late?.();
	expect((await reader.read()).done).toBe(true);
	expect(request.abort).toHaveBeenCalledOnce();
	expect(request.onprogress).toBeNull();
});

it.each([204, 205, 304])(
	"rejects invalid body status %i and closes the request",
	async (status) => {
		const response = openBrowserEventStream("token", abort.signal, 10);
		request.status = status;
		try {
			headers();
		} catch {
			// A browser event handler must reject the caller instead of throwing out of band.
		}
		await expect(response).rejects.toBeInstanceOf(TypeError);
		expect(request.abort).toHaveBeenCalledOnce();
	},
);

it("settles on load when the engine skips the headers state", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	request.responseText = "ready\n";
	request.onload?.();
	expect(await (await response).text()).toBe("ready\n");
});

it("rejects a network error before headers", async () => {
	const response = openBrowserEventStream("token", abort.signal, 10);
	request.onerror?.();
	await expect(response).rejects.toThrow("Event stream unavailable");
	expect(request.abort).toHaveBeenCalledOnce();
});

it("fetch events bypass the cache without delaying document load", async () => {
	const fetchStream = vi.fn(
		async () =>
			new Response(new Uint8Array([65, 66]), {
				headers: { "Content-Type": "application/x-ndjson" },
			}),
	);
	const pending = openBrowserEventStream(
		"token",
		abort.signal,
		10,
		"http://127.0.0.1:4000/api/events",
		fetchStream,
	);
	void pending.catch(() => {});
	expect(fetchStream).toHaveBeenCalledWith("http://127.0.0.1:4000/api/events", {
		headers: { Authorization: "Bearer token" },
		credentials: "omit",
		cache: "no-store",
		signal: abort.signal,
	});
	const response = await pending;
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([65, 66]));
	expect(request.open).not.toHaveBeenCalled();
});
it("fetch events enforce the same byte limit and cancel upstream on overflow", async () => {
	const cancel = vi.fn();
	const fetchStream = vi.fn(
		async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array([1, 2, 3]));
					},
					cancel,
				}),
			),
	);
	const pending = openBrowserEventStream(
		"token",
		abort.signal,
		2,
		"http://127.0.0.1:4000/api/events",
		fetchStream,
	);
	void pending.catch(() => {});
	expect(fetchStream).toHaveBeenCalled();
	const response = await pending;
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing event reader");
	await expect(reader.read()).rejects.toThrow("Event stream exceeded its limit");
	await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});
it("fetch event reader cancellation cancels its captured upstream", async () => {
	const cancel = vi.fn();
	const fetchStream = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel })));
	const pending = openBrowserEventStream(
		"token",
		abort.signal,
		10,
		"http://127.0.0.1:4000/api/events",
		fetchStream,
	);
	void pending.catch(() => {});
	expect(fetchStream).toHaveBeenCalled();
	const response = await pending;
	await response.body?.cancel();
	expect(cancel).toHaveBeenCalledTimes(1);
});
