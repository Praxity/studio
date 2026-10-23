import { learnerRuntime, withLearnerStateAuthority } from "../learner-block-state";
import {
	createSelfCheckMutationObserver,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckConsumers,
	selfCheckEpochTicket,
} from "../self-check-consumers";
import { afterSelfCheckFinalization } from "../self-check-finalization";
import type { SelfCheckTicket } from "../self-check-session";
import { createCompletionEffects } from "../viewer/completion-effects";
import {
	clearRequiredValidation,
	getActiveRequiredValidationBlock,
	isRequiredBlockComplete,
} from "../viewer/required-blocks.ts";
import type { CompoundOperation, LogicAction, LogicConditions, LogicRule } from "./evaluate.ts";
import { flattenLogicBlocks } from "./flatten-blocks.ts";
import { LearnerTracker } from "./learner-tracker.ts";
import { LogicEngine } from "./logic-engine.ts";
import { MentionResolver } from "./mention-resolver.ts";
import type { VariableDefinition } from "./variable-store.ts";
import { VariableStore } from "./variable-store.ts";
import { resolveBlockRef } from "./visibility";

interface RuntimeLike {
	getSuspendData: () => string | null;
	setSuspendData: (data: string) => void;
	commit: () => void;
	getValue?: (key: string) => string | null;
}

interface PageBlock {
	id: string;
	type: string;
	name?: string;
	visible?: boolean;
	data: Record<string, unknown>;
	logicScope?: string;
}

interface RuleConfig {
	blockId: string;
	conditions: LogicConditions;
	actions: LogicAction[];
}

interface VisibilityConfig {
	blockId: string;
	conditions: LogicConditions;
}

interface NormalizedConfig {
	currentPage: number;
	blocks: PageBlock[];
	pageId: string;
	courseId: string;
	pageIdMap: Record<string, string>;
	logic: {
		rules: RuleConfig[];
		variables: VariableDefinition[];
		visibility: VisibilityConfig[];
		dependencyRules: RuleConfig[];
	};
}

interface RuntimeState {
	engine: LogicEngine;
	mentions: MentionResolver;
	variables: VariableStore;
	learner: LearnerTracker;
}

export interface DomLogicRuntime {
	evaluate: () => void;
	getJumpTarget: () => string | null;
	isCompletionBlocked: () => boolean;
	getCompletionReasons: () => string[];
	destroy: () => void;
}

type LogicWindow = Window & {
	__praxityLogicEngine?: {
		evaluate: () => void;
		getJumpTarget: () => string | null;
		isCompletionBlocked: () => boolean;
		getCompletionReasons: () => string[];
	};
	__praxityPageIdMap?: Record<string, string>;
};

let activeRuntime: DomLogicRuntime | undefined;
let activeInput: unknown;

/** Initialize page-scoped logic without loading the React viewer. */
export function initDomLogicRuntime(rawConfig: unknown): DomLogicRuntime | null {
	if (activeRuntime && activeInput === rawConfig) return activeRuntime;
	activeRuntime?.destroy();
	if (typeof window === "undefined" || typeof document === "undefined") return null;

	const config = normalizeConfig(rawConfig);
	if (!config) return null;

	const logicWindow = window as LogicWindow;
	const fallbackRuntime = createLocalRuntime(config.courseId);
	let destroyed = false;
	// Non-dependency writes are synchronous behind gated entries; deferred writes need per-admission state.
	const synchronous = () => !destroyed;
	const hostRuntime = logicRuntime(learnerRuntime(synchronous));
	let hasHostRuntime = !!hostRuntime;
	let currentRuntime: RuntimeLike = hostRuntime ?? fallbackRuntime;
	const hasDependencies = document.documentElement.hasAttribute("data-self-check-dependencies");
	let state = hasDependencies ? undefined : createState(config, currentRuntime);
	let epoch: number | undefined, ticket: SelfCheckTicket | undefined;
	let visited = false;
	const blockElements = collectBlockElements(config.blocks);
	const completionEffects = hasDependencies
		? undefined
		: createCompletionEffects(config.currentPage);
	const previousLogicEngine = logicWindow.__praxityLogicEngine;
	const previousPageIdMap = logicWindow.__praxityPageIdMap;
	let pendingFrame: number | undefined;
	let pendingOrigins = new Set<string>();
	let pendingRequiredBlock: HTMLElement | null | undefined;
	let interactionEpoch = 0;
	const cancelInteraction = () => {
		++interactionEpoch;
		if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
		pendingFrame = undefined;
		pendingOrigins.clear();
		pendingRequiredBlock = undefined;
	};
	let releaseEffects: (() => void) | undefined;
	let releaseTracking: (() => void) | undefined;
	const current = () => !destroyed && (!hasDependencies || ticket?.current() === true);
	const apply = (
		origin: "initial" | "restore" | "interaction" | "hydrate",
		interactionBlocks?: ReadonlySet<string>,
	) => {
		const pass = ticket,
			applying = state;
		const owned = () => !destroyed && (!hasDependencies || pass?.current() === true);
		if (!owned() || !applying) return;
		if (origin === "hydrate") applying.engine.refreshVisibility(owned);
		else applying.engine.evaluate(origin, owned, interactionBlocks);
		if (!owned()) return;
		if (hasDependencies)
			selfCheckConsumers()?.presentLogicGate(
				applying.engine.isCompletionBlocked(),
				applying.engine.getCompletionReasons(),
			);
		else
			completionEffects?.sync(
				applying.engine.isCompletionBlocked(),
				applying.engine.getCompletionReasons(),
			);
		if (!owned()) return;
		applying.mentions.resolve();
		if (owned()) syncVisibility(blockElements, applying.engine.getVisibleBlockIds());
	};
	const evaluate = () => {
		if (hasDependencies) return;
		apply("initial");
	};
	const publicEngine = {
		evaluate,
		getJumpTarget: () => (current() ? (state?.engine.getJumpTarget() ?? null) : null),
		isCompletionBlocked: () => !current() || state?.engine.isCompletionBlocked() === true,
		getCompletionReasons: () => state?.engine.getCompletionReasons() ?? [],
	};
	const onInteraction = (event: Event) => {
		const received = selfCheckEpochTicket(document, event);
		if (!received()) return;
		// The owner runs deliberate Show feedback before finalization; its existing event is publication.
		if (hasDependencies && (event as CustomEvent).detail?.blockType === "selfCheck") return;
		const blockId = (event as CustomEvent).detail?.blockId;
		if (typeof blockId === "string" && blockId) pendingOrigins.add(blockId);
		pendingRequiredBlock = getActiveRequiredValidationBlock();
		if (pendingFrame !== undefined) return;
		const scheduledTicket = ticket;
		const scheduledEpoch = interactionEpoch;
		const owned = () =>
			!destroyed &&
			scheduledEpoch === interactionEpoch &&
			received() &&
			(!hasDependencies || scheduledTicket?.current() === true);
		pendingFrame = requestSelfCheckFrame(() => {
			if (!owned()) return;
			pendingFrame = undefined;
			// Reentrant events belong to a later frame, never this evaluation's origins.
			const origins = pendingOrigins,
				requiredBlock = pendingRequiredBlock;
			pendingOrigins = new Set();
			pendingRequiredBlock = undefined;
			if (hasDependencies && !selfCheckConsumers()?.settled()) return;
			apply("interaction", origins);
			if (
				owned() &&
				requiredBlock &&
				getActiveRequiredValidationBlock() === requiredBlock &&
				(!requiredBlock.isConnected ||
					requiredBlock.closest("[hidden]") ||
					isRequiredBlockComplete(requiredBlock))
			)
				clearRequiredValidation();
		}, owned);
	};
	const onRuntimeReady = () => {
		cancelInteraction();
		// Provider-ready starts admission. Only its session may hydrate learner variables.
		if (hasDependencies) return;
		const nextRuntime = logicRuntime(learnerRuntime(synchronous));
		if (nextRuntime && !hasHostRuntime) {
			hasHostRuntime = true;
			currentRuntime = nextRuntime;
			state?.engine.destroy();
			state = createState(config, currentRuntime);
		} else state?.variables.restoreFromSuspendData();
		evaluate();
	};
	const releaseHydration = observeSelfCheckLifetime((owned) => {
		const observer = createSelfCheckMutationObserver(owned, () => {
			if (!owned() || (hasDependencies && !selfCheckConsumers()?.settled())) return;
			apply("hydrate");
		});
		observer.observe(document.body, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-hydrated"],
		});
		return () => observer.disconnect();
	});
	const revokeInteractions = cancelInteraction;
	const runtime: DomLogicRuntime = {
		...publicEngine,
		destroy: () => {
			if (destroyed) return;
			destroyed = true;
			releaseHydration();
			releaseEffects?.();
			releaseTracking?.();
			cancelInteraction();
			document.removeEventListener("praxity:block-interaction", onInteraction);
			document.removeEventListener("praxity:self-check-owner", revokeInteractions);
			window.removeEventListener("pagehide", revokeInteractions);
			window.removeEventListener("praxity:runtime-ready", onRuntimeReady);
			state?.engine.destroy();
			completionEffects?.destroy();
			if (logicWindow.__praxityLogicEngine === publicEngine)
				logicWindow.__praxityLogicEngine = previousLogicEngine;
			if (logicWindow.__praxityPageIdMap === config.pageIdMap)
				logicWindow.__praxityPageIdMap = previousPageIdMap;
			if (activeRuntime === runtime) {
				activeRuntime = undefined;
				activeInput = undefined;
			}
		},
	};
	logicWindow.__praxityLogicEngine = publicEngine;
	logicWindow.__praxityPageIdMap = config.pageIdMap;
	document.addEventListener("praxity:block-interaction", onInteraction);
	document.addEventListener("praxity:self-check-owner", revokeInteractions);
	window.addEventListener("pagehide", revokeInteractions);
	window.addEventListener("praxity:runtime-ready", onRuntimeReady);
	activeRuntime = runtime;
	activeInput = rawConfig;
	releaseEffects = hasDependencies
		? afterSelfCheckFinalization(
				document,
				(pass, command) => {
					if (destroyed || !pass.current()) return;
					if (ticket && !ticket.current()) cancelInteraction();
					ticket = pass;
					const owner = selfCheckConsumers();
					const present = !!logicRuntime(learnerRuntime(pass.current));
					const initial = !state || epoch !== owner?.epoch() || present !== hasHostRuntime;
					if (initial) {
						cancelInteraction();
						state?.engine.destroy();
						const generation = owner?.epoch();
						// The store spans commands; the FIFO owner revokes the current ticket before reentry.
						const owned = () => current() && selfCheckConsumers()?.epoch() === generation;
						hasHostRuntime = present;
						currentRuntime =
							logicRuntime(learnerRuntime(owned)) ??
							withLearnerStateAuthority(fallbackRuntime, owned);
						const next = createState(config, currentRuntime, true);
						if (!owned()) {
							next.engine.destroy();
							return;
						}
						state = next;
						epoch = generation;
						visited = false;
					}
					apply(
						initial
							? "initial"
							: command?.type === "show-feedback"
								? "interaction"
								: command
									? "restore"
									: "hydrate",
					);
				},
				"effects",
			)
		: undefined;
	if (destroyed) releaseEffects?.();
	releaseTracking =
		hasDependencies && !destroyed
			? afterSelfCheckFinalization(
					document,
					(pass) => {
						if (destroyed || !pass.current() || visited || !state) return;
						visited = true;
						state.learner.recordPageVisit();
					},
					"tracking",
				)
			: undefined;
	if (destroyed) releaseTracking?.();
	if (!hasDependencies && !destroyed) evaluate();
	return runtime;
}

function createState(
	config: NormalizedConfig,
	runtime: RuntimeLike,
	deferredVisit = false,
): RuntimeState {
	const conditionalIds = new Set(
		config.logic.visibility.map((entry) => resolveBlockRef(config.blocks, entry.blockId)),
	);
	const engineBlocks = config.blocks.map((block) =>
		conditionalIds.has(block.id) ? { ...block, visible: false } : block,
	);
	const variables = new VariableStore(config.logic.variables, runtime);
	const learner = new LearnerTracker({ pageId: config.pageId, runtime });
	if (!deferredVisit) learner.recordPageVisit();
	const engine = new LogicEngine(
		variables,
		engineBlocks,
		learner,
		undefined,
		selfCheckConsumers(),
		config.logic.dependencyRules,
	);

	for (const rule of config.logic.rules) engine.registerLogicBlock(rule);
	for (const visibility of config.logic.visibility) {
		engine.registerLogicBlock({
			blockId: `visible:${visibility.blockId}`,
			conditions: visibility.conditions,
			actions: [{ type: "show", target: visibility.blockId }],
		});
	}

	return {
		engine,
		learner,
		mentions: new MentionResolver(variables, engineBlocks, learner),
		variables,
	};
}

function collectBlockElements(blocks: PageBlock[]): Array<{ id: string; element: HTMLElement }> {
	const visibleBlocks = blocks.filter(
		(block) => block.type !== "logic" && block.type !== "variable",
	);
	const ids = new Set(visibleBlocks.map((block) => block.id));
	const found = new Map<string, HTMLElement>();
	for (const selector of [".praxity-block[data-block-id]", "[data-block-id]"])
		for (const element of document.querySelectorAll<HTMLElement>(selector)) {
			const id = element.dataset.blockId;
			if (id && ids.has(id) && !found.has(id)) found.set(id, element);
		}
	return visibleBlocks.flatMap((block) => {
		const element = found.get(block.id);
		return element ? [{ id: block.id, element }] : [];
	});
}

function syncVisibility(
	blocks: Array<{ id: string; element: HTMLElement }>,
	visibleIds: Set<string>,
): void {
	const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	let hiddenFocusIndex = -1;
	let changed = false;
	for (let index = 0; index < blocks.length; index++) {
		const { id, element } = blocks[index];
		const hidden = !visibleIds.has(id);
		if (hidden && active && element.contains(active)) hiddenFocusIndex = index;
		if (element.hidden !== hidden) changed = true;
		element.hidden = hidden;
	}
	for (const section of document.querySelectorAll<HTMLElement>(".praxity-section")) {
		const nextHidden = !Array.from(section.querySelectorAll<HTMLElement>(".praxity-block")).some(
			(block) => isEffectivelyVisible(block, section),
		);
		if (section.hidden !== nextHidden) changed = true;
		section.hidden = nextHidden;
	}
	if (hiddenFocusIndex !== -1) recoverFocus(blocks, hiddenFocusIndex);
	if (changed) document.dispatchEvent(new Event("praxity:visibility-change"));
}

function isEffectivelyVisible(element: HTMLElement, boundary?: HTMLElement): boolean {
	if (element.hidden) return false;
	for (
		let parent = element.parentElement;
		parent && parent !== boundary;
		parent = parent.parentElement
	) {
		if (parent.hidden) return false;
	}
	return true;
}

function recoverFocus(
	blocks: Array<{ id: string; element: HTMLElement }>,
	hiddenIndex: number,
): void {
	let destination: HTMLElement | null = null;
	for (let index = hiddenIndex + 1; index < blocks.length; index++) {
		if (isEffectivelyVisible(blocks[index].element)) {
			destination = blocks[index].element;
			break;
		}
	}
	for (let index = hiddenIndex - 1; !destination && index >= 0; index--) {
		if (isEffectivelyVisible(blocks[index].element)) destination = blocks[index].element;
	}
	destination ??= document.querySelector<HTMLElement>(
		"main, [role='main'], #praxity-root, [data-praxity-root]",
	);
	if (!destination) return;

	const focusTarget =
		Array.from(destination.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).find(
			(heading) => isEffectivelyVisible(heading),
		) ?? destination;
	const temporaryTabIndex = !focusTarget.hasAttribute("tabindex");
	if (temporaryTabIndex) focusTarget.setAttribute("tabindex", "-1");
	try {
		focusTarget.focus({ preventScroll: true });
	} catch {
		focusTarget.focus();
	}
	if (temporaryTabIndex) focusTarget.removeAttribute("tabindex");
}

function createLocalRuntime(courseId: string): RuntimeLike {
	const key = `praxity:logic:${courseId || "standalone"}`;
	let memory = "";
	return {
		getSuspendData: () => {
			try {
				return window.localStorage.getItem(key) ?? (memory || null);
			} catch {
				return memory || null;
			}
		},
		setSuspendData: (data) => {
			memory = data;
			try {
				window.localStorage.setItem(key, data);
			} catch {
				// In-memory state still preserves this page session.
			}
		},
		commit: () => {},
	};
}

function logicRuntime(runtime: ReturnType<typeof learnerRuntime>): RuntimeLike | null {
	return runtime &&
		(["getSuspendData", "setSuspendData", "commit"] as const).every(
			(method) => typeof runtime[method] === "function",
		)
		? (runtime as RuntimeLike)
		: null;
}

function normalizeConfig(value: unknown): NormalizedConfig | null {
	const config = asRecord(value);
	if (!config) return null;
	const blocks = flattenLogicBlocks(normalizeList(config.blocks, normalizeBlock));
	const logic = asRecord(config.logic) ?? {};
	return {
		blocks,
		currentPage:
			typeof config.currentPage === "number" && Number.isInteger(config.currentPage)
				? config.currentPage
				: 1,
		pageId: typeof config.pageId === "string" ? config.pageId : "page",
		courseId: typeof config.courseId === "string" ? config.courseId : "standalone",
		pageIdMap: normalizeStringRecord(config.pageIdMap),
		logic: {
			dependencyRules: normalizeList(logic.dependencyRules, normalizeRule),
			rules: normalizeList(logic.rules, normalizeRule),
			variables: normalizeList(logic.variables, normalizeVariable),
			visibility: normalizeList(logic.visibility, normalizeVisibility),
		},
	};
}

function normalizeBlock(value: unknown): PageBlock | null {
	const block = asRecord(value);
	if (!block || typeof block.id !== "string" || typeof block.type !== "string") return null;
	return {
		id: block.id,
		type: block.type,
		...(typeof block.name === "string" ? { name: block.name } : {}),
		...(typeof block.visible === "boolean" ? { visible: block.visible } : {}),
		data: asRecord(block.data) ?? {},
	};
}

function normalizeVariable(value: unknown): VariableDefinition | null {
	const variable = asRecord(value);
	if (!variable || typeof variable.name !== "string" || !variable.name) return null;
	const dataType = ["number", "boolean", "text"].includes(variable.dataType as string)
		? (variable.dataType as VariableDefinition["dataType"])
		: "text";
	const source = ["manual", "url_parameter", "lms", "computed", "author"].includes(
		String(variable.source),
	)
		? (variable.source as VariableDefinition["source"])
		: undefined;
	return {
		name: variable.name,
		dataType,
		...(source ? { source } : {}),
		...(isScalar(variable.defaultValue) ? { defaultValue: variable.defaultValue } : {}),
		...(typeof variable.locked === "boolean" ? { locked: variable.locked } : {}),
		...(typeof variable.urlParamName === "string" ? { urlParamName: variable.urlParamName } : {}),
		...(isScalar(variable.urlParamFallback) ? { urlParamFallback: variable.urlParamFallback } : {}),
		...(typeof variable.lmsField === "string" ? { lmsField: variable.lmsField } : {}),
		...(isScalar(variable.lmsFallback) ? { lmsFallback: variable.lmsFallback } : {}),
	};
}

function normalizeList<T>(value: unknown, normalize: (value: unknown) => T | null): T[] {
	return Array.isArray(value)
		? value.map(normalize).filter((entry): entry is T => entry !== null)
		: [];
}

function normalizeRule(value: unknown): RuleConfig | null {
	const visibility = normalizeVisibility(value);
	if (!visibility) return null;
	return {
		...visibility,
		actions: normalizeList((value as Record<string, unknown>).actions, normalizeAction),
	};
}

function normalizeVisibility(value: unknown): VisibilityConfig | null {
	const visibility = asRecord(value);
	const conditions = normalizeConditions(visibility?.conditions);
	return visibility && typeof visibility.blockId === "string" && conditions
		? { blockId: visibility.blockId, conditions }
		: null;
}

function normalizeConditions(value: unknown): LogicConditions | null {
	const conditions = asRecord(value);
	if (!conditions || !Array.isArray(conditions.rules)) return null;
	return {
		operator: conditions.operator === "or" ? "or" : "and",
		rules: normalizeList(conditions.rules, normalizeConditionRule),
	};
}

function normalizeConditionRule(value: unknown): LogicRule | null {
	const rule = asRecord(value);
	if (!rule || typeof rule.source !== "string" || typeof rule.comparison !== "string") return null;
	const conditionValue = rule.value;
	if (!isScalar(conditionValue) && !isStringArray(conditionValue)) return null;
	return {
		source: rule.source,
		...(typeof rule.field === "string" ? { field: rule.field } : {}),
		comparison: rule.comparison,
		value: conditionValue,
	};
}

function normalizeAction(value: unknown): LogicAction | null {
	const action = asRecord(value);
	if (!action || typeof action.type !== "string") return null;
	const normalized: LogicAction = { type: action.type };
	if (typeof action.reason === "string") normalized.reason = action.reason;
	if (typeof action.target === "string") normalized.target = action.target;
	if (isStringArray(action.targets)) normalized.targets = action.targets;
	const actionValue = normalizeActionValue(action.value);
	if (actionValue !== undefined) normalized.value = actionValue;
	return normalized;
}

function normalizeActionValue(value: unknown): LogicAction["value"] | undefined {
	if (isScalar(value)) return value;
	const compound = asRecord(value);
	if (
		!compound ||
		!["add", "subtract", "multiply", "divide", "assign", "concat"].includes(
			String(compound.operation),
		)
	) {
		return undefined;
	}
	let operand: CompoundOperation["operand"];
	if (isScalar(compound.operand)) operand = compound.operand;
	else {
		const reference = asRecord(compound.operand);
		if (!reference || typeof reference.ref !== "string") return undefined;
		operand = {
			ref: reference.ref,
			...(typeof reference.field === "string" ? { field: reference.field } : {}),
		};
	}
	return { operation: compound.operation as CompoundOperation["operation"], operand };
}

function normalizeStringRecord(value: unknown): Record<string, string> {
	const record = asRecord(value);
	if (!record) return {};
	return Object.fromEntries(
		Object.entries(record).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isScalar(value: unknown): value is string | number | boolean {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
