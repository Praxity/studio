import { realpathSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const within = (root, file) => file.startsWith(`${root}${path.sep}`);
export function assertNonvisualEntry(base, script) {
	if (
		realpathSync(script) !== path.join(realpathSync(base), "scripts/equivalence/nonvisual-gate.mjs")
	)
		throw new Error(
			"Run the exact trusted base scripts/equivalence/nonvisual-gate.mjs entry (realpath)",
		);
}
export function selectCourses(inputs, names, subset) {
	const missing = Object.keys(inputs.courses).filter((name) => !names.includes(name));
	if (missing.length && !subset)
		throw new Error(
			`Missing required courses: ${missing.join(", ")}; --subset explicitly selects a partial run`,
		);
	return names;
}
export function assertNodeModules(checkout) {
	const root = realpathSync(checkout);
	if (!within(root, realpathSync(path.join(root, "node_modules"))))
		throw new Error(`node_modules resolves outside selected checkout: ${root}`);
}
function productionPath(file) {
	const sourcePath = file.split(`${path.sep}node_modules${path.sep}`)[0];
	return /(?:^|\/)(?:packages|apps)\//.test(sourcePath);
}
function assertSource(checkout, file, workspaceRequest = false) {
	// Ignore third-party package internals; workspace sources must stay on this side.
	if (!workspaceRequest && !productionPath(file)) return;
	const resolved = realpathSync(file);
	if (!within(checkout, resolved))
		throw new Error(
			`Production module resolves outside selected checkout ${checkout}: ${file} -> ${resolved}`,
		);
}
export function assertLoadedSources(checkout) {
	const root = realpathSync(checkout);
	const source = createRequire(import.meta.url);
	for (const file of Object.keys(source.cache)) assertSource(root, file);
}
const selected = process.env.PRAXITY_EQUIVALENCE_CHECKOUT;
if (selected) {
	const root = realpathSync(selected);
	assertNodeModules(root);
	registerHooks({
		resolve(specifier, context, nextResolve) {
			const result = nextResolve(specifier, context);
			if (result.url.startsWith("file:")) {
				const parent = context.parentURL?.startsWith("file:")
					? fileURLToPath(context.parentURL)
					: "";
				const workspaceRequest =
					/^@praxity\/|^\.\/(?:packages|apps)\//.test(specifier) ||
					(specifier.startsWith(".") && productionPath(parent));
				assertSource(root, fileURLToPath(result.url), workspaceRequest);
			}
			return result;
		},
	});
}
