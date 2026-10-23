import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { withProjectFileTransaction } from "../../src/main/project-file-transactions";
import { startJourney } from "./global-setup";

const leadership = process.env.PRAXITY_CANVAS_DECK_COURSE;
const firstTitle = leadership ? "Conversations difficiles au travail" : "Opening slide";
const secondTitle = leadership ? "Naviguer dans le parcours" : "Second slide";
// The leadership fixture has three authored headings in its opening accordion.
const secondHeadingPosition = leadership ? 5 : 3;
const editLabel = leadership ? "Modifier le texte" : "Edit text";
let stop: (() => Promise<void>) | undefined;
let origin = "";

async function projectBytes(root: string): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			// Captured compiler outputs are disposable, outside the author's records.
			if (entry.name === "cache" || entry.name === "locks") continue;
			for (const [key, digest] of Object.entries(await projectBytes(path)))
				files[`${entry.name}/${key}`] = digest;
		} else
			files[entry.name] = createHash("sha256")
				.update(await readFile(path))
				.digest("hex");
	}
	return files;
}

test.beforeAll(async ({ browser }) => {
	stop = await startJourney(browser, {
		courseFixture: leadership ?? resolve(import.meta.dirname, "fixtures/canvas-deck"),
	});
	origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
});
test.afterAll(async () => stop?.());

test("Read mode link reserves space outside deck header text", async ({ page }, testInfo) => {
	const intersections: number[] = [];
	for (const width of [1280, 390]) {
		for (const colorScheme of ["light", "dark"] as const) {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ colorScheme });
			await page.goto(`${origin}/launch?canvas=1`);
			await page
				.getByRole("link", { name: leadership ? "Mode lecture" : "Read mode", exact: true })
				.click();
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.locator(".deck-identity")).toBeVisible();
			const link = page.getByRole("link", { name: editLabel, exact: true });
			await expect(link).toBeVisible();
			intersections.push(
				...(await link.evaluate((element) => {
					const box = element.getBoundingClientRect();
					return Array.from(document.querySelectorAll(".deck-identity p, .deck-identity-separator"))
						.filter((text) => text.getClientRects().length > 0)
						.map((text) => {
							const other = text.getBoundingClientRect();
							return (
								Math.max(0, Math.min(box.right, other.right) - Math.max(box.left, other.left)) *
								Math.max(0, Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top))
							);
						});
				})),
			);
			await page.screenshot({ path: testInfo.outputPath(`header-${width}-${colorScheme}.png`) });
			await link.focus();
			await page.keyboard.press("Enter");
			await expect(
				page.getByRole("link", { name: leadership ? "Mode lecture" : "Read mode", exact: true }),
			).toBeVisible();
		}
	}
	expect(intersections.length).toBeGreaterThan(0);
	expect(intersections).toEqual(intersections.map(() => 0));
});

test("top-level learner deck is ready, navigates and keeps isolated browser state", async ({
	page,
	request,
}, testInfo) => {
	await page.goto(`${origin}/launch?canvas=1`);
	await expect(
		page.getByRole("status").filter({ hasText: leadership ? "Connecté" : "Connected" }),
	).toBeVisible();
	const read = page.getByRole("link", {
		name: leadership ? "Mode lecture" : "Read mode",
		exact: true,
	});
	await expect(read).toBeVisible();
	const token = await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"));
	expect(token).toBeTruthy();
	for (const format of ["html", "invalid", null]) {
		const refused = await request.post(`${origin}/api/rpc`, {
			headers: { Origin: origin, Authorization: `Bearer ${token}` },
			data: { method: "coursePreviewBuild", args: { format } },
		});
		expect(refused.status()).toBe(400);
	}
	await page.evaluate(() => localStorage.setItem("author-state-control", "author-only"));
	const before = await withProjectFileTransaction(
		process.env.PRAXITY_BROWSER_PROJECT ?? "",
		projectBytes,
		"read",
	);
	const readUrl = await read.getAttribute("href");
	if (!readUrl) throw new Error("Missing learner URL");
	const captured = new URL(readUrl);
	captured.pathname = captured.pathname.slice("/canvas".length);
	const original = await (await request.get(captured.href)).text();
	const response = await request.get(readUrl);
	expect(
		(await response.text()).replace(
			/<style data-praxity-studio-read>[\s\S]*?<\/style><div class="praxity-studio-read-tools">[\s\S]*?<\/div>/,
			"",
		),
	).toBe(original);
	await read.click();
	const learnerOrigin = new URL(page.url()).origin;
	expect(learnerOrigin).not.toBe(origin);
	expect(await page.evaluate(() => window.parent === window)).toBe(true);
	const deck = page.locator(".praxity-deck");
	await expect(deck).toHaveAttribute("data-ready", "true");
	await expect(page.locator(".deck-workspace")).toBeVisible();
	expect(
		await page.evaluate(() => ({
			runtime: Boolean((window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime),
			tracker: Boolean((window as unknown as { __praxityTracker?: unknown }).__praxityTracker),
			inspection: new URL(location.href).searchParams.has("praxity-inspect"),
		})),
	).toEqual({ runtime: true, tracker: true, inspection: false });
	await expect(
		page.locator(".deck-slide").getByRole("heading", { name: firstTitle, exact: true }),
	).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("read-deck.png") });
	expect(await page.evaluate(() => localStorage.getItem("author-state-control"))).toBeNull();
	expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBeNull();
	expect(await page.content()).not.toContain(token);
	const calls: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.method());
	});
	await page.locator("#deck-next").click();
	await expect(
		page.locator(".deck-slide").getByRole("heading", { name: secondTitle, exact: true }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: editLabel, exact: true })).toBeVisible();
	await page.reload();
	await expect(deck).toHaveAttribute("data-ready", "true");
	await expect(
		page.locator(".deck-slide").getByRole("heading", {
			// The learner host can prefix a resumed heading with its position cue.
			name: leadership ? /Naviguer dans le parcours$/ : /Second slide$/,
		}),
	).toBeVisible();
	const state = await page.evaluate(() => Object.entries(localStorage));
	expect(state.some(([key]) => key.startsWith("praxity:") && key.endsWith(":default:state"))).toBe(
		true,
	);
	await page.locator("#deck-previous").click();
	await expect(
		page.locator(".deck-slide").getByRole("heading", { name: firstTitle, exact: true }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: editLabel, exact: true })).toBeVisible();
	expect(calls).toEqual([]);
	expect(
		await withProjectFileTransaction(
			process.env.PRAXITY_BROWSER_PROJECT ?? "",
			projectBytes,
			"read",
		),
	).toEqual(before);
	await page.getByRole("link", { name: editLabel, exact: true }).click();
	expect(new URL(page.url()).origin).toBe(origin);
	expect(await page.evaluate(() => localStorage.getItem("author-state-control"))).toBe(
		"author-only",
	);
});

test("script-stripped author deck keeps every slide and heading Edit button visible", async ({
	page,
}, testInfo) => {
	await page.goto(`${origin}/launch?canvas=1`);
	await expect(
		page.getByRole("status").filter({ hasText: leadership ? "Connecté" : "Connected" }),
	).toBeVisible();
	await expect(page.locator(".deck-workspace")).toBeVisible();
	for (const [index, title] of [firstTitle, secondTitle].entries()) {
		await expect(
			page.locator(".deck-slide").getByRole("heading", { name: title, exact: true }),
		).toBeVisible();
		await expect(
			page
				.getByRole("button", {
					name: `${leadership ? "Modifier le titre" : "Edit heading"} ${index === 0 ? 1 : secondHeadingPosition}${leadership ? " : " : ": "}${title}`,
					exact: true,
				})
				.first(),
		).toBeVisible();
	}
	if (!leadership)
		await expect(
			page.getByRole("button", { name: "Edit heading 2: Authored heading", exact: true }).first(),
		).toBeVisible();
	expect(await page.locator("script[src]").count()).toBe(0);
	expect(await page.locator(".praxity-deck[data-ready]").count()).toBe(0);
	await page.screenshot({ path: testInfo.outputPath("edit-deck.png"), fullPage: true });
});

test("saving the second slide refreshes the deck and retains every heading binding", async ({
	page,
}) => {
	await page.goto(`${origin}/launch?canvas=1`);
	await expect(
		page.getByRole("status").filter({ hasText: leadership ? "Connecté" : "Connected" }),
	).toBeVisible();
	const editPrefix = leadership ? "Modifier le titre" : "Edit heading";
	const edit = (title: string, n: number) =>
		page
			.getByRole("button", {
				name: `${editPrefix} ${n}${leadership ? " : " : ": "}${title}`,
				exact: true,
			})
			.first();
	const calls: unknown[] = [];
	page.on("request", (request) => {
		if (request.url().endsWith("/api/rpc") && request.postDataJSON().method === "canvasTextApply")
			calls.push(request.postDataJSON());
	});
	await edit(secondTitle, secondHeadingPosition).click();
	const savedTitle = leadership ? "Naviguer dans le parcours, modifié" : "Second slide saved";
	await page
		.getByRole("textbox", { name: leadership ? "Texte du titre" : "Heading text", exact: true })
		.fill(savedTitle);
	await page.keyboard.press("Enter");
	await expect(
		page.locator(".deck-slide").getByRole("heading", { name: savedTitle, exact: true }),
	).toBeVisible();
	await expect(edit(savedTitle, secondHeadingPosition)).toBeFocused();
	await expect(edit(firstTitle, 1)).toBeVisible();
	if (!leadership) {
		await expect(edit("Authored heading", 2)).toBeVisible();
		expect(
			await readFile(join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "lesson.prax"), "utf8"),
		).toBe(
			"---\ntitle: Deck module\n---\n\n# Opening slide\n\nFirst slide body.\n\n## Authored heading\n\nMore opening content.\n\n# Second slide saved\n\nSecond slide body.\n",
		);
	}
	expect(calls).toHaveLength(1);
});
