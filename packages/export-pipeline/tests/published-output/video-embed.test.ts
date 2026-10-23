import { beforeAll, describe, expect, test } from "vitest";
import { type BuildResult, blocksByType, getBuild } from "./setup";

let build: BuildResult;

beforeAll(async () => {
	build = await getBuild();
}, 120_000);

describe("Video and embed blocks", () => {
	test("video iframes have title attribute", () => {
		const videos = blocksByType(build.blocks, "video");
		for (const block of videos) {
			const iframe = block.element.querySelector("iframe");
			if (iframe) {
				expect(iframe.getAttribute("title"), `video ${block.id} iframe missing title`).toBeTruthy();
			}
		}
	});

	test("embed blocks have sandbox attribute", () => {
		const embeds = blocksByType(build.blocks, "embed");
		for (const block of embeds) {
			const iframe = block.element.querySelector("iframe");
			if (iframe) {
				expect(iframe.hasAttribute("sandbox"), `embed ${block.id} missing sandbox`).toBe(true);
				expect(iframe.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
			}
		}
	});

	test("audio blocks have controls", () => {
		const audios = blocksByType(build.blocks, "audio");
		for (const block of audios) {
			const audio = block.element.querySelector("audio");
			if (audio) {
				expect(audio.hasAttribute("controls"), `audio ${block.id} missing controls`).toBe(true);
			}
		}
	});
});
