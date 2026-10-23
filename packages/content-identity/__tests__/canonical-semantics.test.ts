import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { describeDocument } from "../src/index.ts";

it("preserves pre-memo lesson metadata and complete root revisions", () => {
	const source =
		"---\ntitle: Safety\nlang: en\nvariables:\n  ready: false\n---\n# One\n\nAlpha.\n\n# Two\n\nBravo.\n";
	const root = describeDocument({ path: "lesson.prax", tree: readLesson(source).tree })[0];
	// Literal outputs from canonical.ts at 49089c1b4, before semantic memoisation.
	expect(root.revisionContent).toBe(
		'{"children":[{"body":[{"kind":"text","value":"--- title: Safety lang: en variables: ready: false ---"}],"children":[],"kind":"frontmatter","settings":{},"type":"frontmatter"},{"children":[{"body":[{"kind":"text","value":"Alpha."}],"children":[],"kind":"body","settings":{},"type":"body"}],"headingLevel":1,"kind":"page","settings":{},"subject":[{"kind":"text","value":"One"}],"type":"page"},{"children":[{"body":[{"kind":"text","value":"Bravo."}],"children":[],"kind":"body","settings":{},"type":"body"}],"headingLevel":1,"kind":"page","settings":{},"subject":[{"kind":"text","value":"Two"}],"type":"page"}],"kind":"lesson","settings":{},"type":"lesson"}',
	);
	expect(root.canonical).toBe(
		'{"kind":"lesson","metadata":[{"body":[{"kind":"text","value":"--- title: Safety lang: en variables: ready: false ---"}],"kind":"frontmatter","settings":{},"type":"frontmatter"}],"settings":{},"type":"lesson"}',
	);
});

it("keeps title projections after source children on single and multi-digit page paths", () => {
	const source = Array.from(
		{ length: 12 },
		(_, index) => `# Page ${index}\n\nFirst paragraph.\n\nSecond paragraph.\n`,
	).join("\n");
	const titles = describeDocument(
		{ path: "lesson.prax", tree: readLesson(source).tree },
		{ readerRoles: true },
	).filter((descriptor) => descriptor.readerRole === "title");
	expect(
		titles.map(({ path, parentPath, readerOwnerPath, order }) => ({
			path,
			parentPath,
			readerOwnerPath,
			order,
		})),
	).toEqual(
		Array.from({ length: 12 }, (_, index) => ({
			path: [index, 2],
			parentPath: [index],
			readerOwnerPath: [index],
			order: 2,
		})),
	);
});

it("rebuilds projections after caller edits and reader configuration changes", () => {
	const source = "# One\n\nAlpha.\n";
	const document = { path: "lesson.prax", tree: readLesson(source).tree };
	const options = { readerRoles: true };
	const first = describeDocument(document, options);
	first[0].path.push(99);
	const body = document.tree.root.children[0].children[0];
	body.raw = body.raw.replace("Alpha", "Bravo");
	const next = describeDocument(document, options);
	expect(next.find((descriptor) => descriptor.type === "body")?.canonical).toBe(
		'{"body":[{"kind":"text","value":"Bravo."}],"children":[],"kind":"body","settings":{},"type":"body"}',
	);
	expect(next[0].path).toEqual([]);
	options.readerRoles = false;
	expect(describeDocument(document, options).every((descriptor) => !descriptor.readerRole)).toBe(
		true,
	);
});
