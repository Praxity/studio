import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { isMap, isNode, isScalar } from "yaml";
import {
	type CourseManifest,
	parseCourseManifest,
	serializeCourseManifest,
	validateManifest,
} from "../shared/course-manifest";
import { readFileWithin, resolveExistingPathWithin } from "./path-security";
import { applyPlainYamlEdits, plainYamlDocument, type YamlEdit } from "./plain-yaml-edit";
import {
	applyProjectFilePlan,
	type ProjectFileChange,
	withProjectFileTransaction,
} from "./project-file-transactions";

export const COURSE_MANIFEST_FILENAME = "course.yaml";

interface ReadCourseManifestDataOptions {
	requireManifest?: boolean;
}

export interface CourseManifestData {
	manifest: CourseManifest;
	manifestSource: string | undefined;
	lessonFilesOnDisk: string[];
	orderedLessons: string[];
	unlistedLessons: string[];
}

export async function readCourseManifestData(
	courseDir: string,
	options: ReadCourseManifestDataOptions = {},
): Promise<CourseManifestData> {
	return withProjectFileTransaction(
		courseDir,
		(root) => readManifestSnapshot(root, options),
		"read",
	);
}

/** Change the lesson inventory without rewriting surrounding metadata. */
function patchManifestLessons(source: string, value: string[]): string {
	const key = "lessons";
	const document = plainYamlDocument(source);
	if (document.errors.length || !isMap(document.contents) || !document.contents.range)
		throw new Error("Invalid course manifest; refusing field changes");
	const map = document.contents;
	const ending = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
	const replacement = JSON.stringify(value);
	const pair = map.items.find((pair) => isScalar(pair.key) && pair.key.value === key);
	const edits: YamlEdit[] = [];
	if (pair && isNode(pair.value) && pair.value.range) {
		const [start, end] = pair.value.range;
		const trailingEnding = source.slice(start, end).match(/(?:\r\n|\r|\n)$/)?.[0] ?? "";
		const commentSeparator = source[end] === "#" ? " " : "";
		edits.push({ start, end, text: replacement + trailingEnding + commentSeparator });
	} else if (map.flow) {
		const end = map.range[1] - 1;
		edits.push({ start: end, end, text: `${map.items.length ? ", " : ""}${key}: ${replacement}` });
	} else {
		const end = map.range[1];
		const before = source.slice(0, end);
		edits.push({
			start: end,
			end,
			text: `${before && !/[\r\n]$/.test(before) ? ending : ""}${key}: ${replacement}${ending}`,
		});
	}
	const expected = { ...document.toJS(), [key]: value };
	return applyPlainYamlEdits(source, edits, expected, parseCourseManifest);
}

/** Change only the owned lessons value; preserve every surrounding authored byte. */
export async function planManifestLessons(
	root: string,
	update: (lessons: string[]) => string[],
	create = false,
): Promise<ProjectFileChange[]> {
	let source: string | null;
	try {
		source = (await readFileWithin(root, join(root, COURSE_MANIFEST_FILENAME), "utf8")) as string;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		source = null;
	}
	if (source === null && !create) return [];
	const manifest = parseCourseManifest(source ?? "");
	const lessons = update(manifest.lessons);
	if (source !== null && JSON.stringify(lessons) === JSON.stringify(manifest.lessons)) return [];
	let content: string;
	if (source === null) content = serializeCourseManifest({ ...manifest, lessons });
	else {
		content = patchManifestLessons(source, lessons);
	}
	return [{ path: COURSE_MANIFEST_FILENAME, content, expectedContent: source, head: true }];
}

async function readManifestSnapshot(
	courseDir: string,
	options: ReadCourseManifestDataOptions,
): Promise<CourseManifestData> {
	let manifestYaml: string | undefined;
	try {
		manifestYaml = (await readFileWithin(
			courseDir,
			join(courseDir, COURSE_MANIFEST_FILENAME),
			"utf-8",
		)) as string;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		if (options.requireManifest) {
			throw new Error(`Missing course manifest: ${COURSE_MANIFEST_FILENAME}`);
		}
	}

	// Reading must surface malformed authored YAML even when no field migration
	// is needed. Otherwise the tolerant model parser hides it behind defaults.
	if (manifestYaml !== undefined) plainYamlDocument(manifestYaml);
	const manifest = parseCourseManifest(manifestYaml ?? "");
	const entries = await readdir(courseDir, { withFileTypes: true });
	// Symlink lessons remain unsupported, but an escape must fail at preparation
	// rather than be hidden as an absent lesson by manifest discovery.
	for (const entry of entries) {
		if (entry.isSymbolicLink() && entry.name.toLowerCase().endsWith(".prax")) {
			await resolveExistingPathWithin(courseDir, join(courseDir, entry.name));
		}
	}
	const lessonFilesOnDisk = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".prax"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	const discoveredLessons =
		manifest.lessons.length > 0 ? [...manifest.lessons] : [...lessonFilesOnDisk];
	const validation = validateManifest(
		{ ...manifest, lessons: discoveredLessons },
		lessonFilesOnDisk,
	);
	const orderedLessons = discoveredLessons.filter(
		(filename, index) =>
			!validation.missingFiles.includes(filename) && discoveredLessons.indexOf(filename) === index,
	);

	const discoveredManifest = { ...manifest, lessons: discoveredLessons };
	const identifiedManifest = { manifest: discoveredManifest, manifestSource: manifestYaml };

	return {
		manifest: identifiedManifest.manifest,
		manifestSource: identifiedManifest.manifestSource,
		lessonFilesOnDisk,
		orderedLessons,
		unlistedLessons: validation.unlistedFiles,
	};
}
