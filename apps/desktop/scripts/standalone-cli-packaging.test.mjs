import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build, loadConfigFromFile } from "vite";
import * as packaging from "./standalone-cli-packaging.mjs";
import { filesIn, inventoryPayload, packagePraxFormat } from "./standalone-cli-packaging.mjs";
import { portablePath } from "./standalone-cli-paths.mjs";

const repoDir = fileURLToPath(new URL("../../../", import.meta.url));
const sourceDir = path.join(repoDir, "docs/prax-format");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("browser build ships only the thin canvas and its digest", async () => {
	const result = await build({
		configFile: path.join(repoDir, "apps/desktop/browser.vite.config.ts"),
		logLevel: "silent",
		build: { write: false },
	});
	assert.deepEqual(result.output.map((file) => file.fileName).sort(), [
		"canvas.js",
		"canvas.sha256",
	]);
});

test("canvas import check rejects each retired dependency, including transitive modules", () => {
	for (const file of [
		"apps/desktop/src/renderer/App.tsx",
		"apps/desktop/src/renderer/EditorView.tsx",
		"apps/desktop/src/renderer/browser/bridge.ts",
		"packages/editor-core/src/session/controller.ts",
		"apps/desktop/src/renderer/new-editor/draft-persistence.ts",
		"apps/desktop/src/renderer/new-editor/lesson-session.ts",
		"apps/desktop/src/renderer/new-editor/project-sessions.ts",
		"apps/desktop/src/renderer/components/lens/EditorSessionHost.tsx",
		"apps/desktop/src/renderer/components/course-map/OutlineTree.tsx",
		"packages/editor-core/src/shortcuts/regions.ts",
		"apps/desktop/src/main/operations/local-editor-store.ts",
		"packages/editor-core/src/frame-bridge/source-field.ts",
	]) {
		assert.throws(() => packaging.assertCanvasInputs([file]), /Forbidden canvas dependency/);
		assert.throws(
			() => packaging.assertCanvasInputs([file.replaceAll("/", "\\")]),
			/Forbidden canvas dependency/,
		);
	}
	assert.doesNotThrow(() =>
		packaging.assertCanvasInputs([
			"apps/desktop/src/renderer/browser/canvas.ts",
			"apps/desktop/src/renderer/browser/canvas-text.ts",
			"apps/desktop/src/renderer/browser/event-stream.ts",
			"apps/desktop/src/shared/canvas-messages.ts",
			"apps/desktop/src/shared/canvas-styles.ts",
		]),
	);
});

test("canvas build emits its source closure and refuses a planted transitive shell import", async (t) => {
	const root = await temporaryArtifact(t);
	const entry = path.join(root, "canvas.ts");
	const forbidden = path.join(root, "renderer", "App.tsx");
	await mkdir(path.dirname(forbidden), { recursive: true });
	await writeFile(forbidden, "export const shell = 'old shell';");
	await writeFile(entry, "export function startStudioAuthor() { return 'canvas'; }");
	const plugin = packaging.canvasBundlePlugin(entry);
	const options = {
		configFile: false,
		logLevel: "silent",
		plugins: [plugin],
		build: { write: false, rollupOptions: { input: entry } },
	};
	const result = await build(options);
	const canvas = result.output.find((file) => file.fileName === "canvas.js");
	assert.ok(canvas);
	assert.match(canvas.source, /PraxityCanvas/);
	assert.equal(
		result.output.find((file) => file.fileName === "canvas.sha256")?.source,
		`${sha256(canvas.source)}\n`,
	);
	assert.deepEqual(plugin.api.inputs.map(portablePath), [portablePath(entry)]);
	assert.ok(!result.output.some((file) => file.fileName.endsWith(".map")));
	await writeFile(entry, "export { shell as startStudioAuthor } from './renderer/App';");
	await assert.rejects(build(options), /Forbidden canvas dependency/);
});

test("shipped canvas entry includes the native text adapter and protected control styles", async (t) => {
	const root = await temporaryArtifact(t);
	const entry = path.join(root, "empty.ts");
	await writeFile(entry, "void 0;");
	const loaded = await loadConfigFromFile(
		{ command: "build", mode: "production" },
		path.join(repoDir, "apps/desktop/browser.vite.config.ts"),
	);
	const canvas = loaded.config.plugins.find((plugin) => plugin.name === "studio-canvas-bundle");
	await build({
		configFile: false,
		logLevel: "silent",
		plugins: [canvas],
		build: { write: false, rollupOptions: { input: entry } },
	});
	const inputs = canvas.api.inputs.map((file) => portablePath(path.relative(repoDir, file)));
	for (const file of [
		"apps/desktop/src/renderer/browser/canvas.ts",
		"apps/desktop/src/renderer/browser/canvas-text.ts",
		"apps/desktop/src/renderer/browser/event-stream.ts",
		"apps/desktop/src/shared/canvas-styles.ts",
	])
		assert.ok(inputs.includes(file), `Missing packaged canvas input: ${file}`);
});

async function temporaryArtifact(t) {
	const directory = await mkdtemp(path.join(tmpdir(), "praxity cli packaging "));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

test("format package preserves public docs, skill links, legal bytes, and complete inventory", async (t) => {
	const outputDir = await temporaryArtifact(t);
	const sources = await packagePraxFormat(sourceDir, outputDir);
	const payload = await inventoryPayload(outputDir, repoDir, { platform: "win32", arch: "x64" });
	const expected = [
		"SKILL.md",
		"README.md",
		"inline-icons.md",
		"cli.md",
		"LICENSE",
		...(await filesIn(path.join(sourceDir, "skill"))).map((file) =>
			portablePath(path.relative(sourceDir, file)),
		),
		...(await filesIn(path.join(sourceDir, "reference"))).map((file) =>
			portablePath(path.relative(sourceDir, file)),
		),
		...(await filesIn(path.join(sourceDir, "examples"))).map((file) =>
			portablePath(path.relative(sourceDir, file)),
		),
	].sort();
	assert.deepEqual(
		sources.map((file) => portablePath(path.relative(sourceDir, file))),
		expected,
	);
	assert.deepEqual(
		payload.files.map((file) => file.path),
		expected.map((file) => `prax-format/${file}`),
	);
	assert.equal(payload.payloadSha256, sha256(JSON.stringify(payload.files)));
	let checkedLinks = 0;
	for (const file of payload.files) {
		const packaged = path.join(outputDir, file.path);
		const bytes = await readFile(packaged);
		assert.deepEqual(bytes, await readFile(path.join(sourceDir, file.path.slice(12))));
		assert.equal(file.bytes, bytes.length);
		assert.equal(file.sha256, sha256(bytes));
		assert.equal(file.component, "prax-format-documentation");
		if (!file.path.endsWith(".md")) continue;
		// Code examples contain placeholder link destinations, not documentation dependencies.
		const markdown = bytes
			.toString("utf8")
			.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
			.replace(/(`+)[\s\S]*?\1/g, "");
		for (const [, href] of markdown.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
			if (/^(?:[a-z][\w+.-]*:|#)/i.test(href)) continue;
			const target = path.resolve(path.dirname(packaged), href.split(/[?#]/)[0]);
			assert.ok(target.startsWith(`${path.join(outputDir, "prax-format")}${path.sep}`), href);
			await readFile(target);
			checkedLinks++;
		}
	}
	assert.ok(checkedLinks > 20, "checked the skill's transitive public documentation links");
	assert.ok(!payload.files.some((file) => file.path.includes("scripts/")));
});

for (const [platform, arch, binary] of [
	["win32", "x64", "typst.exe"],
	["darwin", "arm64", "typst"],
	["darwin", "x64", "typst"],
]) {
	test(`payload inventory records ${platform}/${arch} without requiring the target host`, async (t) => {
		const outputDir = await temporaryArtifact(t);
		await mkdir(path.join(outputDir, "typst"));
		await mkdir(path.join(outputDir, "export-assets"));
		await mkdir(path.join(outputDir, "legal"));
		await mkdir(path.join(outputDir, "editor"));
		await writeFile(
			path.join(outputDir, "editor", "index.html"),
			'<script type="module" src="/editor.js"></script>',
		);
		await writeFile(path.join(outputDir, "editor", "editor.js"), 'console.log("Editor");');
		await writeFile(path.join(outputDir, "typst", binary), Buffer.from([0, 1, 0]));
		await writeFile(path.join(outputDir, "export-assets", "viewer.css"), "body {}");
		await writeFile(path.join(outputDir, "export-assets", "inspection-frame.js"), "void 0;");
		await writeFile(path.join(outputDir, "legal", "LICENSE"), "legal notice");
		await writeFile(path.join(outputDir, "praxity.mjs"), "console.log('CLI');");
		const payload = await inventoryPayload(outputDir, repoDir, { platform, arch });
		assert.equal(payload.platform, platform);
		assert.equal(payload.arch, arch);
		assert.deepEqual(
			payload.files.map((file) => [file.path, file.component]),
			[
				["editor/editor.js", "studio-browser-editor"],
				["editor/index.html", "studio-browser-editor"],
				["export-assets/inspection-frame.js", "studio-browser-editor"],
				["export-assets/viewer.css", "course-delivery-runtime-and-inputs"],
				["legal/LICENSE", "operative-legal-notice"],
				["praxity.mjs", "studio-module"],
				[`typst/${binary}`, "third-party"],
			],
		);
		assert.equal(payload.payloadSha256, sha256(JSON.stringify(payload.files)));
	});
}

test("payload inventory rejects unsupported targets, private paths, source maps and symlinks", async (t) => {
	const outputDir = await temporaryArtifact(t);
	await assert.rejects(
		inventoryPayload(outputDir, repoDir, { platform: "linux", arch: "x64" }),
		/Unsupported standalone CLI platform/,
	);
	await assert.rejects(
		inventoryPayload(outputDir, repoDir, { platform: "win32", arch: "arm64" }),
		/Unsupported Typst architecture/,
	);
	const target = { platform: "win32", arch: "x64" };
	await writeFile(path.join(outputDir, "private.txt"), repoDir);
	await assert.rejects(inventoryPayload(outputDir, repoDir, target), /Private checkout path/);
	await rm(path.join(outputDir, "private.txt"));
	await writeFile(path.join(outputDir, "bundle.js.map"), "{}");
	await assert.rejects(inventoryPayload(outputDir, repoDir, target), /artifact source map/);
	await rm(path.join(outputDir, "bundle.js.map"));
	const external = await temporaryArtifact(t);
	await symlink(external, path.join(outputDir, "linked"), "junction");
	await assert.rejects(inventoryPayload(outputDir, repoDir, target), /non-regular artifact file/);
});

test("CLI packaging preserves the frozen 0.2.0 legal archive", async () => {
	for (const [name, hash] of Object.entries({
		"EULA.md": "66d461e3f3c4b07875e8e8ca06fc61a71ed0628097ed5c95eb1be44f0337dc11",
		"EULA.fr.md": "d86e6cbdad10fd7b78c79e28f113b583e5dd253ed6ee4038a79f1633a0507727",
		"ETHICAL-USE-POLICY.md": "310cb2988e6a526e78cf56d9d3cc514a87f18a0b292544e0102d0c5a4725117d",
		"ETHICAL-USE-POLICY.fr.md": "dd65962830c58e8aa2969b38b08bfa0cfcdb0a81895a4b6450a3531716d1554e",
		"COMPONENT-SCHEDULE.md": "8b2f92fd296f1658f8f23139c8ff53a1a0f23a6670c02e490a83f766a9604445",
		"COMPONENT-SCHEDULE.shipped.md":
			"6e8fb866663c4ff30da9f4d9ebfa0dfc4378c78a3ba226926aebb3aeb8ca68f7",
	})) {
		assert.equal(
			sha256(await readFile(path.join(repoDir, `legal/archive/0.2.0/${name}`))),
			hash,
			name,
		);
	}
});
