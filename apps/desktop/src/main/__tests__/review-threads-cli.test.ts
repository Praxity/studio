import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_LIMITS, REVIEW_TEXT_RULES } from "@praxity/review-share/review";
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { openReviewStore } from "../studio/review-store";

let root: string;
let store: Awaited<ReturnType<typeof openReviewStore>>;
let server: Awaited<ReturnType<typeof startStudioReadOnlyServer>>;
let threadId: string;
const resolvedIds: string[] = [];
const capability = "A".repeat(43);
const source = await readFile(
	new URL("../../../../../packages/export-pipeline/template/review-comments.js", import.meta.url),
	"utf8",
);
const doms: JSDOM[] = [];
beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "review-threads-cli-"));
	await writeFile(join(root, "course.yaml"), "title: Review\nlessons: [lesson.prax]\n");
	await writeFile(join(root, "lesson.prax"), "# Page\n\nPassage.\n");
	store = await openReviewStore(root);
	const created = await store.create(await store.principalFor("reviewer", "local-preview"), {
		reviewId: store.reviewId,
		requestId: randomUUID(),
		body: "Please fix this.",
		anchor: {
			courseId: null,
			lessonId: "lesson",
			pageId: "page",
			nodeId: null,
			blockId: null,
			revision: null,
			quote: null,
			pin: null,
			tab: null,
			revealPath: [],
			cssPath: null,
			context: { pageTitle: "Page", targetLabel: null },
		},
	});
	if (!created.ok || !created.thread) throw new Error(JSON.stringify(created));
	threadId = created.thread.id;
	for (let i = 0; i < 3; i++) {
		const other = await store.create(await store.principalFor("reviewer", "local-preview"), {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			body: "Initial feedback",
			anchor: created.thread.anchor,
		});
		if (!other.ok || !other.thread) throw new Error(JSON.stringify(other));
		resolvedIds.push(other.thread.id);
		if (i === 2) continue;
		const closed = await store.resolve(await store.principalFor("author", "local-cli"), {
			reviewId: store.reviewId,
			threadId: other.thread.id,
			requestId: randomUUID(),
			expectVersion: 1,
			body: "Initial resolution",
		});
		if (!closed.ok) throw new Error(JSON.stringify(closed));
	}
	server = await startStudioReadOnlyServer({
		projectDir: root,
		getEditorOrigin: () => "http://127.0.0.1:1",
		review: { store, capability },
	});
});
afterEach(async () => {
	for (const dom of doms.splice(0)) {
		dom.window.dispatchEvent(new dom.window.Event("pagehide"));
		await settle();
		dom.window.close();
	}
});
afterAll(async () => {
	await server?.close();
	if (root) await rm(root, { recursive: true });
});
async function settle() {
	for (let i = 0; i < 100; i++) await Promise.resolve();
}
async function page() {
	const config = {
		schema: 1,
		reviewId: store.reviewId,
		capability,
		endpoint: `/api/reviews/${store.reviewId}`,
		locale: "en",
		limits: REVIEW_LIMITS,
		textRules: {
			controls: REVIEW_TEXT_RULES.bodyControls,
			surrogates: REVIEW_TEXT_RULES.surrogates,
		},
		blockNames: {},
		page: { lessonId: "lesson", pageId: "page", pageIds: ["page"], pageIndex: 0, revision: null },
	};
	const dom = new JSDOM(
		`<html><head><script type="application/json" id="praxity-review-config">${JSON.stringify(config)}</script><script data-praxity-review-comments="true"></script></head><body><main><h1>Page</h1></main></body></html>`,
		{ url: `${server.origin}/lesson.html`, runScripts: "outside-only", pretendToBeVisual: true },
	);
	doms.push(dom);
	dom.window.fetch = (url, options) =>
		fetch(new URL(String(url), server.origin), {
			...options,
			headers: { ...options?.headers, Origin: server.origin },
		});
	dom.window.requestAnimationFrame = () => 1;
	dom.window.eval(source);
	dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
	await vi.waitFor(() =>
		expect(dom.window.document.querySelectorAll(".prx-review-comment")).toHaveLength(4),
	);
	(dom.window.document.querySelector(".prx-review-toggle") as HTMLButtonElement).click();
	return dom;
}
async function cli(kind: "reply" | "resolve", version: number, body: string, targetId = threadId) {
	const text = join(root, "reply.txt");
	await writeFile(text, body);
	const result = await runPraxityCli(
		[
			"comments",
			kind,
			root,
			targetId,
			kind === "resolve" ? "--reply-file" : "--text-file",
			text,
			"--expect-version",
			String(version),
			"--request-id",
			randomUUID(),
			"--json",
		],
		{ appVersion: "test", exportAssetsDir: "unused" },
	);
	expect(result.exitCode, result.stderr).toBe(0);
}
it("CLI reply reaches the browser on refresh and survives reload", async () => {
	const dom = await page(),
		doc = dom.window.document.querySelector(`[data-thread-id="${threadId}"]`)!;
	await cli("reply", 1, "Agent reply through CLI");
	dom.window.dispatchEvent(new dom.window.Event("focus"));
	await vi.waitFor(() => expect(doc.querySelectorAll(".prx-review-comment-text")).toHaveLength(2));
	expect(
		[...doc.querySelectorAll(".prx-review-comment-text")].map((node) => node.textContent),
	).toEqual(["Please fix this.", "Agent reply through CLI"]);
	expect(
		[...doc.querySelectorAll(".prx-review-message-author")].map((node) => node.textContent),
	).toEqual(["You", "Agent"]);
	const reload = await page(),
		reloaded = reload.window.document.querySelector(`[data-thread-id="${threadId}"]`)!;
	expect(reloaded.querySelectorAll(".prx-review-comment-text")).toHaveLength(2);
});
it("CLI resolution reaches the browser on refresh and survives reload", async () => {
	const dom = await page(),
		selector = `[data-thread-id="${resolvedIds[2]}"] .prx-review-thread-status`;
	await cli("resolve", 1, "Fixed and verified", resolvedIds[2]);
	dom.window.dispatchEvent(new dom.window.Event("focus"));
	await vi.waitFor(() =>
		expect(dom.window.document.querySelector(selector)?.textContent).toBe("Resolved by Agent"),
	);
	const reloaded = await page();
	expect(reloaded.window.document.querySelector(selector)?.textContent).toBe("Resolved by Agent");
});
it("reviewer reply reopens a durable resolved thread", async () => {
	const reload = await page(),
		reloaded = reload.window.document.querySelector(`[data-thread-id="${resolvedIds[0]}"]`)!;
	(reloaded.querySelector(".prx-review-reply-toggle") as HTMLButtonElement).click();
	(reloaded.querySelector(".prx-review-reply textarea") as HTMLTextAreaElement).value =
		"Please check again.";
	(reloaded.querySelector(".prx-review-reply-send") as HTMLButtonElement).click();
	await vi.waitFor(() =>
		expect(reloaded.querySelector(".prx-review-thread-status")?.textContent).toBe("Open"),
	);
	const persisted = await (await openReviewStore(root)).list(
		await store.principalFor("reviewer", "local-preview"),
	);
	if (!("threads" in persisted)) throw new Error(persisted.code);
	const thread = persisted.threads.find((thread) => thread.id === resolvedIds[0]);
	expect(thread).toMatchObject({
		id: resolvedIds[0],
		version: 3,
		status: "open",
		resolution: null,
	});
	expect(thread?.messages.map((message) => message.body)).toEqual([
		"Initial feedback",
		"Initial resolution",
		"Please check again.",
	]);
});
it("reviewer explicitly reopens a resolved thread through HTTP and retains it after reload", async () => {
	const dom = await page(),
		doc = dom.window.document;
	const thread = doc.querySelector(`[data-thread-id="${resolvedIds[1]}"]`)!;
	(thread.querySelector(".prx-review-reopen") as HTMLButtonElement).click();
	await vi.waitFor(() =>
		expect(thread.querySelector(".prx-review-thread-status")?.textContent).toBe("Open"),
	);
	const reloaded = await page();
	expect(
		reloaded.window.document.querySelector(
			`[data-thread-id="${resolvedIds[1]}"] .prx-review-thread-status`,
		)?.textContent,
	).toBe("Open");
});
