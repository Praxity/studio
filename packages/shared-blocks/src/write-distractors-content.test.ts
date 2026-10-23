import { expect, it } from "vitest";
import {
	admitWriteDistractorsAsset,
	createWriteDistractorsRules,
} from "./write-distractors-content";

const content = {
	question: "When?",
	rightAnswer: "Throughout.",
	count: 2,
	misconceptions: [{ id: "late", label: "Only at the end" }],
	authorOptions: [{ misconception: "late", text: "AUTHOR-OPTION" }],
};
it("first-half authority exposes literal answer/labels and never author options", () => {
	const rules = createWriteDistractorsRules(content);
	expect(rules.firstHalf()).toEqual({
		answer: "Throughout.",
		items: [{ id: "late", label: "Only at the end" }],
	});
	const exposed = rules.firstHalf();
	exposed.answer = "changed";
	exposed.items[0].label = "changed";
	expect(rules.firstHalf()).toEqual({
		answer: "Throughout.",
		items: [{ id: "late", label: "Only at the end" }],
	});
});
it("asset admission refuses a changed payload with the original revision", () => {
	const contentRevision = createWriteDistractorsRules(content).contentRevision;
	const reference = { blockId: "wd", contentRevision };
	expect(admitWriteDistractorsAsset({ ...reference, content }, reference).firstHalf().answer).toBe(
		"Throughout.",
	);
	expect(() =>
		admitWriteDistractorsAsset(
			{ ...reference, content: { ...content, rightAnswer: "Not at all." } },
			reference,
		),
	).toThrow(expect.objectContaining({ code: "write-distractors-content-revision" }));
	expect(() =>
		admitWriteDistractorsAsset({ ...reference, blockId: "other", content }, reference),
	).toThrow(expect.objectContaining({ code: "write-distractors-content-invalid" }));
});

for (const field of ["rightAnswer", "label", "option"] as const)
	it(`asset revision refuses same-length ${field} edits with the contract code`, () => {
		const contentRevision = createWriteDistractorsRules(content).contentRevision;
		const reference = { blockId: "wd", contentRevision };
		const changed = structuredClone(content);
		if (field === "rightAnswer") changed.rightAnswer = "X" + changed.rightAnswer.slice(1);
		if (field === "label")
			changed.misconceptions[0].label = "X" + changed.misconceptions[0].label.slice(1);
		if (field === "option")
			changed.authorOptions[0].text = "X" + changed.authorOptions[0].text.slice(1);
		expect(() => admitWriteDistractorsAsset({ ...reference, content: changed }, reference)).toThrow(
			expect.objectContaining({ code: "write-distractors-content-revision" }),
		);
	});
for (const defect of [
	"extra",
	"accessor",
	"prototype",
	"nested-extra",
	"nested-accessor",
	"array-accessor",
])
	it(`asset admission refuses ${defect} without traversing untrusted records`, () => {
		const reference = {
			blockId: "wd",
			contentRevision: createWriteDistractorsRules(content).contentRevision,
		};
		const payload = { ...reference, content: structuredClone(content) };
		if (defect === "extra") Object.assign(payload, { extra: true });
		if (defect === "accessor")
			Object.defineProperty(payload, "content", {
				enumerable: true,
				get() {
					throw new Error("accessor ran");
				},
			});
		if (defect === "prototype") Object.setPrototypeOf(payload, { extra: true });
		if (defect === "nested-extra")
			Object.assign(payload.content.misconceptions[0], { extra: true });
		if (defect === "nested-accessor")
			Object.defineProperty(payload.content.misconceptions[0], "label", {
				enumerable: true,
				get() {
					throw new Error("accessor ran");
				},
			});
		if (defect === "array-accessor")
			Object.defineProperty(payload.content.authorOptions, "0", {
				enumerable: true,
				get() {
					throw new Error("accessor ran");
				},
			});
		expect(() => admitWriteDistractorsAsset(payload, reference)).toThrow(
			expect.objectContaining({ code: "write-distractors-content-invalid" }),
		);
	});
