import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import globalSetup from "./scorm-cloud/global-setup";
import { isDriverAvailable } from "./scorm-local/local-harness";

afterEach(() => vi.unstubAllEnvs());

describe("gate prerequisites", () => {
	it("throws for a missing Rustici driver in gate mode", async () => {
		vi.stubEnv("PRAXITY_GATE", "1");
		const dir = await mkdtemp(join(tmpdir(), "missing-driver-"));
		try {
			await expect(isDriverAvailable("scorm12", dir)).rejects.toThrow(/Rustici.*scorm12/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("lets the caller skip a missing driver without gate mode", async () => {
		vi.stubEnv("PRAXITY_GATE", "");
		const dir = await mkdtemp(join(tmpdir(), "missing-driver-"));
		try {
			expect(await isDriverAvailable("scorm2004", dir)).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects an incomplete driver even when its index exists", async () => {
		vi.stubEnv("PRAXITY_GATE", "1");
		const dir = await mkdtemp(join(tmpdir(), "incomplete-driver-"));
		try {
			await writeFile(join(dir, "indexAPI.html"), "<html></html>");
			await expect(isDriverAvailable("scorm12", dir)).rejects.toThrow(/scormdriver.js/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("throws for missing Cloud credentials before fixture compilation", async () => {
		vi.stubEnv("PRAXITY_GATE", "1");
		vi.stubEnv("SCORM_CLOUD_APP_ID", "");
		vi.stubEnv("SCORM_CLOUD_SECRET_KEY", "");
		await expect(globalSetup({} as never)).rejects.toThrow(/SCORM_CLOUD_APP_ID/);
	});

	it("retains Cloud skip mode without the gate variable", async () => {
		vi.stubEnv("PRAXITY_GATE", "");
		vi.stubEnv("SCORM_CLOUD_APP_ID", "");
		vi.stubEnv("SCORM_CLOUD_SECRET_KEY", "");
		const cleanup = await globalSetup({} as never);
		await cleanup();
	});
});
