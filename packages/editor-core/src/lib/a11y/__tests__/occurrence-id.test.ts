import { describe, expect, it } from "vitest";
import { buildA11yOccurrenceId } from "../occurrence-id";

describe("buildA11yOccurrenceId", () => {
	const occurrence = {
		rule: "image-alt",
		pageId: "lesson-1",
		blockId: "hero-image",
		sourceLocation: "data.altText",
	};

	it("ignores evidence wording and scan order", () => {
		const original = { ...occurrence, message: "Image is missing alt text" };
		const reworded = { ...occurrence, message: "Add an image description" };
		expect(buildA11yOccurrenceId(original)).toBe(buildA11yOccurrenceId(reworded));
	});

	it("changes when the authored source target changes", () => {
		expect(buildA11yOccurrenceId(occurrence)).not.toBe(
			buildA11yOccurrenceId({ ...occurrence, sourceLocation: "data.caption" }),
		);
	});
});
