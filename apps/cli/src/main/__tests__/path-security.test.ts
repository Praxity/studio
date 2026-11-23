import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	createFileWithin,
	readFileWithin,
	resolveWritablePathWithin,
	sha256FileWithin,
	writeFileAtomicallyWithin,
	writeFileWithin,
} from "../path-security";
import { withProjectFileTransaction } from "../project-file-transactions";

describe("project path security", () => {
	it("refuses cache-overlapping roots even before the cache exists and guards raw file operations", async () => {
		const home = await mkdtemp(join(tmpdir(), "private-lock-home-"));
		vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", home);
		try {
			await expect(withProjectFileTransaction(home, async () => "admitted")).rejects.toThrow(
				/private lock cache/i,
			);
			const cache = join(home, ".praxity-studio", "project-locks");
			await mkdir(cache, { recursive: true });
			const target = join(cache, "lock.sqlite");
			await writeFile(target, "PRIVATE");
			for (const root of [home, join(home, ".praxity-studio"), cache]) {
				await expect(withProjectFileTransaction(root, async () => "admitted")).rejects.toThrow(
					/private lock cache/i,
				);
			}
			await expect(readFileWithin(home, target, "utf8")).rejects.toThrow(/private lock cache/i);
			await expect(sha256FileWithin(home, target)).rejects.toThrow(/private lock cache/i);
			await expect(writeFileWithin(home, target, "bad")).rejects.toThrow(/private lock cache/i);
			await expect(createFileWithin(home, join(cache, "new.sqlite"), "bad")).rejects.toThrow(
				/private lock cache/i,
			);
			await expect(resolveWritablePathWithin(home, target)).rejects.toThrow(/private lock cache/i);
			const alias = join(home, "alias");
			await symlink(cache, alias, process.platform === "win32" ? "junction" : "dir");
			await expect(readFileWithin(home, join(alias, "lock.sqlite"), "utf8")).rejects.toThrow(
				/private lock cache/i,
			);
			await expect(withProjectFileTransaction(alias, async () => "admitted")).rejects.toThrow(
				/private lock cache/i,
			);
			expect(await readFile(target, "utf8")).toBe("PRIVATE");
			const project = join(home, "ordinary-project");
			await mkdir(project);
			await expect(withProjectFileTransaction(project, async () => "admitted")).resolves.toBe(
				"admitted",
			);
		} finally {
			vi.unstubAllEnvs();
			await rm(home, { recursive: true, force: true });
		}
	});
	it("blocks reads and writes through symlinks that escape the project", async () => {
		const temp = await mkdtemp(join(tmpdir(), "praxity-path-"));
		const project = join(temp, "project");
		const outside = join(temp, "outside");
		await Promise.all([mkdir(project), mkdir(outside)]);
		await writeFile(join(outside, "secret.txt"), "secret");
		await symlink(outside, join(project, "escape"));

		await expect(
			readFileWithin(project, join(project, "escape", "secret.txt"), "utf-8"),
		).rejects.toThrow("Path traversal blocked");
		await expect(sha256FileWithin(project, join(project, "escape", "secret.txt"))).rejects.toThrow(
			"Path traversal blocked",
		);
		await expect(
			writeFileWithin(project, join(project, "escape", "new.txt"), "bad"),
		).rejects.toThrow("Path traversal blocked");
		expect(await readFile(join(outside, "secret.txt"), "utf-8")).toBe("secret");
	});

	it("hashes every chunk and observes a replacement at the same path", async () => {
		const project = await mkdtemp(join(tmpdir(), "praxity-hash-"));
		try {
			await expect(sha256FileWithin(project, project)).rejects.toThrow();
			const target = join(project, "media.bin");
			const bytes = Buffer.alloc(200_000, "a");
			bytes[bytes.length - 1] = 98;
			await writeFile(target, bytes);
			expect(await sha256FileWithin(project, target)).toBe(
				createHash("sha256").update(bytes).digest("hex"),
			);
			await writeFile(target, "");
			expect(await sha256FileWithin(project, target)).toBe(
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			);
		} finally {
			await rm(project, { recursive: true, force: true });
		}
	});
});

it.runIf(process.platform === "win32")(
	"non-durable atomic callers retain the raw Windows sharing error",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "praxity-atomic-sharing-"));
		const target = join(root, "settings.json");
		await writeFile(target, "Original settings");
		const held = await open(target, "r");
		try {
			await expect(
				writeFileAtomicallyWithin(root, target, Buffer.from("New settings")),
			).rejects.toMatchObject({ code: "EPERM" });
			expect(await readFile(target, "utf8")).toBe("Original settings");
		} finally {
			await held.close();
			await rm(root, { recursive: true, force: true });
		}
	},
);
