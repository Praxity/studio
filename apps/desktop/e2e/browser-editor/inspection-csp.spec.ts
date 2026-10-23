import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { expect, type Frame, test } from "@playwright/test";
import type { FrameEventBody, FrameView } from "@praxity/editor-core/frame-bridge";
import {
	type CourseArtifactByteRange,
	type CoursePreviewDeployment,
	compileCourse,
	deployCourse,
} from "@praxity/export-pipeline";
import { build } from "esbuild";
import { startStudioReadOnlyServer } from "../../src/main/studio/read-only-server";
import { rawCss } from "../raw-css";
import { installHostileMarkup } from "./fixtures/hostile-course";

// Chromium 147 aborts the browser (SIGTRAP, a null CHECK in NetworkHandler::GetResponseBody)
// when Playwright 1.59's tracing reads a response body after these specs' cross-origin
// navigations swap the renderer. Traces stay off here until Playwright 1.64+, which detaches
// obsolete sessions before reading bodies. Assertions are unchanged.
test.use({ trace: "off" });

const view: FrameView = {
	file: "lesson.prax",
	pageId: "page",
	language: "en",
	alwaysShowHandles: true,
	escapeEnabled: true,
	nodes: [
		{ id: "page", kind: "page", parentId: null, name: "Course", description: "Course." },
		{ id: "text", kind: "block", parentId: "page", name: "Text", description: "Static text." },
	],
	selected: [],
	expanded: [],
	focus: null,
};
// The product's URL parameters and handshake: CourseArtifactFrame names the page over the offered port.
const channel = "inspection-channel-0123456789abcdef";
const attack = `window.sentinel = true;
const key = Object.getOwnPropertyDescriptor(KeyboardEvent.prototype, 'key').get;
Object.defineProperty(KeyboardEvent.prototype, 'key', {configurable:true,get(){return key.call(this)==='F2'?'Escape':key.call(this)}});
const dialog = document.querySelector('#hostile-dialog');
if (dialog && dialog.requestClose) { dialog.showModal(); dialog.requestClose(); window.requestCloseRan = true; }
navigator.serviceWorker?.register('./worker.js').then(() => window.workerRegistered=true).catch(() => window.workerRefused=true);`;
const planted = `<script type="module" src="planted.js"></script><script>${attack}</script>
<svg><script>window.sentinel=true</script></svg>
<img src="missing-image.png" onerror="window.sentinel=true" alt="Fixture">
<button id="hostile-handler" onclick="window.sentinel=true">Authored handler</button>
<iframe title="Hostile srcdoc" srcdoc="&lt;script&gt;parent.sentinel=true&lt;/script&gt;"></iframe>
<dialog id="hostile-dialog">Authored dialog</dialog>
<img id="course-image" src="course-image.png" alt="Course image">`;
// A 1x1 PNG, served from the captured artifact like any course image.
const courseImage = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
	"base64",
);
// CourseArtifactFrame's sandbox makes the inspection origin opaque from creation, unlike the CSP
// sandbox alone. WebKit then matches 'self' against nothing, so read the course resources it gates.
async function courseResources(frame: Frame) {
	return frame.evaluate(async () => {
		await document.fonts.load('16px "Source Sans 3"').catch(() => []);
		const image = document.querySelector<HTMLImageElement>("#course-image");
		if (image && !image.complete)
			await new Promise((done) => {
				image.addEventListener("load", done, { once: true });
				image.addEventListener("error", done, { once: true });
			});
		return {
			fontFamily: getComputedStyle(document.body).fontFamily,
			fonts: [...document.fonts]
				.filter((face) => face.family.includes("Source Sans 3"))
				.map((face) => face.status),
			imageWidth: image?.naturalWidth ?? -1,
		};
	});
}
function expectCourseResources(resources: Awaited<ReturnType<typeof courseResources>>) {
	expect(resources.fontFamily).toContain("Source Sans 3");
	expect(resources.fonts).toContain("loaded");
	expect(resources.imageWidth).toBe(1);
}
let host: ReturnType<typeof createServer>;
let browserServer: Awaited<ReturnType<typeof startStudioReadOnlyServer>>;
let hostOrigin: string;
let browserEntry: string;
let hostJs: string;
let fontFile: string;
const releases: (() => Promise<void>)[] = [];

async function listen(server: ReturnType<typeof createServer>) {
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Fixture did not bind");
	return `http://127.0.0.1:${address.port}`;
}

test.beforeAll(async () => {
	const root = resolve(import.meta.dirname, "../../../..");
	const bridge = await readFile(
		join(root, "apps/desktop/resources/export-assets/inspection-frame.js"),
		"utf8",
	);
	const scratch = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "inspection-browser-"),
	);
	const hostBundle = await build({
		stdin: {
			contents: `import {connectPageFrame} from './packages/editor-core/src/frame-bridge/transport.ts';
const frame=document.querySelector('iframe'); window.events=[];
const channel=${JSON.stringify(channel)};
addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.origin==='null'&&e.data?.event==='inspect'&&e.data.channel===channel&&e.ports.length===1)e.ports[0].postMessage({source:'praxity-studio',version:1,action:'connect',channel,courseId:'inspection-course',revision:'fixture',pageId:'page'})});
frame.src=window.entry.replace(/[^/]*$/,new URLSearchParams(location.search).get('page')??window.entry.split('/').pop())+'?praxity-inspect=1&praxity-channel='+channel+'&praxity-parent-origin='+encodeURIComponent(location.origin);
window.bridge=connectPageFrame({window,frame,frameOrigin:'null',channel,pageId:'page',view:${JSON.stringify(view)},onEvent:e=>window.events.push(e)});
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
	host = createServer((req, res) => {
		if (req.url === "/host.js") {
			res.setHeader("Content-Type", "text/javascript");
			res.end(hostJs);
			return;
		}
		res.setHeader("Content-Type", "text/html");
		res.end(
			`<!doctype html><title>Inspection host</title><iframe title="Page" sandbox="allow-scripts"></iframe><script>window.entry=${JSON.stringify(browserEntry)}</script><script src="/host.js"></script>`,
		);
	});
	hostOrigin = await listen(host);
	browserServer = await startStudioReadOnlyServer({
		projectDir: scratch,
		getEditorOrigin: () => hostOrigin,
		getInspectionScript: async () => bridge,
	});
	const artifact = await compileCourse(
		{
			id: "inspection-course",
			title: "Course",
			sourceLocale: "en",
			content: [
				{
					id: "page",
					title: "Course",
					blocks: [
						{ id: "text", type: "text", data: { content: "<p>Static course text.</p>" } },
						{
							id: "checklist",
							type: "checklist",
							data: { items: [{ id: "item", text: "Static checklist" }] },
						},
					],
				},
			],
		},
		{ prebuiltAssetsDir: join(root, "apps/desktop/resources/export-assets") },
	);
	releases.push(() => artifact.dispose());
	async function course() {
		const deployment = await deployCourse(artifact, { format: "electron-preview" });
		const files = new Map<string, Buffer>();
		for (const file of deployment.manifest.files) {
			const stream = await deployment.openFile(file.path);
			const chunks: Buffer[] = [];
			for await (const chunk of stream) chunks.push(Buffer.from(chunk));
			let bytes = Buffer.concat(chunks);
			if (file.mediaType.startsWith("text/html"))
				bytes = Buffer.from(
					bytes
						.toString()
						.replace(
							"</head>",
							`<script src="bridge.js" data-parent="${hostOrigin}" data-channel="inspection" data-page-id="page"></script></head>`,
						)
						.replace("</body>", planted + "</body>"),
				);
			files.set(file.path, bytes);
		}
		files.set("planted.js", Buffer.from(attack));
		files.set("course-image.png", courseImage);
		// Course content that navigates on its own: a refresh, and a link the author can follow.
		const entry = `${deployment.manifest.pages[0].slug}.html`;
		const entryHtml = files.get(entry)?.toString();
		if (!entryHtml) throw new Error("Missing compiled entry page");
		files.set(
			"refresh.html",
			Buffer.from(
				entryHtml
					.replace("</head>", '<meta http-equiv="refresh" content="0;url=escaped.html"></head>')
					.replace("</body>", '<a href="escaped.html">Escape link</a></body>'),
			),
		);
		files.set(
			"escaped.html",
			Buffer.from(
				'<!doctype html><title>Escaped</title><p>Escaped page</p><script src="planted.js"></script>',
			),
		);
		files.set(
			"worker.js",
			Buffer.from(
				"self.addEventListener('fetch',event=>event.respondWith(new Response('<script>window.sentinel=true</script>')));",
			),
		);
		files.set("bridge.js", Buffer.from(bridge));
		const manifest = {
			...deployment.manifest,
			files: [...files].map(([path, bytes]) => ({
				path,
				byteLength: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				mediaType: path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".html")
						? "text/html; charset=utf-8"
						: path.endsWith(".png")
							? "image/png"
							: (deployment.manifest.files.find((f) => f.path === path)?.mediaType ??
								"application/octet-stream"),
			})),
		};
		const captured: CoursePreviewDeployment = {
			...deployment,
			manifest,
			openFile: async (path: string, range?: CourseArtifactByteRange) => {
				const bytes = files.get(path);
				if (!bytes) throw new Error("Unlisted fixture file");
				return Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]);
			},
		};
		return captured;
	}
	const capturedCourse = await course();
	const font = capturedCourse.manifest.files.find((file) => file.path.endsWith(".woff2"));
	if (!font) throw new Error("Missing captured course font");
	fontFile = font.path;
	const browserHosted = await browserServer.hostCourseArtifact(capturedCourse);
	browserEntry = new URL(artifact.manifest.pages[0].slug + ".html", browserHosted.entryUrl).href;
});

for (const kind of ["browser"] as const)
	test(`${kind} inspection realms cannot reach each other and load course fonts`, async ({
		page,
	}) => {
		await page.goto(`${hostOrigin}/?server=${kind}`);
		const inspected = page.frames().find((frame) => frame !== page.mainFrame());
		if (!inspected) throw new Error("Missing inspection frame");
		await expect(inspected.getByRole("button", { name: "Text", exact: true })).toBeVisible();
		const loadsCourseResources = true;
		if (loadsCourseResources) expectCourseResources(await courseResources(inspected));
		await page.evaluate((src) => {
			const frame = document.createElement("iframe");
			frame.title = "Second inspection";
			frame.src = src;
			// Deliberately over-permissive mount: the response must still isolate it.
			frame.sandbox.add("allow-scripts", "allow-same-origin");
			document.body.append(frame);
		}, inspected.url());
		const other = page
			.mainFrame()
			.childFrames()
			.find((frame) => frame !== inspected);
		if (!other) throw new Error("Missing second inspection frame");
		await other.waitForURL(inspected.url());
		for (const [frame, index] of [
			[other, 0],
			[inspected, 1],
		] as const)
			expect(
				await frame.evaluate((target) => {
					try {
						const doc = parent.frames[target].document;
						const script = doc.createElement("script");
						script.nonce = doc.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
						script.textContent = "window.sentinel=true";
						doc.head.append(script);
						return "injected";
					} catch (error) {
						return (error as DOMException).name;
					}
				}, index),
			).toBe("SecurityError");
		expect(await inspected.evaluate(() => Reflect.get(window, "sentinel") ?? false)).toBe(false);
		if (loadsCourseResources) {
			const font = await inspected.evaluate(async (path) => {
				const face = new FontFace(
					"Isolation fixture",
					`url("${new URL(path, location.href).href}")`,
				);
				document.fonts.add(face);
				await face.load();
				return face.status;
			}, fontFile);
			expect(font).toBe("loaded");
		}
		await page.evaluate(() =>
			Reflect.get(window, "bridge").focus({
				file: "lesson.prax",
				nodeId: "text",
				role: "handle",
			}),
		);
		await expect(inspected.getByRole("button", { name: "Text", exact: true })).toBeFocused();
	});

test.afterAll(async () => {
	await browserServer?.close();
	for (const release of releases.reverse()) await release();
	for (const server of [host].filter(Boolean))
		await new Promise<void>((done, fail) =>
			server.close((error) => (error ? fail(error) : done())),
		);
});

for (const kind of ["browser"] as const)
	test(`${kind} inspection blocks course execution and preserves real keys and focus under hostile markup`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.assign(window, { violations: [] });
			window.addEventListener("securitypolicyviolation", (event) =>
				(window as unknown as { violations: string[] }).violations.push(event.effectiveDirective),
			);
		});
		await page.goto(`${hostOrigin}/?server=${kind}`);
		const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
		if (!frame) throw new Error("Missing inspection frame");
		const handle = frame.getByRole("button", { name: "Text", exact: true });
		await expect(handle).toBeVisible();
		const inspected = () =>
			frame.evaluate(() => ({
				sentinel: (window as unknown as { sentinel?: boolean }).sentinel ?? false,
				requestCloseRan:
					(window as unknown as { requestCloseRan?: boolean }).requestCloseRan ?? false,
				violations: (window as unknown as { violations: string[] }).violations,
			}));
		expect(await inspected()).toMatchObject({ sentinel: false, requestCloseRan: false });
		await expect.poll(async () => (await inspected()).violations).toContain("script-src-attr");
		const registrations = await frame.evaluate(async () => {
			try {
				return navigator.serviceWorker
					? (await navigator.serviceWorker.getRegistrations()).length
					: 0;
			} catch (error) {
				return (error as DOMException).name;
			}
		});
		// Chromium refuses even reading this API in an opaque document.
		expect([0, "SecurityError"]).toContain(registrations);
		// JSON data blocks stay for the logic overlay; they never execute.
		await expect(frame.locator('script:not([type="application/json"])')).toHaveCount(1);
		await expect(frame.locator('[data-island="checklist"]')).toHaveCount(1);
		await installHostileMarkup(
			frame,
			{
				channel,
				pageId: "page",
				file: "lesson.prax",
				nodeId: "text",
				parentOrigin: hostOrigin,
			},
			true,
		);
		await handle.focus();
		await expect(handle).toBeFocused();
		await page.evaluate(() => Object.assign(window, { events: [] }));
		await page.keyboard.press("F2");
		const events = () =>
			page.evaluate(() => (window as unknown as { events: FrameEventBody[] }).events);
		await expect
			.poll(async () =>
				(await events()).some((event) => event.event === "intent" && event.intent === "source"),
			)
			.toBe(true);
		expect((await events()).some((event) => event.event === "escape")).toBe(false);
		await page.keyboard.press("Escape");
		await expect
			.poll(async () => (await events()).some((event) => event.event === "escape"))
			.toBe(true);
		await expect(handle).toBeFocused();
		expect(await inspected()).toMatchObject({ sentinel: false, requestCloseRan: false });
	});

test("browser learner preview cannot install a worker on the inspection origin", async ({
	page,
}) => {
	// The real planted module attempts registration. It runs here under the unchanged learner CSP.
	await page.goto(hostOrigin);
	// CourseArtifactFrame keys its iframe by mode, so learner preview is a new element with the
	// browser learner sandbox. Re-pointing the inspection element instead could leave macOS
	// Chromium's frame handle closed just after the learner page committed.
	await page.evaluate((entry) => {
		const frame = document.createElement("iframe");
		frame.title = "Learner";
		frame.setAttribute(
			"sandbox",
			"allow-downloads allow-forms allow-presentation allow-same-origin allow-scripts",
		);
		frame.src = entry;
		document.body.append(frame);
	}, browserEntry);
	const frame = await (
		await page.locator('iframe[title="Learner"]').elementHandle()
	)?.contentFrame();
	if (!frame) throw new Error("Missing learner frame");
	await frame.waitForURL(browserEntry);
	await expect
		.poll(() =>
			frame.evaluate(() => (window as unknown as { workerRefused?: boolean }).workerRefused),
		)
		.toBe(true);
	expect(
		await frame.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
	).toBe(0);
});

for (const kind of ["browser"] as const)
	test(`${kind} learner and popup cannot copy the inspection nonce`, async ({ page }) => {
		const entry = browserEntry;
		await page.context().route(new URL("planted.js", entry).href, (route) =>
			route.fulfill({
				contentType: "text/javascript",
				body: `try {
const target = opener ? opener.frames[0] : parent.frames[0];
const doc = target.document;
const script = doc.createElement('script');
script.nonce = doc.querySelector('script[nonce]').nonce;
script.textContent = 'window.sentinel=true';
doc.head.append(script);
window.nonceAttack = 'injected';
} catch (error) { window.nonceAttack = error.name; }`,
			}),
		);
		await page.goto(`${hostOrigin}/?server=${kind}`);
		const inspected = page.frames().find((frame) => frame !== page.mainFrame());
		if (!inspected) throw new Error("Missing inspection frame");
		await expect(inspected.getByRole("button", { name: "Text", exact: true })).toBeVisible();
		await page.evaluate((src) => {
			const frame = document.createElement("iframe");
			frame.title = "Learner";
			frame.src = src;
			document.body.append(frame);
		}, entry);
		const learner = page.frameLocator('iframe[title="Learner"]');
		await expect(learner.locator("body")).toBeVisible();
		const learnerFrame = page.frames().find((frame) => frame.url() === entry);
		if (!learnerFrame) throw new Error("Missing learner frame");
		await expect
			.poll(() => learnerFrame.evaluate(() => Reflect.get(window, "nonceAttack")))
			.toBe("SecurityError");
		expect(await inspected.evaluate(() => Reflect.get(window, "sentinel") ?? false)).toBe(false);
		const popupPromise = page.waitForEvent("popup");
		await page.evaluate((src) => window.open(src), entry);
		const popup = await popupPromise;
		await expect
			.poll(() => popup.evaluate(() => Reflect.get(window, "nonceAttack")))
			.toBe("SecurityError");
		expect(await inspected.evaluate(() => Reflect.get(window, "sentinel") ?? false)).toBe(false);
		await popup.close();
	});

for (const kind of ["browser"] as const)
	test(`${kind} nonce CSP enforces refusal even when script tags survive`, async ({ page }) => {
		await page.addInitScript(() => {
			Object.assign(window, { violations: [] });
			window.addEventListener("securitypolicyviolation", (event) =>
				(window as unknown as { violations: string[] }).violations.push(event.effectiveDirective),
			);
		});
		const entry = browserEntry;
		await page.route(`${entry}?*`, async (route) => {
			const response = await route.fetch();
			// Model a stripping defect at the HTTP boundary. These are course bytes, never evaluate calls.
			await route.fulfill({
				response,
				body: (await response.text()).replace(
					"</body>",
					`<script nonce="authored">window.sentinel=true</script><script type="module" src="planted.js"></script><svg><script>window.sentinel=true</script></svg><script src="https://www.youtube.com/iframe_api"></script></body>`,
				),
			});
		});
		await page.goto(`${hostOrigin}/?server=${kind}`);
		const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
		if (!frame) throw new Error("Missing inspection frame");
		await expect(frame.getByRole("button", { name: "Text", exact: true })).toBeVisible();
		await expect
			.poll(() => frame.evaluate(() => (window as unknown as { violations: string[] }).violations))
			.toContain("script-src-elem");
		expect(
			await frame.evaluate(() => (window as unknown as { sentinel?: boolean }).sentinel),
		).toBeUndefined();
	});

for (const kind of ["browser"] as const)
	test(`${kind} course navigation never leaves the inspection document`, async ({ page }) => {
		await page.goto(`${hostOrigin}/?server=${kind}&page=refresh.html`);
		const lens = page.frames().find((candidate) => candidate !== page.mainFrame());
		if (!lens) throw new Error("Missing inspection frame");
		await expect(lens.getByRole("button", { name: "Text", exact: true })).toBeVisible();
		const inspected = lens.url();
		expect(new URL(inspected).searchParams.get("praxity-inspect")).toBe("1");
		await lens.getByRole("link", { name: "Escape link" }).click();
		// Positive control, after the click: the same course page refreshes a learner frame away.
		const learnerUrl = inspected.replace(/\?.*$/, "");
		await page.evaluate((src) => {
			const frame = document.createElement("iframe");
			frame.title = "Learner";
			frame.src = src;
			document.body.append(frame);
		}, learnerUrl);
		await expect
			.poll(() => page.frames().map((frame) => frame.url().split("?")[0].split("/").pop()))
			.toContain("escaped.html");
		expect(lens.url()).toBe(inspected);
		expect(page.frames().filter((frame) => frame.url().endsWith("escaped.html"))).toHaveLength(1);
		await expect(lens.getByRole("button", { name: "Text", exact: true })).toBeVisible();
	});
