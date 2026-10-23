import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScormPackage, type DesktopExportInput } from "../src/build";
import { fixtureCourseRuntimeLicense, fixtureRuntimeNotices } from "./fixtures/runtime-notices.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(testDir, "../template/review-comments.js");
const HOST_FILENAMES = {
	standalone: "host-standalone-TEST1234.js",
	electronPreview: "host-electron-preview-TEST1234.js",
	scorm12: "host-scorm12-TEST1234.js",
	scorm2004: "host-scorm2004-TEST1234.js",
	xapi: "host-xapi-TEST1234.js",
} as const;
const RESUME_FILENAME = "course-resume-TEST1234.js";
const SHELL_FILENAME = "course-shell-TEST1234.js";
const ISLAND_FILENAMES = {
	loader: "island-loader-TEST1234.js",
	nav: "island-nav-TEST1234.js",
} as const;

function stylesheetEntry(zip: AdmZip, lite = false): string {
	const pattern = lite ? /^styles-lite\.[a-f0-9]{12}\.css$/ : /^styles\.[a-f0-9]{12}\.css$/;
	const entry = zip.getEntries().find((candidate) => pattern.test(candidate.entryName));
	expect(entry).toBeDefined();
	return entry?.entryName ?? "";
}

function desktopInput(reviewMode = false): DesktopExportInput {
	return {
		courseId: "review-course",
		blocks: [{ id: "b1", type: "text", data: { content: "<p>Review this page</p>" } }],
		frontmatter: { title: "Review Course", lang: "en" },
		config: { completionThreshold: 0.8 },
		resolvedAssets: new Map(),
		viewerVersion: "test-viewer",
		locale: "en",
		reviewMode,
		reviewExpiresAt: reviewMode ? "2026-08-05T16:00:00.000Z" : undefined,
	};
}

function contentPage(zip: AdmZip): string {
	const entry = zip
		.getEntries()
		.find(
			(candidate) =>
				candidate.entryName.endsWith(".html") &&
				candidate.entryName !== "index.html" &&
				!/^page-\d+\.html$/.test(candidate.entryName),
		);
	if (!entry) throw new Error("Expected a generated content page");
	return entry.getData().toString("utf-8");
}

const navigationCases = [
	{ label: "same page", pageId: "two" },
	{ label: "different page", pageId: "one" },
] as const;

async function delayedPostReviewDom() {
	const dom = new JSDOM(
		`<!doctype html><html><head>
		<script data-praxity-review-comments="true" data-review-page-id="two"></script>
		</head><body><main><article data-deck-slide="one" hidden><h1>First slide</h1></article>
		<article data-deck-slide="two"><h1>Second slide</h1></article></main></body></html>`,
		{
			url: "https://reviews.example/s/abcdefghijklmnop/module.html",
			runScripts: "outside-only",
		},
	);
	let resolvePost!: (response: Response) => void;
	const fetchMock = vi.fn().mockImplementation((_url, options) => {
		if (options?.method === "POST") {
			return new Promise<Response>((resolve) => {
				resolvePost = resolve;
			});
		}
		return Promise.resolve(new Response("[]", { status: 200 }));
	});
	dom.window.fetch = fetchMock;
	dom.window.eval(await readFile(scriptPath, "utf-8"));
	const doc = dom.window.document;
	await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
	const name = doc.querySelector<HTMLInputElement>("#prx-review-name");
	const text = doc.querySelector<HTMLTextAreaElement>("#prx-review-text");
	const form = doc.querySelector<HTMLFormElement>(".prx-review-form");
	const submit = doc.querySelector<HTMLButtonElement>(".prx-review-submit");
	if (!name || !text || !form || !submit) throw new Error("Expected comment form");
	await vi.waitFor(() => expect(submit.disabled).toBe(false));
	return {
		dom,
		doc,
		fetchMock,
		name,
		text,
		form,
		submit,
		resolvePost: (response: Response) => resolvePost(response),
	};
}

function navigateReviewPage(dom: JSDOM, pageId: string) {
	dom.window.dispatchEvent(
		new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId } }),
	);
}

describe("review HTML builds", () => {
	let prebuiltAssetsDir: string;

	beforeEach(async () => {
		prebuiltAssetsDir = await mkdtemp(path.join(os.tmpdir(), "review-prebuilt-assets-"));
		await writeFile(path.join(prebuiltAssetsDir, "viewer.css"), ".viewer{}", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "deck-shell.css"), ".praxity-deck{}", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "highlight.css"), ".praxity-highlight{}", "utf-8");
		await writeFile(
			path.join(prebuiltAssetsDir, "retrieval-sheet.css"),
			".praxity-retrieval-sheet{}",
			"utf-8",
		);
		await writeFile(path.join(prebuiltAssetsDir, SHELL_FILENAME), "window.shell={};", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, RESUME_FILENAME), "", "utf-8");
		await writeFile(path.join(prebuiltAssetsDir, "styles.css"), "body{}", "utf-8");
		await mkdir(path.join(prebuiltAssetsDir, "islands"));
		for (const filename of Object.values(ISLAND_FILENAMES)) {
			await writeFile(path.join(prebuiltAssetsDir, "islands", filename), "", "utf-8");
		}
		for (const filename of Object.values(HOST_FILENAMES)) {
			await writeFile(path.join(prebuiltAssetsDir, filename), "window.PraxityHost={};", "utf-8");
		}
		await writeFile(
			path.join(prebuiltAssetsDir, "viewer-manifest.json"),
			JSON.stringify({
				courseRuntimeLicense: await fixtureCourseRuntimeLicense(),
				thirdPartyNotices: await fixtureRuntimeNotices(
					SHELL_FILENAME,
					Object.values(HOST_FILENAMES),
					Object.values(ISLAND_FILENAMES),
					RESUME_FILENAME,
				),
				css: "viewer.css",
				deckCss: "deck-shell.css",
				retrievalSheetCss: "retrieval-sheet.css",
				highlightCss: "highlight.css",
				shell: SHELL_FILENAME,
				resume: RESUME_FILENAME,
				hosts: HOST_FILENAMES,
				islands: {
					"island-loader": ISLAND_FILENAMES.loader,
					"island-nav": ISLAND_FILENAMES.nav,
				},
				islandFiles: Object.values(ISLAND_FILENAMES),
				islandDependencies: {
					"island-loader": [ISLAND_FILENAMES.loader],
					"island-nav": [ISLAND_FILENAMES.nav],
				},
			}),
			"utf-8",
		);
		await writeFile(
			path.join(prebuiltAssetsDir, "review-comments.js"),
			"window.review={};",
			"utf-8",
		);
		await writeFile(path.join(prebuiltAssetsDir, "review-comments.css"), ".review{}", "utf-8");
		await mkdir(path.join(prebuiltAssetsDir, "schemas", "scorm12"), { recursive: true });
	});

	afterEach(async () => {
		await rm(prebuiltAssetsDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("injects the sidebar assets into review HTML but not plain HTML or SCORM", async () => {
		const review = new AdmZip(
			(
				await buildScormPackage(desktopInput(true), {
					mode: "desktop",
					format: "html",
					prebuiltAssetsDir,
					projectDir: "/tmp/project",
				})
			).zip,
		);
		const plain = new AdmZip(
			(
				await buildScormPackage(desktopInput(), {
					mode: "desktop",
					format: "html",
					prebuiltAssetsDir,
					projectDir: "/tmp/project",
				})
			).zip,
		);
		const scorm = new AdmZip(
			(
				await buildScormPackage(desktopInput(true), {
					mode: "desktop",
					format: "scorm12",
					prebuiltAssetsDir,
					projectDir: "/tmp/project",
				})
			).zip,
		);

		expect(review.getEntry("review-comments.js")).not.toBeNull();
		expect(review.getEntry("review-comments.css")).not.toBeNull();
		expect(review.readAsText(stylesheetEntry(review))).not.toContain(".review{}");
		expect(review.readAsText(stylesheetEntry(review, true))).not.toContain(".review{}");
		expect(contentPage(review)).toMatch(/href="review-comments\.css\?v=[a-f0-9]{12}"/);
		expect(contentPage(review)).toMatch(/src="review-comments\.js\?v=[a-f0-9]{12}"/);
		expect(contentPage(review)).toContain('data-review-expires-at="2026-08-05T16:00:00.000Z"');
		expect(review.getEntry(HOST_FILENAMES.standalone)).not.toBeNull();
		expect(contentPage(review)).toContain(
			'<script id="praxity-deployment-config" type="application/json">{"format":"standalone"}</script>',
		);
		expect(contentPage(review)).toContain(`src="${HOST_FILENAMES.standalone}"`);
		expect(plain.getEntry(HOST_FILENAMES.standalone)).not.toBeNull();
		expect(contentPage(plain)).toContain(`src="${HOST_FILENAMES.standalone}"`);
		expect(plain.getEntry("review-comments.js")).toBeNull();
		expect(plain.readAsText(stylesheetEntry(plain))).not.toContain(".review{}");
		expect(plain.readAsText(stylesheetEntry(plain, true))).not.toContain(".review{}");
		expect(contentPage(plain)).not.toContain("review-comments");
		expect(scorm.getEntry("review-comments.js")).toBeNull();
		expect(contentPage(scorm)).not.toContain("review-comments");
		expect(scorm.getEntry(HOST_FILENAMES.scorm12)).not.toBeNull();
		expect(scorm.getEntry(HOST_FILENAMES.scorm2004)).toBeNull();
		expect(scorm.getEntry(HOST_FILENAMES.xapi)).toBeNull();
		expect(scorm.getEntry("scorm-runtime.js")).toBeNull();
	});

	it("loads, posts, and toggles comments without interpreting comment HTML", async () => {
		const dom = new JSDOM(
			"<!doctype html><html><head></head><body><main>Course</main></body></html>",
			{
				url: "https://reviews.example/s/abcdefghijklmnop/page-one.html",
				runScripts: "outside-only",
			},
		);
		Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 1200 });
		const maliciousText = '<img src=x onerror="alert(1)"> Helpful note';
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							page: "page-1",
							name: "Reviewer",
							text: maliciousText,
							at: "2026-07-22T16:00:00.000Z",
						},
					]),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						page: "page-1",
						name: "Ariel",
						text: "Looks good",
						at: "2026-07-22T16:05:00.000Z",
					}),
					{ status: 201, headers: { "Content-Type": "application/json" } },
				),
			);
		dom.window.fetch = fetchMock;
		const configScript = dom.window.document.createElement("script");
		configScript.dataset.praxityReviewComments = "true";
		configScript.dataset.reviewPageId = "page-1";
		configScript.dataset.reviewLocale = "en";
		configScript.dataset.reviewExpiresAt = "2026-08-05T11:00:00.000Z";
		dom.window.document.head.append(configScript);
		const source = await readFile(scriptPath, "utf-8");
		dom.window.eval(source);

		await vi.waitFor(() => {
			expect(dom.window.document.querySelector('[role="complementary"]')).not.toBeNull();
			expect(dom.window.document.querySelector(".prx-review-comment-text")?.textContent).toBe(
				maliciousText,
			);
		});
		const sidebar = dom.window.document.querySelector('[role="complementary"]');
		const liveStatus = sidebar?.querySelector<HTMLElement>(".prx-review-status");
		expect(liveStatus?.hidden).toBe(false);
		expect(liveStatus?.classList.contains("praxity-a11y-sr-only")).toBe(true);
		expect(liveStatus?.textContent).toBe("");
		const hiddenChanges: MutationRecord[] = [];
		const statusObserver = new dom.window.MutationObserver((records) =>
			hiddenChanges.push(...records),
		);
		if (!liveStatus) throw new Error("Expected persistent live status");
		statusObserver.observe(liveStatus, { attributes: true, attributeFilter: ["hidden"] });
		expect(sidebar?.getAttribute("aria-label")).toBe("Comments");
		expect(sidebar?.querySelector("img")).toBeNull();
		expect(sidebar?.querySelector(".prx-review-footer")?.textContent).toBe(
			"Review copy — expires Aug 5, 2026",
		);
		expect(fetchMock.mock.calls[0]).toEqual([
			"https://reviews.example/s/abcdefghijklmnop/comments?page=page-1",
		]);

		const toggle = sidebar?.querySelector<HTMLButtonElement>(".prx-review-toggle");
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(toggle?.textContent).toContain("Comments");
		expect(toggle?.textContent).toContain("1");
		toggle?.focus();
		toggle?.click();
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(dom.window.document.activeElement).toBe(toggle);

		const name = sidebar?.querySelector<HTMLInputElement>("#prx-review-name");
		const text = sidebar?.querySelector<HTMLTextAreaElement>("#prx-review-text");
		const form = sidebar?.querySelector<HTMLFormElement>("form");
		if (!name || !text || !form) throw new Error("Expected the comment form");
		name.value = "Ariel";
		text.value = "Looks good";
		form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		await vi.waitFor(() => expect(sidebar?.textContent).toContain("Looks good"));
		expect(fetchMock.mock.calls[1]?.[0]).toBe(
			"https://reviews.example/s/abcdefghijklmnop/comments",
		);
		expect(fetchMock.mock.calls[1]?.[1]).toEqual(
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ page: "page-1", name: "Ariel", text: "Looks good" }),
			}),
		);
		await vi.waitFor(() =>
			expect(sidebar?.querySelector(".prx-review-status")?.textContent).toBe("Comment posted."),
		);
		expect(
			sidebar?.querySelector(".prx-review-status")?.classList.contains("praxity-a11y-sr-only"),
		).toBe(true);
		expect(sidebar?.querySelector(".prx-review-status")?.getAttribute("aria-live")).toBe("polite");
		expect(text.value).toBe("");
		expect(sidebar?.querySelector(".prx-review-status")).toBe(liveStatus);
		expect(liveStatus.hidden).toBe(false);
		expect(hiddenChanges).toHaveLength(0);
		statusObserver.disconnect();
		expect(source).not.toContain("innerHTML");
	});

	it("follows active slides and snapshots their question or heading while requests are in flight", async () => {
		const dom = new JSDOM(
			`<!doctype html><html><head>
			<script data-praxity-review-comments="true" data-review-page-id="module"></script>
			</head><body><div class="praxity-deck" data-ready="true"><div class="deck-workspace"><main><article data-deck-slide="one" hidden><h1>First slide</h1></article>
			<article data-deck-slide="two"><p class="praxity-assessment-stem">Which choice is helpful?</p></article>
			<article data-deck-slide="three" hidden><h2>Knowledge check</h2><p class="praxity-assessment-stem">First question?</p></article></main></div><nav id="deck-controls"><div class="deck-utilities"><details id="deck-more" open><summary>More</summary><div class="deck-utility-items"></div></details></div></nav></div></body></html>`,
			{
				url: "https://reviews.example/s/abcdefghijklmnop/module.html",
				runScripts: "outside-only",
			},
		);
		let resolvePost!: (value: Response) => void;
		let resolveFirst!: (value: Response) => void;
		let resolveInitial!: (value: Response) => void;
		const fetchMock = vi.fn().mockImplementation((_url, options) => {
			if (fetchMock.mock.calls.length === 1)
				return new Promise<Response>((resolve) => {
					resolveInitial = resolve;
				});
			if (options?.method === "POST")
				return new Promise<Response>((resolve) => {
					resolvePost = resolve;
				});
			if (_url.endsWith("page=one"))
				return new Promise<Response>((resolve) => {
					resolveFirst = resolve;
				});
			return Promise.resolve(
				new Response(
					JSON.stringify([{ page: "two", name: "Old", text: "Legacy", at: "2026-07-22" }]),
				),
			);
		});
		dom.window.fetch = fetchMock;
		dom.window.eval(await readFile(scriptPath, "utf-8"));
		const doc = dom.window.document;
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const deckToggle = doc.querySelector<HTMLButtonElement>(
			".deck-utility-items .prx-review-toggle",
		);
		const sidebar = doc.querySelector<HTMLElement>(".prx-review-sidebar");
		expect(sidebar?.parentElement).toBe(doc.querySelector(".deck-workspace"));
		expect(sidebar?.parentElement?.contains(doc.querySelector("#deck-controls"))).toBe(false);
		expect(deckToggle).not.toBeNull();
		expect(deckToggle?.getAttribute("aria-label")).toBe("Expand comments");
		expect(deckToggle?.querySelector("svg")).not.toBeNull();
		expect(deckToggle?.querySelector(".prx-review-count")).toBeNull();
		expect(sidebar?.hidden).toBe(true);
		deckToggle?.focus();
		deckToggle?.click();
		expect(sidebar?.hidden).toBe(false);
		expect(sidebar?.querySelector(".prx-review-toggle")).toBe(deckToggle);
		expect(deckToggle?.getAttribute("aria-label")).toBe("Collapse comments");
		expect(doc.activeElement).toBe(deckToggle);
		expect(doc.querySelector(".prx-review-context")?.textContent).toBe(
			"Commenting on: Which choice is helpful?",
		);
		expect(doc.querySelector(".prx-review-submit")?.nextElementSibling).toBe(
			doc.querySelector(".prx-review-context"),
		);
		const style = doc.createElement("style");
		style.textContent = await readFile(
			path.resolve(testDir, "../template/review-comments.css"),
			"utf8",
		);
		doc.head.append(style);
		if (!sidebar) throw new Error("Expected review sidebar");
		expect(dom.window.getComputedStyle(sidebar).position).toBe("absolute");
		expect(dom.window.getComputedStyle(sidebar).bottom).toBe("0px");
		expect(dom.window.getComputedStyle(sidebar).height).toBe("auto");
		const context = doc.querySelector(".prx-review-context");
		if (!context) throw new Error("Expected comment context");
		expect(["", "normal", "400"]).toContain(dom.window.getComputedStyle(context).fontWeight);
		expect(doc.querySelector(".prx-review-comment-heading")).toBeNull();
		const name = doc.querySelector<HTMLInputElement>("#prx-review-name");
		const text = doc.querySelector<HTMLTextAreaElement>("#prx-review-text");
		if (!name || !text) throw new Error("Expected comment inputs");
		name.value = "Reviewer";
		text.value = "My note";
		doc.querySelector("form")?.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveInitial(
			new Response(
				JSON.stringify([{ page: "two", name: "Old", text: "Legacy", at: "2026-07-22" }]),
			),
		);
		await vi.waitFor(() =>
			expect(doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.disabled).toBe(false),
		);
		expect(doc.querySelector(".prx-review-comment-text")?.textContent).toBe("Legacy");
		deckToggle?.click();
		expect(doc.querySelector(".prx-review-count")?.textContent).toBe("1");
		deckToggle?.click();
		doc.querySelector("form")?.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
		const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
		expect(payload).toEqual({
			page: "two",
			pageHeading: "Which choice is helpful?",
			name: "Reviewer",
			text: "My note",
		});
		expect(doc.querySelector(".prx-review-comment-heading")).toBeNull();
		const change = (pageId: string) =>
			dom.window.dispatchEvent(
				new dom.window.CustomEvent("praxity:active-page-change", { detail: { pageId } }),
			);
		change("one");
		expect(doc.querySelector(".prx-review-context")?.textContent).toBe(
			"Commenting on: First slide",
		);
		expect(doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.disabled).toBe(true);
		doc.querySelector("form")?.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
		expect(fetchMock).toHaveBeenCalledTimes(3);
		change("two");
		await vi.waitFor(() =>
			expect(doc.querySelector(".prx-review-comment-text")?.textContent).toBe("Legacy"),
		);
		text.value = "New draft";
		resolvePost(new Response(JSON.stringify({ ...payload, at: "2026-07-22" })));
		await vi.waitFor(() =>
			expect(doc.querySelector<HTMLButtonElement>(".prx-review-submit")?.disabled).toBe(false),
		);
		expect(text.value).toBe("New draft");
		resolveFirst(
			new Response(JSON.stringify([{ page: "one", name: "Other", text: "Stale result" }])),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(doc.querySelector(".prx-review-list")?.textContent).not.toContain("Stale result");
		change("three");
		expect(doc.querySelector(".prx-review-context")?.textContent).toBe(
			"Commenting on: Knowledge check",
		);
		dom.window.close();
	});

	it.each(navigationCases)(
		"clears an unchanged submitted draft after successful delayed POST during $label navigation",
		async ({ pageId }) => {
			const { dom, doc, text, name, form, submit, fetchMock, resolvePost } =
				await delayedPostReviewDom();
			const submitted = "  Submitted note  ";
			name.value = "Reviewer";
			text.value = submitted;
			form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(0);
			expect(text.value).toBe("  Submitted note  ");
			expect(submit.disabled).toBe(true);
			expect(submit.textContent).toBe("Posting…");
			expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
				page: "two",
				pageHeading: "Second slide",
				text: "Submitted note",
			});
			navigateReviewPage(dom, pageId);
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(pageId === "one" ? 3 : 2));
			resolvePost(
				new Response(
					JSON.stringify({
						page: "two",
						name: "Reviewer",
						text: submitted.trim(),
						at: "2026-07-22T16:00:00.000Z",
					}),
					{ status: 201 },
				),
			);
			await vi.waitFor(() => expect(submit.disabled).toBe(false));
			expect(text.value).toBe("");
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(pageId === "two" ? 1 : 0);
			if (pageId === "two")
				expect(doc.querySelector(".prx-review-comment-text")?.textContent).toBe("Submitted note");
			dom.window.close();
		},
	);

	it.each(navigationCases)(
		"preserves a newer draft after successful delayed POST during $label navigation",
		async ({ pageId }) => {
			const { dom, doc, text, name, form, submit, fetchMock, resolvePost } =
				await delayedPostReviewDom();
			name.value = "Reviewer";
			text.value = "  Submitted note  ";
			form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(0);
			expect(text.value).toBe("  Submitted note  ");
			expect(submit.disabled).toBe(true);
			expect(submit.textContent).toBe("Posting…");
			expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
				page: "two",
				pageHeading: "Second slide",
				text: "Submitted note",
			});
			navigateReviewPage(dom, pageId);
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(pageId === "one" ? 3 : 2));
			text.value = "Newer draft";
			resolvePost(
				new Response(JSON.stringify({ page: "two", text: "Submitted note" }), { status: 201 }),
			);
			await vi.waitFor(() => expect(submit.disabled).toBe(false));
			expect(text.value).toBe("Newer draft");
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(pageId === "two" ? 1 : 0);
			dom.window.close();
		},
	);

	it.each(navigationCases)(
		"preserves the submitted draft after failed delayed POST during $label navigation",
		async ({ pageId }) => {
			const { dom, doc, text, name, form, submit, fetchMock, resolvePost } =
				await delayedPostReviewDom();
			name.value = "Reviewer";
			text.value = "  Submitted note  ";
			form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(0);
			expect(text.value).toBe("  Submitted note  ");
			expect(submit.disabled).toBe(true);
			expect(submit.textContent).toBe("Posting…");
			expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
				page: "two",
				pageHeading: "Second slide",
				text: "Submitted note",
			});
			navigateReviewPage(dom, pageId);
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(pageId === "one" ? 3 : 2));
			resolvePost(new Response("{}", { status: 500 }));
			await vi.waitFor(() => expect(submit.disabled).toBe(false));
			expect(text.value).toBe("  Submitted note  ");
			expect(doc.querySelectorAll(".prx-review-comment")).toHaveLength(0);
			if (pageId === "two")
				expect(doc.querySelector<HTMLElement>(".prx-review-error")?.hidden).toBe(false);
			dom.window.close();
		},
	);

	it("uses French accessible labels for French review builds", async () => {
		const dom = new JSDOM(
			"<!doctype html><html><head></head><body><main><h1>Introduction</h1></main></body></html>",
			{
				url: "https://reviews.example/s/abcdefghijklmnop/page-one.html",
				runScripts: "outside-only",
			},
		);
		dom.window.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify([
					{
						name: "<b>Réviseur</b>",
						text: "<img src=x onerror=alert(1)> Note",
						pageHeading: "<em>Introduction</em>",
					},
				]),
			),
		);
		const configScript = dom.window.document.createElement("script");
		configScript.dataset.praxityReviewComments = "true";
		configScript.dataset.reviewPageId = "page-1";
		configScript.dataset.reviewLocale = "fr";
		configScript.dataset.reviewExpiresAt = "2026-08-05T11:00:00.000Z";
		dom.window.document.head.append(configScript);
		const source = await readFile(scriptPath, "utf-8");
		dom.window.eval(source);

		await vi.waitFor(() =>
			expect(
				dom.window.document.querySelector('[role="complementary"]')?.getAttribute("aria-label"),
			).toBe("Commentaires"),
		);
		expect(dom.window.document.querySelector('label[for="prx-review-name"]')?.textContent).toBe(
			"Nom",
		);
		expect(dom.window.document.querySelector('label[for="prx-review-text"]')?.textContent).toBe(
			"Commentaire",
		);
		expect(source).toContain("Commentaire publié.");
		expect(dom.window.document.querySelector(".prx-review-context")?.textContent).toBe(
			"Commentaire sur\u202f: Introduction",
		);
		await vi.waitFor(() =>
			expect(dom.window.document.querySelector(".prx-review-comment-text")?.textContent).toBe(
				"<img src=x onerror=alert(1)> Note",
			),
		);
		expect(
			dom.window.document.querySelector(".prx-review-comment-byline strong")?.textContent,
		).toBe("<b>Réviseur</b>");
		expect(dom.window.document.querySelector(".prx-review-comment-heading")?.textContent).toBe(
			"<em>Introduction</em>",
		);
		expect(
			dom.window.document.querySelector(
				".prx-review-list img, .prx-review-list b, .prx-review-list em",
			),
		).toBeNull();
		expect(dom.window.document.querySelector(".prx-review-footer")?.textContent).toBe(
			"Copie de révision — expire le 5 août 2026",
		);
		dom.window.close();
	});
});

describe("legacy review requests", () => {
	const locales = [
		{
			locale: "en",
			loadError: "Comments could not be loaded.",
			postError: "Comment could not be posted.",
			empty: "No comments on this page yet.",
		},
		{
			locale: "fr",
			loadError: "Impossible de charger les commentaires.",
			postError: "Impossible de publier le commentaire.",
			empty: "Aucun commentaire pour cette page.",
		},
	];
	const failures = ["http", "json", "network"] as const;
	const doms: JSDOM[] = [];

	afterEach(() => {
		for (const dom of doms.splice(0)) dom.window.close();
	});

	async function openReview(
		fetchMock: typeof fetch,
		locale = "en",
		pathname = "/s/abcdefghijklmnop/nested/page.html",
	) {
		const dom = new JSDOM(
			`<!doctype html><html><head><script data-praxity-review-comments="true"
			data-review-page-id="lesson/page & one" data-review-locale="${locale}"></script>
			</head><body><main>Course</main></body></html>`,
			{ url: `https://reviews.example${pathname}`, runScripts: "outside-only" },
		);
		doms.push(dom);
		dom.window.fetch = fetchMock;
		dom.window.eval(await readFile(scriptPath, "utf-8"));
		await vi.waitFor(() =>
			expect(dom.window.document.querySelector(".prx-review-form")).not.toBeNull(),
		);
		return dom;
	}

	it.each(locales.flatMap((locale) => failures.map((failure) => ({ ...locale, failure }))))(
		"keeps $locale load and post errors for $failure failures",
		async ({ locale, loadError, postError, empty, failure }) => {
			const failedResponse = () =>
				failure === "network"
					? Promise.reject(new Error("offline"))
					: Promise.resolve(
							new Response(failure === "json" ? "invalid json" : "[]", {
								status: failure === "http" ? 500 : 200,
							}),
						);
			const fetchMock = vi
				.fn()
				.mockImplementationOnce(failedResponse)
				.mockResolvedValueOnce(new Response("[]"))
				.mockImplementationOnce(failedResponse);
			const dom = await openReview(fetchMock, locale);
			const doc = dom.window.document;
			await vi.waitFor(() =>
				expect(doc.querySelector(".prx-review-status")?.textContent).toBe(loadError),
			);
			expect(fetchMock.mock.calls[0]).toEqual([
				"https://reviews.example/s/abcdefghijklmnop/comments?page=lesson%2Fpage+%26+one",
			]);
			navigateReviewPage(dom, "next/page");
			const submit = doc.querySelector<HTMLButtonElement>(".prx-review-submit");
			await vi.waitFor(() => expect(submit?.disabled).toBe(false));
			expect(doc.querySelector(".prx-review-status")?.textContent).toBe(empty);
			expect(fetchMock.mock.calls[1]).toEqual([
				"https://reviews.example/s/abcdefghijklmnop/comments?page=next%2Fpage",
			]);
			const name = doc.querySelector<HTMLInputElement>("#prx-review-name");
			const text = doc.querySelector<HTMLTextAreaElement>("#prx-review-text");
			if (!name || !text) throw new Error("Expected comment inputs");
			name.value = "  Reviewer  ";
			text.value = "  Keep this draft  ";
			doc
				.querySelector("form")
				?.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
			await vi.waitFor(() =>
				expect(doc.querySelector(".prx-review-error")?.textContent).toBe(postError),
			);
			expect(doc.querySelector<HTMLElement>(".prx-review-error")?.hidden).toBe(false);
			expect(text.value).toBe("  Keep this draft  ");
			expect(submit?.disabled).toBe(false);
			expect(fetchMock.mock.calls[2]).toEqual([
				"https://reviews.example/s/abcdefghijklmnop/comments",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: '{"page":"next/page","name":"Reviewer","text":"Keep this draft"}',
				},
			]);
		},
	);

	it.each([
		{ pathname: "/page.html", url: "https://reviews.example/comments?page=lesson%2Fpage+%26+one" },
		{ pathname: "/s/", url: "https://reviews.example/comments?page=lesson%2Fpage+%26+one" },
		{
			pathname: "/s/review%20slug/page.html",
			url: "https://reviews.example/s/review%2520slug/comments?page=lesson%2Fpage+%26+one",
		},
	])(
		"preserves the request URL and empty list fallback at $pathname",
		async ({ pathname, url }) => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{"comments":[]}'));
			const dom = await openReview(fetchMock, "en", pathname);
			await vi.waitFor(() =>
				expect(dom.window.document.querySelector(".prx-review-status")?.textContent).toBe(
					"No comments on this page yet.",
				),
			);
			expect(fetchMock.mock.calls).toEqual([[url]]);
			expect(dom.window.document.querySelectorAll(".prx-review-comment")).toHaveLength(0);
		},
	);
});
