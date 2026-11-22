import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { withProjectFileTransaction } from "../../src/main/project-file-transactions";
import { startJourney } from "./global-setup";

const leadership = process.env.PRAXITY_CANVAS_DECK_COURSE;
const firstTitle = leadership ? "Conversations difficiles au travail" : "Opening slide";
const secondTitle = leadership ? "Naviguer dans le parcours" : "Second slide";
const editLabel = leadership ? "Modifier le texte" : "Edit text";
let stop: (() => Promise<void>) | undefined;
let origin = "";

async function projectBytes(root: string): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
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

test("top-level learner deck is ready, navigates and keeps isolated browser state", async ({
	page,
	request,
}, testInfo) => {
	const ready = process.env.PRAXITY_BROWSER_READY_URL ?? "";
	const token = new URL(ready).hash.slice("#session=".length);
	await page.goto(`${origin}/api/identity`);
	await page.evaluate(() => localStorage.setItem("author-state-control", "author-only"));
	await page.goto(ready);
	const readUrl = page.url();
	const before = await withProjectFileTransaction(
		process.env.PRAXITY_BROWSER_PROJECT ?? "",
		projectBytes,
		"read",
	);
	const captured = new URL(readUrl);
	captured.pathname = captured.pathname.slice("/canvas".length);
	const original = await (await request.get(captured.href)).text();
	expect(await (await request.get(readUrl)).text()).toBe(original);
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
	await expect(page.getByRole("link", { name: editLabel, exact: true })).toHaveCount(0);
	await page.reload();
	await expect(deck).toHaveAttribute("data-ready", "true");
	await expect(
		page.locator(".deck-slide").getByRole("heading", {
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
	await expect(page.getByRole("link", { name: editLabel, exact: true })).toHaveCount(0);
	expect(calls).toEqual([]);
	expect(
		await withProjectFileTransaction(
			process.env.PRAXITY_BROWSER_PROJECT ?? "",
			projectBytes,
			"read",
		),
	).toEqual(before);
});
