import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("a small single event arrives before the server closes or sends another event", async ({
	page,
}) => {
	const bundle = await build({
		entryPoints: ["src/renderer/browser/event-stream.ts"],
		absWorkingDir: fileURLToPath(new URL("../..", import.meta.url)),
		bundle: true,
		write: false,
		format: "esm",
	});
	const event = '{"type":"heartbeat"}\n';
	let eventResponse: ServerResponse | undefined;
	const server = createServer((request, response) => {
		if (request.url === "/event-stream.js") {
			response.writeHead(200, { "Content-Type": "text/javascript" });
			response.end(bundle.outputFiles[0].text);
		} else if (request.url === "/api/events") {
			eventResponse = response;
			response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
			response.write('{"type":"ready"}\n');
		} else if (request.url === "/send-event") {
			eventResponse?.write(event);
			response.end();
		} else {
			response.end("<!doctype html><title>Small event</title>");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing server address");
		await page.goto(`http://127.0.0.1:${address.port}`);
		await page.evaluate(async () => {
			const moduleUrl = "/event-stream.js";
			const { openBrowserEventStream } = await import(moduleUrl);
			const response = await openBrowserEventStream(
				"token",
				new AbortController().signal,
				20_000_000,
			);
			const reader = response.body.getReader();
			const first = await reader.read();
			if (new TextDecoder().decode(first.value) !== '{"type":"ready"}\n')
				throw new Error("Missing complete unpadded ready event");
			await fetch("/send-event");
			void (async () => {
				let received = "";
				while (!received.includes("heartbeat")) {
					const { value, done } = await reader.read();
					if (done) throw new Error("Server closed before the event arrived");
					received += new TextDecoder().decode(value);
				}
				document.body.textContent = received;
				await reader.cancel();
			})();
		});
		await expect(page.locator("body")).toHaveText(event.trim());
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
