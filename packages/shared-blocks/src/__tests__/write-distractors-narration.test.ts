import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { extractNarrationSegments, resolveNarrationV2 } from "../narration";
import type { PraxityBlock } from "../types";

it("narrates the typed placeholder's literal question without hidden author content", () => {
	const read = readLesson(
		"# P\n::: write-distractors <b>Q</b> [term]{definition} @icon{star}\nanswer: HiddenRight\n:: HiddenLabel\noption: HiddenOption\n:::\n",
	);
	const block = read.blocks.find((b) => b.type === "writeDistractors");
	if (!block) throw new Error("Missing typed placeholder");
	const segments = extractNarrationSegments("", {}, [block], {}, "en");
	expect(segments).toHaveLength(1);
	expect(segments[0]).toMatchObject({
		script: "<b>Q</b> [term]{definition} @icon{star}",
		derivedScript: "<b>Q</b> [term]{definition} @icon{star}",
	});
	for (const hidden of ["HiddenRight", "HiddenLabel", "HiddenOption"])
		expect(JSON.stringify(segments)).not.toContain(hidden);
});

it.each(["en", "fr"])("keeps question-only source and reviewed fingerprints in %s", (locale) => {
	const question = locale === "fr" ? "Quand commencer?" : "When should we start?";
	const read = (marker: string) => {
		const result = readLesson(
			`# Page\n::: write-distractors ${question}\nanswer: ${marker}_RIGHT\n:: ${marker}_LABEL\noption: ${marker}_OPTION\n:::\n`,
			{
				ids: (node, role) => `id-${node.span.start}-${role ?? "node"}`,
			},
		);
		const block = result.blocks.find((b) => b.type === "writeDistractors");
		if (!block) throw new Error("Missing distractor");
		return block;
	};
	const before = read("HIDDEN_ONE");
	const after = read("HIDDEN_TWO_LONGER");
	const sourceContent = JSON.stringify({
		type: "writeDistractors",
		data: { content: { question } },
	});
	const digest = (text: string) => `fingerprint:${text}`;
	const resolve = (block: PraxityBlock) =>
		resolveNarrationV2({
			courseId: "course",
			lessonId: "lesson",
			locale,
			pages: [{ id: "page", title: "", blocks: [block] }],
			digest,
			sidecar: {
				version: 2,
				courseId: "course",
				lessons: {
					lesson: {
						segments: [
							{
								target: { id: before.id, role: "body" },
								reviewedRevision: digest(question),
								audio: "question.mp3",
								audioFor: { script: question, language: locale, voice: "Maya", speed: 1 },
							},
						],
					},
				},
			},
		});
	for (const block of [before, after]) {
		const [segment] = extractNarrationSegments("", {}, [block], {}, locale);
		expect(segment).toMatchObject({ script: question, derivedScript: question, sourceContent });
		const resolved = resolve(block);
		expect(resolved.pages[0].segments).toEqual([
			expect.objectContaining({
				script: question,
				sourceContent,
				revision: digest(question),
				status: "ready",
				audioForCurrent: true,
				audioUrl: "question.mp3",
			}),
		]);
		expect(resolved.unresolved).toEqual([]);
		// Plant forbidden fields even in malformed generic data, bypassing the safe reader.
		const planted = {
			...block,
			data: {
				...block.data,
				rightAnswer: "HIDDEN_RIGHT",
				labels: ["HIDDEN_LABEL"],
				authorOptions: ["HIDDEN_OPTION"],
				answer: "HIDDEN_LEARNER",
				recovery: "HIDDEN_RECOVERY",
				comparison: "HIDDEN_COMPARISON",
				content: {
					...(block.data.content as object),
					rightAnswer: "HIDDEN_CONTENT_RIGHT",
					misconceptions: [{ label: "HIDDEN_CONTENT_LABEL" }],
					authorOptions: [{ text: "HIDDEN_CONTENT_OPTION" }],
				},
			},
		};
		expect(resolve(planted)).toEqual(resolved);
		expect(JSON.stringify([segment, resolved, resolve(planted)])).not.toContain("HIDDEN_");
		const changed = structuredClone(block);
		(changed.data.content as { question: string }).question += " Changed";
		expect(resolve(changed).pages[0].segments[0]).toMatchObject({ status: "needsReview" });
	}
	expect(resolve(after)).toEqual(resolve(before));
});
