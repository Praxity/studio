import { describe, expect, it } from "vitest";
import { traverseAssetGraph } from "../asset-graph";
import type { PraxityPage } from "../types";

const PAGE_FIXTURE: PraxityPage[] = [
	{
		id: "page-1",
		title: "Page",
		blocks: [
			{
				id: "blk-1",
				type: "assessment",
				data: {
					title: "Question",
					imageSrc: "https://cdn.example.com/root.png",
					response: {
						type: "choice",
						options: [
							{
								id: "o1",
								image: "https://cdn.example.com/opt-1.png",
							},
						],
					},
					items: [
						{
							children: [
								{
									id: "nested-1",
									type: "image",
									data: {
										src: "https://cdn.example.com/child.png",
										alt: "child",
									},
								},
							],
						},
					],
				},
			},
			{
				id: "blk-2",
				type: "embed",
				data: {
					src: "https://www.youtube.com/watch?v=abc123",
				},
			},
		],
	},
];

describe("traverseAssetGraph", () => {
	it("collects asset fields from deeply nested arrays and objects", async () => {
		const collected: string[] = [];
		const paths: string[] = [];

		const result = await traverseAssetGraph(PAGE_FIXTURE, {
			onAsset: ({ value, path }) => {
				collected.push(value);
				paths.push(path.join("."));
			},
		});

		expect(result).toBe(PAGE_FIXTURE);
		expect(collected).toEqual([
			"https://cdn.example.com/root.png",
			"https://cdn.example.com/opt-1.png",
			"https://cdn.example.com/child.png",
			"https://www.youtube.com/watch?v=abc123",
		]);
		expect(paths).toEqual([
			"imageSrc",
			"response.options.0.image",
			"items.0.children.0.data.src",
			"src",
		]);
	});

	it("rewrites deep asset fields while preserving non-asset fields", async () => {
		const rewritten = await traverseAssetGraph(PAGE_FIXTURE, {
			rewriteAsset: ({ value }) => `proxy:${value}`,
		});

		const data = rewritten[0].blocks[0].data as Record<string, unknown>;
		expect(data.title).toBe("Question");
		expect(data.imageSrc).toBe("proxy:https://cdn.example.com/root.png");

		const response = data.response as { options: Array<{ image: string }> };
		expect(response.options[0].image).toBe("proxy:https://cdn.example.com/opt-1.png");

		const items = data.items as Array<{ children: Array<{ data: { src: string } }> }>;
		expect(items[0].children[0].data.src).toBe("proxy:https://cdn.example.com/child.png");
	});

	it("leaves avatar none sentinels out of collection and rewriting", async () => {
		const pages: PraxityPage[] = [
			{
				id: "dialogue-page",
				title: "Dialogue",
				blocks: [
					{
						id: "dialogue",
						type: "dialogue",
						data: {
							speakers: {
								alex: { avatar: "none" },
								blair: { avatar: "NoNe" },
								casey: { avatar: " NONE " },
								drew: { avatar: "assets/drew.png" },
							},
						},
					},
				],
			},
		];
		const seen: string[] = [];
		await traverseAssetGraph(pages, {
			onAsset: ({ value }) => {
				seen.push(value);
			},
		});
		expect(seen).toEqual(["assets/drew.png"]);
		seen.length = 0;
		const rewritten = await traverseAssetGraph(pages, {
			onAsset: ({ value }) => {
				seen.push(value);
			},
			rewriteAsset: ({ value }) => `packaged:${value}`,
		});
		expect(seen).toEqual(["assets/drew.png"]);
		expect(rewritten[0].blocks[0].data.speakers).toEqual({
			alex: { avatar: "none" },
			blair: { avatar: "NoNe" },
			casey: { avatar: " NONE " },
			drew: { avatar: "packaged:assets/drew.png" },
		});
	});

	it("supports block skipping for both walk and rewrite adapters", async () => {
		const seen: string[] = [];
		const rewritten = await traverseAssetGraph(
			PAGE_FIXTURE,
			{
				onAsset: ({ value }) => {
					seen.push(value);
				},
				rewriteAsset: ({ value }) => `rewritten:${value}`,
			},
			{
				shouldSkipBlock: (block) => block.type === "embed",
			},
		);

		expect(seen).not.toContain("https://www.youtube.com/watch?v=abc123");
		const embedData = rewritten[0].blocks[1].data as { src: string };
		expect(embedData.src).toBe("https://www.youtube.com/watch?v=abc123");
	});
});

it("discovers and rewrites narration on page metadata as well as blocks", async () => {
	const pages = [
		{
			id: "title-audio",
			title: "Title",
			data: { narrationAudio: "https://example.com/title.mp3" },
			blocks: [],
		},
	];
	const discovered: string[] = [];
	await traverseAssetGraph(pages, {
		onAsset: ({ value }) => {
			discovered.push(value);
		},
	});
	expect(discovered).toEqual(["https://example.com/title.mp3"]);
	const rewritten = await traverseAssetGraph(pages, { rewriteAsset: () => "./assets/title.mp3" });
	expect(rewritten[0].data?.narrationAudio).toBe("./assets/title.mp3");
	expect(pages[0].data.narrationAudio).toBe("https://example.com/title.mp3");
});

it("rewrites a video caption track along with its video", async () => {
	const pages: PraxityPage[] = [
		{
			id: "video-page",
			title: "Video",
			blocks: [
				{
					id: "video",
					type: "video",
					data: {
						src: "/assets/intro.mp4",
						captionTracks: [
							{ kind: "captions", language: "und", label: "", src: "/assets/intro.en.vtt" },
						],
					},
				},
			],
		},
	];
	const found: string[] = [];
	const rewritten = await traverseAssetGraph(pages, {
		onAsset: ({ value }) => {
			found.push(value);
		},
		rewriteAsset: ({ value }) => value.replace("/assets/", "assets/"),
	});
	expect(found).toEqual(["/assets/intro.mp4", "/assets/intro.en.vtt"]);
	expect((rewritten[0].blocks[0].data.captionTracks as Array<{ src: string }>)[0].src).toBe(
		"assets/intro.en.vtt",
	);
});
