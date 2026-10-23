import { createHash } from "node:crypto";
import { join } from "node:path";
import { SourceEditError, setFrontmatterPath, setYamlPath } from "@praxity/grammar";
import {
	type ManifestEditResult,
	manifestEditSchema,
	parseEditorInput,
} from "../../shared/editor-session";
import { PlainYamlRequiredError } from "../../shared/project-write-errors";
import { readCourseManifestData } from "../course-manifest-io";
import { IdentityRetirementError, IdentitySourceError } from "../identity-store";
import { readLessonSource, writeLessonSource } from "../lesson-source";
import { readFileWithin } from "../path-security";
import { plainYamlDocument } from "../plain-yaml-edit";
import {
	acknowledgeProjectWrite,
	applyProjectFilePlan,
	withProjectFileTransaction,
} from "../project-file-transactions";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
/** Metadata edits bind to exact source bytes, then use the owning YAML setters. */
export async function editManifest(root: string, input: unknown): Promise<ManifestEditResult> {
	const request = parseEditorInput(manifestEditSchema, input);
	let result: ManifestEditResult | undefined;
	const writeResult = await acknowledgeProjectWrite(
		withProjectFileTransaction(
			root,
			async (root) => {
				const course = request.file === "course.yaml";
				const source = course
					? ((await readFileWithin(root, join(root, "course.yaml"), "utf8")) as string)
					: await readLessonSource(root, request.file);
				if (digest(source) !== request.baseRevision) {
					result = { ok: false, code: "stale" };
					return;
				}
				const data = await readCourseManifestData(root);
				if (!course && !data.lessonFilesOnDisk.includes(request.file))
					throw new Error("Manifest lesson is not in this project");
				if (course) plainYamlDocument(source);
				const next = course
					? setYamlPath(source, request.path, request.value)
					: setFrontmatterPath(source, request.path, request.value);
				if (next === source) {
					result = { ok: false, code: "not-allowed" };
					return;
				}
				if (course)
					await applyProjectFilePlan(root, [
						{ path: "course.yaml", content: next, expectedContent: source, head: true },
					]);
				else await writeLessonSource(root, request.file, next, source);
				result = { ok: true, revision: digest(next), writeResult: {} };
			},
			"write",
			false,
		),
	).catch((error) => {
		if (error instanceof IdentityRetirementError) {
			result = { ok: false, code: "identity-retirement-pending", reviewUrl: "/launch" };
			return {};
		}
		if (error instanceof IdentitySourceError) {
			result = { ok: false, code: error.code === "bad_yaml" ? "bad-yaml" : "source-invalid" };
			return {};
		}
		if (error instanceof SourceEditError || error instanceof PlainYamlRequiredError) {
			result = { ok: false, code: "invalid-args" };
			return {};
		}
		if ((error as { code?: string }).code !== "ECONFLICT") throw error;
		result = { ok: false, code: "conflict" };
		return {};
	});
	if (!result) throw new Error("Manifest edit returned no result");
	return result.ok ? { ...result, writeResult } : result;
}
