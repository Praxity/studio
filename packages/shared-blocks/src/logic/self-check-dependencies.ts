import {
	isCompoundOperation,
	type LogicAction,
	type LogicConditions,
	normalizeAction,
} from "./evaluate";
import { resolveBlockRef, type VisibilityBlock } from "./visibility";

export interface DependencyRule {
	conditions: LogicConditions;
	actions: LogicAction[];
}

/** Follow variable writers and compound operands, including originating inputs when queried. */
export function selfCheckDependencies(
	blocks: readonly VisibilityBlock[],
	rules: readonly DependencyRule[],
	rule: DependencyRule,
	includeBlockIds?: ReadonlySet<string>,
): string[] {
	const ids = new Set<string>(),
		variables = new Set<string>();
	const source = (reference: string) => {
		if (reference.startsWith("block:")) {
			const id = resolveBlockRef(blocks, reference.slice(6));
			if (
				includeBlockIds?.has(id) ||
				blocks.some((block) => block.id === id && block.type === "selfCheck")
			)
				ids.add(id);
		} else if (reference.startsWith("variable:")) {
			const name = reference.slice(9);
			if (variables.has(name)) return;
			variables.add(name);
			for (const writer of rules)
				if (
					writer.actions?.some((raw) => {
						const action = normalizeAction(raw);
						return action?.type === "setVariable" && action.targets.includes(name);
					})
				)
					visit(writer);
		}
	};
	const visit = (entry: DependencyRule) => {
		for (const condition of entry.conditions?.rules ?? []) source(condition.source);
		for (const action of entry.actions ?? [])
			if (
				action.value !== undefined &&
				isCompoundOperation(action.value) &&
				typeof action.value.operand === "object"
			)
				source(action.value.operand.ref);
	};
	visit(rule);
	return [...ids];
}
