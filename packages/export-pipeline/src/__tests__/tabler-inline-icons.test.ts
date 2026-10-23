import { readBlockFixture as readBlockSource } from "../../../grammar/__tests__/helpers/lesson-fixture.ts";
// @vitest-environment jsdom

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inlineMarkdown } from "@praxity/shared-blocks/inline-markdown";
import { sanitizeHtml } from "@praxity/shared-blocks/sanitize";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { describe, expect, it } from "vitest";
import { sanitizeBlockForJson } from "../published-markup.ts";
import { renderBlockHtml } from "../render-block-html.ts";
import { embedTablerInlineIcons } from "../tabler-note-icons.ts";

const outlineNodes = [["path", { d: "M1 1" }]];
const filledNodes = [["path", { d: "M2 2" }]];

function pageFor(source: string): PraxityPage[] {
	return [
		{
			id: "page-1",
			title: "Page",
			blocks: readBlockSource(source).blocks,
		},
	] as PraxityPage[];
}

function contentOf(pages: PraxityPage[]): string {
	return String((pages[0]?.blocks[0]?.data as Record<string, unknown> | undefined)?.content ?? "");
}

async function withCatalogs(
	callback: (outlinePath: string, filledPath: string) => Promise<void>,
): Promise<void> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "praxity-inline-icons-"));
	const outlinePath = path.join(tempDir, "outline.json");
	const filledPath = path.join(tempDir, "filled.json");
	await Promise.all([
		writeFile(outlinePath, JSON.stringify({ mail: outlineNodes })),
		writeFile(filledPath, JSON.stringify({ mail: filledNodes })),
	]);
	try {
		await callback(outlinePath, filledPath);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

describe("inline Tabler icons", () => {
	it("embeds selected outline and filled paths, then survives sanitization", async () => {
		await withCatalogs(async (outlinePath, filledPath) => {
			const pages = pageFor("Contact @icon{mail} @icon{IconMailFilled}.");
			await embedTablerInlineIcons(pages, outlinePath, filledPath);
			const marker = contentOf(pages);

			expect(marker).toContain("data-praxity-inline-icon-nodes=");
			const html = sanitizeHtml(marker);
			expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
			expect(html).toContain('data-praxity-inline-icon="mail"');
			expect(html).toContain('data-praxity-inline-icon="IconMailFilled"');
			expect(html).toContain('width="1em" height="1em"');
			expect(html).toContain('d="M1 1"');
			expect(html).toContain('d="M2 2"');
			expect(html).not.toContain("tabler-nodes-");
		});
	});

	it("renders an embedded marker in the server block output", async () => {
		await withCatalogs(async (outlinePath, filledPath) => {
			const pages = pageFor("Server output @icon{mail}.");
			await embedTablerInlineIcons(pages, outlinePath, filledPath);
			const html = renderBlockHtml(pages[0].blocks[0]);

			expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
			expect(html).toContain('data-praxity-inline-icon="mail"');
			expect(html).toContain('d="M1 1"');
		});
	});

	it("keeps node metadata in island JSON instead of serializing SVG", async () => {
		await withCatalogs(async (outlinePath, filledPath) => {
			const pages = pageFor("Island output @icon{mail}.");
			await embedTablerInlineIcons(pages, outlinePath, filledPath);
			const safeBlock = sanitizeBlockForJson(pages[0].blocks[0]);
			const content = String((safeBlock.data as Record<string, unknown>).content);

			expect(content).toContain("data-praxity-inline-icon-nodes=");
			expect(content).not.toContain("<svg");
		});
	});

	it("keeps unknown names as literal syntax and protects code spans", async () => {
		await withCatalogs(async (outlinePath, filledPath) => {
			const pages = pageFor("Use `@icon{mail}` and @icon{IconMissing}.");
			await embedTablerInlineIcons(pages, outlinePath, filledPath);
			const html = sanitizeHtml(contentOf(pages));

			expect(html).toContain("<code>@icon{mail}</code>");
			expect(html).toContain("@icon{IconMissing}");
			expect(html).not.toContain('data-praxity-inline-icon="IconMissing"');
		});
	});

	it("does not rewrite code or URL metadata", async () => {
		await withCatalogs(async (outlinePath, filledPath) => {
			const pages: PraxityPage[] = [
				{
					id: "page-1",
					title: "Page",
					blocks: [
						{ id: "code", type: "code", data: { code: "@icon{mail}" } },
						{
							id: "link",
							type: "text",
							data: {
								href: "https://example.test/@icon{mail}",
								content: inlineMarkdown("@icon{mail}"),
							},
						},
					],
				},
			];
			await embedTablerInlineIcons(pages, outlinePath, filledPath);

			expect((pages[0].blocks[0].data as Record<string, unknown>).code).toBe("@icon{mail}");
			expect((pages[0].blocks[1].data as Record<string, unknown>).href).toBe(
				"https://example.test/@icon{mail}",
			);
			expect((pages[0].blocks[1].data as Record<string, unknown>).content).toContain(
				"data-praxity-inline-icon-nodes",
			);
		});
	});

	it("fails closed for malformed or hostile embedded path metadata", () => {
		const encoded = encodeURIComponent(
			JSON.stringify([["path", { d: 'M1" /><script>alert(1)</script>', onload: "alert(1)" }]]),
		);
		const malformed = encodeURIComponent(JSON.stringify([["circle", { d: "M2" }]]));
		const html = sanitizeHtml(
			`<span class="praxity-inline-icon" data-praxity-inline-icon="mail" data-icon="mail" data-icon-variant="outline" data-praxity-inline-icon-nodes="${encoded}"></span><span class="praxity-inline-icon" data-praxity-inline-icon="mail" data-icon="mail" data-icon-variant="outline" data-praxity-inline-icon-nodes="${malformed}"></span>`,
		);

		expect(html).not.toContain('d="M1');
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onload");
		expect(html).toContain("@icon{mail}");
	});

	it("drops URL paint values and keeps sanitized SVG idempotent", () => {
		const encoded = encodeURIComponent(
			JSON.stringify([
				["path", { d: "M1 1", fill: "url(https://evil.example/icon)", opacity: "2" }],
			]),
		);
		const marker = `<span class="praxity-inline-icon" data-praxity-inline-icon="mail" data-icon="mail" data-icon-variant="outline" data-praxity-inline-icon-nodes="${encoded}"></span>`;
		const once = sanitizeHtml(marker);
		const twice = sanitizeHtml(once);

		expect(once).toContain('d="M1 1"');
		expect(once).not.toContain("evil.example");
		expect(twice).toContain('d="M1 1"');
	});

	it("keeps concurrent course catalogs isolated", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "praxity-inline-icons-concurrent-"));
		const outlineA = path.join(tempDir, "outline-a.json");
		const filledA = path.join(tempDir, "filled-a.json");
		const outlineB = path.join(tempDir, "outline-b.json");
		const filledB = path.join(tempDir, "filled-b.json");
		try {
			await Promise.all([
				writeFile(outlineA, JSON.stringify({ mail: [["path", { d: "M1 1" }]] })),
				writeFile(filledA, JSON.stringify({ mail: [["path", { d: "M3 3" }]] })),
				writeFile(outlineB, JSON.stringify({ mail: [["path", { d: "M2 2" }]] })),
				writeFile(filledB, JSON.stringify({ mail: [["path", { d: "M4 4" }]] })),
			]);
			const courseA = pageFor("@icon{mail}");
			const courseB = pageFor("@icon{mail}");
			await Promise.all([
				embedTablerInlineIcons(courseA, outlineA, filledA),
				embedTablerInlineIcons(courseB, outlineB, filledB),
			]);
			expect(sanitizeHtml(contentOf(courseA))).toContain('d="M1 1"');
			expect(sanitizeHtml(contentOf(courseA))).not.toContain("M2 2");
			expect(sanitizeHtml(contentOf(courseB))).toContain('d="M2 2"');
			expect(sanitizeHtml(contentOf(courseB))).not.toContain("M1 1");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
