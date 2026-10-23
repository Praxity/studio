import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	projectIdentityRecoveryAdvice,
	projectIdentityRecoveryMessage,
	projectPlainStoreMessage,
	projectPlainStorePath,
} from "../shared/project-write-errors";
import type { CliExecution } from "./cli";
import en from "./cli-messages/en.json" with { type: "json" };
import fr from "./cli-messages/fr.json" with { type: "json" };
import { readCourseManifestData } from "./course-manifest-io";
import {
	type IdentityBlockLocation,
	type IdentityRetiredLocation,
	IdentitySourceError,
	IdentityStoreError,
	initializeCourseIdentity,
	previewCourseIdentityInitialization,
} from "./identity-store";
import { withProjectFileTransaction } from "./project-file-transactions";

export function formatIdentityBlockLocation(
	block: IdentityBlockLocation | IdentityRetiredLocation,
	template: string,
	unknownLine = "?",
): string {
	const values: Record<string, string> = {
		"{file}": block.file,
		"{line}": block.line === null ? unknownLine : String(block.line),
		"{page}": block.page,
		"{label}": block.label,
		"{id}": block.id,
	};
	return template.replace(/\{(?:file|line|page|label|id)\}/g, (key) => values[key]);
}

export function formatIdentityCourseArgument(course: string): string {
	return `'${course.replaceAll("'", process.platform === "win32" ? "''" : "'\"'\"'")}'`;
}

export function formatIdentityAdvice(
	template: string,
	course?: string,
	location?: { file: string; line: number },
): string {
	const values: Record<string, string> = {
		"{course}": course ? formatIdentityCourseArgument(course) : "<course>",
		"{file}": location?.file ?? "",
		"{line}": String(location?.line ?? 1),
	};
	return template.replace(/\{(?:course|file|line)\}/g, (key) => values[key]);
}

export async function runIdentityInitCli(
	args: string[],
	writeNotice?: (text: string) => Promise<void>,
): Promise<CliExecution> {
	const locale = args[args.indexOf("--lang") + 1] === "fr" ? "fr" : "en";
	const messages = (locale === "fr" ? fr : en).identityInit;
	const result = (exitCode: 0 | 1 | 2, value: unknown, message: string): CliExecution => ({
		exitCode,
		stdout: `${JSON.stringify(value)}\n`,
		stderr: `${message}\n`,
	});
	const languageIndex = args.indexOf("--lang");
	if (languageIndex !== -1) {
		if (
			args.lastIndexOf("--lang") !== languageIndex ||
			!["en", "fr"].includes(args[languageIndex + 1])
		)
			return result(
				2,
				{ ok: false, error: { code: "invalid_arguments", message: messages.usage } },
				messages.usage,
			);
		args = [...args.slice(0, languageIndex), ...args.slice(languageIndex + 2)];
	}
	const rederive = args.includes("--rederive");
	const confirmed = args.includes("--confirm-unpublished");
	const flags = args.filter((arg) => arg === "--rederive" || arg === "--confirm-unpublished");
	args = args.filter((arg) => arg !== "--rederive" && arg !== "--confirm-unpublished");
	if (
		args.length !== 3 ||
		args[2].startsWith("-") ||
		new Set(flags).size !== flags.length ||
		(confirmed && !rederive)
	)
		return result(
			2,
			{ ok: false, error: { code: "invalid_arguments", message: messages.usage } },
			messages.usage,
		);
	let notice = "";
	try {
		const course = await realpath(resolve(args[2]));
		if (rederive && !confirmed) {
			const changes = await withProjectFileTransaction(
				course,
				async (root) => {
					const { lessonFilesOnDisk } = await readCourseManifestData(root, {
						requireManifest: true,
					});
					return previewCourseIdentityInitialization(root, lessonFilesOnDisk);
				},
				"read",
			);
			const warning =
				changes.retired.length && !changes.added.length
					? messages.deletionWarning
					: messages.rederiveWarning;
			return result(
				1,
				{
					ok: false,
					error: { code: "unpublished_confirmation_required", message: warning },
				},
				warning,
			);
		}
		const initialized = await withProjectFileTransaction(
			course,
			async (root) => {
				const { lessonFilesOnDisk } = await readCourseManifestData(root, { requireManifest: true });
				return initializeCourseIdentity(root, lessonFilesOnDisk, {
					rederive,
					beforeWrite: async ({ added, retired }) => {
						const warning =
							retired.length && !added.length ? messages.deletionWarning : messages.rederiveWarning;
						notice = [
							warning,
							...(retired.length ? [messages.retiredHeading] : []),
							...retired.map((block) =>
								formatIdentityBlockLocation(
									block,
									block.kind === "lesson"
										? messages.retiredLessonLocation
										: block.kind === "page"
											? messages.retiredPageLocation
											: messages.retiredLocation,
									messages.unknownLine,
								),
							),
							...(added.length ? [messages.addedHeading] : []),
							...added.map((block) => formatIdentityBlockLocation(block, messages.addedLocation)),
							...(added.length ? [] : [messages.noReplacements]),
						].join("\n");
						if (writeNotice) await writeNotice(`${notice}\n`);
					},
				});
			},
			"write",
		);
		return result(
			0,
			{ ok: true, ...initialized },
			[
				...(!writeNotice && notice ? [notice] : []),
				initialized.changed ? messages.initialized : messages.unchanged,
			].join("\n"),
		);
	} catch (error) {
		if ((error as { code?: string } | null)?.code === "ERECOVERYREQUIRED") throw error;
		const plainStorePath = projectPlainStorePath(error);
		const message =
			(plainStorePath !== undefined
				? projectPlainStoreMessage(plainStorePath, locale)
				: undefined) ??
			projectIdentityRecoveryAdvice(error, locale) ??
			(error instanceof IdentityStoreError &&
			error.messageRef.key === "desktop.identity.invalidFile"
				? projectIdentityRecoveryMessage(locale)
				: undefined) ??
			(error instanceof IdentityStoreError && error.initialization?.rederive
				? formatIdentityAdvice(
						error.initialization.pending?.sameTitlePages
							? messages.sameTitlePages
							: error.initialization.pending
								? messages.mixedRederiveRequired
								: error.initialization.retired.length && !error.initialization.added.length
									? messages.deletionRequired
									: messages.rederiveRequired,
						args[2],
						error.initialization.pending,
					)
				: undefined) ??
			(error instanceof IdentitySourceError
				? formatIdentityAdvice(
						error.sameTitlePages
							? messages.sameTitlePages
							: error.pending
								? error.copyCountDropped
									? messages.copyCountDropped
									: messages.pendingError
								: messages.sourceError,
						args[2],
						error,
					)
				: messages.failed.replace("{reason}", () =>
						error instanceof Error ? error.message : String(error),
					));
		return result(1, { ok: false, error: { code: "identity_init_failed", message } }, message);
	}
}
