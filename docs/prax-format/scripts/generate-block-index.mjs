#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const referenceDir = process.argv[2] ? resolve(process.argv[2]) : resolve(directory, "../reference");
// --stdout projects the schema without the transitional grammar-3 envelope.
const schema = JSON.parse(execFileSync(process.execPath, [
 "--import", "tsx", resolve(directory, "../../../packages/grammar/src/v4/generate-block-index.ts"), "--stdout",
], { cwd: resolve(directory, "../../.."), encoding: "utf8" }));
await writeFile(resolve(referenceDir, "blocks.json"), JSON.stringify(schema, null, 2) + "\n");
