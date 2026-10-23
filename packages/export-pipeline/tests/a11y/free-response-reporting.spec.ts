import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { compileCourse, deployCourse } from "../../src/build.ts";

const endpoint = "https://reports.example.invalid/xapi/statements";
const cases = [
	{ name: "250 characters", body: "a".repeat(247), summary: `Q. ${"a".repeat(247)}` },
	{ name: "251 characters", body: "a".repeat(248), summary: "Q.\u2026" },
	{ name: "long unbroken token", body: "a".repeat(4000), summary: "Q.\u2026" },
	{
		name: "long paragraphs",
		body: `${"word ".repeat(700).trim()}\n\nFinal paragraph ENDMARK.`,
		summary: `Q. ${"word ".repeat(49).trim()}\u2026`,
	},
];
let server: Server;
let directory: string;
let base: string;
const entries = new Map<string, string[]>();

test.beforeAll(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "free-response-reporting-"));
	for (const locale of ["en", "fr"] as const) {
		const read = readLesson(
			`---\nlang: ${locale}\n---\n\n${cases
				.map(({ name, body }) => `# ${name}\n::: free-response Q.\n${body}\n:::\n`)
				.join("\n")}`,
		);
		expect(read.errors).toEqual([]);
		const artifact = await compileCourse({
			id: `reporting-${locale}`,
			title: "Reporting",
			sourceLocale: locale,
			content: read.pages,
		});
		try {
			for (const format of ["xapi", "scorm2004"] as const) {
				const result = await deployCourse(artifact, {
					format,
					xapiConfig: {
						endpoint,
						auth: "test",
						actorMode: "manual",
						actor: { name: "Test learner", mbox: "mailto:learner@example.invalid" },
					},
				});
				const key = `${locale}-${format}`;
				new AdmZip(result.zip).extractAllTo(resolve(directory, key));
				entries.set(
					key,
					artifact.manifest.pages.map(({ slug }) => `${slug}.html`),
				);
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

for (const locale of ["en", "fr"] as const) {
	for (const [index, { name, body, summary }] of cases.entries()) {
		test(`${locale} xAPI keeps ${name} in the statement JSON`, async ({ page }) => {
			await page.route(endpoint, (route) => route.fulfill({ status: 200, body: "[]" }));
			const key = `${locale}-xapi`;
			await page.goto(`${base}/${key}/${entries.get(key)?.[index]}`);
			const assessment = page.locator('[data-island="assessment"]');
			await expect(assessment).toHaveAttribute("data-hydrated", "");
			await assessment.getByRole("textbox").fill("My answer");
			const request = page.waitForRequest(
				(request) =>
					request.url() === endpoint &&
					request.method() === "POST" &&
					request.postDataJSON().verb.id === "http://adlnet.gov/expapi/verbs/answered",
			);
			await assessment.getByRole("button", { name: /Submit|Soumettre/ }).click();
			const statement = (await request).postDataJSON();
			expect(statement.object.definition.description).toEqual({
				[locale]: `Q. ${body.replaceAll("\n\n", " ")}`,
			});
			expect(statement.result.response).toBe("My answer");
			if (name === "long paragraphs")
				expect(statement.object.definition.description[locale]).toContain(
					"Final paragraph ENDMARK.",
				);
		});

		test(`${locale} SCORM 2004 keeps its summary for ${name}`, async ({ page }) => {
			await page.addInitScript(() => {
				const data: Record<string, string> = {};
				Object.assign(window, {
					reportData: data,
					API_1484_11: {
						Initialize: () => "true",
						Terminate: () => "true",
						Commit: () => "true",
						GetValue: (key: string) => data[key] ?? (key.endsWith("._count") ? "0" : ""),
						SetValue: (key: string, value: string) => {
							data[key] = value;
							return "true";
						},
						GetLastError: () => "0",
						GetErrorString: () => "",
						GetDiagnostic: () => "",
					},
				});
			});
			const key = `${locale}-scorm2004`;
			await page.goto(`${base}/${key}/${entries.get(key)?.[index]}`);
			const assessment = page.locator('[data-island="assessment"]');
			await expect(assessment).toHaveAttribute("data-hydrated", "");
			await assessment.getByRole("textbox").fill("My answer");
			await assessment.getByRole("button", { name: /Submit|Soumettre/ }).click();
			const data = await page.evaluate(
				() => (window as unknown as { reportData: Record<string, string> }).reportData,
			);
			expect(data["cmi.interactions.0.description"]).toBe(`{lang=${locale}}${summary}`);
			expect(data["cmi.interactions.0.learner_response"]).toBe("My answer");
		});
	}
}
