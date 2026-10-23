import type { TokenStream } from "../lex/index.ts";
import type { ReportDiagnostic } from "./analyze.ts";
import type { AnalysisOptions, TreeNode } from "./types.ts";

export function deriveHeadings(
	stream: TokenStream,
	root: TreeNode,
	options: AnalysisOptions,
	report: ReportDiagnostic,
): void {
	const scopes: { owner: TreeNode; level: number; itemLevel?: number; itemHeading?: boolean }[] = [
		{ owner: root, level: 1 },
	];
	for (let index = 0; index < scopes.length; index++) {
		const scope = scopes[index];
		let level = scope.level;
		for (const child of scope.owner.children) {
			const definition = options.definition(child.type ?? "");
			const explicit = child.settings.find((s) => s.name === "level");
			let authored: number | undefined;
			if (
				child.kind === "page" &&
				!child.settings.some(
					(s) => s.name === "hideTitle" && (s.value.value === true || s.value.value === "true"),
				)
			)
				authored = 1;
			if (child.kind === "heading") {
				authored =
					stream.tokens
						.slice(child.header?.tokenStart, child.header?.tokenEnd)
						.find((t) => t.kind === "marker")?.raw.length ?? 2;
			}
			if (child.kind === "block" && child.subject && definition?.heading) authored = level + 1;
			if (child.kind === "item" && scope.itemHeading) authored = scope.itemLevel ?? level;
			if (explicit && child.kind !== "page") authored = Number(explicit.value.value);
			if (authored !== undefined) {
				child.headingLevel = Math.min(authored, 6);
				if (authored > 6)
					report(
						"heading-level-clamped",
						child.header ?? child.span,
						{ requested: authored, level: 6 },
						"warning",
					);
			}
			if (child.kind === "heading") level = child.headingLevel ?? level;
			// Derived titles do not change their parent's last authored heading.
			const ownLevel =
				child.headingLevel ??
				(definition?.items
					? Math.min(level + 1, 6)
					: child.kind === "item"
						? (scope.itemLevel ?? level)
						: level);
			const itemLevel = definition?.items
				? child.subject && definition.heading
					? ownLevel + 1
					: level + 1
				: undefined;
			scopes.push({
				owner: child,
				level: child.kind === "page" ? 1 : ownLevel,
				itemLevel,
				itemHeading: definition?.itemHeading,
			});
		}
	}
}
