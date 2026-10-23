import {
	type DialogueCast,
	normalizeDialogueCast,
	normalizeLineEndings,
	type PronunciationConfig,
} from "@praxity/grammar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface CourseManifest {
	title: string;
	description?: string;
	locale?: string;
	courseHomeUrl?: string;
	narrationEnabled?: boolean;
	moduleDeck?: boolean;
	theme?: string;
	lessons: string[];
	design: Record<string, unknown>;
	pronunciation?: PronunciationConfig;
	cast?: DialogueCast;
	/** Authored YAML value, kept so rewrites retain invalid cast entries. */
	castRaw?: unknown;
	castWarnings?: string[];
}

export interface ManifestValidation {
	missingFiles: string[]; // in lessons: but not on disk
	unlistedFiles: string[]; // on disk but not in lessons:
	duplicates: string[]; // duplicate entries in lessons:
}

export class CourseHomeUrlError extends Error {
	constructor(locale = "en") {
		super(
			locale.startsWith("fr")
				? "courseHomeUrl doit être une URL relative ou une URL HTTPS absolue."
				: "courseHomeUrl must be a relative URL or an absolute HTTPS URL.",
		);
	}
}

function parseCourseHomeUrl(value: unknown, locale: string): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		!value ||
		value !== value.trim() ||
		/[\u0000-\u001f\u007f\\]/u.test(value) ||
		value.startsWith("//")
	) {
		throw new CourseHomeUrlError(locale);
	}
	const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(value);
	try {
		const url = new URL(value, "https://course.invalid/");
		if (url.protocol === "https:" && (!hasScheme || /^https:\/\//iu.test(value))) return value;
	} catch {
		// Report malformed URLs with the same field-specific refusal as unsafe schemes.
	}
	throw new CourseHomeUrlError(locale);
}

export function parseCourseManifest(yamlContent: string, locale = "en"): CourseManifest {
	let raw: Record<string, unknown> = {};
	try {
		const parsed = parseYaml(normalizeLineEndings(yamlContent));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			raw = parsed as Record<string, unknown>;
		}
	} catch {
		// Invalid YAML — return defaults
	}

	if (raw.moduleDeck !== undefined && typeof raw.moduleDeck !== "boolean") {
		throw new Error("moduleDeck must be a boolean");
	}
	const { cast, warnings: castWarnings } = normalizeDialogueCast(
		raw.cast,
		typeof raw.locale === "string" ? raw.locale : "en",
	);

	// Retired persisted `badge` values are intentionally omitted from normalized state.
	return {
		title: typeof raw.title === "string" ? raw.title : "",
		description: typeof raw.description === "string" ? raw.description : undefined,
		locale: typeof raw.locale === "string" ? raw.locale : undefined,
		...(raw.courseHomeUrl === undefined
			? {}
			: {
					courseHomeUrl: parseCourseHomeUrl(raw.courseHomeUrl, locale),
				}),
		moduleDeck: raw.moduleDeck as boolean | undefined,
		narrationEnabled: typeof raw.narrationEnabled === "boolean" ? raw.narrationEnabled : undefined,
		theme: typeof raw.theme === "string" ? raw.theme : undefined,
		lessons: Array.isArray(raw.lessons)
			? raw.lessons.filter((item): item is string => typeof item === "string")
			: [],
		design:
			raw.design && typeof raw.design === "object" && !Array.isArray(raw.design)
				? (raw.design as Record<string, unknown>)
				: {},
		pronunciation:
			raw.pronunciation && typeof raw.pronunciation === "object"
				? (raw.pronunciation as PronunciationConfig)
				: undefined,
		cast: Object.keys(cast).length ? cast : undefined,
		...(Object.hasOwn(raw, "cast") ? { castRaw: raw.cast } : {}),
		...(castWarnings.length ? { castWarnings } : {}),
	};
}

export function serializeCourseManifest(manifest: CourseManifest): string {
	const obj: Record<string, unknown> = { title: manifest.title };
	if (manifest.description) obj.description = manifest.description;
	if (manifest.locale) obj.locale = manifest.locale;
	if (manifest.courseHomeUrl !== undefined) obj.courseHomeUrl = manifest.courseHomeUrl;
	if (manifest.narrationEnabled !== undefined) obj.narrationEnabled = manifest.narrationEnabled;
	if (manifest.moduleDeck !== undefined) obj.moduleDeck = manifest.moduleDeck;
	if (manifest.theme) obj.theme = manifest.theme;
	if (manifest.lessons.length > 0) obj.lessons = manifest.lessons;
	if (Object.keys(manifest.design).length > 0) obj.design = manifest.design;
	if (manifest.pronunciation) obj.pronunciation = manifest.pronunciation;
	if (Object.hasOwn(manifest, "castRaw")) obj.cast = manifest.castRaw;
	else if (manifest.cast && Object.keys(manifest.cast).length) obj.cast = manifest.cast;
	return stringifyYaml(obj);
}

export function validateManifest(
	manifest: CourseManifest,
	praxFilesOnDisk: string[],
): ManifestValidation {
	const seen = new Set<string>();
	const duplicates: string[] = [];
	for (const lesson of manifest.lessons) {
		if (seen.has(lesson)) {
			duplicates.push(lesson);
		}
		seen.add(lesson);
	}

	const listedSet = new Set(manifest.lessons);
	const diskSet = new Set(praxFilesOnDisk);

	return {
		missingFiles: manifest.lessons.filter((f) => !diskSet.has(f)),
		unlistedFiles: praxFilesOnDisk.filter((f) => !listedSet.has(f)),
		duplicates,
	};
}
