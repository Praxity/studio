import { createHash } from "node:crypto";
import { renameSync, symlinkSync } from "node:fs";
import {
	cp,
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as contentIdentity from "@praxity/content-identity";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	CourseIdentitySession,
	IdentityStoreCache,
	loadIdentityStore,
	persistCourseIdentity,
	resolveCourseIdentity,
	withIdentityStoreReuse,
} from "../identity-store";
import { writeLessonSource } from "../lesson-source";
import { withProjectFileTransaction } from "../project-file-transactions";

const io = vi.hoisted(() => ({
	root: "",
	courseReads: 0,
	snapshotReads: [] as string[],
	fixedChangeTime: false,
	changeTime: undefined as
		| "coarse"
		| "second"
		| "millisecond"
		| "birth"
		| "zero-birth"
		| "missing"
		| "before-birth"
		| undefined,
	changeTimePath: "",
	allSnapshotChangeTime: false,
	fineChangeTimeAdvance: 0n,
	betweenReads: undefined as (() => Promise<void>) | undefined,
	sourceRead: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const path = String(args[0]).replaceAll("\\", "/");
			if (io.root && path === `${io.root}/.praxity/identity/course.json`) {
				if (++io.courseReads === 2) await io.betweenReads?.();
			}
			if (io.root && path === `${io.root}/lesson.prax` && io.sourceRead) {
				const hook = io.sourceRead;
				io.sourceRead = undefined;
				await hook();
			}
			const handle = await fs.open(...args);
			const changeTime =
				path === io.changeTimePath ||
				(io.allSnapshotChangeTime && path.includes("/.praxity/identity/snapshots/"))
					? io.changeTime
					: undefined;
			if (io.fixedChangeTime || changeTime) {
				const stat = handle.stat.bind(handle);
				handle.stat = (async (...params: Parameters<typeof handle.stat>) => {
					const info = await stat(...params);
					if (!("birthtimeNs" in info)) return info;
					if (changeTime === "zero-birth")
						return Object.assign(info, { birthtimeNs: 0n, ctimeNs: 1n });
					if (changeTime === "missing") Reflect.deleteProperty(info, "ctimeNs");
					else
						info.ctimeNs =
							changeTime === "before-birth"
								? info.birthtimeNs - 1n
								: changeTime === "coarse"
									? 1n
									: changeTime === "birth"
										? info.birthtimeNs
										: changeTime === "second"
											? (info.birthtimeNs / 1_000_000_000n + 1n) * 1_000_000_000n
											: changeTime === "millisecond"
												? (info.birthtimeNs / 1_000_000n + 1n) * 1_000_000n
												: (info.birthtimeNs / 1_000_000_000n + 1n) * 1_000_000_000n +
													123_456_700n +
													(path === io.changeTimePath ? io.fineChangeTimeAdvance : 0n);
					return info;
				}) as typeof handle.stat;
			}
			if (io.root && path.startsWith(`${io.root}/.praxity/identity/snapshots/`)) {
				const read = handle.readFile.bind(handle);
				handle.readFile = (async (...params: Parameters<typeof handle.readFile>) => {
					const bytes = await read(...params);
					io.snapshotReads.push(path);
					return bytes;
				}) as typeof handle.readFile;
			}
			return handle;
		},
	};
});

const roots: string[] = [];
const paragraphIds = new Map<string, string>();
const filename = "lesson.prax";
const sources = [
	"# Practice\n\nA stable practice paragraph keeps its original identity through Revision one.\n",
	"# Practice\n\nA stable practice paragraph keeps its original identity through Revision two.\n",
	"# Practice\n\nA stable practice paragraph keeps its original identity through Revision three.\n",
];
const next =
	"# Practice\n\nA stable practice paragraph keeps its original identity through Revision four.\n";
afterEach(async () => {
	Object.assign(io, {
		root: "",
		courseReads: 0,
		snapshotReads: [],
		fixedChangeTime: false,
		changeTime: undefined,
		changeTimePath: "",
		allSnapshotChangeTime: false,
		fineChangeTimeAdvance: 0n,
		betweenReads: undefined,
		sourceRead: undefined,
	});
	vi.restoreAllMocks();
	for (const [root, id] of paragraphIds) {
		const source = await readFile(join(root, filename), "utf8");
		if (source !== next && !source.includes("Revision five.")) continue;
		const [headName] = await readdir(join(root, ".praxity/identity/lessons"));
		const head = JSON.parse(
			await readFile(join(root, ".praxity/identity/lessons", headName), "utf8"),
		);
		const snapshot = JSON.parse(
			await readFile(join(root, ".praxity/identity/snapshots", `${head.head}.json`), "utf8"),
		);
		expect(snapshot.nodes[id]).toMatchObject({
			status: "active",
			matchText: source.split("\n\n")[1].trim(),
		});
	}
	paragraphIds.clear();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function seed(root: string) {
	// Seed real resolver history without paying three unrelated durable-save costs per case.
	for (const source of sources) {
		const { identity } = await resolveCourseIdentity(root, {
			lessonPaths: [filename],
			sources: { [filename]: source },
		});
		const paragraph = identity.sourceMappings.find((node) => node.path.join() === "0,0");
		if (!paragraph) throw new Error("Missing fixture paragraph");
		if (paragraphIds.has(root)) expect(paragraph.id).toBe(paragraphIds.get(root));
		paragraphIds.set(root, paragraph.id);
		await mkdir(join(root, ".praxity/identity/snapshots"), { recursive: true });
		await mkdir(join(root, ".praxity/identity/lessons"), { recursive: true });
		// The namespace stays fixed; rewriting it would invalidate the seeded history proofs.
		if (source === sources[0])
			await writeFile(
				join(root, ".praxity/identity/course.json"),
				contentIdentity.serializeIdentity(identity.course),
			);
		for (const snapshot of identity.snapshots) {
			const text = contentIdentity.serializeIdentity(snapshot);
			const hash = createHash("sha256").update(text).digest("hex");
			await writeFile(join(root, `.praxity/identity/snapshots/${hash}.json`), text);
			const head = identity.heads.find((head) => head.head === hash);
			if (!head) throw new Error("Missing fixture head");
			await writeFile(
				join(root, `.praxity/identity/lessons/${snapshot.lessonId}.json`),
				contentIdentity.serializeIdentity(head),
			);
		}
		await writeFile(join(root, filename), source);
	}
}

let template: { root: string; paragraphId: string };
beforeAll(async () => {
	const root = await mkdtemp(join(tmpdir(), "lesson-identity-reuse-template-"));
	await seed(root);
	const paragraphId = paragraphIds.get(root);
	if (!paragraphId) throw new Error("Missing template paragraph");
	paragraphIds.delete(root);
	template = { root, paragraphId };
});
afterAll(async () => {
	if (template) await rm(template.root, { recursive: true, force: true });
});

async function fixture(oversized = false, retainSeededProofs = false) {
	const root = await mkdtemp(join(tmpdir(), "lesson-identity-reuse-"));
	roots.push(root);
	if (retainSeededProofs) await seed(root);
	else {
		await cp(template.root, root, { recursive: true });
		paragraphIds.set(root, template.paragraphId);
	}
	const directory = join(root, ".praxity/identity/snapshots");
	const names = await readdir(directory);
	expect(names).toHaveLength(3);
	const snapshots = await Promise.all(
		names.map(async (name) => ({
			path: join(directory, name),
			text: await readFile(join(directory, name), "utf8"),
		})),
	);
	const historical = snapshots.find(({ text }) => JSON.parse(text).parents.length === 0);
	if (!historical) throw new Error("Missing historical fixture snapshot");
	if (oversized) {
		// Valid JSON whitespace makes admitted UTF-16 payload alone exceed the 16 MiB cache.
		await Promise.all(
			snapshots.map(({ path, text }) => writeFile(path, `${text}${" ".repeat(3 * 1024 * 1024)}`)),
		);
	}
	// Most cases start cold. Count cases retain prior proofs; the newest seeded snapshot is still cold.
	if (!retainSeededProofs)
		await expect(
			loadIdentityStore(root, { expectedCourseId: "00000000-0000-4000-8000-000000000000" }),
		).rejects.toThrow(/namespace mismatch/);
	io.root = root.replaceAll("\\", "/");
	const validation = vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord");
	const headDirectory = join(root, ".praxity/identity/lessons");
	const heads = await Promise.all(
		(await readdir(headDirectory)).map(async (name) => {
			const path = join(headDirectory, name);
			return { path, text: await readFile(path, "utf8") };
		}),
	);
	return {
		root,
		historical,
		validation,
		heads,
		snapshotPaths: snapshots.map(({ path }) => path.replaceAll("\\", "/")),
	};
}

async function assertUnwritten(root: string, heads: { path: string; text: string }[]) {
	expect(await readFile(join(root, filename), "utf8")).toBe(sources[2]);
	for (const { path, text } of heads) expect(await readFile(path, "utf8")).toBe(text);
	expect(await readdir(root)).not.toContain(".praxity-transaction.json");
}

it("rereads oversized history but validates it once in a clean public save", async () => {
	const { root, validation, snapshotPaths } = await fixture(true);
	const result = await writeLessonSource(root, filename, next, sources[2], {
		requireExpectedSource: true,
	});
	expect(result).toEqual({});
	expect(await readFile(join(root, filename), "utf8")).toBe(next);
	// Resolution/persistence plus the two required fresh checks before archive deletion.
	expect(io.courseReads).toBe(4);
	expect(validation).toHaveBeenCalledTimes(3);
	for (const path of snapshotPaths)
		expect(io.snapshotReads.filter((read) => read === path)).toHaveLength(4);
	expect(io.snapshotReads).toHaveLength(15);
	validation.mockClear();
	expect((await loadIdentityStore(root)).heads.map((head) => head.path)).toEqual([filename]);
	expect(validation).toHaveBeenCalledTimes(1);
});

describe("public save continuation", () => {
	let root: string;
	beforeAll(async () => {
		({ root } = await fixture(true));
		await writeLessonSource(root, filename, next, sources[2]);
	});
	it("validates only the appended snapshot across clean public saves", async () => {
		const validation = vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord");
		validation.mockClear();
		const last =
			"# Practice\n\nA stable practice paragraph keeps its original identity through Revision five.\n";
		expect(await writeLessonSource(root, filename, last, next)).toEqual({});
		expect(validation).toHaveBeenCalledTimes(1);
		expect(await readFile(join(root, filename), "utf8")).toBe(last);
	});
});

describe("session save continuation", () => {
	let root: string;
	let save: (source: string) => ReturnType<typeof persistCourseIdentity>;
	beforeAll(async () => {
		({ root } = await fixture(true));
		const identitySession = new CourseIdentitySession(root);
		save = (source: string) =>
			withProjectFileTransaction(
				root,
				() =>
					withIdentityStoreReuse(async () => {
						const resolved = await resolveCourseIdentity(root, {
							lessonPaths: [filename],
							sources: { [filename]: source },
							identitySession,
						});
						return persistCourseIdentity(root, resolved);
					}),
				"write",
			);
		await save(next);
	});
	it("retains snapshot proofs across post-save session seeding", async () => {
		const validation = vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord");
		validation.mockClear();
		expect((await loadIdentityStore(root)).heads.map((head) => head.path)).toEqual([filename]);
		const last =
			"# Practice\n\nA stable practice paragraph keeps its original identity through Revision five.\n";
		expect((await save(last)).writeResult).toEqual({});
		expect(validation).toHaveBeenCalledTimes(1);
		expect(await readFile(join(root, filename), "utf8")).toBe(last);
	});
});

it("refuses a tampered old snapshot cached by a previous public save", async () => {
	const { root, historical, validation } = await fixture(true);
	io.fixedChangeTime = true;
	await writeLessonSource(root, filename, next, sources[2]);
	const directory = join(root, ".praxity/identity/lessons");
	const heads = await Promise.all(
		(await readdir(directory)).map(async (name) => {
			const path = join(directory, name);
			return { path, text: await readFile(path, "utf8") };
		}),
	);
	validation.mockClear();
	await writeFile(historical.path, historical.text.replace("Revision one.", "Revision owe."));
	await expect(writeLessonSource(root, filename, sources[0], next)).rejects.toThrow(
		/hash mismatch/,
	);
	expect(validation.mock.calls.some(([text]) => text.includes("Revision owe."))).toBe(true);
	expect(await readFile(join(root, filename), "utf8")).toBe(next);
	for (const head of heads) expect(await readFile(head.path, "utf8")).toBe(head.text);
	expect(await readdir(root)).not.toContain(".praxity-transaction.json");
});

it("revalidates an outside edit to a historical snapshot before refusing the save", async () => {
	const { root, historical, validation, heads } = await fixture();
	io.betweenReads = () =>
		writeFile(historical.path, historical.text.replace("Revision one.", "Revision xxx."));
	await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow(
		/hash mismatch/,
	);
	expect(validation.mock.calls.length).toBeGreaterThan(3);
	await assertUnwritten(root, heads);
	expect(await readFile(historical.path, "utf8")).toContain("Revision xxx.");
});

it("detects a tampered byte despite unchanged size, filename and mtime", async () => {
	const { root, historical, heads } = await fixture();
	await utimes(historical.path, 1_680_000_000, 1_680_000_000);
	const before = await stat(historical.path);
	io.betweenReads = async () => {
		const changed = historical.text.replace("Revision one.", "Revision owe.");
		expect(Buffer.byteLength(changed)).toBe(before.size);
		await writeFile(historical.path, changed);
		await utimes(historical.path, before.atime, before.mtime);
	};
	await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow(
		/hash mismatch/,
	);
	expect((await stat(historical.path)).size).toBe(before.size);
	expect(Math.floor((await stat(historical.path)).mtimeMs)).toBe(Math.floor(before.mtimeMs));
	await assertUnwritten(root, heads);
});

it("freshly validates an added valid historical snapshot then refuses changed inventory", async () => {
	const { root, historical, validation, heads } = await fixture();
	io.betweenReads = async () => {
		const snapshot = JSON.parse(historical.text);
		snapshot.sourceHash = "0".repeat(64);
		const text = contentIdentity.serializeIdentity(snapshot);
		const hash = createHash("sha256").update(text).digest("hex");
		await writeFile(join(root, `.praxity/identity/snapshots/${hash}.json`), text);
	};
	await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow(
		/files changed since resolution/,
	);
	expect(validation).toHaveBeenCalledTimes(4);
	await assertUnwritten(root, heads);
});

it("refuses a removed historical ancestor even when the current snapshot is intact", async () => {
	const { root, historical, heads } = await fixture();
	io.betweenReads = () => rm(historical.path);
	await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow(
		/missing parent snapshot/,
	);
	await assertUnwritten(root, heads);
});

it("revalidates an identical-byte snapshot replacement from a different file handle", async () => {
	const { root, historical, validation } = await fixture();
	const original = await stat(historical.path, { bigint: true });
	io.betweenReads = async () => {
		const replacement = join(root, "replacement.json");
		await writeFile(replacement, historical.text);
		await rename(replacement, historical.path);
		expect((await stat(historical.path, { bigint: true })).ino).not.toBe(original.ino);
	};
	expect(await writeLessonSource(root, filename, next, sources[2])).toEqual({});
	expect(validation).toHaveBeenCalledTimes(4);
	expect(await readFile(join(root, filename), "utf8")).toBe(next);
});

it("freshly validates a historical snapshot relinked to its original inode", async () => {
	const { root, historical, validation } = await fixture();
	const before = await stat(historical.path, { bigint: true });
	io.betweenReads = async () => {
		const saved = join(root, "same-inode.json");
		await link(historical.path, saved);
		await unlink(historical.path);
		await link(saved, historical.path);
		expect((await stat(historical.path, { bigint: true })).ino).toBe(before.ino);
	};
	expect(await writeLessonSource(root, filename, next, sources[2])).toEqual({});
	expect(validation).toHaveBeenCalledTimes(4);
});

for (const changeTime of [
	undefined,
	"coarse",
	"second",
	"millisecond",
	"birth",
	"zero-birth",
	"missing",
	"before-birth",
] as const) {
	it(`matches uncached results after a restored-link-count relink with ${changeTime ?? "native"} change time`, async () => {
		const { root, historical, validation } = await fixture();
		io.changeTime = changeTime;
		io.changeTimePath = historical.path.replaceAll("\\", "/");
		const expected = await loadIdentityStore(root, {
			cache: new IdentityStoreCache({ maxBytes: 0 }),
		});
		await loadIdentityStore(root);
		validation.mockClear();
		const before = await stat(historical.path, { bigint: true });
		const saved = join(root, "saved-link.json");
		await link(historical.path, saved);
		await unlink(historical.path);
		await link(saved, historical.path);
		await unlink(saved);
		const after = await stat(historical.path, { bigint: true });
		expect(after.ino).toBe(before.ino);
		expect(after.nlink).toBe(before.nlink);
		expect(await loadIdentityStore(root)).toEqual(expected);
		expect(validation.mock.calls.length).toBeLessThanOrEqual(1);
		// Identical bytes have the same result; changed bytes must never inherit that proof.
		validation.mockClear();
		const changed = `${historical.text}\n`;
		await writeFile(historical.path, changed);
		expect(await loadIdentityStore(root)).toEqual(expected);
		expect(validation).toHaveBeenCalledTimes(1);
		expect(validation.mock.calls[0][0]).toBe(changed);
	});
}

for (const changeTime of [
	"before-birth",
	"coarse",
	"second",
	"millisecond",
	"birth",
	"zero-birth",
	"missing",
] as const) {
	it(`validates only the appended snapshot in clean saves with ${changeTime} history stamps`, async () => {
		io.changeTime = changeTime;
		io.allSnapshotChangeTime = true;
		const { root, validation } = await fixture(false, true);
		let source = sources[2];
		for (const updated of [
			next,
			"# Practice\n\nA stable practice paragraph keeps its original identity through Revision five.\n",
		]) {
			validation.mockClear();
			expect(await writeLessonSource(root, filename, updated, source)).toEqual({});
			expect(validation).toHaveBeenCalledTimes(1);
			expect(await readFile(join(root, filename), "utf8")).toBe(updated);
			source = updated;
		}
	});
}

it("validates changed link count even with unchanged fine change time", async () => {
	const { root, historical, validation } = await fixture();
	io.fixedChangeTime = true;
	const expected = await loadIdentityStore(root, {
		cache: new IdentityStoreCache({ maxBytes: 0 }),
	});
	await loadIdentityStore(root);
	validation.mockClear();
	const before = await stat(historical.path, { bigint: true });
	await link(historical.path, join(root, "extra-link.json"));
	expect((await stat(historical.path, { bigint: true })).nlink).toBe(before.nlink + 1n);
	expect(await loadIdentityStore(root)).toEqual(expected);
	expect(validation).toHaveBeenCalledTimes(1);
	expect(validation.mock.calls[0][0]).toBe(historical.text);
});

it("validates changed fine change time even with restored link count", async () => {
	const { root, historical, validation } = await fixture();
	io.fixedChangeTime = true;
	io.changeTimePath = historical.path.replaceAll("\\", "/");
	const expected = await loadIdentityStore(root, {
		cache: new IdentityStoreCache({ maxBytes: 0 }),
	});
	await loadIdentityStore(root);
	validation.mockClear();
	const before = await stat(historical.path, { bigint: true });
	const saved = join(root, "fine-time-link.json");
	await link(historical.path, saved);
	await unlink(historical.path);
	await link(saved, historical.path);
	await unlink(saved);
	io.fineChangeTimeAdvance = 100n;
	expect((await stat(historical.path, { bigint: true })).nlink).toBe(before.nlink);
	expect(await loadIdentityStore(root)).toEqual(expected);
	expect(validation).toHaveBeenCalledTimes(1);
	expect(validation.mock.calls[0][0]).toBe(historical.text);
});

it("reuses identical coarse history at persistence inside a public save", async () => {
	const { root, historical, validation } = await fixture();
	io.changeTime = "coarse";
	io.changeTimePath = historical.path.replaceAll("\\", "/");
	await writeLessonSource(root, filename, next, sources[2]);
	validation.mockClear();
	io.courseReads = 0;
	io.betweenReads = async () => {
		const saved = join(root, "restored-link.json");
		await link(historical.path, saved);
		await unlink(historical.path);
		await link(saved, historical.path);
		await unlink(saved);
	};
	const last =
		"# Practice\n\nA stable practice paragraph keeps its original identity through Revision five.\n";
	expect(await writeLessonSource(root, filename, last, next)).toEqual({});
	expect(validation.mock.calls.filter(([text]) => text === historical.text)).toHaveLength(0);
	expect(validation).toHaveBeenCalledTimes(1);
	expect(await readFile(join(root, filename), "utf8")).toBe(last);
});

it("reuses identical coarse history in a retained identity session", async () => {
	const { root, historical, validation } = await fixture();
	io.changeTime = "coarse";
	io.changeTimePath = historical.path.replaceAll("\\", "/");
	const options = { lessonPaths: [filename], identitySession: new CourseIdentitySession(root) };
	const expected = await resolveCourseIdentity(root, options);
	validation.mockClear();
	expect((await resolveCourseIdentity(root, options)).identity).toEqual(expected.identity);
	expect(validation).not.toHaveBeenCalled();
});

it("reuses validated coarse history during post-save session seeding", async () => {
	const { root, historical, validation } = await fixture();
	io.changeTime = "coarse";
	io.changeTimePath = historical.path.replaceAll("\\", "/");
	await withProjectFileTransaction(
		root,
		() =>
			withIdentityStoreReuse(async () => {
				const resolved = await resolveCourseIdentity(root, {
					lessonPaths: [filename],
					sources: { [filename]: next },
					identitySession: new CourseIdentitySession(root),
				});
				expect((await persistCourseIdentity(root, resolved)).writeResult).toEqual({});
			}),
		"write",
	);
	expect(validation.mock.calls.filter(([text]) => text === historical.text)).toHaveLength(1);
	expect(validation).toHaveBeenCalledTimes(3);
	expect(await readFile(join(root, filename), "utf8")).toBe(next);
});

it("freshly validates history after a snapshot directory case-only rename", async () => {
	const { root, validation } = await fixture();
	io.betweenReads = () =>
		rename(join(root, ".praxity/identity/snapshots"), join(root, ".praxity/identity/SNAPSHOTS"));
	if (process.platform === "linux")
		await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow();
	else {
		expect(await writeLessonSource(root, filename, next, sources[2])).toEqual({});
		expect(validation).toHaveBeenCalledTimes(6);
	}
});

it("freshly validates changed exact JSON bytes even when their canonical hash still matches", async () => {
	const { root, historical, validation, heads } = await fixture();
	io.fixedChangeTime = true;
	io.betweenReads = () => writeFile(historical.path, `${historical.text} `);
	await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow(
		/files changed since resolution/,
	);
	expect(validation).toHaveBeenCalledTimes(4);
	await assertUnwritten(root, heads);
});

for (const throws of [false, true]) {
	it(`revokes in-flight resolution evidence when its scope ${throws ? "throws" : "returns"}`, async () => {
		const { root, validation } = await fixture(true);
		await withProjectFileTransaction(
			root,
			async () => {
				let release!: () => void;
				let signal!: () => void;
				const gate = new Promise<void>((resolve) => {
					release = resolve;
				});
				const reached = new Promise<void>((resolve) => {
					signal = resolve;
				});
				let escaped!: Promise<unknown>;
				io.sourceRead = async () => {
					signal();
					await gate;
				};
				const scope = withIdentityStoreReuse(async () => {
					escaped = resolveCourseIdentity(root, {
						lessonPaths: [filename],
						sources: { [filename]: next },
					}).then((result) => persistCourseIdentity(root, result));
					await reached;
					expect(validation).toHaveBeenCalledTimes(3);
					if (throws) throw new Error("scope failed");
				});
				try {
					if (throws) await expect(scope).rejects.toThrow("scope failed");
					else await scope;
				} finally {
					// Revoke global retention through its interface so this assertion isolates save-local evidence.
					await expect(
						loadIdentityStore(root, { expectedCourseId: "00000000-0000-4000-8000-000000000000" }),
					).rejects.toThrow(/namespace mismatch/);
					release();
				}
				await escaped;
				expect(validation).toHaveBeenCalledTimes(6);
				expect(await readFile(join(root, filename), "utf8")).toBe(next);
			},
			"write",
		);
	});
}

it("freshly validates a course file case-only rename during a public save", async () => {
	const { root, validation } = await fixture(true);
	io.fixedChangeTime = true;
	io.betweenReads = () =>
		rename(
			join(root, ".praxity/identity/course.json"),
			join(root, ".praxity/identity/COURSE.json"),
		);
	if (process.platform === "linux") {
		await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow();
	} else {
		expect(await writeLessonSource(root, filename, next, sources[2])).toEqual({});
		expect(validation).toHaveBeenCalledTimes(6);
		expect(await readFile(join(root, filename), "utf8")).toBe(next);
	}
});

it.skipIf(process.platform === "win32")(
	"refuses a course symlink replacement after its path check",
	async () => {
		const { root, heads } = await fixture(true);
		io.betweenReads = async () => {
			const course = join(root, ".praxity/identity/course.json");
			const moved = join(root, ".praxity/identity/course-original.json");
			await rename(course, moved);
			await symlink(moved, course);
		};
		await expect(writeLessonSource(root, filename, next, sources[2])).rejects.toThrow(
			/symbolic|ELOOP/i,
		);
		await assertUnwritten(root, heads);
	},
);

it.skipIf(process.platform === "win32")(
	"refuses a course symlink to the original inode before path checking without writes",
	async () => {
		const { root, heads, snapshotPaths } = await fixture(true);
		io.fixedChangeTime = true;
		const course = join(root, ".praxity/identity/course.json");
		const original = await stat(course, { bigint: true });
		const paths = [course, ...snapshotPaths];
		const before = await Promise.all(
			paths.map(async (path) => ({ path, bytes: await readFile(path) })),
		);
		await expect(
			writeLessonSource(root, filename, next, sources[2], {
				get additionalChanges() {
					const moved = join(root, ".praxity/identity/course-original.json");
					renameSync(course, moved);
					symlinkSync(moved, course);
					return [];
				},
			}),
		).rejects.toMatchObject({
			code: "EIDENTITY",
			messageRef: {
				key: "desktop.identity.plainStoreRequired",
				args: { path: ".praxity/identity/course.json" },
			},
		});
		expect((await stat(course, { bigint: true })).ino).toBe(original.ino);
		for (const saved of before) expect((await readFile(saved.path)).equals(saved.bytes)).toBe(true);
		await assertUnwritten(root, heads);
	},
);
