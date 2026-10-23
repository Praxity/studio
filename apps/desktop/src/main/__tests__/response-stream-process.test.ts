import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("survives repeated mid-body disconnects, preview release and shutdown with open descriptors", async () => {
	const child = spawn(
		process.execPath,
		[
			"--import",
			"tsx",
			fileURLToPath(new URL("./fixtures/response-stream-server.ts", import.meta.url)),
		],
		{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "";
	let errors = "";
	child.stdout.on("data", (bytes) => {
		output += bytes;
	});
	child.stderr.on("data", (bytes) => {
		errors += bytes;
	});
	try {
		const code = await new Promise<number | null>((resolve, reject) => {
			const deadline = setTimeout(() => {
				child.kill();
				reject(new Error(`Response stream process stalled: ${errors}`));
			}, 20_000);
			child.once("error", reject);
			child.once("exit", (code) => {
				clearTimeout(deadline);
				resolve(code);
			});
		});
		expect(code, errors).toBe(0);
		expect(errors).not.toMatch(/Unhandled|unhandled|ABORT_ERR|ERR_STREAM_PREMATURE_CLOSE/);
		expect(JSON.parse(output)).toMatchObject({ disconnects: 80, closed: true });
	} finally {
		if (child.exitCode === null) child.kill();
	}
}, 30_000);
