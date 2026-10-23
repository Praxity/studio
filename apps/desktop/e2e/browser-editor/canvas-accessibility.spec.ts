import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startJourney } from "./global-setup";

const source =
	"# Practice\n\nRepeated paragraph.\n\nRepeated paragraph.\n\n- First leaf\n- Second leaf\n\n::: choice Pick\n(x) Same label\n( ) Same label\n:::\n";
let stop: (() => Promise<void>) | undefined;
test.afterEach(async ({ page }) => {
	page.on("dialog", (dialog) => dialog.accept());
	await page.goto("about:blank");
	await stop?.();
});
async function open(page: Page, lang: string, theme = "light", body = source) {
	stop = await startJourney(page.context(), {
		standaloneSource: `---\nlang: ${lang}\ndesign:\n  colorMode: ${theme}\n---\n\n${body}`,
	});
	await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
	await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
	await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
}
async function observe(page: Page) {
	await page.getByRole("status").evaluate((el) => {
		const changes: string[] = [];
		Object.assign(window, { announcements: changes });
		new MutationObserver((records) => {
			for (const record of records)
				if (record.type === "childList") changes.push(el.textContent ?? "");
		}).observe(el, { childList: true });
	});
}
async function announcements(page: Page) {
	return page.evaluate(() => Reflect.get(window, "announcements") as string[]);
}

for (const lang of ["en", "fr"]) {
	const fr = lang === "fr";
	const heading = fr ? "Modifier le titre" : "Edit heading";
	const paragraph = fr ? "Modifier le paragraphe" : "Edit paragraph";
	const list = fr ? "Modifier l'élément de liste" : "Edit list item";
	const choice = fr ? "Modifier le libellé du choix" : "Edit choice label";
	const caption = fr ? "Modifier la légende" : "Edit caption";
	const separator = fr ? " : " : ": ";
	const editButtons = (page: Page) =>
		page.getByRole("button", {
			name: fr
				? /^Modifier (le titre|le paragraphe|l'élément de liste|le libellé du choix|la légende) \d+/
				: /^Edit (heading|paragraph|list item|choice label|caption) \d+/,
		});
	const names = (page: Page) =>
		editButtons(page).evaluateAll((buttons) =>
			buttons.map((button) => button.getAttribute("aria-label")),
		);

	test(`C09 names omit unsupported binding kinds, ${lang}`, async ({ page }) => {
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextSnapshot") return route.continue();
			const response = await route.fetch();
			const reply = await response.json();
			for (const field of reply.result.fields)
				if (field.field === "subject") field.kind = "future-kind";
			await route.fulfill({ response, json: reply });
		});
		await open(page, lang, "light", "# Practice\n\nParagraph.\n");
		await expect.poll(() => names(page)).toEqual([`${paragraph} 1${separator}Paragraph.`]);
	});

	test(`C09 names number every kind across hundreds of adversarial runs, ${lang}`, async ({
		page,
	}) => {
		const texts = [
			"Repeated paragraph.",
			"Repeated paragraph.",
			"Repeated paragraph.",
			"Repeated paragraph., position 2",
			"Use {position} here.",
			"{n} {text} $& $1 $$",
			"123",
			"Edit paragraph 1: Repeated paragraph.",
			"a".repeat(500),
			...Array.from({ length: 111 }, () => "Repeated paragraph."),
		];
		const question = "::: choice Pick\n(x) Same label\n( ) Same label\n:::\n";
		await open(
			page,
			lang,
			"light",
			`# Practice\n\n${texts.join("\n\n")}\n\n- Alpha\n- Beta\n\n${question}\n${question}\n::: figure\n![Alt](https://example.com/image.png)\nCaption.\n:::\n`,
		);
		const expected = [
			`${heading} 1${separator}Practice`,
			...texts.map(
				(text, index) =>
					`${paragraph} ${index + 1}${separator}${index === 8 ? `${"a".repeat(40)}…` : text}`,
			),
			`${list} 1${separator}Alpha`,
			`${list} 2${separator}Beta`,
			...Array.from({ length: 4 }, (_, index) => `${choice} ${index + 1}${separator}Same label`),
			`${caption} 1${separator}Caption.`,
		];
		await expect.poll(() => names(page)).toEqual(expected);
		expect(new Set(await names(page)).size).toBe(expected.length);
		for (const n of [1, 12, 120]) {
			const name = `${paragraph} ${n}${separator}Repeated paragraph.`;
			await expect(page.getByRole("button", { name, exact: true })).toHaveCount(1);
			await expect(page.getByRole("button", { name, exact: true })).toHaveAccessibleName(name);
		}
	});

	test(`C09 names follow inserted and reordered runs on refresh and save, ${lang}`, async ({
		page,
	}) => {
		await open(
			page,
			lang,
			"light",
			"# Practice\n\nRepeated paragraph.\n\nRepeated paragraph., position 2\n\n- Alpha\n- Beta\n",
		);
		const expected = [
			`${heading} 1${separator}Practice`,
			`${paragraph} 1${separator}Repeated paragraph.`,
			`${paragraph} 2${separator}Repeated paragraph., position 2`,
			`${list} 1${separator}Alpha`,
			`${list} 2${separator}Beta`,
		];
		await expect.poll(() => names(page)).toEqual(expected);
		const refresh = async (body: string) => {
			const revision = page.url();
			await writeFile(
				join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
				`---\nlang: ${lang}\n---\n\n${body}`,
			);
			await expect(page).not.toHaveURL(revision);
		};
		await refresh(
			"# Practice\n\nInserted paragraph.\n\n- Beta\n- Alpha\n\nRepeated paragraph., position 2\n\nRepeated paragraph.\n",
		);
		const refreshed = [
			`${heading} 1${separator}Practice`,
			`${paragraph} 1${separator}Inserted paragraph.`,
			`${list} 1${separator}Beta`,
			`${list} 2${separator}Alpha`,
			`${paragraph} 2${separator}Repeated paragraph., position 2`,
			`${paragraph} 3${separator}Repeated paragraph.`,
		];
		await expect.poll(() => names(page)).toEqual(refreshed);
		expect(new Set(await names(page)).size).toBe(refreshed.length);
		const acknowledge = async (labels: string[], editing: boolean) => {
			const gateFrench = (await page.locator("html").getAttribute("lang")) === "fr";
			// Only the list entry reflects the resolver's containing-block re-ID limit.
			await expect(page.locator("main > ul > li")).toHaveText(
				labels.map(
					(label) =>
						`second.prax: Practice; ${label}; ${gateFrench ? "Ligne inconnue" : "Line unknown"}`,
				),
			);
			await page
				.getByRole("button", {
					name: gateFrench
						? "Je n'ai pas publié ce cours : continuer."
						: "I haven't published this course: continue.",
					exact: true,
				})
				.click();
			const toggle = page.getByRole("button", {
				name: fr ? "Modifier le texte" : "Edit text",
				exact: true,
			});
			await expect(toggle).toBeEnabled();
			if ((await toggle.getAttribute("aria-pressed")) !== String(editing)) await toggle.click();
		};
		await page.getByRole("button", { name: refreshed[1], exact: true }).click();
		await page.getByRole("textbox").fill("Saved {position} $&");
		await page.getByRole("textbox").press("Enter");
		await page
			.getByRole("button", {
				name: fr ? "Examiner les modifications" : "Review changes",
				exact: true,
			})
			.click();
		await page
			.getByRole("button", {
				name: fr ? "Abandonner le texte et recharger" : "Discard text and reload",
				exact: true,
			})
			.click();
		await acknowledge(["list"], true);
		// Hold the background render so this also asserts the immediate save path.
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
			const button = page.getByRole("button", { name: refreshed[1], exact: true });
			await button.focus();
			await button.press("Enter");
			await page.getByRole("textbox").fill("Saved {position} $&");
			await page.getByRole("textbox").press("Enter");
			refreshed[1] = `${paragraph} 1${separator}Saved {position} $&`;
			await expect.poll(() => names(page)).toEqual(refreshed);
			await expect
				.poll(() => heldBuilds, { message: "The preview refresh hold must engage" })
				.toBeGreaterThan(0);
		} finally {
			release();
		}
		await page.unrouteAll({ behavior: "wait" });
		await expect(
			page.getByRole("link", { name: fr ? "Mode lecture" : "Read mode", exact: true }),
		).not.toHaveAttribute("aria-busy", "true");
		const toggle = page.getByRole("button", {
			name: fr ? "Modifier le texte" : "Edit text",
			exact: true,
		});
		await toggle.click();
		await refresh("# Practice\n\nNew first.\n\n- Alpha\n- Beta\n\nRepeated paragraph.\n");
		await expect(editButtons(page)).toHaveCount(0);
		await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
		await acknowledge(["Saved {position} $&", "list", "Repeated paragraph., position 2"], false);
		await toggle.click();
		await expect
			.poll(() => names(page))
			.toEqual([
				`${heading} 1${separator}Practice`,
				`${paragraph} 1${separator}New first.`,
				`${list} 1${separator}Alpha`,
				`${list} 2${separator}Beta`,
				`${paragraph} 2${separator}Repeated paragraph.`,
			]);
		expect(new Set(await names(page)).size).toBe(5);
	});
}

test("C09 checking an unknown save after Copy does not repeat its outcome", async ({ page }) => {
	await open(page, "en");
	await observe(page);
	await page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }).click();
	let unreadable = true;
	await page.route("**/api/rpc", async (route) => {
		const method = route.request().postDataJSON().method;
		if (method === "canvasTextApply" || (method === "canvasTextSnapshot" && unreadable))
			return route.abort();
		await route.continue();
	});
	await page.getByRole("textbox").fill("Keep this input");
	await page.getByRole("textbox").press("Enter");
	const status = page.getByRole("status");
	const unknown = "The save could not be confirmed. Your text is kept.";
	await expect(status).toHaveText(unknown);
	await page.getByRole("button", { name: "Copy text", exact: true }).click();
	await expect(status).toHaveText(/^(Text copied|Copy was unavailable\.)/);
	const copied = await status.innerText();
	expect([
		"Text copied",
		"Copy was unavailable. The text is selected; use your copy command.",
	]).toContain(copied);
	unreadable = false;
	await page.getByRole("button", { name: "Check saved bytes", exact: true }).click();
	await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
	await expect(status).toHaveText(copied);
	expect((await announcements(page)).filter((text) => text === unknown)).toHaveLength(1);
	await expect(page.getByRole("textbox")).toHaveValue("Keep this input");
});

for (const lang of ["en", "fr"]) {
	const fr = lang === "fr";
	const toggleName = fr ? "Modifier le texte" : "Edit text";
	const editPrefix = fr
		? /^Modifier (le titre|le paragraphe|l'élément|le libellé)/
		: /^Edit (heading|paragraph|list item|choice label)/;
	test(`C09 toggle waits for save and retains refused text, ${lang}`, async ({ page }) => {
		await open(page, lang);
		const toggle = page.getByRole("button", { name: toggleName, exact: true });
		const heading = page.getByRole("button", {
			name: fr ? "Modifier le titre 1 : Practice" : "Edit heading 1: Practice",
			exact: true,
		});
		await heading.click();
		const field = page.getByRole("textbox");
		await field.fill("Kept input");
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
			await pending;
			await route.fulfill({ json: { ok: true, result: { ok: false, code: "stale" } } });
		});
		try {
			await toggle.click();
			await expect(field).toHaveAttribute("readonly", "");
			await expect(toggle).toHaveAttribute("aria-pressed", "true");
			await expect(field).toHaveValue("Kept input");
			release();
			await expect(
				page.getByRole("button", {
					name: fr ? "Continuer la modification" : "Keep editing",
					exact: true,
				}),
			).toBeFocused();
			await page
				.getByRole("button", {
					name: fr ? "Continuer la modification" : "Keep editing",
					exact: true,
				})
				.press("Enter");
			await expect(field).toBeFocused();
			await expect(field).toHaveValue("Kept input");
			await expect(toggle).toHaveAttribute("aria-pressed", "true");
			await toggle.click();
			await page
				.getByRole("button", { name: fr ? "Abandonner le texte" : "Discard text", exact: true })
				.press("Enter");
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			await expect(field).toHaveCount(0);
			await expect(toggle).toBeFocused();
			await expect(page.getByRole("button", { name: editPrefix })).toHaveCount(0);
		} finally {
			release();
		}
	});

	test(`C09 hostile CSS and forced colours retain toggle, errors and focus, ${lang}`, async ({
		page,
	}) => {
		await open(page, lang);
		await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
		expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
		await page.addStyleTag({
			content:
				"button,textarea,[popover]{color:transparent!important;opacity:0!important;transform:scale(0)!important;pointer-events:none!important}*:focus{outline:none!important}body:after{content:'';position:fixed;inset:0;background:magenta;z-index:2147483647;pointer-events:none}",
		});
		const toggle = page.getByRole("button", { name: toggleName, exact: true });
		await toggle.focus();
		await expect(toggle).toHaveCSS("outline-style", "solid");
		await toggle.press("Enter");
		await expect(page.getByRole("button", { name: editPrefix })).toHaveCount(0);
		await toggle.press("Space");
		await page.getByRole("button", { name: editPrefix }).first().click();
		const field = page.getByRole("textbox");
		await field.fill("");
		await field.press("Enter");
		await expect(field).toHaveCSS("outline-style", "solid");
		await expect(page.locator("#error:visible")).toHaveText(
			fr ? "Saisissez du texte." : "Enter some text.",
		);
		expect(
			await field.evaluate((el) => {
				const box = el.getBoundingClientRect();
				const root = el.getRootNode();
				return (
					root instanceof ShadowRoot &&
					root.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el
				);
			}),
		).toBe(true);
	});
	test(`C09 keyboard toggle and every field in reading order, ${lang}`, async ({ page }) => {
		await open(page, lang);
		const origin = new URL(page.url()).origin;
		const toggle = page.getByRole("button", { name: toggleName, exact: true });
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		expect(await toggle.evaluate((el) => el.parentElement?.firstElementChild === el)).toBe(true);
		await toggle.dispatchEvent("click");
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		await observe(page);
		await toggle.focus();
		await toggle.press("Enter");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await expect(page.getByRole("button", { name: editPrefix })).toHaveCount(0);
		expect(new URL(page.url()).origin).toBe(origin);
		await toggle.press("e");
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await toggle.press("Space");
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
		expect(await announcements(page)).toEqual(
			fr
				? ["Modification du texte désactivée", "Modification du texte activée"]
				: ["Text editing off", "Text editing on"],
		);
		const buttons = page.getByRole("button", { name: editPrefix });
		const names = await buttons.evaluateAll((els) =>
			els.map((el) => el.getAttribute("aria-label")),
		);
		expect(names).toEqual(
			fr
				? [
						"Modifier le titre 1 : Practice",
						"Modifier le paragraphe 1 : Repeated paragraph.",
						"Modifier le paragraphe 2 : Repeated paragraph.",
						"Modifier l'élément de liste 1 : First leaf",
						"Modifier l'élément de liste 2 : Second leaf",
						"Modifier le libellé du choix 1 : Same label",
						"Modifier le libellé du choix 2 : Same label",
					]
				: [
						"Edit heading 1: Practice",
						"Edit paragraph 1: Repeated paragraph.",
						"Edit paragraph 2: Repeated paragraph.",
						"Edit list item 1: First leaf",
						"Edit list item 2: Second leaf",
						"Edit choice label 1: Same label",
						"Edit choice label 2: Same label",
					],
		);
		const heading = page.getByRole("button", {
			name: fr ? "Modifier le titre 1 : Practice" : "Edit heading 1: Practice",
			exact: true,
		});
		await heading.focus();
		for (let index = 0; index < names.length; index++) {
			const button = page.getByRole("button", { name: names[index] ?? "", exact: true });
			await expect(button).toBeFocused();
			await button.press(index % 2 ? "Space" : "Enter");
			const field = page.getByRole("textbox");
			await expect(field).toBeFocused();
			await expect(field).toHaveAttribute("aria-describedby", "hint");
			await field.press("Escape");
			await expect(button).toBeFocused();
			await button.press("Tab");
		}
		for (let index = names.length - 1; index >= 0; index--) {
			await page.keyboard.press("Shift+Tab");
			await expect(
				page.getByRole("button", { name: names[index] ?? "", exact: true }),
			).toBeFocused();
		}
		await expect(page.locator("h1")).toHaveCount(1);
		await expect(page.locator(".praxity-text li")).toHaveCount(2);
		await expect(
			page.locator("button button,button a,button input,label button,label textarea"),
		).toHaveCount(0);
	});

	test(`C09 one polite announcement per outcome, persistent described refusal, ${lang}`, async ({
		page,
	}) => {
		await open(page, lang);
		let calls = 0;
		page.on("request", (request) => {
			if (request.url().endsWith("/api/rpc") && request.postDataJSON().method === "canvasTextApply")
				calls++;
		});
		const heading = () =>
			page.getByRole("button", {
				name: new RegExp(fr ? "^Modifier le titre 1 : Practice" : "^Edit heading 1: Practice"),
			});
		const field = page.getByRole("textbox");
		await observe(page);
		await heading().click();
		await field.fill("Practice saved");
		expect((await announcements(page)).filter(Boolean)).toEqual([]);
		await field.press("Enter");
		await expect(page.getByRole("status")).toHaveText(fr ? "Enregistré" : "Saved");
		await expect(heading()).toBeFocused();
		await heading().press("Enter");
		await field.fill("Discard this");
		await field.press("Escape");
		await expect(heading()).toBeFocused();
		await heading().press("Enter");
		await field.fill("");
		await field.press("Enter");
		await expect(field).toHaveAttribute("aria-invalid", "true");
		await expect(field).toHaveAttribute("aria-describedby", "hint error");
		const error = page.locator("#error:visible");
		await expect(error).toHaveText(fr ? "Saisissez du texte." : "Enter some text.");
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(page.getByRole("status")).toHaveCount(1);
		await expect(field).toBeFocused();
		await field.fill("Practice blur saved");
		await field.press("Tab");
		await expect(page.getByRole("status")).toHaveText(fr ? "Enregistré" : "Saved");
		await expect(
			page
				.getByRole("button", {
					name: new RegExp(fr ? "^Modifier le paragraphe" : "^Edit paragraph"),
				})
				.first(),
		).toBeFocused();
		expect(calls).toBe(3);
		expect((await announcements(page)).filter(Boolean)).toEqual(
			fr
				? ["Enregistré", "Annulé", "Saisissez du texte.", "Enregistré"]
				: ["Saved", "Cancelled", "Enter some text.", "Saved"],
		);
		const disk = await readFile(
			join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
			"utf8",
		);
		expect(disk).toContain("# Practice blur saved\n");
	});
	for (const theme of ["light", "dark"])
		for (const width of [1280, 390, 320]) {
			test(`C09 course theme, choice row, reflow and focus, ${lang}, ${theme}, ${width}`, async ({
				page,
			}, info) => {
				await page.setViewportSize({ width, height: width === 320 ? 225 : 900 });
				await page.emulateMedia({
					colorScheme: theme === "dark" ? "light" : "dark",
					reducedMotion: "reduce",
				});
				await open(page, lang, theme);
				const toggle = page.getByRole("button", { name: toggleName, exact: true });
				async function shot(state: string) {
					if (
						!process.env.PRAXITY_CANVAS_C09_SHOTS ||
						info.project.name !== "chromium" ||
						width === 320
					)
						return;
					await mkdir(process.env.PRAXITY_CANVAS_C09_SHOTS, { recursive: true });
					await page.screenshot({
						path: join(
							process.env.PRAXITY_CANVAS_C09_SHOTS,
							`${lang}-${theme}-${width}-${state}.png`,
						),
					});
				}
				await toggle.click();
				await shot("off");
				await toggle.click();
				await shot("on");
				const choice = page.getByRole("button", {
					name: new RegExp(fr ? "^Modifier le libellé du choix 1" : "^Edit choice label 1"),
				});
				await choice.focus();
				await expect(choice).toHaveCSS("color-scheme", theme);
				await choice.press("Enter");
				const field = page.getByRole("textbox");
				await expect(field).toBeFocused();
				const row = page.locator("label.praxity-assessment-choice-option").first();
				const rowBox = await row.boundingBox();
				const fieldBox = await field.boundingBox();
				if (!rowBox || !fieldBox) throw new Error("Missing choice geometry");
				expect(fieldBox.x).toBeGreaterThan(rowBox.x + 26);
				expect(fieldBox.y).toBeGreaterThanOrEqual(rowBox.y);
				expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
				expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(width);
				await expect(row.locator("input")).toBeDisabled();
				await expect(row.locator("input")).not.toBeChecked();
				await expect(row.locator(".praxity-choice-key")).toBeVisible();
				await expect(field).toHaveCSS("outline-style", "solid");
				await shot("open");
				await field.fill("");
				await field.press("Enter");
				await expect(page.locator("#error:visible")).toBeVisible();
				await shot("refused");
				await expect(row.locator("input")).not.toBeChecked();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
			});
		}
}
