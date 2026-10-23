export { migrateCoursePresetDesign, READING_PALETTES } from "./course-reading-palettes";
export {
	COURSE_PRESET_ALIASES,
	COURSE_PRESET_IDS,
	type CoursePresetId,
	resolveCoursePresetId,
	withCoursePresetAliases,
} from "./course-theme-ids";
export {
	type DeckDesign,
	getDeckPreset,
	normalizeDeckDesign,
	resolveDeckDesign,
} from "./deck-design.ts";
export type { CastMember, DialogueCast, DialogueSpeakerWarning } from "./dialogue-cast.ts";
export {
	formatDialogueWarning,
	isAvatarNone,
	normalizeDialogueCast,
	resolveDialogueSpeakers,
} from "./dialogue-cast.ts";
export type {
	DesignSettingWarning,
	FontEntry,
	FontFaceRequest,
	TypographyWarning,
} from "./font-catalog.ts";
export {
	CLEAR_FONT_WEIGHTS,
	collectTypographyFontFaces,
	createTypography,
	DEFAULT_TYPOGRAPHY,
	FONT_LIST,
	findFontEntry,
	fontFamilyListToCss,
	getDesignSettingWarnings,
	getFontEntry,
	getFontSelectData,
	getTypographyWarnings,
	mergeTypography,
	normalizeFontFamilyList,
	normalizeTypography,
	resolveHeadingTypography,
	typographyToCssVariables,
} from "./font-catalog.ts";
export type { FrontmatterResult } from "./frontmatter.ts";
export { findFrontmatterEndOffset, parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
export {
	findLineEnding,
	normalizeLineEndings,
	normalizeYamlLineEndings,
	preserveLineEndings,
} from "./line-endings.ts";
export {
	compileVisibleExpression,
	parseLogicConditionExpression,
	parseLogicScalarValue,
} from "./logic-condition.ts";
export type {
	KeywordCategory,
	KeywordManifest,
	ManifestParameter,
	VariantAxis,
} from "./manifest.ts";
export {
	getAllKeywords,
	getManifest,
	getOptionValue,
	getVariantAxes,
	INERT_PARAMETERS,
	isOptionImplemented,
} from "./manifest.ts";
export {
	isNavArchetype,
	NAV_ARCHETYPES,
	navArchetypeToLayoutClass,
	toNavArchetype,
} from "./nav-archetype-layout.ts";
export type { NavToggleValues } from "./nav-archetype-presets.ts";
export {
	BOOLEAN_NAV_KEYS,
	getNavPreset,
	NAV_PRESET_KEYS,
	PROGRESS_STYLES,
	READING_SUPPORT_PLACEMENTS,
} from "./nav-archetype-presets.ts";
export type * from "./operations/contract.ts";
export {
	applyKeyboardNavFloor,
	getPageFocusDefault,
	getPageNavArchetype,
	inferNavStyleFromToggles,
	mergePageNavToggles,
	pageHasNavOverrides,
} from "./page-nav-overrides.ts";
export { type LessonPage, partitionLessonPages } from "./pages.ts";
export {
	canonicalComponentDefaults,
	toModelParameter,
	toSourceParameter,
} from "./parameter-metadata.ts";
export {
	assertCoursePracticeAdmission,
	CoursePracticeAdmissionError,
	type PracticeSourceDiagnostic,
	practiceAdmissionDiagnostics,
} from "./practice-admission.ts";
export {
	practiceDiagnosticMessage,
	writeDistractorsDiagnosticMessage,
} from "./practice-diagnostics.ts";
export {
	type BlockSpan,
	type ContainerSourceRange,
	HighlightContentError,
	type LessonReadError,
	LessonRuntimeError,
	lessonPageBodyBlocks,
	lessonSourceText,
	type ParseWarning,
	type ReadLessonOptions,
	type ReadLessonResult,
	RetrievalSheetContentError,
	readHighlightContent,
	readLesson,
	readRetrievalSheetContent,
	readSelfCheckContent,
	readWriteDistractorsContent,
	refuseUnavailableLessonRuntime,
	SelfCheckContentError,
	WriteDistractorsContentError,
	withLessonIds,
} from "./read-lesson.ts";
export type { SourceEdit } from "./source-edit.ts";
export {
	applyEdits,
	SourceEditError,
	setFrontmatterPath,
	setYamlPath,
} from "./source-edit.ts";
export {
	type BlockStatus,
	blockStatus,
	HIDDEN_BLOCK_TYPES,
	isCoreBlockType,
	RETIRED_BLOCK_TYPES,
} from "./supported-blocks.ts";
export type {
	DesignVariants,
	FontDisplay,
	FontRoleTypography,
	FontStyle,
	FontWeight,
	GrammarFrontmatter,
	HeadingTypography,
	ImageEffectsMap,
	ImagePerceptualMetadata,
	NavArchetype,
	PronunciationConfig,
	PronunciationLexeme,
	TypographyVariants,
} from "./types.ts";
export { escapeHtml, isSafeCaptionTrackUrl, isSafeEmbedUrl, isSafeMediaUrl } from "./utils.ts";
export { lineColumn } from "./v4/lex/index.ts";
export { type CourseDiagnostic, type CourseLesson, validateCourse } from "./v4/schema.ts";
export {
	createTransientIdAllocator,
	type LessonIdAllocator,
	type LessonNodeRecord,
} from "./v4/to-blocks.ts";
export type { MessageRef } from "./v4/tree/types.ts";
export {
	clearRegisteredSchemas,
	getSchemaForBlockType,
	registerSchema,
} from "./validation/schema-registry.ts";
export { validate } from "./validation/validate.ts";
export type {
	BlockSchema,
	SchemaAttribute,
	ValidationConfig,
	ValidationContext,
	ValidationError,
	ValidationResult,
	ValidationSeverity,
	ValidationStrictness,
} from "./validation/validation-types.ts";
