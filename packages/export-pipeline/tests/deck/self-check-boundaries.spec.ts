import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";

let folder: string, base: string, server: Server;
const entries: Record<string, string> = {};
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-boundaries-"));
	for (const locale of ["en", "fr"] as const) {
		const source =
			`---\nlang: ${locale}\n---\n# Practice\n` +
			[true, false]
				.map((privacy) => `::: self-check A {private=${privacy}}\nmodel: M\n:: L\nmissed: H\n:::\n`)
				.join("\n") +
			`\n::: self-check Many\nmodel: M\n${Array.from({ length: 1000 }, (_, n) => `:: Part ${n + 1}\nmissed: Hint ${n + 1}\n`).join("")}:::\n`;
		const read = readLesson(source);
		const artifact = await compileCourse({
			id: `boundaries-${locale}`,
			title: "Practice",
			sourceLocale: locale,
			content: read.pages,
			selfCheckContents: read.blocks
				.filter((b) => b.type === "selfCheck")
				.map((b) => selfCheckContentInput(b.id, readSelfCheckContent(read, b.id))),
		});
		try {
			for (const format of ["html", "scorm12", "scorm2004"] as const) {
				const key = `${locale}-${format}`;
				entries[key] = `${key}/${artifact.manifest.pages[0].slug}.html`;
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(join(folder, key));
			}
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer(async (req, res) => {
		try {
			const path = req.url?.split("?")[0] ?? "/";
			res.setHeader(
				"Content-Type",
				path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
			);
			res.end(await readFile(join(folder, path)));
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	if (folder) await rm(folder, { recursive: true });
});
for (const locale of ["en", "fr"] as const) {
	for (const format of ["html", "scorm12", "scorm2004"] as const) {
		test(`${locale} ${format}: notices follow host destination and authored privacy`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			if (format !== "html")
				await page.addInitScript((format) => {
					const prefix = format === "scorm12" ? "LMS" : "";
					const values: Record<string, string> = {};
					Reflect.set(window, format === "scorm12" ? "API" : "API_1484_11", {
						[`${prefix}Initialize`]: () => "true",
						[`${prefix}Commit`]: () => "true",
						[format === "scorm12" ? "LMSFinish" : "Terminate"]: () => "true",
						[`${prefix}GetValue`]: (key: string) => values[key] ?? "",
						[`${prefix}SetValue`]: (key: string, value: string) => {
							values[key] = value;
							return "true";
						},
						[`${prefix}GetLastError`]: () => "0",
						[`${prefix}GetErrorString`]: () => "",
						[`${prefix}GetDiagnostic`]: () => "",
					});
				}, format);
			await page.goto(base + entries[`${locale}-${format}`]);
			for (const [index, privacy] of [true, false].entries()) {
				const root = page.locator("[data-self-check]").nth(index);
				await root.locator("textarea").fill("Answer");
				await root.locator('[data-self-check-action="check"]').click();
				await expect(root.getByRole("checkbox").first()).toBeVisible();
				await root.locator('[data-self-check-action="show-feedback"]').click();
				const reporting = !privacy && format !== "html";
				await expect(root.locator("[data-self-check-mode]")).toHaveCount(1);
				await expect(root.locator("[data-self-check-mode]")).toHaveText(
					reporting
						? locale === "en"
							? "Your answer is reported to the LMS. Drafts and comparison state may also be saved there."
							: "Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés."
						: locale === "en"
							? "Your answer is saved in this browser on this device. It is not sent to the LMS."
							: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
				);
				await expect(root.locator("[data-self-check-save]")).toBeEmpty();
			}
			expect(errors).toEqual([]);
		});
	}
	test(`${locale}: singular and grouped counts reach the learner`, async ({ page }) => {
		await page.goto(base + entries[`${locale}-html`]);
		const one = page.locator("[data-self-check]").first();
		await one.locator("textarea").fill("A");
		await one.locator('[data-self-check-action="check"]').click();
		await one.getByRole("checkbox").check();
		await expect(one.locator("[data-self-check-count]")).toHaveText(
			locale === "en" ? "1 of 1 selected" : "1 sur 1 sélectionné",
		);
		await one.locator('[data-self-check-action="show-feedback"]').click();
		await expect(one.getByRole("status")).toHaveText(
			locale === "en" ? "You included 1 of 1 part." : "Éléments inclus : 1 sur 1.",
		);
		const many = page.locator("[data-self-check]").nth(2);
		await many.locator("textarea").fill("A");
		await many.locator('[data-self-check-action="check"]').click();
		await expect(many.locator("[data-self-check-count]")).toHaveText(
			locale === "en" ? "0 of 1,000 selected" : "0 sur 1 000 sélectionné",
		);
		await many.locator('[data-self-check-action="show-feedback"]').click();
		await expect(many.getByRole("status")).toHaveText(
			locale === "en" ? "You included 0 of 1,000 parts." : "Éléments inclus : 0 sur 1 000.",
		);
	});
}
