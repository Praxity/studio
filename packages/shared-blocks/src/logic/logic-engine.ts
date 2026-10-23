import {
	readSelfCheckField,
	type SelfCheckConsumers,
	selfCheckConsumers,
} from "../self-check-consumers";
import { findBlockElement } from "./block-element.ts";
import { computeBlockFields } from "./computed-fields.ts";
import {
	applyCompoundOperation,
	type CompoundOperation,
	type DataProvider,
	evaluateConditions,
	isCompoundOperation,
	type LogicAction,
	type LogicConditions,
	normalizeAction,
} from "./evaluate.ts";
import type { LearnerTracker } from "./learner-tracker.ts";
import { type DependencyRule, selfCheckDependencies } from "./self-check-dependencies";
import type { VariableStore } from "./variable-store.ts";
import { resolveBlockRef, resolveBlockTargetIds } from "./visibility.ts";

interface LogicBlockConfig {
	blockId: string;
	conditions: LogicConditions;
	actions: LogicAction[];
}

interface LogicPageBlock {
	id: string;
	type: string;
	name?: string;
	visible?: boolean;
	data?: Record<string, unknown>;
	logicScope?: string;
}

interface RequiredEffect {
	active: boolean;
	required: string | null;
	minimum: string | null;
	position: string;
	indicator: HTMLElement | null;
}

export class LogicEngine {
	private logicBlocks: LogicBlockConfig[] = [];
	private jumpTarget: string | null = null;
	private provider: DataProvider;
	private visibleBlockIds: Set<string>;
	private requiredEffects = new Map<HTMLElement, RequiredEffect>();
	private completionBlocked = false;
	private completionReasons: string[] = [];

	constructor(
		private variableStore: VariableStore,
		private pageBlocks: LogicPageBlock[],
		private learnerTracker?: LearnerTracker,
		provider?: DataProvider,
		private selfChecks: Pick<SelfCheckConsumers, "read"> | undefined = typeof document ===
		"undefined"
			? undefined
			: selfCheckConsumers(),
		private dependencyRules: DependencyRule[] = [],
	) {
		this.visibleBlockIds = this.getInitialVisibleBlockIds();
		this.provider = provider ?? this.createDomDataProvider();
	}

	registerLogicBlock(config: LogicBlockConfig): void {
		this.logicBlocks.push(config);
	}

	/**
	 * Evaluate all logic blocks on the page.
	 * Call on page load and after any block interaction.
	 */
	evaluate(
		origin: "initial" | "restore" | "interaction" = "initial",
		current: () => boolean = () => true,
		interactionBlocks?: ReadonlySet<string>,
	): void {
		if (!current()) return;
		this.jumpTarget = null;
		this.visibleBlockIds = this.getInitialVisibleBlockIds();
		for (const effect of this.requiredEffects.values()) effect.active = false;
		this.completionBlocked = false;
		this.completionReasons = [];
		const inputs =
			interactionBlocks &&
			new Set([...interactionBlocks].map((id) => resolveBlockRef(this.pageBlocks, id)));
		const rules = [...this.logicBlocks, ...this.dependencyRules];

		for (const logic of this.logicBlocks) {
			if (!current()) return;
			const dependencies = selfCheckDependencies(this.pageBlocks, rules, logic).map((id) =>
				this.selfChecks?.read(id),
			);
			if (dependencies.some((activity) => !activity?.ready || !activity.available)) {
				if (
					logic.actions.some((action) =>
						["require", "disableCompletion"].includes(normalizeAction(action)?.type ?? ""),
					)
				)
					this.completionBlocked = true;
				continue;
			}
			if (evaluateConditions(logic.conditions, this.provider)) {
				const restoring =
					origin === "restore" ||
					(dependencies.some((activity) => activity?.origin === "restore") &&
						(origin !== "interaction" ||
							(inputs &&
								!selfCheckDependencies(this.pageBlocks, rules, logic, inputs).some((id) =>
									inputs.has(id),
								))));
				this.executeActions(
					restoring
						? logic.actions.filter((action) =>
								["show", "hide", "require", "disableCompletion"].includes(
									normalizeAction(action)?.type ?? "",
								),
							)
						: logic.actions,
					current,
				);
			}
		}
		if (current()) this.restoreInactiveDomEffects();
	}

	/** Refresh predicates after hydration without replaying authored mutations or jumps. */
	refreshVisibility(current: () => boolean = () => true): void {
		// Attaching a display must not discard a jump from a deliberate interaction.
		const jump = this.jumpTarget;
		this.evaluate("restore", current);
		if (current()) this.jumpTarget = jump;
	}

	/** Restore author-owned DOM state when this engine is replaced or unmounted. */
	destroy(): void {
		for (const [element, effect] of this.requiredEffects) {
			this.restoreRequiredEffect(element, effect);
		}
		this.requiredEffects.clear();
		this.completionBlocked = false;
		this.completionReasons = [];
	}

	/**
	 * Get the jump target if any logic block triggered jumpToPage.
	 * Returns null if linear navigation should proceed.
	 */
	getJumpTarget(): string | null {
		return this.jumpTarget;
	}

	isCompletionBlocked(): boolean {
		return this.completionBlocked;
	}

	getCompletionReasons(): string[] {
		return [...this.completionReasons];
	}

	getVisibleBlockIds(): Set<string> {
		return new Set(this.visibleBlockIds);
	}

	private createDomDataProvider(): DataProvider {
		return {
			getBlockField: (blockId: string, field: string) => {
				const resolvedBlockId = resolveBlockRef(this.pageBlocks, blockId);
				const block = this.pageBlocks.find((b) => b.id === resolvedBlockId);
				if (block?.type === "selfCheck")
					return readSelfCheckField(this.selfChecks, resolvedBlockId, field);
				const blockEl = findBlockElement(resolvedBlockId);
				if (!blockEl) return undefined;

				if (!block) return undefined;

				const fields = computeBlockFields(block.type, blockEl);
				return fields[field];
			},
			getVariable: (name: string) => {
				return this.variableStore.get(name);
			},
			getLearnerInfo: (scope: string, metric: string) => {
				if (this.learnerTracker) {
					return this.learnerTracker.getMetric(
						metric as "grade" | "progress" | "visitCount" | "timeOn",
						scope as "course" | "lesson" | "page",
					);
				}
				return undefined;
			},
		};
	}

	private executeActions(actions: LogicAction[], current: () => boolean): void {
		for (const rawAction of actions) {
			if (!current()) return;
			const action = normalizeAction(rawAction);
			if (action === null) continue;

			const { type, targets } = action;

			switch (type) {
				case "show":
				case "hide": {
					for (const t of targets) {
						for (const blockId of resolveBlockTargetIds(this.pageBlocks, t)) {
							this.visibleBlockIds[type === "show" ? "add" : "delete"](blockId);
						}
					}
					break;
				}
				case "jumpToPage":
					this.jumpTarget = targets[0] ? resolveBlockRef(this.pageBlocks, targets[0]) : null;
					break;
				case "setVariable":
					if (action.value !== undefined) {
						const target = targets[0];
						if (target) {
							if (
								isCompoundOperation(action.value as string | number | boolean | CompoundOperation)
							) {
								const result = applyCompoundOperation(
									this.variableStore.get(target),
									action.value as CompoundOperation,
									this.provider,
								);
								this.variableStore.set(target, result);
							} else {
								this.variableStore.set(target, action.value as string | number | boolean);
							}
						}
					}
					break;
				case "require": {
					for (const t of targets) {
						const el = document.querySelector(
							`[data-block-id="${resolveBlockRef(this.pageBlocks, t)}"]`,
						);
						if (el instanceof HTMLElement) {
							let effect = this.requiredEffects.get(el);
							if (!effect) {
								effect = {
									active: false,
									required: el.getAttribute("data-required"),
									minimum: el.getAttribute("data-required-min"),
									position: el.style.position,
									indicator: null,
								};
								this.requiredEffects.set(el, effect);
							}
							if (!effect.active) restoreAttribute(el, "data-required-min", effect.minimum);
							effect.active = true;
							el.setAttribute("data-required", "true");
							if (typeof action.value === "number" && action.value > 0) {
								el.setAttribute("data-required-min", String(action.value));
							}
							el.style.position = "relative";
							// TODO: Lift required indicator rendering into React state (remove direct DOM injection).
							// Inject required indicator if not already present
							if (!el.querySelector(".praxity-required-indicator")) {
								const indicator = document.createElement("span");
								indicator.className = "praxity-required-indicator";
								indicator.setAttribute("aria-hidden", "true");
								indicator.innerHTML =
									'<svg width="0.6em" height="0.6em" viewBox="0 0 16 16" fill="var(--praxity-color-accent, #868e96)" style="display:block"><path d="M7 0h2v4.6l3.98-2.3 1 1.74L10 6.33h4.6v2H10l3.98 2.3-1 1.73L9 10.07V14.6H7v-4.53l-3.98 2.3-1-1.74L7 4.6V0z"/></svg>';
								el.insertBefore(indicator, el.firstChild);
								effect.indicator = indicator;
							}
						}
					}
					break;
				}
				case "disableCompletion": {
					this.completionBlocked = true;
					const reason = typeof action.reason === "string" ? action.reason.trim() : "";
					if (reason && !this.completionReasons.includes(reason))
						this.completionReasons.push(reason);
					break;
				}
			}
		}
	}

	private restoreInactiveDomEffects(): void {
		for (const [element, effect] of this.requiredEffects) {
			if (effect.active) continue;
			this.restoreRequiredEffect(element, effect);
			this.requiredEffects.delete(element);
		}
	}

	private restoreRequiredEffect(element: HTMLElement, effect: RequiredEffect): void {
		restoreAttribute(element, "data-required", effect.required);
		restoreAttribute(element, "data-required-min", effect.minimum);
		element.style.position = effect.position;
		effect.indicator?.remove();
	}

	private getInitialVisibleBlockIds(): Set<string> {
		const visible = new Set<string>();
		const hiddenHeadingLevels = new Map<string, number>();
		for (const block of this.pageBlocks) {
			const scope = block.logicScope ?? "root";
			let hiddenHeadingLevel = hiddenHeadingLevels.get(scope) ?? null;
			const data = block.data ?? {};
			const headingLevel = getHeadingLevel(block);
			if (
				hiddenHeadingLevel !== null &&
				headingLevel !== null &&
				headingLevel <= hiddenHeadingLevel
			) {
				hiddenHeadingLevel = null;
				hiddenHeadingLevels.delete(scope);
			}
			const isHidden = block.visible === false || data.hide === true || data.hidden === true;
			if (isHidden && headingLevel !== null) {
				hiddenHeadingLevel = headingLevel;
				hiddenHeadingLevels.set(scope, headingLevel);
			}
			if (!isHidden && hiddenHeadingLevel === null) {
				visible.add(block.id);
			}
		}
		return visible;
	}
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
	if (value === null) element.removeAttribute(name);
	else element.setAttribute(name, value);
}

function getHeadingLevel(block: LogicPageBlock): number | null {
	if (block.type !== "heading") return null;
	const level = Number(block.data?.level ?? 2);
	return Number.isFinite(level) ? level : 2;
}
