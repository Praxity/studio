import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request, Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { CoursePreviewDeployment } from "@praxity/export-pipeline";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { startStudioServer } from "../studio/server";

const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
async function fixture() {
	const root = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "studio-preview-"),
	);
	roots.push(root);
	const projectDir = join(root, "project");
	const editorAssetsDir = join(root, "editor");
	await mkdir(join(projectDir, "assets"), { recursive: true });
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "index.html"), "<!doctype html><title>Editor</title>");
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	await writeFile(
		join(projectDir, "lesson.prax"),
		"---\nid: preview-fixture\ntitle: Saved\n---\n\n# Saved\n\nSaved body.\n",
	);
	await writeFile(join(root, "workspace.praxity.yaml"), "defaultLocale: fr\n");
	return { root, projectDir, editorAssetsDir };
}
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("isolated Studio media and previews", () => {
	it("logs the preview failure cause while keeping the RPC error generic", async () => {
		const files = await fixture();
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const server = await startStudioServer({
			...files,
			appVersion: "0.3.0",
			exportAssetsDir: join(files.root, "missing-export-assets"),
		});
		servers.push(server);
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const response = await fetch(`${server.origin}/api/rpc`, {
			method: "POST",
			headers: {
				Origin: server.origin,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ method: "coursePreviewBuild", args: {} }),
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			ok: false,
			error: { code: "operation_failed", message: "Project operation failed" },
		});
		expect(logged).toHaveBeenCalledExactlyOnceWith(
			"[studio] Project operation failed",
			expect.objectContaining({ message: "Missing export asset: viewer.css" }),
		);
	});
	it("refuses RPC, editor credentials, hostile origins and unauthenticated media", async () => {
		const files = await fixture();
		const editor = await startStudioServer({ ...files, appVersion: "0.3.0" });
		servers.push(editor);
		const token = new URLSearchParams(new URL(editor.readyUrl).hash.slice(1)).get("session");
		const snapshot = await (
			await fetch(`${editor.origin}/api/session`, { headers: { Authorization: `Bearer ${token}` } })
		).json();
		const media = snapshot.result.mediaBaseUrl as string;
		const readOnlyOrigin = new URL(media).origin;
		expect(readOnlyOrigin).not.toBe(editor.origin);
		await writeFile(join(files.projectDir, "assets", "audio.mp3"), "0123456789");
		for (const headers of [
			{ Authorization: `Bearer ${token}` },
			{ Origin: "null" },
			{ Origin: "https://evil.test" },
		] as Record<string, string>[])
			expect((await fetch(`${media}assets/audio.mp3`, { headers })).status).toBe(403);
		const badHost = await new Promise<number>((resolve) => {
			const req = request(`${media}assets/audio.mp3`, { headers: { Host: "localhost" } }, (res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			});
			req.end();
		});
		expect(badHost).toBe(403);
		expect(
			(
				await fetch(`${readOnlyOrigin}/api/rpc`, {
					method: "POST",
					headers: { Authorization: `Bearer ${token}`, Origin: editor.origin },
				})
			).status,
		).toBe(403);
		expect((await fetch(`${readOnlyOrigin}/api/session`)).status).toBe(404);
		expect((await fetch(`${readOnlyOrigin}/media/${token}/assets/audio.mp3`)).status).toBe(401);
		const preflight = await fetch(`${media}assets/audio.mp3`, {
			method: "OPTIONS",
			headers: { Origin: editor.origin },
		});
		expect(preflight.status).toBe(405);
		expect(preflight.headers.has("access-control-allow-origin")).toBe(false);
		const mediaToken = new URL(media).pathname.split("/")[2];
		expect(
			(
				await fetch(`${editor.origin}/api/session`, {
					headers: { Authorization: `Bearer ${mediaToken}` },
				})
			).status,
		).toBe(401);
		expect((await fetch(`${editor.origin}/media/${mediaToken}/assets/audio.mp3`)).status).toBe(404);
		expect((await fetch(`${editor.origin}/assets/audio.mp3`)).status).toBe(404);
	});
	it("serves exact MIME, nosniff, closed asset CSP, CORS and byte ranges", async () => {
		const files = await fixture();
		const server = await startStudioReadOnlyServer({
			projectDir: files.projectDir,
			getEditorOrigin: () => "http://127.0.0.1:9000",
		});
		servers.push(server);
		for (const [name, mime] of [
			["audio.mp3", "audio/mpeg"],
			["movie.mov", "video/quicktime"],
			["image.svg", "image/svg+xml"],
			["hostile.html", "text/html; charset=utf-8"],
		]) {
			await writeFile(join(files.projectDir, "assets", name), "0123456789");
			const response = await fetch(`${server.mediaBaseUrl}assets/${name}`, {
				headers: { Origin: "http://127.0.0.1:9000" },
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(mime);
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("content-security-policy")).toContain(
				"sandbox; default-src 'none'",
			);
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:9000");
			await response.arrayBuffer();
		}
		for (const [range, bytes, contentRange] of [
			["bytes=2-5", "2345", "bytes 2-5/10"],
			["bytes=-3", "789", "bytes 7-9/10"],
			["bytes=8-100", "89", "bytes 8-9/10"],
		]) {
			const response = await fetch(`${server.mediaBaseUrl}assets/audio.mp3`, {
				headers: { Range: range },
			});
			expect(response.status).toBe(206);
			expect(response.headers.get("content-range")).toBe(contentRange);
			expect(await response.text()).toBe(bytes);
		}
		for (const range of [
			"bytes=11-",
			"bytes=-0",
			"bytes=0-1,3-4",
			"bytes=9007199254740993-",
			"bad",
		])
			expect(
				(await fetch(`${server.mediaBaseUrl}assets/audio.mp3`, { headers: { Range: range } }))
					.status,
			).toBe(416);
		const head = await fetch(`${server.mediaBaseUrl}assets/audio.mp3`, {
			method: "HEAD",
			headers: { Range: "bytes=2-5" },
		});
		expect(head.status).toBe(206);
		expect(head.headers.get("content-length")).toBe("4");
		expect(await head.text()).toBe("");
	});
	it("confines asset reads, including escaping and dangling links", async () => {
		const files = await fixture();
		const server = await startStudioReadOnlyServer({
			projectDir: files.projectDir,
			getEditorOrigin: () => "http://127.0.0.1:9000",
		});
		servers.push(server);
		await writeFile(join(files.root, "private.txt"), "PRIVATE");
		await symlink(join(files.root, "private.txt"), join(files.projectDir, "assets", "escape.txt"));
		await symlink(join(files.root, "absent.txt"), join(files.projectDir, "assets", "dangling.txt"));
		for (const file of [
			"assets/escape.txt",
			"assets/dangling.txt",
			"lesson.prax",
			"assets/%2e%2e%2f%2e%2e%2fprivate.txt",
			"assets/%252e%252e/private.txt",
			"assets/%5cprivate.txt",
		]) {
			const response = await fetch(`${server.mediaBaseUrl}${file}`);
			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(await response.text()).not.toContain("PRIVATE");
		}
	});
	it.each(["normal", "error", "hung"])(
		"hosts captured files and disposes leases with HTTP close %s",
		async (mode) => {
			const files = await fixture();
			const server = await startStudioReadOnlyServer({
				projectDir: files.projectDir,
				getEditorOrigin: () => "http://127.0.0.1:9000",
			});
			servers.push(server);
			let disposals = 0;
			const deployment: CoursePreviewDeployment = {
				format: "electron-preview",
				courseToken: "a".repeat(32),
				manifest: {
					version: 1,
					rendererContractVersion: 1,
					learnerStateSchemaVersion: 1,
					courseId: "course",
					revision: "b".repeat(64),
					entry: "index.html",
					pageCount: 1,
					pages: [],
					files: [
						{
							path: "index.html",
							byteLength: 5,
							mediaType: "text/html; charset=utf-8",
							sha256: "c".repeat(64),
						},
					],
				},
				openFile: async () => Readable.from([Buffer.from("Hello")]),
				dispose: async () => {
					disposals++;
				},
			};
			const lease = await server.hostCourseArtifact(deployment);
			const response = await fetch(lease.entryUrl);
			expect(await response.text()).toBe("Hello");
			expect(response.headers.get("content-security-policy")).toContain(
				"frame-ancestors http://127.0.0.1:9000",
			);
			expect(response.headers.has("access-control-allow-origin")).toBe(false);
			expect((await fetch(new URL("private.txt", lease.entryUrl))).status).toBe(404);
			if (mode !== "normal") {
				servers.pop();
				const close = Server.prototype.close;
				let releaseClose: (() => void) | undefined;
				const fault = vi.spyOn(Server.prototype, "close").mockImplementation(function (
					this: Server,
					callback,
				) {
					return close.call(this, (error) => {
						releaseClose = () => callback?.(error);
						if (mode === "error") callback?.(new Error("Read-only HTTP close failed"));
					});
				});
				const closing = server.close().catch((error: unknown) => error);
				try {
					await vi.waitFor(() => expect(disposals).toBe(1));
					if (mode === "hung") {
						await vi.waitFor(() => expect(releaseClose).toBeTypeOf("function"));
						releaseClose?.();
						expect(await closing).toBeUndefined();
					} else {
						expect(await closing).toMatchObject({
							errors: [expect.objectContaining({ message: "Read-only HTTP close failed" })],
						});
					}
				} finally {
					fault.mockRestore();
					releaseClose?.();
					await closing;
					await lease.release();
				}
				return;
			}
			await lease.release();
			await lease.release();
			expect(disposals).toBe(1);
			expect((await fetch(lease.entryUrl)).status).toBe(404);
		},
	);
	it("compiles unsaved source through authenticated RPC, without ancestor inheritance or source writes", async () => {
		const files = await fixture();
		const original = await readFile(join(files.projectDir, "lesson.prax"), "utf8");
		const server = await startStudioServer({
			...files,
			appVersion: "0.3.0",
			exportAssetsDir: fileURLToPath(new URL("../../../resources/export-assets/", import.meta.url)),
		});
		servers.push(server);
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const rpc = async (method: string, args: unknown) => {
			const response = await fetch(`${server.origin}/api/rpc`, {
				method: "POST",
				headers: {
					Origin: server.origin,
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ method, args }),
			});
			return { status: response.status, ...(await response.json()) };
		};
		expect(
			(
				await rpc("coursePreviewBuild", {
					request: { scope: "lesson", lessonFilename: "../lesson.prax", source: original },
				})
			).status,
		).toBe(400);
		const built = await rpc("coursePreviewBuild", {
			request: {
				scope: "lesson",
				lessonFilename: "lesson.prax",
				source: original.replace("Saved body.", "Unsaved [term]{definition} body."),
			},
		});
		expect(built.status, JSON.stringify(built)).toBe(200);
		const html = await (await fetch(built.result.entryUrl)).text();
		expect(html).toContain('lang="en"');
		const lessonUrl = new URL(`${built.result.pages[0].slug}.html`, built.result.entryUrl);
		expect(await (await fetch(lessonUrl)).text()).toContain("Unsaved");
		expect(await readFile(join(files.projectDir, "lesson.prax"), "utf8")).toBe(original);
		await expect(readFile(join(files.projectDir, "course.yaml"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		const active = await rpc("coursePreviewStateActivate", { leaseId: built.result.leaseId });
		expect(active.result.writerToken).toMatch(/^[0-9a-f-]{36}$/);
		expect(
			(
				await rpc("coursePreviewStatePersist", {
					leaseId: built.result.leaseId,
					writerToken: active.result.writerToken,
					state: "bad",
				})
			).result,
		).toBe(false);
		const reset = await rpc("coursePreviewStateReset", { leaseId: built.result.leaseId });
		expect(JSON.parse(reset.result).generation).toBe(1);
		expect(
			(
				await rpc("coursePreviewStatePersist", {
					leaseId: built.result.leaseId,
					writerToken: active.result.writerToken,
					state: reset.result,
				})
			).result,
		).toBe(false);
		await rpc("coursePreviewRelease", { leaseId: built.result.leaseId });
		expect((await fetch(lessonUrl)).status).toBe(404);
	}, 60_000);
});
