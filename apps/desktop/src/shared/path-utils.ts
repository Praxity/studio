export function getFileExtension(filename: string): string {
	const normalized = filename.toLowerCase();
	const dotIndex = normalized.lastIndexOf(".");
	if (dotIndex === -1 || dotIndex === normalized.length - 1) {
		return "";
	}
	return normalized.slice(dotIndex + 1);
}

export function normalizeDesktopPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getPathBasename(path: string): string {
	const normalizedPath = normalizeDesktopPath(path);
	const segments = normalizedPath.split("/").filter(Boolean);
	return segments.at(-1) ?? path;
}

export function joinDesktopPath(basePath: string, childPath: string): string {
	return `${normalizeDesktopPath(basePath)}/${childPath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

export function getRelativeDesktopPath(parentPath: string, childPath: string): string {
	const normalizedParent = normalizeDesktopPath(parentPath);
	const normalizedChild = childPath.replace(/\\/g, "/");

	if (normalizedChild.startsWith(`${normalizedParent}/`)) {
		return normalizedChild.slice(normalizedParent.length + 1);
	}

	return getPathBasename(normalizedChild);
}

export function isDesktopSubPath(parentPath: string, childPath: string): boolean {
	const normalizedParent = normalizeDesktopPath(parentPath);
	const normalizedChild = normalizeDesktopPath(childPath);
	return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

export function sanitizePathSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}

export function sanitizeExportFilenameStem(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9-_ ]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
}
