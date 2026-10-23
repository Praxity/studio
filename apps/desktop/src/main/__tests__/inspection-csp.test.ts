import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { CourseArtifactByteRange, CoursePreviewDeployment } from "@praxity/export-pipeline";
import { EMBED_FRAME_CSP_SOURCES } from "@praxity/shared-blocks/embed-url-utils";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { startStudioReadOnlyServer } from "../studio/read-only-server";

const html = `<!doctype html><html><head><title>Inspection</title>
<script nonce="authored" src="islands/loader.js"></script>
<script type="module" src="planted.js"></script><script>window.sentinel=true</script>
</head><body><main nonce="authored">Static course</main>
<svg><script>window.sentinel=true</script></svg>
<template><script>window.sentinel=true</script><meta http-equiv="refresh" content="0;url=learner.html"></template>
<meta http-equiv=" Refresh" content="0;url=learner.html"><meta http-equiv="REFRESH" content="1">
<div><template shadowrootmode="closed"><a href="learner.html">Shadow link</a></template></div>
<script id="praxity-config" type="application/json">{"logic":{"rules":[]}}</script>
<script type="speculationrules">{"prerender":[{"source":"list","urls":["learner.html"]}]}</script></body></html>`;
const bridge = "window.bridgeStarted = true;";
const learnerCsp = [
	"default-src 'self'",
	"script-src 'self'",
	"script-src-attr 'none'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' https: data:",
	"media-src 'self' https: data:",
	"font-src 'self' data:",
	"connect-src 'self'",
	`frame-src ${EMBED_FRAME_CSP_SOURCES.join(" ")}`,
	"object-src 'none'",
	"base-uri 'none'",
].join("; ");
const cleanup: (() => Promise<unknown>)[] = [];

function deployment(): CoursePreviewDeployment {
	const files = {
		"index.html": html,
		"planted.js": "window.sentinel=true",
		"hostile.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script href="planted.js"/></svg>',
		"course.woff2": "captured-font",
	};
	return {
		format: "electron-preview",
		courseToken: "a".repeat(32),
		manifest: {
			version: 1,
			rendererContractVersion: 1,
			learnerStateSchemaVersion: 1,
			courseId: "inspection",
			revision: "b".repeat(64),
			entry: "index.html",
			pageCount: 1,
			pages: [],
			files: Object.entries(files).map(([path, content]) => ({
				path,
				byteLength: Buffer.byteLength(content),
				sha256: "c".repeat(64),
				mediaType: path.endsWith(".html")
					? "text/html; charset=utf-8"
					: path.endsWith(".svg")
						? "image/svg+xml"
						: path.endsWith(".woff2")
							? "font/woff2"
							: "text/javascript",
			})),
		},
		openFile: async (path: string, range?: CourseArtifactByteRange) => {
			const body = Buffer.from(files[path as keyof typeof files]);
			return Readable.from([range ? body.subarray(range.start, range.end + 1) : body]);
		},
		dispose: async () => {},
	};
}

async function server(kind: "browser") {
	const projectDir = await mkdtemp(join(tmpdir(), "inspection-csp-"));
	cleanup.push(() => rm(projectDir, { recursive: true, force: true }));
	const listener = await startStudioReadOnlyServer({
		projectDir,
		getEditorOrigin: () => "http://127.0.0.1:1234",
		getInspectionScript: async () => bridge,
	});
	cleanup.push(() => listener.close());
	const hosted = await listener.hostCourseArtifact(deployment());
	// Pin the bound loopback origin itself, not just its reuse in the policy.
	expect(listener.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
	expect(hosted.entryUrl.startsWith(`${listener.origin}/`)).toBe(true);
	return {
		url: hosted.entryUrl,
		// WebKit matches 'self' against nothing once the iframe sandbox makes the origin opaque.
		self: listener.origin,
		policySuffix: "; frame-ancestors http://127.0.0.1:1234",
		fetch,
	};
}

afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

for (const kind of ["browser"] as const)
	describe(kind, () => {
		it("gives each inspection its own nonce, strips all course scripts and grants only the bridge", async () => {
			const host = await server(kind);
			const nonces: string[] = [];
			for (let i = 0; i < 2; i++) {
				const response = await host.fetch(`${host.url}?praxity-inspect=1&channel=test&pageId=page`);
				expect(response.status).toBe(200);
				expect(response.headers.get("referrer-policy")).toBe("no-referrer");
				const csp = response.headers.get("content-security-policy") ?? "";
				const nonce = csp.match(/(?:^|; )script-src 'nonce-([A-Za-z0-9+/=_-]+)'(?:;|$)/)?.[1];
				expect(nonce).toBeDefined();
				if (!nonce) throw new Error("Missing inspection nonce");
				nonces.push(nonce);
				expect(csp).toBe(
					[
						`default-src ${host.self}`,
						`script-src 'nonce-${nonce}'`,
						"script-src-attr 'none'",
						`style-src ${host.self} 'unsafe-inline'`,
						`img-src ${host.self} https: data:`,
						`media-src ${host.self} https: data:`,
						`font-src ${host.self} data:`,
						`connect-src ${host.self}`,
						`frame-src ${EMBED_FRAME_CSP_SOURCES.join(" ")}`,
						"object-src 'none'",
						"base-uri 'none'",
						"sandbox allow-scripts",
					].join("; ") + host.policySuffix,
				);
				expect(response.headers.get("cache-control")).toBe("no-store");
				expect(response.headers.has("etag")).toBe(false);
				const body = await response.text();
				expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(body)));
				const doc = new JSDOM(body).window.document;
				const templates = [...doc.querySelectorAll("template")];
				// Only the host navigates the Page lens; a refresh would load a learner page there.
				expect(doc.querySelectorAll("meta[http-equiv]")).toHaveLength(0);
				expect(templates.map((template) => template.content.querySelector("script,meta"))).toEqual([
					null,
					null,
				]);
				// A declared shadow root would hide its links from the bridge's click guard.
				expect(templates.some((template) => template.hasAttribute("shadowrootmode"))).toBe(false);
				// The bridge reads the product's own URL parameters; the server adds none.
				const scripts = [...doc.querySelectorAll("script")];
				expect(scripts[0].textContent).toBe(bridge);
				expect([...scripts[0].attributes].map((attribute) => attribute.name)).toEqual(["nonce"]);
				expect(scripts[0].getAttribute("nonce")).toBe(nonce);
				expect(doc.querySelectorAll("[nonce]")).toHaveLength(1);
				// JSON data blocks never execute; the Page lens reads the logic config from them.
				expect(scripts.map((script) => script.type || "classic")).toEqual([
					"classic",
					"application/json",
				]);
			}
			expect(nonces[0]).not.toBe(nonces[1]);
		});
		it.each(["GET", "HEAD"])(
			"never returns cached or partial inspection HTML for %s",
			async (method) => {
				const host = await server(kind);
				const response = await host.fetch(`${host.url}?praxity-inspect=1`, {
					method,
					headers: { Range: "bytes=0-40", "If-None-Match": '"' + "c".repeat(64) + '"' },
				});
				expect(response.status).toBe(200);
				expect(response.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
				expect(response.headers.has("content-range")).toBe(false);
				if (method === "HEAD") expect(await response.text()).toBe("");
			},
		);
		it("enforces an opaque inspection origin even without an iframe sandbox", async () => {
			const host = await server(kind);
			const response = await host.fetch(`${host.url}?praxity-inspect=1`);
			const directives = (response.headers.get("content-security-policy") ?? "").split("; ");
			expect(directives.filter((directive) => directive.startsWith("sandbox"))).toEqual([
				"sandbox allow-scripts",
			]);
		});
		it("allows opaque inspection font reads only within the admitted artifact", async () => {
			const host = await server(kind);
			const url = host.url.replace("index.html", "course.woff2");
			const response = await host.fetch(url, { headers: { Origin: "null" } });
			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe("null");
			expect(response.headers.get("vary")).toBe("Origin");
			expect(await response.text()).toBe("captured-font");
			const missing = await host.fetch(url.replace("course.woff2", "missing.woff2"), {
				headers: { Origin: "null" },
			});
			expect(missing.status).toBe(404);
			expect(missing.headers.has("access-control-allow-origin")).toBe(false);
			const learner = await host.fetch(url);
			expect(learner.headers.has("access-control-allow-origin")).toBe(false);
			expect(learner.headers.get("vary")).toBe("Origin");
		});
		it.each(["", "?praxity-inspect=0"])(
			"keeps learner CSP and course bytes unchanged for %s",
			async (query) => {
				const host = await server(kind);
				const response = await host.fetch(host.url + query);
				expect(response.headers.get("content-security-policy")).toMatch(
					new RegExp(`^${learnerCsp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:;|$)`),
				);
				expect(await response.text()).toBe(html);
			},
		);
	});

it("refuses service-worker scripts on the whole shared browser preview origin", async () => {
	const host = await server("browser");
	for (const query of ["", "?praxity-inspect=1"])
		expect(
			(
				await host.fetch(host.url.replace("index.html", "planted.js") + query, {
					headers: { "Service-Worker": "script" },
				})
			).status,
		).toBe(403);
});

it("preserves the browser course media sandbox and script refusal", async () => {
	const host = await server("browser");
	const response = await host.fetch(host.url.replace("index.html", "hostile.svg"));
	expect(response.status).toBe(200);
	expect(response.headers.get("content-security-policy")).toContain("sandbox; default-src 'none'");
});
