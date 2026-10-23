import { randomBytes } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import en from "@praxity/editor-core/messages/en" with { type: "json" };
import fr from "@praxity/editor-core/messages/fr" with { type: "json" };
import { DEFAULT_PROJECT_CONFIG } from "@praxity/editor-core/types";
import { ViewerAssetsError } from "@praxity/export-pipeline/bundle-viewer";
import { CoursePracticeAdmissionError } from "@praxity/grammar";
import { createTranslator } from "use-intl/core";
import { CourseHomeUrlError } from "../shared/course-manifest";
import { type ExportFormat, studioPortSchema } from "../shared/ipc-schemas";
import type { SelfCheckNarrationWarning } from "../shared/narration-sidecar";
import {
	ProjectPermissionError,
	projectIdentityRecoveryAdvice,
	projectIdentityRecoveryMessage,
	projectPermissionMessage,
	projectPlainStoreMessage,
	projectPlainStorePath,
} from "../shared/project-write-errors";
import cliEn from "./cli-messages/en.json" with { type: "json" };
import cliFr from "./cli-messages/fr.json" with { type: "json" };
import { type CommentsExitCode, commentsHelp, runCommentsCli } from "./comments-cli";
import { COURSE_MANIFEST_FILENAME } from "./course-manifest-io";
import { type EditExitCode, editHelp, runEditCli, runInspectBlocksCli } from "./edit-cli";
import { ExportAccessibilityError } from "./export/accessibility-enforcement";
import { saveExport } from "./export/save-export";
import {
	formatIdentityAdvice,
	formatIdentityBlockLocation,
	runIdentityInitCli,
} from "./identity-init-cli";
import { identityMergeHelp, runIdentityMergeCli } from "./identity-merge-cli";
import { IdentitySourceError, IdentityStoreError } from "./identity-store";
import { InitSettingsError, InitTargetError, initCourse } from "./init-course";
import { narrationHelp, runNarrationCli } from "./narration-cli";
import { LocalEditorStore } from "./operations/local-editor-store";
import {
	assertProjectWritesAllowed,
	extractProjectRecovery,
	listProjectRecovery,
	ProjectRecoveryRestoreError,
	ProjectRecoveryRestoreHeldError,
	resolveProjectRecovery,
	restoreProjectRecovery,
	withProjectFileTransaction,
} from "./project-file-transactions";
import { ReviewAssetsError } from "./studio/read-only-server";
import { isLinkedReviewWorktree, openReviewStore, ReviewStoreError } from "./studio/review-store";
import type { StudioServer } from "./studio/server";

const CLI_FORMATS = new Set<ExportFormat>(["html", "scorm-1.2", "scorm-2004", "pdf"]);
const draftExportCommand = "praxity recovery export-drafts <project-dir> <new-directory>";

const help = (args: string[]) => `Usage:
  praxity init [<course-dir>] [--lang en|fr]
  praxity export <project-dir> --format <format> --output <file-path> [options]
  praxity inspect <project-dir> [--schema 0|1 | <--blocks [--eligibility] | --text-fields> [--json]]
  praxity studio <project-dir> [--review] [--port <n>] [--no-open]
  praxity recovery run <project-dir>
  praxity recovery list <project-dir>
  ${draftExportCommand}
  praxity recovery extract <project-dir> <archive> <new-directory>
  praxity recovery restore <project-dir> <archive> <original|replacement> <path>
  praxity recovery resolve <project-dir> <archive>
  praxity identity merge [<course>]
  praxity identity init <course> [--rederive --confirm-unpublished] [--lang en|fr]

${(args.includes("fr") ? cliFr : cliEn).init.help}

${(args.includes("fr") ? cliFr : cliEn).identityInit.help}

${identityMergeHelp}

${narrationHelp}

${editHelp(args)}

${commentsHelp(args)}

inspect prints the parsed course as JSON without modifying the project.
studio starts a foreground loopback server. Stop it with Ctrl+C.
recovery run recovers an interrupted transaction and retains recovery copies.
recovery list, extract, restore and resolve inspect, preserve, restore or explicitly discard retained copies.
recovery list includes retained editor drafts; export-drafts copies their exact text without removing them.

Formats:
  html | scorm-1.2 | scorm-2004 | pdf

Options:
  --lang en|fr                 Language for inspect/export advice and Studio/recovery notices, default en
  --paper-size a4|letter        PDF paper size, default a4
  --include-answer-sheet       Append PDF answers; authored prose is never redacted
  --allow-critical-a11y-issues  Export after reporting critical accessibility issues
  --no-open                     Print the Studio ready URL without opening a browser
  --review                      ${(args.includes("fr") ? cliFr : cliEn).studio.reviewHelp}
  --port <n>                    Bind Studio to this loopback port, with no fallback
  -h, --help                    Show this help
  -v, --version                 Show the Studio version

The project must contain course.yaml. Do not modify it while export is running.`;

interface CliRuntime {
	/** Standalone hosts flush this notice before identity replacement. */
	writeIdentityNotice?: (text: string) => Promise<void>;
	openReviewStore?: typeof openReviewStore;
	typstExecutablePath?: string;
	appVersion: string;
	exportAssetsDir: string;
	expectedAppVersion?: string;
	expectedViewerSourceHash?: string;
	/** Only the standalone artifact supplies a browser UI build. */
	editorAssetsDir?: string;
}

export interface CliExecution {
	exitCode: EditExitCode | CommentsExitCode;
	stdout: string;
	stderr: string;
	studioServer?: StudioServer;
	openBrowser?: boolean;
}

interface ParsedExportArgs {
	pageSize?: "a4" | "letter";
	includeAnswerSheet: boolean;
	projectDir: string;
	format: Exclude<ExportFormat, "xapi">;
	outputPath: string;
	allowCriticalA11yIssues: boolean;
}

class CliError extends Error {
	readonly code: string;
	readonly exitCode: 1 | 2;
	readonly details?: unknown;

	constructor(code: string, message: string, exitCode: 1 | 2, details?: unknown, cause?: unknown) {
		super(message, { cause });
		this.name = "CliError";
		this.code = code;
		this.exitCode = exitCode;
		this.details = details;
	}
}

function parseExportArgs(args: string[]): ParsedExportArgs {
	let projectDir: string | undefined;
	let format: ParsedExportArgs["format"] | undefined;
	let outputPath: string | undefined;
	let allowCriticalA11yIssues = false;
	let pageSize: "a4" | "letter" | undefined;
	let includeAnswerSheet = false;

	for (let index = 1; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--include-answer-sheet") {
			if (includeAnswerSheet)
				throw new CliError("invalid_arguments", `${argument} may be supplied only once.`, 2);
			includeAnswerSheet = true;
			continue;
		}
		if (argument === "--paper-size") {
			const value = args[++index];
			if (pageSize || (value !== "a4" && value !== "letter"))
				throw new CliError(
					"invalid_arguments",
					"--paper-size requires a4 or letter, supplied once.",
					2,
				);
			pageSize = value;
			continue;
		}
		if (argument === "--allow-critical-a11y-issues") {
			if (allowCriticalA11yIssues) {
				throw new CliError("invalid_arguments", `${argument} may be supplied only once.`, 2);
			}
			allowCriticalA11yIssues = true;
			continue;
		}
		if (argument === "--format" || argument === "--output") {
			const value = args[++index];
			if (!value || value.startsWith("--")) {
				throw new CliError("invalid_arguments", `${argument} requires a value.`, 2);
			}
			if (argument === "--format") {
				if (format)
					throw new CliError("invalid_arguments", "--format may be supplied only once.", 2);
				if (!CLI_FORMATS.has(value as ExportFormat)) {
					throw new CliError("invalid_arguments", `Unsupported format: ${value}`, 2);
				}
				format = value as ParsedExportArgs["format"];
			} else {
				if (outputPath) {
					throw new CliError("invalid_arguments", "--output may be supplied only once.", 2);
				}
				outputPath = value;
			}
			continue;
		}
		if (argument.startsWith("-")) {
			throw new CliError("invalid_arguments", `Unknown option: ${argument}`, 2);
		}
		if (projectDir) {
			throw new CliError("invalid_arguments", `Unexpected argument: ${argument}`, 2);
		}
		projectDir = argument;
	}

	if (!projectDir) throw new CliError("invalid_arguments", "Missing project directory.", 2);
	if (!format) throw new CliError("invalid_arguments", "Missing --format.", 2);
	if (!outputPath) throw new CliError("invalid_arguments", "Missing --output.", 2);
	const extension = format === "pdf" ? ".pdf" : ".zip";
	if (path.extname(outputPath).toLowerCase() !== extension) {
		throw new CliError("invalid_arguments", `--output must name a ${extension} file.`, 2);
	}
	if (format !== "pdf" && (pageSize || includeAnswerSheet))
		throw new CliError("invalid_arguments", "PDF options require --format pdf.", 2);

	return { projectDir, format, outputPath, allowCriticalA11yIssues, pageSize, includeAnswerSheet };
}

async function resolveProjectDir(projectDir: string): Promise<string> {
	try {
		const resolved = await realpath(path.resolve(projectDir));
		if (!(await stat(resolved)).isDirectory()) throw new Error("Not a directory");
		return resolved;
	} catch (error) {
		throw new CliError("project_not_found", `Project directory is unavailable: ${projectDir}`, 1, {
			cause: error instanceof Error ? error.message : String(error),
		});
	}
}

async function resolvePaths(parsed: ParsedExportArgs): Promise<{
	projectDir: string;
	outputPath: string;
}> {
	const projectDir = await resolveProjectDir(parsed.projectDir);
	const outputPath = path.resolve(parsed.outputPath);
	try {
		if (!(await stat(path.dirname(outputPath))).isDirectory()) throw new Error("Not a directory");
		try {
			if ((await stat(outputPath)).isDirectory()) throw new Error("Output path is a directory");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	} catch (error) {
		throw new CliError("output_invalid", `Output path is unavailable: ${outputPath}`, 1, {
			cause: error instanceof Error ? error.message : String(error),
		});
	}
	return { projectDir, outputPath };
}

async function replaceOutput(outputPath: string, bytes: Buffer): Promise<void> {
	try {
		await saveExport(path.dirname(outputPath), outputPath, bytes);
	} catch (error) {
		throw new CliError("output_write_failed", `Unable to write export: ${outputPath}`, 1, {
			cause: error instanceof Error ? error.message : String(error),
		});
	}
}

function jsonExecution(exitCode: 0 | 1 | 2, value: unknown, stderr = ""): CliExecution {
	return {
		exitCode,
		stdout: `${JSON.stringify(value)}\n`,
		stderr: stderr ? `${stderr}\n` : "",
	};
}

async function errorExecution(
	error: unknown,
	command = "export",
	locale: "en" | "fr" = "en",
	course?: string,
): Promise<CliExecution> {
	if (error instanceof ProjectPermissionError)
		return errorExecution(
			new CliError(error.code, projectPermissionMessage(locale), 1),
			command,
			locale,
		);
	if (
		error instanceof CourseHomeUrlError ||
		(error instanceof Error && error.cause instanceof CourseHomeUrlError)
	) {
		return errorExecution(
			new CliError("project_invalid", new CourseHomeUrlError(locale).message, 1),
			command,
			locale,
		);
	}
	const messages = (locale === "fr" ? cliFr : cliEn).identityInit;
	const seen = new Set<unknown>();
	let cause = error;
	while (!(error instanceof CliError) && cause instanceof Error && !seen.has(cause)) {
		seen.add(cause);
		if ((cause as { code?: string }).code === "ERECOVERYREQUIRED")
			return errorExecution(
				new CliError("ERECOVERYREQUIRED", messages.recoveryRequired, 1),
				command,
				locale,
			);
		cause = cause.cause;
	}
	const identityAdvice = projectIdentityRecoveryAdvice(error, locale);
	if (identityAdvice)
		return errorExecution(new CliError("EIDENTITY", identityAdvice, 1), command, locale);
	const identityError =
		error instanceof Error &&
		(error.cause instanceof IdentityStoreError || error.cause instanceof IdentitySourceError)
			? error.cause
			: error;
	if (command === "export" && identityError instanceof IdentitySourceError) {
		const message = formatIdentityAdvice(messages.exportSourceError, course, identityError);
		return errorExecution(
			new CliError(error === identityError ? "EIDENTITY" : "project_invalid", message, 1),
			command,
			locale,
		);
	}
	if (
		command === "export" &&
		identityError instanceof IdentityStoreError &&
		identityError.messageRef.key === "desktop.identity.exportRefused"
	) {
		const initialization = identityError.initialization;
		const pending = initialization?.pending;
		const advice = pending?.sameTitlePages
			? messages.exportSameTitlePages
			: pending && initialization?.rederive
				? messages.exportMixedRederiveAdvice
				: pending
					? pending.copyCountDropped
						? messages.exportCopyCountDropped
						: messages.exportPendingAdvice
					: initialization?.rederive
						? initialization.retired.length && !initialization.added.length
							? messages.exportDeletionAdvice
							: messages.exportRederiveAdvice
						: messages.exportAdvice;
		const locations = pending
			? []
			: (initialization?.added.map((block) =>
					formatIdentityBlockLocation(block, messages.blockLocation),
				) ?? []);
		const message = [
			...(pending ? [] : [messages.exportRefused]),
			formatIdentityAdvice(advice, course, pending),
			...locations,
		].join("\n");
		return errorExecution(
			new CliError(error === identityError ? "EIDENTITY" : "project_invalid", message, 1),
			command,
			locale,
		);
	}
	if (error instanceof CliError) {
		return jsonExecution(
			error.exitCode,
			{
				ok: false,
				error: {
					code: error.code,
					message: error.message,
					...(error.details === undefined ? {} : { details: error.details }),
				},
			},
			(locale === "fr" ? cliFr : cliEn).commandFailed
				.replace("{command}", command)
				.replace("{reason}", () => error.message),
		);
	}
	if (error instanceof ExportAccessibilityError) {
		return jsonExecution(
			1,
			{
				ok: false,
				error: {
					code: "accessibility_blocked",
					message: "Critical accessibility issues blocked export.",
					details: { criticalIssueCount: error.issues.length, issues: error.issues },
				},
			},
			`Praxity export failed: ${error.issues.length} critical accessibility issue(s).`,
		);
	}
	if (error instanceof ViewerAssetsError) {
		return jsonExecution(
			1,
			{ ok: false, error: { code: "export_assets_missing", message: error.message } },
			`Praxity ${command} failed: ${error.message}`,
		);
	}
	if (
		error instanceof CoursePracticeAdmissionError &&
		(error.code === "unsupported-runtime" ||
			error.code === "choice-invalid-attempts" ||
			error.code.startsWith("highlight-"))
	)
		return jsonExecution(
			1,
			{
				ok: false,
				error: { code: error.code, message: error.message, diagnostics: error.diagnostics },
			},
			(locale === "fr" ? cliFr : cliEn).commandFailed
				.replace("{command}", command)
				.replace("{reason}", () => error.message),
		);
	const { ProjectExportError } = await import("./export/export-project");
	const { EmptyCourseError } = await import("@praxity/export-pipeline");
	if (error instanceof ProjectExportError || error instanceof EmptyCourseError) {
		return jsonExecution(
			1,
			{ ok: false, error: { code: error.code, message: error.message } },
			(locale === "fr" ? cliFr : cliEn).commandFailed
				.replace("{command}", command)
				.replace("{reason}", () => error.message),
		);
	}
	const message = error instanceof Error ? error.message : String(error);
	return jsonExecution(
		1,
		{ ok: false, error: { code: "export_failed", message } },
		`Praxity ${command} failed: ${message}`,
	);
}

export async function runPraxityCli(args: string[], runtime: CliRuntime): Promise<CliExecution> {
	if (args[0] === "--help" || args[0] === "-h" || args.includes("--help") || args.includes("-h")) {
		if (args[0] === "init") {
			const messages = (args.includes("fr") ? cliFr : cliEn).init;
			return { exitCode: 0, stdout: `${messages.usage}\n${messages.help}\n`, stderr: "" };
		}
		if (args[0] === "comments")
			return { exitCode: 0, stdout: `${commentsHelp(args)}\n`, stderr: "" };
		return { exitCode: 0, stdout: `${help(args)}\n`, stderr: "" };
	}
	if (args[0] === "--version" || args[0] === "-v") {
		return { exitCode: 0, stdout: `${runtime.appVersion}\n`, stderr: "" };
	}
	const writes =
		["init", "studio"].includes(args[0]) ||
		(args[0] === "identity" && ["init", "merge"].includes(args[1])) ||
		(args[0] === "edit" && !args.includes("--dry-run")) ||
		(args[0] === "comments" && ["reply", "resolve", "reopen"].includes(args[1])) ||
		(args[0] === "narration" && ["accept", "attach"].includes(args[1])) ||
		(args[0] === "recovery" && !["list", "export-drafts"].includes(args[1]));
	try {
		if (writes) assertProjectWritesAllowed();
	} catch (error) {
		return errorExecution(error, args[0], args[args.indexOf("--lang") + 1] === "fr" ? "fr" : "en");
	}
	if (args[0] === "narration") return runNarrationCli(args);
	if (args[0] === "edit") return runEditCli(args);
	if (args[0] === "comments") return runCommentsCli(args, runtime.openReviewStore);
	if (args[0] === "inspect" && (args.includes("--blocks") || args.includes("--text-fields")))
		return runInspectBlocksCli(args);
	if (args[0] === "identity")
		return args[1] === "init"
			? runIdentityInitCli(args, runtime.writeIdentityNotice).catch((error) =>
					errorExecution(
						error,
						"identity",
						args[args.indexOf("--lang") + 1] === "fr" ? "fr" : "en",
					),
				)
			: runIdentityMergeCli(args);
	let adviceLocale: "en" | "fr" = "en";
	if (
		["init", "inspect", "export", "studio", "recovery"].includes(args[0]) &&
		args.includes("--lang")
	) {
		const index = args.indexOf("--lang");
		const language = args[index + 1];
		if (!["en", "fr"].includes(language) || args.lastIndexOf("--lang") !== index)
			return errorExecution(
				new CliError(
					"invalid_arguments",
					(language === "fr" ? cliFr : cliEn).adviceLanguageOption,
					2,
				),
				args[0] === "init" ? "init" : "export",
				language === "fr" ? "fr" : "en",
			);
		adviceLocale = language as "en" | "fr";
		args = [...args.slice(0, index), ...args.slice(index + 2)];
	}
	const advice = createTranslator({
		locale: adviceLocale,
		messages: adviceLocale === "fr" ? fr : en,
		namespace: "narrationAdvice",
	});
	const narrationAdvice = (warning: SelfCheckNarrationWarning & { file?: string }) =>
		`${warning.file}: ${advice("selfCheckSpoiler", { line: warning.line })}`;

	if (args[0] === "init") {
		const messages = (adviceLocale === "fr" ? cliFr : cliEn).init;
		if (args.length > 2 || args[1]?.startsWith("-"))
			return errorExecution(
				new CliError("invalid_arguments", messages.usage, 2),
				"init",
				adviceLocale,
			);
		let root: string;
		try {
			root = await resolveProjectDir(args[1] ?? process.cwd());
		} catch {
			return errorExecution(
				new CliError("project_not_found", messages.missingCourse, 1),
				"init",
				adviceLocale,
			);
		}
		try {
			const result = await initCourse(root);
			return {
				exitCode: 0,
				stderr: "",
				stdout: `${[
					result.settings === "updated" ? messages.updatedSettings : messages.unchangedSettings,
					result.git === "not-git"
						? messages.noGit
						: result.git === "updated"
							? messages.updatedGit
							: messages.unchangedGit,
					...result.retained.map((entry) => messages.retained.replace("{entry}", entry)),
					...result.names.map(({ name, status }) =>
						messages[status === "retained" ? "authorChoice" : status].replace("{name}", name),
					),
					messages.preserved,
					messages.workspace,
					messages.userSettings,
					messages.unhide,
				].join("\n")}\n`,
			};
		} catch (error) {
			const failure = await errorExecution(
				new CliError(
					error instanceof InitSettingsError
						? "init_settings_invalid"
						: error instanceof InitTargetError && error.notWritable
							? "init_not_writable"
							: "init_failed",
					error instanceof InitSettingsError
						? messages.invalidSettings
						: error instanceof InitTargetError
							? messages[error.notWritable ? "notWritable" : "targetFailed"].replace(
									"{target}",
									error.target === "settings" ? ".vscode/settings.json" : messages.gitTarget,
								)
							: messages.failed,
					1,
				),
				"init",
				adviceLocale,
			);
			if (error instanceof InitTargetError && error.settings)
				failure.stderr = `${error.settings === "updated" ? messages.updatedSettings : messages.unchangedSettings}\n${failure.stderr}`;
			return failure;
		}
	}
	if (args[0] === "recovery") {
		try {
			const action = args[1];
			if (
				!args[2] ||
				!["run", "list", "extract", "restore", "resolve", "export-drafts"].includes(action) ||
				args.length !==
					{ run: 3, list: 3, extract: 5, restore: 6, resolve: 4, "export-drafts": 4 }[action]
			)
				throw new CliError(
					"invalid_arguments",
					(adviceLocale === "fr" ? cliFr : cliEn).recovery.usage,
					2,
				);
			const root = await resolveProjectDir(args[2]);
			if (action === "list") {
				const archives = await listProjectRecovery(root);
				try {
					return jsonExecution(0, {
						ok: true,
						archives,
						...(await new LocalEditorStore(root).draftInventory()),
					});
				} catch (error) {
					return jsonExecution(0, {
						ok: true,
						archives,
						drafts: [],
						draftsError: error instanceof Error ? error.message : String(error),
					});
				}
			}
			if (action === "export-drafts")
				return jsonExecution(0, {
					ok: true,
					...(await new LocalEditorStore(root).draftExport(args[3])),
				});
			if (action === "run") await withProjectFileTransaction(root, async () => {}, "write", false);
			else if (action === "extract") await extractProjectRecovery(root, args[3], args[4]);
			else if (action === "restore") {
				await restoreProjectRecovery(root, args[3], args[4], args[5]);
				return jsonExecution(0, {
					ok: true,
					message: (adviceLocale === "fr" ? cliFr : cliEn).recovery.restoreHeld,
				});
			} else await resolveProjectRecovery(root, args[3]);
			return jsonExecution(0, { ok: true });
		} catch (error) {
			const message =
				projectIdentityRecoveryAdvice(error, adviceLocale) ??
				(error instanceof ProjectRecoveryRestoreError
					? (adviceLocale === "fr" ? cliFr : cliEn).recovery[error.reason]
					: error instanceof Error
						? error.message
						: String(error));
			return errorExecution(
				error instanceof CliError
					? error
					: new CliError(
							"recovery_failed",
							error instanceof ProjectRecoveryRestoreHeldError
								? `${message} ${(adviceLocale === "fr" ? cliFr : cliEn).recovery.restoreHeld}`
								: message,
							1,
						),
				"recovery",
			);
		}
	}
	if (args[0] === "studio") {
		try {
			let projectDir: string | undefined;
			let noOpen = false;
			let reviewEnabled = false;
			let port: number | undefined;
			for (let index = 1; index < args.length; index++) {
				const argument = args[index];
				if (argument === "--port") {
					const value = args[++index];
					const parsed = studioPortSchema.safeParse(Number(value));
					if (port !== undefined || !/^\d+$/.test(value ?? "") || !parsed.success)
						throw new CliError(
							"invalid_arguments",
							"--port requires an integer from 1 to 65535, supplied once.",
							2,
						);
					port = parsed.data;
					continue;
				}
				if (argument === "--no-open" && !noOpen) noOpen = true;
				else if (argument === "--review" && !reviewEnabled) reviewEnabled = true;
				else if (!argument.startsWith("-") && !projectDir) projectDir = argument;
				else
					throw new CliError(
						"invalid_arguments",
						"Usage: praxity studio <project-dir> [--review] [--port <n>] [--no-open]",
						2,
					);
			}
			if (!projectDir) throw new CliError("invalid_arguments", "Missing project directory.", 2);
			if (!runtime.editorAssetsDir)
				throw new CliError(
					"editor_assets_missing",
					"Use the standalone CLI artifact with its browser editor assets.",
					1,
				);
			const root = await resolveProjectDir(projectDir);
			if (reviewEnabled) {
				const manifest = await lstat(path.join(root, COURSE_MANIFEST_FILENAME)).catch(
					(error: unknown) => {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
						throw error;
					},
				);
				if (!manifest?.isFile()) {
					const messages = createTranslator({
						locale: adviceLocale,
						messages: adviceLocale === "fr" ? cliFr : cliEn,
					});
					return errorExecution(
						new CliError(
							"course_manifest_required",
							messages("studio.reviewCourseRequired", { filename: COURSE_MANIFEST_FILENAME }),
							1,
						),
						"studio",
						adviceLocale,
					);
				}
			}
			// Argument refusals do not need the server or rendering runtime.
			const { startStudioServer } = await import("./studio/server");
			let reviewPortFallback = false;
			const review = reviewEnabled
				? {
						store: await openReviewStore(root),
						capability: randomBytes(32).toString("base64url"),
						assetsDir: runtime.exportAssetsDir,
						preferredPort: port === undefined ? undefined : port + 1000,
						onPortFallback: () => {
							reviewPortFallback = true;
						},
					}
				: undefined;
			const server = await startStudioServer({
				projectDir: root,
				appVersion: runtime.appVersion,
				editorAssetsDir: runtime.editorAssetsDir,
				port,
				exportAssetsDir: runtime.exportAssetsDir,
				typstExecutablePath: runtime.typstExecutablePath,
				review,
			});
			let draftCount = 0;
			let draftsUnavailable = false;
			try {
				// Optional retired-editor data cannot prevent the retained host from starting.
				const inventory = await new LocalEditorStore(root).draftInventory();
				draftCount = inventory.drafts.length;
				draftsUnavailable = inventory.skippedDraftFiles.length > 0;
			} catch {
				draftsUnavailable = true;
			}
			const messages = createTranslator({
				locale: adviceLocale,
				messages: adviceLocale === "fr" ? cliFr : cliEn,
			});
			const notices = [
				...(reviewEnabled && (await isLinkedReviewWorktree(root))
					? [messages("reviewWorktreeWarning")]
					: []),
				...(reviewPortFallback ? [messages("studio.reviewPortFallback")] : []),
				...(draftCount
					? [messages("recovery.draftsNotice", { count: draftCount, command: draftExportCommand })]
					: []),
				...(draftsUnavailable ? [messages("recovery.draftsSkippedNotice")] : []),
			];
			return {
				exitCode: 0,
				stdout: `${server.readyUrl}\n`,
				stderr: notices.length ? `${notices.join(" ")}\n` : "",
				studioServer: server,
				openBrowser: !noOpen,
			};
		} catch (error) {
			if (error instanceof ReviewStoreError || error instanceof ReviewAssetsError) {
				const messages = createTranslator({
					locale: adviceLocale,
					messages: adviceLocale === "fr" ? cliFr : cliEn,
				});
				return errorExecution(
					new CliError(
						error instanceof ReviewStoreError ? error.code : "review_assets_missing",
						error instanceof ReviewStoreError
							? messages("studio.reviewRefused", { code: error.code, path: error.path })
							: messages("studio.reviewAssetsMissing", { filename: error.filename }),
						1,
					),
					"studio",
					adviceLocale,
				);
			}
			const plainStorePath = projectPlainStorePath(error);
			if (plainStorePath !== undefined) {
				const message = projectPlainStoreMessage(plainStorePath, adviceLocale);
				return jsonExecution(
					1,
					{
						ok: false,
						error: {
							code: "EIDENTITY",
							message,
							messageRef: {
								key: "desktop.identity.plainStoreRequired",
								args: { path: plainStorePath },
							},
						},
					},
					message,
				);
			}
			if (
				error instanceof IdentityStoreError &&
				error.messageRef.key === "desktop.identity.missingEstablished"
			)
				return errorExecution(
					new CliError("EIDENTITY", projectIdentityRecoveryMessage(adviceLocale), 1),
					"studio",
				);
			return errorExecution(
				error instanceof CliError
					? error
					: new CliError(
							"studio_failed",
							error instanceof Error ? error.message : "Studio startup failed",
							1,
							undefined,
							error,
						),
				"studio",
				adviceLocale,
			);
		}
	}
	if (args[0] === "inspect") {
		try {
			if (
				(args.length !== 2 &&
					!(args.length === 4 && args[2] === "--schema" && ["0", "1"].includes(args[3]))) ||
				!args[1] ||
				args[1].startsWith("-")
			) {
				throw new CliError(
					"invalid_arguments",
					"Usage: praxity inspect <project-dir> [--schema 0|1]",
					2,
				);
			}
			const projectDir = await resolveProjectDir(args[1]);

			const inspected = await (args[3] === "1"
				? (await import("./export/inspect-project-v1")).inspectProjectV1
				: (await import("./export/inspect-project")).inspectProject)(
				projectDir,
				runtime.appVersion,
			);
			return jsonExecution(
				0,
				{ ok: true, ...inspected },
				inspected.warnings
					.filter(
						(warning): warning is SelfCheckNarrationWarning & { file: string } =>
							warning.code === "ENARRATIONSELFCHECKSPOILER",
					)
					.map(narrationAdvice)
					.join("\n"),
			);
		} catch (error) {
			return errorExecution(
				error instanceof CliError
					? error
					: new CliError(
							"project_invalid",
							projectIdentityRecoveryAdvice(error, adviceLocale) ??
								(error instanceof Error ? error.message : String(error)),
							1,
						),
				"inspect",
			);
		}
	}
	if (args[0] !== "export") {
		return errorExecution(
			new CliError("invalid_arguments", `${cliEn.expectedCommand}\n${cliFr.expectedCommand}`, 2),
		);
	}

	let exportCourse: string | undefined;
	try {
		const parsed = parseExportArgs(args);
		const resolved = await resolvePaths(parsed);
		exportCourse = resolved.projectDir;
		const { exportProject } = await import("./export/export-project");
		const result = await exportProject({
			adviceLocale,
			projectDir: resolved.projectDir,
			manifestPolicy: "read-only",
			format: parsed.format,
			...(parsed.format === "pdf"
				? {
						pageSize: parsed.pageSize ?? "a4",
						includeAnswerSheet: parsed.includeAnswerSheet,
						typstExecutablePath: runtime.typstExecutablePath,
					}
				: {}),
			exportAssetsDir: runtime.exportAssetsDir,
			scope: "course",
			fallbackCompletionThreshold: DEFAULT_PROJECT_CONFIG.export.completionThreshold,
			enforceAccessibility: !parsed.allowCriticalA11yIssues,
			expectedAppVersion: runtime.expectedAppVersion,
			expectedViewerSourceHash: runtime.expectedViewerSourceHash,
		});
		await replaceOutput(resolved.outputPath, "pdf" in result ? result.pdf : result.zip);
		const overridden = result.criticalAccessibilityIssues.length > 0;
		return jsonExecution(
			0,
			{
				ok: true,
				outputPath: resolved.outputPath,
				format: parsed.format,
				pageCount: result.pageCount,
				...(result.designWarnings?.length ||
				result.narrationWarnings?.length ||
				result.authorWarnings?.length
					? {
							warnings: [
								...(result.designWarnings ?? []),
								...(result.narrationWarnings ?? []),
								...(result.authorWarnings ?? []),
							],
						}
					: {}),
				...("pdf" in result ? { diagnostics: result.diagnostics } : {}),
				...("scorm12Storage" in result ? { scorm12Storage: result.scorm12Storage } : {}),
				accessibility: overridden
					? {
							status: "overridden",
							criticalIssueCount: result.criticalAccessibilityIssues.length,
							issues: result.criticalAccessibilityIssues,
						}
					: { status: "passed" },
			},
			[
				...(result.designWarnings ?? []).map((warning) => `${warning.file}: ${warning.message}`),
				...(result.narrationWarnings ?? []).map(narrationAdvice),
				...(result.authorWarnings ?? []).map(
					(warning) => `${warning.file}: ${warning.message}. ${warning.hint}`,
				),
				...(overridden
					? [
							`Warning: exported with ${result.criticalAccessibilityIssues.length} critical accessibility issue(s).`,
						]
					: []),
				...("scorm12Storage" in result && result.scorm12Storage?.atRisk
					? [
							`Warning: a full attempt needs about ${result.scorm12Storage.estimatedLength} characters of SCORM 1.2 progress storage, which holds ${result.scorm12Storage.limit}. ${result.scorm12Storage.reportingSelfCheckCount > 0 ? "Progress and answer text may exceed SCORM 1.2's storage limit. Export to SCORM 2004 if your LMS supports it, or use device-only mode for self-check answers." : "This course may be too long for SCORM 1.2. Progress may stop saving partway through. Export to SCORM 2004 if your LMS supports it."}`,
						]
					: []),
				...("pdf" in result
					? result.diagnostics.map(
							(diagnostic) =>
								`${diagnostic.lessonId}${diagnostic.blockId ? ` / ${diagnostic.blockId}` : ""}: ${diagnostic.message}`,
						)
					: []),
			].join("\n"),
		);
	} catch (error) {
		return errorExecution(error, "export", adviceLocale, exportCourse);
	}
}
