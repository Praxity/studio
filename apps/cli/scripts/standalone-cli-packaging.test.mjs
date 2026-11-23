import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { filesIn, inventoryPayload, packagePraxFormat } from "./standalone-cli-packaging.mjs";
import { portablePath } from "./standalone-cli-paths.mjs";

const repoDir = fileURLToPath(new URL("../../../", import.meta.url));
const sourceDir = path.join(repoDir, "docs/prax-format");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

for (const [platform, arch] of [
	["win32", "arm64"],
	["linux", "x64"],
	["linux", "arm64"],
	["darwin", "arm64"],
	["darwin", "x64"],
]) {
	test(`payload inventory records ${platform}/${arch} without requiring the target host`, async (t) => {
		const outputDir = await temporaryArtifact(t);
		await mkdir(path.join(outputDir, "typst"));
		await mkdir(path.join(outputDir, "export-assets"));
		await mkdir(path.join(outputDir, "legal"));
		await mkdir(path.join(outputDir, "typst/fonts"));
		await writeFile(path.join(outputDir, "typst/fonts/LICENSE"), "font notice");
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
				["export-assets/inspection-frame.js", "studio-browser-editor"],
				["export-assets/viewer.css", "course-delivery-runtime-and-inputs"],
				["legal/LICENSE", "operative-legal-notice"],
				["praxity.mjs", "studio-module"],
				["typst/fonts/LICENSE", "third-party"],
			],
		);
		assert.equal(payload.payloadSha256, sha256(JSON.stringify(payload.files)));
	});
}

test("payload inventory rejects private paths, source maps and symlinks", async (t) => {
	const outputDir = await temporaryArtifact(t);
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
