import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import type { HostedCourseDeployment } from "../course-preview-service";
import { addStudioReadModeLink, serveStudioAuthorDocument } from "../studio/author-document";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { startStudioServer } from "../studio/server";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

it("executes the supplied canvas bundle before parsing course elements", async () => {
	const response = await serveStudioAuthorDocument(
		new Request("http://127.0.0.1:9000/canvas"),
		"<!doctype html><html><head></head><body><p>Course</p></body></html>",
		"http://127.0.0.1:9001/course.html",
		"var PraxityCanvas={startStudioAuthor(){window.packagedCanvas=true}};/* </script> */",
	);
	const dom = new JSDOM(await response.text());
	try {
		const script = dom.window.document.querySelector("script");
		expect(script?.textContent).toContain("window.packagedCanvas=true");
		expect(script?.textContent).toContain("PraxityCanvas.startStudioAuthor(");
		expect(dom.window.document.head.firstElementChild).toBe(script);
		expect(dom.window.document.querySelectorAll("script")).toHaveLength(1);
	} finally {
		dom.window.close();
	}
});

it("admits the canvas mode through launch, preserving exact route and origin admission", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-canvas-"));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "project"));
	await mkdir(join(root, "editor"));
	await writeFile(join(root, "project/lesson.prax"), "# Title\n\nA **nested** word.\n");
	await writeFile(join(root, "editor/index.html"), "<!doctype html><title>Editor</title>");
	await writeFile(join(root, "editor/canvas.js"), "void 0;");
	await writeFile(
		join(root, "editor/canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	const server = await startStudioServer({
		projectDir: join(root, "project"),
		editorAssetsDir: join(root, "editor"),
		appVersion: "0.3.0",
	});
	cleanup.push(() => server.close());
	const response = await fetch(`${server.origin}/launch?canvas=1`, { redirect: "manual" });
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toMatch(/^\/canvas\?admission=[\w-]{43}$/);
	expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
	expect((await fetch(`${server.origin}/launch?canvas=1`, { method: "POST" })).status).toBe(405);
	expect((await fetch(`${server.origin}/canvas`, { redirect: "manual" })).status).toBe(401);
	const admission = new URL(response.headers.get("location") ?? "", server.origin);
	for (const route of [
		"/canvas?admission=wrong",
		`${admission.pathname}${admission.search}&extra=1`,
	])
		expect((await fetch(new URL(route, server.origin), { redirect: "manual" })).status).toBe(401);
	const navigation = await fetch(`${server.origin}/canvas?admission=wrong`, {
		headers: { "Sec-Fetch-Dest": "document" },
		redirect: "manual",
	});
	expect(navigation.status).toBe(303);
	expect(navigation.headers.get("location")).toBe("/#");
	expect(await navigation.text()).toBe("");
	const headNavigation = await fetch(`${server.origin}/canvas?admission=wrong`, {
		method: "HEAD",
		headers: { "Sec-Fetch-Dest": "document" },
		redirect: "manual",
	});
	expect(headNavigation.status).toBe(401);
	expect(headNavigation.headers.get("location")).toBeNull();
	expect((await fetch(admission, { method: "HEAD", redirect: "manual" })).status).toBe(405);
	expect((await fetch(admission, { redirect: "manual" })).status).toBe(401);
	const unavailable = await fetch(`${server.origin}/launch?canvas=1`, { redirect: "manual" });
	expect(
		(
			await fetch(new URL(unavailable.headers.get("location") ?? "", server.origin), {
				redirect: "manual",
			})
		).status,
	).toBe(503);
	const outstanding = [];
	for (let index = 0; index < 9; index++) {
		const launched = await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" });
		outstanding.push(new URL(launched.headers.get("location") ?? "", server.origin));
	}
	// Eight live one-use admissions survive other tabs; the oldest ninth admission is evicted.
	expect((await fetch(outstanding[0], { redirect: "manual" })).status).toBe(401);
	for (const pending of outstanding.slice(1, -1)) {
		expect((await fetch(pending, { redirect: "manual" })).status).toBe(503);
		expect((await fetch(pending, { redirect: "manual" })).status).toBe(401);
	}
	const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
	try {
		expect((await fetch(outstanding[8], { redirect: "manual" })).status).toBe(401);
	} finally {
		clock.mockRestore();
	}
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	for (const route of [
		"/launch?canvas=1&extra=1",
		"/launch?canvas=%31",
		"/launch?canvas=%",
		"/launch?canvas=https://evil.test",
		`/launch?canvas=${encodeURIComponent("/preview/missing.html")}`,
		"/canvas/../course.yaml",
	]) {
		expect((await fetch(`${server.origin}${route}`, { redirect: "manual" })).status).toBe(404);
	}
	for (const origin of ["null", "https://evil.test", "http://127.0.0.1:1"]) {
		const denied = await fetch(`${server.origin}/launch?canvas=1`, {
			headers: { Origin: origin },
			redirect: "manual",
		});
		expect(denied.status).toBe(403);
		expect(denied.headers.has("access-control-allow-origin")).toBe(false);
	}
});

it("projects hostile compiled HTML under a fresh nonce with assets on the learner origin", async () => {
	const { serveStudioAuthorDocument } = await import("../studio/author-document");
	const html = `<!doctype html><html lang="fr"><head><base href="http://evil.test/">
	<script src="course.js"></script><script nonce="forged">window.courseRan=true</script>
	<meta http-equiv="refresh" content="0;url=http://evil.test/"></head><body onload="window.courseRan=true">
	<p data-node-id="renderer-node">A <strong>nested</strong> word.</p>
	<button data-node-id="forged" data-praxity-author-control="save" onclick="window.courseRan=true"
	 command="show-modal" commandfor="target" popovertarget="target" interestfor="target">Forged</button>
	<div popover id="target"></div><div><template shadowrootmode="closed"><script>window.courseRan=true</script></template></div>
	<style>* { display:none !important; color:transparent !important }</style></body></html>`;
	const nonces = [];
	for (let i = 0; i < 2; i++) {
		const response = await serveStudioAuthorDocument(
			new Request("http://127.0.0.1:9000/canvas"),
			html,
			"http://127.0.0.1:9001/preview/captured/index.html",
			"/* packaged canvas */",
		);
		const policy = response.headers.get("content-security-policy") ?? "";
		const nonce = policy.match(/script-src 'nonce-([^']+)'/)?.[1];
		expect(nonce).toBeTruthy();
		nonces.push(nonce);
		expect(policy.split("; ").some((directive) => directive.startsWith("sandbox"))).toBe(false);
		expect(policy).toContain("script-src-attr 'none'");
		expect(policy).toContain("connect-src 'self'");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		const dom = new JSDOM(await response.text());
		try {
			const doc = dom.window.document;
			expect(doc.querySelectorAll('script:not([type="application/json"])')).toHaveLength(1);
			expect(doc.querySelector("script")?.getAttribute("nonce")).toBe(nonce);
			expect(doc.querySelector("base")?.href).toBe(
				"http://127.0.0.1:9001/preview/captured/index.html",
			);
			expect(doc.querySelectorAll("base")).toHaveLength(1);
			expect(
				doc.querySelectorAll(
					"[onload],[onclick],[command],[commandfor],[popovertarget],[interestfor],meta[http-equiv]",
				),
			).toHaveLength(0);
			expect(doc.querySelector("template")?.hasAttribute("shadowrootmode")).toBe(false);
			expect(doc.querySelector("p strong")?.textContent).toBe("nested");
			expect(doc.querySelector("iframe")).toBeNull();
		} finally {
			dom.window.close();
		}
	}
	expect(nonces[0]).not.toBe(nonces[1]);
});

it("splices only an escaped localized mode link at the parsed body boundary", async () => {
	for (const [lang, label] of [
		["en", "Edit text"],
		["fr", "Modifier le texte"],
	]) {
		const html = `<!doctype html>\r\n<html lang=${lang}><head><script>const fake = '<body>';</script></head><body data-empty><p title='One &amp; two'>A &#x26; B</p></body></html>\r\n`;
		const actual = await addStudioReadModeLink(
			html,
			'http://127.0.0.1:9000/launch?canvas=one&label="two"',
		);
		const injected = `<a href="http://127.0.0.1:9000/launch?canvas=one&amp;label=&quot;two&quot;" rel="noreferrer" style="position:relative;z-index:2147483647">${label}</a>`;
		expect(actual).toContain(`<body data-empty>${injected}<p`);
		expect(actual.replace(injected, "")).toBe(html);
	}
	await expect(
		addStudioReadModeLink("<!-- no body boundary -->", "http://127.0.0.1:9000/launch?canvas=1"),
	).rejects.toThrow("Captured document has no body insertion boundary");
});

it("splices the deck mode link into its flow without changing captured bytes", async () => {
	const html =
		'<!doctype html><html><body><div class="praxity-deck" data-island="deck"><header>Course / Module</header><main>Slide</main></div></body></html>';
	const actual = await addStudioReadModeLink(html, "http://127.0.0.1:9000/launch?canvas=1");
	const dom = new JSDOM(actual);
	try {
		const link = dom.window.document.querySelector("a");
		expect(link?.parentElement?.className).toBe("praxity-deck");
		expect(link?.nextElementSibling?.tagName).toBe("HEADER");
		expect(actual.replace(link?.outerHTML ?? "", "")).toBe(html);
	} finally {
		dom.window.close();
	}
});

it("removes noscript parse differentials, referrer overrides and rewrites fragment anchors", async () => {
	const html = `<!doctype html><html><head><meta name="referrer" content="unsafe-url"></head><body>
	<noscript><p title="</noscript><meta http-equiv='refresh' content='0;url=https://evil.test'><button data-focus-role='handle' popovertarget='x' data-praxity-author-control='save'>Forged</button><div><template shadowrootmode='open'>Shadow</template></div>"></p></noscript>
	<a href=" #main-content " referrerpolicy="unsafe-url">Skip</a><main id="main-content">Course</main></body></html>`;
	const response = await serveStudioAuthorDocument(
		new Request("http://127.0.0.1:9000/canvas/preview/page.html"),
		html,
		"http://127.0.0.1:9001/canvas/preview/page.html",
		"/* packaged canvas */",
	);
	expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
	const dom = new JSDOM(await response.text());
	try {
		expect(
			dom.window.document.querySelectorAll(
				"noscript,meta[name=referrer],[referrerpolicy],[data-focus-role],[popovertarget],[data-praxity-author-control]",
			),
		).toHaveLength(0);
		expect(dom.window.document.querySelector("a")?.getAttribute("href")).toBe(
			"http://127.0.0.1:9000/canvas/preview/page.html#main-content",
		);
	} finally {
		dom.window.close();
	}
});

it.each([false, true])("admits captured deck=%s scope and resources", async (deck) => {
	const server = await startStudioReadOnlyServer({
		projectDir: process.cwd(),
		getEditorOrigin: () => "http://127.0.0.1:9000",
	});
	cleanup.push(() => server.close());
	const files: Record<string, string> = {
		"index.html":
			'<!doctype html><html><body class="praxity-deck"><a href="second.html">Next</a></body></html>',
		"second.html": "\ufeff<!doctype html><html><body>Second</body></html>",
		"style.css": "body{color:red}",
	};
	const deployment: HostedCourseDeployment = {
		editorSeq: 42,
		format: "electron-preview",
		courseToken: "a".repeat(32),
		manifest: {
			version: 1,
			rendererContractVersion: 1,
			learnerStateSchemaVersion: 1,
			courseId: "canvas",
			revision: "b".repeat(64),
			entry: "index.html",
			pageCount: 2,
			pages: ["index", "second"].map((slug, pageIndex) => ({
				id: `page-${pageIndex}`,
				lessonId: "lesson",
				slug,
				runtime: { mode: "islands", islands: deck ? ["deck"] : [], legacyReasons: [] },
				statefulBlockIds: [],
			})),
			files: Object.entries(files).map(([path, html]) => ({
				path,
				byteLength: Buffer.byteLength(html),
				sha256: "c".repeat(64),
				mediaType: path.endsWith("html") ? "text/html; charset=utf-8" : "text/css",
			})),
		},
		openFile: async (path) => Readable.from([Buffer.from(files[path])]),
		dispose: async () => {},
	};
	const hosted = await server.hostCourseArtifact(deployment);
	const plain = new URL(hosted.entryUrl);
	const capturedScope = {
		editorSeq: 42,
		pageId: "page-0",
		lessonId: "lesson",
		pageIndex: 0,
		pageIds: ["page-0", "page-1"],
		sourceRevisions: undefined,
		allLessonPages: deck,
	};
	expect(server.canvasPageScope(plain.pathname)).toStrictEqual(capturedScope);
	const first = new URL(`/canvas${plain.pathname}`, plain.origin);
	expect(await (await fetch(first)).text()).toContain("Edit text");
	const second = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
		await (await fetch(new URL("second.html", first))).arrayBuffer(),
	);
	expect(
		second.replace(
			/<a href="[^"]+" rel="noreferrer" style="position:relative;z-index:2147483647">Edit text<\/a>/,
			"",
		),
	).toBe(files["second.html"]);
	expect(server.hasCanvasDocument(plain.pathname)).toBe(true);
	expect(server.hasCanvasDocument(new URL("style.css", plain).pathname)).toBe(false);
	expect(
		await server.readCanvasDocument(
			new URL("style.css", plain).pathname,
			new AbortController().signal,
		),
	).toBeNull();
	expect(server.hasCanvasDocument(`/preview/../..${plain.pathname}`)).toBe(false);
	for (const path of [plain, new URL("style.css", plain), new URL("style.css", first)]) {
		for (const origin of [
			undefined,
			server.origin,
			"http://127.0.0.1:9000",
			"http://127.0.0.1:9002",
			"https://evil.test",
		]) {
			const response = await fetch(path, { headers: origin ? { Origin: origin } : {} });
			expect(response.headers.get("access-control-allow-origin")).toBe(
				origin === "http://127.0.0.1:9000" && path.pathname.endsWith("css") ? origin : null,
			);
		}
	}
	await hosted.release();
	expect(server.hasCanvasDocument(plain.pathname)).toBe(false);
	expect(server.canvasPageScope(plain.pathname)).toStrictEqual(capturedScope);
	const replacement = await server.hostCourseArtifact({
		...deployment,
		sourceRevisions: { "a.prax": "fresh-source" },
	});
	expect(server.canvasPageScope(plain.pathname)?.sourceRevisions).toEqual({
		"a.prax": "fresh-source",
	});
	await replacement.release();
	expect(server.hasCanvasDocument(plain.pathname)).toBe(false);
	expect(server.canvasPageScope(plain.pathname)).toStrictEqual({
		...capturedScope,
		sourceRevisions: { "a.prax": "fresh-source" },
	});
	await server.close();
	expect(server.canvasPageScope(plain.pathname)).toBeUndefined();
	expect(server.origin).toBe(plain.origin);
});

it("admits compilation once, refuses absent and non-HTML launches, and retains older canvas revisions", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-canvas-"));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "project"));
	await mkdir(join(root, "editor"));
	await writeFile(join(root, "project/lesson.prax"), "# First\n\nRevision zero.\n");
	await writeFile(join(root, "editor/index.html"), "<!doctype html><title>Editor</title>");
	await writeFile(join(root, "editor/canvas.js"), "void 0;");
	await writeFile(
		join(root, "editor/canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	const server = await startStudioServer({
		projectDir: join(root, "project"),
		editorAssetsDir: join(root, "editor"),
		appVersion: "0.3.0",
		exportAssetsDir: fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
	});
	cleanup.push(() => server.close());
	const crossSite = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors" };
	expect(
		(await fetch(`${server.origin}/canvas`, { headers: crossSite, redirect: "manual" })).status,
	).toBe(401);
	let previous = "";
	for (let i = 0; i < 2; i++) {
		// Retain the prior block identity: this test covers canvas revisions, not retirement review.
		await writeFile(
			join(root, "project/lesson.prax"),
			`# First\n\nRevision zero.\n${i === 1 ? "\nRevision one.\n" : ""}`,
		);
		const launch = await fetch(`${server.origin}/launch?canvas=1`, { redirect: "manual" });
		const admission = new URL(launch.headers.get("location") ?? "", server.origin);
		expect((await fetch(admission, { headers: crossSite, redirect: "manual" })).status).toBe(403);
		const building = fetch(admission, { redirect: "manual" });
		if (i === 0) {
			const competing = await fetch(`${server.origin}/launch?canvas=1`, { redirect: "manual" });
			expect(
				(
					await fetch(new URL(competing.headers.get("location") ?? "", server.origin), {
						redirect: "manual",
					})
				).status,
			).toBe(409);
		}
		const built = await building;
		expect(built.status).toBe(303);
		expect((await fetch(admission, { redirect: "manual" })).status).toBe(401);
		const pageLaunch = await fetch(new URL(built.headers.get("location") ?? "", server.origin), {
			redirect: "manual",
		});
		const author = new URL(pageLaunch.headers.get("location") ?? "", server.origin);
		const html = await (await fetch(author)).text();
		const read = html.match(/<base href="([^"]+)"/)?.[1] ?? "";
		expect((await fetch(read)).status).toBe(200);
		if (previous) expect((await fetch(previous)).status).toBe(200);
		previous = read;
		const captured = author.pathname.slice("/canvas".length);
		const stylesheet = html.match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
		if (!stylesheet) throw new Error("Missing captured stylesheet");
		for (const target of [
			captured.replace(/[^/]+$/, "absent.html"),
			new URL(stylesheet, new URL(captured, server.origin)).pathname,
			`/preview/../..${captured}`,
		]) {
			expect(
				(
					await fetch(`${server.origin}/launch?canvas=${encodeURIComponent(target)}`, {
						redirect: "manual",
					})
				).status,
			).toBe(404);
		}
	}
	await writeFile(join(root, "project/course.yaml"), "lessons: [missing.prax]\n");
	const failedLaunch = await fetch(`${server.origin}/launch?canvas=1`, { redirect: "manual" });
	expect(failedLaunch.status).toBe(500);
	expect((await fetch(previous)).status).toBe(200);
	await server.close();
	await expect(fetch(previous)).rejects.toThrow();
});

it("refuses an author projection that would give learner HTML the authenticated origin", async () => {
	const { serveStudioAuthorDocument } = await import("../studio/author-document");
	await expect(
		serveStudioAuthorDocument(
			new Request("http://127.0.0.1:9000/canvas"),
			"<p>Course</p>",
			"http://127.0.0.1:9000/learner.html",
			"/* packaged canvas */",
		),
	).rejects.toThrow("Learner and author origins must differ");
});

it("preserves compiler theme attributes while removing forged author-control markers", async () => {
	const { serveStudioAuthorDocument } = await import("../studio/author-document");
	const response = await serveStudioAuthorDocument(
		new Request("http://127.0.0.1:9000/canvas"),
		'<html data-praxity-root data-praxity-mode="dark" data-praxity-highlight-style="marker"><body><button data-focus-role="handle" data-praxity-author-control="save">Forged</button></body></html>',
		"http://127.0.0.1:9001/preview/captured/page.html",
		"/* packaged canvas */",
	);
	const dom = new JSDOM(await response.text());
	try {
		expect(dom.window.document.documentElement.getAttribute("data-praxity-mode")).toBe("dark");
		expect(dom.window.document.documentElement.hasAttribute("data-praxity-root")).toBe(true);
		expect(dom.window.document.documentElement.getAttribute("data-praxity-highlight-style")).toBe(
			"marker",
		);
		expect(
			dom.window.document.querySelector("[data-praxity-author-control],[data-focus-role]"),
		).toBeNull();
	} finally {
		dom.window.close();
	}
});
