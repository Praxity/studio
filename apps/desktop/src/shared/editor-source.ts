import { normalizeLineEndings } from "@praxity/grammar/src/line-endings.ts";

/** Match unchanged lines with Myers' edit path, including repeated blank lines. */
function unchangedLines(before: string[], after: string[]): Map<number, number> {
	const matches = new Map<number, number>();
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) {
		matches.set(start, start);
		start++;
	}
	let oldEnd = before.length;
	let newEnd = after.length;
	// Anchor the unchanged suffix before diffing, so adjacent repeated blank lines
	// keep their own endings when one is edited. Only the changed region needs a trace.
	while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
		matches.set(--newEnd, --oldEnd);
	}
	const oldLines = before.slice(start, oldEnd);
	const newLines = after.slice(start, newEnd);
	if (oldLines.length === 0 || newLines.length === 0) return matches;
	const trace: Map<number, number>[] = [];
	let frontier = new Map([[1, 0]]);
	for (let distance = 0; distance <= oldLines.length + newLines.length; distance++) {
		trace.push(new Map(frontier));
		for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
			let x =
				diagonal === -distance ||
				(diagonal !== distance &&
					(frontier.get(diagonal - 1) ?? 0) < (frontier.get(diagonal + 1) ?? 0))
					? (frontier.get(diagonal + 1) ?? 0)
					: (frontier.get(diagonal - 1) ?? 0) + 1;
			let y = x - diagonal;
			while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
				x++;
				y++;
			}
			frontier.set(diagonal, x);
			if (x < oldLines.length || y < newLines.length) continue;
			for (let step = distance; step >= 0; step--) {
				frontier = trace[step];
				const k = x - y;
				const previousK =
					k === -step || (k !== step && (frontier.get(k - 1) ?? 0) < (frontier.get(k + 1) ?? 0))
						? k + 1
						: k - 1;
				const previousX = frontier.get(previousK) ?? 0;
				const previousY = previousX - previousK;
				while (x > previousX && y > previousY) {
					matches.set(--y + start, --x + start);
				}
				x = previousX;
				y = previousY;
			}
			return matches;
		}
	}
	throw new Error("Editor line edits could not be resolved");
}

/** Apply LF editor line edits to the raw baseline, retaining each line's own terminator.
 * Explicit CR bytes are already a raw replacement. The editor represents the final
 * newline as an empty final paragraph, so its presence or removal is authoritative. */
export function preserveEditorLineEndings(
	source: string,
	previousSource: string | undefined,
): string {
	if (previousSource === undefined || source.includes("\r")) return source;
	const before = normalizeLineEndings(previousSource).split("\n");
	const after = source.split("\n");
	const endings = previousSource.match(/\r\n|\r|\n/g) ?? [];
	const matches = unchangedLines(before, after);
	const anchors = [...matches.entries()].sort(([a], [b]) => a - b);
	anchors.push([after.length, before.length]);
	let oldStart = 0;
	let newStart = 0;
	for (const [newEnd, oldEnd] of anchors) {
		// Pair edited lines between unchanged anchors; new lines inherit the local style.
		for (let index = newStart; index < newEnd; index++) {
			const oldIndex = oldStart + index - newStart;
			if (oldIndex < oldEnd) matches.set(index, oldIndex);
		}
		oldStart = oldEnd + 1;
		newStart = newEnd + 1;
	}
	let eol = endings[0] ?? "\n";
	return after
		.map((line, index) => {
			const oldIndex = matches.get(index);
			if (oldIndex !== undefined) eol = endings[oldIndex] ?? eol;
			return line + (index < after.length - 1 ? eol : "");
		})
		.join("");
}
