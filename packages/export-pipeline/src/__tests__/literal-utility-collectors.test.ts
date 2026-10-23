import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compileCourse, deployCourse, selfCheckContentInput } from "../build";

const task =
	'Write [Task]{Task definition} @source{Task source} @icon{mail} <span data-tooltip-content="HTML definition">HTML task</span> <span data-footer-content="HTML source">note</span> here.';
let artifact: Awaited<ReturnType<typeof compileCourse>>;

beforeAll(async () => {
	const lesson = readLesson(
		`# Practice\n::: accordion\n:: Panel\nBefore [Rich]{Rich definition} @source{Rich source}.\n::: self-check ${task}\nmodel: [Model]{Model definition}\n:: [Label]{Label definition}\nmissed: [Hint]{Hint definition}\n:::\nAfter [Later]{Later definition} @source{Later source}.\n:::\n`,
	);
	artifact = await compileCourse({
		id: "literal-collectors",
		title: "Literal collectors",
		sourceLocale: "en",
		content: lesson.pages,
		selfCheckContents: [...lesson.nodes.values()]
			.filter((record) => !record.role && record.node.type === "self-check")
			.map((record) => selfCheckContentInput(record.id, readSelfCheckContent(lesson, record.id))),
	});
});

afterAll(async () => {
	await artifact?.dispose();
});

it("compiles literal self-check tasks without utility entries and keeps nested rich controls", async () => {
	const zip = new AdmZip((await deployCourse(artifact, { format: "html" })).zip);
	const doc = new JSDOM(zip.readAsText("practice.html")).window.document;
	expect(
		[...doc.querySelectorAll("[data-self-check] .praxity-assessment-stem")].some(
			(p) => p.textContent === task,
		),
	).toBe(true);
	expect(
		[...doc.querySelectorAll("[data-tooltip-content]")].map((node) => node.textContent?.trim()),
	).toEqual(["Rich (Rich definition)", "Later (Later definition)"]);
	expect(
		[...doc.querySelectorAll(".praxity-footnote-ref")].map((node) => node.textContent),
	).toEqual(["Footnote [1]", "Footnote [2]"]);
	expect(
		[...doc.querySelectorAll(".praxity-footnotes li")].map((node) => node.textContent),
	).toEqual(["Rich source", "Later source"]);
	expect(doc.querySelectorAll(".praxity-inline-icon")).toHaveLength(0);
	const glossary = new JSDOM(zip.readAsText("glossary.html")).window.document;
	expect([...glossary.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
		"Later",
		"Rich",
	]);
});
