import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { describeDocument, serializeIdentity } from "../src/index";

it("keeps existing I4 canonical bytes and hashes for every converted non-self-check fixture", () => {
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const fixtures = globSync("packages/grammar/__tests__/fixtures/v4/**/*.prax", {
		cwd: root,
	}).sort();
	const canonical = fixtures.map((file) => {
		const path = file.replaceAll("\\", "/");
		return {
			path,
			nodes: describeDocument(
				{ path, tree: readLesson(readFileSync(resolve(root, file), "utf8")).tree },
				{ readerRoles: true },
			)
				// C06c1 adds reader-only records; every pre-existing descriptor keeps this baseline.
				.filter((node) => node.readerRole !== "option-feedback")
				.map(({ path, parentPath, canonical, revisionContent, readerRole, readerOwnerPath }) => ({
					path,
					parentPath,
					canonical,
					revisionContent,
					readerRole,
					readerOwnerPath,
				})),
		};
	});
	expect(fixtures).toHaveLength(5);
	// Captured from the reader branch after merging main, before prompt projection.
	expect(createHash("sha256").update(serializeIdentity(canonical)).digest("hex")).toBe(
		"0f71bd6bdab886b7a6bd4bb690799504578a2f686cbecfce45c0aeb3fe4ab145",
	);
});

it.each(["model", "missed"])(
	"a %s-only edit changes canonical content and source revision, with the same generic prompt",
	(field) => {
		const source =
			"# Practice\n::: self-check TASK\nmodel: MODEL ONE\n:: Criterion\nmissed: HINT ONE\n:::\n";
		const read = (text: string) =>
			readLesson(text, { ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` });
		const first = read(source);
		const second = read(
			source.replace(
				field === "model" ? "MODEL ONE" : "HINT ONE",
				field === "model" ? "MODEL TWO" : "HINT TWO",
			),
		);
		expect(second.blocks).toEqual(first.blocks);
		expect(second.pages).toEqual(first.pages);
		const descriptor = (lesson: typeof first) => {
			const node = describeDocument(
				{ path: "lesson.prax", tree: lesson.tree },
				{ readerRoles: true },
			).find((node) => node.type === "self-check");
			if (!node) throw new Error("Missing canonical self-check fixture");
			return node;
		};
		expect(descriptor(first).canonical).toContain("ONE");
		expect(descriptor(second).canonical).toContain("TWO");
		expect(descriptor(second).canonical).not.toBe(descriptor(first).canonical);
		expect(descriptor(second).revisionContent).not.toBe(descriptor(first).revisionContent);
		const sourceRevision = (lesson: typeof first) =>
			createHash("sha256").update(lesson.tree.stream.source).digest("hex");
		expect(sourceRevision(second)).not.toBe(sourceRevision(first));
	},
);
