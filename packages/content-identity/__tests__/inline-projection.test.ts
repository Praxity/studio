import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { describeDocument, serializeIdentity } from "../src/index";

it("keeps every persisted descriptor byte from main for split choice descriptions", () => {
	const source =
		"# P\n::: choice Pick {scored}\nRead first.\n$$\nx^2\n$$\nThen @source{N} more.\n(x) Yes\n( ) No\n:::\n";
	const descriptors = describeDocument(
		{ path: "lesson.prax", tree: readLesson(source).tree },
		{ readerRoles: true },
	);
	const canonical = serializeIdentity(descriptors);
	expect(descriptors.find((node) => node.readerRole === "prose:2")?.canonical).toBe(
		'{"content":{"content":"<p>Then <span data-footer-content=\\"N\\">@footer{N}</span> more.</p>"},"type":"reader-role:prose"}',
	);
	expect(canonical).not.toContain("_inlineTrees");
	// Whole-descriptor bytes captured on main, including canonical, matchText,
	// revisionContent and ranges used by persisted identity and retirement.
	expect(createHash("sha256").update(canonical).digest("hex")).toBe(
		"88dde21733cd13226db18b232f3dca673631064f7a2a8a35a6f1c60d01ef48b4",
	);
});
