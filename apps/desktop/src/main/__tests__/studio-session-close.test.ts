import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import type { CoursePreviewArtifactDescriptor } from "../../shared/bridge";
import { CoursePreviewService } from "../course-preview-service";
import { CoursePreviewStateStore } from "../course-preview-state-store";
import { createStudioProjectSession } from "../studio/project-session";

// Fail at the watcher adapter, after closing the real watcher and its handles.
vi.mock("chokidar", async (importOriginal) => {
	const chokidar = await importOriginal<typeof import("chokidar")>();
	return {
		...chokidar,
		watch: (...args: Parameters<typeof chokidar.watch>) => {
			const watcher = chokidar.watch(...args);
			const close = watcher.close.bind(watcher);
			watcher.close = async () => {
				await close();
				throw new Error("Watcher close failed");
			};
			return watcher;
		},
	};
});

it("project close drains an in-flight canvas build and removes every compiler folder", async () => {
	const root = await mkdtemp(join(tmpdir(), "studio-close-canvas-"));
	const output = await mkdtemp(join(tmpdir(), "studio-close-output-"));
	let entered = () => {};
	let resume = () => {};
	const hosting = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const held = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const preview = new CoursePreviewService({
		getProjectDir: () => root,
		getExportAssetsDir: () =>
			fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
		getWorkspacePath: () => null,
		getFallbackCompletionThreshold: () => 80,
		temporaryRoot: output,
		stateStore: new CoursePreviewStateStore({ get: () => undefined, set: () => {} }),
		hostCourseArtifact: async (deployment) => {
			entered();
			await held;
			return {
				entryUrl: "http://127.0.0.1/preview/index.html",
				release: () => deployment.dispose(),
			};
		},
	});
	try {
		await writeFile(join(root, "lesson.prax"), "# Hello\n\nBody.\n");
		const session = await createStudioProjectSession(root, "test", preview);
		const building = session.invoke("canvasPreviewBuild", {});
		await hosting;
		expect((await readdir(output)).length).toBeGreaterThan(0);
		const closing = session.close().catch((error: unknown) => error);
		resume();
		await building;
		const failure = await closing;
		expect(failure).toMatchObject({
			errors: [expect.objectContaining({ message: "Watcher close failed" })],
		});
		expect(await readdir(output)).toEqual([]);
		expect(preview.canvasHead()).toBeUndefined();
	} finally {
		resume();
		await preview.dispose();
		await rm(root, { recursive: true, force: true });
		await rm(output, { recursive: true, force: true });
	}
});

it("session close releases a real preview after watcher close fails", async () => {
	const root = await mkdtemp(join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "studio-close-"));
	const marker = join(root, "preview-lease");
	const source = "---\ntitle: Test\n---\n\n# Hello\n\nBody.\n";
	const preview = new CoursePreviewService({
		getProjectDir: () => root,
		getExportAssetsDir: () =>
			fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
		getWorkspacePath: () => null,
		getFallbackCompletionThreshold: () => 80,
		stateStore: new CoursePreviewStateStore({ get: () => undefined, set: () => {} }),
		hostCourseArtifact: async (deployment) => {
			await writeFile(marker, "leased");
			return {
				entryUrl: "http://127.0.0.1/preview",
				release: async () => {
					await deployment.dispose();
					await rm(marker);
				},
			};
		},
	});
	try {
		await writeFile(join(root, "lesson.prax"), source);
		const session = await createStudioProjectSession(root, "test", preview);
		const built = (await session.invoke("coursePreviewBuild", {
			request: { scope: "lesson", lessonFilename: "lesson.prax", source },
		})) as CoursePreviewArtifactDescriptor;
		expect(await readFile(marker, "utf8")).toBe("leased");
		const failure = await session.close().catch((error: unknown) => error);
		await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(preview.stateRead(built.leaseId)).rejects.toThrow(
			"Course preview lease is not active",
		);
		expect(failure).toMatchObject({
			errors: [expect.objectContaining({ message: "Watcher close failed" })],
		});
	} finally {
		await preview.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
