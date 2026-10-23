import { constants } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";

const [root, action] = process.argv.slice(2);
process.on("message", () => {});
async function pause() {
	process.send?.({ paused: true });
	await new Promise<void>(() => {});
}
const open = fs.open;
fs.open = async (...args) => {
	const file = await open(...args);
	if (
		Number(args[1]) & constants.O_TRUNC &&
		["course.yaml", "install-0"].includes(basename(String(args[0]))) &&
		action === "manifest"
	) {
		await file.write("title: PAR");
		await pause();
	}
	if (action === "create" && String(args[0]) === join(root, "new.prax")) {
		const write = file.writeFile.bind(file);
		file.writeFile = (async (...options: Parameters<typeof file.writeFile>) => {
			await write(...options);
			await pause();
		}) as typeof file.writeFile;
	}
	return file;
};
const rename = fs.rename;
fs.rename = async (...args) => {
	await rename(...args);
	if (
		(action === "delete" && String(args[0]) === join(root, "lesson.prax")) ||
		(action === "narration" && String(args[1]).endsWith(".mp3"))
	)
		await pause();
};
const rm = fs.rm;
fs.rm = async (...args) => {
	await rm(...args);
	if (action === "delete" && String(args[0]) === join(root, "lesson.prax")) await pause();
};
const link = fs.link;
fs.link = async (...args) => {
	await link(...args);
	if (
		(action === "rename" && String(args[1]) === join(root, "renamed.prax")) ||
		(action === "create" && String(args[1]) === join(root, "new.prax")) ||
		(action === "narration" && String(args[1]).endsWith(".mp3"))
	)
		await pause();
};
syncBuiltinESMExports();
try {
	if (action === "manifest") {
		const { writeManifestFixtureLessons } = await import("../../../test-utils/manifest-fixture");
		await writeManifestFixtureLessons(root);
	} else if (action === "create") {
		const { createCourseLesson } = await import("../../course-io");
		await createCourseLesson(root, "new.prax", "---\ntitle: new\n---\n\n");
	} else if (action === "narration") {
		const { writeGeneratedNarration } = await import("../../narration");
		const { request, generated } = JSON.parse(
			await fs.readFile(join(root, "generated.json"), "utf8"),
		);
		await writeGeneratedNarration(
			join(root, "assets"),
			request,
			{ ...generated, audio: Buffer.from("ID3audio") },
			root,
		);
	} else {
		const { deleteLessonSource, renameProjectSource } = await import("../../lesson-source");
		await (action === "delete"
			? deleteLessonSource(root, "lesson.prax")
			: renameProjectSource(root, "lesson.prax", "renamed.prax"));
	}
	process.send?.({ error: "Writer did not pause" });
} catch (error) {
	process.send?.({ error: String(error) });
}
process.disconnect();
