import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ platform: process.platform }));
vi.mock("node:os", async (original) => ({
	...(await original<typeof import("node:os")>()),
	platform: () => host.platform,
}));
afterEach(() => {
	host.platform = process.platform;
	vi.unstubAllEnvs();
});

it.each([
	["darwin", "true", 1],
	["darwin", undefined, 1],
	["linux", "true", "100%"],
	["linux", undefined, "50%"],
	["linux", "false", "50%"],
	["linux", "1", "50%"],
	["win32", "true", "50%"],
	["win32", undefined, "50%"],
] as const)("uses the workspace worker budget for %s with CI=%s", async (platform, ci, workers) => {
	host.platform = platform;
	vi.stubEnv("CI", ci);
	vi.resetModules();
	const { default: config } = await import("../../../../vitest.workspace");
	expect(config.test?.maxWorkers).toBe(workers);
});
