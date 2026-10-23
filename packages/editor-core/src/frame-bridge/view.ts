import type { readLesson } from "@praxity/grammar";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import type { TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";
import { canEscape } from "../session/controller";
import { nodeNames } from "../session/names";
import type { Session } from "../session/types";
import type { FrameFocus, FrameNode, FrameView } from "./protocol";

type Translate = (key: string, params?: Record<string, string | number>) => string;
type ViewOptions = {
	lesson: ReturnType<typeof readLesson>;
	file: string;
	pageId: string;
	session: Session;
	translate: Translate;
	alwaysShowHandles?: boolean;
	suggestions?: ReadonlyMap<string, number>;
};

/** Pure page-node projection: identity from readLesson/I4, names from A3, state from U1/U2. */
export function buildPageNodes(options: ViewOptions): FrameNode[] {
	return projectPageNodes(options).nodes;
}

function projectPageNodes(options: ViewOptions) {
	const { lesson, file, pageId, session, translate } = options;
	const names = nodeNames(lesson.tree.root, translate);
	const records = new Map(
		[...lesson.nodes.values()].filter((r) => !r.role).map((r) => [r.node, r]),
	);
	const page = [...records.values()].find((r) => r.id === pageId && r.node.kind === "page");
	if (!page) throw new Error(`Frame page is absent from lesson: ${pageId}`);
	const nodes: FrameNode[] = [];
	const positions = new Map<string, { pos: number; total: number }>();
	const itemKinds = new Set([
		"item",
		"back",
		"option",
		"task",
		"pair",
		"step",
		"turn",
		"spot",
		"list-entry",
	]);
	const omitted = new Set(["frontmatter", "part", "list"]);
	const visit = (node: TreeNode, parentId: string | null, pos: number, total: number) => {
		const record = records.get(node);
		let owner = parentId;
		if (record && !omitted.has(node.kind)) {
			owner = record.id;
			positions.set(record.id, { pos, total });
			const states: string[] = [];
			if (session.selected.includes(record.id))
				states.push(translate("canvas.handle.state.selected"));
			const draft = Object.values(session.drafts).find(
				(d) => d.file === file && d.target.kind === "node" && d.target.nodeId === record.id,
			);
			if (draft) {
				if (["dirty", "invalid"].includes(draft.status))
					states.push(translate("canvas.handle.state.unsavedDraft"));
				if (["held", "orphaned"].includes(draft.status))
					states.push(translate("canvas.handle.state.held"));
				if (draft.status === "conflict") states.push(translate("canvas.handle.state.conflict"));
			}
			const count = options.suggestions?.get(record.id) ?? 0;
			if (count > 0) states.push(translate("canvas.handle.state.suggestions", { n: count }));
			const name = names.get(node);
			if (!name) throw new Error(`Frame node has no A3 name: ${record.id}`);
			nodes.push({
				id: record.id,
				kind: node.kind === "page" ? "page" : itemKinds.has(node.kind) ? "item" : "block",
				parentId,
				name,
				description: translate("canvas.handle.description", {
					pos,
					total,
					states: states.join(" "),
				}).trim(),
			});
		}
		const siblings = node.children.filter(
			(child) => records.has(child) && !omitted.has(child.kind),
		);
		node.children.forEach((child) =>
			visit(child, owner, siblings.indexOf(child) + 1, siblings.length),
		);
	};
	visit(page.node, null, 1, 1);
	return { nodes, positions };
}

/** Host presentation uses the same page-node projection as lesson dispatch. */
export function buildFrameView(options: ViewOptions): FrameView {
	const { file, pageId, session } = options;
	const { nodes, positions } = projectPageNodes(options);
	const visibleIds = new Set(nodes.map((node) => node.id));
	const focus = session.focus;
	const draft = session.activeDraft ? session.drafts[session.activeDraft] : undefined;
	const sourceId =
		draft &&
		(session.draftDisplayIds[draft.id] ??
			(draft.target.kind === "node" ? draft.target.nodeId : undefined));
	const sourceNode = nodes.find((node) => node.id === sourceId);
	const sourceRecord = sourceId ? options.lesson.nodes.get(sourceId) : undefined;
	// The context already carries the view's position, so omit the name's duplicate suffix.
	const contextName =
		sourceRecord &&
		nodeNames(options.lesson.tree.root, options.translate, { positions: false }).get(
			sourceRecord.node,
		);
	const labelKey = sourceRecord?.node.type
		? getDefinition(sourceRecord.node.type)?.labelKey
		: undefined;
	const sourceName = labelKey
		? options.translate(`session.labels.${labelKey.replaceAll(".", "_")}`)
		: (contextName ?? sourceNode?.name);
	const sourcePosition = sourceId ? positions.get(sourceId) : undefined;
	const parentName = nodes.find((node) => node.id === sourceNode?.parentId)?.name;
	return {
		file,
		pageId,
		language: session.interfaceLanguage,
		escapeEnabled: canEscape(session),
		nodes,
		alwaysShowHandles: options.alwaysShowHandles ?? false,
		platform: session.platform,
		selected: session.selected.filter((id) => visibleIds.has(id)),
		expanded: session.layers
			.filter((layer) => layer.kind === "popup" && layer.popup === "actions")
			.flatMap((layer) => {
				if (layer.kind !== "popup" || layer.target.target.ref.kind !== "node") return [];
				const id = layer.target.target.ref.nodeId;
				return id && visibleIds.has(id) ? [id] : [];
			}),
		focus:
			focus &&
			focus.file === file &&
			focus.nodeId &&
			visibleIds.has(focus.nodeId) &&
			(focus.role === "handle" || focus.role === "source" || focus.role.startsWith("chip:"))
				? {
						file: focus.file,
						nodeId: focus.nodeId,
						role: focus.role as FrameFocus["role"],
						...(focus.selection ? { selection: focus.selection } : {}),
					}
				: null,
		...(draft && draft.file === file && draft.scope !== "file" && sourceNode && sourceName
			? {
					source: {
						draftId: draft.id,
						nodeId: sourceNode.id,
						value: draft.text,
						baseText: draft.baseText,
						invalid: draft.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
						...(draft.diagnostics.length
							? {
									diagnostic: draft.diagnostics
										.map((d) =>
											options.translate("sourceField.diagnostic", {
												n: d.message.params.line ?? 1,
												message: options.translate(d.message.key, d.message.params),
											}),
										)
										.join("\n"),
								}
							: {}),
						name: options.translate("sourceField.name", { name: sourceName }),
						caption: options.translate("sourceField.caption"),
						description: options.translate("sourceField.description", {
							hasName: sourceName === contextName ? "no" : "yes",
							name: contextName ?? sourceNode.name,
							position: options
								.translate("canvas.handle.description", {
									...sourcePosition,
									states: "",
								})
								.trim(),
							hasParent: parentName === undefined ? "no" : "yes",
							parent: parentName ?? "",
						}),
						closer: !!sourceRecord?.node.closer,
					},
				}
			: {}),
	};
}
