import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";
import { readBlockFixture as readBlockSource } from "../helpers/lesson-fixture.ts";

function createImageBlock(data: Record<string, unknown>): PraxityBlock {
	return {
		id: "image-0",
		type: "image",
		data,
	};
}

describe("image schema", () => {
	it("requires src", () => {
		const result = validate([createImageBlock({ alt: "A cat" })], "/assets/cat.jpg\nalt: A cat", {
			strictness: "normal",
		});

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "missing-src", level: "error", blockType: "image" }),
			]),
		);
	});

	it("flags unsafe image src as critical", () => {
		const result = validate(
			[createImageBlock({ src: "javascript:alert(1)", alt: "A cat" })],
			"/assets/cat.jpg\nalt: A cat",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "unsafe-media-url", level: "critical", attribute: "src" }),
			]),
		);
	});

	it("requires alt text unless decorative", () => {
		const result = validate(
			[createImageBlock({ src: "https://example.com/cat.jpg" })],
			"/assets/cat.jpg",
			{
				strictness: "normal",
			},
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "missing-alt-text", level: "error", attribute: "altText" }),
			]),
		);
	});

	it("allows missing alt when decorative is true", () => {
		const result = validate(
			[createImageBlock({ src: "https://example.com/cat.jpg", decorative: true })],
			"/assets/cat.jpg\ndecorative: true",
			{ strictness: "normal" },
		);

		expect(result.errors.some((error) => error.id === "missing-alt-text")).toBe(false);
	});

	it("validates width, float, and alignment enums", () => {
		const result = validate(
			[
				createImageBlock({
					src: "https://example.com/cat.jpg",
					alt: "A cat",
					width: "giant",
					float: "around",
					alignment: "top",
				}),
			],
			"/assets/cat.jpg\nalt: A cat\nwidth: giant\nfloat: around\nalignment: top",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "invalid-width", attribute: "width" }),
				expect.objectContaining({ id: "invalid-float", attribute: "float" }),
				expect.objectContaining({ id: "invalid-alignment", attribute: "alignment" }),
			]),
		);
	});

	it("rejects legacy full-frame values in width", () => {
		const result = validate(
			[createImageBlock({ src: "https://example.com/cat.jpg", alt: "A cat", width: "full" })],
			"/assets/cat.jpg\nalt: A cat\nwidth: full",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "invalid-width", attribute: "width" }),
			]),
		);
	});

	it("warns when float has no width or conflicts with layout", () => {
		const result = validate(
			[
				createImageBlock({
					src: "https://example.com/cat.jpg",
					alt: "A cat",
					float: "left",
					layout: "wide",
				}),
			],
			"/assets/cat.jpg\nalt: A cat\nfloat: start\nlayout: wide",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "image-float-requires-width", attribute: "float" }),
				expect.objectContaining({ id: "image-float-conflicts-layout", attribute: "float" }),
			]),
		);
	});

	it("catches missing alt text on a parsed grammar 4 image", () => {
		const source = "# Photos {hideTitle}\n\n![](https://example.com/photo.jpg)\n";
		const { blocks, spans } = readBlockSource(source);
		const result = validate(blocks, source, { strictness: "normal", spans });
		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "missing-alt-text", blockType: "image" }),
			]),
		);
	});

	it("attaches source line numbers to parsed grammar 4 images", () => {
		const source = `---
title: Demo
---

# Photos {hideTitle}

![](https://example.com/photo.jpg)
`;
		const { blocks, spans } = readBlockSource(source);
		const result = validate(blocks, source, { strictness: "normal", spans });
		const missingAlt = result.errors.find((error) => error.id === "missing-alt-text");
		expect(missingAlt?.line).toBe(7);
	});
});
