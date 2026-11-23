import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROJECT_CONFIG } from "@praxity/editor-core/types";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LocalStorageRuntime } from "../../../packages/export-pipeline/src/scorm/local-storage-runtime";
import { CourseTracker } from "../../../packages/export-pipeline/src/scorm/tracking";
import { readProjectConfig, resolveCompletionSettings } from "./main/project-config";
import { DEFAULT_APP_SETTINGS } from "./shared/types";

let projectDir: string;
const values = new Map<string, string>();
const storage: Storage = {
	get length() {
		return values.size;
	},
	clear: () => values.clear(),
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => {
		values.set(key, value);
	},
	removeItem: (key) => {
		values.delete(key);
	},
	key: (index) => [...values.keys()][index] ?? null,
};
beforeEach(async () => {
	projectDir = await mkdtemp(path.join(os.tmpdir(), "completion-default-"));
	storage.clear();
});
afterEach(async () => {
	await rm(projectDir, { recursive: true, force: true });
});

it.each([
	["CLI", () => DEFAULT_PROJECT_CONFIG.export.completionThreshold],
	["Studio", () => DEFAULT_APP_SETTINGS.defaultCompletionThreshold],
] as const)("%s export without saved settings waits for the last page", async (_host, fallback) => {
	const config = await readProjectConfig(projectDir);
	const settings = await resolveCompletionSettings({
		projectDir,
		fallbackCompletionThreshold: fallback(),
	});
	const runtime = new LocalStorageRuntime(storage);
	const tracker = new CourseTracker(runtime, {
		totalPages: 5,
		completionMethod: "percentage",
		completionThreshold: settings.completionThreshold * 100,
	});
	for (const page of ["intro", "lesson", "practice", "review"]) tracker.trackPageVisit(page);
	expect(runtime.getCompletion()).toBe("incomplete");
	tracker.trackPageVisit("review");
	expect(runtime.getCompletion()).toBe("incomplete");
	tracker.trackPageVisit("closing-survey");
	expect(runtime.getCompletion()).toBe("completed");
	expect(config.export.completionThreshold).toBe(1);
});

it("keeps an explicitly saved 80% threshold", async () => {
	const saved = JSON.stringify({
		version: 1,
		export: { format: "scorm-1.2", completionThreshold: 0.8 },
	});
	const configPath = path.join(projectDir, "praxity.json");
	await writeFile(configPath, saved);
	expect((await readProjectConfig(projectDir)).export.completionThreshold).toBe(0.8);
	const settings = await resolveCompletionSettings({
		projectDir,
		fallbackCompletionThreshold: DEFAULT_PROJECT_CONFIG.export.completionThreshold,
	});
	const runtime = new LocalStorageRuntime(storage);
	const tracker = new CourseTracker(runtime, {
		totalPages: 5,
		completionMethod: "percentage",
		completionThreshold: settings.completionThreshold * 100,
	});
	for (const page of ["intro", "lesson", "practice", "review"]) tracker.trackPageVisit(page);
	expect(runtime.getCompletion()).toBe("completed");
	expect(await readFile(configPath, "utf8")).toBe(saved);
});
