import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { persistFixtureIdentity } from "../../src/test-utils/identity-fixture";
import { startJourney } from "./global-setup";

const a = "# First page\n\n## Original heading\n\nBody.\n";
const b = "# Other lesson\n\n## Held heading\n\nHeld body.\n";
const origin = () => new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
const project = () => process.env.PRAXITY_BROWSER_PROJECT ?? "";
const field = (page: Page) => page.getByRole("textbox", { name: "Heading text", exact: true });
const edit = (page: Page, heading: string) =>
	page.getByRole("button", { name: `Edit heading 2: ${heading}`, exact: true });
async function open(page: Page) {
	await page.goto(`${origin()}/launch?canvas=1`);
	await expect(page.getByRole("status")).toHaveText("Connected");
}
async function submit(page: Page) {
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/rpc") &&
			response.request().method() === "POST" &&
			response.request().postDataJSON().method === "canvasTextApply",
	);
	await field(page).press("Enter");
	return (await (await saved).json()).result as {
		ok: boolean;
		code?: string;
		correspondence?: { runtimeId: string; durableId: string }[];
	};
}
async function nodeId(page: Page, text: string) {
	return page
		.getByRole("heading", { name: text, exact: true })
		.evaluate((el) => el.closest("[data-node-id]")?.getAttribute("data-node-id"));
}

for (const scenario of [
	"uninitialized",
	"established",
	"body changed",
	"deleted",
	"both fields held",
	"reverse save order",
] as const) {
	test(`C05f first durable write: ${scenario}`, async ({ page, context }) => {
		const fixture = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "first-write-"),
		);
		await writeFile(
			join(fixture, "course.yaml"),
			"title: Browser journey\nlessons: [second.prax, first.prax]\n",
		);
		await writeFile(join(fixture, "second.prax"), "# First page\n\nBody.\n");
		await writeFile(join(fixture, "first.prax"), "# Other lesson\n\nHeld body.\n");
		const stop = await startJourney(context, { courseFixture: fixture });
		try {
			// Newly inserted headings have runtime IDs without retiring the saved page or body IDs.
			await writeFile(join(project(), "second.prax"), a);
			await writeFile(join(project(), "first.prax"), b);
			if (scenario === "established") await persistFixtureIdentity(project());
			await open(page);
			const other = await context.newPage();
			await other.goto(`${origin()}/launch?canvas=read`);
			await other.goto(new URL("other-lesson.html", other.url()).href);
			await other.getByRole("link", { name: "Edit text", exact: true }).click();
			await expect(other.getByRole("status")).toHaveText("Connected");
			const originalA = await nodeId(page, "Original heading");
			const originalB = await nodeId(other, "Held heading");
			expect(originalA).toBeTruthy();
			expect(originalB).toBeTruthy();
			if (scenario === "both fields held" || scenario === "reverse save order") {
				await edit(page, "Original heading").click();
				await field(page).fill("Saved 0");
			}
			await edit(other, "Held heading").click();
			await field(other).fill("Held exact *text*");
			const old = other.url();
			if (scenario !== "both fields held" && scenario !== "reverse save order") {
				await edit(page, "Original heading").click();
				await field(page).fill("Saved 0");
			}
			const reverse = scenario === "reverse save order";
			const first = await submit(reverse ? other : page);
			expect(first).toMatchObject({ ok: true });
			expect(await readFile(join(project(), reverse ? "first.prax" : "second.prax"), "utf8")).toBe(
				reverse
					? "# Other lesson\n\n## Held exact *text*\n\nHeld body.\n"
					: "# First page\n\n## Saved 0\n\nBody.\n",
			);
			const firstPage = reverse ? other : page;
			await expect(
				firstPage.getByRole("heading", {
					name: reverse ? "Held exact text" : "Saved 0",
					exact: true,
				}),
			).toBeVisible();
			const promoted = (id: string | null | undefined) =>
				first.correspondence?.find((pair) => pair.runtimeId === id)?.durableId ?? id;
			expect(await nodeId(firstPage, reverse ? "Held exact text" : "Saved 0")).toBe(
				promoted(reverse ? originalB : originalA),
			);
			expect((await other.request.get(old, { maxRedirects: 0 })).status()).toBe(200);
			if (scenario === "body changed")
				await writeFile(
					join(project(), "first.prax"),
					"# Other lesson\n\n## Held heading\n\nOutside body.\n",
				);
			if (scenario === "deleted")
				await writeFile(join(project(), "first.prax"), "# Other lesson\n\nHeld body.\n");
			const last = reverse ? page : other;
			const result = await submit(last);
			if (scenario === "body changed" || scenario === "deleted") {
				expect(result).toMatchObject({
					ok: false,
					code: scenario === "deleted" ? "orphaned" : "stale",
				});
				await expect(field(other)).toHaveValue("Held exact *text*");
				await expect(other.locator("#error:visible")).toHaveText(
					"The file changed. Your text is kept. Copy it, then reload.",
				);
				expect(await readFile(join(project(), "first.prax"), "utf8")).toBe(
					scenario === "deleted"
						? "# Other lesson\n\nHeld body.\n"
						: "# Other lesson\n\n## Held heading\n\nOutside body.\n",
				);
			} else {
				expect(result).toMatchObject({ ok: true });
				const text = reverse ? "Saved 0" : "Held exact text";
				await expect(last.getByRole("heading", { name: text, exact: true })).toBeVisible();
				expect(await nodeId(last, text)).toBe(promoted(reverse ? originalA : originalB));
				expect(await readFile(join(project(), "first.prax"), "utf8")).toBe(
					"# Other lesson\n\n## Held exact *text*\n\nHeld body.\n",
				);
			}
			expect(await readFile(join(project(), "second.prax"), "utf8")).toBe(
				"# First page\n\n## Saved 0\n\nBody.\n",
			);
		} finally {
			await stop();
			await rm(fixture, { recursive: true });
		}
	});
}
