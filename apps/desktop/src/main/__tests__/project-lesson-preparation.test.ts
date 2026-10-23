import { mkdir, mkdtemp, readFile, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serializeIdentity } from "@praxity/content-identity";
import { compilePage, createCourseContext } from "@praxity/export-pipeline";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serializeNarrationSidecarV2 } from "../../shared/narration-sidecar";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { narrationFixture } from "../../test-utils/narration-fixture";
import {
	type BuildCourseExportInputOptions,
	buildCourseExportInput,
	ProjectLessonPreparation,
} from "../export/build-export-input-from-project";
import { ProjectAssetInventory } from "../export/project-asset-inventory";
import { CourseIdentitySession, loadIdentityStore } from "../identity-store";
import * as lessonSource from "../lesson-source";

let root: string;
let preparation: ProjectLessonPreparation;
let options: BuildCourseExportInputOptions;
const first = "# First\n\nFirst body.\n";
const second = "# Second\n\nOther body.\n";
beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), "lesson-preparation-"));
	await writeFile(
		path.join(root, "course.yaml"),
		"title: Course\nlocale: en\nlessons: [one.prax, two.prax]\n",
	);
	await writeFile(path.join(root, "one.prax"), first);
	await writeFile(path.join(root, "two.prax"), second);
	await persistFixtureIdentity(root);
	preparation = new ProjectLessonPreparation(root);
	options = {
		projectDir: root,
		scope: "course",
		mode: "preview",
		manifestPolicy: "read-only",
		inheritWorkspaceSettings: false,
		completionThreshold: 80,
		viewerVersionPath: path.join(root, "viewer.json"),
		identitySession: new CourseIdentitySession(root),
		lessonPreparation: preparation,
		loadAssets: false,
	};
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

// Every differential oracle runs without either retained owner, before warming it.
const fresh = (patch: Partial<BuildCourseExportInputOptions> = {}) =>
	buildCourseExportInput({
		...options,
		...patch,
		lessonPreparation: undefined,
		identitySession: undefined,
	});

it("retains unchanged preparation, copies results, and prepares only the edited lesson", async () => {
	const expected = await fresh();
	const parse = vi.spyOn(lessonSource, "parseLessonSource");
	const firstInput = await buildCourseExportInput(options);
	expect(firstInput).toEqual(expected);
	firstInput.blocks[0].data.title = "Caller tamper";
	if (firstInput.frontmatter.design) firstInput.frontmatter.design.colorMode = "dark";
	expect(await buildCourseExportInput(options)).toEqual(expected);
	expect(parse).toHaveBeenCalledTimes(2);
	await writeFile(path.join(root, "two.prax"), second.replace("Other", "Later"));
	await persistFixtureIdentity(root);
	const edited = await fresh();
	parse.mockClear();
	expect(await buildCourseExportInput(options)).toEqual(edited);
	expect(parse.mock.calls.map(([, filename]) => filename)).toEqual(["two.prax"]);
});

it("agrees with fresh after a same-size write with restored coarse mtime and no watcher", async () => {
	await buildCourseExportInput(options);
	const filename = path.join(root, "one.prax");
	await writeFile(filename, first.replace("First body", "Later body"));
	const time = Math.floor(Date.now() / 1000);
	await utimes(filename, time, time);
	await persistFixtureIdentity(root);
	const expected = await fresh();
	expect(await buildCourseExportInput(options)).toEqual(expected);
	expect(expected.blocks.some((block) => block.data.content === "<p>Later body.</p>")).toBe(true);
});

it("refreshes a retained reader after a variable definition changes in another lesson", async () => {
	await writeFile(
		path.join(root, "one.prax"),
		"---\nvariables: {name: Alice}\n---\n# Definition\n",
	);
	await writeFile(path.join(root, "two.prax"), "# Reader\n\nHello {{name}}.\n");
	await persistFixtureIdentity(root);
	const original = await fresh();
	expect(await buildCourseExportInput(options)).toEqual(original);
	await writeFile(path.join(root, "one.prax"), "---\nvariables: {name: Bob}\n---\n# Definition\n");
	await persistFixtureIdentity(root);
	const expected = await fresh();
	const parse = vi.spyOn(lessonSource, "parseLessonSource");
	const retained = await buildCourseExportInput(options);
	expect(retained).toEqual(expected);
	expect(parse.mock.calls.map(([, filename]) => filename)).toEqual(["one.prax"]);
	const freshContext = await createCourseContext(expected);
	const retainedContext = await createCourseContext(retained);
	const reader = freshContext.pages[1];
	if (!reader) throw new Error("Missing reader page");
	const freshHtml = compilePage(freshContext, reader.id).html;
	expect(freshHtml).toContain('data-fallback="Bob">Bob');
	expect(compilePage(retainedContext, reader.id).html).toBe(freshHtml);
});

it("reads settings, workspace defaults and option changes before consulting retention", async () => {
	await buildCourseExportInput(options);
	await writeFile(
		path.join(root, "course.yaml"),
		"title: Changed\nlocale: fr\nnarrationEnabled: false\ndesign:\n  colorMode: dark\nlessons: [two.prax, one.prax]\n",
	);
	const patch = {
		completionThreshold: 50,
		passingScore: 75,
		requireKnowledgeChecks: true,
		preparePdf: true,
	};
	const expected = await fresh(patch);
	expect(await buildCourseExportInput({ ...options, ...patch })).toEqual(expected);
	expect(expected.locale).toBe("fr");
	expect(expected.config.passingScore).toBe(75);
	await writeFile(path.join(root, "course.yaml"), "title: Course\nlessons: [one.prax, two.prax]\n");
	await mkdir(path.join(root, "course"));
	// Workspace reads use the admitted parent, rather than caller-owned configuration.
	await writeFile(path.join(root, "workspace.praxity.yaml"), "defaultLocale: fr\n");
	const workspacePatch = { workspacePath: root, inheritWorkspaceSettings: true };
	const inherited = await fresh(workspacePatch);
	expect(await buildCourseExportInput({ ...options, ...workspacePatch })).toEqual(inherited);
	await writeFile(path.join(root, "workspace.praxity.yaml"), "defaultLocale: en\n");
	const changed = await fresh(workspacePatch);
	expect(await buildCourseExportInput({ ...options, ...workspacePatch })).toEqual(changed);
	expect(changed.locale).toBe("en");
});

it("invalidates narration and preserves unlinked publication refusals after warming preview", async () => {
	const fixture = await narrationFixture(root, "one.prax");
	const target = fixture.items.find((item) => item.segment.target.role === "body");
	if (!target) throw new Error("Missing narration target");
	fixture.update(target.segment.target, { audio: "assets/first.mp3" });
	await writeFile(path.join(root, "narration.yaml"), serializeNarrationSidecarV2(fixture.sidecar));
	const original = await fresh();
	expect(await buildCourseExportInput(options)).toEqual(original);
	fixture.update(target.segment.target, { audio: "assets/other.mp3" });
	await writeFile(path.join(root, "narration.yaml"), serializeNarrationSidecarV2(fixture.sidecar));
	const expected = await fresh();
	expect(await buildCourseExportInput(options)).toEqual(expected);
	expect(expected).not.toEqual(original);
	await writeFile(path.join(root, "one.prax"), "# First\n\nReplacement body.\n");
	await persistFixtureIdentity(root);
	const edited = await fresh();
	expect(await buildCourseExportInput(options)).toEqual(edited);
	expect(edited.warnings?.[0]).toMatchObject({ code: "ENARRATIONUNLINKED", count: 1 });
	await expect(buildCourseExportInput({ ...options, mode: "export" })).rejects.toMatchObject({
		code: "ENARRATIONUNLINKED",
	});
});

it("does not retain asset admission, including retargeted and restored symlinks", async () => {
	await mkdir(path.join(root, "assets"));
	await writeFile(path.join(root, "original"), "first");
	await writeFile(path.join(root, "other"), "other");
	const asset = path.join(root, "assets", "a.bin");
	await symlink(path.join(root, "original"), asset);
	const patch = { loadAssets: true, assetInventory: new ProjectAssetInventory(root) };
	const original = await fresh(patch);
	expect(await buildCourseExportInput({ ...options, ...patch })).toEqual(original);
	await unlink(asset);
	await symlink(path.join(root, "other"), asset);
	const changed = await fresh({ loadAssets: true });
	expect(await buildCourseExportInput({ ...options, ...patch })).toEqual(changed);
	await unlink(asset);
	await symlink(path.join(root, "original"), asset);
	const restored = await fresh({ loadAssets: true });
	expect(await buildCourseExportInput({ ...options, ...patch })).toEqual(restored);
});

it("refuses identity tampering even with a retained preparation", async () => {
	await buildCourseExportInput(options);
	const store = await loadIdentityStore(root);
	const head = store.heads[0];
	if (!head) throw new Error("Missing identity head");
	const snapshot = path.join(root, ".praxity", "identity", "snapshots", `${head.head}.json`);
	const bytes = await readFile(snapshot, "utf8");
	await writeFile(
		snapshot,
		serializeIdentity({ ...JSON.parse(bytes), sourceHash: "0".repeat(64) }),
	);
	await expect(fresh()).rejects.toThrow();
	await expect(buildCourseExportInput(options)).rejects.toThrow();
	await writeFile(snapshot, bytes);
	const expected = await fresh();
	const parse = vi.spyOn(lessonSource, "parseLessonSource");
	expect(await buildCourseExportInput(options)).toEqual(expected);
	expect(parse).toHaveBeenCalledTimes(2);
});

it("enforces byte and entry bounds without changing output", async () => {
	const expected = await fresh();
	const parse = vi.spyOn(lessonSource, "parseLessonSource");
	const tiny = new ProjectLessonPreparation(root, 1);
	for (let index = 0; index < 2; index++)
		expect(await buildCourseExportInput({ ...options, lessonPreparation: tiny })).toEqual(expected);
	expect(parse).toHaveBeenCalledTimes(4);
	parse.mockClear();
	const oneEntry = new ProjectLessonPreparation(root, 16 * 1024 * 1024, 1);
	for (let index = 0; index < 2; index++)
		expect(await buildCourseExportInput({ ...options, lessonPreparation: oneEntry })).toEqual(
			expected,
		);
	expect(parse).toHaveBeenCalledTimes(4);
});

it("does not repopulate an owner invalidated during lesson preparation", async () => {
	const expected = await fresh();
	const originalParse = lessonSource.parseLessonSource;
	const parse = vi.spyOn(lessonSource, "parseLessonSource");
	parse.mockImplementationOnce(async (...args) => {
		const read = await originalParse(...args);
		preparation.invalidate();
		return read;
	});
	expect(await buildCourseExportInput(options)).toEqual(expected);
	parse.mockClear();
	expect(await buildCourseExportInput(options)).toEqual(expected);
	expect(parse.mock.calls.map(([, filename]) => filename)).toEqual(["one.prax"]);
	parse.mockClear();
	expect(await buildCourseExportInput(options)).toEqual(expected);
	expect(parse).not.toHaveBeenCalled();
});

it("rejects a preparation owner from another project", async () => {
	const other = await mkdtemp(path.join(tmpdir(), "other-preparation-"));
	try {
		await expect(
			buildCourseExportInput({
				...options,
				lessonPreparation: new ProjectLessonPreparation(other),
			}),
		).rejects.toThrow("Lesson preparation belongs to another project");
	} finally {
		await rm(other, { recursive: true, force: true });
	}
});

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.5])(
	"rejects invalid cache budgets %s",
	(budget) => {
		expect(() => new ProjectLessonPreparation(root, budget)).toThrow(
			"Invalid lesson preparation budget",
		);
		expect(() => new ProjectLessonPreparation(root, 1024, budget)).toThrow(
			"Invalid lesson preparation budget",
		);
	},
);
