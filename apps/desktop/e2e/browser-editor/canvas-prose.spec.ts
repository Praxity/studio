import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { CanvasTextBinding } from "../../src/renderer/browser/canvas-text";
import { startJourney } from "./global-setup";

const source =
	"# Practice\n\nA [working link](#main-content)\nwrapped paragraph.\n\n- Parent\n  - Nested leaf\n- Other leaf\n\n::: choice Pick\ncorrect: Authored correct.\nincorrect: Authored incorrect.\n(x) Same label\n( ) Same label\n:::\n";
const kinds = [
	{
		kind: "body",
		name: "paragraph",
		label: "Paragraph text",
		old: "A [working link](#main-content)\nwrapped paragraph.",
		next: "A *saved* paragraph.\nStill wrapped.",
		visible: "A saved paragraph. Still wrapped.",
	},
	{
		kind: "list-entry",
		name: "list item",
		label: "List item text",
		old: "Nested leaf",
		next: "Saved *leaf*",
		visible: "Saved leaf",
	},
	{
		kind: "option",
		name: "choice label",
		label: "Choice label text",
		old: "Same label",
		next: "Saved *choice*",
		visible: "Saved choice",
	},
] as const;

let stop: (() => Promise<void>) | undefined;
let file: string;
test.afterEach(async () => {
	await stop?.();
});

async function open(page: Page, initial = source, lang = "en") {
	stop = await startJourney(page.context(), {
		standaloneSource: lang === "fr" ? `---\nlang: fr\n---\n\n${initial}` : initial,
	});
	file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
	const snapshot = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/rpc") &&
			response.request().postDataJSON().method === "canvasTextSnapshot",
	);
	await page.goto(`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`);
	const fields = ((await (await snapshot).json()) as { result: { fields: CanvasTextBinding[] } })
		.result.fields;
	await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
	return fields;
}
function saves(page: Page) {
	const calls: Record<string, unknown>[] = [];
	const replies: { ok: boolean; code?: string }[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/api/rpc") && request.postDataJSON().method === "canvasTextApply")
			calls.push(request.postDataJSON().args);
	});
	page.on("response", async (response) => {
		if (
			response.url().endsWith("/api/rpc") &&
			response.request().postDataJSON().method === "canvasTextApply"
		)
			replies.push((await response.json()).result);
	});
	return { calls, replies };
}
function edit(
	page: Page,
	name: string,
	text: string,
	position = name === "choice label" || name === "list item" ? 2 : 1,
) {
	return page.getByRole("button", {
		name: `Edit ${name} ${position}: ${text}`,
		exact: true,
	});
}

for (const lang of ["en", "fr"]) {
	test(`break-ui A all eight nested list items have distinct names and level three saves in ${lang}`, async ({
		page,
	}) => {
		const initial =
			"# Practice\n\n- Same item\n  - Same item\n    - Same item\n      - Same item\n        - Same item\n          - Same item\n            - Same item\n              - Same item\n";
		const observed = saves(page);
		const fields = await open(page, initial, lang);
		const listFields = fields.filter((field) => field.kind === "list-entry");
		expect(listFields.map((field) => field.text)).toEqual(Array(8).fill("Same item"));
		const prefix = lang === "fr" ? "Modifier l'élément de liste" : "Edit list item";
		const separator = lang === "fr" ? " : " : ": ";
		const buttons = page.getByRole("button", { name: new RegExp(`^${prefix} `) });
		const names = Array.from(
			{ length: 8 },
			(_, index) => `${prefix} ${index + 1}${separator}Same item`,
		);
		await expect(buttons).toHaveCount(8);
		expect(
			await buttons.evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))),
		).toEqual(names);
		const items = page.locator("li[data-node-id]");
		const ids = await items.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute("data-node-id")),
		);
		await page.getByRole("button", { name: names[2], exact: true }).press("Enter");
		const field = page.getByRole("textbox", {
			name: lang === "fr" ? "Texte de l'élément de liste" : "List item text",
			exact: true,
		});
		await expect(field).toBeFocused();
		await expect(field).toHaveValue("Same item");
		await expect(items.nth(3).locator(":scope > div[data-node-id]")).toBeVisible();
		const openingPath = new URL(page.url()).pathname;
		await field.fill("Saved *level three*");
		await field.press("Enter");
		await expect(field).toHaveCount(0);
		await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Enregistré" : "Saved");
		await expect.poll(() => new URL(page.url()).pathname).not.toBe(openingPath);
		await expect(
			page.getByRole("button", {
				name: `${prefix} 3${separator}Saved level three`,
				exact: true,
			}),
		).toBeVisible();
		expect(
			await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-node-id"))),
		).toEqual(ids);
		await expect(items.locator(":scope > div[data-node-id]")).toHaveText([
			"Same item",
			"Same item",
			"Saved level three",
			"Same item",
			"Same item",
			"Same item",
			"Same item",
			"Same item",
		]);
		expect(await readFile(file, "utf8")).toBe(
			(lang === "fr" ? "---\nlang: fr\n---\n\n" : "") +
				initial.replace("\n    - Same item\n", "\n    - Saved *level three*\n"),
		);
		expect(observed.calls).toHaveLength(1);
	});
}
async function copy(page: Page, text: string) {
	await page.evaluate(() => {
		const input = document.createElement("textarea");
		input.id = "clipboard-source";
		input.style.cssText = "position:fixed;top:0;left:0";
		document.body.append(input);
	});
	const input = page.locator("#clipboard-source");
	await input.fill(text);
	await input.selectText();
	await page.keyboard.press("ControlOrMeta+c");
	await input.evaluate((el) => el.remove());
}
async function paste(page: Page, field: Locator) {
	await field.press("ControlOrMeta+a");
	await field.press("ControlOrMeta+v");
}

for (const [ending, bom] of [
	["\n", ""],
	["\r\n", ""],
	["\r\n", "\uFEFF"],
]) {
	for (const item of kinds) {
		test(`C06b ${item.name} saves exact bytes and cancels, ending=${JSON.stringify(ending)}, BOM=${!!bom}`, async ({
			page,
		}) => {
			const initial = bom + source.replaceAll("\n", ending);
			const observed = saves(page);
			const fields = await open(page, initial);
			const targets = fields.filter((field) => field.kind === item.kind);
			const binding =
				item.kind === "option"
					? targets[1]
					: targets.find((field) => field.text.replaceAll("\r\n", "\n") === item.old);
			if (!binding) throw new Error("Missing admitted field");
			const buttons = page.getByRole("button", { name: new RegExp(`^Edit ${item.name}`) });
			await expect(buttons).toHaveCount(targets.length);
			const button =
				item.kind === "option"
					? edit(page, item.name, "Same label")
					: edit(
							page,
							item.name,
							item.old
								.replaceAll("[working link](#main-content)", "working link")
								.replaceAll("\n", " "),
						);
			await button.focus();
			await page.keyboard.press("Enter");
			const field = page.getByRole("textbox", { name: item.label, exact: true });
			await expect(field).toBeFocused();
			await expect(field).toHaveValue(item.old);
			await field.fill("Discarded text");
			await field.press("Escape");
			await expect(field).toHaveCount(0);
			await expect(button).toBeFocused();
			expect(observed.calls).toHaveLength(0);
			expect(await readFile(file)).toEqual(Buffer.from(initial));
			const radios = await page.getByRole("radio").elementHandles();
			const openingPath = new URL(page.url()).pathname;
			await button.click();
			await field.fill(item.next);
			await field.press("Enter");
			await expect(page.getByRole("status")).toHaveText("Saved");
			await expect(field).toHaveCount(0);
			expect(observed.calls).toHaveLength(1);
			expect(observed.calls[0]).toMatchObject({
				nodeId: binding.nodeId,
				expectedText: binding.text,
				text: item.next,
			});
			const offset =
				item.kind === "option"
					? initial.lastIndexOf("Same label")
					: initial.indexOf(item.old.replaceAll("\n", ending));
			const expected =
				initial.slice(0, offset) +
				item.next.replaceAll("\n", ending) +
				initial.slice(offset + item.old.replaceAll("\n", ending).length);
			expect(await readFile(file)).toEqual(Buffer.from(expected));
			await expect(edit(page, item.name, item.visible)).toBeVisible();
			await expect(page.getByRole("radio")).toHaveCount(3);
			for (const radio of radios) expect(await radio.evaluate((el) => el.isConnected)).toBe(true);
			if (item.kind === "option") {
				await expect(page.locator(".praxity-choice-label").nth(0)).toHaveText("Same label");
				await expect(page.locator(".praxity-choice-label").nth(1).locator("em")).toHaveText(
					"choice",
				);
			}
			// Captured artifact URLs are immutable. Wait for the saved-page revision before reload.
			await expect.poll(() => new URL(page.url()).pathname).not.toBe(openingPath);
			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(edit(page, item.name, item.visible)).toBeVisible();
			expect(observed.calls).toHaveLength(1);
		});
	}
}

for (const [kindIndex, text, code, message] of [
	[0, "# Heading", "unsupported-syntax", "Use inline text only."],
	[0, "::: note\nBody\n:::", "unsupported-syntax", "Use inline text only."],
	[0, "One\n\nTwo", "unsupported-syntax", "Use inline text only."],
	[
		0,
		"- New item",
		"list-marker",
		"This line would become a list item. Remove the list marker to keep it as text.",
	],
	[
		1,
		"Leaf\n  - Crossed child",
		"list-marker",
		"This line would become a list item. Remove the list marker to keep it as text.",
	],
	[2, "(x) New option", "unsupported-syntax", "Use inline text only."],
] as const) {
	const item = kinds[kindIndex];
	test(`C06b ${item.name} pasted structure refuses ${JSON.stringify(text)} and retains input`, async ({
		page,
	}) => {
		const observed = saves(page);
		await open(page);
		await copy(page, text);
		await page
			.getByRole("button", { name: new RegExp(`^Edit ${item.name}`) })
			.first()
			.focus();
		await page.keyboard.press("Enter");
		const field = page.getByRole("textbox", { name: item.label, exact: true });
		await paste(page, field);
		await expect(field).toHaveValue(text);
		await field.press("Enter");
		await expect(page.locator("#error:visible")).toHaveText(message);
		await expect(field).toHaveValue(text);
		await expect(field).toBeEditable();
		await expect
			.poll(() => observed.replies.map(({ ok, code }) => ({ ok, code })))
			.toEqual([{ ok: false, code }]);
		expect(await readFile(file, "utf8")).toBe(source);
	});
}

for (const item of kinds) {
	test(`C06b ${item.name} native undo and redo survive typing paste and refused save`, async ({
		page,
	}) => {
		await open(page);
		await copy(page, "# Pasted heading\n\nSplit");
		await page
			.getByRole("button", { name: new RegExp(`^Edit ${item.name}`) })
			.first()
			.focus();
		await page.keyboard.press("Enter");
		const field = page.getByRole("textbox", { name: item.label, exact: true });
		const baseline = await field.inputValue();
		await field.press("End");
		await page.keyboard.type(" typed");
		const typed = await field.inputValue();
		await field.press("ControlOrMeta+z");
		await expect(field).toHaveValue(baseline);
		await field.press("ControlOrMeta+Shift+z");
		await expect(field).toHaveValue(typed);
		await paste(page, field);
		await expect(field).toHaveValue("# Pasted heading\n\nSplit");
		await field.press("Enter");
		await expect(page.locator("#error:visible")).toBeVisible();
		await field.press("ControlOrMeta+z");
		await expect(field).toHaveValue(typed);
		await field.press("ControlOrMeta+Shift+z");
		await expect(field).toHaveValue("# Pasted heading\n\nSplit");
		expect(await readFile(file, "utf8")).toBe(source);
	});
}

test("C06b choice acknowledgement refreshes only the label text before saved-page refresh", async ({
	page,
}) => {
	const observed = saves(page);
	await open(page);
	const openingPath = new URL(page.url()).pathname;
	const radios = await page.getByRole("radio").elementHandles();
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
		await edit(page, "choice label", "Same label").click();
		const field = page.getByRole("textbox", { name: "Choice label text", exact: true });
		await field.fill("Compiler **label**");
		await field.press("Enter");
		await expect(field).toHaveCount(0);
		await expect(page.locator(".praxity-choice-label").nth(1).locator("strong")).toHaveText(
			"label",
		);
		await expect(page.locator(".praxity-choice-label").nth(0)).toHaveText("Same label");
		expect(new URL(page.url()).pathname).toBe(openingPath);
		for (const radio of radios) expect(await radio.evaluate((el) => el.isConnected)).toBe(true);
		await expect
			.poll(() => heldBuilds, { message: "The preview refresh hold must engage" })
			.toBeGreaterThan(0);
		release();
		await expect.poll(() => new URL(page.url()).pathname).not.toBe(openingPath);
		await expect(page.getByRole("radio")).toHaveCount(3);
		for (const radio of radios) expect(await radio.evaluate((el) => el.isConnected)).toBe(true);
		expect(observed.calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe(
			source.replace("( ) Same label", "( ) Compiler **label**"),
		);
	} finally {
		release();
	}
});

test("C06b paragraph newline gesture preserves the native edit history and Enter only saves", async ({
	page,
}) => {
	const observed = saves(page);
	await open(page);
	await page.getByRole("button", { name: /^Edit paragraph \d+:/ }).click();
	const field = page.getByRole("textbox", { name: "Paragraph text", exact: true });
	await expect(field).toHaveAccessibleDescription(/Shift\+Enter/);
	await field.press("ControlOrMeta+a");
	await page.keyboard.type("First line");
	await field.press("Shift+Enter");
	await page.keyboard.type("Second line");
	await expect(field).toHaveValue("First line\nSecond line");
	await field.press("Enter");
	await expect(page.getByRole("status")).toHaveText("Saved");
	expect(observed.calls).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(
		source.replace(kinds[0].old, "First line\nSecond line"),
	);
});

for (const direction of ["Tab", "Shift+Tab"]) {
	test(`C06b changed list field ${direction} reaches the adjacent Edit button during save`, async ({
		page,
	}) => {
		const observed = saves(page);
		await open(
			page,
			"# Practice\n\nIntro.\n\n- Leaf one\n- Leaf two\n- Leaf three\n\nAfter list.\n",
		);
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method === "canvasTextApply") await held;
			await route.continue();
		});
		try {
			await edit(page, "list item", "Leaf two", 2).click();
			const field = page.getByRole("textbox", { name: "List item text", exact: true });
			await field.press("End");
			await page.keyboard.type("!");
			await field.press(direction);
			const next = edit(
				page,
				"list item",
				direction === "Tab" ? "Leaf three" : "Leaf one",
				direction === "Tab" ? 3 : 1,
			);
			await expect(next).toBeFocused();
			await expect.poll(() => observed.calls.length).toBe(1);
			// Pending controls stay in reading order but cannot open a second field.
			await page.keyboard.press("Enter");
			await expect(field).toHaveValue("Leaf two!");
			release();
			await expect(field).toHaveCount(0);
			await expect(next).toBeFocused();
			expect(observed.calls).toHaveLength(1);
		} finally {
			release();
		}
	});
}

test("C06b lost acknowledgement on a CRLF paragraph resolves saved bytes and permits another edit", async ({
	page,
}) => {
	const initial = source.replaceAll("\n", "\r\n");
	const calls: unknown[] = [];
	await open(page, initial);
	let heldBuilds = 0;
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/rpc", async (route) => {
		const request = route.request().postDataJSON();
		if (request.method === "canvasPreviewBuild") {
			expect(request.method).toBe("canvasPreviewBuild");
			heldBuilds++;
			await held;
		}
		if (request.method !== "canvasTextApply") return route.continue();
		calls.push(request.args);
		if (calls.length > 1) return route.continue();
		const response = await route.fetch();
		expect((await response.json()).result.ok).toBe(true);
		await route.abort("failed");
	});
	try {
		await page.getByRole("button", { name: /^Edit paragraph \d+:/ }).click();
		const field = page.getByRole("textbox", { name: "Paragraph text", exact: true });
		await field.fill("Saved first\nsecond.");
		await field.press("Enter");
		const saved = initial.replace(
			"A [working link](#main-content)\r\nwrapped paragraph.",
			"Saved first\r\nsecond.",
		);
		await expect(field).toHaveCount(0);
		await expect(page.getByRole("status")).toHaveText("Saved");
		// Outside readers can see T1's capture gap until settlement, see "Durable file journal (T1)" in docs/context/architecture.md.
		expect(await readFile(file, "utf8")).toBe(saved);
		expect(calls).toHaveLength(1);
		// Keep the old document until the second save proves the recovered raw baseline.
		await expect
			.poll(() => heldBuilds, { message: "The preview refresh hold must engage" })
			.toBeGreaterThan(0);
		await page.getByRole("button", { name: /^Edit paragraph \d+:/ }).click();
		await expect(field).toHaveValue("Saved first\nsecond.");
		await field.fill("Saved again\nsecond.");
		await field.press("Enter");
		await expect(field).toHaveCount(0);
		expect(await readFile(file, "utf8")).toBe(saved.replace("Saved first", "Saved again"));
		expect(calls).toHaveLength(2);
	} finally {
		release();
	}
});

test("C06b a touched and restored CRLF paragraph closes without an operation", async ({ page }) => {
	const initial = source.replaceAll("\n", "\r\n");
	const observed = saves(page);
	await open(page, initial);
	await page.getByRole("button", { name: /^Edit paragraph \d+:/ }).click();
	const field = page.getByRole("textbox", { name: "Paragraph text", exact: true });
	await page.keyboard.type("x");
	await field.press("Backspace");
	await field.press("Enter");
	await expect(field).toHaveCount(0);
	await expect(page.getByRole("status")).toHaveText("Cancelled");
	expect(observed.calls).toHaveLength(0);
	expect(await readFile(file, "utf8")).toBe(initial);
});

test("C06b the open list field stays inside its visible list item", async ({ page }) => {
	await open(page);
	await edit(page, "list item", "Nested leaf").click();
	const field = page.getByRole("textbox", { name: "List item text", exact: true });
	await expect(field).toBeFocused();
	const placement = await field.evaluate((textarea) => {
		const host = (textarea.getRootNode() as ShadowRoot).host;
		return {
			parent: host.parentElement?.tagName,
			itemVisible: host.closest("li")?.checkVisibility({ checkVisibilityCSS: true }),
			invalidChildren: document.querySelectorAll("ul > div,ol > div").length,
		};
	});
	expect(placement).toEqual({ parent: "LI", itemVisible: true, invalidChildren: 0 });
});

for (const item of kinds.slice(1)) {
	test(`C06b ${item.name} blocks the undocumented Shift+Enter gesture`, async ({ page }) => {
		const observed = saves(page);
		await open(page);
		await edit(page, item.name, item.old).click();
		const field = page.getByRole("textbox", { name: item.label, exact: true });
		await field.press("Shift+Enter");
		await expect(field).toHaveValue(item.old);
		expect(observed.calls).toHaveLength(0);
		await page.keyboard.type("!");
		await field.press("Enter");
		await expect(field).toHaveCount(0);
		await expect(page.getByRole("status")).toHaveText("Saved");
		expect(observed.calls).toHaveLength(1);
	});
}

test("C06b authored choice prompt paragraphs have a mapped Edit button", async ({ page }) => {
	const initial = "# Practice\n\n::: choice Which?\nChoose one.\n(x) One\n( ) Two\n:::\n";
	const observed = saves(page);
	const fields = await open(page, initial);
	expect(fields.some((field) => field.kind === "body" && field.text === "Choose one.")).toBe(true);
	await edit(page, "paragraph", "Choose one.").click();
	const field = page.getByRole("textbox", { name: "Paragraph text", exact: true });
	await field.fill("Choose **carefully**.");
	await field.press("Enter");
	await expect(field).toHaveCount(0);
	await expect(edit(page, "paragraph", "Choose carefully.")).toBeVisible();
	await expect(page.getByRole("radio")).toHaveCount(3);
	expect(observed.calls).toHaveLength(1);
	expect(await readFile(file, "utf8")).toBe(
		initial.replace("Choose one.", "Choose **carefully**."),
	);
});

for (const lang of ["en", "fr"]) {
	test(`C06b adjacent controls keep semantic reading order and Read links, ${lang}`, async ({
		page,
	}) => {
		await open(page, source, lang);
		const names =
			lang === "fr"
				? ["Modifier le paragraphe", "Modifier l'élément de liste", "Modifier le libellé du choix"]
				: ["Edit paragraph", "Edit list item", "Edit choice label"];
		for (const name of names)
			await expect(
				page.getByRole("button", { name: new RegExp(`^${name}`) }).first(),
			).toBeVisible();
		const choiceNames = await page
			.getByRole("button", { name: new RegExp(`^${names[2]}`) })
			.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
		expect(choiceNames).toEqual(
			lang === "fr"
				? [
						"Modifier le libellé du choix 1 : Same label",
						"Modifier le libellé du choix 2 : Same label",
					]
				: ["Edit choice label 1: Same label", "Edit choice label 2: Same label"],
		);
		const listButtons = page.getByRole("button", { name: new RegExp(`^${names[1]} `) });
		await expect(listButtons.first()).toBeVisible();
		expect(
			await listButtons.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute("aria-label")),
			),
		).toEqual(
			lang === "fr"
				? [
						"Modifier l'élément de liste 1 : Parent",
						"Modifier l'élément de liste 2 : Nested leaf",
						"Modifier l'élément de liste 3 : Other leaf",
					]
				: [
						"Edit list item 1: Parent",
						"Edit list item 2: Nested leaf",
						"Edit list item 3: Other leaf",
					],
		);
		await expect(page.locator("button a, button input, label button, p button")).toHaveCount(0);
		await expect(page.locator(".praxity-text li")).toHaveCount(3);
		const link = page.getByRole("link", { name: "working link", exact: true });
		expect(await link.evaluate((el) => el.closest("p")?.nextElementSibling?.tagName)).toBe("DIV");
		await page
			.getByRole("link", { name: lang === "fr" ? "Mode lecture" : "Read mode", exact: true })
			.click();
		const readLink = page.getByRole("link", { name: "working link", exact: true });
		await readLink.click();
		await expect(page).toHaveURL(/#main-content$/);
	});
}

for (const lang of ["en", "fr"]) {
	for (const width of [1280, 390]) {
		for (const colorScheme of ["light", "dark"] as const) {
			test(`C06b fields reflow, ${lang}, ${width}, ${colorScheme}`, async ({ page }, info) => {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ colorScheme });
				await open(page, source, lang);
				await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
				const names =
					lang === "fr"
						? [
								"Modifier le paragraphe",
								"Modifier l'élément de liste",
								"Modifier le libellé du choix",
							]
						: ["Edit paragraph", "Edit list item", "Edit choice label"];
				const labels =
					lang === "fr"
						? ["Texte du paragraphe", "Texte de l'élément de liste", "Texte du libellé du choix"]
						: kinds.map((item) => item.label);
				for (const [index, name] of names.entries()) {
					const button = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
					await button.focus();
					await page.keyboard.press("Enter");
					const field = page.getByRole("textbox", { name: labels[index], exact: true });
					await expect(field).toBeFocused();
					const box = await field.boundingBox();
					if (!box) throw new Error("Field is not rendered");
					expect(box.x).toBeGreaterThanOrEqual(0);
					expect(box.x + box.width).toBeLessThanOrEqual(width);
					if (process.env.PRAXITY_CANVAS_SHOTS) {
						await mkdir(process.env.PRAXITY_CANVAS_SHOTS, { recursive: true });
						await page.screenshot({
							path: join(
								process.env.PRAXITY_CANVAS_SHOTS,
								`${info.project.name}-${lang}-${width}-${colorScheme}-${index}.png`,
							),
						});
					}
					await field.press("Escape");
					await expect(button).toBeFocused();
				}
			});
		}
	}
}
