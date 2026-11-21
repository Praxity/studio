import type {} from "./course-preview-protocol";

declare module "./course-preview-protocol" {
	interface PreviewCompileDiagnostic {
		code?: string;
		column?: number;
		span?: { start: number; end: number };
	}
}
