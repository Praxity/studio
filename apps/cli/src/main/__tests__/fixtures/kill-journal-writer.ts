import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { ProjectFileChange } from "../../project-file-transactions";

export function killCommittedJournal(root: string, changes: readonly ProjectFileChange[]) {
	return killJournalWriter(
		root,
		"committed-save",
		changes.map((change) => JSON.stringify(change)),
	);
}

export async function killJournalWriter(
	root: string,
	step: string,
	sources?: readonly string[],
	writerEntry?: string,
): Promise<void> {
	const child = fork(
		writerEntry ?? fileURLToPath(new URL("./journal-writer.ts", import.meta.url)),
		[root, step, ...(sources ? [JSON.stringify(sources)] : [])],
		{
			execArgv: writerEntry ? [] : ["--import", "tsx"],
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		},
	);
	let errors = "";
	child.stderr?.on("data", (chunk) => {
		errors += chunk;
	});
	const exited = once(child, "exit");
	try {
		await Promise.race([
			once(child, "message").then(([message]) => {
				if (!message.paused) throw new Error(message.error ?? "Writer did not pause");
			}),
			exited.then(([code]) => {
				throw new Error(`Writer exited ${code}: ${errors}`);
			}),
		]);
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
	}
}
