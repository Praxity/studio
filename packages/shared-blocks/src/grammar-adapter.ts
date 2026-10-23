import {
	type AssessmentDeckOptions,
	assessmentGradingMode,
	resolveAssessmentDontKnow,
} from "@praxity/content-model";
import {
	canonicalComponentDefaults,
	isSafeCaptionTrackUrl,
	toModelParameter,
} from "@praxity/grammar";
import { isDirectVideoUrl } from "./blocks/video-player/url-utils";
import { assertChildIds } from "./child-records";
import { NARRATION_BLOCK_FIELDS } from "./narration";
import { constructSelfCheckDefaults, constructSelfCheckPromptBlock } from "./self-check-prompt";
import type { PraxityBlock } from "./types";
import {
	admitWriteDistractorsPrompt,
	constructWriteDistractorsDefaults,
	constructWriteDistractorsPromptBlock,
} from "./write-distractors-prompt";

export { decodeEscapes, fillBlankChoices, fillBlankParts } from "@praxity/content-model";
export { constructSelfCheckDefaults, constructSelfCheckPromptBlock } from "./self-check-prompt";
export {
	admitWriteDistractorsPrompt,
	constructWriteDistractorsDefaults,
	constructWriteDistractorsPromptBlock,
} from "./write-distractors-prompt";

type DataRecord = Record<string, unknown>;
type ComponentDefaultsMap = Record<string, Record<string, unknown>>;

function isSliderComparison(block: PraxityBlock): boolean {
	if (block.type !== "columns") return false;
	const data = (block.data ?? {}) as DataRecord;
	return (data.style ?? data.comparisonStyle) === "slider";
}

function isImageBlock(block: PraxityBlock | undefined): block is PraxityBlock {
	return block?.type === "image";
}

function getImageAlt(data: DataRecord): string {
	const altText = typeof data.altText === "string" ? data.altText : "";
	const alt = typeof data.alt === "string" ? data.alt : "";
	return altText || alt;
}

function getComparisonLabel(block: PraxityBlock, index: number, fallback: string): string {
	const data = (block.data ?? {}) as DataRecord;
	const items = Array.isArray(data.items) ? (data.items as DataRecord[]) : [];
	const item = items[index];
	if (!item) return fallback;
	const heading = typeof item.heading === "string" ? item.heading : "";
	const title = typeof item.title === "string" ? item.title : "";
	const label = typeof item.label === "string" ? item.label : "";
	return heading || title || label || fallback;
}

const ASSESSMENT_DEFAULT_KEYS: Record<string, string> = {
	single: "choose-one",
	multi: "choose-many",
	matching: "match",
	ordering: "order",
	sequence: "order",
	open: "free-response",
	freeResponse: "free-response",
	fillBlank: "fill-blank",
	categorize: "categorize",
	hotspot: "hotspot",
	matrix: "matrix",
};

/** Merge author defaults before adapters synthesize rendering fields. Authored fields win. */
function withComponentDefaults(block: PraxityBlock, defaults?: ComponentDefaultsMap): PraxityBlock {
	if (Object.getOwnPropertyDescriptor(block, "type")?.value === "selfCheck") {
		const result = constructSelfCheckPromptBlock(block);
		for (const [key, value] of Object.entries(defaults?.selfCheck ?? {})) {
			if (!Object.hasOwn(result.data, key)) result.data[key] = value as string | number | boolean;
		}
		return constructSelfCheckPromptBlock(result);
	}
	const distractors = admitWriteDistractorsPrompt(block);
	if (distractors) {
		return constructWriteDistractorsPromptBlock({
			...distractors,
			data: { ...defaults?.writeDistractors, ...distractors.data },
		});
	}

	const keyword =
		block.type === "rating"
			? "rate"
			: block.type === "assessmentGroup"
				? "assessment-group"
				: block.type === "assessment"
					? ASSESSMENT_DEFAULT_KEYS[
							block.data.assessmentType === "choice" && isDataRecord(block.data.response)
								? block.data.response.selectionMode === "multiple"
									? "multi"
									: "single"
								: String(block.data.assessmentType)
						]
					: block.type === "columns" &&
							(block.data.preset === "comparison" || block.data.comparisonStyle !== undefined)
						? "comparison"
						: block.type;
	const settings = defaults?.[keyword] ?? defaults?.[block.type];
	if (!isDataRecord(settings)) return block;
	const normalized = Object.fromEntries(
		Object.entries(settings).map(([key, value]) => {
			const parameter = toModelParameter(keyword, key, value);
			return [parameter.key, parameter.value];
		}),
	);
	// Blank response modes and their choices must be authored on each question.
	if (keyword === "fill-blank") {
		delete normalized.style;
		delete normalized.bank;
	}
	if (keyword === "accordion" && normalized.style !== undefined) {
		normalized.accordionStyle = normalized.style;
		delete normalized.style;
	}
	if ((keyword === "tabs" || keyword === "sequence") && normalized.style !== undefined) {
		normalized.variant =
			keyword === "sequence" && normalized.style === "none" ? "plain" : normalized.style;
		delete normalized.style;
	}
	if (keyword === "comparison" && normalized.style !== undefined) {
		normalized.comparisonStyle = normalized.style;
		delete normalized.style;
	}
	const data = { ...normalized, ...block.data };
	if (
		Array.isArray(data.stem) &&
		block.data.scored === undefined &&
		normalized.scored !== undefined
	)
		data.gradingMode = assessmentGradingMode(normalized.scored);
	if (isDataRecord(data.response) && data.response.type === "choice") {
		data.response = {
			...(normalized.shuffle !== undefined ? { shuffle: normalized.shuffle } : {}),
			...data.response,
		};
	}
	return { ...block, data };
}

function adaptComparisonSequence(
	blocks: PraxityBlock[],
	componentDefaults?: ComponentDefaultsMap,
	captionLocale?: string,
): PraxityBlock[] {
	const result: PraxityBlock[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const block = withComponentDefaults(blocks[i], componentDefaults);
		if (block.type === "pageBreak" && typeof block.data.lessonLocale === "string") {
			captionLocale = block.data.lessonLocale;
		}
		const comparisonItems = Array.isArray(block.data.items)
			? (block.data.items as DataRecord[])
			: [];
		const nestedImages =
			comparisonItems.length === 2 &&
			comparisonItems.every(
				(item) =>
					Array.isArray(item.children) &&
					item.children.length === 1 &&
					isImageBlock(item.children[0] as PraxityBlock),
			)
				? comparisonItems.map((item) => (item.children as PraxityBlock[])[0])
				: undefined;
		const firstImage = nestedImages?.[0];
		const secondImage = nestedImages?.[1];
		if (isSliderComparison(block) && isImageBlock(firstImage) && isImageBlock(secondImage)) {
			const beforeData = (firstImage.data ?? {}) as DataRecord;
			const afterData = (secondImage.data ?? {}) as DataRecord;
			const adaptedComparison: PraxityBlock = {
				id: block.id,
				type: "imageComparison",
				data: {
					display: "slider",
					...(typeof beforeData.caption === "string" ? { beforeCaption: beforeData.caption } : {}),
					...(typeof afterData.caption === "string" ? { afterCaption: afterData.caption } : {}),
					beforeLabel: getComparisonLabel(block, 0, "Before"),
					afterLabel: getComparisonLabel(block, 1, "After"),
					beforeImage: {
						src: typeof beforeData.src === "string" ? beforeData.src : "",
						altText: getImageAlt(beforeData),
					},
					afterImage: {
						src: typeof afterData.src === "string" ? afterData.src : "",
						altText: getImageAlt(afterData),
					},
				},
			};
			result.push(adaptBlock(adaptedComparison, componentDefaults, captionLocale));
			continue;
		}
		result.push(adaptBlock(block, componentDefaults, captionLocale));
	}
	return result;
}

function adaptCard(block: PraxityBlock): PraxityBlock {
	const data = (block.data ?? {}) as DataRecord;
	const asBoolean = (value: unknown, fallback: boolean): boolean =>
		typeof value === "boolean" ? value : fallback;
	const asNumber = (value: unknown, fallback: number): number =>
		typeof value === "number" && Number.isFinite(value) ? value : fallback;
	const normalizeLayout = (value: unknown): "single" | "grid" | "masonry" | "rows" =>
		value === "single" || value === "masonry" || value === "rows" ? value : "grid";
	const normalizeStyle = (
		style: unknown,
	): "none" | "outline" | "filled" | "shaded" | "accent" | "primary" | "secondary" => {
		if (
			style === "none" ||
			style === "outline" ||
			style === "filled" ||
			style === "shaded" ||
			style === "accent" ||
			style === "primary" ||
			style === "secondary"
		)
			return style;
		return "none";
	};
	const normalizeShadow = (shadow: unknown): "theme" | "none" | "subtle" | "elevated" => {
		if (shadow === "none" || shadow === "subtle" || shadow === "elevated" || shadow === "theme") {
			return shadow;
		}
		return "theme";
	};
	const normalizeTransition = (value: unknown): "none" | "fade" | "slide" | "zoom" =>
		value === "none" || value === "slide" || value === "zoom" ? value : "fade";

	type AdaptedCardItem = {
		id: string;
		label: string;
		headingLevel?: number;
		front: PraxityBlock[];
		back: PraxityBlock[];
	};

	const fromItemsArray = (rawItems: DataRecord[]): AdaptedCardItem[] =>
		rawItems.map((item) => {
			const front = Array.isArray(item.front) ? (item.front as PraxityBlock[]) : [];
			const back = Array.isArray(item.back) ? (item.back as PraxityBlock[]) : [];
			return {
				...(typeof item.backId === "string" ? { backId: item.backId } : {}),
				...(isDataRecord(item._inline) ? { _inline: item._inline } : {}),
				id: item.id as string,
				label: typeof item.label === "string" ? item.label : "",
				...(typeof item.headingLevel === "number" ? { headingLevel: item.headingLevel } : {}),
				front,
				back,
			};
		});

	const rawItems = Array.isArray(data.items) ? data.items.filter(isDataRecord) : [];
	const items = fromItemsArray(rawItems);

	const { children: _children, ...rest } = data;
	const layout = normalizeLayout(data.layout);
	const style = normalizeStyle(data.style);
	const shadow = normalizeShadow(data.shadow);

	return {
		...block,
		data: {
			...rest,
			layout,
			columns: Math.max(1, asNumber(data.columns, 1)),
			style,
			shadow,
			shuffle: asBoolean(data.shuffle, false),
			trackCompletion: layout === "single" ? asBoolean(data.trackCompletion, false) : false,
			advance: Math.max(0, asNumber(data.advance, 0)),
			transition: normalizeTransition(data.transition),
			showProgress: asBoolean(data.showProgress, true),
			items,
		},
	};
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function parseHeroOverlay(raw: unknown): {
	overlayColor?: "dark" | "light";
	overlayOpacity?: number;
} {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		const normalized = raw > 1 ? raw / 100 : raw;
		return {
			overlayOpacity: Math.max(0, Math.min(1, normalized)),
		};
	}
	if (typeof raw !== "string") {
		return {};
	}

	const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return {};
	}

	let overlayColor: "dark" | "light" | undefined;
	let overlayOpacity: number | undefined;
	for (const token of tokens) {
		if (token === "dark" || token === "light") {
			overlayColor = token;
			continue;
		}
		const numeric = Number(token.replace(/%$/, ""));
		if (Number.isFinite(numeric)) {
			const normalized = numeric > 1 ? numeric / 100 : numeric;
			overlayOpacity = Math.max(0, Math.min(1, normalized));
		}
	}

	return {
		...(overlayColor ? { overlayColor } : {}),
		...(overlayOpacity !== undefined ? { overlayOpacity } : {}),
	};
}

function isLikelyHeroImageSource(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (/^https?:\/\//i.test(trimmed)) return true;
	if (/^(\/|\.\/|\.\.\/)/.test(trimmed)) return true;
	if (/^assets\//i.test(trimmed)) return true;
	return /\.(avif|webp|png|jpe?g|gif|svg)(\?.*)?$/i.test(trimmed);
}

function adaptHeadingToHeroCover(block: PraxityBlock): PraxityBlock | null {
	if (block.type !== "heading") return null;
	const data = (block.data ?? {}) as DataRecord;
	const background = typeof data.background === "string" ? data.background.trim() : "";
	if (!background || !isLikelyHeroImageSource(background)) {
		return null;
	}

	const titleHtml = typeof data.content === "string" ? data.content : "";
	const title = stripHtml(titleHtml);
	const overlay = parseHeroOverlay(data.overlay);
	const headingOffset =
		typeof data.headingOffset === "number" && Number.isFinite(data.headingOffset)
			? data.headingOffset
			: undefined;

	return {
		...block,
		type: "heroCover",
		data: {
			imageSrc: background,
			imageAlt: typeof data.backgroundAlt === "string" ? data.backgroundAlt : "",
			title,
			...(typeof data.subtitle === "string" && data.subtitle.trim()
				? { subtitle: data.subtitle.trim() }
				: {}),
			...(data.alignment === "left" || data.alignment === "center" || data.alignment === "right"
				? { alignment: data.alignment }
				: {}),
			...(data.verticalAlignment === "top" ||
			data.verticalAlignment === "center" ||
			data.verticalAlignment === "bottom"
				? { verticalAlignment: data.verticalAlignment }
				: {}),
			...(headingOffset !== undefined ? { headingOffset } : {}),
			...overlay,
		},
	};
}

function isDataRecord(value: unknown): value is DataRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function adaptChildArray(
	children: unknown[],
	componentDefaults: ComponentDefaultsMap | undefined,
	captionLocale?: string,
): unknown[] {
	return children.map((child) => {
		if (!isDataRecord(child)) return child;
		const id = child.id;
		const type = child.type;
		const data = child.data;
		if (typeof id !== "string" || typeof type !== "string" || !isDataRecord(data)) {
			return child;
		}
		return adaptBlock(child as unknown as PraxityBlock, componentDefaults, captionLocale);
	});
}

function adaptBlock(
	block: PraxityBlock,
	componentDefaults?: ComponentDefaultsMap,
	captionLocale?: string,
): PraxityBlock {
	block = withComponentDefaults(block, componentDefaults);
	if (block.type === "selfCheck" || block.type === "retrievalSheet" || block.type === "highlight")
		return block;
	const blockWithKnownChildren = (adaptHeadingToHeroCover(block) ?? block) as PraxityBlock & {
		children?: unknown[];
	};
	let adapted: PraxityBlock & { children?: unknown[] } =
		block.type === "card" ? adaptCard(blockWithKnownChildren) : { ...blockWithKnownChildren };

	const nextData: DataRecord = { ...(adapted.data ?? {}) };
	if (block.type === "assessment") {
		if (
			isDataRecord(nextData.response) &&
			nextData.response.type === "choice" &&
			nextData.response.shuffle === undefined
		)
			nextData.response = { ...nextData.response, shuffle: false };
	}
	if (block.type === "columns" && Array.isArray(nextData.items) && nextData.items.length) {
		const items = nextData.items as DataRecord[];
		const widths = items.map((item) =>
			typeof item.width === "number" && Number.isFinite(item.width) && item.width > 0
				? item.width
				: 1,
		);
		const largest = Math.max(...widths);
		const total = widths.reduce((sum, width) => sum + width / largest, 0);
		if (largest * total > 1.01)
			nextData.items = items.map((item, index) => ({
				...item,
				width: widths[index] / largest / total,
			}));
	}
	if (block.type === "video" && nextData.captionTracks !== undefined) {
		if (Array.isArray(nextData.captionTracks)) {
			nextData.captionTracks = nextData.captionTracks.filter(
				(track) =>
					isDataRecord(track) &&
					(track.kind === "captions" ||
						track.kind === "subtitles" ||
						track.kind === "descriptions") &&
					isSafeCaptionTrackUrl(track.src),
			);
		} else {
			delete nextData.captionTracks;
		}
	}
	const videoSrc =
		typeof nextData.src === "string"
			? nextData.src
			: isDataRecord(nextData.source) && nextData.source.type === "url"
				? nextData.source.src
				: "";
	if (block.type === "video" && typeof videoSrc === "string" && isDirectVideoUrl(videoSrc)) {
		const captions = isSafeCaptionTrackUrl(nextData.captions)
			? nextData.captions
			: nextData.captionsSrc;
		if (isSafeCaptionTrackUrl(captions)) {
			const tracks = Array.isArray(nextData.captionTracks) ? nextData.captionTracks : [];
			if (!tracks.some((track) => track.kind === "captions" || track.kind === "subtitles")) {
				const language = captionLocale === "fr" || captionLocale === "en" ? captionLocale : "und";
				nextData.captionTracks = [
					...tracks,
					{
						kind: "captions",
						language,
						label: language === "fr" ? "Français" : language === "en" ? "English" : "",
						src: captions,
						default: true,
					},
				];
			}
		}
	}
	// Resolved v2 narration stays attached to its renderer block.
	for (const key of NARRATION_BLOCK_FIELDS) {
		if (block.data?.[key] !== undefined) nextData[key] = block.data[key];
	}

	if (Array.isArray(adapted.children)) {
		adapted = {
			...adapted,
			children: adaptChildArray(adapted.children, componentDefaults, captionLocale),
		};
	}

	if (Array.isArray(nextData.items)) {
		nextData.items = nextData.items.map((item, index) => {
			if (!isDataRecord(item)) return item;
			const sourceItem = Array.isArray(block.data?.items) ? block.data.items[index] : undefined;
			if (isDataRecord(sourceItem)) {
				item = { ...item };
				for (const key of NARRATION_BLOCK_FIELDS) {
					if (sourceItem[key] !== undefined) item[key] = sourceItem[key];
				}
			}
			if (Array.isArray(item.front) || Array.isArray(item.back)) {
				return {
					...item,
					front: Array.isArray(item.front)
						? adaptChildArray(item.front, componentDefaults, captionLocale)
						: [],
					back: Array.isArray(item.back)
						? adaptChildArray(item.back, componentDefaults, captionLocale)
						: [],
				};
			}
			if (!Array.isArray(item.children)) return item;
			return {
				...item,
				children: adaptChildArray(item.children, componentDefaults, captionLocale),
			};
		});
	}

	return {
		...adapted,
		data: nextData,
	};
}

export function adaptGrammarPreviewBlocks(
	blocks: PraxityBlock[],
	componentDefaults?: ComponentDefaultsMap,
	captionLocale?: string,
	assessmentContext?: { moduleDeck?: AssessmentDeckOptions; preserveSource?: boolean },
): PraxityBlock[] {
	const suppliedIds = assertChildIds(blocks);
	const canonical = canonicalComponentDefaults(
		isDataRecord(componentDefaults)
			? Object.fromEntries(
					Object.keys(componentDefaults)
						.filter(
							(keyword) =>
								!["selfCheck", "self-check", "writeDistractors", "write-distractors"].includes(
									keyword,
								),
						)
						.map((keyword) => [keyword, componentDefaults[keyword]]),
				)
			: componentDefaults,
	);
	const defaults = isDataRecord(canonical)
		? Object.fromEntries(
				Object.entries(canonical).filter((entry): entry is [string, DataRecord] =>
					isDataRecord(entry[1]),
				),
			)
		: {};
	let validated = false;
	let selfCheckDefaults: ReturnType<typeof constructSelfCheckDefaults>;
	// Unused self-check defaults must not refuse an ordinary course.
	Object.defineProperty(defaults, "selfCheck", {
		get() {
			if (!validated) {
				selfCheckDefaults = constructSelfCheckDefaults(componentDefaults);
				validated = true;
			}
			return selfCheckDefaults;
		},
	});
	Object.defineProperty(defaults, "writeDistractors", {
		get() {
			return constructWriteDistractorsDefaults(componentDefaults);
		},
	});

	const adapted = adaptComparisonSequence(blocks, defaults, captionLocale);
	for (const id of assertChildIds(adapted)) {
		if (!suppliedIds.has(id)) throw new Error(`Missing child ID: adapter synthesized ${id}`);
	}
	return resolveAssessmentDontKnow(
		adapted,
		assessmentContext?.moduleDeck,
		assessmentContext?.preserveSource ? blocks : adapted,
	);
}
