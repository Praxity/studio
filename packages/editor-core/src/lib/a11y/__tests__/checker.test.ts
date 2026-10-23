import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import {
	checkCourseAccessibility,
	checkDesignSystemAccessibility,
	type DesignSystemConfig,
} from "../checker";
import { buildA11yOccurrenceId } from "../occurrence-id";

describe("checkCourseAccessibility", () => {
	it.each(["", "---\ntitle: '  '\n---\n"])("warns once for an untitled lesson %j", (metadata) => {
		const read = readLesson(`${metadata}# First\n\nBody\n\n# Second\n\nMore\n`);
		const report = checkCourseAccessibility(
			[{ id: "draft.prax", title: "draft", blocks: read.blocks }],
			undefined,
			new Map([["draft.prax", { read }]]),
		);
		expect(report.issues.filter((issue) => issue.rule === "lesson-title")).toEqual([
			{
				severity: "minor",
				rule: "lesson-title",
				outcome: "failed",
				message: "Lesson has no title",
				pageId: "draft.prax",
				sourceLocation: "frontmatter.title",
			},
		]);
		const titled = readLesson("---\ntitle: Keep this title\n---\n# First\n\nBody\n");
		expect(
			checkCourseAccessibility(
				[{ id: "titled.prax", title: "Keep this title", blocks: titled.blocks }],
				undefined,
				new Map([["titled.prax", { read: titled }]]),
			).issues.filter((issue) => issue.rule === "lesson-title"),
		).toEqual([]);
	});
	it.each([undefined, "", " \t\n ", 42])(
		"flags a forward gate with missing or blank reason %j",
		(reason) => {
			const report = checkCourseAccessibility([
				{
					id: "p1",
					title: "Safety check",
					blocks: [
						{
							id: "gate",
							type: "logic",
							data: {
								actions: [
									{ type: "show", targets: ["help"] },
									{ type: "disableCompletion", reason },
								],
							},
						},
					],
				},
			]);
			expect(report.issues.filter((issue) => issue.rule === "completion-gate-reason")).toEqual([
				expect.objectContaining({
					severity: "moderate",
					outcome: "failed",
					blockId: "gate",
					pageId: "p1",
					sourceLocation: "data.actions[1].reason",
				}),
			]);
		},
	);

	it("accepts an authored forward-gate reason and older logic without a gate", () => {
		for (const actions of [
			undefined,
			[],
			[null, { type: "show" }],
			[{ type: "disableCompletion", reason: "Complete the safety check before continuing." }],
		]) {
			const report = checkCourseAccessibility([
				{
					id: "p1",
					title: "Safety check",
					blocks: [{ id: "logic", type: "logic", data: { actions } }],
				},
			]);
			expect(report.issues.filter((issue) => issue.rule === "completion-gate-reason")).toEqual([]);
		}
	});

	it("checks nested forward gates and keeps duplicate gates independently identifiable", () => {
		const report = checkCourseAccessibility([
			{
				id: "p1",
				title: "Safety check",
				blocks: [
					{
						id: "tabs",
						type: "tabs",
						data: {
							items: [
								{
									title: "Check",
									children: [
										{
											id: "gate",
											type: "logic",
											data: {
												actions: [
													{ type: "disableCompletion" },
													{ type: "disableCompletion", reason: "" },
												],
											},
										},
									],
								},
							],
						},
					},
				],
			},
		]);
		const issues = report.issues.filter((issue) => issue.rule === "completion-gate-reason");
		expect(issues.map((issue) => issue.sourceLocation)).toEqual([
			"data.actions[0].reason",
			"data.actions[1].reason",
		]);
		expect(new Set(issues.map(buildA11yOccurrenceId)).size).toBe(2);
	});

	it("keeps repeated findings in one block independently identifiable", () => {
		const longHeading = "long heading ".repeat(11);
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Repeated findings",
				blocks: [
					{ id: "h1", type: "heading", data: { level: 2, content: "Start" } },
					{
						id: "links-1",
						type: "text",
						data: {
							content:
								'<p><a href="/a">First destination</a> <a href="/b">Second destination</a></p>',
						},
					},
					{
						id: "content",
						type: "text",
						data: {
							content: `<h4>${longHeading}one</h4><h6>${longHeading}two</h6><p>NASA and HTML. <a href="/a">First reference</a> <a href="/b">Second reference</a></p>`,
						},
					},
				],
			},
		];

		const ids = checkCourseAccessibility(pages).issues.map(buildA11yOccurrenceId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("returns clean report for accessible content", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Welcome",
				blocks: [{ id: "b1", type: "text", data: { content: "<p>Hello</p>" } }],
			},
		];

		const report = checkCourseAccessibility(pages);
		expect(report.failed).toBe(0);
		expect(report.cantTell).toBe(0);
	});

	it("flags missing image alt text as critical", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Images",
				blocks: [
					{
						id: "b1",
						type: "image",
						data: { src: "/photo.jpg", altText: "", decorative: false },
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const altIssue = report.issues.find((i) => i.rule === "image-alt");
		expect(altIssue).toBeDefined();
		expect(altIssue?.severity).toBe("critical");
	});

	// The v3 parser emits alt text as `data.alt`; only the editor block shape uses
	// `data.altText`. Reading one key and not the other silently reported every
	// authored image as missing alt text, which the publish pre-flight then blocked on.
	it("accepts alt text under the parser's `alt` key", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Images",
				blocks: [
					{
						id: "b1",
						type: "image",
						data: { src: "/photo.jpg", alt: "A clear path through a blue landscape" },
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		expect(report.issues.find((i) => i.rule === "image-alt")).toBeUndefined();
	});

	it("applies alt-text quality rules to the parser's `alt` key", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Images",
				blocks: [
					{ id: "b1", type: "image", data: { src: "/a.jpg", alt: "image" } },
					{ id: "b2", type: "image", data: { src: "/b.jpg", alt: "screenshot-2024.png" } },
					{ id: "b3", type: "image", data: { src: "/c.jpg", alt: "x".repeat(130) } },
				],
			},
		];

		const rules = checkCourseAccessibility(pages).issues.map((i) => i.rule);
		expect(rules).toContain("image-alt-quality");
		expect(rules).toContain("image-alt-length");
	});

	it("flags duplicate alt text across the parser's `alt` key", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Images",
				blocks: [
					{ id: "b1", type: "image", data: { src: "/a.jpg", alt: "The same description" } },
					{ id: "b2", type: "image", data: { src: "/b.jpg", alt: "The same description" } },
				],
			},
		];

		const rules = checkCourseAccessibility(pages).issues.map((i) => i.rule);
		expect(rules).toContain("repeated-alt-text");
	});

	it("allows decorative images without alt text", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Decorative",
				blocks: [
					{
						id: "b1",
						type: "image",
						data: { src: "/bg.jpg", altText: "", decorative: true },
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const altIssue = report.issues.find((i) => i.rule === "image-alt");
		expect(altIssue).toBeUndefined();
	});

	describe("nested image alternatives", () => {
		const paths = ["image", "card front", "card back", "tabs", "accordion", "sequence", "columns"];

		it.each(paths)("checks decorative and informative images in %s", (path) => {
			for (const flags of [
				{ data: { decorative: true }, exempt: true },
				{ data: {}, exempt: false },
				{ data: { decorative: false }, exempt: false },
				{ data: { decorative: "true" }, exempt: false },
				{ data: {}, a11y: { decorative: true }, exempt: true },
				{ data: { alt: "Safety equipment" }, exempt: true },
				{ data: { altText: "Safety equipment" }, exempt: true },
			]) {
				const image: PraxityBlock = {
					id: "nested-image",
					type: "image",
					data: { src: "/picture.png", ...flags.data },
					a11y: flags.a11y,
				};
				const block: PraxityBlock =
					path === "image"
						? image
						: {
								id: "container",
								type: (path.startsWith("card") ? "card" : path) as PraxityBlock["type"],
								data: {
									items: path.startsWith("card")
										? [{ front: [], back: [], [path === "card front" ? "front" : "back"]: [image] }]
										: [{ label: "Section", children: [image] }],
								},
							};
				const issues = checkCourseAccessibility([
					{ id: "p1", title: "Images", blocks: [block] },
				]).issues.filter((issue) => issue.rule === "image-alt");
				expect(issues, JSON.stringify(flags)).toHaveLength(flags.exempt ? 0 : 1);
				if (!flags.exempt)
					expect(issues[0]).toMatchObject({
						blockId: image.id,
						severity: "critical",
						outcome: "failed",
					});
			}
		});

		it.each([
			["imageComparison", "beforeImage"],
			["imageComparison", "afterImage"],
			["comparison", "beforeImage"],
			["comparison", "afterImage"],
			["comparison", "images"],
			["hotgraphic", "background"],
			["labeledGraphic", "background"],
			["hotspot", "background"],
		])("checks decorative and informative %s %s images", (type, field) => {
			for (const decorative of [undefined, false, true, "true"]) {
				const image = { src: "/picture.png", decorative };
				const data =
					field === "background"
						? { image: "/picture.png", imageSrc: "/picture.png", decorative }
						: field === "images"
							? { images: [image] }
							: { [field]: image };
				const issues = checkCourseAccessibility([
					{
						id: "p1",
						title: "Images",
						blocks: [{ id: "b1", type: type as PraxityBlock["type"], data }],
					},
				]).issues.filter((issue) =>
					["image-alt", "hotgraphic-alt", "labeled-graphic-alt", "hotspot-image-alt"].includes(
						issue.rule,
					),
				);
				expect(issues, String(decorative)).toHaveLength(decorative === true ? 0 : 1);
				if (decorative !== true)
					expect(issues[0]).toMatchObject({
						blockId: "b1",
						severity: "critical",
						outcome: "failed",
					});
			}
		});
	});

	it("honors decoration on legacy hotspot assessments", () => {
		for (const flags of [
			{ data: { decorative: true }, exempt: true },
			{ data: {}, a11y: { decorative: true }, exempt: true },
			{ data: {}, exempt: false },
			{ data: { decorative: false }, exempt: false },
			{ data: { decorative: "true" }, exempt: false },
			{ data: {}, imageAlt: "Safety equipment", exempt: true },
		]) {
			const issues = checkCourseAccessibility([
				{
					id: "p1",
					title: "Hotspot assessment",
					blocks: [
						{
							id: "hotspot-assessment",
							type: "assessment",
							data: {
								...flags.data,
								response: { type: "hotspot", image: "/picture.png", imageAlt: flags.imageAlt },
							},
							a11y: flags.a11y,
						},
					],
				},
			]).issues.filter((issue) => issue.rule === "hotspot-image-alt");
			expect(issues, JSON.stringify(flags)).toHaveLength(flags.exempt ? 0 : 1);
			if (!flags.exempt)
				expect(issues[0]).toMatchObject({ severity: "critical", blockId: "hotspot-assessment" });
		}
	});

	it("flags poor alt text quality", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Images",
				blocks: [
					{
						id: "b1",
						type: "image",
						data: { src: "/photo.jpg", altText: "image", decorative: false },
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const qualityIssue = report.issues.find((i) => i.rule === "image-alt-quality");
		expect(qualityIssue).toBeDefined();
	});

	it("flags missing media transcript", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Video",
				blocks: [
					{
						id: "b1",
						type: "video",
						data: { src: "/video.mp4", transcript: "" },
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const issue = report.issues.find((i) => i.rule === "media-transcript");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("serious");
	});

	it("flags MCQ with no correct answer (legacy block type)", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Quiz",
				blocks: [
					{
						id: "b1",
						type: "mcq" as PraxityPage["blocks"][number]["type"],
						data: {
							question: "What is 2+2?",
							options: [
								{ text: "3", isCorrect: false },
								{ text: "5", isCorrect: false },
							],
						},
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const issue = report.issues.find((i) => i.rule === "mcq-correct-answer");
		expect(issue).toBeDefined();
	});

	it("flags heading hierarchy jumps", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Content",
				blocks: [
					{
						id: "b1",
						type: "text",
						data: { content: "<h2>Section</h2><h4>Subsection</h4>" },
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const issue = report.issues.find((i) => i.rule === "heading-hierarchy");
		expect(issue).toBeDefined();
	});

	it("flags empty pages", () => {
		const pages: PraxityPage[] = [{ id: "p1", title: "Empty Page", blocks: [] }];

		const report = checkCourseAccessibility(pages);
		const issue = report.issues.find((i) => i.rule === "empty-page");
		expect(issue).toBeDefined();
	});

	it("flags missing page title", () => {
		const pages: PraxityPage[] = [
			{ id: "p1", title: "", blocks: [{ id: "b1", type: "text", data: { content: "hi" } }] },
		];

		const report = checkCourseAccessibility(pages);
		const issue = report.issues.find((i) => i.rule === "page-title");
		expect(issue).toBeDefined();
	});

	it("flags narrative slides with missing image alt (legacy block type)", () => {
		const pages: PraxityPage[] = [
			{
				id: "p1",
				title: "Narrative",
				blocks: [
					{
						id: "b1",
						type: "narrative" as PraxityPage["blocks"][number]["type"],
						data: {
							items: [
								{ id: "1", title: "Slide", body: "text", imageSrc: "/img.jpg", imageAlt: "" },
							],
						},
					},
				],
			},
		];

		const report = checkCourseAccessibility(pages);
		const issue = report.issues.find((i) => i.rule === "narrative-image-alt");
		expect(issue).toBeDefined();
		expect(issue?.severity).toBe("critical");
	});

	// ============================================================
	// New rule tests
	// ============================================================

	describe("link-text-quality", () => {
		it("flags generic link text in TipTap content", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: '<p><a href="https://example.com">click here</a></p>' },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags raw URL as link text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content:
									'<p><a href="https://example.com">https://example.com/very/long/path</a></p>',
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "link-text-quality" && i.message.includes("raw URL"),
			);
			expect(issue).toBeDefined();
		});

		it("flags generic button block text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Buttons",
					blocks: [
						{
							id: "b1",
							type: "button",
							data: { text: "Click here", href: "https://example.com" },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality");
			expect(issue).toBeDefined();
		});

		it("flags generic download button text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Downloads",
					blocks: [
						{
							id: "b1",
							type: "document",
							data: { title: "Download", display: "button", url: "/file.pdf" },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality");
			expect(issue).toBeDefined();
		});

		it("does not flag descriptive link text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content:
									'<p><a href="https://example.com">View the accessibility guidelines</a></p>',
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality");
			expect(issue).toBeUndefined();
		});

		it("flags generic link text in bookmark display mode", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Downloads",
					blocks: [
						{
							id: "b1",
							type: "document",
							data: { title: "Click here", display: "bookmark", url: "/file.pdf" },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("Click here");
		});

		it("flags document with no title", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Downloads",
					blocks: [
						{
							id: "b1",
							type: "document",
							data: { url: "/file.pdf" },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality" && i.blockId === "b1");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag unconfigured document with no URL", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Downloads",
					blocks: [
						{
							id: "b1",
							type: "document",
							data: {},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality" && i.blockId === "b1");
			expect(issue).toBeUndefined();
		});

		it("does not flag document with descriptive title", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Downloads",
					blocks: [
						{
							id: "b1",
							type: "document",
							data: { title: "Course syllabus", url: "/syllabus.pdf" },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "link-text-quality" && i.blockId === "b1");
			expect(issue).toBeUndefined();
		});
	});

	describe("empty-link", () => {
		it("flags links with no text content", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: '<p><a href="https://example.com"></a></p>' },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "empty-link");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});
	});

	describe("image-alt-length", () => {
		it("flags alt text longer than 125 characters", () => {
			const longAlt = "A".repeat(130);
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{
							id: "b1",
							type: "image",
							data: { src: "/photo.jpg", altText: longAlt, decorative: false },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "image-alt-length");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
			expect(issue?.blockId).toBe("b1");
		});

		it("does not flag alt text under 125 characters", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{
							id: "b1",
							type: "image",
							data: {
								src: "/photo.jpg",
								altText: "A student working on a laptop in a library",
								decorative: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "image-alt-length");
			expect(issue).toBeUndefined();
		});
	});

	describe("image-alt-quality (filename)", () => {
		it("flags alt text that looks like a filename", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{
							id: "b1",
							type: "image",
							data: { src: "/photo.jpg", altText: "IMG_2045.jpg", decorative: false },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "image-alt-quality" && i.message.includes("filename"),
			);
			expect(issue).toBeDefined();
		});
	});

	describe("table-headers", () => {
		it("flags table with no header row or column", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "table",
							data: {
								headers: ["A", "B"],
								rows: [["1", "2"]],
								highlightHeaderRow: false,
								highlightHeaderCol: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "table-headers");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("does not flag table with header row enabled", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "table",
							data: {
								headers: ["A", "B"],
								rows: [["1", "2"]],
								highlightHeaderRow: true,
								caption: "Results table",
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "table-headers");
			expect(issue).toBeUndefined();
		});
	});

	describe("table-caption", () => {
		it("flags table with missing caption", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "table",
							data: {
								headers: ["A", "B"],
								rows: [["1", "2"]],
								highlightHeaderRow: true,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "table-caption");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});
	});

	describe("container-single-item", () => {
		it("flags tabs block with only 1 tab", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tabs",
					blocks: [
						{
							id: "b1",
							type: "tabs",
							data: {
								items: [{ id: "t1", label: "Only tab", children: [] }],
								trackCompletion: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "container-single-item");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("Tabs");
		});

		it("flags accordion with only 1 section", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Accordion",
					blocks: [
						{
							id: "b1",
							type: "accordion",
							data: {
								items: [{ id: "a1", label: "Only section", children: [] }],
								trackCompletion: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "container-single-item");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("Accordion");
		});

		it("does not flag tabs with 2+ items", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tabs",
					blocks: [
						{
							id: "b1",
							type: "tabs",
							data: {
								items: [
									{ id: "t1", label: "Tab 1", children: [] },
									{ id: "t2", label: "Tab 2", children: [] },
								],
								trackCompletion: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "container-single-item");
			expect(issue).toBeUndefined();
		});
	});

	describe("container-too-many-items", () => {
		it("flags tabs block with more than 6 tabs", () => {
			const items = Array.from({ length: 8 }, (_, i) => ({
				id: `t${i}`,
				label: `Tab ${i + 1}`,
				children: [],
			}));
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tabs",
					blocks: [
						{
							id: "b1",
							type: "tabs",
							data: { items, trackCompletion: false },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "container-too-many-items");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("8 tabs");
		});

		it("does not flag 6 or fewer tabs", () => {
			const items = Array.from({ length: 5 }, (_, i) => ({
				id: `t${i}`,
				label: `Tab ${i + 1}`,
				children: [],
			}));
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tabs",
					blocks: [
						{
							id: "b1",
							type: "tabs",
							data: { items, trackCompletion: false },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "container-too-many-items");
			expect(issue).toBeUndefined();
		});
	});

	describe("columns-too-many", () => {
		it("flags 4+ column layout", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Layout",
					blocks: [
						{
							id: "b1",
							type: "columns",
							data: {
								items: [
									{ id: "c1", width: 0.25, children: [{ id: "x1", type: "text", data: {} }] },
									{ id: "c2", width: 0.25, children: [{ id: "x2", type: "text", data: {} }] },
									{ id: "c3", width: 0.25, children: [{ id: "x3", type: "text", data: {} }] },
									{ id: "c4", width: 0.25, children: [{ id: "x4", type: "text", data: {} }] },
								],
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "columns-too-many");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("flags 3 columns with substantial content", () => {
			const makeChildren = (count: number) =>
				Array.from({ length: count }, (_, i) => ({
					id: `x${i}`,
					type: "text" as const,
					data: { content: "<p>text</p>" },
				}));

			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Layout",
					blocks: [
						{
							id: "b1",
							type: "columns",
							data: {
								items: [
									{ id: "c1", width: 0.33, children: makeChildren(4) },
									{ id: "c2", width: 0.33, children: makeChildren(4) },
									{ id: "c3", width: 0.34, children: makeChildren(4) },
								],
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "columns-too-many");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
		});

		it("does not flag 2 columns", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Layout",
					blocks: [
						{
							id: "b1",
							type: "columns",
							data: {
								items: [
									{ id: "c1", width: 0.5, children: [{ id: "x1", type: "text", data: {} }] },
									{ id: "c2", width: 0.5, children: [{ id: "x2", type: "text", data: {} }] },
								],
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "columns-too-many");
			expect(issue).toBeUndefined();
		});
	});

	describe("decorative-image-overuse", () => {
		it("flags when >50% of images are decorative (4+ images)", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{ id: "b1", type: "image", data: { src: "/1.jpg", decorative: true } },
						{ id: "b2", type: "image", data: { src: "/2.jpg", decorative: true } },
						{ id: "b3", type: "image", data: { src: "/3.jpg", decorative: true } },
						{
							id: "b4",
							type: "image",
							data: { src: "/4.jpg", altText: "Chart", decorative: false },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "decorative-image-overuse");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag with few images", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{ id: "b1", type: "image", data: { src: "/1.jpg", decorative: true } },
						{ id: "b2", type: "image", data: { src: "/2.jpg", decorative: true } },
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "decorative-image-overuse");
			expect(issue).toBeUndefined();
		});
	});

	describe("duplicate-heading", () => {
		it("flags identical headings on same page", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{ id: "b1", type: "text", data: { content: "<h2>Overview</h2><p>text</p>" } },
						{ id: "b2", type: "text", data: { content: "<h2>Overview</h2><p>more</p>" } },
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-heading");
			expect(issue).toBeDefined();
		});

		it("flags duplicate heading blocks (not just text blocks)", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Overview", level: 2 },
						},
						{
							id: "b2",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Overview", level: 2 },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-heading");
			expect(issue).toBeDefined();
		});
	});

	describe("consecutive-headings", () => {
		it("flags back-to-back heading-only blocks", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{ id: "b1", type: "text", data: { content: "<h2>Section A</h2>" } },
						{ id: "b2", type: "text", data: { content: "<h3>Subsection</h3>" } },
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "consecutive-headings");
			expect(issue).toBeDefined();
		});

		it("flags consecutive heading blocks (not just text blocks)", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Section A", level: 2 },
						},
						{
							id: "b2",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Section B", level: 3 },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "consecutive-headings");
			expect(issue).toBeDefined();
		});

		it("does not flag heading followed by content", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: "<h2>Section A</h2><p>Some body text here.</p>" },
						},
						{ id: "b2", type: "text", data: { content: "<h3>Subsection</h3>" } },
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "consecutive-headings");
			expect(issue).toBeUndefined();
		});
	});

	describe("heading-hierarchy (deep traversal)", () => {
		it("accepts an authored H1, H2, and nested H3 outline", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Observatory workshop",
					blocks: [
						{
							id: "h1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Preparing the observatory", level: 1 },
						},
						{
							id: "h2",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Tonight's observing schedule", level: 2 },
						},
						{
							id: "columns",
							type: "columns",
							data: {
								items: [
									{
										id: "column",
										children: [
											{
												id: "h3",
												type: "heading" as PraxityBlock["type"],
												data: { content: "Telescope alignment", level: 3 },
											},
										],
									},
								],
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			expect(report.issues.some((issue) => issue.rule === "heading-hierarchy")).toBe(false);
		});

		it("detects heading hierarchy jump inside tabs container", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tabs with headings",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Section", level: 2 },
						},
						{
							id: "b2",
							type: "tabs",
							data: {
								items: [
									{
										id: "t1",
										label: "Tab 1",
										children: [
											{
												id: "b3",
												type: "heading" as PraxityBlock["type"],
												data: { content: "Nested heading", level: 2 },
											},
										],
									},
								],
								trackCompletion: false,
							},
						},
					],
				},
			];

			// H2 (heading block) → H2 inside tabs — no jump, should pass
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-hierarchy");
			expect(issue).toBeUndefined();
		});

		it("detects heading hierarchy jump from heading block to deeper heading block inside columns", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Columns with headings",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Top level", level: 1 },
						},
						{
							id: "b2",
							type: "columns",
							data: {
								items: [
									{
										id: "c1",
										width: 0.5,
										children: [
											{
												id: "b3",
												type: "heading" as PraxityBlock["type"],
												data: { content: "Column heading", level: 3 },
											},
										],
									},
								],
							},
						},
					],
				},
			];

			// H1 → H3 (skips H2) — should flag
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-hierarchy");
			expect(issue).toBeDefined();
		});

		it("detects heading hierarchy jump with heading blocks at top level", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Heading blocks",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Section", level: 1 },
						},
						{
							id: "b2",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Subsection", level: 3 },
						},
					],
				},
			];

			// H1 → H3 via heading blocks — should flag
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-hierarchy");
			expect(issue).toBeDefined();
		});

		it("detects heading in assessment stem", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Assessment headings",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "Quiz Section", level: 2 },
						},
						{
							id: "b2",
							type: "assessment",
							data: {
								assessmentType: "choice",
								stem: [
									{
										id: "s1",
										type: "text",
										data: { content: "<h4>Question context</h4>" },
									},
								],
								response: { type: "choice" },
								feedback: { correct: [], incorrect: [] },
							},
						},
					],
				},
			];

			// H2 (heading block) → H4 in stem (skips H3) — should flag
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-hierarchy");
			expect(issue).toBeDefined();
		});
	});

	describe("repeated-alt-text", () => {
		it("flags multiple images with identical alt text on same page", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{
							id: "b1",
							type: "image",
							data: { src: "/1.jpg", altText: "Team photo", decorative: false },
						},
						{
							id: "b2",
							type: "image",
							data: { src: "/2.jpg", altText: "Team photo", decorative: false },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "repeated-alt-text");
			expect(issue).toBeDefined();
		});
	});

	describe("media-audio-description", () => {
		it("flags video blocks missing audio description track", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Test",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: {
								source: { type: "direct", url: "/test.mp4" },
								captionTracks: [
									{
										language: "en",
										label: "English",
										src: "/en.vtt",
										kind: "captions",
									},
								],
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "media-audio-description");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
		});

		it("does not flag video blocks that have an audio description track", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Test",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: {
								source: { type: "direct", url: "/test.mp4" },
								captionTracks: [
									{
										language: "en",
										label: "English",
										src: "/en.vtt",
										kind: "captions",
									},
									{
										language: "en",
										label: "English AD",
										src: "/en-ad.vtt",
										kind: "descriptions",
									},
								],
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "media-audio-description");
			expect(issue).toBeUndefined();
		});
	});

	describe("hotspot-image-alt", () => {
		it("flags hotspot assessment without image alt text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Hotspot",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "hotspot",
								response: {
									type: "hotspot",
									image: "/map.jpg",
									imageAlt: "",
									hotspots: [],
								},
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "hotspot-image-alt");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("critical");
		});

		it("does not flag hotspot with alt text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Hotspot",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "hotspot",
								response: {
									type: "hotspot",
									image: "/map.jpg",
									imageAlt: "World map showing major continents",
									hotspots: [],
								},
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "hotspot-image-alt");
			expect(issue).toBeUndefined();
		});
	});

	describe("code block rules", () => {
		it("fires code-block-empty on empty code block", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Code Page",
					blocks: [
						{
							id: "b1",
							type: "code" as PraxityBlock["type"],
							data: { code: "", language: "javascript" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "code-block-empty");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does NOT fire code-block-empty on code block with content", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Code Page",
					blocks: [
						{
							id: "b1",
							type: "code" as PraxityBlock["type"],
							data: { code: "console.log('hi');", language: "javascript" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "code-block-empty");
			expect(issue).toBeUndefined();
		});
	});

	describe("heading-length", () => {
		it("flags heading block content exceeding 120 characters", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "A".repeat(125), level: 2 },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-length");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
		});

		it("flags long heading in text block HTML", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: `<h2>${"B".repeat(125)}</h2>` },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-length");
			expect(issue).toBeDefined();
		});

		it("flags long heading inside container children", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "tabs",
							data: {
								items: [
									{
										id: "t1",
										label: "Tab 1",
										children: [
											{
												id: "b2",
												type: "heading" as PraxityBlock["type"],
												data: { content: "C".repeat(125), level: 2 },
											},
										],
									},
								],
								trackCompletion: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-length");
			expect(issue).toBeDefined();
		});

		it("does not flag heading at or under 120 characters", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "heading" as PraxityBlock["type"],
							data: { content: "A".repeat(120), level: 2 },
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "heading-length");
			expect(issue).toBeUndefined();
		});
	});

	describe("duplicate-links", () => {
		it("flags duplicate href in text blocks", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/page">First link</a></p>',
							},
						},
						{
							id: "b2",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/page">Second link</a></p>',
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-links");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
		});

		it("flags duplicate link across text and button blocks", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/guide">Read guide</a></p>',
							},
						},
						{
							id: "b2",
							type: "button" as PraxityBlock["type"],
							data: {
								text: "Open guide",
								href: "https://example.com/guide",
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-links");
			expect(issue).toBeDefined();
		});

		it("flags duplicate link with document block", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Downloads",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/file.pdf">Download PDF</a></p>',
							},
						},
						{
							id: "b2",
							type: "document" as PraxityBlock["type"],
							data: {
								title: "PDF File",
								url: "https://example.com/file.pdf",
								display: "button",
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-links");
			expect(issue).toBeDefined();
		});

		it("flags duplicate links inside containers", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tabs",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/ref">Reference</a></p>',
							},
						},
						{
							id: "b2",
							type: "tabs",
							data: {
								items: [
									{
										id: "t1",
										label: "Tab",
										children: [
											{
												id: "b3",
												type: "text",
												data: {
													content: '<p><a href="https://example.com/ref">Same reference</a></p>',
												},
											},
										],
									},
								],
								trackCompletion: false,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-links");
			expect(issue).toBeDefined();
		});

		it("does not flag unique links", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Links",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/page1">Page 1</a></p>',
							},
						},
						{
							id: "b2",
							type: "text",
							data: {
								content: '<p><a href="https://example.com/page2">Page 2</a></p>',
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "duplicate-links");
			expect(issue).toBeUndefined();
		});
	});

	// ============================================================
	// New rules (17 additional)
	// ============================================================

	describe("assessment-format-hint", () => {
		it("flags text input with no placeholder or hint", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "textInput" as PraxityBlock["type"],
							data: { question: "What year?", correctAnswers: ["2025"], placeholder: "", hint: "" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-format-hint");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag text input with placeholder", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "textInput" as PraxityBlock["type"],
							data: { question: "What year?", correctAnswers: ["2025"], placeholder: "e.g., 2025" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-format-hint");
			expect(issue).toBeUndefined();
		});
	});

	describe("video-captions", () => {
		it("flags video with src but no captions", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: { src: "/intro.mp4", transcript: "Full transcript here." },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "video-captions");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("does not flag video with captions", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: {
								src: "/intro.mp4",
								captionsSrc: "/intro.vtt",
								transcript: "Full transcript.",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "video-captions");
			expect(issue).toBeUndefined();
		});

		it("accepts the timed track rendered for a direct video", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: {
								src: "/assets/intro.mp4",
								caption: "Visible description",
								captionTracks: [
									{ kind: "captions", language: "und", label: "", src: "/assets/intro.en.vtt" },
								],
							},
						},
					],
				},
			];
			expect(
				checkCourseAccessibility(pages).issues.some((issue) => issue.rule === "video-captions"),
			).toBe(false);
		});

		it.each([
			[],
			[null],
			[{ kind: "captions", src: "javascript:evil.vtt" }],
			[{ kind: "captions", src: "/assets/../private.vtt" }],
			[{ kind: "descriptions", src: "/assets/description.vtt" }],
		])("still flags an unusable track collection %j", (captionTracks) => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: {
								src: "/assets/intro.mp4",
								caption: "Visible description",
								captionTracks,
							},
						},
					],
				},
			];
			expect(
				checkCourseAccessibility(pages).issues.some((issue) => issue.rule === "video-captions"),
			).toBe(true);
		});

		it("checks a direct video stored as a typed source", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: { source: { type: "url", src: "/assets/intro.mp4" }, captionTracks: [null] },
						},
					],
				},
			];
			expect(
				checkCourseAccessibility(pages).issues.some((issue) => issue.rule === "video-captions"),
			).toBe(true);
		});
	});

	describe("audio-transcript-quality", () => {
		it("flags audio with short transcript", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Audio",
					blocks: [
						{
							id: "b1",
							type: "audio",
							data: { src: "/podcast.mp3", transcript: "TODO: add transcript" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "audio-transcript-quality");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag audio with substantial transcript", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Audio",
					blocks: [
						{
							id: "b1",
							type: "audio",
							data: {
								src: "/podcast.mp3",
								transcript:
									"In this episode we discuss the importance of accessibility in eLearning design and how to implement WCAG standards.",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "audio-transcript-quality");
			expect(issue).toBeUndefined();
		});
	});

	describe("card-both-sides", () => {
		it("flags card with empty back side, case 1", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								layout: "single",
								items: [
									{
										front: [{ id: "t1", type: "text", data: { content: "<p>What is a11y?</p>" } }],
										back: [],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "card-both-sides" && i.message.includes("back-side"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags card with front image missing alt", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								layout: "single",
								items: [
									{
										front: [{ id: "i1", type: "image", data: { src: "/card.jpg", alt: "" } }],
										back: [{ id: "t1", type: "text", data: { content: "<p>Answer</p>" } }],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "image-alt" && i.message.includes("alt text"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("critical");
		});

		it("does not flag complete card", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								layout: "single",
								items: [
									{
										front: [{ id: "t1", type: "text", data: { content: "<p>What is a11y?</p>" } }],
										back: [{ id: "t2", type: "text", data: { content: "<p>Accessibility</p>" } }],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "card-both-sides");
			expect(issue).toBeUndefined();
		});

		it("flags card with empty back side, case 2", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								layout: "single",
								items: [
									{
										front: [{ id: "t1", type: "text", data: { content: "<p>What is a11y?</p>" } }],
										back: [],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "card-both-sides" && i.message.includes("back-side"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("does not flag card with empty back when layout is grid", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								layout: "grid",
								items: [
									{
										front: [{ id: "t1", type: "text", data: { content: "<p>Metric</p>" } }],
										back: [],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "card-both-sides" && i.message.includes("back-side"),
			);
			expect(issue).toBeUndefined();
		});

		it("does not flag card with empty back when layout is masonry", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								layout: "masonry",
								items: [
									{
										front: [{ id: "t1", type: "text", data: { content: "<p>Metric</p>" } }],
										back: [],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "card-both-sides" && i.message.includes("back-side"),
			);
			expect(issue).toBeUndefined();
		});

		it("flags card front image block missing alt", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Cards",
					blocks: [
						{
							id: "b1",
							type: "card" as PraxityBlock["type"],
							data: {
								items: [
									{
										front: [{ id: "i1", type: "image", data: { src: "/card.jpg", alt: "" } }],
										back: [{ id: "t1", type: "text", data: { content: "<p>Answer</p>" } }],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "image-alt" && i.message.includes("alt text"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("critical");
		});
	});

	describe("empty-table-cells", () => {
		it("flags table with empty header cells", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "table",
							data: {
								headers: ["Name", "", "Score"],
								rows: [["Alice", "A", "95"]],
								highlightHeaderRow: true,
								caption: "Results",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "empty-table-cells" && i.message.includes("header"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag table with filled headers", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "table",
							data: {
								headers: ["Name", "Grade"],
								rows: [["Alice", "A"]],
								highlightHeaderRow: true,
								caption: "Results",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "empty-table-cells");
			expect(issue).toBeUndefined();
		});
	});

	describe("color-only-information", () => {
		it("flags note block with color variant but no icon", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Notes",
					blocks: [
						{
							id: "b1",
							type: "note" as PraxityBlock["type"],
							data: { content: "<p>Important warning</p>", variant: "warning", showIcon: false },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "color-only-information");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag note block with icon enabled", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Notes",
					blocks: [
						{
							id: "b1",
							type: "note" as PraxityBlock["type"],
							data: { content: "<p>Important warning</p>", variant: "warning", showIcon: true },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "color-only-information");
			expect(issue).toBeUndefined();
		});
	});

	describe("images-of-text", () => {
		it("flags non-decorative image with very long alt text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{
							id: "b1",
							type: "image",
							data: { src: "/schedule.jpg", altText: "A".repeat(210), decorative: false },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "images-of-text");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag decorative image with long alt text", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Images",
					blocks: [
						{
							id: "b1",
							type: "image",
							data: { src: "/bg.jpg", altText: "A".repeat(210), decorative: true },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "images-of-text");
			expect(issue).toBeUndefined();
		});
	});

	describe("abbreviation-undefined", () => {
		it("flags undefined abbreviation on page", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: "<p>The WCAG standard requires alt text.</p>" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "abbreviation-undefined" && i.message.includes("WCAG"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
		});

		it("does not flag abbreviation that is expanded", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: {
								content: "<p>Web Content Accessibility Guidelines (WCAG) requires alt text.</p>",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "abbreviation-undefined" && i.message.includes("WCAG"),
			);
			expect(issue).toBeUndefined();
		});
	});

	describe("sensory-only-instructions", () => {
		it("flags color-based instructions", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Instructions",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: "<p>Click the red button to continue.</p>" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "sensory-only-instructions");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("moderate");
		});

		it("does not flag non-sensory instructions", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Instructions",
					blocks: [
						{
							id: "b1",
							type: "text",
							data: { content: '<p>Click the "Submit" button to continue.</p>' },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "sensory-only-instructions");
			expect(issue).toBeUndefined();
		});
	});

	describe("glossary-term-orphaned", () => {
		it("flags orphaned glossary term not in content", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{ id: "b1", type: "text", data: { content: "<p>Learn about accessibility.</p>" } },
						{
							id: "b2",
							type: "glossary-term" as PraxityBlock["type"],
							data: { term: "Interoperability", definition: "Ability of systems to work together" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "glossary-term-orphaned");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("minor");
		});

		it("does not flag glossary term that appears in content", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Content",
					blocks: [
						{ id: "b1", type: "text", data: { content: "<p>Accessibility is important.</p>" } },
						{
							id: "b2",
							type: "glossary-term" as PraxityBlock["type"],
							data: { term: "Accessibility", definition: "Making content usable by everyone" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "glossary-term-orphaned");
			expect(issue).toBeUndefined();
		});
	});

	describe("video-audio-autoplay", () => {
		it("flags video with autoplay", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [
						{
							id: "b1",
							type: "video",
							data: { src: "/intro.mp4", autoplay: true, transcript: "Text." },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "video-audio-autoplay");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags audio with autoplay", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Audio",
					blocks: [
						{
							id: "b1",
							type: "audio",
							data: {
								src: "/bg-music.mp3",
								autoplay: true,
								transcript:
									"Background music plays automatically with ambient nature sounds for a relaxing experience.",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "video-audio-autoplay");
			expect(issue).toBeDefined();
		});

		it("does not flag video without autoplay", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Video",
					blocks: [{ id: "b1", type: "video", data: { src: "/intro.mp4", transcript: "Text." } }],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "video-audio-autoplay");
			expect(issue).toBeUndefined();
		});
	});

	// ============================================================
	// Phase 0: Grammar block type rules
	// ============================================================

	describe("data-table (grammar block)", () => {
		it("flags data-table with no header row or column", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "data-table" as PraxityPage["blocks"][number]["type"],
							data: {
								headers: ["A", "B"],
								rows: [["1", "2"]],
								highlightHeaderRow: false,
								highlightHeaderCol: false,
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "table-headers" && i.blockId === "b1");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags data-table with missing caption", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "data-table" as PraxityPage["blocks"][number]["type"],
							data: {
								headers: ["A", "B"],
								rows: [["1", "2"]],
								highlightHeaderRow: true,
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "table-caption" && i.blockId === "b1");
			expect(issue).toBeDefined();
		});

		it("flags data-table with empty header cells", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "data-table" as PraxityPage["blocks"][number]["type"],
							data: {
								headers: ["Name", ""],
								rows: [["Alice", "30"]],
								highlightHeaderRow: true,
								caption: "People",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "empty-table-cells" && i.blockId === "b1");
			expect(issue).toBeDefined();
		});

		it("does not flag well-formed data-table", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Tables",
					blocks: [
						{
							id: "b1",
							type: "data-table" as PraxityPage["blocks"][number]["type"],
							data: {
								headers: ["Name", "Age"],
								rows: [["Alice", "30"]],
								highlightHeaderRow: true,
								caption: "Team members",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const tableIssues = report.issues.filter(
				(i) => i.blockId === "b1" && (i.rule === "table-headers" || i.rule === "table-caption"),
			);
			expect(tableIssues).toHaveLength(0);
		});
	});

	describe("comparison (grammar block)", () => {
		it("flags comparison block with missing before image alt", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Compare",
					blocks: [
						{
							id: "b1",
							type: "comparison" as PraxityPage["blocks"][number]["type"],
							data: {
								beforeImage: { src: "/before.jpg", altText: "" },
								afterImage: { src: "/after.jpg", altText: "After state" },
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "image-alt" && i.message.includes("Before"),
			);
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("critical");
		});

		it("flags comparison block with missing after image alt", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Compare",
					blocks: [
						{
							id: "b1",
							type: "comparison" as PraxityPage["blocks"][number]["type"],
							data: {
								beforeImage: { src: "/before.jpg", altText: "Before state" },
								afterImage: { src: "/after.jpg", altText: "" },
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find(
				(i) => i.rule === "image-alt" && i.message.includes("After"),
			);
			expect(issue).toBeDefined();
		});

		it("does not flag comparison with both alt texts", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Compare",
					blocks: [
						{
							id: "b1",
							type: "comparison" as PraxityPage["blocks"][number]["type"],
							data: {
								beforeImage: { src: "/before.jpg", altText: "Before renovation" },
								afterImage: { src: "/after.jpg", altText: "After renovation" },
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const altIssues = report.issues.filter((i) => i.rule === "image-alt" && i.blockId === "b1");
			expect(altIssues).toHaveLength(0);
		});
	});

	describe("hotspot (grammar block)", () => {
		it("flags hotspot with missing background image alt", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Hotspot",
					blocks: [
						{
							id: "b1",
							type: "hotspot" as PraxityPage["blocks"][number]["type"],
							data: {
								image: "/map.jpg",
								imageAlt: "",
								regions: [{ label: "Region 1" }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "hotspot-image-alt" && i.blockId === "b1");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("critical");
		});

		it("flags hotspot regions with missing labels", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Hotspot",
					blocks: [
						{
							id: "b1",
							type: "hotspot" as PraxityPage["blocks"][number]["type"],
							data: {
								image: "/map.jpg",
								imageAlt: "World map",
								regions: [{ label: "Europe" }, { label: "" }, { label: "" }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "hotspot-region-labels");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
			expect(issue?.message).toContain("2");
		});

		it("does not flag hotspot with all labels", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Hotspot",
					blocks: [
						{
							id: "b1",
							type: "hotspot" as PraxityPage["blocks"][number]["type"],
							data: {
								image: "/map.jpg",
								imageAlt: "World map",
								regions: [{ label: "Europe" }, { label: "Asia" }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.filter((i) => i.blockId === "b1" && i.rule.startsWith("hotspot"));
			expect(issue).toHaveLength(0);
		});
	});

	describe("rate (grammar block)", () => {
		it("flags rate block with no question", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Rating",
					blocks: [
						{
							id: "b1",
							type: "rate" as PraxityPage["blocks"][number]["type"],
							data: { style: "likert" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "rate-question");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("does not flag rate block with question", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Rating",
					blocks: [
						{
							id: "b1",
							type: "rate" as PraxityPage["blocks"][number]["type"],
							data: { question: "How confident are you?", style: "likert" },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "rate-question");
			expect(issue).toBeUndefined();
		});
	});

	describe("assessment (grammar types)", () => {
		it("flags assessment with empty question stem", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "single",
								question: "",
								options: [{ text: "A", correct: true }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-empty-stem");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags single-choice assessment with no correct answer", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "single",
								question: "What is 2+2?",
								options: [
									{ text: "3", correct: false },
									{ text: "5", correct: false },
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-no-correct");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("Single-choice");
		});

		it("flags multi-choice assessment with no correct answer", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "multi",
								question: "Select all that apply",
								options: [
									{ text: "A", correct: false },
									{ text: "B", correct: false },
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-no-correct");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("Multi-choice");
		});

		it("flags matching assessment with fewer than 2 pairs", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "matching",
								question: "Match the items",
								pairs: [{ left: "A", right: "1" }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-too-few-pairs");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags ordering assessment with fewer than 2 items", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "sequence",
								question: "Put in order",
								items: [{ text: "Only item" }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "assessment-too-few-items");
			expect(issue).toBeDefined();
		});

		it("does not flag well-formed single-choice assessment", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Quiz",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "single",
								question: "What is the capital of France?",
								options: [
									{ text: "Paris", correct: true },
									{ text: "London", correct: false },
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const stemIssue = report.issues.find((i) => i.rule === "assessment-empty-stem");
			const correctIssue = report.issues.find((i) => i.rule === "assessment-no-correct");
			expect(stemIssue).toBeUndefined();
			expect(correctIssue).toBeUndefined();
		});
	});

	describe("sequence (grammar block)", () => {
		it("flags sequence with only 1 step", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Steps",
					blocks: [
						{
							id: "b1",
							type: "sequence" as PraxityPage["blocks"][number]["type"],
							data: {
								items: [
									{
										label: "Only step",
										children: [{ id: "t-1", type: "text", data: { content: "<p>Do this</p>" } }],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "sequence-single-item");
			expect(issue).toBeDefined();
		});

		it("flags sequence with more than 8 steps", () => {
			const items = Array.from({ length: 10 }, (_, i) => ({
				label: `Step ${i + 1}`,
				children: [
					{ id: `t-${i + 1}`, type: "text", data: { content: `<p>Do step ${i + 1}</p>` } },
				],
			}));
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Steps",
					blocks: [
						{
							id: "b1",
							type: "sequence" as PraxityPage["blocks"][number]["type"],
							data: { items },
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "sequence-too-many-items");
			expect(issue).toBeDefined();
			expect(issue?.message).toContain("10");
		});

		it("does not flag sequence with 3 steps", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Steps",
					blocks: [
						{
							id: "b1",
							type: "sequence" as PraxityPage["blocks"][number]["type"],
							data: {
								items: [
									{
										label: "Step 1",
										children: [{ id: "t-1", type: "text", data: { content: "<p>First</p>" } }],
									},
									{
										label: "Step 2",
										children: [{ id: "t-2", type: "text", data: { content: "<p>Second</p>" } }],
									},
									{
										label: "Step 3",
										children: [{ id: "t-3", type: "text", data: { content: "<p>Third</p>" } }],
									},
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const seqIssues = report.issues.filter(
				(i) => i.rule === "sequence-single-item" || i.rule === "sequence-too-many-items",
			);
			expect(seqIssues).toHaveLength(0);
		});
	});

	describe("fill-blank (grammar block)", () => {
		it("flags parser assessment shape with no response blanks", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Fill",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "fillBlank",
								question: "Complete the sentence",
								content: "No blank here.",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			expect(report.issues.some((issue) => issue.rule === "fill-blank-missing-blanks")).toBe(true);
		});

		it("flags fill-blank with no blanks defined", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Fill",
					blocks: [
						{
							id: "b1",
							type: "fill-blank" as PraxityPage["blocks"][number]["type"],
							data: {
								content: "The sky is blue.",
								instructions: "Complete the sentence",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "fill-blank-missing-blanks");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags fill-blank with no instructions", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Fill",
					blocks: [
						{
							id: "b1",
							type: "fill-blank" as PraxityPage["blocks"][number]["type"],
							data: {
								content: "The sky is ____.",
								blanks: [{ id: "b1", correctAnswer: "blue" }],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "fill-blank-missing-instructions");
			expect(issue).toBeDefined();
		});

		it("does not flag fill-blank with blanks and instructions", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Fill",
					blocks: [
						{
							id: "b1",
							type: "fill-blank" as PraxityPage["blocks"][number]["type"],
							data: {
								content: "The sky is ____.",
								blanks: [{ id: "b1", correctAnswer: "blue" }],
								instructions: "Fill in the missing word",
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const fbIssues = report.issues.filter(
				(i) => i.blockId === "b1" && i.rule.startsWith("fill-blank"),
			);
			expect(fbIssues).toHaveLength(0);
		});

		it("flags a scored fill-blank containing only open blanks", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Reflection",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "fillBlank",
								question: "Finish the sentence",
								content: "Today I will ____.",
								scored: true,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			expect(report.issues.find((issue) => issue.rule === "fill-blank-open-scored")).toEqual(
				expect.objectContaining({ blockId: "b1", severity: "serious" }),
			);
		});

		it("does not flag a scored mixed fill-blank", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Mixed",
					blocks: [
						{
							id: "b1",
							type: "assessment",
							data: {
								assessmentType: "fillBlank",
								question: "Complete and reflect",
								content: "Wear {gloves}. I will ____.",
								scored: true,
							},
						},
					],
				},
			];

			const report = checkCourseAccessibility(pages);
			expect(report.issues.some((issue) => issue.rule === "fill-blank-open-scored")).toBe(false);
		});
	});

	describe("branch (grammar block)", () => {
		it("flags branch with generic option labels", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Branch",
					blocks: [
						{
							id: "b1",
							type: "branch" as PraxityPage["blocks"][number]["type"],
							data: {
								options: [
									{ label: "Option A", target: "page-2" },
									{ label: "Option B", target: "page-3" },
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "branch-generic-labels");
			expect(issue).toBeDefined();
			expect(issue?.severity).toBe("serious");
		});

		it("flags branch with dead-end options", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Branch",
					blocks: [
						{
							id: "b1",
							type: "branch" as PraxityPage["blocks"][number]["type"],
							data: {
								options: [
									{ label: "Go to the park", target: "page-2" },
									{ label: "Stay home", target: "" },
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const issue = report.issues.find((i) => i.rule === "branch-dead-end");
			expect(issue).toBeDefined();
		});

		it("does not flag branch with descriptive labels and targets", () => {
			const pages: PraxityPage[] = [
				{
					id: "p1",
					title: "Branch",
					blocks: [
						{
							id: "b1",
							type: "branch" as PraxityPage["blocks"][number]["type"],
							data: {
								options: [
									{ label: "Investigate the cave", target: "page-2" },
									{ label: "Continue down the path", target: "page-3" },
								],
							},
						},
					],
				},
			];
			const report = checkCourseAccessibility(pages);
			const branchIssues = report.issues.filter(
				(i) => i.blockId === "b1" && i.rule.startsWith("branch"),
			);
			expect(branchIssues).toHaveLength(0);
		});
	});

	// ============================================================
	// Phase 1: Design System rules
	// ============================================================

	describe("design system rules", () => {
		const minimalPage: PraxityPage[] = [
			{
				id: "p1",
				title: "Page",
				blocks: [{ id: "b1", type: "text", data: { content: "<p>Hi</p>" } }],
			},
		];

		describe("theme contrast", () => {
			it("flags text/background contrast below 4.5:1", () => {
				const ds: DesignSystemConfig = {
					colors: {
						background: "#ffffff",
						text: "#999999", // ~2.8:1 contrast
						accent: "#1e40af",
						buttonBackground: "#1e40af",
						buttonText: "#ffffff",
						success: "#16a34a",
						error: "#dc2626",
					},
				};
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "theme-text-on-background-contrast");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("critical");
			});

			it("flags button text/background contrast below 4.5:1", () => {
				const ds: DesignSystemConfig = {
					colors: {
						background: "#ffffff",
						text: "#1a1a1a",
						accent: "#1e40af",
						buttonBackground: "#ffff00", // yellow
						buttonText: "#ffffff", // white on yellow = bad contrast
						success: "#16a34a",
						error: "#dc2626",
					},
				};
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "theme-button-text-contrast");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("critical");
			});

			it("flags accent/background contrast below 3:1", () => {
				const ds: DesignSystemConfig = {
					colors: {
						background: "#ffffff",
						text: "#1a1a1a",
						accent: "#cccccc", // very light gray on white = bad
						buttonBackground: "#1e40af",
						buttonText: "#ffffff",
						success: "#16a34a",
						error: "#dc2626",
					},
				};
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "theme-accent-on-background-contrast");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});

			it("does not flag when all contrasts are sufficient", () => {
				const ds: DesignSystemConfig = {
					colors: {
						background: "#ffffff",
						text: "#1a1a1a",
						accent: "#1e40af",
						buttonBackground: "#1e40af",
						buttonText: "#ffffff",
						success: "#007a3d",
						error: "#dc2626",
						warning: "#825500",
					},
				};
				const issues = checkDesignSystemAccessibility(ds);
				const contrastIssues = issues.filter((i) => i.rule.includes("contrast"));
				expect(contrastIssues).toHaveLength(0);
			});
		});

		describe("line-height-minimum", () => {
			it("flags line height below 1.5", () => {
				const ds: DesignSystemConfig = { lineHeight: 1.2 };
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "line-height-minimum");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});

			it("does not flag line height of 1.5 or above", () => {
				const ds: DesignSystemConfig = { lineHeight: 1.5 };
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "line-height-minimum");
				expect(issue).toBeUndefined();
			});
		});

		describe("font-size-minimum", () => {
			it("flags base font size below 16px", () => {
				const ds: DesignSystemConfig = { baseFontSize: 14 };
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "font-size-minimum");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});

			it("does not flag base font size of 16px", () => {
				const ds: DesignSystemConfig = { baseFontSize: 16 };
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "font-size-minimum");
				expect(issue).toBeUndefined();
			});
		});

		describe("max-content-width", () => {
			it("flags content width over 720px", () => {
				const ds: DesignSystemConfig = { contentMaxWidth: 900 };
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "max-content-width");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("moderate");
			});

			it("does not flag content width of 720px", () => {
				const ds: DesignSystemConfig = { contentMaxWidth: 720 };
				const issues = checkDesignSystemAccessibility(ds);
				const issue = issues.find((i) => i.rule === "max-content-width");
				expect(issue).toBeUndefined();
			});
		});

		it("does not mix design system rules into course checks", () => {
			const report = checkCourseAccessibility(minimalPage);
			expect(report.issues.some((issue) => issue.blockId === "designSystem")).toBe(false);
		});
	});

	// ============================================================
	// Phase 2: Keyboard/Interaction rules
	// ============================================================

	describe("keyboard/interaction rules", () => {
		describe("choice-option-count", () => {
			it("flags assessment with more than 10 options", () => {
				const options = Array.from({ length: 12 }, (_, i) => ({
					text: `Option ${i + 1}`,
					correct: i === 0,
				}));
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Quiz",
						blocks: [
							{
								id: "b1",
								type: "assessment",
								data: { assessmentType: "single", question: "Pick one", options },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "choice-option-count");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("moderate");
			});

			it("does not flag assessment with 10 or fewer options", () => {
				const options = Array.from({ length: 5 }, (_, i) => ({
					text: `Option ${i + 1}`,
					correct: i === 0,
				}));
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Quiz",
						blocks: [
							{
								id: "b1",
								type: "assessment",
								data: { assessmentType: "single", question: "Pick one", options },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "choice-option-count");
				expect(issue).toBeUndefined();
			});
		});

		describe("image-only-options", () => {
			it("flags options with images but no text", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Quiz",
						blocks: [
							{
								id: "b1",
								type: "assessment",
								data: {
									assessmentType: "single",
									question: "Which animal?",
									options: [
										{ text: "", imageSrc: "/cat.jpg", correct: true },
										{ text: "", imageSrc: "/dog.jpg", correct: false },
									],
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "image-only-options");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});
		});

		describe("match-pair-count", () => {
			it("flags matching assessment with more than 8 pairs", () => {
				const pairs = Array.from({ length: 10 }, (_, i) => ({
					left: `Term ${i + 1}`,
					right: `Def ${i + 1}`,
				}));
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Quiz",
						blocks: [
							{
								id: "b1",
								type: "assessment",
								data: { assessmentType: "matching", question: "Match", pairs },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "match-pair-count");
				expect(issue).toBeDefined();
			});
		});

		describe("drag-variant-keyboard-alt", () => {
			it("flags matching assessment with drag variant", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Quiz",
						blocks: [
							{
								id: "b1",
								type: "assessment",
								data: {
									assessmentType: "matching",
									question: "Match",
									pairs: [
										{ left: "A", right: "1" },
										{ left: "B", right: "2" },
									],
									variant: "drag",
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "drag-variant-keyboard-alt");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});

			it("flags fill-blank with word-bank-drag style", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Fill",
						blocks: [
							{
								id: "b1",
								type: "fill-blank" as PraxityPage["blocks"][number]["type"],
								data: {
									content: "The sky is ____.",
									blanks: [{ id: "b1", correctAnswer: "blue" }],
									instructions: "Drag words",
									style: "word-bank-drag",
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "drag-variant-keyboard-alt");
				expect(issue).toBeDefined();
			});
		});

		describe("hotspot-item-count", () => {
			it("flags hotspot with more than 12 regions", () => {
				const regions = Array.from({ length: 15 }, (_, i) => ({ label: `Region ${i + 1}` }));
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Hotspot",
						blocks: [
							{
								id: "b1",
								type: "hotspot" as PraxityPage["blocks"][number]["type"],
								data: { image: "/map.jpg", imageAlt: "Map", regions },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "hotspot-item-count");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("moderate");
			});
		});

		describe("auto-advance-pause-control", () => {
			it("flags sequence with auto-advance but no pause control", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Steps",
						blocks: [
							{
								id: "b1",
								type: "sequence" as PraxityPage["blocks"][number]["type"],
								data: {
									items: [
										{
											label: "Step 1",
											children: [{ id: "t-1", type: "text", data: { content: "<p>First</p>" } }],
										},
										{
											label: "Step 2",
											children: [{ id: "t-2", type: "text", data: { content: "<p>Second</p>" } }],
										},
									],
									autoAdvance: true,
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "auto-advance-pause-control");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});

			it("does not flag sequence with auto-advance and pause control", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Steps",
						blocks: [
							{
								id: "b1",
								type: "sequence" as PraxityPage["blocks"][number]["type"],
								data: {
									items: [
										{
											label: "Step 1",
											children: [{ id: "t-1", type: "text", data: { content: "<p>First</p>" } }],
										},
										{
											label: "Step 2",
											children: [{ id: "t-2", type: "text", data: { content: "<p>Second</p>" } }],
										},
									],
									autoAdvance: true,
									pauseControl: true,
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "auto-advance-pause-control");
				expect(issue).toBeUndefined();
			});
		});

		describe("rating-scale-endpoints", () => {
			it("flags rate block without endpoint labels", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Rate",
						blocks: [
							{
								id: "b1",
								type: "rate" as PraxityPage["blocks"][number]["type"],
								data: { question: "How do you feel?", style: "likert" },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "rating-scale-endpoints");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("moderate");
			});

			it("does not flag rate block with endpoint labels", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Rate",
						blocks: [
							{
								id: "b1",
								type: "rate" as PraxityPage["blocks"][number]["type"],
								data: {
									question: "How do you feel?",
									style: "likert",
									lowLabel: "Strongly disagree",
									highLabel: "Strongly agree",
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "rating-scale-endpoints");
				expect(issue).toBeUndefined();
			});
		});

		describe("video-following-heading", () => {
			it("flags video not preceded by a heading", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Media",
						blocks: [
							{ id: "b1", type: "text", data: { content: "<p>Some text</p>" } },
							{
								id: "b2",
								type: "video",
								data: { src: "/vid.mp4", transcript: "Transcript text." },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "video-following-heading");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("serious");
			});

			it("does not flag video preceded by a heading", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Media",
						blocks: [
							{
								id: "b1",
								type: "heading" as PraxityPage["blocks"][number]["type"],
								data: { content: "Intro Video", level: 2 },
							},
							{
								id: "b2",
								type: "video",
								data: { src: "/vid.mp4", transcript: "Transcript text." },
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find(
					(i) => i.rule === "video-following-heading" && i.blockId === "b2",
				);
				expect(issue).toBeUndefined();
			});

			it("flags audio not preceded by a heading", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Media",
						blocks: [
							{
								id: "b1",
								type: "audio",
								data: {
									src: "/pod.mp3",
									transcript: "Full transcript of the podcast episode.",
								},
							},
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "video-following-heading");
				expect(issue).toBeDefined();
			});
		});
	});

	// ============================================================
	// Phase 3: Content Quality rules
	// ============================================================

	describe("content quality rules", () => {
		describe("sentence-length-excessive", () => {
			it("flags sentences with more than 30 words", () => {
				const longSentence = `${"word ".repeat(35).trim()}.`;
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Content",
						blocks: [{ id: "b1", type: "text", data: { content: `<p>${longSentence}</p>` } }],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "sentence-length-excessive");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("moderate");
			});

			it("does not flag short sentences", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Content",
						blocks: [
							{ id: "b1", type: "text", data: { content: "<p>This is a short sentence.</p>" } },
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "sentence-length-excessive");
				expect(issue).toBeUndefined();
			});
		});

		describe("paragraph-length-excessive", () => {
			it("flags paragraphs with more than 150 words", () => {
				const longParagraph = "word ".repeat(160).trim();
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Content",
						blocks: [{ id: "b1", type: "text", data: { content: `<p>${longParagraph}</p>` } }],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "paragraph-length-excessive");
				expect(issue).toBeDefined();
				expect(issue?.severity).toBe("minor");
			});
		});

		describe("image-cluster-without-context", () => {
			it("flags 3+ consecutive images without text", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Gallery",
						blocks: [
							{ id: "i1", type: "image", data: { src: "/a.jpg", altText: "A", decorative: false } },
							{ id: "i2", type: "image", data: { src: "/b.jpg", altText: "B", decorative: false } },
							{ id: "i3", type: "image", data: { src: "/c.jpg", altText: "C", decorative: false } },
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "image-cluster-without-context");
				expect(issue).toBeDefined();
			});

			it("does not flag images separated by text", () => {
				const pages: PraxityPage[] = [
					{
						id: "p1",
						title: "Gallery",
						blocks: [
							{ id: "i1", type: "image", data: { src: "/a.jpg", altText: "A", decorative: false } },
							{ id: "t1", type: "text", data: { content: "<p>Context</p>" } },
							{ id: "i2", type: "image", data: { src: "/b.jpg", altText: "B", decorative: false } },
						],
					},
				];
				const report = checkCourseAccessibility(pages);
				const issue = report.issues.find((i) => i.rule === "image-cluster-without-context");
				expect(issue).toBeUndefined();
			});
		});
	});
});

/**
 * The renderer names a table from its title or its caption, whichever exists, and
 * falls back to a generic "Data table" only when neither does. The rule used to
 * fire on a missing caption alone, nagging authors who had already named the table
 * with a title.
 */
describe("table naming", () => {
	const tablePage = (data: Record<string, unknown>) => ({
		id: "p1",
		title: "Page",
		blocks: [
			{
				id: "t1",
				type: "table" as const,
				data: { headers: ["A"], rows: [["1"]], highlightHeaderRow: true, ...data },
			},
		],
	});

	const captionIssues = (data: Record<string, unknown>) =>
		checkCourseAccessibility([tablePage(data) as never]).issues.filter(
			(issue) => issue.rule === "table-caption",
		);

	it("flags a table with neither title nor caption", () => {
		const issues = captionIssues({});
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain("Data table");
	});

	it("accepts a title as the table's name", () => {
		expect(captionIssues({ title: "Quarterly revenue" })).toHaveLength(0);
	});

	it("accepts a caption as the table's name", () => {
		expect(captionIssues({ caption: "Revenue by quarter" })).toHaveLength(0);
	});

	it("ignores whitespace-only names", () => {
		expect(captionIssues({ title: "   " })).toHaveLength(1);
	});
});
