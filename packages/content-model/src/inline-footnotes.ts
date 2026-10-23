import { escapeLength, findUnescaped } from "./escaping";
import type { InlineNode } from "./inline-tree";

/** Material recognition only. The two learner parsers keep their existing contracts. */
export function parseMaterialFootnote(
	source: string,
	start: number,
	offset = 0,
): Extract<InlineNode, { kind: "source" | "sources" }> | undefined {
	for (const name of ["@sources", "@footer.insert"]) {
		if (source.startsWith(name, start) && !/[\w.-]/.test(source[start + name.length] ?? ""))
			return {
				kind: "sources",
				start: start + offset,
				end: start + name.length + offset,
				raw: name,
			};
	}
	if (!source.startsWith("@source{", start) && !source.startsWith("@footer{", start))
		return undefined;
	for (let index = start + 8; index < source.length; index++) {
		if (escapeLength(source, index, "ascii")) {
			index++;
			continue;
		}
		if (source[index] === "`") {
			const end = source.indexOf("`", index + 1);
			if (end !== -1) {
				if (findUnescaped(source.slice(index + 1, end), "{") !== -1) return undefined;
				index = end;
				continue;
			}
		}
		if (source[index] === "{") return undefined;
		if (source[index] === "}") {
			if (index === start + 8) return undefined;
			const raw = source.slice(start + 8, index);
			return {
				kind: "source",
				start: start + offset,
				end: index + 1 + offset,
				raw: source.slice(start, index + 1),
				content: { start: start + 8 + offset, end: index + offset, raw, value: raw },
			};
		}
	}
	return undefined;
}
