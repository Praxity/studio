import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import type { CanvasPreviewDescriptor } from "../course-preview-service";
import { startStudioReadOnlyServer } from "../studio/read-only-server";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
});

async function fixture() {
	let head: CanvasPreviewDescriptor | undefined;
	const server = await startStudioReadOnlyServer({
		projectDir: process.cwd(),
		getEditorOrigin: () => "http://127.0.0.1:9000",
		getCanvasHead: () => head,
	});
	cleanups.push(() => server.close());
	async function host(
		n: number,
		pages = [
			{ id: "first", lessonId: "one", slug: "first" },
			{ id: "second", lessonId: "one", slug: "second" },
			{ id: "third", lessonId: "two", slug: "third" },
		],
	) {
		const files = Object.fromEntries(
			pages.map((p) => [
				`${p.slug}.html`,
				`<!doctype html><html><body><h1>${p.id}</h1></body></html>`,
			]),
		);
		files["index.html"] = files[`${pages[0].slug}.html`];
		const revision = n.toString(16).padStart(64, "0");
		const hosted = await server.hostCourseArtifact({
			format: "standalone",
			courseToken: "a".repeat(32),
			editorSeq: n,
			sourceRevisions: { "one.prax": "source" },
			manifest: {
				version: 1,
				rendererContractVersion: 1,
				learnerStateSchemaVersion: 1,
				courseId: "course",
				revision,
				entry: "index.html",
				pageCount: pages.length,
				pages: pages.map((p) => ({
					...p,
					title: p.id,
					runtime: { mode: "islands", islands: ["deck"], legacyReasons: [] },
					statefulBlockIds: [],
				})),
				files: Object.entries(files).map(([path, text]) => ({
					path,
					byteLength: Buffer.byteLength(text),
					sha256: "b".repeat(64),
					mediaType: "text/html",
				})),
			},
			openFile: async (p) => Readable.from([Buffer.from(files[p])]),
			dispose: async () => {},
		});
		head = {
			entryUrl: hosted.entryUrl,
			courseId: "course",
			coreRevision: revision,
			responseRevision: revision,
			pages: pages.map(({ id, slug }) => ({ id, slug })),
		};
		return { ...hosted, path: new URL("second.html", hosted.entryUrl).pathname };
	}
	return { server, host };
}

it("retains captured scope after releasing files and redirects only known documents, preserving queries", async () => {
	const { server, host } = await fixture();
	const old = await host(1);
	const captured = server.canvasPageScope(old.path);
	expect(captured).toEqual({
		pageId: "second",
		lessonId: "one",
		pageIndex: 1,
		pageIds: ["first", "second"],
		allLessonPages: true,
		editorSeq: 1,
		sourceRevisions: { "one.prax": "source" },
	});
	await old.release();
	const newest = await host(2);
	expect(server.canvasPageScope(old.path)).toEqual(captured);
	const response = await fetch(`${server.origin}/canvas${old.path}?praxity-resume=0`, {
		redirect: "manual",
	});
	expect(response.status).toBe(303);
	expect(response.headers.get("location")).toBe(`/canvas${newest.path}?praxity-resume=0`);
	expect(response.headers.get("location")).not.toContain("#");
	for (const [query, expected] of [
		["tracking=kept", "tracking=kept&praxity-resume=0"],
		["praxity-resume=1&tracking=kept", "praxity-resume=1&tracking=kept"],
	]) {
		const arrival = await fetch(`${server.origin}/canvas${old.path}?${query}`, {
			redirect: "manual",
		});
		expect(arrival.status).toBe(303);
		expect(arrival.headers.get("location")).toBe(`/canvas${newest.path}?${expected}`);
	}
	expect(server.currentCanvasDocument(old.path)).toBe(newest.path);
	for (const invalid of [
		old.path.replace("second.html", "absent.html"),
		old.path.replace("/preview/", "/preview/wrong/"),
		old.path.replace("second.html", "asset.js"),
	]) {
		expect(server.canvasPageScope(invalid)).toBeUndefined();
		expect(server.currentCanvasDocument(invalid)).toBeUndefined();
		expect((await fetch(`${server.origin}/canvas${invalid}`, { redirect: "manual" })).status).toBe(
			404,
		);
	}
});

it.each([
	[[{ id: "first", lessonId: "one", slug: "first" }], "first.html"],
	[[{ id: "third", lessonId: "two", slug: "third" }], "third.html"],
	[[{ id: "second", lessonId: "one", slug: "renamed" }], "renamed.html"],
] as const)(
	"maps released pages by identity then lesson then course, %j",
	async (pages, expected) => {
		const { server, host } = await fixture();
		const old = await host(1);
		await old.release();
		const newest = await host(2, [...pages]);
		expect(server.currentCanvasDocument(old.path)).toBe(
			new URL(expected, newest.entryUrl).pathname,
		);
	},
);

it("keeps at most 256 recorded revisions and touches a recorded lookup", async () => {
	const { server, host } = await fixture();
	const paths: string[] = [];
	for (let i = 0; i < 256; i++) {
		const built = await host(i);
		paths.push(built.path);
		await built.release();
	}
	expect(server.canvasPageScope(paths[0])?.pageId).toBe("second");
	await host(256);
	expect(server.canvasPageScope(paths[0])?.pageId).toBe("second");
	expect(server.canvasPageScope(paths[1])).toBeUndefined();
	await server.close();
	expect(server.canvasPageScope(paths[0])).toBeUndefined();
});
