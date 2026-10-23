import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("canvas text bindings load on the server without a UI or CSS loader", () => {
	const entry = new URL("../src/main/operations/canvas-text-bindings.ts", import.meta.url);
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"--input-type=module",
			"-e",
			`import { registerHooks } from "node:module";
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith("/AssessmentBlock.tsx") || url.endsWith(".css")) {
    throw new Error("Server bindings must not load AssessmentBlock.tsx or CSS: " + url);
  }
  return nextLoad(url, context);
} });
const bindings = await import(${JSON.stringify(entry.href)});
if (typeof bindings.canvasTextBindings !== "function") throw new Error("Missing server bindings");`,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
