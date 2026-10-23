import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, vi } from "vitest";

// macOS aliases /var to /private/var. Fault injection must match admitted paths.
if (process.platform === "darwin") process.env.TMPDIR = realpathSync.native(tmpdir());

afterEach(() => {
	vi.useRealTimers();
});
