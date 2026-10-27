import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import reviewFr from "@praxity/editor-core/messages/fr" with { type: "json" };
import { REVIEW_TEXT_RULES } from "@praxity/review-share/review";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";
import { COURSE_CSP } from "../course-file-response";
import type { CanvasPreviewDescriptor, HostedCourseDeployment } from "../course-preview-service";
import { addStudioReadModeLink } from "../studio/author-document";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { openReviewStore } from "../studio/review-store";

const cleanups: (() => Promise<unknown>)[] = [];
const editorOrigin = "http://127.0.0.1:9000";
const assetsCsp =
	"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const reviewId = "11111111-1111-4111-8111-111111111111";
const capability = "A".repeat(43);
const captured =
	'<!doctype html><html lang="fr"><head><title>Untrusted title</title></head><body><a href="second.html">Next</a><main>Course</main></body></html>';
const fallbackCleanups: (() => Promise<unknown>)[] = [];
let fallbackFiles: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
	// Port-fallback assertions reuse an admitted course instead of bootstrapping its durable stores.
	fallbackFiles = await fixture(fallbackCleanups);
	const result = await runPraxityCli(
		["studio", fallbackFiles.projectDir, "--review", "--no-open"],
		{
			appVersion: "0.3.0",
			exportAssetsDir: fallbackFiles.assetsDir,
			editorAssetsDir: fallbackFiles.editorAssetsDir,
		},
	);
	try {
		expect(result.exitCode, result.stderr).toBe(0);
	} finally {
		await result.studioServer?.close();
	}
});
afterAll(async () => {
	for (const close of fallbackCleanups.splice(0).reverse()) await close();
});
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture(cleanup = cleanups) {
	const root = await mkdtemp(join(tmpdir(), "studio-review-launch-"));
	cleanup.push(() => rm(root, { recursive: true }));
	const projectDir = join(root, "project");
	const assetsDir = join(root, "assets");
	const editorAssetsDir = join(root, "editor");
	await Promise.all([projectDir, assetsDir, editorAssetsDir].map((dir) => mkdir(dir)));
	for (const name of ["review-comments.js", "review-comments.css"])
		await cp(
			fileURLToPath(
				new URL(`../../../../../packages/export-pipeline/template/${name}`, import.meta.url),
			),
			join(assetsDir, name),
		);
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362",
	);
	await writeFile(join(projectDir, "lesson.prax"), "# First\n\nBody.\n");
	await writeFile(
		join(projectDir, "course.yaml"),
		"title: Review fixture\nlessons: [lesson.prax]\n",
	);
	const initial = await openReviewStore(projectDir);
	const storage = join(projectDir, ".praxity/reviews");
	const manifest = JSON.parse(await readFile(join(storage, "manifest.json"), "utf8"));
	manifest.reviewId = reviewId;
	await writeFile(join(storage, "manifest.json"), JSON.stringify(manifest));
	await mkdir(join(storage, reviewId));
	const state = JSON.parse(
		await readFile(join(storage, initial.reviewId, "comments.json"), "utf8"),
	);
	state.reviewId = reviewId;
	await writeFile(join(storage, reviewId, "comments.json"), JSON.stringify(state));
	const store = await openReviewStore(projectDir);
	return { root, projectDir, assetsDir, editorAssetsDir, store };
}

async function running(
	enabled = true,
	sourceRevisions: Record<string, string> | undefined = {
		"a.prax": "source-a",
		"b.prax": "source-b",
	},
	preferredPort?: number,
) {
	const files = await fixture();
	let head: CanvasPreviewDescriptor | undefined;
	const server = await startStudioReadOnlyServer({
		projectDir: files.projectDir,
		getEditorOrigin: () => editorOrigin,
		getCanvasHead: () => head,
		getInspectionScript: async () => "void 0;",
		...(enabled
			? { review: { store: files.store, capability, assetsDir: files.assetsDir, preferredPort } }
			: {}),
	});
	cleanups.push(() => server.close());
	async function host(n = 1, revisions = sourceRevisions) {
		const pages = [
			{ id: "page-one", title: "Sort the seedlings", lessonId: "lesson-one", slug: "index" },
			{ id: "page-two", title: "Water on a schedule", lessonId: "lesson-one", slug: "second" },
			{ id: "page-three", title: "Compost notes", lessonId: "lesson-two", slug: "third" },
		];
		const deployment: HostedCourseDeployment = {
			format: "standalone",
			courseToken: "a".repeat(32),
			sourceRevisions: revisions,
			manifest: {
				version: 1,
				rendererContractVersion: 1,
				learnerStateSchemaVersion: 1,
				courseId: "course",
				revision: String(n).padStart(64, "0"),
				entry: "index.html",
				pageCount: 3,
				pages: pages.map((page) => ({
					...page,
					runtime: { mode: "islands", islands: [], legacyReasons: [] },
					statefulBlockIds: [],
				})),
				files: [
					...["index", "second", "third", "unmapped"].map((slug) => ({
						path: `${slug}.html`,
						byteLength: Buffer.byteLength(captured),
						sha256: "b".repeat(64),
						mediaType: "text/html; charset=utf-8",
					})),
					{
						path: "runtime.js",
						byteLength: 7,
						sha256: "c".repeat(64),
						mediaType: "text/javascript; charset=utf-8",
					},
				],
			},
			openFile: async (relativePath) =>
				Readable.from([Buffer.from(relativePath === "runtime.js" ? "void 0;" : captured)]),
			dispose: async () => {},
		};
		const hosted = await server.hostCourseArtifact(deployment);
		head = {
			entryUrl: hosted.entryUrl,
			courseId: "course",
			coreRevision: deployment.manifest.revision,
			responseRevision: deployment.manifest.revision,
			pages,
		};
		return { ...hosted, readUrl: `${server.origin}/canvas${new URL(hosted.entryUrl).pathname}` };
	}
	return { ...files, server, host, ...(await host()) };
}

function config(html: string) {
	const dom = new JSDOM(html);
	try {
		return JSON.parse(
			dom.window.document.getElementById("praxity-review-config")?.textContent ?? "null",
		);
	} finally {
		dom.window.close();
	}
}

it("refuses every third-party script source on course HTML, JavaScript and artifacts, with nonce-only inspection", async () => {
	const directive = (csp: string | null) =>
		csp
			?.split(";")
			.map((value) => value.trim())
			.find((value) => value.startsWith("script-src "));
	expect(directive(COURSE_CSP)).toBe("script-src 'self'");
	const reviewed = await running();
	const plain = await running(false);
	const plainResponse = await fetch(plain.readUrl);
	const strict = plainResponse.headers.get("content-security-policy");
	expect(directive(strict)).toBe("script-src 'self'");
	for (const url of [
		reviewed.readUrl,
		reviewed.entryUrl,
		plain.entryUrl,
		new URL("runtime.js", reviewed.readUrl),
		new URL("runtime.js", reviewed.entryUrl),
		new URL("runtime.js", plain.readUrl),
		new URL("runtime.js", plain.entryUrl),
	]) {
		const response = await fetch(url);
		expect(response.status).toBe(200);
		expect(directive(response.headers.get("content-security-policy"))).toBe("script-src 'self'");
		expect(response.headers.get("content-security-policy")).toBe(strict);
		if (url === reviewed.entryUrl) expect(await response.text()).toBe(captured);
		else if (url === reviewed.readUrl) expect(config(await response.text())).not.toBeNull();
		else await response.arrayBuffer();
	}
	for (const url of [reviewed.readUrl, new URL("runtime.js", reviewed.readUrl).href]) {
		const inspected = await fetch(`${url}?praxity-inspect=1`);
		expect(directive(inspected.headers.get("content-security-policy"))).toMatch(
			/^script-src 'nonce-[A-Za-z0-9+/]+={0,2}'$/,
		);
		const body = await inspected.text();
		if (url === reviewed.readUrl) expect(config(body)).toBeNull();
	}
});

it("reuses the preferred review listener port across actual listener restarts", async () => {
	const probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const address = probe.address();
	if (!address || typeof address === "string") throw new Error("No test port");
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	const first = await running(true, undefined, address.port);
	expect(new URL(first.server.origin).port).toBe(String(address.port));
	expect(config(await (await fetch(first.readUrl)).text()).draftOriginChanged).toBeUndefined();
	await first.server.close();
	const restarted = await startStudioReadOnlyServer({
		projectDir: first.projectDir,
		getEditorOrigin: () => editorOrigin,
		review: {
			store: await openReviewStore(first.projectDir),
			capability: "B" + "A".repeat(42),
			preferredPort: address.port,
		},
	});
	cleanups.push(() => restarted.close());
	expect(restarted.origin).toBe(first.server.origin);
});
it("falls back only when a preferred review port is busy or out of range and marks the bootstrap", async () => {
	const blocker = createServer();
	await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
	const address = blocker.address();
	if (!address || typeof address === "string") throw new Error("No test port");
	for (const preferred of [address.port, 65536]) {
		const started = await running(true, undefined, preferred);
		expect(new URL(started.server.origin).port).not.toBe(String(preferred));
		expect(config(await (await fetch(started.readUrl)).text()).draftOriginChanged).toBe(true);
	}
});
it.each(["EACCES", "EIO"])(
	"a preferred-port %s bind refusal falls back to a real port-0 listener",
	async (code) => {
		const listen = Server.prototype.listen;
		const spy = vi.spyOn(Server.prototype, "listen").mockImplementation(function (
			this: Server,
			...args: unknown[]
		) {
			if (args[0] === 56789) {
				queueMicrotask(() =>
					this.emit("error", Object.assign(new Error("Preferred bind refused"), { code })),
				);
				return this;
			}
			return Reflect.apply(listen, this, args);
		});
		try {
			const started = await running(true, undefined, 56789);
			expect(new URL(started.server.origin).port).not.toBe("56789");
			expect(config(await (await fetch(started.readUrl)).text()).draftOriginChanged).toBe(true);
		} finally {
			spy.mockRestore();
		}
	},
);
it("rethrows the port-0 bind failure after a preferred-port refusal", async () => {
	const files = await fixture(),
		listen = Server.prototype.listen;
	const spy = vi.spyOn(Server.prototype, "listen").mockImplementation(function (
		this: Server,
		...args: unknown[]
	) {
		if (args[0] === 56789 || args[0] === 0) {
			queueMicrotask(() =>
				this.emit(
					"error",
					Object.assign(new Error("Bind refused"), { code: args[0] === 0 ? "EIO" : "EACCES" }),
				),
			);
			return this;
		}
		return Reflect.apply(listen, this, args);
	});
	try {
		await expect(
			startStudioReadOnlyServer({
				projectDir: files.projectDir,
				getEditorOrigin: () => editorOrigin,
				review: {
					store: await openReviewStore(files.projectDir),
					capability,
					preferredPort: 56789,
				},
			}),
		).rejects.toMatchObject({ code: "EIO" });
	} finally {
		spy.mockRestore();
	}
});
it.each(["en", "fr"])("CLI reports preferred-port fallback on stderr in %s", async (locale) => {
	const files = fallbackFiles,
		probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const address = probe.address();
	if (!address || typeof address === "string") throw new Error("Missing port");
	const port = address.port > 64535 ? address.port - 1000 : address.port;
	await new Promise<void>((resolve) => probe.close(() => resolve()));
	const listen = Server.prototype.listen;
	const spy = vi.spyOn(Server.prototype, "listen").mockImplementation(function (
		this: Server,
		...args: unknown[]
	) {
		if (args[0] === port + 1000) {
			queueMicrotask(() =>
				this.emit("error", Object.assign(new Error("Preferred bind refused"), { code: "EACCES" })),
			);
			return this;
		}
		return Reflect.apply(listen, this, args);
	});
	try {
		const result = await runPraxityCli(
			[
				"studio",
				files.projectDir,
				"--review",
				"--no-open",
				"--port",
				String(port),
				"--lang",
				locale,
			],
			{
				appVersion: "0.3.0",
				exportAssetsDir: files.assetsDir,
				editorAssetsDir: files.editorAssetsDir,
			},
		);
		if (result.studioServer) cleanups.push(() => result.studioServer?.close() ?? Promise.resolve());
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe(
			locale === "fr"
				? "Le port de lecture pr\u00e9f\u00e9r\u00e9 est indisponible. Des brouillons ant\u00e9rieurs peuvent manquer et les nouveaux brouillons peuvent ne pas survivre au red\u00e9marrage.\n"
				: "The preferred learner port is unavailable. Earlier drafts may be unavailable, and new drafts may not survive a restart.\n",
		);
	} finally {
		spy.mockRestore();
	}
});
it("CLI without --port keeps random learner binding without a fallback notice", async () => {
	const files = await fixture();
	const result = await runPraxityCli(["studio", files.projectDir, "--review", "--no-open"], {
		appVersion: "0.3.0",
		exportAssetsDir: files.assetsDir,
		editorAssetsDir: files.editorAssetsDir,
	});
	if (result.studioServer) cleanups.push(() => result.studioServer?.close() ?? Promise.resolve());
	expect(result.exitCode).toBe(0);
	expect(result.stderr).toBe("");
});

it("bootstraps captured two-lesson scope, reload, relative links and released revision redirects", async () => {
	const { readUrl, server, host, release } = await running();
	const response = await fetch(readUrl);
	const html = await response.text();
	expect(config(html)).toEqual({
		schema: 1,
		reviewId,
		capability,
		endpoint: `/api/reviews/${reviewId}`,
		locale: "fr",
		pages: [
			{
				id: "page-one",
				title: "Sort the seedlings",
				href: `${new URL(".", readUrl).pathname}index.html?praxity-resume=0#page-one`,
			},
			{
				id: "page-two",
				title: "Water on a schedule",
				href: `${new URL(".", readUrl).pathname}second.html?praxity-resume=0#page-two`,
			},
			{
				id: "page-three",
				title: "Compost notes",
				href: `${new URL(".", readUrl).pathname}third.html?praxity-resume=0#page-three`,
			},
		],
		blockNames: reviewFr.pedagogyAudit.blockTypes,
		textRules: {
			controls: REVIEW_TEXT_RULES.bodyControls,
			surrogates: REVIEW_TEXT_RULES.surrogates,
		},
		limits: {
			name: 60,
			body: 2000,
			quoteExact: 2000,
			quoteContext: 32,
			requestBodyBytes: 65536,
			stateBytes: 4194304,
			authorReserveBytes: 524288,
			id: 200,
			revision: 500,
			title: 500,
			pinPath: 512,
			pinDepth: 16,
			revealDepth: 16,
			cssPath: 2048,
			listLimit: 100,
			cursor: 2048,
			threadsPerReview: 1000,
			messagesPerThread: 100,
			mutationsPerReview: 100000,
		},
		page: {
			lessonId: "lesson-one",
			pageId: "page-one",
			pageIds: ["page-one", "page-two"],
			pageIndex: 0,
			revision: "2468b077321b458bffd8924f4e7a4285bb879e55582703193b5f978590323661",
		},
	});
	expect(response.headers.get("content-security-policy")).toBe(
		`default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https: data:; font-src 'self' data:; connect-src 'self'; frame-src https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com https://youtube-nocookie.com https://youtu.be https://player.vimeo.com https://vimeo.com https://www.vimeo.com https://www.loom.com https://loom.com https://docs.google.com https://drive.google.com https://www.google.com https://maps.google.com https://www.figma.com https://figma.com https://embed.figma.com https://codepen.io https://codesandbox.io https://calendly.com https://tally.so https://twitter.com https://x.com https://platform.twitter.com https://miro.com https://www.canva.com https://canva.com https://airtable.com https://www.notion.so https://notion.so https://h5p.org https://padlet.com https://view.genial.ly https://view.genially.com https://www.mentimeter.com https://www.menti.com https://www.surveymonkey.com https://open.spotify.com https://soundcloud.com https://w.soundcloud.com https://www.slideshare.net https://typeform.com https://*.typeform.com https://h5p.com https://*.h5p.com; object-src 'none'; base-uri 'none'; frame-ancestors ${editorOrigin}; sandbox allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads`,
	);
	expect(config(await (await fetch(readUrl)).text())).toEqual(config(html));
	expect(config(await (await fetch(new URL("second.html", readUrl))).text()).page).toMatchObject({
		pageId: "page-two",
		pageIndex: 1,
		lessonId: "lesson-one",
	});
	expect(config(await (await fetch(new URL("third.html", readUrl))).text()).page).toMatchObject({
		pageId: "page-three",
		pageIndex: 0,
		lessonId: "lesson-two",
		pageIds: ["page-three"],
	});
	expect(config(await (await fetch(new URL("unmapped.html", readUrl))).text()).page).toEqual({
		lessonId: null,
		pageId: null,
		pageIds: null,
		pageIndex: null,
		revision: null,
	});
	expect(await (await fetch(readUrl.replace("/canvas/", "/"))).text()).toBe(captured);
	expect(
		await server.readCanvasDocument(
			new URL(readUrl).pathname.slice(7),
			new AbortController().signal,
		),
	).toBe(captured);
	await release();
	await host(2);
	expect(config(await (await fetch(readUrl)).text()).reviewId).toBe(reviewId);
});

it("inspection omits the review config, capability and assets while Read HEAD succeeds", async () => {
	const { readUrl } = await running();
	const inspection = await fetch(`${readUrl}?praxity-inspect=1`);
	expect(inspection.status).toBe(200);
	expect(inspection.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
	expect(inspection.headers.get("content-security-policy")).toContain("script-src 'nonce-");
	expect(inspection.headers.get("content-security-policy")).not.toContain("allow-same-origin");
	const html = await inspection.text();
	expect(html).not.toContain("praxity-review-config");
	expect(html).not.toContain(capability);
	expect(html).not.toContain("/_praxity/review/");
	const head = await fetch(readUrl, { method: "HEAD" });
	// Node never sends HEAD bodies, so only the status exercises this handler.
	expect(head.status).toBe(200);
});

it("source revision ignores build changes and includes edits in another lesson", async () => {
	const { host } = await running();
	const rebuilt = await host(2);
	expect(config(await (await fetch(rebuilt.readUrl)).text()).page.revision).toBe(
		"2468b077321b458bffd8924f4e7a4285bb879e55582703193b5f978590323661",
	);
	const edited = await host(3, { "b.prax": "edited-other-lesson", "a.prax": "source-a" });
	const page = config(await (await fetch(edited.readUrl)).text()).page;
	expect(page.lessonId).toBe("lesson-one");
	expect(page.revision).toBe("78a9683728561ff96f76689632b5fc411fc917964738c09f2e425cc8c2b58ae8");
});

it("default-off Read preserves captured bytes and the localized editor destination", async () => {
	const { readUrl, server } = await running(false);
	const html = await (await fetch(readUrl)).text();
	const dom = new JSDOM(html);
	try {
		const link = dom.window.document.querySelector(".praxity-studio-edit-link");
		expect(link?.textContent).toBe("Modifier le texte");
		expect(link?.getAttribute("href")).toBe(
			`${editorOrigin}/launch?canvas=${encodeURIComponent(new URL(readUrl).pathname.slice(7))}`,
		);
	} finally {
		dom.window.close();
	}
	expect(
		html.replace(
			/<style data-praxity-studio-read>[\s\S]*?<\/style><div class="praxity-studio-read-tools">[\s\S]*?<\/div>/,
			"",
		),
	).toBe(captured);
	for (const method of ["GET", "POST"]) {
		const response = await fetch(`${server.origin}/_praxity/review/review-comments.js`, { method });
		expect(response.status).toBe(method === "GET" ? 404 : 405);
		expect(await response.text()).toBe("");
	}
});

it("serves only the two shipped assets with literal headers, HEAD and fail-closed reads", async () => {
	const { server, assetsDir } = await running();
	for (const [name, mime] of [
		["review-comments.js", "text/javascript; charset=utf-8"],
		["review-comments.css", "text/css; charset=utf-8"],
	]) {
		for (const method of ["GET", "HEAD"]) {
			const response = await fetch(`${server.origin}/_praxity/review/${name}`, { method });
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(mime);
			expect(response.headers.get("content-security-policy")).toBe(assetsCsp);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(await response.text()).toBe(
				method === "HEAD" ? "" : await readFile(join(assetsDir, name), "utf8"),
			);
		}
	}
	for (const path of [
		"unknown.js",
		"%72eview-comments.js",
		"review-comments.js/extra",
		"..%2freview-comments.js",
		"review-comments.js?other=1",
	])
		expect((await fetch(`${server.origin}/_praxity/review/${path}`)).status).toBe(404);
	expect(
		(await fetch(`${server.origin}/_praxity/review/review-comments.js`, { method: "POST" })).status,
	).toBe(405);
	await rm(join(assetsDir, "review-comments.js"));
	expect((await fetch(`${server.origin}/_praxity/review/review-comments.js`)).status).toBe(503);
});

it.each(["review-comments.js", "review-comments.css"])(
	"refuses startup when %s is missing",
	async (name) => {
		const files = await fixture();
		await rm(join(files.assetsDir, name));
		await expect(
			startStudioReadOnlyServer({
				projectDir: files.projectDir,
				getEditorOrigin: () => editorOrigin,
				review: { store: files.store, capability, assetsDir: files.assetsDir },
			}),
		).rejects.toThrow(name);
	},
);

it("serializes script delimiters safely and refuses an invalid local configuration", async () => {
	const hostile = "</script><script>throw 1</script>&\u2028\u2029";
	const html = await addStudioReadModeLink(captured, `${editorOrigin}/launch`, {
		reviewId,
		capability: hostile,
		page: undefined,
	});
	const dom = new JSDOM(html, {
		runScripts: "outside-only",
		url: "https://reviews.example/s/legacy/page.html",
	});
	try {
		const json = dom.window.document.getElementById("praxity-review-config");
		expect(json?.textContent).not.toMatch(/[<>&\u2028\u2029]/u);
		expect(config(html).capability).toBe(hostile);
		const fetchMock = vi.fn();
		dom.window.fetch = fetchMock;
		dom.window.eval(
			await readFile(
				fileURLToPath(
					new URL(
						"../../../../../packages/export-pipeline/template/review-comments.js",
						import.meta.url,
					),
				),
				"utf8",
			),
		);
		dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
		expect(fetchMock).not.toHaveBeenCalled();
		expect(dom.window.document.querySelector(".prx-review-status")?.textContent).toBe(
			"Comments could not be loaded.",
		);
	} finally {
		dom.window.close();
	}
});

it.each([
	'<div id="praxity-review-config"></div>',
	'<script type="text/plain" id="praxity-review-config"></script>',
])("legacy client ignores a non-config element: %s", async (element) => {
	const dom = new JSDOM(
		`<!doctype html><html><head>${element}<script data-praxity-review-comments="true" data-review-page-id="page-one"></script></head><body><main>Course</main></body></html>`,
		{ runScripts: "outside-only", url: "https://reviews.example/s/legacy/page.html" },
	);
	try {
		const fetchMock = vi.fn(async () => new Response("[]"));
		dom.window.fetch = fetchMock;
		dom.window.eval(
			await readFile(
				fileURLToPath(
					new URL(
						"../../../../../packages/export-pipeline/template/review-comments.js",
						import.meta.url,
					),
				),
				"utf8",
			),
		);
		dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(fetchMock).toHaveBeenCalledWith(
			"https://reviews.example/s/legacy/comments?page=page-one",
		);
		expect(dom.window.document.querySelector(".prx-review-sidebar")).not.toBeNull();
	} finally {
		dom.window.close();
	}
});

it.each(["corrupt-json", "newer-schema", "unsafe-path"])(
	"CLI preserves %s store refusal and never starts",
	async (code) => {
		const files = await fixture();
		const manifest = join(files.projectDir, ".praxity/reviews/manifest.json");
		if (code === "unsafe-path") {
			await rm(manifest);
			await symlink(join(files.root, "missing"), manifest);
		} else await writeFile(manifest, code === "corrupt-json" ? "{" : '{"schema":2}');
		const result = await runPraxityCli(["studio", files.projectDir, "--review", "--no-open"], {
			appVersion: "0.3.0",
			exportAssetsDir: files.assetsDir,
			editorAssetsDir: files.editorAssetsDir,
		});
		if (result.studioServer) cleanups.push(() => result.studioServer?.close() ?? Promise.resolve());
		expect(result.exitCode).toBe(1);
		expect(result.studioServer).toBeUndefined();
		expect(JSON.parse(result.stdout).error.code).toBe(code);
		expect(result.stderr).toContain(code);
	},
);

it.each(["en", "fr"])(
	"CLI refuses missing review assets with a localized notice in %s",
	async (locale) => {
		const files = await fixture();
		await rm(join(files.assetsDir, "review-comments.css"));
		const result = await runPraxityCli(
			["studio", files.projectDir, "--review", "--no-open", "--lang", locale],
			{
				appVersion: "0.3.0",
				exportAssetsDir: files.assetsDir,
				editorAssetsDir: files.editorAssetsDir,
			},
		);
		expect(result.exitCode).toBe(1);
		expect(result.studioServer).toBeUndefined();
		expect(JSON.parse(result.stdout).error.code).toBe("review_assets_missing");
		expect(result.stdout).not.toContain("#session=");
		expect(result.stderr).toContain("review-comments.css");
		expect(result.stderr).toContain(
			locale === "fr" ? "Studio n'a pas démarré" : "Studio did not start",
		);
	},
);

it.each([
	{ locale: "en", busy: false },
	{ locale: "fr", busy: false },
	{ locale: "en", busy: true },
	{ locale: "fr", busy: true },
])(
	"review refuses an empty folder without writes, $locale busy=$busy",
	async ({ locale, busy }) => {
		const files = await fixture();
		const emptyDir = join(files.root, "empty");
		await mkdir(emptyDir);
		let port: number | undefined;
		if (busy) {
			const listener = createServer((_request, response) => {
				response.writeHead(404);
				response.end();
			});
			await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
			cleanups.push(
				() =>
					new Promise<void>((resolve, reject) =>
						listener.close((error) => (error ? reject(error) : resolve())),
					),
			);
			const address = listener.address();
			if (!address || typeof address === "string") throw new Error("No busy test port");
			port = address.port;
		}
		const result = await runPraxityCli(
			[
				"studio",
				emptyDir,
				"--review",
				"--no-open",
				"--lang",
				locale,
				...(port === undefined ? [] : ["--port", String(port)]),
			],
			{
				appVersion: "0.3.0",
				exportAssetsDir: files.assetsDir,
				editorAssetsDir: files.editorAssetsDir,
			},
		);
		if (result.studioServer) cleanups.push(() => result.studioServer?.close() ?? Promise.resolve());
		expect(result.exitCode).toBe(1);
		expect(result.studioServer).toBeUndefined();
		expect(JSON.parse(result.stdout).error.code).toBe("course_manifest_required");
		expect(result.stderr).toContain(
			locale === "fr"
				? "--review nécessite un fichier course.yaml ordinaire"
				: "--review requires a regular course.yaml file",
		);
		expect(await readdir(emptyDir)).toEqual([]);
	},
);

it.each(["directory", "symlink"])(
	"review refuses a %s manifest without writing review storage",
	async (kind) => {
		const files = await fixture();
		const nonCourse = join(files.root, "non-course");
		await mkdir(nonCourse);
		const manifest = join(nonCourse, "course.yaml");
		if (kind === "directory") await mkdir(manifest);
		else await symlink(join(files.projectDir, "course.yaml"), manifest);
		const result = await runPraxityCli(["studio", nonCourse, "--review", "--no-open"], {
			appVersion: "0.3.0",
			exportAssetsDir: files.assetsDir,
			editorAssetsDir: files.editorAssetsDir,
		});
		if (result.studioServer) cleanups.push(() => result.studioServer?.close() ?? Promise.resolve());
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("course_manifest_required");
		expect(await readdir(nonCourse)).toEqual(["course.yaml"]);
	},
);

it("CLI rejects duplicate review flags and documents opt-in in EN/FR", async () => {
	const runtime = { appVersion: "0.3.0", exportAssetsDir: "unused" };
	expect((await runPraxityCli(["studio", ".", "--review", "--review"], runtime)).exitCode).toBe(2);
	for (const locale of ["en", "fr"]) {
		const help = await runPraxityCli(["studio", "--help", "--lang", locale], runtime);
		expect(help.stdout).toContain("[--review]");
		expect(help.stdout).toContain(locale === "fr" ? "commentaires" : "review comments");
	}
});
