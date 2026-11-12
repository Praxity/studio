export function normalizeDesktopAssetPath(assetPath: string): string {
	return assetPath.replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");
}

export function matchingDesktopAssetPath(
	url: string,
	resolvedAssetPaths: ReadonlySet<string>,
): string | undefined {
	const normalized = normalizeDesktopAssetPath(url.split(/[?#]/, 1)[0]);
	if (resolvedAssetPaths.has(normalized)) return normalized;
	try {
		const decoded = decodeURIComponent(normalized);
		return resolvedAssetPaths.has(decoded) ? decoded : undefined;
	} catch {
		return undefined;
	}
}
