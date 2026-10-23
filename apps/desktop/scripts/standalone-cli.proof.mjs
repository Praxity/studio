import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import AdmZip from "adm-zip";
import { build } from "esbuild";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("packaged recovery and Studio tolerate foreign, malformed and unreadable drafts", async () => {
	const artifact = fileURLToPath(new URL("../../../dist/studio-cli/", import.meta.url));
	const root = await mkdtemp(path.join(os.tmpdir(), "studio-draft-discovery-"));
	const project = path.join(root, "project");
	const directory = path.join(project, ".praxity/local/drafts");
	const text = "\uFEFFUnsaved été.\r\n";
	const source = "# Canvas\n\nSaved text.\n";
	const filename = `file-${sha256("lesson.prax")}.json`;
	const unreadable = `${"c".repeat(64)}.json`;
	const draft = {
		id: "recoverable",
		file: "lesson.prax",
		scope: "file",
		target: { kind: "node", nodeId: null, path: [], fingerprint: "a".repeat(64) },
		baseRevision: "b".repeat(64),
		expectedText: source,
		editableText: source,
		baseText: source,
		text,
		selection: [0, 0],
		generation: 1,
		status: "held",
		diagnostics: [],
		changedAt: 10,
		validatedGeneration: 1,
		persistedGeneration: 1,
	};
	const cli = (...args) => {
		const result = spawnSync(process.execPath, [path.join(artifact, "praxity.mjs"), ...args], {
			encoding: "utf8",
			windowsHide: true,
			timeout: 20_000,
		});
		assert.ifError(result.error);
		return result;
	};
	let lock;
	let lockStopped;
	const releaseLock = path.join(root, "release-lock");
	try {
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(project, "lesson.prax"), source);
		const bucket = JSON.stringify({ schema: 2, file: "lesson.prax", drafts: [draft] });
		const localFiles = {
			[filename]: bucket,
			[filename.replace(".json", " 2.json")]: bucket,
			".DS_Store": "Finder",
			"bad.json": "{truncated",
			[unreadable]: bucket,
		};
		for (const [name, content] of Object.entries(localFiles))
			await writeFile(path.join(directory, name), content);
		if (process.platform === "win32") {
			const script = path.join(root, "lock.ps1");
			await writeFile(
				script,
				'param([string]$Path, [string]$Release)\n$stream = [IO.File]::Open($Path, "Open", "Read", "None")\nWrite-Output "locked"\ntry { while (!(Test-Path -LiteralPath $Release)) { Start-Sleep -Milliseconds 50 } } finally { $stream.Dispose() }\n',
			);
			lock = spawn(
				"powershell.exe",
				[
					"-NoProfile",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					script,
					path.join(directory, unreadable),
					releaseLock,
				],
				{
					windowsHide: true,
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			lockStopped = new Promise((resolve) => lock.once("exit", resolve));
			await new Promise((resolve, reject) => {
				let errors = "";
				lock.stderr.on("data", (bytes) => {
					errors += bytes;
				});
				lock.once("error", reject);
				lock.once("exit", (code) => reject(new Error(`Lock exited ${code}: ${errors}`)));
				lock.stdout.once("data", () => resolve());
			});
		} else await chmod(path.join(directory, unreadable), 0);
		await assert.rejects(readFile(path.join(directory, unreadable)));
		const listed = cli("recovery", "list", project);
		assert.equal(listed.status, 0, listed.stderr);
		const inventory = JSON.parse(listed.stdout);
		assert.deepEqual(inventory.archives, []);
		assert.deepEqual(inventory.drafts, [draft]);
		assert.deepEqual(inventory.skippedDraftFiles, [
			{ file: ".DS_Store", reason: "unrecognized-file" },
			{ file: "bad.json", reason: "invalid-draft" },
			{ file: unreadable, reason: "unreadable-file" },
			{ file: filename.replace(".json", " 2.json"), reason: "unrecognized-file" },
		]);
		const output = path.join(root, "export");
		const exported = cli("recovery", "export-drafts", project, output);
		assert.equal(exported.status, 0, exported.stderr);
		assert.deepEqual(JSON.parse(exported.stdout).skippedDraftFiles, inventory.skippedDraftFiles);
		assert.deepEqual(await readFile(path.join(output, "draft-1.txt")), Buffer.from(text));
		const existing = path.join(root, "existing");
		await mkdir(existing);
		assert.equal(cli("recovery", "export-drafts", project, existing).status, 1);
		assert.deepEqual(await readdir(existing), []);
		for (const language of ["en", "fr"]) {
			const child = spawn(
				process.execPath,
				[path.join(artifact, "praxity.mjs"), "studio", project, "--no-open", "--lang", language],
				{
					windowsHide: true,
					stdio: ["ignore", "pipe", "pipe", "ipc"],
				},
			);
			const stopped = new Promise((resolve) => child.once("exit", resolve));
			try {
				const ready = await new Promise((resolve, reject) => {
					let output = "";
					let errors = "";
					const finish = () => {
						const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#session=[\w-]+/);
						if (match && errors.endsWith("\n")) {
							clearTimeout(timer);
							resolve({ url: match[0], errors });
						}
					};
					const timer = setTimeout(() => reject(new Error(`Startup timeout: ${errors}`)), 20_000);
					child.once("error", reject);
					child.once("exit", (code) => {
						clearTimeout(timer);
						reject(new Error(`Startup exited ${code}: ${errors}`));
					});
					child.stderr.on("data", (bytes) => {
						errors += bytes;
						finish();
					});
					child.stdout.on("data", (bytes) => {
						output += bytes;
						finish();
					});
				});
				assert.match(ready.errors, /praxity recovery list/);
				assert.match(
					ready.errors,
					language === "en" ? /Some retained draft files/ : /Certains fichiers/,
				);
				assert.equal(ready.errors.trim().split("\n").length, 1);
				const response = await fetch(ready.url);
				assert.equal(response.status, 200);
				assert.match(await response.text(), /Edit text/);
			} finally {
				if (child.connected) child.disconnect();
				await stopped;
			}
		}
		if (lock) {
			await writeFile(releaseLock, "release");
			await lockStopped;
			lock = undefined;
		} else await chmod(path.join(directory, unreadable), 0o600);
		assert.deepEqual((await readdir(directory)).sort(), Object.keys(localFiles).sort());
		for (const [name, content] of Object.entries(localFiles))
			assert.deepEqual(await readFile(path.join(directory, name)), Buffer.from(content));
		assert.equal(await readFile(path.join(project, "lesson.prax"), "utf8"), source);
	} finally {
		if (lock) {
			await writeFile(releaseLock, "release");
			await lockStopped;
		}
		await chmod(path.join(directory, unreadable), 0o600).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
		await rm(root, { recursive: true, force: true });
	}
});

test("packaged studio refuses missing, empty and substituted canvas bytes before startup", async (t) => {
	const checkout = fileURLToPath(new URL("../../../", import.meta.url));
	const artifact = path.join(checkout, "dist/studio-cli");
	const root = await mkdtemp(path.join(os.tmpdir(), "studio-canvas-asset-"));
	const canvasPath = path.join(artifact, "editor/canvas.js");
	const canvas = await readFile(canvasPath);
	const inventoryPath = path.join(artifact, "inventory.json");
	const inventory = await readFile(inventoryPath);
	const digestPath = path.join(artifact, "editor/canvas.sha256");
	try {
		for (const state of ["missing", "empty", "substituted", "substituted-with-digest"]) {
			await t.test(state, async () => {
				const project = path.join(root, state);
				await mkdir(project);
				await writeFile(path.join(project, "lesson.prax"), "# Canvas\n\nLearner text.\n");
				const replacement =
					'var PraxityCanvas={startStudioAuthor(){document.documentElement.dataset.reviewSubstitute="executed"}};';
				if (state === "missing") await rm(canvasPath);
				else await writeFile(canvasPath, state === "empty" ? "" : replacement);
				if (state === "substituted-with-digest") await writeFile(digestPath, sha256(replacement));
				const result = spawnSync(
					process.execPath,
					[path.join(artifact, "praxity.mjs"), "studio", project, "--no-open"],
					{ encoding: "utf8", windowsHide: true, timeout: 20_000 },
				);
				assert.ifError(result.error);
				assert.equal(result.status, 1);
				assert.match(
					result.stdout + result.stderr,
					/Canvas assets are unavailable.*Rebuild the standalone CLI/,
				);
				assert.doesNotMatch(result.stdout, /http:\/\/127\.0\.0\.1:\d+/);
				await assert.rejects(readdir(path.join(project, ".praxity")), { code: "ENOENT" });
				assert.deepEqual(await readFile(inventoryPath), inventory);
				await writeFile(canvasPath, canvas);
			});
		}
	} finally {
		await writeFile(canvasPath, canvas);
		// The source-build digest is never an authority for the packaged CLI.
		await writeFile(digestPath, `${sha256(canvas)}\n`);
		await rm(root, { recursive: true, force: true });
	}
});

test("packaged studio starts with the real canvas bytes", async () => {
	const artifact = fileURLToPath(new URL("../../../dist/studio-cli/", import.meta.url));
	const root = await mkdtemp(path.join(os.tmpdir(), "studio-canvas-valid-"));
	const digestPath = path.join(artifact, "editor/canvas.sha256");
	const digest = await readFile(digestPath);
	await writeFile(path.join(root, "lesson.prax"), "# Canvas\n\nLearner text.\n");
	// The packaged CLI must not depend on the source server's receipt.
	await rm(digestPath);
	const child = spawn(
		process.execPath,
		[path.join(artifact, "praxity.mjs"), "studio", root, "--no-open"],
		{
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		},
	);
	const stopped = new Promise((resolve) => child.once("exit", resolve));
	try {
		await new Promise((resolve, reject) => {
			let output = "";
			let errors = "";
			const timer = setTimeout(() => reject(new Error(`Startup timeout: ${errors}`)), 20_000);
			child.once("error", reject);
			child.once("close", (code) => {
				clearTimeout(timer);
				reject(new Error(`Startup exited ${code}: ${errors}`));
			});
			child.stderr.on("data", (bytes) => {
				errors += bytes;
			});
			child.stdout.on("data", (bytes) => {
				output += bytes;
				if (/http:\/\/127\.0\.0\.1:\d+\/#session=/.test(output)) {
					clearTimeout(timer);
					resolve();
				}
			});
		});
		assert.ok((await readdir(path.join(root, ".praxity"))).includes("identity"));
	} finally {
		if (child.connected) child.disconnect();
		await stopped;
		await writeFile(digestPath, digest);
		await rm(root, { recursive: true, force: true });
	}
});
// A valid opaque raster, generated without a native image library or private course assets.
function rasterFixture() {
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const size = Buffer.alloc(4);
		size.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([size, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(256, 0);
	header.writeUInt32BE(256, 4);
	header[8] = 8;
	header[9] = 2;
	const pixels = Buffer.alloc(256 * (1 + 256 * 3));
	for (let y = 0; y < 256; y++) {
		for (let x = 0; x < 256; x++) {
			const offset = y * 769 + 1 + x * 3;
			pixels.set([x, y, 128], offset);
		}
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels, { level: 0 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
async function filesIn(directory, prefix = "") {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relative = prefix + entry.name;
		assert.ok(!entry.isSymbolicLink(), relative);
		if (entry.isDirectory())
			files.push(...(await filesIn(path.join(directory, entry.name), `${relative}/`)));
		else {
			assert.ok(entry.isFile(), `Non-regular payload: ${relative}`);
			files.push(relative);
		}
	}
	return files.sort();
}

test("CLI payload retains the pinned learning-patterns MIT license", async () => {
	const artifact = new URL("../../../dist/studio-cli/", import.meta.url);
	const inventory = JSON.parse(await readFile(new URL("inventory.json", artifact), "utf8"));
	const dependency = inventory.dependencies.find((entry) => entry.name === "learning-patterns");
	assert.equal(dependency?.version, "0.1.0");
	assert.equal(dependency.license, "MIT");
	const license = "licenses/learning-patterns@0.1.0/LICENSE";
	assert.ok(dependency.notices.includes(license));
	assert.ok(inventory.files.some((entry) => entry.path === license));
	assert.equal(
		sha256(await readFile(new URL(license, artifact))),
		"d817c04f10efaffd1ab6dba0792a6567dce98f8ab41e86c64833a7b9cff7ecc5",
	);
});

test("browser payload carries its emitted source closure, classification and upstream notices", async () => {
	const checkout = fileURLToPath(new URL("../../../", import.meta.url));
	const artifact = path.join(checkout, "dist/studio-cli");
	const inventory = JSON.parse(await readFile(path.join(artifact, "inventory.json"), "utf8"));
	const provenance = JSON.parse(
		await readFile(path.join(checkout, "dist/studio-cli-review/build-inputs.json"), "utf8"),
	);
	const browserFiles = inventory.files.filter((file) => file.path.startsWith("editor/"));
	assert.deepEqual(browserFiles.map((file) => file.path).sort(), [
		"editor/canvas.js",
		"editor/canvas.sha256",
	]);
	assert.ok(browserFiles.some((file) => file.path === "editor/canvas.js"));
	assert.ok(browserFiles.some((file) => file.path.endsWith(".js")));
	assert.ok(browserFiles.every((file) => file.component === "studio-browser-editor"));
	for (const file of browserFiles)
		assert.equal(file.sha256, sha256(await readFile(path.join(artifact, file.path))));
	for (const file of [
		"apps/desktop/src/renderer/browser/canvas-entry.ts",
		"apps/desktop/src/renderer/browser/canvas.ts",
		"apps/desktop/src/renderer/browser/canvas-text.ts",
		"apps/desktop/src/renderer/browser/event-stream.ts",
		"apps/desktop/src/shared/canvas-styles.ts",
	]) {
		const input = provenance.inputs.find((input) => input.path === file);
		assert.ok(input?.components.includes("studio-browser-editor"), file);
		assert.equal(input.sha256, sha256(await readFile(path.join(checkout, file))), file);
	}
	for (const name of ["yaml"]) {
		assert.ok(
			provenance.inputs.some(
				(input) =>
					input.path.includes(`/node_modules/${name}/`) &&
					input.components.includes("third-party") &&
					input.components.includes("studio-browser-editor"),
			),
			name,
		);
		const dependency = inventory.dependencies.find((dependency) => dependency.name === name);
		assert.ok(
			dependency?.notices.some((file) => /licen[cs]e/i.test(file)),
			`${name} license`,
		);
		for (const file of dependency.notices) {
			const bytes = await readFile(path.join(artifact, file));
			assert.ok(
				provenance.inputs.some(
					(input) =>
						input.path.endsWith(`/node_modules/${name}/${path.basename(file)}`) &&
						input.sha256 === sha256(bytes) &&
						input.components.includes("third-party"),
				),
				`${name} notice provenance: ${file}`,
			);
		}
	}
	assert.equal(
		provenance.artifactInventorySha256,
		sha256(await readFile(path.join(artifact, "inventory.json"))),
	);
});

test("portable CLI exports and preserves identities outside the checkout", async () => {
	// fs-extra checks copy destination ancestors up to the drive root. A Windows
	// fixture directly under that root keeps every checked directory inside the
	// allowed tree, without granting access to Users (and therefore the checkout).
	const tempBase = process.platform === "win32" ? path.parse(os.tmpdir()).root : os.tmpdir();
	const root = await realpath(await mkdtemp(path.join(tempBase, "studio-cli-")));
	const checkout = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
	try {
		// Course fixtures are authored through the real writer before the confined CLI
		// reads them. Export refuses transient identities and must never allocate them.
		const author = path.join(root, "author-fixture.mjs");
		await build({
			stdin: {
				resolveDir: path.join(checkout, "apps/desktop"),
				contents: `
					import { readFile } from 'node:fs/promises';
					import { writeLessonSource } from './src/main/lesson-source';
					const course = process.argv[2];
					const source = await readFile(course + '/lesson.prax', 'utf8');
					await writeLessonSource(course, 'lesson.prax', source, source);
				`,
			},
			outfile: author,
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node24",
			banner: {
				js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
			},
		});
		const persistFixture = (course) => {
			const result = spawnSync(process.execPath, [author, course], { encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr || result.stdout);
		};
		const bundle = path.join(root, "tool with spaces");
		await cp(new URL("../../../dist/studio-cli", import.meta.url), bundle, { recursive: true });
		const inventory = JSON.parse(await readFile(path.join(bundle, "inventory.json"), "utf8"));
		assert.equal(inventory.distribution, "private-binary");
		assert.equal(inventory.entrypoint, "praxity.mjs");
		assert.equal(inventory.platform, process.platform);
		assert.equal(inventory.arch, process.arch);
		assert.equal(inventory.license, "SEE LICENSE IN legal/LICENSE");
		assert.equal(inventory.licenseVersion, "1.0.1");
		assert.equal(inventory.licenseEffectiveDate, "2026-09-29");
		const typstExecutable = process.platform === "win32" ? "typst.exe" : "typst";
		for (const filename of [typstExecutable, "LICENSE", "NOTICE", "FONT-NOTICE", "version.json"]) {
			assert.ok(
				inventory.files.some(
					(file) => file.path === `typst/${filename}` && file.component === "third-party",
				),
			);
		}
		const engine = JSON.parse(await readFile(path.join(bundle, "typst/version.json"), "utf8"));
		assert.equal(engine.version, "0.15.1");
		assert.equal(engine.platform, process.platform);
		assert.equal(engine.arch, process.arch);
		assert.ok(inventory.files.some((file) => file.path === "typst/mitex/mitex.wasm"));
		assert.equal(
			engine.binarySha256,
			sha256(await readFile(path.join(bundle, "typst", typstExecutable))),
		);
		assert.ok(inventory.dependencies.some((dependency) => dependency.name === "react"));
		assert.ok(
			inventory.runtimePackages.some((dependency) => dependency.name === "isomorphic-dompurify"),
		);
		for (const dependency of inventory.runtimePackages) {
			assert.ok(
				inventory.files.some((file) => file.path === `${dependency.path}/package.json`),
				dependency.path,
			);
		}
		assert.ok(!inventory.dependencies.some((dependency) => dependency.name === "electron"));
		assert.equal(inventory.payloadSha256, sha256(JSON.stringify(inventory.files)));
		assert.deepEqual(
			await filesIn(bundle),
			[...inventory.files.map((file) => file.path), "inventory.json"].sort(),
		);
		for (const file of inventory.files) {
			assert.ok(!path.isAbsolute(file.path) && !file.path.split("/").includes(".."));
			assert.ok(!file.path.endsWith(".map"), file.path);
			assert.ok(
				!/(^|\/)(?:\.git|docs|research|src)\//.test(file.path) ||
					file.path.startsWith("node_modules/"),
				file.path,
			);
			const bytes = await readFile(path.join(bundle, file.path));
			assert.equal(bytes.length, file.bytes, file.path);
			assert.equal(sha256(bytes), file.sha256, file.path);
			for (const privatePath of [checkout, checkout.replaceAll("\\", "/")]) {
				assert.ok(!bytes.includes(Buffer.from(privatePath)), file.path);
			}
		}
		assert.deepEqual(inventory.legal, ["legal/LICENSE", "legal/LICENSING.md"]);
		assert.deepEqual(await filesIn(path.join(bundle, "legal")), ["LICENSE", "LICENSING.md"]);
		const manifest = JSON.parse(await readFile(path.join(bundle, "package.json"), "utf8"));
		assert.equal(manifest.license, "SEE LICENSE IN legal/LICENSE");
		for (const name of ["LICENSE", "LICENSING.md"]) {
			assert.deepEqual(
				await readFile(path.join(bundle, "legal", name)),
				await readFile(new URL(`../../../${name}`, import.meta.url)),
			);
		}
		for (const file of ["SKILL.md", "cli.md", "LICENSE"]) {
			assert.ok(inventory.files.some((entry) => entry.path === `prax-format/${file}`));
		}
		assert.deepEqual(
			await filesIn(path.join(bundle, "prax-format/skill")),
			await filesIn(fileURLToPath(new URL("../../../docs/prax-format/skill/", import.meta.url))),
		);
		for (const file of inventory.files.filter((entry) => entry.path.startsWith("prax-format/"))) {
			assert.deepEqual(
				await readFile(path.join(bundle, file.path)),
				await readFile(new URL(`../../../docs/${file.path}`, import.meta.url)),
				file.path,
			);
		}
		for (const dependency of inventory.dependencies) {
			for (const notice of dependency.notices)
				assert.ok(
					inventory.files.some(
						(file) => file.path === notice || file.path.startsWith(`${notice}/`),
					),
					notice,
				);
		}
		const project = path.join(root, "course");
		await mkdir(path.join(project, "assets"), { recursive: true });
		await writeFile(
			path.join(project, "course.yaml"),
			"title: Packing a kit\nlessons:\n  - lesson.prax\ndesign:\n  typography:\n    pairing: book\n",
		);
		await writeFile(
			path.join(project, "lesson.prax"),
			"---\ntitle: Packing a kit\nlang: en\n---\n\n# Check your kit {hideTitle}\n\n## Check your kit\n\n@icon{mail} Pack water before leaving. @icon{star-filled} Save this checklist.\n\n![A blue water bottle](/assets/kit.svg)\n\n# Review {hideTitle}\n\n## Review\n\nCheck the bottle cap.\n",
		);
		await writeFile(
			path.join(project, "assets/kit.svg"),
			'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="blue"/></svg>',
		);
		const raster = rasterFixture();
		await writeFile(path.join(project, "assets/landscape.png"), raster);
		const lessonPath = path.join(project, "lesson.prax");
		await writeFile(
			lessonPath,
			`${await readFile(lessonPath, "utf8")}\n![A colour gradient](/assets/landscape.png)\n`,
		);
		persistFixture(project);
		// POSIX realpath walks ancestors. Windows can use the exact disposable root;
		// granting its Users ancestor would also expose the checkout.
		const tempTree =
			process.platform === "win32"
				? root
				: path.join(path.parse(root).root, root.split(path.sep).filter(Boolean)[0]);
		const relativeCheckout = path.relative(tempTree, checkout);
		assert.ok(
			relativeCheckout === ".." ||
				relativeCheckout.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relativeCheckout),
			"The permitted temporary tree must not contain the checkout",
		);
		const runNode = (args, allowChildProcess = false) =>
			spawnSync(
				process.execPath,
				[
					"--permission",
					...(allowChildProcess ? ["--allow-child-process"] : []),
					`--allow-fs-read=${tempTree}`,
					`--allow-fs-write=${tempTree}`,
					...args,
				],
				{
					cwd: root,
					encoding: "utf8",
					env: {
						PATH: path.dirname(process.execPath),
						HOME: root,
						// Windows homedir uses USERPROFILE; keep SQLite's cache in the same
						// confined temporary tree as the POSIX HOME setting.
						USERPROFILE: root,
						TMPDIR: root,
						TMP: root,
						TEMP: root,
						NODE_ENV: "production",
					},
				},
			);
		const isolatedHome = runNode([
			"--eval",
			'console.log(JSON.stringify(require("node:os").homedir()))',
		]);
		assert.equal(isolatedHome.status, 0, isolatedHome.stderr);
		assert.equal(JSON.parse(isolatedHome.stdout), root);
		const deniedCheckout = runNode([
			"--eval",
			`require("node:fs").readFileSync(${JSON.stringify(path.join(checkout, "package.json"))})`,
		]);
		assert.equal(deniedCheckout.error, undefined);
		assert.equal(deniedCheckout.status, 1);
		assert.match(deniedCheckout.stderr, /ERR_ACCESS_DENIED/);
		const runRestricted = (...args) => runNode([path.join(bundle, "praxity.mjs"), ...args]);
		const run = (...args) =>
			runNode([path.join(bundle, "praxity.mjs"), ...args], args.includes("pdf"));
		const version = runRestricted("--version");
		assert.equal(version.status, 0, version.stderr || version.stdout);
		const beforeInspect = await Promise.all(
			(await filesIn(project)).map(async (file) => [
				file,
				sha256(await readFile(path.join(project, file))),
			]),
		);
		const legacyInspection = runRestricted("inspect", project);
		assert.equal(legacyInspection.status, 0, legacyInspection.stderr);
		assert.equal(JSON.parse(legacyInspection.stdout).schema, "praxity-inspect/0");
		const inspections = [0, 1].map(() => {
			const result = runRestricted("inspect", project, "--schema", "1");
			assert.equal(result.status, 0, result.stderr || result.stdout);
			return JSON.parse(result.stdout);
		});
		assert.equal(inspections[0].schema, "praxity-inspect/1");
		assert.equal(inspections[0].projectionVersion, 2);
		assert.ok(Array.isArray(inspections[0].lessons[0].unlinkedNarration));
		for (const inspection of inspections)
			assert.match(inspection.course.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
		assert.equal(inspections[0].course.id, inspections[1].course.id);
		assert.equal(inspections[0].revision, inspections[1].revision);
		assert.deepEqual(
			inspections[0].lessons[0].pages.flatMap((page) => page.blocks.map((block) => block.ref)),
			inspections[1].lessons[0].pages.flatMap((page) => page.blocks.map((block) => block.ref)),
		);
		assert.deepEqual(
			await Promise.all(
				(await filesIn(project)).map(async (file) => [
					file,
					sha256(await readFile(path.join(project, file))),
				]),
			),
			beforeInspect,
		);
		const unsupportedSchema = runRestricted("inspect", project, "--schema", "99");
		assert.equal(unsupportedSchema.status, 2);
		assert.equal(JSON.parse(unsupportedSchema.stdout).error.code, "invalid_arguments");
		const restrictedSnapshot = async () =>
			Promise.all(
				(await readdir(project, { recursive: true, withFileTypes: true }))
					.map((entry) => ({ entry, file: path.join(entry.parentPath, entry.name) }))
					.sort((a, b) => a.file.localeCompare(b.file))
					.map(async ({ entry, file }) => [
						path.relative(project, file),
						entry.isDirectory() ? "directory" : sha256(await readFile(file)),
					]),
			);
		const beforeRestrictedWrites = await restrictedSnapshot();
		for (const args of [
			["init", project],
			["identity", "init", project],
			["edit", project, "setText"],
			["comments", "reply", project],
			["narration", "accept", "invalid", "--project", project],
			["recovery", "run", project],
			["studio", project, "--no-open"],
		]) {
			const refused = runRestricted(...args);
			assert.equal(refused.error, undefined);
			assert.equal(refused.status, 1, refused.stderr || refused.stdout);
			assert.deepEqual(JSON.parse(refused.stdout), {
				ok: false,
				error: {
					code: "EPERMISSIONMODEL",
					message:
						"Studio can't save while Node's permission model is on, because it blocks the file sync that keeps saves safe. Run without --permission.",
				},
			});
			assert.deepEqual(await restrictedSnapshot(), beforeRestrictedWrites);
		}
		let identity;
		for (const format of ["html", "scorm-1.2", "scorm-2004"]) {
			const output = path.join(root, `${format}.zip`);
			const result = run("export", project, "--format", format, "--output", output);
			assert.equal(result.status, 0, result.stderr || result.stdout);
			const json = JSON.parse(result.stdout);
			assert.equal(json.ok, true);
			assert.equal(json.pageCount, 2);
			assert.equal(json.accessibility.status, "passed");
			const zip = new AdmZip(output);
			const entries = zip.getEntries();
			const optimized = entries.find((entry) => entry.entryName.endsWith(".webp"));
			assert.ok(optimized, "Existing project raster is optimized in the portable CLI");
			assert.ok(zip.readFile(optimized).length < raster.length);
			assert.ok(
				entries
					.filter((entry) => entry.entryName.endsWith(".html"))
					.some((entry) => zip.readAsText(entry).includes(optimized.entryName)),
			);
			assert.ok(
				!entries.some((entry) => entry.entryName.endsWith(".wasm")),
				"Compiler codecs stay out of learner output",
			);
			assert.deepEqual(await readFile(path.join(project, "assets/landscape.png")), raster);
			assert.deepEqual(
				zip.readFile("PRAXITY-COURSE-RUNTIME-LICENSE.txt"),
				await readFile(
					new URL(
						"../../../packages/export-pipeline/template/COURSE-RUNTIME-LICENSE.txt",
						import.meta.url,
					),
				),
			);
			for (const name of [
				"@fontsource-source-sans-3",
				"@fontsource-source-serif-4",
				"@tabler-icons",
			]) {
				const selectedNotice = entries.find((entry) =>
					entry.entryName.startsWith(`third-party-notices/${name}@`),
				);
				assert.ok(selectedNotice, `${name} licence travels with the course`);
				assert.ok(zip.readAsText(selectedNotice).trim());
				if (name.startsWith("@fontsource-"))
					assert.match(zip.readAsText(selectedNotice), /SIL OPEN FONT LICENSE/i);
			}
			for (const [family, weights] of [
				["source-sans-3", [400, 600]],
				["source-serif-4", [600]],
			]) {
				for (const weight of weights) {
					const filename = `${family}-latin-${weight}-normal.woff2`;
					assert.deepEqual(
						zip.readFile(`fonts/${filename}`),
						await readFile(
							path.join(bundle, "export-assets/css-sources/fontsource", family, "files", filename),
						),
						`Selected ${family} ${weight} bytes travel with the portable export`,
					);
				}
			}
			assert.ok(
				!entries.some((entry) =>
					/^(?:third-party-notices\/@fontsource-|fonts\/)(?:inter|poppins)(?:@|-)/.test(
						entry.entryName,
					),
				),
				"Retired Inter and Poppins notices and fonts stay out of the course",
			);
			const html = entries
				.filter((entry) => entry.entryName.endsWith(".html"))
				.map((entry) => zip.readAsText(entry))
				.join("\n");
			for (const icon of ["mail", "star-filled"]) {
				assert.ok(html.includes(`data-praxity-inline-icon="${icon}"`), icon);
			}
			assert.ok(!entries.some((entry) => /(?:^|\/)EULA\.md$/.test(entry.entryName)));
			assert.ok(
				entries.some(
					(entry) => entry.entryName.startsWith("fonts/") && entry.entryName.endsWith(".woff2"),
				),
			);
			assert.ok(entries.some((entry) => entry.entryName.endsWith("kit.svg")));
			assert.ok(
				entries
					.filter((entry) => entry.entryName.endsWith(".html"))
					.some((entry) => zip.readAsText(entry).includes("Pack water before leaving.")),
			);
			assert.equal(Boolean(zip.getEntry("imsmanifest.xml")), format !== "html");
			if (format !== "html") {
				assert.equal(
					zip.readAsText("license.txt"),
					await readFile(
						new URL("../../../packages/export-pipeline/schemas/license.txt", import.meta.url),
						"utf8",
					),
					"Packaged CLI exports include the complete schema notice",
				);
				const schemaDir = format === "scorm-1.2" ? "scorm12" : "scorm2004";
				const schema = format === "scorm-1.2" ? "imscp_rootv1p1p2.xsd" : "lomLoose.xsd";
				assert.deepEqual(
					zip.readFile(schema),
					await readFile(
						new URL(
							`../../../packages/export-pipeline/schemas/${schemaDir}/${schema}`,
							import.meta.url,
						),
					),
					"Schema files retain their embedded upstream notices unchanged",
				);
			}
			const identityFiles = await filesIn(path.join(project, ".praxity/identity"));
			assert.ok(identityFiles.includes("course.json"));
			const current = await Promise.all(
				identityFiles.map(async (file) => [
					file,
					await readFile(path.join(project, ".praxity/identity", file), "utf8"),
				]),
			);
			const courseIdentity = JSON.parse(current.find(([file]) => file === "course.json")[1]);
			assert.match(courseIdentity.courseId, /^[0-9a-f-]{36}$/);
			assert.equal(current.filter(([file]) => file.startsWith("lessons/")).length, 1);
			const [headFile, headText] = current.find(([file]) => file.startsWith("lessons/"));
			const head = JSON.parse(headText);
			assert.equal(head.path, "lesson.prax");
			const snapshotText = current.find(([file]) => file === `snapshots/${head.head}.json`)[1];
			assert.equal(sha256(snapshotText), head.head);
			const snapshot = JSON.parse(snapshotText);
			assert.equal(snapshot.lessonId, path.basename(headFile, ".json"));
			assert.equal(snapshot.sourceHash, sha256(await readFile(lessonPath)));
			if (identity) assert.deepEqual(current, identity);
			identity = current;
		}
		const ignoredProject = path.join(root, "ignored-font");
		await mkdir(ignoredProject);
		await writeFile(
			path.join(ignoredProject, "course.yaml"),
			"title: Ignored font\nlessons: [lesson.prax]\ndesign:\n  typography:\n    body:\n      fontFamily: [Poppins, sans-serif]\n",
		);
		await writeFile(
			path.join(ignoredProject, "lesson.prax"),
			"---\ntitle: Ignored font\n---\n\n# Read\n\n## Read\n\nKeep your kit ready.\n",
		);
		persistFixture(ignoredProject);
		const ignoredOutput = path.join(root, "ignored-font.zip");
		const ignored = run("export", ignoredProject, "--format", "html", "--output", ignoredOutput);
		assert.equal(ignored.status, 0, ignored.stderr || ignored.stdout);
		const expectedWarning =
			"design.typography.body.fontFamily is ignored. Courses use the Sans pairing; set typography.pairing to sans, book or clear.";
		const warning = JSON.parse(ignored.stdout).warnings;
		assert.deepEqual(warning, [
			{
				code: "ignored-font-setting",
				file: "course.yaml",
				path: "design.typography.body.fontFamily",
				pairing: "sans",
				message: expectedWarning,
			},
		]);
		assert.ok(ignored.stderr.includes(expectedWarning));
		for (const schema of ["0", "1"]) {
			const inspected = run("inspect", ignoredProject, "--schema", schema);
			assert.equal(inspected.status, 0, inspected.stderr);
			assert.deepEqual(JSON.parse(inspected.stdout).warnings, [
				{
					code: "ignored-font-setting",
					blockId: "course.yaml",
					path: "design.typography.body.fontFamily",
					pairing: "sans",
					message: expectedWarning,
				},
			]);
		}
		const ignoredZip = new AdmZip(ignoredOutput);
		for (const weight of [400, 600]) {
			const filename = `source-sans-3-latin-${weight}-normal.woff2`;
			assert.deepEqual(
				ignoredZip.readFile(`fonts/${filename}`),
				await readFile(
					path.join(bundle, "export-assets/css-sources/fontsource/source-sans-3/files", filename),
				),
			);
		}
		assert.ok(
			ignoredZip
				.getEntries()
				.some((entry) =>
					entry.entryName.startsWith("third-party-notices/@fontsource-source-sans-3@"),
				),
		);
		assert.ok(
			!ignoredZip
				.getEntries()
				.some((entry) =>
					/^(?:third-party-notices\/@fontsource-|fonts\/)(?:inter|poppins|source-serif-4)(?:@|-)/.test(
						entry.entryName,
					),
				),
		);
		const output = path.join(root, "html.zip");
		const original = await readFile(output);
		// Grammar 4 rejects missing image alt before accessibility checks. An empty
		// link is valid source that reaches the same accessibility blocking gate.
		const sourcePath = path.join(project, "lesson.prax");
		await writeFile(sourcePath, `${await readFile(sourcePath, "utf8")}\n[](https://example.com)\n`);
		persistFixture(project);
		const blocked = run("export", project, "--format", "html", "--output", output);
		assert.equal(blocked.status, 1);
		assert.equal(JSON.parse(blocked.stdout).error.code, "accessibility_blocked");
		assert.deepEqual(await readFile(output), original);
		const overridden = run(
			"export",
			project,
			"--format",
			"html",
			"--output",
			output,
			"--allow-critical-a11y-issues",
		);
		assert.equal(overridden.status, 0, overridden.stderr);
		assert.equal(JSON.parse(overridden.stdout).accessibility.status, "overridden");
		await rm(path.join(bundle, "export-assets/viewer.version.json"));
		const missing = run("export", project, "--format", "html", "--output", output);
		assert.equal(missing.status, 1);
		assert.equal(JSON.parse(missing.stdout).error.code, "export_assets_missing");
		// PDF must still work with the viewer unavailable, in a copied distribution.
		const pdfProject = path.join(root, "public-quiz");
		await mkdir(pdfProject);
		await cp(
			new URL("../../../docs/prax-format/examples/quiz-course.prax", import.meta.url),
			path.join(pdfProject, "lesson.prax"),
		);
		const quizPath = path.join(pdfProject, "lesson.prax");
		await writeFile(quizPath, `${await readFile(quizPath, "utf8")}\n$$\n\\frac{1}{2}\n$$\n`);
		await writeFile(
			path.join(pdfProject, "course.yaml"),
			"title: Public safety quiz\nlessons:\n  - lesson.prax\n",
		);
		persistFixture(pdfProject);
		for (const paperSize of ["a4", "letter"]) {
			for (const answers of [false, true]) {
				const pdfPath = path.join(root, `quiz-${paperSize}-${answers}.pdf`);
				const exported = run(
					"export",
					pdfProject,
					"--format",
					"pdf",
					"--paper-size",
					paperSize,
					"--output",
					pdfPath,
					...(answers ? ["--include-answer-sheet"] : []),
				);
				assert.equal(exported.status, 0, exported.stderr || exported.stdout);
				assert.equal(JSON.parse(exported.stdout).format, "pdf");
				assert.equal(JSON.parse(exported.stdout).accessibility.status, "passed");
				const pdf = await readFile(pdfPath);
				assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
				assert.ok(pdf.length > 1000);
			}
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
