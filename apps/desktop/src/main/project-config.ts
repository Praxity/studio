import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PROJECT_CONFIG, type ProjectConfig } from "@praxity/editor-core/types";
import { projectConfigSchema } from "../shared/ipc-schemas";
import { readFileWithin } from "./path-security";
import { withProjectFileTransaction } from "./project-file-transactions";

export async function readProjectConfig(projectDir: string) {
	return withProjectFileTransaction(projectDir, readConfigSnapshot, "read");
}

async function readConfigSnapshot(projectDir: string) {
	const configPath = join(projectDir, "praxity.json");
	if (!existsSync(configPath)) return { ...DEFAULT_PROJECT_CONFIG };
	const { parsed } = await decodeConfig(projectDir);
	return parsed.success ? parsed.data : { ...DEFAULT_PROJECT_CONFIG };
}

type CompletionSettings = Partial<
	Pick<ProjectConfig["export"], "completionThreshold" | "requireKnowledgeChecks" | "passingScore">
>;

export async function resolveCompletionSettings(
	options: CompletionSettings & { projectDir: string; fallbackCompletionThreshold: number },
) {
	return withProjectFileTransaction(
		options.projectDir,
		() => readCompletionSettings(options),
		"read",
	);
}

async function readCompletionSettings(options: Parameters<typeof resolveCompletionSettings>[0]) {
	let saved: CompletionSettings = {};
	let rawConfig: unknown;
	try {
		const decoded = await decodeConfig(options.projectDir);
		rawConfig = decoded.rawConfig;
		const parsed = decoded.parsed;
		if (parsed.success) saved = parsed.data.export;
	} catch (error) {
		if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT")
			throw error;
		// Missing or invalid project config uses the caller's fixed defaults.
	}
	// A pass mark decides pass/fail, so an unusable one must not silently fall back to a
	// completion-only package (or drop the other saved completion rules with it).
	const savedPassingScore = (rawConfig as { export?: { passingScore?: unknown } } | undefined)
		?.export?.passingScore;
	if (
		options.passingScore === undefined &&
		savedPassingScore !== undefined &&
		!projectConfigSchema.shape.export.shape.passingScore.safeParse(savedPassingScore).success
	)
		throw new Error(
			"praxity.json export.passingScore must be a fraction above 0 through 1, such as 0.8. Fix or remove it.",
		);
	return {
		completionThreshold:
			options.completionThreshold ??
			saved.completionThreshold ??
			options.fallbackCompletionThreshold,
		requireKnowledgeChecks: options.requireKnowledgeChecks ?? saved.requireKnowledgeChecks ?? false,
		passingScore: options.passingScore ?? saved.passingScore,
	};
}

async function decodeConfig(projectDir: string) {
	const raw = (await readFileWithin(
		projectDir,
		join(projectDir, "praxity.json"),
		"utf-8",
	)) as string;
	const rawConfig: unknown = JSON.parse(raw);
	return { rawConfig, parsed: projectConfigSchema.safeParse(rawConfig) };
}
