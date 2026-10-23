import {
	closeSync,
	ftruncateSync,
	openSync,
	renameSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { parentPort } from "node:worker_threads";

if (!parentPort) throw new Error("Native inventory writer requires a worker thread");
// Keep the write inside the native timestamp tick. The controller still waits
// for completion through the worker port before checking retained bytes.
parentPort.on("message", ({ id, mode, file, replacement, target, restore }) => {
	try {
		if (mode === "same-size") {
			const h = openSync(file, "r+");
			try {
				writeSync(h, Buffer.from(replacement), 0, replacement.length, 0);
			} finally {
				closeSync(h);
			}
		} else if (mode === "truncate-extend") {
			const h = openSync(file, "r+");
			try {
				ftruncateSync(h, 0);
				writeSync(h, Buffer.from(replacement), 0, replacement.length, 0);
			} finally {
				closeSync(h);
			}
		} else if (mode === "rename-replace") {
			writeFileSync(`${file}.replacement`, replacement);
			// Windows denies replacement of an open destination. Move its name first,
			// preserving the inventory's old open inode, then install the replacement.
			renameSync(file, `${file}.previous`);
			renameSync(`${file}.replacement`, file);
			unlinkSync(`${file}.previous`);
		} else if (mode === "symlink-retarget") {
			unlinkSync(file);
			symlinkSync(target, file, "file");
			if (restore) {
				unlinkSync(file);
				symlinkSync(restore, file, "file");
			}
		} else throw new Error(`Unknown mode ${mode}`);
		parentPort.postMessage({ id });
	} catch (error) {
		parentPort.postMessage({ id, error: String(error), stack: error.stack });
	}
});
