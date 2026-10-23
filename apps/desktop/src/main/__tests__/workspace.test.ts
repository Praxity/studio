import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectLockCacheDirectory } from "../path-security";
import { withProjectFileTransaction } from "../project-file-transactions";
import {
	createWorkspace,
	detectWorkspaceType,
	readWorkspaceConfig,
	scanWorkspace,
} from "../workspace";

for (const filename of ["course.prax", "workspace.praxity.yaml"]) {
	it(`workspace reads refuse private lock-cache aliases, ${filename}`, async () => {
		const parent = await mkdtemp(join(tmpdir(), "workspace-cache-"));
		const root = join(parent, "course");
		await mkdir(root);
		try {
			await withProjectFileTransaction(root, async () => {});
			const cache = projectLockCacheDirectory();
			const entry = (await readdir(cache)).find((name) => name.endsWith(".sqlite"));
			if (!entry) throw new Error("Admission did not create a lock file");
			await symlink(join(cache, entry), join(root, filename), "file");
			await expect(
				filename === "course.prax" ? scanWorkspace(parent) : readWorkspaceConfig(root),
			).rejects.toMatchObject({ code: "ELOCKCACHE" });
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	});
}

it("T1 refuses workspace creation over an authored workspace manifest", async () => {
	const root = await mkdtemp(join(tmpdir(), "workspace-journal-"));
	try {
		const original = "# Authored\r\nname: Original\n";
		await writeFile(join(root, "workspace.praxity.yaml"), original);
		await expect(createWorkspace(root, "New")).rejects.toThrow();
		expect(await readFile(join(root, "workspace.praxity.yaml"), "utf8")).toBe(original);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

describe("scanWorkspace", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "praxity-ws-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it.each(["\n", "\r\n", "\r"])("counts grammar pages after frontmatter, %j", async (eol) => {
		const root = join(tempDir, "pages");
		await mkdir(root);
		await writeFile(
			join(root, "lesson.prax"),
			[
				"---",
				"title: Course",
				"---",
				"",
				"# First",
				"",
				"Text.",
				"",
				"```",
				"--- ignored",
				"# Ignored",
				"```",
				"",
				"# Second",
				"",
				"Text.",
			].join(eol),
		);
		expect(await scanWorkspace(tempDir)).toMatchObject([{ pageCount: 2 }]);
	});

	it("refreshes a same-size write with the previous mtime", async () => {
		const root = join(tempDir, "freshness");
		await mkdir(root);
		const file = join(root, "lesson.prax");
		await writeFile(file, "# One\n\nWords\n");
		const stamp = await stat(file);
		expect(await scanWorkspace(tempDir)).toMatchObject([{ pageCount: 1 }]);
		await writeFile(file, "# One\n\n# Two\n");
		await utimes(file, stamp.atime, stamp.mtime);
		expect(await scanWorkspace(tempDir)).toMatchObject([{ pageCount: 2 }]);
	});

	it("finds course projects with .prax files", async () => {
		await mkdir(join(tempDir, "course-a"));
		await writeFile(
			join(tempDir, "course-a", "course.prax"),
			"---\ntitle: Course A\n---\nHello world content here.",
		);
		await mkdir(join(tempDir, "course-b"));
		await writeFile(join(tempDir, "course-b", "course.prax"), "---\ntitle: Course B\n---\n");

		const courses = await scanWorkspace(tempDir);
		expect(courses).toHaveLength(2);
		expect(courses[0]?.name).toBe("course-a");
		expect(courses[0]?.title).toBe("Course A");
		expect(courses[0]?.pageCount).toBeGreaterThanOrEqual(1);
		expect(courses[1]?.name).toBe("course-b");
	});

	it.each(["\n", "\r\n"])(
		"uses the grammar frontmatter reader for BOM-prefixed lessons, %j",
		async (eol) => {
			await mkdir(join(tempDir, "bom-course"));
			const metadata = Array(201).fill("metadata").join(" ");
			await writeFile(
				join(tempDir, "bom-course", "course.prax"),
				`\uFEFF---${eol}title: "BOM course"${eol}description: ${metadata}${eol}---${eol}One word.${eol}`,
			);
			expect(await scanWorkspace(tempDir)).toMatchObject([
				{ title: "BOM course", estimatedMinutes: 1 },
			]);
		},
	);

	it("skips shared/ and .git directories", async () => {
		await mkdir(join(tempDir, "shared"));
		await writeFile(join(tempDir, "shared", "course.prax"), "---\ntitle: Shared\n---\n");
		await mkdir(join(tempDir, ".git"));

		const courses = await scanWorkspace(tempDir);
		expect(courses).toHaveLength(0);
	});

	it("falls back to folder name when no title in frontmatter", async () => {
		await mkdir(join(tempDir, "my-course"));
		await writeFile(join(tempDir, "my-course", "course.prax"), "Hello world no frontmatter");

		const courses = await scanWorkspace(tempDir);
		expect(courses[0]?.title).toBe("my-course");
	});

	it("calculates estimated reading time", async () => {
		const words = Array(400).fill("word").join(" ");
		await mkdir(join(tempDir, "long-course"));
		await writeFile(join(tempDir, "long-course", "course.prax"), `---\ntitle: Long\n---\n${words}`);

		const courses = await scanWorkspace(tempDir);
		expect(courses[0]?.estimatedMinutes).toBe(2);
	});
});

describe("readWorkspaceConfig", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "praxity-wsconfig-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("reads valid workspace config", async () => {
		await writeFile(
			join(tempDir, "workspace.praxity.yaml"),
			"name: Test Workspace\ndescription: A test\ndefaultLocale: fr\n",
		);

		const config = await readWorkspaceConfig(tempDir);
		expect(config.name).toBe("Test Workspace");
		expect(config.description).toBe("A test");
		expect(config.defaultLocale).toBe("fr");
	});

	it("returns empty config when file is missing", async () => {
		const config = await readWorkspaceConfig(tempDir);
		expect(config).toEqual({});
	});
});

describe("detectWorkspaceType", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "praxity-wsdetect-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("detects explicit workspace", async () => {
		await writeFile(join(tempDir, "workspace.praxity.yaml"), "name: WS");
		expect(await detectWorkspaceType(tempDir)).toBe("workspace");
	});

	it("detects single project", async () => {
		await writeFile(join(tempDir, "course.prax"), "---\ntitle: X\n---\n");
		expect(await detectWorkspaceType(tempDir)).toBe("project");
	});

	it("detects implicit workspace", async () => {
		await mkdir(join(tempDir, "a"));
		await writeFile(join(tempDir, "a", "course.prax"), "");
		await mkdir(join(tempDir, "b"));
		await writeFile(join(tempDir, "b", "course.prax"), "");
		expect(await detectWorkspaceType(tempDir)).toBe("implicit-workspace");
	});

	it("detects empty directory", async () => {
		expect(await detectWorkspaceType(tempDir)).toBe("empty");
	});
});
