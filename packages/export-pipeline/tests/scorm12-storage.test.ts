import { createHash } from "node:crypto";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { estimateScorm12Storage } from "../src/scorm/scorm12-storage";

/** Desktop page IDs: `page-` plus a UUID, 41 characters. */
function pageId(index: number): string {
	return `page-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function pageBreak(index: number): PraxityBlock {
	return { id: `pb-${index}`, type: "pageBreak", data: { id: pageId(index) } };
}

function text(id: string): PraxityBlock {
	return { id, type: "text", data: { content: "Body" } };
}

function choice(id: string, data: Record<string, unknown> = {}): PraxityBlock {
	return { id, type: "assessment", data: { assessmentType: "choice", ...data } };
}

describe("estimateScorm12Storage", () => {
	it("budgets the saved choice and its row, rather than just the row", () => {
		const block = choice("q", {
			response: {
				type: "choice",
				selectionMode: "single",
				options: [
					{ id: "stop", label: "Stop", isCorrect: true },
					{ id: "go", label: "Go" },
				],
			},
		});
		// One full attempt, using the published saved-state schema and estimate allowances.
		const expected =
			JSON.stringify({
				visitedPages: ["page-1"],
				interactions: [
					{
						id: "q",
						response: "x".repeat(32),
						correct: true,
						score: 100,
						timestamp: 1800000000000,
						contentSignature: "s96:AAAAAAAAAAAAAAAA",
						attemptsUsed: 1,
						maxAttempts: 2,
					},
				],
				custom: JSON.stringify({
					blockState: {
						q: {
							version: 1,
							kind: "assessment",
							assessmentType: "choice",
							contentSignature: "s96:AAAAAAAAAAAAAAAA",
							writtenAt: 1800000000000,
							attemptCount: 1,
							checked: true,
							correct: true,
							completed: true,
							interacted: true,
							answer: ["stop"],
							reviewedChoiceIds: ["stop"],
						},
					},
				}),
			}).length + 512;
		expect(estimateScorm12Storage({ blocks: [block] })).toEqual({
			atRisk: false,
			estimatedLength: expected,
			limit: 4096,
			reportingSelfCheckCount: 0,
		});
	});

	it.each([4, 5, 8, 12])("does not warn before compression for %i UUID questions", (count) => {
		const uuid = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 36);
		const blocks: PraxityBlock[] = [];
		for (let n = 0; n < count; n++)
			blocks.push(
				{ id: uuid(`break-${n}`), type: "pageBreak", data: { id: `page-${uuid(`page-${n}`)}` } },
				choice(uuid(`q-${n}`), {
					response: {
						type: "choice",
						selectionMode: "single",
						options: Array.from({ length: 4 }, (_, i) => ({
							id: uuid(`${n}-${i}`),
							label: `Option ${i}`,
							isCorrect: i === 0,
						})),
					},
				}),
			);
		const estimate = estimateScorm12Storage({ blocks });
		expect(estimate.atRisk).toBe(false);
		expect(estimate.estimatedLength).toBeLessThanOrEqual(4096);
	});

	it("budgets both reportable self-check snapshots and excludes private checks", () => {
		const check: PraxityBlock = {
			id: "check",
			type: "selfCheck",
			data: { content: { task: "Explain", parts: [{ id: "part" }] } },
		};
		expect(estimateScorm12Storage({ blocks: [check] })).toEqual({
			atRisk: false,
			estimatedLength: 557,
			limit: 4096,
			reportingSelfCheckCount: 0,
		});
		expect(
			estimateScorm12Storage({ blocks: [{ ...check, data: { ...check.data, private: false } }] }),
		).toEqual({ atRisk: true, estimatedLength: 8754, limit: 4096, reportingSelfCheckCount: 1 });
	});
	it("flags a 250-page course with UUID page IDs", () => {
		const blocks: PraxityBlock[] = [pageBreak(0), text("t-0")];
		for (let index = 1; index < 250; index++) blocks.push(pageBreak(index), text(`t-${index}`));

		expect(estimateScorm12Storage({ blocks })).toEqual({
			atRisk: true,
			estimatedLength: 11548,
			limit: 4096,
			reportingSelfCheckCount: 0,
		});
	});

	it("passes a short course with a few questions", () => {
		const blocks: PraxityBlock[] = [
			pageBreak(0),
			text("t-0"),
			pageBreak(1),
			choice("q-1"),
			pageBreak(2),
			choice("q-2"),
			pageBreak(3),
			text("t-3"),
		];

		expect(estimateScorm12Storage({ blocks })).toEqual({
			atRisk: false,
			estimatedLength: 947,
			limit: 4096,
			reportingSelfCheckCount: 0,
		});
	});

	it("counts nested questions and groups, but not private questions", () => {
		const withPrivate = estimateScorm12Storage({
			blocks: [
				{
					id: "group-1",
					type: "assessmentGroup",
					data: { children: [choice("q-1"), choice("q-2", { private: true })] },
				},
			],
		});
		const withoutPrivate = estimateScorm12Storage({
			blocks: [{ id: "group-1", type: "assessmentGroup", data: { children: [choice("q-1")] } }],
		});

		expect(withPrivate).toEqual(withoutPrivate);
		expect(withPrivate.estimatedLength).toBe(784);
	});
});

it("keeps the reporting self-check warning when a choice enables compression", () => {
	const check: PraxityBlock = {
		id: "reflection",
		type: "selfCheck",
		data: { private: false, content: { task: "Explain", parts: [{ id: "part" }] } },
	};
	const question = choice("q", {
		response: {
			type: "choice",
			selectionMode: "single",
			options: [
				{ id: "stop", label: "Stop", isCorrect: true },
				{ id: "go", label: "Go" },
			],
		},
	});
	expect(estimateScorm12Storage({ blocks: [question, check] })).toMatchObject({
		atRisk: true,
		reportingSelfCheckCount: 1,
	});
});
it("keeps the open-text warning in a mixed course", () => {
	const question = choice("q", {
		response: {
			type: "choice",
			selectionMode: "single",
			options: [{ id: "stop", label: "Stop", isCorrect: true }],
		},
	});
	const open = Array.from(
		{ length: 40 },
		(_, i): PraxityBlock => ({
			id: `reflection-${i}`,
			type: "assessment",
			data: { assessmentType: "textResponse", private: false },
		}),
	);
	expect(estimateScorm12Storage({ blocks: open }).atRisk).toBe(true);
	expect(estimateScorm12Storage({ blocks: [question, ...open] }).atRisk).toBe(true);
});

it("warns when a signed full choice attempt exceeds the compact codec limit", () => {
	const blocks = Array.from({ length: 120 }, (_, n) =>
		choice(createHash("sha256").update(`q-${n}`).digest("hex"), {
			response: {
				type: "choice",
				selectionMode: "single",
				options: [
					{
						id: createHash("sha256").update(`a-${n}`).digest("hex"),
						label: `Action ${n}`,
						isCorrect: true,
					},
					{ id: createHash("sha256").update(`b-${n}`).digest("hex"), label: `Alternative ${n}` },
				],
			},
		}),
	);
	expect(() => estimateScorm12Storage({ blocks })).not.toThrow();
	expect(estimateScorm12Storage({ blocks })).toMatchObject({ atRisk: true, limit: 4096 });
});
