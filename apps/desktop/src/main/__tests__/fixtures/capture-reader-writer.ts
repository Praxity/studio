import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const [projectPath, target, content] = process.argv.slice(2);
// Admission canonicalizes directory aliases, including macOS /var -> /private/var.
// Match the writer's actual rename path so the capture cannot silently complete.
const root = await fs.realpath(projectPath);
const rename = fs.rename;
fs.rename = async (...args) => {
	await rename(...args);
	if (String(args[0]) === join(root, target) && String(args[1]).includes(".capture-")) {
		process.send?.({ captured: true });
		await new Promise<void>((resolve) => process.once("message", () => resolve()));
	}
};
syncBuiltinESMExports();
const { writeProjectFiles } = await import("../../project-file-transactions");
try {
	await writeProjectFiles(root, [{ path: target, content }]);
} catch (error) {
	process.send?.({ error: String(error) });
	process.exitCode = 1;
}
process.disconnect?.();
