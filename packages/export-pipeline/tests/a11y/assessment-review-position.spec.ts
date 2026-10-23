import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { buildScormPackage } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { test } from "../muted-test";

let server: Server;
let base: string;

test.beforeAll(async () => {
	const files = new Map<string, Buffer>();
	for (const locale of ["en", "fr"] as const) {
		const questions: PraxityBlock[] = [
			{
				id: "choice",
				type: "assessment",
				data: {
					assessmentType: "choice",
					gradingMode: "none",
					attempts: 0,
					feedbackEnabled: true,
					stem: [{ id: "choice-stem", type: "text", data: { content: "Choose a response" } }],
					response: {
						type: "choice",
						selectionMode: "single",
						options: [
							{ id: "wrong", label: "Interrupt", isCorrect: false },
							{ id: "right", label: "Listen", isCorrect: true },
						],
					},
				},
			},
			{
				id: "blank",
				type: "assessment",
				data: {
					assessmentType: "fillBlank",
					gradingMode: "none",
					attempts: 0,
					feedbackEnabled: false,
					stem: [{ id: "blank-stem", type: "text", data: { content: "Complete the response" } }],
					response: { type: "fillBlank", blanks: [{ id: "answer", answer: "listen" }] },
				},
			},
		];
		const members = questions.map(
			(question) =>
				JSON.parse(JSON.stringify(question), (key, value) =>
					key === "id" && typeof value === "string" ? `group-${value}` : value,
				) as PraxityBlock,
		);
		const result = await buildScormPackage(
			{
				id: `review-position-${locale}`,
				title: "Review position",
				sourceLocale: locale,
				navigationStyle: "sidebar",
				content: [
					{ id: "individual", title: "Individual", blocks: questions },
					{
						id: "group",
						title: "Group",
						blocks: [
							{
								id: "group",
								type: "assessmentGroup",
								data: {
									mode: "all",
									requireAll: true,
									showResultsSummary: true,
									memberBlockIds: members.map((member) => member.id),
								},
							},
							...members,
						],
					},
				],
			},
			{ format: "html" },
		);
		for (const entry of new AdmZip(result.zip).getEntries())
			if (!entry.isDirectory) files.set(`/${locale}/${entry.entryName}`, entry.getData());
	}
	server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		if (!bytes) {
			response.writeHead(404).end();
			return;
		}
		response.setHeader(
			"Content-Type",
			path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
});

for (const locale of ["en", "fr"] as const) {
	for (const grouped of [false, true]) {
		test(`review wording follows choice and fill-blank result rows ${locale} ${grouped ? "group" : "single"}`, async ({
			page,
		}) => {
			await page.goto(`${base}/${locale}/${grouped ? "group" : "individual"}.html`);
			const prefix = grouped ? "group-" : "";
			const choice = page.locator(`[data-island="assessment"][data-block-id="${prefix}choice"]`);
			const blank = page.locator(`[data-island="assessment"][data-block-id="${prefix}blank"]`);
			for (const card of [choice, blank]) {
				await card.scrollIntoViewIfNeeded();
				await expect(card).toHaveAttribute("data-hydrated", "");
			}
			await choice.getByRole("radio", { name: "Interrupt", exact: true }).check();
			await blank.getByRole("textbox").fill("interrupt");
			if (grouped) await page.locator('[data-assessment-group-submit="group"] button').click();
			else
				for (const card of [choice, blank]) await card.locator("[data-assessment-submit]").click();
			for (const [card, selector] of [
				[choice, "[data-assessment-status]"],
				[blank, ".praxity-assessment-result"],
			] as const) {
				const summary = card.locator(`[data-assessment-feedback] ${selector}`);
				await expect(summary).toBeVisible();
				expect
					.soft(await summary.textContent())
					.toBe(
						locale === "en"
							? "Answer checked. Review the results above."
							: "Réponse vérifiée. Consultez les résultats ci-dessus.",
					);
				for (const attribute of ["role", "aria-live"])
					await expect(summary).not.toHaveAttribute(attribute);
				expect(
					await summary.evaluate((message) => {
						const card = message.closest(".praxity-block-assessment");
						const rows = Array.from(
							card?.querySelectorAll("[data-option-feedback], .praxity-fill-blank-status") ?? [],
						);
						return (
							rows.length > 0 &&
							rows.every(
								(row) =>
									Boolean(
										row.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING,
									) && row.getBoundingClientRect().bottom <= message.getBoundingClientRect().top,
							)
						);
					}),
				).toBe(true);
				await expect(card.locator("[data-assessment-retry]")).not.toHaveAccessibleDescription(
					/Review the results|Consultez les résultats/,
				);
			}
		});
	}
}
