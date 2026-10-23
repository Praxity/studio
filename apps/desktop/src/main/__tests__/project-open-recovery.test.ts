import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import {
	interruptProjectWrite,
	projectDiskSnapshot,
} from "../../test-utils/interrupted-project-write";
import { runPraxityCli } from "../cli";
import { CoursePreviewService } from "../course-preview-service";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";
import { createStudioProjectSession } from "../studio/project-session";
import type { StudioServer } from "../studio/server";

const source = "---\ntitle: Recovery\n---\n\n# Original\n\nOriginal body.\n";
const manifest = "id: recovery-course\ntitle: Recovery\nlessons: [lesson.prax]\n";
const roots: string[] = [];
const servers: StudioServer[] = [];
const runtime = {
	appVersion: "0.3.0",
	exportAssetsDir: resolve(import.meta.dirname, "../../../resources/export-assets"),
};

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "project open recovery spaces "));
	roots.push(parent);
	const root = join(parent, "course");
	const editorAssetsDir = join(parent, "editor");
	await mkdir(root);
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "index.html"), "<!doctype html><title>Recovery</title>");
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	await writeFile(join(root, "lesson.prax"), source);
	await writeFile(join(root, "course.yaml"), manifest);
	await persistFixtureIdentity(root);
	return { root, parent, editorAssetsDir };
}

it.each(["lesson.prax", "course.yaml"])(
	"praxity studio recovers a dead writer's %s before discovery and serves the editor snapshot",
	async (target) => {
		const { root, editorAssetsDir } = await fixture();
		await interruptProjectWrite(
			root,
			target,
			target === "lesson.prax" ? `${source}New.\n` : `${manifest}description: New\n`,
		);
		const result = await runPraxityCli(["studio", root, "--no-open"], {
			...runtime,
			editorAssetsDir,
		});
		if (result.studioServer) servers.push(result.studioServer);
		expect(result.exitCode, result.stderr).toBe(0);
		if (!result.studioServer) throw new Error(result.stderr);
		const server = result.studioServer;
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const before = await projectDiskSnapshot(root);
		const response = await fetch(`${server.origin}/api/session`, {
			headers: { Origin: server.origin, Authorization: `Bearer ${token}` },
		});
		expect(response.status).toBe(200);
		expect((await response.json()).result.project.grammar).toBe(source);
		expect(await readFile(join(root, "course.yaml"), "utf8")).toBe(manifest);
		await expect(readFile(join(root, ".praxity-transaction.json"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(await projectDiskSnapshot(root)).toEqual(before);
	},
);

it("inspect and export refuse without writes, name a working recovery command, then succeed", async () => {
	const { root, parent } = await fixture();
	await interruptProjectWrite(root, "lesson.prax", `${source}New.\n`);
	const before = await projectDiskSnapshot(root);
	for (const args of [
		["inspect", root],
		["inspect", root, "--schema", "1"],
		["export", root, "--format", "html", "--output", join(parent, "course.zip")],
	]) {
		const result = await runPraxityCli(args, runtime);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.message).toContain(
			'praxity recovery run "<project-dir>"',
		);
		expect(await projectDiskSnapshot(root)).toEqual(before);
	}
	const recovery = await runPraxityCli(["recovery", "run", root], runtime);
	expect(recovery.exitCode, recovery.stderr).toBe(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
	const recovered = await projectDiskSnapshot(root);
	for (const schema of ["0", "1"]) {
		const result = await runPraxityCli(["inspect", root, "--schema", schema], runtime);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(await projectDiskSnapshot(root)).toEqual(recovered);
	}
	const exported = await runPraxityCli(
		["export", root, "--format", "html", "--output", join(parent, "course.zip")],
		runtime,
	);
	expect(exported.exitCode, exported.stderr).toBe(0);
	expect((await readFile(join(parent, "course.zip"))).length).toBeGreaterThan(0);
	expect(await projectDiskSnapshot(root)).toEqual(recovered);
});

function preview(root: string) {
	return new CoursePreviewService({
		getProjectDir: () => root,
		getExportAssetsDir: () => runtime.exportAssetsDir,
		getWorkspacePath: () => null,
		getFallbackCompletionThreshold: () => 0.8,
		stateStore: { read: () => null, persist: () => true, reset: () => null } as never,
		hostCourseArtifact: async (deployment) => ({
			entryUrl: "http://localhost/preview",
			release: () => deployment.dispose(),
		}),
	});
}

it("CLI recovery refuses corrupt journals and keeps an outside edit during conflict recovery", async () => {
	const { root } = await fixture();
	await writeFile(join(root, ".praxity-transaction.json"), "corrupt journal");
	const corrupt = await projectDiskSnapshot(root);
	const refusal = await runPraxityCli(["recovery", "run", root], runtime);
	const refusalBody = JSON.parse(refusal.stdout);
	expect(refusal.exitCode).toBe(1);
	expect(refusalBody.error.code).toBe("recovery_failed");
	expect(await projectDiskSnapshot(root)).toEqual(corrupt);
	await rm(join(root, ".praxity-transaction.json"));
	await interruptProjectWrite(root, "lesson.prax", `${source}New.\n`);
	await writeFile(join(root, "lesson.prax"), "# Outside edit\n");
	const conflict = await runPraxityCli(["recovery", "run", root], runtime);
	expect(conflict.exitCode).toBe(1);
	expect(conflict.stderr).toMatch(/recovery conflict/i);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Outside edit\n");
	expect((await runPraxityCli(["recovery", "run", root], runtime)).exitCode).toBe(0);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Outside edit\n");
});

it("old-editor preview refuses a pending journal without recovery, then compiles without writes", async () => {
	const { root } = await fixture();
	await interruptProjectWrite(root, "lesson.prax", `${source}New.\n`);
	const before = await projectDiskSnapshot(root);
	const service = preview(root);
	try {
		await expect(service.build()).rejects.toMatchObject({ code: "ERECOVERYREQUIRED" });
		expect(await projectDiskSnapshot(root)).toEqual(before);
		await withProjectFileTransaction(root, async () => {}, "write", false);
		const recovered = await projectDiskSnapshot(root);
		await service.build();
		expect(await projectDiskSnapshot(root)).toEqual(recovered);
	} finally {
		await service.dispose();
	}
});

it("browser snapshot reports an outside edit to retained recovery bytes without marking or changing them", async () => {
	const { root } = await fixture();
	const session = await createStudioProjectSession(root, "test");
	const outside = await open(join(root, "lesson.prax"), "r+");
	try {
		await writeProjectFiles(root, [{ path: "lesson.prax", content: `${source}Saved.\n` }]);
		// An outside editor kept the displaced inode open through the save.
		await outside.writeFile("Outside edit to the retained original.\n");
		const before = await projectDiskSnapshot(root);
		const snapshot = await session.readSnapshot();
		expect(snapshot.project.recoveryArchives?.length).toBeGreaterThan(0);
		expect(snapshot.project.grammar).toBe(`${source}Saved.\n`);
		expect(await projectDiskSnapshot(root)).toEqual(before);
	} finally {
		await outside.close();
		await session.close();
	}
});
