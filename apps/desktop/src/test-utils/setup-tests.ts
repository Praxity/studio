import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, vi } from "vitest";

if (process.platform === "darwin") process.env.TMPDIR = realpathSync.native(tmpdir());

afterEach(() => {
	vi.useRealTimers();
});
