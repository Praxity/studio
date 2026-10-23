import { expect, it } from "vitest";
import {
	choiceContentSignature,
	choiceMaterialContent,
	choiceMaterialSignature,
} from "../src/assessment-choice";
import { question } from "./fixtures/choice-material";
import { exemptHtml, rebuild } from "./fixtures/choice-signature-html";
import vectors from "./fixtures/choice-signature-vectors.json";

const hash = (html: string) => choiceMaterialSignature(choiceMaterialContent(html));
it.each(vectors.vectors)("retains every attribute and word in $name", ({ html }) => {
	const signature = hash(html),
		root = document.createElement("div");
	root.innerHTML = html;
	expect(hash(`${html}z`)).not.toBe(signature);
	for (const element of root.querySelectorAll("*")) {
		element.setAttribute("data-material-probe", "yes");
		expect(hash(root.innerHTML)).not.toBe(signature);
		element.removeAttribute("data-material-probe");
		for (const attribute of Array.from(element.attributes).filter(
			({ name }) => name !== "class" && name !== "style",
		)) {
			const value = attribute.value;
			element.setAttribute(attribute.name, `${value}z`);
			expect(hash(root.innerHTML)).not.toBe(signature);
			element.removeAttribute(attribute.name);
			expect(hash(root.innerHTML)).not.toBe(signature);
			element.setAttribute(attribute.name, value);
		}
	}
	expect(exemptHtml(root.innerHTML)).toBe(exemptHtml(html));
	expect(exemptHtml(rebuild(choiceMaterialContent(html)))).toBe(exemptHtml(html));
});

it.each([
	['<a href="/go">Stop</a> Go', 'Stop <a href="/go">Go</a>'],
	['<span aria-hidden="true">Stop</span> Go', 'Stop <span aria-hidden="true">Go</span>'],
	["<p>A</p><p>B</p>", "<p>B</p><p>A</p>"],
	["H<sub>2</sub>O", "H<sub>3</sub>O"],
	["x<sup>2</sup>", "x<sup>3</sup>"],
	["<del>old</del>", "<del>new</del>"],
	["<s>old</s>", "<s>new</s>"],
	['<span data-math-latex="x">x</span>', '<span data-math-latex="y">y</span>'],
	['<video src="a.mp4"></video>', '<video src="b.mp4"></video>'],
	['<audio src="a.mp3"></audio>', '<audio src="b.mp3"></audio>'],
	['<img src="a.png" alt="one">', '<img src="a.png" alt="two">'],
	['<ol start="2"><li>A</li></ol>', '<ol start="3"><li>A</li></ol>'],
	["Go Stop", "GoStop"],
	['Go <a href="/a">Stop</a>', 'Go<a href="/a">Stop</a>'],
	['<a href="/a">A </a>B', '<a href="/a">A</a>B'],
	['<a href="/a"> A</a>B', '<a href="/a">A</a>B'],
	["<pre>A  B</pre>", "<pre>A B</pre>"],
	["<code>A\tB</code>", "<code>A B</code>"],
	["A&nbsp;B", "A B"],
	["A\u202fB", "A B"],
	["A\u200bB", "AB"],
])("material learner edit changes payload and signature %#", (before, after) => {
	expect(choiceMaterialContent(after)).not.toEqual(choiceMaterialContent(before));
	expect(hash(after)).not.toBe(hash(before));
	expect(choiceContentSignature({ ...question(), stem: after }, false)).not.toBe(
		choiceContentSignature({ ...question(), stem: before }, false),
	);
});

it("retains namespaces and local names, including identically named children", () => {
	const html = choiceMaterialContent("<a>A</a>"),
		svg = choiceMaterialContent("<svg><a>A</a></svg>");
	expect(html).toEqual([["http://www.w3.org/1999/xhtml", "a", [], ["A"]]]);
	expect(svg).toEqual([
		["http://www.w3.org/2000/svg", "svg", [], [["http://www.w3.org/2000/svg", "a", [], ["A"]]]],
	]);
	expect(choiceMaterialContent("<math><mi>x</mi></math>")).toEqual([
		[
			"http://www.w3.org/1998/Math/MathML",
			"math",
			[],
			[["http://www.w3.org/1998/Math/MathML", "mi", [], ["x"]]],
		],
	]);
});
it("preserves textarea whitespace in the canonicalizer", () => {
	expect(hash("<textarea>A  B</textarea>")).not.toBe(hash("<textarea>A B</textarea>"));
});
it("exempts presentation, emphasis, whitespace runs, feedback and option ordering", () => {
	const original = { ...question(), stem: 'Pick <a href="/go" lang="en">one</a>' },
		signature = choiceContentSignature(original, false);
	for (const stem of [
		'<b>Pick</b> <a href="/go" lang="en"><em>one</em></a>',
		'Pick\t\n<a class="other" style="color:red" lang="en" href="/go">one</a>',
	])
		expect(choiceContentSignature({ ...original, stem }, false)).toBe(signature);
	const changed = structuredClone(original);
	if (changed.response.type !== "choice") throw new Error("Expected choice");
	changed.response.options.reverse();
	changed.response.options[0].feedback = "Different feedback";
	changed.shuffle = true;
	expect(choiceContentSignature(changed, false)).toBe(signature);
});
it("retains each question and option policy field", () => {
	const original = question(),
		signature = choiceContentSignature(original, false);
	for (const changes of [
		{ points: 50 },
		{ required: false },
		{ attempts: 2 },
		{ gradingMode: "none" },
	])
		expect(choiceContentSignature({ ...original, ...changes } as typeof original, false)).not.toBe(
			signature,
		);
	expect(choiceContentSignature(original, true)).not.toBe(signature);
	for (const field of ["id", "label", "image", "isCorrect"] as const) {
		const changed = question();
		if (changed.response.type !== "choice") throw new Error("Expected choice");
		Object.assign(changed.response.options[0], {
			[field]: field === "isCorrect" ? false : "changed",
		});
		expect(choiceContentSignature(changed, false)).not.toBe(signature);
	}
	const changed = question();
	if (changed.response.type !== "choice") throw new Error("Expected choice");
	changed.response.selectionMode = "multiple";
	expect(choiceContentSignature(changed, false)).not.toBe(signature);
});
