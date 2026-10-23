import { expect, test } from "@playwright/test";
import { readLesson, serializeFrontmatter } from "@praxity/grammar";
import { normalizeDesignVariants } from "../../../editor-core/src/lib/themes/normalize-design-variants";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { generateCourseCss } from "../../src/html-gen";

const shapes = [
	["legacy serif without body", { headings: { fontFamily: ["Source Serif 4", "serif"] } }, "sans"],
	["empty typography", {}, "sans"],
	["null body", { body: null }, "sans"],
	["non-array body family", { body: { fontFamily: "Atkinson Hyperlegible" } }, "sans"],
	["per-level only", { headings: { h1: { fontFamily: ["Source Serif 4", "serif"] } } }, "sans"],
	["unknown id", { pairing: "unknown" }, "sans"],
	["explicit Book", { pairing: "book" }, "book"],
	["legacy Atkinson", { body: { fontFamily: ["Atkinson Hyperlegible", "sans-serif"] } }, "clear"],
] as const;

for (const palette of ["ink", "forest", "plum", "clay", "clear"])
	for (const [name, typography, pairing] of shapes)
		test(`${palette}: ${name} retains its pairing through an unrelated edit and export`, async ({
			page,
		}) => {
			const content = "# Review\n\nBody sample.\n";
			const source = `---\ntitle: Review\ndesign: ${JSON.stringify({ palette, typography })}\n---\n\n${content}`;
			const parsed = readLesson(source);
			const before = extractDesktopDesignFromFrontmatter(parsed.frontmatter);
			const loaded = normalizeDesignVariants(parsed.frontmatter.design);
			const saved = serializeFrontmatter(
				{ ...parsed.frontmatter, design: { ...loaded, lineHeight: 2 } },
				content,
			);
			const reloaded = readLesson(saved);
			const after = extractDesktopDesignFromFrontmatter(reloaded.frontmatter);
			for (const design of [
				loaded,
				normalizeDesignVariants(reloaded.frontmatter.design),
				before,
				after,
			])
				expect.soft(design.typography?.pairing).toBe(pairing);
			const body = pairing === "clear" ? "Atkinson Hyperlegible Next" : "Source Sans 3";
			const heading = pairing === "book" ? "Source Serif 4" : body;
			for (const design of [before, after]) {
				await page.setContent(`<style>${generateCourseCss({ ...design, colorMode: "light" })}
				p{font-family:var(--praxity-font-family)}h1{font-family:var(--praxity-font-heading)}</style>
				<main><h1>Review</h1><p>Body sample.</p></main>`);
				await expect.soft(page.locator("p")).toHaveCSS("font-family", `"${body}", sans-serif`);
				await expect
					.soft(page.locator("h1"))
					.toHaveCSS("font-family", `"${heading}", ${pairing === "book" ? "serif" : "sans-serif"}`);
			}
		});
