import { describe, expect, it } from "vitest";
import { extractDesktopDesignFromFrontmatter } from "../desktop-design";

describe("published reading rhythm design compatibility", () => {
	it.each([
		[undefined, "calc(var(--praxity-space-section) * 1)"],
		[48, "calc(var(--praxity-space-section) * 1)"],
		[56, `calc(var(--praxity-space-section) * ${56 / 48})`],
		[1.1, "calc(var(--praxity-space-section) * 1.1)"],
	] as const)("normalizes legacy sectionGap %s", (sectionGap, _expected) => {
		const design = extractDesktopDesignFromFrontmatter({
			design: (sectionGap === undefined ? {} : { sectionGap }) as never,
		});

		expect(design.cssVars).not.toHaveProperty("--praxity-section-gap");
	});
});
