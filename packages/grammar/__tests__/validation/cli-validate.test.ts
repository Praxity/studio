import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PATH = resolve(import.meta.dirname, "../../src/cli/validate.ts");

// Match the package command without spawning a platform-specific shell shim.
const TSX_LOADER = import.meta.resolve("tsx");
const CLI_TEST_TIMEOUT_MS = 20_000;

function runCli(args: string[]) {
	const result = spawnSync(process.execPath, ["--import", TSX_LOADER, CLI_PATH, ...args], {
		encoding: "utf-8",
		timeout: 15_000,
	});
	expect(result.error).toBeUndefined();
	return result;
}

function withTempGrammarFile(source: string): string {
	const directory = mkdtempSync(join(tmpdir(), "grammar validate & spaces-"));
	const filePath = join(directory, "sample.md");
	writeFileSync(filePath, source, "utf-8");
	return filePath;
}

describe("grammar-validate cli", () => {
	it(
		"returns usage error when no file argument is provided",
		() => {
			const result = runCli([]);
			expect(result.status).toBe(2);
			expect(result.stderr).toContain("Usage: grammar-validate <file.md>");
		},
		CLI_TEST_TIMEOUT_MS,
	);

	it(
		"returns success when validation has no blocking errors",
		() => {
			const filePath = withTempGrammarFile(`# Page\n\n![Example](https://example.com/photo.jpg)`);
			const result = runCli([filePath]);
			rmSync(resolve(filePath, ".."), { recursive: true, force: true });

			expect(result.status).toBe(0);
			expect(result.stderr).toContain("OK");
		},
		CLI_TEST_TIMEOUT_MS,
	);

	it(
		"returns failure when validation has error or critical findings",
		() => {
			const filePath = withTempGrammarFile(`# Page\n\n![](https://example.com/photo.jpg)`);
			const result = runCli([filePath]);
			rmSync(resolve(filePath, ".."), { recursive: true, force: true });

			expect(result.status).toBe(1);
			expect(result.stderr).toContain("missing-alt-text");
		},
		CLI_TEST_TIMEOUT_MS,
	);
});
