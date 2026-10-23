import type { IncomingMessage, ServerResponse } from "node:http";

/** Match the published server's byte-range support so browsers can seek fixture media. */
export function serveFixtureBytes(
	request: IncomingMessage,
	response: ServerResponse,
	bytes: Buffer,
): void {
	response.setHeader("Accept-Ranges", "bytes");
	const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
	if (range) {
		const start = Number(range[1]);
		const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
		if (start > end) {
			response.writeHead(416, { "Content-Range": `bytes */${bytes.length}` });
			response.end();
			return;
		}
		response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${bytes.length}` });
		response.end(bytes.subarray(start, end + 1));
	} else response.end(bytes);
}
