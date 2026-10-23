import { parseLessonSource, writeLessonSource } from "../../lesson-source";
import { withProjectFileTransaction } from "../../project-file-transactions";

process.on(
	"message",
	async (message: { root: string; filename: string; source: string; hold?: boolean }) => {
		try {
			if (message.hold) {
				await withProjectFileTransaction(
					message.root,
					async () => {
						process.send?.({ held: true });
						await new Promise(() => {});
					},
					"write",
				);
				return;
			}
			await writeLessonSource(message.root, message.filename, message.source);
			const parsed = await parseLessonSource(message.root, message.filename, message.source);
			process.send?.({ result: parsed.pages.map((page) => page.id) });
		} catch (error) {
			process.send?.({ error: String(error) });
		}
	},
);
process.send?.({ ready: true });
