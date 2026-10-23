import "./viewer-shell.css";

export { MantineIslandProvider } from "./MantineIslandProvider";
export { buildSlugMap, pageSlug } from "./page-slug";
export {
	checkRequiredBlocks,
	clearRequiredValidation,
	showRequiredValidation,
} from "./required-blocks";
export { scrollElementIntoView } from "./scroll-into-view";
export {
	BUILT_IN_SLIDE_STYLES,
	type ResolvedSlideStyle,
	resolveSlideStyle,
	type SlideStyleDef,
} from "./slide-styles";
export { type PageData, splitBlocksIntoPages } from "./split-pages";
export type { NavToggles, PageInfo, ViewerConfig } from "./types";
