import { computeAccessibleName } from "dom-accessibility-api";
import { JSDOM } from "jsdom";
import { assert, describe, expect, it, vi } from "vitest";
import { initializeCourseHost } from "../../template/src/hosts/course-host";
import { collectGlossaryTerms } from "../glossary-page";
import { type CourseConfig, generateHtmlPage } from "../html-gen";

const titles = ["Orientation", "Module 1: Safety", "Module 2: Practice", "Module 3: Review"];
const pages: CourseConfig["pages"] = titles.flatMap((lessonTitle, lesson) =>
	Array.from({ length: 2 }, (_, page) => ({
		id: `lesson-${lesson}-page-${page}`,
		lessonId: `lesson-${lesson}`,
		lessonTitle,
		lessonKicker: "Not an outline label",
		isFirstPageOfLesson: page === 0,
		title: `Page ${lesson}-${page}`,
		blocks: [
			{
				id: `term-${lesson}-${page}`,
				type: "text" as const,
				data: { content: `[Term ${lesson}]{Definition ${lesson}}` },
			},
		],
	})),
);
const config: CourseConfig = {
	id: "modules",
	title: "Manifest course",
	sourceLocale: "en",
	totalPages: pages.length,
	pages,
};

function render(index: number, overrides: Partial<CourseConfig> = {}) {
	const course = { ...config, ...overrides };
	const slugs = course.pages.map((page) => ({ pageId: page.id, slug: page.id, title: page.title }));
	return new JSDOM(
		generateHtmlPage({
			config: course,
			page: course.pages[index],
			index,
			currentSlug: slugs[index].slug,
			slugList: slugs,
			slugMap: new Map(slugs.map((entry) => [entry.pageId, entry.slug])),
			islandAssets: {
				loaderFilename: "island-loader.js",
				islandFilenames: { nav: "island-nav.js", tooltip: "island-tooltip.js" },
			},
		}),
	).window.document;
}

describe("manifest module navigation", () => {
	it("lists all modules in order and only the current module's nested pages", () => {
		const doc = render(3);
		const outline = doc.querySelector("[data-native-outline]");
		assert(outline);
		expect(
			[...outline.querySelectorAll(".praxity-native-module > a")].map(
				(a) => a.childNodes[0].textContent,
			),
		).toEqual(titles);
		expect(outline.querySelectorAll(".praxity-native-module > ol")).toHaveLength(1);
		expect(
			[...outline.querySelectorAll(".praxity-native-module > ol a")].map((a) =>
				a.getAttribute("href"),
			),
		).toEqual(["lesson-1-page-0.html", "lesson-1-page-1.html"]);
		expect(outline.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(
			"lesson-1-page-1.html",
		);
		expect(outline.textContent).not.toContain("Not an outline label");
		expect(doc.querySelector(".praxity-pages-position")?.textContent).toBe("Page 2 of 2");
		const progress = doc.querySelector('[role="progressbar"]');
		expect(progress?.getAttribute("aria-valuenow")).toBe("2");
		expect(progress?.getAttribute("aria-valuemax")).toBe("2");
		expect(outline.querySelector("details")).toBeNull();
	});

	it("crosses module boundaries in both directions with a named continuation", () => {
		const end = render(3);
		expect(end.querySelector(".praxity-nav-next .praxity-nav-label-full")?.textContent).toBe(
			"Next Module",
		);
		expect(end.querySelector(".praxity-nav-next")?.getAttribute("aria-label")).toBe(
			"Next Module: Module 2: Practice",
		);
		expect(end.querySelector(".praxity-nav-next")?.getAttribute("href")).toBe(
			"lesson-2-page-0.html",
		);
		expect(render(4).querySelector(".praxity-nav-prev")?.getAttribute("href")).toBe(
			"lesson-1-page-1.html",
		);
		expect(end.querySelector(".praxity-nav-next .praxity-nav-label-compact")?.textContent).toBe(
			"Next",
		);
		const start = render(4);
		expect(start.querySelector(".praxity-nav-prev .praxity-nav-label-full")?.textContent).toBe(
			"Previous Module",
		);
		expect(start.querySelector(".praxity-nav-prev .praxity-nav-label-compact")?.textContent).toBe(
			"Previous",
		);
		expect(start.querySelector(".praxity-nav-prev")?.getAttribute("aria-label")).toBe(
			"Previous Module: Module 1: Safety",
		);
		expect(
			render(4, { sourceLocale: "fr" }).querySelector(".praxity-nav-prev .praxity-nav-label-full")
				?.textContent,
		).toBe("Module précédent");
		expect(end.querySelector(".praxity-pages-position")?.textContent).toBe("Page 2 of 2");
		expect(end.querySelector(".praxity-nav-next .praxity-pagination-title")?.textContent).toBe(
			"Page 2-0",
		);
		expect(render(2).querySelector(".praxity-nav-next")?.firstChild?.textContent).toBe("Next");
		expect(
			render(3, { sourceLocale: "fr" }).querySelector(".praxity-nav-next .praxity-nav-label-full")
				?.textContent,
		).toBe("Module suivant");
		expect(
			render(3, { sourceLocale: "fr" }).querySelector(".praxity-pages-position")?.textContent,
		).toBe("Page 2 sur 2");
	});

	it("keeps the Pages position when legacy slide counters are hidden", () => {
		const noCount = render(3, { navToggles: { navSlideCounter: false, navProgressStyle: "dots" } });
		expect(noCount.querySelector(".praxity-pages-position")?.textContent).toBe("Page 2 of 2");
		expect(noCount.querySelector('[role="progressbar"]')).not.toBeNull();
		const noProgress = render(3, {
			navToggles: { navSlideCounter: true, navProgressStyle: "none" },
		});
		expect(noProgress.querySelector(".praxity-pages-position")?.textContent).toBe("Page 2 of 2");
		expect(noProgress.querySelector(".praxity-native-page-position [role=progressbar]")).toBeNull();
	});

	it("keeps a single lesson flat and honours page navigation overrides", () => {
		expect(
			render(0, { pages: pages.slice(0, 2), totalPages: 2 }).querySelector(
				".praxity-native-module",
			),
		).toBeNull();
		const overridden = pages.map((page, index) =>
			index === 3 ? { ...page, data: { nav: "none" } } : page,
		);
		expect(render(3, { pages: overridden }).querySelector(".praxity-outline-fallback")).toBeNull();
	});

	it("aggregates glossary terms across modules and exposes a native new-tab link", () => {
		const terms = collectGlossaryTerms(pages);
		expect(terms.map((term) => term.term)).toEqual(["Term 0", "Term 1", "Term 2", "Term 3"]);
		const link = render(3, { glossaryTerms: terms }).querySelector('a[href="glossary.html"]');
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener");
		assert(link);
		expect(computeAccessibleName(link)).toBe("Glossary , (opens in a new tab)");
		expect(link?.closest("ol")).toBeNull();
	});

	it.each(["scorm12", "scorm2004", "standalone", "xapi"] as const)(
		"never starts a %s runtime from the glossary",
		(format) => {
			const doc = render(0);
			const host = doc.getElementById("praxity-host-config");
			assert(host?.textContent);
			assert(doc.defaultView);
			host.textContent = JSON.stringify({ ...JSON.parse(host.textContent), pageRole: "glossary" });
			const deployment = doc.createElement("script");
			deployment.id = "praxity-deployment-config";
			deployment.textContent = JSON.stringify({ format });
			doc.body.append(deployment);
			const createRuntime = vi.fn();
			expect(
				initializeCourseHost(
					{ format, createRuntime },
					{
						win: doc.defaultView,
						doc,
						location: doc.defaultView.location,
						history: doc.defaultView.history,
					},
				),
			).toBe(false);
			expect(createRuntime).not.toHaveBeenCalled();
		},
	);
});
