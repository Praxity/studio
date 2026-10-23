import { getAllKeywords, readLesson } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, test } from "vitest";
import { renderBlockHtml } from "../../src/render-block-html";
import { AUTHORING_CATALOG, catalogSlug, catalogStarter } from "../fixtures/authoring-catalog";
import { type BuildResult, getBuild } from "./setup";

type CatalogCase = (typeof AUTHORING_CATALOG)[number];
function assertContent(root: ParentNode, entry: CatalogCase) {
	const blocks = root.querySelectorAll(`[data-block-type="${entry.type}"]`);
	expect(blocks.length, `${entry.keyword} must emit ${entry.type}`).toBeGreaterThan(0);
	for (const block of blocks) {
		const controls = block.querySelectorAll(entry.selector);
		expect(controls.length, `${entry.keyword}: ${entry.selector}`).toBe(
			"count" in entry ? entry.count : 1,
		);
		for (const text of entry.texts) expect(block.textContent).toContain(text);
		if (entry.type === "assessment") {
			expect(block.querySelector("fieldset, legend")).toBeTruthy();
			for (const control of block.querySelectorAll("input, select, textarea, button")) {
				expect(control.hasAttribute("disabled"), `${entry.keyword} fallback must be inert`).toBe(
					true,
				);
			}
		}
	}
	if (entry.keyword === "hotspot") {
		expect(root.querySelector('img[alt="Describe the image"]')).toBeTruthy();
		expect(root.querySelector('button[aria-label="Correct area"]')).toBeTruthy();
		expect(root.querySelector('button[aria-label="Distractor area"]')).toBeTruthy();
	}
	if (entry.keyword === "assessment-group") {
		const child = root.querySelector('[data-block-type="assessment"]');
		expect(child?.textContent).toContain("Choose the correct answer");
		expect(child?.querySelectorAll('input[type="radio"]')).toHaveLength(2);
	}
}

describe("authoring catalog static contract", () => {
	test("every advertised starter has an independent learner expectation", () => {
		expect(AUTHORING_CATALOG.map(({ keyword }) => keyword).sort()).toEqual(
			[...getAllKeywords()].sort(),
		);
	});
	for (const entry of AUTHORING_CATALOG) {
		test.each([false, true])(`${entry.keyword}, serialized=%s`, (serialized) => {
			const parsed = readLesson(catalogStarter(entry.keyword, serialized));
			const blocks = adaptGrammarPreviewBlocks(
				parsed.blocks.filter((block) => block.type !== "pageBreak"),
			);
			if ("response" in entry) {
				const assessments = blocks.filter((block) => block.type === "assessment");
				expect(assessments).toHaveLength(1);
				expect(assessments[0].data.response).toMatchObject({ type: entry.response });
			}
			const dom = new JSDOM(blocks.map((block) => renderBlockHtml(block)).join(""));
			assertContent(dom.window.document, entry);
			dom.window.close();
		});
	}
});

describe("authoring catalog compiled artifacts", () => {
	let build: BuildResult;
	beforeAll(async () => {
		build = await getBuild(true);
	}, 120_000);
	for (const entry of AUTHORING_CATALOG) {
		test.each([false, true])(`${entry.keyword}, serialized=%s`, (serialized) => {
			const slug = catalogSlug(entry.keyword, serialized);
			const page = build.pages.find(
				({ entryName }) => entryName.endsWith(`/${slug}.html`) || entryName === `${slug}.html`,
			);
			expect(page, `missing compiled page ${slug}`).toBeTruthy();
			if (!page) throw new Error(`Missing compiled page ${slug}`);
			assertContent(page.document, entry);
		});
	}
	test("starter media are packaged as real local assets", () => {
		for (const name of [
			"test-image.webp",
			"test-hotspot.webp",
			"test-audio.mp3",
			"test-video.mp4",
		]) {
			expect(build.zip.getEntries().some(({ entryName }) => entryName.endsWith(name))).toBe(true);
		}
	});
});

describe("static assessment accessibility and escaping", () => {
	test("matrix names each inert control by statement and scale point in French", async () => {
		const { getStrings } = await import("@praxity/shared-blocks/i18n/strings");
		const blocks = adaptGrammarPreviewBlocks(readLesson(catalogStarter("matrix")).blocks);
		const dom = new JSDOM(
			blocks.map((block) => renderBlockHtml(block, { strings: getStrings("fr") })).join(""),
		);
		const fieldset = dom.window.document.querySelector("fieldset");
		const stem = dom.window.document.getElementById(
			fieldset?.getAttribute("aria-labelledby") ?? "",
		);
		expect(stem?.matches("p.praxity-assessment-stem")).toBe(true);
		expect(stem?.textContent).toBe("How confident are you?");
		expect(
			Array.from(
				dom.window.document.querySelectorAll('th[scope="col"]'),
				(cell) => cell.textContent,
			),
		).toEqual(["", "Not confident", "Somewhat confident", "Confident"]);
		expect(
			dom.window.document.querySelector(
				'input[aria-label="Using the first skill: Not confident"][disabled]',
			),
		).toBeTruthy();
		dom.window.close();
	});
	test("hotspot URLs and names cannot inject markup, and coordinates stay within the image", () => {
		const block = adaptGrammarPreviewBlocks(
			readLesson(
				"# Diagram {hideTitle}\n::: hotspot Diagram\n![Diagram](/assets/diagram.png)\n- Area {x=30 y=40 correct}\n:::\n",
			).blocks,
		).find((item) => item.type === "assessment");
		if (!block) throw new Error("Missing hotspot starter assessment");
		const response = block.data.response as {
			image: string;
			hotspots: Array<{ label?: string; coords: number[] }>;
		};
		response.image = "javascript:alert(1)";
		response.hotspots[0].label = '<img src=x onerror="alert(1)"> Area';
		response.hotspots[0].coords = [-20, 120];
		const dom = new JSDOM(renderBlockHtml(block), { url: "https://praxity.test/" });
		expect(dom.window.document.querySelector("img")).toBeNull();
		expect(dom.window.document.querySelector("[onerror]")).toBeNull();
		const pin = dom.window.document.querySelector(".praxity-hotspot-region");
		expect((pin as HTMLElement)?.style.left).toBe("0%");
		expect((pin as HTMLElement)?.style.top).toBe("100%");
		dom.window.close();
	});
	test("rect and polygon hotspots keep their bounds and names in inert static HTML", () => {
		const source =
			'# Diagram {hideTitle}\n::: hotspot Equipment diagram\n![Equipment diagram](/assets/diagram.png)\n- Valve {shape=rect x=10 y=20 w=30 h=15 correct}\n- Panel {shape=polygon points="10 10, 40 10, 40 30, 10 30"}\n:::\n';
		const block = adaptGrammarPreviewBlocks(readLesson(source).blocks).find(
			(block) => block.type === "assessment",
		);
		if (!block) throw new Error("Missing converted hotspot assessment");
		const dom = new JSDOM(renderBlockHtml(block));
		const controls = [...dom.window.document.querySelectorAll(".praxity-hotspot-region")];
		expect(controls.map((node) => node.getAttribute("data-shape"))).toEqual(["rect", "polygon"]);
		expect((controls[0] as HTMLElement).style.width).toBe("30%");
		expect((controls[1].querySelector("button") as HTMLElement).style.clipPath).toContain(
			"polygon(",
		);
		expect(
			controls.map((node) => node.querySelector("button")?.getAttribute("aria-label")),
		).toEqual(["Valve", "Panel"]);
		// Hydration replaces these nodes, so a focusable fallback would drop the learner's focus.
		expect(controls.every((node) => node.querySelector("button")?.hasAttribute("disabled"))).toBe(
			true,
		);
		dom.window.close();
	});
});

describe("advertised option rendering effects", () => {
	const documentFor = (source: string) =>
		new JSDOM(
			adaptGrammarPreviewBlocks(readLesson(source).blocks)
				.map((block) => renderBlockHtml(block))
				.join(""),
		).window.document;
	test.each([
		["numeric", "1"],
		["emoji", "😞"],
		["likert", "Not confident"],
	] as const)("rating %s changes the visible scale", (style, firstLabel) => {
		const block = readLesson(catalogStarter("rate")).blocks.find(
			(block) => block.type === "rating",
		);
		if (!block) throw new Error("Missing converted rating block");
		block.data.style = style;
		const document = new JSDOM(renderBlockHtml(block)).window.document;
		expect(document.querySelector(".praxity-rating-visual")?.textContent).toBe(firstLabel);
		expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(3);
	});
	test("rating slider exposes a range and hides the radio scale", () => {
		const document = documentFor(catalogStarter("rate").replace("level=3", "level=3 style=slider"));
		expect(document.querySelector('input[type="range"][min="1"][max="3"]')).toBeTruthy();
		expect(document.querySelector(".praxity-rating-options")?.hasAttribute("hidden")).toBe(true);
	});
	test.each(["none", "numbered", "timeline"])(
		"sequence %s renders its intended markers",
		(variant) => {
			const document = documentFor(
				catalogStarter("sequence").replace("style=numbered", `style=${variant}`),
			);
			expect(document.querySelectorAll(".praxity-sequence-marker")).toHaveLength(
				variant === "none" ? 0 : 2,
			);
			expect(document.querySelectorAll(".praxity-accent-dot")).toHaveLength(0);
			expect(
				[...document.querySelectorAll(".praxity-accent-badge")].map((node) => node.textContent),
			).toEqual(variant === "none" ? [] : ["1", "2"]);
		},
	);
	test.each([
		["small", "33%"],
		["medium", "50%"],
		["large", "75%"],
		["full", ""],
	])("image width %s constrains the figure", (width, expected) => {
		const document = documentFor(
			catalogStarter("image").replace(/(!\[[^\]]*\]\([^)]*\))/, `$1{size=${width}}`),
		);
		expect(document.querySelector("figure")?.style.maxWidth).toBe(expected);
		expect(document.querySelector("img")?.style.width).toBe("100%");
	});
});

describe("card layouts, note tones, and quote semantics", () => {
	const documentFor = (source: string) =>
		new JSDOM(
			adaptGrammarPreviewBlocks(readLesson(source).blocks)
				.map((block) => renderBlockHtml(block))
				.join(""),
		).window.document;
	test.each(["grid", "masonry", "single"])("card layout %s changes layout structure", (layout) => {
		const document = documentFor(
			catalogStarter("card").replace(
				"columns=2",
				`columns=2 layout=${layout === "single" ? "slides" : layout}`,
			),
		);
		const root = document.querySelector<HTMLElement>("[data-card-root]");
		if (layout === "single") {
			expect(root?.getAttribute("aria-roledescription")).toBe("carousel");
			expect(root?.querySelector("[data-card-next][aria-label]")).toBeTruthy();
			expect(root?.querySelectorAll("[data-slide-position]")).toHaveLength(2);
		} else if (layout === "grid") {
			expect(root?.style.display).toBe("grid");
			expect(root?.style.gridTemplateColumns).toBe("repeat(2,minmax(0,1fr))");
		} else {
			expect(root?.style.columns).toBe("2");
			expect(root?.style.columnGap).toBe("16px");
		}
	});
	test.each([
		["accent", "Note"],
		["primary", "Note"],
		["secondary", "Note"],
		["success", "Note"],
		["warning", "Warning"],
		["error", "Warning"],
		["grey", "Note"],
	])("note color %s supplies the intended semantic label and icon", (color, label) => {
		const document = documentFor(
			catalogStarter("note").replace(
				"tone=note",
				`tone=${({ accent: "note", primary: "info", secondary: "info", success: "success", warning: "warning", error: "warning", grey: "tip" } as Record<string, string>)[color]}`,
			),
		);
		expect(document.querySelector(".praxity-note-label")?.textContent).toBe(label);
		expect(document.querySelectorAll(".praxity-note-icon svg, svg.praxity-note-icon")).toHaveLength(
			label === "Warning" ? 1 : 0,
		);
	});
	test("quote source parameters create attribution outside the quotation", () => {
		const document = documentFor(
			"# Findings {hideTitle}\n::: quote {source=https://example.com/study}\nFindings from the study.\nspeaker: Researcher\nwork: Study title\n:::\n",
		);
		expect(document.querySelector("blockquote")?.textContent).toBe("Findings from the study.");
		expect(document.querySelector("figcaption")?.textContent).toContain("Researcher");
		expect(document.querySelector("figcaption cite")?.textContent).toBe("Study title");
		expect(document.querySelector('figcaption a[href="https://example.com/study"]')).toBeTruthy();
	});
});
