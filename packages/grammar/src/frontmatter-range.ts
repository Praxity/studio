/** Dependency-free fence ownership for the lexer, metadata reader and source editor.
 * Raw offsets include one optional leading BOM and the authored line endings. */
export function findFrontmatterRange(source: string) {
	const lines = source.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
	const first = lines[0];
	if (first === undefined) return undefined;
	const opening = first.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, "");
	if (!/^---[ \t]*$/.test(opening)) return undefined;
	const yamlStart = first.length;
	let offset = yamlStart;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			return {
				yamlStart,
				yamlEnd: offset,
				endIndex: i,
				end: offset + lines[i].length,
			};
		}
		offset += lines[i].length;
	}
	return { yamlStart, yamlEnd: source.length, endIndex: -1, end: source.length };
}
