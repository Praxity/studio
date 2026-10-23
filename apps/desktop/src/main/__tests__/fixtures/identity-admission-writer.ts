import { DatabaseSync } from "node:sqlite";
import { writeLessonSource } from "../../lesson-source";
import { withProjectFileTransaction } from "../../project-file-transactions";

const [root] = process.argv.slice(2);
let resume = () => {};
const resumed = new Promise<void>((resolve) => {
	resume = resolve;
});
const execute = DatabaseSync.prototype.exec;
let reportedWaiting = false;
DatabaseSync.prototype.exec = function (sql) {
	try {
		return execute.call(this, sql);
	} catch (error) {
		const code = (error as { errcode?: number }).errcode;
		if (
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
process.on("message", async (message: { start?: boolean; resume?: boolean }) => {
	if (message.resume) {
		resume();
		return;
	}
	if (!message.start) return;
	try {
		await withProjectFileTransaction(
			root,
			async (admitted) => {
				process.send?.({ admitted: true });
				await resumed;
				await writeLessonSource(admitted, "lesson-1.prax", "# Second\n");
			},
			"write",
		);
		process.send?.({ done: true });
	} catch (error) {
		process.send?.({ done: true, error: String(error) });
	}
});
process.send?.({ ready: true });
