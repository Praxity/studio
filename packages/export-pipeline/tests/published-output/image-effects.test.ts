import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, test } from "vitest";
import { buildScormPackage } from "../../src/build";
import { type BuildResult, blocksByType, getBuild } from "./setup";

let build: BuildResult;
beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Image effects and treatments", () => {
	test("populated legacy treatment inputs preserve canonical images, floats and captions", async () => {
		const images = [
			{
				id: "treated",
				type: "image",
				data: {
					src: "https://example.com/portrait.png",
					altText: "Portrait",
					width: "small",
					float: "left",
					treatment: "grayscale",
					effects: { progressiveBlur: { intensity: 8 } },
					caption: "Photo by [Alex](https://example.com/alex)",
				},
			},
			{
				id: "decorative",
				type: "image",
				data: {
					src: "https://example.com/decoration.png",
					decorative: true,
					treatment: "grain",
					imageHover: "tilt",
				},
			},
		] as const;
		expect(images.filter((image) => typeof image.data.treatment === "string")).toHaveLength(2);
		const result = await buildScormPackage(
			{
				id: "image-effects",
				title: "Images",
				sourceLocale: "en",
				content: [{ id: "images", title: "Images", blocks: images as never }],
			},
			{ format: "html" },
		);
		const zip = new AdmZip(result.zip);
		const entry = zip
			.getEntries()
			.find(
				(entry) =>
					entry.entryName.endsWith(".html") &&
					zip.readAsText(entry).includes('data-block-id="treated"'),
			);
		expect(entry).toBeTruthy();
		if (!entry) throw new Error("Missing compiled image fixture");
		const document = new JSDOM(zip.readAsText(entry)).window.document;
		expect(document.querySelectorAll('[data-block-type="image"]')).toHaveLength(2);
		const treated = document.querySelector('[data-block-id="treated"]');
		expect(treated?.querySelectorAll("img")).toHaveLength(1);
		expect(treated?.querySelector("img")?.getAttribute("alt")).toBe("Portrait");
		expect(treated?.querySelector("figure")?.getAttribute("data-image-float")).toBe("left");
		expect(treated?.querySelector("figure")?.getAttribute("data-image-width")).toBe("small");
		expect(treated?.querySelector("figcaption a")?.textContent).toBe("Alex");
		expect(treated?.querySelector("figcaption a")?.getAttribute("href")).toBe(
			"https://example.com/alex",
		);
		expect(document.querySelector('[data-block-id="decorative"] img')?.getAttribute("alt")).toBe(
			"",
		);
		// Treatments and composable effects were retired before these React helpers were removed.
		expect(
			document.querySelector(
				'[class*="praxity-image-treatment-"], .praxity-blur-clone, [data-praxity-effects]',
			),
		).toBeNull();
	});
	test("image hover effect attribute on html element", () => {
		let checkedPages = 0;
		for (const page of build.pages) {
			const htmlEl = page.document.documentElement;
			if (!htmlEl.hasAttribute("data-praxity-root")) continue;
			expect(htmlEl.getAttribute("data-praxity-image-hover")).toBeTruthy();
			checkedPages += 1;
		}
		expect(checkedPages).toBeGreaterThan(0);
	});
	test("all image blocks have alt attributes", () => {
		const images = blocksByType(build.blocks, "image");
		expect(images.length).toBeGreaterThan(0);
		for (const block of images)
			expect(
				block.element.querySelector("img")?.hasAttribute("alt"),
				`image ${block.id} missing alt`,
			).toBe(true);
	});
});
