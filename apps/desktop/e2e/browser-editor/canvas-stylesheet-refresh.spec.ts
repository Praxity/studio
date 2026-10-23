import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { startJourney } from "./global-setup";

let stop: (() => Promise<void>) | undefined;
test.afterEach(async ({ page }) => {
	page.on("dialog", (dialog) => dialog.accept());
	await page.goto("about:blank");
	await stop?.();
});

const source = (heading: string) => `# ${heading}\n\n${"A long paragraph. ".repeat(90)}\n`;
async function open(page: Page) {
	stop = await startJourney(page.context(), { standaloneSource: source("Practice") });
	await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
	await expect(page.getByRole("status")).toHaveText("Connected");
	await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
}
async function save(page: Page, before: string, after: string) {
	await page.getByRole("button", { name: `Edit heading 1: ${before}`, exact: true }).click();
	await page.getByRole("textbox").fill(after);
	const applied = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/rpc") &&
			response.request().postDataJSON().method === "canvasTextApply",
	);
	await page.getByRole("textbox").press("Enter");
	expect((await (await applied).json()).result.ok).toBe(true);
	await expect(page.getByRole("textbox")).toHaveCount(0);
}

for (const visible of [false, true]) {
	test(`C09 refresh retains focus and reveals the Edit button, already visible: ${visible}`, async ({
		page,
	}) => {
		await open(page);
		const originalUrl = page.url();
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let styles = 0;
		await page.route("**/*.css", async (route) => {
			styles++;
			await held;
			await route.continue();
		});
		try {
			await save(page, "Practice", "Saved");
			await expect
				.poll(() => styles, { message: "The stylesheet hold must engage" })
				.toBeGreaterThan(0);
			const edit = page.getByRole("button", { name: "Edit heading 1: Saved", exact: true });
			await expect(edit).toBeFocused();
			await page.evaluate((y) => scrollTo(0, y), visible ? 100 : 350);
			await expect.poll(() => page.evaluate(() => scrollY)).toBe(visible ? 100 : 350);
			if (visible) await expect(edit).toBeInViewport();
			else await expect(edit).not.toBeInViewport();
			release();
			await expect(page).not.toHaveURL(originalUrl);
			await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeEnabled();
			// Let a queued refresh focus reveal run before checking the reading position.
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
			await expect(edit).toBeFocused();
			await expect(edit).toBeInViewport();
			if (visible) expect(await page.evaluate(() => scrollY)).toBe(100);
		} finally {
			release();
		}
	});
}

test("C09 loaded styles can wait for a paused rendering update", async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		const style = document.createElement("style");
		style.textContent = ":root{--swap-order:later}";
		document.head.append(style);
	});
	const oldStyle = await page.locator('head link[rel="stylesheet"]').elementHandle();
	if (!oldStyle) throw new Error("Missing current stylesheet");
	await page.clock.install();
	await page.evaluate(() => {
		const frame = requestAnimationFrame.bind(window);
		const held: FrameRequestCallback[] = [];
		Reflect.set(window, "heldStyleFrames", held);
		window.requestAnimationFrame = (callback) => {
			if (Reflect.get(window, "holdStyleFrames")) {
				held.push(callback);
				return 0;
			}
			return frame(callback);
		};
		Reflect.set(window, "finishStyleFrames", () => {
			Reflect.set(window, "holdStyleFrames", false);
			for (const callback of held.splice(0)) frame(callback);
		});
	});
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let styles = 0;
	await page.route("**/*.css", async (route) => {
		styles++;
		await held;
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: `${await response.text()}\n:root{--swap-order:replacement}`,
		});
	});
	try {
		await save(page, "Practice", "Saved");
		await expect.poll(() => styles).toBeGreaterThan(0);
		await page.evaluate(() => Reflect.set(window, "holdStyleFrames", true));
		release();
		await expect
			.poll(() => page.evaluate(() => Reflect.get(window, "heldStyleFrames").length))
			.toBeGreaterThan(0);
		const updating = page.getByRole("link", { name: "Read mode: Updating", exact: true });
		await expect(updating).toHaveAttribute("aria-busy", "true");
		expect(await oldStyle.evaluate((sheet) => sheet.isConnected)).toBe(true);
		await expect(page.locator("html")).toHaveCSS("--swap-order", "later");
		// Release only the first refresh frame. A one-frame plant must commit instead of waiting.
		await page.evaluate(() => Reflect.get(window, "heldStyleFrames").shift()(performance.now()));
		await expect
			.poll(async () => ({
				held: await page.evaluate(() => Reflect.get(window, "heldStyleFrames").length),
				updating: (await updating.count()) > 0,
			}))
			.not.toEqual({ held: 0, updating: true });
		await expect(updating).toHaveAttribute("aria-busy", "true");
		expect(await oldStyle.evaluate((sheet) => sheet.isConnected)).toBe(true);
		await page.clock.fastForward(10_000);
		await expect(page.getByRole("status")).not.toHaveText(
			"Studio could not refresh the saved page. Reload to try again.",
		);
		await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
		await page.evaluate(() => Reflect.get(window, "finishStyleFrames")());
		await page.clock.runFor(100);
		await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeEnabled();
	} finally {
		release();
		await page.evaluate(() => Reflect.get(window, "finishStyleFrames")());
	}
});

for (const failure of ["error", "timeout"]) {
	test(`C09 a stylesheet ${failure} preserves the previous styled document`, async ({ page }) => {
		await open(page);
		if (failure === "timeout") await page.clock.install();
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let styles = 0;
		await page.route("**/*.css", async (route) => {
			styles++;
			if (failure === "timeout") await held;
			await route.abort();
		});
		try {
			await writeFile(
				join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
				source("Changed"),
			);
			await expect
				.poll(() => styles, { message: "The failing stylesheet must be requested" })
				.toBeGreaterThan(0);
			if (failure === "timeout") await page.clock.fastForward(10_000);
			await expect(page.getByRole("status")).toHaveText(
				"Studio could not refresh the saved page. Reload to try again.",
			);
			await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
			await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
			await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(0);
		} finally {
			release();
		}
	});
}

test("C09 a superseded stylesheet never replaces the latest revision", async ({ page }) => {
	await open(page);
	await page.evaluate(() => {
		const applied: string[] = [];
		Reflect.set(window, "appliedStyles", applied);
		const record = () => {
			const value = getComputedStyle(document.documentElement)
				.getPropertyValue("--refresh-test")
				.trim();
			if (value) applied.push(value);
		};
		new MutationObserver(record).observe(document.head, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		document.addEventListener("load", record, true);
	});
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let styles = 0;
	await page.route("**/*.css", async (route) => {
		const revision = ++styles;
		const response = await route.fetch();
		if (revision === 1) await held;
		await route.fulfill({
			response,
			body: `${await response.text()}\n:root{--refresh-test:${revision === 1 ? "superseded" : "latest"}}`,
		});
	});
	try {
		await save(page, "Practice", "First");
		await expect.poll(() => styles, { message: "The first stylesheet hold must engage" }).toBe(1);
		await save(page, "First", "Latest");
		release();
		await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeEnabled();
		await expect(page.getByRole("heading", { name: "Latest", exact: true })).toBeVisible();
		await expect(page.locator("html")).toHaveCSS("--refresh-test", "latest");
		expect(await page.evaluate(() => Reflect.get(window, "appliedStyles"))).not.toContain(
			"superseded",
		);
		await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(1);
	} finally {
		release();
	}
});

test("C09 pagehide cancels an in-flight stylesheet without losing the current sheet", async ({
	page,
}) => {
	await open(page);
	const original = page.url();
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let styles = 0;
	await page.route("**/*.css", async (route) => {
		styles++;
		await held;
		await route.continue();
	});
	try {
		await save(page, "Practice", "Saved");
		await expect.poll(() => styles).toBe(1);
		await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(1);
		await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
		await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(0);
		await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(1);
		await expect(page.getByRole("status")).not.toHaveText(
			"Studio could not refresh the saved page. Reload to try again.",
		);
		await expect(page).toHaveURL(original);
		await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
		expect(errors.filter((message) => message.includes("Canvas refresh failed"))).toEqual([]);
	} finally {
		release();
	}
});

test("C09 changed source admission rejects a preloaded sheet before activation", async ({
	page,
}) => {
	await open(page);
	await page.evaluate(() => {
		const applied: string[] = [];
		Reflect.set(window, "admittedStyles", applied);
		const record = () => {
			const value = getComputedStyle(document.documentElement)
				.getPropertyValue("--admission-test")
				.trim();
			if (value) applied.push(value);
		};
		new MutationObserver(record).observe(document.head, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		document.addEventListener("load", record, true);
	});
	let styles = 0;
	let changed = false;
	let builds = 0;
	let release = () => {};
	const nextBuild = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/rpc", async (route) => {
		const method = route.request().postDataJSON().method;
		if (method === "canvasPreviewBuild" && ++builds === 2) await nextBuild;
		const change = method === "canvasTextSnapshot" && styles === 1 && !changed;
		if (change) changed = true;
		const response = await route.fetch();
		if (change) {
			const body = await response.json();
			// Deliver a changed admitted source without a watcher event certifying it first.
			body.result.fields[0].text = "Changed outside the captured build";
			await route.fulfill({ response, json: body });
		} else await route.fulfill({ response });
	});
	await page.route("**/*.css", async (route) => {
		const revision = ++styles;
		const response = await route.fetch();
		await route.fulfill({
			response,
			body: `${await response.text()}\n:root{--admission-test:${revision === 1 ? "stale" : "latest"}}`,
		});
	});
	try {
		await save(page, "Practice", "Saved");
		await expect
			.poll(() => changed, { message: "The pre-activation source change must engage" })
			.toBe(true);
		await expect
			.poll(() => builds, { message: "Changed admission must discard the build" })
			.toBe(2);
		expect(await page.evaluate(() => Reflect.get(window, "admittedStyles"))).not.toContain("stale");
		await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(0);
	} finally {
		release();
	}
});

test("C09 a style deadline during admission preserves the previous styled document", async ({
	page,
}) => {
	await open(page);
	const original = page.url();
	const oldStyle = await page.locator('head link[rel="stylesheet"]').elementHandle();
	if (!oldStyle) throw new Error("Missing current stylesheet");
	await page.clock.install();
	let releaseCss = () => {};
	let releaseAdmission = () => {};
	const css = new Promise<void>((resolve) => {
		releaseCss = resolve;
	});
	const admission = new Promise<void>((resolve) => {
		releaseAdmission = resolve;
	});
	let styles = 0;
	let armed = false;
	let held = false;
	await page.route("**/*.css", async (route) => {
		styles++;
		await css;
		await route.continue();
	});
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method === "canvasTextSnapshot" && armed) {
			armed = false;
			held = true;
			await admission;
		}
		await route.continue();
	});
	try {
		await save(page, "Practice", "Saved");
		await expect.poll(() => styles).toBe(1);
		await page.clock.fastForward(5_000);
		armed = true;
		releaseCss();
		await expect
			.poll(() => held, { message: "The pre-activation admission must be held" })
			.toBe(true);
		await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(1);
		// Cross the style deadline while staying inside the later admission RPC's own budget.
		await page.clock.fastForward(5_500);
		releaseAdmission();
		await expect(page.getByRole("status")).toHaveText(
			"Studio could not refresh the saved page. Reload to try again.",
		);
		await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeEnabled();
		await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(0);
		await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(1);
		expect(await oldStyle.evaluate((sheet) => sheet.isConnected)).toBe(true);
		await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
		await expect(page).toHaveURL(original);
	} finally {
		releaseCss();
		releaseAdmission();
	}
});

test("C09 pagehide before the rendering wait removes the activated sheet", async ({ page }) => {
	await open(page);
	const original = page.url();
	const oldStyle = await page.locator('head link[rel="stylesheet"]').elementHandle();
	if (!oldStyle) throw new Error("Missing current stylesheet");
	await page.evaluate(() => {
		let activated = false;
		const clear = window.clearTimeout.bind(window);
		window.clearTimeout = (id) => {
			clear(id);
			if (!activated) return;
			activated = false;
			// Inject pagehide when the completed load drops its deadline, before the frame wait.
			Reflect.set(window, "stylePagehide", true);
			window.requestAnimationFrame = () => 0;
			window.dispatchEvent(new PageTransitionEvent("pagehide"));
		};
		document.addEventListener(
			"load",
			(event) => {
				if (!(event.target instanceof HTMLLinkElement) || event.target.rel !== "stylesheet") return;
				activated = true;
			},
			true,
		);
	});
	await save(page, "Practice", "Saved");
	await expect.poll(() => page.evaluate(() => Reflect.get(window, "stylePagehide"))).toBe(true);
	await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(1);
	await expect(page.locator('head link[rel="preload"][as="style"]')).toHaveCount(0);
	expect(await oldStyle.evaluate((sheet) => sheet.isConnected)).toBe(true);
	await expect(page.getByRole("status")).not.toHaveText(
		"Studio could not refresh the saved page. Reload to try again.",
	);
	await expect(page).toHaveURL(original);
});

test("C09 every sampled refresh frame stays styled with one request and no warnings", async ({
	page,
}) => {
	await open(page);
	const warnings: string[] = [];
	const styles: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "warning") warnings.push(message.text());
	});
	await page.route("**/*.css", async (route) => {
		styles.push(route.request().url());
		const response = await route.fetch();
		// Fault injection: expose a second CSS request instead of letting it finish between frames.
		await new Promise((resolve) => setTimeout(resolve, 250));
		await route.fulfill({ response });
	});
	await page.evaluate(() => {
		const samples: string[] = [];
		Reflect.set(window, "refreshStyleSamples", samples);
		const sample = () => {
			samples.push(getComputedStyle(document.body).fontFamily);
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	const original = page.url();
	await save(page, "Practice", "Saved");
	await expect(page).not.toHaveURL(original);
	await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeEnabled();
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	const samples = await page.evaluate(() => Reflect.get(window, "refreshStyleSamples") as string[]);
	console.log("Sampled font families", JSON.stringify([...new Set(samples)]));
	console.log("Stylesheet requests", styles.length, "warnings", warnings);
	expect(styles).toHaveLength(1);
	expect(samples.length).toBeGreaterThan(2);
	expect(samples.every((font) => font.includes("Source Sans 3"))).toBe(true);
	expect(warnings).toEqual([]);
});
