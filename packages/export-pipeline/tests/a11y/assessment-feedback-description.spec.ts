import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { ChoiceResponse, PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { buildScormPackage } from "../../src/build";
import { test } from "../muted-test";
import { activityBugsFixture } from "./fixtures/activity-bugs-fixture";

let server: Server;
let directory: string;
let base: string;
const terminalDeckEntries = new Map<string, string>();

test.beforeAll(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "assessment-description-"));
	for (const locale of ["en", "fr"] as const) {
		const course = activityBugsFixture(locale);
		course.navigationStyle = "sidebar";
		const choice = course.content[0].blocks.find((block) => block.id === "choice");
		const categorize = course.content[0].blocks.find((block) => block.id === "categorize");
		if (!choice || !categorize) throw new Error("Missing assessment fixture");
		const explanation =
			locale === "en" ? "Let the person finish." : "Laissez la personne terminer.";
		choice.data.response = {
			type: "choice",
			selectionMode: "single",
			options: [
				{ id: "wrong", label: "Interrupt", isCorrect: false },
				{ id: "right", label: "Listen", isCorrect: true },
			],
		};
		choice.data.feedback = {
			incorrect: [{ id: "explanation", type: "text", data: { content: explanation } }],
			correct: [{ id: "correct-explanation", type: "text", data: { content: explanation } }],
		};
		choice.data.dontKnow = true;
		const inlineChoice = JSON.parse(JSON.stringify(choice), (key, value) =>
			key === "id" && typeof value === "string" ? `inline-${value}` : value,
		) as PraxityBlock;
		inlineChoice.id = "inline-choice";
		inlineChoice.data.feedback = {};
		(inlineChoice.data.response as ChoiceResponse).options[0].feedback = explanation;
		const free: PraxityBlock = {
			id: "free",
			type: "assessment",
			data: {
				assessmentType: "textResponse",
				gradingMode: "none",
				feedbackEnabled: true,
				stem: [{ id: "free-stem", type: "text", data: { content: "Your response" } }],
				response: { type: "textResponse", inputType: "short" },
				feedback: {
					correct: [{ id: "free-feedback", type: "text", data: { content: explanation } }],
				},
			},
		};
		const group: PraxityBlock = {
			id: "group",
			type: "assessmentGroup",
			data: {
				mode: "all",
				requireAll: true,
				showResultsSummary: true,
				memberBlockIds: ["first", "second"],
			},
		};
		const members = ["first", "second"].map((id) => {
			const member = JSON.parse(JSON.stringify(choice), (key, value) =>
				key === "id" && typeof value === "string" ? `${id}-${value}` : value,
			) as PraxityBlock;
			member.id = id;
			member.data.gradingMode = "none";
			member.data.required = false;
			return member;
		});
		course.content = [
			{
				id: "individual",
				title: "Individual",
				blocks: [
					choice,
					categorize,
					free,
					inlineChoice,
					{ id: "after", type: "text", data: { content: "Next content" } },
				],
			},
			{ id: "group-page", title: "Group", blocks: [group, ...members] },
			{
				id: "done",
				title: "Done",
				blocks: [{ id: "done-text", type: "text", data: { content: "Done" } }],
			},
			{
				id: "terminal",
				title: "Terminal",
				blocks: [
					{
						id: "terminal-group",
						type: "assessmentGroup",
						data: {
							mode: "all",
							requireAll: true,
							showResultsSummary: true,
							memberBlockIds: ["terminal-member"],
						},
					},
					JSON.parse(JSON.stringify(members[0]), (key, value) =>
						key === "id" && typeof value === "string" ? `terminal-${value}` : value,
					),
				],
			},
		];
		const terminal = course.content[3].blocks[1];
		terminal.id = "terminal-member";
		terminal.data.attempts = 1;
		const partialMembers = members.map(
			(member) =>
				JSON.parse(JSON.stringify(member), (key, value) =>
					key === "id" && typeof value === "string" ? `partial-${value}` : value,
				) as PraxityBlock,
		);
		course.content.splice(3, 0, {
			id: "partial",
			title: "Partial group",
			blocks: [
				{
					...group,
					id: "partial-group",
					data: {
						...group.data,
						requireAll: false,
						memberBlockIds: partialMembers.map((member) => member.id),
					},
				},
				...partialMembers,
			],
		});
		const result = await buildScormPackage(course, { format: "html" });
		new AdmZip(result.zip).extractAllTo(resolve(directory, locale));
		const deckMember = JSON.parse(JSON.stringify(members[0]), (key, value) =>
			key === "id" && typeof value === "string" ? `deck-${value}` : value,
		) as PraxityBlock;
		deckMember.id = "deck-member";
		const terminalDeck = await buildScormPackage(
			{
				...course,
				id: `terminal-deck-${locale}`,
				navigationStyle: "slides",
				moduleDeck: { gates: {} },
				content: [
					{
						id: "terminal-deck",
						title: "Terminal group",
						lessonId: "terminal-lesson",
						lessonTitle: "Terminal lesson",
						isFirstPageOfLesson: true,
						blocks: [
							{ ...group, data: { ...group.data, memberBlockIds: [deckMember.id] } },
							deckMember,
						],
					},
				],
			},
			{ format: "html" },
		);
		const deckZip = new AdmZip(terminalDeck.zip);
		deckZip.extractAllTo(resolve(directory, locale, "terminal-deck"));
		const deckEntry = deckZip
			.getEntries()
			.find(
				(entry) =>
					entry.entryName.endsWith(".html") &&
					entry.getData().toString().includes('data-deck-slide="terminal-deck"'),
			);
		if (!deckEntry) throw new Error("Missing terminal deck fixture");
		terminalDeckEntries.set(locale, deckEntry.entryName);
	}
	server = createServer(
		(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
	);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((done) => server.close(() => done()));
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function activity(page: Page, id: string): Promise<Locator> {
	const card = page.locator(`[data-island="assessment"][data-block-id="${id}"]`);
	await card.scrollIntoViewIfNeeded();
	await expect(card).toHaveAttribute("data-hydrated", "");
	return card;
}

for (const locale of ["en", "fr"] as const) {
	const explanation = locale === "en" ? "Let the person finish." : "Laissez la personne terminer.";
	test(`N11 Finish clears the terminal group description ${locale}`, async ({ page }) => {
		const entry = terminalDeckEntries.get(locale);
		if (!entry) throw new Error("Missing terminal deck entry");
		await page.goto(`${base}/${locale}/terminal-deck/${entry}`);
		const card = await activity(page, "deck-member");
		await card.getByRole("radio", { name: "Listen", exact: true }).check();
		await page.locator('[data-assessment-group-submit="group"] button').click();
		const next = page.locator("#deck-next");
		await expect(next).toBeFocused();
		await expect(next).toHaveAccessibleDescription(
			locale === "en" ? "1 of 1 correct · Passed" : "1 sur 1 correctes · Réussi",
		);
		await next.click();
		await expect(page.locator("#deck-completion")).toBeVisible();
		await expect(next).not.toHaveAttribute("aria-describedby");
		await expect(next).toHaveAccessibleDescription(
			locale === "en" ? "Back to course" : "Retour au cours",
		);
	});
	test(`N11 incomplete group keeps member feedback focus ${locale}`, async ({ page }) => {
		await page.goto(`${base}/${locale}/partial-group.html`);
		const first = await activity(page, "partial-first");
		const second = await activity(page, "partial-second");
		await first.getByRole("radio", { name: "Interrupt", exact: true }).check();
		await expect(second.getByRole("radio", { name: "Listen", exact: true })).not.toBeChecked();
		await page.locator('[data-assessment-group-submit="partial-group"] button').click();
		const retry = first.locator("[data-assessment-retry]");
		await expect(retry).toBeFocused();
		await expect(retry).toHaveAccessibleDescription(
			`${locale === "en" ? "Not quite" : "Pas tout à fait"} ${explanation}`,
		);
		await expect(page.locator(".praxity-ag-results-score")).toHaveCount(0);
	});
	test(`N11 description ${locale} inline authored explanation beats generic status`, async ({
		page,
	}) => {
		await page.goto(`${base}/${locale}/individual.html`);
		const card = await activity(page, "inline-choice");
		await card.getByRole("radio", { name: "Interrupt", exact: true }).check();
		await card.locator("[data-assessment-submit]").click();
		const retry = card.locator("[data-assessment-retry]");
		await expect(retry).toBeFocused();
		await expect(retry).toHaveAccessibleDescription(
			`${locale === "en" ? "Not quite" : "Pas tout à fait"} ${explanation}`,
		);
		await expect(card.locator("[data-assessment-status]")).toHaveText(
			locale === "en" ? "1 of 2 attempts used" : "Tentatives utilisées : 1 sur 2",
		);
	});
	for (const answer of ["wrong", "unknown", "correct"] as const) {
		test(`N11 description ${locale} choice ${answer}`, async ({ page }) => {
			await page.goto(`${base}/${locale}/individual.html`);
			const card = await activity(page, "choice");
			const name =
				answer === "unknown"
					? locale === "en"
						? "I don't know"
						: "Je ne sais pas"
					: answer === "wrong"
						? "Interrupt"
						: "Listen";
			await card.getByRole("radio", { name, exact: true }).check();
			await card.locator("[data-assessment-submit]").click();
			const button = card.locator(
				answer === "correct" ? "[data-assessment-continue]" : "[data-assessment-retry]",
			);
			await expect(button).toBeFocused();
			const result =
				answer === "unknown"
					? locale === "en"
						? 'You chose "I don\'t know"'
						: "Vous avez choisi « Je ne sais pas »"
					: answer === "wrong"
						? locale === "en"
							? "Not quite"
							: "Pas tout à fait"
						: "Correct";
			await expect(button).toHaveAccessibleDescription(`${result} ${explanation}`);
			const ids = (await button.getAttribute("aria-describedby"))?.split(/\s+/);
			expect(ids).toHaveLength(2);
		});
	}
	test(`N11 description ${locale} categorize and free response`, async ({ page }, testInfo) => {
		await page.goto(`${base}/${locale}/individual.html`);
		const categorize = await activity(page, "categorize");
		for (const row of await categorize.locator("tbody tr").all())
			await row.getByRole("radio").first().check();
		await categorize.locator("[data-assessment-submit]").click();
		const retry = categorize.locator("[data-assessment-retry]");
		await expect(retry).toBeFocused();
		await expect(retry).toHaveAccessibleName(locale === "en" ? "Try again" : "Réessayer");
		await expect(retry).toHaveAccessibleDescription(
			locale === "en" ? "2 of 4 correct" : "2 sur 4 corrects",
		);
		if (testInfo.project.name === "firefox") {
			await testInfo.attach(`firefox-${locale}-categorize-tree`, {
				body: await categorize.ariaSnapshot(),
				contentType: "text/plain",
			});
			const label = await retry.evaluate((button) => ({
				text: (button as HTMLElement).innerText,
				pseudo: ["::before", "::after"].map((pseudo) => getComputedStyle(button, pseudo).content),
				hidden: Array.from(button.querySelectorAll('[aria-hidden="true"]')).map(
					(element) => element.textContent,
				),
			}));
			expect(label.text).toBe(locale === "en" ? "Try again" : "Réessayer");
			await testInfo.attach(`firefox-${locale}-retry-label`, {
				body: JSON.stringify(label),
				contentType: "application/json",
			});
		}
		const free = await activity(page, "free");
		await free.getByRole("textbox").fill("My response");
		await free.locator("[data-assessment-submit]").click();
		const next = free.locator("[data-assessment-continue]");
		await expect(next).toBeFocused();
		await expect(next).toHaveAccessibleDescription(
			`${locale === "en" ? "Completed" : "Terminé"} ${explanation}`,
		);
	});

	test(`N11 retry clears stale descriptions ${locale}`, async ({ page }) => {
		await page.goto(`${base}/${locale}/individual.html`);
		const card = await activity(page, "choice");
		await card.getByRole("radio", { name: "Interrupt", exact: true }).check();
		await card.locator("[data-assessment-submit]").click();
		await card.locator("[data-assessment-retry]").click();
		await expect(card.getByRole("radio").first()).toBeFocused();
		for (const radio of await card.getByRole("radio").all())
			await expect(radio).toHaveAccessibleDescription("");
		expect(
			await card.evaluate((element) =>
				Array.from(element.querySelectorAll("[aria-describedby]")).flatMap((node) =>
					(node.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => {
						const target = document.getElementById(id);
						return (
							!target ||
							target.closest(
								"[data-option-feedback], [data-feedback-explanation], [data-assessment-feedback], .praxity-choice-feedback",
							) !== null
						);
					}),
				),
			),
		).toEqual([]);
	});

	for (const pattern of ["correct", "mixed", "wrong"] as const) {
		test(`N11 group focus ${locale} ${pattern} survives saved transition`, async ({ page }) => {
			await page.goto(`${base}/${locale}/group.html`);
			for (const [index, id] of ["first", "second"].entries()) {
				const card = await activity(page, id);
				await card
					.getByRole("radio", {
						name:
							pattern === "correct" || (pattern === "mixed" && index === 0)
								? "Listen"
								: "Interrupt",
						exact: true,
					})
					.check();
			}
			const submit = page.locator('[data-assessment-group-submit="group"] .praxity-ag-submit-btn');
			await submit.focus();
			await page.evaluate(() => {
				const failures: string[] = [];
				(window as Window & { bodyFocusFailures?: string[] }).bodyFocusFailures = failures;
				const announcements: string[] = [];
				(window as Window & { groupFocusTargets?: string[] }).groupFocusTargets = announcements;
				document.addEventListener("focusin", () =>
					announcements.push(document.activeElement?.textContent?.trim() ?? ""),
				);
				const sample = () => {
					if (document.activeElement === document.body) failures.push("BODY");
				};
				new MutationObserver(sample).observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
				});
				document.addEventListener("focusout", () => queueMicrotask(sample));
			});
			await submit.press("Enter");
			const summary = page.locator(
				'[data-assessment-group-submit="group"] .praxity-ag-results-score',
			);
			const count = pattern === "correct" ? 2 : pattern === "mixed" ? 1 : 0;
			const text =
				locale === "en"
					? `${count} of 2 correct · ${count === 2 ? "Passed" : "Not passed"}`
					: `${count} sur 2 correctes · ${count === 2 ? "Réussi" : "Non réussi"}`;
			await expect(summary).toHaveText(text);
			const action =
				pattern === "correct"
					? page.locator(".praxity-nav-next")
					: page.locator('[data-assessment-group="group"] [data-assessment-retry]').first();
			await expect(action).toBeFocused();
			await expect(action).toHaveAccessibleDescription(text);
			for (const attribute of ["role", "aria-label", "aria-labelledby", "tabindex"])
				await expect(summary).not.toHaveAttribute(attribute);
			await expect(summary).toHaveAccessibleName("");
			await expect(summary.locator("+ .praxity-ag-review-links a")).toHaveCount(2);
			// A following frame observes the post-submit save callback, including partial completion.
			await page.evaluate(
				() =>
					new Promise<void>((done) =>
						requestAnimationFrame(() => requestAnimationFrame(() => done())),
					),
			);
			await expect(action).toBeFocused();
			if (pattern !== "wrong") {
				await expect
					.poll(() => page.evaluate(() => window.__praxityBlockState?.get("group")))
					.toMatchObject({ completed: pattern === "correct" });
			}
			expect(
				await page.evaluate(
					() => (window as Window & { bodyFocusFailures?: string[] }).bodyFocusFailures,
				),
			).toEqual([]);
			expect(
				await page.evaluate(
					() => (window as Window & { groupFocusTargets?: string[] }).groupFocusTargets,
				),
			).toEqual([(await action.textContent())?.trim()]);
		});
	}
	test(`N11 terminal group fallback ${locale}`, async ({ page }) => {
		await page.goto(`${base}/${locale}/terminal.html`);
		const card = await activity(page, "terminal-member");
		await card.getByRole("radio", { name: "Interrupt", exact: true }).check();
		await page
			.locator('[data-assessment-group-submit="terminal-group"] .praxity-ag-submit-btn')
			.click();
		const summary = page.locator(
			'[data-assessment-group-submit="terminal-group"] .praxity-ag-results-score',
		);
		await expect(summary).toHaveText(
			locale === "en" ? "0 of 1 correct · Not passed" : "0 sur 1 correctes · Non réussi",
		);
		await expect(summary).toBeFocused();
		await expect(summary).toHaveAttribute("tabindex", "-1");
		await expect(summary).not.toHaveAttribute("role");
		await expect(summary).toHaveAccessibleName("");
	});
	test(`N11 hidden next action fallback ${locale}`, async ({ page }) => {
		await page.goto(`${base}/${locale}/group.html`);
		const next = page.locator(".praxity-nav-next");
		await next.evaluate((element) => {
			(element as HTMLElement).style.display = "none";
		});
		for (const id of ["first", "second"]) {
			const card = await activity(page, id);
			await card.getByRole("radio", { name: "Listen", exact: true }).check();
		}
		await page.locator('[data-assessment-group-submit="group"] .praxity-ag-submit-btn').click();
		const summary = page.locator(
			'[data-assessment-group-submit="group"] .praxity-ag-results-score',
		);
		await expect(summary).toBeFocused();
		await expect(summary).toHaveAttribute("tabindex", "-1");
		await expect(summary).toHaveText(
			locale === "en" ? "2 of 2 correct · Passed" : "2 sur 2 correctes · Réussi",
		);
		await expect(next).not.toHaveAttribute("aria-describedby");
	});
}
