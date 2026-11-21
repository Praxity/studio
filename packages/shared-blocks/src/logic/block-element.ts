export function findBlockElement(
	blockId: string,
	root: Document | Element = document,
): HTMLElement | null {
	const escaped = blockId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	const matches = root.querySelectorAll<HTMLElement>(`[data-block-id="${escaped}"]`);
	return matches[matches.length - 1] ?? null;
}
