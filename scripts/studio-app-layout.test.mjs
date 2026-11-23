import assert from "node:assert/strict";
import test from "node:test";
import { priorStudioAppPath, renamedStudioAppReferences } from "./studio-app-layout.mjs";

test("app prefix migration is fixed and one-way", () => {
	assert.equal(renamedStudioAppReferences("apps/desktop/a.ts"), "apps/cli/a.ts");
	assert.equal(renamedStudioAppReferences("apps/cli/a.ts"), "apps/cli/a.ts");
	assert.equal(renamedStudioAppReferences("apps/other/a.ts"), "apps/other/a.ts");
});

test("prior paths prefer exact matches and migrate only removed, unoccupied old paths", () => {
	const old = "apps/desktop/a.ts";
	const moved = "apps/cli/a.ts";
	assert.equal(priorStudioAppPath(moved, new Set([old]), new Set([moved])), old);
	assert.equal(priorStudioAppPath(moved, new Set([old, moved]), new Set([moved])), moved);
	assert.equal(priorStudioAppPath(moved, new Set([old]), new Set([old, moved])), undefined);
	assert.equal(priorStudioAppPath(old, new Set([moved]), new Set([old])), undefined);
	assert.equal(priorStudioAppPath(moved, new Set(), new Set([moved])), undefined);
	assert.equal(priorStudioAppPath("apps/other/a.ts", new Set([old]), new Set()), undefined);
});
