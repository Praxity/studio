import { constants } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { relative } from "node:path";

const [root, mode, stop, prefixText] = process.argv.slice(2);
const events: string[] = [];
process.on("message", () => {});
async function point(operation: string, paths: unknown[], phase: string) {
	const key = `${phase}:${operation}:${paths
		.filter((path): path is string => typeof path === "string")
		.map((path) => relative(root, path).replaceAll("\\", "/"))
		.join("|")}`;
	events.push(key);
	if (new RegExp(stop).test(key)) {
		process.send?.({ paused: true, events });
		await new Promise<void>(() => {});
	}
}
for (const operation of ["rename", "link", "unlink"] as const) {
	const original = fs[operation];
	Object.assign(fs, {
		[operation]: async (...args: Parameters<typeof original>) => {
			const result = await Reflect.apply(original, fs, args);
			await point(operation, args, "after");
			return result;
		},
	});
}
const open = fs.open;
fs.open = async (...args) => {
	const file = await open(...args);
	if (Number(args[1]) & (constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT)) {
		await point("open", [args[0]], "after");
		const write = file.writeFile.bind(file);
		file.writeFile = (async (...options: Parameters<typeof write>) => {
			if (
				prefixText !== undefined &&
				new RegExp(stop).test(
					`after:writeFile:${relative(root, String(args[0])).replaceAll("\\", "/")}`,
				)
			) {
				await write(Buffer.from(options[0] as string).subarray(0, Number(prefixText)));
			} else await write(...options);
			await point("writeFile", [args[0]], "after");
		}) as typeof file.writeFile;
		const sync = file.sync.bind(file);
		file.sync = async () => {
			await sync();
			await point("sync", [args[0]], "after");
		};
	}
	return file;
};
syncBuiltinESMExports();
const owner = await import("../../project-file-transactions");
try {
	if (mode === "recover") await owner.withProjectFileTransaction(root, async () => {}, "write");
	else
		await owner.writeProjectFiles(
			root,
			[
				{ path: "a.prax", content: "A1", expectedContent: "A0" },
				{ path: "b.prax", content: "B1", expectedContent: "B0", head: true },
			],
			{
				onStep: async ({ kind, index }) => {
					await point(`step-${kind}-${index}`, [], "after");
					if (mode === "rollback" && kind === "installed") throw new Error("Forced abort");
				},
			},
		);
	process.send?.({ error: `Did not reach ${stop}`, events });
} catch (error) {
	process.send?.({ error: String(error), events });
}
process.disconnect();
