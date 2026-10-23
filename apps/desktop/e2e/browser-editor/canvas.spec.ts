import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import { startJourney } from "./global-setup";

let stop: (() => Promise<void>) | undefined;
let origin = "";
test.beforeAll(async ({ browser }) => {
	stop = await startJourney(browser, {
		standaloneSource:
			"---\ntitle: Canvas\n---\n\n# Canvas\n\nA **nested** word.\n\n::: accordion\n:: More\nLearner interaction.\n:::\n\n# Second page\n\nSecond page body.\n",
	});
	origin = new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin;
});
test.afterAll(async () => {
	await stop?.();
});

async function authorUrl(request: APIRequestContext) {
	const launch = await request.get(`${origin}/launch?canvas=1`, { maxRedirects: 0 });
	expect(launch.status()).toBe(303);
	const built = await request.get(new URL(launch.headers().location, origin).href, {
		maxRedirects: 0,
	});
	expect(built.status()).toBe(303);
	const documentLaunch = await request.get(new URL(built.headers().location, origin).href, {
		maxRedirects: 0,
	});
	expect(documentLaunch.status()).toBe(303);
	return new URL(documentLaunch.headers().location, origin);
}

test("canvas bundle exposes heading Edit buttons", async ({ page }) => {
	await page.goto(`${origin}/launch?canvas=1`);
	await expect(
		page.getByRole("button", { name: "Edit heading 1: Canvas", exact: true }).first(),
	).toBeVisible();
});

test("Read opens the edited page despite a bookmark on another page", async ({ page }) => {
	await page.goto(`${origin}/launch?canvas=1`);
	await page.getByRole("link", { name: "Read mode", exact: true }).click();
	await page.locator("a.praxity-nav-next").click();
	await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
	const bookmarkedPath = new URL(page.url()).pathname;
	await page.reload();
	await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
	await page.goto(`${origin}/launch?canvas=1`);
	await expect(
		page.getByRole("button", { name: "Edit heading 1: Canvas", exact: true }).first(),
	).toBeVisible();
	const read = page.getByRole("link", { name: "Read mode", exact: true });
	const editedPage = new URL((await read.getAttribute("href")) ?? "").pathname;
	expect(editedPage).not.toBe(bookmarkedPath);
	await read.click();
	await expect(page.getByText("Second page body.", { exact: true })).toHaveCount(0);
	expect(new URL(page.url()).pathname).toBe(editedPage);
	await expect(page.locator("p strong")).toHaveText("nested");
});

test("direct compiled course, admitted mode links and separate learner authority", async ({
	page,
	request,
}) => {
	const authorResponse = await page.goto(`${origin}/launch?canvas=1`);
	expect(authorResponse?.headers()["cache-control"]).toBe("no-store");
	expect(authorResponse?.headers()["referrer-policy"]).toBe("no-referrer");
	expect(authorResponse?.headers()["content-security-policy"]).toContain("script-src 'nonce-");
	await expect(page.getByRole("button", { name: "Edit text", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.getByRole("status")).toHaveText("Connected");
	expect(new URL(page.url()).hash).toBe("");
	expect(authorResponse?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
	expect(await page.locator("iframe").count()).toBe(0);
	const nested = await page.evaluate(() => {
		const element = document.querySelector("p strong");
		if (!element) throw new Error("Missing nested course element");
		const box = element.getBoundingClientRect();
		return {
			text: element.textContent,
			hit: document
				.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
				?.closest("p")
				?.contains(element),
		};
	});
	expect(nested).toEqual({ text: "nested", hit: true });
	const token = await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"));
	expect(token).toBeTruthy();
	const authorPath = new URL(page.url()).pathname;
	const skip = page.locator('a[href$="#main-content"]').first();
	await skip.focus();
	await page.keyboard.press("Enter");
	expect(new URL(page.url()).pathname).toBe(authorPath);
	expect(new URL(page.url()).origin).toBe(origin);
	expect(new URL(page.url()).hash).toBe("#main-content");
	const readUrl = await page
		.getByRole("link", { name: "Read mode", exact: true })
		.getAttribute("href");
	if (!readUrl) throw new Error("Missing learner URL");
	const plain = new URL(readUrl);
	plain.pathname = plain.pathname.slice("/canvas".length);
	const original = await (await request.get(plain.href)).text();
	const read = await (await request.get(readUrl)).text();
	expect(
		read.replace(
			/<a href="[^"]+" rel="noreferrer" style="position:relative;z-index:2147483647">Edit text<\/a>/,
			"",
		),
	).toBe(original);
	await page.getByRole("link", { name: "Read mode", exact: true }).click();
	expect(new URL(page.url()).origin).not.toBe(origin);
	const learnerOrigin = new URL(page.url()).origin;
	expect(await page.content()).not.toContain(token);
	expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBeNull();
	expect(await page.evaluate(() => Object.values(sessionStorage))).not.toContain(token);
	expect(await page.locator("script[src]").count()).toBeGreaterThan(0);
	const disclosure = page.getByRole("button", { name: "More", exact: false });
	await disclosure.click();
	await expect(disclosure).toHaveAttribute("aria-expanded", "true");
	await page.locator("a.praxity-nav-next").click();
	await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
	await page.locator("a.praxity-nav-prev").click();
	await expect(page.locator("p strong")).toHaveText("nested");
	await page.setViewportSize({ width: 600, height: 900 });
	await page.locator("[data-nav-menu-toggle]").click();
	await page.locator("#course-nav-sidebar a").filter({ hasText: "Second page" }).click();
	await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Edit text", exact: true })).toBeVisible();
	for (const path of ["/api/rpc", "/api/events", "/api/session"]) {
		const response = await request.get(`${learnerOrigin}${path}`);
		expect(response.status()).toBe(404);
		expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
	}
	for (const method of [
		"projectSave",
		"courseWriteLesson",
		"operationApply",
		"draftPut",
		"draftDelete",
		"historyApply",
	]) {
		const response = await request.post(`${learnerOrigin}/api/rpc`, { data: { method, args: {} } });
		expect(response.status()).toBe(405);
		const credentialed = await request.post(`${learnerOrigin}/api/rpc`, {
			headers: { Authorization: `Bearer ${token}` },
			data: { method, args: {} },
		});
		expect(credentialed.status()).toBe(403);
	}
	await page.getByRole("link", { name: "Edit text", exact: true }).click();
	await expect(page.getByRole("status")).toHaveText("Connected");
	await expect(page.getByText("Second page body.", { exact: true })).toBeVisible();
	expect(new URL(page.url()).origin).toBe(origin);
	for (const route of ["/api/rpc", "/api/events"]) {
		const refused = await request.get(`${origin}${route}`, {
			headers: { Origin: "null", Authorization: `Bearer ${token}` },
		});
		expect(refused.status()).toBe(403);
	}
});

test("hostile author response cannot execute or impersonate reference-owned controls", async ({
	page,
	request,
}) => {
	const calls: string[] = [];
	let projected = false;
	page.on("request", (request) => {
		if (request.url() === `${origin}/api/rpc`) calls.push(request.postDataJSON().method);
	});
	await page.addInitScript(() => {
		Object.assign(window, { violations: [] });
		window.addEventListener("securitypolicyviolation", (event) => {
			(window as unknown as { violations: string[] }).violations.push(event.effectiveDirective);
		});
	});
	await page.route(`${origin}/canvas/preview/**`, async (route) => {
		projected = true;
		const original = await route.fetch();
		const readUrl = (await original.text()).match(/<base href="([^"]+)"/)?.[1];
		if (!readUrl) throw new Error("Missing admitted learner URL");
		const response = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			`<!doctype html><html lang="en"><head>
		<script>window.courseRan=true</script><script src="attack.js"></script>
		<meta http-equiv="refresh" content="0;url=https://evil.test/">
		<meta name="referrer" content="unsafe-url">
		<style>button,a,[popover],[data-praxity-author-control] { display:none!important; opacity:0!important; color:transparent!important; pointer-events:none!important; transform:scale(0)!important }</style>
		</head><body onload="window.courseRan=true"><p data-node-id="real">A <strong>nested</strong> word.</p>
		<img name="createElement" src="data:,"><img name="body" src="data:,"><img name="addEventListener" src="data:,"><div id="addEventListener"></div>
		<noscript><p title="</noscript><meta http-equiv='refresh' content='0;url=https://evil.test/'><button popovertarget='target' data-praxity-author-control='read' data-focus-role='handle'>Invoker</button><div id='mxss-shadow'><template shadowrootmode='open'>Shadow</template></div>"></p></noscript>
		<button id="forged" data-focus-role="handle" data-node-id="real" data-praxity-author-control="read" command="show-modal" commandfor="target" popovertarget="target" interestfor="target" onclick="window.courseRan=true">Forged</button>
		<img src="https://referrer.test/pixel.png" referrerpolicy="unsafe-url">
		<div id="target" popover>Hostile popover</div><div><template shadowrootmode="closed"><button>Shadow</button></template></div>
		</body></html>`,
			readUrl,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		// Plant a missed-strip control in the real response. Browser CSP, never evaluate, must stop it.
		const body = (await response.text()).replace(
			"</body>",
			'<script>window.courseRan=true</script><img src="missing" onerror="window.courseRan=true"></body>',
		);
		await route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body });
	});
	// Route interception applies to the first URL of a redirect chain. Admit first,
	// then navigate to the captured document so the hostile response is exercised.
	const referrers: Array<string | undefined> = [];
	await page.route("https://referrer.test/**", async (route) => {
		referrers.push(route.request().headers().referer);
		await route.fulfill({ status: 200, contentType: "image/png", body: "" });
	});
	await page.goto((await authorUrl(request)).href);
	await expect(page.getByRole("status")).toHaveText("Connected");
	expect(projected).toBe(true);
	expect(new URL(page.url()).hash).toBe("");
	await expect.poll(() => referrers.length).toBe(1);
	expect(referrers).toEqual([undefined]);
	await expect(page.getByRole("link", { name: "Read mode", exact: true })).toBeVisible();
	expect(calls).toEqual(["configRead", "canvasTextSnapshot"]);
	const state = await page.evaluate(() => ({
		ran: (window as unknown as { courseRan?: boolean }).courseRan ?? false,
		violations: (window as unknown as { violations: string[] }).violations,
		shadow: document.querySelector("template")?.parentElement?.shadowRoot !== null,
		invokers: document.querySelectorAll("[command],[commandfor],[popovertarget],[interestfor]")
			.length,
	}));
	expect(state.ran).toBe(false);
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { violations: string[] }).violations))
		.toContain("script-src-elem");
	await expect
		.poll(() => page.evaluate(() => (window as unknown as { violations: string[] }).violations))
		.toContain("script-src-attr");
	expect(state.invokers).toBe(0);
	expect(state.shadow).toBe(false);
	expect(
		await page
			.locator(
				"noscript,[data-focus-role],[data-praxity-author-control],meta[name=referrer],[referrerpolicy]",
			)
			.count(),
	).toBe(0);
	expect(await page.locator("#mxss-shadow").count()).toBe(0);
	await page.locator("#forged").evaluate((element) => {
		(element as HTMLElement).style.cssText =
			"display:block!important;opacity:1!important;transform:none!important;pointer-events:auto!important";
	});
	await page.locator("#forged").click();
	await page.locator("#forged").dispatchEvent("click");
	expect(calls).toEqual(["configRead", "canvasTextSnapshot"]);
	const link = page.getByRole("link", { name: "Read mode", exact: true });
	await link.focus();
	await expect(link).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page).not.toHaveURL(new RegExp(`^${origin}/`));
});

for (const refusal of ["rpc-http", "rpc-record", "events-http", "events-record"]) {
	test(`bootstrap reports independent ${refusal} refusal`, async ({ page, request }) => {
		const url = await authorUrl(request);
		if (refusal.startsWith("rpc")) {
			await page.route(`${origin}/api/rpc`, (route) =>
				route.fulfill({
					status: refusal === "rpc-http" ? 503 : 200,
					json: { ok: refusal === "rpc-http" },
				}),
			);
		} else {
			await page.route(`${origin}/api/events`, (route) =>
				route.fulfill({
					status: refusal === "events-http" ? 503 : 200,
					contentType: "application/x-ndjson",
					body:
						refusal === "events-record"
							? '{"type":"heartbeat"}\n{"type":"ready"}\n'
							: '{"type":"ready"}\n',
				}),
			);
		}
		await page.goto(url.href);
		await expect(page.getByRole("status")).toHaveText(
			"Studio could not connect. Reopen the Studio launch link.",
		);
		expect(new URL(page.url()).hash).toBe("");
	});
}

for (const token of ["short", "x".repeat(44), "!".repeat(43)]) {
	test(`bootstrap rejects malformed token ${token.length}-${token[0]} before any RPC or event request`, async ({
		page,
		request,
	}) => {
		const url = await authorUrl(request);
		const calls: string[] = [];
		page.on("request", (request) => {
			if (request.url().startsWith(`${origin}/api/`)) calls.push(request.url());
		});
		url.hash = `session=${token}`;
		await page.goto(url.href);
		await expect(page.getByRole("status")).toHaveText(
			"Studio could not connect. Reopen the Studio launch link.",
		);
		expect(new URL(page.url()).hash).toBe("");
		expect(calls).toEqual([]);
	});
}

test("an injected fragment cannot replace the stored session", async ({ page, request }) => {
	const url = await authorUrl(request);
	await page.goto(url.href);
	await expect(page.getByRole("status")).toHaveText("Connected");
	const stored = await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"));
	let release: (() => void) | undefined;
	await page.route(`${origin}/api/rpc`, async (route) => {
		if (route.request().headers().authorization === `Bearer ${"x".repeat(43)}`)
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		await route.continue();
	});
	const authentication: number[] = [];
	page.on("response", (response) => {
		if (
			response.url() === `${origin}/api/rpc` &&
			response.request().postDataJSON().method === "configRead"
		)
			authentication.push(response.status());
	});
	url.hash = `session=${"x".repeat(43)}`;
	// A fresh navigation retains tab-scoped storage without Firefox's same-document reload race.
	await page.goto("about:blank");
	await page.goto(url.href, { waitUntil: "domcontentloaded" });
	await expect.poll(() => Boolean(release)).toBe(true);
	expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBe(stored);
	expect(new URL(page.url()).hash).toBe("");
	release?.();
	await expect(page.getByRole("status")).toHaveText("Connected");
	expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBe(stored);
	expect(authentication).toEqual([401, 200]);
	expect(new URL(page.url()).hash).toBe("");
});

test("a fresh launch fragment authenticates after a fixed-port Studio restart", async ({
	page,
	request,
	browser,
}) => {
	await page.goto((await authorUrl(request)).href);
	await expect(page.getByRole("status")).toHaveText("Connected");
	const old = await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"));
	const port = Number(new URL(origin).port);
	await stop?.();
	stop = await startJourney(browser, {
		standaloneSource: "# Restarted\n\n## New heading\n",
		port,
	});
	expect(new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin).toBe(origin);
	await page.goto((await authorUrl(request)).href);
	await expect(page.getByRole("status")).toHaveText("Connected");
	const fresh = new URLSearchParams(
		new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").hash.slice(1),
	).get("session");
	expect(fresh).not.toBe(old);
	expect(await page.evaluate(() => sessionStorage.getItem("praxity.studio.session"))).toBe(fresh);
	expect(new URL(page.url()).hash).toBe("");
	await expect(
		page.getByRole("button", { name: "Edit heading 2: New heading", exact: true }),
	).toBeVisible();
});

test("fragment cleanup precedes a throwing storage accessor", async ({ page, request }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "sessionStorage", {
			get() {
				throw new Error("Storage unavailable");
			},
		});
	});
	await page.goto((await authorUrl(request)).href);
	await expect(page.getByRole("status")).toHaveText(
		"Studio could not connect. Reopen the Studio launch link.",
	);
	expect(new URL(page.url()).hash).toBe("");
});
