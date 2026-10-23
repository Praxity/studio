import { writeProjectFiles } from "../../project-file-transactions";

try {
	await writeProjectFiles(process.argv[2], [
		{ path: "lesson.prax", content: "# Changed\nNew words.\n" },
		{ path: "second.prax", content: "second new" },
	]);
	process.send?.({ done: true });
} catch (error) {
	process.send?.({ error: String(error) });
}
process.disconnect();
