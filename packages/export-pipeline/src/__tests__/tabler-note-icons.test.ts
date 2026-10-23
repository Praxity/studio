import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { embedTablerNoteIcons } from "../tabler-note-icons.ts";

describe("embedTablerNoteIcons", () => {
	it("embeds only referenced Tabler icon nodes and rejects unknown names", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "praxity-tabler-icons-"));
		const catalogPath = path.join(tempDir, "tabler-nodes-outline.json");
		const bulbNodes = [["path", { d: "M1 1h2" }]];
		await writeFile(catalogPath, JSON.stringify({ bulb: bulbNodes }));
		const pages = [
			{
				id: "page-1",
				title: "Page",
				blocks: [
					{
						id: "note-1",
						type: "note" as const,
						data: { content: "Think", icon: "bulb" },
					},
				],
			},
		];
		try {
			await embedTablerNoteIcons(pages, catalogPath);
			expect((pages[0].blocks[0].data as Record<string, unknown>)._tablerIconNodes).toEqual(
				bulbNodes,
			);

			pages[0].blocks[0].data.icon = "not-a-real-tabler-icon";
			await expect(embedTablerNoteIcons(pages, catalogPath)).rejects.toThrow(
				'Unknown Tabler outline icon "not-a-real-tabler-icon".',
			);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
