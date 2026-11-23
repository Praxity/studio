import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import type { HostedCourseDeployment } from "../course-preview-service";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { startStudioServer } from "../studio/server";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

it("admits the canvas mode through launch, preserving exact route and origin admission", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-canvas-"));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "project"));

	await writeFile(join(root, "project/lesson.prax"), "# Title\n\nA **nested** word.\n");

	const server = await startStudioServer({
		projectDir: join(root, "project"),

		appVersion: "0.3.0",
	});
	cleanup.push(() => server.close());
	const response = await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" });
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toMatch(/^\/canvas\?admission=[\w-]{43}$/);
	expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
	expect((await fetch(`${server.origin}/launch?canvas=read`, { method: "POST" })).status).toBe(405);
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
	const unavailable = await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" });
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
		"/launch?canvas=read&extra=1",
		"/launch?canvas=%31",
		"/launch?canvas=%",
		"/launch?canvas=https://evil.test",
		`/launch?canvas=${encodeURIComponent("/preview/missing.html")}`,
		"/canvas/../course.yaml",
	]) {
		expect((await fetch(`${server.origin}${route}`, { redirect: "manual" })).status).toBe(404);
	}
	for (const origin of ["null", "https://evil.test", "http://127.0.0.1:1"]) {
		const denied = await fetch(`${server.origin}/launch?canvas=read`, {
			headers: { Origin: origin },
			redirect: "manual",
		});
		expect(denied.status).toBe(403);
		expect(denied.headers.has("access-control-allow-origin")).toBe(false);
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
				title: `Page ${pageIndex + 1}`,
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
	expect(await (await fetch(first)).text()).toBe(files["index.html"]);
	const second = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
		await (await fetch(new URL("second.html", first))).arrayBuffer(),
	);
	expect(second).toBe(files["second.html"]);
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

	await writeFile(join(root, "project/lesson.prax"), "# First\n\nRevision zero.\n");

	const server = await startStudioServer({
		projectDir: join(root, "project"),

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
		await writeFile(
			join(root, "project/lesson.prax"),
			`# First\n\nRevision zero.\n${i === 1 ? "\nRevision one.\n" : ""}`,
		);
		const launch = await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" });
		const admission = new URL(launch.headers.get("location") ?? "", server.origin);
		expect((await fetch(admission, { headers: crossSite, redirect: "manual" })).status).toBe(403);
		const building = fetch(admission, { redirect: "manual" });
		if (i === 0) {
			const competing = await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" });
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
		const read = built.headers.get("location") ?? "";
		const html = await (await fetch(read)).text();
		expect((await fetch(read)).status).toBe(200);
		if (previous) expect((await fetch(previous)).status).toBe(200);
		previous = read;
		const captured = new URL(read).pathname.slice("/canvas".length);
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
	const failedLaunch = await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" });
	expect(failedLaunch.status).toBe(303);
	expect(
		(
			await fetch(new URL(failedLaunch.headers.get("location") ?? "", server.origin), {
				redirect: "manual",
			})
		).status,
	).toBe(500);
	expect((await fetch(previous)).status).toBe(200);
	await server.close();
	await expect(fetch(previous)).rejects.toThrow();
});
