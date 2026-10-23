import { createHash } from "node:crypto";
import { resolveDialogueSpeakers } from "@praxity/grammar";
import { describe, expect, it, vi } from "vitest";
import type { CourseExportInput, DesktopExportInput } from "../src/build";
import {
	createCourseContext,
	getPageDependencies,
	refreshCourseContext,
	SLICE_CONSUMERS,
} from "../src/preview/course-context";

function input(): DesktopExportInput {
	return {
		courseId: "context-course",
		frontmatter: { title: "Context course", lang: "en" },
		config: { completionThreshold: 0.8, requireKnowledgeChecks: true },
		locale: "en",
		viewerVersion: "test",
		resolvedAssets: new Map([
			["assets/roger.svg", new Uint8Array([1])],
			["assets/roger-new.svg", new Uint8Array([2])],
			["assets/photo.svg", new Uint8Array([3])],
		]),
		blocks: [
			{
				id: "page-5",
				type: "pageBreak",
				data: {
					id: "page-5",
					title: "Five",
					lessonId: "01",
					lessonTitle: "Lesson one",
					isFirstPageOfLesson: true,
				},
			},
			{
				id: "term",
				type: "text",
				data: { content: '<span data-tooltip-content="Old definition">Term</span>' },
			},
			{ id: "page-7", type: "pageBreak", data: { id: "page-7", title: "Seven" } },
			{
				id: "dialogue",
				type: "dialogue",
				data: {
					speakers: { roger: { name: "Roger", avatar: "assets/roger.svg" } },
					turns: [{ id: "turn", speaker: "roger", paragraphs: ["Hello"] }],
				},
			},
			{ id: "page-9", type: "pageBreak", data: { id: "page-9", title: "Nine" } },
			{
				id: "question",
				type: "assessment",
				data: {
					assessmentType: "choice",
					gradingMode: "none",
					stem: [{ id: "stem", type: "text", data: { content: "Question" } }],
					response: {
						type: "choice",
						selectionMode: "single",
						options: [{ id: "option", text: "Answer", isCorrect: true }],
					},
				},
			},
			{
				id: "page-10",
				type: "pageBreak",
				data: {
					id: "page-10",
					title: "Ten",
					lessonId: "02",
					lessonTitle: "Lesson two",
					isFirstPageOfLesson: true,
				},
			},
			{ id: "image", type: "image", data: { src: "assets/photo.svg", alt: "Photo" } },
		],
	};
}

function changedDigests(
	previous: Awaited<ReturnType<typeof createCourseContext>>,
	next: typeof previous,
) {
	return [...new Set([...Object.keys(previous.slices), ...Object.keys(next.slices)])]
		.filter(
			(key) =>
				previous.slices[key as keyof typeof previous.slices]?.digest !==
				next.slices[key as keyof typeof next.slices]?.digest,
		)
		.sort();
}

function block(course: DesktopExportInput, id: string) {
	const found = course.blocks.find((candidate) => candidate.id === id);
	if (!found) throw new Error(`Missing fixture block ${id}`);
	return found;
}

function invalidated(
	previous: Awaited<ReturnType<typeof createCourseContext>>,
	next: typeof previous,
	consumer: "fragments" | "shell",
) {
	return next.pages
		.filter(
			(page) =>
				JSON.stringify(getPageDependencies(previous, page.id, consumer)) !==
				JSON.stringify(getPageDependencies(next, page.id, consumer)),
		)
		.map((page) => page.id);
}

describe("P1 course context", () => {
	it.each([1, 256])("scans each page JSON once with %i available assets", async (count) => {
		const course: CourseExportInput = {
			id: "scan-course",
			title: "Scan course",
			sourceLocale: "en",
			content: [1, 2].map((id) => ({
				id: `scan-page-${id}`,
				title: `Page ${id}`,
				blocks: [{ id: `text-${id}`, type: "text", data: { content: "assets/0.svg" } }],
			})),
		};
		const assets = new Map(
			Array.from({ length: count }, (_, id) => [`assets/${id}.svg`, "digest"] as const),
		);
		const previous = await createCourseContext(course, assets);
		const scans = new Map<string, number>();
		const record = (serialized: string) => {
			if (!serialized.startsWith("{")) return;
			const value = JSON.parse(serialized);
			if (typeof value.id === "string" && value.id.startsWith("scan-page-"))
				scans.set(value.id, (scans.get(value.id) ?? 0) + 1);
		};
		// Count full-string searches at the platform seam, across both implementations.
		const includes = String.prototype.includes;
		const matchAll = String.prototype.matchAll;
		const includesSpy = vi.spyOn(String.prototype, "includes").mockImplementation(function (
			this: string,
			...args
		) {
			record(String(this));
			return includes.apply(this, args);
		});
		const matchAllSpy = vi.spyOn(String.prototype, "matchAll").mockImplementation(function (
			this: string,
			...args
		) {
			record(String(this));
			return matchAll.apply(this, args);
		});
		let next: typeof previous;
		try {
			next = await refreshCourseContext(previous, course, {});
		} finally {
			includesSpy.mockRestore();
			matchAllSpy.mockRestore();
		}
		expect(scans).toEqual(
			new Map([
				["scan-page-1", 1],
				["scan-page-2", 1],
			]),
		);
		expect(next.pages.map((page) => page.assetPaths)).toEqual([["assets/0.svg"], ["assets/0.svg"]]);
	});

	it.each([
		{
			text: "assets/a.png assets/a.pngx assets/a assets/ab.png",
			paths: ["assets/a", "assets/a.png", "a.png", "assets/ab.png", ""],
			expected: ["assets/a", "assets/a.png", "a.png", "assets/ab.png", ""],
		},
		{
			text: "plain a.aa [file] \\ é",
			paths: ["plain", "a", "a.aa", "[file]", "\\", "é"],
			expected: ["plain", "a", "a.aa", "[file]", "\\", "é"],
		},
		{
			text: "assets/abab/assets/ab",
			paths: ["assets/ab", "assets/abab", "ab", "abab", "b/assets"],
			expected: ["assets/ab", "assets/abab", "ab", "abab", "b/assets"],
		},
		{
			text: "assets/a+b[1].svg assets/é😀.svg assets/%C3%A9.svg assets/雪.svg",
			paths: [
				"assets/a+b[1].svg",
				"assets/é😀.svg",
				"assets/%C3%A9.svg",
				"assets/雪.svg",
				"assets/é.svg",
				"assets/aab1.svg",
			],
			expected: ["assets/a+b[1].svg", "assets/é😀.svg", "assets/%C3%A9.svg", "assets/雪.svg"],
		},
		{
			text: 'assets/a"b.svg assets/a\\b.svg assets/a\nb.svg assets/a%20b.svg',
			paths: [
				'assets/a"b.svg',
				'assets/a\\"b.svg',
				"assets/a\\b.svg",
				"assets/a\\\\b.svg",
				"assets/a\nb.svg",
				"assets/a\\nb.svg",
				"assets/a%20b.svg",
				"assets/a b.svg",
			],
			expected: ['assets/a\\"b.svg', "assets/a\\\\b.svg", "assets/a\\nb.svg", "assets/a%20b.svg"],
		},
		{ text: "assets/absent.svg", paths: [], expected: [] },
		{ text: "", paths: [""], expected: [""] },
	])("preserves literal JSON asset matches for $text", async ({ text, paths, expected }) => {
		const course: CourseExportInput = {
			id: "literal-course",
			title: "Literal course",
			sourceLocale: "en",
			content: [{ id: "literal-page", title: "Page", blocks: [], description: text }],
		};
		const assets = new Map(paths.map((name) => [name, "digest"]));
		const previous = await createCourseContext(course, assets);
		const next = await refreshCourseContext(previous, course, {});
		for (const context of [previous, next])
			expect(context.pages[0].assetPaths).toEqual([...expected].sort());
	});

	it("preserves desktop embedded asset packaging order on create and refresh", async () => {
		const course = input();
		course.blocks = [
			{ id: "page", type: "pageBreak", data: { id: "page", title: "Page" } },
			{ id: "text", type: "text", data: { content: "assets/abab/assets/ab assets/%C3%A9.svg é" } },
		];
		const paths = [
			"assets/ab",
			"assets/abab",
			"ab",
			"abab",
			"b/assets",
			"",
			"é",
			"assets/%C3%A9.svg",
			"absent",
		];
		course.resolvedAssets = new Map(paths.map((name) => [name, new Uint8Array([1])]));
		const expected = paths.slice(0, -1);
		const previous = await createCourseContext(course);
		const next = await refreshCourseContext(previous, course, {});
		for (const context of [previous, next]) {
			expect([...(context.referencedDesktopAssetPaths ?? [])]).toEqual(expected);
			expect(context.pages[0].assetPaths).toEqual([...expected].sort());
		}
	});

	it("a glossary definition changes only its lesson and glossary terms; other pages are reused", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		block(course, "term").data.content = '<span data-tooltip-content="New definition">Term</span>';
		const next = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(changedDigests(previous, next)).toEqual(["glossary.terms", "lesson:01"]);
		expect(next.pages[0].sourceDigest).not.toBe(previous.pages[0].sourceDigest);
		for (const id of ["page-7", "page-9", "page-10"]) {
			expect(next.pages.find((page) => page.id === id)?.blocks).toBe(
				previous.pages.find((page) => page.id === id)?.blocks,
			);
		}
		expect(SLICE_CONSUMERS["glossary.terms"]).toEqual({ "glossary-document": "all" });
	});

	it("a cast avatar changes only its speaker slice and reuses pages without that speaker", async () => {
		const course = input();
		course.blocks.push({
			id: "other-dialogue",
			type: "dialogue",
			data: {
				speakers: {
					roger: { name: "Roger", avatar: "assets/roger.svg" },
					alice: { name: "Alice" },
				},
				turns: [{ id: "other-turn", speaker: "alice", paragraphs: ["Hi"] }],
			},
		});
		course.blocks = resolveDialogueSpeakers(course.blocks).blocks;
		const previous = await createCourseContext(course);
		block(course, "dialogue").data.speakers = {
			roger: { name: "Roger", avatar: "assets/roger-new.svg" },
		};
		block(course, "other-dialogue").data.speakers = {
			roger: { name: "Roger", avatar: "assets/roger-new.svg" },
			alice: { name: "Alice" },
		};
		course.blocks = resolveDialogueSpeakers(course.blocks).blocks;
		const next = await refreshCourseContext(previous, course, { manifest: true });
		expect(changedDigests(previous, next)).toEqual(["cast:roger"]);
		expect(next.pages[1].blocks).not.toBe(previous.pages[1].blocks);
		expect(next.pages[0].blocks).toBe(previous.pages[0].blocks);
		expect(next.pages[3].blocks).toBe(previous.pages[3].blocks);
		expect(invalidated(previous, next, "fragments")).toEqual(["page-7"]);
		course.resolvedAssets.set("assets/roger-new.svg", new Uint8Array([7]));
		const asset = await refreshCourseContext(next, course, { assets: ["assets/roger-new.svg"] });
		expect(invalidated(next, asset, "fragments")).toEqual(["page-7"]);
	});

	it("host-captured digests refresh changed bytes even without an asset event", async () => {
		const course = input();
		const before = new Uint8Array([3]);
		const after = new Uint8Array([4]);
		const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
		course.resolvedAssetDigests = new Map([["assets/photo.svg", sha(before)]]);
		const previous = await createCourseContext(course);
		course.resolvedAssets.set("assets/photo.svg", after);
		course.resolvedAssetDigests = new Map([["assets/photo.svg", sha(after)]]);
		const refreshed = await refreshCourseContext(previous, course, {});
		expect(
			(refreshed.slices.assets?.value as Map<string, string> | undefined)?.get("assets/photo.svg"),
		).toBe(sha(after));
		expect(invalidated(previous, refreshed, "fragments")).toEqual(["page-10"]);
	});

	it("a theme accent changes theme.css without changing lesson, design or nav slices", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		course.frontmatter.design = {
			colorAccent: "#993366",
		} as DesktopExportInput["frontmatter"]["design"];
		const next = await refreshCourseContext(previous, course, { manifest: true });
		expect(changedDigests(previous, next)).toEqual(["theme.css"]);
		expect(SLICE_CONSUMERS["theme.css"]).toEqual({ shell: "all" });
	});

	it("grading changes assessments; editing a question's text changes only its lesson", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		block(course, "question").data.gradingMode = "exact";
		const graded = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(changedDigests(previous, graded)).toEqual(["assessments", "lesson:01"]);
		block(course, "question").data.stem = [
			{ id: "stem", type: "text", data: { content: "Changed question" } },
		];
		const edited = await refreshCourseContext(graded, course, { lessons: ["01"] });
		expect(changedDigests(graded, edited)).toEqual(["lesson:01"]);
	});

	it("lesson title provenance invalidates shells while preserving page fragment inputs", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		block(course, "page-5").data.lessonTitleIsFallback = true;
		const next = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(changedDigests(previous, next)).toEqual(["nav"]);
		expect(invalidated(previous, next, "fragments")).toEqual([]);
		expect(invalidated(previous, next, "shell")).toEqual(["page-5", "page-7", "page-9", "page-10"]);
	});

	it("moving a page changes nav without changing lesson slices or page fragment inputs", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		const moved = course.blocks.splice(2, 2);
		course.blocks.splice(4, 0, ...moved);
		const next = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(changedDigests(previous, next)).toEqual(["nav"]);
		expect(next.pages.map((page) => page.id)).toEqual(["page-5", "page-9", "page-7", "page-10"]);
		for (const page of next.pages) {
			expect(page.sourceDigest).toBe(
				previous.pages.find((candidate) => candidate.id === page.id)?.sourceDigest,
			);
			expect(page.blocks).toBe(
				previous.pages.find((candidate) => candidate.id === page.id)?.blocks,
			);
		}
	});

	it("replacing an image changes assets only and preserves page fragment inputs", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		course.resolvedAssets.set("assets/photo.svg", new Uint8Array([4]));
		const next = await refreshCourseContext(previous, course, { assets: ["assets/photo.svg"] });
		expect(changedDigests(previous, next)).toEqual(["assets"]);
		expect(next.pages[3].blocks).toBe(previous.pages[3].blocks);
	});

	it("an unchanged refresh changes no digest, isolates caller mutations, and advances the sequence", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		const next = await refreshCourseContext(previous, structuredClone(course), {});
		expect(changedDigests(previous, next)).toEqual([]);
		expect(next.seq).toBe(previous.seq + 1);
		expect(next.pages[0].blocks).toBe(previous.pages[0].blocks);
		block(course, "term").data.content = "Caller mutation";
		expect(previous.pages[0].blocks[0].data.content).toContain("Old definition");
	});

	it("structurally identical inputs with different property insertion order have identical digests", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		const term = block(course, "term");
		term.data = Object.fromEntries(Object.entries(term.data).reverse());
		const next = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(changedDigests(previous, next)).toEqual([]);
	});

	it("uses the host's admitted sequence and refuses an older refresh", async () => {
		const course = { ...input(), seq: 70 };
		const previous = await createCourseContext(course);
		expect(previous.seq).toBe(70);
		const next = await refreshCourseContext(previous, { ...course, seq: 73 }, {});
		expect(next.seq).toBe(73);
		await expect(refreshCourseContext(next, { ...course, seq: 72 }, {})).rejects.toThrow(
			"sequence",
		);
	});

	it("retired image treatments do not change context slices", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		course.frontmatter.design = {
			imageStyle: "grayscale",
		} as DesktopExportInput["frontmatter"]["design"];
		const next = await refreshCourseContext(previous, course, { manifest: true });
		// Course design decisions section 10 retires treatments; authored images stay unchanged.
		expect(changedDigests(previous, next)).toEqual([]);
	});

	it("a reading-time boundary changes nav using the published duration rule", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		block(course, "term").data.content += ` ${"word ".repeat(400)}`;
		const next = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(changedDigests(previous, next)).toEqual(["lesson:01", "nav"]);
	});

	it("fragment dependencies invalidate exactly the glossary page, speaker page or image page", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		block(course, "term").data.content = '<span data-tooltip-content="New definition">Term</span>';
		const glossary = await refreshCourseContext(previous, course, { lessons: ["01"] });
		expect(invalidated(previous, glossary, "fragments")).toEqual(["page-5"]);
		block(course, "dialogue").data.speakers = {
			roger: { name: "Roger", avatar: "assets/roger-new.svg" },
		};
		const cast = await refreshCourseContext(glossary, course, { manifest: true });
		expect(invalidated(glossary, cast, "fragments")).toEqual(["page-7"]);
		course.resolvedAssets.set("assets/photo.svg", new Uint8Array([9]));
		const asset = await refreshCourseContext(cast, course, { assets: ["assets/photo.svg"] });
		expect(invalidated(cast, asset, "fragments")).toEqual(["page-10"]);
	});

	it("theme, grading and page-order changes invalidate every shell; theme and order keep fragments", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		course.frontmatter.design = {
			colorAccent: "#993366",
		} as DesktopExportInput["frontmatter"]["design"];
		const theme = await refreshCourseContext(previous, course, { manifest: true });
		expect(invalidated(previous, theme, "shell")).toEqual([
			"page-5",
			"page-7",
			"page-9",
			"page-10",
		]);
		expect(invalidated(previous, theme, "fragments")).toEqual([]);
		block(course, "question").data.gradingMode = "exact";
		const graded = await refreshCourseContext(theme, course, { lessons: ["01"] });
		expect(invalidated(theme, graded, "shell")).toEqual(["page-5", "page-7", "page-9", "page-10"]);
		expect(invalidated(theme, graded, "fragments")).toEqual(["page-9"]);
		const moved = course.blocks.splice(2, 2);
		course.blocks.splice(4, 0, ...moved);
		const reordered = await refreshCourseContext(graded, course, { lessons: ["01"] });
		expect(invalidated(graded, reordered, "shell")).toEqual([
			"page-5",
			"page-9",
			"page-7",
			"page-10",
		]);
		expect(invalidated(graded, reordered, "fragments")).toEqual([]);
	});

	it("retired image treatments preserve fragments, and unknown page IDs refuse", async () => {
		const course = input();
		const previous = await createCourseContext(course);
		course.frontmatter.design = {
			imageStyle: "grayscale",
		} as DesktopExportInput["frontmatter"]["design"];
		const next = await refreshCourseContext(previous, course, { manifest: true });
		expect(invalidated(previous, next, "fragments")).toEqual([]);
		expect(next.pages.find((page) => page.id === "page-10")?.blocks).toBe(
			previous.pages.find((page) => page.id === "page-10")?.blocks,
		);
		expect(() => getPageDependencies(next, "absent", "fragments")).toThrow("page");
	});

	it("assets referenced by authored HTML invalidate their page", async () => {
		const course = input();
		block(course, "term").data.content = '<img src="assets/roger.svg" alt="Roger">';
		const previous = await createCourseContext(course);
		course.resolvedAssets.set("assets/roger.svg", new Uint8Array([8]));
		const next = await refreshCourseContext(previous, course, { assets: ["assets/roger.svg"] });
		expect(invalidated(previous, next, "fragments")).toEqual(["page-5", "page-7"]);
	});

	it("refuses refresh from another course instead of reusing its asset digests", async () => {
		const previous = await createCourseContext(input());
		await expect(
			refreshCourseContext(previous, { ...input(), courseId: "other-course" }, {}),
		).rejects.toThrow("course");
	});

	it("appearance mode and an empty knowledge-check gate still invalidate shell configuration", async () => {
		const course = input();
		course.blocks = course.blocks.filter((candidate) => candidate.id !== "question");
		course.config.requireKnowledgeChecks = false;
		const previous = await createCourseContext(course);
		course.config.requireKnowledgeChecks = true;
		const gated = await refreshCourseContext(previous, course, { manifest: true });
		expect(changedDigests(previous, gated)).toEqual(["assessments"]);
		expect(invalidated(previous, gated, "shell")).toHaveLength(4);
		course.frontmatter.design = {
			colorMode: "dark",
		} as DesktopExportInput["frontmatter"]["design"];
		const dark = await refreshCourseContext(gated, course, { manifest: true });
		expect(changedDigests(gated, dark)).toEqual(["theme.css"]);
		expect(invalidated(gated, dark, "shell")).toHaveLength(4);
		expect(invalidated(gated, dark, "fragments")).toEqual([]);
	});
});
