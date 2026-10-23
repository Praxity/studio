import { beforeAll, describe, expect, test } from "vitest";
import { type BuildResult, getBuild } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Page-level content integrity", () => {
	const METADATA_ONLY_TYPES = new Set(["variable", "logic", "pageBreak", "blockBreak"]);

	test("every page has visible content beyond just headings", () => {
		for (const page of build.pages) {
			const root = page.document.querySelector("#main-content");
			if (!root) continue;
			// Remove all heading elements, then check if remaining content has text
			const clone = root.cloneNode(true) as Element;
			for (const h of clone.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
				h.remove();
			}
			// Also remove empty metadata blocks (variable, logic, etc.)
			for (const empty of clone.querySelectorAll("[data-block-type]")) {
				if ((empty.textContent ?? "").trim().length === 0) {
					empty.remove();
				}
			}
			const remainingText = (clone.textContent ?? "").trim();
			expect(
				remainingText.length,
				`${page.entryName} has only headings and empty blocks — learner sees no real content`,
			).toBeGreaterThan(0);
		}
	});

	test("pages with only metadata blocks still have useful content or are omitted", () => {
		for (const page of build.pages) {
			const pageBlocks = build.blocks.filter((b) => b.entryName === page.entryName);
			const visibleBlocks = pageBlocks.filter((b) => !METADATA_ONLY_TYPES.has(b.type));
			if (visibleBlocks.length === 0 && pageBlocks.length > 0) {
				// Page has blocks but they're all metadata — check the page still has content
				const root = page.document.querySelector("#main-content");
				const bodyText = (root?.textContent ?? "").trim();
				expect(
					bodyText.length,
					`${page.entryName} contains only metadata blocks (${pageBlocks.map((b) => b.type).join(", ")}) with no visible content`,
				).toBeGreaterThan(20);
			}
		}
	});
});

describe("Runtime plan packaging", () => {
	test("emitted island metadata, loader, and packaged entry assets stay in sync", () => {
		const packagedFiles = new Set(build.zip.getEntries().map((entry) => entry.entryName));
		for (const page of build.pages) {
			const root = page.document.documentElement;
			const islands = (root.getAttribute("data-praxity-islands") ?? "").split(",").filter(Boolean);
			const loader = Array.from(page.document.querySelectorAll("script[src]"))
				.map((script) => script.getAttribute("src") ?? "")
				.find((src) => src.startsWith("island-loader-"));

			expect(Boolean(loader), `${page.entryName} loader mismatch`).toBe(islands.length > 0);
			if (loader) expect(packagedFiles.has(loader), `${loader} is not packaged`).toBe(true);
			for (const island of islands) {
				const asset = root.getAttribute(
					`data-island-${island.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
				);
				expect(asset, `${page.entryName} missing ${island} asset metadata`).toBeTruthy();
				if (asset) expect(packagedFiles.has(asset), `${asset} is not packaged`).toBe(true);
			}
		}
	});

	test("React islands have block JSON while DOM enhancements use the semantic baseline", () => {
		for (const page of build.pages) {
			const islandBlocks = build.blocks.filter(
				(b) => b.entryName === page.entryName && b.element.hasAttribute("data-island"),
			);
			for (const block of islandBlocks) {
				// Assessment is the React block island. Media and the other DOM islands
				// read server-rendered content and attributes rather than hydrating JSON.
				if (block.element.getAttribute("data-island") !== "assessment") {
					expect(block.element.hasAttribute("data-block-json")).toBe(false);
					continue;
				}
				const json = block.element.getAttribute("data-block-json");
				expect(json, `island block ${block.id} missing data-block-json`).toBeTruthy();
				if (json) {
					expect(() => JSON.parse(json)).not.toThrow();
				}
			}
		}
	});
});
