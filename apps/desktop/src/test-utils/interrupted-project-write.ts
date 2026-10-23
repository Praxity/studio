import { fork } from "node:child_process";
import { once } from "node:events";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Kill a real participating writer while its authored destination is absent. */
export async function interruptProjectWrite(
	root: string,
	target: string,
	content: string,
	writerEntry?: string,
) {
	const child = fork(
		writerEntry ??
			fileURLToPath(
				new URL("../main/__tests__/fixtures/capture-reader-writer.ts", import.meta.url),
			),
		[root, target, content],
		{ execArgv: writerEntry ? [] : ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] },
	);
	let errors = "";
	let output = "";
	child.stderr?.on("data", (chunk) => {
		errors += chunk;
	});
	child.stdout?.on("data", (chunk) => {
		output += chunk;
	});
	// close follows exit and drains the diagnostic streams before reporting them.
	const closed = once(child, "close");
	try {
		const [message] = await Promise.race([
			once(child, "message"),
			closed.then(([code, signal]) => {
				throw new Error(
					`Writer exited before capture (code=${code}, signal=${signal})\nstderr: ${errors}\nstdout: ${output}`,
				);
			}),
		]);
		if (!message.captured) throw new Error(`Writer did not capture: ${JSON.stringify(message)}`);
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await closed;
	}
}

/** Access times are excluded because this observation itself updates them. */
export async function projectDiskSnapshot(root: string): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	async function visit(relative: string) {
		const path = join(root, relative);
		const stat = await lstat(path);
		const metadata = { mtime: stat.mtimeMs, ctime: stat.ctimeMs, birthtime: stat.birthtimeMs };
		if (stat.isDirectory()) {
			const entries = (await readdir(path)).sort();
			result[relative] = { ...metadata, entries };
			for (const entry of entries) await visit(join(relative, entry));
		} else result[relative] = { ...metadata, bytes: (await readFile(path)).toString("base64") };
	}
	await visit("");
	return result;
}
