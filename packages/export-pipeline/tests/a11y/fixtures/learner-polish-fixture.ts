import { crc32, deflateSync } from "node:zlib";
import { readLesson } from "@praxity/grammar";
import type { PraxityBlock, PraxityPage } from "@praxity/shared-blocks/types";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { DEFAULT_DESIGN_VARIANTS } from "../../../../editor-core/src/lib/themes/design-variant-defaults";
import { THEME_PRESET_DEFAULTS } from "../../../../editor-core/src/lib/themes/theme-preset-defaults";
import type { CourseExportInput } from "../../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../../src/desktop-design";

export const POLISH_IMAGE_URL = "https://example.com/blank-inspection-panel.png";

export const LEARNER_POLISH_VARIANTS = [
	{ route: "learner-polish-en", locale: "en", colorMode: "light" },
	{ route: "learner-polish-fr", locale: "fr", colorMode: "light" },
	{ route: "learner-polish-en-dark", locale: "en", colorMode: "dark" },
] as const;

export type LearnerPolishVariant = (typeof LEARNER_POLISH_VARIANTS)[number];

/**
 * A blank image shows whether its edge stays visible on a pale page. A photo
 * would make the edge pixels depend on the picture.
 */
export function blankPanelPng(width = 480, height = 240): Uint8Array {
	const chunk = (type: string, data: Buffer) => {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const checksum = Buffer.alloc(4);
		checksum.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, checksum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const row = Buffer.alloc(1 + width * 3, 0xff);
	row[0] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const COPY = {
	en: {
		title: "Inspection basics",
		heading: "Check every harness, lanyard and anchor point before anyone climbs",
		info: "Lockers are on the second floor beside the training room.",
		success: "All inspections for this week are complete.",
		alt: "Blank inspection panel",
		table: "| Item | Done | Due |\n|---|---|---|\n| Harness | 12 | 3 |\n| Lanyard | 9 | 6 |",
		tableTitle: "Inspection status",
		chart:
			"| Site | North | South |\n|---|---|---|\n| Q1 | 12 | 18 |\n| Q2 | 16 | 14 |\n| Q3 | 9 | 21 |",
		chartTitle: "Inspections by site",
		question: "Describe one hazard you noticed near the anchor points on the north roof today",
		placeholder: "Type your answer",
		next: "Next steps",
	},
	fr: {
		title: "Notions d'inspection",
		heading: "Vérifiez chaque harnais, longe et point d'ancrage avant toute montée",
		info: "Les casiers se trouvent au deuxième étage, près de la salle de formation.",
		success: "Toutes les inspections de la semaine sont terminées.",
		alt: "Panneau d'inspection vierge",
		table: "| Élément | Fait | À faire |\n|---|---|---|\n| Harnais | 12 | 3 |\n| Longe | 9 | 6 |",
		tableTitle: "État des inspections",
		chart:
			"| Site | Nord | Sud |\n|---|---|---|\n| T1 | 12 | 18 |\n| T2 | 16 | 14 |\n| T3 | 9 | 21 |",
		chartTitle: "Inspections par site",
		question: "Décrivez un danger remarqué aujourd'hui près des points d'ancrage du toit nord",
		placeholder: "Saisissez votre réponse",
		next: "Étapes suivantes",
	},
} as const;

function grammar(locale: "en" | "fr"): string {
	const copy = COPY[locale];
	return (
		"---\ntitle: " +
		copy.title +
		"\nlang: " +
		locale +
		"\n---\n\n# " +
		copy.title +
		"\n\n## " +
		copy.heading +
		"\n\n::: note {tone=info style=shaded}\n" +
		copy.info +
		"\n:::\n\n::: note {tone=success style=shaded}\n" +
		copy.success +
		"\n:::\n\n![" +
		copy.alt +
		"](/assets/blank-inspection-panel.png)\n\n::: table\n" +
		copy.table +
		"\ntitle: " +
		copy.tableTitle +
		"\n:::\n\n::: table {chart=bar}\n" +
		copy.chart +
		"\ntitle: " +
		copy.chartTitle +
		"\n:::\n\n::: free-response " +
		copy.question +
		"\nplaceholder: " +
		copy.placeholder +
		"\n:::\n\n# " +
		copy.next +
		"\n\n" +
		copy.next +
		".\n"
	);
}

function pointImagesAtStub(blocks: PraxityBlock[]): PraxityBlock[] {
	return blocks.map((block) => {
		const data = block.data as Record<string, unknown>;
		return typeof data.src === "string" && data.src.startsWith("/assets/")
			? { ...block, data: { ...data, src: POLISH_IMAGE_URL } }
			: block;
	});
}

/** Campfire with a grain texture: the textured page where the skip link escaped. */
export function buildLearnerPolishCourse(variant: LearnerPolishVariant): CourseExportInput {
	const parsed = readLesson(grammar(variant.locale));
	if (parsed.hasErrors) {
		throw new Error(`Invalid learner polish fixture: ${JSON.stringify(parsed.errors)}`);
	}
	const pages: PraxityPage[] = splitBlocksIntoPages(parsed.blocks, COPY[variant.locale].title).map(
		(page) => ({ ...page, blocks: pointImagesAtStub(page.blocks) }),
	);
	const design = extractDesktopDesignFromFrontmatter({
		design: {
			...DEFAULT_DESIGN_VARIANTS,
			...THEME_PRESET_DEFAULTS.campfire,
			palette: "campfire",
			colorMode: variant.colorMode,
			backgroundTexture: "grain",
		},
	});
	if (design.texture !== "none") throw new Error("Learner polish fixture must use plain paper");
	return {
		...design,
		id: variant.route,
		title: COPY[variant.locale].title,
		sourceLocale: variant.locale,
		content: pages,
		navigationStyle: "sidebar",
		navToggles: { navOutline: true, navPrevNext: true },
		colorMode: variant.colorMode,
	};
}
