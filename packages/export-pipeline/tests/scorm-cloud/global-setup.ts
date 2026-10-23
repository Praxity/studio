import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import type { FullConfig } from "@playwright/test";
import { ScormCloudClient } from "../../src/scorm-cloud/client";
import { buildScormCloudFixtures } from "./fixture";
import { type ScormCloudTestEnv, TEST_ENV_PATH } from "./helpers";

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
	await rm(TEST_ENV_PATH, { force: true });

	const appId = process.env.SCORM_CLOUD_APP_ID;
	const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;

	if (!appId || !secretKey) {
		if (process.env.PRAXITY_GATE === "1") {
			throw new Error("Missing SCORM_CLOUD_APP_ID or SCORM_CLOUD_SECRET_KEY");
		}
		const env: ScormCloudTestEnv = {
			skip: true,
			reason: "Missing SCORM_CLOUD_APP_ID or SCORM_CLOUD_SECRET_KEY",
		};
		await writeFile(TEST_ENV_PATH, JSON.stringify(env, null, 2), "utf-8");
		return async () => {
			await rm(TEST_ENV_PATH, { force: true });
		};
	}

	const client = new ScormCloudClient(appId, secretKey);
	const useFull = process.env.SCORM_CLOUD_FULL_FIXTURE === "true";
	const timestamp = randomUUID();
	const scorm12CourseId = `praxity-test-scorm12-${timestamp}`;
	const scorm2004CourseId = `praxity-test-scorm2004-${timestamp}`;

	console.log("[scorm-cloud] Building test fixtures...");
	const fixtures = await buildScormCloudFixtures({ full: useFull });

	const cleanup = async () => {
		console.log("[scorm-cloud] Cleaning up courses...");

		for (const courseId of [scorm12CourseId, scorm2004CourseId]) {
			try {
				await client.deleteCourse(courseId);
			} catch {
				console.warn("[scorm-cloud] Failed to delete a course created by this run.");
			}
		}

		await rm(TEST_ENV_PATH, { force: true });
		console.log("[scorm-cloud] Cleanup complete.");
	};

	try {
		console.log("[scorm-cloud] Uploading SCORM 1.2 and 2004 packages...");
		const scorm12JobId = await client.uploadCourse(scorm12CourseId, fixtures.scorm12Zip);
		const scorm12Import = await client.pollImportJob(scorm12JobId);

		if (scorm12Import.status === "ERROR") {
			throw new Error(`SCORM 1.2 import failed: ${scorm12Import.message}`);
		}
		const scorm2004JobId = await client.uploadCourse(scorm2004CourseId, fixtures.scorm2004Zip);
		const scorm2004Import = await client.pollImportJob(scorm2004JobId);

		if (scorm2004Import.status === "ERROR") {
			throw new Error(`SCORM 2004 import failed: ${scorm2004Import.message}`);
		}

		if (scorm12Import.parserWarnings.length > 0) {
			console.log("[scorm-cloud] SCORM 1.2 parser warnings:", scorm12Import.parserWarnings);
		}
		if (scorm2004Import.parserWarnings.length > 0) {
			console.log("[scorm-cloud] SCORM 2004 parser warnings:", scorm2004Import.parserWarnings);
		}

		console.log("[scorm-cloud] Both packages imported successfully.");

		const env: ScormCloudTestEnv = {
			scorm12CourseId,
			scorm2004CourseId,
			pageCount: fixtures.pageCount,
			scoredQuestionCount: fixtures.scoredQuestionCount,
		};
		await writeFile(TEST_ENV_PATH, JSON.stringify(env, null, 2), "utf-8");

		return cleanup;
	} catch (error) {
		await cleanup();
		throw error;
	}
}
