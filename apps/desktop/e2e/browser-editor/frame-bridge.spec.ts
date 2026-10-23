import { readFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
	connectPageFrame,
	FrameEventBody,
	FrameView,
	mountPageLens,
} from "@praxity/editor-core/frame-bridge";
import { createSession } from "@praxity/editor-core/session";
import { readLesson } from "@praxity/grammar";
import { build } from "esbuild";
import { createTranslator } from "use-intl/core";
import { buildFrameView } from "../../../../packages/editor-core/src/frame-bridge/view";
import { renderBlockHtml } from "../../../../packages/export-pipeline/src/render-block-html";
import { sanitizeHtml } from "../../../../packages/shared-blocks/src/sanitize";
import { rawCss } from "../raw-css";
import { forgeLearnerDocumentMessages, installHostileMarkup } from "./fixtures/hostile-course";

const source = `# Working together

Good feedback describes what happened and what could change.

::: tabs
:: Listen first

Ask a question before offering advice.

:: Be specific

Describe the action you observed.
:::

::: accordion
:: Try this

Write one observation and one question.
:::

::: columns
::

Focus on the work.

::

Agree on a next step.
:::
`;
let server: ReturnType<typeof createServer>;
let courseServer: ReturnType<typeof createServer>;
let baseUrl: string;
let frameUrl: string;
let frameView: FrameView;
let rendered: string;
let scripts: Record<string, string>;

test.beforeAll(async () => {
	const root = resolve(import.meta.dirname, "../../../..");
	const messages = JSON.parse(
		await readFile(resolve(root, "packages/editor-core/src/messages/en.json"), "utf8"),
	);
	const lesson = readLesson(source);
	if (lesson.hasErrors) throw new Error(JSON.stringify(lesson.errors));
	const pageId = lesson.pages[0].id;
	frameView = buildFrameView({
		lesson,
		file: "lesson.prax",
		pageId,
		session: createSession(),
		translate: createTranslator({ locale: "en", messages }),
		alwaysShowHandles: true,
	});
	const titleIds = new Set(
		[...lesson.nodes.values()]
			.filter((record) => record.node.kind === "page" && record.role === "title")
			.map((record) => record.id),
	);
	rendered = lesson.pages[0].blocks
		.filter((block) => !titleIds.has(block.id))
		.map((block) => renderBlockHtml(block))
		.join("\n");
	scripts = {};
	for (const [name, contents] of Object.entries({
		lens: `import { mountPageLens } from './packages/editor-core/src/frame-bridge/page-lens.ts'; window.mountPageLens = mountPageLens;`,
		frame: `import { startInspectionFrame } from './packages/editor-core/src/frame-bridge/transport.ts';
			const params = new URLSearchParams(location.search);
			startInspectionFrame({ window, parentOrigin: params.get('parent') ?? '', channel: params.get('channel') ?? 'u3-browser', pageId: '${pageId}' });`,
		host: `import { connectPageFrame } from './packages/editor-core/src/frame-bridge/transport.ts';
			const frame = document.querySelector('iframe');
			const bridge = connectPageFrame({ window, frame, frameOrigin: 'null', channel: 'u3-browser', pageId: '${pageId}', view: window.fixtureView, onEvent: event => window.frameEvents.push(event) });
			window.pageBridge = bridge; frame.src = window.fixtureFrameOrigin + '/frame?praxity-inspect=1&parent=' + encodeURIComponent(location.origin) + '&theme=' + new URLSearchParams(location.search).get('theme');`,
	})) {
		const result = await build({
			stdin: { contents, resolveDir: root, sourcefile: `${name}.ts`, loader: "ts" },
			bundle: true,
			plugins: [rawCss],
			write: false,
			platform: "browser",
			format: "iife",
		});
		scripts[`/${name}.js`] = result.outputFiles[0].text;
	}
	const respond: RequestListener = (request, response) => {
		const url = new URL(request.url ?? "/", baseUrl);
		if (scripts[url.pathname]) {
			response.setHeader("Content-Type", "text/javascript");
			response.end(scripts[url.pathname]);
			return;
		}
		response.setHeader("Content-Type", "text/html; charset=utf-8");
		if (url.pathname === "/frame") {
			const dark = url.searchParams.get("theme") === "dark";
			response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Working together</title><style>
			body { margin:0; padding:48px 24px 60px 52px; background:${dark ? "#171717" : "#fbfbfb"}; color:${dark ? "#f1f1f1" : "#252525"}; font:18px/1.6 system-ui; }
			main { max-width:720px; margin:auto; } h1 { margin:0 0 28px; font-size:32px; line-height:1.2; }
			.praxity-block { margin:0 0 28px; } p { margin:0 0 16px; } [role="tablist"] { display:flex; gap:24px; margin-bottom:20px; }
			[role="tab"] { appearance:none; border:0; padding:8px; background:transparent; color:inherit; font:inherit; border-bottom:2px solid currentColor; }
			.praxity-disclosure-heading { font-size:20px; } .praxity-columns { display:flex; gap:32px; } .praxity-column { min-width:0; }
			[hidden] { display:none!important; }
			@media(max-width:600px) { body { font-size:16px; } h1 { font-size:26px; } .praxity-columns { flex-direction:column; } }
			</style></head><body><main><h1 class="praxity-page-title">Working together</h1>${rendered}</main><script src="/frame.js"></script></body></html>`);
		} else
			response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>U3 Page lens</title><style>
			body { margin:0; padding:16px; background:${url.searchParams.get("theme") === "dark" ? "#15181c" : "#e6e9ed"}; }
			iframe { display:block; border:0; border-radius:10px; width:100%; height:calc(100vh - 32px); box-shadow:0 4px 16px rgb(29 35 41 / .12); }
			</style></head><body><iframe title="Page" sandbox="allow-scripts"></iframe><script>window.fixtureView=${JSON.stringify(frameView)};window.fixtureFrameOrigin=${JSON.stringify(frameUrl)};window.frameEvents=[];</script><script src="/host.js"></script></body></html>`);
	};
	server = createServer(respond);
	await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("U3 fixture server has no address");
	baseUrl = `http://127.0.0.1:${address.port}`;
	// Exercise the actual preview/editor origin boundary, not a same-origin iframe.
	courseServer = createServer(respond);
	await new Promise<void>((resolveReady) => courseServer.listen(0, "127.0.0.1", resolveReady));
	const courseAddress = courseServer.address();
	if (!courseAddress || typeof courseAddress === "string")
		throw new Error("U3 course server has no address");
	frameUrl = `http://127.0.0.1:${courseAddress.port}`;
});
test.afterAll(async () => {
	await Promise.all(
		[server, courseServer].map(
			(listener) =>
				new Promise<void>((resolveClosed, reject) =>
					listener.close((error) => (error ? reject(error) : resolveClosed())),
				),
		),
	);
});

test("hostile markup leaves bridge keys, selection and focus working", async ({ page }) => {
	await page.goto(baseUrl);
	const node = frameView.nodes.find((candidate) => candidate.name.includes("Good feedback"));
	if (!node) throw new Error("Missing hostile-course node");
	await expect(
		page.frameLocator("iframe").getByRole("button", { name: node.name, exact: true }),
	).toBeVisible();
	const frame = page.frames().find((candidate) => candidate.url().startsWith(frameUrl));
	if (!frame) throw new Error("Missing course frame");
	const real = frame.getByRole("button", { name: node.name, exact: true });
	await expect(real).toBeVisible();
	const identity = {
		channel: "u3-browser",
		pageId: frameView.pageId,
		file: frameView.file,
		nodeId: node.id,
		parentOrigin: baseUrl,
	};
	await installHostileMarkup(frame, identity);
	await real.focus();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents.some(
					(event) => event.event === "focusChanged",
				),
			),
		)
		.toBe(true);
	await page.evaluate(() => {
		(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents = [];
	});
	await real.press("F2");
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents.some(
					(event) => event.event === "intent" && event.intent === "source",
				),
			),
		)
		.toBe(true);
	await real.locator("xpath=following-sibling::*[1]").click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents.some(
					(event) => event.event === "select",
				),
			),
		)
		.toBe(true);
	await real.click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents.some(
					(event) => event.event === "intent" && event.intent === "actions",
				),
			),
		)
		.toBe(true);
});

test("a learner document in the lens frame cannot replace the private port while a frame swap prepares", async ({
	page,
}) => {
	await page.goto(baseUrl);
	const node = frameView.nodes.find((candidate) => candidate.name.includes("Good feedback"));
	if (!node) throw new Error("Missing swap node");
	const button = page.frameLocator("iframe").getByRole("button", { name: node.name, exact: true });
	await expect(button).toBeVisible();
	const frame = page.frames().find((candidate) => candidate.url().startsWith(frameUrl));
	if (!frame) throw new Error("Missing swap frame");
	await button.focus();
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents.some(
					(event) => event.event === "focusChanged",
				),
			),
		)
		.toBe(true);
	await page.evaluate((nodeId) => {
		const context = window as unknown as {
			fixtureView: FrameView;
			pageBridge: { render(view: FrameView): void; prepareSwap(): unknown };
			frameEvents: FrameEventBody[];
		};
		context.pageBridge.render({
			...context.fixtureView,
			focus: { file: "lesson.prax", nodeId, role: "handle" },
		});
		context.pageBridge.prepareSwap();
		context.frameEvents = [];
	}, node.id);
	await forgeLearnerDocumentMessages(page, frame, {
		channel: "u3-browser",
		pageId: frameView.pageId,
		file: frameView.file,
		nodeId: node.id,
		parentOrigin: baseUrl,
	});
	expect(
		await page.evaluate(() => (window as unknown as { frameEvents: FrameEventBody[] }).frameEvents),
	).toEqual([]);
	await expect(button).toBeFocused();
});

for (const theme of ["light", "dark"])
	for (const width of [1280, 390]) {
		test(`F1 F3 F5 handles in ${theme} at ${width}px`, async ({ page }, testInfo) => {
			await page.setViewportSize({ width, height: width === 390 ? 760 : 860 });
			await page.goto(`${baseUrl}/?theme=${theme}`);
			const frame = page.frameLocator("iframe");
			const handles = frame.locator('button[data-focus-role="handle"]');
			await expect(handles).toHaveCount(frameView.nodes.length);
			const paragraph = frameView.nodes.find((node) => node.name.includes("Good feedback"));
			if (!paragraph) throw new Error("Missing paragraph fixture");
			await expect(frame.locator("html")).toHaveAttribute("data-chrome", theme);
			await expect(
				frame.getByRole("button", { name: paragraph.name, exact: true }),
			).toHaveAttribute("aria-haspopup", "menu");
			await page.screenshot({ path: testInfo.outputPath(`U3-${theme}-${width}-always.png`) });
			const audit = await new AxeBuilder({ page })
				.include(["iframe", '[data-praxity-chrome="handle"]'])
				.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
				.analyze();
			await testInfo.attach("chrome-axe", {
				body: JSON.stringify(audit, null, 2),
				contentType: "application/json",
			});
			expect(audit.violations).toEqual([]);
			const geometry = await handles.evaluateAll((buttons) => {
				const chrome = (element: Element) => element.closest("[data-praxity-chrome]");
				const contentBoxes: DOMRect[] = [];
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				while (walker.nextNode()) {
					const text = walker.currentNode;
					const parent = text.parentElement;
					if (
						!parent ||
						chrome(parent) ||
						parent.closest("script,style") ||
						!text.textContent?.trim()
					)
						continue;
					const range = document.createRange();
					range.selectNodeContents(text);
					contentBoxes.push(...range.getClientRects());
				}
				for (const control of document.querySelectorAll(
					"a[href],button,input,select,textarea,summary,[role=tab],[role=tabpanel]",
				))
					if (!chrome(control)) contentBoxes.push(control.getBoundingClientRect());
				// A tab's handle is read before its panel and anchored to its tab.
				const nodeOf = (button: Element) =>
					[...document.querySelectorAll('[role="tab"]')].find(
						(tab) => tab.getAttribute("data-node-id") === button.getAttribute("data-node-id"),
					) ?? button.nextElementSibling;
				return buttons
					.filter((b) => !(b as HTMLElement).hidden)
					.map((button) => {
						const box = button.getBoundingClientRect();
						const element = nodeOf(button);
						const node = element?.getBoundingClientRect();
						const horizontalTab = element?.getAttribute("role") === "tab";
						const lineHeight = element
							? Number.parseFloat(getComputedStyle(element).lineHeight)
							: 0;
						const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
						const hit = document.elementFromPoint(
							box.x + box.width / 2 - 20,
							box.y + box.height / 2,
						);
						return {
							name: button.getAttribute("aria-label"),
							box: box.toJSON(),
							nodeBox: node?.toJSON(),
							anchored:
								!!node &&
								node.height > 0 &&
								box.y + box.height / 2 >= node.top &&
								box.y + box.height / 2 <= node.bottom,
							firstLine:
								horizontalTab || (!!node && box.y + box.height / 2 <= node.top + lineHeight),
							clearOfTextAndControls: contentBoxes.every(
								(content) =>
									content.height === 0 ||
									content.width === 0 ||
									box.right <= content.left ||
									box.left >= content.right ||
									box.bottom <= content.top ||
									box.top >= content.bottom,
							),
							inViewport:
								box.y < 0 || box.y > innerHeight || (box.x >= 0 && box.right <= innerWidth),
							clearOfContent: !node || box.right <= node.left,
							hittable:
								box.y < 0 ||
								box.bottom > innerHeight ||
								centre?.closest('[data-focus-role="handle"]') === button,
							enlarged: box.y < 0 || box.bottom > innerHeight || hit === button,
						};
					});
			});
			await testInfo.attach("handle-geometry", {
				body: JSON.stringify(geometry, null, 2),
				contentType: "application/json",
			});
			const tabGeometry = await handles.evaluateAll((buttons) =>
				buttons.flatMap((button) => {
					const tab = [...document.querySelectorAll('[role="tab"]')].find(
						(candidate) =>
							candidate.getAttribute("data-node-id") === button.getAttribute("data-node-id"),
					);
					if (!tab) return [];
					// Read order: the handle comes directly before its tab's panel.
					if (button.nextElementSibling?.getAttribute("role") !== "tabpanel") return [];
					return [
						{
							box: button.getBoundingClientRect().toJSON(),
							gutter: tab.closest('[role="tablist"]')?.getBoundingClientRect().left,
						},
					];
				}),
			);
			expect(tabGeometry).toHaveLength(2);
			for (const tab of tabGeometry) expect(tab.box.right).toBeLessThanOrEqual(tab.gutter ?? -1);
			expect(tabGeometry[1].box.left).toBe(tabGeometry[0].box.left);
			expect(tabGeometry[1].box.top).toBeGreaterThanOrEqual(tabGeometry[0].box.bottom);
			for (const result of geometry)
				expect(
					result,
					JSON.stringify(
						await handles.evaluateAll((buttons) =>
							buttons.map((button) => ({
								name: button.getAttribute("aria-label"),
								box: button.getBoundingClientRect().toJSON(),
								hidden: (button as HTMLElement).hidden,
							})),
						),
					),
				).toEqual({
					name: result.name,
					box: result.box,
					nodeBox: result.nodeBox,
					anchored: true,
					firstLine: true,
					clearOfTextAndControls: true,
					inViewport: true,
					clearOfContent: true,
					hittable: true,
					enlarged: true,
				});
			const courseBoxes = await handles.evaluateAll((buttons) =>
				buttons.map((button) => button.nextElementSibling?.getBoundingClientRect().toJSON()),
			);
			for (const state of ["idle", "hover", "selected"] as const) {
				await page.mouse.move(0, 0);
				await page.evaluate(
					({ state, nodeId }) => {
						const context = window as unknown as {
							fixtureView: FrameView;
							pageBridge: { render(view: FrameView): void };
						};
						context.pageBridge.render({
							...context.fixtureView,
							alwaysShowHandles: false,
							selected: state === "selected" ? [nodeId] : [],
							focus: null,
						});
					},
					{ state, nodeId: paragraph.id },
				);
				const button = frame.getByRole("button", { name: paragraph.name, exact: true });
				if (state === "hover") await button.locator("xpath=following-sibling::*[1]").hover();
				await expect(button).toHaveCSS("opacity", state === "idle" ? "0" : "1");
				for (const other of await handles.all()) {
					if ((await other.getAttribute("aria-label")) !== paragraph.name)
						await expect(other).toHaveCSS("opacity", "0");
				}
				if (state === "selected") {
					await expect(button.locator("xpath=following-sibling::*[1]")).toHaveCSS(
						"outline-offset",
						"4px",
					);
					await expect(button.locator("xpath=following-sibling::*[1]")).toHaveCSS(
						"outline-width",
						"2px",
					);
				}
				expect(
					await handles.evaluateAll((buttons) =>
						buttons.map((button) => button.nextElementSibling?.getBoundingClientRect().toJSON()),
					),
				).toEqual(courseBoxes);
				await page.screenshot({ path: testInfo.outputPath(`U3-${theme}-${width}-${state}.png`) });
				const stateAudit = await new AxeBuilder({ page })
					.include(["iframe", '[data-praxity-chrome="handle"]'])
					.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
					.analyze();
				expect(stateAudit.violations).toEqual([]);
			}
			await page.emulateMedia({ reducedMotion: "reduce" });
			await expect(handles.first()).toHaveCSS("transition-duration", "0s");
		});
	}

test("explicit handle focus does not reactivate a frame that already owns focus", async ({
	page,
}) => {
	await page.goto(baseUrl);
	const frame = page.frameLocator("iframe");
	const node = frameView.nodes.find((candidate) => candidate.name.includes("Good feedback"));
	if (!node) throw new Error("Missing paragraph fixture");
	await frame.getByRole("button", { name: frameView.nodes[0].name, exact: true }).focus();
	const button = frame.getByRole("button", { name: node.name, exact: true });
	await button.evaluate((element) => {
		const win = element.ownerDocument.defaultView;
		if (!win) throw new Error("Missing frame window");
		// WebKit can refuse control focus while a redundant window focus transitions.
		let reactivated = false;
		win.focus = () => {
			reactivated = true;
		};
		const nativeFocus = win.HTMLElement.prototype.focus;
		win.HTMLElement.prototype.focus = function (...args) {
			if (!reactivated) nativeFocus.apply(this, args);
		};
	});
	const entered = await page.evaluate((nodeId) => {
		const context = window as unknown as {
			pageBridge: {
				focus(target: { file: string; nodeId: string; role: "handle" }): Promise<boolean>;
			};
		};
		return context.pageBridge.focus({ file: "lesson.prax", nodeId, role: "handle" });
	}, node.id);
	expect(entered).toBe(true);
	await expect(button).toBeFocused();
});

test("F6 F9 node patches and full frame swaps restore logical focus without background focus moves", async ({
	page,
}) => {
	await page.goto(baseUrl);
	const frame = page.frameLocator("iframe");
	const node = frameView.nodes.find((n) => n.name.includes("Good feedback"));
	if (!node) throw new Error("Missing paragraph fixture");
	const button = frame.getByRole("button", { name: node.name, exact: true });
	await button.focus();
	await page.evaluate((nodeId) => {
		const context = window as unknown as {
			fixtureView: FrameView;
			pageBridge: { render(view: FrameView): void };
		};
		context.pageBridge.render({
			...context.fixtureView,
			focus: { file: "lesson.prax", nodeId, role: "handle" },
		});
	}, node.id);
	await button.evaluate((element) => {
		const content = element.nextElementSibling;
		if (!content) throw new Error("No content");
		content.replaceWith(content.cloneNode(true));
	});
	await expect(button).toBeFocused();
	await button.evaluate((element) => element.remove());
	await expect(button).toBeFocused();
	const courseFrame = page
		.frames()
		.find((candidate) => candidate.parentFrame() === page.mainFrame());
	if (!courseFrame) throw new Error("No course frame");
	// Keep the departing document available while the replacement response is delayed.
	await page.route(
		(url) => url.searchParams.get("swap") === "1",
		async (route) => {
			await delay(200);
			await route.continue();
		},
	);
	await page.evaluate(() => {
		const context = window as unknown as { pageBridge: { prepareSwap(): string } };
		const channel = context.pageBridge.prepareSwap();
		const element = document.querySelector("iframe");
		if (!element) throw new Error("No frame");
		const next = new URL(element.src);
		next.searchParams.set("channel", channel);
		next.searchParams.set("swap", "1");
		element.src = next.href;
	});
	// The old document can still satisfy focus while its replacement is loading.
	await courseFrame.waitForURL((url) => url.searchParams.get("swap") === "1");
	await expect(button).toBeFocused();
	await button.press("F2");
	await expect
		.poll(() =>
			page.evaluate(() =>
				(
					window as unknown as { frameEvents: { event: string; intent?: string }[] }
				).frameEvents.some((e) => e.event === "intent" && e.intent === "source"),
			),
		)
		.toBe(true);
	const body = frameView.nodes.find((n) => n.name.includes("Describe the action"));
	if (!body) throw new Error("No hidden tab body");
	await page.evaluate((nodeId) => {
		const context = window as unknown as {
			fixtureView: FrameView;
			pageBridge: { render(view: FrameView): void };
		};
		context.pageBridge.render({ ...context.fixtureView, selected: [nodeId], focus: null });
	}, body.id);
	await expect(frame.getByRole("button", { name: body.name, exact: true })).toBeVisible();
	await expect(button).toBeFocused();
});

type PresentationContext = {
	pageBridge: ReturnType<typeof connectPageFrame>;
	frameEvents: FrameEventBody[];
	hostKeys: string[];
};
for (const queued of [false, true]) {
	test(`07t suspension releases native frame focus and host keys, queued focus ${queued}`, async ({
		page,
	}) => {
		await page.goto(baseUrl);
		const node = frameView.nodes.find((candidate) => candidate.name.includes("Good feedback"));
		if (!node) throw new Error("Missing paragraph fixture");
		await expect(
			page.frameLocator("iframe").getByRole("button", { name: node.name, exact: true }),
		).toBeVisible();
		const frame = page.frames().find((candidate) => candidate.url().startsWith(frameUrl));
		if (!frame) throw new Error("Missing inspection frame");
		const handle = frame.getByRole("button", { name: node.name, exact: true });
		await expect(handle).toBeVisible();
		await installHostileMarkup(frame, {
			channel: "u3-browser",
			pageId: frameView.pageId,
			file: frameView.file,
			nodeId: node.id,
			parentOrigin: baseUrl,
		});
		if (!queued) await handle.focus();
		const result = await page.evaluate(
			async ({ queued, nodeId, pageId }) => {
				const context = window as unknown as PresentationContext;
				context.hostKeys = [];
				document.addEventListener("keydown", (event) => context.hostKeys.push(event.key));
				const result = queued
					? context.pageBridge.focus({ file: "lesson.prax", nodeId, role: "handle" })
					: Promise.resolve(false);
				context.pageBridge.suspend();
				context.pageBridge.nodes({ seq: 701, pageId, fragments: [] });
				return result;
			},
			{ queued, nodeId: node.id, pageId: frameView.pageId },
		);
		expect(result).toBe(false);
		await expect
			.poll(() =>
				page.evaluate(() =>
					(window as unknown as PresentationContext).frameEvents.some(
						(event) => event.event === "painted" && event.seq === 701,
					),
				),
			)
			.toBe(true);
		expect(await frame.evaluate(() => document.hasFocus())).toBe(false);
		for (const key of ["Escape", "Alt+F6", "F2"]) await page.keyboard.press(key);
		expect(await page.evaluate(() => (window as unknown as PresentationContext).hostKeys)).toEqual([
			"Escape",
			"Alt",
			"F6",
			"F2",
		]);
	});
}

test("F5 excludes hidden and zero-height nodes from rendering, focus and the Tab order", async ({
	page,
}) => {
	await page.goto(baseUrl);
	const frame = page.frameLocator("iframe");
	const paragraph = frameView.nodes.find((node) => node.name.includes("Good feedback"));
	if (!paragraph) throw new Error("Missing paragraph fixture");
	const button = frame.getByRole("button", {
		name: paragraph.name,
		exact: true,
		includeHidden: true,
	});
	await expect(button).toBeVisible();
	await button.evaluate(() => {
		const style = document.createElement("style");
		style.textContent = ".u3-hidden { display:none; }";
		document.head.append(style);
	});
	for (const state of ["height:0;overflow:hidden", "display:none", "visibility:hidden", "class"]) {
		await button.evaluate((element, style) => {
			if (style === "class") element.nextElementSibling?.classList.add("u3-hidden");
			else element.nextElementSibling?.setAttribute("style", style);
		}, state);
		await expect(button).toBeHidden();
		await frame.locator('button[data-focus-role="handle"]:visible').first().focus();
		await page.evaluate((nodeId) => {
			const context = window as unknown as {
				pageBridge: { focus(target: { file: string; nodeId: string; role: "handle" }): void };
			};
			context.pageBridge.focus({ file: "lesson.prax", nodeId, role: "handle" });
		}, paragraph.id);
		await expect(button).not.toBeFocused();
		await frame.locator('button[data-focus-role="handle"]:visible').first().press("Tab");
		await expect(button).not.toBeFocused();
		await button.evaluate((element, state) => {
			if (state === "class") element.nextElementSibling?.classList.remove("u3-hidden");
			else element.nextElementSibling?.removeAttribute("style");
		}, state);
		await expect(button).toBeVisible();
	}
});

test("V5 keeps handles out of adjacent column text after a content patch", async ({ page }) => {
	await page.goto(baseUrl);
	const frame = page.frameLocator("iframe");
	const first = frameView.nodes.find((node) => node.name.includes("Focus on the work"));
	if (!first) throw new Error("Missing first column fixture");
	await frame.getByRole("button", { name: first.name, exact: true }).evaluate((button) => {
		const paragraph = button.nextElementSibling?.querySelector("p");
		if (!paragraph) throw new Error("Missing first column paragraph");
		paragraph.textContent =
			"Discuss the specific actions you observed and the changes you would like to see in the next conversation.";
	});
	await expect
		.poll(() =>
			frame.locator('button[data-focus-role="handle"]').evaluateAll((buttons) => {
				const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
				const textBoxes: DOMRect[] = [];
				while (walker.nextNode()) {
					const node = walker.currentNode;
					if (
						!node.textContent?.trim() ||
						node.parentElement?.closest("[data-praxity-chrome],script,style")
					)
						continue;
					const range = document.createRange();
					range.selectNodeContents(node);
					textBoxes.push(...range.getClientRects());
				}
				return buttons
					.filter((button) => !(button as HTMLElement).hidden)
					.filter((button) => {
						const box = button.getBoundingClientRect();
						return textBoxes.some(
							(text) =>
								text.width > 0 &&
								text.height > 0 &&
								box.left < text.right &&
								box.right > text.left &&
								box.top < text.bottom &&
								box.bottom > text.top,
						);
					})
					.map((button) => button.getAttribute("aria-label"));
			}),
		)
		.toEqual([]);
	const audit = await new AxeBuilder({ page })
		.include(["iframe", '[data-praxity-chrome="handle"]'])
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(audit.violations).toEqual([]);
});

test("inspection-only injection leaves learner fragments free of chrome", async ({ page }) => {
	await page.goto(`${baseUrl}/frame?praxity-inspect=0`);
	await expect(page.locator("[data-praxity-chrome]")).toHaveCount(0);
	expect(rendered).not.toContain("data-praxity-chrome");
});

type ReviewContext = {
	mountPageLens: typeof mountPageLens;
	lens: ReturnType<typeof mountPageLens>;
	events: FrameEventBody[];
};
const reviewView: FrameView = {
	file: "lesson.prax",
	pageId: "page",
	language: "en",
	alwaysShowHandles: true,
	nodes: [
		{ id: "page", kind: "page", parentId: null, name: "Page", description: "Page." },
		{ id: "text", kind: "block", parentId: "page", name: "Text", description: "Text." },
		{ id: "next", kind: "block", parentId: "page", name: "Next", description: "Next." },
	],
	selected: [],
	expanded: [],
	focus: null,
};
async function mountReview(page: Page, body: string, css = "", direction = "ltr") {
	await page.route(`${baseUrl}/review**`, (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><html lang="en" dir="${direction}"><head><title>Lens regression</title><style>
		body{margin:0;padding:48px 80px;font:18px/1.6 system-ui}h1,p{margin:0 0 28px}${css}
		</style></head><body>${body}<p data-node-id="next">Next block.</p></body></html>`,
		}),
	);
	await page.goto(`${baseUrl}/review?praxity-inspect=1`);
	await page.addScriptTag({ content: scripts["/lens.js"] });
	return page.evaluate((view) => {
		const context = window as unknown as ReviewContext;
		context.events = [];
		try {
			context.lens = context.mountPageLens({
				document,
				view,
				onEvent: (event) => context.events.push(event),
			});
			return null;
		} catch (error) {
			return String(error);
		}
	}, reviewView);
}

for (const suspended of [false, true]) {
	test(`07t retained source control patch restores focus only while presenting, suspended ${suspended}`, async ({
		page,
	}) => {
		expect(await mountReview(page, '<h1>Title</h1><p data-node-id="text">Body.</p>')).toBeNull();
		await installHostileMarkup(page.mainFrame(), {
			channel: "review",
			pageId: "page",
			file: "lesson.prax",
			nodeId: "text",
			parentOrigin: baseUrl,
		});
		await page.evaluate(() => {
			const { lens } = window as unknown as ReviewContext;
			const field = document.createElement("textarea");
			field.id = "source-field";
			field.value = "Uncommitted draft";
			lens.fragmentElement("text")?.append(field);
			lens.registerControl(field, { file: "lesson.prax", nodeId: "text", role: "source" });
		});
		await page.locator("#source-field").focus();
		const result = await page.evaluate((suspended) => {
			const { lens } = window as unknown as ReviewContext;
			if (suspended) lens.suspend();
			const replaced = lens.replaceFragment({
				id: "text",
				html: '<p data-node-id="text">Replaced.</p>',
			});
			const field = document.getElementById("source-field") as HTMLTextAreaElement;
			return { replaced, focused: document.activeElement === field, value: field.value };
		}, suspended);
		expect(result).toEqual({ replaced: true, focused: !suspended, value: "Uncommitted draft" });
	});
}

test("authored chrome cannot forge source intents or hijack logical focus", async ({ page }) => {
	const authored = sanitizeHtml(
		'<button id="forged" data-praxity-chrome="handle" data-focus-role="handle" data-node-id="text">Author button</button>',
	);
	expect(authored).toContain("data-praxity-chrome");
	expect(
		await mountReview(page, `<h1>Title ${authored}</h1><p data-node-id="text">Body.</p>`),
	).toBeNull();
	const forged = page.locator("#forged");
	await expect(forged).toHaveAttribute("tabindex", "-1");
	for (const attribute of ["data-praxity-chrome", "data-focus-role", "data-node-id"])
		await expect(forged).not.toHaveAttribute(attribute);
	await forged.focus();
	await page.keyboard.press("F2");
	expect(
		await page.evaluate(() =>
			(window as unknown as ReviewContext).events.filter((e) => e.event === "intent"),
		),
	).toEqual([]);
	await page.evaluate(() =>
		(window as unknown as ReviewContext).lens.focus({
			file: "lesson.prax",
			nodeId: "text",
			role: "handle",
		}),
	);
	const real = page.locator('button[data-focus-role="handle"][data-node-id="text"]');
	await expect(real).toBeFocused();
	await page.keyboard.press("F2");
	expect(
		await page.evaluate(() =>
			(window as unknown as ReviewContext).events.filter((e) => e.event === "intent"),
		),
	).toEqual([
		{
			event: "intent",
			intent: "source",
			focus: { file: "lesson.prax", nodeId: "text", role: "handle" },
		},
	]);
});

test("iframe learner controls cannot enter Tab order", async ({ page }) => {
	const embed = renderBlockHtml({
		id: "text",
		type: "embed",
		data: { src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Embedded learner control" },
	});
	expect(embed).toContain("<iframe");
	expect(await mountReview(page, `<h1>Title</h1>${embed}`)).toBeNull();
	await expect(page.locator("iframe")).toHaveAttribute("tabindex", "-1");
	await page.locator('button[data-focus-role="handle"][data-node-id="text"]').focus();
	await page.keyboard.press("Tab");
	await expect(page.locator('button[data-focus-role="handle"][data-node-id="next"]')).toBeFocused();
});

test("RTL course reserves a usable inline-start gutter", async ({ page }, testInfo) => {
	expect(
		await mountReview(
			page,
			'<h1>Title</h1><p data-node-id="text">Body.</p>',
			"body{padding:48px 24px}",
			"rtl",
		),
	).toBeNull();
	const handles = page.locator('button[data-focus-role="handle"]');
	expect(
		await handles.evaluateAll((buttons) =>
			buttons.every((button) => {
				const box = button.getBoundingClientRect();
				const node = button.nextElementSibling?.getBoundingClientRect();
				return (
					node &&
					box.left >= node.right &&
					box.right <= innerWidth &&
					box.top + box.height / 2 >= node.top &&
					box.top + box.height / 2 <= node.bottom
				);
			}),
		),
	).toBe(true);
	await page.screenshot({ path: testInfo.outputPath("U3-rtl.png") });
});

for (const [name, body, css] of [
	["CSS zoom", '<h1>Title</h1><p data-node-id="text">Body.</p>', "body{zoom:2}"],
	[
		"transformed ancestors",
		'<h1>Title</h1><div style="transform:translateY(8px) scale(1.1);transform-origin:top left"><p data-node-id="text">Body.</p></div>',
		"",
	],
	[
		"flip-card ancestors",
		'<h1>Title</h1><div style="transform:rotateY(180deg)"><p data-node-id="text">Body.</p></div>',
		"",
	],
	[
		"transformed ancestors with geometry fallback",
		'<h1>Title</h1><div style="transform:translateY(8px) scale(1.1);transform-origin:top left"><p data-node-id="text">Body.</p></div>',
		"",
	],
] as const) {
	test(`${name} keep handle centred on first line`, async ({ page }) => {
		if (name.endsWith("fallback"))
			await page.addInitScript(() => Reflect.deleteProperty(Element.prototype, "currentCSSZoom"));
		expect(await mountReview(page, body, css)).toBeNull();
		if (name.endsWith("fallback"))
			await page.evaluate(() => (window as unknown as ReviewContext).lens.refresh());
		const geometry = await page.locator('button[data-node-id="text"]').evaluate((button) => {
			const node = button.nextElementSibling;
			if (!node?.firstChild) throw new Error("Missing text");
			const range = document.createRange();
			range.selectNodeContents(node.firstChild);
			const line = range.getClientRects()[0];
			const box = button.getBoundingClientRect();
			const glyph = button.querySelector("svg")?.getBoundingClientRect();
			if (!glyph) throw new Error("Missing handle glyph");
			return {
				centre: box.top + box.height / 2,
				top: line.top,
				bottom: line.bottom,
				left: box.left,
				right: box.right,
				nodeLeft: node.getBoundingClientRect().left,
				glyphOffsetX: glyph.left + glyph.width / 2 - (box.left + box.width / 2),
				glyphOffsetY: glyph.top + glyph.height / 2 - (box.top + box.height / 2),
			};
		});
		expect(geometry.centre).toBeGreaterThanOrEqual(geometry.top);
		expect(geometry.centre).toBeLessThanOrEqual(geometry.bottom);
		expect(geometry.right).toBeLessThanOrEqual(geometry.nodeLeft);
		expect(Math.abs(geometry.glyphOffsetX)).toBeLessThan(0.1);
		expect(Math.abs(geometry.glyphOffsetY)).toBeLessThan(0.1);
	});
}
