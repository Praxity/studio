import { PracticeAdmissionError } from "@praxity/export-pipeline";
import { CoursePracticeAdmissionError, practiceDiagnosticMessage } from "@praxity/grammar";
import type { PreviewCompileDiagnostic } from "@praxity/shared-blocks/course-preview-protocol";
import { canvasMessages } from "../../shared/canvas-messages";

/** Preserve localization and source metadata without copying authored operands. */
export function previewDiagnostics(error: unknown, file?: string): PreviewCompileDiagnostic[] {
	if (error instanceof CoursePracticeAdmissionError) return error.diagnostics;
	return [
		{
			...(file ? { file } : {}),
			message: error instanceof Error ? error.message : String(error),
			...(error instanceof PracticeAdmissionError
				? { code: error.code, messageRef: error.messageRef }
				: {}),
		},
	];
}

/** Content-free practice refusal from a canvas build: code and source position only. */
export interface CanvasPracticeDiagnostic {
	code: "practice-no-tracking" | "private-choice-practice-only";
	/** Absent when only compiled output identified the violation. */
	file?: string;
	line?: number;
	column?: number;
}

/** Canvas builds report only these two practice codes, as code and source position.
 * References, block IDs and upstream messages stay on the server. */
export function canvasPracticeDiagnostics(error: unknown): CanvasPracticeDiagnostic[] | undefined {
	const diagnostics: CanvasPracticeDiagnostic[] = [];
	const shown = (code: string): code is CanvasPracticeDiagnostic["code"] =>
		code === "practice-no-tracking" || code === "private-choice-practice-only";
	if (error instanceof CoursePracticeAdmissionError) {
		for (const { code, file, line, column } of error.diagnostics)
			if (shown(code)) diagnostics.push({ code, file, line, column });
	} else if (error instanceof PracticeAdmissionError && shown(error.code))
		// Compiled-only refusals have no source span; never invent one.
		diagnostics.push({ code: error.code });
	return diagnostics.length ? diagnostics : undefined;
}

/** One line per refusal in the course language, for the canvas status. */
export function canvasPracticeRefusalText(
	diagnostics: readonly CanvasPracticeDiagnostic[],
	locale: "en" | "fr",
): string {
	return diagnostics
		.map(({ code, file, line, column }) => {
			const message = practiceDiagnosticMessage(code, locale);
			if (file === undefined) return message;
			const values = { file, line: String(line), column: String(column), message };
			// One pass keeps a file name such as "{line}.prax" literal.
			return canvasMessages[locale].sourceLocation.replace(
				/\{(file|line|column|message)\}/g,
				(_, key: keyof typeof values) => values[key],
			);
		})
		.join("\n");
}
