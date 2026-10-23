import { normalizeHeadingLevel } from "../heading-styles";
import type { PraxityBlock } from "../types";
import { flattenLogicBlocks } from "./flatten-blocks";

export interface VisibilityBlock {
	id: string;
	type: string;
	name?: string;
	data?: Record<string, unknown>;
	logicScope?: string;
}

export function initiallyHiddenBlockIds(blocks: readonly PraxityBlock[]): Set<string> {
	const hidden = new Set<string>();
	const hiddenHeadingLevels = new Map<string, number>();
	for (const block of flattenLogicBlocks(blocks)) {
		let hiddenHeadingLevel = hiddenHeadingLevels.get(block.logicScope) ?? null;
		const data =
			block.data && typeof block.data === "object" && !Array.isArray(block.data) ? block.data : {};
		const headingLevel =
			block.type === "heading"
				? normalizeHeadingLevel(typeof data.level === "number" ? data.level : 2, 2)
				: null;
		if (
			hiddenHeadingLevel !== null &&
			headingLevel !== null &&
			headingLevel <= hiddenHeadingLevel
		) {
			hiddenHeadingLevel = null;
			hiddenHeadingLevels.delete(block.logicScope);
		}
		const metadata = block.type === "logic" || block.type === "variable";
		const conditional = typeof data.visible === "string" && data.visible.trim().length > 0;
		const authoredHidden = block.visible === false || data.hide === true || data.hidden === true;
		if ((conditional || authoredHidden) && headingLevel !== null) {
			hiddenHeadingLevel = headingLevel;
			hiddenHeadingLevels.set(block.logicScope, headingLevel);
		}
		if (metadata || conditional || authoredHidden || hiddenHeadingLevel !== null)
			hidden.add(block.id);
	}
	return hidden;
}

export function resolveBlockRef(blocks: readonly VisibilityBlock[], ref: string): string {
	const normalized = ref.startsWith("@") ? ref.slice(1) : ref;
	return (
		blocks.find(
			(block) =>
				block.id === normalized || block.name === normalized || block.data?.name === normalized,
		)?.id ?? normalized
	);
}

export function resolveBlockTargetIds(blocks: readonly VisibilityBlock[], ref: string): string[] {
	const targetId = resolveBlockRef(blocks, ref);
	const targetIndex = blocks.findIndex((block) => block.id === targetId);
	if (targetIndex < 0 || blocks[targetIndex].type !== "heading") return [targetId];
	const rawLevel = Number(blocks[targetIndex].data?.level ?? 2);
	const level = Number.isFinite(rawLevel) ? rawLevel : 2;
	const scope = blocks[targetIndex].logicScope ?? "root";
	const ids = [targetId];
	for (let index = targetIndex + 1; index < blocks.length; index++) {
		const block = blocks[index];
		const blockScope = block.logicScope ?? "root";
		const sameScope = blockScope === scope;
		if (!sameScope && !blockScope.startsWith(`${scope}/`)) break;
		if (sameScope && block.type === "heading") {
			const rawNextLevel = Number(block.data?.level ?? 2);
			const nextLevel = Number.isFinite(rawNextLevel) ? rawNextLevel : 2;
			if (nextLevel <= level) break;
		}
		ids.push(block.id);
	}
	return ids;
}
