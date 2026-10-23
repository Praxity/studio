import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateBlocksIndex } from "./schema.ts";

if (process.argv[2] === "--stdout") {
	process.stdout.write(JSON.stringify(generateBlocksIndex()));
} else {
	const path = resolve(process.argv[2] ?? "docs/prax-format/reference/blocks.json");
	const current = JSON.parse(await readFile(path, "utf8"));
	await writeFile(
		path,
		`${JSON.stringify(current.grammarVersion === 4 ? generateBlocksIndex() : { ...current, grammar4: generateBlocksIndex() }, null, 2)}\n`,
	);
}
