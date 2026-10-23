import type {
	SectionDividerStyle,
	SectionPaletteName,
	SectionRhythm,
	SectionTexture,
} from "../section-grouping";
import type { SlideStyleDef } from "./slide-styles";

export interface ViewerSectionPalette {
	background: string;
	surface: string;
	text: string;
	textLight: string;
	accent: string;
	border: string;
}

export interface PageInfo {
	id: string;
	title: string;
	slug: string;
	index: number;
	lessonTitle?: string;
	lessonKicker?: string;
	lessonSlug?: string;
	isFirstPageOfLesson?: boolean;
	narrationEnabled?: boolean;
	narrationDefaults?: Record<string, unknown>;
	data?: Record<string, unknown>;
}

export interface NavToggles {
	navOutline?: boolean;
	navHamburgerMenu?: boolean;
	navOutlinePosition?: "left" | "right";
	navPrevNext?: boolean;
	navPrevNextPosition?: "bottom" | "top";
	navProgressStyle?: "bar" | "dots" | "segments" | "none";
	navBottomArrows?: boolean;
	navTopBar?: boolean;
	navReadingSupportPlacement?: "topBar" | "bottomBar" | "sidebar" | "none";
	navFloatingToc?: boolean;
	navScrollProgress?: boolean;
	navEdgeArrows?: boolean;
	navSlideCounter?: boolean;
	navBreadcrumbs?: boolean;
	navCourseTitle?: boolean;
	navLessonTitles?: boolean;
	navLessonTitleAsHeading?: boolean;
	navReadingTime?: boolean;
	navSwipeGestures?: boolean;
	navKeyboardArrows?: boolean;
	showA11yPill?: boolean;
	colorSecondary?: string;
	colorTertiary?: string;
}

export interface ViewerConfig {
	courseId: string;
	courseTitle: string;
	pageTitle: string;
	pageId: string;
	lessonId: string;
	currentPage: number;
	totalPages: number;
	currentSlug: string;
	pages: PageInfo[];
	pageIdMap: Record<string, string>;
	navToggles: NavToggles;
	navigationStyle: "sidebar" | "bottomBar" | "none" | string;
	/**
	 * Chrome-free contexts (sidebar thumbnails) force nav toggles off; per-page
	 * overrides must not re-enable chrome there. Non-nav page params (style,
	 * narration, duration) still apply.
	 */
	ignorePageNavOverrides?: boolean;
	format: string;
	basePath: string;
	sourceLocale: string;
	lessonTitle: string;
	lessonKicker?: string;
	isFirstPageOfLesson: boolean;
	showCourseNameInNav: boolean;
	showLessonNameInNav: boolean;
	showLessonNameAsTitle: boolean;
	estimatedDuration: string;
	colorShades?: Record<string, string[]> | null;
	defaultImageTreatment: string;
	imageEffects?: Record<string, unknown> | null;
	imageEffectsAuto: boolean;
	slideTransition: string;
	motionEntrance?: "none" | "fade" | "slide" | "scale";
	motionStagger?: "none" | "sequential";
	imageHoverEffect: string;
	glossaryEnabled: boolean;
	resourcesEnabled: boolean;
	/** Resolved course/lesson narration enablement; absent is off. */
	narrationEnabled?: boolean;
	/** Effective lesson narration generation defaults. */
	narrationDefaults?: Record<string, unknown>;
	readingTimeMinutes?: number;
	sectionCount?: number;
	pageRole?: string;
	sectionRhythm?: SectionRhythm;
	dividerStyle?: SectionDividerStyle;
	texture?: SectionTexture;
	sectionPalettes?: Partial<Record<SectionPaletteName, ViewerSectionPalette>>;
	slideStyles?: Record<string, SlideStyleDef>;
}
