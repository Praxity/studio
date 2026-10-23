import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { test as base, expect } from "@playwright/test";
import { startStudioServer } from "../../src/main/studio/server";

const source =
	"---\ntitle: Accessibility fixture\n---\n# First\n\n::: accordion Container {style=shaded level=2}\n:: Item {level=3}\nBody.\n:::\n\n# Second page\n\n::: choice Practice {shuffle level=2}\nQuestion?\n(x) Yes\n( ) No\n:::\n";

const test = base.extend<object, { a11ySession: string }>({
	a11ySession: [
		async ({ browserName }, use) => {
			// Prepare before listening: browser projects must not rewrite each other's active lesson.
			const editorAssetsDir = process.env.PRAXITY_BROWSER_EDITOR_ASSETS;
			if (!editorAssetsDir) throw new Error("Browser editor assets were not prepared");
			const projectDir = await mkdtemp(
				join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), `a11y-${browserName}-`),
			);
			try {
				await writeFile(
					join(projectDir, "course.yaml"),
					"title: Accessibility journey\nlessons: [second.prax]\n",
				);
				await writeFile(join(projectDir, "second.prax"), source.replace(/\n/g, "\r\n"));
				const server = await startStudioServer({
					projectDir,
					editorAssetsDir,
					appVersion: "0.3.0",
					exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
				});
				try {
					await use(server.readyUrl);
				} finally {
					await server.close();
				}
			} finally {
				await rm(projectDir, { recursive: true });
			}
		},
		{ scope: "worker" },
	],
});

test("axe projects stay outside the inventoried editor payload", async ({
	a11ySession,
	request,
}) => {
	const sessionUrl = new URL(a11ySession);
	const token = new URLSearchParams(sessionUrl.hash.slice(1)).get("session");
	const response = await request.get(new URL("/api/session", sessionUrl).href, {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(response.ok()).toBe(true);
	const { result } = await response.json();
	const assets = process.env.PRAXITY_BROWSER_EDITOR_ASSETS;
	if (!assets) throw new Error("Browser editor assets were not prepared");
	const payloadPath = relative(dirname(assets), result.project.projectPath);
	expect(payloadPath.startsWith("..") || isAbsolute(payloadPath)).toBe(true);
	expect(await realpath(dirname(result.project.projectPath))).toBe(
		await realpath(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir()),
	);
});
