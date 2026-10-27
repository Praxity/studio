import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	interruptProjectWrite,
	projectDiskSnapshot,
} from "../../test-utils/interrupted-project-write";
import { runPraxityCli } from "../cli";
import { withProjectFileTransaction } from "../project-file-transactions";
import type { StudioServer } from "../studio/server";

const roots: string[] = [];
const servers: StudioServer[] = [];
const runtime = { appVersion: "0.3.0", exportAssetsDir: "unused", editorAssetsDir: "missing" };
let writerRoot: string;
let writerEntry: string;
beforeAll(async () => {
	writerRoot = await mkdtemp(join(tmpdir(), "studio-cli-writer-"));
	writerEntry = join(writerRoot, "writer.mjs");
	// Compile once; every recovery case still kills a fresh real writer at capture.
	await build({
		entryPoints: [fileURLToPath(new URL("./fixtures/capture-reader-writer.ts", import.meta.url))],
		outfile: writerEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
	// Every case uses the real server; its lazy module load is file setup, not recovery work.
	await import("../studio/server");
});
afterAll(async () => {
	if (writerRoot) await rm(writerRoot, { recursive: true, force: true });
});

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "studio cli spaces "),
	);
	roots.push(root);
	const editorAssetsDir = join(root, "editor");
	const projectDir = join(root, "project");
	await mkdir(editorAssetsDir);
	await mkdir(projectDir);
	await writeFile(join(editorAssetsDir, "index.html"), "<!doctype html><title>Fixture</title>");
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	await writeFile(
		join(projectDir, "course.prax"),
		"---\nid: fixture-lesson\ntitle: Test\n---\n# Hello\n",
	);
	return { editorAssetsDir, projectDir };
}

it.each([
	[
		"en",
		"Restore the complete .praxity/identity/ folder from a backup",
		"Keep the original folder",
	],
	[
		"fr",
		"Restaurez le dossier complet .praxity/identity/ depuis une sauvegarde",
		"Conservez le dossier original",
	],
] as const)(
	"fresh Studio open after a real interrupted write explains identity recovery in %s",
	async (locale, restore, keep) => {
		const { projectDir, editorAssetsDir } = await fixture();
		await writeFile(join(projectDir, "narration.yaml"), "old narration");
		await interruptProjectWrite(projectDir, "narration.yaml", "new narration", writerEntry);
		await withProjectFileTransaction(projectDir, async () => {}, "write");
		await rm(join(projectDir, "narration.yaml"));
		const result = await runPraxityCli(["studio", projectDir, "--no-open", "--lang", locale], {
			...runtime,
			editorAssetsDir,
		});
		if (result.studioServer) servers.push(result.studioServer);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(restore);
		expect(result.stderr).toContain(keep);
		expect(result.stderr).toContain("praxity recovery list <project-dir>");
		expect(result.stderr).toContain("praxity recovery resolve <project-dir> <archive>");
		expect(result.stderr).toContain(
			"praxity recovery extract <project-dir> <archive> <new-directory>",
		);
		expect(result.stderr).toContain(".praxity-write-*");
		expect((await readdir(projectDir)).some((name) => name.startsWith(".praxity-write-"))).toBe(
			true,
		);
	},
);

it.each(["en", "fr"] as const)(
	"identity recovery is localized across CLI admissions in %s",
	async (locale) => {
		const { projectDir } = await fixture();
		await writeFile(join(projectDir, "course.yaml"), "title: Test\nlessons: [course.prax]\n");
		await writeFile(join(projectDir, "narration.yaml"), "old narration");
		await interruptProjectWrite(projectDir, "narration.yaml", "new narration", writerEntry);
		await withProjectFileTransaction(projectDir, async () => {}, "write");
		await rm(join(projectDir, "narration.yaml"));
		for (const args of [
			["inspect", projectDir],
			["inspect", projectDir, "--blocks"],
			["export", projectDir, "--format", "pdf", "--output", join(projectDir, "output.pdf")],
			[
				"edit",
				projectDir,
				"setProperty",
				"--at",
				"course.prax#1.1",
				"--arg",
				"name=tone",
				"--arg",
				"value=warning",
			],
		]) {
			const result = await runPraxityCli([...args, "--lang", locale], runtime);
			expect(result.exitCode, result.stderr).toBe(1);
			const output = `${result.stdout}\n${result.stderr}`;
			expect(output).toContain(
				locale === "fr" ? "Restaurez le dossier complet" : "Restore the complete",
			);
			expect(output).toContain("praxity recovery resolve <project-dir> <archive>");
		}
	},
);

describe("studio command", () => {
	it.each(["en", "fr"] as const)("explains linked storage in stderr, %s", async (locale) => {
		const { editorAssetsDir, projectDir } = await fixture();
		const target = join(projectDir, "linked-store");
		await mkdir(target);
		await writeFile(join(target, "keep.json"), "keep these bytes");
		await symlink(target, join(projectDir, ".praxity"), "junction");
		const before = await projectDiskSnapshot(target);
		const result = await runPraxityCli(["studio", projectDir, "--no-open", "--lang", locale], {
			...runtime,
			editorAssetsDir,
		});
		expect(result.exitCode).toBe(1);
		expect(result.studioServer).toBeUndefined();
		expect(JSON.parse(result.stdout).error, result.stderr).toMatchObject({
			code: "EIDENTITY",
			messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: ".praxity" } },
		});
		expect(result.stderr).toContain(
			locale === "fr"
				? "Studio a besoin d'une copie ordinaire de .praxity"
				: "Studio needs a plain copy of .praxity",
		);
		expect(result.stderr).toContain("cp -R -L");
		expect(result.stderr).toContain("Copy-Item -LiteralPath");
		if (locale === "fr") {
			for (const output of [result.stderr, JSON.parse(result.stdout).error.message]) {
				for (const text of ["spéciaux", "identités", "Vérifiez", "à la copie"])
					expect(output).toContain(text);
				expect(output).not.toMatch(/\p{L}\?\p{L}/u);
			}
		}
		expect(await projectDiskSnapshot(target)).toEqual(before);
	});
	it("dispatches studio, retains existing commands and explains the foreground lifecycle", async () => {
		expect((await runPraxityCli(["studio", "--help"], runtime)).stdout).toContain("--no-open");
		expect((await runPraxityCli(["--version"], runtime)).stdout).toBe("0.3.0\n");
	});

	it.each(
		[
			["studio"],
			["studio", "--no-open"],
			["studio", "folder", "extra"],
			["studio", "folder", "--port"],
			["studio", "folder", "--port", "0"],
			["studio", "folder", "--port", "65536"],
			["studio", "folder", "--port", "-1"],
			["studio", "folder", "--port", "1.5"],
			["studio", "folder", "--port", "1e3"],
			["studio", "folder", "--port", "NaN"],
			["studio", "folder", "--port", "8080", "--port", "8081"],
			["studio", "folder", "--no-open", "--no-open"],
		].map((args) => ({ args })),
	)("rejects malformed arguments $args", async ({ args }) => {
		const result = await runPraxityCli(args, runtime);
		expect(result.exitCode).toBe(2);
		expect(result.studioServer).toBeUndefined();
		expect(JSON.parse(result.stdout).error.code).toBe("invalid_arguments");
	});

	it("prints the fragment capability ready URL after admission and honours --no-open", async () => {
		const { editorAssetsDir, projectDir } = await fixture();
		for (const noOpen of [true, false]) {
			const result = await runPraxityCli(["studio", projectDir, ...(noOpen ? ["--no-open"] : [])], {
				...runtime,
				editorAssetsDir,
			});
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe(
				noOpen
					? ""
					: "The default Studio port is unavailable. Studio is using a temporary port for this session.\n",
			);
			expect(result.stdout).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#session=[A-Za-z0-9_-]{43}\n$/);
			expect(result.openBrowser).toBe(!noOpen);
			if (!result.studioServer) throw new Error("CLI did not retain its foreground server");
			servers.push(result.studioServer);
			expect((await fetch(result.studioServer.origin, { redirect: "manual" })).status).toBe(303);
		}
		expect(servers[0].origin).not.toBe(servers[1].origin);
		expect(servers[0].readyUrl.split("#")[1]).not.toBe(servers[1].readyUrl.split("#")[1]);
	});

	it("accepts --port and binds exactly that port", async () => {
		const { editorAssetsDir, projectDir } = await fixture();
		const cliRuntime = { ...runtime, editorAssetsDir };
		const initial = await runPraxityCli(["studio", projectDir, "--no-open"], cliRuntime);
		if (!initial.studioServer) throw new Error(initial.stderr);
		servers.push(initial.studioServer);
		const port = new URL(initial.studioServer.origin).port;
		await initial.studioServer.close();
		const result = await runPraxityCli(
			["studio", "--port", port, projectDir, "--no-open"],
			cliRuntime,
		);
		if (result.studioServer) servers.push(result.studioServer);
		expect(result.exitCode).toBe(0);
		expect(result.studioServer?.origin).toBe(`http://127.0.0.1:${port}`);
		expect(result.openBrowser).toBe(false);
		expect(result.stdout).toBe(`${result.studioServer?.readyUrl}\n`);
	}, 15_000);

	it("names the course holding a requested port and leaves that Studio working", async () => {
		const holder = await fixture();
		const initial = await runPraxityCli(["studio", holder.projectDir, "--no-open"], {
			...runtime,
			editorAssetsDir: holder.editorAssetsDir,
		});
		if (!initial.studioServer) throw new Error(initial.stderr);
		servers.push(initial.studioServer);
		const contender = await fixture();
		const port = new URL(initial.studioServer.origin).port;
		const result = await runPraxityCli(
			["studio", contender.projectDir, "--port", port, "--no-open"],
			{ ...runtime, editorAssetsDir: contender.editorAssetsDir },
		);
		expect(result.exitCode).toBe(1);
		expect(result.studioServer).toBeUndefined();
		expect(result.stdout).not.toContain("#session=");
		expect(result.stderr).toContain(`Port ${port} is already used by Studio`);
		expect(result.stderr).toContain(holder.projectDir);
		expect((await fetch(initial.studioServer.origin, { redirect: "manual" })).status).toBe(303);
	}, 20_000);

	it.each(["foreign HTTP", "silent listener"])(
		"reports another program holding the requested port: %s",
		async (kind) => {
			const listener = createServer((_req, res) => {
				if (kind === "foreign HTTP") res.end("Another application");
			});
			await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
			try {
				const address = listener.address();
				if (!address || typeof address === "string") throw new Error("Listener did not bind");
				const { projectDir, editorAssetsDir } = await fixture();
				const result = await runPraxityCli(
					["studio", projectDir, "--no-open", "--port", String(address.port)],
					{ ...runtime, editorAssetsDir },
				);
				expect(result.exitCode).toBe(1);
				expect(result.studioServer).toBeUndefined();
				expect(result.stdout).not.toContain("#session=");
				expect(result.stderr).toContain(`Port ${address.port} is already used by another program`);
			} finally {
				listener.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					listener.close((error) => (error ? reject(error) : resolve())),
				);
			}
		},
		15_000,
	);

	it.each([
		"crafted",
		"malformed",
		"extra",
		"redirect",
		"oversized",
		"oversizedStream",
		"silent",
		"aborted",
		"slow",
	])("handles an untrusted port holder cleanly: %s", async (kind) => {
		const requests: string[] = [];
		const listener = createServer((req, res) => {
			requests.push(req.url ?? "");
			if (kind === "silent") return;
			if (kind === "aborted") {
				res.writeHead(200);
				res.write("{");
				res.destroy();
				return;
			}
			res.writeHead(kind === "redirect" ? 302 : 200, {
				"Content-Type": "application/json",
				...(kind === "redirect" ? { Location: "/redirect-target" } : {}),
			});
			if (kind === "oversizedStream") {
				res.write("x".repeat(20_000));
				return;
			}
			if (kind === "slow") {
				// Keep delivering bytes so an inactivity timeout would never fire.
				res.write("{");
				const trickle = setInterval(() => res.write(" "), 100);
				res.once("close", () => clearInterval(trickle));
				return;
			}
			res.end(
				kind === "malformed"
					? "not json"
					: JSON.stringify({
							service: "praxity-studio",
							projectDir:
								kind === "crafted"
									? "FAKE\u001b[2J\u001b[H\nhttp://example.invalid/forged-ready\n\u001b]8;;http://example.invalid/\u0007click\u001b]8;;\u0007"
									: kind === "oversized"
										? "x".repeat(20_000)
										: "fixture",
							...(kind === "extra" ? { token: "false" } : {}),
						}),
			);
		});
		await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			const address = listener.address();
			if (!address || typeof address === "string") throw new Error("Listener did not bind");
			const { projectDir, editorAssetsDir } = await fixture();
			const result = await Promise.race([
				runPraxityCli(["studio", projectDir, "--no-open", "--port", String(address.port)], {
					...runtime,
					editorAssetsDir,
				}),
				new Promise<never>((_resolve, reject) => {
					deadline = setTimeout(() => reject(new Error("Collision probe stalled")), 2500);
				}),
			]);
			const message = `Port ${address.port} is already used by another program. Stop it or choose another --port.`;
			expect(result.exitCode).toBe(1);
			expect(result.studioServer).toBeUndefined();
			expect(JSON.parse(result.stdout)).toEqual({
				ok: false,
				error: { code: "studio_failed", message },
			});
			expect(result.stderr).toBe(`Praxity studio failed: ${message}\n`);
			expect(requests).toEqual(["/api/identity"]);
			expect(await readdir(projectDir)).toEqual(["course.prax"]);
		} finally {
			clearTimeout(deadline);
			listener.closeAllConnections();
			await new Promise<void>((resolve) => listener.close(() => resolve()));
		}
	});
	it("releases the requested port when project initialization fails", async () => {
		const listener = createServer();
		await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
		const address = listener.address();
		if (!address || typeof address === "string") throw new Error("Listener did not bind");
		await new Promise<void>((resolve) => listener.close(() => resolve()));
		const { projectDir, editorAssetsDir } = await fixture();
		await rm(join(projectDir, "course.prax"));
		try {
			const result = await runPraxityCli(
				["studio", projectDir, "--no-open", "--port", String(address.port)],
				{ ...runtime, editorAssetsDir },
			);
			expect(result.exitCode).toBe(1);
			await new Promise<void>((resolve, reject) => {
				listener.once("error", reject);
				listener.listen(address.port, "127.0.0.1", resolve);
			});
		} finally {
			await new Promise<void>((resolve) => listener.close(() => resolve()));
		}
	});

	it.each([
		{
			name: "terminal and bidi controls in an absolute path",
			identity: {
				service: "praxity-studio",
				projectDir:
					"/course\u0000\u001b\u001f\u007f\u0080\u0085\u009f\n\r\u061c\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069",
			},
			holder:
				"/course\\u0000\\u001b\\u001f\\u007f\\u0080\\u0085\\u009f\\u000a\\u000d\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a\\u202b\\u202c\\u202d\\u202e\\u2066\\u2067\\u2068\\u2069",
		},
		{ name: "wrong service", identity: { service: "foreign", projectDir: "/course" } },
		{ name: "non-string path", identity: { service: "praxity-studio", projectDir: 12 } },
		{ name: "empty path", identity: { service: "praxity-studio", projectDir: "" } },
		{ name: "relative path", identity: { service: "praxity-studio", projectDir: "course" } },
		{
			name: "overlong path within the response byte cap",
			identity: { service: "praxity-studio", projectDir: `/${"x".repeat(4096)}` },
		},
		{
			name: "extra field on an absolute path",
			identity: { service: "praxity-studio", projectDir: "/course", token: "false" },
		},
		{
			name: "non-200 Studio identity",
			identity: { service: "praxity-studio", projectDir: "/course" },
			status: 503,
		},
	])(
		"validates the port holder identity: $name",
		async ({ identity, holder, status }) => {
			const listener = createServer((_req, res) => {
				res.writeHead(status ?? 200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(identity));
			});
			await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
			try {
				const address = listener.address();
				if (!address || typeof address === "string") throw new Error("Listener did not bind");
				const { projectDir, editorAssetsDir } = await fixture();
				const result = await runPraxityCli(
					["studio", projectDir, "--no-open", "--port", String(address.port)],
					{ ...runtime, editorAssetsDir },
				);
				const message = holder
					? `Port ${address.port} is already used by Studio for course "${holder}". Stop that Studio or choose another --port.`
					: `Port ${address.port} is already used by another program. Stop it or choose another --port.`;
				expect(result.exitCode).toBe(1);
				expect(JSON.parse(result.stdout).error.message).toBe(message);
				expect(result.stderr).toBe(`Praxity studio failed: ${message}\n`);
			} finally {
				listener.closeAllConnections();
				await new Promise<void>((resolve) => listener.close(() => resolve()));
			}
		},
		15_000,
	);

	it("returns startup errors without a ready URL or listener", async () => {
		const result = await runPraxityCli(["studio", ".", "--no-open"], runtime);
		expect(result.exitCode).toBe(1);
		expect(result.studioServer).toBeUndefined();
		expect(result.stdout).not.toContain("#session=");
		expect(result.stderr).toContain("Browser editor assets are unavailable");
		const desktop = await runPraxityCli(["studio", "."], {
			appVersion: "0.3.0",
			exportAssetsDir: "unused",
		});
		expect(desktop.exitCode).toBe(1);
		expect(JSON.parse(desktop.stdout).error.code).toBe("editor_assets_missing");
	});
});
