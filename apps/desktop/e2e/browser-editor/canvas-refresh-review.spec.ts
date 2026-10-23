// Review C05 Opus probes. Each asserts the expected behaviour; red means a finding.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { JSDOM } from "jsdom";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import { readIdentityFixture } from "../../src/test-utils/identity-fixture";
import { startJourney } from "./global-setup";

const source = "# Page\n\n## Before\n\nBody.\n\n## Second\n";
let stop: (() => Promise<void>) | undefined;
let project = "";
let file = "";
let courseFixture: string | undefined;
const multi = (title: string) =>
	title.includes("cross-page") || title.includes("unrelated outside edit");
test.beforeEach(async ({ context, browserName }, info) => {
	// Establish each focus/trust fixture before Studio allocates its first IDs.
	if (multi(info.title)) {
		courseFixture = await mkdtemp(
			join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "refresh-course-"),
		);
		const section = info.title.includes("forged request") ? "heading" : "section";
		await writeFile(
			join(courseFixture, "course.yaml"),
			"title: Browser journey\nlessons: [second.prax, first.prax]\n",
		);
		await writeFile(
			join(courseFixture, "second.prax"),
			`# Alpha\n\n## Alpha ${section}\n${section === "section" ? "\nAlpha body.\n" : ""}`,
		);
		await writeFile(
			join(courseFixture, "first.prax"),
			`# Beta\n\n## Beta ${section}\n${section === "section" ? "\nBeta body.\n" : ""}`,
		);
	}
	const initialSource = info.title.includes("O2b")
		? "# Page\n\n## Before\n\n[Next](#note).\n\n## Second\n"
		: info.title.includes("duplicate fragment href")
			? "# Page\n\n## Before\n\n[First](#note) and [Second link](#note).\n\n## Second\n"
			: source;
	stop = await startJourney(
		context,
		courseFixture ? { courseFixture } : { standaloneSource: initialSource },
	);
	project = process.env.PRAXITY_BROWSER_PROJECT ?? "";
	file = join(project, "second.prax");
	if (browserName === "chromium")
		await context.grantPermissions(["local-network-access"], {
			origin: new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin,
		});
});
test.afterEach(async () => {
	await stop?.();
	if (courseFixture) await rm(courseFixture, { recursive: true, force: true });
	courseFixture = undefined;
});
const origin = () => new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
const field = (page: Page) => page.getByRole("textbox", { name: "Heading text" });
const edit = (page: Page, name = "Before") =>
	page.getByRole("button", { name: `Edit heading 2: ${name}`, exact: true });
async function open(page: Page) {
	await page.goto(`${origin()}/launch?canvas=1`);
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
async function projectWith(page: Page, transform: (html: string, url: string) => string) {
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			!["document", "fetch"].includes(route.request().resourceType()) ||
			new URL(route.request().url()).origin !== origin()
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
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			transform(html, route.request().url()),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
}
const append = (markup: string) => (html: string) => html.replace("</body>", `${markup}</body>`);

// O1: course HTML clobbers document.documentElement, where the open field's host is appended.
for (const markup of [
	'<form name="documentElement" inert></form>',
	'<form name="documentElement" hidden></form>',
	'<img name="documentElement" hidden alt="">',
])
	test(`C05-r1 O1 open field stays reachable with ${markup}`, async ({ page }) => {
		const calls = saves(page);
		await projectWith(page, append(markup));
		await open(page);
		const authorUrl = page.url();
		await page.goto("about:blank");
		await page.goto(authorUrl);
		await expect(page.getByRole("status")).toHaveText("Connected");
		await edit(page).click();
		await expect(field(page)).toBeVisible();
		await expect(field(page)).toBeFocused();
		await page.keyboard.type(" typed");
		await expect(field(page)).toHaveValue("Before typed");
		await page.keyboard.press("Escape");
		await expect(field(page)).toHaveCount(0);
		await expect(edit(page)).toBeFocused();
		expect(calls).toHaveLength(0);
		expect(await readFile(file, "utf8")).toBe(source);
	});

// O1d: the clobbered host parent can hide the field later, after the author has typed.
test("C05-r1 O1d typed text stays visible and recoverable with a delayed course hide", async ({
	page,
}) => {
	const calls = saves(page);
	await projectWith(
		page,
		append(
			'<form name="documentElement"></form><style>form[name="documentElement"]:focus-within{animation:hide 0s 2s forwards}@keyframes hide{to{display:none}}</style>',
		),
	);
	await open(page);
	const authorUrl = page.url();
	await page.goto("about:blank");
	await page.goto(authorUrl);
	await expect(page.getByRole("status")).toHaveText("Connected");
	await edit(page).click();
	await expect(field(page)).toBeFocused();
	await page.keyboard.type(" and my words");
	await page.waitForTimeout(3_000);
	const visible = await field(page).isVisible();
	expect(visible).toBe(true);
	await expect(field(page)).toHaveValue("Before and my words");
	await page.keyboard.press("Escape");
	await expect(edit(page)).toBeFocused();
	expect(calls).toHaveLength(0);
	expect(await readFile(file, "utf8")).toBe(source);
});

// O2: course HTML clobbers document.body / document.activeElement used by refresh.
for (const name of ["body", "head"])
	test(`C05-r1 O2a saved page refreshes with a form named ${name}`, async ({ page }) => {
		await projectWith(page, append(`<form name="${name}"></form>`));
		await open(page);
		const authorUrl = page.url();
		await page.goto("about:blank");
		await page.goto(authorUrl);
		await expect(page.getByRole("status")).toHaveText("Connected");
		await edit(page).click();
		await field(page).fill("After **saving**");
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("heading", { name: "After saving", exact: true }).locator("strong"),
		).toHaveText("saving");
		await writeFile(file, "# Page\n\n## After **saving**\n\nOutside body.\n\n## Second\n");
		await expect(page.getByText("Outside body.", { exact: true })).toBeVisible();
	});

for (const markup of ['<img name="activeElement" alt="">', ""])
	test(`C05-r1 O2b blur refresh keeps course-link focus with ${markup || "no clobber (control)"}`, async ({
		page,
	}) => {
		await projectWith(page, append(markup));
		await open(page);
		const id = await headingId(page, "Before");
		expect(id).toBeTruthy();
		const authorUrl = page.url();
		await page.goto("about:blank");
		await page.goto(authorUrl);
		await expect(page.getByRole("status")).toHaveText("Connected");
		await edit(page).click();
		await field(page).fill("Blur **saved**");
		await page.getByRole("link", { name: "Next", exact: true }).focus();
		await expect(page.getByRole("heading", { name: "Blur saved", exact: true })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Blur saved", exact: true }).locator("strong"),
		).toHaveText("saved");
		// Read focus through the native getter; Playwright's own check may see the clobbered name.
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")?.get?.call(
								document,
							) as Element | null
						)?.textContent,
				),
			)
			.toBe("Next");
		expect(await headingId(page, "Blur saved")).toBe(id);
	});

// O4: one failed refresh leaves its failure message after a later successful refresh.
test("C05-r1 O4 status reflects the latest refresh outcome", async ({ page }) => {
	await open(page);
	let failed = false;
	// Own-save invalidations may request another build before the outage is observed.
	let failRefresh = true;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasPreviewBuild" || !failRefresh)
			return route.continue();
		failed = true;
		await route.fulfill({ status: 500, body: "{}" });
	});
	await edit(page).click();
	await field(page).fill("After **saving**");
	await page.keyboard.press("Enter");
	await expect.poll(() => failed).toBe(true);
	await expect(page.getByRole("status")).toHaveText(
		"Studio could not refresh the saved page. Reload to try again.",
	);
	failRefresh = false;
	await writeFile(file, "# Page\n\n## After **saving**\n\nOutside body.\n\n## Second\n");
	await expect(page.getByText("Outside body.", { exact: true })).toBeVisible();
	await expect(page.getByRole("status")).not.toHaveText(
		"Studio could not refresh the saved page. Reload to try again.",
	);
});

// O5: a slow course resource holds the window load event, so the canvas stays Connecting.
// O6: focus moved to a course control without id or href survives an outside insertion.
for (const outside of [
	"# Page\n\n## Before\n\nInserted.\n\nBody.\n\n## Second\n",
	"# Page\n\n## Before\n\nBody.\n\n## Second Inserted.\n",
])
	test(`C05-r1 O6 outside edit keeps focus on an id-less course button (${outside.includes("Second Inserted") ? "no shift, control" : "insertion"})`, async ({
		page,
	}) => {
		await projectWith(page, (html) => {
			const dom = new JSDOM(html);
			try {
				const doc = dom.window.document;
				const paragraph = [...doc.querySelectorAll("p")].find((p) => p.textContent === "Body.");
				if (!paragraph) return html;
				const button = doc.createElement("button");
				button.type = "button";
				button.textContent = "Course control";
				paragraph.after(button);
				return dom.serialize();
			} finally {
				dom.window.close();
			}
		});
		await open(page);
		const authorUrl = page.url();
		await page.goto("about:blank");
		await page.goto(authorUrl);
		await expect(page.getByRole("status")).toHaveText("Connected");
		await page.getByRole("button", { name: "Course control", exact: true }).focus();
		await writeFile(file, outside);
		await expect(page.getByText(/Inserted\./u)).toBeVisible();
		await expect(page.getByRole("button", { name: "Course control", exact: true })).toBeFocused();
	});

test("C05-r1 duplicate fragment href preserves the actual moved focus", async ({ page }) => {
	const source = "# Page\n\n## Before\n\n[First](#note) and [Second link](#note).\n\n## Second\n";
	await open(page);
	const id = await headingId(page, "Before");
	expect(id).toBeTruthy();
	await edit(page).click();
	await field(page).fill("Saved **heading**");
	await page.getByRole("link", { name: "Second link", exact: true }).focus();
	await expect(page.getByRole("heading", { name: "Saved heading", exact: true })).toBeVisible();
	console.log(
		"focus after refresh",
		await page.evaluate(() => ({
			tag: document.activeElement?.tagName,
			text: document.activeElement?.textContent?.slice(0, 120),
		})),
	);
	expect(await readFile(file, "utf8")).toBe(source.replace("## Before", "## Saved **heading**"));
	await expect(page.getByRole("link", { name: "Second link", exact: true })).toBeFocused();
	expect(await headingId(page, "Saved heading")).toBe(id);
});
test("C05-r1 outside page title change then Escape reads current disk", async ({ page }) => {
	await open(page);
	await edit(page).click();
	await field(page).fill("Unsaved");
	await writeFile(file, source.replace("# Page", "# Outside page title"));
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("heading", { name: "Outside page title", exact: true }),
	).toBeVisible();
	await expect(edit(page)).toBeFocused();
});
test("C05-r1 startup invalidation during held initial snapshot is retained", async ({ page }) => {
	await page.addInitScript(() => {
		const parse = JSON.parse;
		(window as any).reviewEvents = 0;
		JSON.parse = (...args: Parameters<typeof JSON.parse>) => {
			const value = parse(...args);
			if (value?.type === "editorChanged") (window as any).reviewEvents++;
			return value;
		};
	});
	let release: (() => void) | undefined;
	let first = true;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasTextSnapshot" || !first)
			return route.continue();
		first = false;
		const response = await route.fetch();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.fulfill({ response });
	});
	await page.goto(`${new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin}/launch?canvas=1`);
	await expect.poll(() => Boolean(release)).toBe(true);
	await writeFile(file, source.replace("## Before", "## Changed during startup"));
	await expect.poll(() => page.evaluate(() => (window as any).reviewEvents)).toBeGreaterThan(0);
	release?.();
	await expect(page.getByRole("status")).toHaveText("Connected");
	await expect(
		page.getByRole("heading", { name: "Changed during startup", exact: true }),
	).toBeVisible();
});

test("C05-r1 a pending course image cannot block editor startup", async ({
	page,
	context,
	browserName,
}) => {
	const origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
	if (browserName === "chromium")
		await context.grantPermissions(["local-network-access"], { origin });
	await open(page);
	const authorUrl = page.url();
	const { serveStudioAuthorDocument } = await import("../../src/main/studio/author-document");
	let release: (() => void) | undefined;
	await page.route("https://example.test/slow.png", async (route) => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		await route.fulfill({ status: 404, body: "" });
	});
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			route.request().resourceType() !== "document" ||
			new URL(route.request().url()).origin !== origin
		)
			return route.continue();
		const response = await route.fetch();
		const html = await response.text();
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw Error("No base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			html.replace(
				"</body>",
				'<img src="https://example.test/slow.png" alt="Pending course illustration"></body>',
			),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
	await page.goto("about:blank");
	await page.goto(authorUrl, { waitUntil: "domcontentloaded" });
	await expect.poll(() => Boolean(release)).toBe(true);
	try {
		await expect(page.getByRole("status")).toHaveText("Connected");
	} finally {
		release?.();
		await expect(page.getByRole("status")).toHaveText("Connected");
	}
	await expect.poll(() => page.evaluate(() => document.readyState)).toBe("complete");
});

test("C05-r1 unchanged an unrelated outside edit keeps this page's nodes and focus untouched", async ({
	page,
}) => {
	await page.goto(`${origin()}/launch?canvas=1`);
	await expect(page.getByRole("status")).toHaveText("Connected");
	await expect(page.getByText("Alpha body.", { exact: true })).toBeVisible();
	const held = await page.getByText("Alpha body.", { exact: true }).elementHandle();
	const id = await headingId(page, "Alpha section");
	expect(id).toBeTruthy();
	const button = page.getByRole("button", { name: "Edit heading 2: Alpha section", exact: true });
	await button.focus();
	await page.evaluate(() => {
		const counter = window as unknown as { focusEvents: number };
		counter.focusEvents = 0;
		document.addEventListener("focusin", () => counter.focusEvents++, true);
	});
	let builds = 0;
	page.on("request", (request) => {
		if (
			request.url().endsWith("/api/rpc") &&
			request.postDataJSON().method === "canvasPreviewBuild"
		)
			builds++;
	});
	await writeFile(
		join(project, "first.prax"),
		"# Beta\n\n## Beta section\n\nBeta changed by an agent.\n",
	);
	await page.waitForTimeout(5_000);
	const focusEvents = await page.evaluate(
		() => (window as unknown as { focusEvents: number }).focusEvents,
	);
	const connected = await held?.evaluate((element) => element.isConnected);
	console.log(
		`C05-r1 unchanged builds ${builds}; held paragraph connected ${connected}; focusin events ${focusEvents}`,
	);
	await expect(button).toBeFocused();
	expect(connected).toBe(true);
	expect(focusEvents).toBe(0);
	expect(await headingId(page, "Alpha section")).toBe(id);
});

test("C05-r1 Enter keeps the owning button through compiled refresh", async ({ page }) => {
	await open(page);
	const held = await edit(page).elementHandle();
	await edit(page).click();
	await field(page).fill("After **saving**");
	await held?.evaluate((button) => {
		const w = window as unknown as { focusEvents: number };
		w.focusEvents = 0;
		// Field and button now share a shadow root; document focus events are retargeted.
		button.addEventListener("focus", () => w.focusEvents++);
	});
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("heading", { name: "After saving", exact: true }).locator("strong"),
	).toHaveText("saving");
	expect(await held?.evaluate((el) => el.isConnected)).toBe(true);
	expect(
		await page.evaluate(() => (window as unknown as { focusEvents: number }).focusEvents),
	).toBe(1);
});

test("C05-r1 cross-page a forged wrapper on Beta cannot write Alpha's title", async ({ page }) => {
	let forgedId = "";
	let betaSlug = "";
	await projectWith(page, (html, url) =>
		forgedId && betaSlug && new URL(url).pathname.endsWith(`/${betaSlug}`)
			? append(`<div class="praxity-block" data-node-id="${forgedId}"><h1>Forged</h1></div>`)(html)
			: html,
	);
	await open(page);
	forgedId = await page
		.locator("h1")
		.first()
		.evaluate((heading) => heading.closest("[data-node-id]")?.getAttribute("data-node-id") ?? "");
	const identity = await readIdentityFixture(project);
	betaSlug =
		(await page.evaluate(() =>
			([...Document.prototype.querySelectorAll.call(document, "a[href]")] as HTMLAnchorElement[])
				.find((link) => /beta/i.test(link.textContent ?? "") && link.href.endsWith(".html"))
				?.href.split("/")
				.pop(),
		)) ?? "";
	await page.goto(new URL(betaSlug, page.url()).href);
	await expect(page.getByRole("heading", { name: "Forged", exact: true })).toBeVisible();
	await expect(page.getByRole("status")).toHaveText("Connected");
	const calls = saves(page);
	await expect(edit(page, "Forged")).toHaveCount(0);
	expect(calls).toHaveLength(0);
	expect(await readFile(join(project, "second.prax"), "utf8")).toBe(
		"# Alpha\n\n## Alpha section\n\nAlpha body.\n",
	);
	expect(await readIdentityFixture(project)).toEqual(identity);
});

test("C05-r1 cross-page forged request cannot write another lesson", async ({ page }) => {
	let alpha:
		| { file: string; nodeId: string; baseRevision: string; text: string; field: string }
		| undefined;
	page.on("response", async (response) => {
		if (response.request().postData()?.includes('"canvasTextSnapshot"')) {
			const reply = await response.json();
			alpha ??= reply.result.fields.find(
				(field: { text: string }) => field.text === "Alpha heading",
			);
		}
	});
	await open(page);
	await expect.poll(() => Boolean(alpha)).toBe(true);
	const identity = await readIdentityFixture(project);
	const beta = await page
		.locator("a[href]")
		.evaluateAll((links) =>
			(links as HTMLAnchorElement[])
				.find((link) => /Beta/.test(link.textContent ?? "") && link.href.endsWith(".html"))
				?.getAttribute("href"),
		);
	if (!beta) throw new Error("Missing Beta link");
	await page.goto(new URL(beta, page.url()).href);
	await expect(edit(page, "Beta heading")).toBeVisible();
	let forged = false;
	await page.route("**/api/rpc", async (route) => {
		const body = route.request().postDataJSON();
		if (body.method !== "canvasTextApply" || !alpha) return route.continue();
		forged = true;
		await route.continue({
			postData: JSON.stringify({
				...body,
				args: {
					...body.args,
					file: alpha.file,
					nodeId: alpha.nodeId,
					baseRevision: alpha.baseRevision,
					expectedText: alpha.text,
					field: alpha.field,
					text: "Forbidden from Beta",
				},
			}),
		});
	});
	await edit(page, "Beta heading").click();
	await field(page).fill("Kept on Beta");
	await page.keyboard.press("Enter");
	await expect(page.locator("#error:visible")).toContainText("refused");
	await expect(field(page)).toHaveValue("Kept on Beta");
	expect(forged).toBe(true);
	expect(await readFile(join(project, "second.prax"), "utf8")).toBe(
		"# Alpha\n\n## Alpha heading\n",
	);
	expect(await readFile(join(project, "first.prax"), "utf8")).toBe("# Beta\n\n## Beta heading\n");
	expect(await readIdentityFixture(project)).toEqual(identity);
});

test("C05-r1 a repaired mapping clears its stale refusal", async ({ page }) => {
	await open(page);
	const id = await page
		.getByRole("heading", { name: "Before", exact: true })
		.evaluate((heading) => heading.closest("[data-node-id]")?.getAttribute("data-node-id"));
	if (!id) throw new Error("Missing heading binding");
	let duplicate = true;
	await projectWith(page, (html) =>
		duplicate
			? append(`<div class="praxity-block" data-node-id="${id}"><h2>Forged</h2></div>`)(html)
			: html,
	);
	await page.reload();
	await expect(page.getByRole("heading", { name: "Forged", exact: true })).toBeVisible();
	await expect(page.getByRole("status")).toHaveText(
		"Some text could not be matched to the saved page.",
	);
	duplicate = false;
	await writeFile(file, source.replace("Body.", "Mapping repaired."));
	await expect(page.getByText("Mapping repaired.", { exact: true })).toBeVisible();
	await expect(edit(page)).toBeVisible();
	await expect(page.getByRole("status")).toHaveText("Connected");
});

test("C05-r1 fragment navigation then reload retains the authenticated session and completes load", async ({
	page,
}) => {
	await open(page);
	const stored = await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"));
	const url = new URL(page.url());
	url.hash = `session=${"x".repeat(43)}`;
	await page.goto(url.href);
	await page.reload({ waitUntil: "commit" });
	await expect(page.getByRole("status")).toHaveText("Connected");
	expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBe(stored);
	expect(new URL(page.url()).hash).toBe("");
	await expect.poll(() => page.evaluate(() => document.readyState)).toBe("complete");
});
