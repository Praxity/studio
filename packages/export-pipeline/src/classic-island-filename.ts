/** A classic variant inherits the module's fingerprint and dependency identity. */
export function classicIslandFilename(moduleFilename: string): string {
	return moduleFilename.replace(/\.js$/u, ".classic.js");
}
