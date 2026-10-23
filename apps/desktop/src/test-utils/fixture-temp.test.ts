import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureTmpdir } from "./fixture-temp";

afterEach(() => vi.unstubAllEnvs());

it.each(["project-os-lock", "project-journal-flush-dependency"])(
	"keeps %s on runner disk even when the default temp directory is tmpfs",
	(suite) => {
		vi.stubEnv("RUNNER_TEMP", "/runner-disk");
		vi.stubEnv("TMPDIR", "/dev/shm/vitest.fixture");
		expect(fixtureTmpdir(suite)).toBe("/runner-disk");
	},
);

it("preserves local temp defaults and ordinary tmpfs fixtures", () => {
	vi.stubEnv("RUNNER_TEMP", undefined);
	for (const suite of ["project-os-lock", "project-journal-flush-dependency", "comments-cli"])
		expect(fixtureTmpdir(suite)).toBe(tmpdir());
	vi.stubEnv("RUNNER_TEMP", "/runner-disk");
	expect(fixtureTmpdir("comments-cli")).toBe(tmpdir());
});

// This is a fixture-placement policy: reverting a caller must fail alongside changing the owner.
it.each(["project-os-lock", "project-journal-flush-dependency"])(
	"routes %s project fixtures through the disk policy",
	(suite) => {
		const source = readFileSync(
			new URL(`../main/__tests__/${suite}.test.ts`, import.meta.url),
			"utf8",
		);
		const factory = source.match(/async function project\(\) \{([\s\S]*?)\n\}/)?.[1];
		const placement = new RegExp(`mkdtemp\\(\\s*join\\(fixtureTmpdir\\("${suite}"\\),`);
		expect(factory).toMatch(placement);
		expect(factory?.replaceAll(`fixtureTmpdir("${suite}")`, "tmpdir()")).not.toMatch(placement);
	},
);
