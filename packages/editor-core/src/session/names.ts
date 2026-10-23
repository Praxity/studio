import { tokenizeInline } from "@praxity/grammar/src/v4/inline.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { definitionOf, type TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";

type Translate = (key: string, params?: Record<string, string | number>) => string;
function learnerText(source: string, literalText: boolean): string {
	const visit = (nodes: ReturnType<typeof tokenizeInline>["children"]): string =>
		nodes
			.map((node): string => {
				if ("children" in node) return visit(node.children);
				if (node.kind === "text") return node.value;
				if (node.kind === "code" || node.kind === "source") return node.content.value;
				return "";
			})
			.join("");
	return (literalText ? source : visit(tokenizeInline(source).children))
		.replace(/[…"'“”‘’]/gu, "")
		.replace(/\s+/gu, " ")
		.trim();
}
function excerpt(source: string, literalText = false): string {
	const text = learnerText(source, literalText);
	if (text.length <= 40) return text;
	const prefix = text.slice(0, 40);
	if (/\s/u.test(text[40])) return prefix;
	const boundary = prefix.lastIndexOf(" ");
	// A single word longer than the limit has no permitted word boundary.
	return boundary < 0 ? "" : prefix.slice(0, boundary);
}
function textOf(node: TreeNode): string {
	const value = node.subject?.value ?? node.alt?.value ?? node.text?.value ?? node.value?.value;
	if (typeof value === "string" && value.trim()) return value;
	const title = node.children.find((child) => child.kind === "part" && child.name === "title");
	if (title) return textOf(title);
	const cell = node.rows?.[0]?.cells[0]?.value;
	if (typeof cell === "string" && cell.trim()) return cell;
	if (node.kind === "body" || node.kind === "recovery") return node.raw;
	return node.children.map(textOf).find((text) => text.trim()) ?? "";
}
function nameOf(
	node: TreeNode,
	parent: TreeNode | undefined,
	grandparent: TreeNode | undefined,
	translate: Translate,
	positions: boolean,
): string {
	const peers = parent?.children.filter((child) => child.kind === node.kind) ?? [node];
	const pos = peers.indexOf(node) + 1;
	const total = peers.length;
	const definition = definitionOf(node, parent, getDefinition);
	const labelKey =
		node.kind === "part"
			? parent && definitionOf(parent, grandparent, getDefinition)?.partLabels[node.name ?? ""]
			: definition?.labelKey;
	// Schema labels include parent and child keys, such as categorize and categorize.item.
	// Encode dots inside a leaf key so ICU catalog branches never collide with a label.
	const label = translate(
		labelKey ? `session.labels.${labelKey.replaceAll(".", "_")}` : `session.names.${node.kind}`,
	);
	if (
		node.kind === "image" &&
		node.settings.some((s) => s.name === "decorative" && s.value.value === true)
	)
		return translate("session.names.decorativeImage");
	if (node.kind === "item") {
		const itemLabel = label;
		if (parent?.type === "columns")
			return positions
				? translate("session.names.itemPosition", { label: itemLabel, pos, total })
				: itemLabel;
		const title = excerpt(
			String(node.subject?.value ?? node.value?.value ?? ""),
			definition?.literalText,
		);
		if (!positions)
			return title
				? translate("session.names.withExcerpt", { label: itemLabel, excerpt: title })
				: itemLabel;
		return translate(title ? "session.names.titledItem" : "session.names.untitledItem", {
			label: itemLabel,
			pos,
			total,
			excerpt: title,
		});
	}
	if (node.kind === "divider") {
		const tone = node.settings.find((s) => s.name === "palette");
		return tone
			? translate("session.names.sectionBand", { value: String(tone.value.value) })
			: label;
	}
	const text = excerpt(textOf(node), definition?.literalText);
	return text ? translate("session.names.withExcerpt", { label, excerpt: text }) : label;
}

/** Names use the schema's label keys. Identical siblings receive a position. */
export function nodeNames(
	root: TreeNode,
	translate: Translate,
	options: { positions?: boolean } = {},
): Map<TreeNode, string> {
	const names = new Map<TreeNode, string>();
	const visit = (node: TreeNode, parent?: TreeNode, grandparent?: TreeNode) => {
		names.set(
			node,
			nameOf(node, parent, grandparent, translate, options.positions !== false).replace(
				/[…"'“”‘’]/gu,
				"",
			),
		);
		node.children.forEach((child) => visit(child, node, parent));
		const counts = new Map<string, number>();
		for (const child of node.children) {
			const name = names.get(child) as string;
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}
		node.children.forEach((child, i) => {
			const name = names.get(child) as string;
			if (options.positions !== false && (counts.get(name) ?? 0) > 1)
				names.set(
					child,
					translate("session.names.duplicatePosition", {
						name,
						pos: i + 1,
						total: node.children.length,
					}),
				);
		});
	};
	visit(root);
	return names;
}
