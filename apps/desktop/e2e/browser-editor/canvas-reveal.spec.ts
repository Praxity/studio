import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import { startJourney } from "./global-setup";

// The approach probe's 16 controls, traversed in both directions through the real adapter.
const source = `# Practice\n\n${Array.from({ length: 15 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n")}\n`;
let stop: (() => Promise<void>) | undefined;
test.afterEach(async ({ page }) => {
	await page.goto("about:blank");
	await stop?.();
});

async function open(page: Page, css: string, lang = "en", mode = "light", text = source) {
	stop = await startJourney(page.context(), {
		standaloneSource: `---\nlang: ${lang}\ndesign:\n  colorMode: ${mode}\n---\n\n${text}`,
	});
	const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
	if (page.context().browser()?.browserType().name() === "chromium")
		await page.context().grantPermissions(["local-network-access"], { origin });
	await page.route(`${origin}/canvas/preview/**`, async (route) => {
		if (!["document", "fetch"].includes(route.request().resourceType())) return route.continue();
		const response = await route.fetch();
		const html = await response.text();
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			html
				.replace("</head>", `<style>${css}</style></head>`)
				.replace(
					/(<main\b[^>]*>)/u,
					'$1<div class="cover top"></div><div class="cover stacked"></div>',
				)
				.replace("</main>", '<div class="tail"></div><div class="cover bottom"></div></main>'),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
	await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
	await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
	await page.reload();
	await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
	expect(await page.locator("head style").textContent()).toContain(css);
	await expect(page.locator(".cover.top")).toHaveCount(1);
	await page.evaluate(() => document.fonts.ready);
}

const layout = `
main{padding-top:0!important;padding-bottom:0!important}
.praxity-top-bar-fallback,.praxity-top-bar,#praxity-page-nav{display:none!important}
.praxity-block{min-height:110px!important}
.tail{height:400px}
.cover{background:#234;color:white;z-index:10;pointer-events:auto}
.top,.stacked{position:sticky;top:0;height:64px}
.stacked{display:none;top:64px;height:32px}
.bottom{position:fixed;bottom:0;left:0;width:100%;height:48px}
`;

async function hits(control: Locator) {
	return control.evaluate((element) => {
		const root = element.getRootNode();
		if (!(root instanceof ShadowRoot)) throw new Error("Missing author host");
		const box = element.getBoundingClientRect();
		return [
			[box.left + 4, box.top + 4],
			[(box.left + box.right) / 2, (box.top + box.bottom) / 2],
			[box.right - 4, box.bottom - 4],
		].map(([x, y]) => document.elementFromPoint(x, y) === root.host);
	});
}

async function frame(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
}

async function recordScrolls(page: Page) {
	await page.evaluate(() => {
		const scroll = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
			const root = this.getRootNode();
			const host = root instanceof ShadowRoot ? root.host : this;
			if (host.shadowRoot?.querySelector("button.edit")) {
				const calls = JSON.parse(host.getAttribute("data-test-scrolls") ?? "[]");
				calls.push(options);
				host.setAttribute("data-test-scrolls", JSON.stringify(calls));
			}
			scroll.call(this, options);
		};
	});
}

async function scrolls(control: Locator) {
	return control.evaluate((el) => {
		const root = el.getRootNode();
		if (!(root instanceof ShadowRoot)) throw new Error("Missing author host");
		return JSON.parse(root.host.getAttribute("data-test-scrolls") ?? "[]");
	});
}

async function traverse(page: Page) {
	const buttons = page.locator("button.edit");
	await expect(buttons).toHaveCount(16);
	await page.getByRole("button", { name: /^(Edit text|Modifier le texte)$/u }).focus();
	// Course skip links and the main scrollport can precede the first Edit control.
	for (let i = 0; i < 10; i++) {
		await page.keyboard.press("Tab");
		if (await buttons.first().evaluate((el) => el.matches(":focus"))) break;
	}
	for (let i = 0; i < 16; i++) {
		await expect(buttons.nth(i)).toBeFocused();
		expect(await hits(buttons.nth(i)), `forward ${i}`).toEqual([true, true, true]);
		if (i < 15) await page.keyboard.press("Tab");
	}
	for (let i = 15; i >= 0; i--) {
		await expect(buttons.nth(i)).toBeFocused();
		expect(await hits(buttons.nth(i)), `reverse ${i}`).toEqual([true, true, true]);
		if (i > 0) await page.keyboard.press("Shift+Tab");
	}
}

for (const lang of ["en", "fr"])
	for (const mode of ["light", "dark"])
		for (const [width, height] of [
			[1280, 900],
			[390, 844],
			[320, 256],
		])
			test(`native reveal chrome ${lang} ${mode} ${width}x${height}`, async ({ page }) => {
				await page.setViewportSize({ width, height });
				await open(page, layout, lang, mode);
				for (const chrome of ["top", "bottom", "both", "stacked"]) {
					await test.step(chrome, async () => {
						await page.locator(".top").evaluate((el, visible) => {
							(el as HTMLElement).style.display = visible ? "block" : "none";
						}, chrome !== "bottom");
						await page.locator(".bottom").evaluate((el, visible) => {
							(el as HTMLElement).style.display = visible ? "block" : "none";
						}, chrome !== "top");
						await page.locator(".stacked").evaluate((el, visible) => {
							(el as HTMLElement).style.display = visible ? "block" : "none";
						}, chrome === "stacked");
						await expect(page.locator(".top")).toBeVisible({ visible: chrome !== "bottom" });
						await expect(page.locator(".bottom")).toBeVisible({ visible: chrome !== "top" });
						await expect(page.locator(".stacked")).toBeVisible({ visible: chrome === "stacked" });
						await traverse(page);
					});
				}
			});

for (const zoom of [0.75, 1, 1.5, 2])
	test(`native reveal nested 350px scroller zoom ${zoom}`, async ({ page }) => {
		await open(
			page,
			`${layout}
main{zoom:${zoom};height:350px!important;min-height:0!important;overflow:auto!important;position:relative}
.top{height:230px}.bottom{display:none}
`,
		);
		await traverse(page);
		// 230 course pixels of chrome plus the specified 8px host margin at every zoom.
		expect(
			await page
				.locator("button.edit")
				.first()
				.evaluate((el) => {
					const root = el.getRootNode();
					return root instanceof ShadowRoot
						? (root.host as HTMLElement).style.scrollMarginTop
						: null;
				}),
		).toBe("238px");
	});

test("native reveal nested asymmetric chrome and unlayered sticky header", async ({ page }) => {
	await open(
		page,
		`${layout}
main{height:350px!important;min-height:0!important;overflow:auto!important;position:relative}
.top{height:110px;z-index:auto}.bottom{position:sticky;height:70px}
`,
	);
	await traverse(page);
	await page.locator("button.edit").last().focus();
	await page.keyboard.press("Shift+Tab");
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	expect(await hits(page.locator("button.edit").nth(14))).toEqual([true, true, true]);
});

for (const reducedMotion of ["reduce", "no-preference"] as const)
	test(`native reveal overrides smooth scrolling in the focus frame ${reducedMotion}`, async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion });
		await open(
			page,
			`${layout}
html,main{scroll-behavior:smooth!important}
main{height:350px!important;min-height:0!important;overflow:auto!important;position:relative}
.top{height:230px}.bottom{display:none}
`,
		);
		await page
			.locator("main")
			.evaluate((el) =>
				(el as HTMLElement).style.setProperty("scroll-behavior", "smooth", "important"),
			);
		await expect(page.locator("main")).toHaveCSS("scroll-behavior", "smooth");
		// Record the platform contract while retaining the real engine's scrolling.
		await page.evaluate(() => {
			const scroll = Element.prototype.scrollIntoView;
			Element.prototype.scrollIntoView = function (
				this: Element,
				options?: boolean | ScrollIntoViewOptions,
			) {
				if (this.shadowRoot?.querySelector("button.edit")) {
					const behavior = typeof options === "object" ? options.behavior : "auto";
					this.setAttribute(
						"data-test-scroll",
						`${this.getAttribute("data-test-scroll") ?? ""} ${behavior}`,
					);
				}
				scroll.call(this, options);
			};
		});
		// Capture visibility in the focus event, before any animation frame can settle scrolling.
		await page.locator("button.edit").evaluateAll((buttons) => {
			for (const button of buttons)
				button.addEventListener("focus", () => {
					const root = button.getRootNode();
					const box = button.getBoundingClientRect();
					button.setAttribute(
						"data-focus-hit",
						String(
							root instanceof ShadowRoot &&
								document.elementFromPoint(box.left + 4, box.top + 4) === root.host &&
								document.elementFromPoint(box.right - 4, box.bottom - 4) === root.host,
						),
					);
				});
		});
		await traverse(page);
		await expect(page.locator('button.edit[data-focus-hit="false"]')).toHaveCount(0);
		await page.keyboard.press("Enter");
		const scrolled = page.locator("[data-test-scroll]");
		await expect(scrolled).not.toHaveCount(0);
		for (const host of await scrolled.all())
			await expect(host).toHaveAttribute("data-test-scroll", /^( instant)+$/u);
	});

test("native reveal ignores sticky chrome behind the course", async ({ page }) => {
	await open(page, `${layout}.top{height:230px;z-index:-1}.bottom{display:none}`);
	const button = page.locator("button.edit").nth(8);
	await button.focus();
	expect(await hits(button)).toEqual([true, true, true]);
	expect(
		await button.evaluate((el) => {
			const root = el.getRootNode();
			return root instanceof ShadowRoot ? (root.host as HTMLElement).style.scrollMarginTop : null;
		}),
	).toBe("8px");
});

for (const height of [900, 256])
	test(`native reveal tall field label and caret under a bottom bar ${height}`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height });
		await open(
			page,
			`${layout}.top{display:none}`,
			"en",
			"light",
			`# Practice\n\n${"Long text wraps onto another line. ".repeat(30)}\n`,
		);
		const button = page.getByRole("button", { name: /^Edit paragraph 1:/u });
		await button.focus();
		await page.keyboard.press("Enter");
		const field = page.getByRole("textbox");
		await expect(field).toBeFocused();
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
		const label = page.locator('.field:not([hidden]) label[for="heading"]');
		expect(await hits(label)).toEqual([true, true, true]);
		expect(await hits(field)).toEqual([true, true, true]);
		expect(
			await field.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
		).toBeLessThan(3);
		await field.press("Control+End");
		expect(
			await field.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
		).toBeLessThan(3);
		expect(await hits(label)).toEqual([true, true, true]);
		expect(await hits(field)).toEqual([true, true, true]);
		if (height === 900) await expect(page.locator("[popover]:popover-open")).toHaveCount(1);
	});

test("native reveal keeps a fitting field in flow at 320 by 256", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 256 });
	await open(
		page,
		`${layout}.top{display:none}.bottom{height:32px}`,
		"en",
		"light",
		"# Practice\n\nShort.\n",
	);
	await page.getByRole("button", { name: "Edit paragraph 1: Short.", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("textbox")).toBeFocused();
	await expect(page.locator("[popover]:popover-open")).toHaveCount(1);
	expect(await hits(page.locator('.field:not([hidden]) label[for="heading"]'))).toEqual([
		true,
		true,
		true,
	]);
	expect(await hits(page.getByRole("textbox"))).toEqual([true, true, true]);
	expect(
		await page.getByRole("textbox").evaluate((el) => (el as HTMLTextAreaElement).selectionStart),
	).toBe(6);
});

test("native reveal falls back when chrome leaves no room for a field", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 256 });
	await open(
		page,
		`${layout}.top{display:none}.bottom{height:220px}`,
		"en",
		"light",
		"# Practice\n\nShort.\n",
	);
	await page.getByRole("button", { name: "Edit paragraph 1: Short.", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("textbox")).toBeFocused();
	await expect(page.locator("[popover]:popover-open")).toHaveCount(2);
	expect(await page.locator("body").evaluate((el) => el instanceof HTMLElement && el.inert)).toBe(
		true,
	);
});

test("native reveal overlaid-midpoint-nested headers in both Tab directions", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await open(
		page,
		`${layout}
main{height:350px!important;min-height:0!important;overflow:auto!important;position:relative}
.top{height:230px;width:calc(100% + 16px);margin-left:-8px}
.stacked{display:block;top:0;height:120px;z-index:20}
.bottom{position:sticky;height:60px}`,
	);
	await traverse(page);
});

test("native reveal recovery controls clear the bottom bar after an unknown save", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await open(page, `${layout}.top{display:none}html{scroll-behavior:smooth!important}`);
	const button = page.locator("button.edit").nth(8);
	await button.evaluate((el) =>
		window.scrollBy({ top: el.getBoundingClientRect().bottom - 842, behavior: "instant" }),
	);
	await button.focus();
	await page.keyboard.press("Enter");
	const field = page.getByRole("textbox");
	await expect(field).toBeFocused();
	await frame(page);
	await page.route("**/api/rpc", async (route) => {
		// Keep the outcome unknown so Check saved bytes stays available after the automatic check.
		if (["canvasTextApply", "canvasTextSnapshot"].includes(route.request().postDataJSON().method))
			return route.abort();
		await route.continue();
	});
	await field.fill("Keep this input");
	await field.press("Enter");
	await expect(page.getByRole("status")).toHaveText(
		"The save could not be confirmed. Your text is kept.",
	);
	await frame(page);
	await recordScrolls(page);
	for (const name of ["Copy text", "Reload", "Check saved bytes"]) {
		await page.keyboard.press("Tab");
		const control = page.getByRole("button", { name, exact: true });
		await expect(control).toBeFocused();
		await frame(page);
		expect(await hits(control), name).toEqual([true, true, true]);
	}
	const calls = await scrolls(field);
	expect(calls.length).toBeGreaterThan(0);
	for (const call of calls) expect(call.behavior).toBe("instant");
	await expect(field).toHaveValue("Keep this input");
});

test("native reveal preserves the first pointer click on a partly covered Edit button", async ({
	page,
}) => {
	await open(page, `${layout}.bottom{display:none}`);
	const button = page.locator("button.edit").nth(6);
	await button.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 44));
	const box = await button.boundingBox();
	if (!box) throw new Error("Missing Edit button");
	expect(await hits(button)).toEqual([false, false, true]);
	await recordScrolls(page);
	// Observe mousedown separately: focus must leave the pointer's click target in place.
	await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
	await page.mouse.down();
	expect(await scrolls(button)).toEqual([]);
	await page.mouse.up();
	await expect(page.getByRole("textbox")).toBeFocused();
});

test("native reveal leaves a fully visible target in place before pointer activation", async ({
	page,
}) => {
	await open(page, `${layout}.bottom{display:none}`);
	const button = page.locator("button.edit").nth(6);
	await button.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 84));
	expect(await hits(button)).toEqual([true, true, true]);
	await recordScrolls(page);
	const before = await page.evaluate(() => scrollY);
	await button.focus();
	expect(await scrolls(button)).toEqual([]);
	expect(await page.evaluate(() => scrollY)).toBe(before);
	await button.click();
	await expect(page.getByRole("textbox")).toBeFocused();
});

test("native reveal caps a tall field to its 600px scrollport", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await open(
		page,
		`${layout}
main{height:600px!important;min-height:0!important;overflow:auto!important;position:relative}
.bottom{display:none}`,
		"en",
		"light",
		`# Practice\n\n${"Long text wraps onto another line. ".repeat(150)}\n\nAfter.\n`,
	);
	await page.getByRole("button", { name: /^Edit paragraph 1:/u }).focus();
	await page.keyboard.press("Enter");
	const field = page.getByRole("textbox");
	await expect(field).toBeFocused();
	await frame(page);
	await expect(page.locator("body")).not.toHaveAttribute("inert");
	await expect(page.locator("[popover]:popover-open")).toHaveCount(1);
	expect(await hits(page.locator('.field:not([hidden]) label[for="heading"]'))).toEqual([
		true,
		true,
		true,
	]);
	expect(await hits(field)).toEqual([true, true, true]);
	expect(await field.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(536);
	expect(
		await field.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
	).toBeLessThan(3);
});

for (const [name, css, sentences, minimumHeight, maximumHeight] of [
	["hidden block tall", ".praxity-block{overflow:hidden}", 150, 700, 900],
	["hidden block fitting", ".praxity-block{overflow:hidden}", 12, 72, 900],
	["horizontal clipping tall", ".praxity-block{overflow-x:hidden}", 150, 700, 900],
	["horizontal clipping fitting", ".praxity-block{overflow-x:hidden}", 12, 72, 900],
	[
		"hidden block in main scrollport",
		"main{height:600px!important;min-height:0!important;overflow:auto!important;position:relative}.praxity-block{overflow:hidden}",
		150,
		400,
		600,
	],
	[
		"body scrollport",
		"html{overflow:hidden!important}body{height:600px!important;min-height:0!important;overflow:auto!important;position:relative}main{overflow:visible!important}",
		150,
		400,
		600,
	],
] as const)
	test(`native reveal uses the scrolling ancestor for ${name}`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await open(
			page,
			`${layout}.bottom{display:none}${css}`,
			"en",
			"light",
			`# Practice\n\n${"Long text wraps onto another line. ".repeat(sentences)}\n\nAfter.\n`,
		);
		await page.getByRole("button", { name: /^Edit paragraph 1:/u }).focus();
		await page.keyboard.press("Enter");
		const field = page.getByRole("textbox");
		await expect(field).toBeFocused();
		// Include the focusin re-cap on the next frame before measuring the opening caret.
		await frame(page);
		await expect(page.locator("body")).not.toHaveAttribute("inert");
		await expect(page.locator("[popover]:popover-open")).toHaveCount(1);
		expect(await hits(page.locator('.field:not([hidden]) label[for="heading"]'))).toEqual([
			true,
			true,
			true,
		]);
		expect(await hits(field)).toEqual([true, true, true]);
		const height = await field.evaluate((el) => el.getBoundingClientRect().height);
		expect(height).toBeGreaterThan(minimumHeight);
		expect(height).toBeLessThan(maximumHeight);
		expect(
			await field.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
		).toBeLessThan(3);
		if (sentences === 12)
			expect(await field.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
	});

test("native reveal centers when chrome content overflows its measured box", async ({ page }) => {
	await open(
		page,
		`${layout}.top{overflow:visible}.bottom{display:none}
.top::after{content:"";display:block;width:100%;height:160px;background:#234}`,
	);
	const button = page.locator("button.edit").nth(6);
	await button.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 44));
	await recordScrolls(page);
	await button.focus();
	expect(await scrolls(button)).toEqual([
		{ block: "nearest", inline: "nearest", behavior: "instant" },
		{ block: "center", inline: "nearest", behavior: "instant" },
	]);
	expect(await hits(button)).toEqual([true, true, true]);
});

test("native reveal measures sticky chrome against an offset scrollport", async ({ page }) => {
	await open(
		page,
		`${layout}
main{height:350px!important;min-height:0!important;overflow:auto!important;position:relative;margin-top:400px!important}
.top{height:80px;bottom:0}.bottom{display:none}`,
	);
	const button = page.locator("button.edit").nth(6);
	await button.focus();
	expect(
		await button.evaluate((el) => (el.getRootNode() as ShadowRoot).host.getAttribute("style")),
	).toContain("scroll-margin-top: 88px");
	expect(await hits(button)).toEqual([true, true, true]);
});

test("native reveal ignores chrome outside the control column", async ({ page }) => {
	await open(
		page,
		`${layout}
.top{position:fixed;top:0;left:0;width:16px;height:700px;overflow:visible}
.top::after{content:"";position:absolute;top:340px;width:1280px;height:20px;background:#234}
.bottom{display:none}`,
	);
	const button = page.locator("button.edit").nth(6);
	await button.focus();
	expect(
		await button.evaluate((el) => (el.getRootNode() as ShadowRoot).host.getAttribute("style")),
	).toContain("scroll-margin-top: 8px");
	expect(await hits(button)).toEqual([true, true, true]);
});

test("native reveal clears bottom chrome with nearest alone", async ({ page }) => {
	await open(page, `${layout}.top{display:none}`);
	const button = page.locator("button.edit").nth(6);
	await button.evaluate((el) => {
		const main = document.querySelector("main");
		if (!main) throw new Error("Missing course scrollport");
		// Use whole pixels so native window-scroll rounding cannot consume the 8px gap.
		const bottom = el.getBoundingClientRect().bottom;
		main.style.setProperty("padding-top", `${Math.ceil(bottom) - bottom}px`, "important");
		window.scrollBy(0, el.getBoundingClientRect().bottom - 880);
	});
	await recordScrolls(page);
	await button.focus();
	expect(await scrolls(button)).toEqual([
		{ block: "nearest", inline: "nearest", behavior: "instant" },
	]);
	expect(
		await button.evaluate((el) => {
			const bar = document.querySelector(".bottom");
			if (!bar) throw new Error("Missing bottom bar");
			return bar.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
		}),
	).toBeGreaterThanOrEqual(8);
	expect(await hits(button)).toEqual([true, true, true]);
});
