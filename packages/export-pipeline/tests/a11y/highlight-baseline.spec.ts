import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { getHighlightStrings } from "@praxity/shared-blocks/i18n/highlight-strings";
import { check as checkHighlight } from "learning-patterns/patterns/highlight/logic.js";
import { expectFocusRing, expectForcedEmulationInert, forcedPalette } from "../focus-assertions";
import { highlightHarnessContent, writeHighlightHarness } from "./fixtures/highlight-harness";

let directory: string;
let url: string;
let server: ReturnType<typeof createServer>;
let context: BrowserContext;
let page: Page;
const evidence = process.env.PRAXITY_HIGHLIGHT_EVIDENCE_DIR;

async function waitForFonts(): Promise<void> {
	// Force layout and bound this no-script fixture's font-readiness check.
	// A pending fonts.ready promise must not consume the entire setup hook.
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					document.body.getBoundingClientRect();
					return document.fonts.status;
				}),
			{ timeout: 1_500 },
		)
		.toBe("loaded");
}

test.beforeAll(async ({ browser }) => {
	await test
		.info()
		.attach("browser-version", { body: browser.version(), contentType: "text/plain" });
	directory = await mkdtemp(join(tmpdir(), "highlight-baseline-"));
	await writeHighlightHarness(directory);
	server = createServer(async (request, response) => {
		const file = resolve(directory, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			response.writeHead(403).end();
			return;
		}
		try {
			response.setHeader(
				"Content-Type",
				file.endsWith(".css")
					? "text/css"
					: file.endsWith(".woff2")
						? "font/woff2"
						: "text/html; charset=utf-8",
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	context = await browser.newContext({ javaScriptEnabled: false });
	page = await context.newPage();
	await page.goto(`${url}/key-en-light.html`);
	await waitForFonts();
});
test.afterAll(async () => {
	await context?.close();
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true });
});

for (const mode of ["key", "evidence"]) {
	for (const { lang, theme } of [
		{ lang: "en", theme: "light" },
		{ lang: "fr", theme: "dark" },
	]) {
		for (const width of [1280, 320]) {
			for (const answer of ["closed", "open"]) {
				test(`${mode} ${answer} ${lang} ${theme} ${width}px without JavaScript`, async ({
					browserName,
				}, testInfo) => {
					testInfo.annotations.push({ type: "browser", description: browserName });
					await page.emulateMedia({ media: "screen" });
					await page.setViewportSize({ width, height: 900 });
					await page.goto(`${url}/${mode}-${lang}-${theme}.html`);
					await waitForFonts();
					if (answer === "open") await page.locator("details summary").click();
					await expect(page.locator("[data-highlight-passage]")).toBeVisible();
					await expect(page.locator("[data-highlight-chunk]")).toHaveCount(4);
					await expect(page.locator("[data-highlight-flow]")).toBeHidden();
					await expect(page.locator("[data-highlight-instructions]")).toBeHidden();
					await expect(page.locator("[data-highlight-print-answer]")).toBeHidden();
					await expect(page.locator("[data-highlight-memory-notice]")).toHaveCount(0);
					await expect(page.locator("[data-highlight-status]")).toHaveText("");
					const list = page.locator("details ul");
					if (answer === "open") {
						await expect(list).toBeVisible();
						await expect(list.locator("li")).toHaveCount(lang === "en" ? 3 : 4);
					} else await expect(list).toBeHidden();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
					).toBeLessThanOrEqual(1);
					if (lang === "fr")
						await expect(page.locator('[data-highlight-chunk="return"]')).toHaveText(
							"Il dit : « Je reviens à midi ! »",
						);
					if (mode === "evidence") {
						const styles = await page.locator("[data-highlight]").evaluate((root) => {
							const prompt = root.querySelector(".praxity-highlight-question");
							const passage = root.querySelector("[data-highlight-chunk]");
							if (!prompt || !passage || !prompt.parentElement)
								throw new Error("Missing prompt or passage");
							const body = getComputedStyle(passage);
							const question = getComputedStyle(prompt);
							const hint = getComputedStyle(prompt.parentElement);
							return {
								body: { size: body.fontSize, color: body.color },
								question: { size: question.fontSize, color: question.color },
								hint: { size: hint.fontSize, color: hint.color },
							};
						});
						expect(styles.question).toEqual(styles.body);
						expect(Number.parseFloat(styles.hint.size)).toBeLessThan(
							Number.parseFloat(styles.question.size),
						);
						expect(styles.hint.color).not.toBe(styles.question.color);
					}
					const filename = `${mode}-${answer}-${lang}-${theme}-${width}.png`;
					await page.screenshot({
						path: evidence ? join(evidence, filename) : testInfo.outputPath(filename),
						fullPage: true,
					});
				});
			}
		}
	}
	test(`${mode} prints passage then complete Answer and hides learner state`, async ({
		browserName,
	}, testInfo) => {
		await page.setViewportSize({ width: 1280, height: 1000 });
		await page.goto(`${url}/${mode}-en-light.html`);
		await page.evaluate((memoryCopy) => {
			// Plant checked UI and a failure notice without importing an enhancer.
			const root = document.querySelector("[data-highlight]")!;
			(root.querySelector("[data-highlight-flow]") as HTMLElement).hidden = false;
			const status = root.querySelector("[data-highlight-status]")!;
			status.textContent = status.getAttribute("data-highlight-unavailable");
			status.className = "praxity-assessment-choice-hint";
			const memory = document.createElement("p");
			memory.dataset.highlightMemoryNotice = "";
			memory.textContent = memoryCopy;
			root.after(memory);
			const chunk = root.querySelector("[data-highlight-chunk]")!;
			chunk.setAttribute("aria-pressed", "true");
			chunk.setAttribute("data-highlight-outcome", "correct");
			const feedback = root.querySelector("[data-highlight-feedback]") as HTMLElement;
			feedback.hidden = false;
			feedback.textContent = "LEARNER FEEDBACK";
		}, getHighlightStrings("en").highlightMemoryNotice);
		await page.emulateMedia({ media: "print" });
		await expect(page.locator("[data-highlight-passage]")).toBeVisible();
		await expect(page.locator("[data-highlight-print-answer]")).toBeVisible();
		await expect(page.locator("[data-highlight-print-answer] li")).toHaveCount(3);
		for (const marker of ["flow", "fallback", "status", "memory-notice", "feedback"]) {
			for (const node of await page.locator(`[data-highlight-${marker}]`).all())
				await expect(node).toBeHidden();
		}
		await expect(page.locator("[data-highlight-chunk]").first()).toHaveCSS(
			"text-decoration-line",
			"none",
		);
		await expect(page.locator("[data-highlight-chunk]").first()).toHaveCSS(
			"background-color",
			"rgba(0, 0, 0, 0)",
		);
		await expect(page.locator("details")).not.toHaveAttribute("open");
		await page.screenshot({
			path: evidence
				? join(evidence, `${mode}-print-en.png`)
				: testInfo.outputPath(`${mode}-print-en.png`),
			fullPage: true,
		});
		if (browserName === "chromium") {
			for (const format of ["A4", "Letter"] as const) {
				const path = evidence
					? join(evidence, `${mode}-${format}.pdf`)
					: testInfo.outputPath(`${mode}-${format}.pdf`);
				await page.pdf({ path, format });
				// Poppler is optional for suite portability; print visibility above is mandatory.
				if (process.env.PRAXITY_PDFTOTEXT) {
					const text = execFileSync(process.env.PRAXITY_PDFTOTEXT, ["-enc", "UTF-8", path, "-"], {
						encoding: "utf8",
					});
					expect(text).toContain(
						mode === "key"
							? "Key idea: They know when to expect you."
							: "Answers the question: They know when to expect you.",
					);
					expect(text).toContain("This gives a reason to say when you will return.");
					expect(text.indexOf("The wall is blue.")).toBeLessThan(text.indexOf("Answer"));
					expect(text).not.toMatch(
						/LEARNER FEEDBACK|Your marks reset|Marking is unavailable|marked/,
					);
					await writeFile(path.replace(/\.pdf$/, ".txt"), text);
				}
			}
		}
	});
}

test("French baseline wraps at 400% with text spacing and reduced motion", async () => {
	await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(`${url}/evidence-fr-dark.html`);
	await page.locator("details summary").click();
	// addStyleTag waits for a script-driven load event in a no-JavaScript context.
	await page.evaluate(() => {
		const style = document.createElement("style");
		style.textContent =
			"[data-highlight] { line-height: 1.5; letter-spacing: .12em; word-spacing: .16em; } [data-highlight] p { margin-block-end: 2em; }";
		document.head.append(style);
	});
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
	).toBeLessThanOrEqual(1);
	await expect(page.locator('[data-highlight-chunk="return"]')).toHaveText(
		"Il dit : « Je reviens à midi ! »",
	);
	await expect(page.locator("details ul")).toBeVisible();
});

test("owned CSS keeps hidden controls hidden and forced-colour verdicts distinct", async () => {
	await page.emulateMedia({ media: "screen", forcedColors: "active" });
	await page.goto(`${url}/key-fr-dark.html`);
	const result = checkHighlight(highlightHarnessContent("fr", "key"), ["pause", "return"]);
	expect(result.items.slice(0, 3).map(({ marked, outcome }) => ({ marked, outcome }))).toEqual([
		{ marked: true, outcome: "wrong" },
		{ marked: true, outcome: "correct" },
		{ marked: false, outcome: "missed" },
	]);
	// Apply a real checked outcome to the same passage spans without importing an enhancer.
	await page.evaluate((items) => {
		(document.querySelector("[data-highlight-flow]") as HTMLElement).hidden = false;
		for (const item of items) {
			const chunk = [...document.querySelectorAll("[data-highlight-chunk]")].find(
				(node) => node.getAttribute("data-highlight-chunk") === item.id,
			);
			if (!chunk) throw new Error(`Missing fixture chunk ${item.id}`);
			chunk.setAttribute("aria-pressed", String(item.marked));
			chunk.setAttribute("aria-disabled", "true");
			chunk.setAttribute("data-highlight-outcome", item.outcome);
		}
	}, result.items);
	await expect(page.locator("[data-highlight-check]")).toBeVisible();
	await expect(page.locator("[data-highlight-restart]")).toBeHidden();
	await expect(page.locator("[data-highlight-feedback]").first()).toBeHidden();
	const wrong = page.locator('[data-highlight-chunk][data-highlight-outcome="wrong"]');
	const correct = page.locator('[data-highlight-chunk][data-highlight-outcome="correct"]');
	if (!(await forcedPalette(page))) {
		const check = page.locator("[data-highlight-check]");
		await page.keyboard.press("Tab");
		await check.focus();
		await expect(check).toBeFocused();
		await expectForcedEmulationInert(page, [page.locator("[data-highlight-chunk]"), check]);
		await expectFocusRing(check, 2);
	} else {
		await expect(page.locator("[data-highlight-chunk]").nth(0)).toHaveCSS(
			"border-top-style",
			"solid",
		);
		await expect(correct).toHaveCSS("border-top-style", "solid");
	}
	await expect(wrong).toHaveAttribute("aria-pressed", "true");
	await expect(correct).toHaveAttribute("aria-pressed", "true");
	await expect(wrong).toHaveCSS("text-decoration-line", "none");
	await expect(correct).toHaveCSS("text-decoration-line", "underline");
	await expect(page.locator("[data-highlight-chunk]").nth(1)).toHaveCSS(
		"text-decoration-style",
		"solid",
	);
	await expect(page.locator("[data-highlight-chunk]").nth(2)).toHaveCSS(
		"text-decoration-style",
		"dashed",
	);
	await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
});

test("wrapped chunks clone their boxes and verdicts retain their word joiner", async () => {
	const css = await readFile(join(directory, "fr-dark.css"), "utf8");
	expect(css).toMatch(/-webkit-box-decoration-break:\s*clone\s*;/);
	expect(css).toMatch(/(?:^|[;{])\s*box-decoration-break:\s*clone\s*;/m);
	await page.emulateMedia({ media: "screen", forcedColors: "none" });
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto(`${url}/key-fr-dark.html`);
	const presentation = await page.evaluate(() => {
		const chunks = [...document.querySelectorAll<HTMLElement>("[data-highlight-chunk]")];
		const chunk = chunks[0];
		chunk.textContent = "Une longue phrase française pour vérifier les lignes du passage. ".repeat(
			8,
		);
		chunk.setAttribute("aria-pressed", "true");
		for (const [index, outcome] of ["correct", "missed"].entries()) {
			const feedback = chunks[index].nextElementSibling as HTMLElement;
			feedback.hidden = false;
			feedback.dataset.highlightOutcome = outcome;
			feedback.textContent = outcome === "correct" ? "Idée clé" : "Manqué";
		}
		const style = getComputedStyle(chunk);
		return {
			lines: chunk.getClientRects().length,
			supportsDecoration: CSS.supports("box-decoration-break", "clone"),
			decoration: style.getPropertyValue("box-decoration-break"),
			webkitDecoration: style.getPropertyValue("-webkit-box-decoration-break"),
			verdicts: [
				...document.querySelectorAll<HTMLElement>("[data-highlight-feedback]:not([hidden])"),
			].map((feedback) => ({
				joiner: getComputedStyle(feedback, "::before").content,
				whiteSpace: getComputedStyle(feedback).whiteSpace,
			})),
		};
	});
	expect(presentation.lines).toBeGreaterThan(1);
	expect([presentation.decoration, presentation.webkitDecoration]).toContain("clone");
	expect(
		presentation.supportsDecoration ? presentation.decoration : presentation.webkitDecoration,
	).toBe("clone");
	expect(presentation.verdicts).toHaveLength(2);
	for (const verdict of presentation.verdicts) {
		expect(verdict.joiner).toContain("\u2060");
		expect(verdict.whiteSpace).toBe("normal");
	}
});
