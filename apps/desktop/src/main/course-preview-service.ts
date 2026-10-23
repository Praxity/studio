import { randomUUID } from "node:crypto";
import path from "node:path";
import {
	type CoursePreviewDeployment,
	type CoursePreviewDeploymentTarget,
	compileCourse,
	deployCourse,
} from "@praxity/export-pipeline";
import { assertViewerAssetsReady } from "@praxity/export-pipeline/bundle-viewer";
import type { CoursePreviewArtifactDescriptor, CoursePreviewBuildRequest } from "../shared/bridge";
import type { CoursePreviewStateStore } from "./course-preview-state-store";
import {
	buildCourseExportInput,
	ProjectLessonPreparation,
} from "./export/build-export-input-from-project";
import { ProjectAssetInventory } from "./export/project-asset-inventory";
import { CourseIdentitySession } from "./identity-store";
import { resolveCompletionSettings } from "./project-config";
import { withProjectFileTransaction } from "./project-file-transactions";

export interface HostedCourseArtifact {
	readonly entryUrl: string;
	release(): Promise<void>;
}

/** Host-only freshness metadata, never part of the learner manifest. */
export type HostedCourseDeployment = CoursePreviewDeployment & {
	editorSeq?: number;
	sourceRevisions?: Record<string, string>;
};

interface PreviewLease {
	courseId: string;
	hosted: HostedCourseArtifact;
	revision: string;
	writerToken?: string;
}

export type CanvasPreviewDescriptor = Omit<CoursePreviewArtifactDescriptor, "leaseId">;

export class CoursePreviewService {
	private readonly leases = new Map<string, PreviewLease>();
	private readonly canvas = new Map<
		string,
		{ start: number; leaseId: string; descriptor: CanvasPreviewDescriptor }
	>();
	private readonly building = new Set<Promise<CoursePreviewArtifactDescriptor>>();
	private canvasStart = 0;
	private closed = false;
	private assetInventory?: ProjectAssetInventory;
	private lessonPreparation?: ProjectLessonPreparation;
	private identitySession?: CourseIdentitySession;

	constructor(
		private readonly options: {
			getProjectDir: () => string | null;
			getExportAssetsDir: () => string;
			getWorkspacePath: (projectDir: string) => string | null;
			getFallbackCompletionThreshold: () => number;
			stateStore: CoursePreviewStateStore;
			hostCourseArtifact: (deployment: HostedCourseDeployment) => Promise<HostedCourseArtifact>;
			inheritWorkspaceSettings?: boolean;
			manifestPolicy?: "read-only";
			temporaryRoot?: string;
		},
	) {}

	build(
		request?: CoursePreviewBuildRequest,
		session?: CourseIdentitySession,
		format: CoursePreviewDeploymentTarget["format"] = "electron-preview",
		editorSeq?: number,
	): Promise<CoursePreviewArtifactDescriptor> {
		return this.buildOwned(request, session, format, editorSeq);
	}

	async buildCanvas(
		session?: CourseIdentitySession,
		editorSeq?: number,
	): Promise<CanvasPreviewDescriptor> {
		const { leaseId: _leaseId, ...descriptor } = await this.buildOwned(
			undefined,
			session,
			"standalone",
			editorSeq,
			++this.canvasStart,
		);
		return descriptor;
	}

	canvasHead(): CanvasPreviewDescriptor | undefined {
		return [...this.canvas.values()].sort((a, b) => b.start - a.start)[0]?.descriptor;
	}

	private buildOwned(
		request: CoursePreviewBuildRequest | undefined,
		session: CourseIdentitySession | undefined,
		format: CoursePreviewDeploymentTarget["format"],
		editorSeq?: number,
		canvasStart?: number,
	) {
		if (this.closed) return Promise.reject(new Error("Course preview service is closed"));
		const task = this.compile(request, session, format, editorSeq, canvasStart);
		this.building.add(task);
		void task.then(
			() => this.building.delete(task),
			() => this.building.delete(task),
		);
		return task;
	}

	private async compile(
		request: CoursePreviewBuildRequest | undefined,
		session: CourseIdentitySession | undefined,
		format: CoursePreviewDeploymentTarget["format"],
		editorSeq?: number,
		canvasStart?: number,
	): Promise<CoursePreviewArtifactDescriptor> {
		const projectDir = this.options.getProjectDir();
		if (!projectDir) throw new Error("No project is currently open.");
		const exportAssetsDir = this.options.getExportAssetsDir();
		await assertViewerAssetsReady(exportAssetsDir, format === "standalone" ? "html" : format);
		const workspacePath = this.options.getWorkspacePath(projectDir);
		const input = await withProjectFileTransaction(
			projectDir,
			async (root) => {
				if (session) this.identitySession = session;
				else if (this.identitySession?.projectDir !== root)
					this.identitySession = new CourseIdentitySession(root);
				if (this.assetInventory?.projectDir !== root)
					this.assetInventory = new ProjectAssetInventory(root);
				if (this.lessonPreparation?.projectDir !== root)
					this.lessonPreparation = new ProjectLessonPreparation(root);
				const assetInventory = this.assetInventory;
				return buildCourseExportInput({
					identitySession: this.identitySession,
					mode: "preview",
					assetInventory,
					lessonPreparation: this.lessonPreparation,
					projectDir: root,
					...(await resolveCompletionSettings({
						projectDir: root,
						fallbackCompletionThreshold: this.options.getFallbackCompletionThreshold(),
					})),
					viewerVersionPath: path.join(exportAssetsDir, "viewer.version.json"),
					workspacePath,
					inheritWorkspaceSettings: this.options.inheritWorkspaceSettings,
					manifestPolicy: "read-only",
					scope: request ? "lesson" : "course",
					...(request
						? { lessonFilename: request.lessonFilename, lessonSource: request.source }
						: {}),
				});
			},
			"read",
		);
		const artifact = await compileCourse(input, {
			mode: "desktop",
			prebuiltAssetsDir: exportAssetsDir,
			projectDir,
			temporaryRoot: this.options.temporaryRoot,
		});
		try {
			const deployment = await deployCourse(artifact, { format });
			const hosted = await this.options.hostCourseArtifact({
				...deployment,
				editorSeq,
				sourceRevisions: input.sourceRevisions,
				dispose: async () => {
					try {
						await deployment.dispose();
					} finally {
						await artifact.dispose();
					}
				},
			});
			const leaseId = randomUUID();
			this.leases.set(leaseId, {
				courseId: artifact.manifest.courseId,
				hosted,
				revision: artifact.manifest.revision,
			});
			const descriptor = {
				warnings: input.warnings,
				leaseId,
				entryUrl: hosted.entryUrl,
				courseId: artifact.manifest.courseId,
				coreRevision: artifact.manifest.revision,
				responseRevision: deployment.manifest.revision,
				// Guided slides share the lesson's first HTML document. Small previews
				// select a slide by its ID fragment instead of loading redirect aliases.
				pages: artifact.manifest.pages.map(({ id, slug }) => ({
					id,
					slug: request && input.config.moduleDeck ? artifact.manifest.pages[0].slug : slug,
				})),
			};
			if (canvasStart !== undefined) {
				const key = hosted.entryUrl;
				const existing = this.canvas.get(key);
				if (existing) {
					existing.start = Math.max(existing.start, canvasStart);
					await this.release(leaseId);
				} else {
					const { leaseId: _leaseId, ...canvasDescriptor } = descriptor;
					this.canvas.set(key, { start: canvasStart, leaseId, descriptor: canvasDescriptor });
				}
				// Hosting owns the build even if the requester never receives its reply.
				const oldest = [...this.canvas.entries()].sort((a, b) => a[1].start - b[1].start);
				for (const [key, entry] of oldest.slice(0, Math.max(0, oldest.length - 4))) {
					this.canvas.delete(key);
					await this.release(entry.leaseId);
				}
			}
			return descriptor;
		} catch (error) {
			await artifact.dispose();
			throw error;
		}
	}

	invalidateAssets(file?: string): void {
		this.assetInventory?.invalidate(file);
		if (file === undefined) {
			this.identitySession?.invalidate();
			this.lessonPreparation?.invalidate();
		}
	}

	async stateRead(leaseId: string): Promise<string> {
		const lease = this.requireLease(leaseId);
		return this.options.stateStore.read(lease.courseId, lease.revision);
	}

	async stateActivate(leaseId: string): Promise<{ state: string; writerToken: string }> {
		const lease = this.requireLease(leaseId);
		for (const candidate of this.leases.values()) {
			if (candidate.courseId === lease.courseId) candidate.writerToken = undefined;
		}
		const writerToken = randomUUID();
		lease.writerToken = writerToken;
		return {
			state: this.options.stateStore.read(lease.courseId, lease.revision),
			writerToken,
		};
	}

	async statePersist(leaseId: string, writerToken: string, state: string): Promise<boolean> {
		const lease = this.leases.get(leaseId);
		if (!lease || lease.writerToken !== writerToken) return false;
		return this.options.stateStore.persist(lease.courseId, state);
	}

	async stateReset(leaseId: string): Promise<string> {
		const lease = this.requireLease(leaseId);
		for (const candidate of this.leases.values()) {
			if (candidate.courseId === lease.courseId) candidate.writerToken = undefined;
		}
		return this.options.stateStore.reset(lease.courseId, lease.revision);
	}

	async release(leaseId: string): Promise<void> {
		const lease = this.leases.get(leaseId);
		if (!lease) return;
		this.leases.delete(leaseId);
		await lease.hosted.release();
	}

	async dispose(): Promise<void> {
		this.closed = true;
		await Promise.allSettled([...this.building]);
		this.canvas.clear();
		this.assetInventory = undefined;
		this.lessonPreparation?.invalidate();
		this.lessonPreparation = undefined;
		this.identitySession?.invalidate();
		this.identitySession = undefined;
		await Promise.all([...this.leases.keys()].map((leaseId) => this.release(leaseId)));
	}

	private requireLease(leaseId: string): PreviewLease {
		const lease = this.leases.get(leaseId);
		if (!lease) throw new Error("Course preview lease is not active");
		return lease;
	}
}
