import { createLearnerState, parseLearnerState } from "@praxity/shared-blocks/learner-state";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChoiceDependencyView } from "../../shared-blocks/src/choice-learner-state";
import { choiceDependencyStatus } from "../../shared-blocks/src/choice-learner-state";
import * as scorm12 from "../src/scorm/api/scorm12";
import * as scorm2004 from "../src/scorm/api/scorm2004";
import * as xapi from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import * as evidence from "../src/scorm/types";

const signature = "sha256:e4df374aeafe8ae449c0321eca27fe0d42f77d070f28050db87e4957bc86e30d";
const current = {
	id: "a",
	response: "a",
	correct: true,
	score: 100,
	timestamp: 1,
	contentSignature: signature,
};
const rejected = { ...current, response: null, timestamp: 2, contentSignature: "sha256:broken" };
const marker = { id: "a", choiceEvidenceInvalid: true };
const state = {
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: 1,
	checked: true,
	correct: true,
	completed: true,
	interacted: true,
	answer: ["a"],
	contentSignature: signature,
	materialProof: { optionIds: ["a", "b"] },
};
const view: Omit<ChoiceDependencyView, "rows"> = {
	questions: {
		a: {
			selectionMode: "single",
			dontKnow: false,
			canAutoScore: true,
			graded: true,
			maxAttempts: 2,
			correctAnswerSignature:
				"sha256:0eb5b8d6f81bc677da8a08567cc4fa9a06a57e9ec8da85ed73a7f62727996002",
			materialSignature: `sha256:${"a".repeat(64)}`,
			options: [
				{ id: "a", materialSignature: `sha256:${"b".repeat(64)}` },
				{ id: "b", materialSignature: `sha256:${"c".repeat(64)}` },
			],
		},
	},
	signatures: { a: signature },
	readState: () => state,
};

const documents: JSDOM[] = [];
afterEach(() => {
	for (const dom of documents.splice(0)) dom.window.close();
	vi.unstubAllGlobals();
});

function storage() {
	const dom = new JSDOM("", { url: "https://course.example/lesson.html" });
	documents.push(dom);
	vi.stubGlobal("window", dom.window);
	return dom.window.localStorage;
}
const key = "praxity-xapi:course:mailto%3Alearner%40example.com";
function runtime(store: Storage) {
	return new xapi.XapiRuntime(
		{
			endpoint: "https://lrs.example/statements",
			auth: "Basic synthetic",
			actorMode: "manual",
			actor: { name: "Learner", mbox: "mailto:learner@example.com" },
		},
		"course",
		store,
	);
}
function ordinaryRead(raw: string) {
	const store = storage();
	store.setItem(key, raw);
	return runtime(store).getInteractions();
}
// Base controls use the actual old reader, so absence fails assertions, never imports.
const read = xapi.readXapiInteractionEvidence ?? ordinaryRead;

function scorm(format: string, raw: string) {
	const get = (name: string) => (name === "cmi.suspend_data" ? raw : "");
	const ok = () => "true";
	const win = {
		API: { LMSInitialize: ok, LMSGetValue: get, LMSSetValue: ok, LMSGetLastError: () => "0" },
		API_1484_11: { Initialize: ok, GetValue: get, SetValue: ok, GetLastError: () => "0" },
		parent: undefined as unknown,
	};
	win.parent = win;
	vi.stubGlobal("window", win);
	const adapter =
		format === "scorm12" ? new scorm12.Scorm12Runtime() : new scorm2004.Scorm2004Runtime();
	expect(adapter.initialize()).toBe(true);
	return adapter;
}

describe("ordinary restoration characterization", () => {
	it("keeps xAPI acceptance, raw fields, order and persisted writes unchanged", () => {
		const store = storage();
		const rawRows = [
			{ ...current, customField: "opaque", attemptsUsed: "malformed" },
			{ ...current, id: "", timestamp: -1 },
			rejected,
			{ ...current, score: "100" },
			{ ...current, correct: "true" },
			null,
			"invalid",
			{ ...current, timestamp: null },
			{ id: "b", response: "b", timestamp: 3 },
		];
		store.setItem(key, JSON.stringify({ interactions: rawRows }));
		const original = runtime(store);
		expect(original.getInteractions()).toEqual([rawRows[0], rawRows[1], rawRows[8]]);
		original.setBookmark("page");
		expect(store.getItem(key)).toBe(
			JSON.stringify({
				visitedPages: [],
				interactions: [rawRows[0], rawRows[1], rawRows[8]],
				completionStatus: "incomplete",
				successStatus: "unknown",
				score: null,
				bookmark: "page",
				suspendData: null,
				outbox: [],
			}),
		);
		expect(runtime(store).getInteractions()).toEqual(original.getInteractions());
	});

	it.each(["scorm12", "scorm2004"])("%s retains rejected raw rows in order", (format) => {
		const raw = JSON.stringify({ visitedPages: [], interactions: [current, rejected] });
		const adapter = scorm(format, raw);
		expect(JSON.parse(JSON.stringify(adapter.getInteractions()))).toEqual([current, rejected]);
	});

	it("local state refuses a malformed envelope without reviving any row or replacing bytes", () => {
		const store = storage();
		const saved = createLearnerState({ courseId: "course", attemptId: "default" });
		const raw = JSON.stringify({ ...saved, interactions: [current, rejected] });
		store.setItem("praxity:course:default:state", raw);
		expect(parseLearnerState(raw, saved)).toBeNull();
		expect(new LocalStorageRuntime(store, "course").getInteractions()).toEqual([]);
		expect(store.getItem("praxity:course:default:state")).toBe(raw);
	});
});

describe("dormant signed restoration", () => {
	it("rejects unsigned numeric IDs through the ordinary and dormant readers", () => {
		const raw = JSON.stringify({ interactions: [current, { id: 0, response: "a", timestamp: 2 }] });
		expect(ordinaryRead(raw)).toEqual([current]);
		expect(read(raw)).toEqual([current]);
	});

	it.each(["timestamp", "score"])(
		"rejects overflowing JSON %s without changing ordinary acceptance",
		(field) => {
			const latest = JSON.stringify({ ...current, [field]: "overflow" }).replace(
				'"overflow"',
				"1e999",
			);
			const raw = `{"interactions":[${JSON.stringify(current)},${latest}]}`;
			expect(ordinaryRead(raw)).toEqual([current]);
			expect(read(raw)?.[1]).toMatchObject(marker);
			expect(choiceDependencyStatus("a", { ...view, rows: read(raw) ?? [] })).toBe("history");
		},
	);

	it("admits a valid signed row through the existing status owner", () => {
		const rows = read(JSON.stringify({ interactions: [current] }));
		expect(rows).not.toBeNull();
		expect(choiceDependencyStatus("a", { ...view, rows: rows ?? [] })).toBe("current");
	});

	it.each([
		rejected,
		{ ...rejected, contentSignature: signature },
		{ ...current, response: "a", contentSignature: "sha256:broken" },
		{ ...current, response: null, contentSignature: undefined, choiceEvidenceInvalid: true },
		{ ...current, timestamp: null },
		{ ...current, correct: "true" },
		{ ...current, score: "100" },
		{ ...current, memberIds: [null] },
	])("keeps the latest rejected evidence as history through save/reload: %j", (latest) => {
		const raw = JSON.stringify({ interactions: [current, latest] });
		const rows = read(raw);
		expect(rows).toHaveLength(2);
		expect(rows?.[1]).toMatchObject(marker);
		expect(choiceDependencyStatus("a", { ...view, rows: rows ?? [] })).toBe("history");
		const reloaded = read(JSON.stringify({ interactions: rows }));
		expect(reloaded).toEqual(rows);
		expect(choiceDependencyStatus("a", { ...view, rows: reloaded ?? [] })).toBe("history");
		expect(JSON.parse(raw).interactions[1]).toEqual(JSON.parse(JSON.stringify(latest)));
	});

	it("does not invent a response, score, verdict or timestamp for a rejected row", () => {
		const rows = read(JSON.stringify({ interactions: [current, rejected] }));
		expect(rows?.[1]).toEqual({ ...rejected, ...marker });
	});

	it("retains the marker in the existing row array when saved and read from storage again", () => {
		const store = storage();
		store.setItem(key, JSON.stringify({ interactions: [current, rejected] }));
		const rows = read(store.getItem(key) as string);
		expect(rows?.[1]).toEqual({ ...rejected, ...marker });
		store.setItem(key, JSON.stringify({ interactions: rows }));
		const reloaded = read(store.getItem(key) as string);
		expect(reloaded?.[1]).toEqual({ ...rejected, ...marker });
		expect(choiceDependencyStatus("a", { ...view, rows: reloaded ?? [] })).toBe("history");
	});

	it("retains order rather than sorting timestamps or finding earlier credit", () => {
		const rows = read(JSON.stringify({ interactions: [current, { ...rejected, timestamp: 0 }] }));
		expect(rows?.map((row) => row.id)).toEqual(["a", "a"]);
		expect(choiceDependencyStatus("a", { ...view, rows: rows ?? [] })).toBe("history");
		const repaired = read(JSON.stringify({ interactions: [...(rows ?? []), current] }));
		expect(choiceDependencyStatus("a", { ...view, rows: repaired ?? [] })).toBe("current");
	});

	it.each([undefined, null, "", 0])("refuses unidentifiable signed evidence with id %j", (id) => {
		expect(read(JSON.stringify({ interactions: [current, { ...rejected, id }] }))).toBeNull();
	});

	it("refuses empty identity even when the signed row has otherwise valid fields", () => {
		const latest = { ...current, id: "" };
		expect(read(JSON.stringify({ interactions: [current, latest] }))).toBeNull();
		expect(() => evidence.assessmentRowEvidence(latest)).toThrow(
			"Unidentifiable interaction evidence",
		);
	});

	it("keeps malformed raw attempt fields and raw rejected metadata through reload", () => {
		const legacy = { id: "q", response: "x", timestamp: 1, attemptsUsed: "3", maxAttempts: -1 };
		const invalid = {
			...current,
			memberIds: [null],
			attemptsUsed: "bad",
			maxAttempts: -1,
			opaque: "keep",
		};
		const raw = JSON.stringify({ interactions: [legacy, invalid] });
		expect(ordinaryRead(raw)).toEqual([legacy, invalid]);
		const rows = read(raw);
		expect(rows).toEqual([legacy, { ...invalid, ...marker }]);
		expect(read(JSON.stringify({ interactions: rows }))).toEqual(rows);
	});

	for (const format of ["scorm12", "scorm2004", "xapi"]) {
		it.each(["response", "timestamp"])(
			`${format} marks malformed signed %s as history`,
			(field) => {
				const latest = { ...current, [field]: null };
				const raw = JSON.stringify({ visitedPages: [], interactions: [current, latest] });
				const adapter = format === "xapi" ? undefined : scorm(format, raw);
				const reader =
					format === "scorm12"
						? scorm12.readScorm12InteractionEvidence
						: scorm2004.readScorm2004InteractionEvidence;
				const rows = adapter ? (reader ? reader(raw) : adapter.getInteractions()) : read(raw);
				expect(rows).toEqual([current, { ...latest, ...marker }]);
				expect(choiceDependencyStatus("a", { ...view, rows: rows ?? [] })).toBe("history");
			},
		);
	}

	it("preserves unsigned acceptance/rejection and opaque accepted fields", () => {
		const legacy = { id: "a", response: "a", timestamp: 1, opaque: "keep" };
		const rows = read(
			JSON.stringify({ interactions: [null, legacy, { ...legacy, response: null }] }),
		);
		expect(JSON.parse(JSON.stringify(rows))).toEqual([legacy]);
	});

	it.each(["null", "{}", "{", '{"interactions":null}'])("refuses invalid transport %s", (raw) => {
		expect(xapi.readXapiInteractionEvidence?.(raw) ?? null).toBeNull();
		expect(scorm12.readScorm12InteractionEvidence?.(raw) ?? null).toBeNull();
		expect(scorm2004.readScorm2004InteractionEvidence?.(raw) ?? null).toBeNull();
	});

	it("normalizes rejected identity at the shared owner for other transports", () => {
		const normalize = evidence.assessmentRowEvidence ?? (() => null);
		expect(normalize(rejected)).toEqual({ ...rejected, ...marker });
		expect(normalize({ id: "a", response: null })).toBeNull();
		expect(normalize(null)).toBeNull();
		expect(() => normalize({ ...rejected, id: null })).toThrow(
			"Unidentifiable interaction evidence",
		);
	});
});
