import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import { openReviewStore } from "../studio/review-store";
import type { StudioServer } from "../studio/server";

const assetsDir = fileURLToPath(new URL("../../../resources/export-assets", import.meta.url));
const servers: StudioServer[] = [];
let root: string;
let projectDir: string;
let editorAssetsDir: string;
let sharedReview: Awaited<ReturnType<typeof start>>;
beforeAll(async () => {
	await import("../studio/server");
	root = await mkdtemp(join(tmpdir(), "studio-review-cli-"));
	projectDir = join(root, "project");
	editorAssetsDir = join(root, "editor");
	await mkdir(projectDir);
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362",
	);
	await writeFile(
		join(projectDir, "course.yaml"),
		"title: Review fixture\nlessons: [one.prax, two.prax]\n",
	);
	await writeFile(
		join(projectDir, "one.prax"),
		"---\ntitle: First lesson\n---\n# First page\n\nFirst body.\n\n# Second page\n\nSecond body.\n",
	);
	await writeFile(
		join(projectDir, "two.prax"),
		"---\ntitle: Second lesson\n---\n# Third page\n\nThird body.\n",
	);
	sharedReview = await start();
});
afterAll(async () => {
	await Promise.all(servers.map((server) => server.close()));
	if (root) await rm(root, { recursive: true });
});
async function start(review = true) {
	const result = await runPraxityCli(
		["studio", projectDir, "--no-open", ...(review ? ["--review"] : [])],
		{
			appVersion: "0.3.0",
			exportAssetsDir: assetsDir,
			editorAssetsDir,
		},
	);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(result.openBrowser).toBe(false);
	const server = result.studioServer;
	if (!server) throw new Error(result.stderr);
	servers.push(server);
	expect(result.stdout).toBe(`${server.readyUrl}\n`);
	const response = await fetch(server.readyUrl);
	expect(response.status).toBe(200);
	const html = await response.text();
	const dom = new JSDOM(html);
	const config = JSON.parse(
		dom.window.document.getElementById("praxity-review-config")?.textContent ?? "null",
	);
	dom.window.close();
	const authorToken = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
	expect(authorToken).toBeTruthy();
	expect(html).not.toContain(authorToken);
	return { result, server, response, html, config, authorToken };
}

it("CLI prints the ready URL and serves Read bootstrap, assets and the author page", async () => {
	const first = sharedReview;
	expect(first.config.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
	expect(first.config.endpoint).toBe(`/api/reviews/${first.config.reviewId}`);
	expect(first.config.page).toMatchObject({ pageIndex: 0 });
	expect(first.config.page.pageIds).toHaveLength(2);
	expect(first.config.page.revision).toMatch(/^[a-f0-9]{64}$/);
	for (const name of ["review-comments.js", "review-comments.css"]) {
		const response = await fetch(new URL(`/_praxity/review/${name}`, first.response.url));
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain(first.authorToken);
	}
	const listed = await fetch(new URL(`${first.config.endpoint}/comments`, first.response.url), {
		headers: { "X-Praxity-Review": first.config.capability },
	});
	expect(listed.status).toBe(200);
	expect(await listed.text()).not.toContain(first.authorToken);
	const author = await fetch(
		`${first.server.origin}/launch?canvas=${encodeURIComponent(new URL(first.response.url).pathname.slice(7))}`,
	);
	const authorHtml = await author.text();
	expect(authorHtml).not.toContain("praxity-review-config");
	expect(authorHtml).not.toContain("/_praxity/review/");
	expect(authorHtml).toContain(first.response.url.split("?")[0]);
});

it("CLI restart remints its capability with the same durable review and refuses the old capability", async () => {
	const first = sharedReview;
	await first.server.close();
	const second = await start();
	sharedReview = second;
	expect(second.config.reviewId).toBe(first.config.reviewId);
	expect(second.config.capability).not.toBe(first.config.capability);
	expect(
		(
			await fetch(new URL(`${second.config.endpoint}/comments`, second.response.url), {
				headers: { "X-Praxity-Review": first.config.capability },
			})
		).status,
	).toBe(401);
});

it.each(["html", "scorm-1.2", "scorm-2004"])(
	"%s export contains no local review config, credentials or feedback while review runs",
	async (format) => {
		const running = await start();
		const store = await openReviewStore(projectDir);
		const feedback = "Private review feedback must stay local";
		const created = await store.create(await store.principalFor("reviewer", "local-preview"), {
			reviewId: store.reviewId,
			requestId: randomUUID(),
			body: feedback,
			anchor: {
				courseId: null,
				lessonId: running.config.page.lessonId,
				pageId: running.config.page.pageId,
				nodeId: null,
				blockId: null,
				revision: null,
				quote: null,
				pin: null,
				tab: null,
				revealPath: [],
				cssPath: null,
				context: { pageTitle: null, targetLabel: null },
			},
		});
		expect(created.ok).toBe(true);
		const output = join(root, `${format}.zip`);
		const result = await runPraxityCli(
			["export", projectDir, "--format", format, "--output", output],
			{ appVersion: "0.3.0", exportAssetsDir: assetsDir },
		);
		expect(result.exitCode, result.stderr).toBe(0);
		const zip = new AdmZip(await readFile(output));
		for (const entry of zip.getEntries()) {
			const text = zip.readAsText(entry);
			for (const privateValue of [
				"praxity-review-config",
				"_praxity/review/",
				running.config.capability,
				running.authorToken,
				feedback,
			])
				expect(text).not.toContain(privateValue);
		}
		await running.server.close();
	},
);

it("plain CLI startup stays in Read mode without review credentials or assets", async () => {
	const running = await start(false);
	expect(running.config).toBeNull();
	expect(running.html).not.toContain("/_praxity/review/");
	const response = await fetch(
		new URL("/_praxity/review/review-comments.js", running.response.url),
	);
	expect(response.status).toBe(404);
});
