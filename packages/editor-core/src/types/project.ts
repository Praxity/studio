import { DEFAULT_COMPLETION_THRESHOLD } from "@praxity/shared-blocks/constants";

export interface ProjectConfig {
	version: number;
	export: {
		format: "scorm-1.2" | "scorm-2004" | "html";
		completionThreshold: number;
		requireKnowledgeChecks?: boolean;
		passingScore?: number;
	};
	cloud?: {
		projectId: string;
	};
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
	version: 1,
	export: {
		format: "scorm-1.2",
		completionThreshold: DEFAULT_COMPLETION_THRESHOLD,
		requireKnowledgeChecks: false,
	},
};
