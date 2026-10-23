import { stat } from "node:fs/promises";
import path from "node:path";
import {
	buildCoursePdfSource,
	type CoursePdfLesson,
} from "@praxity/format-renderers/pipelines/course-pdf";
import { resolveExistingPathWithin } from "../path-security";
import { createProjectAssetAdmission } from "../project-assets";
import { withProjectFileTransaction } from "../project-file-transactions";

/** Resolve only the PDF module's selected images, never feedback/hidden/unreferenced assets. */
export async function resolvePdfAssets(
	projectDir: string,
	lessons: CoursePdfLesson[],
	includeAnswerSheet: boolean,
	diagnosticLocale?: string,
): Promise<Map<string, Uint8Array>> {
	return withProjectFileTransaction(
		projectDir,
		(root) => readPdfAssets(root, lessons, includeAnswerSheet, diagnosticLocale),
		"read",
	);
}

async function readPdfAssets(
	projectDir: string,
	lessons: CoursePdfLesson[],
	includeAnswerSheet: boolean,
	diagnosticLocale?: string,
): Promise<Map<string, Uint8Array>> {
	const { assetSources } = buildCoursePdfSource({
		title: "Asset preparation",
		locale: lessons[0]?.locale ?? "en",
		diagnosticLocale,
		lessons,
		includeAnswerSheet,
	});
	const assets = new Map<string, Uint8Array>();
	const admission = createProjectAssetAdmission(projectDir);
	const root = assetSources.size
		? await admission.resolve(path.join(projectDir, "assets"))
		: path.join(projectDir, "assets");
	let totalBytes = 0;
	for (const reference of assetSources.keys()) {
		let relative: string;
		try {
			relative = decodeURIComponent(reference);
		} catch {
			throw new Error("Invalid PDF asset reference.");
		}
		if (!/^(?:\.\/|\/)?assets\//.test(relative) || /[\\\u0000-\u001f\u007f?#]/.test(relative))
			throw new Error("PDF images must reference files in the project's assets directory.");
		relative = relative.replace(/^(?:\.\/|\/)?assets\//, "");
		if (relative.split("/").some((part) => !part || part === "." || part === ".."))
			throw new Error("PDF asset path traversal blocked.");
		const safePath = await resolveExistingPathWithin(root, path.join(root, relative));
		const assetPath = path.join(projectDir, "assets", relative);
		await admission.resolve(assetPath);
		const info = await stat(safePath);
		if (
			!info.isFile() ||
			info.size > 50 * 1024 * 1024 ||
			(totalBytes += info.size) > 250 * 1024 * 1024
		)
			throw new Error("PDF image assets must be regular files under 50 MB each and 250 MB total.");
		const file = await admission.open(assetPath);
		try {
			assets.set(reference, await file.readFile());
		} finally {
			await file.close();
		}
	}
	await admission.finish();
	return assets;
}
