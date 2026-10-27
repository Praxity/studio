import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import type { HostedCourseDeployment } from "../course-preview-service";
import { CourseIdentitySession } from "../identity-store";
import { OperationService } from "../operations/operation-service";
import { startStudioReadOnlyServer } from "../studio/read-only-server";

vi.mock("node:fs", async (importOriginal) => {
	const { admissionNativeFilesystem } = await import("../../test-utils/admission-filesystem");
	return admissionNativeFilesystem(await importOriginal<typeof import("node:fs")>());
});

vi.mock("node:fs/promises", async (importOriginal) => {
	const { admissionFilesystem } = await import("../../test-utils/admission-filesystem");
	return admissionFilesystem(
		await importOriginal<typeof import("node:fs/promises")>(),
		await vi.importActual<typeof import("node:fs")>("node:fs"),
	);
});

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const step of cleanup.splice(0).reverse()) await step();
});
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;
const gc = async () => {
	await new Promise((resolve) => setImmediate(resolve));
	collect();
	await new Promise((resolve) => setImmediate(resolve));
	collect();
};

type Snapshot = Awaited<ReturnType<OperationService["canvasTextSnapshot"]>>;
type Field = Snapshot["fields"][number];
const request = (field: Field, text: string) => ({
	transactionId: randomUUID(),
	operation: "setText",
	file: field.file,
	nodeId: field.nodeId,
	baseRevision: field.baseRevision,
	expectedText: field.text,
	field: field.field,
	text,
});

const A = "# A page\n\n## A heading\n\nBody A.\n";
const B = "# B page\n\n## B heading\n\nBody B.\n";

/**
 * Real read-only host plus the real operation and identity owners. Canvas launches now retain the
 * previous build in the project ring. Force an early artifact release to also exercise the captured
 * page index: a request during rebuilding must still resolve the held tab's original scope.
 */
async function launchGap(gapRequest: boolean) {
	const root = await mkdtemp(join(tmpdir(), "review-c05f-r2-"));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "course.yaml"), "title: R2\nlessons: [a.prax, b.prax]\n");
	await writeFile(join(root, "a.prax"), A);
	await writeFile(join(root, "b.prax"), B);
	const identity = new CourseIdentitySession(root);
	const service = new OperationService(root, identity);
	const server = await startStudioReadOnlyServer({
		projectDir: process.cwd(),
		getEditorOrigin: () => "http://127.0.0.1:9000",
	});
	cleanup.push(() => server.close());
	// Learn the transient page IDs a real build would embed; keep only strings.
	const pages = await (async () => {
		const initial = await service.canvasTextSnapshot();
		return ["a.prax", "b.prax"].map((file) => {
			const field = initial.fields.find((f) => f.file === file && f.kind === "heading");
			if (!field) throw new Error("Missing heading");
			return { file, pageId: field.pageId, lessonId: field.lessonId };
		});
	})();
	const files: Record<string, string> = {
		"index.html": "<!doctype html><html><body>A</body></html>",
		"b.html": "<!doctype html><html><body>B</body></html>",
	};
	const deployment = (): HostedCourseDeployment => ({
		editorSeq: 1,
		format: "electron-preview",
		courseToken: "a".repeat(32),
		manifest: {
			version: 1,
			rendererContractVersion: 1,
			learnerStateSchemaVersion: 1,
			courseId: "canvas",
			revision: "b".repeat(64),
			entry: "index.html",
			pageCount: 2,
			pages: pages.map(({ pageId, lessonId }, index) => ({
				id: pageId,
				title: `Page ${index + 1}`,
				lessonId,
				slug: index ? "b" : "index",
				runtime: { mode: "islands", islands: [], legacyReasons: [] },
				statefulBlockIds: [],
			})),
			files: Object.entries(files).map(([path, html]) => ({
				path,
				byteLength: Buffer.byteLength(html),
				sha256: "c".repeat(64),
				mediaType: "text/html; charset=utf-8",
			})),
		},
		openFile: async (path) => Readable.from([Buffer.from(files[path])]),
		dispose: async () => {},
	});
	const first = await server.hostCourseArtifact(deployment());
	const base = new URL(first.entryUrl).pathname.replace(/index\.html$/, "");
	const docA = `${base}index.html`;
	const docB = `${base}b.html`;
	const expectedScopeB = {
		lessonId: pages[1].lessonId,
		pageId: pages[1].pageId,
		pageIds: [pages[1].pageId],
		pageIndex: 0,
		allLessonPages: false,
		editorSeq: 1,
		sourceRevisions: undefined,
	};
	// Tab B opens first and holds its heading. Only the request (strings) stays in the tab.
	const held = await (async () => {
		const scope = server.canvasPageScope(docB);
		if (!scope) throw new Error("B document not admitted");
		const snap = await service.canvasTextSnapshot(scope);
		const field = snap.fields.find((f) => f.file === "b.prax" && f.kind === "heading");
		if (!field) throw new Error("Missing B heading");
		expect(field.nodeId.startsWith("rt-")).toBe(true);
		return request(field, "Held B saved");
	})();
	// Stress scope retention even if the old artifact is released before Tab A's rebuild.
	await first.release();
	if (gapRequest) {
		const during = server.canvasPageScope(docB);
		expect(during).toStrictEqual(expectedScopeB);
	}
	const rebuilt = await server.hostCourseArtifact(deployment());
	cleanup.push(() => rebuilt.release());
	// Tab A bootstraps on the rebuilt document and makes the course's first durable write.
	const promote = await (async () => {
		const scope = server.canvasPageScope(docA);
		if (!scope) throw new Error("A document not admitted");
		const snap = await service.canvasTextSnapshot(scope);
		const field = snap.fields.find((f) => f.file === "a.prax" && f.kind === "heading");
		if (!field) throw new Error("Missing A heading");
		return service.canvasTextApply(request(field, "A saved"), scope);
	})();
	expect(promote).toMatchObject({ ok: true });
	await gc();
	const scopeB = server.canvasPageScope(docB);
	if (!scopeB) throw new Error("B document not admitted after rebuild");
	expect(scopeB).toStrictEqual(expectedScopeB);
	const result = await service.canvasTextApply(held, scopeB);
	return { result, root };
}

it("C05f control: held field saves after another tab's launch rebuild and first write", async () => {
	const { result, root } = await launchGap(false);
	expect(result).toMatchObject({ ok: true });
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(B.replace("B heading", "Held B saved"));
});

it("C05f a canvas request during another tab's launch build preserves the held field", async () => {
	const { result, root } = await launchGap(true);
	expect(result).toMatchObject({ ok: true });
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(B.replace("B heading", "Held B saved"));
});
