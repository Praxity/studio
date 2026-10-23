import { createServer } from "node:http";
import { test as base, expect } from "@playwright/test";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "../fixtures/http-bytes";

const test = base.extend<Record<never, never>, { feedbackCourse: string }>({
	feedbackCourse: [
		async ({ browserName: _browserName }, use) => {
			const files = new Map<string, Buffer>();
			for (const locale of ["en", "fr"] as const) {
				const explanation =
					locale === "en"
						? "Consider how the other person feels."
						: "Pensez à ce que ressent l’autre personne.";
				const blocks: PraxityBlock[] = [
					{ id: "heading", type: "heading", data: { level: 1, content: "Feedback focus" } },
					...["single", "multiple", "free", "inline"].map(
						(kind): PraxityBlock => ({
							id: kind,
							type: "assessment",
							data: {
								assessmentType:
									kind === "free" ? "textResponse" : kind === "inline" ? "fillBlank" : "choice",
								gradingMode: kind === "free" || kind === "inline" ? "none" : "exact",
								attempts: 2,
								stem: [{ id: `${kind}-stem`, type: "text", data: { content: `Question ${kind}` } }],
								feedbackEnabled: kind !== "inline",
								feedback:
									kind === "inline"
										? {}
										: {
												incorrect: [
													{
														id: `${kind}-feedback-wrong`,
														type: "text",
														data: { content: explanation },
													},
												],
												correct: [
													{
														id: `${kind}-feedback-right`,
														type: "text",
														data: { content: explanation },
													},
												],
											},
								response:
									kind === "free"
										? { type: "textResponse", inputType: "short" }
										: kind === "inline"
											? { type: "fillBlank", blanks: [{ id: "blank", answer: "Listen" }] }
											: {
													type: "choice",
													selectionMode: kind,
													options: [
														{ id: `${kind}-wrong`, label: "Interrupt", isCorrect: false },
														{ id: `${kind}-right`, label: "Listen", isCorrect: true },
													],
												},
							},
						}),
					),
					{
						id: "categorize",
						type: "assessment",
						data: {
							assessmentType: "categorize",
							gradingMode: "exact",
							attempts: 2,
							stem: [{ id: "categorize-stem", type: "text", data: { content: "Sort actions" } }],
							response: {
								type: "categorize",
								categories: [
									{ id: "helpful", name: "Helpful", items: ["Listen"], itemIds: ["listen-item"] },
									{
										id: "unhelpful",
										name: "Unhelpful",
										items: ["Interrupt"],
										itemIds: ["interrupt-item"],
									},
								],
							},
						},
					},
				];
				const artifact = await compileCourse(
					{
						id: `feedback-${locale}`,
						title: "Feedback focus",
						sourceLocale: locale,
						navigationStyle: "minimal",
						content: [{ id: "feedback-page", title: "Feedback focus", blocks }],
					},
					{ mode: "source" },
				);
				try {
					const deployment = await deployCourse(artifact, { format: "html" });
					if (!("zip" in deployment)) throw new Error("Expected HTML package");
					for (const entry of new AdmZip(deployment.zip).getEntries())
						if (!entry.isDirectory) files.set(`/${locale}/${entry.entryName}`, entry.getData());
				} finally {
					await artifact.dispose();
				}
			}
			const server = createServer((request, response) => {
				const path = new URL(request.url ?? "/", "http://localhost").pathname;
				const bytes = files.get(path);
				if (!bytes) {
					response.writeHead(404).end();
					return;
				}
				response.setHeader(
					"Content-Type",
					path.endsWith(".js")
						? "text/javascript"
						: path.endsWith(".css")
							? "text/css"
							: "text/html",
				);
				serveFixtureBytes(request, response, bytes);
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			try {
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("Missing fixture address");
				await use(`http://127.0.0.1:${address.port}`);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
		{ scope: "worker" },
	],
});

for (const locale of ["en", "fr"]) {
	for (const kind of ["single", "multiple", "free", "inline"]) {
		test(`${locale} ${kind} submission focuses the described next action and preserves retry`, async ({
			page,
			feedbackCourse,
		}) => {
			await page.goto(`${feedbackCourse}/${locale}/index.html`);
			const block = page.locator(`[data-island="assessment"][data-block-id="${kind}"]`);
			await block.scrollIntoViewIfNeeded();
			await expect(block).toHaveAttribute("data-hydrated", "");
			const answer =
				kind === "single" || kind === "multiple"
					? block.getByRole(kind === "single" ? "radio" : "checkbox", {
							name: "Interrupt",
							exact: true,
						})
					: block.getByRole("textbox");
			if (kind === "single" || kind === "multiple") await answer.check();
			else await answer.fill("Interrupt");
			await block.locator("[data-assessment-submit]").click();
			const feedback = block.locator("[data-assessment-feedback]");
			const retryName = locale === "en" ? "Try again" : "Réessayer";
			const focused = block.getByRole("button", { name: retryName, exact: true });
			const expected =
				kind === "free"
					? locale === "en"
						? "Completed Consider how the other person feels."
						: "Terminé Pensez à ce que ressent l’autre personne."
					: kind === "inline"
						? ""
						: locale === "en"
							? "Not quite Consider how the other person feels."
							: "Pas tout à fait Pensez à ce que ressent l’autre personne.";
			await expect(focused).toBeFocused();
			await expect(focused).toHaveAccessibleName(retryName);
			await expect(focused).toHaveAccessibleDescription(expected);
			for (const attribute of ["role", "aria-label", "aria-labelledby", "tabindex", "aria-live"])
				await expect(feedback).not.toHaveAttribute(attribute);
			await expect(feedback).toHaveAccessibleName("");
			{
				await block
					.getByRole("button", { name: locale === "en" ? "Try again" : "Réessayer", exact: true })
					.click();
				const first =
					kind === "single" || kind === "multiple"
						? block.getByRole(kind === "single" ? "radio" : "checkbox").first()
						: answer;
				await expect(first).toBeFocused();
				await expect(first).toBeEnabled();
				await expect(block.locator(`[aria-describedby*="feedback-${kind}"]`)).toHaveCount(0);
			}
		});
	}
}

for (const locale of ["en", "fr"]) {
	test(`${locale} categorization describes the focused retry with its summary only`, async ({
		page,
		feedbackCourse,
	}) => {
		await page.goto(`${feedbackCourse}/${locale}/index.html`);
		const block = page.locator('[data-island="assessment"][data-block-id="categorize"]');
		await block.scrollIntoViewIfNeeded();
		await expect(block).toHaveAttribute("data-hydrated", "");
		await block
			.getByRole("radio", {
				name: locale === "fr" ? "Listen : Unhelpful" : "Listen: Unhelpful",
				exact: true,
			})
			.check();
		await block
			.getByRole("radio", {
				name: locale === "fr" ? "Interrupt : Unhelpful" : "Interrupt: Unhelpful",
				exact: true,
			})
			.check();
		await block.locator("[data-assessment-submit]").click();
		const feedback = block.locator("[data-assessment-feedback]");
		const retry = block.getByRole("button", {
			name: locale === "en" ? "Try again" : "Réessayer",
			exact: true,
		});
		await expect(retry).toBeFocused();
		await expect(retry).toHaveAccessibleName(locale === "en" ? "Try again" : "Réessayer");
		await expect(retry).toHaveAccessibleDescription(
			locale === "en" ? "1 of 2 correct" : "1 sur 2 corrects",
		);
		await expect(feedback.locator("p[tabindex]")).toHaveCount(0);
		await block
			.getByRole("button", { name: locale === "en" ? "Try again" : "R\u00e9essayer", exact: true })
			.click();
		await expect(block.getByRole("radio").first()).toBeFocused();
		await expect(block.getByRole("radio").first()).toBeEnabled();
		await expect(block.locator('[aria-describedby*="feedback-categorize"]')).toHaveCount(0);
	});
}

for (const locale of ["en", "fr"]) {
	for (const outcome of ["correct", "exhausted"] as const) {
		test(`${locale} ${outcome} choice focuses Continue with the explanation`, async ({
			page,
			feedbackCourse,
		}) => {
			await page.goto(`${feedbackCourse}/${locale}/index.html`);
			const block = page.locator('[data-island="assessment"][data-block-id="single"]');
			await expect(block).toHaveAttribute("data-hydrated", "");
			if (outcome === "exhausted") {
				await block.getByRole("radio", { name: "Interrupt", exact: true }).check();
				await block.locator("[data-assessment-submit]").click();
				await block
					.getByRole("button", { name: locale === "en" ? "Try again" : "Réessayer", exact: true })
					.click();
			}
			await block
				.getByRole("radio", { name: outcome === "correct" ? "Listen" : "Interrupt", exact: true })
				.check();
			await block.locator("[data-assessment-submit]").click();
			const action = block.getByRole("button", {
				name: locale === "en" ? "Continue" : "Continuer",
				exact: true,
			});
			await expect(action).toBeFocused();
			await expect(action).toHaveAccessibleName(locale === "en" ? "Continue" : "Continuer");
			await expect(action).toHaveAccessibleDescription(
				locale === "en"
					? `${outcome === "correct" ? "Correct" : "Not quite"} Consider how the other person feels.`
					: `${outcome === "correct" ? "Correct" : "Pas tout à fait"} Pensez à ce que ressent l’autre personne.`,
			);
		});
	}
	test(`${locale} final categorization without a next action focuses its score paragraph`, async ({
		page,
		feedbackCourse,
	}) => {
		await page.goto(`${feedbackCourse}/${locale}/index.html`);
		const block = page.locator('[data-island="assessment"][data-block-id="categorize"]');
		await expect(block).toHaveAttribute("data-hydrated", "");
		await block
			.getByRole("radio", {
				name: locale === "en" ? "Listen: Helpful" : "Listen : Helpful",
				exact: true,
			})
			.check();
		await block
			.getByRole("radio", {
				name: locale === "en" ? "Interrupt: Unhelpful" : "Interrupt : Unhelpful",
				exact: true,
			})
			.check();
		await block.locator("[data-assessment-submit]").click();
		await expect(block.getByRole("button")).toHaveCount(0);
		const summary = block.locator("[data-row-summary]");
		await expect(summary).toBeFocused();
		await expect(summary).toHaveAttribute("tabindex", "-1");
		await expect(summary).toHaveText(locale === "en" ? "2 of 2 correct" : "2 sur 2 corrects");
		for (const attribute of ["role", "aria-label", "aria-labelledby", "tabindex", "aria-live"])
			await expect(block.locator("[data-assessment-feedback]")).not.toHaveAttribute(attribute);
	});
}

for (const locale of ["en", "fr"]) {
	test(`${locale} exhausted free response focuses Continue described by Completed`, async ({
		page,
		feedbackCourse,
	}) => {
		await page.goto(`${feedbackCourse}/${locale}/index.html`);
		const block = page.locator('[data-island="assessment"][data-block-id="free"]');
		await expect(block).toHaveAttribute("data-hydrated", "");
		await block.getByRole("textbox").fill("My answer");
		await block.locator("[data-assessment-submit]").click();
		await block
			.getByRole("button", { name: locale === "en" ? "Try again" : "Réessayer", exact: true })
			.click();
		await expect(block.locator('[aria-describedby*="feedback-free"]')).toHaveCount(0);
		await block.locator("[data-assessment-submit]").click();
		const action = block.getByRole("button", {
			name: locale === "en" ? "Continue" : "Continuer",
			exact: true,
		});
		await expect(
			block.getByRole("button", { name: locale === "en" ? "Try again" : "Réessayer", exact: true }),
		).toHaveCount(0);
		await expect(action).toBeFocused();
		await expect(action).toHaveAccessibleName(locale === "en" ? "Continue" : "Continuer");
		await expect(action).toHaveAccessibleDescription(
			locale === "en"
				? "Completed Consider how the other person feels."
				: "Terminé Pensez à ce que ressent l’autre personne.",
		);
	});
}
