import { describe, expect, it } from "vitest";
import { previewRenderDraftSchema } from "../../../apps/desktop/src/shared/editor-session";
import { isFrameCommand, isFrameView } from "../../editor-core/src/frame-bridge/protocol";
import { renderBlockHtml } from "../src/render-block-html";

const runtimeId = "rt-00000000000000000000000000001003";
const durableId = "00000000-0000-4000-8000-000000001003";

describe("display runtime-ID acceptance table", () => {
	const identity = { channel: "channel", pageId: runtimeId };
	const rows: Array<[string, (id: string) => boolean]> = [
		[
			"frame view",
			(id) =>
				isFrameView({
					file: "a.prax",
					pageId: id,
					language: "en",
					alwaysShowHandles: true,
					nodes: [{ id, kind: "page", parentId: null, name: "P", description: "Page" }],
					selected: [id],
					expanded: [id],
					focus: { file: "a.prax", nodeId: id, role: "handle" },
				}),
		],
		[
			"preview draft schema",
			(id) =>
				previewRenderDraftSchema.safeParse({
					transactionId: "draft",
					pageId: id,
					nodeId: id,
					seq: 1,
					source: "Text",
				}).success,
		],
		[
			"data-node-id rendering",
			(id) =>
				renderBlockHtml({ id, type: "text", data: { content: "<p>Words</p>" } }).includes(
					`data-node-id="${id}"`,
				),
		],
		[
			"patch protocol",
			(id) =>
				isFrameCommand(
					{
						source: "praxity-editor",
						version: 1,
						...identity,
						action: "patch",
						patch: {
							pageId: runtimeId,
							seq: 1,
							order: [id],
							fragments: [{ id, html: "<p>Words</p>" }],
							shellStale: false,
						},
						documentRegions: [],
					},
					identity,
				),
		],
	];
	it.each(rows)("accepts runtime tokens and durable controls at %s", (_name, accept) => {
		expect(accept(runtimeId)).toBe(true);
		expect(accept(durableId)).toBe(true);
	});
});
