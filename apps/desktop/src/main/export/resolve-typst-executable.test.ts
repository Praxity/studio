import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveTypstExecutable } from "./resolve-typst-executable";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "studio-typst-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
const version = async () => "typst 0.15.1 (9dfd3a08)";
async function executable(name: string) {
	const file = path.join(root, name);
	await writeFile(file, "test executable");
	await chmod(file, 0o755);
	return realpath(file);
}
it("prefers the explicit path over the environment and PATH", async () => {
	const file = await executable("explicit.exe");
	expect(
		await resolveTypstExecutable(file, {
			env: { PRAXITY_STUDIO_TYPST: "missing", PATH: root },
			runVersion: version,
		}),
	).toBe(file);
});
it("uses the environment before PATH and refuses an invalid override", async () => {
	const file = await executable("environment.exe");
	expect(
		await resolveTypstExecutable(undefined, {
			env: { PRAXITY_STUDIO_TYPST: file, PATH: "missing" },
			runVersion: version,
		}),
	).toBe(file);
	await expect(
		resolveTypstExecutable("missing", { env: { PRAXITY_STUDIO_TYPST: file }, runVersion: version }),
	).rejects.toThrow("Cannot use Typst");
});
it("finds the executable on PATH", async () => {
	const file = await executable(process.platform === "win32" ? "typst.exe" : "typst");
	expect(
		await resolveTypstExecutable(undefined, { env: { PATH: root }, runVersion: version }),
	).toBe(file);
});
it("explains installation when missing or the wrong version, without falling back", async () => {
	await expect(resolveTypstExecutable(undefined, { env: {}, platform: "win32" })).rejects.toThrow(
		"winget install --id Typst.Typst",
	);
	const file = await executable("wrong.exe");
	await expect(
		resolveTypstExecutable(file, { env: {}, runVersion: async () => "typst 0.15.0" }),
	).rejects.toThrow(/0.15.1 is required; found.*0.15.0/);
	await expect(
		resolveTypstExecutable(file, {
			env: {},
			runVersion: async () => {
				throw new Error("failed to start");
			},
		}),
	).rejects.toThrow(/failed to start.*Typst 0\.15\.1/);
});
it("rejects Windows command shims and names the real executable", async () => {
	for (const extension of ["cmd", "bat"]) {
		const shim = await executable(`typst.${extension}`);
		await expect(
			resolveTypstExecutable(shim, { platform: "win32", env: {}, runVersion: version }),
		).rejects.toThrow(/shims.*real typst.exe/);
	}
	await expect(
		resolveTypstExecutable(undefined, {
			platform: "win32",
			env: { Path: root },
			runVersion: version,
		}),
	).rejects.toThrow(/shims.*real typst.exe/);
	const file = await executable("typst.exe");
	expect(
		await resolveTypstExecutable(undefined, {
			platform: "win32",
			env: { Path: root },
			runVersion: version,
		}),
	).toBe(file);
});

it("provides French installation guidance", async () => {
	await expect(
		resolveTypstExecutable(undefined, { env: {}, locale: "fr", platform: "win32" }),
	).rejects.toThrow("Installez Typst 0.15.1");
});

it("keeps non-Windows guidance pinned and tells explicit callers to fix their option", async () => {
	for (const platform of ["darwin", "linux"] as const) {
		const error = await resolveTypstExecutable(undefined, { env: {}, platform }).catch(
			(error) => error,
		);
		expect(error.message).toContain("https://github.com/typst/typst/releases/tag/v0.15.1");
		expect(error.message).not.toMatch(/winget|brew|typst.exe|shims/);
	}
	const error = await resolveTypstExecutable("missing", { env: {}, platform: "linux" }).catch(
		(error) => error,
	);
	expect(error.message).toContain("explicit typstExecutablePath");
	expect(error.message).not.toContain("PRAXITY_STUDIO_TYPST");
	const configuredError = await resolveTypstExecutable(undefined, {
		env: { PRAXITY_STUDIO_TYPST: "missing" },
		platform: "linux",
	}).catch((error) => error);
	expect(configuredError.message).toContain("unset it to search PATH");
});
