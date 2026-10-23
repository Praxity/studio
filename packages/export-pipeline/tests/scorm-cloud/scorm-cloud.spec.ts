import { type Browser, chromium, expect, test } from "@playwright/test";
import { ScormCloudClient } from "../../src/scorm-cloud/client";
import { buildScormCloudFixtures } from "./fixture";
import { readTestEnv, type ScormCloudTestEnv, waitForProgress } from "./helpers";
import { simulateLearner } from "./learner-simulation";

let client: ScormCloudClient;
let browser: Browser;
let env: ScormCloudTestEnv;

test.beforeAll(async () => {
	env = readTestEnv();
	if (env.skip) {
		test.skip(true, env.reason ?? "SCORM Cloud credentials not configured");
		return;
	}

	const appId = process.env.SCORM_CLOUD_APP_ID;
	const secretKey = process.env.SCORM_CLOUD_SECRET_KEY;
	if (!appId || !secretKey) {
		test.skip(true, "SCORM Cloud credentials not configured");
		return;
	}

	client = new ScormCloudClient(appId, secretKey);
	browser = await chromium.launch({ headless: true });
});

test.afterAll(async () => {
	if (browser) await browser.close();
});

function makeRegId(format: string, testName: string): string {
	return `praxity-test-${format}-${testName}-${Date.now()}`;
}

const LAUNCH_OPTS = {
	redirectOnExitUrl: "message" as const,
	expiry: 300,
};

function getCourseId(
	currentEnv: ScormCloudTestEnv,
	key: "scorm12CourseId" | "scorm2004CourseId",
): string {
	const courseId = currentEnv[key];
	if (!courseId) {
		throw new Error(`Missing required course id in test env: ${key}`);
	}
	return courseId;
}

for (const format of ["scorm12", "scorm2004"] as const) {
	const courseIdKey = format === "scorm12" ? "scorm12CourseId" : "scorm2004CourseId";

	test.describe
		.serial(`SCORM Cloud: ${format}`, () => {
			test("full completion with correct answers", async () => {
				const courseId = getCourseId(env, courseIdKey);
				const regId = makeRegId(format, "complete");

				await client.createRegistration(regId, courseId, "test-learner-1");
				const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

				await simulateLearner(browser, launchUrl, { answerCorrectly: true });

				const progress = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion !== "UNKNOWN" && p.score != null,
				);

				expect(progress.registrationCompletion).toBe("COMPLETED");
				expect(progress.score?.scaled).toBe(100);
				expect(progress.totalSecondsTracked).toBeGreaterThan(0);

				if (format === "scorm2004") {
					expect(progress.registrationSuccess).toBe("PASSED");
				}

				// Cloud requires the separate interaction flag even when runtime data is requested.
				const detailed = await client.getProgress(regId, {
					includeRuntime: true,
					includeInteractionsAndObjectives: true,
				});
				expect(detailed.runtime).toBeDefined();
				if (detailed.runtime) {
					const runtime = detailed.runtime;
					expect(runtime.runtimeInteractions.length).toBe(env.scoredQuestionCount);

					// Verify suspend data contains visited pages
					if (runtime.suspendData) {
						const suspendData = JSON.parse(runtime.suspendData);
						expect(Array.isArray(suspendData.visitedPages)).toBe(true);
						expect(suspendData.visitedPages.length).toBe(env.pageCount);
					}
				}
			});

			test("suspend data persists across sessions", async () => {
				const courseId = getCourseId(env, courseIdKey);
				const regId = makeRegId(format, "suspend");

				await client.createRegistration(regId, courseId, "test-learner-2");

				// Session 1: visit first 2 pages, then close
				const launchUrl1 = await client.getLaunchLink(regId, LAUNCH_OPTS);
				await simulateLearner(browser, launchUrl1, { stopAfterPage: 2 });

				const progress1 = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion !== "UNKNOWN",
				);
				expect(progress1.registrationCompletion).toBe("INCOMPLETE");

				// Verify suspend data has 2 visited pages
				const detailed1 = await client.getProgress(regId, { includeRuntime: true });
				expect(detailed1.runtime?.suspendData).toBeTruthy();
				if (detailed1.runtime?.suspendData) {
					const sd = JSON.parse(detailed1.runtime.suspendData);
					expect(sd.visitedPages.length).toBe(2);
				}

				// Session 2: complete the course
				const launchUrl2 = await client.getLaunchLink(regId, LAUNCH_OPTS);
				await simulateLearner(browser, launchUrl2);

				const progress2 = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion === "COMPLETED",
				);
				expect(progress2.registrationCompletion).toBe("COMPLETED");
			});

			test("window close restores the answered quiz in a fresh session", async () => {
				test.skip(
					process.env.SCORM_CLOUD_FULL_FIXTURE === "true",
					"Uses the minimal fixture's quiz on page 3",
				);
				const regId = makeRegId(format, "answered-resume");
				await client.createRegistration(
					regId,
					getCourseId(env, courseIdKey),
					"synthetic-resume-learner",
				);
				try {
					const first = await simulateLearner(
						browser,
						await client.getLaunchLink(regId, LAUNCH_OPTS),
						{ stopAfterPage: 3 },
					);
					expect(first.questionsAnswered).toBe(env.scoredQuestionCount);
					const saved = await waitForProgress(client, regId, (progress) =>
						Boolean(progress.runtime?.suspendData && progress.runtime.location),
					);
					expect(saved.registrationCompletion).toBe("INCOMPLETE");
					expect(saved.runtime?.suspendData).toBeTruthy();
					expect(saved.runtime?.location).toBeTruthy();
					const resumed = await simulateLearner(
						browser,
						await client.getLaunchLink(regId, LAUNCH_OPTS),
						{ stopAfterPage: 0 },
					);
					expect(resumed.startingPage).toBe(3);
					expect(resumed.initialCheckedValues).toContain("q1-b");
					expect(resumed.initialCheckedValues).toContain("q2-b");
					expect((await client.getProgress(regId)).registrationCompletion).toBe("INCOMPLETE");
				} finally {
					await client.deleteRegistration(regId);
				}
			});

			test("incorrect answers produce lower score", async () => {
				const courseId = getCourseId(env, courseIdKey);
				const regId = makeRegId(format, "incorrect");

				await client.createRegistration(regId, courseId, "test-learner-3");
				const launchUrl = await client.getLaunchLink(regId, LAUNCH_OPTS);

				await simulateLearner(browser, launchUrl, { answerCorrectly: false });

				const progress = await waitForProgress(
					client,
					regId,
					(p) => p.registrationCompletion !== "UNKNOWN",
				);

				expect(progress.registrationCompletion).toBe("COMPLETED");
				expect(progress.score?.scaled).toBeLessThan(100);

				if (format === "scorm2004") {
					expect(progress.registrationSuccess).toBe("FAILED");
				}
			});
		});
}

test.describe("SCORM Cloud: error cases", () => {
	test("parser warnings are captured from import result", async () => {
		if (env.skip) {
			test.skip(true, env.reason ?? "SCORM Cloud credentials not configured");
			return;
		}

		// Use the SCORM 1.2 course that was already imported in global setup
		const courseId = `praxity-test-warnings-${Date.now()}`;
		const fixtures = await buildScormCloudFixtures();
		const jobId = await client.uploadCourse(courseId, fixtures.scorm12Zip);

		try {
			const result = await client.pollImportJob(jobId);
			expect(result.status).toBe("COMPLETE");
			expect(Array.isArray(result.parserWarnings)).toBe(true);
			expect(result.courseId).toBe(courseId);

			// Verify array element types
			for (const warning of result.parserWarnings) {
				expect(typeof warning).toBe("string");
			}

			if (result.parserWarnings.length > 0) {
				console.log(`[scorm-cloud] Parser warnings for ${courseId}:`, result.parserWarnings);
			}
		} finally {
			try {
				await client.deleteCourse(courseId);
			} catch {
				// Best-effort cleanup
			}
		}
	});
});
