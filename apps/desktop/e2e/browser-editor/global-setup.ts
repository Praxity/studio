import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, BrowserContext } from "@playwright/test";
import { build } from "vite";
import { startStudioServer } from "../../src/main/studio/server";

export default async function setup() {
	const scratch = process.env.PRAXITY_TEST_ARTIFACTS ?? join(tmpdir(), "studio-browser-editor");
	await mkdir(scratch, { recursive: true });
	const root = await mkdtemp(join(scratch, "journey-"));
	const artifact = process.env.PRAXITY_BROWSER_ARTIFACT;
	const editorAssetsDir = artifact ? join(artifact, "editor") : join(root, "editor");
	if (!artifact)
		await build({
			configFile: resolve(import.meta.dirname, "../../browser.vite.config.ts"),
			build: { outDir: editorAssetsDir },
		});
	process.env.PRAXITY_BROWSER_EDITOR_ASSETS = editorAssetsDir;
}

export async function startJourney(
	owner: Browser | BrowserContext,
	options: { standaloneSource?: string; courseFixture?: string; port?: number } = {},
) {
	async function drainRoutes() {
		const contexts = "contexts" in owner ? owner.contexts() : [owner];
		// Route handlers can still need Studio after the test's final assertion.
		await Promise.all(
			contexts.flatMap((context) => [
				context.unrouteAll({ behavior: "wait" }),
				...context.pages().map((page) => page.unrouteAll({ behavior: "wait" })),
			]),
		);
	}
	const scratch = process.env.PRAXITY_TEST_ARTIFACTS ?? join(tmpdir(), "studio-browser-editor");
	const root = await mkdtemp(join(scratch, "journey-"));
	const artifact = process.env.PRAXITY_BROWSER_ARTIFACT;
	const editorAssetsDir = process.env.PRAXITY_BROWSER_EDITOR_ASSETS;
	if (!editorAssetsDir) throw new Error("Browser journey editor assets were not initialized");
	const projectDir = join(root, "project");
	await mkdir(projectDir);
	if (options.courseFixture) {
		await cp(options.courseFixture, projectDir, { recursive: true });
	} else {
		if (options.standaloneSource === undefined)
			await writeFile(
				join(projectDir, "course.yaml"),
				"title: Browser journey\nlessons: [second.prax, first.prax]\n",
			);
		const source = "---\ntitle: Same\n---\n\n# First\n\nOriginal body.\n";
		if (options.standaloneSource === undefined)
			await writeFile(join(projectDir, "first.prax"), source);
		await writeFile(join(projectDir, "second.prax"), options.standaloneSource ?? source);
	}
	process.env.PRAXITY_BROWSER_PROJECT = projectDir;
	if (artifact) {
		const child = spawn(
			process.execPath,
			[
				join(artifact, "praxity.mjs"),
				"studio",
				projectDir,
				"--no-open",
				...(options.port === undefined ? [] : ["--port", String(options.port)]),
			],
			{ cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		const stopped = new Promise<void>((resolve) => child.once("close", () => resolve()));
		try {
			process.env.PRAXITY_BROWSER_READY_URL = await new Promise<string>((resolveReady, reject) => {
				let output = "";
				let errors = "";
				const timer = setTimeout(
					() => reject(new Error(`Packaged Studio did not start: ${errors}`)),
					20_000,
				);
				child.once("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
				child.once("exit", (code) => {
					clearTimeout(timer);
					reject(new Error(`Packaged Studio exited (${code}): ${errors}`));
				});
				child.stderr.on("data", (bytes) => {
					errors += bytes.toString();
				});
				child.stdout.on("data", (bytes) => {
					output += bytes.toString();
					const ready = output.match(/http:\/\/127\.0\.0\.1:\d+\/#session=[a-zA-Z0-9_-]+/);
					if (ready) {
						clearTimeout(timer);
						resolveReady(ready[0]);
					}
				});
			});
		} catch (error) {
			child.kill();
			await stopped;
			throw error;
		}
		return async () => {
			await drainRoutes();
			child.kill();
			await stopped;
		};
	}
	const server = await startStudioServer({
		projectDir,
		port: options.port,
		editorAssetsDir,
		appVersion: "0.3.0",
		exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
		typstExecutablePath: process.env.PRAXITY_TEST_TYPST,
	});
	process.env.PRAXITY_BROWSER_READY_URL = server.readyUrl;
	// Retain the build and authored test files as evidence; never copy the ready URL to disk.
	return async () => {
		await drainRoutes();
		await server.close();
	};
}
