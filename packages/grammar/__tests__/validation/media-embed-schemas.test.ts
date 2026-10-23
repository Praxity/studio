import type { PraxityBlock } from "@praxity/content-model/types";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/validation/validate.ts";

function createBlock(type: PraxityBlock["type"], data: Record<string, unknown>): PraxityBlock {
	return {
		id: `${type}-0`,
		type,
		data,
	};
}

describe("media and embed schemas", () => {
	it("warns when video captions are missing", () => {
		const result = validate(
			[
				createBlock("video", {
					src: "https://example.com/video.mp4",
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "video-missing-captions", level: "warning" }),
			]),
		);
	});

	it("rejects an unsafe caption attachment path", () => {
		const result = validate(
			[
				createBlock("video", {
					src: "/assets/intro.mp4",
					captions: "/assets/../private.vtt",
				}),
			],
			"",
			{ strictness: "normal" },
		);
		expect(result.errors.map((error) => error.id)).toEqual(
			expect.arrayContaining(["invalid-caption-track", "video-missing-captions"]),
		);
	});

	it("does not count a local VTT on a hosted iframe video", () => {
		const result = validate(
			[
				createBlock("video", {
					src: "https://youtu.be/dQw4w9WgXcQ",
					captions: "/assets/intro.vtt",
				}),
			],
			"",
			{ strictness: "normal" },
		);
		expect(result.errors.map((error) => error.id)).toContain("video-missing-captions");
	});

	it("warns when audio transcript is missing", () => {
		const result = validate(
			[
				createBlock("audio", {
					src: "https://example.com/audio.mp3",
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "audio-missing-transcript", level: "warning" }),
			]),
		);
	});

	it("flags unsafe embed urls as critical", () => {
		const result = validate(
			[
				createBlock("embed", {
					src: "https://praxity.io/internal/embed",
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "unsafe-embed-url", level: "critical", attribute: "src" }),
			]),
		);
	});

	it("validates note style and color enums", () => {
		const result = validate(
			[
				createBlock("note", {
					style: "wireframe",
					color: "magenta",
				}),
			],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "invalid-style", attribute: "style" }),
				expect.objectContaining({ id: "invalid-color", attribute: "color" }),
			]),
		);
	});

	it("accepts any kebab-case Tabler icon name", () => {
		const result = validate(
			[createBlock("note", { color: "secondary", icon: "thinking-high" })],
			"",
			{ strictness: "normal" },
		);

		expect(result.errors).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ attribute: "color" }),
				expect.objectContaining({ attribute: "icon" }),
			]),
		);
	});

	it("rejects unsafe icon-name syntax", () => {
		const result = validate([createBlock("note", { icon: "../thinking-high" })], "", {
			strictness: "normal",
		});

		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "invalid-icon-format", attribute: "icon" }),
			]),
		);
	});
});
