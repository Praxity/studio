import { isSectionPalette, type SectionPaletteName } from "./constants";
import { imageFloatRegions } from "./image-float";
import type { PraxityBlock } from "./types";

export type SectionRhythm = "uniform" | "alternate" | "manual";
export type SectionDividerStyle =
	| "none"
	| "thin"
	| "gradient"
	| "ornamental"
	| "wave"
	| "angle"
	| "curve"
	| "squiggle"
	| "blend";
/** @deprecated Use SectionDividerStyle. */
export type SectionTransition = Extract<
	SectionDividerStyle,
	"none" | "wave" | "angle" | "curve" | "squiggle" | "gradient" | "blend"
>;
export type SectionTexture = "none" | "grain" | "noise" | "paper";
export type { SectionPaletteName } from "./constants";

export interface SectionGroup {
	palette: SectionPaletteName;
	blocks: PraxityBlock[];
}

interface SectionDividerPalette {
	background: string;
}

type SectionDividerPaletteMap = Partial<Record<SectionPaletteName, SectionDividerPalette>>;

export interface SectionDividerModel {
	fromPalette: SectionPaletteName;
	toPalette: SectionPaletteName;
	shape: Exclude<SectionDividerStyle, "none">;
	pathData?: string;
	gradientId?: string;
	styleVars?: {
		dividerFill?: string;
		dividerBackground?: string;
	};
	svgInnerMarkup: string;
}

function getBlockSectionTheme(block: PraxityBlock): SectionPaletteName | undefined {
	if (isSectionPalette(block.sectionTheme)) return block.sectionTheme;
	return block.type === "divider" && isSectionPalette(block.data?.palette)
		? block.data.palette
		: undefined;
}

/**
 * Group a flat block list into publish-time visual sections.
 *
 * - uniform: keep the page flat unless a block has an explicit palette
 * - alternate: split on H2 headings and alternate light/dark palettes
 * - manual: split whenever a block starts a new section via sectionTheme or a divider palette
 */
export function groupBlocksIntoSections(
	blocks: PraxityBlock[],
	rhythm: SectionRhythm,
): SectionGroup[] {
	if (rhythm === "uniform" && !blocks.some(getBlockSectionTheme))
		return [{ palette: "light", blocks: [...blocks] }];
	if (blocks.length === 0) return [];

	const sections: SectionGroup[] = [];
	let currentPalette: SectionPaletteName = "light";
	let currentBlocks: PraxityBlock[] = [];
	let sectionIndex = 0;

	const flushSection = () => {
		if (!currentBlocks.length) return;
		sections.push({ palette: currentPalette, blocks: currentBlocks });
		currentBlocks = [];
	};

	const floatingMembers = new Set(
		imageFloatRegions(blocks)
			.filter((region) => region.float)
			.flatMap((region) => region.blocks.slice(1)),
	);
	for (const block of blocks) {
		const sectionTheme = getBlockSectionTheme(block);
		const headingLevel =
			block.type === "heading" ? Number((block.data as { level?: unknown }).level) : Number.NaN;
		const shouldSplitForHeading =
			rhythm === "alternate" &&
			headingLevel === 2 &&
			!floatingMembers.has(block) &&
			!(
				currentBlocks.length === 1 &&
				currentBlocks[0].type === "divider" &&
				getBlockSectionTheme(currentBlocks[0]) !== undefined
			);
		const shouldSplitForPalette = sectionTheme !== undefined && !floatingMembers.has(block);

		if (shouldSplitForPalette) {
			if (currentBlocks.length > 0) flushSection();
			currentPalette = sectionTheme;
		} else if (shouldSplitForHeading) {
			if (currentBlocks.length > 0) {
				flushSection();
				sectionIndex += 1;
				currentPalette = sectionIndex % 2 === 0 ? "light" : "dark";
			}
		}

		currentBlocks.push(block);
	}

	flushSection();
	return sections;
}

export function getSectionDividerModel(
	shape: SectionDividerStyle,
	fromPalette: SectionPaletteName,
	toPalette: SectionPaletteName,
	palettes?: SectionDividerPaletteMap,
): SectionDividerModel | null {
	if (shape === "none") return null;

	const svgPaths: Record<
		Exclude<SectionDividerStyle, "none" | "gradient" | "blend" | "thin">,
		string
	> = {
		wave: "M0,40 C360,80 720,0 1080,40 C1260,60 1440,40 1440,40 L1440,80 L0,80 Z",
		angle: "M0,80 L720,0 L1440,80 Z",
		curve: "M0,80 Q720,-40 1440,80 Z",
		squiggle:
			"M0,40 C60,10 120,10 180,40 S300,70 360,40 S480,10 540,40 S660,70 720,40 S840,10 900,40 S1020,70 1080,40 S1200,10 1260,40 S1380,70 1440,40 L1440,80 L0,80 Z",
		ornamental:
			"M0,40 Q60,18 120,40 T240,40 T360,40 T480,40 T600,40 T720,40 T840,40 T960,40 T1080,40 T1200,40 T1320,40 T1440,40 L1440,80 L0,80 Z",
	};

	const toFill = palettes?.[toPalette]?.background;
	const fromFill = palettes?.[fromPalette]?.background;
	const isBlendShape = shape === "gradient" || shape === "blend";
	const isThinShape = shape === "thin";
	const gradientId = `praxity-divider-${shape}-${fromPalette}-${toPalette}`;
	const pathData = isBlendShape || isThinShape ? undefined : (svgPaths[shape] ?? svgPaths.wave);
	const svgInnerMarkup = isBlendShape
		? `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--praxity-section-divider-fill, var(--praxity-section-background))" stop-opacity="0.36"/><stop offset="100%" stop-color="var(--praxity-section-divider-fill, var(--praxity-section-background))" stop-opacity="0"/></linearGradient></defs><rect x="0" y="0" width="1440" height="80" fill="url(#${gradientId})"/>`
		: isThinShape
			? `<rect x="0" y="39" width="1440" height="2" />`
			: `<path d="${pathData}" />`;

	return {
		fromPalette,
		toPalette,
		shape,
		pathData,
		gradientId: isBlendShape ? gradientId : undefined,
		styleVars:
			toFill || fromFill
				? {
						...(toFill ? { dividerFill: toFill } : {}),
						...(fromFill ? { dividerBackground: fromFill } : {}),
					}
				: undefined,
		svgInnerMarkup,
	};
}
