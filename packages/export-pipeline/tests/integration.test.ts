import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

// Mock asset downloads
vi.mock("../src/asset-resolver", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/asset-resolver")>();
	return {
		...original,
		resolveAssets: vi.fn().mockImplementation((pages) => {
			// Return pages unchanged (no actual downloads)
			return Promise.resolve(pages);
		}),
	};
});

import type { PraxityPage } from "@praxity/shared-blocks";
import { buildScormPackage, type CourseExportInput, type DesktopExportInput } from "../src/build";
import { XapiRuntime } from "../src/scorm/api/xapi";

// ---------- Test Data ----------

function createRealisticCourse(overrides?: Partial<CourseExportInput>): CourseExportInput {
	return {
		id: "course-integration-test",
		title: "Integration Test Course",
		sourceLocale: "en",
		content: [
			{
				id: "page-intro",
				title: "Welcome",
				blocks: [
					{
						id: "b1",
						type: "text",
						data: { content: "<h2>Welcome to the Course</h2><p>Learn amazing things.</p>" },
					},
					{ id: "b2", type: "image", data: { src: "assets/hero.jpg", alt: "Course hero image" } },
					{ id: "b3", type: "divider", data: {} },
				],
			},
			{
				id: "page-content",
				title: "Core Concepts",
				blocks: [
					{ id: "b4", type: "text", data: { content: "<p>Understanding the fundamentals.</p>" } },
					{
						id: "b5",
						type: "accordion",
						data: {
							items: [
								{
									id: "topic",
									label: "Topic 1",
									children: [
										{ id: "topic-text", type: "text", data: { content: "<p>Details</p>" } },
									],
								},
							],
						},
					},
					{
						id: "b6",
						type: "tabs",
						data: {
							items: [
								{
									id: "tab",
									label: "Tab A",
									children: [
										{ id: "tab-text", type: "text", data: { content: "<p>Content A</p>" } },
									],
								},
							],
						},
					},
					{
						id: "b7",
						type: "sequence",
						data: {
							variant: "timeline",
							orientation: "vertical",
							trackCompletion: false,
							items: [{ id: "step-1", label: "Step 1", children: [] }],
						},
					},
				],
			},
			{
				id: "page-quiz",
				title: "Knowledge Check",
				blocks: [
					{
						id: "b8",
						type: "assessment",
						data: {
							assessmentType: "choice",
							stem: [{ id: "q1-stem", type: "text", data: { content: "<p>What is 2+2?</p>" } }],
							response: {
								type: "choice",
								selectionMode: "single",
								inputMethod: "click",
								options: [
									{ id: "q1-a", label: "3", isCorrect: false },
									{ id: "q1-b", label: "4", isCorrect: true },
								],
								display: "list",
								shuffle: false,
							},
							feedback: {},
							gradingMode: "exact",
						},
					},
					{ id: "b9", type: "note", data: { content: "Review your answer before continuing." } },
				],
			},
		],
		...overrides,
	};
}

// ---------- Tests ----------

describe("Integration: buildScormPackage", () => {
	it("packages an xAPI launch with the selected LRS host", async () => {
		const xapiConfig = {
			endpoint: "https://lrs.example.com/xapi/statements",
			auth: "Basic dGVzdA==",
			actorMode: "manual" as const,
			actor: { name: "Test Learner", mbox: "mailto:learner@example.com" },
		};
		const course = createRealisticCourse({ xapiConfig });
		const result = await buildScormPackage(course, { format: "xapi" });
		const zip = new AdmZip(result.zip);
		const tincan = new JSDOM(zip.readAsText("tincan.xml"), { contentType: "text/xml" }).window
			.document;
		const launchPath = tincan.querySelector("launch")?.textContent;
		expect(launchPath).toBe("index.html");
		expect(zip.getEntry(launchPath ?? "")).toBeTruthy();
		// The launch file redirects to the first page, which carries the deployment config.
		const refresh = new JSDOM(zip.readAsText(launchPath ?? "")).window.document
			.querySelector('meta[http-equiv="refresh"]')
			?.getAttribute("content");
		const firstPage = refresh?.split("url=")[1] ?? "";
		const launchDom = new JSDOM(zip.readAsText(firstPage), {
			url: `https://course.example/${firstPage}`,
		});
		const launch = launchDom.window.document;
		const deployment = JSON.parse(
			launch.getElementById("praxity-deployment-config")?.textContent ?? "null",
		) as { format: string; xapiConfig: typeof xapiConfig; courseActivityId: string } | null;
		expect(deployment).toMatchObject({ format: "xapi", xapiConfig });
		const declaredId = tincan.querySelector("activity")?.getAttribute("id");
		expect(deployment?.courseActivityId).toBe(declaredId);
		const page = JSON.parse(
			launch.getElementById("praxity-host-config")?.textContent ?? "null",
		) as {
			courseId: string;
		};
		expect(page.courseId).toBe(course.id);
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 200 }));
		try {
			vi.stubGlobal("window", launchDom.window);
			const runtime = new XapiRuntime(
				deployment?.xapiConfig ?? xapiConfig,
				page.courseId,
				undefined,
				deployment?.courseActivityId,
			);
			runtime.setCompletion("completed");
			const statement = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
			expect(statement.object.id).toBe(declaredId);
			const launchedId = "https://lms.example.com/activities/course-123";
			launchDom.window.history.replaceState(
				{},
				"",
				`${firstPage}?activity_id=${encodeURIComponent(launchedId)}`,
			);
			const launchedRuntime = new XapiRuntime(
				deployment?.xapiConfig ?? xapiConfig,
				page.courseId,
				undefined,
				deployment?.courseActivityId,
			);
			launchedRuntime.trackInteraction("question-1", "A", true, 1);
			const interaction = JSON.parse(fetchSpy.mock.calls.at(-1)?.[1]?.body as string);
			expect(interaction.object.id).toBe(`${launchedId}/interaction/question-1`);
			launchDom.window.history.replaceState({}, "", "second-page.html");
			new XapiRuntime(
				deployment?.xapiConfig ?? xapiConfig,
				page.courseId,
				undefined,
				deployment?.courseActivityId,
			).setCompletion("passed");
			const laterPageStatement = JSON.parse(fetchSpy.mock.calls.at(-1)?.[1]?.body as string);
			expect(laterPageStatement.object.id).toBe(launchedId);
		} finally {
			vi.unstubAllGlobals();
			fetchSpy.mockRestore();
			launchDom.window.close();
		}
		const hostPath = launch.querySelector('script[src*="host-xapi-"]')?.getAttribute("src");
		expect(zip.getEntry(hostPath ?? "")).toBeTruthy();
	});

	it("throws for empty course (0 pages)", async () => {
		const emptyCourse = createRealisticCourse({ content: [] });

		await expect(buildScormPackage(emptyCourse, { format: "scorm12" })).rejects.toThrow(
			"Cannot publish a course with no content pages. Add at least one page.",
		);
	});

	it("handles RTL language course (Arabic)", async () => {
		const rtlCourse = createRealisticCourse({
			sourceLocale: "ar",
			title: "دورة تعليمية",
			content: [
				{
					id: "page-1",
					title: "مرحبا",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>مرحبا بالعالم</p>" } }],
				},
			],
		});

		const result = await buildScormPackage(rtlCourse, { format: "scorm12" });

		expect(result.zip).toBeInstanceOf(Buffer);
		expect(result.pageCount).toBe(1);
	});

	it("handles a single-page course", async () => {
		const singlePage = createRealisticCourse({
			content: [
				{
					id: "only-page",
					title: "Single Page",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>Only content</p>" } }],
				},
			],
		});

		const result = await buildScormPackage(singlePage, { format: "scorm12" });
		expect(result.pageCount).toBe(1);
	});

	it("handles special characters in course and page titles", async () => {
		const specialChars = createRealisticCourse({
			title: 'Course "With" <Special> & Characters',
			content: [
				{
					id: "p1",
					title: "Page & Title <with> 'quotes'",
					blocks: [{ id: "b1", type: "text", data: { content: "<p>Content</p>" } }],
				},
			],
		});

		// Should not throw
		const result = await buildScormPackage(specialChars, { format: "scorm12" });
		expect(result.zip).toBeInstanceOf(Buffer);
	});

	it("uses page break data.title for desktop parser-format page titles", async () => {
		const desktopCourseInput: DesktopExportInput = {
			courseId: "desktop-course",
			blocks: [
				{ id: "b1", type: "text", data: { content: "<p>First page</p>" } },
				{ id: "pb1", type: "pageBreak", data: { title: "Second Page Title" } },
				{ id: "b2", type: "text", data: { content: "<p>Second page</p>" } },
			] as PraxityPage["blocks"],
			frontmatter: { title: "Desktop Course" },
			config: { completionThreshold: 1 },
			resolvedAssets: new Map<string, Uint8Array>(),
			viewerVersion: "test",
			locale: "en",
		};

		const result = await buildScormPackage(desktopCourseInput, { format: "scorm12" });
		expect(result.pageCount).toBe(2);

		const zip = new AdmZip(result.zip);
		const allHtml = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => entry.getData().toString("utf-8"))
			.join("\n");

		expect(allHtml).toContain("Second Page Title");
	});

	it("preserves canonical grammar 4 assessments for published output", async () => {
		const parserFormatCourse = createRealisticCourse({
			content: [
				{
					id: "page-quiz",
					title: "Quiz",
					blocks: [
						{
							id: "q1",
							type: "assessment",
							data: {
								assessmentType: "choice",
								stem: [{ id: "sum-stem", type: "text", data: { content: "<p>What is 2+2?</p>" } }],
								response: {
									type: "choice",
									selectionMode: "single",
									options: [
										{ id: "three", label: "3", isCorrect: false },
										{ id: "four", label: "4", isCorrect: true },
									],
								},
							},
						},
					],
				},
			],
		});

		const result = await buildScormPackage(parserFormatCourse, { format: "scorm12" });
		expect(result.zip).toBeInstanceOf(Buffer);

		const zip = new AdmZip(result.zip);
		const allHtml = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => entry.getData().toString("utf-8"))
			.join("\n");

		expect(allHtml).toContain('"assessmentType":"choice"');
		expect(allHtml).toContain('"stem"');
		expect(allHtml).toContain('"response"');
		expect(allHtml).not.toContain('"assessmentType":"single"');
	});
});
