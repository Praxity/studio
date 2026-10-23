import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { restoreProjectRecovery } from "../../project-file-transactions";

// Pause at the next filesystem operation after the hold's durable publication.
// The parent kills this process before the restore can apply its plan.
const [root, source] = process.argv.slice(2);
let published = false;
for (const method of ["open", "lstat", "readdir"] as const) {
	const original = fsp[method];
	Object.assign(fsp, {
		[method]: async (...args: Parameters<typeof original>) => {
			if (published) {
				process.send?.({ held: true });
				await new Promise(() => {});
			}
			return Reflect.apply(original, fsp, args);
		},
	});
}
const rename = fsp.rename;
fsp.rename = async (...args) => {
	await rename(...args);
	if (basename(String(args[1])) === "held") {
		// Finish the marker's platform-specific flushes before pausing.
		const open = fsp.open;
		fsp.open = async (...openArgs) => {
			const handle = await open(...openArgs);
			const close = handle.close.bind(handle);
			handle.close = async () => {
				await close();
				published = true;
			};
			return handle;
		};
		syncBuiltinESMExports();
	}
};
syncBuiltinESMExports();
await restoreProjectRecovery(root, source, "original", "lesson.prax");
process.disconnect();
