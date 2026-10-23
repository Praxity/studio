import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { persistCourseIdentity, resolveCourseIdentity } from "../../identity-store";
import { withProjectFileTransaction } from "../../project-file-transactions";

const [root, stop] = process.argv.slice(2);
const source = await readFile(join(root, "lesson.prax"), "utf8");
try {
	await withProjectFileTransaction(
		root,
		async () => {
			const result = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": source.replace("clear path", "clear route") },
			});
			await persistCourseIdentity(root, result, [], {
				onStep: async ({ kind, index }) => {
					const journal = JSON.parse(
						await readFile(join(root, ".praxity-transaction.json"), "utf8"),
					) as { plan: { files: { path: string }[] } };
					const path = index === undefined ? "" : journal.plan.files[index].path;
					const target =
						path === "lesson.prax"
							? "source"
							: path.includes("/snapshots/")
								? "snapshot"
								: path.includes("/lessons/")
									? "head"
									: "course";
					if (stop !== (kind === "journal" ? "journal" : `${kind}:${target}`)) return;
					process.send?.({ paused: true });
					await new Promise(() => {});
				},
			});
			process.send?.({ error: "Writer completed without reaching the death point" });
		},
		"write",
	);
} catch (error) {
	process.send?.({ error: String(error) });
}
