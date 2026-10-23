import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { withProjectFileTransaction } from "../main/project-file-transactions";
import { interruptProjectWrite } from "./interrupted-project-write";

const roots: string[] = [];
const source = "# Original\n";
let writerRoot: string;
let writerEntry: string;
beforeAll(async () => {
	writerRoot = await mkdtemp(join(tmpdir(), "capture-writer-"));
	writerEntry = join(writerRoot, "writer.mjs");
	await build({
		entryPoints: [
			fileURLToPath(
				new URL("../main/__tests__/fixtures/capture-reader-writer.ts", import.meta.url),
			),
		],
		outfile: writerEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
});
afterAll(async () => {
	if (writerRoot) await rm(writerRoot, { recursive: true, force: true });
});

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "interrupted-project-write-"));
	roots.push(parent);
	const root = join(parent, "course");
	await mkdir(root);
	await writeFile(join(root, "lesson.prax"), source);
	return { parent, root };
}

it.each(["tsx", "bundled"])(
	"captures a %s writer reached through a directory alias and recovers its original bytes",
	async (mode) => {
		const { parent, root } = await fixture();
		const alias = join(parent, "alias");
		await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
		await interruptProjectWrite(
			alias,
			"lesson.prax",
			"# Replacement\n",
			mode === "bundled" ? writerEntry : undefined,
		);
		await expect(readFile(join(root, "lesson.prax"))).rejects.toMatchObject({ code: "ENOENT" });
		await withProjectFileTransaction(alias, async () => {}, "write", false);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
	},
);

it.each(["tsx", "bundled"])(
	"reports exit code, signal and both output streams when a new-file %s writer exits before capture",
	async (mode) => {
		const { root } = await fixture();
		await expect(
			interruptProjectWrite(root, "new.prax", source, mode === "bundled" ? writerEntry : undefined),
		).rejects.toThrow(/Writer exited before capture \(code=0, signal=null\)\nstderr:.*\nstdout:/s);
	},
);

it("reports a missing supplied writer entry instead of using the TSX fallback", async () => {
	const { root } = await fixture();
	await expect(
		interruptProjectWrite(root, "lesson.prax", "# Replacement\n", join(root, "missing.mjs")),
	).rejects.toThrow(/Writer exited before capture \(code=1, signal=null\)/);
});
