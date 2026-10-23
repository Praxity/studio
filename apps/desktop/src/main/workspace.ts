import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, readLesson } from "@praxity/grammar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { WorkspaceConfig, WorkspaceCourse, WorkspaceData } from "../shared/types";
import { assertOutsideProjectLockCache } from "./path-security";
import { withProjectFileTransaction, writeProjectFiles } from "./project-file-transactions";

const SKIP_DIRS = new Set(["shared", ".git", ".praxity", "node_modules"]);

export async function readWorkspaceConfig(dirPath: string): Promise<WorkspaceConfig> {
	return withProjectFileTransaction(dirPath, readWorkspaceConfigSnapshot, "read");
}

async function readWorkspaceConfigSnapshot(dirPath: string): Promise<WorkspaceConfig> {
	const configPath = join(dirPath, "workspace.praxity.yaml");
	try {
		await assertOutsideProjectLockCache(configPath);
		const raw = await readFile(configPath, "utf-8");
		return (parseYaml(raw) as WorkspaceConfig) ?? {};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOCKCACHE") throw error;
		return {};
	}
}

export async function scanWorkspace(dirPath: string): Promise<WorkspaceCourse[]> {
	const entries = await readdir(dirPath, { withFileTypes: true });
	const results = await Promise.all(
		entries.map(async (entry) => {
			if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRS.has(entry.name))
				return null;
			const name = entry.name;
			const projectDir = join(dirPath, name);
			return withProjectFileTransaction(
				projectDir,
				async (root) => {
					try {
						const grammarFile = (await readdir(root)).find((file) => file.endsWith(".prax"));
						if (!grammarFile) return null;
						const grammarPath = join(root, grammarFile);
						const grammarStat = await stat(grammarPath);
						// mtime alone cannot establish freshness after same-size or restored-time writes.
						await assertOutsideProjectLockCache(grammarPath);
						const grammar = await readFile(grammarPath, "utf-8");
						const { frontmatter, body } = parseFrontmatter(grammar);
						const title = typeof frontmatter.title === "string" ? frontmatter.title.trim() : name;
						const pageCount = Math.max(1, readLesson(grammar).pages.length);
						const wordCount = body.split(/\s+/).filter(Boolean).length;

						const info: WorkspaceCourse = {
							name,
							path: projectDir,
							title,
							pageCount,
							estimatedMinutes: Math.ceil(wordCount / 200),
							lastModified: grammarStat.mtime.toISOString(),
						};
						return info;
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
						throw error;
					}
				},
				"read",
			);
		}),
	);

	return results
		.filter((course): course is WorkspaceCourse => course !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadWorkspace(dirPath: string): Promise<WorkspaceData> {
	const config = await readWorkspaceConfig(dirPath);
	const courses = await scanWorkspace(dirPath);
	return { dirPath, config, courses };
}

export async function createWorkspace(dirPath: string, name: string): Promise<WorkspaceData> {
	const config: WorkspaceConfig = {
		name,
		defaultLocale: "en",
	};

	await writeProjectFiles(dirPath, [
		{
			path: "workspace.praxity.yaml",
			content: stringifyYaml(config),
			expectedContent: null,
			head: true,
		},
	]);
	await mkdir(join(dirPath, "shared", "themes"), { recursive: true });
	await mkdir(join(dirPath, "shared", "lexicons"), { recursive: true });
	await mkdir(join(dirPath, "shared", "assets"), { recursive: true });

	const courses = await scanWorkspace(dirPath);
	return { dirPath, config, courses };
}

export async function detectWorkspaceType(
	dirPath: string,
): Promise<"workspace" | "implicit-workspace" | "project" | "empty"> {
	const snapshot = await withProjectFileTransaction(
		dirPath,
		async (root) => {
			const entries = await readdir(root, { withFileTypes: true });
			const type: "workspace" | "project" | undefined = existsSync(
				join(root, "workspace.praxity.yaml"),
			)
				? "workspace"
				: entries.some((entry) => entry.isFile() && entry.name.endsWith(".prax"))
					? "project"
					: undefined;
			return { type, entries };
		},
		"read",
	);
	if (snapshot.type) return snapshot.type;

	let courseCount = 0;
	for (const entry of snapshot.entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) {
			continue;
		}
		const subFiles = await withProjectFileTransaction(
			join(dirPath, entry.name),
			(root) => readdir(root),
			"read",
		);
		if (subFiles.some((file) => file.endsWith(".prax"))) {
			courseCount += 1;
		}
		if (courseCount >= 2) {
			return "implicit-workspace";
		}
	}

	return courseCount === 1 ? "project" : "empty";
}
