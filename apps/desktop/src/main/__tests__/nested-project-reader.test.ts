import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import type { FileTreeNode } from "../../shared/types";
import { readProjectTree } from "../project-tree";
import { createStudioProjectSession, type StudioEvent } from "../studio/project-session";

const source = "---\nid: reader\ntitle: Saved\n---\n\n# First\n\nAuthored bytes.\n";

it.each(["lesson.prax", "course.yaml"])(
	"parent tree and browser watcher wait for a nested %s capture in another process",
	async (target) => {
		const root = await mkdtemp(join(tmpdir(), "nested-project-reader-"));
		const nested = join(root, "folder", "nested");
		await mkdir(nested, { recursive: true });
		await writeFile(join(root, "course.prax"), source);
		await writeFile(join(root, "course.yaml"), "id: parent\nlessons: [course.prax]\n");
		await writeFile(join(nested, "lesson.prax"), source);
		await writeFile(join(nested, "course.yaml"), "id: child\nlessons: [lesson.prax]\n");
		const session = await createStudioProjectSession(root, "test");
		const events: StudioEvent[] = [];
		session.subscribe((event) => events.push(event));
		const content =
			target === "lesson.prax"
				? `${source}\nSaved.\n`
				: "id: child\nlessons: [lesson.prax]\ntitle: Saved\n";
		const child = fork(
			fileURLToPath(new URL("./fixtures/capture-reader-writer.ts", import.meta.url)),
			[nested, target, content],
			{ execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
		);
		let errors = "";
		child.stderr?.on("data", (chunk) => {
			errors += chunk;
		});
		const exited = once(child, "exit");
		let tree: Promise<FileTreeNode[]> | undefined;
		let browserTree: Promise<unknown> | undefined;
		try {
			const [message] = await Promise.race([
				once(child, "message"),
				exited.then(() => {
					throw new Error(`Writer exited before capture: ${errors}`);
				}),
			]);
			expect(message).toEqual({ captured: true });
			let settled = false;
			tree = readProjectTree(root).finally(() => {
				settled = true;
			});
			// Attach a handler immediately, retaining any rejection for the final assertion.
			void tree.catch(() => {});
			let browserSettled = false;
			browserTree = session.invoke("projectReadTree", {}).finally(() => {
				browserSettled = true;
			});
			void browserTree.catch(() => {});
			await delay(700);
			expect(settled, "Parent tree returned while the nested target was absent").toBe(false);
			expect(browserSettled, "Browser tree returned while the nested target was absent").toBe(
				false,
			);
			expect(events.filter((event) => event.type === "treeChanged")).toEqual([]);
		} finally {
			if (child.connected) child.send("release");
			await exited;
			try {
				if (tree) await tree;
				if (browserTree) await browserTree;
				await vi.waitFor(() =>
					expect(events.some((event) => event.type === "treeChanged")).toBe(true),
				);
			} finally {
				await session.close();
				await rm(root, { recursive: true, force: true });
			}
		}
		expect(child.exitCode, errors).toBe(0);
		const expectedNested = expect.objectContaining({
			name: "nested",
			children: expect.arrayContaining([
				expect.objectContaining({
					name: "lesson.prax",
					path: join("folder", "nested", "lesson.prax"),
				}),
				expect.objectContaining({ name: "course.yaml" }),
			]),
		});
		const expectTree = (nodes: FileTreeNode[]) => {
			expect(nodes.find((node) => node.name === "folder")?.children).toEqual(
				expect.arrayContaining([expectedNested]),
			);
		};
		if (!tree) throw new Error("Tree read did not start");
		expectTree(await tree);
		expectTree((await browserTree) as FileTreeNode[]);
		const published = events.filter((event) => event.type === "treeChanged");
		expect(published.length).toBeGreaterThan(0);
		for (const event of published) expectTree(event.tree);
	},
	20_000,
);
