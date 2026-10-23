import {
	type PracticeDiagnosticCode,
	practiceDiagnosticMessage,
} from "@praxity/grammar/src/practice-diagnostics.ts";
import type { HighlightData, RetrievalSheetData } from "@praxity/shared-blocks/types";
import { validateContent as validateHighlightContent } from "learning-patterns/patterns/highlight/logic.js";
import { validateContent } from "learning-patterns/patterns/retrieval-sheet/logic.js";

/** Raw compiled input has no guaranteed source coordinates. Expose structural
 * paths and a localization reference, never authored fields or guessed spans. */
export class PracticeAdmissionError extends Error {
	readonly messageRef;
	constructor(
		readonly code: PracticeDiagnosticCode,
		readonly blockId: string,
		readonly referencePath: string,
		locale = "en",
		blockType?: "write-distractors",
	) {
		super(practiceDiagnosticMessage(code, locale, blockType));
		this.name = "PracticeAdmissionError";
		const args: Record<string, string> = blockType ? { type: blockType } : {};
		this.messageRef = { key: `grammar.v4.${code}` as const, args };
	}
}

/** Raw compiled callers do not have the source reader's shape/blank-field admission.
 * Upstream owns schema limits, IDs and cross-field validation; never expose its errors. */
export function assertRetrievalSheetData(
	data: unknown,
	blockId: string,
	referencePath: string,
	locale = "en",
): asserts data is RetrievalSheetData {
	try {
		if (!data || typeof data !== "object" || Array.isArray(data) || !("content" in data))
			throw new Error();
		const content = data.content;
		validateContent(content);
		if (
			[content.title, ...content.questions.flatMap((row) => [row.question, row.answer])].some(
				(text) => !text.trim(),
			)
		)
			throw new Error();
	} catch {
		throw new PracticeAdmissionError("retrieval-sheet-invalid", blockId, referencePath, locale);
	}
}

/** Compiled highlight content uses upstream validation, with content-free Studio errors. */
export function assertHighlightData(
	data: unknown,
	blockId: string,
	referencePath: string,
	locale = "en",
): asserts data is HighlightData {
	try {
		if (!data || typeof data !== "object" || Array.isArray(data) || !("content" in data))
			throw new Error();
		validateHighlightContent(data.content);
	} catch {
		throw new PracticeAdmissionError("highlight-invalid", blockId, referencePath, locale);
	}
}
