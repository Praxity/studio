import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { writeRetrievalSheetHarness } from "./fixtures/retrieval-sheet-harness";

let directory: string, url: string;
let server: ReturnType<typeof createServer>;
let page: Page, context: BrowserContext;
test.beforeAll(async ({ browser }) => {
	directory = await mkdtemp(join(tmpdir(), "retrieval-print-"));
	await writeRetrievalSheetHarness(directory, true, true);
	// Two real rendered instances. Re-key IDs before enhancement, never clone live controls.
	for (const lang of ["en", "fr"]) {
		for (const rows of [1, 3, 8, "8-short"]) {
			const file = join(directory, `${lang}-light-${rows}.html`);
			const html = await readFile(file, "utf8");
			const start = html.indexOf('<div class="praxity-block" data-block-type="retrievalSheet"');
			const end = html.indexOf("</p></div></div>", start) + "</p></div></div>".length;
			if (start < 0 || end < start) throw new Error("Missing rendered sheet fixture");
			const second = html
				.slice(start, end)
				.replaceAll("sheet-retrieval", "other-retrieval")
				.replace('data-block-id="sheet"', 'data-block-id="other"');
			await writeFile(file, html.slice(0, end) + second + html.slice(end));
		}
	}
	server = createServer(async (request, response) => {
		const file = resolve(directory, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			response.writeHead(403).end();
			return;
		}
		try {
			response.setHeader(
				"Content-Type",
				file.endsWith(".js")
					? "text/javascript"
					: file.endsWith(".css")
						? "text/css"
						: "text/html; charset=utf-8",
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	context = await browser.newContext();
	page = await context.newPage();
	await page.clock.setFixedTime(new Date("2026-10-17T12:00:00"));
	await page.addInitScript(() => {
		window.print = () => {};
	});
});
test.afterAll(async () => {
	await context?.close();
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true, force: true });
});
const first = () => page.locator('[data-block-id="sheet"] > [data-retrieval-sheet]');
const second = () => page.locator('[data-block-id="other"] > [data-retrieval-sheet]');
async function open(lang = "en", rows: number | string = 3) {
	await page.emulateMedia({ media: "screen" });
	await page.goto(`${url}/${lang}-light-${rows}.html`);
	await expect(page.locator("[data-retrieval-enhanced]")).toHaveCount(2);
}
async function enterPrint() {
	// Observe entry before exit so Firefox cannot coalesce both emulated changes.
	const entry = await page.evaluateHandle(() => ({
		ready: new Promise<boolean>((done) => {
			matchMedia("print").addEventListener("change", (event) => done(event.matches), {
				once: true,
			});
		}),
	}));
	await page.emulateMedia({ media: "print" });
	expect(await entry.evaluate(({ ready }) => ready)).toBe(true);
	await entry.dispose();
}
async function request() {
	// Hidden containers cannot receive a pointer click. Exercise the same real handler.
	await first()
		.locator(":scope > .praxity-button")
		.evaluate((button: HTMLButtonElement) => button.click());
	await expect(page.locator("html")).toHaveAttribute("data-praxity-retrieval-print", "sheet");
	await enterPrint();
}
async function endPrint() {
	await page.emulateMedia({ media: "screen" });
	await expect(
		page.locator(
			"[data-praxity-retrieval-print], [data-praxity-print-selected], [data-praxity-print-path]",
		),
	).toHaveCount(0);
}
async function screenMarkup() {
	return page.locator("#placement").evaluate((host) => {
		const copy = host.cloneNode(true) as HTMLElement;
		// The contract requires one printing announcement. All other screen DOM stays exact.
		for (const status of copy.querySelectorAll('[role="status"]')) status.textContent = "";
		return copy.outerHTML;
	});
}

for (const placement of [
	"top",
	"accordion",
	"tabs",
	"sequence",
	"columns",
	"front",
	"back",
	"deck",
	"details",
	"clipped",
] as const) {
	test(`scoped print fully exposes ${placement} while retaining its screen state`, async ({
		browserName,
	}) => {
		await open();
		await first().getByRole("tab", { name: "Back", exact: true }).click();
		const original = await first().getAttribute("data-retrieval-enhanced");
		const date = await first().locator("[data-retrieval-date-line]").textContent();
		await first().evaluate((root, placement) => {
			const wrapper = root.parentElement!;
			const host = document.createElement(placement === "details" ? "details" : "div");
			host.id = "placement";
			host.className =
				{
					top: "",
					details: "",
					clipped: "",
					accordion: "praxity-accordion-panel",
					tabs: "praxity-tab-panel",
					sequence: "praxity-sequence-scroll-viewport",
					columns: "praxity-columns",
					front: "praxity-flashcard-face",
					back: "praxity-flashcard-face praxity-flashcard-face--back",
					deck: "deck-slide",
				}[placement] ?? "";
			if (["accordion", "tabs", "sequence", "deck"].includes(placement)) host.hidden = true;
			if (["front", "back", "clipped", "deck"].includes(placement))
				host.style.cssText =
					"height:1px;max-height:1px;overflow:hidden;position:absolute;transform:rotateY(180deg);clip-path:inset(100%);visibility:hidden;opacity:0;contain:strict;content-visibility:hidden";
			if (placement === "columns")
				host.style.cssText = "display:grid;grid-template-columns:1fr 1fr;width:30px";
			wrapper.before(host);
			host.append(wrapper);
			if (placement === "deck") {
				host.dataset.deckSlide = "inactive-slide";
				const deck = document.createElement("div");
				deck.className = "praxity-deck";
				deck.dataset.ready = "true";
				deck.dataset.panel = "outline";
				host.before(deck);
				deck.append(host);
			}
		}, placement);
		const screen = await screenMarkup();
		const nativePanelVisibility = () =>
			first()
				.locator("[data-retrieval-side]")
				.evaluateAll((panels) =>
					panels.map((panel) =>
						panel.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
					),
				);
		// Gecko still hits MAIN under print media after observed media entry, scrolling
		// and a frame. Its native visibility and box checks below remain required.
		const probePrintPaint = placement === "details" && browserName !== "firefox";
		if (placement === "details") expect(await nativePanelVisibility()).toEqual([false, false]);
		await request();
		// Playwright's WebKit :visible fallback rejects closed details even when
		// print CSS exposes ::details-content. Use the browser's visibility check.
		await expect
			.poll(() =>
				first()
					.locator("[data-retrieval-side]")
					.evaluateAll(
						(sides) =>
							sides.filter((side) => {
								const box = side.getBoundingClientRect();
								return (
									side.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
									box.width > 0 &&
									box.height > 0
								);
							}).length,
					),
			)
			.toBe(2);
		if (probePrintPaint) {
			// Also prove the exposed text is painted and receives hits inside the viewport.
			const paint = await first()
				.locator("[data-retrieval-side]")
				.evaluateAll(async (panels) => {
					const results = [];
					for (const panel of panels) {
						const text = panel.querySelector("li p")!;
						text.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
						await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
						const box = text.getBoundingClientRect();
						const x = box.x + box.width / 2;
						const y = box.y + box.height / 2;
						const hit = text.ownerDocument.elementFromPoint(x, y);
						results.push({
							side: panel.getAttribute("data-retrieval-side"),
							painted: box.width > 0 && box.height > 0 && (hit === text || text.contains(hit)),
							point: { x, y },
							viewport: { width: innerWidth, height: innerHeight },
							hit: hit?.tagName ?? null,
						});
					}
					return results;
				});
			await test.info().attach("closed-details-paint-probe", {
				body: JSON.stringify(paint),
				contentType: "application/json",
			});
			expect(paint.map(({ side, painted }) => ({ side, painted }))).toEqual([
				{ side: "front", painted: true },
				{ side: "back", painted: true },
			]);
			await test.info().attach("closed-details-print", {
				body: await page.screenshot({ fullPage: true, caret: "initial" }),
				contentType: "image/png",
			});
		}
		if (placement === "details")
			await expect(page.locator("#placement")).not.toHaveAttribute("open");
		await expect(second()).toBeHidden();
		await expect(page.getByRole("heading", { name: "Course complete", exact: true })).toBeHidden();
		expect(
			await first()
				.locator("[data-retrieval-side=back]")
				.evaluate((node) => ({
					top: node.getBoundingClientRect().top,
					height: node.getBoundingClientRect().height,
					overflow: getComputedStyle(node).overflow,
					breakBefore: getComputedStyle(node).breakBefore,
				})),
		).toMatchObject({ overflow: "visible", breakBefore: "page" });
		const box = await first().boundingBox();
		expect(box!.width).toBeGreaterThan(500);
		expect(box!.height).toBeGreaterThan(0);
		await endPrint();
		expect(await screenMarkup()).toBe(screen);
		expect(await first().getAttribute("data-retrieval-enhanced")).toBe(original);
		await expect(first().locator("[data-retrieval-date-line]")).toHaveText(date!);
		await expect(first().locator('[role=tab][aria-selected="true"]')).toHaveText("Back");
	});
}

test("prints through nested columns, an inactive deck slide and a collapsed accordion", async () => {
	await open();
	await first().evaluate((root) => {
		const wrapper = root.parentElement!;
		const columns = document.createElement("div");
		columns.id = "placement";
		columns.className = "praxity-columns";
		columns.style.cssText = "display:grid;grid-template-columns:1fr 1fr;width:80px";
		const deck = document.createElement("div");
		deck.className = "praxity-deck";
		deck.dataset.ready = "true";
		const slide = document.createElement("div");
		slide.className = "deck-slide";
		slide.dataset.deckSlide = "inactive-slide";
		slide.hidden = true;
		const panel = document.createElement("div");
		panel.className = "praxity-accordion-panel";
		panel.hidden = true;
		panel.style.cssText = "height:1px;overflow:hidden";
		wrapper.before(columns);
		columns.append(deck);
		deck.append(slide);
		slide.append(panel);
		panel.append(wrapper);
		for (const parent of [columns, slide, panel]) {
			const sibling = document.createElement("p");
			sibling.dataset.printSibling = "";
			sibling.textContent = "Other container content";
			parent.append(sibling);
		}
	});
	const before = await screenMarkup();
	await request();
	await expect(first().locator("[data-retrieval-side]:visible")).toHaveCount(2);
	await expect(page.locator("[data-print-sibling]:visible")).toHaveCount(0);
	await expect(second()).toBeHidden();
	expect((await first().boundingBox())!.width).toBeGreaterThan(500);
	await endPrint();
	expect(await screenMarkup()).toBe(before);
});

test("next key after an ignored print restores ordinary whole-course printing", async () => {
	await open();
	await first().locator(".praxity-button").click();
	await page.keyboard.press("Escape");
	await expect(page.locator("[data-praxity-print-path]")).toHaveCount(0);
	await enterPrint();
	await expect(page.locator("[data-retrieval-side]:visible")).toHaveCount(4);
	await expect(page.getByRole("heading", { name: "Course complete", exact: true })).toBeVisible();
});

test("a second Print click works after print returned without a dialog", async () => {
	await open();
	await page.evaluate(() => {
		let calls = 0;
		window.print = () => {
			document.body.dataset.printCalls = String(++calls);
		};
	});
	const button = first().locator(".praxity-button");
	await button.click();
	await button.click();
	await expect(page.locator("body")).toHaveAttribute("data-print-calls", "2");
	await expect(first().getByRole("status")).toHaveText("Print dialog opened.");
	await page.keyboard.press("Escape");
	await expect(page.locator("[data-praxity-print-selected]")).toHaveCount(0);
});

test("nested instances select only themselves in either direction, then ordinary print shows both", async () => {
	await open();
	await first().evaluate((root) => root.append(document.querySelector('[data-block-id="other"]')!));
	await second().locator(".praxity-button").click();
	await enterPrint();
	await expect(second().locator("[data-retrieval-side]:visible")).toHaveCount(2);
	await expect(first().locator(":scope > h1")).toBeHidden();
	await endPrint();
	await request();
	await expect(second()).toBeHidden();
	await expect(first().locator("[data-retrieval-side]:visible")).toHaveCount(2);
	await endPrint();
	await enterPrint();
	await expect(page.locator("[data-retrieval-side]:visible")).toHaveCount(4);
	await expect(page.getByRole("heading", { name: "Course complete", exact: true })).toBeVisible();
});

test("print-displaced focus returns, later focus stays, repeated requests recover", async () => {
	await open();
	const button = first().locator(".praxity-button");
	await first().getByRole("tabpanel", { name: "Front", exact: true }).focus();
	await page.keyboard.press("Tab");
	await expect(button).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.locator("html")).toHaveAttribute("data-praxity-retrieval-print", "sheet");
	await button.evaluate((node: HTMLButtonElement) => node.blur());
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await expect(button).toBeFocused();
	await button.click();
	const other = second().getByRole("tab", { name: "Front", exact: true });
	await other.focus();
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await expect(other).toBeFocused();
	await expect(page.locator("[data-praxity-print-path]")).toHaveCount(0);
});

test("pointer printing preserves the focus held when the request starts", async () => {
	await open();
	const other = second().getByRole("tab", { name: "Front", exact: true });
	await other.focus();
	const button = first().locator(".praxity-button");
	// Exercise Safari's non-focusing pointer activation on every engine.
	await button.evaluate((node) => {
		node.addEventListener("mousedown", (event) => event.preventDefault(), { once: true });
	});
	await expect(other).toBeFocused();
	await button.click();
	await expect(page.locator("html")).toHaveAttribute("data-praxity-retrieval-print", "sheet");
	await expect(other).toBeFocused();
	await expect(button).not.toBeFocused();
	await other.evaluate((node: HTMLButtonElement) => node.blur());
	await expect(other).not.toBeFocused();
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await expect(other).toBeFocused();
	await expect(page.locator("[data-praxity-print-path]")).toHaveCount(0);
});

for (const lang of ["en", "fr"] as const)
	for (const rows of [1, 3, 8, "8-short"])
		for (const format of ["A4", "Letter"] as const) {
			test(`${lang} ${rows} rows ${format} print flow`, async ({ browserName }) => {
				test.skip(browserName !== "chromium", "Paper pagination uses Chromium's PDF printer.");
				await open(lang, rows);
				await request();
				await expect(first().locator("[data-retrieval-question]:visible")).toHaveCount(
					(typeof rows === "number" ? rows : 8) * 2,
				);
				const boxes = await first().evaluate((root) =>
					[root, ...root.querySelectorAll<HTMLElement>("[data-retrieval-side]")].map((node) => ({
						overflow: getComputedStyle(node).overflow,
						height: node.clientHeight,
						scrollHeight: node.scrollHeight,
						width: node.clientWidth,
						scrollWidth: node.scrollWidth,
					})),
				);
				for (const box of boxes) {
					expect(box.overflow).toBe("visible");
					expect(box.height).toBeGreaterThan(0);
					expect(box.scrollHeight).toBeLessThanOrEqual(box.height + 1);
					expect(box.scrollWidth).toBeLessThanOrEqual(box.width + 1);
				}
				const spaces = await first()
					.locator(".praxity-retrieval-sheet-space")
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							height: node.getBoundingClientRect().height,
							rule: getComputedStyle(node).borderBottomWidth,
						})),
					);
				for (const space of spaces) {
					expect(space.height).toBeGreaterThanOrEqual((16 * 96) / 25.4);
					expect(space.height).toBeLessThanOrEqual((18 * 96) / 25.4);
					expect(space.rule).toBe("1px");
				}
				if (rows === 8) {
					const last = first().locator("[data-retrieval-side=back] li").last();
					await expect(last).toContainText("END-8");
					expect((await last.boundingBox())!.height).toBeGreaterThan(0);
				}
				expect(
					await first()
						.locator("li")
						.first()
						.evaluate((row) => getComputedStyle(row).display),
				).toBe("list-item");
				expect(
					await first()
						.locator("[data-retrieval-side=back]")
						.evaluate((node) => getComputedStyle(node).breakInside),
				).toBe("auto");
				// Paper dimensions and page counts run in CI, independent of optional captures.
				const pdf = await page.pdf({
					format,
					printBackground: true,
					margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
				});
				const source = pdf.toString("latin1");
				const captures = process.env.PRAXITY_RETRIEVAL_PRINT_CAPTURES;
				if (captures) {
					await mkdir(captures, { recursive: true });
					await writeFile(join(captures, `${lang}-${rows}-${format}.pdf`), pdf);
				}
				const pages = source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
				if (rows === 8) expect(pages).toBeGreaterThan(2);
				else expect(pages).toBe(2);
				const paper = source.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
				// PDF paper sizes in points; allow Chromium's device-pixel rounding.
				expect(Math.abs(Number(paper?.[1]) - (format === "A4" ? 595.28 : 612))).toBeLessThan(1.5);
				expect(Math.abs(Number(paper?.[2]) - (format === "A4" ? 841.89 : 792))).toBeLessThan(1.5);
				await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			});
		}

test("ordinary print keeps two complete sheets and the course", async () => {
	await open();
	await enterPrint();
	await expect(page.locator("[data-retrieval-side]:visible")).toHaveCount(4);
	await expect(page.getByRole("heading", { name: "Course complete", exact: true })).toBeVisible();
	const captures = process.env.PRAXITY_RETRIEVAL_PRINT_CAPTURES;
	if (captures)
		await page.pdf({
			path: join(captures, "ordinary-two-sheets-A4.pdf"),
			format: "A4",
			printBackground: true,
		});
});
