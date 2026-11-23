import { ZodError } from "zod";
import {
	isProjectBusyError,
	isProjectFileBusyError,
	projectReadErrorKey,
} from "../../../shared/project-write-errors";
import { DEFAULT_APP_SETTINGS } from "../../../shared/types";
import { CoursePreviewService } from "../../course-preview-service";
import { CoursePreviewStateStore } from "../../course-preview-state-store";
import { createStudioProjectSession, StudioSessionError } from "../../studio/project-session";
import { startStudioReadOnlyServer } from "../../studio/read-only-server";
import { prepareStudioTemporaryOutputs } from "../../studio/temporary-outputs";

type Session = Awaited<ReturnType<typeof createStudioProjectSession>>;

export async function sessionResult(
	session: Session,
	method: string,
	args: unknown = {},
): Promise<ReturnType<typeof JSON.parse>> {
	try {
		return {
			status: 200,
			ok: true,
			result: JSON.parse(JSON.stringify((await session.invoke(method, args)) ?? null)),
		};
	} catch (error) {
		if (error instanceof StudioSessionError)
			return {
				status: error.status,
				ok: false,
				error: {
					code: error.code,
					message: error.message,
					...(error.details ? { details: error.details } : {}),
				},
			};
		if (error instanceof ZodError)
			return {
				status: 400,
				ok: false,
				error: { code: "bad_schema", message: "Request does not match the input schema" },
			};
		if (isProjectFileBusyError(error))
			return { status: 503, ok: false, error: { code: "EFILEBUSY" } };
		if (isProjectBusyError(error))
			return { status: 503, ok: false, error: { code: "EPROJECTBUSY" } };
		if (projectReadErrorKey(error) === "projectRecoveryRequired")
			return {
				status: 503,
				ok: false,
				error: { code: "ERECOVERYREQUIRED", message: String(error) },
			};
		throw error;
	}
}

export async function retainedSession(
	projectDir: string,
	options: {
		exportAssetsDir?: string;
		editorOrigin?: string;
		typstExecutablePath?: string;
		locale?: "en" | "fr";
		appVersion?: string;
	} = {},
) {
	const readOnly = await startStudioReadOnlyServer({
		projectDir,
		getEditorOrigin: () => options.editorOrigin ?? "http://127.0.0.1:9000",
	});
	const values = new Map<string, string>();
	const temporary = options.exportAssetsDir
		? await prepareStudioTemporaryOutputs(projectDir)
		: undefined;
	const preview = options.exportAssetsDir
		? new CoursePreviewService({
				getProjectDir: () => projectDir,
				getExportAssetsDir: () => options.exportAssetsDir ?? "",
				getWorkspacePath: () => null,
				getFallbackCompletionThreshold: () => DEFAULT_APP_SETTINGS.defaultCompletionThreshold,
				inheritWorkspaceSettings: false,
				manifestPolicy: "read-only",
				temporaryRoot: temporary?.directory,
				stateStore: new CoursePreviewStateStore({
					get: (key) => values.get(key),
					set: (key, value) => {
						values.set(key, value);
					},
				}),
				hostCourseArtifact: readOnly.hostCourseArtifact,
			})
		: undefined;
	const session = await createStudioProjectSession(
		projectDir,
		options.appVersion ?? "0.3.0",
		preview,
		options.exportAssetsDir
			? {
					projectDir,
					exportAssetsDir: options.exportAssetsDir,
					temporaryRoot: temporary?.directory,
					recordOutputStage: temporary?.recordOutputStage,
					typstExecutablePath: options.typstExecutablePath,
					registerDownload: readOnly.registerDownload,
				}
			: undefined,
		options.locale,
	);
	return {
		session,
		readOnly,
		invoke: (method: string, args?: unknown) => sessionResult(session, method, args),
		async close() {
			await session.close();
			await readOnly.close();
			await preview?.dispose();
			await temporary?.dispose();
		},
	};
}
