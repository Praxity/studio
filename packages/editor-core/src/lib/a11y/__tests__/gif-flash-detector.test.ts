import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { checkCourseAccessibility } from "../checker";
import { analyzeGifFlashes, findFlashingGifSources } from "../gif-flash-detector";

async function fixture(name: string): Promise<Uint8Array> {
	const packageRoot = process.cwd().endsWith("packages/editor-core")
		? process.cwd()
		: path.join(process.cwd(), "packages/editor-core");
	return readFile(path.join(packageRoot, "src/lib/a11y/__tests__/fixtures/gif-flash", name));
}

describe("analyzeGifFlashes", () => {
	it("flags a real GIF with more than three full-frame flashes per second", async () => {
		const bytes = await fixture("flashing.gif");
		const result = analyzeGifFlashes(bytes);
		const pages: PraxityPage[] = [
			{
				id: "lesson",
				title: "Lesson",
				blocks: [
					{
						id: "image",
						type: "image",
						data: { src: "/assets/flashing.gif", alt: "Alternating signal" },
					},
				],
			},
		];
		const flashingGifSources = await findFlashingGifSources(pages, async () => bytes);
		const report = checkCourseAccessibility(pages, { flashingGifSources });

		expect(result).toMatchObject({ analyzed: true, exceedsThreshold: true });
		expect(result.flashCount).toBeGreaterThan(3);
		expect(report.issues).toContainEqual(
			expect.objectContaining({ rule: "gif-flash-threshold", blockId: "image" }),
		);
	});

	it("does not flag a real GIF with a small moving region", async () => {
		expect(analyzeGifFlashes(await fixture("benign.gif"))).toEqual({
			analyzed: true,
			exceedsThreshold: false,
			flashCount: 0,
		});
	});
});
