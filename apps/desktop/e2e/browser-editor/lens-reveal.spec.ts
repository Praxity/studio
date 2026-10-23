import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	expect,
	type Frame,
	type FrameLocator,
	type Locator,
	type Page,
	test,
} from "@playwright/test";
import type { FrameEventBody, FrameView } from "@praxity/editor-core/frame-bridge";
import { createSession } from "@praxity/editor-core/session";
import { compileCourse, deployCourse } from "@praxity/export-pipeline";
import { readLesson } from "@praxity/grammar";
import { build } from "esbuild";
import { createTranslator } from "use-intl/core";
import { buildFrameView } from "../../../../packages/editor-core/src/frame-bridge/view";
import { startStudioReadOnlyServer } from "../../src/main/studio/read-only-server";
import { rawCss } from "../raw-css";
import {
	assertHandlesUnobscured,
	assertHostileCourseInert,
	HOSTILE_ANCESTOR_FADE_CSS,
	HOSTILE_STATE_CSS,
	installHostileMarkup,
} from "./fixtures/hostile-course";

/**
 * P3b-3 reveal adapters. The real compiled course runs in the Page lens with course
 * scripts blocked, so interactive blocks keep their static server form. Every handle
 * stays reachable by Tab (F1): later card slides and conditional blocks are laid
 * open, and focusing a tab's handle shows its panel (F5).
 */
const source = `# Reveal

Intro paragraph.

::: cards Slide deck {layout=slides}
:: Slide one
Slide one body.
::: back
Slide one back.
:::
:: Slide two
Slide two body.
::: back
Slide two back.
:::
:: Slide three
Slide three body.
:::

::: cards Grid cards
:: Front one
Grid front body.
::: back
Grid back body.
:::
:::

::: tabs
:: First tab
Tab first body.
:: Second tab
Tab second body.
::: text {hide=true}
Conditional inside a tab.
:::
:::

::: accordion
:: First fold
Accordion first body.
:::

::: sequence
:: First step
Sequence first body.
:: Second step
Sequence second body.
:::

::: text {name=target hide=true}
Hidden conditional body.
:::

::: text {visible=ready}
Visible-when body.
:::

::: match Match them
- First -> Answer
- Second -> Other answer
:::

::: signature Confirm completion
sublabel: Your signature
:::

Closing paragraph.
`;
const channel = "lens-reveal-channel-0123456789abcdef";
let view: FrameView;
let host: ReturnType<typeof createServer>;
let browserServer: Awaited<ReturnType<typeof startStudioReadOnlyServer>>;
let hostOrigin: string;
const entries: Record<"light" | "dark", string> = { light: "", dark: "" };
let hostJs: string;
const releases: (() => Promise<void>)[] = [];

test.beforeAll(async () => {
	const root = resolve(import.meta.dirname, "../../../..");
	// Run `pnpm prebuild` first: this is the packaged bridge the product injects.
	const bridge = await readFile(
		join(root, "apps/desktop/resources/export-assets/inspection-frame.js"),
		"utf8",
	);
	const messages = JSON.parse(
		await readFile(resolve(root, "packages/editor-core/src/messages/en.json"), "utf8"),
	);
	const lesson = readLesson(source);
	if (lesson.hasErrors) throw new Error(JSON.stringify(lesson.errors));
	const page = lesson.pages[0];
	view = buildFrameView({
		lesson,
		file: "lesson.prax",
		pageId: page.id,
		session: createSession(),
		translate: createTranslator({ locale: "en", messages }),
	});
	// The host stands in for the controller: a reported focus becomes the view's focus and selection.
	const hostBundle = await build({
		stdin: {
			contents: `import {connectPageFrame} from './packages/editor-core/src/frame-bridge/transport.ts';
const frame=document.querySelector('iframe'); const params=new URLSearchParams(location.search);
const channel=${JSON.stringify(channel)}; const pageId=${JSON.stringify(page.id)};
let view={...${JSON.stringify(view)},alwaysShowHandles:params.get('handles')==='always'};
addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.origin==='null'&&e.data?.event==='inspect'&&e.data.channel===channel&&e.ports.length===1)e.ports[0].postMessage({source:'praxity-studio',version:1,action:'connect',channel,courseId:'lens-reveal',revision:'fixture',pageId})});
frame.src=window.entry+'?praxity-inspect=1&praxity-channel='+channel+'&praxity-parent-origin='+encodeURIComponent(location.origin);
const bridge=connectPageFrame({window,frame,frameOrigin:'null',channel,pageId,view,onEvent:e=>{(window.frameEvents??=[]).push(e);
	if(e.event==='focusChanged'){view={...view,focus:e.focus,selected:[e.focus.nodeId]};bridge.render(view);}
}});
`,
			resolveDir: root,
			loader: "ts",
		},
		bundle: true,
		plugins: [rawCss],
		write: false,
		platform: "browser",
		format: "iife",
	});
	hostJs = hostBundle.outputFiles[0].text;
	host = createServer((request, response) => {
		if (request.url === "/host.js") {
			response.setHeader("Content-Type", "text/javascript");
			response.end(hostJs);
			return;
		}
		const theme =
			new URL(request.url ?? "/", "http://fixture").searchParams.get("theme") === "dark"
				? "dark"
				: "light";
		response.setHeader("Content-Type", "text/html");
		response.end(
			`<!doctype html><html lang="en"><title>Reveal host</title><style>body{margin:0}iframe{display:block;border:0;width:100vw;height:100vh}</style><iframe title="Page"></iframe><script>window.entry=${JSON.stringify(entries[theme])}</script><script src="/host.js"></script></html>`,
		);
	});
	await new Promise<void>((ready) => host.listen(0, "127.0.0.1", ready));
	const address = host.address();
	if (!address || typeof address === "string") throw new Error("Reveal host did not bind");
	hostOrigin = `http://127.0.0.1:${address.port}`;
	browserServer = await startStudioReadOnlyServer({
		projectDir: await mkdtemp(join(tmpdir(), "lens-reveal-")),
		getEditorOrigin: () => hostOrigin,
		getInspectionScript: async () => bridge,
	});
	for (const colorMode of ["light", "dark"] as const) {
		const artifact = await compileCourse(
			{
				id: "lens-reveal",
				title: "Reveal",
				sourceLocale: "en",
				colorMode,
				content: [{ id: page.id, title: "Reveal", blocks: page.blocks }],
			},
			{ prebuiltAssetsDir: join(root, "apps/desktop/resources/export-assets") },
		);
		releases.push(() => artifact.dispose());
		const hosted = await browserServer.hostCourseArtifact(
			await deployCourse(artifact, { format: "electron-preview" }),
		);
		releases.push(() => hosted.release());
		entries[colorMode] = new URL(`${artifact.manifest.pages[0].slug}.html`, hosted.entryUrl).href;
	}
});

test.afterAll(async () => {
	for (const release of releases.reverse()) await release();
	await browserServer?.close();
	await new Promise((done) => host?.close(done));
});

const node = (name: string) => {
	const found = view.nodes.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`Missing view node: ${name}`);
	return found;
};
const handleOf = (frame: FrameLocator, name: string) =>
	frame.locator(`button[data-focus-role="handle"][data-node-id="${node(name).id}"]`);

async function openLens(
	page: Page,
	options: { theme?: "light" | "dark"; handles?: "always" } = {},
) {
	await page.goto(
		`${hostOrigin}/?theme=${options.theme ?? "light"}&handles=${options.handles ?? "hover"}`,
	);
	const frame = page.frameLocator('iframe[title="Page"]');
	await expect(handleOf(frame, "Page: Reveal")).toBeAttached({ timeout: 30_000 });
	return frame;
}

/** Real course invokers open no dialog or popover over the handles, by click or hover. */
async function assertInvokersOpenNothing(page: Page, content: Frame) {
	for (const id of ["hostile-modal-opener", "hostile-popover-opener", "hostile-interest"]) {
		const opener = content.locator(`#${id}`);
		await expect(opener).toHaveAttribute("tabindex", "-1");
		const box = await opener.boundingBox();
		if (!box) throw new Error(`Missing ${id}`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.up();
	}
	// Interest invokers open after a hover delay; stay over the last one past it.
	await page.waitForTimeout(1500);
	expect(
		await content.evaluate(() => ({
			modal: document.querySelector(":modal")?.id ?? null,
			popover: document.querySelector("#hostile-popover")?.matches(":popover-open") ?? null,
			dialog: document.querySelector<HTMLDialogElement>("#hostile-dialog")?.open ?? null,
		})),
	).toEqual({ modal: null, popover: false, dialog: false });
	await page.mouse.move(0, 0);
}

const focusColour = { light: [0x1f, 0x4f, 0xd8], dark: [0x8a, 0xa8, 0xff] };
const paperColour = { light: [0xfc, 0xfc, 0xfd], dark: [0x22, 0x27, 0x2e] };
/**
 * Reads the painted handle: computed box-shadow and zoom report unzoomed values, so
 * this checks pixels. `ring` is the nearest distance to the focus colour 2-4px outside
 * the left edge; `glyph` the largest distance from the paper colour inside the glyph.
 */
async function renderedHandle(page: Page, handle: Locator, theme: "light" | "dark") {
	const box = await handle.boundingBox();
	if (!box) throw new Error("Missing handle box");
	const clip = { x: Math.round(box.x) - 6, y: Math.round(box.y) - 6, width: 36, height: 36 };
	const png = await page.screenshot({ clip });
	const image = await page.evaluate(async (data) => {
		const element = new Image();
		element.src = `data:image/png;base64,${data}`;
		await element.decode();
		const canvas = document.createElement("canvas");
		canvas.width = element.width;
		canvas.height = element.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("No canvas");
		context.drawImage(element, 0, 0);
		return {
			width: element.width,
			data: [...context.getImageData(0, 0, element.width, element.height).data],
		};
	}, png.toString("base64"));
	const at = (x: number, y: number) =>
		image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
	const distance = (a: number[], b: number[]) =>
		Math.hypot(...a.map((value, index) => value - b[index]));
	const left = Math.round(box.x) - clip.x;
	const middle = Math.round(box.y + box.height / 2) - clip.y;
	const ring = Math.min(
		...[2, 3, 4].map((offset) => distance(at(left - offset, middle), focusColour[theme])),
	);
	const centre = Math.round(box.x + box.width / 2) - clip.x;
	let glyph = 0;
	for (let x = centre - 5; x <= centre + 5; x++)
		for (let y = middle - 5; y <= middle + 5; y++)
			glyph = Math.max(glyph, distance(at(x, y), paperColour[theme]));
	return { ring, glyph };
}

/** Waits for the controller's round trip: the focused node is selected in the frame. */
async function focusSettled(frame: FrameLocator, name: string) {
	const handle = handleOf(frame, name);
	await expect(handle).toBeFocused();
	await expect(handle).toHaveAttribute("data-selected", "");
	return handle;
}

test("course scripts stay blocked and hostile markup stays inert while slides are laid open", async ({
	page,
}) => {
	const frame = await openLens(page);
	await expect(frame.locator('script:not([type="application/json"])')).toHaveCount(1);
	await expect(handleOf(frame, "Card 2 of 3: Slide two")).toBeVisible();
	const content = page.frames().find((candidate) => candidate.url().includes("praxity-inspect=1"));
	if (!content) throw new Error("Missing inspection frame");
	await installHostileMarkup(content, {
		channel,
		pageId: view.pageId,
		file: view.file,
		nodeId: node("Card 2 of 3: Slide two").id,
		parentOrigin: hostOrigin,
	});
	await assertHostileCourseInert(content);
	await expect(handleOf(frame, "Paragraph: Slide two body.")).toBeVisible();
});

test("F1 Tab reaches every handle in reading order, revealing tab panels as their handles take focus", async ({
	page,
}) => {
	const frame = await openLens(page);
	await handleOf(frame, "Page: Reveal").focus();
	const reached: string[] = [];
	for (let step = 0; step <= view.nodes.length; step++) {
		const id = await frame
			.locator(":focus")
			.evaluate((element) =>
				element.matches('button[data-focus-role="handle"]')
					? (element as HTMLElement).dataset.nodeId
					: undefined,
			);
		// Past the last handle, Tab leaves the frame and its last focus remains.
		if (!id || id === reached.at(-1)) break;
		// Text blocks and their paragraph share a name; settle by identity.
		const handle = frame.locator(`button[data-focus-role="handle"][data-node-id="${id}"]`);
		await expect(handle).toHaveAttribute("data-selected", "");
		reached.push(id);
		await page.keyboard.press("Tab");
	}
	expect(reached).toEqual(view.nodes.map((candidate) => candidate.id));
});

test("Tab retains resize subscriptions and does not rewrite unchanged tabindex", async ({
	page,
}, testInfo) => {
	await page.addInitScript(() => {
		const effects = { resizeDeliveries: 0, unchangedResizeDeliveries: 0, tabindexWrites: 0 };
		const sizes = new WeakMap<Element, string>();
		const NativeResizeObserver = window.ResizeObserver;
		window.ResizeObserver = class extends NativeResizeObserver {
			constructor(callback: ResizeObserverCallback) {
				super((entries, observer) => {
					effects.resizeDeliveries++;
					let changed = false;
					for (const entry of entries) {
						const size = `${entry.contentRect.width},${entry.contentRect.height}`;
						if (sizes.get(entry.target) !== size) changed = true;
						sizes.set(entry.target, size);
					}
					if (!changed) effects.unchangedResizeDeliveries++;
					callback.call(observer, entries, observer);
				});
			}
		};
		new MutationObserver((records) => {
			effects.tabindexWrites += records.filter((record) =>
				(record.target as Element).matches('button[data-focus-role="handle"]'),
			).length;
		}).observe(document, { subtree: true, attributes: true, attributeFilter: ["tabindex"] });
		Object.assign(window, { lensTabEffects: effects });
	});
	const frame = await openLens(page);
	const content = page.frames().find((candidate) => candidate.url().includes("praxity-inspect=1"));
	if (!content) throw new Error("Missing inspection frame");
	const probe = await content.evaluateHandle(
		() =>
			Reflect.get(window, "lensTabEffects") as {
				resizeDeliveries: number;
				unchangedResizeDeliveries: number;
				tabindexWrites: number;
			},
	);
	const settle = () =>
		content.evaluate(async () => {
			await document.fonts.ready;
			for (let frame = 0; frame < 3; frame++)
				await new Promise<void>((done) => requestAnimationFrame(() => done()));
		});
	const samples = [];
	try {
		await handleOf(frame, "Page: Reveal").focus();
		await focusSettled(frame, "Page: Reveal");
		await settle();
		for (let step = 0; step < 8; step++) {
			await probe.evaluate((effects) => {
				effects.resizeDeliveries = 0;
				effects.unchangedResizeDeliveries = 0;
				effects.tabindexWrites = 0;
			});
			await page.keyboard.press("Tab");
			await expect(frame.locator(":focus")).toHaveAttribute("data-selected", "");
			await settle();
			samples.push(await probe.evaluate((effects) => ({ ...effects })));
		}
		await testInfo.attach("tab-effects", {
			body: JSON.stringify(samples),
			contentType: "application/json",
		});
		for (const effects of samples) {
			expect(effects.tabindexWrites).toBe(0);
			expect(effects.unchangedResizeDeliveries).toBe(0);
			expect(effects.resizeDeliveries).toBeLessThanOrEqual(1);
		}
	} finally {
		await probe.dispose();
	}
});

test("Tab to a hidden slide or conditional block shows it, focuses its named handle and keeps learner semantics quiet", async ({
	page,
}) => {
	const frame = await openLens(page);
	for (const [before, hidden, content] of [
		["Paragraph: Slide one back.", "Card 2 of 3: Slide two", "Slide two body."],
		["Paragraph: Slide two back.", "Card 3 of 3: Slide three", "Slide three body."],
		[
			"Paragraph: Sequence second body.",
			"Paragraph: Hidden conditional body.",
			"Hidden conditional body.",
		],
		["Tab 2 of 2: Second tab", "Paragraph: Tab second body.", "Tab second body."],
		[
			"Paragraph: Tab second body.",
			"Paragraph: Conditional inside a tab.",
			"Conditional inside a tab.",
		],
		["Pair: Second", "Signature: Confirm completion", "Confirm completion"],
	]) {
		await handleOf(frame, before).focus();
		await focusSettled(frame, before);
		await page.keyboard.press("Tab");
		const handle = await focusSettled(frame, hidden);
		await expect(handle).toBeVisible();
		await expect(handle).toHaveAccessibleName(hidden);
		const text = frame.getByText(content, { exact: true }).first();
		await expect(text).toBeVisible();
		// No ancestor hides the revealed content from assistive technology or opacity.
		expect(
			await text.evaluate((element) => {
				for (let el: Element | null = element; el; el = el.parentElement)
					if (
						el.closest("[inert],[aria-hidden='true'],[hidden]") ||
						getComputedStyle(el).opacity === "0"
					)
						return false;
				return true;
			}),
		).toBe(true);
	}
	// Laid-open slides keep the learner carousel controls out of the Tab order.
	for (const control of await frame
		.locator("[data-card-root] button:not([data-praxity-chrome])")
		.all())
		await expect(control).toHaveAttribute("tabindex", "-1");
});

test("F11 a keyboard-focused block handle stacks above its item-handle neighbours, so they never cover its ring", async ({
	page,
}) => {
	const frame = await openLens(page, { handles: "always" });
	const block = handleOf(frame, "Cards: Slide deck");
	await handleOf(frame, "Page: Reveal").focus();
	await focusSettled(frame, "Page: Reveal");
	// Keyboard modality, so the ring is drawn through :focus-visible.
	while (!(await block.evaluate((element) => element === document.activeElement)))
		await page.keyboard.press("Tab");
	await focusSettled(frame, "Cards: Slide deck");
	expect(await block.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
	const zIndex = (name: string) =>
		handleOf(frame, name).evaluate((element) => Number(getComputedStyle(element).zIndex));
	expect(await zIndex("Cards: Slide deck")).toBeGreaterThan(await zIndex("Card 1 of 3: Slide one"));
	// Top-layer handles paint in the order they were shown, whatever their z-index. Find
	// two handles whose hit extensions meet outside both buttons: whichever has focus
	// paints on top there, so one of the two directions needs the focused handle re-shown.
	const pair = await block.evaluate((anchor: HTMLButtonElement) => {
		const doc = anchor.ownerDocument;
		const reach = (button: Element, grow: number) => {
			const box = button.getBoundingClientRect();
			return {
				left: box.left - grow,
				top: box.top - grow,
				right: box.right + grow,
				bottom: box.bottom + grow,
			};
		};
		const inside = (box: ReturnType<typeof reach>, x: number, y: number) =>
			x > box.left && x < box.right && y > box.top && y < box.bottom;
		const handles = [
			...doc.querySelectorAll<HTMLButtonElement>('button[data-focus-role="handle"]'),
		].filter((button) => !button.hidden);
		for (const a of handles)
			for (const b of handles) {
				if (a === b) continue;
				const outer = reach(a, 10);
				for (let x = Math.ceil(outer.left); x < outer.right; x++)
					for (let y = Math.ceil(outer.top); y < outer.bottom; y++)
						if (
							inside(reach(b, 10), x, y) &&
							!inside(reach(a, 0), x, y) &&
							!inside(reach(b, 0), x, y)
						)
							return { ids: [a.dataset.nodeId ?? "", b.dataset.nodeId ?? ""], x, y };
			}
		return null;
	});
	if (!pair) throw new Error("No two handles' hit extensions meet");
	for (const id of pair.ids) {
		const handle = frame.locator(`button[data-focus-role="handle"][data-node-id="${id}"]`);
		await handle.focus();
		await expect(handle).toHaveAttribute("data-selected", "");
		expect(
			await handle.evaluate(
				(element, { x, y }) => element.ownerDocument.elementFromPoint(x, y) === element,
				pair,
			),
		).toBe(true);
	}
	// The laid-open deck's learner-only controls stay out of the accessibility tree.
	await expect(frame.locator(".praxity-card-controls")).toHaveAttribute("inert", "");
	for (const flip of await frame.locator("[data-card-flip]").all())
		await expect(flip).toHaveAttribute("inert", "");
});

for (const theme of ["light", "dark"] as const)
	test(`F11 hostile course CSS cannot cover or hide handles or their focus rings (${theme})`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(300_000);
		const frame = await openLens(page, { theme, handles: "always" });
		const content = page
			.frames()
			.find((candidate) => candidate.url().includes("praxity-inspect=1"));
		if (!content) throw new Error("Missing inspection frame");
		await installHostileMarkup(
			content,
			{
				channel,
				pageId: view.pageId,
				file: view.file,
				nodeId: node("Card 2 of 3: Slide two").id,
				parentOrigin: hostOrigin,
			},
			true,
		);
		await assertInvokersOpenNothing(page, content);
		// Keyboard modality, so programmatic focus matches :focus-visible.
		await handleOf(frame, "Page: Reveal").focus();
		await page.keyboard.press("Tab");
		expect((await assertHandlesUnobscured(content)).length).toBeGreaterThan(30);
		// The guard's interactivity reset leaves the inert attribute working.
		expect(
			await content.evaluate(() => {
				const control = document.querySelector<HTMLElement>("[inert] button");
				control?.focus();
				return !!control && document.activeElement !== control;
			}),
		).toBe(true);
		// Under ancestor zoom the box is compensated but the ring and glyph must render
		// at full size too, and course CSS cannot hide the glyph dots.
		for (const name of ["Cards: Slide deck", "Card 1 of 3: Slide one"]) {
			const handle = handleOf(frame, name);
			await handle.evaluate(async (button) => {
				button.nextElementSibling?.scrollIntoView({ block: "center" });
				await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
				button.focus({ preventScroll: true });
				await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
			});
			const rendered = await renderedHandle(page, handle, theme);
			expect(rendered.ring, `${name} ring colour distance`).toBeLessThan(80);
			expect(rendered.glyph, `${name} glyph contrast`).toBeGreaterThan(100);
			// Course generated content cannot rewrite the description AT reads.
			await expect(handle).toHaveAccessibleDescription(node(name).description);
		}
		const captures = process.env.PRAXITY_LENS_SCREENSHOTS;
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
			await content.evaluate(async () => {
				scrollTo(0, 0);
				await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
			});
			if (captures)
				await page.screenshot({
					path: join(captures, `${testInfo.project.name}-${theme}-${width}-hostile.png`),
				});
		}
		await page.setViewportSize({ width: 1280, height: 900 });
		// The pointer and faded-ancestor passes do not depend on the theme.
		if (theme === "dark") return;
		// A real mouse click at each centre reaches the handle through the overlay.
		await page.evaluate(() => Object.assign(window, { frameEvents: [] }));
		const clicked: string[] = [];
		for (const handle of await frame.locator('button[data-focus-role="handle"]').all()) {
			const id = await handle.evaluate(async (button: HTMLButtonElement) => {
				if (button.hidden) return null;
				const node = button.nextElementSibling;
				// A display:contents node (a matching pair's row) has no box to scroll to.
				(node && getComputedStyle(node).display === "contents"
					? node.firstElementChild
					: node
				)?.scrollIntoView({ block: "center" });
				await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
				return button.dataset.nodeId ?? "";
			});
			if (id === null) continue;
			await handle.click({ timeout: 5000 });
			clicked.push(id);
		}
		expect(clicked.length).toBeGreaterThan(30);
		await expect
			.poll(() =>
				page.evaluate(() =>
					(window as unknown as { frameEvents: FrameEventBody[] }).frameEvents.flatMap((event) =>
						event.event === "intent" && event.intent === "actions" ? [event.focus.nodeId] : [],
					),
				),
			)
			.toEqual(clicked);
		// Fade every ancestor out: only the top layer can still show a handle.
		await content.evaluate((css) => {
			const style = document.createElement("style");
			style.textContent = css;
			document.head.append(style);
		}, HOSTILE_ANCESTOR_FADE_CSS);
		// The clicks above set pointer modality; Tab restores keyboard modality for the rings.
		await handleOf(frame, "Page: Reveal").focus();
		await page.keyboard.press("Tab");
		expect((await assertHandlesUnobscured(content)).length).toBeGreaterThan(30);
		for (const name of ["Cards: Slide deck", "Card 1 of 3: Slide one"]) {
			const handle = handleOf(frame, name);
			await handle.evaluate(async (button) => {
				button.nextElementSibling?.scrollIntoView({ block: "center" });
				await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
			});
			const clip = await handle.boundingBox();
			if (!clip) throw new Error(`Missing ${name} box`);
			const shown = await page.screenshot({ clip });
			// Inline !important on chrome is the test's own toggle; the lens ignores chrome mutations.
			await handle.evaluate(async (button) => {
				button.style.setProperty("visibility", "hidden", "important");
				await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
			});
			const hidden = await page.screenshot({ clip });
			await handle.evaluate((button) => button.style.removeProperty("visibility"));
			expect(shown.equals(hidden), `${name} paints under faded ancestors`).toBe(false);
		}
		if (captures)
			await page.screenshot({
				path: join(captures, `${testInfo.project.name}-${theme}-1280-faded-ancestors.png`),
			});
	});

test("F11 in hover mode, the handle of the node under the pointer shows through a course overlay", async ({
	page,
}) => {
	// Hover is the shipped default (CourseArtifactFrame).
	const frame = await openLens(page);
	const content = page.frames().find((candidate) => candidate.url().includes("praxity-inspect=1"));
	if (!content) throw new Error("Missing inspection frame");
	await installHostileMarkup(
		content,
		{
			channel,
			pageId: view.pageId,
			file: view.file,
			nodeId: node("Card 2 of 3: Slide two").id,
			parentOrigin: hostOrigin,
		},
		true,
	);
	// A text block and its paragraph share a name; the pointer selects the innermost.
	const innermost = (name: string) =>
		view.nodes.filter((candidate) => candidate.name === name).at(-1)?.id ?? "";
	const opacity = (name: string) =>
		frame
			.locator(`button[data-focus-role="handle"][data-node-id="${innermost(name)}"]`)
			.evaluate((button) => getComputedStyle(button).opacity);
	for (const [name, other] of [
		["Paragraph: Intro paragraph.", "Paragraph: Slide one body."],
		["Paragraph: Slide one body.", "Paragraph: Intro paragraph."],
	]) {
		const content = frame.locator(`[data-node-id="${innermost(name)}"]:not([data-praxity-chrome])`);
		await content.evaluate((element) => element.scrollIntoView({ block: "center" }));
		const box = await content.boundingBox();
		if (!box) throw new Error(`Missing ${name} box`);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect.poll(() => opacity(name)).toBe("1");
		await expect.poll(() => opacity(other)).toBe("0");
	}
	// A patch re-creates the handle of the node it replaces. With the pointer still over
	// that node, the new handle shows too.
	await frame
		.locator(
			`[data-node-id="${innermost("Paragraph: Slide one body.")}"]:not([data-praxity-chrome])`,
		)
		.evaluate((element) => {
			element.previousElementSibling?.remove();
			element.replaceWith(element.cloneNode(true));
		});
	await expect.poll(() => opacity("Paragraph: Slide one body.")).toBe("1");
	await page.mouse.move(0, 0);
});

test("F11 moving focus to a tab handle leaves its aria-expanded and other handles alone while the panels switch", async ({
	page,
}) => {
	const frame = await openLens(page, { handles: "always" });
	const first = handleOf(frame, "Tab 1 of 2: First tab");
	await first.focus();
	await focusSettled(frame, "Tab 1 of 2: First tab");
	const second = handleOf(frame, "Tab 2 of 2: Second tab");
	await second.evaluate((button) => {
		const changes: string[] = [];
		const toggles: string[] = [];
		Object.assign(window, { expandedChanges: changes, popoverToggles: toggles });
		// The neutral pass would close and re-show every open handle; focusing re-shows
		// only the focused one, to stack it on top.
		const bystander = button.ownerDocument.querySelector('button[data-focus-role="handle"]');
		bystander?.addEventListener("beforetoggle", (event) =>
			toggles.push((event as ToggleEvent).newState),
		);
		new MutationObserver((records) => {
			for (const record of records) changes.push(String(record.oldValue));
		}).observe(button, {
			attributes: true,
			attributeOldValue: true,
			attributeFilter: ["aria-expanded"],
		});
	});
	// Selecting the second tab hides the first panel with the hidden attribute. That is
	// markup, not CSS keyed to handle state, so no neutral re-measurement runs.
	await second.focus();
	await focusSettled(frame, "Tab 2 of 2: Second tab");
	await page.waitForTimeout(300);
	expect(
		await second.evaluate(
			() => (window as unknown as { expandedChanges: string[] }).expandedChanges,
		),
		// Rewriting the same value is harmless; removing it (old value null) is not.
	).not.toContain("null");
	expect(
		await second.evaluate(() => (window as unknown as { popoverToggles: string[] }).popoverToggles),
	).toEqual([]);
});

test("F11 course CSS that hides a node while its handle has state cannot break the lens", async ({
	page,
}) => {
	const frame = await openLens(page, { handles: "always" });
	const content = page.frames().find((candidate) => candidate.url().includes("praxity-inspect=1"));
	if (!content) throw new Error("Missing inspection frame");
	await content.evaluate((css) => {
		const errors: string[] = [];
		Object.assign(window, { hostileErrors: errors });
		addEventListener("error", (event) => errors.push(event.message));
		const style = document.createElement("style");
		style.textContent = css;
		document.head.append(style);
	}, HOSTILE_STATE_CSS);
	// Placement settles: no handle keeps flipping between shown and hidden.
	await page.waitForTimeout(300);
	expect(
		await content.evaluate(async () => {
			let changes = 0;
			const observer = new MutationObserver((records) => {
				changes += records.length;
			});
			for (const button of document.querySelectorAll('button[data-focus-role="handle"]'))
				observer.observe(button, { attributes: true, attributeFilter: ["hidden"] });
			await new Promise((done) => setTimeout(done, 500));
			observer.disconnect();
			return changes;
		}),
	).toBe(0);
	// The keyboard lens keeps working: each Tab lands on the next handle and stays there.
	await handleOf(frame, "Page: Reveal").focus();
	for (let step = 0; step < 6; step++) {
		await page.keyboard.press("Tab");
		const focused = () =>
			content.evaluate(() =>
				document.activeElement?.matches('button[data-focus-role="handle"]')
					? (document.activeElement as HTMLElement).dataset.nodeId
					: document.activeElement?.tagName,
			);
		const landed = await focused();
		expect(view.nodes.some((candidate) => candidate.id === landed)).toBe(true);
		await page.waitForTimeout(400);
		expect(await focused()).toBe(landed);
	}
	expect(
		await content.evaluate(() => (window as unknown as { hostileErrors: string[] }).hostileErrors),
	).toEqual([]);
});

test("matching pairs, whose rows are display:contents, get visible handles beside their prompts", async ({
	page,
}) => {
	const frame = await openLens(page);
	for (const name of ["Pair: First", "Pair: Second"]) {
		const handle = handleOf(frame, name);
		await expect(handle).toBeVisible();
		await handle.focus();
		await focusSettled(frame, name);
		const [handleBox, promptBox] = await Promise.all([
			handle.boundingBox(),
			frame.getByText(name.replace("Pair: ", ""), { exact: true }).boundingBox(),
		]);
		if (!handleBox || !promptBox) throw new Error(`Missing boxes for ${name}`);
		expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(promptBox.x);
		expect(
			Math.abs(handleBox.y + handleBox.height / 2 - (promptBox.y + promptBox.height / 2)),
		).toBeLessThan(promptBox.height);
	}
});

for (const width of [1280, 390])
	test(`WCAG 2.5.8: handles keep target spacing at ${width}px while the page scrolls`, async ({
		page,
	}) => {
		await page.setViewportSize({ width, height: 900 });
		const frame = await openLens(page, { handles: "always" });
		const crowded: string[] = [];
		// The first panel shows on load; the second, with its nested conditional, on focus.
		for (const tab of ["Tab 1 of 2: First tab", "Tab 2 of 2: Second tab"]) {
			await handleOf(frame, tab).focus();
			await focusSettled(frame, tab);
			crowded.push(
				...(await frame.locator("body").evaluate(async (_, tab) => {
					const failures: string[] = [];
					// Handles clamp to the viewport edges, so check every scroll position.
					const end = document.documentElement.scrollHeight - innerHeight;
					for (let scroll = 0; scroll < end + 50; scroll += 50) {
						scrollTo(0, Math.min(scroll, end));
						await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
						const handles = [
							...document.querySelectorAll<HTMLElement>('button[data-focus-role="handle"]'),
						]
							.filter((button) => !button.hidden)
							.map((button) => {
								const box = button.getBoundingClientRect();
								return {
									name: button.getAttribute("aria-label"),
									box,
									x: box.left + box.width / 2,
									y: box.top + box.height / 2,
									undersized: box.width < 24 || box.height < 24,
								};
							});
						// Targets must not overlap. A 24 px circle centred on a target must not
						// intersect another target; circles of two undersized targets must not
						// intersect each other. Firefox rounds fixed positions by under 0.001px.
						const slack = 0.01;
						const reach = (x: number, y: number, box: DOMRect) =>
							Math.hypot(
								Math.max(box.left - x, 0, x - box.right),
								Math.max(box.top - y, 0, y - box.bottom),
							);
						for (const [index, a] of handles.entries())
							for (const b of handles.slice(index + 1))
								if (
									(a.box.left < b.box.right - slack &&
										b.box.left < a.box.right - slack &&
										a.box.top < b.box.bottom - slack &&
										b.box.top < a.box.bottom - slack) ||
									reach(a.x, a.y, b.box) < 12 - slack ||
									reach(b.x, b.y, a.box) < 12 - slack ||
									(a.undersized && b.undersized && Math.hypot(a.x - b.x, a.y - b.y) < 24 - slack)
								)
									failures.push(
										`${tab}, scroll ${scrollY}: ${a.name} (${a.x}, ${a.y}) and ${b.name} (${b.x}, ${b.y})`,
									);
					}
					return failures;
				}, tab)),
			);
		}
		expect(crowded).toEqual([]);
	});

test("handles placed while a flip card's back face animates stay beside their content after it ends", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 900 });
	const frame = await openLens(page, { handles: "always" });
	const names = [
		"Paragraph: Slide one back.",
		"Paragraph: Slide two back.",
		"Paragraph: Grid back body.",
	];
	const misplaced = await frame.locator("body").evaluate(async (_, names) => {
		const frames = () =>
			new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
		const faces = [...document.querySelectorAll(".praxity-flashcard-face--back")];
		// The course's back face rises in with a transform, which makes it the handles'
		// containing block until the animation ends. Replay it slowly and place the
		// handles mid-animation, as a render during the reveal does.
		const style = document.createElement("style");
		style.textContent =
			"@keyframes lens-test-rise{from{transform:translateY(6px)}to{transform:none}}.praxity-flashcard-face--back{animation:lens-test-rise 1s !important}";
		document.head.append(style);
		const ended = Promise.all(
			faces.map(
				(face) =>
					new Promise<void>((done) =>
						// The course's own back-face animation may still be ending; wait for this one.
						face.addEventListener("animationend", (event) => {
							if ((event as AnimationEvent).animationName === "lens-test-rise") done();
						}),
					),
			),
		);
		await frames();
		dispatchEvent(new Event("resize"));
		await frames();
		await ended;
		await frames();
		const failures: string[] = [];
		for (const name of names) {
			const handle = document.querySelector(
				`button[data-focus-role="handle"][aria-label="${name}"]`,
			);
			const content = handle?.nextElementSibling;
			if (!handle || !content) throw new Error(`Missing handle or content for ${name}`);
			const box = handle.getBoundingClientRect();
			const target = content.getBoundingClientRect();
			const centre = box.top + box.height / 2;
			if (box.left < 0 || box.right > target.left || centre < target.top || centre > target.bottom)
				failures.push(
					`${name} at (${box.left}, ${box.top}) beside (${target.left}, ${target.top})`,
				);
		}
		return failures;
	}, names);
	expect(misplaced).toEqual([]);
});

// Review evidence for the lead. Set PRAXITY_LENS_REVEAL_SCREENSHOTS to an external folder.
const screenshots = process.env.PRAXITY_LENS_REVEAL_SCREENSHOTS;
for (const theme of ["light", "dark"] as const)
	for (const width of [1280, 390])
		test(`adapted blocks in the lens, ${theme} ${width}px`, async ({ page, browserName }) => {
			test.skip(!screenshots || browserName !== "chromium", "Screenshot capture only");
			if (!screenshots) return;
			await mkdir(screenshots, { recursive: true });
			await page.setViewportSize({ width, height: 900 });
			const frame = await openLens(page, { theme, handles: "always" });
			for (const [label, name, block] of [
				["slides", "Cards: Slide deck", "Cards: Slide deck"],
				["tabs", "Tab 2 of 2: Second tab", "Tabs: First tab"],
				[
					"conditional",
					"Paragraph: Hidden conditional body.",
					"Paragraph: Hidden conditional body.",
				],
				["matching", "Match: Match them", "Match: Match them"],
			]) {
				await handleOf(frame, name).focus();
				await focusSettled(frame, name);
				await handleOf(frame, block).evaluate((element) =>
					element.nextElementSibling?.scrollIntoView({ block: "start" }),
				);
				await page.screenshot({ path: join(screenshots, `${label}-${theme}-${width}.png`) });
			}
		});
