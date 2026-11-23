import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	assertViewerAssetsReady: vi.fn(),
	buildCourseExportInput: vi.fn(),
	compileCourse: vi.fn(),
	deployCourse: vi.fn(),
	hostCourseArtifact: vi.fn(),
}));

vi.mock("@praxity/export-pipeline/bundle-viewer", () => ({
	assertViewerAssetsReady: mocks.assertViewerAssetsReady,
}));
vi.mock("@praxity/export-pipeline", () => ({
	compileCourse: mocks.compileCourse,
	deployCourse: mocks.deployCourse,
}));
vi.mock("../export/build-export-input-from-project", async (importOriginal) => ({
	...(await importOriginal<typeof import("../export/build-export-input-from-project")>()),
	buildCourseExportInput: mocks.buildCourseExportInput,
}));

import { CoursePreviewService } from "../course-preview-service";

describe("CoursePreviewService", () => {
	let projectDir: string;
	const stateStore = {
		read: vi.fn().mockReturnValue("saved-state"),
		persist: vi.fn().mockReturnValue(true),
		reset: vi.fn().mockReturnValue("reset-state"),
	};

	beforeEach(async () => {
		projectDir = await mkdtemp(join(tmpdir(), "preview-admission-"));
		vi.clearAllMocks();
		stateStore.read.mockReturnValue("saved-state");
		stateStore.persist.mockReturnValue(true);
		stateStore.reset.mockReturnValue("reset-state");
	});
	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
	});

	it.each(["electron-preview", "standalone"] as const)(
		"owns the %s artifact and hosted deployment for one releasable lease",
		async (format) => {
			const alias = join(projectDir, "alias");
			await symlink(projectDir, alias, "junction");
			const artifact = {
				manifest: {
					courseId: "course-1",
					revision: "a".repeat(64),
					pages: [{ id: "page-1", slug: "welcome" }],
				},
				dispose: vi.fn().mockResolvedValue(undefined),
			};
			const deployment = {
				manifest: { revision: "b".repeat(64) },
				dispose: vi.fn().mockResolvedValue(undefined),
			};
			const entryUrl = `praxity-course://${"c".repeat(32)}/r/${"b".repeat(64)}/index.html`;
			mocks.buildCourseExportInput.mockResolvedValue({ courseId: "course-1" });
			mocks.compileCourse.mockResolvedValue(artifact);
			mocks.deployCourse.mockResolvedValue(deployment);
			mocks.hostCourseArtifact.mockImplementation(async (ownedDeployment) => ({
				entryUrl,
				release: vi.fn(() => ownedDeployment.dispose()),
			}));
			const service = new CoursePreviewService({
				getProjectDir: () => alias,
				getExportAssetsDir: () => "/app/export-assets",
				getWorkspacePath: () => "/project",
				getFallbackCompletionThreshold: () => 0.8,
				stateStore: stateStore as never,
				hostCourseArtifact: mocks.hostCourseArtifact,
			});

			const descriptor = await service.build(undefined, undefined, format);
			const retained = mocks.buildCourseExportInput.mock.calls[0][0].assetInventory;
			const preparation = mocks.buildCourseExportInput.mock.calls[0][0].lessonPreparation;
			expect(retained.projectDir).toBe(await realpath(projectDir));
			expect(preparation.projectDir).toBe(await realpath(projectDir));
			const secondDescriptor = await service.build(undefined, undefined, format);
			expect(mocks.buildCourseExportInput.mock.calls[1][0].assetInventory).toBe(retained);
			expect(mocks.buildCourseExportInput.mock.calls[1][0].lessonPreparation).toBe(preparation);

			expect(mocks.assertViewerAssetsReady).toHaveBeenCalledWith(
				"/app/export-assets",
				format === "standalone" ? "html" : "electron-preview",
			);
			expect(mocks.deployCourse).toHaveBeenCalledWith(artifact, { format });
			expect(stateStore.read).not.toHaveBeenCalled();
			expect(stateStore.persist).not.toHaveBeenCalled();
			expect(stateStore.reset).not.toHaveBeenCalled();
			expect(descriptor).toMatchObject({
				entryUrl,
				courseId: "course-1",
				coreRevision: "a".repeat(64),
				responseRevision: "b".repeat(64),
				pages: [{ id: "page-1", slug: "welcome" }],
			});
			expect(descriptor.leaseId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
			);

			await service.release(descriptor.leaseId);
			expect(deployment.dispose).toHaveBeenCalledOnce();
			expect(artifact.dispose).toHaveBeenCalledOnce();
			await service.release(descriptor.leaseId);
			expect(deployment.dispose).toHaveBeenCalledOnce();
			await service.release(secondDescriptor.leaseId);
		},
	);

	it("disposes the core artifact when deployment or hosting fails", async () => {
		const artifact = {
			manifest: { courseId: "course-1", revision: "a".repeat(64), pages: [] },
			dispose: vi.fn().mockResolvedValue(undefined),
		};
		mocks.buildCourseExportInput.mockResolvedValue({ courseId: "course-1" });
		mocks.compileCourse.mockResolvedValue(artifact);
		mocks.deployCourse.mockRejectedValue(new Error("deployment failed"));
		const service = new CoursePreviewService({
			getProjectDir: () => projectDir,
			getExportAssetsDir: () => "/app/export-assets",
			getWorkspacePath: () => "/project",
			getFallbackCompletionThreshold: () => 0.8,
			stateStore: stateStore as never,
			hostCourseArtifact: mocks.hostCourseArtifact,
		});

		await expect(service.build()).rejects.toThrow("deployment failed");
		expect(artifact.dispose).toHaveBeenCalledOnce();
	});

	it("builds one content-only lesson artifact from the live authoring source", async () => {
		const artifact = {
			manifest: {
				courseId: "course-1",
				revision: "a".repeat(64),
				pages: [
					{ id: "page-1", slug: "welcome" },
					{ id: "page-2", slug: "second" },
					{ id: "page-3", slug: "third" },
				],
			},
			dispose: vi.fn().mockResolvedValue(undefined),
		};
		const deployment = {
			manifest: { revision: "b".repeat(64) },
			dispose: vi.fn().mockResolvedValue(undefined),
		};
		mocks.buildCourseExportInput.mockResolvedValue({
			courseId: "course-1",
			frontmatter: { design: { navArchetype: "slides" } },
			config: { moduleDeck: {} },
		});
		mocks.compileCourse.mockResolvedValue(artifact);
		mocks.deployCourse.mockResolvedValue(deployment);
		mocks.hostCourseArtifact.mockResolvedValue({
			entryUrl: `praxity-course://${"c".repeat(32)}/r/${"b".repeat(64)}/index.html`,
			release: vi.fn().mockResolvedValue(undefined),
		});
		const service = new CoursePreviewService({
			getProjectDir: () => projectDir,
			getExportAssetsDir: () => "/app/export-assets",
			getWorkspacePath: () => "/project",
			getFallbackCompletionThreshold: () => 0.8,
			stateStore: stateStore as never,
			hostCourseArtifact: mocks.hostCourseArtifact,
		});
		const source = "---\nid: lesson-1\n---\n\nUnsaved";

		const descriptor = await service.build({
			scope: "lesson",
			lessonFilename: "lesson-1.prax",
			source,
		});

		expect(descriptor.pages).toEqual([
			{ id: "page-1", slug: "welcome" },
			{ id: "page-2", slug: "welcome" },
			{ id: "page-3", slug: "welcome" },
		]);

		expect(mocks.buildCourseExportInput).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: "lesson",
				lessonFilename: "lesson-1.prax",
				lessonSource: source,
			}),
		);
		expect(mocks.compileCourse).toHaveBeenCalledWith(
			expect.objectContaining({
				frontmatter: { design: { navArchetype: "slides" } },
			}),
			expect.objectContaining({ mode: "desktop" }),
		);
	});

	it("issues revocable writer tokens and routes state by lease identity", async () => {
		const artifact = {
			manifest: { courseId: "course-1", revision: "a".repeat(64), pages: [] },
			dispose: vi.fn().mockResolvedValue(undefined),
		};
		mocks.buildCourseExportInput.mockResolvedValue({ courseId: "course-1" });
		mocks.compileCourse.mockResolvedValue(artifact);
		mocks.deployCourse.mockResolvedValue({ manifest: { revision: "b".repeat(64) } });
		mocks.hostCourseArtifact.mockResolvedValue({
			entryUrl: `praxity-course://${"c".repeat(32)}/r/${"b".repeat(64)}/index.html`,
			release: vi.fn().mockResolvedValue(undefined),
		});
		const service = new CoursePreviewService({
			getProjectDir: () => projectDir,
			getExportAssetsDir: () => "/app/export-assets",
			getWorkspacePath: () => "/project",
			getFallbackCompletionThreshold: () => 0.8,
			stateStore: stateStore as never,
			hostCourseArtifact: mocks.hostCourseArtifact,
		});
		const { leaseId } = await service.build();

		await expect(service.stateRead(leaseId)).resolves.toBe("saved-state");
		expect(stateStore.read).toHaveBeenCalledWith("course-1", "a".repeat(64));
		const active = await service.stateActivate(leaseId);
		expect(active.state).toBe("saved-state");
		expect(active.writerToken).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		const replacement = await service.build();
		const replacementActive = await service.stateActivate(replacement.leaseId);
		await expect(service.statePersist(leaseId, active.writerToken, "late-state")).resolves.toBe(
			false,
		);
		await expect(
			service.statePersist(replacement.leaseId, replacementActive.writerToken, "next-state"),
		).resolves.toBe(true);
		expect(stateStore.persist).toHaveBeenCalledWith("course-1", "next-state");

		await expect(service.stateReset(replacement.leaseId)).resolves.toBe("reset-state");
		const reactivated = await service.stateActivate(replacement.leaseId);
		await service.release(replacement.leaseId);
		await expect(
			service.statePersist(replacement.leaseId, reactivated.writerToken, "late-state"),
		).resolves.toBe(false);
	});
});
