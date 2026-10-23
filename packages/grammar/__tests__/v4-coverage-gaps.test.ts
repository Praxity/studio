import { describe, expect, it } from "vitest";
import { readLesson } from "../src/read-lesson";
import { validateCourse } from "../src/v4/schema";

describe("C1b grammar interface", () => {
	it("retains one page when a later heading overrides its level to H1", () => {
		const lesson = readLesson("# First\nWords\n## Second {level=1}\nOther words\n");
		expect(lesson.errors).toEqual([]);
		expect(lesson.pages).toHaveLength(1);
		expect(
			lesson.pages[0].blocks.filter((b) => b.type === "heading").map((b) => b.data.level),
		).toEqual([1, 1]);
	});
	it.each(["primary", "secondary"])("preserves card colour %s", (color) => {
		const lesson = readLesson(
			`# Page\n::: cards {style=shaded color=${color}}\n:: Card\nWords\n:::\n`,
		);
		expect(lesson.errors).toEqual([]);
		expect(lesson.blocks.find((b) => b.type === "card")?.data.color).toBe(color);
	});
	it.each([true, false])("preserves chart point visibility %s", (showPoints) => {
		const lesson = readLesson(
			`# Page\n::: table {chart=line showPoints=${showPoints}}\n| Label | Value |\n| --- | --- |\n| Example | 2 |\n:::\n`,
		);
		expect(lesson.errors).toEqual([]);
		expect(lesson.blocks.find((b) => b.type === "chart")?.data.showPoints).toBe(showPoints);
	});
	it.each(["calm-path", "Jean-Pierre"])(
		"accepts hyphenated dialogue name %s and cast keys through rule resolution",
		(name) => {
			const lesson = readLesson(
				`# Page\n::: dialogue {name=${name}}\n- Jean-Pierre: Bonjour\n:::\n::: rule\nif: block:${name}.completed is true\nthen: show @${name}\n:::\n`,
			);
			expect(lesson.errors).toEqual([]);
			expect(
				validateCourse([{ path: "lesson", tree: lesson.tree }], {
					cast: { "jean-pierre": { name: "Jean-Pierre" } },
				}).diagnostics,
			).toEqual([]);
		},
	);
	it("accepts untitled image cards with one back", () => {
		const lesson = readLesson(
			"# Page\n::: cards\n::\n![Diagram](/assets/a.png)\n::: back\nWords\n:::\n:::\n",
		);
		expect(lesson.errors).toEqual([]);
		expect(lesson.blocks.find((b) => b.type === "card")?.data.items).toMatchObject([
			{ label: "", front: [{ type: "image" }], back: [{ type: "text" }] },
		]);
	});
	it("still refuses two backs on an untitled card", () => {
		const lesson = readLesson(
			"# Page\n::: cards\n::\n::: back\nOne\n:::\n::: back\nTwo\n:::\n:::\n",
		);
		expect(lesson.errors).toContainEqual(
			expect.objectContaining({
				messageRef: expect.objectContaining({
					key: "grammar.v4.child-count",
					args: expect.objectContaining({ child: "back", count: 2, max: 1 }),
				}),
			}),
		);
	});
	it.each(["\n", "\r\n"])("splits raw bank separators before decoding with %j", (eol) => {
		const source =
			"# Page\n::: fill-blank Codes {style=word-bank}\nUse {A\\|B} and {C\\\\}.\nbank: A\\|B |\n  C\\\\ | D\n:::\n".replaceAll(
				"\n",
				eol,
			);
		const lesson = readLesson(source);
		expect(lesson.errors).toEqual([]);
		expect(lesson.tree.root.raw).toBe(source);
		expect(lesson.blocks.find((b) => b.type === "assessment")?.data.response).toMatchObject({
			wordBank: ["A|B", "C\\", "D"],
			blanks: [{ answer: "A|B" }, { answer: "C\\" }],
		});
	});
	it("checks bank multiplicity after decoding escaped separators", () => {
		const lesson = readLesson(
			"# Page\n::: fill-blank Codes {style=word-bank}\n{A\\|B} and {A\\|B}\nbank: A\\|B | C\n:::\n",
		);
		expect(lesson.errors).toContainEqual(
			expect.objectContaining({
				messageRef: expect.objectContaining({
					args: expect.objectContaining({ rule: "word-bank-answers-and-counts" }),
				}),
			}),
		);
	});
	it("passes page style to the renderer and validates its declared name", () => {
		const lesson = readLesson(
			"---\npageStyles:\n  feature: { background: red }\n---\n# Page {style=feature}\n",
		);
		expect(lesson.errors).toEqual([]);
		expect(lesson.pages[0].data.pageStyle).toBe("feature");
		expect(validateCourse([{ path: "lesson", tree: lesson.tree }]).diagnostics).toEqual([]);
	});
	it("keeps container width and card layout independently", () => {
		const lesson = readLesson("# Page\n::: cards {width=wide layout=slides}\n:: Card\n:::\n");
		expect(lesson.errors).toEqual([]);
		expect(lesson.blocks.find((b) => b.type === "card")?.data).toMatchObject({
			layoutMode: "wide",
			layout: "single",
		});
	});
	it.each(["", " {chart=bar}"])("accepts a table alt part and adapts it %s", (settings) => {
		const lesson = readLesson(
			`# Page\n::: table${settings}\n| Label | Value |\n| --- | --- |\n| Example | 2 |\nalt: Values\u202F: 2\n:::\n`,
		);
		expect(lesson.errors).toEqual([]);
		expect(lesson.blocks.find((b) => ["table", "chart"].includes(b.type))?.data.altText).toBe(
			"Values\u202F: 2",
		);
	});
	it("keeps image alt text in the Markdown label", () => {
		const lesson = readLesson("# Page\n![Diagram](/assets/a.png)\n");
		expect(lesson.errors).toEqual([]);
		expect(lesson.blocks.find((b) => b.type === "image")?.data.alt).toBe("Diagram");
	});
});
