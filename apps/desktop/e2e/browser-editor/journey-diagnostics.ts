import { channel } from "node:diagnostics_channel";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Observe server receipt without reading bodies or changing the browser transport. */
export function captureJourneyRequests(origin: string) {
	const port = Number(new URL(origin).port);
	const events: Record<string, unknown>[] = [];
	const cleanups = new Set<() => void>();
	const requests = channel("http.server.request.start");
	let nextId = 0;
	const record = (event: Record<string, unknown>) => events.push({ at: Date.now(), ...event });
	const receive = (message: unknown) => {
		const { request, response } = message as {
			request: IncomingMessage;
			response: ServerResponse;
		};
		if (
			request.socket.localPort !== port ||
			(request.url !== "/api/rpc" && request.url !== "/api/events")
		)
			return;
		const id = ++nextId;
		record({ phase: "received", id, route: request.url, method: request.method });
		const bodyEnd = () => record({ phase: "body-end", id, complete: request.complete });
		const aborted = () => record({ phase: "aborted", id });
		const finished = () => record({ phase: "finished", id, status: response.statusCode });
		const closed = () => {
			record({ phase: "closed", id, finished: response.writableFinished });
			cleanup();
		};
		const cleanup = () => {
			request.off("end", bodyEnd);
			request.off("aborted", aborted);
			response.off("finish", finished);
			response.off("close", closed);
			cleanups.delete(cleanup);
		};
		cleanups.add(cleanup);
		request.once("end", bodyEnd);
		request.once("aborted", aborted);
		response.once("finish", finished);
		response.once("close", closed);
	};
	requests.subscribe(receive);
	return {
		mark(phase: string) {
			record({ phase });
		},
		finish() {
			requests.unsubscribe(receive);
			for (const cleanup of cleanups) cleanup();
			return JSON.stringify(events, null, 2);
		},
	};
}
