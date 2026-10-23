import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const checkout = fileURLToPath(new URL("../../../", import.meta.url));
const desktop = path.join(checkout, "apps/desktop");
const runtimeRequire = createRequire(path.join(checkout, "packages/shared-blocks/package.json"));

describe("standalone Studio lifecycle", () => {
	let root;
	let entry;
	let checkerEntry;
	let preload;
	let launcher;
	let project;

	before(async () => {
		root = await realpath(await mkdtemp(path.join(tmpdir(), "studio-cli-lifecycle-")));
		entry = path.join(root, "praxity.mjs");
		checkerEntry = path.join(root, "checker.mjs");
		preload = path.join(root, "http-close.mjs");
		launcher = path.join(root, "launcher.mjs");
		project = path.join(root, "course");
		await mkdir(project);
		// macOS temp folders can contain /var aliases; match the CLI's canonical root.
		project = await realpath(project);
		await mkdir(path.join(root, "editor"));
		await writeFile(path.join(root, "editor/index.html"), "<!doctype html><title>Studio</title>");
		await writeFile(path.join(root, "editor/canvas.js"), "void 0;");
		await writeFile(
			path.join(root, "editor/canvas.sha256"),
			"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
		);
		await writeFile(path.join(project, "lesson.prax"), "---\ntitle: Test\n---\n# Hello\n");
		// CI runs Node tests before desktop prebuild. Keep real preview/export assets
		// in this fixture by running their owning builder, including on clean checkouts.
		await promisify(execFile)(
			process.execPath,
			["--import", "tsx", path.join(desktop, "scripts/prebuild-viewer.ts")],
			{ cwd: checkout },
		);
		await cp(path.join(desktop, "resources/export-assets"), path.join(root, "export-assets"), {
			recursive: true,
		});
		const domRuntime = path.join(root, "dom-runtime.mjs");
		await writeFile(
			domRuntime,
			`if (process.env.TEST_DOM_FORBIDDEN) throw new Error('Unexpected DOM runtime at startup');
if (process.env.TEST_DOM_DELAY) {
  process.stdout.write('test-dom-loading\\n');
  await new Promise(resolve => setTimeout(resolve, Number(process.env.TEST_DOM_DELAY)));
}
export default (await import(${JSON.stringify(pathToFileURL(runtimeRequire.resolve("isomorphic-dompurify")).href)})).default;
`,
		);
		const checkerSource = path.join(root, "checker.ts");
		await writeFile(
			checkerSource,
			`import { checkCourseAccessibility } from ${JSON.stringify(path.join(checkout, "packages/editor-core/src/lib/a11y/checker.ts"))};
const report = checkCourseAccessibility([{ id: 'page', title: 'Question', blocks: [{ id: 'choice', type: 'assessment', data: { response: { type: 'choice', options: [{ label: '<em>Yes</em> @source{N}' }] } } }] }]);
process.stdout.write('advice=' + report.issues.filter(issue => issue.rule === 'choice-raw-html-footnote').length + '\\n');
`,
		);
		await build({
			entryPoints: {
				praxity: path.join(desktop, "src/main/standalone-cli.ts"),
				checker: checkerSource,
			},
			outdir: root,
			outExtension: { ".js": ".mjs" },
			splitting: true,
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node24",
			banner: {
				js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
			},
			plugins: [
				{
					name: "external-dom-runtime",
					setup(builder) {
						// Catch eager signature imports even if their DOM dependency becomes lazy.
						builder.onLoad(
							{ filter: /[/\\]shared-blocks[/\\]src[/\\]assessment-(choice|content)\.ts$/ },
							async (args) => ({
								contents: `if (process.env.TEST_DOM_FORBIDDEN) throw new Error('Unexpected signature module at startup');\n${await readFile(args.path, "utf8")}`,
								loader: "ts",
							}),
						);
						builder.onResolve({ filter: /^(isomorphic-dompurify|jsdom)$/ }, (args) => ({
							path: pathToFileURL(
								args.path === "isomorphic-dompurify"
									? domRuntime
									: runtimeRequire.resolve(args.path),
							).href,
							external: true,
						}));
					},
				},
			],
		});
		// Inject delay/failure only at Node's HTTP adapter. CLI, session, filesystem,
		// watchers and preview/export disposal all run their production implementations.
		await writeFile(
			preload,
			`
import { Server } from 'node:http';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
if (process.env.TEST_PRELOAD_DELAY) await new Promise(resolve => setTimeout(resolve, Number(process.env.TEST_PRELOAD_DELAY)));
const close = Server.prototype.close;
if (process.env.TEST_PARENT_ENV === '1') {
  const execFile = childProcess.execFile;
  // Replace only the browser adapter; spawn a real descendant with inherited env.
  childProcess.execFile = (_command, _args, options, callback) => execFile(
    process.execPath,
    ['-e', 'console.log(JSON.stringify({parent:process.env.PRAXITY_PARENT_PID??null}))'],
    options,
    (error, stdout) => { process.stdout.write('test-descendant=' + stdout); callback(error); },
  );
  syncBuiltinESMExports();
}
let first = true;
let releaseExport;
Server.prototype.close = function(callback) {
  if (!first) return close.call(this, callback);
  first = false;
  return close.call(this, (error) => {
    process.stdout.write('test-close-started\\n');
    if (process.env.TEST_CLOSE === 'hung') return;
    if (process.env.TEST_CLOSE === 'gated') {
      process.once('message', () => callback(error));
      process.channel.unref();
    } else if (process.env.TEST_CLOSE === 'error') {
      process.stdout.write('test-close-error\\n');
      callback(new Error('HTTP close failed'));
      releaseExport?.();
    } else callback(error);
  });
};
const writeFile = fs.writeFile;
fs.writeFile = async function(file, ...args) {
  const result = await writeFile.call(this, file, ...args);
  if (['gated', 'abortable', 'hung'].includes(process.env.TEST_EXPORT) && typeof file === 'string' && /\\.zip\\..*\\.tmp$/.test(file)) {
    process.stdout.write('test-export-staged\\n');
    if (process.env.TEST_EXPORT === 'hung') await new Promise(() => setInterval(() => {}, 1000));
    else if (process.env.TEST_EXPORT === 'abortable') await new Promise((resolve, reject) => {
      const signal = args[1]?.signal;
      signal?.throwIfAborted();
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('Write aborted'), { name: 'AbortError' })), { once: true });
    });
    // Keep the real staged write pending until HTTP has reported its close error.
    else if (process.env.TEST_CLOSE === 'error') await new Promise(resolve => { releaseExport = resolve; });
    else await new Promise(resolve => setTimeout(resolve, 1500));
    if (process.env.TEST_CLOSE === 'error') process.stdout.write('test-export-released\\n');
  }
  return result;
};
const stat = fs.stat;
let startup = true;
fs.stat = async function(file, ...args) {
  const result = await stat.call(this, file, ...args);
  if (startup && process.env.TEST_STARTUP === 'hung' && file === process.env.TEST_PROJECT) {
    startup = false;
    process.stdout.write('test-startup-hung\\n');
    await new Promise(() => setInterval(() => {}, 1000));
  }
  return result;
};
syncBuiltinESMExports();
const kill = process.kill;
if (process.env.TEST_PARENT_PROBE === 'live') process.kill = function(pid, signal) {
  if (signal === 0) { process.stdout.write('test-pid-probed\\n'); return true; }
  return kill.call(this, pid, signal);
};
process.on('exit', (code) => process.stdout.write('test-exit=' + code + '\\n'));
`,
		);
		await writeFile(
			launcher,
			`
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, process.argv.slice(2), {
  env: { ...process.env, ...(process.env.TEST_PARENT === 'identity' ? { PRAXITY_PARENT_PID: String(process.pid) } : {}) },
  detached: true, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', ['identity', 'none'].includes(process.env.TEST_PARENT) ? 'ignore' : 'ipc'],
});
process.send({ pid: child.pid });
child.once('exit', (code) => process.exit(code ?? 1));
`,
		);
	});

	after(async () => {
		if (root) await rm(root, { recursive: true, force: true });
	});

	async function start(t, mode = "normal", parent = false, options = {}) {
		const requests = new AbortController();
		const args = [
			"--import",
			pathToFileURL(preload).href,
			entry,
			...(options.args ?? ["studio", project, "--no-open"]),
		];
		const child = spawn(process.execPath, parent ? [launcher, ...args] : args, {
			detached: process.platform === "win32",
			windowsHide: true,
			env: {
				...process.env,
				TEST_CLOSE: mode,
				TMPDIR: root,
				TMP: root,
				TEMP: root,
				TEST_PROJECT: project,
				...options.env,
			},
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (bytes) => {
			stdout += bytes;
		});
		child.stderr.on("data", (bytes) => {
			stderr += bytes;
		});
		const exited = once(child, "exit");
		const closed = once(child, "close");
		const studioPid = parent ? (await once(child, "message"))[0].pid : child.pid;
		t.after(async () => {
			requests.abort();
			// Kill only this test's CLI, and only while its inherited pipe remains open.
			if (parent && !child.stdout.destroyed) process.kill(studioPid, "SIGKILL");
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await closed;
		});
		const waitFor = async (text) => {
			// The test deadline bounds startup; readiness is the CLI's output, not a poll count.
			await new Promise((resolve, reject) => {
				const finish = (error) => {
					child.stdout.off("data", check).off("end", check).off("close", check);
					child.off("close", check);
					t.signal.removeEventListener("abort", abort);
					if (error) reject(error);
					else resolve();
				};
				const abort = () => {
					t.diagnostic(
						`CLI did not print ${text}: ${JSON.stringify(stdout)} ${JSON.stringify(stderr)}`,
					);
					finish(t.signal.reason);
				};
				const check = () => {
					if (stdout.includes(text)) finish();
					else if (child.stdout.destroyed || child.stdout.readableEnded)
						finish(new Error(`CLI closed before ${text}: ${stdout} ${stderr}`));
				};
				child.stdout.on("data", check).on("end", check).on("close", check);
				// Process exit can precede the final output chunk; close waits for the streams.
				child.on("close", check);
				t.signal.addEventListener("abort", abort, { once: true });
				if (t.signal.aborted) abort();
				else check();
			});
		};
		let origin;
		let token;
		const ready = async () => {
			await waitFor("/#session=");
			const url = new URL(stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#session=[\w-]+/)[0]);
			origin = url.origin;
			token = new URLSearchParams(url.hash.slice(1)).get("session");
			assert.equal((await fetch(origin)).status, 200);
		};
		const rpc = async (method, args) => {
			const response = await fetch(`${origin}/api/rpc`, {
				signal: requests.signal,
				method: "POST",
				headers: {
					Origin: origin,
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ method, args }),
			});
			const body = await response.json();
			assert.equal(response.status, 200, JSON.stringify(body));
			return body.result;
		};
		if (options.ready !== false) await ready();
		return {
			child,
			exited,
			closed,
			waitFor,
			rpc,
			origin,
			stdout: () => stdout,
			stderr: () => stderr,
		};
	}

	async function outputEntries() {
		const directories = [root, path.join(project, "exports")];
		for (const name of await readdir(root))
			if (name.startsWith("praxity-studio-")) directories.push(path.join(root, name));
		const entries = [];
		for (const directory of directories) {
			try {
				for (const name of await readdir(directory))
					entries.push(path.relative(root, path.join(directory, name)));
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		return entries;
	}
	async function previewFolders() {
		return (await outputEntries()).filter((name) =>
			/^praxity-(export|deployment)-/.test(path.basename(name)),
		);
	}
	async function stagedExports() {
		return (await outputEntries()).filter((name) => /\.zip\..*\.tmp$/.test(name));
	}
	async function assertExportsRolledBack() {
		assert.deepEqual(await readdir(path.join(project, "exports")), []);
		assert.deepEqual(await readdir(path.join(project, ".praxity/studio-tmp")), []);
		assert.deepEqual(
			(await readdir(root)).filter((name) => name.startsWith("praxity-studio-")),
			[],
		);
	}
	async function preview(cli) {
		const prior = new Set(await previewFolders());
		const result = await cli.rpc("coursePreviewBuild", {
			request: {
				scope: "lesson",
				lessonFilename: "lesson.prax",
				source: "---\ntitle: Test\n---\n# Hello\n",
			},
		});
		assert.ok(result.leaseId);
		const folders = (await previewFolders()).filter((name) => !prior.has(name));
		assert.ok(folders.length > 0, "Preview must allocate real temporary files");
		return folders;
	}

	test("init hides course metadata through the bundled CLI and reruns in French", async (t) => {
		const course = path.join(root, "init-course");
		await mkdir(course);
		const first = await start(t, "normal", false, { ready: false, args: ["init", course] });
		assert.deepEqual(await first.exited, [0, null]);
		assert.match(first.stdout(), /Updated .vscode\/settings.json/);
		const settings = await readFile(path.join(course, ".vscode/settings.json"), "utf8");
		assert.deepEqual(JSON.parse(settings), {
			"files.exclude": { ".praxity": true, ".praxity-write-*": true },
			"search.exclude": { ".praxity": true, ".praxity-write-*": true },
		});
		const again = await start(t, "normal", false, {
			ready: false,
			args: ["init", course, "--lang", "fr"],
		});
		assert.deepEqual(await again.exited, [0, null]);
		assert.match(again.stdout(), /settings.json inchangé/);
		assert.match(again.stdout(), /Ce dossier n'est pas dans un dépôt Git/);
		assert.match(again.stdout(), /\.praxity déjà masqué/);
		assert.equal(await readFile(path.join(course, ".vscode/settings.json"), "utf8"), settings);
		assert.deepEqual((await readdir(course)).sort(), [".vscode"]);
	});

	// Exceed the old 500-poll cap: about 8 s on Windows and 5 s on Unix.
	test("slow startup waits for the printed session URL", { timeout: 30_000 }, async (t) => {
		const cli = await start(t, "normal", false, {
			env: { TEST_PRELOAD_DELAY: process.platform === "win32" ? "9000" : "5500" },
		});
		cli.child.kill("SIGKILL");
		await cli.closed;
	});

	test("startup refusal rejects readiness with the captured output", {
		timeout: 10_000,
	}, async (t) => {
		const cli = await start(t, "normal", false, { ready: false, args: ["studio"] });
		await cli.closed;
		await assert.rejects(
			cli.waitFor("/#session="),
			/CLI closed before \/#session=.*Missing project directory/s,
		);
		await cli.closed;
		await assert.rejects(
			cli.waitFor("/#session="),
			/CLI closed before \/#session=.*Missing project directory/s,
		);
	});

	test("stdout closing rejects readiness while the CLI is still alive", {
		timeout: 10_000,
	}, async (t) => {
		const cli = await start(t, "normal", false, {
			ready: false,
			env: { TEST_STARTUP: "hung" },
		});
		await cli.waitFor("test-startup-hung");
		const ready = cli.waitFor("/#session=");
		cli.child.stdout.destroy();
		await assert.rejects(ready, /CLI closed before \/#session=.*test-startup-hung/s);
		assert.equal(cli.child.exitCode, null);
		assert.equal(cli.child.signalCode, null);
	});

	test("studio help and startup refusals exit with a live IPC parent", {
		timeout: 10_000,
	}, async (t) => {
		// Two eager DOM imports exceed this deadline; help and argument errors need neither.
		const outputs = [];
		for (const [args, code] of [
			[["studio", "--help"], 0],
			[["studio"], 2],
		]) {
			const cli = await start(t, "normal", false, {
				ready: false,
				args,
				env: { TEST_DOM_DELAY: "6000" },
			});
			assert.deepEqual(await cli.exited, [code, null]);
			await cli.closed;
			outputs.push(cli.stdout());
		}
		for (const output of outputs) assert.doesNotMatch(output, /test-dom-loading/);
		assert.match(outputs[0], /^Usage:\n {2}praxity init/);
		assert.deepEqual(JSON.parse(outputs[1].split("\n")[0]), {
			ok: false,
			error: { code: "invalid_arguments", message: "Missing project directory." },
		});
	});

	test("studio help and the choice checker do not load signature or DOM modules", async () => {
		const env = { ...process.env, TEST_DOM_FORBIDDEN: "1" };
		const help = await promisify(execFile)(process.execPath, [entry, "studio", "--help"], { env });
		assert.match(help.stdout, /studio/);
		const checker = await promisify(execFile)(process.execPath, [checkerEntry], { env });
		assert.equal(checker.stdout, "advice=1\n");
	});

	test("the launcher PID is consumed before spawning a browser descendant", {
		timeout: 10_000,
	}, async (t) => {
		const cli = await start(t, "normal", true, {
			args: ["studio", project],
			env: { PRAXITY_PARENT_PID: String(process.pid), TEST_PARENT_ENV: "1" },
		});
		await cli.waitFor('test-descendant={"parent":null}');
		cli.child.kill("SIGKILL");
		assert.deepEqual(await cli.exited, [null, "SIGKILL"]);
		await cli.closed;
		assert.match(cli.stdout(), /test-exit=129/);
		await cli.waitFor("test-close-started");
		assert.equal(cli.stderr(), "");
	});

	test("malformed expected-parent identities refuse startup", { timeout: 10_000 }, async (t) => {
		for (const value of ["0", "-1", "not-a-pid", "1e5", "9007199254740992"]) {
			const cli = await start(t, "normal", false, {
				ready: false,
				env: { PRAXITY_PARENT_PID: value },
			});
			assert.deepEqual(await cli.exited, [1, null]);
			assert.match(cli.stderr(), /PRAXITY_PARENT_PID/);
			assert.ok(!cli.stdout().includes("/#session="));
		}
	});

	test("repeat signals wait for a slow close and retain the first exit code", {
		timeout: 10_000,
		skip: process.platform === "win32",
	}, async (t) => {
		const cli = await start(t, "gated");
		cli.child.kill("SIGINT");
		await cli.waitFor("test-close-started");
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) {
			cli.child.kill(signal);
			await delay(100);
			assert.equal(cli.child.exitCode, null);
			assert.equal(cli.child.signalCode, null);
		}
		cli.child.send("release");
		assert.deepEqual(await cli.exited, [130, null]);
		assert.equal(cli.stderr(), "");
	});

	for (const [signal, code] of [
		["SIGTERM", 143],
		["SIGHUP", 129],
		["SIGQUIT", 131],
	]) {
		test(`${signal} completes server cleanup with exit ${code}`, {
			timeout: 10_000,
			skip: process.platform === "win32",
		}, async (t) => {
			const cli = await start(t);
			cli.child.kill(signal);
			assert.deepEqual(await cli.exited, [code, null]);
			await cli.waitFor("test-close-started");
			assert.equal(cli.stderr(), "");
		});
	}

	test("a hung close exits after ten seconds despite another signal", {
		timeout: 20_000,
		skip: process.platform === "win32",
	}, async (t) => {
		const cli = await start(t, "hung");
		const folders = await preview(cli);
		const started = performance.now();
		cli.child.kill("SIGTERM");
		await cli.waitFor("test-close-started");
		await delay(100);
		cli.child.kill("SIGQUIT");
		assert.deepEqual(await cli.exited, [143, null]);
		const elapsed = performance.now() - started;
		assert.ok(elapsed >= 9_900 && elapsed < 12_000, `Forced exit took ${elapsed}ms`);
		assert.match(cli.stderr(), /shutdown timed out/);
		assert.deepEqual(
			(await previewFolders()).filter((name) => folders.includes(name)),
			[],
		);
	});

	test("a close failure reports the error and retains the signal exit code", {
		timeout: 10_000,
		skip: process.platform === "win32",
	}, async (t) => {
		const cli = await start(t, "error", false, { env: { TEST_EXPORT: "gated" } });
		const folders = await preview(cli);
		const exporting = cli
			.rpc("exportScorm", { format: "html", scope: "lesson", lessonFilename: "lesson.prax" })
			.catch(() => {});
		await cli.waitFor("test-export-staged");
		assert.ok((await stagedExports()).length > 0);
		cli.child.kill("SIGINT");
		await cli.waitFor("test-export-released");
		assert.deepEqual(await cli.exited, [130, null]);
		await cli.closed;
		assert.match(
			cli.stdout(),
			/test-export-staged[\s\S]*test-close-error[\s\S]*test-export-released/,
		);
		assert.match(cli.stderr(), /failed to shut down cleanly/);
		assert.match(cli.stderr(), /HTTP close failed/);
		await exporting;
		await assertExportsRolledBack();
		assert.deepEqual(
			(await previewFolders()).filter((name) => folders.includes(name)),
			[],
		);
	});

	for (const contract of ["ipc", "identity"]) {
		for (const milliseconds of [0, 100]) {
			test(`${contract} launcher death after ${milliseconds}ms stops before readiness`, {
				timeout: 10_000,
			}, async (t) => {
				const cli = await start(t, "normal", true, {
					ready: false,
					env: { TEST_PARENT: contract, TEST_PRELOAD_DELAY: "500" },
				});
				await delay(milliseconds);
				cli.child.kill("SIGKILL");
				assert.deepEqual(await cli.exited, [null, "SIGKILL"]);
				await cli.waitFor("test-exit=129");
				await cli.closed;
				assert.ok(!cli.stdout().includes("/#session="));
				assert.equal(cli.stderr(), "");
			});
		}
	}

	test("parent death during stuck startup uses the shutdown deadline", {
		timeout: 20_000,
	}, async (t) => {
		const cli = await start(t, "normal", true, {
			ready: false,
			env: { TEST_STARTUP: "hung", TEST_PARENT: "none" },
		});
		await cli.waitFor("test-startup-hung");
		cli.child.kill("SIGKILL");
		assert.deepEqual(await cli.exited, [null, "SIGKILL"]);
		await cli.closed;
		assert.match(cli.stdout(), /test-exit=129/);
		assert.match(cli.stderr(), /shutdown timed out/);
	});

	for (const contract of ["ipc", "identity", "none"]) {
		test(`${contract} parent death rolls back an export and releases preview files`, {
			timeout: 10_000,
		}, async (t) => {
			const cli = await start(t, "normal", true, {
				env: { TEST_PARENT: contract, TEST_EXPORT: "gated" },
			});
			const folders = await preview(cli);
			const exporting = cli
				.rpc("exportScorm", { format: "html", scope: "lesson", lessonFilename: "lesson.prax" })
				.catch(() => {});
			await cli.waitFor("test-export-staged");
			assert.ok((await stagedExports()).length > 0);
			cli.child.kill("SIGKILL");
			assert.deepEqual(await cli.exited, [null, "SIGKILL"]);
			await cli.closed;
			await exporting;
			assert.match(cli.stdout(), /test-exit=129/);
			await assertExportsRolledBack();
			assert.deepEqual(
				(await previewFolders()).filter((name) => folders.includes(name)),
				[],
			);
			assert.equal(cli.stderr(), "");
		});
	}

	test("IPC launcher EOF closes Studio without a numeric PID probe", {
		timeout: 10_000,
	}, async (t) => {
		const cli = await start(t, "normal", true, {
			env: { TEST_PARENT: "ipc", TEST_PARENT_PROBE: "live" },
		});
		cli.child.kill("SIGKILL");
		assert.deepEqual(await cli.exited, [null, "SIGKILL"]);
		await cli.closed;
		assert.match(cli.stdout(), /test-exit=129/);
		assert.doesNotMatch(cli.stdout(), /test-pid-probed/);
		assert.equal(cli.stderr(), "");
	});

	test("parent EOF cancels a filesystem write that waits for its abort signal", {
		timeout: 10_000,
	}, async (t) => {
		const cli = await start(t, "normal", true, {
			env: { TEST_PARENT: "ipc", TEST_EXPORT: "abortable" },
		});
		const folders = await preview(cli);
		const exporting = cli
			.rpc("exportScorm", {
				format: "html",
				scope: "lesson",
				lessonFilename: "lesson.prax",
			})
			.catch(() => {});
		await cli.waitFor("test-export-staged");
		cli.child.kill("SIGKILL");
		await cli.closed;
		await exporting;
		assert.match(cli.stdout(), /test-exit=129/);
		assert.equal(cli.stderr(), "");
		assert.deepEqual(await stagedExports(), []);
		assert.deepEqual(
			(await previewFolders()).filter((name) => folders.includes(name)),
			[],
		);
	});

	test("an export that outlasts shutdown releases previews and is recovered on next start", {
		timeout: 35_000,
	}, async (t) => {
		const cli = await start(t, "normal", true, {
			env: { TEST_PARENT: "ipc", TEST_EXPORT: "hung" },
		});
		const folders = await preview(cli);
		const exporting = cli
			.rpc("exportScorm", {
				format: "html",
				scope: "lesson",
				lessonFilename: "lesson.prax",
			})
			.catch(() => {});
		await cli.waitFor("test-export-staged");
		const staged = await stagedExports();
		assert.equal(staged.length, 1);
		const sibling = await start(t, "normal", true, { env: { TEST_PARENT: "ipc" } });
		const siblingFolders = await preview(sibling);
		await writeFile(path.join(project, "exports/keep.zip"), "completed export");
		const started = performance.now();
		cli.child.kill("SIGKILL");
		for (let attempts = 0; attempts < 500; attempts++) {
			if (!(await previewFolders()).some((name) => folders.includes(name))) break;
			await delay(10);
		}
		assert.deepEqual(
			(await previewFolders()).filter((name) => folders.includes(name)),
			[],
		);
		assert.ok(!cli.child.stdout.destroyed, "Preview disposal must precede forced exit");
		await cli.closed;
		await exporting;
		const elapsed = performance.now() - started;
		assert.ok(elapsed >= 9_900 && elapsed < 12_000, `Forced exit took ${elapsed}ms`);
		assert.match(cli.stdout(), /test-exit=129/);
		assert.match(cli.stderr(), /shutdown timed out/);
		assert.deepEqual(await stagedExports(), staged, "Hard exit leaves a recoverable staged write");
		const restarted = await start(t, "normal", true, { env: { TEST_PARENT: "ipc" } });
		assert.deepEqual(await stagedExports(), []);
		assert.deepEqual(
			(await previewFolders()).filter((name) => siblingFolders.includes(name)),
			siblingFolders,
		);
		assert.equal(
			await readFile(path.join(project, "exports/keep.zip"), "utf8"),
			"completed export",
		);
		sibling.child.kill("SIGKILL");
		restarted.child.kill("SIGKILL");
		await Promise.all([sibling.closed, restarted.closed]);
		await rm(path.join(project, "exports/keep.zip"));
	});

	test("SIGKILL of a detached launcher closes Studio within the best-effort watchdog interval", {
		timeout: 10_000,
	}, async (t) => {
		const cli = await start(t, "normal", true, { env: { TEST_PARENT: "none" } });
		const started = performance.now();
		cli.child.kill("SIGKILL");
		assert.deepEqual(await cli.exited, [null, "SIGKILL"]);
		await cli.waitFor("test-exit=129");
		await cli.closed;
		assert.ok(performance.now() - started < 2_000, "Watchdog missed its one-second poll");
		await cli.waitFor("test-close-started");
		assert.equal(cli.stderr(), "");
	});
});
