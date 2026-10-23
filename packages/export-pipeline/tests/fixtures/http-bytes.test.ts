import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { serveFixtureBytes } from "./http-bytes";

let server: Server;
let url: string;
beforeAll(async () => {
	server = createServer((request, response) => {
		serveFixtureBytes(request, response, Buffer.from("0123456789"));
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture server address");
	url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((done) => server.close(() => done()));
});

it.each([
	{ range: undefined, status: 200, contentRange: null, body: "0123456789" },
	{ range: "bytes=2-4", status: 206, contentRange: "bytes 2-4/10", body: "234" },
	{ range: "bytes=7-", status: 206, contentRange: "bytes 7-9/10", body: "789" },
	{ range: "bytes=7-99", status: 206, contentRange: "bytes 7-9/10", body: "789" },
	{ range: "bytes=10-", status: 416, contentRange: "bytes */10", body: "" },
	{ range: "bytes=7-3", status: 416, contentRange: "bytes */10", body: "" },
	{ range: "invalid", status: 200, contentRange: null, body: "0123456789" },
])(
	"serves $range with exact status, bounds and bytes",
	async ({ range, status, contentRange, body }) => {
		const response = await fetch(url, { headers: range ? { Range: range } : {} });
		expect(response.status).toBe(status);
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(response.headers.get("Content-Range")).toBe(contentRange);
		expect(await response.text()).toBe(body);
	},
);
