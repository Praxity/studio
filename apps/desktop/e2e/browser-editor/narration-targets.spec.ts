import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import AdmZip from "adm-zip";
import { applyEdits } from "../../../../packages/grammar/src/source-edit.ts";
import { applyOperation } from "../../../../packages/operations/src/index.ts";
import { exportProject } from "../../src/main/export/export-project";
import { writeLessonSource } from "../../src/main/lesson-source";
import { serializeNarrationSidecarV2 } from "../../src/shared/narration-sidecar";
import { narrationFixture } from "../../src/test-utils/narration-fixture";

for (const mode of ["pages", "deck"] as const) {
	test.describe(mode, () => {
		let server: Server;
		let url: string;

		test.beforeAll(async () => {
			test.setTimeout(120_000);
			const root = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? process.env.TEMP ?? ".", "narration-targets-"),
			);
			await mkdir(join(root, "assets"));
			await writeFile(
				join(root, "course.yaml"),
				`title: Narration targets\nlessons: [lesson.prax]\nnarrationEnabled: true\nmoduleDeck: ${mode === "deck"}\n`,
			);
			const source =
				"# Targets\n\n![](/assets/opener.svg){decorative}\n\n![](/assets/opener.svg){decorative}\n\n::: group Check your understanding\n::: choice Which action helps?\n(x) Listen\n( ) Interrupt\n:::\n:::\n";
			await writeFile(
				join(root, "assets/opener.svg"),
				'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>',
			);
			const audio = await readFile(
				resolve(import.meta.dirname, "../../../../docs/test-fixtures/assets/narration-sample.mp3"),
			);
			await writeFile(join(root, "lesson.prax"), source);
			const fixture = await narrationFixture(root, "lesson.prax");
			const digest = (text: string) => createHash("sha256").update(text).digest("hex");
			const images = fixture.read.blocks.filter((block) => block.type === "image");
			for (const image of images)
				fixture.update(
					{ id: image.id, role: "body" },
					{ audio: "assets/clip-0.mp3", reviewedRevision: digest("") },
				);
			const seeded = await narrationFixture(root, "lesson.prax", fixture.sidecar);
			const targets = seeded.items.filter((item) =>
				["image", "assessmentGroup", "assessment"].includes(item.segment.blockType ?? ""),
			);
			expect(targets).toHaveLength(4);
			for (const [index, target] of targets.entries()) {
				await writeFile(join(root, `assets/clip-${index}.mp3`), audio);
				seeded.update(target.segment.target, {
					audio: `assets/clip-${index}.mp3`,
					reviewedRevision: target.segment.revision,
					audioFor: { script: target.segment.script, language: "en", voice: "Maya", speed: 1 },
				});
			}
			await writeFile(join(root, "narration.yaml"), serializeNarrationSidecarV2(seeded.sidecar));
			const inserted = applyOperation(
				[{ path: "lesson.prax", source }],
				{
					transactionId: "fixture-insert",
					operation: "insertBlock",
					files: [{ path: "lesson.prax", baseRevision: digest(source) }],
					targets: [
						{
							file: "lesson.prax",
							ref: {
								kind: "insertion",
								parentId: fixture.read.pages[0].id,
								after: null,
								before: images[0].id,
							},
						},
					],
					args: { text: "Inserted paragraph." },
				},
				{ identity: fixture.read.identity.identity, allocateId: randomUUID, digest },
			);
			if (!inserted.ok) throw new Error(`Fixture insertion refused: ${inserted.code}`);
			await writeLessonSource(
				root,
				"lesson.prax",
				applyEdits(source, inserted.files[0].edits),
				source,
				{ operations: inserted.evidence },
			);

			const result = await exportProject({
				manifestPolicy: "write" as const,
				projectDir: root,
				format: "html",
				exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
				scope: "course",
				fallbackCompletionThreshold: 0.8,
				enforceAccessibility: true,
			});
			if (!("zip" in result)) throw new Error("Expected HTML export");
			await writeFile(join(root, "export.zip"), result.zip);
			const files = new Map(
				new AdmZip(result.zip)
					.getEntries()
					.filter((entry) => !entry.isDirectory)
					.map((entry) => [`/${entry.entryName}`, entry.getData()]),
			);
			expect(files.get("/targets.html")?.toString()).toContain('alt=""');
			server = createServer((request, response) => {
				const path = new URL(request.url ?? "/", "http://localhost").pathname;
				const bytes = files.get(path);
				const types: Record<string, string> = {
					html: "text/html",
					js: "text/javascript",
					css: "text/css",
					mp3: "audio/mpeg",
					svg: "image/svg+xml",
				};
				response.writeHead(bytes ? 200 : 404, {
					"Content-Type": types[path.split(".").pop() ?? ""] ?? "application/octet-stream",
				});
				response.end(bytes);
			});
			await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
			url = `http://127.0.0.1:${(server.address() as { port: number }).port}/targets.html`;
		});

		test.afterAll(async () => {
			if (server) await new Promise<void>((done) => server.close(() => done()));
		});

		for (const input of mode === "deck" ? ["mouse", "Enter", "Space"] : ["mouse"]) {
			test(`published HTML plays each decorative image, then the group introduction, then the question${input === "mouse" ? "" : ` with ${input}`}`, async ({
				page,
			}) => {
				await page.goto(url);
				await expect(page.locator('[data-block-type="image"] img')).toHaveCount(2);
				for (const image of await page.locator('[data-block-type="image"] img').all())
					await expect(image).toHaveAttribute("alt", "");
				if (mode === "pages") {
					await page.getByRole("button", { name: "Listen", exact: true }).click();
					await page.getByRole("button", { name: "Play", exact: true }).click();
				} else {
					await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
					const play = page.getByRole("button", { name: "Play", exact: true });
					if (input === "mouse") await play.click();
					else {
						await play.focus();
						await play.press(input);
					}
					// Keep focus in slide content while narration traverses its recorded targets.
					await page.getByRole("main").focus();
					await expect(page.getByRole("main")).toBeFocused();
				}
				const audio = page.locator("audio[data-narration-player]");
				for (const index of [0, 1, 2, 3]) {
					await expect(audio).toHaveAttribute("src", new RegExp(`clip-${index}\\.mp3$`));
					await expect
						.poll(() => audio.evaluate((element) => (element as HTMLAudioElement).currentTime))
						.toBeGreaterThan(0.05);
				}
				await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
			});
		}
	});
}
