import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { compileCourse, deployCourse } from "../../src/build.ts";

let server: Server;
let directory: string;
let base: string;
const entries = new Map<string, string>();
const formats = ["html", "scorm12", "scorm2004"] as const;
const cases = [
	{
		locale: "en",
		paragraphs: ["First paragraph.", "Second paragraph with a guide.", "Final paragraph."],
		items: ["First idea.", "Nested idea.", "Another idea.", "Last idea."],
		report:
			"Reflect. First paragraph . Second paragraph with a guide . First idea. Nested idea. Another idea. Last idea. Final paragraph.",
	},
	{
		locale: "fr",
		paragraphs: [
			"Premier paragraphe.",
			"Deuxième paragraphe avec un guide.",
			"Dernier paragraphe.",
		],
		items: ["Première idée.", "Idée imbriquée.", "Autre idée.", "Dernière idée."],
		report:
			"Réfléchissez. Premier paragraphe . Deuxième paragraphe avec un guide . Première idée. Idée imbriquée. Autre idée. Dernière idée. Dernier paragraphe.",
	},
] as const;

test.beforeAll(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "free-response-description-"));
	for (const { locale } of cases) {
		const read = readLesson(
			await readFile(
				resolve(
					import.meta.dirname,
					`../../../grammar/__tests__/fixtures/free-response-description.${locale}.prax`,
				),
				"utf8",
			),
		);
		expect(read.errors).toEqual([]);
		const artifact = await compileCourse({
			id: `description-${locale}`,
			title: read.pages[0].title,
			sourceLocale: locale,
			content: read.pages,
		});
		try {
			for (const format of formats) {
				const result = await deployCourse(artifact, { format });
				const zip = new AdmZip(result.zip);
				const entry = zip.getEntry(`${artifact.manifest.pages[0].slug}.html`);
				if (!entry) throw new Error("Missing compiled content page");
				zip.extractAllTo(resolve(directory, `${locale}-${format}`));
				entries.set(`${locale}-${format}`, entry.entryName);
			}
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer(
		(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
	);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
	if (directory) await rm(directory, { recursive: true });
});

for (const { locale, paragraphs, items, report } of cases) {
	for (const format of formats) {
		for (const javaScriptEnabled of [false, true]) {
			test(`${locale} ${format} keeps the complete description with JavaScript=${javaScriptEnabled}`, async ({
				browser,
			}) => {
				const context = await browser.newContext({
					javaScriptEnabled,
					viewport: { width: 390, height: 844 },
				});
				try {
					await context.addInitScript(() => {
						const state = new Map<string, string>();
						const calls: [string, string][] = [];
						const host = window as unknown as Record<string, unknown>;
						host.descriptionCalls = calls;
						const set = (element: string, value: string) => {
							state.set(element, value);
							calls.push([element, value]);
							return "true";
						};
						const get = (element: string) =>
							state.get(element) ?? (element.endsWith("._count") ? "0" : "");
						host.API = {
							LMSInitialize: () => "true",
							LMSFinish: () => "true",
							LMSGetValue: get,
							LMSSetValue: set,
							LMSCommit: () => "true",
							LMSGetLastError: () => "0",
							LMSGetErrorString: () => "",
							LMSGetDiagnostic: () => "",
						};
						host.API_1484_11 = {
							Initialize: () => "true",
							Terminate: () => "true",
							GetValue: get,
							SetValue: set,
							Commit: () => "true",
							GetLastError: () => "0",
							GetErrorString: () => "",
							GetDiagnostic: () => "",
						};
					});
					const page = await context.newPage();
					const key = `${locale}-${format}`;
					await page.goto(`${base}/${key}/${entries.get(key)}`);
					const assessment = page.locator('[data-island="assessment"]');
					if (javaScriptEnabled) await expect(assessment).toHaveAttribute("data-hydrated", "");
					const description = assessment.locator(".praxity-assessment-description");
					await expect(description.locator("p")).toHaveText([...paragraphs]);
					for (const item of items)
						await expect(description.getByText(item, { exact: true })).toBeVisible();
					await expect(description.locator("ul ol")).toBeVisible();
					await expect(description.locator("strong")).toHaveText(
						locale === "en" ? "paragraph" : "paragraphe",
					);
					await expect(description.locator("em")).toHaveText(
						locale === "en" ? "paragraph" : "paragraphe",
					);
					await expect(description.getByRole("link", { name: "guide" })).toHaveAttribute(
						"href",
						"https://example.com/guide",
					);
					const input = assessment.getByRole("textbox");
					await expect(input).toHaveAccessibleDescription(
						`${paragraphs[0]} ${paragraphs[1]} ${items.join(" ")} ${paragraphs[2]}`,
					);
					const tree = await description.ariaSnapshot();
					for (const item of items) expect(tree).toContain(item);
					await page.emulateMedia({ media: "print" });
					for (const item of items)
						await expect(description.getByText(item, { exact: true })).toBeVisible();
					await page.emulateMedia({ media: "screen" });
					if (javaScriptEnabled) {
						await input.fill("My answer");
						await assessment.getByRole("button", { name: /Submit|Soumettre/ }).click();
						const calls = await page.evaluate(
							() =>
								(window as unknown as { descriptionCalls: [string, string][] }).descriptionCalls,
						);
						if (format === "scorm2004") {
							expect(calls).toContainEqual([
								"cmi.interactions.0.description",
								`{lang=${locale}}${report}`,
							]);
							expect(calls).toContainEqual(["cmi.interactions.0.type", "long-fill-in"]);
						} else if (format === "scorm12") {
							expect(calls).toContainEqual(["cmi.interactions.0.student_response", "My answer"]);
							expect(calls.some(([element]) => element.endsWith(".description"))).toBe(false);
						}
					}
				} finally {
					await context.close();
				}
			});
		}
	}
}
