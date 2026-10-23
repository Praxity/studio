import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { describe, expect, it } from "vitest";
import {
	emptyNarrationReadView,
	parseNarrationSidecarV2,
	resolveLessonNarration,
	serializeNarrationSidecarV2,
} from "../narration-sidecar";

const id = "00000000-0000-4000-8000-000000000001";
describe("N1 v2 persistence", () => {
	it("missing narration accepts a runtime read namespace while durable parsing and serialization refuse it", () => {
		const runtimeId = "rt-00000000000000000000000000001003";
		const view = emptyNarrationReadView(runtimeId);
		expect(view).toEqual({ version: 2, courseId: runtimeId, lessons: {} });
		expect(() => parseNarrationSidecarV2("", runtimeId)).toThrow(
			"an empty v2 sidecar requires the course identity",
		);
		expect(() => serializeNarrationSidecarV2(view)).toThrow(
			"expected version 2 with courseId and lessons",
		);
	});
	it("round-trips a nested self-check task recording without automatic feedback or private text", () => {
		const source =
			"# Practice\n::: accordion\n:: Practice task\n::: self-check Explain the delay.\nmodel: MODEL_SECRET\n:: Criterion\nmissed: HINT_SECRET\n:::\n:::\n";
		const readSource = (text: string) => {
			let next = 0;
			return readLesson(text, {
				ids: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
			});
		};
		const read = readSource(source);
		const check = [...read.nodes.values()].find(
			(record) => !record.role && record.node.type === "self-check",
		);
		if (!check) throw new Error("Missing self-check fixture");
		const target = { id: check.id, role: "title" as const };
		const digest = (text: string) => createHash("sha256").update(text).digest("hex");
		const sidecar = parseNarrationSidecarV2(
			serializeNarrationSidecarV2({
				version: 2,
				courseId: id,
				lessons: {
					[id]: {
						enabled: true,
						segments: [
							{
								target,
								reviewedRevision: digest("Explain the delay."),
								audio: "audio/task.mp3",
								audioFor: { script: "Explain the delay.", language: "en", voice: "Maya", speed: 1 },
							},
						],
					},
				},
			}),
		);
		const resolve = (read: ReturnType<typeof readLesson>) =>
			resolveLessonNarration({ read, courseId: id, lessonId: id, locale: "en", digest, sidecar });
		const result = resolve(read);
		expect(result.unlinked).toEqual([]);
		expect(
			result.items.find(({ segment }) => segment.target.id === check.id)?.segment,
		).toMatchObject({
			target,
			script: "Explain the delay.",
			status: "ready",
			audioUrl: "audio/task.mp3",
		});
		for (const marker of ["MODEL_SECRET", "HINT_SECRET", "PRIVATE_ANSWER"])
			expect(JSON.stringify(result.items)).not.toContain(marker);
		expect(
			resolve(
				readSource(
					source.replace("MODEL_SECRET", "MODEL_EDITED").replace("HINT_SECRET", "HINT_EDITED"),
				),
			).items.find(({ segment }) => segment.target.id === check.id)?.segment.status,
		).toBe("ready");
		expect(
			resolve(readSource(source.replace("Explain the delay.", "Explain a delay."))).items.find(
				({ segment }) => segment.target.id === check.id,
			)?.segment,
		).toMatchObject({ target, status: "needsReview", audioUrl: "audio/task.mp3" });
	});
	it("uncertainty normalization preserves source heading narration targets", () => {
		let next = 0;
		const read = readLesson(
			"# Page\n\n## Scene\n\n::: choice Pick {required}\n(x) First\n( ) Last\n:::\n",
			{
				ids: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
			},
		);
		expect(read.errors).toEqual([]);
		const heading = read.blocks.find((block) => block.type === "heading" && block.data.level === 2);
		if (!heading) throw new Error("Missing heading");
		heading.data.background = "assets/cover.png";
		const target = { id: heading.id, role: "title" as const };
		const resolved = resolveLessonNarration({
			read,
			courseId: id,
			lessonId: id,
			locale: "en",
			moduleDeck: {},
			digest: () => "a".repeat(64),
			sidecar: {
				version: 2,
				courseId: id,
				lessons: { [id]: { segments: [{ target, script: "Recorded title" }] } },
			},
		});
		expect(resolved.unlinked).toEqual([]);
		expect(
			resolved.pages.flatMap((page) => page.blocks).find((block) => block.type === "assessment")
				?.data._dontKnow,
		).toBe(false);
		expect(
			resolved.items.find((item) => item.segment.target.id === heading.id)?.segment,
		).toMatchObject({ target, script: "Recorded title" });
	});
	it("serializes then parses exactly, including disabled false and empty custom scripts", () => {
		const value = {
			version: 2 as const,
			courseId: id,
			lessons: {
				[id]: {
					enabled: false,
					defaults: { language: "fr", voice: "Maya", speed: 1 },
					segments: [
						{
							target: { id, role: "turn" as const },
							reviewedRevision: "a".repeat(64),
							script: "",
							disabled: false,
							audio: "audio/a.mp3",
							timings: "audio/a.vtt",
							duration: 4.2,
							audioFor: { script: "Café 😀", language: "fr", voice: "Maya", speed: 1 },
						},
					],
				},
			},
		};
		const bytes = serializeNarrationSidecarV2(value);
		expect(parseNarrationSidecarV2(bytes)).toEqual(value);
		expect(serializeNarrationSidecarV2(parseNarrationSidecarV2(bytes))).toBe(bytes);
		expect(parseNarrationSidecarV2(bytes)).toEqual(value);
	});
	it("refuses v1 in the grammar 4 path with the conversion command", () => {
		expect(() => parseNarrationSidecarV2("version: 1\nlessons: {}\n")).toThrow(
			/pnpm --dir \.\.\/praxity-converter --filter @praxity\/convert convert/,
		);
	});
	it.each(["role: invalid", "role: body\n          unexpected: true"])(
		"fails loudly on malformed targets: %s",
		(target) => {
			expect(() =>
				parseNarrationSidecarV2(
					`version: 2\ncourseId: ${id}\nlessons:\n  ${id}:\n    segments:\n      - target:\n          id: ${id}\n          ${target}\n`,
				),
			).toThrow();
		},
	);
});

it.each([
	{},
	{ script: "Words", language: "en", voice: "Maya", speed: 2 },
	{ script: "Words", language: "en", voice: "Maya", speed: 1, unknown: true },
])("rejects malformed acceptance provenance %j", (acceptedFor) => {
	const value = {
		version: 2,
		courseId: id,
		lessons: { [id]: { segments: [{ target: { id, role: "body" }, acceptedFor }] } },
	};
	expect(() => parseNarrationSidecarV2(JSON.stringify(value))).toThrow();
});
