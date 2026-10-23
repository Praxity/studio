import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { extractNarrationSegments, resolveNarrationV2 } from "../narration";
import type { PraxityBlock } from "../types";

it.each([
	["en", 1],
	["en", 8],
	["fr", 1],
	["fr", 8],
] as const)(
	"extracts and fingerprints only title and ordered questions in %s with %i rows",
	(locale, count) => {
		const title = locale === "fr" ? "Rappel littéral" : "Literal recall";
		const questions = Array.from({ length: count }, (_, i) =>
			locale === "fr" ? `Que rappeler ${i + 1}?` : `What to recall ${i + 1}?`,
		);
		const read = (answer: string) => {
			const result = readLesson(
				`# Page\n::: retrieval-sheet ${title}\n${questions.map((q, i) => `:: ${q}\nanswer: ${answer}_${i + 1}\n`).join("")}:::\n`,
				{ ids: (node, role) => `id-${node.span.start}-${role ?? "node"}` },
			);
			const block = result.blocks.find((b) => b.type === "retrievalSheet");
			if (!block) throw new Error("Missing sheet");
			return block;
		};
		const before = read("ANSWER_MARKER_ONE");
		const after = read("ANSWER_MARKER_TWO_LONGER");
		const script = `${title} [pause]\n\n${questions.join(" ")}`;
		const sourceContent = JSON.stringify({
			type: "retrievalSheet",
			data: { content: { questions: questions.map((question) => ({ question })), title } },
		});
		const digest = (text: string) => `fingerprint:${text}`;
		const revision = digest(`${title} [pause] ${questions.join(" ")}`);
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
									reviewedRevision: revision,
									audio: "recall.mp3",
									audioFor: { script, language: locale, voice: "Maya", speed: 1 },
								},
							],
						},
					},
				},
			});
		for (const block of [before, after]) {
			const [extracted] = extractNarrationSegments("", {}, [block], {}, locale);
			expect(extracted).toMatchObject({ script, derivedScript: script, sourceContent });
			const resolved = resolve(block);
			expect(resolved.pages[0].segments).toHaveLength(1);
			expect(resolved.pages[0].segments[0]).toMatchObject({
				script,
				sourceContent,
				revision,
				status: "ready",
				audioForCurrent: true,
				audioUrl: "recall.mp3",
			});
			expect(resolved.unresolved).toEqual([]);
			expect(JSON.stringify([extracted, resolved])).not.toContain("ANSWER_MARKER");
			const withControls = {
				...block,
				data: { ...block.data, date: "DATE_MARKER", side: "back", controlCopy: "CONTROL_MARKER" },
			};
			expect(resolve(withControls).pages[0].segments).toEqual(resolved.pages[0].segments);
			// A positive control: editing a narrated question must invalidate review.
			const edited = structuredClone(block);
			const content = edited.data.content as { questions: { question: string }[] };
			content.questions[0].question += " Changed";
			expect(resolve(edited).pages[0].segments[0]).toMatchObject({ status: "needsReview" });
		}
		expect(resolve(after).pages[0].segments).toEqual(resolve(before).pages[0].segments);
	},
);
