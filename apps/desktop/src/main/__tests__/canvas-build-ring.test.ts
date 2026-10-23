import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const adapters = vi.hoisted(() => ({ input: vi.fn(), compile: vi.fn(), deploy: vi.fn() }));
vi.mock("@praxity/export-pipeline/bundle-viewer", () => ({
	assertViewerAssetsReady: async () => {},
}));
vi.mock("@praxity/export-pipeline", () => ({
	compileCourse: adapters.compile,
	deployCourse: adapters.deploy,
}));
vi.mock("../export/build-export-input-from-project", async (original) => ({
	...(await original<typeof import("../export/build-export-input-from-project")>()),
	buildCourseExportInput: adapters.input,
}));

import { CoursePreviewService } from "../course-preview-service";

let root: string;
let service: CoursePreviewService;
let revision: number;
const hosted = new Set<number>();
const released: number[] = [];
let hold: ((revision: number) => Promise<void>) | undefined;
beforeEach(async () => {
	root = await mkdtemp(join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "canvas-ring-"));
	revision = 0;
	hosted.clear();
	released.length = 0;
	hold = undefined;
	adapters.input.mockImplementation(async () => ({ revision, courseId: "course" }));
	adapters.compile.mockImplementation(async (input) => ({
		manifest: {
			courseId: "course",
			revision: String(input.revision),
			pages: [{ id: "page", slug: "page" }],
		},
		dispose: async () => {},
	}));
	adapters.deploy.mockImplementation(async (artifact) => ({
		...artifact,
		manifest: artifact.manifest,
	}));
	service = new CoursePreviewService({
		getProjectDir: () => root,
		getExportAssetsDir: () => root,
		getWorkspacePath: () => null,
		getFallbackCompletionThreshold: () => 80,
		stateStore: {} as never,
		hostCourseArtifact: async (deployment) => {
			const id = Number(deployment.manifest.revision);
			await hold?.(id);
			hosted.add(id);
			return {
				entryUrl: `http://127.0.0.1/preview/${id}/index.html`,
				release: async () => {
					released.push(id);
					hosted.delete(id);
				},
			};
		},
	});
});
afterEach(async () => {
	vi.useRealTimers();
	await service.dispose();
	await rm(root, { recursive: true, force: true });
});

it("owns abandoned replies immediately and bounds fifty saves to the newest four revisions", async () => {
	for (revision = 0; revision < 50; revision++) {
		const descriptor = await service.buildCanvas();
		expect(descriptor).not.toHaveProperty("leaseId");
		expect([...hosted]).toEqual(
			Array.from({ length: Math.min(4, revision + 1) }, (_, i) => Math.max(0, revision - 3) + i),
		);
		expect(service.canvasHead()?.entryUrl).toBe(`http://127.0.0.1/preview/${revision}/index.html`);
	}
	expect(released).toHaveLength(46);
	await service.dispose();
	expect(hosted.size).toBe(0);
});

it("keeps the current head for 24 idle hours without any author session", async () => {
	vi.useFakeTimers();
	await service.buildCanvas();
	await vi.advanceTimersByTimeAsync(86_400_000);
	expect([...hosted]).toEqual([0]);
	expect(released).toEqual([]);
});

it("deduplicates unchanged launches without releasing their last reference", async () => {
	// This adapter counts independent handles, as the real host does for identical files.
	const handles: number[] = [];
	const release = vi.fn(async () => {
		handles.pop();
	});
	const deduped = new CoursePreviewService({
		getProjectDir: () => root,
		getExportAssetsDir: () => root,
		getWorkspacePath: () => null,
		getFallbackCompletionThreshold: () => 80,
		stateStore: {} as never,
		hostCourseArtifact: async () => {
			handles.push(0);
			return { entryUrl: "http://127.0.0.1/0/index.html", release };
		},
	});
	try {
		for (let i = 0; i < 9; i++) await deduped.buildCanvas();
		expect(handles).toEqual([0]);
		expect(release).toHaveBeenCalledTimes(8);
	} finally {
		await deduped.dispose();
	}
	expect(handles).toEqual([]);
});

it("refuses both build interfaces after project close without hosting more files", async () => {
	await service.buildCanvas();
	await service.dispose();
	await expect(service.buildCanvas()).rejects.toThrow("Course preview service is closed");
	await expect(service.build()).rejects.toThrow("Course preview service is closed");
	expect(hosted.size).toBe(0);
	expect(released).toEqual([0]);
});

it("keeps the old head until hosting succeeds and orders overlapping builds by start", async () => {
	await service.buildCanvas();
	let resume = () => {};
	let entered = () => {};
	const entering = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const barrier = new Promise<void>((resolve) => {
		resume = resolve;
	});
	hold = async (id) => {
		if (id === 1) {
			entered();
			await barrier;
		}
	};
	revision = 1;
	const slow = service.buildCanvas();
	await entering;
	try {
		expect([...hosted]).toEqual([0]);
		for (revision = 2; revision <= 5; revision++) await service.buildCanvas();
	} finally {
		resume();
		await slow;
	}
	expect([...hosted]).toEqual([2, 3, 4, 5]);
	expect(service.canvasHead()?.entryUrl).toBe("http://127.0.0.1/preview/5/index.html");
});

it("registers a reply after a ten second client deadline and drains it on project close", async () => {
	let resume = () => {};
	let entered = () => {};
	const entering = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const barrier = new Promise<void>((resolve) => {
		resume = resolve;
	});
	hold = async () => {
		entered();
		await barrier;
	};
	const building = service.buildCanvas();
	await entering;
	vi.useFakeTimers();
	await vi.advanceTimersByTimeAsync(10_001);
	resume();
	await building;
	expect([...hosted]).toEqual([0]);
});
