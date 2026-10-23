import { describe, expect, it } from "vitest";
import { extractNarrationSegments, resolveNarrationV2 } from "../narration";
import type { PraxityBlock } from "../types";

const task: PraxityBlock = {
	id: "00000000-0000-4000-8000-000000000004",
	type: "selfCheck",
	data: { content: { task: "Explain the delay.", parts: [{ id: "criterion" }] } },
};
const courseId = "00000000-0000-4000-8000-000000000001";
const lessonId = "00000000-0000-4000-8000-000000000002";
const pageId = "00000000-0000-4000-8000-000000000003";

describe("self-check task narration", () => {
	it.each(["accordion", "tabs", "card", "sequence"] as const)(
		"keeps an independent task target inside %s",
		(type) => {
			const container: PraxityBlock = {
				id: "00000000-0000-4000-8000-000000000005",
				type,
				data: {
					items: [
						{ id: "00000000-0000-4000-8000-000000000006", label: "Practice", children: [task] },
					],
				},
			};
			const resolved = resolveNarrationV2({
				courseId,
				lessonId,
				locale: "en",
				pages: [{ id: pageId, title: "", blocks: [container] }],
				sidecar: { version: 2, courseId, lessons: {} },
				digest: (text) => text,
			});
			expect(resolved.pages[0].segments.map(({ target, script }) => [target, script])).toEqual([
				[
					{ id: "00000000-0000-4000-8000-000000000006", role: type === "card" ? "front" : "body" },
					"Practice",
				],
				[{ id: task.id, role: "title" }, "Explain the delay."],
			]);
		},
	);

	it("binds a title recording to the task and flags only task edits", () => {
		const resolve = (block: PraxityBlock) =>
			resolveNarrationV2({
				courseId,
				lessonId,
				pages: [{ id: pageId, title: "", blocks: [block] }],
				digest: (text) => text,
				sidecar: {
					version: 2,
					courseId,
					lessons: {
						[lessonId]: {
							segments: [
								{
									target: { id: task.id, role: "title" },
									reviewedRevision: "Explain the delay.",
									audio: "task.mp3",
									audioFor: {
										script: "Explain the delay.",
										language: "en",
										voice: "Maya",
										speed: 1,
									},
								},
							],
						},
					},
				},
				locale: "en",
			});
		expect(resolve(task).unresolved).toEqual([]);
		expect(resolve(task).pages[0].segments[0]).toMatchObject({
			target: { id: task.id, role: "title" },
			status: "ready",
			audioUrl: "task.mp3",
		});
		expect(
			resolve({ ...task, data: { content: { task: "Explain a new delay.", parts: [] } } }).pages[0]
				.segments[0],
		).toMatchObject({ status: "needsReview", audioUrl: "task.mp3" });
	});

	it("extracts only literal task text even from older full-content input", () => {
		const [segment] = extractNarrationSegments("", {}, [
			{
				...task,
				data: {
					content: {
						task: "Use **literal** <words>.",
						model: "MODEL_SECRET",
						parts: [
							{
								id: "criterion",
								label: "LABEL_SECRET",
								missed: "HINT_SECRET",
								evidence: "EVIDENCE_SECRET",
							},
						],
					},
					answer: "PRIVATE_ANSWER",
					feedback: "DYNAMIC_FEEDBACK",
				},
			},
		]);
		expect(segment.script).toBe("Use **literal** <words>.");
		for (const marker of [
			"MODEL_SECRET",
			"LABEL_SECRET",
			"HINT_SECRET",
			"EVIDENCE_SECRET",
			"PRIVATE_ANSWER",
			"DYNAMIC_FEEDBACK",
		])
			expect(JSON.stringify(segment)).not.toContain(marker);
	});
});
