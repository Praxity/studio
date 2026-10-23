import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { SCORMRuntime } from "../../../../packages/export-pipeline/src/scorm/types";
import { canvasMessages } from "../../src/shared/canvas-messages";
import { startJourney } from "./global-setup";

const source = (lang: string) =>
	`---\nlang: ${lang}\ndesign:\n  colorMode: ${lang === "fr" ? "dark" : "light"}\n---\n# Practice\n::: highlight ${lang === "fr" ? "Une pause utile" : "A useful pause"}\nquestion: ${lang === "fr" ? "Pourquoi revenir ?" : "Why return?"}\n:: ${lang === "fr" ? "Il dit : « Je reviens à midi ! »" : "They know when to expect you."} {key}\nnote: ${lang === "fr" ? "Une heure précise." : "A precise time."}\n:: ${lang === "fr" ? "Le mur est bleu." : "The wall is blue."}\nnote: ${lang === "fr" ? "Ce détail décrit la couleur." : "This describes the colour."}\n:::\n`;

const readState = (page: Page) =>
	page.evaluate(() => {
		const runtime = Reflect.get(window, "__praxityRuntime") as SCORMRuntime | undefined;
		if (!runtime) throw new Error("Missing learner runtime in Read mode");
		return JSON.stringify({
			local: Object.entries(localStorage),
			session: Object.entries(sessionStorage),
			suspend: runtime.getSuspendData(),
			interactions: runtime.getInteractions(),
			writes: Reflect.get(window, "highlightStorageWrites"),
		});
	});

async function watchStorage(page: Page) {
	await page.evaluate(() => {
		const writes: unknown[] = [];
		Reflect.set(window, "highlightStorageWrites", writes);
		for (const name of ["setItem", "removeItem", "clear"] as const) {
			const original = Storage.prototype[name];
			Reflect.set(Storage.prototype, name, function (this: Storage, ...args: unknown[]) {
				writes.push([this === localStorage ? "local" : "session", name, ...args]);
				return Reflect.apply(original, this, args);
			});
		}
	});
}

for (const [lang, width, theme] of [
	["en", 1280, "light"],
	["en", 320, "light"],
	["fr", 320, "dark"],
] as const) {
	test.describe(`${lang} ${width} ${theme}`, () => {
		const stops: (() => Promise<void>)[] = [];
		let file = "";
		let invalidFile = "";
		let authorUrl = "";
		let readUrl = "";
		let page: Page;
		let invalidPage: Page;
		const initial = source(lang);
		const initialText = lang === "fr" ? "Le mur est bleu." : "The wall is blue.";
		const updatedText = lang === "fr" ? "Le mur est vert." : "The wall is green.";
		const recoveredText = lang === "fr" ? "Le mur est rouge." : "The wall is red.";
		const updated = initial.replace(initialText, updatedText);
		const recovered = initial.replace(initialText, recoveredText);
		const messages = canvasMessages[lang];
		const chunk = (target = page) =>
			target.locator("[data-highlight-passage] [data-highlight-chunk]").nth(1);

		test.beforeAll(async ({ browser }) => {
			// Recovery owns a green input that the other cases cannot change.
			for (const authored of [initial, updated]) {
				stops.push(await startJourney(browser, { standaloneSource: authored }));
				const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
				const sourceFile = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
				const prepared = await browser.newPage({
					viewport: { width, height: 900 },
					colorScheme: theme,
				});
				await prepared.goto(`${origin}/launch?canvas=1`);
				await expect(prepared.locator("#studio-status")).toHaveText(messages.connected);
				if (authored === initial) {
					page = prepared;
					file = sourceFile;
					authorUrl = page.url();
					const read = page.getByRole("link", { name: messages.read, exact: true });
					await expect(read).toHaveAttribute("href", /canvas\/preview/);
					readUrl = (await read.getAttribute("href")) ?? "";
				} else {
					invalidPage = prepared;
					invalidFile = sourceFile;
				}
			}
		});
		test.afterAll(async () => {
			await page?.context().close();
			await invalidPage?.context().close();
			for (const stop of stops) await stop();
		});
		async function restoreSource(authored: string) {
			// Disconnect the previous document before restoring this case's source.
			await page.goto("about:blank");
			if ((await readFile(file, "utf8")) !== authored) await writeFile(file, authored);
		}
		async function openEdit() {
			await restoreSource(initial);
			await page.goto(authorUrl, { waitUntil: "domcontentloaded" });
			await expect(page.locator("#studio-status")).toHaveText(messages.connected);
			await expect(page.locator("[data-highlight]")).toHaveCount(1);
			await expect(chunk()).toHaveText(initialText);
			await expect(page.getByRole("button", { name: messages.enter, exact: true })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
		}
		async function expectReadReady() {
			await expect(page.locator("[data-highlight]")).toHaveAttribute("data-highlight-enhanced", "");
			await expect(chunk()).toHaveText(initialText);
			await expect
				.poll(() => page.evaluate(() => !!Reflect.get(window, "__praxityRuntime")))
				.toBe(true);
			await expect(page.locator('[data-highlight-chunk][aria-pressed="true"]')).toHaveCount(0);
		}
		async function openRead() {
			await restoreSource(initial);
			await page.goto(readUrl, { waitUntil: "domcontentloaded" });
			await expectReadReady();
			await watchStorage(page);
		}

		async function expectSourceOnly(target = page) {
			const edits = target.getByRole("button", { name: /^(Edit|Modifier) .*\d+\s*:/u });
			await expect(edits).toHaveCount(1);
			await expect(edits).toHaveAccessibleName(
				lang === "en" ? "Edit heading 1: Practice" : "Modifier le titre 1 : Practice",
			);
			expect(await target.evaluate(() => Reflect.get(window, "__praxityRuntime"))).toBeUndefined();
			const root = target.locator("[data-highlight]");
			await expect(root).not.toHaveAttribute("data-highlight-enhanced");
			await expect(root.locator("[data-highlight-memory-notice]")).toHaveCount(0);
			await expect(root.locator("[data-node-id]")).toHaveCount(0);
		}

		test("Edit exposes only the page heading control", async () => {
			await openEdit();
			await expectSourceOnly();
		});

		test("script-stripped baseline has no bindings or notice", async () => {
			await openEdit();
			const root = page.locator("[data-highlight]");
			const answer = root.locator("[data-highlight-fallback]");
			await expect(answer).toBeVisible();
			await expect(answer).not.toHaveAttribute("open");
			await expect(answer.locator("summary")).toHaveText(lang === "fr" ? "Réponse" : "Answer");
			await expect(root.locator("[data-highlight-check]")).toBeHidden();
			await expect(root.locator("[data-highlight-restart]")).toBeHidden();
			await expect(root.locator("[data-highlight-enhanced]")).toHaveCount(0);
			await expect(root.locator("[data-highlight-chunk][role=button]")).toHaveCount(0);
			await expectSourceOnly();
		});

		test("valid source refreshes the highlight", async () => {
			await openEdit();
			await writeFile(file, updated);
			await expect(chunk()).toHaveText(updatedText);
			await expect(page.locator("[data-highlight-fallback]")).toContainText(updatedText);
			await expect(page.locator("[data-highlight-fallback]")).not.toContainText(initialText);
			await expect(page.locator("[data-highlight-print-answer]")).toContainText(updatedText);
			await expect(page.locator("[data-highlight-print-answer]")).not.toContainText(initialText);
			await expect(page.locator("#studio-status")).toHaveText(messages.connected);
			await expectSourceOnly();
		});

		test("invalid source retains the last good highlight and recovers", async () => {
			const page = invalidPage;
			const file = invalidFile;
			expect(await readFile(file, "utf8")).toBe(updated);
			await expect(chunk(page)).toHaveText(updatedText);
			await expect(page.getByRole("button", { name: messages.enter, exact: true })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			await expectSourceOnly(page);
			const root = page.locator("[data-highlight]");
			const good = await root.innerHTML();
			await writeFile(file, updated.replace("{key}", '{key="true"}'));
			await expect(page.locator("#studio-status")).toHaveText(messages.refreshFailed);
			expect(await root.innerHTML()).toBe(good);
			await writeFile(file, recovered);
			await expect(chunk(page)).toHaveText(recoveredText);
			await expect(root.locator("[data-highlight-passage]")).not.toContainText(updatedText);
			await expect(page.locator("[data-highlight-fallback]")).toContainText(recoveredText);
			await expect(page.locator("[data-highlight-fallback]")).not.toContainText(updatedText);
			await expect(page.locator("[data-highlight-print-answer]")).toContainText(recoveredText);
			await expect(page.locator("[data-highlight-print-answer]")).not.toContainText(updatedText);
			await expect(page.locator("#studio-status")).toHaveText(messages.connected);
			await expect(page.getByRole("link", { name: messages.read, exact: true })).toHaveAttribute(
				"href",
				/canvas\/preview/,
			);
			await expectSourceOnly(page);
		});

		test("Read marks, checks and resets without changing stored state", async () => {
			await openRead();
			const root = page.locator("[data-highlight]");
			const before = await readState(page);
			await root.locator("[data-highlight-chunk]").first().click();
			await root.locator("[data-highlight-check]").click();
			await expect(root.locator("[data-highlight-fallback]")).toHaveAttribute("open", "");
			await expect(root.locator("[data-highlight-memory-notice]")).toBeVisible();
			expect(await readState(page)).toBe(before);
			await root.locator("[data-highlight-restart]").click();
			await expect(root.locator('[data-highlight-chunk][aria-pressed="true"]')).toHaveCount(0);
			await expect(root.locator("[data-highlight-fallback]")).toBeHidden();
			expect(await readState(page)).toBe(before);
			expect(await readFile(file, "utf8")).toBe(initial);
		});

		test("Read reload clears marks and preserves source bytes", async () => {
			await openRead();
			const root = page.locator("[data-highlight]");
			await root.locator("[data-highlight-chunk]").first().click();
			await root.locator("[data-highlight-check]").click();
			await expect(root.locator('[data-highlight-chunk][aria-pressed="true"]')).toHaveCount(1);
			await page.reload();
			await expectReadReady();
			expect(await readFile(file, "utf8")).toBe(initial);
		});
	});
}
