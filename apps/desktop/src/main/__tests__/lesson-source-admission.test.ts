import { type ChildProcess, fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { resolveLessonSources, writeLessonSource } from "../lesson-source";

const inventory = vi.hoisted(() => ({ pause: undefined as (() => Promise<void>) | undefined }));
vi.mock("../course-manifest-io", async (importOriginal) => {
	const io = await importOriginal<typeof import("../course-manifest-io")>();
	return {
		...io,
		readCourseManifestData: async (...args: Parameters<typeof io.readCourseManifestData>) => {
			const snapshot = await io.readCourseManifestData(...args);
			await inventory.pause?.();
			return snapshot;
		},
	};
});

const roots: string[] = [];
const children: ChildProcess[] = [];
const releases: (() => void)[] = [];
afterEach(async () => {
	inventory.pause = undefined;
	for (const release of releases.splice(0)) release();
	await Promise.all(
		children.splice(0).map(async (child) => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill();
			await exited;
		}),
	);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function barrier() {
	let release = () => {};
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	releases.push(release);
	return { ready, release };
}

type WriterMessage = {
	ready?: boolean;
	waiting?: boolean;
	admitted?: boolean;
	done?: boolean;
	error?: string;
};
async function writer(root: string) {
	const child = fork(
		fileURLToPath(new URL("./fixtures/identity-admission-writer.ts", import.meta.url)),
		[root],
		{ execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
	);
	children.push(child);
	let errors = "";
	child.stderr?.on("data", (chunk) => {
		errors += chunk;
	});
	const messages: WriterMessage[] = [];
	let receive: ((message: WriterMessage) => void) | undefined;
	child.on("message", (message: WriterMessage) => {
		if (receive) {
			const pending = receive;
			receive = undefined;
			pending(message);
		} else messages.push(message);
	});
	const next = async (): Promise<WriterMessage> => {
		const queued = messages.shift();
		if (queued) return queued;
		const message = new Promise<WriterMessage>((resolve) => {
			receive = resolve;
		});
		return Promise.race([
			message,
			once(child, "exit").then(() => {
				throw new Error(errors || "Identity admission writer exited");
			}),
		]);
	};
	expect(await next()).toEqual({ ready: true });
	return { child, next };
}

for (const strict of [false, true]) {
	it(`keeps inventory and identity in one read admission, strict=${strict}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "identity-admission-"));
		roots.push(root);
		await writeLessonSource(root, "lesson-0.prax", "# First\n");
		const original = await resolveLessonSources(root, {}, { strict: true });
		const second = await writer(root);
		const captured = barrier();
		const resumeRead = barrier();
		inventory.pause = async () => {
			captured.release();
			await resumeRead.ready;
		};
		const read = resolveLessonSources(root, {}, { strict }).then(
			(value) => ({ value, error: undefined }),
			(error: unknown) => ({ value: undefined, error }),
		);
		await captured.ready;
		second.child.send({ start: true });
		const competing = await second.next();
		if (competing.admitted) {
			// Without the outer read admission, commit the second writer before
			// returning the captured inventory. This forces the stale read every time.
			second.child.send({ resume: true });
			expect(await second.next()).toEqual({ done: true });
		}
		resumeRead.release();
		const result = await read;
		if (competing.waiting) {
			expect(await second.next()).toEqual({ admitted: true });
			second.child.send({ resume: true });
			expect(await second.next()).toEqual({ done: true });
		}
		inventory.pause = undefined;
		expect.soft(result.error).toBeUndefined();
		expect.soft(result.value?.identity.heads).toEqual(original.identity.heads);
		expect.soft(competing).toEqual({ waiting: true });
		const current = await resolveLessonSources(root, {}, { strict: true });
		expect(current.identity.heads.map((head) => head.path).sort()).toEqual([
			"lesson-0.prax",
			"lesson-1.prax",
		]);
		expect(current.identity.heads.find((head) => head.path === "lesson-0.prax")).toEqual(
			original.identity.heads[0],
		);
	}, 25_000);
}
