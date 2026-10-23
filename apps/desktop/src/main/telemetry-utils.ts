import { extname } from "node:path";
import { partitionLessonPages, readLesson } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";

export interface GrammarTelemetryMetrics {
	pageCount: number;
	blockCount: number;
	blockTypes: string[];
}

const MIME_BY_EXTENSION: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".mp4": "video/mp4",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".pdf": "application/pdf",
	".txt": "text/plain",
	".json": "application/json",
	".zip": "application/zip",
};

export function getMimeTypeFromFilename(filename: string): string {
	const extension = extname(filename).toLowerCase();
	return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export function getMetricsFromBlocks(blocks: PraxityBlock[]): GrammarTelemetryMetrics {
	const contentBlocks = blocks.filter((block) => block.type !== "pageBreak");
	const uniqueTypes = new Set<string>();
	for (const block of contentBlocks) {
		uniqueTypes.add(block.type);
	}
	return {
		pageCount: partitionLessonPages(blocks).length,
		blockCount: contentBlocks.length,
		blockTypes: [...uniqueTypes].sort(),
	};
}

function fallbackPageCount(grammar: string): number {
	return (grammar.match(/^#\s+.+/gm) || []).length || 1;
}

export function getGrammarTelemetryMetrics(grammar: string): GrammarTelemetryMetrics {
	try {
		const parsed = readLesson(grammar);
		return getMetricsFromBlocks(parsed.blocks);
	} catch {
		return {
			pageCount: fallbackPageCount(grammar),
			blockCount: 0,
			blockTypes: [],
		};
	}
}
