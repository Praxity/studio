import { expect, it } from "vitest";
import { readLesson, readSelfCheckContent } from "../src/index";

const source = (
	task: string,
	model = "Model",
	label = "Label",
	missed = "Hint",
	evidence?: string,
) =>
	`# Practice\n::: self-check ${task}\nmodel: ${model}\n:: ${label}\nmissed: ${missed}\n${evidence === undefined ? "" : `evidence: ${evidence}\n`}:::\n`;
function check(text: string, allowed: boolean, code = "self-check-invalid", line = 2) {
	const read = readLesson(text);
	expect(read.tree.root.raw).toBe(text);
	const block = read.pages[0].blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing self-check");
	if (allowed) {
		expect(read.diagnostics).toEqual([]);
		return readSelfCheckContent(read, block.id);
	}
	expect(read.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([code]);
	expect(read.diagnostics[0]).toMatchObject({ line, column: 1 });
	expect(JSON.stringify(read.diagnostics)).not.toContain("SECRET");
	expect(() => readSelfCheckContent(read, block.id)).toThrowError(
		expect.objectContaining({
			code: "self-check-content-invalid",
			message: "self-check-content-invalid",
		}),
	);
}
it.each([0, 1])(
	"admits boundary fields and refuses overflow (+%i) through the public reader",
	(overflow) => {
		const allowed = overflow === 0;
		check(source("x".repeat(400 + overflow)), allowed);
		check(source("Task", "x".repeat(1500 + overflow)), allowed);
		check(source("Task", "Model", "x".repeat(120 + overflow)), allowed);
		check(source("Task", "Model", "Label", "x".repeat(1500 + overflow)), allowed);
		// Model stays at 1500 when evidence exceeds 1500; do not mask its error.
		check(
			source("Task", "x".repeat(1500), "Label", "Hint", "x".repeat(1500 + overflow)),
			allowed,
			"evidence-not-once",
			6,
		);
	},
);
it("checks host-allocated criterion IDs without forwarding hidden content", () => {
	for (const length of [120, 121]) {
		const read = readLesson(source("Task", "SECRET_MODEL"), {
			ids: (node, role) =>
				node.kind === "item" ? "x".repeat(length) : `id-${node.span.start}-${role ?? "node"}`,
		});
		const block = read.pages[0].blocks.find((block) => block.type === "selfCheck");
		if (!block) throw new Error("Missing self-check");
		if (length === 120)
			expect(readSelfCheckContent(read, block.id).parts[0].id).toBe("x".repeat(120));
		else expect(() => readSelfCheckContent(read, block.id)).toThrow("self-check-content-invalid");
	}
});
it("counts decoded escapes and CRLF continuations rather than source units", () => {
	const task = String.raw`\*`.repeat(400);
	expect(check(source(task), true)?.task).toBe("*".repeat(400));
	check(source(task + String.raw`\*`), false);
	const model = `${"😀".repeat(749)}\r\n  ${"😀".repeat(750)}`;
	const text = source("Task", model);
	expect(check(text, true)?.model).toBe(`${"😀".repeat(749)}\n${"😀".repeat(750)}`);
	check(source("Task", model + "😀"), false);
	check(source("e\u0301".repeat(200)), true);
	check(source("e\u0301".repeat(200) + "x"), false);
});

it("keeps overflow diagnostics and host refusals free of authored secrets", () => {
	check(source("SECRET_TASK".repeat(40), "SECRET_MODEL", "SECRET_LABEL", "SECRET_HINT"), false);
	check(source("Task", "SECRET_MODEL".repeat(150)), false);
});
