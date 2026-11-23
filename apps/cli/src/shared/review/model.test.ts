import { describe, expect, it } from "vitest";
import { parseReviewRun, parseReviewState } from "./model";

const courseId = "00000000-0000-4000-8000-000000000001";
const entityId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const hash = "a".repeat(64);
const metadata = {
	schema: 1,
	author: "Retained author",
	createdAt: "2026-10-12T00:00:00Z",
	summaries: [{ entityId, summary: "Retained evidence" }],
};
const { schema: _schema, ...run } = metadata;
const state = {
	schema: 1,
	courseId,
	baseline: [{ path: "lesson.prax", snapshotRef: hash }],
	runs: [{ id: runId, ...run }],
	suggestions: [{ id: hash, runId }],
};

describe("retained review recovery formats", () => {
	it("reads existing run and state records without changing their values", () => {
		expect(parseReviewRun(JSON.stringify(metadata))).toEqual(metadata);
		expect(parseReviewState(JSON.stringify(state), courseId)).toEqual(state);
		expect(parseReviewState(JSON.stringify(state))).toEqual(state);
	});
	it.each([
		{ ...metadata, schema: 99 },
		{ ...metadata, extra: true },
		{ ...metadata, author: " " },
		{ ...metadata, createdAt: "yesterday" },
		{ ...metadata, createdAt: "2026-10-12T00:00:00+00:00" },
		{ ...metadata, summaries: null },
		{
			...metadata,
			summaries: [{ entityId: "rt-00000000000000000000000000001003", summary: "Changed" }],
		},
		{ ...metadata, summaries: [{ entityId, summary: "" }] },
		{ ...metadata, summaries: [{ entityId, summary: "Changed", extra: true }] },
	])("refuses invalid retained run %j", (value) => {
		expect(() => parseReviewRun(JSON.stringify(value))).toThrow();
	});
	it.each([
		{ ...state, schema: 99 },
		{ ...state, courseId: entityId },
		{ ...state, extra: true },
		{ ...state, baseline: null },
		{ ...state, baseline: [{ path: "../outside.prax", snapshotRef: hash }] },
		{ ...state, baseline: [{ path: "lesson.prax", snapshotRef: "invalid" }] },
		{ ...state, baseline: [state.baseline[0], state.baseline[0]] },
		{ ...state, runs: [state.runs[0], state.runs[0]] },
		{ ...state, runs: [{ ...state.runs[0], id: "invalid" }] },
		{ ...state, runs: [{ ...state.runs[0], author: "" }] },
		{ ...state, runs: [{ ...state.runs[0], extra: true }] },
		{ ...state, suggestions: [{ id: "invalid", runId }] },
		{ ...state, suggestions: [{ id: hash, runId: entityId }] },
		{ ...state, suggestions: [state.suggestions[0], state.suggestions[0]] },
	])("refuses invalid retained state %j", (value) => {
		expect(() => parseReviewState(JSON.stringify(value), courseId)).toThrow();
	});
	it.each(["", "{broken", "null", "[]", "{}"])(
		"refuses unreadable or incomplete record %s",
		(source) => {
			expect(() => parseReviewRun(source)).toThrow();
			expect(() => parseReviewState(source, courseId)).toThrow();
		},
	);
});
