/**
 * Comprehensive SCORM Cloud test using the full grammar fixture.
 * Tests containers, multiple assessment types, assessment groups,
 * and navigation style variants.
 *
 * Run with: SCORM_CLOUD_FULL=true npx playwright test --config tests/scorm-cloud/playwright.config.ts comprehensive.spec.ts
 */
import { type Browser, chromium, expect, test } from "@playwright/test";
import { ScormCloudClient } from "../../src/scorm-cloud/client";
import { buildScormCloudFixtures } from "./fixture";
import { waitForProgress } from "./helpers";
import { simulateLearner } from "./learner-simulation";

test.skip(() => process.env.SCORM_CLOUD_FULL !== "true", "Set SCORM_CLOUD_FULL=true to run");
test.setTimeout(300_000);

let client: ScormCloudClient;
let browser: Browser;
let courseId: string;
let pageCount: number;
let scoredQuestionCount: number;

const LAUNCH_OPTS = { redirectOnExitUrl: "message" as const, expiry: 600 };

test.beforeAll(async () => {
	const appId = process.env.SCORM_CLOUD_APP_ID;
	const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;
	if (!appId || !secretKey) {
		test.skip(true, "SCORM Cloud credentials not configured");
		return;
	}

	client = new ScormCloudClient(appId, secretKey);
	browser = await chromium.launch({ headless: false });

	console.log("[comprehensive] Building full grammar fixture...");
	const fixtures = await buildScormCloudFixtures({ full: true });
	pageCount = fixtures.pageCount;
	scoredQuestionCount = fixtures.scoredQuestionCount;

	courseId = `praxity-test-comprehensive-${Date.now()}`;
	console.log(
		`[comprehensive] Uploading (${pageCount} pages, ${scoredQuestionCount} scored questions)...`,
	);
	const jobId = await client.uploadCourse(courseId, fixtures.scorm12Zip);
	const result = await client.pollImportJob(jobId);
	if (result.status === "ERROR") {
		throw new Error(`Import failed: ${result.message}`);
	}
	if (result.parserWarnings.length > 0) {
		console.log("[comprehensive] Parser warnings:", result.parserWarnings);
	}
	console.log("[comprehensive] Course imported successfully.");
});

test.afterAll(async () => {
	if (courseId) {
		try {
			await client.deleteCourse(courseId);
		} catch {}
	}
	if (browser) await browser.close();
});

// --- Tests ---

test("navigates all pages and answers automatable assessments", async () => {
	const regId = `praxity-comprehensive-${Date.now()}`;
	await client.createRegistration(regId, courseId, "comprehensive-learner");
	const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

	const result = await simulateLearner(browser, launchUrl, { answerCorrectly: true });

	console.log(
		`[comprehensive] Result: ${result.pagesVisited} pages, ${result.questionsAnswered} questions answered`,
	);

	expect(result.pagesVisited).toBe(pageCount);
	expect(result.questionsAnswered).toBeGreaterThan(0);

	const progress = await waitForProgress(
		client,
		regId,
		(p) => p.registrationCompletion !== "UNKNOWN" && p.score != null,
	);
	expect(progress.registrationCompletion).toBe("COMPLETED");
	expect(progress.score?.scaled).toBeGreaterThan(0);
	expect(progress.totalSecondsTracked).toBeGreaterThan(0);
});

test.describe
	.serial("navigation style variants", () => {
		test.beforeAll(async () => {
			// Free the course slot used by the comprehensive fixture
			if (courseId) {
				try {
					await client.deleteCourse(courseId);
				} catch {}
				courseId = "";
			}
		});

		for (const navStyle of ["sidebar", "bottomBar", "none"] as const) {
			test(`${navStyle} navigation renders and allows page traversal`, async () => {
				// Use the MINIMAL fixture (4 pages) — fast to build and upload.
				// Each variant uploads its own course and deletes it afterward.
				const fixtures = await buildScormCloudFixtures({
					navigationStyle: navStyle,
				});
				const navCourseId = `praxity-nav-${navStyle}-${Date.now()}`;

				const jobId = await client.uploadCourse(navCourseId, fixtures.scorm12Zip);
				const importResult = await client.pollImportJob(jobId);
				if (importResult.status === "ERROR") {
					throw new Error(`Import failed for ${navStyle}: ${importResult.message}`);
				}

				try {
					const regId = `praxity-nav-${navStyle}-${Date.now()}`;
					await client.createRegistration(regId, navCourseId, `nav-${navStyle}-learner`);
					const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

					const result = await simulateLearner(browser, launchUrl, { answerCorrectly: true });

					expect(result.pagesVisited).toBe(fixtures.pageCount);
					expect(result.questionsAnswered).toBe(fixtures.scoredQuestionCount);

					const progress = await waitForProgress(
						client,
						regId,
						(p) => p.registrationCompletion !== "UNKNOWN" && p.score != null,
					);
					expect(progress.registrationCompletion).toBe("COMPLETED");
					expect(progress.score?.scaled).toBe(100);
					console.log(`[comprehensive] ✓ Nav style "${navStyle}" works correctly`);
				} finally {
					try {
						await client.deleteCourse(navCourseId);
					} catch {}
				}
			});
		}
	});
