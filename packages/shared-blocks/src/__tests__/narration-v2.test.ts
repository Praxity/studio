import { describe, expect, it } from "vitest";
import {
	acceptNarrationV2Entry,
	type NarrationSidecarV2,
	resolveNarrationV2,
	retireNarration,
	updateNarrationV2Entry,
} from "../narration";
import type { PraxityPage } from "../types";

// The host owns SHA-256. This seam makes revision changes visible without Node in the UI package.
const digest = (text: string) => text;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const courseId = uuid(1),
	lessonId = uuid(2);
function pages(): PraxityPage[] {
	return [
		{
			id: uuid(3),
			title: "A title",
			blocks: [
				{
					id: uuid(4),
					type: "card",
					data: {
						items: [
							{
								id: uuid(5),
								backId: uuid(6),
								label: "Front",
								front: [],
								back: [{ id: uuid(7), type: "text", data: { content: "Back" } }],
							},
						],
					},
				},
			],
		},
	];
}
const empty = (): NarrationSidecarV2 => ({
	version: 2,
	courseId,
	lessons: {
		[lessonId]: {
			enabled: true,
			defaults: { language: "en", voice: "Maya", speed: 1 },
			segments: [],
		},
	},
});
function recorded(): NarrationSidecarV2 {
	const sidecar = empty();
	sidecar.lessons[lessonId].segments = resolve(pages(), sidecar).pages[0].segments.map(
		(segment) => ({
			target: segment.target,
			reviewedRevision: segment.revision,
			audio: `${segment.target.role}.mp3`,
			audioFor: { script: segment.script, language: "en", voice: "Maya", speed: 1 },
		}),
	);
	return sidecar;
}
function resolve(current: PraxityPage[], sidecar = recorded()) {
	return resolveNarrationV2({ courseId, lessonId, pages: current, sidecar, locale: "en", digest });
}
describe("N1 role revisions and identity", () => {
	it("a card back edit flags only the back clip and retains every recording", () => {
		const current = pages();
		const item = (
			current[0].blocks[0].data.items as { back: { data: { content: string } }[] }[]
		)[0];
		item.back[0].data.content = "Edited back";
		const segments = resolve(current).pages[0].segments;
		expect(segments.map((s) => [s.target.role, s.status, s.audioUrl])).toEqual([
			["title", "ready", "title.mp3"],
			["front", "ready", "front.mp3"],
			["back", "needsReview", "back.mp3"],
		]);
	});
	it("emptying a title keeps its recording at the same playback position and flags it", () => {
		const current = pages();
		current[0].title = "";
		const resolved = resolve(current);
		expect(resolved.unresolved).toEqual([]);
		expect(resolved.pages[0].segments.map((s) => [s.target.role, s.audioUrl, s.status])).toEqual([
			["title", "title.mp3", "needsReview"],
			["front", "front.mp3", "ready"],
			["back", "back.mp3", "ready"],
		]);
	});
	it("a title typo flags only the title clip", () => {
		const current = pages();
		current[0].title = "A titlle";
		expect(resolve(current).pages[0].segments.map((s) => s.status)).toEqual([
			"needsReview",
			"ready",
			"ready",
		]);
	});
	it("a nav label edit leaves the authored page title recording current", () => {
		const current = pages();
		current[0].data = { title: "A title" };
		current[0].title = "Short nav";
		expect(resolve(current).pages[0].segments[0].status).toBe("ready");
		expect(resolve(current).pages[0].segments[0].script).toBe("A title");
	});
	it("a page move keeps audio unflagged", () => {
		const current = pages();
		current.unshift({ id: uuid(8), title: "Other", blocks: [] });
		expect(resolve(current).pages[1].segments.map((s) => s.status)).toEqual([
			"ready",
			"ready",
			"ready",
		]);
	});
	it("a page moved into another lesson finds the same recordings", () => {
		const sidecar = recorded();
		sidecar.lessons[uuid(9)] = {
			enabled: true,
			defaults: sidecar.lessons[lessonId].defaults,
			segments: [],
		};
		const moved = resolveNarrationV2({
			courseId,
			lessonId: uuid(9),
			pages: pages(),
			sidecar,
			locale: "en",
			digest,
		});
		expect(moved.pages[0].segments.map((s) => [s.status, s.audioUrl])).toEqual([
			["ready", "title.mp3"],
			["ready", "front.mp3"],
			["ready", "back.mp3"],
		]);
	});
	it("a changed inherited voice invalidates provenance while retaining the recording", () => {
		const sidecar = recorded();
		sidecar.lessons[lessonId].defaults = { language: "en", voice: "Other", speed: 1 };
		expect(resolve(pages(), sidecar).pages[0].segments.map((s) => [s.status, s.audioUrl])).toEqual([
			["stale", "title.mp3"],
			["stale", "front.mp3"],
			["stale", "back.mp3"],
		]);
	});
	it("editing a moved target updates its course entry without duplicating it", () => {
		const sidecar = recorded();
		sidecar.lessons[uuid(9)] = {
			enabled: true,
			defaults: sidecar.lessons[lessonId].defaults,
			segments: [],
		};
		const edited = updateNarrationV2Entry(
			sidecar,
			uuid(9),
			{ id: uuid(3), role: "title" },
			{ script: "Edited" },
		);
		const result = resolveNarrationV2({
			courseId,
			lessonId: uuid(9),
			pages: pages(),
			sidecar: edited,
			locale: "en",
			digest,
		});
		expect(result.pages[0].segments[0].script).toBe("Edited");
		expect(result.pages[0].segments[0].audioUrl).toBe("title.mp3");
		expect(Object.values(edited.lessons).flatMap((l) => l.segments)).toHaveLength(3);
	});
	it.each([{ script: "New script" }, { voice: "Other" }, { speed: 1.1 }, { language: "fr" }])(
		"changed inputs invalidate audioFor and keep audio: %j",
		(patch) => {
			const sidecar = recorded(),
				entry = sidecar.lessons[lessonId].segments[0];
			const edited = updateNarrationV2Entry(sidecar, lessonId, entry.target, patch);
			expect(edited.lessons[lessonId].segments[0].audioFor).toBeUndefined();
			expect(resolve(pages(), edited).pages[0].segments[0].status).toBe("stale");
			expect(edited.lessons[lessonId].segments[0].audio).toBe("title.mp3");
			expect(sidecar.lessons[lessonId].segments[0].audioFor).toBeDefined();
		},
	);
	it("unresolved entries remain listed until their identity is retired", () => {
		const sidecar = recorded();
		const result = resolve([], sidecar);
		expect(result.unresolved.map((item) => item.entry)).toEqual(sidecar.lessons[lessonId].segments);
		expect(
			retireNarration(sidecar, [uuid(6)]).lessons[lessonId].segments.map((s) => s.target.role),
		).toEqual(["title", "front"]);
		expect(sidecar.lessons[lessonId].segments).toHaveLength(3);
	});
	it("rejects another course namespace", () => {
		expect(() =>
			resolveNarrationV2({
				courseId: uuid(9),
				lessonId,
				pages: pages(),
				sidecar: recorded(),
				locale: "en",
				digest,
			}),
		).toThrow(/course/i);
	});
});

describe("N2 acceptance", () => {
	it("accepts a retained clip while keeping its original provenance, then reflags settings and source changes", () => {
		const current = pages();
		current[0].title = "A revised title";
		const old = recorded();
		const stale = resolve(current, old).pages[0].segments[0];
		const accepted = acceptNarrationV2Entry(old, lessonId, stale, "en");
		expect(accepted.lessons[lessonId].segments[0]).toMatchObject({
			audio: "title.mp3",
			audioFor: { script: "A title" },
			acceptedFor: { script: "A revised title", voice: "Maya", speed: 1 },
			reviewedRevision: "A revised title",
		});
		expect(resolve(current, accepted).pages[0].segments[0]).toMatchObject({
			status: "ready",
			audioForCurrent: false,
			audioUrl: "title.mp3",
		});
		for (const patch of [{ voice: "Other" }, { speed: 0.85 }, { script: "Different words" }]) {
			const next = updateNarrationV2Entry(accepted, lessonId, stale.target, patch);
			expect(resolve(current, next).pages[0].segments[0]).toMatchObject({
				status: "stale",
				audioUrl: "title.mp3",
			});
		}
		current[0].title = "A revised title!";
		expect(resolve(current, accepted).pages[0].segments[0]).toMatchObject({
			status: "needsReview",
			audioUrl: "title.mp3",
		});
	});
});

it("N2 keeps acceptance when an unchanged inherited script is blurred", () => {
	const current = pages();
	current[0].title = "Revised title";
	const old = recorded();
	const segment = resolve(current, old).pages[0].segments[0];
	const accepted = acceptNarrationV2Entry(old, lessonId, segment, "en");
	const unchanged = updateNarrationV2Entry(accepted, lessonId, segment.target, {
		script: undefined,
	});
	expect(resolve(current, unchanged).pages[0].segments[0]).toMatchObject({
		status: "ready",
		audioUrl: "title.mp3",
	});
});
