import { assertHash, assertId, assertPath } from "@praxity/content-identity/src/files.ts";

/** Retained review formats are read only to verify protected recovery evidence. */
export interface ReviewRunMetadata {
	schema: 1;
	author: string;
	createdAt: string;
	summaries: { entityId: string; summary: string }[];
}
export interface ReviewRun {
	id: string;
	author: string;
	createdAt: string;
	summaries: ReviewRunMetadata["summaries"];
}
export interface ReviewState {
	schema: 1;
	courseId: string;
	baseline: { path: string; snapshotRef: string }[];
	runs: ReviewRun[];
	suggestions: { id: string; runId: string }[];
}
export class ReviewError extends Error {
	readonly code = "EREVIEW";
}
const fail = (reason: string): never => {
	throw new ReviewError(`Review: ${reason}`);
};

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		fail("invalid sidecar fields");
	return value as Record<string, unknown>;
}
function text(value: unknown): asserts value is string {
	if (typeof value !== "string" || !value.trim()) fail("expected nonempty text");
}
function array(value: unknown): asserts value is unknown[] {
	if (!Array.isArray(value)) fail("expected array");
}
function unique(values: readonly string[]) {
	if (new Set(values).size !== values.length) fail("duplicate sidecar ID or path");
}
function json(source: string): unknown {
	try {
		return JSON.parse(source);
	} catch (cause) {
		throw new ReviewError(`Review: invalid JSON: ${String(cause)}`);
	}
}

function runMetadata(value: Record<string, unknown>) {
	text(value.author);
	text(value.createdAt);
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value.createdAt) ||
		!Number.isFinite(Date.parse(value.createdAt))
	)
		fail("invalid run timestamp");
	array(value.summaries);
	for (const raw of value.summaries) {
		const summary = object(raw, ["entityId", "summary"]);
		assertId(summary.entityId);
		text(summary.summary);
	}
}
export function parseReviewRun(source: string): ReviewRunMetadata {
	const value = object(json(source), ["schema", "author", "createdAt", "summaries"]);
	if (value.schema !== 1) fail("unknown run schema");
	runMetadata(value);
	return value as unknown as ReviewRunMetadata;
}
export function parseReviewState(source: string, courseId?: string): ReviewState {
	const value = object(json(source), ["schema", "courseId", "baseline", "runs", "suggestions"]);
	if (value.schema !== 1 || (courseId !== undefined && value.courseId !== courseId))
		fail("state schema or course identity mismatch");
	assertId(value.courseId);
	array(value.baseline);
	array(value.runs);
	array(value.suggestions);
	for (const raw of value.baseline) {
		const baseline = object(raw, ["path", "snapshotRef"]);
		assertPath(baseline.path);
		assertHash(baseline.snapshotRef);
	}
	for (const raw of value.runs) {
		const run = object(raw, ["id", "author", "createdAt", "summaries"]);
		assertId(run.id);
		runMetadata(run);
	}
	const runs = value.runs as ReviewRun[];
	for (const raw of value.suggestions) {
		const suggestion = object(raw, ["id", "runId"]);
		assertHash(suggestion.id);
		assertId(suggestion.runId);
		if (!runs.some((run) => run.id === suggestion.runId)) fail("suggestion refers to missing run");
	}
	unique(value.baseline.map((b) => (b as ReviewState["baseline"][number]).path));
	unique(runs.map((r) => r.id));
	unique(value.suggestions.map((s) => (s as ReviewState["suggestions"][number]).id));
	return value as unknown as ReviewState;
}
