import { tmpdir } from "node:os";

// Keep the complete recovery-save latency gate on disk and flush-order fixtures in parity.
const diskFixtures = new Set(["project-os-lock", "project-journal-flush-dependency"]);

export function fixtureTmpdir(suite: string): string {
	return diskFixtures.has(suite) ? (process.env.RUNNER_TEMP ?? tmpdir()) : tmpdir();
}
