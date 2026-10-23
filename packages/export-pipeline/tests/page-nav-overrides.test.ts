import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks";
import { describe, expect, it } from "vitest";
import { type CourseConfig, generateHtmlPage } from "../src/html-gen";

function textBlock(id: string, content: string): PraxityBlock {
	return { id, type: "text", data: { content: `<p>${content}</p>` } };
}

function makePages(datas: Array<Record<string, unknown> | undefined>): PraxityPage[] {
	return datas.map((data, i) => ({
		id: `p${i + 1}`,
		title: `Page ${i + 1}`,
		blocks: [textBlock(`t${i + 1}`, `Body of page ${i + 1}.`)],
		...(data ? { data } : {}),
	}));
}

function renderCourse(
	datas: Array<Record<string, unknown> | undefined>,
	configOverrides?: Partial<CourseConfig>,
): string[] {
	const pages = makePages(datas);
	const config: CourseConfig = {
		id: "course-1",
		title: "Course",
		sourceLocale: "en",
		pages,
		totalPages: pages.length,
		navigationStyle: "sidebar",
		...configOverrides,
	};
	const slugList = pages.map((p, i) => ({ pageId: p.id, slug: `page-${i + 1}`, title: p.title }));
	const slugMap = new Map(pages.map((p, i) => [p.id, `page-${i + 1}`]));
	return pages.map((page, index) =>
		generateHtmlPage({
			config,
			page,
			index,
			currentSlug: `page-${index + 1}`,
			slugList,
			slugMap,
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js" },
			},
		}),
	);
}

function shellConfig(html: string): Record<string, unknown> {
	const json = html.match(
		/<script id="praxity-shell-config" type="application\/json">([\s\S]*?)<\/script>/u,
	)?.[1];
	return JSON.parse(json ?? "{}") as Record<string, unknown>;
}

describe("per-page nav overrides in export", () => {
	it("uses native navigation and the matching body class for per-key overrides", () => {
		const [plain, overridden] = renderCourse([undefined, { navOutline: false }]);
		// navOutline:false + navPrevNext:true (sidebar default) infers "embedded".
		expect(overridden).toContain('<body class="praxity-layout-embedded">');
		expect(overridden).toContain('<main id="main-content"');
		expect(overridden).toContain('data-praxity-islands="nav"');
		expect(plain).toContain('<body class="praxity-layout-sidebar">');
	});

	it("applies a per-page archetype to body class and fallback nav", () => {
		const [plain, minimal, none] = renderCourse([
			undefined,
			{ nav: "minimal", focus: "off" },
			{ nav: "none" },
		]);
		expect(minimal).toContain('<body class="praxity-layout-minimal">');
		expect(none).toContain('<body class="praxity-layout-none">');
		expect(none).not.toContain("praxity-outline-fallback");
		expect(plain).toContain("praxity-outline-fallback");
	});

	it("keeps title/duration-only pages static", () => {
		const [page] = renderCourse([{ title: "Reading", duration: "show" }]);
		expect(page).toContain('<main id="main-content"');
	});

	it("threads effective arrow-key navigation into the shell config", () => {
		const [locked, plain] = renderCourse([{ navKeyboardArrows: false }, undefined]);
		expect(shellConfig(locked).keyboardArrows).toBe(false);
		expect(shellConfig(plain).keyboardArrows).toBe(true);
	});

	it("threads the page focus default into the shell config", () => {
		const [focusOn, plain] = renderCourse([{ focus: "on" }, undefined]);
		expect(shellConfig(focusOn).pageFocusDefault).toBe(true);
		expect(shellConfig(plain).pageFocusDefault).toBe(false);
	});

	it("does not synthesize a page heading from its navigation label", () => {
		const pages = makePages([{ navLessonTitleAsHeading: false }]);
		const config: CourseConfig = {
			id: "course-1",
			title: "Course",
			sourceLocale: "en",
			pages,
			totalPages: 1,
			navigationStyle: "sidebar",
			showLessonNameAsTitle: true,
		};
		const html = generateHtmlPage({
			config,
			page: pages[0],
			index: 0,
			currentSlug: "page-1",
			slugList: [{ pageId: "p1", slug: "page-1", title: "Page 1" }],
			slugMap: new Map([["p1", "page-1"]]),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js" },
			},
		});
		expect(html).not.toContain('class="praxity-page-title"');
		expect(html).toContain("Body of page 1.");
		expect(html).not.toContain('class="praxity-lesson-title"');
	});
});
