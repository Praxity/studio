import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { FileTreeNode } from "../shared/types";
import {
	isNestedProjectDirectory,
	isProjectRecoveryPath,
	withProjectFileTransaction,
} from "./project-file-transactions";

const IGNORED_DIRS = new Set([".praxity", ".git", "node_modules", ".DS_Store"]);
type NestedProject = { root: string; node: FileTreeNode };

export async function readProjectTree(projectDir: string): Promise<FileTreeNode[]> {
	return readAdmittedTree(projectDir);
}

async function readAdmittedTree(root: string, displayRoot?: string): Promise<FileTreeNode[]> {
	const nested: NestedProject[] = [];
	const snapshot = await withProjectFileTransaction(
		root,
		async (admittedRoot) => {
			const projectRoot = displayRoot ?? admittedRoot;
			return {
				tree: await readDirectoryRecursive(admittedRoot, projectRoot, nested),
				projectRoot,
			};
		},
		"read",
	);
	// Each nested project owns its journal and lock. Release this admission before
	// entering a child's, then fill the existing tree node to retain its visibility.
	for (const child of nested)
		child.node.children = await readAdmittedTree(child.root, snapshot.projectRoot);
	return snapshot.tree;
}

async function readDirectoryRecursive(
	projectDir: string,
	projectRoot: string,
	nested: NestedProject[],
): Promise<FileTreeNode[]> {
	const entries = await readdir(projectDir, { withFileTypes: true });
	const nodes: FileTreeNode[] = [];
	const topLevel = relative(projectRoot, projectDir) === "";

	for (const entry of entries) {
		if (isProjectRecoveryPath(entry.name)) continue;
		const entryPath = join(projectDir, entry.name);
		if (entry.name.startsWith(".") && (!topLevel || IGNORED_DIRS.has(entry.name))) {
			continue;
		}
		if (entry.isSymbolicLink()) continue;

		if (entry.isDirectory()) {
			const node: FileTreeNode = {
				name: entry.name,
				path: relative(projectRoot, entryPath),
				type: "directory",
				children: [],
				...(topLevel ? { isHidden: entry.name.startsWith(".") } : {}),
			};
			if (await isNestedProjectDirectory(entryPath)) nested.push({ root: entryPath, node });
			else node.children = await readDirectoryRecursive(entryPath, projectRoot, nested);
			nodes.push(node);
			continue;
		}

		const fileStat = await stat(entryPath);
		nodes.push({
			name: entry.name,
			path: relative(projectRoot, entryPath),
			type: "file",
			size: fileStat.size,
			extension: extname(entry.name).slice(1).toLowerCase(),
		});
	}

	return nodes.sort(sortTreeNodes);
}

function sortTreeNodes(a: FileTreeNode, b: FileTreeNode): number {
	if (a.type !== b.type) {
		return a.type === "directory" ? -1 : 1;
	}
	return a.name.localeCompare(b.name);
}
