import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { writeProjectFiles } from "../../project-file-transactions";

const [root, outcome, death, checkpoint] = process.argv.slice(2);
process.on("message", () => {});
async function pause(label: string, path?: string) {
	process.send?.({ label, path });
	await new Promise<void>((resolve) => process.once("message", resolve));
}

// Pause at the filesystem adapter, after the owner's checks and before the unlink.
const rename = fs.rename;
let raced = false;
fs.rename = async (...args: Parameters<typeof fs.rename>) => {
	// Source retirement now renames before checking/removing it. Race the old
	// publication name, then kill after that name disappears, as in #1338.
	const phase = outcome === "rollback" ? "rollback" : "install";
	const target = new RegExp(`^${phase}-0(?:\\.attempt-[0-9a-f-]+)?\\.cleanup\\.capture-`).test(
		basename(String(args[1])),
	);
	if (target && !raced) {
		raced = true;
		await pause(checkpoint, String(args[0]));
		await rename(...args);
		if (death === "after-unlink") await pause("after-unlink", String(args[0]));
	} else await rename(...args);
};
syncBuiltinESMExports();

try {
	await writeProjectFiles(root, [{ path: "lesson.prax", content: "Saved lesson" }], {
		onStep: async ({ kind }) => {
			if (outcome === "rollback" && kind === "installed") throw new Error("Forced refusal");
		},
	});
} catch (error) {
	if (
		outcome !== "rollback" ||
		!(error instanceof Error) ||
		!/Forced refusal|rollback conflict/.test(error.message)
	)
		throw error;
}
await pause("done");
process.disconnect();
