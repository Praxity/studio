import { createHash } from "node:crypto";
import { homedir } from "node:os";

// Typst 0.15.1's unmodified macOS release binaries embed upstream Cargo paths
// under the hosted macOS runner home. Pin exact bytes and artifact path.
// https://github.com/typst/typst/releases/tag/v0.15.1
const upstreamTypstSha256 = new Set([
	"7c4a136b377f3689400afe37b4f0fe3528d50faaa55cbb1106ac8a128f86ba1a", // aarch64-apple-darwin
	"a6fb5786e71f6f95d8323b326353770734c1e4624e7c108783ea578723916b46", // x86_64-apple-darwin
]);

export function portablePath(file) {
	return file.replaceAll("\\", "/");
}

export function assertNoPrivateCheckoutPath(bytes, relative, repoDir) {
	if (
		relative === "typst/typst" &&
		upstreamTypstSha256.has(createHash("sha256").update(bytes).digest("hex"))
	)
		return;
	const homeDir = process.env.HOME || homedir();
	for (const privatePath of [repoDir, homeDir]) {
		if (
			bytes.includes(Buffer.from(privatePath)) ||
			bytes.includes(Buffer.from(portablePath(privatePath)))
		) {
			throw new Error(`Private checkout path in artifact: ${relative}`);
		}
	}
}
