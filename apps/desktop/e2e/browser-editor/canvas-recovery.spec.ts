import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { JSDOM } from "jsdom";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import { readIdentityFixture } from "../../src/test-utils/identity-fixture";
import { startJourney } from "./global-setup";

const source = "# Practice\n\n## Keep *clear*\n\nOther.\n";
let stop: (() => Promise<void>) | undefined;
let file = "";
test.beforeEach(async ({ context, browserName }) => {
	stop = await startJourney(context, { standaloneSource: source });
	file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax");
	// Fulfilled document fixtures have no remote IP; Chromium otherwise blocks loopback assets.
	if (browserName === "chromium")
		await context.grantPermissions(["local-network-access"], {
			origin: new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin,
		});
});
test.afterEach(async () => {
	await stop?.();
});
const edit = (page: Page) =>
	page.getByRole("button", { name: "Edit heading 2: Keep clear", exact: true });
const field = (page: Page) => page.getByRole("textbox", { name: "Heading text" });
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
async function project(page: Page, transform: (html: string) => string, gateSource?: string) {
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			!["document", "fetch"].includes(route.request().resourceType()) ||
			new URL(route.request().url()).origin !==
				new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin
		)
			return route.continue();
		const headers = await route.request().allHeaders();
		// Playwright routing doesn't expose browser-added Fetch Metadata.
		if (route.request().resourceType() === "fetch")
			Object.assign(headers, {
				"sec-fetch-dest": "empty",
				"sec-fetch-mode": "cors",
				"sec-fetch-site": "same-origin",
			});
		const response = await route.fetch({ headers });
		const html = await response.text();
		if (gateSource !== undefined && html.includes('id="review-heading"')) {
			expect(await readFile(file, "utf8")).toBe(gateSource);
			return route.fulfill({ response });
		}
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			transform(html),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
}
async function refuse(page: Page) {
	await edit(page).click();
	await field(page).fill("Unique kept text");
	await writeFile(file, source.replace("Other.", "Outside."));
	await page.keyboard.press("Enter");
	await expect(page.locator("#error:visible")).toHaveText(
		"The file changed. Your text is kept. Copy it, then reload.",
	);
}

for (const [trigger, controls] of [
	["resize", ["Copy text", "Reload", "Heading text"]],
	["hostile CSS", ["Heading text"]],
] as const)
	for (const control of controls)
		test(`C09b fallback preserves recovery focus on ${control} after ${trigger}`, async ({
			page,
		}) => {
			await open(page);
			await refuse(page);
			const focused =
				control === "Heading text"
					? field(page)
					: page.getByRole("button", { name: control, exact: true });
			await focused.focus();
			await expect(focused).toBeFocused();
			await expect(page.locator("body")).not.toHaveAttribute("inert", "");
			if (trigger === "resize") await page.setViewportSize({ width: 320, height: 240 });
			else
				await page.evaluate(() => {
					const style = document.createElement("style");
					style.textContent = "body{display:none!important}";
					document.head.append(style);
				});
			await expect(page.locator("body")).toHaveAttribute("inert", "");
			await expect(focused).toBeFocused();
			await expect(field(page)).toHaveValue("Unique kept text");
			if (control === "Copy text") {
				await page.keyboard.press("Tab");
				await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeFocused();
			}
			expect(await readFile(file, "utf8")).toBe(source.replace("Other.", "Outside."));
		});

for (const action of ["Read mode", "course link", "Escape"] as const)
	test(`C04 recovery ${action} confirms before discarding refused text`, async ({
		page,
		context,
	}) => {
		const root = process.env.PRAXITY_BROWSER_PROJECT ?? "";
		const identity = await readIdentityFixture(root);
		const admitted = action === "Escape" ? undefined : await context.newPage();
		const errors: string[] = [];
		if (admitted) {
			admitted.on("pageerror", (error) => errors.push(error.message));
			await admitted.addInitScript(() => {
				const rejections: string[] = [];
				Object.assign(window, { recoveryUnhandledRejections: rejections });
				addEventListener("unhandledrejection", (event) => rejections.push(String(event.reason)));
			});
			// Keep an admitted author document: entering again after the loss must gate.
			await open(admitted);
		}
		await project(
			page,
			(html) =>
				html.replace("</body>", '<a href="https://example.test/">Course destination</a></body>'),
			source.replace("Other.", "Outside."),
		);
		await open(page);
		await page.reload();
		await expect(edit(page)).toBeVisible();
		await refuse(page);
		const authorUrl = page.url();
		if (action === "Escape") {
			await field(page).focus();
			await page.keyboard.press("Escape");
		} else
			await page
				.getByRole("link", {
					name: action === "Read mode" ? action : "Course destination",
					exact: true,
				})
				.click();
		await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
		expect(page.url()).toBe(authorUrl);
		await expect(field(page)).toHaveValue("Unique kept text");
		await page.getByRole("button", { name: "Keep editing", exact: true }).click();
		await expect(field(page)).toBeFocused();
		if (action === "Escape") {
			await page.keyboard.press("Escape");
			await page.getByRole("button", { name: "Discard text", exact: true }).click();
			await expect(field(page)).toHaveCount(0);
		} else {
			await page.getByRole("link", { name: "Read mode", exact: true }).click();
			await page.getByRole("button", { name: "Discard text and leave", exact: true }).click();
			await expect(page.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
			await expect(page.locator("#review-heading")).toHaveCount(0);
			await expect(page.getByText("Outside.", { exact: true })).toBeVisible();
			expect(await readIdentityFixture(root)).toEqual(identity);
			if (!admitted) throw new Error("Missing admitted author tab");
			await expect(admitted.getByText("Outside.", { exact: true })).toBeVisible();
			await expect(admitted.getByRole("status")).toHaveText("Connected");
			const storage = () => readFile(file);
			const beforeWrite = await storage();
			const admittedUrl = admitted.url();
			await edit(admitted).click();
			await field(admitted).fill("Next refused write");
			const refused = admitted.waitForResponse(
				(response) =>
					response.url().endsWith("/api/rpc") &&
					response.request().postDataJSON().method === "canvasTextApply",
			);
			await admitted.keyboard.press("Enter");
			expect((await refused).status()).toBe(200);
			expect(await (await refused).json()).toMatchObject({
				ok: true,
				result: { ok: false, code: "identity-retirement-pending", reviewUrl: "/launch" },
			});
			await expect(admitted.locator("#error:visible")).toHaveText(
				"This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.",
			);
			await expect(field(admitted)).toHaveValue("Next refused write");
			await expect(field(admitted)).toBeFocused();
			expect(await storage()).toEqual(beforeWrite);
			expect(await readIdentityFixture(root)).toEqual(identity);
			expect(errors).toEqual([]);
			expect(
				await admitted.evaluate(() => Reflect.get(window, "recoveryUnhandledRejections")),
			).toEqual([]);
			await admitted.getByRole("button", { name: "Review changes", exact: true }).click();
			await admitted.getByRole("button", { name: "Discard text and reload", exact: true }).click();
			await expect(
				admitted.getByRole("heading", { name: "Some blocks would get new IDs", exact: true }),
			).toBeFocused();
			expect(admitted.url()).toBe(admittedUrl);
			await expect(admitted.locator("main > ul > li")).toHaveText([
				"second.prax: Practice; Other.; Line unknown",
			]);
			await admitted.getByRole("link", { name: "Close", exact: true }).click();
			await expect(admitted.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
			await page.goto(authorUrl);
			await expect(
				page.getByRole("heading", { name: "Some blocks would get new IDs", exact: true }),
			).toBeFocused();
			await expect(page.locator("main > ul > li")).toHaveText([
				"second.prax: Practice; Other.; Line unknown",
			]);
			expect(await storage()).toEqual(beforeWrite);
			expect(await readIdentityFixture(root)).toEqual(identity);
			expect(errors).toEqual([]);
			await admitted.close();
		}
		expect(await readFile(file, "utf8")).toBe(source.replace("Other.", "Outside."));
	});

test("C04 recovery navigation waits for a pending blur save and confirms its refusal", async ({
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
	await field(page).fill("Pending then refused");
	await writeFile(file, source.replace("Other.", "Outside."));
	const authorUrl = page.url();
	await page.getByRole("link", { name: "Read mode", exact: true }).click();
	await expect(field(page)).toHaveAttribute("readonly", "");
	expect(page.url()).toBe(authorUrl);
	await expect.poll(() => Boolean(release)).toBe(true);
	release?.();
	await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
	await expect(field(page)).toHaveValue("Pending then refused");
	expect(calls).toHaveLength(1);
});

test("C04 recovery unload prompts only for kept text", async ({ page }) => {
	await open(page);
	let dialogs = 0;
	page.on("dialog", async (dialog) => {
		dialogs++;
		await dialog.dismiss();
	});
	await edit(page).click();
	await field(page).fill("Ordinary edit");
	await page.reload();
	expect(dialogs).toBe(0);
	await expect(edit(page)).toBeVisible();
	await refuse(page);
	const before = page.url();
	await page.evaluate(() => location.reload());
	await expect.poll(() => dialogs).toBe(1);
	expect(page.url()).toBe(before);
	await expect(field(page)).toHaveValue("Unique kept text");
});

for (const css of ["display:none", "interactivity:inert"])
	for (const selector of [":has(> [popover])", "html"])
		test(`C04 recovery course CSS cannot blur-save partial text or hide the open field: ${selector} ${css}`, async ({
			page,
		}) => {
			if (css === "interactivity:inert")
				test.skip(
					!(await page.evaluate(() => CSS.supports("interactivity", "inert"))),
					"Engine has no CSS interactivity property",
				);
			const calls = saves(page);
			await project(page, (html) =>
				html.replace(
					"</head>",
					`<style>@keyframes studiohide{to{${css}}}${selector}:focus-within{animation:studiohide 0s 1.5s forwards!important}</style></head>`,
				),
			);
			await open(page);
			await page.reload();
			await expect(edit(page)).toBeVisible();
			await edit(page).click();
			await page.keyboard.type("Half typ");
			await page.waitForTimeout(2000);
			expect(calls).toHaveLength(0);
			expect(await readFile(file, "utf8")).toBe(source);
			await expect(field(page)).toBeVisible();
			await field(page).focus();
			await page.keyboard.press("Escape");
			await expect(field(page)).toHaveCount(0);
		});

test("C04 recovery unchanged fields send no operation, even after an outside change", async ({
	page,
}) => {
	const calls = saves(page);
	await open(page);
	await edit(page).click();
	await page.keyboard.press("Enter");
	await expect(field(page)).toHaveCount(0);
	await edit(page).click();
	await writeFile(file, source.replace("Other.", "Outside."));
	await page.getByRole("link", { name: /^Read mode(?:: Updating)?$/ }).focus();
	await expect(field(page)).toHaveCount(0);
	expect(calls).toHaveLength(0);
	expect(await readFile(file, "utf8")).toBe(source.replace("Other.", "Outside."));
});

test("C04 recovery duplicate course IDs keep the admitted heading editable", async ({ page }) => {
	await open(page);
	const id = await page
		.getByRole("heading", { name: "Keep clear", exact: true })
		.evaluate((el) => el.closest("[data-node-id]")?.getAttribute("data-node-id"));
	await project(page, (html) =>
		html.replace("</body>", `<div data-node-id="${id}"><h2>Forged twin</h2></div></body>`),
	);
	await page.reload();
	await expect(page.getByRole("status")).toHaveText("Connected");
	await expect(edit(page)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Edit heading 1: Forged twin", exact: true }),
	).toHaveCount(0);
	await edit(page).click();
	await expect(field(page)).toHaveValue("Keep *clear*");
});

test("C04 recovery repeats an identical refusal announcement", async ({ page }) => {
	const calls = saves(page);
	await open(page);
	await refuse(page);
	const alert = page.locator("#error:visible");
	await alert.evaluate((el) => {
		const updates: string[] = [];
		new MutationObserver(() => updates.push(el.textContent ?? "")).observe(el, {
			childList: true,
			subtree: true,
			characterData: true,
		});
		Object.assign(window, { alertUpdates: updates });
	});
	await field(page).focus();
	await page.keyboard.press("Enter");
	await expect.poll(() => calls.length).toBe(2);
	await expect(alert).toHaveText("The file changed. Your text is kept. Copy it, then reload.");
	expect(await page.evaluate(() => Reflect.get(window, "alertUpdates"))).toEqual([
		"",
		"The file changed. Your text is kept. Copy it, then reload.",
	]);
});

test("C04 recovery corrected input still saves on blur after a refusal", async ({ page }) => {
	const calls = saves(page);
	await open(page);
	await edit(page).click();
	await field(page).fill(" ");
	await page.keyboard.press("Enter");
	await expect(page.locator("#error:visible")).toHaveText("Enter some text.");
	await field(page).fill("Corrected heading");
	await page.getByRole("link", { name: "Read mode", exact: true }).focus();
	await expect(field(page)).toHaveCount(0);
	expect(calls).toHaveLength(2);
	expect(await readFile(file, "utf8")).toBe(source.replace("Keep *clear*", "Corrected heading"));
});

test("C04 recovery a new pending save retires an earlier discard confirmation", async ({
	page,
}) => {
	await open(page);
	await refuse(page);
	await page.getByRole("link", { name: "Read mode", exact: true }).click();
	const discard = page.getByRole("button", { name: "Discard text and leave", exact: true });
	await expect(discard).toBeVisible();
	let release: (() => void) | undefined;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.continue();
	});
	await field(page).focus();
	await page.keyboard.press("Enter");
	await expect(field(page)).toHaveAttribute("readonly", "");
	await expect(discard).toHaveCount(0);
	await expect.poll(() => Boolean(release)).toBe(true);
	release?.();
	await expect(field(page)).toBeEditable();
	await expect(discard).toHaveCount(0);
	await expect(field(page)).toHaveValue("Unique kept text");
});

for (const unknown of [false, true])
	test(`C04 recovery pending navigation handles unknown=${unknown}`, async ({ page }) => {
		const calls = saves(page);
		await open(page);
		let release: (() => void) | undefined;
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			if (unknown) await route.abort();
			else await route.continue();
		});
		await edit(page).click();
		await field(page).fill("Pending navigation");
		await page.keyboard.press("Enter");
		await expect(field(page)).toHaveAttribute("readonly", "");
		await page.getByRole("link", { name: "Read mode", exact: true }).click();
		await expect.poll(() => Boolean(release)).toBe(true);
		release?.();
		if (unknown) {
			await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeVisible();
			await expect(field(page)).toHaveValue("Pending navigation");
			await field(page).focus();
			await page.keyboard.press("Escape");
			await expect(page.getByRole("button", { name: "Discard text", exact: true })).toBeVisible();
			expect(await readFile(file, "utf8")).toBe(source);
		} else {
			await expect(page.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
			expect(await readFile(file, "utf8")).toBe(
				source.replace("Keep *clear*", "Pending navigation"),
			);
		}
		expect(calls).toHaveLength(1);
	});

// Both independent round-2 repros: corrected kept text must survive Studio's focus move.
for (const refusal of ["empty-input", "stale"])
	test(`C04 recovery r2 Escape never saves corrected ${refusal} text`, async ({ page }) => {
		const calls = saves(page);
		await open(page);
		await edit(page).click();
		await field(page).fill(refusal === "stale" ? "Refused text" : " ");
		const disk = refusal === "stale" ? "# Practice\n\n## Keep *clear*\n\nOutside.\n" : source;
		if (refusal === "stale") await writeFile(file, disk);
		await page.keyboard.press("Enter");
		await expect(page.locator("#error:visible")).toBeVisible();
		await expect(field(page)).toBeEditable();
		await field(page).fill("Corrected but not submitted");
		await page.keyboard.press("Escape");
		const keep = page.getByRole("button", { name: "Keep editing", exact: true });
		await expect(keep).toBeFocused();
		await expect(field(page)).toHaveValue("Corrected but not submitted");
		expect(calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe(disk);
		await expect(
			page.getByRole("group", { name: "Discard your kept text?", exact: true }),
		).toMatchAriaSnapshot(`
- group "Discard your kept text?":
  - paragraph: Discard your kept text?
  - button "Discard text"
  - button "Keep editing"
`);
		await keep.click();
		await expect(field(page)).toBeFocused();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Discard text", exact: true }).click();
		await expect(field(page)).toHaveCount(0);
		expect(calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe(disk);
	});

test("C04 recovery r2 confirmation exposes its question once with focus inside the named group", async ({
	page,
}) => {
	await open(page);
	await refuse(page);
	await field(page).focus();
	await page.keyboard.press("Escape");
	const group = page.getByRole("group", { name: "Discard your kept text?", exact: true });
	await expect(group).toBeVisible();
	await expect(group.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
	await expect(group.getByText("Discard your kept text?", { exact: true })).toHaveCount(1);
	await expect(group.locator('[role="alert"],[role="status"],[aria-live]')).toHaveCount(0);
});

// The model drives real trusted focus events, including the mount layer's own blur.
for (const refusal of ["empty-input", "stale"])
	test(`C04 recovery r2 generated focus histories from ${refusal} keep requests and literal bytes`, async ({
		page,
	}) => {
		const model = {
			calls: 1,
			disk: refusal === "stale" ? "# Practice\n\n## Keep *clear*\n\nOutside.\n" : source,
			text: refusal === "stale" ? "Refused text" : " ",
		};
		const calls = saves(page);
		await open(page);
		await edit(page).click();
		await field(page).fill(model.text);
		if (refusal === "stale") await writeFile(file, model.disk);
		await page.keyboard.press("Enter");
		await expect(page.locator("#error:visible")).toBeVisible();
		await expect(field(page)).toBeEditable();
		// Merely leaving the unchanged refused value cannot resend it.
		await page.getByRole("link", { name: "Read mode", exact: true }).focus();
		expect(calls).toHaveLength(model.calls);
		let random = 421;
		for (let step = 0; step < 5; step++) {
			random = (random * 16807) % 2147483647;
			model.text = `Kept correction ${random}`;
			await field(page).fill(model.text);
			if (refusal === "stale" && step === 0) {
				await page.keyboard.press("Tab");
				await expect(page.getByRole("button", { name: "Copy text", exact: true })).toBeFocused();
				expect(calls).toHaveLength(model.calls);
				await page.keyboard.press("Shift+Tab");
				await expect(field(page)).toBeFocused();
			}
			if (refusal === "stale" && step === 1)
				await page.getByRole("button", { name: "Reload", exact: true }).click();
			else await page.keyboard.press("Escape");
			await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
			await expect(field(page)).toHaveValue(model.text);
			expect(calls).toHaveLength(model.calls);
			expect(await readFile(file, "utf8")).toBe(model.disk);
			await page.getByRole("button", { name: "Keep editing", exact: true }).click();
			await expect(field(page)).toBeFocused();
		}
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Discard text", exact: true }).click();
		await expect(field(page)).toHaveCount(0);
		expect(calls).toHaveLength(model.calls);
		expect(await readFile(file, "utf8")).toBe(model.disk);
	});

for (const backwards of [false, true])
	for (const text of ["Keep *clear*", "Tabbed heading"])
		test(`C04 recovery r2 ${backwards ? "Shift+Tab" : "Tab"} follows the heading's course position with ${text}`, async ({
			page,
		}) => {
			const calls = saves(page);
			// Keep the test's course controls in every saved-page projection too.
			await project(page, (html) => {
				const dom = new JSDOM(html);
				try {
					const doc = dom.window.document;
					const heading = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((element) =>
						["Keep clear", "Tabbed heading"].includes(element.textContent ?? ""),
					);
					const paragraph = [...doc.querySelectorAll("p")].find(
						(element) => element.textContent === "Other.",
					);
					if (!heading || !paragraph) throw new Error("Missing course focus fixture");
					const before = doc.createElement("button");
					before.type = "button";
					before.textContent = "Before heading";
					heading.before(before);
					const after = doc.createElement("a");
					after.href = "https://example.test/after";
					after.textContent = "Link after heading";
					paragraph.append(after);
					return dom.serialize();
				} finally {
					dom.window.close();
				}
			});
			await open(page);
			await page.reload();
			await expect(page.getByRole("status")).toHaveText("Connected");
			await expect(edit(page)).toBeVisible();
			await expect(page.getByRole("button", { name: "Before heading", exact: true })).toBeVisible();
			await expect(
				page.getByRole("link", { name: "Link after heading", exact: true }),
			).toBeVisible();
			await edit(page).click();
			await field(page).fill(text);
			await field(page).dispatchEvent("keydown", {
				key: "Tab",
				shiftKey: backwards,
				bubbles: true,
			});
			await expect(field(page)).toBeFocused();
			expect(calls).toHaveLength(0);
			expect(await readFile(file, "utf8")).toBe(source);
			await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
			await expect(field(page)).toHaveCount(0);
			await expect(
				page.getByRole(backwards ? "button" : "link", {
					name: backwards ? "Before heading" : "Link after heading",
					exact: true,
				}),
			).toBeFocused();
			expect(calls).toHaveLength(text === "Keep *clear*" ? 0 : 1);
			expect(await readFile(file, "utf8")).toBe(
				text === "Keep *clear*" ? source : "# Practice\n\n## Tabbed heading\n\nOther.\n",
			);
		});

for (const target of ["_top", "_parent"])
	test(`C04 recovery r2 target=${target} waits for pending save and refusal`, async ({ page }) => {
		const calls = saves(page);
		await project(page, (html) =>
			html.replace(
				"</body>",
				`<a href="https://example.test/destination" target="${target}">Course destination</a></body>`,
			),
		);
		await page.route("https://example.test/**", (route) => route.fulfill({ body: "Elsewhere" }));
		await open(page);
		await page.reload();
		await expect(edit(page)).toBeVisible();
		let release: (() => void) | undefined;
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			await route.continue();
		});
		await edit(page).click();
		await field(page).fill("Pending at navigation");
		await writeFile(file, "# Practice\n\n## Keep *clear*\n\nOutside.\n");
		const authorUrl = page.url();
		await page.getByRole("link", { name: "Course destination", exact: true }).click();
		await expect(field(page)).toHaveAttribute("readonly", "");
		expect(page.url()).toBe(authorUrl);
		await expect.poll(() => Boolean(release)).toBe(true);
		release?.();
		await expect(page.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
		await expect(field(page)).toHaveValue("Pending at navigation");
		expect(calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe("# Practice\n\n## Keep *clear*\n\nOutside.\n");
	});

for (const navigation of ["reload", "assign", "back"])
	test(`C04 recovery r2 ${navigation} prompts while save is pending`, async ({ page }) => {
		const calls = saves(page);
		if (navigation === "back") {
			const previous = `${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/history-entry`;
			await page.route(previous, (route) =>
				route.fulfill({
					contentType: "text/html",
					body: "<p>Before Studio</p>",
					headers: { "Cross-Origin-Opener-Policy": "same-origin" },
				}),
			);
			await page.goto(previous);
		}
		await open(page);
		if (navigation === "back") expect(await page.evaluate(() => history.length)).toBeGreaterThan(1);
		let release: (() => void) | undefined;
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			await route.continue();
		});
		await edit(page).click();
		await field(page).fill("Pending on unload");
		await writeFile(file, "# Practice\n\n## Keep *clear*\n\nOutside.\n");
		await page.keyboard.press("Enter");
		await expect(field(page)).toHaveAttribute("readonly", "");
		const authorUrl = page.url();
		let dialogs = 0;
		page.on("dialog", async (dialog) => {
			dialogs++;
			await dialog.dismiss();
		});
		await page.evaluate((kind) => {
			if (kind === "reload") location.reload();
			else if (kind === "assign") location.assign("about:blank");
			else history.back();
		}, navigation);
		await expect.poll(() => dialogs).toBe(1);
		expect(page.url()).toBe(authorUrl);
		await expect.poll(() => Boolean(release)).toBe(true);
		release?.();
		await expect(page.locator("#error:visible")).toHaveText(
			"The file changed. Your text is kept. Copy it, then reload.",
		);
		await expect(field(page)).toHaveValue("Pending on unload");
		expect(calls).toHaveLength(1);
		expect(await readFile(file, "utf8")).toBe("# Practice\n\n## Keep *clear*\n\nOutside.\n");
	});

for (const css of [
	":root:focus-within body{position:relative!important;top:-100000px!important}",
	":root:focus-within{zoom:0.05!important}",
])
	test(`C04 recovery r2 focus CSS preserves field size and viewport: ${css}`, async ({ page }) => {
		const calls = saves(page);
		await project(page, (html) => html.replace("</head>", `<style>${css}</style></head>`));
		await open(page);
		await page.reload();
		await expect(edit(page)).toBeVisible();
		await edit(page).click();
		await page.keyboard.type(" unsaved");
		await expect(field(page)).toBeFocused();
		const box = await field(page).boundingBox();
		expect(box).not.toBeNull();
		expect(box?.y).toBeGreaterThanOrEqual(0);
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
			page.viewportSize()?.height ?? 0,
		);
		expect(box?.height).toBeGreaterThan(40);
		expect(box?.width).toBeGreaterThan(200);
		expect(calls).toHaveLength(0);
		expect(await readFile(file, "utf8")).toBe(source);
		await page.keyboard.press("Escape");
		await expect(field(page)).toHaveCount(0);
	});
