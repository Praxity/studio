import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("shared lesson projection runs in Node/tsx without browser CSS loaders", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"--input-type=module",
			"-e",
			`
import assert from "node:assert/strict";
import { createSession } from "@praxity/editor-core/session";
import { editorLessonProjection } from "./src/shared/editor-session.ts";
import { largeSnapshotFixture } from "./src/main/__tests__/fixtures/editor-snapshot.ts";
const source = "# First\\n\\nText\\n\\n# Second\\n\\nOther\\n";
const lesson = largeSnapshotFixture(source).lessons[0];
const projection = editorLessonProjection(lesson, createSession({}), key => key);
const focus = { file: "a.prax", nodeId: lesson.nodes[1].id, role: "handle" };
assert.equal(projection.selectionNodes().length, 4);
assert.equal(projection.readDraft(focus).editableText, "Text\\n");
assert.equal(projection.readDraft(focus, "file").expectedText, source);
`,
		],
		{ cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8" },
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
});
