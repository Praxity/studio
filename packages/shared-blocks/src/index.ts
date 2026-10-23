// Assessment block (unified)
export { PreviewAssessmentBlock } from "./blocks/AssessmentBlock";
export { AuthoringLogicContext } from "./blocks/authoring-context";
// Container context (parent-child communication)
export { ContainerContext, type ContainerContextValue } from "./blocks/container-context";
// Publish context (tier-aware rendering in published output)
export { PublishContext, usePublishContext } from "./blocks/publish-context";
// Block renderers
// Components
export { RequiredIndicator } from "./components";
// Shared constants
export { ASSET_FIELDS, GRAMMAR_YTEXT_FIELD, SELF_HOSTNAMES } from "./constants";
export type { ContentDensityConfig } from "./content-density";
// Content density engine (pure functions, no React dependency)
export {
	countDialogueWords,
	countWordsInHtml,
	estimateBlockTime,
} from "./content-density";
export { adaptGrammarPreviewBlocks } from "./grammar-adapter";
export { HEADING_STYLES, HEADING_STYLES_PUBLISHED } from "./heading-styles";
export type { LearnerStrings } from "./i18n";
// i18n (learner-facing strings)
export { getStrings, LocaleContext, useLocale, useStrings } from "./i18n";
export * from "./learner-state";
export { processMathSpans } from "./math/process-math-spans";
// Math utilities (KaTeX rendering)
export { renderMath } from "./math/render-math";
export * from "./narration";
export { getNoteTypeLabel, NoteIcon, normalizeNoteProps } from "./note";
// HTML sanitization (safe rendering)
export { sanitizeHtml } from "./sanitize";
export * from "./self-check-state";
export type { CardBlockData, CardItem } from "./types";
export * from "./types";
