import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { NARRATION_SIDECAR_PATH } from "../../shared/narration-sidecar";
import {
	buildCourseExportInput,
	buildExportInputFromProject,
} from "../export/build-export-input-from-project";
import { resolvePdfAssets } from "../export/resolve-pdf-assets";
import { projectLockCacheDirectory } from "../path-security";
import { resolveCompletionSettings } from "../project-config";
import { withProjectFileTransaction } from "../project-file-transactions";

const roots: string[] = [];
async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "export-root-"));
	roots.push(parent);
	const root = join(parent, "course");
	const outside = join(parent, "outside");
	await Promise.all([mkdir(root), mkdir(outside)]);
	await writeFile(join(root, "course.yaml"), "title: Bounded course\nlessons:\n  - lesson.prax\n");
	await writeFile(join(root, "lesson.prax"), "---\ntitle: Lesson\n---\n\n# Hello\n");
	const runtime = join(outside, "viewer.version.json");
	await writeFile(runtime, '{"viewerSourceHash":"trusted-runtime"}');
	return {
		root,
		outside,
		options: {
			manifestPolicy: "write" as const,
			projectDir: root,
			completionThreshold: 0.8,
			viewerVersionPath: runtime,
		},
	};
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("refuses inherited workspace settings aliased into the private lock cache", async () => {
	const { root, options } = await fixture();
	await withProjectFileTransaction(root, async () => {});
	const cache = projectLockCacheDirectory();
	const entry = (await readdir(cache)).find((name) => name.endsWith(".sqlite"));
	if (!entry) throw new Error("Admission did not create a lock file");
	await symlink(join(cache, entry), join(root, "..", "workspace.praxity.yaml"), "file");
	await expect(buildCourseExportInput(options)).rejects.toMatchObject({ code: "ELOCKCACHE" });
});

it.each(["lesson", "course"] as const)(
	"rejects an escaping assets directory for %s input",
	async (scope) => {
		const { root, outside, options } = await fixture();
		await writeFile(join(outside, "marker.txt"), "outside marker");
		await symlink(outside, join(root, "assets"), "junction");
		await expect(buildCourseExportInput({ ...options, scope })).rejects.toThrow(
			"Path traversal blocked",
		);
	},
);

it.each(["file", "directory"] as const)("rejects an escaping asset %s symlink", async (kind) => {
	const { root, outside, options } = await fixture();
	await mkdir(join(root, "assets"));
	await writeFile(join(outside, "marker.txt"), "outside marker");
	await symlink(
		kind === "file" ? join(outside, "marker.txt") : outside,
		join(root, "assets", "escape"),
		kind === "file" ? "file" : "junction",
	);
	await expect(buildExportInputFromProject(options)).rejects.toThrow("Path traversal blocked");
});

it.each(["assets", NARRATION_SIDECAR_PATH, "praxity.json"])(
	"rejects a dangling escaping %s link rather than treating it as absent",
	async (filename) => {
		const { root, outside, options } = await fixture();
		await mkdir(join(root, ".praxity"), { recursive: true });
		await symlink(
			join(outside, "missing"),
			join(root, filename),
			filename === "assets" ? "junction" : "file",
		);
		if (filename === "praxity.json")
			await expect(
				resolveCompletionSettings({ projectDir: root, fallbackCompletionThreshold: 0.8 }),
			).rejects.toThrow();
		else await expect(buildCourseExportInput(options)).rejects.toThrow();
	},
);

it.each(["course.yaml", NARRATION_SIDECAR_PATH, "lesson.prax"])(
	"rejects an escaping %s sidecar/source",
	async (filename) => {
		const { root, outside, options } = await fixture();
		await mkdir(join(root, ".praxity"), { recursive: true });
		const target = join(outside, "source.txt");
		await writeFile(
			target,
			filename === "course.yaml" ? "id: outside\nlessons:\n  - lesson.prax\n" : "outside source",
		);
		await rm(join(root, filename), { force: true });
		await symlink(target, join(root, filename));
		if (filename === NARRATION_SIDECAR_PATH) {
			const refusal = {
				code: "EIDENTITY",
				messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: filename } },
			};
			await expect(buildCourseExportInput(options)).rejects.toMatchObject(refusal);
			await expect(
				buildCourseExportInput({ ...options, loadAssets: false, preparePdf: true }),
			).rejects.toMatchObject(refusal);
		} else await expect(buildCourseExportInput(options)).rejects.toThrow("Path traversal blocked");
		expect(await readFile(target, "utf8")).toContain("outside");
	},
);

it("rejects an escaping project config instead of applying export defaults", async () => {
	const { root, outside } = await fixture();
	await writeFile(join(outside, "config.json"), "{}");
	await symlink(join(outside, "config.json"), join(root, "praxity.json"));
	await expect(
		resolveCompletionSettings({ projectDir: root, fallbackCompletionThreshold: 0.8 }),
	).rejects.toThrow("Path traversal blocked");
});

it("allows missing assets and trusted runtime files outside the project", async () => {
	const { options } = await fixture();
	const input = await buildCourseExportInput(options);
	expect(input.resolvedAssets.size).toBe(0);
	expect(input.viewerVersion).toBe("trusted-runtime");
});

it("keeps internal asset symlinks readable and rejects cyclic directory links", async () => {
	const { root, options } = await fixture();
	await mkdir(join(root, "assets"));
	await writeFile(join(root, "assets", "original.txt"), "inside");
	await symlink(join(root, "assets", "original.txt"), join(root, "assets", "alias.txt"));
	const input = await buildCourseExportInput(options);
	expect(Buffer.from(input.resolvedAssets.get("assets/alias.txt") ?? []).toString()).toBe("inside");
	await symlink(join(root, "assets"), join(root, "assets", "cycle"), "junction");
	await expect(buildCourseExportInput(options)).rejects.toThrow("Cyclic asset directory");
});

it("does not inherit an ancestor workspace when explicitly disabled", async () => {
	const { root, options } = await fixture();
	await writeFile(join(root, "..", "workspace.praxity.yaml"), "defaultLocale: fr\n");
	expect((await buildCourseExportInput(options)).locale).toBe("fr");
	// The server supplies this trusted option; null alone preserves desktop behavior.
	expect(
		(
			await buildCourseExportInput({
				...options,
				workspacePath: null,
				inheritWorkspaceSettings: false,
			})
		).locale,
	).toBe("en");
});

it("rejects an escaping PDF image", async () => {
	const { root, outside } = await fixture();
	await mkdir(join(root, "assets"));
	await writeFile(join(outside, "image.png"), "outside image");
	await symlink(join(outside, "image.png"), join(root, "assets", "image.png"));
	await expect(
		resolvePdfAssets(
			root,
			[
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{ id: "image", type: "image", data: { src: "assets/image.png", alt: "Outside" } },
					],
				},
			],
			false,
		),
	).rejects.toThrow("Path traversal blocked");
});
