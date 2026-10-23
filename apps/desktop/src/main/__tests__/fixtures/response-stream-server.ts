import assert from "node:assert/strict";
import { fstatSync } from "node:fs";
import fsp from "node:fs/promises";
import { get, type IncomingMessage } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoursePreviewDeployment } from "@praxity/export-pipeline";
import { persistFixtureIdentity } from "../../../test-utils/identity-fixture";
import { startStudioReadOnlyServer } from "../../studio/read-only-server";
import { startStudioServer } from "../../studio/server";

const root = await fsp.mkdtemp(join(tmpdir(), "studio-stream-process-"));
const projectDir = join(root, "project");
const editorAssetsDir = join(root, "editor");
await fsp.mkdir(join(projectDir, "assets"), { recursive: true });
await fsp.mkdir(join(projectDir, "exports"));
await fsp.mkdir(editorAssetsDir);
await fsp.writeFile(join(projectDir, "lesson.prax"), "# Lesson\n\nBody.\n");
await fsp.writeFile(join(editorAssetsDir, "index.html"), "<html>Editor</html>");
await fsp.writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
await fsp.writeFile(
	join(editorAssetsDir, "canvas.sha256"),
	"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
);
const bytes = Buffer.alloc(32 * 1024 * 1024, "x");
const asset = join(projectDir, "assets", "large.mp4");
const download = join(projectDir, "exports", "large.zip");
await fsp.writeFile(asset, bytes);
await fsp.writeFile(download, bytes);

// Observe the filesystem adapter, including real FileHandle ownership. Never
// catch process-level errors: an unhandled event must kill this child and fail.
const descriptors: { fd: number; closed: boolean; closeCalls: number }[] = [];
const open = fsp.open;
fsp.open = async (...args) => {
	const file = await open(...args);
	if ([asset, download].includes(String(args[0]))) {
		const descriptor = { fd: file.fd, closed: false, closeCalls: 0 };
		descriptors.push(descriptor);
		const close = file.close.bind(file);
		file.close = async () => {
			descriptor.closeCalls++;
			await close();
			descriptor.closed = true;
		};
	}
	return file;
};
syncBuiltinESMExports();

function midBody(url: string, headers?: Record<string, string>): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const req = get(url, { agent: false, headers }, (res) => {
			res.on("error", () => {});
			assert.equal(res.statusCode, 200);
			res.once("data", () => {
				res.pause();
				resolve(res);
			});
		});
		req.on("error", reject);
	});
}

await persistFixtureIdentity(projectDir);
const server = await startStudioReadOnlyServer({ projectDir, getEditorOrigin: () => "" });
const editor = await startStudioServer({ projectDir, editorAssetsDir, appVersion: "0.3.0" });
const token = new URLSearchParams(new URL(editor.readyUrl).hash.slice(1)).get("session");
const openResponse = (url: string) =>
	midBody(url, url.startsWith(editor.origin) ? { Authorization: `Bearer ${token}` } : undefined);
const deploymentStreams = new Set<import("node:stream").Readable>();
let latestPreviewStream: import("node:stream").Readable | undefined;
const deployment: CoursePreviewDeployment = {
	format: "electron-preview",
	courseToken: "a".repeat(32),
	manifest: {
		version: 1,
		rendererContractVersion: 1,
		learnerStateSchemaVersion: 1,
		courseId: "stream-fixture",
		revision: "b".repeat(64),
		entry: "index.html",
		pageCount: 1,
		pages: [],
		files: [
			{
				path: "index.html",
				byteLength: bytes.length,
				mediaType: "text/html",
				sha256: "c".repeat(64),
			},
		],
	},
	openFile: async (_path, range) => {
		const file = await fsp.open(asset, "r");
		const stream = file.createReadStream(range);
		latestPreviewStream = stream;
		deploymentStreams.add(stream);
		stream.once("close", () => deploymentStreams.delete(stream));
		return stream;
	},
	dispose: async () => {
		// The host must settle bodies before handing the deployment back for disposal.
		assert.equal(deploymentStreams.size, 0, "Deployment disposed with a response in flight");
		for (const stream of deploymentStreams) stream.destroy();
		await Promise.all(
			[...deploymentStreams].map(
				(stream) => new Promise<void>((resolve) => stream.once("close", resolve)),
			),
		);
	},
};
const hosted = await server.hostCourseArtifact(deployment);
const downloadUrl = server.registerDownload(download, "large.zip", bytes.length);
const urls = [
	hosted.entryUrl,
	`${server.mediaBaseUrl}assets/large.mp4`,
	downloadUrl,
	`${editor.origin}/api/events`,
];
try {
	const failed = await midBody(hosted.entryUrl);
	const failedClosed = new Promise<void>((resolve) => failed.once("close", resolve));
	failed.resume();
	latestPreviewStream?.destroy(new Error("EIO: response read failed"));
	await failedClosed;
	assert.equal(failed.complete, false, "A failed body must not report complete delivery");
	for (let iteration = 0; iteration < 20; iteration++) {
		const responses = await Promise.all(urls.map(openResponse));
		for (const response of responses) response.destroy();
	}
	const events = await midBody(`${editor.origin}/api/events`, { Authorization: `Bearer ${token}` });
	events.destroy();
	const preview = await midBody(hosted.entryUrl);
	await hosted.release();
	preview.destroy();
	const closingPreview = await server.hostCourseArtifact(deployment);
	const active = await Promise.all(
		Array.from({ length: 16 }, (_, index) =>
			openResponse(index % 4 === 0 ? closingPreview.entryUrl : urls[index % 4]),
		),
	);
	await Promise.all([server.close(), editor.close()]);
	for (const response of active) response.destroy();
	assert.ok(descriptors.length > 40);
	for (const descriptor of descriptors) {
		assert.equal(descriptor.closed, true);
		assert.equal(descriptor.closeCalls, 1);
		assert.throws(() => fstatSync(descriptor.fd), { code: "EBADF" });
	}
	console.log(JSON.stringify({ disconnects: 80, descriptors: descriptors.length, closed: true }));
} finally {
	await Promise.all([server.close(), editor.close()]);
	await fsp.rm(root, { recursive: true, force: true });
}
