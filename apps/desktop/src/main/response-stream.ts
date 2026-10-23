import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";

/** Own pending opens and captured bodies until their underlying streams close. */
export class ResponseStreamOwner {
	private closing = false;
	private readonly opening = new Set<Promise<ReadableStream<Uint8Array>>>();
	private readonly active = new Map<Readable, Promise<void>>();
	private closePromise?: Promise<void>;

	body(open: () => Promise<Readable> | Readable, signal: AbortSignal) {
		const task = this.openBody(open, signal);
		this.opening.add(task);
		const remove = () => this.opening.delete(task);
		void task.then(remove, remove);
		return task;
	}

	private async openBody(open: () => Promise<Readable> | Readable, signal: AbortSignal) {
		if (this.closing) throw new Error("Response streams are closing");
		signal.throwIfAborted();
		const stream = await open();
		// Keep a terminal handler for the stream's lifetime. Bridges can schedule
		// another error after close, when transient pipeline listeners are gone.
		stream.on("error", () => stream.destroy());
		const closed = stream.closed
			? Promise.resolve()
			: new Promise<void>((resolve) => stream.once("close", resolve));
		const abort = () => stream.destroy(new DOMException("Response cancelled", "AbortError"));
		signal.addEventListener("abort", abort, { once: true });
		const settle = async () => {
			stream.destroy();
			await closed;
			signal.removeEventListener("abort", abort);
			this.active.delete(stream);
		};
		// The Web body delivers read errors to its consumer. Here both outcomes
		// must wait for close, including completion on a non-auto-closing stream.
		const done = finished(stream).then(settle, settle);
		this.active.set(stream, done);
		const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
		if (this.closing || signal.aborted) {
			abort();
			await done;
			signal.throwIfAborted();
			throw new Error("Response streams are closing");
		}
		return body;
	}

	close(): Promise<void> {
		this.closing = true;
		this.closePromise ??= (async () => {
			await Promise.allSettled([...this.opening]);
			const active = [...this.active];
			for (const [stream] of active) stream.destroy();
			await Promise.all(active.map(([, done]) => done));
		})();
		return this.closePromise;
	}
}

/** Attach before asynchronous routing, including buffered files and event streams. */
export function ownHttpResponse(req: IncomingMessage, res: ServerResponse): AbortSignal {
	const cancellation = new AbortController();
	const abort = () => {
		cancellation.abort();
		res.destroy();
	};
	// Request-body readers may remove their own error listeners on abort. These
	// owners remain until the objects are collected to handle later terminal errors.
	req.on("error", abort);
	res.on("error", abort);
	req.once("aborted", abort);
	res.once("close", () => cancellation.abort());
	if (req.aborted || res.destroyed) abort();
	return cancellation.signal;
}

export async function sendResponse(response: Response, res: ServerResponse): Promise<void> {
	if (res.destroyed) {
		await response.body?.cancel();
		return;
	}
	response.headers.forEach((value, key) => res.setHeader(key, value));
	res.writeHead(response.status);
	if (!response.body) {
		res.end();
		return;
	}
	const source = Readable.fromWeb(
		response.body as import("node:stream/web").ReadableStream<Uint8Array>,
	);
	// fromWeb's reader.closed rejection can arrive after pipeline has settled.
	// It still belongs to this response and must never become an unhandled event.
	source.on("error", () => res.destroy());
	await pipeline(source, res);
}
