import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { loadIdentityStore } from "../../src/main/identity-store";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import { readIdentityFixture } from "../../src/test-utils/identity-fixture";
import { startJourney } from "./global-setup";

const source =
	"---\ntitle: Canvas text\n---\n\n# Practice\n\n## Keep *clear*\n\nA neighbouring paragraph stays here.\n\n## Next heading\n\nMore course content.\n";
let stop: (() => Promise<void>) | undefined;
let file = "";
test.beforeEach(async ({ context }) => {
	stop = await startJourney(context, { standaloneSource: source });
	file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
});
test.afterEach(async () => {
	await stop?.();
});

async function open(page: Page) {
	await page.goto(`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`);
	await expect(page.getByRole("status")).toHaveText("Connected");
}
function headingEdit(page: Page) {
	return page.getByRole("button", { name: "Edit heading 2: Keep clear", exact: true });
}
function hitTarget(element: Element) {
	const box = element.getBoundingClientRect();
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	let hit = Document.prototype.elementFromPoint.call(document, x, y);
	while (hit?.shadowRoot) {
		const next = hit.shadowRoot.elementFromPoint(x, y);
		if (!next || next === hit) break;
		hit = next;
	}
	return hit === element;
}
function observe(page: Page) {
	const calls: { method: string; args: Record<string, unknown> }[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/api/rpc")) calls.push(request.postDataJSON());
	});
	return { calls, saves: () => calls.filter((call) => call.method === "canvasTextApply") };
}

test("C04 native editing changes literal bytes once on Enter then blur, and Escape sends nothing", async ({
	page,
}) => {
	const observed = observe(page);
	await open(page);
	await expect(page.locator("body")).toHaveCSS("font-family", '"Source Sans 3", sans-serif');
	expect(await page.evaluate(() => document.fonts.check('16px "Source Sans 3"'))).toBe(true);
	const heading = page.getByRole("heading", { name: "Keep clear", exact: true });
	const presentationStyle = await heading.getAttribute("style");
	const edit = headingEdit(page);
	await expect(edit).toHaveText("Edit");
	await edit.dispatchEvent("click");
	await expect(page.getByRole("textbox", { name: "Heading text" })).toHaveCount(0);
	expect(await heading.evaluate((el) => el.nextElementSibling?.tagName)).toBe("DIV");
	await edit.focus();
	await page.keyboard.press("Enter");
	const field = page.getByRole("textbox", { name: "Heading text", exact: true });
	await expect(field).toBeFocused();
	await expect(field).toHaveValue("Keep *clear*");
	expect(await field.evaluate((el) => (el as HTMLTextAreaElement).selectionStart)).toBe(12);
	await expect(page.getByRole("button", { name: "Edit heading 3: Next heading" })).toBeDisabled();
	await field.fill("Stay **safe**");
	await page.keyboard.press("Enter");
	await page.getByRole("link", { name: "Read mode", exact: true }).focus();
	await expect(field).toHaveCount(0);
	await expect(page.getByRole("status")).toHaveText("Saved");
	expect(observed.saves()).toHaveLength(1);
	expect(observed.saves()[0]?.args).toMatchObject({
		operation: "setText",
		expectedText: "Keep *clear*",
		text: "Stay **safe**",
	});
	expect(await readFile(file, "utf8")).toBe(source.replace("Keep *clear*", "Stay **safe**"));
	await expect(page.getByRole("heading", { name: "Stay safe", exact: true })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Stay safe", exact: true }).locator("strong"),
	).toHaveText("safe");
	const changedEdit = page.getByRole("button", {
		name: "Edit heading 2: Stay safe",
		exact: true,
	});
	await changedEdit.focus();
	await page.keyboard.press("Space");
	await field.fill("Discard this");
	await page.keyboard.press("Escape");
	await expect(field).toHaveCount(0);
	await expect(changedEdit).toBeFocused();
	expect(
		await page.getByRole("heading", { name: "Stay safe", exact: true }).getAttribute("style"),
	).toBe(presentationStyle);
	await expect(page.getByRole("status")).toHaveText("Cancelled");
	expect(observed.saves()).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(source.replace("Keep *clear*", "Stay **safe**"));
	expect(observed.calls.some((call) => /draft/i.test(call.method))).toBe(false);
	expect(await readdir(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", ".praxity"))).not.toContain(
		"local",
	);
});

test("C04 blur saves and leaves focus on its destination; Enter acknowledgement returns to Edit", async ({
	page,
}) => {
	await open(page);
	await headingEdit(page).click();
	const field = page.getByRole("textbox", { name: "Heading text" });
	await field.fill("Blur save");
	const link = page.getByRole("link", { name: "Read mode", exact: true });
	await link.focus();
	await expect(field).toHaveCount(0);
	await expect(link).toBeFocused();
	const edit = page.getByRole("button", { name: "Edit heading 2: Blur save", exact: true });
	await edit.click();
	await field.fill("Enter save");
	await page.keyboard.press("Enter");
	await expect(field).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Edit heading 2: Enter save", exact: true }),
	).toBeFocused();
	expect(await readFile(file, "utf8")).toBe(source.replace("Keep *clear*", "Enter save"));
});

test("C04 native Edit names keep the first 40 graphemes whole and marks a cut", async ({
	page,
	context,
}) => {
	await stop?.();
	stop = await startJourney(context, {
		standaloneSource: source.replace("Keep *clear*", "An emoji😀".repeat(7)),
	});
	file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
	const root = process.env.PRAXITY_BROWSER_PROJECT ?? "";
	const identity = await readIdentityFixture(root);
	const savedIds = (await loadIdentityStore(root)).snapshots.flatMap((snapshot) =>
		Object.keys(snapshot.nodes),
	);
	await open(page);
	await expect(
		page.getByRole("button", {
			name: "Edit heading 2: An emoji😀An emoji😀An emoji😀An emoji😀An e…",
			exact: true,
		}),
	).toBeVisible();
	const savedId = await page
		.getByRole("heading", { name: "An emoji😀".repeat(7), exact: true })
		.evaluate((element) => element.closest("[data-node-id]")?.getAttribute("data-node-id"));
	expect(savedIds).toContain(savedId);
	expect(await readIdentityFixture(root)).toEqual(identity);
});

test("C04 an outside edit retains exact input and the document; Reload requires inline confirmation", async ({
	page,
}) => {
	const observed = observe(page);
	await open(page);
	await headingEdit(page).click();
	const field = page.getByRole("textbox", { name: "Heading text" });
	const typed = "  My **typed** text  ";
	await field.fill(typed);
	await writeFile(file, source.replace("neighbouring", "outside"));
	await page.keyboard.press("Enter");
	await expect(field).toHaveValue(typed);
	await expect(field).toBeEditable();
	await expect(page.locator("#error:visible")).toHaveText(
		"The file changed. Your text is kept. Copy it, then reload.",
	);
	await expect(page.getByRole("button", { name: "Copy text", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Reload", exact: true }).click();
	await expect(
		page.getByText("Reload and discard your text?", { exact: true }).filter({ visible: true }),
	).toBeVisible();
	await expect(field).toHaveValue(typed);
	await page.getByRole("button", { name: "Keep editing", exact: true }).click();
	await expect(field).toHaveValue(typed);
	expect(observed.saves()).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(source.replace("neighbouring", "outside"));
});

for (const [text, message] of [
	[" ", "Enter some text."],
	["One\nTwo", "Keep the text on one line."],
	[
		"Title {hideTitle}",
		"Braces would become heading settings. Remove the braces to keep this as text.",
	],
]) {
	test(`C04 author input refusal: ${JSON.stringify(text)}`, async ({ page }) => {
		await open(page);
		await headingEdit(page).click();
		const field = page.getByRole("textbox", { name: "Heading text" });
		await field.fill(text);
		await page.keyboard.press("Enter");
		await expect(page.locator("#error:visible")).toHaveText(message);
		await expect(field).toHaveValue(text);
		await expect(field).toBeEditable();
		const described = await field.getAttribute("aria-describedby");
		expect(described).toContain("error");
		expect(await readFile(file, "utf8")).toBe(source);
	});
}

for (const committed of [false, true]) {
	test(`C04 lost reply reconciles saved bytes, committed=${committed}`, async ({ page }) => {
		const observed = observe(page);
		await open(page);
		let intercepted = false;
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextApply" || intercepted)
				return route.continue();
			intercepted = true;
			if (committed) await route.fetch();
			await route.abort("failed");
		});
		await headingEdit(page).click();
		const field = page.getByRole("textbox", { name: "Heading text" });
		await field.fill("Uncertain");
		await page.keyboard.press("Enter");
		if (committed) {
			await expect(field).toHaveCount(0);
			await expect(page.getByRole("status")).toHaveText("Saved");
		} else {
			await expect(field).toHaveValue("Uncertain");
			await expect(page.locator("#error:visible")).toHaveText(
				"The save could not be confirmed. Your text is kept.",
			);
			expect(observed.saves()).toHaveLength(1);
			expect(observed.calls.slice(-2).map((call) => call.method)).toEqual([
				"canvasTextApply",
				"canvasTextSnapshot",
			]);
			await page.getByRole("button", { name: "Retry save", exact: true }).click();
			await expect(field).toHaveCount(0);
			expect(observed.saves()).toHaveLength(2);
			expect(observed.saves()[1]?.args).toEqual(observed.saves()[0]?.args);
		}
		expect(await readFile(file, "utf8")).toBe(source.replace("Keep *clear*", "Uncertain"));
	});
}

test("C04 IME composition Enter is input, never save", async ({ page, browserName, context }) => {
	test.skip(browserName !== "chromium", "Chromium CDP supplies real composition events");
	const observed = observe(page);
	await open(page);
	await headingEdit(page).click();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Input.imeSetComposition", { text: "é", selectionStart: 1, selectionEnd: 1 });
	await page.getByRole("textbox", { name: "Heading text" }).dispatchEvent("compositionend");
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 229,
		nativeVirtualKeyCode: 229,
	});
	expect(observed.saves()).toHaveLength(0);
	await expect(page.getByRole("textbox", { name: "Heading text" })).toBeFocused();
	await cdp.send("Input.insertText", { text: "é" });
	await cdp.detach();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("textbox", { name: "Heading text" })).toHaveCount(0);
	expect(observed.saves()).toHaveLength(0);
	await headingEdit(page).click();
	const next = await context.newCDPSession(page);
	await next.send("Input.imeSetComposition", { text: "é", selectionStart: 1, selectionEnd: 1 });
	await next.send("Input.insertText", { text: "é" });
	await next.detach();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("textbox", { name: "Heading text" })).toHaveCount(0);
	expect(observed.saves()).toHaveLength(1);
});

test("C04 an absent reply keeps the field and checks bytes before offering retry", async ({
	page,
}) => {
	const observed = observe(page);
	await open(page);
	await page.clock.install();
	let release: (() => void) | undefined;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.abort();
	});
	await headingEdit(page).click();
	const field = page.getByRole("textbox", { name: "Heading text" });
	await field.fill("Keep without a reply");
	await page.keyboard.press("Enter");
	await expect(field).toHaveAttribute("readonly", "");
	await expect.poll(() => Boolean(release)).toBe(true);
	await page.clock.fastForward(10_001);
	await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
	await expect(field).toHaveValue("Keep without a reply");
	expect(observed.saves()).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(source);
	release?.();
});

test("C04 page-title binding and French keyboard names, hint and cancellation", async ({
	page,
	browserName,
	context,
}) => {
	// Fulfilled document fixtures lack an IP address for Chromium's loopback check.
	if (browserName === "chromium")
		await context.grantPermissions(["local-network-access"], {
			origin: new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin,
		});
	await page.setViewportSize({ width: 320, height: 900 });
	await open(page);
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			new URL(route.request().url()).origin !== new URL(page.url()).origin ||
			route.request().resourceType() !== "document"
		)
			return route.continue();
		const response = await route.fetch();
		const html = await response.text();
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner URL");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			html.replace(/lang="[^"]+"/u, 'lang="fr"'),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			status: 200,
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
	await page.reload();
	await expect(page.getByRole("status")).toHaveText("Connecté");
	const edit = page.getByRole("button", { name: "Modifier le titre 1 : Practice", exact: true });
	await edit.focus();
	await page.keyboard.press("Space");
	const field = page.getByRole("textbox", { name: "Texte du titre", exact: true });
	await expect(field).toBeFocused();
	await expect(field).toHaveValue("Practice");
	await expect(
		page
			.getByText(
				"Entrée enregistre. Quitter le champ enregistre. Échap annule. Syntaxe .prax en ligne.",
				{ exact: true },
			)
			.filter({ visible: true }),
	).toBeVisible();
	await field.fill("Titre {hideTitle}");
	await page.keyboard.press("Enter");
	await expect(page.locator("#error:visible")).toHaveText(
		"Les accolades deviendraient des paramètres du titre. Retirez les accolades pour garder ce contenu comme texte.",
	);
	await expect(field).toHaveValue("Titre {hideTitle}");
	await expect(field).toBeEditable();
	await expect(field).toHaveAttribute("aria-invalid", "true");
	expect(await field.getAttribute("aria-describedby")).toContain("error");
	expect(await readFile(file, "utf8")).toBe(source);
	await field.fill(" \tEn français 😀\t ");
	await page.keyboard.press("Enter");
	await expect(field).toHaveCount(0);
	await expect(page.getByRole("status")).toHaveText("Enregistré");
	expect(await readFile(file, "utf8")).toBe(source.replace("# Practice", "# En français 😀"));
	const renamed = page.getByRole("button", {
		name: "Modifier le titre 1 : En français 😀",
		exact: true,
	});
	await expect(renamed).toBeFocused();
	await page.keyboard.press("Enter");
	await field.fill("Annuler");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("status")).toHaveText("Annulé");
	await expect(renamed).toBeFocused();
});

for (const hostile of [false, true])
	for (const theme of ["light", "dark"] as const)
		for (const width of [1280, 390]) {
			test(`C04 visual ${hostile ? "hostile" : "course"} ${theme} ${width}`, async ({
				page,
				browserName,
				context,
			}) => {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ colorScheme: theme });
				const savedParagraph =
					"A neighbouring paragraph stays here to explain how to handle equipment safely throughout this practical training course.";
				const outsideParagraph =
					"A outside paragraph stays here to explain how to handle equipment safely throughout this practical training course.";
				const themedSource = source
					.replace("A neighbouring paragraph stays here.", savedParagraph)
					.replace("title: Canvas text", `title: Canvas text\ndesign:\n  colorMode: ${theme}`);
				await stop?.();
				stop = await startJourney(context, { standaloneSource: themedSource });
				file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
				// Fulfilled document fixtures lack an IP address for Chromium's loopback check.
				if (hostile && browserName === "chromium")
					await context.grantPermissions(["local-network-access"], {
						origin: new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin,
					});
				let projected = false;
				if (hostile)
					await page.route("**/canvas/preview/**", async (route) => {
						if (
							new URL(route.request().url()).origin !==
								new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin ||
							route.request().resourceType() !== "document"
						)
							return route.continue();
						projected = true;
						const response = await route.fetch();
						let html = await response.text();
						const base = html.match(/<base href="([^"]+)"/u)?.[1];
						if (!base) throw new Error("Missing captured learner URL");
						html = html.replace(
							"</head>",
							`<style>*{--text-primary:transparent!important;--bg-primary:transparent!important}button,textarea,label,[popover]{opacity:0!important;color:transparent!important;transform:scale(0)!important;pointer-events:none!important}body:after{content:'';position:fixed;inset:0;background:magenta;z-index:2147483647;pointer-events:none}*:focus{outline:none!important}</style></head>`,
						);
						html = html.replace(
							"</body>",
							'<form name="importNode"></form><button data-node-id="forged" data-praxity-author-control>Forged Edit</button></body>',
						);
						const projection = await serveStudioAuthorDocument(
							new Request(route.request().url()),
							html,
							base,
							await readFile(
								join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"),
								"utf8",
							),
						);
						await route.fulfill({
							status: 200,
							headers: Object.fromEntries(projection.headers),
							body: await projection.text(),
						});
					});
				await open(page);
				// Redirect-chain routing is engine-specific; navigate directly after admission for the fixture.
				await page.reload();
				await expect(page.getByRole("status")).toHaveText("Connected");
				const paragraphId = await page
					.getByText(savedParagraph, { exact: true })
					.evaluate((element) => element.closest("[data-node-id]")?.getAttribute("data-node-id"));
				expect(paragraphId).toBeTruthy();
				expect(projected).toBe(hostile);
				await expect(page.locator("body")).toHaveCSS("font-family", /sans-serif/u);
				expect(await page.evaluate(() => document.fonts.check('16px "Source Sans 3"'))).toBe(true);
				const background = await page.locator("body").evaluate((el) => {
					const canvas = document.createElement("canvas");
					const context = canvas.getContext("2d");
					if (!context) throw new Error("Missing colour measurement context");
					context.fillStyle = getComputedStyle(el).backgroundColor;
					context.fillRect(0, 0, 1, 1);
					return Array.from(context.getImageData(0, 0, 1, 1).data);
				});
				expect(background[3]).toBe(255);
				for (const channel of background.slice(0, 3)) {
					if (theme === "dark") expect(channel).toBeLessThan(100);
					else expect(channel).toBeGreaterThan(240);
				}
				const stem = `${hostile ? "hostile" : "course"}-${theme}-${width}`;
				async function shot(state: string) {
					if (process.env.PRAXITY_CANVAS_SHOTS && browserName === "chromium")
						await page.screenshot({
							path: join(process.env.PRAXITY_CANVAS_SHOTS, `${stem}-${state}.png`),
						});
				}
				await headingEdit(page).focus();
				await expect(headingEdit(page)).toBeVisible();
				expect(await headingEdit(page).evaluate(hitTarget)).toBe(true);
				await shot("idle");
				await page.keyboard.press("Enter");
				const field = page.getByRole("textbox", { name: "Heading text" });
				await expect(field).toBeFocused();
				await expect(field).toBeVisible();
				expect(await field.evaluate(hitTarget)).toBe(true);
				const box = await field.boundingBox();
				expect(box?.width).toBeGreaterThan(200);
				expect(await field.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
				await field.fill("A heading worth keeping");
				await shot("open");
				let release: (() => void) | undefined;
				await page.route("**/api/rpc", async (route) => {
					if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					await route.continue();
				});
				const outsideSource = themedSource.replace("neighbouring", "outside");
				expect(await readFile(file, "utf8")).toBe(themedSource);
				expect(outsideSource).not.toBe(themedSource);
				await writeFile(file, outsideSource);
				expect(await readFile(file, "utf8")).toBe(outsideSource);
				const stale = page.waitForResponse(
					(response) =>
						response.url().endsWith("/api/rpc") &&
						response.request().method() === "POST" &&
						response.request().postDataJSON().method === "canvasTextApply",
				);
				await page.keyboard.press("Enter");
				await expect(field).toHaveAttribute("readonly", "");
				await shot("saving");
				await page.keyboard.press("Escape");
				await expect(field).toHaveValue("A heading worth keeping");
				await expect.poll(() => Boolean(release)).toBe(true);
				release?.();
				expect((await (await stale).json()).result).toMatchObject({ ok: false, code: "stale" });
				await expect(page.locator("#error:visible")).toHaveText(
					"The file changed. Your text is kept. Copy it, then reload.",
				);
				await expect(field).toHaveValue("A heading worth keeping");
				const colours = await page.locator("#error:visible").evaluate((el) => {
					const context = document.createElement("canvas").getContext("2d");
					if (!context || !el.parentElement) throw new Error("Missing colour measurement context");
					return [
						getComputedStyle(el).color,
						getComputedStyle(el.parentElement).backgroundColor,
					].map((colour) => {
						context.fillStyle = colour;
						context.fillRect(0, 0, 1, 1);
						return `#${Array.from(context.getImageData(0, 0, 1, 1).data)
							.slice(0, 3)
							.map((channel) => channel.toString(16).padStart(2, "0"))
							.join("")}`;
					});
				});
				expect(contrastRatio(colours[0] ?? "", colours[1] ?? "")).toBeGreaterThanOrEqual(4.5);
				await expect
					.poll(async () => {
						const bottom = await field.evaluate(
							(el) => el.parentElement?.getBoundingClientRect().bottom ?? Infinity,
						);
						const next = await page.getByText(savedParagraph, { exact: true }).boundingBox();
						return next ? next.y >= bottom : false;
					})
					.toBe(true);
				await shot("refused");
				await field.fill("Corrected kept text");
				await page.keyboard.press("Escape");
				await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
				await expect(
					page.getByRole("group", { name: "Discard your kept text?", exact: true }),
				).toBeVisible();
				await expect(field).toHaveValue("Corrected kept text");
				await shot("confirm");
				await page.unroute("**/api/rpc");
				await page.getByRole("button", { name: "Discard text", exact: true }).click();
				await expect(page.getByText(outsideParagraph, { exact: true })).toBeVisible();
				expect(
					await page
						.getByText(outsideParagraph, { exact: true })
						.evaluate((element) => element.closest("[data-node-id]")?.getAttribute("data-node-id")),
				).toBe(paragraphId);
				await expect(page.getByRole("heading", { name: "Keep clear", exact: true })).toBeVisible();
				await headingEdit(page).focus();
				await page.keyboard.press("Enter");
				await field.fill("Saved **heading**");
				await page.keyboard.press("Enter");
				await expect(
					page.getByRole("heading", { name: "Saved heading", exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole("button", { name: "Edit heading 2: Saved heading", exact: true }),
				).toBeFocused();
				await expect(page.locator("body")).toHaveCSS("font-family", /sans-serif/u);
				await shot("refreshed");
			});
		}
