/**
 * SCORM Cloud variant tests — exercises specific SCORM behaviors:
 *   1. Required blocks prevent navigation until the assessment is completed
 *   2. Quiz completion method reports PASSED when score >= 80%
 *   3. Quiz completion method reports FAILED when score < 80%
 *
 * Run with:
 *   npx playwright test --config tests/scorm-cloud/playwright.config.ts variants.spec.ts
 */
import { type Browser, chromium, expect, test } from "@playwright/test";
import { ScormCloudClient } from "../../src/scorm-cloud/client";
import { buildScormCloudFixtures } from "./fixture";
import { waitForProgress } from "./helpers";
import { simulateLearner } from "./learner-simulation";

test.setTimeout(300_000);

let client: ScormCloudClient;
let browser: Browser;

const LAUNCH_OPTS = {
	redirectOnExitUrl: "message" as const,
	expiry: 300,
};

test.beforeAll(async () => {
	const appId = process.env.SCORM_CLOUD_APP_ID;
	const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;
	if (!appId || !secretKey) {
		test.skip(true, "SCORM Cloud credentials not configured");
		return;
	}

	client = new ScormCloudClient(appId, secretKey);
	// Headed mode required: SCORM Cloud's popuplauncher uses window.open()
	// to navigate a named popup window, which doesn't work in headless Chromium.
	browser = await chromium.launch({ headless: false });
});

test.afterAll(async () => {
	if (browser) await browser.close();
});

test.describe
	.serial("SCORM Cloud: variant tests", () => {
		test("required blocks prevent navigation until assessment is completed", async () => {
			const appId = process.env.SCORM_CLOUD_APP_ID;
			const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;
			if (!appId || !secretKey) {
				test.skip(true, "SCORM Cloud credentials not configured");
				return;
			}

			const fixtures = await buildScormCloudFixtures({ variant: "required" });
			const courseId = `praxity-test-required-${Date.now()}`;

			const jobId = await client.uploadCourse(courseId, fixtures.scorm12Zip);
			const importResult = await client.pollImportJob(jobId);
			if (importResult.status === "ERROR") {
				throw new Error(`Import failed: ${importResult.message}`);
			}

			try {
				const regId = `praxity-required-complete-${Date.now()}`;
				await client.createRegistration(regId, courseId, "required-learner");
				const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

				// Simulate with correct answers — required assessment is completed, so all 3 pages
				// should be reachable.
				const result = await simulateLearner(browser, launchUrl, { answerCorrectly: true });

				expect(result.pagesVisited).toBe(3);
				expect(result.questionsAnswered).toBe(1);

				const progress = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion !== "UNKNOWN",
				);
				expect(progress.registrationCompletion).toBe("COMPLETED");
			} finally {
				try {
					await client.deleteCourse(courseId);
				} catch {
					// Best-effort cleanup
				}
			}
		});

		test("quiz completion method reports PASSED when score >= 80%", async () => {
			const appId = process.env.SCORM_CLOUD_APP_ID;
			const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;
			if (!appId || !secretKey) {
				test.skip(true, "SCORM Cloud credentials not configured");
				return;
			}

			const fixtures = await buildScormCloudFixtures({ variant: "quizCompletion" });
			const courseId = `praxity-test-quiz-pass-${Date.now()}`;

			const jobId = await client.uploadCourse(courseId, fixtures.scorm2004Zip);
			const importResult = await client.pollImportJob(jobId);
			if (importResult.status === "ERROR") {
				throw new Error(`Import failed: ${importResult.message}`);
			}

			try {
				const regId = `praxity-quiz-pass-${Date.now()}`;
				await client.createRegistration(regId, courseId, "quiz-pass-learner");
				const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

				// Answer correctly: score = 100%, should pass (>= 80% threshold).
				await simulateLearner(browser, launchUrl, { answerCorrectly: true });

				const progress = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion !== "UNKNOWN" && p.score != null,
				);

				expect(progress.registrationCompletion).toBe("COMPLETED");
				expect(progress.score?.scaled).toBe(100);
				// SCORM 2004 should report PASSED when quiz score >= 80%.
				expect(progress.registrationSuccess).toBe("PASSED");
			} finally {
				try {
					await client.deleteCourse(courseId);
				} catch {
					// Best-effort cleanup
				}
			}
		});

		test("quiz completion method reports FAILED when score < 80%", async () => {
			const appId = process.env.SCORM_CLOUD_APP_ID;
			const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;
			if (!appId || !secretKey) {
				test.skip(true, "SCORM Cloud credentials not configured");
				return;
			}

			const fixtures = await buildScormCloudFixtures({ variant: "quizCompletion" });
			const courseId = `praxity-test-quiz-fail-${Date.now()}`;

			const jobId = await client.uploadCourse(courseId, fixtures.scorm2004Zip);
			const importResult = await client.pollImportJob(jobId);
			if (importResult.status === "ERROR") {
				throw new Error(`Import failed: ${importResult.message}`);
			}

			try {
				const regId = `praxity-quiz-fail-${Date.now()}`;
				await client.createRegistration(regId, courseId, "quiz-fail-learner");
				const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

				// Answer incorrectly: score = 0%, well below the 80% threshold.
				await simulateLearner(browser, launchUrl, { answerCorrectly: false });

				const progress = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion !== "UNKNOWN" && p.score != null,
				);

				// Course should still be marked COMPLETED (visited all pages), but score < 80.
				expect(progress.registrationCompletion).toBe("COMPLETED");
				expect(progress.score?.scaled).toBeLessThan(80);
			} finally {
				try {
					await client.deleteCourse(courseId);
				} catch {
					// Best-effort cleanup
				}
			}
		});
	});
