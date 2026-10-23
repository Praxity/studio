/** C01 sidecar paths whose recovery archives must not be discarded automatically. */
export const IDENTITY_LINEAGE_PATHS = [
	".praxity",
	".praxity/identity",
	".praxity/content-identity.json",
	"narration.yaml",
	".praxity/review",
] as const;

export function isIdentityLineagePath(path: string): boolean {
	const normalized = path.toLowerCase();
	return IDENTITY_LINEAGE_PATHS.some(
		(protectedPath) =>
			normalized === protectedPath ||
			(protectedPath !== ".praxity" && normalized.startsWith(`${protectedPath}/`)),
	);
}

/** Unknown historical names must retain the same protection during facts and reclamation. */
export function classifyIdentityLineagePath(path: string): "lineage" | "ordinary" | "unknown" {
	const [root, ...children] = path.split("/");
	const ambiguous = (segment: string) => /~\d|[^\x20-\x7e]/u.test(segment);
	// Only root names that could spell a protected name need historical alias protection.
	const folded = root.normalize("NFKC").toUpperCase().toLowerCase();
	const short = /^([^~.]{1,6})~([1-9]\d*)(?:\.([^.]+))?$/u.exec(root.toUpperCase());
	const protectedShort =
		short &&
		short[1].length + short[2].length + 1 <= 8 &&
		((short[3] === "YAM" && "NARRATION".startsWith(short[1])) ||
			(short[3] === undefined && "PRAXITY".startsWith(short[1])) ||
			(short[3] === "YAM" && /^NA[0-9A-F]{4}$/.test(short[1])) ||
			(short[3] === undefined && /^PR[0-9A-F]{4}$/.test(short[1])));
	if (
		protectedShort ||
		(ambiguous(root) && [".praxity", "narration.yaml"].includes(folded)) ||
		(root.toLowerCase() === ".praxity" && children.some(ambiguous))
	)
		return "unknown";
	return isIdentityLineagePath(path) ? "lineage" : "ordinary";
}
