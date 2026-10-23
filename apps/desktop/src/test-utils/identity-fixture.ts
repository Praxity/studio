import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	describeDocument,
	type IdentityOperation,
	resolveIdentity,
	serializeIdentity,
} from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { readCourseManifestData } from "../main/course-manifest-io";
import {
	loadIdentityStore,
	persistCourseIdentity,
	type ResolvedCourseIdentity,
	resolveCourseIdentity,
} from "../main/identity-store";
import { resolveLessonSourcesForWrite } from "../main/lesson-source";
import { withProjectFileTransaction } from "../main/project-file-transactions";

/** Test-only byte installation. Source ownership rejects production imports of test helpers. */
export async function writeIdentityFixture(
	root: string,
	seed: Pick<ResolvedCourseIdentity, "identity">,
) {
	await mkdir(join(root, ".praxity/identity/lessons"), { recursive: true });
	await mkdir(join(root, ".praxity/identity/snapshots"), { recursive: true });
	await writeFile(
		join(root, ".praxity/identity/course.json"),
		serializeIdentity(seed.identity.course),
	);
	for (const snapshot of seed.identity.snapshots) {
		const text = serializeIdentity(snapshot);
		const hash = createHash("sha256").update(text).digest("hex");
		await writeFile(join(root, `.praxity/identity/snapshots/${hash}.json`), text);
		const head = seed.identity.heads.find((h) => h.head === hash);
		if (!head) throw new Error("Missing fixture head");
		await writeFile(
			join(root, `.praxity/identity/lessons/${snapshot.lessonId}.json`),
			serializeIdentity(head),
		);
	}
}

/** Reproduce former saved-pending opens before exercising today's transient Studio entry. */
export async function persistLegacyPendingFixture(root: string) {
	const prior = await loadIdentityStore(root);
	const { lessonFilesOnDisk } = await readCourseManifestData(root);
	const parsedDocuments = await Promise.all(
		lessonFilesOnDisk.map(async (path) => ({
			path,
			tree: readLesson(await readFile(join(root, path), "utf8")).tree,
		})),
	);
	const identity = resolveIdentity(
		{
			course: prior.course ?? undefined,
			priorHeads: prior.heads,
			priorSnapshots: prior.snapshots,
			parsedDocuments,
			readerRoles: true,
		},
		{ allocateId: randomUUID, digest: (text) => createHash("sha256").update(text).digest("hex") },
	);
	await writeIdentityFixture(root, { identity });
}

/** An authored fixture replacement supplies explicit identity intent. Setup
 * installs exact bytes; learner-facing saves still preserve existing endings. */
export async function replaceIdentityFixture(root: string, file: string, source: string) {
	const prior = await resolveLessonSourcesForWrite(root);
	const previous = prior.lessons.get(file);
	const head = prior.identity.heads.find((head) => head.path === file);
	const { lessonFilesOnDisk } = await readCourseManifestData(root);
	if (!previous || !head)
		return withProjectFileTransaction(
			root,
			async () =>
				persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, {
						lessonPaths: [...new Set([...lessonFilesOnDisk, file])],
						sources: { [file]: source },
					}),
				),
			"write",
			false,
		);
	const descriptors = describeDocument(
		{ path: file, tree: readLesson(source).tree },
		{ readerRoles: true },
	);
	const old = prior.identity.sourceMappings.filter((node) => node.file === file);
	const lesson = old.find((node) => node.path.length === 0);
	if (!lesson) throw new Error(`Missing fixture lesson identity: ${file}`);
	const mapping: IdentityOperation["mapping"] = [
		...old
			.filter((node) => node.id !== lesson.id)
			.map((node) => ({ oldId: node.id, newId: null, fate: "retired" as const })),
		...descriptors.map((node) =>
			node.kind === "lesson"
				? { oldId: lesson.id, newId: lesson.id, fate: "kept" as const }
				: { oldId: null, newId: null, fate: "new" as const },
		),
	];
	const offset = mapping.length - descriptors.length;
	const operation: IdentityOperation = {
		intent: "modify",
		files: [
			{
				path: file,
				fromSnapshot: head.head,
				fromRevision: createHash("sha256").update(previous.tree.stream.source).digest("hex"),
				toRevision: createHash("sha256").update(source).digest("hex"),
			},
		],
		mapping,
		placements: descriptors.map((node, index) => ({
			mappingIndex: offset + index,
			file,
			path: node.path,
		})),
	};
	return withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, {
					lessonPaths: lessonFilesOnDisk,
					sources: { [file]: source },
					operations: [operation],
					removedPaths: prior.identity.heads
						.filter((head) => !lessonFilesOnDisk.includes(head.path))
						.map((head) => head.path),
				}),
			),
		"write",
		false,
	);
}

/** Establish fixture bytes before adding sidecars or recovery evidence. Setup does
 * not test durability; scenarios still use the real journal for their writes. */
export async function persistFixtureIdentity(root: string) {
	const { lessonFilesOnDisk } = await readCourseManifestData(root);
	await writeIdentityFixture(
		root,
		await resolveCourseIdentity(root, { lessonPaths: lessonFilesOnDisk }),
	);
}

/** Compare complete identity bytes and follow path changes without source IDs. */
export async function readIdentityFixture(root: string) {
	const store = await loadIdentityStore(root);
	const paths = [".praxity/identity/course.json"];
	for (const directory of ["lessons", "snapshots"]) {
		for (const name of await readdir(join(root, ".praxity/identity", directory))) {
			paths.push(`.praxity/identity/${directory}/${name}`);
		}
	}
	const files = await Promise.all(
		paths.sort().map(async (path) => [path, await readFile(join(root, path), "utf8")]),
	);
	const lessonIds = Object.fromEntries(
		store.heads.flatMap((head) => {
			const lesson = store.snapshots.find(
				(candidate) =>
					createHash("sha256").update(serializeIdentity(candidate)).digest("hex") === head.head,
			);
			if (!lesson) throw new Error(`Missing identity fixture head: ${head.path}`);
			return Object.values(lesson.nodes).some((node) => node.status === "active")
				? [[head.path, lesson.lessonId]]
				: [];
		}),
	);
	const pageIds = Object.fromEntries(
		store.heads.map((head) => {
			const snapshot = store.snapshots.find(
				(candidate) =>
					createHash("sha256").update(serializeIdentity(candidate)).digest("hex") === head.head,
			);
			if (!snapshot) throw new Error(`Missing identity fixture head: ${head.path}`);
			return [
				head.path,
				Object.entries(snapshot.nodes)
					.filter(([, node]) => node.kind === "page" && node.status === "active")
					.sort(([, a], [, b]) => a.order - b.order)
					.map(([id]) => id),
			];
		}),
	);
	return { files: Object.fromEntries(files), lessonIds, pageIds };
}
