import type { FullConfig } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	deleteCourse: vi.fn().mockResolvedValue(undefined),
	listCourses: vi.fn().mockResolvedValue([{ id: "praxity-test-unrelated" }]),
	uploadCourse: vi.fn().mockResolvedValue("job"),
	pollImportJob: vi.fn().mockResolvedValue({ status: "COMPLETE", parserWarnings: [] }),
}));
vi.mock("node:fs/promises", () => ({ rm: vi.fn(), writeFile: vi.fn() }));
vi.mock("./scorm-cloud/fixture", () => ({
	buildScormCloudFixtures: vi.fn().mockResolvedValue({
		scorm12Zip: Buffer.alloc(0),
		scorm2004Zip: Buffer.alloc(0),
		pageCount: 4,
		scoredQuestionCount: 3,
	}),
}));
vi.mock("../src/scorm-cloud/client", () => ({
	ScormCloudClient: class {
		deleteCourse = mocks.deleteCourse;
		listCourses = mocks.listCourses;
		uploadCourse = mocks.uploadCourse;
		pollImportJob = mocks.pollImportJob;
	},
}));

import globalSetup from "./scorm-cloud/global-setup";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});
it("deletes only this run's uploaded courses without scavenging other runs", async () => {
	vi.stubEnv("SCORM_CLOUD_APP_ID", "synthetic");
	vi.stubEnv("SCORM_CLOUD_SECRET_KEY", "synthetic");
	const teardown = await globalSetup({} as FullConfig);
	await teardown();
	expect(mocks.listCourses).not.toHaveBeenCalled();
	expect(mocks.deleteCourse.mock.calls.map(([id]) => id)).toEqual(
		mocks.uploadCourse.mock.calls.map(([id]) => id),
	);
	expect(mocks.deleteCourse).toHaveBeenCalledTimes(2);
});

it("cleans this run's courses when setup fails before returning teardown", async () => {
	vi.stubEnv("SCORM_CLOUD_APP_ID", "synthetic");
	vi.stubEnv("SCORM_CLOUD_SECRET_KEY", "synthetic");
	mocks.pollImportJob.mockRejectedValueOnce(new Error("synthetic import failure"));
	await expect(globalSetup({} as FullConfig)).rejects.toThrow("synthetic import failure");
	expect(mocks.listCourses).not.toHaveBeenCalled();
	expect(mocks.deleteCourse).toHaveBeenCalledWith(mocks.uploadCourse.mock.calls[0]?.[0]);
	expect(mocks.deleteCourse).toHaveBeenCalledTimes(2);
});
