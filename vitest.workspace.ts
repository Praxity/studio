import { platform } from "node:os";
import { defineConfig } from "vitest/config";
import SlowTestsReporter from "./scripts/slow-tests-reporter.mjs";
import DurationSequencer, { FileTimingReporter } from "./scripts/vitest-sequencer";

export const workspaceProjects = [
	"packages/grammar",
	"packages/content-identity",
	"packages/operations",
	"packages/shared-blocks",
	"packages/export-pipeline",
	"packages/editor-core",
	"packages/format-renderers",
	"packages/review-share",

	"apps/cli",
] as const;

export default defineConfig({
	test: {
		reporters:
			process.env.CI === "true"
				? ["default", new SlowTestsReporter(), new FileTimingReporter()]
				: ["default"],
		sequence: { sequencer: DurationSequencer },
		maxWorkers:
			platform() === "darwin"
				? 1
				: platform() === "linux" && process.env.CI === "true"
					? "100%"
					: "50%",
		projects: workspaceProjects as unknown as NonNullable<
			NonNullable<Parameters<typeof defineConfig>[0]["test"]>["projects"]
		>,
	},
});
