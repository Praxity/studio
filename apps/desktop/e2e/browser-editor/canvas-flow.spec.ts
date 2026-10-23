import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type JSHandle, type Locator, type Page, test } from "@playwright/test";
import { serveStudioAuthorDocument } from "../../src/main/studio/author-document";
import {
	type CanvasTextGeometry,
	canvasTextNeedsFallback,
} from "../../src/renderer/browser/canvas-text";
import { startJourney } from "./global-setup";

const content = `# Practice

Previous paragraph with a [course link](#main-content).

Second paragraph.

- First leaf
- Second leaf

::: choice Pick
( ) Alpha
( ) Beta
( ) Gamma
:::

::: figure
![Exact alt](data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='40'/%3E)
First caption.

Second caption.
:::
`;
let stop: (() => Promise<void>) | undefined;
test.afterEach(async ({ page }) => {
	page.on("dialog", (dialog) => dialog.accept());
	await page.goto("about:blank");
	await page.unrouteAll({ behavior: "wait" });
	await stop?.();
});
async function project(page: Page, css: string, transform = (html: string) => html) {
	if (page.context().browser()?.browserType().name() === "chromium")
		await page.context().grantPermissions(["local-network-access"], {
			origin: new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin,
		});
	await page.route("**/canvas/preview/**", async (route) => {
		if (
			!["document", "fetch"].includes(route.request().resourceType()) ||
			new URL(route.request().url()).origin !==
				new URL(process.env.PRAXITY_BROWSER_READY_URL ?? "").origin
		)
			return route.continue();
		const response = await route.fetch();
		const html = await response.text();
		const base = html.match(/<base href="([^"]+)"/u)?.[1];
		if (!base) throw new Error("Missing learner base");
		const projected = await serveStudioAuthorDocument(
			new Request(route.request().url()),
			transform(html).replace("</head>", `<style>${css}</style></head>`),
			base,
			await readFile(join(process.env.PRAXITY_BROWSER_EDITOR_ASSETS ?? "", "canvas.js"), "utf8"),
		);
		await route.fulfill({
			headers: Object.fromEntries(projected.headers),
			body: await projected.text(),
		});
	});
}
async function open(page: Page, lang = "en", mode = "light", css = "", source = content) {
	stop = await startJourney(page.context(), {
		standaloneSource: `---\nlang: ${lang}\ndesign:\n  colorMode: ${mode}\n---\n\n${source}`,
	});
	if (css) await project(page, css);
	await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
	await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
	if (css) {
		await page.reload();
		await expect(page.getByRole("status")).toHaveText(lang === "fr" ? "Connecté" : "Connected");
		expect(await page.locator("head style").textContent()).toContain(css);
	}
}
async function hostBox(locator: Locator) {
	return locator.evaluate((element) => {
		const root = element.getRootNode();
		if (!(root instanceof ShadowRoot)) throw new Error("Missing field host");
		const box = root.host.getBoundingClientRect();
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	});
}
interface FlowSlot {
	parent: Node;
	next: Node | null;
	style: string;
	geometry?: CanvasTextGeometry;
	measure(host: Element, root: ShadowRoot): CanvasTextGeometry;
	observer: ResizeObserver;
}

async function disposeFlow(flow: JSHandle<FlowSlot>) {
	await flow.evaluate(({ observer }) => observer.disconnect());
	await flow.dispose();
}

async function openField(edit: Locator) {
	// Observe before activation, including the open-time reanchor of choices and captions.
	const flow = await edit.evaluateHandle((button) => {
		const host = (button.getRootNode() as ShadowRoot).host as HTMLElement;
		if (!host.parentNode || host.parentNode === document.documentElement)
			throw new Error("Missing in-flow parent before opening");
		function measure(flowHost: Element, flowRoot: ShadowRoot) {
			const root = host.shadowRoot;
			if (!root) throw new Error("Missing field shadow");
			const focused = root.activeElement;
			const topLayer = host.matches(":popover-open");
			const field = flowRoot.querySelector("textarea");
			const label = flowRoot.querySelector("label");
			if (!(field instanceof HTMLTextAreaElement) || !label) throw new Error("Missing flow field");
			const box = field.getBoundingClientRect();
			const hitsHost = (box: DOMRect) =>
				[
					[box.left + 4, box.top + 4],
					[(box.left + box.right) / 2, (box.top + box.bottom) / 2],
					[box.right - 4, box.bottom - 4],
				].every(
					([x, y]) =>
						// Ignore only the real fallback above the probe in the top layer.
						document.elementsFromPoint(x, y).filter((el) => !topLayer || el !== host)[0] ===
						flowHost,
				);
			const courseFocus = document.querySelector(":focus");
			return {
				connected: flowHost.isConnected,
				visible: field.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
				box: {
					top: box.top,
					bottom: box.bottom,
					left: box.left,
					right: box.right,
					width: box.width,
					height: box.height,
				},
				minimum: {
					width: field.offsetWidth,
					height: Number.parseFloat(getComputedStyle(field).minHeight),
				},
				scrollY,
				viewport: { width: innerWidth, height: innerHeight },
				focusDeparted:
					!focused &&
					!!courseFocus &&
					![document.body, document.documentElement, host].includes(courseFocus as HTMLElement),
				focused: !!focused,
				cornersHit: hitsHost(label.getBoundingClientRect()) && hitsHost(box),
			};
		}
		// The product's body ResizeObserver was registered first. Read its chosen flow layout,
		// before later caret reveal or the author's own scrolling changes these inputs.
		const geometryObserver = new ResizeObserver(() => {
			const root = host.shadowRoot;
			const field = root?.querySelector("textarea");
			if (root && field?.checkVisibility() && !host.matches(":popover-open"))
				slot.geometry = measure(host, root);
		});
		const slot: FlowSlot = {
			parent: host.parentNode,
			next: host.nextSibling,
			style: host.style.cssText,
			measure,
			observer: geometryObserver,
		};
		geometryObserver.observe(document.body);
		const observer = new MutationObserver((records) => {
			for (const record of records)
				if ([...record.removedNodes].includes(host) && record.target !== document.documentElement) {
					slot.parent = record.target;
					slot.next = record.nextSibling;
				}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return { slot, observer, host };
	});
	await edit.click();
	// Finish opening reveal and its one-time protection pass before keeping the slot.
	await flow.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	const slot = await flow.evaluateHandle(({ slot, observer, host }) => {
		observer.disconnect();
		if (host.parentNode && host.parentNode !== document.documentElement) {
			slot.parent = host.parentNode;
			slot.next = host.nextSibling;
		}
		if (slot.parent === document.documentElement) throw new Error("Fallback is not a flow slot");
		return slot;
	});
	await flow.dispose();
	return slot;
}
async function clearOfControls(page: Page, step: string, flow: JSHandle<FlowSlot>) {
	const layout = await page.getByRole("textbox").evaluate((field, flow) => {
		const root = field.getRootNode();
		if (!(root instanceof ShadowRoot)) throw new Error("Missing field host");
		const box = root.host.getBoundingClientRect();
		const host = root.host;
		const topLayer = host.matches(":popover-open");

		let geometry: CanvasTextGeometry;
		if (topLayer) {
			const probe = host.cloneNode(false) as HTMLElement;
			probe.removeAttribute("id");
			probe.removeAttribute("popover");
			probe.style.cssText = flow.style;
			const shadow = probe.attachShadow({ mode: "open" });
			shadow.append(...[...root.childNodes].map((node) => node.cloneNode(true)));
			const bodyInert = document.body.inert;
			try {
				document.body.inert = false;
				flow.parent.insertBefore(probe, flow.next);
				geometry = flow.measure(probe, shadow);
			} finally {
				probe.remove();
				document.body.inert = bodyInert;
			}
		} else geometry = flow.measure(host, root);
		const hits: string[] = [];
		function visit(parent: Document | ShadowRoot) {
			for (const el of parent.querySelectorAll("*")) {
				if (topLayer && el.closest("[inert]")) continue;
				if (el.shadowRoot && el !== host) visit(el.shadowRoot);
				if (
					!el.matches(
						"a,button,input,select,textarea,h1,h2,h3,h4,h5,h6,.praxity-text>p,li>div[data-node-id],.praxity-choice-label,.praxity-block-caption [data-node-id]",
					) ||
					!el.checkVisibility()
				)
					continue;
				const other = el.getBoundingClientRect();
				if (
					Math.min(box.right, other.right) - Math.max(box.left, other.left) > 0.5 &&
					Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 0.5
				)
					hits.push(el.getAttribute("aria-label") ?? el.textContent ?? el.tagName);
			}
		}
		visit(document);
		return {
			topLayer,
			bodyInert: document.body.inert,
			focused: root.querySelector(".field")?.contains(root.activeElement) === true,
			geometry,
			admissionGeometry: topLayer ? geometry : (flow.geometry ?? geometry),
			collisions: hits,
		};
	}, flow);
	test.info().annotations.push({
		type: "C09b layout",
		description: `${step}: ${JSON.stringify(layout)}`,
	});
	expect(layout.collisions, step).toEqual([]);
	if (layout.topLayer) {
		expect(layout.bodyInert, `${step}: fallback body`).toBe(true);
		expect(layout.focused, `${step}: fallback focus`).toBe(true);
	} else {
		expect(layout.bodyInert, `${step}: in-flow body`).toBe(false);
	}
	expect(layout.topLayer, `${step}: fallback admission`).toBe(
		canvasTextNeedsFallback(layout.admissionGeometry),
	);
}

for (const lang of ["en", "fr"])
	for (const mode of ["light", "dark"])
		for (const [width, height] of [
			[1280, 900],
			[390, 844],
			[390, 900],
			[320, 568],
			[320, 256],
		])
			test(`C09b in-flow kinds and recovery ${lang} ${mode} ${width}x${height}`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height });
				await open(page, lang, mode);
				let unknown = false;
				await page.route("**/api/rpc", async (route) => {
					const method = route.request().postDataJSON().method;
					if (unknown && ["canvasTextApply", "canvasTextSnapshot"].includes(method))
						return route.abort();
					if (method !== "canvasTextApply") return route.continue();
					await route.fulfill({ json: { ok: true, result: { ok: false, code: "stale" } } });
				});
				const prefix = lang === "fr" ? "Modifier" : "Edit";
				const edits = page.getByRole("button", { name: new RegExp(`^${prefix} .+\\d`) });
				// Literal indices cover heading, paragraph, leaf item, choice, caption.
				for (const index of [0, 2, 4, 5, 8]) {
					const edit = edits.nth(index);
					await edit.scrollIntoViewIfNeeded();
					const previous = index > 0 ? edits.nth(index - 1) : undefined;
					const before = previous
						? await previous.evaluate((el) => scrollY + el.getBoundingClientRect().top)
						: 0;
					const flow = await openField(edit);
					const field = page.getByRole("textbox");
					await expect(field).toBeFocused();

					await clearOfControls(page, `${index}: opened`, flow);
					if (previous) {
						expect(
							await previous.evaluate((el) => scrollY + el.getBoundingClientRect().top),
						).toBeCloseTo(before, 0);
						await previous.scrollIntoViewIfNeeded();
						expect(
							await previous.evaluate((el) => {
								const box = el.getBoundingClientRect();
								return (
									(el.getRootNode() as ShadowRoot).elementFromPoint(
										box.x + box.width / 2,
										box.y + box.height / 2,
									) === el
								);
							}),
						).toBe(true);
					}
					const origin = await field.evaluate((el) => {
						const host = (el.getRootNode() as ShadowRoot).host;
						return { id: host.id, y: host.getBoundingClientRect().y, scroll: scrollY };
					});
					const distance = origin.scroll >= 300 ? -300 : 300;
					// One layout snapshot avoids mixing Firefox viewport reads from different frames.
					const moved = await page.evaluate(
						({ id, y, scroll, distance }) => {
							const host = document.getElementById(id);
							if (!host) throw new Error("Missing in-flow host");
							window.scrollTo({ top: scroll + distance, behavior: "instant" });
							const top = host.getBoundingClientRect().y;
							return { scroll: scrollY - scroll, shift: top - y };
						},
						{ ...origin, distance },
					);
					expect(moved).toEqual({
						scroll: expect.closeTo(distance, 0),
						shift: expect.closeTo(-distance, 0),
					});
					await field.fill("Kept text");
					await field.press("Enter");
					await expect(field).toHaveAttribute("aria-invalid", "true");
					await clearOfControls(page, `${index}: save refused`, flow);
					if (previous) {
						await previous.scrollIntoViewIfNeeded();
						const target = await previous.boundingBox();
						if (!target) throw new Error("Missing neighbouring Edit button");
						await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
						await expect(field).toHaveValue("Kept text");
					}
					await field.press("Escape");
					await expect(
						page.getByRole("group", {
							name: lang === "fr" ? "Abandonner votre texte conservé ?" : "Discard your kept text?",
							exact: true,
						}),
					).toBeVisible();
					await clearOfControls(page, `${index}: discard confirmation`, flow);
					await page
						.getByRole("button", {
							name: lang === "fr" ? "Abandonner le texte" : "Discard text",
							exact: true,
						})
						.click();
					await expect(field).toHaveCount(0);
					await disposeFlow(flow);
					const reopenedFlow = await openField(edit);
					await field.fill("Unconfirmed text");
					unknown = true;
					await field.press("Enter");
					await expect(
						page.getByRole("button", {
							name: lang === "fr" ? "Vérifier le texte enregistré" : "Check saved bytes",
							exact: true,
						}),
					).toBeVisible();
					await clearOfControls(page, `${index}: unknown save`, reopenedFlow);
					unknown = false;
					await field.press("Escape");
					await page
						.getByRole("button", {
							name: lang === "fr" ? "Abandonner le texte" : "Discard text",
							exact: true,
						})
						.click();
					await expect(field).toHaveCount(0);
					await disposeFlow(reopenedFlow);
				}
				const dir = process.env.C09B_SHOTS;
				if (dir) {
					await mkdir(dir, { recursive: true });
					await page.screenshot({
						path: join(dir, `${lang}-${mode}-${width}x${height}-closed.png`),
					});
					await edits.nth(5).click();
					await page.screenshot({ path: join(dir, `${lang}-${mode}-${width}x${height}-open.png`) });
				}
			});

test("C09b refresh reanchors choice buttons in reading and Tab order", async ({ page }) => {
	await open(page);
	const revision = page.url();
	await writeFile(
		join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
		content.replace("( ) Alpha\n( ) Beta\n( ) Gamma", "( ) Gamma\n( ) Beta\n( ) Alpha"),
	);
	await expect(page).not.toHaveURL(revision);
	const buttons = page.getByRole("button", { name: /^Edit choice label/ });
	expect(
		await buttons.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
	).toEqual([
		"Edit choice label 1: Gamma",
		"Edit choice label 2: Beta",
		"Edit choice label 3: Alpha",
	]);
	await buttons.first().focus();
	await page.keyboard.press("Tab");
	await expect(buttons.nth(1)).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(buttons.nth(2)).toBeFocused();
});

test("C09b caption controls never name the figure", async ({ page, browserName, context }) => {
	await open(page);
	const figure = page.getByRole("figure");
	await expect(figure).toHaveAccessibleName("First caption. Second caption.");
	if (browserName === "chromium") {
		const client = await context.newCDPSession(page);
		const tree = await client.send("Accessibility.getFullAXTree");
		const figures = tree.nodes.filter((node) => node.role?.value === "figure");
		expect(figures).toHaveLength(1);
		// Chromium's closed native figure name is empty. C15 owns the spoken-name check.
		expect(figures[0].name?.value).toBe("");
		await client.detach();
	}
	await page.getByRole("button", { name: "Edit caption 1: First caption.", exact: true }).click();
	await expect(figure).toHaveAccessibleName("First caption. Second caption.");
});

test("C09b open-time fallback recaptures a moved flow slot on reopen", async ({ page }) => {
	await open(
		page,
		"en",
		"light",
		'body.reopen-fallback:has(:is(h1,h2,h3)[style*="display: none"]){opacity:0!important}',
	);
	// Keep the same document while moving the sibling and reopening.
	let builds = 0;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method === "canvasPreviewBuild") {
			builds++;
			return route.abort("failed");
		}
		return route.continue();
	});
	const edit = page.getByRole("button", { name: "Edit heading 1: Practice", exact: true });
	await edit.evaluate((button) => {
		(button.getRootNode() as ShadowRoot).host.after(document.createComment("movable flow sibling"));
	});
	const firstFlow = await openField(edit);
	await clearOfControls(page, "first open", firstFlow);
	await page.getByRole("textbox").press("Escape");
	await expect(page.getByRole("textbox")).toHaveCount(0);
	await expect.poll(() => builds).toBe(1);
	await firstFlow.evaluate(({ next }) => {
		if (!next) throw new Error("Missing sibling to move before reopening");
		const moved = document.createElement("div");
		document.body.append(moved);
		moved.append(next);
		document.body.classList.add("reopen-fallback");
	});
	await disposeFlow(firstFlow);
	const reopenedFlow = await openField(edit);
	await expect(page.locator("body")).toHaveAttribute("inert", "");
	await clearOfControls(page, "open-time fallback after moving sibling", reopenedFlow);
	await disposeFlow(reopenedFlow);
});

test("C09b fallback makes the course inert and restores it on cancel", async ({ page }) => {
	await open(page, "en", "light", "body:focus-within{opacity:0!important}");
	await page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }).click();
	await expect(page.getByRole("textbox")).toBeFocused();
	await expect(page.locator("body")).toHaveAttribute("inert", "");
	const before = page.url();
	const courseLink = page.locator(".praxity-text a").first();
	const box = await courseLink.boundingBox();
	if (!box) throw new Error("Missing inert course link");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	expect(page.url()).toBe(before);
	await expect(page.getByRole("textbox")).toBeFocused();
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let builds = 0;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method === "canvasPreviewBuild") {
			builds++;
			await held;
		}
		await route.continue();
	});
	try {
		await page.keyboard.press("Escape");
		await expect.poll(() => builds).toBe(1);
		await expect(page.locator("body")).not.toHaveAttribute("inert", "");
		await expect(
			page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }),
		).toBeFocused();
	} finally {
		release();
	}
});

test("C09b fallback keeps the author toggle usable at 320 by 240", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 240 });
	await open(page, "en", "light", "body:focus-within{opacity:0!important}");
	await page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }).click();
	await expect(page.locator("body")).toHaveAttribute("inert", "");
	const toggle = page.getByRole("button", { name: "Edit text", exact: true });
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator("body")).not.toHaveAttribute("inert", "");
});

test("C09b shortening a long paragraph stays in flow", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 568 });
	stop = await startJourney(page.context(), {
		standaloneSource: `# Practice\n\n${"Long authored paragraph. ".repeat(120)}\n`,
	});
	await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
	await page.getByRole("button", { name: /^Edit paragraph 1:/ }).click();
	const field = page.getByRole("textbox");
	await field.fill("Short paragraph.");
	await field.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	);
	await expect(page.locator("body")).not.toHaveAttribute("inert", "");
	await expect(field).toBeFocused();
	await field.press("Escape");
});

for (const scale of ["scaleX(.6)", "scaleY(.6)"])
	test(`C09b course CSS cannot shrink the in-flow field: ${scale}`, async ({ page }) => {
		await open(page, "en", "light", `body{transform:${scale}!important;transform-origin:left top}`);
		const edit = page.getByRole("button", { name: "Edit heading 1: Practice", exact: true });
		await edit.focus();
		await edit.press("Enter");
		await expect(page.getByRole("textbox")).toBeFocused();
		await expect(page.locator("body")).toHaveAttribute("inert", "");
		await expect(page.getByRole("textbox")).toBeFocused();
		await page.keyboard.press("Escape");
	});

test("C09b failure after mounting retires every Edit button", async ({ page }) => {
	stop = await startJourney(page.context(), { standaloneSource: content });
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let snapshots = 0;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method !== "canvasTextSnapshot") return route.continue();
		snapshots++;
		if (snapshots > 1) return route.abort();
		const response = await route.fetch();
		await held;
		return route.fulfill({ response });
	});
	try {
		await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
		await expect.poll(() => snapshots).toBe(1);
		await writeFile(
			join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
			content.replace("Second paragraph.", "Changed paragraph."),
		);
		// Event streams deliver their ready headers before watcher invalidations.
		await page.waitForTimeout(1500);
		release();
		await expect(page.getByRole("status")).toHaveText(
			"Studio could not connect. Reopen the Studio launch link.",
		);
		const toggle = page.getByRole("button", { name: "Edit text", exact: true });
		await expect(toggle).toBeDisabled();
		await expect(toggle).toHaveAttribute("aria-pressed", "false");
		await expect(page.getByRole("button", { name: /^Edit .+\d/ })).toHaveCount(0);
	} finally {
		release();
	}
});

for (const css of ["body{position:absolute;top:0;left:0;right:0}", "body{margin-top:-120px}"])
	for (const lang of ["en", "fr"])
		test(`C09b author band clears out-of-flow headers ${lang} ${css}`, async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await open(page, lang, "light", css);
			const panel = await hostBox(
				page.getByRole("button", {
					name: lang === "fr" ? "Modifier le texte" : "Edit text",
					exact: true,
				}),
			);
			for (const heading of await page.getByRole("heading").all()) {
				const box = await heading.boundingBox();
				if (box) expect(box.y).toBeGreaterThanOrEqual(panel.y + panel.height);
			}
		});

for (const edge of ["top", "bottom"])
	test(`C09b sticky ${edge} navigation receives clicks with a field open`, async ({ page }) => {
		// The script-free compiled top bar is hidden below 768px.
		await page.setViewportSize({ width: edge === "top" ? 1280 : 390, height: 844 });
		stop = await startJourney(page.context(), {
			standaloneSource: `---\ndesign:\n  navArchetype: bottomBar\n  navTopBar: true\n---\n\n${content}\n# Later page\n\nLater paragraph.\n`,
		});
		await project(page, "", (html) =>
			html.replace(
				edge === "top"
					? /(<div class="praxity-top-bar-fallback[^"]*"[^>]*>)/
					: /(<nav id="praxity-page-nav"[^>]*>)/,
				'$1<a href="#main-content">Sticky destination</a>',
			),
		);
		await page.goto(new URL("/launch?canvas=1", process.env.PRAXITY_BROWSER_READY_URL).href);
		await page.reload();
		await expect(page.getByRole("status")).toHaveText("Connected");
		await expect(page.locator("body")).toHaveCSS("font-family", /Source Sans 3/);
		const chrome = page
			.locator(edge === "top" ? ".praxity-top-bar-fallback" : "#praxity-page-nav")
			.first();
		await expect(chrome).toHaveCSS("position", "sticky");
		await expect(chrome).toBeVisible();
		expect(await chrome.innerHTML()).toContain("Sticky destination");
		// The probe link stays in each projection, including asynchronous saved refreshes.
		await page
			.getByRole("button", { name: "Edit choice label 1: Alpha", exact: true })
			.scrollIntoViewIfNeeded();
		await page
			.getByRole("link", { name: "Sticky destination", exact: true })
			.click({ trial: true });
		const flow = await openField(
			page.getByRole("button", { name: "Edit choice label 1: Alpha", exact: true }),
		);
		await expect(page.getByRole("textbox")).toBeFocused();
		await page.evaluate(() => scrollBy(0, 300));
		await page
			.getByRole("link", { name: "Sticky destination", exact: true })
			.click({ trial: true });
		await clearOfControls(page, `sticky ${edge}`, flow);
		await disposeFlow(flow);
	});

test("C09b enabled course radio never activates from its choice field", async ({ page }) => {
	await open(page);
	await page.locator('input[type="radio"]').evaluateAll((inputs) => {
		for (const input of inputs) if (input instanceof HTMLInputElement) input.disabled = false;
	});
	await page.getByRole("button", { name: "Edit choice label 1: Alpha", exact: true }).click();
	const field = page.getByRole("textbox");
	await page.locator("#hint:visible").click();
	await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
	await field.press("Escape");
});

test("C09b French choice reorder and caption tree names", async ({
	page,
	browserName,
	context,
}) => {
	await open(page, "fr");
	const revision = page.url();
	await writeFile(
		join(process.env.PRAXITY_BROWSER_PROJECT ?? "", "second.prax"),
		`---\nlang: fr\n---\n\n${content.replace("( ) Alpha\n( ) Beta\n( ) Gamma", "( ) Gamma\n( ) Beta\n( ) Alpha")}`,
	);
	await expect(page).not.toHaveURL(revision);
	const buttons = page.getByRole("button", { name: /^Modifier le libellé du choix/ });
	expect(
		await buttons.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))),
	).toEqual([
		"Modifier le libellé du choix 1 : Gamma",
		"Modifier le libellé du choix 2 : Beta",
		"Modifier le libellé du choix 3 : Alpha",
	]);
	await buttons.first().focus();
	await page.keyboard.press("Tab");
	await expect(buttons.nth(1)).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(buttons.nth(2)).toBeFocused();
	const figure = page.getByRole("figure");
	await expect(figure).toHaveAccessibleName("First caption. Second caption.");
	await page
		.getByRole("button", { name: "Modifier la légende 1 : First caption.", exact: true })
		.click();
	await expect(figure).toHaveAccessibleName("First caption. Second caption.");
	if (browserName === "chromium") {
		const client = await context.newCDPSession(page);
		const tree = await client.send("Accessibility.getFullAXTree");
		const figures = tree.nodes.filter((node) => node.role?.value === "figure");
		expect(figures).toHaveLength(1);
		expect(figures[0].name?.value).toBe("First caption. Second caption.");
		await client.detach();
	}
});

test("C09b caption field replaces its run before the next caption", async ({ page }) => {
	await open(page);
	await page.getByRole("button", { name: "Edit caption 1: First caption.", exact: true }).click();
	const field = page.getByRole("textbox");
	const next = page.locator("figcaption > span[data-node-id]").nth(1);
	const fieldBox = await field.boundingBox();
	const nextBox = await next.boundingBox();
	if (!fieldBox || !nextBox) throw new Error("Missing caption geometry");
	expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(nextBox.y);
	await expect(page.getByRole("figure")).toHaveAccessibleName("First caption. Second caption.");
	await field.press("Escape");
	await expect(page.getByRole("figure")).toHaveAccessibleName("First caption. Second caption.");
});

test("C09c author-panel pointerdown keeps the open field until activation", async ({ page }) => {
	await open(page);
	await page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }).click();
	const field = page.getByRole("textbox");
	await field.fill("Changed heading.");
	let applies = 0;
	page.on("request", (request) => {
		if (request.url().endsWith("/api/rpc") && request.postDataJSON().method === "canvasTextApply")
			applies++;
	});
	const toggle = page.getByRole("button", { name: "Edit text", exact: true });
	const box = await toggle.boundingBox();
	if (!box) throw new Error("Missing toggle");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await expect(field).toBeEditable();
	expect(applies).toBe(0);
	expect(await toggle.boundingBox()).toEqual(box);
	await page.mouse.up();
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(field).toHaveCount(0);
	expect(applies).toBe(1);
});

test("C09c wide author panel reserves one compact controls and status row", async ({ page }) => {
	await open(page);
	const box = await hostBox(page.getByRole("button", { name: "Edit text", exact: true }));
	expect(box.height).toBeLessThanOrEqual(58);
	if (process.env.C09C_SHOTS)
		await page.screenshot({ path: join(process.env.C09C_SHOTS, "author-panel-1280.png") });
});

test("C09c wrapped French status keeps author controls in place at 768px", async ({ page }) => {
	await page.setViewportSize({ width: 768, height: 900 });
	await open(page, "fr");
	const toggle = page.getByRole("button", { name: "Modifier le texte", exact: true });
	const initial = await toggle.boundingBox();
	if (!initial) throw new Error("Missing author toggle");
	let builds = 0;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method === "canvasPreviewBuild") {
			builds++;
			await route.abort("failed");
		} else await route.continue();
	});
	await page.getByRole("button", { name: "Modifier le titre 1 : Practice", exact: true }).click();
	await page.keyboard.press("Escape");
	await expect.poll(() => builds).toBe(1);
	const status = page.getByRole("status");
	await expect(status).toHaveText(
		"Studio n'a pas pu actualiser la page enregistrée. Rechargez pour réessayer.",
	);
	expect(
		await status.evaluate(
			(el) =>
				el.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(el).lineHeight),
		),
	).toBe(true);
	expect(await toggle.boundingBox()).toEqual(initial);
});

test("C09c fallback restores a body that was already inert before a held refresh", async ({
	page,
}) => {
	await open(page);
	await page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }).click();
	await page.locator("body").evaluate((el) => {
		if (!(el instanceof HTMLElement)) throw new Error("Missing course body");
		el.inert = true;
	});
	await expect
		.poll(() =>
			page.getByRole("textbox").evaluate((el) => {
				const root = el.getRootNode();
				return root instanceof ShadowRoot && root.host.matches(":popover-open");
			}),
		)
		.toBe(true);
	let release = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let builds = 0;
	await page.route("**/api/rpc", async (route) => {
		if (route.request().postDataJSON().method === "canvasPreviewBuild") {
			builds++;
			await held;
		}
		await route.continue();
	});
	try {
		await page.keyboard.press("Escape");
		await expect.poll(() => builds).toBe(1);
		await expect(page.locator("body")).toHaveAttribute("inert", "");
		const toggle = page.getByRole("button", { name: "Edit text", exact: true });
		await expect(toggle).toBeFocused();
		await expect(toggle).toHaveAttribute("aria-pressed", "true");
	} finally {
		release();
	}
});

test("C09c root paint rules leave the author controls visible", async ({ page }) => {
	await open(
		page,
		"en",
		"light",
		"html:focus-within{filter:opacity(0)!important;opacity:.02!important}",
	);
	await page.getByRole("button", { name: "Edit heading 1: Practice", exact: true }).click();
	await expect(page.locator("html")).toHaveCSS("opacity", "1");
	await expect(page.locator("html")).toHaveCSS("filter", "none");
	await expect(page.getByRole("textbox")).toBeFocused();
});

for (const lang of ["en", "fr"])
	test(`C09c caption context and exact names survive cancel and save before refresh ${lang}`, async ({
		page,
	}) => {
		await open(page, lang);
		const figure = page.getByRole("figure");
		const captions = page.getByRole("button", {
			name: lang === "fr" ? /^Modifier la légende/ : /^Edit caption/,
		});
		const names =
			lang === "fr"
				? ["Modifier la légende 1 : First caption.", "Modifier la légende 2 : Second caption."]
				: ["Edit caption 1: First caption.", "Edit caption 2: Second caption."];
		const previews = page.locator(".caption-context").filter({ hasText: /caption\./ });
		await expect(figure).toHaveAccessibleName("First caption. Second caption.");
		await expect(captions).toHaveText(lang === "fr" ? ["Modifier", "Modifier"] : ["Edit", "Edit"]);
		await expect(captions.nth(0)).toHaveAccessibleName(names[0]);
		await expect(captions.nth(1)).toHaveAccessibleName(names[1]);
		await expect(previews).toHaveText(["First caption.", "Second caption."]);
		expect(await previews.first().ariaSnapshot()).toBe("");
		expect(await previews.last().ariaSnapshot()).toBe("");
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let builds = 0;
		await page.route("**/api/rpc", async (route) => {
			if (route.request().postDataJSON().method === "canvasPreviewBuild") {
				builds++;
				await held;
			}
			await route.continue();
		});
		try {
			await captions.first().click();
			await expect(figure).toHaveAccessibleName("First caption. Second caption.");
			await expect(previews.first()).toBeHidden();
			await expect(previews.last()).toBeVisible();
			await page.keyboard.press("Escape");
			await expect.poll(() => builds).toBe(1);
			await expect(captions.first()).toBeFocused();
			await expect(figure).not.toHaveAttribute("aria-label");
			await expect(figure).not.toHaveAttribute("aria-labelledby");
			await expect(figure).toHaveAccessibleName("First caption. Second caption.");
			await expect(previews.first()).toBeVisible();
			await captions.first().click();
			await page.getByRole("textbox").fill("Saved caption.");
			await page.keyboard.press("Enter");
			await expect(page.getByRole("textbox")).toHaveCount(0);
			await expect(figure).not.toHaveAttribute("aria-label");
			await expect(figure).toHaveAccessibleName("Saved caption. Second caption.");
			await expect(
				page.locator(".caption-context").filter({ hasText: "Saved caption." }),
			).toBeVisible();
			await expect(captions.first()).toHaveAccessibleName(
				lang === "fr" ? "Modifier la légende 1 : Saved caption." : "Edit caption 1: Saved caption.",
			);
		} finally {
			release();
		}
	});

test("C09c long caption context clips at 24ch without changing the button name", async ({
	page,
}) => {
	const caption =
		"A long caption whose leading words identify the run without repeating the whole explanation in the editor.";
	await open(page, "en", "light", "", content.replace("First caption.", caption));
	const preview = page.locator(".caption-context").filter({ hasText: caption });
	await expect(preview).toBeVisible();
	expect(
		await preview.evaluate((el) => ({
			clipped: el.scrollWidth > el.clientWidth,
			width: el.getBoundingClientRect().width,
		})),
	).toMatchObject({ clipped: true });
	const box = await preview.boundingBox();
	if (!box) throw new Error("Missing caption context");
	expect(box.width).toBeLessThanOrEqual(200);
	await expect(page.getByRole("button", { name: /^Edit caption 1:/u })).toHaveAccessibleName(
		"Edit caption 1: A long caption whose leading words ident\u2026",
	);
});
