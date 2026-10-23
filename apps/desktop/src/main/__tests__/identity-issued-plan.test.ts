import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as contentIdentity from "@praxity/content-identity";
import {
	type CanonicalDescriptor,
	describeDocument,
	serializeIdentity,
} from "@praxity/content-identity";
import { type ReadLessonResult, readLesson } from "@praxity/grammar";
import {
	type AppliedOperation,
	applyOperation,
	consumeOperationIdentity,
} from "@praxity/operations";
import { afterEach, expect, it, vi } from "vitest";
import { writeIdentityFixture } from "../../test-utils/identity-fixture";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import {
	CourseIdentitySession,
	IdentityStoreCache,
	loadIdentityStore,
	persistCourseIdentity,
	type ResolvedCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { withProjectFileFlushes, withProjectFileTransaction } from "../project-file-transactions";

// Real journal bytes, admissions and recovery remain; journal-flush tests own durability.
// No-op syncFile also omits the default adapter's post-write path checks.
function withCountingFlushes<Args extends unknown[]>(work: (...args: Args) => Promise<void>) {
	return async (...args: Args) => {
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		await withProjectFileFlushes(flushes, () => work(...args));
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	};
}

const roots: string[] = [];
const paths = ["a.prax", "b.prax"];
const sources = [
	"# Alpha\n\nKeep the exit clear.\n",
	"# Beta\n\nUse safety equipment and inspect it carefully before working in the controlled area.\n",
];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(seedSession = true, lessonSources = sources) {
	const root = await mkdtemp(join(tmpdir(), "identity-issued-plan-"));
	roots.push(root);
	await Promise.all(paths.map((path, i) => writeFile(join(root, path), lessonSources[i])));
	// Seeding is setup, not the write under test. Keep real persistence for admission
	// and its durable result, but avoid a second journal for the initial fixture.
	await writeIdentityFixture(root, await resolveCourseIdentity(root, { lessonPaths: paths }));
	const session = new CourseIdentitySession(root);
	const current = await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, {
					lessonPaths: paths,
					...(seedSession ? { identitySession: session } : {}),
				}),
			),
		"write",
		false,
	);
	return { root, session, current };
}
function plan(current: ResolvedCourseIdentity): AppliedOperation {
	const target = current.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join("/") === "0/0",
	);
	const source = current.lessons.get("a.prax")?.tree.stream.source;
	if (!target || source === undefined) throw new Error("Missing edit target");
	const result = applyOperation(
		[...current.lessons].map(([path, lesson]) => ({ path, source: lesson.tree.stream.source })),
		{
			transactionId: randomUUID(),
			operation: "editSource",
			files: [...current.lessons].map(([path, lesson]) => ({
				path,
				baseRevision: digest(lesson.tree.stream.source),
			})),
			targets: [
				{
					file: "a.prax",
					ref: {
						kind: "node",
						nodeId: target.id,
						path: target.path,
						fingerprint: target.fingerprint,
					},
					expectedText: source.slice(target.span.start, target.span.end),
				},
			],
			args: { text: "Keep every exit clear." },
		},
		{
			identity: current.identity,
			activeHistoryIds: current.activeHistoryIds,
			readerRoles: true,
			allocateId: randomUUID,
			digest,
		},
	);
	if (!result.ok) throw new Error(result.code);
	return result;
}
function options(current: ResolvedCourseIdentity, planned: AppliedOperation) {
	return {
		lessonPaths: paths,
		operationBase: current,
		operationPlan: planned,
		operations: planned.evidence,
		sources: Object.fromEntries(planned.history.after.map((file) => [file.path, file.source])),
	};
}
it("compares unchanged issued identities with private validated values before persistence", async () => {
	const { root, current } = await fixture(false);
	const planned = plan(current);
	const serialize = contentIdentity.serializeIdentity;
	let issued = false;
	vi.spyOn(contentIdentity, "serializeIdentity").mockImplementation((value) => {
		if (
			value === current.identity ||
			(issued &&
				value &&
				typeof value === "object" &&
				"sourceMappings" in value &&
				"snapshots" in value)
		)
			throw new Error("An unchanged issued identity was serialized again");
		return serialize(value);
	});
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, options(current, planned));
			issued = true;
			const durable = await persistCourseIdentity(root, resolved);
			expect(durable.identity).toEqual(resolved.identity);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
				"# Alpha\n\nKeep every exit clear.",
			);
		},
		"write",
		false,
	);
}, 15_000);
it("adopts the forward plan's reader descriptors without describing its sources again", async () => {
	const { root, current } = await fixture(false);
	const planned = plan(current);
	vi.spyOn(contentIdentity, "describeDocument").mockImplementation(() => {
		throw new Error("An issued operation's reader descriptors were rebuilt");
	});
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, options(current, planned));
			expect(resolved.identity.sourceMappings).toEqual(planned.identity.sourceMappings);
			for (const [path, lesson] of resolved.lessons) {
				const provider = resolved.ids.get(path);
				if (!provider) throw new Error("Missing adopted reader provider");
				for (const [id, record] of lesson.nodes)
					expect(provider(record.node, record.role)).toBe(id);
			}
			const durable = await persistCourseIdentity(root, resolved);
			expect(durable.transientIds).toBe(false);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
				"# Alpha\n\nKeep every exit clear.",
			);
		},
		"write",
		false,
	);
}, 15_000);

it.each(["editSource", "editInline"] as const)(
	"%s issues the same reader projection as fresh reads of every final source",
	async (operation) => {
		const source =
			"---\ntitle: Safety\nvariables:\n  ready: false\n  attempts: 0\n---\n# Equipment\n\n::: fill-blank Complete the advice\nWear {boots} and {gloves}.\n:::\n\n# Exits\n\nKeep the [exit](https://example.com) clear.\n";
		const { current } = await fixture(false, [source, sources[1]]);
		const files = [...current.lessons].map(([path, lesson]) => ({
			path,
			source: lesson.tree.stream.source,
		}));
		const target = current.identity.sourceMappings.find(
			(mapping) => mapping.file === "a.prax" && mapping.path.join("/") === "2/0",
		);
		if (!target) throw new Error("Missing second-page body");
		const raw = "[exit](https://example.com)";
		const start = source.indexOf(raw);
		const planned = applyOperation(
			files,
			{
				transactionId: randomUUID(),
				operation,
				files: files.map((file) => ({ path: file.path, baseRevision: digest(file.source) })),
				targets: [
					{
						file: "a.prax",
						ref: {
							kind: "node",
							nodeId: target.id,
							path: target.path,
							fingerprint: target.fingerprint,
						},
						expectedText: source.slice(target.span.start, target.span.end),
						...(operation === "editInline"
							? { inline: { start, end: start + raw.length, expectedText: raw } }
							: {}),
					},
				],
				args: {
					text:
						operation === "editInline" ? "door" : "Keep the [door](https://example.com) clear.\n",
				},
			},
			{
				identity: current.identity,
				activeHistoryIds: current.activeHistoryIds,
				readerRoles: true,
				allocateId: randomUUID,
				digest,
			},
		);
		if (!planned.ok) throw new Error(planned.code);
		expect(planned.history.after.find((file) => file.path === "a.prax")?.source).toBe(
			source.replace("[exit]", "[door]"),
		);
		const issued = consumeOperationIdentity(planned, {
			identity: current.identity,
			activeHistoryIds: [...(current.activeHistoryIds ?? [])].sort(),
			before: files,
			after: planned.history.after,
			operations: planned.evidence,
			readerRoles: true,
		});
		const project = ({ file, path, readerRole, readerOwnerPath }: CanonicalDescriptor) => ({
			file,
			path,
			readerRole,
			readerOwnerPath,
		});
		for (const file of planned.history.after) {
			const fresh = describeDocument(
				{ path: file.path, tree: readLesson(file.source).tree },
				{ readerRoles: true },
			);
			expect(
				issued.descriptors?.filter((descriptor) => descriptor.file === file.path).map(project),
			).toEqual(fresh.map(project));
			if (file.path === "a.prax") {
				expect(
					fresh
						.filter((descriptor) => descriptor.kind === "page")
						.map((descriptor) => descriptor.path),
				).toEqual([[1], [2]]);
				expect(fresh.map((descriptor) => descriptor.readerRole)).toEqual(
					expect.arrayContaining(["blank:0", "blank:1", "variable:ready", "variable:attempts"]),
				);
			}
		}
	},
);
it("keeps loaded store graphs private and copies only their public store boundary", async () => {
	const { root, current } = await fixture(false);
	const expected = await loadIdentityStore(root, {
		cache: new IdentityStoreCache({ maxBytes: 0 }),
	});
	const clone = globalThis.structuredClone;
	vi.spyOn(globalThis, "structuredClone").mockImplementation((value, options) => {
		if (value && typeof value === "object" && "snapshotRecords" in value)
			throw new Error("A private loaded store graph was copied");
		return clone(value, options);
	});
	const exposed = await loadIdentityStore(root);
	exposed.snapshots[0].nodes = {};
	exposed.heads[0].path = "mutated.prax";
	expect(await loadIdentityStore(root)).toEqual(expected);
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, options(current, planned));
			const durable = await persistCourseIdentity(root, resolved);
			expect(durable.identity).toEqual(resolved.identity);
			const independent = await resolveCourseIdentity(root, { lessonPaths: paths });
			durable.identity.snapshots[0].nodes = {};
			resolved.identity.snapshots[1].nodes = {};
			expect((await resolveCourseIdentity(root, { lessonPaths: paths })).identity).toEqual(
				independent.identity,
			);
		},
		"write",
		false,
	);
}, 15_000);
it("validates the installed store from private issued facts after checking its exact bytes", async () => {
	const { root, current, session } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, {
				...options(current, planned),
				identitySession: session,
			});
			vi.spyOn(contentIdentity, "parseIdentitySnapshotRecord").mockImplementation(() => {
				throw new Error("An installed validated snapshot was parsed again");
			});
			const durable = await persistCourseIdentity(root, resolved);
			expect(durable.identity).toEqual(resolved.identity);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
				"# Alpha\n\nKeep every exit clear.",
			);
			vi.restoreAllMocks();
			expect(await loadIdentityStore(root)).toEqual(
				await loadIdentityStore(root, { cache: new IdentityStoreCache({ maxBytes: 0 }) }),
			);
		},
		"write",
		false,
	);
});
it("installed facts preserve the exact JSON values after a canonical-equivalent caller mutation", async () => {
	const { root, current, session } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, {
				...options(current, planned),
				identitySession: session,
			});
			const snapshot = resolved.identity.snapshots[0];
			const lesson = snapshot.nodes[snapshot.lessonId];
			if (!lesson) throw new Error("Missing lesson node");
			expect(lesson.span.start).toBe(0);
			lesson.span.start = -0;
			await persistCourseIdentity(root, resolved);
			const independent = await loadIdentityStore(root, {
				cache: new IdentityStoreCache({ maxBytes: 0 }),
			});
			const actual = await loadIdentityStore(root);
			expect(actual).toEqual(independent);
			const installed = actual.snapshots.find((s) => s.lessonId === snapshot.lessonId);
			expect(installed?.nodes[snapshot.lessonId]?.span.start).toBe(0);
		},
		"write",
		false,
	);
}, 15_000);
it("installed facts retain noncanonical JSON values in an unchanged immutable snapshot", async () => {
	const { root, current, session } = await fixture(false);
	const snapshot = current.identity.snapshots[0];
	const hash = digest(serializeIdentity(snapshot));
	const path = join(root, `.praxity/identity/snapshots/${hash}.json`);
	const original = await readFile(path, "utf8");
	const outside = original.replaceAll('"start":0', '"start":-0');
	expect(outside).not.toBe(original);
	await writeFile(path, outside);
	const independent = await loadIdentityStore(root, {
		cache: new IdentityStoreCache({ maxBytes: 0 }),
	});
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, {
					lessonPaths: paths,
					identitySession: session,
				}),
			),
		"write",
		false,
	);
	expect(await loadIdentityStore(root)).toEqual(independent);
	expect(await readFile(path, "utf8")).toBe(outside);
	expect(
		independent.snapshots.find((s) => s.lessonId === snapshot.lessonId)?.nodes[snapshot.lessonId]
			?.span.start,
	).toBe(-0);
});
it("private installed facts refuse same-size outside bytes with restored timestamps before seeding", async () => {
	const { root, current, session } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, {
				...options(current, planned),
				identitySession: session,
			});
			const path = join(root, ".praxity/identity/course.json");
			const original = await readFile(path, "utf8");
			const before = await stat(path);
			await expect(
				persistCourseIdentity(root, resolved, [], {
					onStep: async (step) => {
						if (step.kind !== "head") return;
						await writeFile(path, original.replace(current.identity.course.courseId, randomUUID()));
						await utimes(path, before.atime, before.mtime);
					},
				}),
			).rejects.toThrow(/namespace/);
			expect(session.lessonReads().size).toBe(0);
			await writeFile(path, original);
			const independent = await resolveCourseIdentity(root, { lessonPaths: paths });
			expect(
				(await resolveCourseIdentity(root, { lessonPaths: paths, identitySession: session }))
					.identity,
			).toEqual(independent.identity);
		},
		"write",
		false,
	);
});
it("refuses an operation base mutated after its initial admission while lesson reads await", async () => {
	const { root, current } = await fixture(false);
	const planned = plan(current);
	class MutatingReads extends Map<string, ReadLessonResult> {
		get(source: string) {
			current.identity.snapshots[1].parents = [digest("unadmitted parent")];
			return super.get(source);
		}
	}
	await expect(
		resolveCourseIdentity(root, {
			...options(current, planned),
			operationPlan: undefined,
			lessonReads: new MutatingReads(),
		}),
	).rejects.toThrow("Identity: invalid operation base");
	expect(await readFile(join(root, "a.prax"), "utf8")).toBe(sources[0]);
});
it("persists the private canonical snapshots already validated by its admission", async () => {
	const { root, current } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, options(current, planned));
			const expected = resolved.identity.snapshots.map((snapshot) => {
				const text = serializeIdentity(snapshot);
				return { text, hash: digest(text) };
			});
			const serialize = contentIdentity.serializeIdentity;
			vi.spyOn(contentIdentity, "serializeIdentity").mockImplementation((value) => {
				if (value && typeof value === "object" && "nodes" in value && "sourceHash" in value)
					throw new Error("A validated snapshot was serialized again");
				return serialize(value);
			});
			const durable = await persistCourseIdentity(root, resolved);
			expect(durable.identity).toEqual(resolved.identity);
			expect(durable.transientIds).toBe(false);
			for (const { hash, text } of expected)
				expect(await readFile(join(root, `.praxity/identity/snapshots/${hash}.json`), "utf8")).toBe(
					text,
				);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
				"# Alpha\n\nKeep every exit clear.",
			);
		},
		"write",
		false,
	);
}, 15_000);
it("compares admitted identity inventories without serializing their exact bytes again", async () => {
	const { root, current } = await fixture();
	const planned = plan(current);
	const serialize = contentIdentity.serializeIdentity;
	vi.spyOn(contentIdentity, "serializeIdentity").mockImplementation((value) => {
		if (
			Array.isArray(value) &&
			value.some(
				(entry) =>
					Array.isArray(entry) &&
					typeof entry[0] === "string" &&
					entry[0].startsWith(".praxity/identity/") &&
					typeof entry[1] === "string" &&
					entry[1].startsWith("{"),
			)
		)
			throw new Error("An admitted file inventory was serialized again");
		return serialize(value);
	});
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, options(current, planned));
			const durable = await persistCourseIdentity(root, resolved);
			expect(durable.identity).toEqual(resolved.identity);
			expect(await readFile(join(root, "a.prax"), "utf8")).toBe(
				"# Alpha\n\nKeep every exit clear.",
			);
		},
		"write",
		false,
	);
}, 15_000);
for (const mutation of ["snapshot", "namespace", "same-size source", "junction"] as const) {
	it(`private canonical records refuse ${mutation} mutation and agree with fresh records after restoration`, async () => {
		const { root, current } = await fixture();
		const planned = plan(current);
		return withProjectFileTransaction(
			root,
			async () => {
				const resolved = await resolveCourseIdentity(root, options(current, planned));
				const identity = structuredClone(resolved.identity);
				const saved = join(root, "saved-identity");
				if (mutation === "snapshot") resolved.identity.snapshots[0].nodes = {};
				if (mutation === "namespace") resolved.identity.course.courseId = randomUUID();
				if (mutation === "same-size source") {
					const before = await stat(join(root, "a.prax"));
					await writeFile(join(root, "a.prax"), sources[0].replace("exit", "door"));
					await utimes(join(root, "a.prax"), before.atime, before.mtime);
				}
				if (mutation === "junction") {
					await rename(join(root, ".praxity"), saved);
					const outside = await mkdtemp(join(tmpdir(), "canonical-record-outside-"));
					roots.push(outside);
					await symlink(outside, join(root, ".praxity"), "junction");
				}
				const refusal = {
					messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: ".praxity" } },
				};
				if (mutation === "junction")
					await expect(persistCourseIdentity(root, resolved)).rejects.toMatchObject(refusal);
				else await expect(persistCourseIdentity(root, resolved)).rejects.toThrow();
				resolved.identity = identity;
				if (mutation === "same-size source") await writeFile(join(root, "a.prax"), sources[0]);
				if (mutation === "junction") {
					const before = await projectDiskSnapshot(saved);
					await rm(join(root, ".praxity"));
					await symlink(saved, join(root, ".praxity"), "junction");
					await expect(persistCourseIdentity(root, resolved)).rejects.toMatchObject(refusal);
					await expect(resolveCourseIdentity(root, { lessonPaths: paths })).rejects.toMatchObject(
						refusal,
					);
					expect(await projectDiskSnapshot(saved)).toEqual(before);
					await rm(join(root, ".praxity"));
					await rename(saved, join(root, ".praxity"));
				}
				// Make the independent admission before reusing this resolution's private bytes.
				const freshBase = await resolveCourseIdentity(root, { lessonPaths: paths });
				const fresh = await resolveCourseIdentity(root, options(freshBase, plan(freshBase)));
				expect(resolved.identity.snapshots).toEqual(fresh.identity.snapshots);
				const durable = await persistCourseIdentity(root, resolved);
				expect(durable.identity.snapshots).toEqual(fresh.identity.snapshots);
				for (const snapshot of fresh.identity.snapshots) {
					const text = serializeIdentity(snapshot);
					expect(
						await readFile(join(root, `.praxity/identity/snapshots/${digest(text)}.json`), "utf8"),
					).toBe(text);
				}
			},
			"write",
			false,
		);
	}, 15_000);
}
it("committing seeds privately owned admission reads before the next save", async () => {
	const { session, current } = await fixture();
	expect(session.lessonReads().size).toBe(2);
	const read = current.lessons.get("a.prax");
	if (!read) throw new Error("Missing read");
	read.tree.stream.source = "caller mutation";
	expect([...session.lessonReads().keys()]).toEqual(sources);
});
it("takes ownership of a private installed store without cloning the same record twice", async () => {
	const { root, session, current } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, {
				...options(current, planned),
				identitySession: session,
			});
			const clone = globalThis.structuredClone;
			const cloned = new WeakSet<object>();
			let installed = false;
			const durable = await persistCourseIdentity(root, resolved, [], {
				async onStep(step) {
					if (step.kind !== "head" || installed) return;
					installed = true;
					vi.spyOn(globalThis, "structuredClone").mockImplementation((value, options) => {
						if (value && typeof value === "object" && "snapshotRecords" in value) {
							if (cloned.has(value)) throw new Error("A private installed store was cloned twice");
							cloned.add(value);
						}
						return clone(value, options);
					});
				},
			});
			expect(installed).toBe(true);
			vi.restoreAllMocks();
			const fresh = await resolveCourseIdentity(root, { lessonPaths: paths });
			durable.identity.snapshots[0].nodes = {};
			const read = durable.lessons.get("a.prax");
			if (!read) throw new Error("Missing durable read");
			read.tree.stream.source = "caller mutation";
			const actual = await resolveCourseIdentity(root, {
				lessonPaths: paths,
				identitySession: session,
			});
			expect(actual.identity).toEqual(fresh.identity);
			expect(actual.lessons.get("a.prax")?.tree.stream.source).toBe(
				"# Alpha\n\nKeep every exit clear.",
			);
		},
		"write",
		false,
	);
});
it("an unchanged seeded admission equals a fresh admission, including mappings and status", async () => {
	const { root, session, current } = await fixture(false);
	// Obtain the independent resolution before this session can retain any evidence.
	const expected = await resolveCourseIdentity(root, { lessonPaths: paths });
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: paths, identitySession: session }),
			),
		"write",
		false,
	);
	const actual = await resolveCourseIdentity(root, {
		lessonPaths: paths,
		identitySession: session,
	});
	expect(actual.identity).toEqual(expected.identity);
	const planned = plan(current);
	await withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, {
					...options(current, planned),
					identitySession: session,
				}),
			),
		"write",
		false,
	);
	const editedExpected = await resolveCourseIdentity(root, { lessonPaths: paths });
	const editedActual = await resolveCourseIdentity(root, {
		lessonPaths: paths,
		identitySession: session,
	});
	expect(editedActual.identity).toEqual(editedExpected.identity);
});
it("a persistence store error invalidates seeded admission evidence", async () => {
	const { root, session } = await fixture();
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, {
				lessonPaths: paths,
				identitySession: session,
			});
			await writeFile(join(root, ".praxity/identity/course.json"), "{broken}");
			await expect(persistCourseIdentity(root, resolved)).rejects.toThrow();
			expect(session.lessonReads().size).toBe(0);
		},
		"write",
		false,
	);
});
it(
	"head installation retains the admitted lesson order after canonical snapshot indexing",
	withCountingFlushes(async () => {
		const { root } = await fixture();
		return withProjectFileTransaction(
			root,
			async () => {
				for (const [attempt, order] of [
					["a.prax", "b.prax"],
					["b.prax", "a.prax"],
				].entries()) {
					const resolved = await resolveCourseIdentity(root, {
						lessonPaths: order,
						sources: Object.fromEntries(
							paths.map((path, i) => [
								path,
								`${sources[i]}${Array.from({ length: attempt + 1 }, (_, index) => `\nAdditional paragraph ${index}.\n`).join("")}`,
							]),
						),
					});
					const installed: string[] = [];
					await persistCourseIdentity(root, resolved, [], {
						onStep: async ({ kind, index }) => {
							if (kind !== "head" || index === undefined) return;
							const journal = JSON.parse(
								await readFile(join(root, ".praxity-transaction.json"), "utf8"),
							);
							const head = JSON.parse(
								await readFile(join(root, journal.plan.files[index].path), "utf8"),
							);
							installed.push(head.path);
						},
					});
					expect(installed).toEqual(attempt === 0 ? ["a.prax", "b.prax"] : ["b.prax", "a.prax"]);
				}
			},
			"write",
			false,
		);
	}),
	30_000,
);
it("a watcher invalidation during installation prevents the commit from reseeding an obsolete session", async () => {
	const { root, session, current } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const resolved = await resolveCourseIdentity(root, {
				...options(current, planned),
				identitySession: session,
			});
			await persistCourseIdentity(root, resolved, [], {
				onStep: async ({ kind }) => {
					if (kind === "head") session.invalidate();
				},
			});
			expect(session.lessonReads().size).toBe(0);
		},
		"write",
		false,
	);
});
it("adopts the registry plan exactly once and issues durable readers only after persistence", async () => {
	const { root, current, session } = await fixture();
	const planned = plan(current);
	return withProjectFileTransaction(
		root,
		async () => {
			const adopted = await resolveCourseIdentity(root, {
				...options(current, planned),
				identitySession: session,
			});
			expect(adopted.identity.sourceMappings).toEqual(planned.identity.sourceMappings);
			expect(adopted.transientIds).toBe(true);
			await expect(resolveCourseIdentity(root, options(current, planned))).rejects.toThrow(
				/issued|consumed|plan/,
			);
			const durable = await persistCourseIdentity(root, adopted);
			expect(durable.transientIds).toBe(false);
			for (const [path, read] of durable.lessons) {
				expect(await readFile(join(root, path), "utf8")).toBe(read.tree.stream.source);
				const provider = durable.ids.get(path);
				if (!provider) throw new Error("Missing provider");
				for (const [id, node] of read.nodes) expect(provider(node.node, node.role)).toBe(id);
			}
		},
		"write",
		false,
	);
}, 15_000);
for (const mutation of [
	"clone",
	"identity",
	"after",
	"evidence",
	"inventory",
	"restoration",
] as const) {
	it(`refuses an unissued or mutated ${mutation} plan with zero writes`, async () => {
		const { root, current } = await fixture();
		let planned = plan(current);
		if (mutation === "clone") planned = structuredClone(planned);
		if (mutation === "identity") planned.identity.snapshots[0].nodes = {};
		if (mutation === "after") planned.history.after[1].source = "# Forged\n";
		if (mutation === "evidence") planned.evidence[0].inverse = true;
		const input = options(current, planned);
		if (mutation === "inventory") input.lessonPaths = ["a.prax"];
		const restore =
			mutation === "restoration"
				? {
						restore: {
							identity: current.identity,
							written: planned.identity,
							mapping: planned.inverse.mapping,
						},
					}
				: {};
		await expect(resolveCourseIdentity(root, { ...input, ...restore })).rejects.toThrow();
		expect(await readFile(join(root, "a.prax"), "utf8")).toBe(sources[0]);
	});
}
it("binds the plan to the exact admitted outside revision on another page", async () => {
	const { root, current } = await fixture();
	const planned = plan(current);
	const before = await stat(join(root, "b.prax"));
	const changed = sources[1].replace("safety", "proper");
	await writeFile(join(root, "b.prax"), changed);
	await utimes(join(root, "b.prax"), before.atime, before.mtime);
	await expect(resolveCourseIdentity(root, options(current, planned))).rejects.toMatchObject({
		code: "ECONFLICT",
	});
	expect(await readFile(join(root, "b.prax"), "utf8")).toBe(changed);
});
it("seeded admissions equal fresh results across same-size writes, dependency edits and restored junctions", async () => {
	const { root, session } = await fixture();
	const before = await stat(join(root, "b.prax"));
	await writeFile(join(root, "b.prax"), sources[1].replace("safety", "proper"));
	await utimes(join(root, "b.prax"), before.atime, before.mtime);
	const expected = await resolveCourseIdentity(root, { lessonPaths: paths });
	const actual = await resolveCourseIdentity(root, {
		lessonPaths: paths,
		identitySession: session,
	});
	expect(serializeIdentity(actual.identity)).toBe(serializeIdentity(expected.identity));
	const saved = join(root, "saved-identity");
	await rename(join(root, ".praxity"), saved);
	const outside = await mkdtemp(join(tmpdir(), "identity-plan-outside-"));
	roots.push(outside);
	await mkdir(join(outside, "identity"));
	await symlink(outside, join(root, ".praxity"), "junction");
	const savedCourse = await projectDiskSnapshot(saved);
	const refusal = {
		messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: ".praxity" } },
	};
	await expect(
		resolveCourseIdentity(root, { lessonPaths: paths, identitySession: session }),
	).rejects.toMatchObject(refusal);
	await rm(join(root, ".praxity"));
	await symlink(saved, join(root, ".praxity"), "junction");
	await expect(
		resolveCourseIdentity(root, { lessonPaths: paths, identitySession: session }),
	).rejects.toMatchObject(refusal);
	expect(await projectDiskSnapshot(saved)).toEqual(savedCourse);
	await rm(join(root, ".praxity"));
	await rename(saved, join(root, ".praxity"));
	expect(
		serializeIdentity(
			(await resolveCourseIdentity(root, { lessonPaths: paths, identitySession: session }))
				.identity,
		),
	).toBe(serializeIdentity(expected.identity));
});
