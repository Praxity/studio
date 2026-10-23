import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { buildScormPackage } from "../../src/build";
import { groupedDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";

let server: Server;
let base: string;
const entries = new Map<string, string>();

test.beforeAll(async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "grouped-card-spacing-"));
	for (const layout of ["pages", "slides"] as const) {
		const course = groupedDeckFixture();
		course.navigationStyle = layout === "pages" ? "sidebar" : "slides";
		const result = await buildScormPackage(course, { format: "html" });
		const output = resolve(directory, layout);
		await mkdir(output);
		const zip = new AdmZip(result.zip);
		zip.extractAllTo(output);
		const entry = zip
			.getEntries()
			.find(
				(file) =>
					file.entryName.endsWith(".html") &&
					file.getData().toString().includes('data-assessment-group-header="experience-survey"'),
			);
		if (!entry) throw new Error(`Missing survey in ${layout} output`);
		entries.set(layout, `/${layout}/${entry.entryName}`);
	}
	server = createServer(
		(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
	);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const layout of ["pages", "slides"] as const) {
	for (const width of [1280, 390]) {
		test(`grouped card gaps ${layout} ${width} before and after submission`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto(`${base}${entries.get(layout)}?praxity-inspect=1#group-slide-2`);
			const members = page.locator('.praxity-block[data-assessment-group="experience-survey"]');
			await expect(members).toHaveCount(6);
			for (const member of await members.all()) {
				await member.scrollIntoViewIfNeeded();
				await expect(member).toHaveAttribute("data-hydrated", "");
			}
			await page.evaluate(() => document.fonts.ready);
			const measured = [];
			for (const state of ["before", "after"]) {
				const gaps = await members.evaluateAll((elements) => {
					const cards = elements.map((element) => {
						const card = element.querySelector(":scope > .praxity-block-assessment");
						if (!card) throw new Error("Missing activity card");
						return card.getBoundingClientRect();
					});
					return cards.slice(1).map((card, index) => card.top - cards[index].bottom);
				});
				measured.push({ state, gaps });
				for (const gap of gaps)
					expect(Math.abs(gap - (width === 390 ? 16 : 24))).toBeLessThanOrEqual(0.5);
				for (const panel of await page
					.locator(
						'[data-assessment-group-header="experience-survey"], [data-assessment-group-context="experience-survey"], [data-assessment-group-submit="experience-survey"]',
					)
					.all()) {
					await expect(panel).toHaveCSS("border-radius", "0px");
					await expect(panel).toHaveCSS("box-shadow", "none");
				}
				if (state === "before") {
					for (let index = 1; index <= 6; index++)
						await page.getByRole("radio", { name: `Confident ${index}`, exact: true }).check();
					await page.getByRole("button", { name: "Send survey", exact: true }).click();
					await expect(
						page.locator(
							'[data-assessment-group-submit="experience-survey"] [data-assessment-group-results]',
						),
					).toContainText("Completed");
				}
			}
			await testInfo.attach("grouped-card-gaps", {
				body: JSON.stringify(measured),
				contentType: "application/json",
			});
		});
	}
}
