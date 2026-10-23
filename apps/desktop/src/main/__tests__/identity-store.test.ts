import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeIdentity } from "@praxity/content-identity";
import { readLesson, readSelfCheckContent } from "@praxity/grammar/src/read-lesson.ts";
import { applyOperation } from "@praxity/operations";
import { afterEach, expect, it } from "vitest";
import {
	assertIdentityExportable,
	loadIdentityStore,
	persistCourseIdentity,
	readCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { projectLockCacheDirectory } from "../path-security";
import {
	readProjectRecoveryEvidence,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const roots: string[] = [];
function present<T>(value: T | undefined | null): T {
	if (value === undefined || value === null) throw new Error("Missing test fixture value");
	return value;
}
const source = "# Safety at work\n\nKeep a clear path to every emergency exit.\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
async function project(text = source) {
	const root = await mkdtemp(join(tmpdir(), "i4-store-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), text);
	return root;
}

async function prepareRecordedEdit(
	root: string,
	operation: "setPageTitle" | "setProperty",
	path: number[],
	args: Record<string, unknown>,
) {
	const base = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
	const text = present(base.lessons.get("lesson.prax")).tree.stream.source;
	const target = present(
		base.identity.sourceMappings.find((node) => node.path.join() === path.join()),
	);
	const plan = applyOperation(
		[{ path: "lesson.prax", source: text }],
		{
			transactionId: randomUUID(),
			operation,
			files: [{ path: "lesson.prax", baseRevision: digest(text) }],
			targets: [
				{
					file: "lesson.prax",
					ref: { kind: "node", nodeId: target.id, path, fingerprint: target.fingerprint },
					expectedText: text.slice(target.span.start, target.span.end),
				},
			],
			args,
		},
		{
			identity: base.identity,
			activeHistoryIds: base.activeHistoryIds,
			readerRoles: true,
			allocateId: randomUUID,
			digest,
		},
	);
	if (!plan.ok) throw new Error(`Operation refused: ${plan.code}`);
	return resolveCourseIdentity(root, {
		lessonPaths: ["lesson.prax"],
		operationBase: base,
		operationPlan: plan,
		operations: plan.evidence,
		sources: Object.fromEntries(plan.history.after.map((file) => [file.path, file.source])),
	});
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bytes(root: string, prefix = ""): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	const directory = await lstat(join(root, prefix));
	const names = (await readdir(join(root, prefix))).sort();
	// Access times include this helper's own reads on Windows. The timestamps
	// below detect file replacement and directory creation, deletion or rewriting.
	result[prefix || "."] = {
		type: "directory",
		names,
		mtime: directory.mtimeMs,
		ctime: directory.ctimeMs,
		birthtime: directory.birthtimeMs,
	};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, path));
		else {
			const file = await lstat(join(root, path));
			result[path] = {
				type: "file",
				bytes: (await readFile(join(root, path))).toString("base64"),
				mtime: file.mtimeMs,
				ctime: file.ctimeMs,
				birthtime: file.birthtimeMs,
			};
		}
	}
	return result;
}

async function privateLockState(root: string) {
	const canonical = await realpath(root);
	const path = join(
		projectLockCacheDirectory(),
		`${digest(process.platform === "win32" ? canonical.toLowerCase() : canonical)}.sqlite`,
	);
	const file = await lstat(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return null;
	});
	return (
		file && {
			bytes: (await readFile(path)).toString("base64"),
			mtime: file.mtimeMs,
			ctime: file.ctimeMs,
			birthtime: file.birthtimeMs,
		}
	);
}

it("I4 first-read-lock creates no private lock file or cache directory", async () => {
	const root = await project();
	const canonical = await realpath(root);
	const key = digest(process.platform === "win32" ? canonical.toLowerCase() : canonical);
	const lock = join(projectLockCacheDirectory(), `${key}.sqlite`);
	expect(await lstat(lock).catch(() => null)).toBeNull();
	const cacheBefore = await lstat(projectLockCacheDirectory()).catch(() => null);
	const before = await bytes(root);
	await loadIdentityStore(root);
	await readCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
	expect(await lstat(lock).catch(() => null)).toBeNull();
	const cacheAfter = await lstat(projectLockCacheDirectory()).catch(() => null);
	expect(cacheAfter?.ino).toBe(cacheBefore?.ino);
	expect(await bytes(root)).toEqual(before);
});

for (const mutation of ["source", "namespace"] as const) {
	it(`I4 refuses persist-${mutation}-race after validation without changing source or identity`, async () => {
		const root = await project();
		await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		return withProjectFileTransaction(
			root,
			async () => {
				const result = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				const before = await bytes(root);
				const saving = persistCourseIdentity(root, result);
				if (mutation === "source")
					present(result.lessons.get("lesson.prax")).tree.stream.source = source.replace(
						"clear path",
						"different escape route",
					);
				else result.identity.course.courseId = randomUUID();
				await expect(saving).rejects.toThrow(/changed|revision/);
				expect(await bytes(root)).toEqual(before);
				const stored = await loadIdentityStore(root);
				expect(stored.snapshots[0].sourceHash).toBe(
					digest(await readFile(join(root, "lesson.prax"), "utf8")),
				);
			},
			"write",
			false,
		);
	});
}

for (const copy of [false, true]) {
	it(`I4 refuses an omitted live lesson${copy ? " used as a copy donor" : ""}, naming its path`, async () => {
		const root = await project();
		const first = await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		await writeFile(
			join(root, "copy.prax"),
			copy ? source : "# Other page\n\nDifferent exercise.\n",
		);
		const before = await bytes(root);
		await expect(resolveCourseIdentity(root, { lessonPaths: ["copy.prax"] })).rejects.toThrow(
			/inventory.*omits.*lesson\.prax/,
		);
		expect(await bytes(root)).toEqual(before);
		const complete = await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax", "copy.prax"] }),
				),
			"write",
			false,
		);
		const originalIds = [...present(first.lessons.get("lesson.prax")).nodes.keys()];
		expect([...present(complete.lessons.get("lesson.prax")).nodes.keys()]).toEqual(originalIds);
		expect(
			[...present(complete.lessons.get("copy.prax")).nodes.keys()].every(
				(id) => !originalIds.includes(id),
			),
		).toBe(true);
	}, 10_000);
}

for (const when of ["before admission", "after staging"] as const) {
	it(`I4 refuses a deleted rename donor recreated ${when} without transferring its IDs`, async () => {
		const root = await project();
		const first = await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		await rename(join(root, "lesson.prax"), join(root, "copy.prax"));
		return withProjectFileTransaction(
			root,
			async () => {
				const renamed = await resolveCourseIdentity(root, { lessonPaths: ["copy.prax"] });
				expect([...present(renamed.lessons.get("copy.prax")).nodes.keys()]).toEqual([
					...present(first.lessons.get("lesson.prax")).nodes.keys(),
				]);
				if (when === "before admission") await writeFile(join(root, "lesson.prax"), source);
				let recreated = false;
				await expect(
					persistCourseIdentity(root, renamed, [], {
						onStep: async ({ kind }) => {
							if (when === "after staging" && kind === "staged" && !recreated) {
								recreated = true;
								await writeFile(join(root, "lesson.prax"), source);
							}
						},
					}),
				).rejects.toThrow(/inventory.*lesson\.prax|changed on disk|already exists/i);
				expect((await loadIdentityStore(root)).heads).toEqual(first.identity.heads);
				expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
				expect(await readFile(join(root, "copy.prax"), "utf8")).toBe(source);
			},
			"write",
			false,
		);
	}, 10_000);
}

it("I4 preserves lesson identity when the deleted path's parent directory was renamed", async () => {
	const root = await project();
	await mkdir(join(root, "old"));
	await rename(join(root, "lesson.prax"), join(root, "old/lesson.prax"));
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["old/lesson.prax"] }),
			),
		"write",
		false,
	);
	await rename(join(root, "old"), join(root, "renamed"));
	const moved = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["renamed/lesson.prax"] }),
			),
		"write",
		false,
	);
	expect([...present(moved.lessons.get("renamed/lesson.prax")).nodes.keys()]).toEqual([
		...present(first.lessons.get("old/lesson.prax")).nodes.keys(),
	]);
	expect((await loadIdentityStore(root)).heads).toEqual(moved.identity.heads);
}, 10_000);

it("I4 accepts a complete inventory after a filename case-only rename", async () => {
	const root = await project();
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	await rename(join(root, "lesson.prax"), join(root, "LESSON.prax"));
	const moved = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["LESSON.prax"] }),
			),
		"write",
		false,
	);
	expect([...present(moved.lessons.get("LESSON.prax")).nodes.keys()]).toEqual([
		...present(first.lessons.get("lesson.prax")).nodes.keys(),
	]);
	expect((await loadIdentityStore(root)).heads).toEqual(moved.identity.heads);
}, 10_000);

for (const evidence of ["recovery archives", "archived legacy identity"] as const) {
	it(`I4 refuses missing identity with ${evidence} instead of allocating a new namespace`, async () => {
		const root = await project();
		if (evidence === "recovery archives") {
			await withProjectFileTransaction(
				root,
				async () =>
					persistCourseIdentity(
						root,
						await resolveCourseIdentity(root, {
							lessonPaths: ["lesson.prax"],
							sources: { "lesson.prax": source.replace("clear path", "clear way") },
						}),
					),
				"write",
				false,
			);
			await withProjectFileTransaction(
				root,
				async () =>
					persistCourseIdentity(
						root,
						await resolveCourseIdentity(root, {
							lessonPaths: ["lesson.prax"],
							sources: { "lesson.prax": source.replace("clear path", "clear route") },
						}),
					),
				"write",
				false,
			);
			// I4 has pruned its intact-store archives. A later T1 write retains fresh evidence.
			const coursePath = ".praxity/identity/course.json";
			await writeProjectFiles(root, [
				{ path: coursePath, content: `${await readFile(join(root, coursePath), "utf8")}\n` },
			]);
			expect(
				(await readdir(root)).filter((name) => name.startsWith(".praxity-write-")),
			).toHaveLength(1);
			// Rename simulates missing metadata without deleting the evidence being tested.
			await rename(join(root, ".praxity/identity"), join(root, "lost-identity"));
		} else {
			await mkdir(join(root, ".praxity/.praxity-write-content-identity.json.archive"), {
				recursive: true,
			});
			await writeFile(
				join(root, ".praxity/.praxity-write-content-identity.json.archive/original"),
				"old identity bytes",
			);
		}
		const before = await bytes(root);
		await expect(resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).rejects.toThrow(
			/missing.*identity.*established course/,
		);
		expect(await bytes(root)).toEqual(before);
	}, 15_000);
}

it.each([
	{ roles: ["option-feedback"], exportable: true },
	{ roles: ["option-feedback", "stem"], exportable: false },
	{ roles: ["option-feedback", "caption"], exportable: false },
])(
	"C06c1 strict export of a store persisted without $roles reader records",
	async ({ roles, exportable }) => {
		const root = await project(
			"# Page\n\n::: choice Q\n(x) A\nfeedback: First.\n( ) B\nfeedback: Second.\n( ) C\nfeedback: Third.\n:::\n\n::: video clip.mp4\ncaption: A caption.\n:::\n",
		);
		await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		const stored = await loadIdentityStore(root);
		const snapshot = structuredClone(stored.snapshots[0]);
		const removed = Object.entries(snapshot.nodes).filter(([, node]) =>
			roles.some((role) => node.type === `reader-role:${role}`),
		);
		expect(removed.length).toBeGreaterThan(0);
		// Recreate the earlier persisted schema without changing source or any surviving ID.
		for (const [id] of removed) delete snapshot.nodes[id];
		const serialized = serializeIdentity(snapshot);
		const hash = digest(serialized);
		await writeFile(join(root, `.praxity/identity/snapshots/${hash}.json`), serialized);
		await writeFile(
			join(root, `.praxity/identity/lessons/${snapshot.lessonId}.json`),
			serializeIdentity({ ...stored.heads[0], head: hash }),
		);
		const before = await bytes(root);
		const strict = resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"], strict: true });
		if (exportable) {
			const result = await strict;
			expect(() => assertIdentityExportable(result)).not.toThrow();
			const lesson = present(result.lessons.get("lesson.prax"));
			expect(
				[...lesson.nodes.values()].filter((record) => record.role === "option-feedback"),
			).toHaveLength(3);
			for (const id of Object.keys(snapshot.nodes))
				expect(result.identity.snapshots[0].nodes[id]).toEqual(snapshot.nodes[id]);
			const pageId = present(
				Object.entries(snapshot.nodes).find(([, node]) => node.kind === "page"),
			)[0];
			await expect(
				resolveCourseIdentity(root, {
					lessonPaths: ["lesson.prax"],
					strict: true,
					slugRenames: { [pageId]: "unpersisted-page-slug" },
				}),
			).rejects.toThrow(/export refused.*persist/s);
		} else {
			await expect(strict).rejects.toThrow(/export refused.*persist/s);
		}
		expect(await bytes(root)).toEqual(before);
	},
);

for (const replacement of [
	"unpersisted source",
	"transient reader",
	"unpersisted reader IDs",
	"transient provider",
	"persisted read",
] as const) {
	it(`I4 export binds the persisted revision and refuses ${replacement}, naming page and block`, async () => {
		const root = await project();
		let result = await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		expect(() => assertIdentityExportable(result)).not.toThrow();
		return withProjectFileTransaction(
			root,
			async () => {
				if (replacement === "unpersisted source")
					result = await resolveCourseIdentity(root, {
						lessonPaths: ["lesson.prax"],
						sources: { "lesson.prax": source.replace("clear path", "clear route") },
					});
				else if (replacement === "persisted read")
					result = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				else if (replacement === "transient provider")
					Object.assign(present(result.ids.get("lesson.prax")), { transient: true });
				else {
					const lesson = readLesson(source);
					if (replacement === "unpersisted reader IDs") lesson.transientIds = false;
					result.lessons.set("lesson.prax", lesson);
				}
				const before = await bytes(root);
				expect(() => assertIdentityExportable(result)).toThrow(
					/lesson\.prax.*Safety at work.*body.*persist|persist.*lesson\.prax.*Safety at work.*body/s,
				);
				expect(await bytes(root)).toEqual(before);
			},
			"write",
			false,
		);
	});
}

it("I4 export refuses mutated lesson bytes even when its identity object is unchanged", async () => {
	const root = await project();
	const result = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	present(result.lessons.get("lesson.prax")).tree.stream.source = source.replace(
		"clear path",
		"unpersisted escape route",
	);
	expect(() => assertIdentityExportable(result)).toThrow(/Safety at work.*body.*persist/);
});

it("I4 admits a valid self-check for export", async () => {
	const root = await project(
		"# Practice\n\n::: self-check Task\nmodel: Model\n:: Criterion\nmissed: Hint\n:::\n",
	);
	const result = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	expect(() => assertIdentityExportable(result)).not.toThrow();
});

it("I4 keeps self-check criterion IDs through a reorder and never reuses one for a copy", async () => {
	const reason = ":: Reason\nmissed: Explain the cause.\nevidence: late\n";
	const respect = ":: Respect\nmissed: Ask politely.\n";
	const text = (criteria: string) =>
		`# Practice\n\n::: self-check Task\nmodel: The data arrived late.\n${criteria}:::\n`;
	const root = await project(text(reason + respect));
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const criteria = (result: typeof first) => {
		const lesson = present(result.lessons.get("lesson.prax"));
		const block = present(lesson.blocks.find((b) => b.type === "selfCheck"));
		return readSelfCheckContent(lesson, block.id).parts.map((part) => [part.label, part.id]);
	};
	const [[, reasonId], [, respectId]] = criteria(first);
	expect(reasonId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	const reordered = await resolveCourseIdentity(root, {
		lessonPaths: ["lesson.prax"],
		sources: { "lesson.prax": text(respect + reason) },
	});
	expect(criteria(reordered)).toEqual([
		["Respect", respectId],
		["Reason", reasonId],
	]);
	const copy = await resolveCourseIdentity(root, {
		lessonPaths: ["lesson.prax"],
		sources: { "lesson.prax": text(reason + respect + respect) },
	});
	const copied = criteria(copy);
	expect(copied.map(([label]) => label)).toEqual(["Reason", "Respect", "Respect"]);
	expect(copied[0][1]).toBe(reasonId);
	// As with checklist tasks, an exact source copy is ambiguous: both get new pending IDs
	// until the author resolves it, so neither silently takes the original identity.
	const copies = [copied[1][1], copied[2][1]];
	expect(new Set([reasonId, respectId, ...copies]).size).toBe(4);
	const snapshot = present(copy.identity.snapshots.at(-1));
	expect(copies.map((id) => snapshot.nodes[id].status)).toEqual(["pending", "pending"]);
});

it("I4 keeps readers for identical lesson sources independently mutable", async () => {
	const root = await project();
	await writeFile(join(root, "copy.prax"), source);
	const result = await resolveCourseIdentity(root, {
		lessonPaths: ["lesson.prax", "copy.prax"],
		lessonReads: new Map(),
	});
	const lesson = present(result.lessons.get("lesson.prax"));
	const copy = present(result.lessons.get("copy.prax"));
	lesson.tree.stream.source = "# Changed lesson\n";
	lesson.frontmatter.title = "Changed title";
	expect(copy.tree.stream.source).toBe(source);
	expect(copy.frontmatter.title).toBeUndefined();
});

it("I4 export refuses altered rendered content even when source bytes and IDs are unchanged", async () => {
	const root = await project();
	const result = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const lesson = present(result.lessons.get("lesson.prax"));
	const body = present(lesson.blocks.find((block) => block.type === "text"));
	body.data.content = "<p>Unpersisted content.</p>";
	// A changed parse tree must not become the publication comparison's new authority.
	const paragraph = present(lesson.nodes.get(body.id));
	paragraph.node.raw = "Unpersisted content.";
	expect(() => assertIdentityExportable(result)).toThrow(/Safety at work.*body.*persist/);
});

for (const target of ["page", "block"] as const) {
	it(`I4 export refuses an unpersisted ${target} ID in the emitted reader output`, async () => {
		const root = await project();
		const result = await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		const lesson = present(result.lessons.get("lesson.prax"));
		if (target === "page") lesson.pages[0].id = randomUUID();
		else lesson.blocks[0].id = randomUUID();
		expect(() => assertIdentityExportable(result)).toThrow(/Safety at work.*body.*persist/);
	});
}

it("I4 names the new page and body when export receives an entirely unpersisted reader", async () => {
	const root = await project();
	const result = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	result.lessons.set("lesson.prax", readLesson("# Unpersisted page\n\nNew unpersisted prose.\n"));
	expect(() => assertIdentityExportable(result)).toThrow(/Unpersisted page.*body.*persist/);
});

it("I4 cannot promote a transient read to export by changing its public flags", async () => {
	const root = await project();
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	return withProjectFileTransaction(
		root,
		async () => {
			const result = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			result.transientIds = false;
			present(result.lessons.get("lesson.prax")).transientIds = false;
			Object.assign(present(result.ids.get("lesson.prax")), { transient: false });
			expect(() => assertIdentityExportable(result)).toThrow(/Safety at work.*body.*persist/);
		},
		"write",
		false,
	);
});

for (const existing of [false, true]) {
	it(`I4 read-only ${existing ? "established" : "new"} resolve changes no bytes and marks its provider transient`, async () => {
		const root = await project();
		if (existing)
			await withProjectFileTransaction(
				root,
				async () =>
					persistCourseIdentity(
						root,
						await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
					),
				"write",
				false,
			);
		const before = await bytes(root);
		const lockBefore = await privateLockState(root);
		const result = await readCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
		expect(result.transientIds).toBe(true);
		expect(present(result.ids.get("lesson.prax")).transient).toBe(true);
		const reread = readLesson(source, { ids: result.ids.get("lesson.prax") });
		expect(reread.transientIds).toBe(true);
		expect([...reread.nodes.keys()]).toEqual([
			...present(result.lessons.get("lesson.prax")).nodes.keys(),
		]);
		expect(await bytes(root)).toEqual(before);
		expect(await privateLockState(root)).toEqual(lockBefore);
	});
}

it("I4 persists every reader role and binds reordered blanks to descriptor IDs", async () => {
	const text =
		"# Practice\n\n::: match Match the equipment\n- Helmet -> Head\n- Gloves -> Hands\n:::\n\n::: rating Confidence {scale=3}\n:::\n\n::: fill-blank Complete the safety advice\nWear {boots} and {gloves}.\n:::\n";
	const root = await project(text);
	return withProjectFileTransaction(
		root,
		async () => {
			const first = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			await persistCourseIdentity(root, first);
			const stored = await loadIdentityStore(root);
			const nodes = stored.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes));
			expect(nodes).toEqual(
				expect.arrayContaining([...present(first.lessons.get("lesson.prax")).nodes.keys()]),
			);
			const moved = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": text.replace("{boots} and {gloves}", "{gloves} and {boots}") },
			});
			const blanks = (result: typeof first) =>
				present(
					present(result.lessons.get("lesson.prax")).blocks.find(
						(block) => (block.data.response as { type?: string } | undefined)?.type === "fillBlank",
					),
				).data.response as { blanks: { id: string }[] };
			expect(blanks(moved).blanks.map((blank) => blank.id)).toEqual(
				blanks(first)
					.blanks.map((blank) => blank.id)
					.reverse(),
			);
		},
		"write",
		false,
	);
});

it("I4 resolve, persist and reload retain every reader ID and source byte", async () => {
	const root = await project();
	return withProjectFileTransaction(
		root,
		async () => {
			const first = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			const durable = await persistCourseIdentity(root, first);
			expect(durable.transientIds).toBe(false);
			const reloaded = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			expect([...present(reloaded.lessons.get("lesson.prax")).nodes.keys()]).toEqual([
				...present(first.lessons.get("lesson.prax")).nodes.keys(),
			]);
			expect(reloaded.identity.course).toEqual(first.identity.course);
			expect(reloaded.identity.heads).toEqual(durable.identity.heads);
			const stored = await loadIdentityStore(root);
			expect(stored.course).toEqual(first.identity.course);
			expect(stored.snapshots).toEqual(durable.identity.snapshots);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
		},
		"write",
		false,
	);
});

it("I4 allocates slugs once, preserves them through title edits, and retains rename aliases", async () => {
	const root = await project();
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const page = present(first.lessons.get("lesson.prax")).pages[0];
	expect(first.identity.snapshots[0].nodes[page.id].slug).toBe("safety-at-work");
	return withProjectFileTransaction(
		root,
		async () => {
			const edit = await prepareRecordedEdit(root, "setPageTitle", [0], {
				title: "Safety at work today",
			});
			expect(present(edit.lessons.get("lesson.prax")).pages[0].id).toBe(page.id);
			expect(edit.identity.snapshots[0].nodes[page.id].slug).toBe("safety-at-work");
			expect(edit.identity.snapshots[0].nodes[page.id].aliases).toEqual(["safety-at-work-today"]);
			await persistCourseIdentity(root, edit);
			const renamed = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				slugRenames: { [page.id]: "emergency-safety" },
			});
			await persistCourseIdentity(root, renamed);
			const stored = await loadIdentityStore(root);
			expect(stored.snapshots[0].nodes[page.id]).toMatchObject({
				slug: "emergency-safety",
				aliases: ["safety-at-work-today", "safety-at-work"],
			});
			const newPage = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: {
					"lesson.prax": `${source.replace("Safety at work", "Safety at work today")}\n# Safety at work\n\nA different page.\n`,
				},
			});
			expect(
				newPage.identity.snapshots
					.flatMap((snapshot) => Object.values(snapshot.nodes))
					.filter((node) => node.kind === "page" && node.status === "active")
					.map((node) => node.slug),
			).toEqual(["emergency-safety", "safety-at-work-2"]);
		},
		"write",
		false,
	);
}, 15_000);

for (const text of [
	"# Equipment check\n\n::: choice PPE question\n:::\n",
	`${source}\nKeep a clear path to every emergency exit.\n`,
]) {
	it(`I4 export refusal names ${text.includes("choice") ? "the source error before rederive" : "the page and pending block"}`, async () => {
		const root = await project();
		await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		const before = await bytes(root);
		return withProjectFileTransaction(
			root,
			async () => {
				const result = await resolveCourseIdentity(root, {
					lessonPaths: ["lesson.prax"],
					sources: { "lesson.prax": text },
				});
				expect(() => assertIdentityExportable(result)).toThrow(
					text.includes("choice") ? "lesson.prax:3" : /Safety at work.*body.*Keep a clear path/s,
				);
				expect(await bytes(root)).toEqual(before);
			},
			"write",
			false,
		);
	});
}

for (const [target, damage, message] of [
	["course", "{", /course\.json.*corrupt JSON/],
	["course", '{"schema":99}', /course\.json.*unknown schema/],
	["course", "<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n", /course\.json.*conflict markers/],
	["head", '{"schema":99}', /lessons.*unknown schema/],
	["snapshot", "{", /snapshots.*corrupt JSON/],
	["snapshot", "namespace", /snapshots.*namespace mismatch/],
	["snapshot", "hash", /snapshots.*hash mismatch/],
	["snapshot", "missing", /missing snapshot/],
	["course", "missing", /missing.*course\.json.*established/],
	["head", "missing", /missing lesson head/],
] as const) {
	it(`I4 refuses ${damage} ${target} metadata with the file named and no writes`, async () => {
		const root = await project();
		return withProjectFileTransaction(
			root,
			async () => {
				const resolved = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				await persistCourseIdentity(root, resolved);
				const reload = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				const snapshot = reload.identity.snapshots[0];
				const path =
					target === "course"
						? ".praxity/identity/course.json"
						: target === "head"
							? `.praxity/identity/lessons/${snapshot.lessonId}.json`
							: `.praxity/identity/snapshots/${reload.identity.heads[0].head}.json`;
				if (damage === "missing") await rm(join(root, path));
				else if (damage === "namespace" || damage === "hash") {
					const changed = structuredClone(snapshot);
					if (damage === "namespace") changed.courseId = "11111111-1111-4111-8111-111111111111";
					else changed.sourceHash = "0".repeat(64);
					await writeFile(join(root, path), serializeIdentity(changed));
				} else await writeFile(join(root, path), damage);
				const before = await bytes(root);
				await expect(resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).rejects.toThrow(
					message,
				);
				if (target === "snapshot")
					await expect(persistCourseIdentity(root, reload)).rejects.toThrow(message);
				else
					await expect(persistCourseIdentity(root, reload)).rejects.toMatchObject({
						code: "ECONFLICT",
						message: "Identity: files changed on disk since resolution",
					});
				expect(await bytes(root)).toEqual(before);
			},
			"write",
			false,
		);
	});
}

it("I4 refuses an expected namespace mismatch and source conflict markers without writes", async () => {
	const root = await project();
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const before = await bytes(root);
	await expect(
		resolveCourseIdentity(root, {
			lessonPaths: ["lesson.prax"],
			expectedCourseId: "11111111-1111-4111-8111-111111111111",
		}),
	).rejects.toThrow(/namespace mismatch/);
	await expect(
		resolveCourseIdentity(root, {
			lessonPaths: ["lesson.prax"],
			sources: {
				"lesson.prax":
					"# One {hideTitle}\n\n<<<<<<< ours\n\n## One {level=1}\n\n=======\n\n## Two {level=1}\n\n::: quote\n>>>>>> theirs\n:::\n",
			},
		}),
	).rejects.toThrow(/source conflict markers/);
	expect(await bytes(root)).toEqual(before);
});

it("I4 refuses missing identity when narration or a host establishes the course", async () => {
	const root = await project();
	await writeFile(join(root, "narration.yaml"), "version: 2\nlessons: {}\n");
	const before = await bytes(root);
	await expect(resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).rejects.toThrow(
		/established course/,
	);
	expect(await bytes(root)).toEqual(before);
	await rm(join(root, "narration.yaml"));
	await expect(
		resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"], established: true }),
	).rejects.toThrow(/established course/);
});

it("I4 prepares immutable snapshots before source and installs lesson heads last", async () => {
	const root = await project();
	return withProjectFileTransaction(
		root,
		async () => {
			const result = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": source.replace("clear path", "clear route") },
			});
			const staged: string[] = [];
			const installed: { path: string; kind: string }[] = [];
			await persistCourseIdentity(root, result, [], {
				onStep: async ({ kind, index }) => {
					if (index === undefined) return;
					const journal = JSON.parse(
						await readFile(join(root, ".praxity-transaction.json"), "utf8"),
					);
					const path = journal.plan.files[index].path as string;
					if (kind === "staged") staged.push(path);
					if (kind === "installed" || kind === "head") installed.push({ path, kind });
				},
			});
			expect(staged.findIndex((path) => path.includes("/snapshots/"))).toBeLessThan(
				staged.indexOf("lesson.prax"),
			);
			expect(installed.at(-1)?.kind).toBe("head");
			expect(installed.slice(0, -1).every((step) => step.kind === "installed")).toBe(true);
		},
		"write",
		false,
	);
});

it("I4 refuses changed source bytes, mutated resolutions and extra source writes", async () => {
	const root = await project();
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	return withProjectFileTransaction(
		root,
		async () => {
			const draft = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": source.replace("clear path", "clear route") },
			});
			await writeFile(join(root, "lesson.prax"), "# Outside edit\n\nKeep these bytes.\n");
			const outside = await bytes(root);
			await expect(persistCourseIdentity(root, draft)).rejects.toThrow(/changed on disk/);
			expect(await bytes(root)).toEqual(outside);
			await writeFile(join(root, "lesson.prax"), source);
			const result = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			present(result.lessons.get("lesson.prax")).tree.stream.source = "# Wrong revision\n";
			const before = await bytes(root);
			await expect(persistCourseIdentity(root, result)).rejects.toThrow(/source.*revision/);
			expect(await bytes(root)).toEqual(before);
			const intact = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			await expect(
				persistCourseIdentity(root, intact, [
					{ path: "unresolved.prax", content: "# Unresolved\n" },
				]),
			).rejects.toThrow(/source.*not resolved/);
			expect(await bytes(root)).toEqual(before);
		},
		"write",
		false,
	);
});

it("I4 never rewrites an existing immutable snapshot even when its JSON has whitespace", async () => {
	const root = await project();
	const result = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const path = join(root, ".praxity/identity/snapshots", `${result.identity.heads[0].head}.json`);
	const pretty = `${JSON.stringify(result.identity.snapshots[0], null, 2)}\n`;
	await writeFile(path, pretty);
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	expect(await readFile(path, "utf8")).toBe(pretty);
});

it("I4 recorded modifications retain IDs across a wholesale title change", async () => {
	const root = await project();
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const pageId = present(first.lessons.get("lesson.prax")).pages[0].id;
	const text = source.replace("Safety at work", "Emergency procedures");
	return withProjectFileTransaction(
		root,
		async () => {
			const next = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": text },
				operations: [
					{
						intent: "modify",
						files: [
							{
								path: "lesson.prax",
								fromRevision: first.identity.snapshots[0].sourceHash,
								toRevision: (await import("node:crypto"))
									.createHash("sha256")
									.update(text)
									.digest("hex"),
								fromSnapshot: first.identity.heads[0].head,
							},
						],
						mapping: [{ oldId: pageId, newId: pageId, fate: "kept" }],
						placements: [{ mappingIndex: 0, file: "lesson.prax", path: [0] }],
					},
				],
			});
			expect(present(next.lessons.get("lesson.prax")).pages[0].id).toBe(pageId);
			expect(next.identity.snapshots[0].nodes[pageId].slug).toBe("safety-at-work");
			await persistCourseIdentity(root, next);
			expect(
				present(
					(await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).lessons.get(
						"lesson.prax",
					),
				).pages[0].id,
			).toBe(pageId);
		},
		"write",
		false,
	);
}, 15_000);

it("I4 a removed rating level receives a fresh identity when reintroduced", async () => {
	const text = "# Practice\n\n::: rating Confidence {scale=3}\n:::\n";
	const root = await project(text);
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const levelId = present(
		[...present(first.lessons.get("lesson.prax")).nodes.values()].find(
			(node) => node.role === "level:3",
		),
	).id;
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await prepareRecordedEdit(root, "setProperty", [0, 0], { name: "scale", value: 2 }),
			),
		"write",
		false,
	);
	const restored = await resolveCourseIdentity(root, {
		lessonPaths: ["lesson.prax"],
		sources: { "lesson.prax": text },
	});
	expect(
		present(
			[...present(restored.lessons.get("lesson.prax")).nodes.values()].find(
				(node) => node.role === "level:3",
			),
		).id,
	).not.toBe(levelId);
}, 10_000);

it("I4 recorded undo restores removed reader roles with their exact IDs", async () => {
	const text = "# Practice\n\n::: rating Confidence {scale=3}\n:::\n";
	const root = await project(text);
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const after = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await prepareRecordedEdit(root, "setProperty", [0, 0], { name: "scale", value: 2 }),
			),
		"write",
		false,
	);
	const mapping = after.identity.inverseMapping;
	const placements = mapping.flatMap((entry, mappingIndex) => {
		if (entry.newId === null || entry.fate === "retired") return [];
		const old = first.identity.sourceMappings.find((source) => source.id === entry.newId);
		return old ? [{ mappingIndex, file: old.file, path: old.path }] : [];
	});
	return withProjectFileTransaction(
		root,
		async () => {
			const restored = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": text },
				operations: [
					{
						intent: "modify",
						inverse: true,
						files: [
							{
								path: "lesson.prax",
								fromRevision: after.identity.snapshots[0].sourceHash,
								toRevision: first.identity.snapshots[0].sourceHash,
								fromSnapshot: after.identity.heads[0].head,
							},
						],
						mapping,
						placements,
					},
				],
			});
			expect([...present(restored.lessons.get("lesson.prax")).nodes.keys()]).toEqual([
				...present(first.lessons.get("lesson.prax")).nodes.keys(),
			]);
			await persistCourseIdentity(root, restored);
			expect([
				...present(
					(await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).lessons.get(
						"lesson.prax",
					),
				).nodes.keys(),
			]).toEqual([...present(first.lessons.get("lesson.prax")).nodes.keys()]);
		},
		"write",
		false,
	);
}, 15_000);

it("I4 preserves BOM, mixed endings and Unicode and refuses invalid UTF-8", async () => {
	const text = "\uFEFF# Caf\u00e9 safety \ud83d\ude00\r\n\r\nKeep a clear path.\nNext line.\r\n";
	const root = await project(text);
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	expect(await readFile(join(root, "lesson.prax"))).toEqual(Buffer.from(text));
	await writeFile(join(root, "lesson.prax"), Buffer.from([0xff, 0xfe, 0x23]));
	const before = await bytes(root);
	await expect(resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).rejects.toThrow(
		/invalid UTF-8.*lesson\.prax/,
	);
	expect(await bytes(root)).toEqual(before);
});

it("I4 reserves index and refuses another page's slug and alias without writing", async () => {
	const text = "# Index\n\nA guide.\n\n# Practice\n\nAn exercise.\n";
	const root = await project(text);
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const [index, practice] = present(first.lessons.get("lesson.prax")).pages;
	expect(first.identity.snapshots[0].nodes[index.id].slug).toBe("index-2");
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, {
					lessonPaths: ["lesson.prax"],
					slugRenames: { [index.id]: "guide" },
				}),
			),
		"write",
		false,
	);
	const before = await bytes(root);
	for (const slug of ["index", "index-2", "guide", "Wrong Slug"]) {
		await expect(
			resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				slugRenames: { [practice.id]: slug },
			}),
		).rejects.toThrow(/slug.*reserved|invalid page slug/);
	}
	expect(await bytes(root)).toEqual(before);
}, 15_000);

it("I4 metadata plans cannot overwrite identity through a Windows path alias", async () => {
	const root = await project();
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	return withProjectFileTransaction(
		root,
		async () => {
			const result = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			const before = await bytes(root);
			await expect(
				persistCourseIdentity(root, result, [
					{ path: ".praxity\\identity\\course.json", content: "{}" },
				]),
			).rejects.toThrow(/identity files belong/);
			expect(await bytes(root)).toEqual(before);
		},
		"write",
		false,
	);
});

it("I4 export requires a persisted namespace and the resolved head revisions", async () => {
	const root = await project();
	return withProjectFileTransaction(
		root,
		async () => {
			const fresh = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			expect(() => assertIdentityExportable(fresh)).toThrow(/persist.*identity.*export/);
			const durable = await persistCourseIdentity(root, fresh);
			expect(() => assertIdentityExportable(durable)).not.toThrow();
			const draft = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				sources: { "lesson.prax": source.replace("clear path", "clear route") },
			});
			expect(() => assertIdentityExportable(draft)).toThrow(/persist.*identity.*export/);
			const readonly = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			expect(() => assertIdentityExportable(readonly)).toThrow(/Safety at work.*body.*transient/);
			const repersisted = await persistCourseIdentity(root, readonly);
			expect(() => assertIdentityExportable(repersisted)).not.toThrow();
		},
		"write",
		false,
	);
});

it("I4 moves a page and all reader IDs across lesson heads and stores variable projections", async () => {
	const second = "---\nvariables:\n  alarm: false\n---\n# Other page\n\nA different subject.\n";
	const root = await project();
	await writeFile(join(root, "second.prax"), second);
	const lessonPaths = ["lesson.prax", "second.prax"];
	const first = await withProjectFileTransaction(
		root,
		async () => persistCourseIdentity(root, await resolveCourseIdentity(root, { lessonPaths })),
		"write",
		false,
	);
	const movedIds = [...present(first.lessons.get("lesson.prax")).nodes.keys()];
	const variable = present(
		[...present(first.lessons.get("second.prax")).nodes.values()].find(
			(node) => node.role === "variable:alarm",
		),
	);
	expect(first.identity.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes))).toContain(
		variable.id,
	);
	return withProjectFileTransaction(
		root,
		async () => {
			const next = await resolveCourseIdentity(root, {
				lessonPaths,
				sources: {
					"lesson.prax": "# New cover\n\nNew content.\n",
					"second.prax": `${second}\n${source}`,
				},
			});
			expect([...present(next.lessons.get("second.prax")).nodes.keys()]).toEqual(
				expect.arrayContaining(movedIds),
			);
			const movedPage = present(
				movedIds.find((id) =>
					first.identity.snapshots.some((snapshot) => snapshot.nodes[id]?.kind === "page"),
				),
			);
			expect(
				present(next.identity.snapshots.find((snapshot) => snapshot.nodes[movedPage])).nodes[
					movedPage
				].slug,
			).toBe("safety-at-work");
			await persistCourseIdentity(root, next);
			const reload = await resolveCourseIdentity(root, { lessonPaths });
			expect([...present(reload.lessons.get("second.prax")).nodes.keys()]).toEqual([
				...present(next.lessons.get("second.prax")).nodes.keys(),
			]);
			expect(() => assertIdentityExportable(reload)).toThrow(/transient/);
			const durableReload = await persistCourseIdentity(root, reload);
			expect(() => assertIdentityExportable(durableReload)).not.toThrow();
		},
		"write",
		false,
	);
}, 20_000);

it("I4 a replaced float's virtual prose cannot inherit the old content's identity", async () => {
	const text =
		"# Page\n\n::: float {side=left}\n![Helmet](old.png)\nWear protective helmets at the construction site.\n```\nhelmet-check\n```\nInspect chin straps before entering the work area.\n:::\n";
	const root = await project(text);
	const first = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
	const prose = present(
		[...present(first.lessons.get("lesson.prax")).nodes.values()].find(
			(node) => node.role === "prose:2",
		),
	);
	const next = await resolveCourseIdentity(root, {
		lessonPaths: ["lesson.prax"],
		sources: {
			"lesson.prax":
				"# Page\n\n::: float {side=left}\n![Forecast](new.png)\nReview annual revenue predictions before the finance meeting.\n```\nrevenue-check\n```\nCompare quarterly expenses with the approved budget.\n:::\n",
		},
	});
	expect(
		present(
			[...present(next.lessons.get("lesson.prax")).nodes.values()].find(
				(node) => node.role === "prose:2",
			),
		).id,
	).not.toBe(prose.id);
});

for (const target of ["lessons", "snapshots"]) {
	it(`I4 rejects an empty UUID or hash filename in ${target} without writing`, async () => {
		const root = await project();
		const result = await withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				),
			"write",
			false,
		);
		const name =
			target === "lessons" ? result.identity.snapshots[0].lessonId : result.identity.heads[0].head;
		const file = join(root, ".praxity/identity", target, `${name}.json`);
		await writeFile(join(root, ".praxity/identity", target, ".json"), await readFile(file));
		if (target === "lessons") await rm(file);
		const before = await bytes(root);
		await expect(loadIdentityStore(root)).rejects.toThrow(
			target === "lessons" ? /invalid UUID/ : /invalid SHA-256/,
		);
		expect(await bytes(root)).toEqual(before);
	});
}

for (const established of [false, true]) {
	for (const stop of [
		"journal",
		"staged:snapshot",
		"staged:source",
		"installed:snapshot",
		"installed:source",
		...(!established ? ["installed:course"] : []),
		"head:head",
	]) {
		it(`I4 ${established ? "existing" : "first"} write recovers source and identity together after process death at ${stop}`, async () => {
			const root = await project();
			let originalIds: string[] | undefined;
			if (established) {
				const original = await withProjectFileTransaction(
					root,
					async () =>
						persistCourseIdentity(
							root,
							await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
						),
					"write",
					false,
				);
				originalIds = [...present(original.lessons.get("lesson.prax")).nodes.keys()];
			}
			const child = fork(
				fileURLToPath(new URL("./fixtures/i4-store-writer.ts", import.meta.url)),
				[root, stop],
				{ execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
			);
			let errors = "";
			child.stderr?.on("data", (chunk) => {
				errors += chunk;
			});
			const exited = once(child, "exit");
			try {
				await Promise.race([
					once(child, "message").then(([message]) => {
						if (!message.paused) throw new Error(message.error);
					}),
					exited.then(([code]) => {
						throw new Error(`Writer exited ${code}: ${errors}`);
					}),
				]);
			} finally {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				await exited;
			}
			const beforeRead = await bytes(root);
			await expect(loadIdentityStore(root)).rejects.toThrow(
				/recovery.*save|save.*next write.*recover/i,
			);
			await expect(readCourseIdentity(root, { lessonPaths: ["lesson.prax"] })).rejects.toThrow(
				/recovery.*save|save.*next write.*recover/i,
			);
			expect(await bytes(root)).toEqual(beforeRead);
			await withProjectFileTransaction(root, async () => {}, "write", false);
			const expected = stop === "head:head" ? source.replace("clear path", "clear route") : source;
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(expected);
			if (established || stop === "head:head") {
				const loaded = await loadIdentityStore(root);
				const resolved = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				expect(resolved.identity.heads).toEqual(loaded.heads);
				if (originalIds)
					expect([...present(resolved.lessons.get("lesson.prax")).nodes.keys()]).toEqual(
						originalIds,
					);
			} else {
				// No protected original and no commit: rollback never established identity.
				expect(await readProjectRecoveryEvidence(root)).toEqual([
					expect.objectContaining({ outcome: "rolled-back" }),
				]);
				expect((await loadIdentityStore(root)).course).toBeNull();
			}
			const recovered = await bytes(root);
			await withProjectFileTransaction(root, async () => {}, "read", false);
			expect(await bytes(root)).toEqual(recovered);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(expected);
		}, 15000);
	}
}
