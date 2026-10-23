import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { CanvasTextReply } from "../../src/renderer/browser/canvas-text";
import { startJourney } from "./global-setup";

const source =
	"# Captions\n\n::: figure\n![Exact alt](https://example.com/image.png)\nFirst *caption*.\n\nSecond caption.\n:::\n\n::: video https://example.com/clip.mp4 {start=2 end=9}\ncaption: Video caption.\ntranscript: Exact transcript.\n:::\n";

test("a saved caption remains clickable when its image finishes loading", async ({ page }) => {
	let release = () => {};
	const imageReady = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("https://example.com/image.png", async (route) => {
		await imageReady;
		await route.fulfill({
			contentType: "image/svg+xml",
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="1800"><rect width="200" height="1800" fill="gray"/></svg>',
		});
	});
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		await page.goto(
			`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
			{ waitUntil: "domcontentloaded" },
		);
		await page
			.getByRole("button", { name: "Edit caption 2: Second caption.", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await page.getByRole("textbox", { name: "Text", exact: true }).fill("Saved caption.");
		const revision = page.url();
		await page.keyboard.press("Enter");
		await expect(page).not.toHaveURL(revision);
		const edit = page.getByRole("button", { name: "Edit caption 2: Saved caption.", exact: true });
		await expect(edit).toBeFocused();
		release();
		await page
			.getByRole("img", { name: "Exact alt" })
			.evaluate((image: HTMLImageElement) => image.decode());
		await expect(edit).toBeInViewport();
		await edit.click();
		await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(
			"Saved caption.",
		);
		await page.keyboard.press("Escape");
	} finally {
		release();
		await stop();
	}
});

test("C08a newly added deck captions retain their binding across saves", async ({ page }) => {
	let startupBuilds = 0;
	let saving = false;
	page.on("request", (request) => {
		if (!request.url().endsWith("/api/rpc")) return;
		const method = request.postDataJSON().method;
		if (method === "canvasTextApply") saving = true;
		if (method === "canvasPreviewBuild" && !saving) startupBuilds++;
	});
	const stop = await startJourney(page.context(), {
		courseFixture: resolve(import.meta.dirname, "fixtures/canvas-deck"),
	});
	try {
		const file = join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax");
		const initial = (await readFile(file, "utf8")).replace(
			"# Second slide",
			"::: figure\n![Deck alt](https://example.com/image.png)\nDeck caption.\n:::\n\n# Second slide",
		);
		await writeFile(file, initial);
		await page.goto(
			`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
		);
		await expect(page.getByRole("status").filter({ hasText: /^Connected$/ })).toHaveText(
			"Connected",
		);
		await page.getByRole("button", { name: "Edit caption 1: Deck caption.", exact: true }).focus();
		await page.keyboard.press("Enter");
		await page.getByRole("textbox", { name: "Text", exact: true }).fill("Saved *deck* caption.");
		const caption = page.locator("figcaption > span[data-node-id]");
		const displayId = await caption.getAttribute("data-node-id");
		const response = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/rpc") &&
				response.request().postDataJSON().method === "canvasTextApply",
		);
		await page.keyboard.press("Enter");
		const reply = (await (await response).json()) as {
			result: Extract<CanvasTextReply, { ok: true }>;
		};
		expect(startupBuilds).toBe(0);
		const durableId =
			reply.result.correspondence?.find((pair) => pair.runtimeId === displayId)?.durableId ??
			displayId;
		await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
		await expect(page.locator("figcaption em")).toHaveText("deck");
		await expect(caption).toHaveAttribute("data-node-id", durableId ?? "missing");
		await page
			.getByRole("button", { name: "Edit caption 1: Saved deck caption.", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await page.getByRole("textbox", { name: "Text", exact: true }).fill("Saved **deck** caption.");
		const revision = page.url();
		await page.keyboard.press("Enter");
		await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toHaveText("Saved");
		await expect(caption).toHaveAttribute("data-node-id", durableId ?? "missing");
		await expect(page.locator("figcaption strong")).toHaveText("deck");
		await expect(page).not.toHaveURL(revision);
		const read = page.getByRole("link", { name: "Read mode", exact: true });
		const href = await read.getAttribute("href");
		if (!href) throw new Error("Missing Read mode link");
		expect(new URL(href).searchParams.get("praxity-resume")).toBe("0");
		await read.click();
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator("figcaption strong")).toHaveText("deck");
		await page.locator("#deck-next").click();
		await expect(
			page.locator(".deck-slide").getByRole("heading", { name: "Second slide", exact: true }),
		).toBeVisible();
		expect(await readFile(file, "utf8")).toBe(
			initial.replace("Deck caption.", "Saved **deck** caption."),
		);
	} finally {
		await stop();
	}
});

test("C08a generic Edit buttons save individual figure and video captions", async ({ page }) => {
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		await page.goto(
			`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
		);
		await expect(page.getByRole("status")).toHaveText("Connected");
		const image = page.getByRole("img", { name: "Exact alt" });
		const imageId = await image.getAttribute("data-node-id");
		for (const [position, old, text] of [
			[2, "Second caption.", "Changed figure caption."],
			[3, "Video caption.", "Changed video caption."],
		] as const) {
			const edit = page.getByRole("button", {
				name: `Edit caption ${position}: ${old}`,
				exact: true,
			});
			await expect(edit).toBeVisible();
			await edit.focus();
			await page.keyboard.press("Enter");
			const field = page.getByRole("textbox", { name: "Text", exact: true });
			await expect(field).toBeFocused();
			await expect(field).toHaveValue(old);
			await field.fill("");
			await page.keyboard.press("Enter");
			await expect(page.locator("#error:visible")).toHaveText("Enter some text.");
			await field.fill(text);
			await page.keyboard.press("Enter");
			await expect(page.getByRole("status")).toHaveText("Saved");
			await expect(field).toHaveCount(0);
		}
		expect(
			await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"), "utf8"),
		).toBe(
			source
				.replace("Second caption.", "Changed figure caption.")
				.replace("Video caption.", "Changed video caption."),
		);
		await expect(image).toHaveAttribute("src", "https://example.com/image.png");
		await expect(image).toHaveAttribute("data-node-id", imageId ?? "missing");
		await expect(page.locator("figcaption")).toContainText("First caption.");
	} finally {
		await stop();
	}
});

test("C08a missing committed fragments use saved-page refresh without retrying the write", async ({
	page,
}) => {
	const stop = await startJourney(page.context(), { standaloneSource: source });
	try {
		await page.goto(
			`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
		);
		await expect(page.getByRole("status")).toHaveText("Connected");
		let saves = 0;
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method !== "canvasTextApply") return route.continue();
			saves++;
			const response = await route.fetch();
			const reply = await response.json();
			delete reply.result.render;
			await route.fulfill({ response, json: reply });
		});
		await page
			.getByRole("button", { name: "Edit caption 2: Second caption.", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await page.getByRole("textbox", { name: "Text", exact: true }).fill("Saved *caption*.");
		await page.keyboard.press("Enter");
		await expect(page.getByRole("status")).toHaveText("Saved");
		await expect(page.getByRole("textbox")).toHaveCount(0);
		await expect(page.locator("figcaption > span[data-node-id]").last()).toHaveText(
			"Saved caption.",
		);
		await expect(page.locator("figcaption em").last()).toHaveText("caption");
		expect(saves).toBe(1);
		expect(
			await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"), "utf8"),
		).toBe(source.replace("Second caption.", "Saved *caption*."));
	} finally {
		await stop();
	}
});

test("C08a captions coexist with shipped text kinds and refresh saved markup", async ({ page }) => {
	const initial =
		"# Captions\n\n## Heading\n\nA plain paragraph.\n\n- List item\n\n::: choice Pick\n(x) Alpha label\n( ) Beta label\n:::\n\n::: figure\n![Exact alt](https://example.com/image.png)\nFirst *caption*.\n:::\n\n::: video https://example.com/clip.mp4\ncaption: Video caption.\n:::\n";
	const stop = await startJourney(page.context(), { standaloneSource: initial });
	try {
		await page.goto(
			`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`,
		);
		await expect(page.getByRole("status")).toHaveText("Connected");
		await expect(page.getByRole("button", { name: /^Edit (heading|caption) \d+:/ })).toHaveText([
			"Edit",
			"Edit",
			"Edit",
			"Edit",
		]);
		await expect(page.getByRole("button", { name: /^Edit heading \d+:/ })).toHaveCount(2);
		await expect(page.getByRole("button", { name: /^Edit caption \d+:/ })).toHaveCount(2);
		for (const [position, old, raw, selector, visible] of [
			[
				1,
				"First caption.",
				"Changed *figure* [caption](#main-content).",
				"figcaption > span[data-node-id]",
				"Changed figure caption.",
			],
			[
				2,
				"Video caption.",
				"Changed *video* [caption](https://example.com/resource).",
				"p.praxity-block-caption > span[data-node-id]",
				"Changed video caption.",
			],
		] as const) {
			await page.locator(selector).scrollIntoViewIfNeeded();
			await page
				.getByRole("button", { name: `Edit caption ${position}: ${old}`, exact: true })
				.focus();
			await page.keyboard.press("Enter");
			await page.getByRole("textbox", { name: "Text", exact: true }).fill(raw);
			const revision = page.url();
			await page.keyboard.press("Enter");
			await expect(page.getByRole("status")).toHaveText("Saved");
			await expect(page.locator(selector)).toHaveText(visible);
			await expect(page.locator(`${selector} em`)).toHaveText(
				selector.startsWith("figcaption") ? "figure" : "video",
			);
			const edit = page.getByRole("button", {
				name: `Edit caption ${position}: ${visible}`,
				exact: true,
			});
			await expect(edit).toBeFocused();
			await expect(page).not.toHaveURL(revision);
			await edit.click();
			await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveValue(raw);
			await page.keyboard.press("Escape");
		}
		const author = new URL(page.url());
		await expect(page.locator("figcaption a")).toHaveAttribute(
			"href",
			`${author.origin}${author.pathname}#main-content`,
		);
		await expect(page.locator("p.praxity-block-caption a")).toHaveAttribute(
			"href",
			"https://example.com/resource",
		);
		await page.locator("figcaption a").focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(`${author.origin}${author.pathname}#main-content`);
		await expect(page.getByRole("radio")).toHaveCount(3);
		expect(
			await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"), "utf8"),
		).toBe(
			initial
				.replace("First *caption*.", "Changed *figure* [caption](#main-content).")
				.replace("Video caption.", "Changed *video* [caption](https://example.com/resource)."),
		);
	} finally {
		await stop();
	}
});
