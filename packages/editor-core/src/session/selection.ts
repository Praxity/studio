import type { IdentityMapping, OperationTarget } from "@praxity/grammar/src/operations/contract.ts";
import { announcement } from "./announcements";
import type {
	Dependencies,
	Focus,
	Message,
	SelectionNode,
	SelectionSnapshot,
	Session,
} from "./types";

export const emptySelection = () => ({
	anchor: null,
	focus: null,
	extended: false,
	allScope: null,
});
export const selectionSnapshot = (state: Session): SelectionSnapshot => ({
	selected: [...state.selected],
	selection: structuredClone(state.selection),
	focus: structuredClone(state.focus),
});
export const selectionOperations = new Set([
	"moveBlocks",
	"deleteBlocks",
	"duplicateBlocks",
	"turnInto",
	"wrapIn",
	"wrapInColumns",
	"cutBlocks",
	"copy",
]);
export const singleNodeOperations = new Set([
	"setProperty",
	"setText",
	"addItem",
	"removeItem",
	"moveItem",
]);
/** Handle commands name the action; selection owns which schema operation applies. */
export function selectionOperationName(
	state: Session,
	operation: string,
	deps: Dependencies,
): string {
	const kind = selectionNodes(deps).find((n) => n.id === state.selected[0])?.kind;
	if (operation === "moveBlocks")
		return kind === "page" ? "movePage" : kind === "item" ? "moveItem" : operation;
	if (operation === "deleteBlocks")
		return kind === "page"
			? "deletePage"
			: kind === "item" && state.selected.length === 1
				? "removeItem"
				: operation;
	return operation;
}
export function selectionNodes(deps: Dependencies): readonly SelectionNode[] {
	if (!deps.selectionNodes) throw new Error("Selection commands require selectionNodes");
	const nodes = deps.selectionNodes();
	const ids = new Set(nodes.map((n) => n.id));
	if (ids.size !== nodes.length) throw new Error("Duplicate selection node ID");
	for (const node of nodes) {
		const seen = new Set([node.id]);
		let parent = node.parentId;
		while (parent !== null) {
			if (seen.has(parent)) throw new Error("Cyclic selection tree");
			seen.add(parent);
			const owner = nodes.find((n) => n.id === parent);
			if (!owner) throw new Error("Missing selection parent");
			parent = owner.parentId;
		}
	}
	return nodes;
}
export function ancestors(id: string, nodes: readonly SelectionNode[]): string[] {
	const result: string[] = [];
	let parent = nodes.find((n) => n.id === id)?.parentId;
	while (parent) {
		result.push(parent);
		parent = nodes.find((n) => n.id === parent)?.parentId;
	}
	return result;
}
export function orderedSelection(
	ids: readonly string[],
	nodes: readonly SelectionNode[],
): string[] {
	const set = new Set(ids);
	return nodes
		.filter((n) => set.has(n.id) && !ancestors(n.id, nodes).some((id) => set.has(id)))
		.map((n) => n.id);
}
export function collapseSelection(state: Session, target: Focus) {
	state.selected = target.nodeId ? [target.nodeId] : [];
	state.selection = { ...emptySelection(), anchor: target.nodeId, focus: target.nodeId };
}
export function selectionCount(state: Session, deps: Dependencies, event = "selected"): Message {
	return announcement(event, {
		n: state.selected.length,
		kind: deps.selectionNodes?.().find((n) => n.id === state.selected[0])?.kind ?? "block",
	});
}
function nodeFocus(node: SelectionNode, role: Focus["role"]): Focus {
	return { file: node.file, nodeId: node.id, role };
}
export function selectNode(
	state: Session,
	target: Focus,
	mode: "range" | "toggle" | undefined,
	deps: Dependencies,
): Message | null {
	if (!deps.selectionNodes) {
		if (mode) throw new Error("Selection extension requires selectionNodes");
		collapseSelection(state, target);
		return null;
	}
	const nodes = selectionNodes(deps);
	const node = nodes.find((n) => n.id === target.nodeId);
	if (!node || (node.kind === "page" && target.role !== "outline")) return null;
	const before = [...state.selected];
	const kind = nodes.find((n) => n.id === state.selected[0])?.kind;
	if (!mode || (kind && kind !== node.kind)) {
		collapseSelection(state, target);
		return before.length > 1
			? announcement("selectionCleared")
			: before.length !== 1 || before[0] !== node.id
				? selectionCount(state, deps)
				: null;
	}
	const ancestor = ancestors(node.id, nodes).find((id) => state.selected.includes(id));
	if (ancestor)
		return announcement("alreadySelected", {
			ancestorName: deps.nameOfFocus(
				nodeFocus(nodes.find((n) => n.id === ancestor) as SelectionNode, target.role),
			),
		});
	state.selection.extended = true;
	state.selection.allScope = null;
	state.selection.focus = node.id;
	if (mode === "toggle") {
		state.selection.anchor = node.id;
		const removed = state.selected.includes(node.id);
		state.selected = orderedSelection(
			removed ? state.selected.filter((id) => id !== node.id) : [...state.selected, node.id],
			nodes,
		);
		return announcement(removed ? "selectionRemoved" : "selected", {
			n: state.selected.length,
			kind: node.kind,
		});
	}
	const anchor = nodes.find((n) => n.id === state.selection.anchor);
	if (!anchor) {
		state.selection.anchor = node.id;
		state.selected = [node.id];
	} else state.selected = range(anchor, node, nodes);
	return selectionCount(state, deps);
}
function range(
	anchor: SelectionNode,
	target: SelectionNode,
	nodes: readonly SelectionNode[],
): string[] {
	if (anchor.lessonId !== target.lessonId) throw new Error("Selection cannot cross lessons");
	const chain = [anchor.id, ...ancestors(anchor.id, nodes)];
	const other = [target.id, ...ancestors(target.id, nodes)];
	const common = chain.find((id) => other.includes(id));
	if (common === anchor.id || common === target.id) return [common];
	// Pages are structural owners. A block range across pages contains their top-level blocks.
	if (!common && anchor.kind === "block") {
		const top = nodes.filter(
			(n) => n.kind === "block" && n.lessonId === anchor.lessonId && n.parentId === n.pageId,
		);
		const lift = (node: SelectionNode) =>
			[node.id, ...ancestors(node.id, nodes)].find((id) => top.some((n) => n.id === id));
		const a = top.findIndex((n) => n.id === lift(anchor));
		const b = top.findIndex((n) => n.id === lift(target));
		return top.slice(Math.min(a, b), Math.max(a, b) + 1).map((n) => n.id);
	}
	const siblings = nodes.filter(
		(n) => n.parentId === (common ?? null) && n.lessonId === anchor.lessonId,
	);
	const lift = (chain: string[]) => chain.find((id) => siblings.some((n) => n.id === id));
	const a = siblings.findIndex((n) => n.id === lift(chain));
	const b = siblings.findIndex((n) => n.id === lift(other));
	return siblings.slice(Math.min(a, b), Math.max(a, b) + 1).map((n) => n.id);
}
export function selectionKey(
	state: Session,
	key: "previous" | "next" | "start" | "end" | "toggle" | "membership" | "all" | "clear" | "level",
	deps: Dependencies,
	extend = true,
): { message: Message | null; target?: Focus } {
	const focused = state.focus;
	if (!focused || (focused.role !== "handle" && focused.role !== "outline") || state.activeDraft)
		return { message: null };
	if (key === "clear") {
		const changed = state.selection.extended || state.selected.length > 1;
		collapseSelection(state, focused);
		return { message: changed ? announcement("selectionCleared") : null };
	}
	const nodes = selectionNodes(deps);
	const node = nodes.find((n) => n.id === focused.nodeId);
	const plainHandles =
		focused.role === "handle" && !extend && ["previous", "next", "start", "end"].includes(key);
	if (!node || (node.kind === "page" && focused.role !== "outline" && !plainHandles))
		return { message: null };
	if (key === "toggle" || key === "membership") {
		if (
			key === "toggle" &&
			!state.selection.extended &&
			state.selected.length === 1 &&
			state.selected[0] === node.id
		) {
			state.selection.extended = true;
			state.selection.allScope = null;
			return { message: announcement("selectionPinned", { name: deps.nameOfFocus(focused) }) };
		}
		return { message: selectNode(state, focused, "toggle", deps) };
	}
	const siblings = nodes.filter(
		(n) =>
			n.lessonId === node.lessonId &&
			(plainHandles
				? n.pageId === node.pageId
				: n.parentId === node.parentId && n.kind === node.kind),
	);
	if (key === "all" || key === "level") {
		const page = key === "all" && state.selection.allScope !== null;
		const members = !page
			? siblings
			: nodes.filter(
					(n) =>
						n.kind === "block" &&
						n.parentId === n.pageId &&
						n.lessonId === node.lessonId &&
						n.pageId === node.pageId,
				);
		state.selected = members.map((n) => n.id);
		state.selection = {
			anchor: node.id,
			focus: node.id,
			extended: true,
			allScope: key === "all" ? (page ? "page" : "siblings") : null,
		};
		return { message: selectionCount(state, deps) };
	}
	const index = siblings.findIndex((n) => n.id === node.id);
	const next =
		key === "start"
			? 0
			: key === "end"
				? siblings.length - 1
				: Math.max(0, Math.min(siblings.length - 1, index + (key === "next" ? 1 : -1)));
	if (next === index) return { message: null };
	const target = nodeFocus(siblings[next], focused.role);
	return { message: extend ? selectNode(state, target, "range", deps) : null, target };
}
export function remapSelection(
	state: Session,
	mapping: readonly IdentityMapping[],
	deps: Dependencies,
	copies = false,
) {
	const remap = (id: string | null): string | null => {
		if (!id) return null;
		const entries = mapping.filter((m) => m.oldId === id && (copies || m.fate !== "copied"));
		const entry = copies ? (entries.find((m) => m.fate === "copied") ?? entries[0]) : entries[0];
		return entry
			? entry.fate === "retired" || entry.fate === "cut"
				? null
				: (entry.newId ?? id)
			: id;
	};
	state.selected = [
		...new Set(state.selected.map(remap).filter((id): id is string => id !== null)),
	];
	state.selection.anchor = remap(state.selection.anchor);
	state.selection.focus = remap(state.selection.focus);
	if (deps.selectionNodes) {
		const nodes = selectionNodes(deps);
		state.selected = orderedSelection(state.selected, nodes);
		if (!nodes.some((n) => n.id === state.selection.anchor))
			state.selection.anchor = state.selected[0] ?? null;
		if (!nodes.some((n) => n.id === state.selection.focus))
			state.selection.focus = state.selected.at(-1) ?? null;
	}
}
export function selectionTargets(
	state: Session,
	deps: Dependencies,
): (OperationTarget & { expectedText: string })[] {
	const nodes = selectionNodes(deps);
	return orderedSelection(state.selected, nodes).map((id) => {
		const node = nodes.find((n) => n.id === id) as SelectionNode;
		const seed = deps.readDraft(nodeFocus(node, "handle"));
		if (seed.target.kind !== "node" || seed.target.nodeId !== id || seed.file !== node.file)
			throw new Error("Selection target identity mismatch");
		return { file: seed.file, ref: seed.target, expectedText: seed.expectedText };
	});
}
export function selectionReason(
	state: Session,
	operation: string,
	args: Record<string, unknown>,
	deps: Dependencies,
): Message | null {
	if (!state.selected.length) return { key: "session.reasons.emptySelection", params: {} };
	const directionalMove =
		["moveBlocks", "movePage", "moveItem"].includes(operation) &&
		(args.direction === "up" || args.direction === "down");
	if (directionalMove || operation === "wrapIn" || operation === "wrapInColumns") {
		const nodes = selectionNodes(deps);
		const members = nodes.filter((n) => state.selected.includes(n.id));
		if (
			directionalMove &&
			members[0]?.kind !== "page" &&
			new Set(members.map((n) => n.pageId)).size > 1
		)
			return { key: "session.reasons.crossPageMove", params: {} };
		const siblings = nodes.filter(
			(n) => n.parentId === members[0]?.parentId && n.lessonId === members[0]?.lessonId,
		);
		const indices = members.map((n) => siblings.findIndex((s) => s.id === n.id));
		if (
			members.some(
				(n) => n.parentId !== members[0]?.parentId || n.lessonId !== members[0]?.lessonId,
			) ||
			indices.some((n, i) => i > 0 && n !== indices[i - 1] + 1)
		)
			return {
				key: directionalMove
					? "session.reasons.neighbourMove"
					: "session.reasons.adjacentSelection",
				params: {},
			};
	}
	if (operation !== "copy" && operation !== "copyReference") {
		const nodes = selectionNodes(deps);
		const draft = Object.values(state.drafts).find(
			(d) =>
				d.target.kind === "node" &&
				d.target.nodeId &&
				(state.selected.includes(d.target.nodeId) ||
					ancestors(d.target.nodeId, nodes).some((id) => state.selected.includes(id))),
		);
		if (draft)
			return {
				key: "session.reasons.selectionDraft",
				params: {
					name: deps.nameOfFocus({
						file: draft.file,
						nodeId: draft.target.kind === "node" ? draft.target.nodeId : null,
						role: "handle",
					}),
				},
			};
	}
	return deps.selectionAllowed?.(operation, selectionTargets(state, deps), args) ?? null;
}
export function selectionView(state: Session, deps: Dependencies) {
	const nodes = selectionNodes(deps);
	const suggestions = (deps.reviewSuggestions?.() ?? []).filter(
		(s) =>
			state.selected.includes(s.nodeId) ||
			ancestors(s.nodeId, nodes).some((id) => state.selected.includes(id)),
	);
	const actions = Object.fromEntries(
		[
			"moveUp",
			"moveDown",
			"moveTo",
			"deleteBlocks",
			"duplicateBlocks",
			"turnInto",
			"cutBlocks",
			"copy",
			"wrapIn",
			"wrapInColumns",
		].map((action) => {
			const operation = action.startsWith("move") ? "moveBlocks" : action;
			const reason = selectionReason(
				state,
				operation,
				action === "moveUp"
					? { direction: "up" }
					: action === "moveDown"
						? { direction: "down" }
						: {},
				deps,
			);
			return [action, { enabled: reason === null, reason }];
		}),
	);
	return {
		count: state.selected.length,
		label: deps.translate(selectionCount(state, deps)),
		dragLabel: deps.translate({
			key: "session.selection.dragLabel",
			params: {
				n: state.selected.length,
				kind: nodes.find((n) => n.id === state.selected[0])?.kind ?? "block",
			},
		}),
		members: Object.fromEntries(
			nodes.map((n) => [
				n.id,
				{
					selected: state.selected.includes(n.id),
					description: state.selected.includes(n.id)
						? deps.translate({ key: "session.selection.description", params: {} })
						: "",
				},
			]),
		),
		suggestions,
		actions,
	};
}
