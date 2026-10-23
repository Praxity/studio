import { createHash } from "node:crypto";
import path from "node:path";
import {
	type DesignSettingWarning,
	formatDialogueWarning,
	type GrammarFrontmatter,
	type TypographyWarning,
} from "@praxity/grammar";
import { withoutInlineProjectionMetadata } from "@praxity/shared-blocks/inline-markdown";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import {
	resolveLessonNarration,
	type SelfCheckNarrationWarning,
} from "../../shared/narration-sidecar";
import { resolveDesignSettings } from "../../shared/settings-inheritance";
import { readCourseManifestData } from "../course-manifest-io";
import { parseLessonSource, resolveLessonSources } from "../lesson-source";
import { readFileWithin } from "../path-security";
import { withProjectFileTransaction } from "../project-file-transactions";
import { type AuthorWarning, lessonTitleWarnings } from "./accessibility-enforcement";
import { readNarrationSidecar } from "./build-export-input-from-project";
import { refuseUnsupportedDescriptions } from "./inspection-evidence";

/**
 * Experimental: block `data` mirrors the parsed grammar and may change between
 * Studio versions. Consumers pin `schema` and treat unknown fields as opaque.
 */
export const INSPECT_SCHEMA = "praxity-inspect/0";

export interface InspectedBlock {
	id: string;
	type: string;
	/** 1-based line where the block starts in the lesson file; null for generated blocks. */
	line: number | null;
	data: Record<string, unknown>;
}

export interface InspectedPage {
	id: string;
	number: number;
	title: string;
	data: Record<string, unknown>;
	blocks: InspectedBlock[];
}

export interface InspectedLesson {
	file: string;
	id: string | null;
	title: string;
	sha256: string;
	frontmatter: GrammarFrontmatter;
	pages: InspectedPage[];
}

export interface CourseInspection {
	schema: typeof INSPECT_SCHEMA;
	studioVersion: string;
	warnings: Array<
		| AuthorWarning
		| (SelfCheckNarrationWarning & { file: string })
		| ({
				blockId: string;
				message: string;
				file?: string;
				line?: number;
				severity?: "warning";
				code?: DesignSettingWarning["code"] | SelfCheckNarrationWarning["code"];
		  } & Partial<Omit<TypographyWarning, "code">>)
	>;
	course: { id: string | null; title: string; locale: string; description: string | null };
	lessons: InspectedLesson[];
}

/**
 * Reads a project without writing to it. Export may add IDs and migrate identity
 * sidecars; inspect uses preview identities instead, so a project that Studio has
 * never saved gets fresh block IDs on each run while its line numbers stay stable.
 */
export async function inspectProject(
	projectDir: string,
	studioVersion: string,
): Promise<CourseInspection> {
	return withProjectFileTransaction(projectDir, (root) =>
		inspectProjectSnapshot(root, studioVersion),
	);
}

async function inspectProjectSnapshot(
	projectDir: string,
	studioVersion: string,
): Promise<CourseInspection> {
	const { manifest, orderedLessons } = await readCourseManifestData(projectDir, {
		requireManifest: true,
	});
	const identity = await resolveLessonSources(projectDir);
	const sidecar = await readNarrationSidecar(projectDir, identity.identity.course.courseId);
	const lessons: InspectedLesson[] = [];
	const warnings: CourseInspection["warnings"] = (manifest.castWarnings ?? []).map((message) => ({
		blockId: "course.yaml",
		message,
	}));

	for (const file of orderedLessons) {
		const source = (await readFileWithin(
			projectDir,
			path.join(projectDir, file),
			"utf-8",
		)) as string;
		const parsed = await parseLessonSource(projectDir, file, source, {
			cast: manifest.cast,
			identity,
		});
		refuseUnsupportedDescriptions(parsed, file);
		const locale = resolveDesignSettings(
			null,
			manifest,
			parsed.frontmatter as Record<string, unknown>,
		).locale;
		warnings.push(...lessonTitleWarnings(parsed.frontmatter, file, locale));
		for (const { source, ...warning } of resolveDesignSettings(null, manifest, parsed.frontmatter)
			.designWarnings) {
			const blockId = source === "course" ? "course.yaml" : file;
			if (
				!warnings.some(
					(existing) =>
						"blockId" in existing &&
						existing.blockId === blockId &&
						existing.code === warning.code &&
						existing.path === warning.path,
				)
			)
				warnings.push({ ...warning, blockId });
		}
		warnings.push(
			...parsed.dialogueWarnings.map((warning) => formatDialogueWarning(warning, locale)),
		);
		const lines = new Map([...parsed.spans].map(([id, span]) => [id, span.startLine + 1]));
		const narrated = resolveLessonNarration({
			read: parsed,
			courseId: parsed.courseId,
			lessonId: parsed.lessonId,
			sidecar,
			locale,
			enabled: manifest.narrationEnabled,
			digest: (text) => createHash("sha256").update(text).digest("hex"),
		});
		warnings.push(...narrated.warnings.map((warning) => ({ ...warning, file })));
		const title =
			typeof narrated.frontmatter.title === "string" && narrated.frontmatter.title.trim()
				? narrated.frontmatter.title.trim()
				: file.replace(/\.prax$/i, "");
		const pages = splitBlocksIntoPages(narrated.blocks, title);
		lessons.push({
			file,
			id: parsed.lessonId,
			title,
			sha256: createHash("sha256").update(source).digest("hex"),
			frontmatter: narrated.frontmatter,
			pages: withoutInlineProjectionMetadata(
				pages.map((page) => ({
					id: page.id,
					number: page.pageNumber,
					title: page.title,
					data: page.data,
					blocks: page.blocks.map((block) => ({
						id: block.id,
						type: block.type,
						line: lines.get(block.id) ?? null,
						data: block.data,
					})),
				})),
				{ keepDisplay: true },
			),
		});
	}

	return {
		schema: INSPECT_SCHEMA,
		studioVersion,
		warnings,
		course: {
			id: identity.identity.course.courseId,
			title: manifest.title || path.basename(projectDir),
			locale: manifest.locale ?? "en",
			description: manifest.description ?? null,
		},
		lessons,
	};
}
