import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function inlineIslandImports(modulePath: string): string {
	return readFileSync(modulePath, "utf8").replace(
		/(from|import)"(\.\/[^"]+)"/gu,
		(_match, keyword: string, relativePath: string) =>
			`${keyword}"data:text/javascript;base64,${Buffer.from(
				inlineIslandImports(resolve(dirname(modulePath), relativePath)),
			).toString("base64")}"`,
	);
}
