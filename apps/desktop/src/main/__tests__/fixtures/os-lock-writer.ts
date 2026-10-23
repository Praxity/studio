import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeLessonSource } from "../../lesson-source";
import { withProjectFileTransaction, writeProjectTextFile } from "../../project-file-transactions";

const [mode, root, platform] = process.argv.slice(2);
if (platform === "darwin" && process.platform === "win32") {
	// Exercise Darwin identity policy on Windows without changing path lookup semantics.
	const relative = path.relative;
	path.relative = (...args) => relative(...args).replaceAll("\\", "/");
}
if (platform) Object.defineProperty(process, "platform", { value: platform });
let lockPath: string | null = null;
const execute = DatabaseSync.prototype.exec;
let reportedWaiting = false;
DatabaseSync.prototype.exec = function (sql) {
	try {
		const result = execute.call(this, sql);
		if (sql === "BEGIN EXCLUSIVE") lockPath = this.location();
		return result;
	} catch (error) {
		const code = (error as { errcode?: number }).errcode;
		if (
			mode === "identity-waiting" &&
			sql === "BEGIN EXCLUSIVE" &&
			code !== undefined &&
			(code & 0xff) === 5 &&
			!reportedWaiting
		) {
			reportedWaiting = true;
			process.send?.({ waiting: true });
		}
		throw error;
	}
};
let resume = () => {};
const resumed = new Promise<void>((resolve) => {
	resume = resolve;
});
process.on("message", () => resume());
if (mode === "rename") {
	const link = fsp.link;
	fsp.link = async (from, to) => {
		if (String(to).endsWith("course.json")) {
			process.send?.({ paused: true, lockPath });
			await resumed;
		}
		return link(from, to);
	};
}
if (mode === "staged" || mode === "staged-differing") {
	const open = fsp.open;
	fsp.open = async (...args) => {
		const handle = await open(...args);
		if (
			String(args[0]).includes(".praxity-write-") &&
			(String(args[0]).endsWith("course.yaml") || String(args[0]).endsWith("install-0"))
		) {
			const write = handle.writeFile.bind(handle);
			handle.writeFile = async (...data) => {
				await write(
					mode === "staged-differing"
						? "PARTIAL BYTES"
						: Buffer.from(data[0] as string).subarray(0, 3),
				);
				process.send?.({ paused: true, lockPath });
				await resumed;
				return write(...data);
			};
		}
		return handle;
	};
}
if (mode === "no-journal") {
	const write = fs.writeFileSync;
	fs.writeFileSync = ((path, ...args) => {
		if (String(path).includes("owner-")) throw new Error("Owner journal publication attempted");
		return write(path, ...args);
	}) as typeof fs.writeFileSync;
}
syncBuiltinESMExports();
try {
	if (mode === "hold") {
		await withProjectFileTransaction(
			root,
			async () => {
				process.send?.({ paused: true, lockPath });
				await resumed;
			},
			"write",
		);
	} else if (mode === "rename" || mode === "identity" || mode === "identity-waiting") {
		await writeLessonSource(root, mode === "rename" ? "old.prax" : "new.prax", "# Lesson\n");
	} else {
		await writeProjectTextFile(root, "course.yaml", "title: Edited\n", "title: Original\n");
	}
	process.send?.({ done: true });
} catch (error) {
	process.send?.({ done: true, error: String(error), code: (error as NodeJS.ErrnoException).code });
}
process.disconnect();
