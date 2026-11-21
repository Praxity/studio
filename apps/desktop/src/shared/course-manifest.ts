import type { CourseHelpConfig } from "@praxity/export-pipeline";
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
	help?: CourseHelpConfig;
	narrationEnabled?: boolean;
	moduleDeck?: boolean;
	theme?: string;
	lessons: string[];
	design: Record<string, unknown>;
	pronunciation?: PronunciationConfig;
	cast?: DialogueCast;
	castRaw?: unknown;
	castWarnings?: string[];
}

export interface ManifestValidation {
	missingFiles: string[];
	unlistedFiles: string[];
	duplicates: string[];
}

type CourseManifestField = "courseHomeUrl" | "help" | "help.endpoint";

/** A refused course.yaml field. The CLI rebuilds it in the caller's language. */
export class CourseHomeUrlError extends Error {
	constructor(
		locale = "en",
		readonly field: CourseManifestField = "courseHomeUrl",
	) {
		const fr = locale.startsWith("fr");
		super(
			field === "help"
				? fr
					? "help doit contenir endpoint et peut contenir les textes label et intro."
					: "help must contain an endpoint and may contain label and intro text."
				: fr
					? `${field} doit être une URL relative ou une URL HTTPS absolue.`
					: `${field} must be a relative URL or an absolute HTTPS URL.`,
		);
	}
}

function parseCourseUrl(
	value: unknown,
	locale: string,
	field: "courseHomeUrl" | "help.endpoint",
): string {
	if (
		typeof value !== "string" ||
		!value ||
		value !== value.trim() ||
		/[\u0000-\u001f\u007f\\]/u.test(value) ||
		value.startsWith("//")
	) {
		throw new CourseHomeUrlError(locale, field);
	}
	const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(value);
	try {
		const url = new URL(value, "https://course.invalid/");
		if (url.protocol === "https:" && (!hasScheme || /^https:\/\//iu.test(value))) return value;
	} catch {}
	throw new CourseHomeUrlError(locale, field);
}

function parseCourseHelp(value: unknown, locale: string): CourseHelpConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new CourseHomeUrlError(locale, "help");
	}
	const { endpoint, label, intro, ...unknown } = value as Record<string, unknown>;
	const optionalText = (text: unknown) =>
		text === undefined || (typeof text === "string" && text.trim().length > 0);
	if (Object.keys(unknown).length || !optionalText(label) || !optionalText(intro)) {
		throw new CourseHomeUrlError(locale, "help");
	}
	if (endpoint === undefined) throw new CourseHomeUrlError(locale, "help");
	return {
		endpoint: parseCourseUrl(endpoint, locale, "help.endpoint"),
		...(label === undefined ? {} : { label: (label as string).trim() }),
		...(intro === undefined ? {} : { intro: (intro as string).trim() }),
	};
}

export function parseCourseManifest(yamlContent: string, locale = "en"): CourseManifest {
	let raw: Record<string, unknown> = {};
	try {
		const parsed = parseYaml(normalizeLineEndings(yamlContent));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			raw = parsed as Record<string, unknown>;
		}
	} catch {}

	if (raw.moduleDeck !== undefined && typeof raw.moduleDeck !== "boolean") {
		throw new Error("moduleDeck must be a boolean");
	}
	const { cast, warnings: castWarnings } = normalizeDialogueCast(
		raw.cast,
		typeof raw.locale === "string" ? raw.locale : "en",
	);

	return {
		title: typeof raw.title === "string" ? raw.title : "",
		description: typeof raw.description === "string" ? raw.description : undefined,
		locale: typeof raw.locale === "string" ? raw.locale : undefined,
		...(raw.courseHomeUrl === undefined
			? {}
			: {
					courseHomeUrl: parseCourseUrl(raw.courseHomeUrl, locale, "courseHomeUrl"),
				}),
		...(raw.help === undefined ? {} : { help: parseCourseHelp(raw.help, locale) }),
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
	if (manifest.help !== undefined) obj.help = manifest.help;
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
