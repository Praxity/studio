import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serializeNarrationSidecarV2 } from "../../shared/narration-sidecar";
import { narrationFixture } from "../../test-utils/narration-fixture";
import { exportProject } from "../export/export-project";
import { ProjectAssetInventory } from "../export/project-asset-inventory";

const { exportCoursePdf } = vi.hoisted(() => ({ exportCoursePdf: vi.fn() }));

// Keep project admission, input preparation and publication validation real.
// Only native compilation and the web viewer installation prerequisite are replaced.
vi.mock("@praxity/format-renderers/pipelines/course-pdf", async (importOriginal) => ({
	...(await importOriginal<typeof import("@praxity/format-renderers/pipelines/course-pdf")>()),
	exportCoursePdf,
}));
vi.mock("@praxity/export-pipeline/bundle-viewer", () => ({
	assertViewerAssetsReady: vi.fn(),
}));

let projectDir: string;
beforeEach(async () => {
	projectDir = await mkdtemp(path.join(os.tmpdir(), "pdf-narration-"));
	await mkdir(path.join(projectDir, "assets"));
	await writeFile(
		path.join(projectDir, "course.yaml"),
		"title: Narrated course\nlocale: en\nnarrationEnabled: true\nlessons: [lesson.prax]\n",
	);
	await writeFile(path.join(projectDir, "lesson.prax"), "# Welcome\n\nHello world\n");
	const fixture = await narrationFixture(projectDir, "lesson.prax");
	const item = fixture.items.find((candidate) => candidate.segment.label === "Hello world");
	if (!item) throw new Error("Missing narration fixture target");
	const sidecar = fixture.update(item.segment.target, {
		audio: "assets/voice.mp3",
		timings: "assets/voice.json",
		reviewedRevision: item.segment.revision,
	});
	await writeFile(path.join(projectDir, "narration.yaml"), serializeNarrationSidecarV2(sidecar));
	await writeFile(path.join(projectDir, "assets/voice.mp3"), "Synthetic audio bytes");
	await writeFile(path.join(projectDir, "assets/voice.json"), "[]");
	exportCoursePdf.mockResolvedValue({ pdf: Buffer.from("%PDF synthetic"), diagnostics: [] });
});

afterEach(async () => {
	await rm(projectDir, { recursive: true, force: true });
});

function options() {
	return {
		manifestPolicy: "write" as const,
		projectDir,
		exportAssetsDir: path.join(projectDir, "unused-export-assets"),
		scope: "course" as const,
		inheritWorkspaceSettings: false,
		fallbackCompletionThreshold: 0.8,
		enforceAccessibility: true,
	};
}

it.each(["course", "lesson"] as const)(
	"exports a narrated %s PDF without loading audio or timing bytes",
	async (scope) => {
		const readAssets = vi.spyOn(ProjectAssetInventory.prototype, "read");
		const result = await exportProject({
			...options(),
			scope,
			lessonFilename: "lesson.prax",
			format: "pdf",
		});
		expect(result.pdf.toString()).toBe("%PDF synthetic");
		expect(result.pageCount).toBe(1);
		expect(readAssets).not.toHaveBeenCalled();
		expect(exportCoursePdf).toHaveBeenCalledWith(
			expect.objectContaining({ resolvedAssets: new Map() }),
		);
	},
);

it.each(["html", "scorm-1.2", "pdf"] as const)(
	"still refuses a genuinely missing narration file for %s",
	async (format) => {
		await rm(path.join(projectDir, "assets/voice.mp3"));
		await expect(exportProject({ ...options(), format })).rejects.toThrow(
			/^Missing narration asset: assets\/voice\.mp3$/,
		);
		expect(exportCoursePdf).not.toHaveBeenCalled();
	},
);

it("still refuses a missing PDF image before native compilation", async () => {
	await writeFile(
		path.join(projectDir, "lesson.prax"),
		"# Welcome\n\nHello world\n\n![A diagram](assets/missing.png)\n",
	);
	await expect(exportProject({ ...options(), format: "pdf" })).rejects.toMatchObject({
		code: "export_failed",
		cause: expect.objectContaining({ code: "ENOENT" }),
	});
	expect(exportCoursePdf).not.toHaveBeenCalled();
});

it("still refuses a missing brand logo during PDF publication validation", async () => {
	await writeFile(
		path.join(projectDir, "course.yaml"),
		"title: Narrated course\nlocale: en\nnarrationEnabled: true\nlessons: [lesson.prax]\ndesign:\n  brand:\n    logoUrl: assets/missing-logo.png\n",
	);
	await expect(exportProject({ ...options(), format: "pdf" })).rejects.toThrow(
		"Missing local brand logo asset: assets/missing-logo.png",
	);
	expect(exportCoursePdf).not.toHaveBeenCalled();
});
