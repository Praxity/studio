import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IdentityNode } from "@praxity/content-identity";
import { afterEach, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import { loadIdentityStore } from "../identity-store";

const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const nodes = async (root: string): Promise<Record<string, IdentityNode>> =>
	Object.assign({}, ...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes));

it.each(["en", "fr"])(
	"confirmed rederive preserves restored durable copies, %s",
	async (locale) => {
		const root = await mkdtemp(join(tmpdir(), "identity-equal-count-rederive-"));
		roots.push(root);
		const init = (...flags: string[]) =>
			runPraxityCli(["identity", "init", root, "--lang", locale, ...flags], runtime);
		const base = "# First\n\nRepeated.\n\nOther subject.\n\nRepeated.\n";
		await writeFile(join(root, "course.yaml"), "title: Example\nlessons: [one.prax]\n");
		await writeFile(join(root, "one.prax"), base);
		expect((await init()).exitCode).toBe(0);
		const original = await nodes(root);
		const donors = Object.keys(original)
			.filter((id) => original[id].kind === "block" && original[id].matchText === "Repeated.")
			.sort((a, b) => original[a].span.start - original[b].span.start);
		expect(donors).toHaveLength(2);
		const rewritten = Object.keys(original).find(
			(id) => original[id].kind === "block" && original[id].matchText === "Other subject.",
		);
		if (!rewritten) throw new Error("Missing rewritten block");
		const added = `${base}\nAn added paragraph.\n`;
		await writeFile(join(root, "one.prax"), added);
		const plain = await init();
		expect(plain.exitCode, plain.stderr).toBe(0);
		const withAddition = await nodes(root);
		expect(donors.map((id) => withAddition[id].status)).toEqual(["active", "active"]);
		const missing = "# First\n\nRepeated.\n\nUnrelated replacement.\n\nAn added paragraph.\n";
		await writeFile(join(root, "one.prax"), missing);
		expect((await init()).exitCode).toBe(1);
		const restored = added.replace("Other subject.", "Unrelated replacement.");
		await writeFile(join(root, "one.prax"), restored);
		const refused = await init();
		expect(refused.exitCode).toBe(1);
		const confirmed = await init("--rederive", "--confirm-unpublished");
		expect(confirmed.exitCode, confirmed.stderr).toBe(0);
		expect(JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id)).toEqual([
			rewritten,
		]);
		const stored = await nodes(root);
		expect(donors.map((id) => stored[id].status)).toEqual(["active", "active"]);
		expect(stored[rewritten].status).toBe("retired");
		expect(
			Object.keys(stored)
				.filter(
					(id) =>
						stored[id].kind === "block" &&
						stored[id].matchText === "Repeated." &&
						stored[id].status === "active",
				)
				.sort((a, b) => stored[a].span.start - stored[b].span.start),
		).toEqual(donors);
		expect(Object.values(stored).filter((node) => node.status === "pending")).toEqual([]);
		expect(await readFile(join(root, "one.prax"), "utf8")).toBe(restored);
	},
);
