import { describe, expect, it } from "vitest";
import {
	detectVideoSource,
	getYouTubeFacadeSrcDoc,
	getYouTubeThumbnailUrl,
	isEmbeddableUrl,
	isYouTubeEmbed,
	toEmbedUrl,
} from "./url-utils";

describe("video embed URLs", () => {
	it("accepts exact HTTPS providers and rejects lookalike hosts", () => {
		expect(toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
		);
		expect(isYouTubeEmbed("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe(true);
		expect(isEmbeddableUrl("https://player.vimeo.com/video/12345")).toBe(true);
		expect(isEmbeddableUrl("https://www.loom.com/embed/abc-123")).toBe(true);

		expect(isEmbeddableUrl("https://youtube.com.evil.example/embed/dQw4w9WgXcQ")).toBe(false);
		expect(isEmbeddableUrl("https://evil.example/youtube.com/embed/dQw4w9WgXcQ")).toBe(false);
		expect(isEmbeddableUrl("http://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(false);
		expect(detectVideoSource("https://youtube.com.evil.example/watch?v=x")).toBe("unknown-embed");
	});

	it("normalizes embeds and builds a script-free click-to-load facade", () => {
		const url = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
		expect(toEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ?start=4")).toBe(
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=4",
		);
		expect(getYouTubeThumbnailUrl(url)).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
		const srcDoc = getYouTubeFacadeSrcDoc(url, 'A "safe" video');
		expect(srcDoc).toContain("autoplay=1");
		expect(srcDoc).toContain("Play A &quot;safe&quot; video");
		expect(srcDoc).not.toContain("<script");
	});
});
