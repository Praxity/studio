import { fillBlankParts, parseFillBlankContent } from "@praxity/content-model";
import {
	isInlineProjectionMetadataKey,
	withoutInlineProjectionMetadata,
} from "@praxity/content-model/inline-fields";
import type { InlineNode } from "@praxity/content-model/inline-tree";
import { tokenizeInline } from "@praxity/grammar/src/v4/inline.ts";
import {
	getDefinition,
	readTreeFrontmatter,
	type SettingDefinition,
	SPOT_SETTINGS,
} from "@praxity/grammar/src/v4/schema.ts";
import { toBlocks } from "@praxity/grammar/src/v4/to-blocks.ts";
import { definitionOf, type TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";
import type { CanonicalDescriptor, IdentitySnapshot, ParsedDocument } from "./types.ts";

// Unicode White_Space plus BOM, shared by descriptors, lexical scores and fragments.
const whitespace = /[\p{White_Space}\uFEFF]+/gu;
export function normalizeText(text: string): string {
	return text
		.replace(/\r\n|\r/g, "\n")
		.normalize("NFC")
		.replace(whitespace, " ")
		.trim();
}
/** Deterministic JSON. Exact authored bytes are hashed separately as sourceHash. */
export function serializeIdentity(value: unknown): string {
	// Field names recur across every node. Their escaped JSON tokens belong to
	// this serialization only, so callers and later admissions cannot stale them.
	return serializeIdentityValue(value, new Map());
}
function serializeIdentityValue(value: unknown, keys: Map<string, string>): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map((entry) => serializeIdentityValue(entry, keys)).join(",")}]`;
	return `{${Object.entries(value)
		.filter(([, entry]) => entry !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, entry]) => {
			let token = keys.get(key);
			if (token === undefined) {
				token = JSON.stringify(key);
				keys.set(key, token);
			}
			return `${token}:${serializeIdentityValue(entry, keys)}`;
		})
		.join(",")}}`;
}
function inlineNode(node: InlineNode): unknown {
	switch (node.kind) {
		case "text":
			return { kind: node.kind, value: node.value.normalize("NFC") };
		case "unresolved":
			return { kind: node.kind, value: normalizeText(node.raw) };
		case "code":
			return {
				kind: node.kind,
				value: node.content.value.replace(/\r\n|\r/g, "\n").normalize("NFC"),
			};
		case "source":
			return { kind: node.kind, value: normalizeText(node.content.value) };
		case "icon":
		case "variable":
			return { kind: node.kind, name: node.name.value.normalize("NFC") };
		case "sources":
			return { kind: node.kind };
		default:
			return {
				kind: node.kind,
				children: node.children.map(inlineNode),
				...(node.kind === "link" ? { destination: node.destination.value.normalize("NFC") } : {}),
				...(node.kind === "term" ? { definition: normalizeText(node.definition.value) } : {}),
				...(node.kind === "doodle" ? { name: node.name, modifiers: node.modifiers } : {}),
			};
	}
}
const inline = (text: string) =>
	tokenizeInline(
		text
			.replace(/\r\n|\r/g, "\n")
			.normalize("NFC")
			.trim(),
	).children.map((node) =>
		node.kind === "text"
			? { kind: "text", value: node.value.replace(whitespace, " ") }
			: inlineNode(node),
	);
function setting(
	value: string | boolean,
	declaration?: SettingDefinition,
): string | number | boolean {
	if (declaration && !declaration.accepts(value)) return value;
	if (declaration?.type === "boolean") return value === true || value === "true";
	if (declaration?.type === "integer" || declaration?.type === "number") {
		const number = Number(value);
		if (Number.isFinite(number)) return number;
	}
	return typeof value === "string" ? normalizeText(value) : value;
}
function semantic(node: TreeNode, parent?: TreeNode): Record<string, unknown> {
	const definition = definitionOf(node, parent, getDefinition);
	const fields: Record<string, unknown> = { kind: node.kind, type: node.type ?? node.kind };
	if (node.name !== undefined) fields.name = node.name;
	for (const key of ["subject", "value", "alt", "text", "answer"] as const) {
		const value = node[key];
		if (value) fields[key] = typeof value.value === "boolean" ? value.value : inline(value.raw);
	}
	for (const key of ["source", "speaker"] as const)
		if (node[key]) fields[key] = normalizeText(String(node[key]?.value));
	fields.settings = Object.fromEntries(
		node.settings.map((s) => [s.name, setting(s.value.value, definition?.settings[s.name])]),
	);
	if (node.bodySettings)
		fields.bodySettings = Object.fromEntries(
			node.bodySettings.map((s) => [s.name, setting(s.value.value, SPOT_SETTINGS[s.name])]),
		);
	for (const key of [
		"headingLevel",
		"correct",
		"checked",
		"optionKind",
		"ordered",
		"startNumber",
		"number",
		"alignments",
	] as const)
		if (node[key] !== undefined) fields[key] = node[key];
	if (node.rows)
		fields.rows = node.rows.map((row) => ({
			header: row.header,
			cells: row.cells.map((cell) => inline(cell.raw)),
		}));
	if (["body", "recovery", "frontmatter"].includes(node.kind)) {
		// Code and math remain literal. G1 owns their shielding.
		fields.body = /^(?:\s*`{3,}|\s*~{3,}|\$\$)/u.test(node.raw)
			? node.raw.replace(/\r\n|\r/g, "\n").normalize("NFC")
			: inline(node.raw);
	}
	return fields;
}
function hasUnresolved(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	if (!Array.isArray(value) && (value as { kind?: string }).kind === "unresolved") return true;
	return Object.values(value).some(hasUnresolved);
}
function matchText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return "";
	if (Array.isArray(value)) return value.map(matchText).join(" ");
	const excluded = new Set([
		"kind",
		"type",
		"settings",
		"bodySettings",
		"headingLevel",
		"number",
		"startNumber",
		"alignments",
		"checked",
		"correct",
		"optionKind",
		"ordered",
	]);
	return Object.entries(value)
		.filter(([key]) => !excluded.has(key))
		.map(([, entry]) => matchText(entry))
		.join(" ");
}
/** Reads the supplied semantic tree without changing it or rebuilding grammar. */
export function describeDocument(
	document: ParsedDocument,
	options: { readerRoles?: boolean; priorSnapshots?: readonly IdentitySnapshot[] } = {},
): CanonicalDescriptor[] {
	const output: CanonicalDescriptor[] = [];
	const paths = new Map<Readonly<TreeNode>, number[]>();
	// Each node's inline semantics are shared by its own descriptor and ancestor revisions.
	type SemanticSubtree = {
		parent?: TreeNode;
		own: Record<string, unknown>;
		full: Record<string, unknown>;
	};
	const subtrees = new Map<TreeNode, SemanticSubtree>();
	const subtree = (node: TreeNode, parent?: TreeNode): SemanticSubtree => {
		const previous = subtrees.get(node);
		if (previous && previous.parent === parent) return previous;
		const own = semantic(node, parent);
		const full = { ...own, children: node.children.map((child) => subtree(child, node).full) };
		const result = { parent, own, full };
		subtrees.set(node, result);
		return result;
	};
	const visit = (
		node: TreeNode,
		path: number[],
		parentPath: number[] | null,
		parent?: TreeNode,
	) => {
		paths.set(node, path);
		const { own, full } = subtree(node, parent);
		const revisionContent = serializeIdentity(full);
		// Lessons/pages own metadata/title. Children have separate identities and revisions.
		const canonical =
			node.kind === "lesson" || node.kind === "page"
				? serializeIdentity({
						...own,
						...(node.kind === "lesson"
							? {
									metadata: node.children
										.filter((n) => n.kind === "frontmatter")
										.map((n) => subtree(n, node).own),
								}
							: {}),
					})
				: revisionContent;
		output.push({
			file: document.path,
			path,
			parentPath,
			kind:
				node.kind === "lesson" || node.kind === "page"
					? node.kind
					: [
								"item",
								"back",
								"part",
								"option",
								"task",
								"pair",
								"step",
								"turn",
								"spot",
								"list-entry",
								"recovery",
							].includes(node.kind)
						? "part"
						: "block",
			type: node.type ?? node.kind,
			order: path.at(-1) ?? 0,
			canonical,
			matchText: normalizeText(matchText(full)),
			label: normalizeText(String(node.subject?.value ?? node.text?.value ?? node.name ?? "")),
			span: { ...node.span },
			valid: node.status === "resolved" && !document.tree.refused && !hasUnresolved(full),
			revisionContent,
		});
		node.children.forEach((child, index) => {
			paths.set(child, [...path, index]);
			if (child.kind !== "frontmatter") visit(child, [...path, index], path, node);
		});
		if (node.kind === "body" && parentPath) {
			let owner = document.tree.root;
			for (const index of parentPath) owner = owner.children[index];
			if (owner.type === "fill-blank") {
				const style = owner.settings.find((s) => s.name === "style")?.value.value;
				let index = node.children.length;
				// G6 shields code, variables, glossary and other inline syntax from blanks.
				for (const token of tokenizeInline(node.raw).children) {
					if (token.kind !== "text") continue;
					let offset = token.start;
					for (const part of fillBlankParts(token.raw)) {
						if (part.blank) {
							const descriptor = serializeIdentity({
								kind: "blank",
								answers: parseFillBlankContent(part.text, style),
							});
							output.push({
								file: document.path,
								path: [...path, index],
								parentPath: path,
								kind: "part",
								type: "blank",
								order: index++,
								canonical: descriptor,
								matchText: normalizeText(part.text),
								label: "",
								span: {
									...node.span,
									start: node.span.start + offset,
									end: node.span.start + offset + part.text.length,
								},
								valid: node.status === "resolved",
								revisionContent: descriptor,
							});
						}
						offset += part.text.length;
					}
				}
			}
		}
	};
	visit(document.tree.root, [], null);
	if (
		options.readerRoles ??
		options.priorSnapshots?.some((snapshot) =>
			Object.values(snapshot.nodes).some((node) => node.type.startsWith("reader-role:")),
		)
	) {
		const roles: { node: Readonly<TreeNode>; role: string; id: string }[] = [];
		const { data } = readTreeFrontmatter(document.tree);
		const adapted = toBlocks(document.tree, {
			variables: data.variables as Record<string, unknown> | undefined,
			ids: (node, role) => {
				const id = `descriptor-${roles.length}-${paths.get(node)?.join("/") ?? "metadata"}-${role ?? "node"}`;
				if (role) roles.push({ node, role, id });
				return id;
			},
		});
		const rendered = new Map<string, Record<string, unknown>>();
		const collect = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			const record = value as Record<string, unknown>;
			if (typeof record.id === "string" && typeof record.type === "string" && record.data)
				rendered.set(
					record.id,
					withoutInlineProjectionMetadata(record.data as Record<string, unknown>, {
						keepDisplay: true,
					}),
				);
			for (const [key, child] of Object.entries(value))
				if (!isInlineProjectionMetadataKey(key, { keepDisplay: true })) collect(child);
		};
		collect(adapted.blocks);
		for (const { node, role, id } of roles) {
			const readerOwnerPath = paths.get(node) ?? [];
			const ownerPath = node.kind === "frontmatter" ? [] : readerOwnerPath;
			const owner = output.find(
				(descriptor) => serializeIdentity(descriptor.path) === serializeIdentity(ownerPath),
			);
			if (!owner) throw new Error("Identity: reader role owner missing");
			if (role.startsWith("blank:")) {
				const blank = output
					.filter(
						(descriptor) =>
							descriptor.type === "blank" &&
							descriptor.span.start >= node.span.start &&
							descriptor.span.end <= node.span.end,
					)
					.sort((a, b) => a.span.start - b.span.start)[Number(role.slice(6))];
				if (!blank) throw new Error("Identity: reader blank descriptor missing");
				blank.readerRole = role;
				blank.readerOwnerPath = [...ownerPath];
				continue;
			}
			// Offsets and fragment ordinals locate projections; their content matches identity.
			const type = `reader-role:${role.replace(/^(prose|fence):.*$/u, "$1")}`;
			const content =
				role === "flow"
					? { role, owner: owner.canonical }
					: role === "answer"
						? inline(node.answer?.raw ?? "")
						: role === "title" || role === "stem"
							? inline(node.subject?.raw ?? "")
							: /^(prose|fence):/u.test(role) || role.startsWith("variable:")
								? rendered.get(id)
								: { role };
			const canonical = serializeIdentity({ type, content });
			const range = adapted.nodes.get(id)?.range ?? node.span;
			const index =
				Math.max(
					node.children.length - 1,
					...output
						.filter(
							(descriptor) =>
								serializeIdentity(descriptor.parentPath) === serializeIdentity(ownerPath),
						)
						.map((descriptor) => descriptor.order),
				) + 1;
			output.push({
				file: document.path,
				path: [...ownerPath, index],
				parentPath: [...ownerPath],
				kind: "part",
				type,
				order: index,
				canonical,
				matchText: role === "flow" ? owner.matchText : normalizeText(matchText(content)),
				label: role,
				span: { ...node.span, start: range.start, end: range.end },
				valid: owner.valid,
				revisionContent: canonical,
				readerRole: role,
				readerOwnerPath: [...readerOwnerPath],
			});
		}
	}
	return output;
}
/** Shared tokenization for lexical similarity and the split/merge guard. */
export const lexicalTokens = (text: string): string[] =>
	normalizeText(text)
		.toLowerCase()
		.match(/[\p{L}\p{N}]+/gu) ?? [];
function dice(a: string[], b: string[]): number {
	if (a.length + b.length === 0) return 1;
	const counts = new Map<string, number>();
	for (const value of a) counts.set(value, (counts.get(value) ?? 0) + 1);
	let shared = 0;
	for (const value of b) {
		const count = counts.get(value) ?? 0;
		if (count) {
			shared++;
			counts.set(value, count - 1);
		}
	}
	return (2 * shared) / (a.length + b.length);
}
/** L uses multiset token counts and Unicode scalar trigrams. */
export function lexicalScore(a: string, b: string): number {
	const x = normalizeText(a).toLowerCase();
	const y = normalizeText(b).toLowerCase();
	const trigrams = (text: string) => {
		const chars = Array.from(text);
		return chars.length < 3
			? [text]
			: chars.slice(0, -2).map((_, i) => chars.slice(i, i + 3).join(""));
	};
	return 0.5 * dice(lexicalTokens(x), lexicalTokens(y)) + 0.5 * dice(trigrams(x), trigrams(y));
}
