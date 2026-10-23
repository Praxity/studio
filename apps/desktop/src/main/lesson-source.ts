import { createHash } from "node:crypto";
import { lstat, readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { type IdentityOperation, serializeIdentity } from "@praxity/content-identity";
import {
	type DialogueCast,
	type ReadLessonResult,
	readLesson,
	resolveDialogueSpeakers,
} from "@praxity/grammar";
import type { ProjectWriteResult } from "../shared/project-write-errors";
import { planManifestLessons, readCourseManifestData } from "./course-manifest-io";
import {
	type CourseIdentitySession,
	persistCourseIdentity,
	type ResolvedCourseIdentity,
	readCourseIdentity,
	resolveCourseIdentity,
	withIdentityStoreReuse,
} from "./identity-store";
import { readFileWithin, resolveWritablePathWithin } from "./path-security";
import {
	applyProjectFilePlan,
	assertProjectWritesAllowed,
	isProjectRecoveryPath,
	type ProjectFileChange,
	ProjectFileConflictError,
	withProjectFileTransaction,
} from "./project-file-transactions";

function assertLessonFilename(filename: string): void {
	if (!/^[^/\\]+\.prax$/i.test(filename) || filename === ".prax")
		throw Object.assign(new Error("Invalid lesson filename"), { code: "ELESSONPATH" });
}
export function refuseGrammar3(source: string, lessonReads?: Map<string, ReadLessonResult>): void {
	const read = lessonReads?.get(source) ?? readLesson(source);
	if (read.tree.stream.source !== source) throw new Error("Parsed lesson source revision differs");
	lessonReads?.set(source, read);
	const error = read.errors.find((error) => error.messageRef.key === "grammar.v4.grammar-3");
	if (error) throw new Error(error.message);
}
const digest = (source: string) => createHash("sha256").update(source).digest("hex");

export async function readLessonSource(
	courseDir: string,
	filename: string,
	options: {
		lessonReads?: Map<string, ReadLessonResult>;
	} = {},
): Promise<string> {
	assertLessonFilename(filename);
	return withProjectFileTransaction(
		courseDir,
		async (root) => {
			const bytes = (await readFileWithin(root, join(root, filename))) as Buffer;
			const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
			refuseGrammar3(source, options.lessonReads);
			return source;
		},
		"read",
	);
}

export async function writeLessonSource(
	courseDir: string,
	filename: string,
	source: string,
	expectedSource?: string,
	options: {
		requireExpectedSource?: boolean;
		createOnly?: boolean;
		additionalChanges?: readonly ProjectFileChange[];
		operations?: readonly IdentityOperation[];
	} = {},
): Promise<ProjectWriteResult> {
	assertProjectWritesAllowed();
	assertLessonFilename(filename);
	refuseGrammar3(source);
	return withProjectFileTransaction(
		courseDir,
		async (root) =>
			withIdentityStoreReuse(async () => {
				let current: string | null = null;
				try {
					current = await readLessonSource(root, filename);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				if (expectedSource !== undefined && current !== expectedSource)
					throw new ProjectFileConflictError("Lesson changed on disk since it was opened");
				if (options.requireExpectedSource && expectedSource === undefined && current !== null)
					throw new Error("Existing lessons require an expected source");
				if (options.createOnly && current !== null)
					throw Object.assign(new Error("File already exists"), { code: "EEXIST" });
				const { lessonFilesOnDisk } = await readCourseManifestData(root);
				const resolved = await resolveCourseIdentity(root, {
					lessonPaths: [...new Set([...lessonFilesOnDisk, filename])],
					sources: { [filename]: source },
					operations: options.operations,
				});
				const durable = await persistCourseIdentity(root, resolved, options.additionalChanges);
				if (!durable.writeResult)
					throw new Error("Identity save returned no write acknowledgement");
				return durable.writeResult;
			}),
		"write",
	);
}

export async function resolveLessonSources(
	courseDir: string,
	sources: Readonly<Record<string, string>> = {},
	options: {
		identitySession?: CourseIdentitySession;
		strict?: boolean;
		operations?: readonly IdentityOperation[];
		lessonReads?: Map<string, ReadLessonResult>;
	} = {},
): Promise<ResolvedCourseIdentity> {
	// Discovery and identity must see the same admitted course revision. A writer
	// between separate admissions can add a head absent from the captured inventory.
	return withProjectFileTransaction(
		courseDir,
		async (root) => {
			const { lessonFilesOnDisk } = await readCourseManifestData(root);
			return options.strict
				? resolveCourseIdentity(root, { lessonPaths: lessonFilesOnDisk, sources, ...options })
				: readCourseIdentity(root, { lessonPaths: lessonFilesOnDisk, sources, ...options });
		},
		"read",
	);
}

/** Explicit write owners request candidates inside their existing write admission. */
export async function resolveLessonSourcesForWrite(
	courseDir: string,
	sources: Readonly<Record<string, string>> = {},
	options: Parameters<typeof resolveLessonSources>[2] = {},
): Promise<ResolvedCourseIdentity> {
	return withProjectFileTransaction(
		courseDir,
		async (root) => {
			const { lessonFilesOnDisk } = await readCourseManifestData(root);
			return resolveCourseIdentity(root, { lessonPaths: lessonFilesOnDisk, sources, ...options });
		},
		"write",
	);
}

export async function parseLessonSource(
	courseDir: string,
	filename: string,
	source: string,
	options: {
		cast?: DialogueCast;
		identity?: ResolvedCourseIdentity;
	} = {},
) {
	assertLessonFilename(filename);
	const lessonReads = new Map<string, ReadLessonResult>();
	const admitted = options.identity?.lessons.get(filename);
	if (admitted?.tree.stream.source === source) lessonReads.set(source, admitted);
	refuseGrammar3(source, lessonReads);
	const resolved =
		options.identity ??
		(await resolveLessonSources(courseDir, { [filename]: source }, { lessonReads }));
	const parsed = resolved.lessons.get(filename);
	if (!parsed || parsed.tree.stream.source !== source)
		throw new Error(`Identity source revision differs for ${filename}`);
	const head = resolved.identity.heads.find((head) => head.path === filename);
	const snapshot = resolved.identity.snapshots.find(
		(snapshot) => digest(serializeIdentity(snapshot)) === head?.head,
	);
	if (!snapshot) throw new Error(`Identity snapshot missing for ${filename}`);
	const { blocks, warnings: dialogueWarnings } = resolveDialogueSpeakers(
		parsed.blocks,
		options.cast,
	);
	return {
		...parsed,
		blocks,
		dialogueWarnings,
		lessonId: snapshot.lessonId,
		courseId: resolved.identity.course.courseId,
		revision: snapshot.sourceHash,
		identity: resolved,
	};
}

export async function deleteLessonSource(courseDir: string, filename: string): Promise<void> {
	assertProjectWritesAllowed();
	assertLessonFilename(filename);
	await withProjectFileTransaction(
		courseDir,
		async (root) => {
			const source = await readLessonSource(root, filename);
			const { lessonFilesOnDisk } = await readCourseManifestData(root);
			const resolved = await resolveCourseIdentity(root, {
				lessonPaths: lessonFilesOnDisk.filter((file) => file !== filename),
				removedPaths: [filename],
			});
			await persistCourseIdentity(root, resolved, [
				{ path: filename, content: null, expectedContent: source },
				...(await planManifestLessons(root, (lessons) =>
					lessons.filter((file) => file !== filename),
				)),
			]);
		},
		"write",
	);
}

export async function renameProjectSource(
	courseDir: string,
	from: string,
	to: string,
): Promise<void> {
	assertProjectWritesAllowed();
	if (from === to) return;
	if (
		to.startsWith(`${from}/`) ||
		[from, to].some(
			(path) => isProjectRecoveryPath(path) || path.replaceAll("\\", "/").startsWith(".praxity/"),
		)
	)
		throw new Error("Invalid rename target");
	await withProjectFileTransaction(
		courseDir,
		async (root) => {
			const changes: ProjectFileChange[] = [];
			const directories: string[] = [];
			const oldDirectories: string[] = [];
			const sources: Record<string, string> = {};
			const removedPaths: string[] = [];
			const target = await resolveWritablePathWithin(root, join(root, to));
			try {
				await lstat(target);
				throw Object.assign(new Error("Rename destination already exists"), { code: "EEXIST" });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			async function capture(oldPath: string, newPath: string): Promise<void> {
				// Descendant parents are created by the journaled plan. Its expected-null
				// writes check collisions after those parents exist, including outside races.
				const original = await resolveWritablePathWithin(root, join(root, oldPath));
				const entry = await lstat(original);
				if (entry.isSymbolicLink()) throw new Error("Symbolic links are not allowed");
				if (entry.isDirectory()) {
					directories.push(newPath);
					oldDirectories.push(original);
					for (const child of await readdir(original))
						await capture(`${oldPath}/${child}`, `${newPath}/${child}`);
				} else {
					if (!entry.isFile()) throw new Error("Rename source is not a regular file");
					const isLesson = oldPath.toLowerCase().endsWith(".prax");
					if (isLesson) assertLessonFilename(newPath);
					const bytes = (await readFileWithin(root, original)) as Buffer;
					changes.push(
						{ path: newPath, content: bytes, expectedContent: null },
						{ path: oldPath, content: null, expectedContent: bytes },
					);
					if (isLesson) {
						removedPaths.push(oldPath);
						sources[newPath] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
							bytes,
						);
					}
				}
			}
			await capture(from, to);
			changes.push(
				...(await planManifestLessons(root, (lessons) =>
					lessons.map((file) =>
						file === from
							? to
							: file.startsWith(`${from}/`)
								? `${to}${file.slice(from.length)}`
								: file,
					),
				)),
			);
			if (removedPaths.length) {
				const { lessonFilesOnDisk } = await readCourseManifestData(root);
				const resolved = await resolveCourseIdentity(root, {
					lessonPaths: [
						...lessonFilesOnDisk.filter((file) => !removedPaths.includes(file)),
						...Object.keys(sources),
					],
					removedPaths,
					sources,
				});
				await persistCourseIdentity(root, resolved, changes, { createDirectories: directories });
			} else await applyProjectFilePlan(root, changes, { createDirectories: directories });
			for (const directory of oldDirectories.reverse()) {
				try {
					await rmdir(directory);
				} catch (error) {
					if (!["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? ""))
						throw error;
				}
			}
		},
		"write",
	);
}
