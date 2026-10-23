import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, it } from "vitest";
import { bundleInspectionFrame } from "../../../../apps/desktop/scripts/prebuild-viewer.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
let root = "";
let refusal = "";

// Build once through the production owner, with an unlisted upstream helper.
beforeAll(async () => {
	root = await mkdtemp(path.join(tmpdir(), "learning-patterns-inspection-"));
	await mkdir(path.join(root, "apps/desktop/src"), { recursive: true });
	await mkdir(path.join(root, "packages/export-pipeline/node_modules"), { recursive: true });
	await mkdir(path.join(root, "scripts"));
	const installed = path.join(root, "packages/export-pipeline/node_modules/learning-patterns");
	await cp(path.join(repo, "packages/export-pipeline/node_modules/learning-patterns"), installed, {
		recursive: true,
		dereference: true,
	});
	await symlink(installed, path.join(root, "apps/desktop/src/learning-patterns"), "dir");
	await writeFile(path.join(installed, "inspection-probe.js"), "export const probe = 1797;\n");
	await writeFile(
		path.join(root, "apps/desktop/src/inspection-frame.ts"),
		'import { probe } from "./learning-patterns/inspection-probe.js"; console.log(probe);\n',
	);
	await writeFile(
		path.join(root, "scripts/learning-patterns-admission.json"),
		await readFile(path.join(repo, "scripts/learning-patterns-admission.json")),
	);
	const output = path.join(root, "output");
	await mkdir(output);
	try {
		await bundleInspectionFrame(root, output);
	} catch (error) {
		refusal = error instanceof Error ? error.message : String(error);
	}
});

afterAll(async () => {
	if (root) await rm(root, { recursive: true });
});

it("R2 P2-1: inspection frame refuses an unadmitted upstream helper", () => {
	assert.match(
		refusal || "inspection build passed without admission",
		/Unadmitted bundle input: inspection-probe.js/,
	);
});
