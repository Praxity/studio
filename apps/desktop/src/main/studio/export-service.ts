import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { CoursePracticeAdmissionError } from "@praxity/grammar";
import { z } from "zod";
import { exportScormSchema } from "../../shared/ipc-schemas";
import { sanitizeExportFilenameStem } from "../../shared/path-utils";
import { DEFAULT_APP_SETTINGS } from "../../shared/types";
import {
	type ExportProjectOptions,
	exportProject,
	ProjectExportError,
} from "../export/export-project";
import { saveExport } from "../export/save-export";
import { resolveExistingPathWithin, resolveWritablePathWithin } from "../path-security";

export const browserExportSchema = exportScormSchema
	.extend({ format: exportScormSchema.shape.format.extract(["html", "pdf"]) })
	.strict();

/** Owns one cancellable export and its rooted output. No global/native settings. */
export class StudioExportService {
	private active: { controller: AbortController; done: Promise<unknown> } | undefined;
	private closed = false;
	private enforcement = true;
	get enforced() {
		return this.enforcement;
	}
	setEnforcement(args: unknown) {
		const input = z
			.discriminatedUnion("enforced", [
				z.object({ enforced: z.literal(true) }).strict(),
				z.object({ enforced: z.literal(false), confirmed: z.literal(true) }).strict(),
			])
			.parse(args);
		this.enforcement = input.enforced;
		return this.enforcement;
	}
	constructor(
		private readonly options: {
			projectDir: string;
			exportAssetsDir: string;
			temporaryRoot?: string;
			recordOutputStage?: (file: string) => Promise<void>;
			typstExecutablePath?: string;
			registerDownload: (filePath: string, filename: string, byteLength: number) => string;
			onProgress: (step: string, percent: number) => void;
			runExport?: (options: ExportProjectOptions) => ReturnType<typeof exportProject>;
		},
	) {}

	run(input: ReturnType<typeof browserExportSchema.parse>) {
		if (this.closed) throw new Error("Export service is closed");
		if (this.active) throw new Error("An export is already running");
		const controller = new AbortController();
		const done = this.perform(input, controller);
		this.active = { controller, done };
		return done.finally(() => {
			this.active = undefined;
		});
	}
	cancel() {
		this.active?.controller.abort();
	}
	async close() {
		this.closed = true;
		this.cancel();
		// The admitted RPC owns and reports any job error. Shutdown drains that
		// same promise after cancellation, without reporting it twice.
		await Promise.allSettled(this.active ? [this.active.done] : []);
	}
	private async perform(
		input: ReturnType<typeof browserExportSchema.parse>,
		controller: AbortController,
	) {
		const { projectDir } = this.options;
		const outputDir = path.join(projectDir, "exports");
		if (
			input.outputDir !== undefined &&
			input.outputDir !== "exports" &&
			path.resolve(input.outputDir) !== outputDir
		)
			throw new Error("Export output must be the project's exports folder");
		let savingOutput = false;
		try {
			this.options.onProgress("preparing", 0);
			const result = await (this.options.runExport ?? exportProject)({
				...input,
				adviceLocale: input.locale,
				projectDir,
				exportAssetsDir: this.options.exportAssetsDir,
				typstExecutablePath: this.options.typstExecutablePath,
				workspacePath: null,
				inheritWorkspaceSettings: false,
				manifestPolicy: "read-only",
				fallbackCompletionThreshold: DEFAULT_APP_SETTINGS.defaultCompletionThreshold,
				enforceAccessibility: this.enforced,
				signal: controller.signal,
				temporaryRoot: this.options.temporaryRoot,
				onProgress: (step, percent) => {
					if (!controller.signal.aborted) this.options.onProgress(step, percent);
				},
			});
			controller.signal.throwIfAborted();
			try {
				await mkdir(outputDir);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			await resolveExistingPathWithin(projectDir, outputDir);
			const stem = sanitizeExportFilenameStem(result.title) || "course";
			const filename = `${stem}-${randomUUID()}.${input.format === "pdf" ? "pdf" : "zip"}`;
			const destination = await resolveWritablePathWithin(
				projectDir,
				path.join(outputDir, filename),
			);
			const bytes = "pdf" in result ? result.pdf : result.zip;
			savingOutput = true;
			await saveExport(
				projectDir,
				destination,
				bytes,
				controller.signal,
				this.options.recordOutputStage,
			);
			if (controller.signal.aborted) {
				await rm(await resolveExistingPathWithin(projectDir, destination));
				return null;
			}
			return {
				outputPath: `exports/${filename}`,
				downloadUrl: this.options.registerDownload(destination, filename, bytes.length),
				byteLength: bytes.length,
				...("pdf" in result || result.diagnostics?.length
					? { diagnostics: result.diagnostics }
					: {}),
				...(result.criticalAccessibilityIssues.length
					? {
							accessibilityOverride: {
								exportedAt: new Date().toISOString(),
								criticalIssueCount: result.criticalAccessibilityIssues.length,
							},
						}
					: {}),
			};
		} catch (error) {
			// Compiler cancellation is wrapped by exportProject. Output/cleanup
			// failures must still surface, even when cancellation happened too.
			if (
				controller.signal.aborted &&
				(!savingOutput || (error instanceof Error && error.name === "AbortError"))
			)
				return null;
			if (error instanceof CoursePracticeAdmissionError)
				throw new ProjectExportError(error.code, error.message, { cause: error });
			throw error;
		}
	}
}
