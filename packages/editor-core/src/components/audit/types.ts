// Shared types for audit panels (a11y, pedagogy, future panels)

export interface GuidanceContent {
	topic: string;
	bullets: string[];
}

export type AuditFilterMode = "severity" | "dismissed";

export type DisplaySeverity = "critical" | "recommended" | "minor";

export interface SeverityCountMap {
	critical: number;
	recommended: number;
	minor: number;
	dismissed: number;
	total: number;
}

export interface AuditIssue {
	annotationId: string;
	category: string;
	displaySeverity: DisplaySeverity;
	fixDomain: string;
	kind: "conformance" | "advisory" | "contentQuality";
	confidence: "high" | "medium" | "low";
	outcome: "failed" | "cantTell";
	sourceLocation: string;
	title: string;
	description: string;
	guidance?: GuidanceContent;
	blockReference: string;
	isDismissed: boolean;
	isFallback: boolean;
	severity: string;
	rule: string;
	message: string;
	blockId?: string;
	pageId?: string;
	documentId?: string;
	documentTitle?: string;
	/** Zero-based source line, independent of transient block IDs across lesson reads. */
	sourceLine?: number;
	isCurrentSource?: (source: string) => boolean;
}

export interface NavigateToIssueRequest {
	annotationId?: string;
	rule: string;
	title: string;
	fixDomain: string;
	blockId?: string;
	pageId?: string;
	documentId?: string;
	documentTitle?: string;
	/** Zero-based source line, independent of transient block IDs across lesson reads. */
	sourceLine?: number;
	isCurrentSource?: (source: string) => boolean;
}

export const DISPLAY_SEVERITY_ORDER: DisplaySeverity[] = ["critical", "recommended", "minor"];
