import { fstatSync } from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { serveFile, serveOpenedFile } from "../course-file-response";
import { ResponseStreamOwner } from "../response-stream";

const metadata = { byteLength: 1_000_000, mediaType: "video/mp4", sha256: "" };
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function capturedFile() {
	const root = await mkdtemp(join(tmpdir(), "studio-body-"));
	roots.push(root);
	const path = join(root, "asset.mp4");
	await writeFile(path, Buffer.alloc(metadata.byteLength));
	return open(path, "r");
}

it.each(["HEAD", "invalid range", "already aborted"])(
	"closes a captured descriptor once without a body for %s",
	async (caseName) => {
		const file = await capturedFile();
		const fd = file.fd;
		const close = vi.spyOn(file, "close");
		const abort = new AbortController();
		if (caseName === "already aborted") abort.abort();
		const request = new Request("http://localhost/asset", {
			method: caseName === "HEAD" ? "HEAD" : "GET",
			headers: caseName === "invalid range" ? { Range: "bytes=1000000-" } : {},
			signal: abort.signal,
		});
		const response = serveOpenedFile(request, file, metadata);
		if (caseName === "already aborted")
			await expect(response).rejects.toMatchObject({ name: "AbortError" });
		else expect((await response).body).toBeNull();
		expect(close).toHaveBeenCalledOnce();
		expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
	},
);

it.each(["body cancellation", "request abort", "completion", "owner shutdown"])(
	"closes a captured descriptor once after %s",
	async (caseName) => {
		const file = await capturedFile();
		const fd = file.fd;
		const close = vi.spyOn(file, "close");
		const owner = new ResponseStreamOwner();
		const abort = new AbortController();
		const response = await serveOpenedFile(
			new Request("http://localhost/asset", { signal: abort.signal }),
			file,
			metadata,
			"no-cache",
			owner,
		);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		expect((await reader.read()).value?.length).toBeGreaterThan(0);
		if (caseName === "body cancellation") await reader.cancel("navigation");
		if (caseName === "request abort") {
			abort.abort();
			await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
		}
		if (caseName === "completion")
			while (!(await reader.read()).done) {
				/* drain */
			}
		await owner.close();
		expect(close).toHaveBeenCalledOnce();
		expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
	},
);

it.each(["request abort", "owner shutdown"])(
	"settles an open still pending during %s",
	async (caseName) => {
		const owner = new ResponseStreamOwner();
		const abort = new AbortController();
		let finishOpen!: (stream: Readable) => void;
		const response = serveFile(
			new Request("http://localhost/asset", { signal: abort.signal }),
			metadata,
			() =>
				new Promise<Readable>((resolve) => {
					finishOpen = resolve;
				}),
			"no-cache",
			owner,
		);
		const refused = expect(response).rejects.toThrow();
		if (caseName === "request abort") abort.abort();
		const closing = owner.close();
		const file = await capturedFile();
		const fd = file.fd;
		const close = vi.spyOn(file, "close");
		finishOpen(file.createReadStream());
		await refused;
		await closing;
		expect(close).toHaveBeenCalledOnce();
		expect(() => fstatSync(fd)).toThrow(expect.objectContaining({ code: "EBADF" }));
	},
);

it("delivers terminal read failures through the body and owns errors after close", async () => {
	const owner = new ResponseStreamOwner();
	const failure = new Error("disk read failed");
	const source = new Readable({
		read() {
			this.destroy(failure);
		},
	});
	const response = await serveFile(
		new Request("http://localhost/asset"),
		metadata,
		() => source,
		"no-cache",
		owner,
	);
	await expect(response.text()).rejects.toBe(failure);
	await owner.close();
	expect(() => source.emit("error", new Error("late terminal error"))).not.toThrow();
});
