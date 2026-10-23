import { constants } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";

const repo = new URL("../../../../../../", import.meta.url).href.replace(/\/$/, "");
const [root, scenario, stop = "installed:0"] = process.argv.slice(2);
process.on("message", () => {});
async function pause(detail) {
	process.send({ paused: true, detail });
	await new Promise(() => {});
}
async function resumePause(detail) {
	process.send({ paused: true, detail });
	await new Promise((r) => process.once("message", r));
}
const rawOpen = fs.open,
	rawRename = fs.rename,
	rawRm = fs.rm,
	rawLink = fs.link,
	rawMkdir = fs.mkdir;
if (scenario.startsWith("marker:")) {
	const [, marker, phase] = scenario.split(":");
	fs.open = async (...args) => {
		const file = await rawOpen(...args);
		if (basename(String(args[0])) === `${marker}.tmp` && Number(args[1]) & constants.O_TRUNC) {
			if (phase === "partial") await file.write("partial");
			await pause(scenario);
		}
		return file;
	};
}
if (scenario === "live-abort")
	fs.rename = async (...args) => {
		await rawRename(...args);
		if (basename(String(args[1])) === "abort") await pause("published abort");
	};
if (scenario === "cleanup")
	fs.rename = async (...args) => {
		await rawRename(...args);
		if (basename(String(args[1])) === "journal.retired") await pause("journal removed");
	};
if (scenario === "stage-before-journal")
	fs.mkdir = async (...args) => {
		const result = await rawMkdir(...args);
		if (basename(String(args[0])).startsWith(".praxity-write-"))
			await resumePause("empty running stage");
		return result;
	};
if (scenario === "git-exclude-race")
	fs.open = async (...args) => {
		const file = await rawOpen(...args);
		if (basename(String(args[0])) === "exclude" && Number(args[1]) & constants.O_APPEND) {
			const write = file.writeFile.bind(file);
			file.writeFile = async (...options) => {
				await resumePause("Git exclusion append");
				return write(...options);
			};
		}
		return file;
	};
if (scenario === "git-exclude-race")
	fs.rename = async (...args) => {
		if (basename(String(args[1])) === "exclude")
			await resumePause("Git exclusion compared, before rename");
		return rawRename(...args);
	};
if (scenario === "recovery")
	fs.rename = async (...args) => {
		await rawRename(...args);
		if (basename(String(args[1])) === "a.prax") await pause("restored first target");
	};
if (scenario === "delete")
	fs.rm = async (...args) => {
		await rawRm(...args);
		if (String(args[0]) === join(root, "a.prax")) await pause("deleted source");
	};
if (scenario === "rename")
	fs.link = async (...args) => {
		await rawLink(...args);
		if (String(args[1]) === join(root, "renamed.prax")) await pause("created rename target");
	};
if (scenario === "manifest")
	fs.open = async (...args) => {
		const file = await rawOpen(...args);
		if (
			["course.yaml", "install-0"].includes(basename(String(args[0]))) &&
			Number(args[1]) & constants.O_TRUNC
		) {
			await file.write("title: PAR");
			await pause("manifest staged partial");
		}
		return file;
	};
if (scenario === "capture-death")
	fs.rename = async (...args) => {
		await rawRename(...args);
		if (String(args[0]) === join(root, "a.prax")) await pause("captured source");
	};
if (scenario === "directory")
	fs.link = async (...args) => {
		await rawLink(...args);
		if (String(args[1]) === join(root, "new", "nested", "asset.txt"))
			await pause("directory destination installed");
	};
syncBuiltinESMExports();
if (scenario === "collision-death") {
	fs.link = async (...args) => {
		if (String(args[1]) === join(root, "a.prax")) {
			await fs.writeFile(args[1], "A new");
			try {
				await rawLink(...args);
			} catch {
				await pause("unacknowledged collision");
			}
		} else return rawLink(...args);
	};
	syncBuiltinESMExports();
}
try {
	const mod = await import(`${repo}/apps/desktop/src/main/project-file-transactions.ts`);
	if (scenario === "read" || scenario === "recovery" || scenario.startsWith("marker:conflict:"))
		await mod.withProjectFileTransaction(root, async () => {
			process.send({ admitted: true, bytes: await fs.readFile(join(root, "a.prax"), "utf8") });
		});
	else if (scenario === "manifest") {
		const m = await import(`${repo}/apps/desktop/src/main/course-manifest-io.ts`);
		await m.readCourseManifestData(root);
	} else if (scenario === "directory") {
		const m = await import(new URL("../../lesson-source.ts", import.meta.url).href);
		await m.renameProjectSource(root, "old", "new");
	} else if (scenario === "delete" || scenario === "rename") {
		const m = await import(`${repo}/apps/desktop/src/main/lesson-source.ts`);
		await (scenario === "delete"
			? m.deleteLessonSource(root, "a.prax")
			: m.renameProjectSource(root, "a.prax", "renamed.prax"));
	} else
		await mod.writeProjectFiles(
			root,
			[
				{ path: "a.prax", content: "A new", expectedContent: "A old" },
				{ path: "b.prax", content: "B new", expectedContent: "B old" },
				{ path: "head.json", content: "H new", expectedContent: "H old", head: true },
			],
			{
				onStep: async ({ kind, index }) => {
					if (scenario === "live-abort" && kind === "installed" && index === 0) {
						await fs.writeFile(join(root, "b.prax"), "B OUTSIDE");
						throw new Error("abort");
					}
					if (scenario.startsWith("marker:abort:") && kind === "head") throw new Error("abort");
					if (
						!scenario.startsWith("marker:") &&
						scenario !== "complete" &&
						scenario !== "stage-before-journal" &&
						scenario !== "cleanup" &&
						(index === undefined ? kind : `${kind}:${index}`) === stop
					)
						await pause(stop);
				},
			},
		);
	process.send({ done: true });
} catch (e) {
	process.send({ error: String(e), cause: String(e.cause) });
}
process.disconnect();
