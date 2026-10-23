import { beforeAll, describe, expect, test } from "vitest";
import { type BuildResult, getBuild } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Section rhythm and palettes", () => {
	test("section wrappers have palette data attribute", () => {
		let sectionCount = 0;
		for (const page of build.pages) {
			const sections = page.document.querySelectorAll("[data-section-palette]");
			sectionCount += sections.length;
		}
		const usesSectionWrappers = Array.from(build.configByEntry.values()).some((config) => {
			const rhythm = (config as { sectionRhythm?: unknown }).sectionRhythm;
			const texture = (config as { texture?: unknown }).texture;
			return (
				(typeof rhythm === "string" && rhythm !== "uniform") ||
				(typeof texture === "string" && texture !== "none")
			);
		});
		if (usesSectionWrappers) {
			expect(sectionCount).toBeGreaterThan(0);
		} else {
			expect(sectionCount).toBe(0);
		}
	});
});
