export const MAX_BUFFERED_EVENT_CHARACTERS = 20_000_000;

/** XHR progress delivers NDJSON promptly where WebKit's fetch reader buffers updates. */
export function openBrowserEventStream(
	token: string,
	signal: AbortSignal,
	maxCharacters: number,
	url = "/api/events",
	fetchStream?: typeof fetch,
): Promise<Response> {
	// Gecko's pre-load XHR holds document load open. Its fetch reader streams promptly.
	if (fetchStream)
		return fetchStream(url, {
			headers: { Authorization: `Bearer ${token}` },
			credentials: "omit",
			// Gecko can hold an identical pending stream behind the HTTP cache entry.
			cache: "no-store",
			signal,
		}).then((response) => {
			let bytes = 0;
			const body = response.body?.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						bytes += chunk.byteLength;
						if (bytes > maxCharacters) throw new Error("Event stream exceeded its limit");
						controller.enqueue(chunk);
					},
				}),
			);
			return new Response(body ?? null, { status: response.status, headers: response.headers });
		});
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		let controller: ReadableStreamDefaultController<Uint8Array>;
		let offset = 0;
		let finished = false;
		let resolved = false;
		const cleanup = () => {
			signal.removeEventListener("abort", abort);
			request.onreadystatechange = null;
			request.onprogress = null;
			request.onload = null;
			request.onerror = null;
			request.onabort = null;
		};
		const fail = (error: Error) => {
			if (finished) return;
			finished = true;
			cleanup();
			request.abort();
			controller.error(error);
			reject(error);
		};
		const abort = () => fail(new DOMException("Event stream aborted", "AbortError"));
		const body = new ReadableStream<Uint8Array>({
			start(value) {
				controller = value;
			},
			cancel() {
				finished = true;
				cleanup();
				request.abort();
			},
		});
		const progress = () => {
			if (finished) return;
			// XHR retains consumed text. Reconnect at the existing stream limit to release it.
			if (request.responseText.length > maxCharacters) {
				fail(new Error("Event stream exceeded its limit"));
				return;
			}
			const text = request.responseText.slice(offset);
			offset = request.responseText.length;
			if (text)
				controller.enqueue(Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff));
		};
		request.open("GET", url);
		// Preserve split UTF-8 sequences and let the bridge's fatal decoder validate them.
		request.overrideMimeType("text/plain; charset=x-user-defined");
		request.setRequestHeader("Authorization", `Bearer ${token}`);
		// Same-origin cookies are sent; the server authenticates only the bearer token.
		const settle = () => {
			if (finished || resolved) return;
			try {
				resolve(new Response(body, { status: request.status }));
				resolved = true;
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		};
		request.onreadystatechange = () => {
			if (request.readyState === XMLHttpRequest.HEADERS_RECEIVED) settle();
		};
		request.onprogress = progress;
		request.onload = () => {
			settle();
			progress();
			if (finished) return;
			finished = true;
			cleanup();
			controller.close();
		};
		request.onerror = () => fail(new TypeError("Event stream unavailable"));
		request.onabort = abort;
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		else request.send();
	});
}
