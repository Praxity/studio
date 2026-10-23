import { PracticeAdmissionError } from "@praxity/export-pipeline";
import { CoursePracticeAdmissionError } from "@praxity/grammar";
import type { PreviewCompileDiagnostic } from "@praxity/shared-blocks/course-preview-protocol";

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
