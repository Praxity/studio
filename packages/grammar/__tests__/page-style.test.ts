import { describe, expect, it } from "vitest";
import { serializeFrontmatter } from "../src/index";

import { readLessonFixture as readSource, replayLesson } from "./helpers/lesson-fixture.ts";

describe("named page styles", () => {
	it("preserves the canonical dictionary on save without rewriting the legacy alias", () => {
		const source =
			"---\npageStyles: {}\nstyles:\n  old:\n    cornerImage: assets/old.png\n---\n\n# Title\n";
		const parsed = readSource(source);
		const restored = readSource(serializeFrontmatter(parsed.frontmatter, "# Title"));
		expect(restored.frontmatter.pageStyles).toEqual({});
		expect(restored.frontmatter.styles).toEqual({ old: { cornerImage: "assets/old.png" } });
	});
	it("retains opening H1 and explicit page references through parse-save-parse", () => {
		const parsed = readSource("# Opening {style=illustrated}\n\nBody.\n\n# Next {style=other}\n");
		expect(parsed.blocks[0].data.pageStyle).toBe("illustrated");
		const restored = readSource(replayLesson(parsed));
		expect(restored.blocks[0].data.pageStyle).toBe("illustrated");
		expect(restored.blocks.filter((block) => block.type === "pageBreak")[1]?.data.pageStyle).toBe(
			"other",
		);
	});
});
