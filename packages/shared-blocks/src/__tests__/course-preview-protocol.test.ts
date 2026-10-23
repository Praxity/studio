import { describe, expect, it } from "vitest";
import {
	isCoursePreviewCommand,
	isCoursePreviewEvent,
	isSafeExternalUrl,
	isSmallPreviewDocument,
	readCoursePreviewChannel,
} from "../course-preview-protocol";
import { LEARNER_STATE_MAX_BYTES } from "../learner-state";

const identity = {
	channel: "a".repeat(32),
	courseId: "course-1",
	revision: "b".repeat(64),
	pageId: "page-1",
};

const patch = {
	source: "praxity-studio",
	version: 1,
	...identity,
	action: "patch",
	seq: 4,
	order: ["node"],
	fragments: [{ id: "node", html: "<p>New</p>", island: "assessment" }],
	shellStale: false,
};
it("refuses frame patches and compile events on the course preview channel", () => {
	expect(isCoursePreviewCommand(patch, identity)).toBe(false);
	expect(
		isCoursePreviewEvent(
			{
				source: "praxity-course",
				version: 1,
				...identity,
				event: "patched",
				seq: 4,
				missing: [],
				stalePatchesDropped: 1,
			},
			identity,
		),
	).toBe(false);
	expect(
		isCoursePreviewEvent(
			{
				source: "praxity-course",
				version: 1,
				...identity,
				event: "compileFailed",
				seq: 5,
				diagnostics: [
					{
						message: "Unclosed block",
						line: 3,
						messageRef: { key: "grammar.v4.unclosed-opener", args: { type: "note" } },
					},
				],
			},
			identity,
		),
	).toBe(false);
});
describe("course preview protocol", () => {
	it("accepts the complete, specific command and event vocabulary", () => {
		for (const command of [
			{ action: "connect" },
			{ action: "restore", state: "{}", writable: true },
			{ action: "freeze" },
			{ action: "utility-closed" },
			{ action: "resume", state: "{}" },
			{ action: "logic", enabled: false },
			{ action: "focus", edge: "first" },
			{ action: "focus", edge: "last" },
		]) {
			expect(
				isCoursePreviewCommand(
					{ source: "praxity-studio", version: 1, ...command, ...identity },
					identity,
				),
			).toBe(true);
		}

		for (const event of [
			{ event: "connected" },
			{ event: "open-utility", url: "http://127.0.0.1:9000/preview/read-only/glossary.html" },
			{ event: "ready", mode: "learner" },
			{ event: "ready", mode: "inspection" },
			{ event: "persist", state: "{}" },
			{ event: "frozen", state: "{}" },
			{ event: "navigate", state: "{}", url: "praxity-course://artifact/page-two.html" },
			{ event: "author-bypass", direction: "previous" },
			{ event: "author-bypass", direction: "next" },
			{ event: "escape" },
			{ event: "focus-boundary", direction: "forward" },
			{ event: "focus-boundary", direction: "backward" },
			{ event: "open-external", url: "https://example.com/resource" },
			{ event: "fatal", code: "runtime-start" },
		]) {
			expect(
				isCoursePreviewEvent(
					{ source: "praxity-course", version: 1, ...event, ...identity },
					identity,
				),
			).toBe(true);
		}
	});

	it("requires the exact identity and per-message keys", () => {
		const connect = {
			source: "praxity-studio",
			version: 1,
			action: "connect",
			...identity,
		};
		expect(isCoursePreviewCommand(connect, identity)).toBe(true);
		expect(isCoursePreviewCommand({ ...connect, extra: true }, identity)).toBe(false);
		expect(isCoursePreviewCommand({ ...connect, version: 2 }, identity)).toBe(false);
		expect(isCoursePreviewCommand({ ...connect, pageId: "other" }, identity)).toBe(false);
		expect(isCoursePreviewCommand({ ...connect, action: "reset" }, identity)).toBe(false);
		expect(isCoursePreviewCommand({ ...connect, action: "focus", edge: "middle" }, identity)).toBe(
			false,
		);

		const restore = {
			source: "praxity-studio",
			version: 1,
			action: "restore",
			state: "{}",
			writable: true,
			...identity,
		};
		expect(isCoursePreviewCommand({ ...restore, writable: undefined }, identity)).toBe(false);

		const ready = {
			source: "praxity-course",
			version: 1,
			event: "ready",
			mode: "inspection",
			...identity,
		};
		expect(isCoursePreviewEvent(ready, identity)).toBe(true);
		expect(isCoursePreviewEvent({ ...ready, extra: true }, identity)).toBe(false);
		expect(isCoursePreviewEvent({ ...ready, version: 2 }, identity)).toBe(false);
		expect(isCoursePreviewEvent({ ...ready, event: "reset" }, identity)).toBe(false);
		expect(
			isCoursePreviewEvent(
				{ source: "praxity-course", version: 1, event: "escape", extra: true, ...identity },
				identity,
			),
		).toBe(false);
	});

	it("bounds state and rejects unknown fatal codes", () => {
		const state = "😀".repeat(LEARNER_STATE_MAX_BYTES / 4);
		const oversizedState = `${state}😀`;
		expect(
			isCoursePreviewCommand(
				{
					source: "praxity-studio",
					version: 1,
					action: "restore",
					state,
					writable: true,
					...identity,
				},
				identity,
			),
		).toBe(true);
		expect(
			isCoursePreviewCommand(
				{
					source: "praxity-studio",
					version: 1,
					action: "resume",
					state: oversizedState,
					...identity,
				},
				identity,
			),
		).toBe(false);
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "persist",
					state: oversizedState,
					...identity,
				},
				identity,
			),
		).toBe(false);
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "navigate",
					state,
					url: "not a URL",
					...identity,
				},
				identity,
			),
		).toBe(false);
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "fatal",
					code: "other",
					...identity,
				},
				identity,
			),
		).toBe(false);
	});

	it("accepts only credential-free HTTPS external URLs", () => {
		expect(isSafeExternalUrl("https://example.com/resource?q=1")).toBe(true);
		expect(isSafeExternalUrl("https://user:secret@example.com")).toBe(false);
		expect(isSafeExternalUrl("http://example.com")).toBe(false);
		expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "open-external",
					url: "javascript:alert(1)",
					...identity,
				},
				identity,
			),
		).toBe(false);
	});

	it("requires an unguessable URL channel", () => {
		expect(readCoursePreviewChannel(`?praxity-channel=${"x".repeat(32)}`)).toBe("x".repeat(32));
		expect(readCoursePreviewChannel("?praxity-channel=short")).toBeNull();
	});

	it("accepts only bounded author bypass directions", () => {
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "author-bypass",
					direction: "next",
					...identity,
				},
				identity,
			),
		).toBe(true);
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "author-bypass",
					direction: "end",
					...identity,
				},
				identity,
			),
		).toBe(false);
		expect(
			isCoursePreviewEvent(
				{
					source: "praxity-course",
					version: 1,
					event: "focus-boundary",
					direction: "sideways",
					...identity,
				},
				identity,
			),
		).toBe(false);
	});
});

describe("small preview query", () => {
	it.each<[string, boolean]>([
		["", false],
		["?minimal=1", false],
		["?praxity-small-preview", false],
		["?praxity-small-preview=", false],
		["?praxity-small-preview=0", false],
		["?praxity-small-preview=true", false],
		["?Praxity-small-preview=1", false],
		["?praxity-small-preview=01", false],
		["?praxity-small-preview=1%20", false],
		["?praxity-small-preview=1", true],
		["?minimal=1&praxity-small-preview=1", true],
		["?praxity-small-preview=0&praxity-small-preview=1", false],
		["?praxity-small-preview=&praxity-small-preview=1", false],
		["?praxity-small-preview=1&praxity-small-preview=0", true],
		["?%70raxity-small-preview=1", true],
		["?praxity-small-preview=%31", true],
		["?%70raxity-small-preview=0&praxity-small-preview=1", false],
	])("interprets %s as %s", (search, expected) => {
		expect(isSmallPreviewDocument(search)).toBe(expected);
	});
});
