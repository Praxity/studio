export { findBlockElement } from "./block-element.ts";
export { computeBlockFields } from "./computed-fields.ts";
export { type DomLogicRuntime, initDomLogicRuntime } from "./dom-logic-runtime.ts";
export {
	applyCompoundOperation,
	type CompoundOperation,
	compareValues,
	type DataProvider,
	evaluateConditions,
	evaluateRule,
	isCompoundOperation,
	type LogicAction,
	type LogicConditions,
	type LogicRule,
	type NormalizedAction,
	normalizeAction,
	resolveOperand,
	resolveSourceValue,
} from "./evaluate.ts";
export {
	flattenLogicBlocks,
	type LogicBlockLike,
	type ScopedLogicBlock,
} from "./flatten-blocks.ts";
export type { LearnerMetric, LearnerScope } from "./learner-tracker.ts";
export { LearnerTracker } from "./learner-tracker.ts";
export { LogicEngine } from "./logic-engine.ts";
export { MentionResolver } from "./mention-resolver.ts";
export type { VariableDefinition } from "./variable-store.ts";
export { VariableStore } from "./variable-store.ts";
