import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	compileTypstNative,
	TypstCliUnavailableError,
} from "../src/pipelines/typst-native-compiler.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
function cliFailure(code: string | number, message: string, stderr = "") {
	vi.mocked(execFile).mockImplementation(((
		_file: string,
		_args: readonly string[],
		_options: unknown,
		callback: (error: Error, stdout: string, stderr: string) => void,
	) => {
		callback(Object.assign(new Error(message), { code }), "", stderr);
	}) as typeof execFile);
}

beforeEach(() => {
	vi.resetAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

describe("explicit Typst engine", () => {
	const executablePath = "/bundled/typst";
	it("native entry validates its executable and propagates an unavailable engine", async () => {
		await expect(compileTypstNative("hello", { executablePath: "typst" })).rejects.toThrow(
			"must be absolute",
		);
		await expect(compileTypstNative("hello", { executablePath: "" })).rejects.toThrow(
			"requires executablePath",
		);
		cliFailure("ENOENT", "missing native executable");
		await expect(compileTypstNative("hello", { executablePath })).rejects.toThrow(
			"missing native executable",
		);
	});
	it.each([
		"../escape",
		"/absolute",
		"assets/../../escape",
		"assets/./file",
		"assets\\file",
		"input.typ",
	])("rejects unsafe staged path %s before spawning", async (filename) => {
		await expect(
			compileTypstNative("hello", {
				executablePath,
				files: new Map([[filename, new Uint8Array()]]),
			}),
		).rejects.toThrow("Invalid staged Typst path");
		expect(execFile).not.toHaveBeenCalled();
	});

	it("stages bytes in its private root and rejects compiler warnings with cleanup", async () => {
		let workspace = "";
		vi.mocked(execFile).mockImplementation(((
			_file: string,
			args: string[],
			_options: unknown,
			callback: (error: Error | null, stdout: string, stderr: string) => void,
		) => {
			workspace = path.dirname(args[args.length - 1]);
			expect(args).toEqual(
				expect.arrayContaining([
					"--features",
					"a11y-extras",
					"--font-path",
					path.join(workspace, "fonts"),
				]),
			);
			void readFile(path.join(workspace, "assets/image.svg"), "utf8").then(
				(content) => {
					expect(content).toBe("image bytes");
					callback(null, "", "warning: missing glyph");
				},
				(error) => callback(error, "", ""),
			);
		}) as typeof execFile);
		await expect(
			compileTypstNative("hello", {
				executablePath,
				a11yExtras: true,
				files: new Map([
					["assets/image.svg", Buffer.from("image bytes")],
					["fonts/body.ttf", Buffer.from("font bytes")],
				]),
			}),
		).rejects.toThrow("warning: missing glyph");
		await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it.each(["", "warning: missing glyph"])(
		"cleans only its private workspace within the host temporary parent with diagnostics %j",
		async (stderr) => {
			const temporaryRoot = await mkdtemp(path.join(tmpdir(), "typst-parent-test-"));
			let workspace = "";
			try {
				await writeFile(path.join(temporaryRoot, "retained.txt"), "host-owned bytes");
				vi.mocked(execFile).mockImplementation(((
					_file: string,
					args: string[],
					_options: unknown,
					callback: (error: Error | null, stdout: string, stderr: string) => void,
				) => {
					const output = args[args.length - 1];
					workspace = path.dirname(output);
					void writeFile(output, "%PDF").then(
						() => callback(null, "", stderr),
						(error) => callback(error, "", ""),
					);
				}) as typeof execFile);
				const compilation = compileTypstNative("hello", { executablePath, temporaryRoot });
				if (stderr) {
					await expect(compilation).rejects.toThrow(
						"Typst compilation diagnostics: warning: missing glyph",
					);
				} else {
					await expect(compilation).resolves.toEqual(Buffer.from("%PDF"));
				}
				expect(path.dirname(workspace)).toBe(temporaryRoot);
				await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
				expect(await readdir(temporaryRoot)).toEqual(["retained.txt"]);
				expect(await readFile(path.join(temporaryRoot, "retained.txt"), "utf8")).toBe(
					"host-owned bytes",
				);
			} finally {
				await rm(temporaryRoot, { recursive: true, force: true });
			}
		},
	);

	it.each([
		{ rootDir: "/host" },
		{ rootDir: "" },
		{ rootDir: undefined },
		{ fontPaths: ["/host"] },
		{ fontPaths: [] },
		{ fontPaths: undefined },
	])("rejects unsupported host options before spawning: %o", async (extra) => {
		cliFailure("EACCES", "compiler must not run");
		for (const files of [undefined, new Map<string, Uint8Array>()]) {
			const error = await compileTypstNative("caller source must stay private", {
				executablePath,
				files,
				...extra,
			}).catch((failure: unknown) => failure);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe(
				"ETYPSTHOSTOPTIONS: rootDir and fontPaths are unsupported; supply assets and fonts through files for private staging.",
			);
			expect((error as Error).cause).toBeUndefined();
		}
		expect(execFile).not.toHaveBeenCalled();
	});

	it("keeps the abort reason ahead of unsupported host options", async () => {
		const signal = AbortSignal.abort(new Error("already cancelled"));
		await expect(
			compileTypstNative("hello", { executablePath, signal, ...{ rootDir: "/host" } }),
		).rejects.toBe(signal.reason);
		expect(execFile).not.toHaveBeenCalled();
	});

	it("requires an absolute executable and propagates a missing engine", async () => {
		await expect(compileTypstNative("hello", { executablePath: "typst" })).rejects.toThrow(
			"must be absolute",
		);
		expect(execFile).not.toHaveBeenCalled();
		cliFailure("ENOENT", "missing bundled executable");
		await expect(compileTypstNative("hello", { executablePath })).rejects.toThrow(
			"missing bundled executable",
		);
		expect(execFile).toHaveBeenCalledTimes(1);
		expect(vi.mocked(execFile).mock.calls[0][0]).toBe(executablePath);
		const args = vi.mocked(execFile).mock.calls[0][1] as string[];
		await expect(access(path.dirname(args[args.length - 1]))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("isolates fonts and environment, and cleans unique workspaces after success", async () => {
		for (const key of [
			"TYPST_FONT_PATHS",
			"TYPST_ROOT",
			"TYPST_PACKAGE_PATH",
			"TYPST_PACKAGE_CACHE_PATH",
			"TYPST_IGNORE_SYSTEM_FONTS",
			"TYPST_FEATURES",
			"SOURCE_DATE_EPOCH",
			"HOME",
		]) {
			vi.stubEnv(key, "/host-pollution");
		}
		const workspaces: string[] = [];
		vi.mocked(execFile).mockImplementation(((
			_file: string,
			args: string[],
			_options: unknown,
			callback: (error: Error | null, stdout: string, stderr: string) => void,
		) => {
			const output = args[args.length - 1];
			workspaces.push(path.dirname(output));
			void writeFile(output, "%PDF").then(() => callback(null, "", ""));
		}) as typeof execFile);
		const pdfs = await Promise.all(
			[0, 1].map(() =>
				compileTypstNative("hello", {
					executablePath,
					pdfStandard: "ua-1",
					files: new Map([["fonts/body.ttf", Buffer.from("font bytes")]]),
				}),
			),
		);
		expect(pdfs.map((pdf) => pdf.toString())).toEqual(["%PDF", "%PDF"]);
		expect(new Set(workspaces).size).toBe(2);
		for (const [index, [file, args, options]] of vi.mocked(execFile).mock.calls.entries()) {
			expect(file).toBe(executablePath);
			expect(args).toEqual(
				expect.arrayContaining([
					"--ignore-system-fonts",
					"--font-path",
					path.join(workspaces[index], "fonts"),
					"--pdf-standard",
					"ua-1",
				]),
			);
			expect(options).toMatchObject({ timeout: 45_000, env: { LANG: "C.UTF-8" } });
			expect(Object.keys((options as { env: object }).env)).toEqual(["LANG"]);
		}
		for (const workspace of workspaces) {
			await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
		}
	});

	it("propagates abort to the child and removes its workspace", async () => {
		const controller = new AbortController();
		const reason = new Error("cancel export");
		let workspace = "";
		vi.mocked(execFile).mockImplementation(((
			_file: string,
			args: string[],
			options: { signal: AbortSignal },
			callback: (error: Error, stdout: string, stderr: string) => void,
		) => {
			workspace = path.dirname(args[args.length - 1]);
			expect(options.signal).toBe(controller.signal);
			options.signal.addEventListener("abort", () => callback(new Error("aborted"), "", ""), {
				once: true,
			});
			controller.abort(reason);
		}) as typeof execFile);
		await expect(
			compileTypstNative("hello", { executablePath, signal: controller.signal }),
		).rejects.toBe(reason);
		await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects an already aborted call without spawning", async () => {
		const signal = AbortSignal.abort(new Error("already cancelled"));
		await expect(compileTypstNative("hello", { executablePath, signal })).rejects.toBe(
			signal.reason,
		);
		expect(execFile).not.toHaveBeenCalled();
	});

	it("preserves caller-owned root directories on refusal", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "typst-root-test-"));
		try {
			await writeFile(path.join(rootDir, "asset.txt"), "retained");
			await writeFile(path.join(rootDir, "input.typ"), "retained source");
			await writeFile(path.join(rootDir, "output.pdf"), "retained PDF");
			cliFailure(1, "invalid source");
			const error = await compileTypstNative("bad", { executablePath, ...{ rootDir } }).catch(
				(failure: unknown) => failure,
			);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe(
				"ETYPSTHOSTOPTIONS: rootDir and fontPaths are unsupported; supply assets and fonts through files for private staging.",
			);
			expect((error as Error).cause).toBeUndefined();
			expect(await readFile(path.join(rootDir, "asset.txt"), "utf8")).toBe("retained");
			expect(await readFile(path.join(rootDir, "input.typ"), "utf8")).toBe("retained source");
			expect(await readFile(path.join(rootDir, "output.pdf"), "utf8")).toBe("retained PDF");
			expect(execFile).not.toHaveBeenCalled();
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});

describe("Typst CLI errors", () => {
	const executablePath = "/bundled/typst";
	it.each([1, "EACCES", "ETIMEDOUT"])(
		"preserves CLI error %s without losing diagnostics",
		async (code) => {
			cliFailure(code, "compiler failed", 'error: unknown paper size "letter"');
			const error = await compileTypstNative("bad source", { executablePath }).catch(
				(failure: unknown) => failure,
			);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe(
				'Typst compilation failed: error: unknown paper size "letter"',
			);
			expect((error as Error).cause).toMatchObject({ code });
		},
	);

	it("reports the missing CLI executable with its cause", async () => {
		cliFailure("ENOENT", "spawn typst ENOENT");
		const error = await compileTypstNative("hello", { executablePath }).catch(
			(failure: unknown) => failure,
		);
		expect(error).toBeInstanceOf(TypstCliUnavailableError);
		expect((error as Error).message).toContain("Typst CLI unavailable: spawn typst ENOENT");
		expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
	});

	it("does not mistake a staging failure for a missing executable", async () => {
		const error = await compileTypstNative("hello", {
			executablePath,
			files: new Map([
				["assets/file", Buffer.from("retained")],
				["assets/file/child", Buffer.from("cannot be staged")],
			]),
		}).catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(TypstCliUnavailableError);
		expect(execFile).not.toHaveBeenCalled();
	});
});
