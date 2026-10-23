import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startJourney } from "./global-setup";

let stop: (() => Promise<void>) | undefined;
test.afterEach(async ({ page }) => {
	page.on("dialog", (dialog) => dialog.accept());
	await page.goto("about:blank");
	await stop?.();
});
const documentSource = (lang: string, body: string) => `---\nlang: ${lang}\n---\n\n${body}`;
async function open(page: Page, lang: string, body: string) {
	stop = await startJourney(page.context(), { standaloneSource: documentSource(lang, body) });
	await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
	await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
	await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
}
async function refresh(page: Page, lang: string, body: string) {
	const url = page.url();
	await writeFile(
		join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
		documentSource(lang, body),
	);
	await expect(page).not.toHaveURL(url);
}

for (const lang of ["en", "fr"]) {
	const fr = lang === "fr";
	const toggleName = fr ? "Modifier le texte" : "Edit text";
	const headingName = fr ? "Modifier le titre 1 : Practice" : "Edit heading 1: Practice";
	const paragraphPrefix = fr ? "Modifier le paragraphe" : "Edit paragraph";
	const repeated = "Repeated paragraph.";
	test(`C09 review final names are unique and follow refreshed page order, ${lang}`, async ({
		page,
	}) => {
		const body = `# Practice\n\n${repeated}\n\n${repeated}\n\n${repeated}, position 2\n`;
		await open(page, lang, body);
		const paragraphs = page.getByRole("button", { name: new RegExp(`^${paragraphPrefix}`) });
		const names = () =>
			paragraphs.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
		expect(new Set(await names()).size).toBe(3);
		expect(await names()).toEqual([
			`${paragraphPrefix} 1${fr ? " : " : ": "}${repeated}`,
			`${paragraphPrefix} 2${fr ? " : " : ": "}${repeated}`,
			`${paragraphPrefix} 3${fr ? " : " : ": "}${repeated}, position 2`,
		]);
		const toggle = page.getByRole("button", { name: toggleName, exact: true });
		await toggle.click();
		await refresh(
			page,
			lang,
			`# Practice\n\nBrand new paragraph.\n\n${repeated}\n\n${repeated}\n\n${repeated}, position 2\n`,
		);
		await expect(paragraphs).toHaveCount(0);
		await expect(page.getByRole("status")).toHaveText(
			fr ? "Modification du texte désactivée" : "Text editing off",
		);
		await toggle.click();
		expect(await names()).toEqual([
			`${paragraphPrefix} 1${fr ? " : " : ": "}Brand new paragraph.`,
			`${paragraphPrefix} 2${fr ? " : " : ": "}${repeated}`,
			`${paragraphPrefix} 3${fr ? " : " : ": "}${repeated}`,
			`${paragraphPrefix} 4${fr ? " : " : ": "}${repeated}, position 2`,
		]);
	});

	test(`C09 review delayed mode exit preserves later course focus, ${lang}`, async ({ page }) => {
		await open(page, lang, "# Practice\n\n[Course link](#main-content).\n");
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method === "canvasTextApply") await held;
			await route.continue();
		});
		try {
			await page.getByRole("button", { name: headingName, exact: true }).click();
			await page.getByRole("textbox").fill("Practice saved");
			const toggle = page.getByRole("button", { name: toggleName, exact: true });
			await toggle.click();
			await expect(page.getByRole("textbox")).toHaveAttribute("readonly", "");
			const link = page.getByRole("link", { name: "Course link", exact: true });
			await link.focus();
			await link.press("ArrowRight");
			const applied = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/rpc") &&
					response.request().postDataJSON().method === "canvasTextApply",
			);
			release();
			expect((await (await applied).json()).result.ok).toBe(true);
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			await expect(page.getByRole("textbox")).toHaveCount(0);
			await expect(link).toBeFocused();
		} finally {
			release();
		}
	});

	test(`C09 review startup toggle is unavailable until ready and after failure, ${lang}`, async ({
		page,
	}) => {
		stop = await startJourney(page.context(), {
			standaloneSource: documentSource(lang, "# Practice\n"),
		});
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method === "configRead") await held;
			await route.continue();
		});
		try {
			await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
			const toggle = page.getByRole("button", { name: toggleName, exact: true });
			await expect(toggle).toBeDisabled();
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			await expect(page.getByRole("status")).toHaveText(fr ? "Connexion" : "Connecting");
			release();
			await expect(toggle).toBeEnabled();
			await expect(toggle).toHaveAttribute("aria-pressed", "true");
			await page.route("**/api/events", (route) => route.abort());
			await page.reload();
			await expect(page.getByRole("status")).toHaveText(
				fr
					? "Studio n'a pas pu se connecter. Rouvrez le lien de lancement de Studio."
					: "Studio could not connect. Reopen the Studio launch link.",
			);
			await expect(toggle).toBeDisabled();
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			await expect(toggle).toHaveAccessibleDescription(
				fr
					? "Studio n'a pas pu se connecter. Rouvrez le lien de lancement de Studio."
					: "Studio could not connect. Reopen the Studio launch link.",
			);
		} finally {
			release();
		}
	});

	test(`C09 review repeated identical refusals clear between announcements, ${lang}`, async ({
		page,
	}) => {
		await open(page, lang, "# Practice\n");
		const status = page.getByRole("status");
		await status.evaluate((el) => {
			const messages: string[] = [];
			Reflect.set(window, "reviewMessages", messages);
			let last = el.textContent;
			new MutationObserver(() => {
				if (el.textContent !== last) {
					messages.push(el.textContent ?? "");
					last = el.textContent;
				}
			}).observe(el, { childList: true });
		});
		await page.getByRole("button", { name: headingName, exact: true }).click();
		const field = page.getByRole("textbox");
		await field.fill("");
		const refusal = fr ? "Saisissez du texte." : "Enter some text.";
		for (let attempt = 1; attempt <= 2; attempt++) {
			await field.press("Enter");
			await expect(status).toHaveText(refusal);
			await expect
				.poll(() => page.evaluate(() => Reflect.get(window, "reviewMessages")))
				.toEqual(attempt === 1 ? ["", refusal] : ["", refusal, "", refusal]);
		}
		await expect(page.locator("#error:visible")).toHaveText(refusal);
		const box = await status.boundingBox();
		if (!box) throw new Error("Missing live region");
		expect(box.width).toBeLessThanOrEqual(1);
		expect(box.height).toBeLessThanOrEqual(1);
	});

	test(`C09 review copy outcome survives saved-page refresh, ${lang}`, async ({ page }) => {
		// Delay the platform clipboard reply across explicit discard and its saved refresh.
		await page.addInitScript(() => {
			Object.defineProperty(navigator.clipboard, "writeText", {
				value: () => new Promise<void>((resolve) => Reflect.set(window, "finishCopy", resolve)),
			});
		});
		await open(page, lang, "# Practice\n\nOriginal paragraph.\n");
		await page.getByRole("button", { name: headingName, exact: true }).click();
		await page.getByRole("textbox").fill("Kept input");
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method === "canvasTextApply")
				return route.fulfill({ json: { ok: true, result: { ok: false, code: "stale" } } });
			await route.continue();
		});
		await page.getByRole("textbox").press("Enter");
		await expect(page.locator("#error:visible")).toBeVisible();
		await page
			.getByRole("button", { name: fr ? "Copier le texte" : "Copy text", exact: true })
			.click();
		const status = page.getByRole("status");
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/canvas/preview/**", async (route) => {
			await held;
			await route.continue();
		});
		try {
			const url = page.url();
			await writeFile(
				join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
				documentSource(lang, "# Practice\n\nChanged paragraph.\n"),
			);
			await page.getByRole("textbox").press("Escape");
			await page
				.getByRole("button", { name: fr ? "Abandonner le texte" : "Discard text", exact: true })
				.click();
			await expect(status).toHaveText(fr ? "Annulé" : "Cancelled");
			await page.evaluate(() => Reflect.get(window, "finishCopy")());
			await expect(status).toHaveText(fr ? "Texte copié" : "Text copied");
			release();
			await expect(page).not.toHaveURL(url);
			await expect(status).toHaveText(fr ? "Texte copié" : "Text copied");
		} finally {
			release();
		}
	});

	test(`C09 review open field respects author band at 320 by 240, ${lang}`, async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 240 });
		await open(page, lang, "# Practice\n\nOriginal paragraph.\n");
		// A compact course can place its first run beside the still-visible author band.
		await page.addStyleTag({
			content:
				".praxity-native-outline{display:none}.praxity-page-content{padding-top:0!important}",
		});
		const toggle = page.getByRole("button", { name: toggleName, exact: true });
		const heading = page.getByRole("button", { name: headingName, exact: true });
		await heading.focus();
		await heading.press("Enter");
		await expect(page.getByRole("textbox")).toBeFocused();
		const panel = page.getByRole("navigation", {
			name: fr ? "Mode édition" : "Edit mode",
			exact: true,
		});
		const bounds = await panel.boundingBox();
		const field = await page.getByRole("textbox").evaluate((element) => {
			const root = element.getRootNode();
			if (!(root instanceof ShadowRoot)) throw new Error("Missing field host");
			const box = root.host.getBoundingClientRect();
			return { y: box.y, height: box.height };
		});
		if (!bounds || !field) throw new Error("Missing author geometry");
		expect(field.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
		await toggle.click();
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
	});

	for (const width of [1280, 390, 320]) {
		test(`C09 review panel reserves space and stable pointer targets, ${lang}, ${width}`, async ({
			page,
		}, info) => {
			await page.setViewportSize({ width, height: 900 });
			await open(page, lang, `# Practice\n\n${"A long paragraph. ".repeat(90)}\n`);
			const toggle = page.getByRole("button", { name: toggleName, exact: true });
			const initial = await toggle.boundingBox();
			const panel = page.getByRole("navigation", {
				name: fr ? "Mode édition" : "Edit mode",
				exact: true,
			});
			const initialPanel = await panel.boundingBox();
			await panel.evaluate((nav) => {
				const overlaps: string[] = [];
				Reflect.set(window, "panelOverlaps", overlaps);
				new MutationObserver(() => {
					const bounds = nav.getBoundingClientRect();
					for (const el of document.querySelectorAll("h1,.praxity-native-sidebar-header")) {
						const r = el.getBoundingClientRect();
						if (
							r.width &&
							r.height &&
							r.left < bounds.right &&
							r.right > bounds.left &&
							r.top < bounds.bottom &&
							r.bottom > Math.max(0, bounds.top)
						)
							overlaps.push(el.textContent ?? "");
					}
				}).observe(nav, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["class"],
				});
			});
			async function geometry() {
				// One browser task measures both boxes; a save reply cannot split the observation.
				const covered = await panel.evaluate((nav) => {
					const bounds = nav.getBoundingClientRect();
					return [...document.querySelectorAll("h1,.praxity-native-sidebar-header")]
						.filter((el) => {
							const r = el.getBoundingClientRect();
							return (
								r.width &&
								r.height &&
								r.left < bounds.right &&
								r.right > bounds.left &&
								r.top < bounds.bottom &&
								r.bottom > Math.max(0, bounds.top)
							);
						})
						.map((el) => el.textContent);
				});
				expect(covered).toEqual([]);
			}
			await geometry();
			let heldBuilds = 0;
			let release = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			await page.route("**/api/rpc", async (route) => {
				if (route.request().postDataJSON().method === "canvasPreviewBuild") {
					expect(route.request().postDataJSON().method).toBe("canvasPreviewBuild");
					heldBuilds++;
					await held;
				}
				await route.continue();
			});
			try {
				await page.getByRole("button", { name: headingName, exact: true }).click();
				// Focus blur closes the field; keep Read Updating across the pointer gesture.
				// Author-panel pointer blur waits for activation so flow shrink cannot move its target.
				await toggle.focus();
				if (!initial) throw new Error("Missing toggle");
				await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
				await page.mouse.down();
				await expect(page.getByRole("status")).toHaveText(fr ? "Annulé" : "Cancelled");
				await expect
					.poll(() => heldBuilds, { message: "The preview refresh hold must engage" })
					.toBeGreaterThan(0);
				expect(await toggle.boundingBox()).toEqual(initial);
				expect(await panel.boundingBox()).toEqual(initialPanel);
			} finally {
				release();
			}
			await page.mouse.up();
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			expect(await toggle.boundingBox()).toEqual(initial);
			await toggle.click();
			await geometry();
			await page.getByRole("button", { name: headingName, exact: true }).click();
			await page.getByRole("textbox").fill("");
			await page.getByRole("textbox").press("Enter");
			await expect(page.locator("#error:visible")).toHaveText(
				fr ? "Saisissez du texte." : "Enter some text.",
			);
			await geometry();
			expect(await toggle.boundingBox()).toEqual(initial);
			expect(await panel.boundingBox()).toEqual(initialPanel);
			let finishRefresh = () => {};
			const refreshHold = new Promise<void>((resolve) => {
				finishRefresh = resolve;
			});
			let refreshStarted = false;
			await page.route("**/api/rpc", async (route) => {
				if (route.request().postDataJSON().method === "canvasPreviewBuild") {
					refreshStarted = true;
					await refreshHold;
				}
				await route.continue();
			});
			try {
				await page.getByRole("textbox").fill("Practice");
				await page.getByRole("textbox").press("Enter");
				await expect(page.getByRole("textbox")).toHaveCount(0);
				await expect
					.poll(() => refreshStarted, { message: "The final preview refresh hold must engage" })
					.toBe(true);
				await page.evaluate(() => {
					(document.activeElement as HTMLElement)?.blur();
					scrollTo(0, 500);
				});
				finishRefresh();
				await expect(
					page.getByRole("link", { name: /^(Read mode|Mode lecture)$/, exact: true }),
				).toBeEnabled();
				await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
			} finally {
				finishRefresh();
			}
			await geometry();
			const edits = page.getByRole("button", {
				name: /^(Edit heading|Edit paragraph|Modifier le titre|Modifier le paragraphe)/,
			});
			const panelBox = await panel.boundingBox();
			if (!panelBox) throw new Error("Missing scrolled panel");
			expect(
				await edits.evaluateAll(
					(els, p) =>
						els.some((el) => {
							const r = el.getBoundingClientRect();
							return (
								r.top < p.y + p.height && r.bottom > p.y && r.left < p.x + p.width && r.right > p.x
							);
						}),
					panelBox,
				),
			).toBe(false);
			if (
				process.env.PRAXITY_CANVAS_C09_SHOTS &&
				info.project.name === "chromium" &&
				width === 320
			) {
				await mkdir(process.env.PRAXITY_CANVAS_C09_SHOTS, { recursive: true });
				await page.screenshot({
					path: join(process.env.PRAXITY_CANVAS_C09_SHOTS, `${lang}-light-320-scrolled.png`),
				});
			}
			await toggle.click();
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			expect(await page.evaluate(() => Reflect.get(window, "panelOverlaps"))).toEqual([]);
		});
	}
}
