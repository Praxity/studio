import { PracticeAdmissionError } from "@praxity/export-pipeline";
import { CoursePracticeAdmissionError, practiceDiagnosticMessage } from "@praxity/grammar";
import type { PreviewCompileDiagnostic } from "@praxity/shared-blocks/course-preview-protocol";
import { previewMessages } from "../../shared/preview-messages";

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

export interface CanvasPracticeDiagnostic {
	code: "practice-no-tracking" | "private-choice-practice-only";
	file?: string;
	line?: number;
	column?: number;
}

export function canvasPracticeDiagnostics(error: unknown): CanvasPracticeDiagnostic[] | undefined {
	const diagnostics: CanvasPracticeDiagnostic[] = [];
	const shown = (code: string): code is CanvasPracticeDiagnostic["code"] =>
		code === "practice-no-tracking" || code === "private-choice-practice-only";
	if (error instanceof CoursePracticeAdmissionError) {
		for (const { code, file, line, column } of error.diagnostics)
			if (shown(code)) diagnostics.push({ code, file, line, column });
	} else if (error instanceof PracticeAdmissionError && shown(error.code))
		diagnostics.push({ code: error.code });
	return diagnostics.length ? diagnostics : undefined;
}

export function canvasPracticeRefusalText(
	diagnostics: readonly CanvasPracticeDiagnostic[],
	locale: "en" | "fr",
): string {
	return diagnostics
		.map(({ code, file, line, column }) => {
			const message = practiceDiagnosticMessage(code, locale);
			return canvasSourceLocation({ file, line, column }, message, locale);
		})
		.join("\n");
}

export function canvasSourceLocation(
	location: { file?: string; line?: number; column?: number },
	message: string,
	locale: "en" | "fr",
) {
	if (location.file === undefined) return message;
	const values = {
		file: location.file,
		line: String(location.line),
		column: String(location.column),
		message,
	};
	return previewMessages[locale].sourceLocation.replace(
		/\{(file|line|column|message)\}/g,
		(_, key: keyof typeof values) => values[key],
	);
}
