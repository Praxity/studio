import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { viewerSourceFiles } from "../bundle-viewer";
import { desktopCssInputs } from "../export-css";
import { generateHtmlPage, prepareHtmlCourse, renderHtmlDocument } from "../html-gen";
import { getBlockIsland, planModuleRuntime, planPageRuntime } from "../runtime-plan";

it("inventories owned presentation sources for hashing and offline CSS", async () => {
	const renderSource = fileURLToPath(new URL("../patterns/highlight/render.ts", import.meta.url));
	const css = fileURLToPath(new URL("../patterns/highlight/style.css", import.meta.url));
	const license = fileURLToPath(new URL("../patterns/highlight/LICENSE", import.meta.url));
	const files = await viewerSourceFiles();
	expect(files).toContain(renderSource);
	expect(files).toContain(css);
	expect(files).toContain(license);
	expect(await desktopCssInputs()).toContainEqual(
		expect.objectContaining({ source: css, assetPath: "css-sources/patterns/highlight/style.css" }),
	);
});

it("plans highlight explicitly, including nested and later deck blocks, and refuses missing JS", async () => {
	const highlight = { id: "hl", type: "highlight" as const, data: {} };
	const page = { id: "p", title: "P", blocks: [] };
	const config = {
		sourceLocale: "en",
		navigationStyle: "sidebar" as const,
		navToggles: { navTopBar: false, showA11yPill: false },
	};
	expect(getBlockIsland(highlight)).toBe("highlight");
	expect(planPageRuntime(config, { ...page, blocks: [highlight] }, true).islands).toEqual([
		"highlight",
	]);
	expect(
		planModuleRuntime(config, [page, { ...page, id: "later", blocks: [highlight] }], true).islands,
	).toEqual(["deck", "highlight"]);
	expect(
		planPageRuntime(
			config,
			{
				...page,
				blocks: [
					{
						id: "panel",
						type: "accordion",
						data: { items: [{ id: "i", title: "I", blocks: [highlight] }] },
					},
				],
			},
			true,
		).islands,
	).toEqual(["accordion", "highlight"]);
	expect(() => planPageRuntime(config, { ...page, blocks: [highlight] }, new Set())).toThrow(
		"Required island assets unavailable: highlight",
	);
	expect(planPageRuntime(config, page, new Set()).islands).toEqual([]);
});

it("selects synchronous highlight CSS only from the explicit runtime plan", async () => {
	const base = {
		config: {
			id: "c",
			title: "C",
			sourceLocale: "en",
			pages: [],
			totalPages: 1,
			navigationStyle: "sidebar" as const,
			navToggles: { navTopBar: false, showA11yPill: false },
		},
		page: { id: "p", title: "P", blocks: [] },
		index: 0,
		currentSlug: "p",
		slugList: [],
		slugMap: new Map<string, string>(),
	};
	const unchanged = generateHtmlPage(base);
	expect(generateHtmlPage({ ...base, highlightStylesheetFilename: "highlight.HASH.css" })).toBe(
		unchanged,
	);
	expect(unchanged).not.toContain("highlight.css");
	expect(unchanged).not.toContain('data-island="highlight"');
	const runtimePlan = {
		mode: "islands" as const,
		islands: ["highlight" as const],
		legacyReasons: [] as [],
	};
	expect(() => generateHtmlPage({ ...base, runtimePlan })).toThrow(
		"Required highlight stylesheet unavailable",
	);
	const usedStylesheets = new Set<string>();
	const html = generateHtmlPage({
		...base,
		runtimePlan,
		highlightStylesheetFilename: "highlight.HASH.css",
		usedStylesheets,
	});
	expect(html).toContain('<link rel="stylesheet" href="highlight.HASH.css" />');
	expect(html.indexOf('href="highlight.HASH.css"')).toBeLessThan(html.indexOf('href="styles.css"'));
	expect(usedStylesheets.has("highlight.HASH.css")).toBe(true);
});

it("preview document options select the existing prepared highlight stylesheet", () => {
	const page = { id: "p", title: "P", blocks: [] };
	const config = { id: "c", title: "C", sourceLocale: "en", totalPages: 1, pages: [page] };
	const prepared = prepareHtmlCourse(config);
	prepared.pageRuntimePlans.set("p", {
		mode: "islands",
		islands: ["highlight"],
		legacyReasons: [],
	});
	const html = renderHtmlDocument(prepared, prepared.firstSlug, {}, () => "<p>Baseline</p>");
	expect(html).toContain('<link rel="stylesheet" href="highlight.css" />');
});
