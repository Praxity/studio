export const STANDALONE_NODE_RANGE = ">=24.22.1 <27";

export function supportsStandaloneNode(version: string): boolean {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) return false;
	const [major, minor, patch] = match.slice(1).map(Number);
	return major === 26 || (major === 24 && (minor > 22 || (minor === 22 && patch >= 1)));
}
