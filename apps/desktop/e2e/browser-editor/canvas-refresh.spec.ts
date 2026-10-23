import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import { startJourney } from "./global-setup";

const source = "# Page\n\n## Before\n\nBody.\n\n## Second\n";
let stop: (() => Promise<void>) | undefined;
let file = "";
const field = (page: Page) => page.getByRole("textbox", { name: "Heading text" });
const edit = (page: Page) =>
	page.getByRole("button", { name: "Edit heading 2: Before", exact: true });
test.beforeEach(async ({ context, browserName }, info) => {
	// Course links are fixture content, present before the first identity admission.
	const initialSource =
		info.title.includes("preserves focus on a course link") || info.title.includes("content shifts")
			? "# Page\n\n## Before\n\n[Next](#note).\n\n## Second\n"
			: source;
	stop = await startJourney(context, { standaloneSource: initialSource });
	file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
	if (browserName === "chromium")
		await context.grantPermissions(["local-network-access"], {
			origin: new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin,
		});
});
test.afterEach(async ({ page }) => {
	page.on("dialog", (dialog) => dialog.accept());
	await page.goto("about:blank");
	await stop?.();
});
async function open(page: Page) {
	await page.goto(`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`);
	await expect(page.getByRole("status")).toHaveText("Connected");
}
function saves(page: Page) {
	const calls: unknown[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/api/rpc") && request.postDataJSON().method === "canvasTextApply")
			calls.push(request.postDataJSON());
	});
	return calls;
}
async function headingId(page: Page, name: string) {
	return page
		.getByRole("heading", { name, exact: true })
		.evaluate((element) => element.closest("[data-node-id]")?.getAttribute("data-node-id"));
}
async function refuse(page: Page, stale = false) {
	await edit(page).click();
	await field(page).fill(stale ? "Refused text" : " ");
	if (stale) await writeFile(file, source.replace("Body.", "Outside."));
	await page.keyboard.press("Enter");
	await expect(page.locator("#error:visible")).toBeVisible();
	await field(page).fill("Corrected but abandoned");
}

test("C05 committed text refreshes its inline presentation with one operation", async ({
	page,
}) => {
	const calls = saves(page);
	await open(page);
	await page.getByRole("status").evaluate((status) => {
		const observed = window as unknown as { savedAnnouncements: number };
		observed.savedAnnouncements = 0;
		new MutationObserver(() => {
			if (status.textContent === "Saved") observed.savedAnnouncements++;
		}).observe(status, { childList: true, subtree: true, characterData: true });
	});
	await edit(page).click();
	await field(page).fill("After **saving**");
	await page.keyboard.press("Enter");
	await expect(page.getByRole("heading", { name: "After saving", exact: true })).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "After saving", exact: true }).locator("strong"),
	).toHaveText("saving");
	await expect(
		page.getByRole("button", { name: "Edit heading 2: After saving", exact: true }),
	).toBeFocused();
	expect(calls).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(
		"# Page\n\n## After **saving**\n\nBody.\n\n## Second\n",
	);
	expect(
		await page.evaluate(
			() => (window as unknown as { savedAnnouncements: number }).savedAnnouncements,
		),
	).toBe(1);
});

test("C05 outside invalidation keeps the native field; Escape reads current disk", async ({
	page,
}) => {
	const calls = saves(page);
	await open(page);
	await edit(page).click();
	await field(page).fill("Exact unsaved *text*");
	await field(page).evaluate((element) => {
		(window as unknown as { heldField: Element }).heldField = element;
	});
	await writeFile(file, "# Page\n\n## Outside heading\n\nOutside body.\n\n## Second\n");
	await expect
		.poll(async () => page.getByRole("heading", { name: "Outside heading", exact: true }).count())
		.toBe(0);
	await expect(field(page)).toHaveValue("Exact unsaved *text*");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("heading", { name: "Outside heading", exact: true })).toBeVisible();
	await expect(page.getByText("Outside body.", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Edit heading 2: Outside heading", exact: true }),
	).toBeFocused();
	expect(calls).toHaveLength(0);
});

for (const departure of ["Tab", "Read mode"])
	test(`C05 Escape confirmation then ${departure} cannot save abandoned text`, async ({ page }) => {
		const calls = saves(page);
		await open(page);
		await refuse(page);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
		if (departure === "Tab") await page.keyboard.press("Tab");
		else await page.getByRole("link", { name: "Read mode", exact: true }).click();
		await expect(field(page)).toHaveValue("Corrected but abandoned");
		expect(calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe(source);
	});

for (const target of ["hint", "Reload", "Copy text"])
	test(`C05 pointer within ${target} is not a departure`, async ({ page }) => {
		const calls = saves(page);
		await open(page);
		await refuse(page, true);
		if (target === "hint")
			await page
				.getByText("Enter saves. Leaving the field saves. Esc cancels. Uses .prax inline syntax.", {
					exact: true,
				})
				.locator("visible=true")
				.click();
		else await page.getByRole("button", { name: target, exact: true }).click();
		if (target === "Reload")
			await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
		await expect(field(page)).toHaveValue("Corrected but abandoned");
		expect(calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe(source.replace("Body.", "Outside."));
	});

test("C05 Escape from recovery controls exposes the discard choice", async ({ page }) => {
	await open(page);
	await refuse(page, true);
	await page.keyboard.press("Tab");
	await expect(page.getByRole("button", { name: "Copy text", exact: true })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("group", { name: "Discard your kept text?", exact: true }),
	).toBeVisible();
});

test("C05 recovery fits a 320 by 240 viewport and focus reveals each action", async ({
	page,
	browserName,
}) => {
	await open(page);
	await refuse(page, true);
	await page.setViewportSize({ width: 320, height: 240 });
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	const reload = page.getByRole("button", { name: "Reload", exact: true });
	await expect(reload).toBeFocused();
	await expect(reload).toBeInViewport({ ratio: 1 });
	if (process.env.PRAXITY_CANVAS_SHOTS)
		await page.screenshot({
			path: join(process.env.PRAXITY_CANVAS_SHOTS, `zoom-${browserName}-320x240-refused.png`),
		});
	await page.keyboard.press("Enter");
	const keep = page.getByRole("button", { name: "Keep editing", exact: true });
	await expect(keep).toBeFocused();
	await expect(keep).toBeInViewport({ ratio: 1 });
	if (process.env.PRAXITY_CANVAS_SHOTS)
		await page.screenshot({
			path: join(process.env.PRAXITY_CANVAS_SHOTS, `zoom-${browserName}-320x240-confirm.png`),
		});
	await page.keyboard.press("Shift+Tab");
	await expect(
		page.getByRole("button", { name: "Discard text and reload", exact: true }),
	).toBeInViewport({ ratio: 1 });
});

test("C05 Tab reveals fixed Edit buttons below the fold", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 240 });
	await open(page);
	await page.getByRole("heading", { name: "Before", exact: true }).evaluate((heading) => {
		const intro = document.createElement("div");
		intro.style.height = "2400px";
		heading.before(intro);
	});
	await edit(page).focus();
	await expect(edit(page)).toBeInViewport({ ratio: 1 });
	await page.keyboard.press("Tab");
	const paragraph = page.getByRole("button", { name: "Edit paragraph 1: Body.", exact: true });
	await expect(paragraph).toBeFocused();
	await expect(paragraph).toBeInViewport({ ratio: 1 });
	await page.keyboard.press("Tab");
	const next = page.getByRole("button", { name: "Edit heading 3: Second", exact: true });
	await expect(next).toBeFocused();
	await expect(next).toBeInViewport({ ratio: 1 });
});

test("C05 open field follows page content in the accessibility reading order", async ({ page }) => {
	await open(page);
	await edit(page).click();
	const tree = await page.locator("html").ariaSnapshot();
	expect(tree.indexOf('heading "Page"')).toBeGreaterThanOrEqual(0);
	expect(tree.indexOf('heading "Page"')).toBeLessThan(tree.indexOf('textbox "Heading text"'));
	expect(tree.indexOf('textbox "Heading text"')).toBeLessThan(tree.indexOf('heading "Second"'));
});

test("C05 qualified duplicate markers explain refused mapping", async ({ page }) => {
	await open(page);
	const nodeId = await page
		.getByRole("heading", { name: "Before", exact: true })
		.evaluate((heading) => heading.closest("[data-node-id]")?.getAttribute("data-node-id"));
	if (!nodeId) throw new Error("Missing node ID");
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			route.request().resourceType() !== "document" ||
			new URL(route.request().url()).origin !== new URL(page.url()).origin
		)
			return route.continue();
		const response = await route.fetch();
		const html = await response.text();
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			html.replace(
				"</body>",
				`<div class="praxity-block" data-node-id="${nodeId}"><h2>Forged heading</h2></div></body>`,
			),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
	await page.reload();
	await expect(page.getByRole("status")).toHaveText(
		"Some text could not be matched to the saved page.",
	);
	await expect(
		page.getByRole("button", { name: "Edit heading 1: Forged heading", exact: true }),
	).toHaveCount(0);
	expect(await readFile(file, "utf8")).toBe(source);
});

test("C05 event before a delayed acknowledgement retains the field and moved focus", async ({
	page,
}) => {
	const calls = saves(page);
	await open(page);
	let release: (() => void) | undefined;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
		const response = await route.fetch();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.fulfill({ response });
	});
	await edit(page).click();
	await field(page).fill("Confirmed **later**");
	const held = await field(page).elementHandle();
	await page.keyboard.press("Enter");
	await expect.poll(() => Boolean(release)).toBe(true);
	await expect(field(page)).toHaveAttribute("readonly", "");
	await expect(field(page)).toHaveValue("Confirmed **later**");
	expect(await held?.evaluate((element) => element.isConnected)).toBe(true);
	const link = page.getByRole("link", { name: "Read mode", exact: true });
	await link.focus();
	release?.();
	await expect(page.getByRole("heading", { name: "Confirmed later", exact: true })).toBeVisible();
	await expect(link).toBeFocused();
	expect(calls).toHaveLength(1);
});

test("C05 a delayed refresh cannot replace a newly opened field", async ({ page }) => {
	await open(page);
	let release: (() => void) | undefined;
	let heldRefresh = false;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasPreviewBuild" || heldRefresh)
			return route.continue();
		heldRefresh = true;
		const response = await route.fetch();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.fulfill({ response });
	});
	await edit(page).click();
	await field(page).fill("First save");
	await page.keyboard.press("Enter");
	await expect.poll(() => Boolean(release)).toBe(true);
	await page.getByRole("button", { name: "Edit heading 3: Second", exact: true }).click();
	await field(page).fill("Native field survives");
	const held = await field(page).elementHandle();
	const replied = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			response.url().endsWith("/api/rpc") &&
			response.request().postDataJSON().method === "canvasPreviewBuild",
	);
	release?.();
	await (await replied).finished();
	await expect(field(page)).toHaveValue("Native field survives");
	await expect(field(page)).toBeFocused();
	expect(await held?.evaluate((element) => element.isConnected)).toBe(true);
	await writeFile(file, "# Page\n\n## Latest **disk**\n\nLatest body.\n\n## Second\n");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("heading", { name: "Latest disk", exact: true })).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Edit heading 3: Second", exact: true }),
	).toBeFocused();
});

test("C05 an outside edit during a pending save refuses and retains exact input", async ({
	page,
}) => {
	const calls = saves(page);
	await open(page);
	let release: (() => void) | undefined;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.continue();
	});
	await edit(page).click();
	await field(page).fill("Typed *é* <kept> & exact");
	await page.keyboard.press("Enter");
	await expect.poll(() => Boolean(release)).toBe(true);
	await writeFile(file, "# Page\n\n## Before\n\nOutside changed body.\n\n## Second\n");
	release?.();
	await expect(page.locator("#error:visible")).toHaveText(
		"The file changed. Your text is kept. Copy it, then reload.",
	);
	await expect(field(page)).toHaveValue("Typed *é* <kept> & exact");
	await expect(field(page)).toBeEditable();
	expect(calls).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(
		"# Page\n\n## Before\n\nOutside changed body.\n\n## Second\n",
	);
});

test("C05 composition Tab is input and never a departure", async ({
	page,
	browserName,
	context,
}) => {
	test.skip(browserName !== "chromium", "CDP supplies native composition input");
	const calls = saves(page);
	await open(page);
	await edit(page).click();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Input.imeSetComposition", { text: "かん", selectionStart: 2, selectionEnd: 2 });
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Tab",
		code: "Tab",
		windowsVirtualKeyCode: 9,
		nativeVirtualKeyCode: 9,
	});
	await expect(field(page)).toBeFocused();
	expect(calls).toHaveLength(0);
	await cdp.send("Input.insertText", { text: "かん" });
	await cdp.detach();
	await page.keyboard.press("Escape");
	await expect(field(page)).toHaveCount(0);
	expect(await readFile(file, "utf8")).toBe(source);
});

test("C05 blur refresh preserves focus on a course link", async ({ page }) => {
	const calls = saves(page);
	await open(page);
	const id = await headingId(page, "Before");
	expect(id).toBeTruthy();
	await edit(page).click();
	await field(page).fill("Blur **saved**");
	await page.getByRole("link", { name: "Next", exact: true }).focus();
	await expect(page.getByRole("heading", { name: "Blur saved", exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Next", exact: true })).toBeFocused();
	expect(await headingId(page, "Blur saved")).toBe(id);
	expect(calls).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(
		"# Page\n\n## Blur **saved**\n\n[Next](#note).\n\n## Second\n",
	);
});

test("C05 reconnect reads changes missed between event streams without a save", async ({
	page,
}) => {
	let connections = 0;
	await page.route("**/api/events", async (route) => {
		connections++;
		if (connections === 1)
			return route.fulfill({ contentType: "application/x-ndjson", body: '{"type":"ready"}\n' });
		await route.continue();
	});
	const calls = saves(page);
	await open(page);
	await writeFile(file, "# Page\n\n## After reconnect\n\nBody.\n\n## Second\n");
	await expect.poll(() => connections).toBe(2);
	await expect(page.getByRole("heading", { name: "After reconnect", exact: true })).toBeVisible();
	expect(calls).toHaveLength(0);
});

test("C05 a late outside change preserves moved course focus when content shifts", async ({
	page,
}) => {
	const calls = saves(page);
	await open(page);
	const id = await headingId(page, "Before");
	expect(id).toBeTruthy();
	let release: (() => void) | undefined;
	let held = false;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasPreviewBuild" || held)
			return route.continue();
		held = true;
		const response = await route.fetch();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.fulfill({ response });
	});
	await edit(page).click();
	await field(page).fill("Blur **saved**");
	await page.getByRole("link", { name: "Next", exact: true }).focus();
	await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
	await expect.poll(() => Boolean(release)).toBe(true);
	await writeFile(
		file,
		"# Page\n\n## Blur **saved**\n\nOutside insertion.\n\n[Next](#note).\n\n## Second\n",
	);
	release?.();
	await expect(page.getByText("Outside insertion.", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Next", exact: true })).toBeFocused();
	expect(await headingId(page, "Blur saved")).toBe(id);
	expect(calls).toHaveLength(1);
});

test("C05 refresh survives course elements named after document methods", async ({ page }) => {
	await open(page);
	const calls = saves(page);
	const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			!["document", "fetch"].includes(route.request().resourceType()) ||
			new URL(route.request().url()).origin !== origin
		)
			return route.continue();
		const response = await route.fetch();
		const html = await response.text();
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			html.replace(
				"</body>",
				'<form name="importNode"></form><form name="querySelectorAll"></form></body>',
			),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
	await page.goto(`${origin}/launch?canvas=1`);
	await page.reload();
	// WebKit's locator engine itself uses the clobbered method. Read through the native API.
	await expect
		.poll(() =>
			page.evaluate(() => {
				const buttons = [...Document.prototype.querySelectorAll.call(document, "div")].flatMap(
					(host) => (host.shadowRoot ? [...host.shadowRoot.querySelectorAll("button")] : []),
				);
				const edit = buttons.find(
					(button) => button.getAttribute("aria-label") === "Edit heading 2: Before",
				);
				if (!(edit instanceof HTMLElement)) return false;
				edit.focus();
				return true;
			}),
		)
		.toBe(true);
	await page.keyboard.press("Enter");
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.insertText("After **saved**");
	await page.keyboard.press("Enter");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					[...Document.prototype.querySelectorAll.call(document, "h2")]
						.find((heading) => heading.textContent === "After saved")
						?.querySelector("strong")?.textContent,
			),
		)
		.toBe("saved");
	expect(calls).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe("# Page\n\n## After **saved**\n\nBody.\n\n## Second\n");
});
