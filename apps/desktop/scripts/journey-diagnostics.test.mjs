import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import test from "node:test";
import { captureJourneyRequests } from "../e2e/browser-editor/journey-diagnostics.ts";

test("journey diagnostics distinguish an admitted pending request from a finished reply", async () => {
	let release;
	let received;
	const admitted = new Promise((resolve) => {
		received = resolve;
	});
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			release = () => res.end("saved");
			received();
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const origin = `http://127.0.0.1:${server.address().port}`;
	const diagnostics = captureJourneyRequests(origin);
	try {
		const req = request(`${origin}/api/rpc`, { method: "POST" });
		const reply = once(req, "response");
		req.end("private authored text");
		await admitted;
		diagnostics.mark("before-close");
		release();
		const [res] = await reply;
		res.resume();
		await once(res, "end");
		const log = diagnostics.finish();
		const events = JSON.parse(log);
		assert.deepEqual(
			events.filter(({ phase }) => phase !== "closed").map(({ at, ...event }) => event),
			[
				{ phase: "received", id: 1, route: "/api/rpc", method: "POST" },
				{ phase: "body-end", id: 1, complete: true },
				{ phase: "before-close" },
				{ phase: "finished", id: 1, status: 200 },
			],
		);
		assert.ok(events.every(({ at }) => Number.isSafeInteger(at)));
		assert.ok(events.some((event) => event.phase === "closed" && event.finished === true));
		assert.ok(!log.includes("private authored text"));
	} finally {
		diagnostics.finish();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("journey diagnostics ignore other listeners and capability paths, then unsubscribe", async () => {
	const servers = [createServer(), createServer()];
	for (const server of servers) {
		server.on("request", (req, res) => {
			req.resume();
			res.end();
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
	}
	const origins = servers.map((server) => `http://127.0.0.1:${server.address().port}`);
	const diagnostics = captureJourneyRequests(origins[0]);
	async function get(url) {
		const req = request(url, { headers: { Authorization: "Bearer secret" } });
		const response = once(req, "response");
		req.end();
		const [res] = await response;
		res.resume();
		await once(res, "end");
	}
	try {
		await get(`${origins[1]}/api/rpc`);
		await get(`${origins[0]}/canvas/private-capability`);
		assert.equal(diagnostics.finish(), "[]");
		await get(`${origins[0]}/api/events`);
		assert.equal(diagnostics.finish(), "[]");
	} finally {
		diagnostics.finish();
		for (const server of servers) {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		}
	}
});
