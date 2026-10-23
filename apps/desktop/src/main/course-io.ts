import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readLesson as parseLesson } from "@praxity/grammar";
import type { CourseData, LessonData, LessonFileInfo } from "../shared/types";
import { planManifestLessons, readCourseManifestData } from "./course-manifest-io";
import { readLessonSource, renameProjectSource, writeLessonSource } from "./lesson-source";

import { readFileWithin } from "./path-security";
import { withProjectFileTransaction } from "./project-file-transactions";

async function readLessonInfo(courseDir: string, filename: string): Promise<LessonFileInfo | null> {
	const filePath = join(courseDir, filename);
	try {
		const grammar = await readLessonSource(courseDir, filename);
		const fileStat = await stat(filePath);
		const { frontmatter, pages } = parseLesson(grammar);
		const title =
			(typeof frontmatter.title === "string" ? frontmatter.title.trim() : "") ||
			filename.replace(/\.prax$/i, "");
		return {
			filename,
			title,
			path: filePath,
			pageCount: pages.length,
			wordCount: grammar.split(/\s+/).filter(Boolean).length,
			lastModified: fileStat.mtime.toISOString(),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export async function loadCourse(courseDir: string): Promise<CourseData> {
	return withProjectFileTransaction(courseDir, loadCourseSnapshot, "read");
}

async function loadCourseSnapshot(courseDir: string): Promise<CourseData> {
	const {
		manifest,
		manifestSource,
		orderedLessons,
		unlistedLessons: unlistedFilenames,
	} = await readCourseManifestData(courseDir);

	const lessons: LessonFileInfo[] = [];
	for (const filename of orderedLessons) {
		const info = await readLessonInfo(courseDir, filename);
		if (info) lessons.push(info);
	}

	const unlistedLessons: LessonFileInfo[] = [];
	for (const filename of unlistedFilenames) {
		const info = await readLessonInfo(courseDir, filename);
		if (info) unlistedLessons.push(info);
	}

	return {
		coursePath: courseDir,
		manifest,
		manifestSource,
		lessons,
		unlistedLessons,
		workspacePath: null, // Resolved by caller
	};
}

export async function readLesson(courseDir: string, filename: string): Promise<LessonData> {
	const lessonPath = join(courseDir, filename);
	const grammar = await readLessonSource(courseDir, filename);
	return { grammar, lessonPath, coursePath: courseDir };
}

export async function createCourseLesson(
	courseDir: string,
	filename: string,
	source: string,
): Promise<void> {
	await withProjectFileTransaction(
		courseDir,
		async (root) => {
			const additionalChanges = await planManifestLessons(
				root,
				(lessons) => (lessons.includes(filename) ? lessons : [...lessons, filename]),
				true,
			);
			await writeLessonSource(root, filename, source, undefined, {
				createOnly: true,
				additionalChanges,
			});
		},
		"write",
	);
}

export async function renameCourseFile(
	courseDir: string,
	oldFilename: string,
	newFilename: string,
): Promise<void> {
	await renameProjectSource(courseDir, oldFilename, newFilename);
}
