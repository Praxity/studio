import { tmpdir } from "node:os";

const diskFixtures = new Set(["project-os-lock", "project-journal-flush-dependency"]);

export function fixtureTmpdir(suite: string): string {
	return diskFixtures.has(suite) ? (process.env.RUNNER_TEMP ?? tmpdir()) : tmpdir();
}
