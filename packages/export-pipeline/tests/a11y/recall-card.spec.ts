import { mkdir, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { buildScormPackage } from "../../src/build";
import { test } from "../muted-test";
import { buildLightweightCourse } from "./fixtures/lightweight-fixture";
import { readTestEnv } from "./helpers";

let server: Server;
let base: string;

test.beforeAll(async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "recall-card-"));
	for (const locale of ["en", "fr"] as const) {
		for (const dark of [false, true]) {
			const content = splitBlocksIntoPages(
				readLesson(
					`# Recall\n\n::: cards {layout=slides trackCompletion advance=1}\n:: Recall prompt\nWhat prevents a fall?\n\n::: back\n## Recall answer\nUse a guardrail. [Review the procedure](#recall)\n:::\n\n:: Second prompt\nWhat protects your eyes?\n\n::: back\nWear goggles.\n:::\n:::\n`,
				).blocks,
				"Recall",
			);
			const course = {
				...buildLightweightCourse({
					theme: {
						name: dark ? "clay-dark" : "ink-light",
						palette: dark ? "clay" : "ink",
						colorMode: dark ? "dark" : "light",
					},
				}),
				id: `recall-${locale}-${dark}`,
				sourceLocale: locale,
				content,
			};
			const result = await buildScormPackage(course, { format: "html" });
			new AdmZip(result.zip).extractAllTo(
				resolve(directory, `${locale}-${dark ? "dark" : "light"}`),
				true,
			);
		}
	}
	server = createServer(
		(req, res) => void handler(req, res, { public: directory, cleanUrls: false }),
	);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing recall server address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	await new Promise<void>((done, reject) =>
		server.close((error) => (error ? reject(error) : done())),
	);
});

async function capture(page: Page, card: Locator, name: string) {
	const directory = process.env.PRAXITY_RECALL_CAPTURES;
	if (!directory || test.info().project.name !== "chromium") return;
	await mkdir(directory, { recursive: true });
	await card.screenshot({ path: resolve(directory, `${name}.png`) });
}

async function open(page: Page, locale = "en", mode = "light") {
	await page.goto(`${base}/${locale}-${mode}/recall.html`);
	const root = page.locator("[data-card-root]");
	await root.scrollIntoViewIfNeeded();
	await expect(root).toHaveAttribute("data-card-enhanced", "true");
	await page.evaluate(() => document.fonts.ready);
	return root;
}

for (const mode of ["light", "dark"]) {
	for (const width of [1280, 390]) {
		test(`recall commit ${mode} ${width}`, async ({ page, browserName }) => {
			await page.setViewportSize({ width, height: 844 });
			const root = await open(page, "en", mode);
			const card = root.locator("[data-card-item]").first();
			const toggle = card.locator("[data-card-flip]");
			const answer = card.locator('[data-card-side="back"]');
			await capture(page, card, `${mode}-${width}-prompt`);
			await expect(toggle).toHaveText("I have my answer");
			await expect(toggle).toHaveAttribute("aria-expanded", "false");
			await expect(answer).toBeHidden();
			await expect(card).toHaveCSS("padding-left", "0px");
			await expect(card).toHaveCSS("border-top-width", "0px");
			await expect(card).toHaveCSS("box-shadow", "none");
			const heading = card.locator(".praxity-flashcard-face-heading");
			const before = await heading.evaluate((e) => e.getBoundingClientRect().top);
			await toggle.focus();
			// Pause the real transitions in the activation turn, before slow
			// cross-engine assertions can outlast its 200ms duration.
			await toggle.evaluate((button) => {
				(button as HTMLButtonElement).click();
				for (const animation of button.nextElementSibling?.getAnimations() ?? []) animation.pause();
			});
			await expect(toggle).toBeFocused();
			await expect(toggle).toHaveText("Hide answer");
			await expect(toggle).toHaveAttribute("aria-expanded", "true");
			await expect(answer).toBeVisible();
			expect(await toggle.getAttribute("aria-controls")).toBe(await answer.getAttribute("id"));
			expect(await toggle.ariaSnapshot()).toContain('button "Hide answer" [expanded]');
			expect(
				Math.abs((await heading.evaluate((e) => e.getBoundingClientRect().top)) - before),
			).toBeLessThanOrEqual(0.5);
			const reveal = card.locator("[data-content-reveal]");
			await expect(reveal).toHaveCSS("transition-property", "grid-template-rows, opacity");
			await expect(reveal).toHaveCSS("transition-duration", "0.2s, 0.2s");
			await expect(reveal).toHaveCSS(
				"transition-timing-function",
				"cubic-bezier(0.2, 0.8, 0.2, 1), cubic-bezier(0.2, 0.8, 0.2, 1)",
			);
			const growth = await reveal.evaluate((element) => {
				const animations = element.getAnimations();
				const properties = animations.map((animation) =>
					animation instanceof CSSTransition ? animation.transitionProperty : "unknown",
				);
				for (const animation of animations) {
					animation.pause();
					animation.currentTime = 0;
				}
				const start = element.getBoundingClientRect().height;
				for (const animation of animations) animation.currentTime = 100;
				const middle = element.getBoundingClientRect().height;
				for (const animation of animations) animation.finish();
				return { properties, start, middle, end: element.getBoundingClientRect().height };
			});
			expect(growth.properties.sort()).toEqual(["grid-template-rows", "opacity"]);
			expect(growth.start).toBeCloseTo(0, 1);
			expect(growth.middle).toBeGreaterThan(growth.start);
			expect(growth.middle).toBeLessThan(growth.end);
			await expect(answer).toHaveCSS("opacity", "1");
			const transforms = await card.evaluate((e) =>
				[e, ...e.querySelectorAll("*")].map((node) => getComputedStyle(node).transform),
			);
			expect(transforms.every((transform) => !transform.startsWith("matrix3d"))).toBe(true);
			await capture(page, card, `${mode}-${width}-answer`);
			// Safari's Option+Tab includes native links on macOS.
			await toggle.press(
				browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
			);
			await expect(answer.getByRole("link")).toBeFocused();
			await toggle.focus();
			await toggle.press("Space");
			await expect(toggle).toBeFocused();
			await expect(toggle).toHaveText("I have my answer");
			await expect(answer).toBeHidden();
			// Hiding the answer does not undo the existing completion credit.
			await expect(root).toHaveAttribute("data-flipped-count", "1");
		});
	}
}

test("French recall commit and hide labels", async ({ page }) => {
	const root = await open(page, "fr");
	const toggle = root.locator("[data-card-flip]").first();
	await expect(toggle).toHaveText("J'ai ma réponse");
	await toggle.click();
	await expect(toggle).toHaveText("Masquer la réponse");
});

test("recall reduced motion is instant", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const root = await open(page);
	const card = root.locator("[data-card-item]").first();
	await card.locator("[data-card-flip]").click();
	const answer = card.locator('[data-card-side="back"]');
	await expect(answer).toBeVisible();
	await expect(answer).toHaveCSS("animation-name", "none");
	await expect(answer).toHaveCSS("transform", "none");
	await capture(page, card, "reduced-motion-answer");
});

test("print shows both faces and removes the commit control", async ({ page }) => {
	const root = await open(page);
	await page.emulateMedia({ media: "print" });
	await expect(root.locator('[data-card-side="front"]').first()).toBeVisible();
	await expect(root.locator('[data-card-side="back"]').first()).toBeVisible();
	await expect(root.locator("[data-card-flip]").first()).toBeHidden();
});

test("no JavaScript shows all prompts and answers", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		await page.goto(`${base}/en-light/recall.html`);
		for (const face of await page.locator("[data-card-side]").all())
			await expect(face).toBeVisible();
		for (const button of await page.locator("[data-card-flip]").all())
			await expect(button).toBeHidden();
	} finally {
		await context.close();
	}
});

test("authored advance stays on the first recall card until learner Play", async ({ page }) => {
	await page.clock.install();
	const root = await open(page);
	await page.clock.runFor(2200);
	await expect(root.locator('[data-active="true"]')).toContainText("Recall prompt");
});

test("narration keeps the prompt readable and cannot reveal an uncommitted answer", async ({
	page,
}) => {
	const root = await open(page);
	const card = root.locator('[data-card-index="0"]');
	for (const side of ["front", "back"]) {
		await root.evaluate(
			(element, side) =>
				element.dispatchEvent(
					new CustomEvent("praxity:narration-reveal", {
						bubbles: true,
						detail: {
							cardTarget: {
								containerId: element.getAttribute("data-block-id"),
								itemIndex: 0,
								side,
							},
						},
					}),
				),
			side,
		);
		await expect(card.locator('[data-card-side="front"]')).toBeVisible();
		await expect(card.locator('[data-card-side="back"]')).toBeHidden();
		await expect(card.getByRole("button", { name: "I have my answer" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	}
	await card.getByRole("button", { name: "I have my answer" }).click();
	await expect(card.locator('[data-card-side="back"]')).toBeVisible();
});

test("comprehensive recall captures", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/container-blocks.html`);
	const root = page
		.locator("[data-card-root]")
		.filter({ has: page.locator('[data-flippable="true"]') })
		.first();
	await root.scrollIntoViewIfNeeded();
	await expect(root).toHaveAttribute("data-card-enhanced", "true");
	const card = root.locator('[data-flippable="true"]').first();
	await capture(page, card, "comprehensive-prompt");
	await card.locator("[data-card-flip]").click();
	await expect(card.locator('[data-card-side="back"]')).toBeVisible();
	await capture(page, card, "comprehensive-answer");
});
