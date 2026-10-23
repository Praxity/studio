import { constants } from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";

const repo = new URL("../../../../../../", import.meta.url).href.replace(/\/$/, "");
const [root, mode, stop] = process.argv.slice(2);
process.on("message", () => {});
async function pause(detail) {
	process.send({ paused: true, detail });
	await new Promise(() => {});
}
const raw = { rename: fs.rename, link: fs.link, open: fs.open, rm: fs.rm, chmod: fs.chmod };
const phase = mode === "recovery" || mode === "abort" ? "rollback" : "install";
let hit = false;
async function point(label) {
	if (!hit && label === stop) {
		hit = true;
		await pause(label);
	}
}
fs.rename = async (a, b) => {
	const marker = basename(String(b));
	if (marker.startsWith("rollback-0") && /\.(intent|displaced|completed)$/.test(marker)) {
		await raw.rename(a, b);
		await point(`rollback-${marker.split(".").at(-1)}-after`);
		return;
	}
	if (marker === "installed-0") {
		await point("marker-before");
		await raw.rename(a, b);
		await point("marker-after");
		return;
	}
	if (basename(String(b)) === "journal.retired") {
		await point("journal-remove-before");
		await raw.rename(a, b);
		await point("journal-remove-after");
		return;
	}
	if (basename(String(b)).startsWith(`${phase}-0`) && String(b).includes(".capture-")) {
		await point("capture-before");
		await raw.rename(a, b);
		await point("capture-after");
		return;
	}
	return raw.rename(a, b);
};
fs.link = async (a, b) => {
	const name = basename(String(b));
	if (name.startsWith("rollback-0") && /\.(intent|displaced|completed)$/.test(name)) {
		await raw.link(a, b);
		await point(`rollback-${name.split(".").at(-1)}-after`);
		return;
	}
	if (
		String(b) === join(root, "a.prax") &&
		(basename(String(a)).startsWith(`${phase}-0`) ||
			(phase === "install" && String(a).endsWith(join("0", "a.prax")))) &&
		!String(a).includes(".capture-")
	) {
		await point("link-before");
		await raw.link(a, b);
		await point("link-after");
		return;
	}
	if (basename(String(b)) === "installed-0") {
		await point("marker-before");
		await raw.link(a, b);
		await point("marker-after");
		return;
	}
	return raw.link(a, b);
};
fs.open = async (...args) => {
	const handle = await raw.open(...args);
	const name = basename(String(args[0]));
	if (
		(name.startsWith(`${phase}-0`) ||
			(phase === "install" && String(args[0]).endsWith(join("0", "a.prax")))) &&
		!name.includes(".capture-")
	) {
		if (Number(args[1]) & constants.O_TRUNC) {
			await point("temp-empty");
			if (stop === "temp-partial") {
				await handle.write("partial");
				await point("temp-partial");
			}
			const write = handle.writeFile.bind(handle);
			handle.writeFile = async (...options) => {
				if (stop === "temp-prefix") {
					await write(Buffer.from(options[0]).subarray(0, 2));
					await point("temp-prefix");
				}
				await write(...options);
				await point("temp-written");
			};
		}
		const sync = handle.sync.bind(handle);
		handle.sync = async () => {
			await sync();
			await point("temp-flushed");
		};
	}
	return handle;
};
fs.chmod = async (a, b) => {
	await raw.chmod(a, b);
	if (
		basename(String(a)).startsWith(`${phase}-0`) ||
		(phase === "install" && String(a).endsWith(join("0", "a.prax")))
	)
		await point("temp-chmod");
};
fs.rm = async (...args) => {
	if (basename(String(args[0])) === ".praxity-transaction.json") {
		await point("journal-remove-before");
		await raw.rm(...args);
		await point("journal-remove-after");
		return;
	}
	if (basename(String(args[0])).startsWith(".praxity-write-")) await point("stage-remove-before");
	return raw.rm(...args);
};
syncBuiltinESMExports();
try {
	const tx = await import(`${repo}/apps/desktop/src/main/project-file-transactions.ts`);
	if (mode === "recovery") await tx.withProjectFileTransaction(root, async () => {}, "write");
	else
		await tx.writeProjectFiles(
			root,
			[
				{ path: "a.prax", content: "A new", expectedContent: "A old" },
				{ path: "b.prax", content: "B new", expectedContent: "B old" },
				{ path: "head.json", content: "H new", expectedContent: "H old", head: true },
			],
			{
				onStep: async ({ kind, index }) => {
					if (mode === "abort" && kind === "installed" && index === 0) throw Error("live abort");
					if (kind === "head") await point("committed-head");
					if (kind === "installed" && index === 0) await point("installed-first");
				},
			},
		);
	// B1 moves capture reclamation to a later admission; keep the deletion-death
	// checkpoint there, with the same byte assertions in the parent.
	if (stop === "stage-remove-before")
		await tx.withProjectFileTransaction(root, async () => {}, "write");
	process.send({ done: true });
} catch (e) {
	if (stop === "stage-remove-before" && mode === "abort") {
		const tx = await import(`${repo}/apps/desktop/src/main/project-file-transactions.ts`);
		await tx.withProjectFileTransaction(root, async () => {}, "write");
	}
	process.send({ error: String(e), cause: String(e.cause) });
}
process.disconnect();
