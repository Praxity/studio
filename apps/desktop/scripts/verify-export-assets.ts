import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPreparedExportAssets } from "../../../packages/export-pipeline/src/export-assets.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../resources/export-assets");
const packageJson = JSON.parse(
	await readFile(path.resolve(__dirname, "../package.json"), "utf-8"),
) as { version: string };

await verifyPreparedExportAssets(outputDir, packageJson.version);
console.log("[prebuild] Export assets match the current viewer source hash.");
