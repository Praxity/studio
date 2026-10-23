/** Author source metadata extends the existing transport without entering the
 * learner runtime module's parsed declarations or changing its bundled output. */
import type {} from "./course-preview-protocol";

declare module "./course-preview-protocol" {
	interface PreviewCompileDiagnostic {
		code?: string;
		/** One-based source column. */
		column?: number;
		/** UTF-16 source offsets, when source is available. */
		span?: { start: number; end: number };
	}
}
