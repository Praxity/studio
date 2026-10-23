import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import {
	createSelfCheckMutationObserver,
	observeSelfCheckLifetime,
	requestSelfCheckFrame,
	selfCheckEpochTicket,
} from "@praxity/shared-blocks/self-check-consumers";

import { privatePracticeState } from "../private-practice-scope";

/** Localized paragraphs come from SSR. Observe only the private activity roots;
 * React can replace its form without discarding the notice's announcement state. */
export function installPrivateChoiceNotices(doc: Document) {
	const win = doc.defaultView;
	if (!win) return () => {};
	const activities = [...doc.querySelectorAll<HTMLElement>('[data-island="assessment"]')]
		.filter((root) => root.querySelector("[data-practice-mode]"))
		.map((root) => {
			const block = JSON.parse(root.dataset.blockJson ?? "{}");
			const node = (name: string) => {
				const element = root.querySelector<HTMLElement>(`[data-practice-${name}]`);
				if (!element) throw new Error("EPRIVATECHOICEMARKUP");
				return element;
			};
			return {
				root,
				id: block.id as string,
				mode: node("mode"),
				shared: node("shared"),
				identified: node("identified"),
				restoring: node("restoring"),
				failure: node("save"),
				status: node("status"),
				provider: undefined as LearnerBlockStateRuntime | undefined,
				announced: false,
				deliberate: false,
			};
		});
	const update = (id?: string, announce = false) => {
		const provider = win.__praxityBlockState as LearnerBlockStateRuntime | undefined;
		for (const activity of activities) {
			if (id && activity.id !== id) continue;
			const { root, mode, shared, identified, restoring, failure, status } = activity;
			const actions = root.querySelector(".praxity-assessment-actions");
			if (!actions) continue;
			if (activity.provider !== provider) {
				activity.provider = provider;
				activity.announced = activity.deliberate = false;
				status.textContent = "";
			}
			if (announce) activity.deliberate = true;
			if (
				actions.nextElementSibling !== mode ||
				mode.nextElementSibling !== restoring ||
				restoring.nextElementSibling !== failure ||
				failure.nextElementSibling !== status
			)
				actions.after(mode, restoring, failure, status);
			const { pending, failed, identified: scoped } = privatePracticeState(provider, activity.id);
			shared.hidden = pending || scoped;
			identified.hidden = pending || !scoped;
			restoring.hidden = !pending;
			failure.hidden = !failed;
			if (!pending && !failed) {
				activity.announced = activity.deliberate = false;
				if (status.textContent) status.textContent = "";
			}
			if (failed && activity.deliberate && !activity.announced) {
				status.textContent = failure.textContent;
				activity.announced = true;
			}
		}
	};
	if (!activities.length) return update;
	for (const { root, id } of activities) {
		const deliberate = (event: Event) => {
			const target = event.target as Element | null;
			if (event.type === "input") {
				if (!target?.matches('input[type="radio"]')) return;
			} else {
				const action = target?.closest("[data-assessment-submit], [data-assessment-retry]");
				if (
					!action ||
					(action.hasAttribute("data-assessment-submit") && !root.querySelector("input:checked"))
				)
					return;
			}
			// React and the admitted provider finish this input before presentation.
			requestSelfCheckFrame(() => update(id, true), selfCheckEpochTicket(doc));
		};
		root.addEventListener("input", deliberate);
		root.addEventListener("click", deliberate);
	}
	observeSelfCheckLifetime((current) => {
		const observer = createSelfCheckMutationObserver(current, () => update());
		for (const { root } of activities) observer.observe(root, { childList: true, subtree: true });
		update();
		return () => observer.disconnect();
	}, doc);
	// The original privacy buffer settles its rejection one microtask after the
	// host's ready event. A lifetime-bound frame projects that final failed state.
	win.addEventListener("praxity:runtime-ready", () => {
		requestSelfCheckFrame(() => update(), selfCheckEpochTicket(doc));
	});
	update();
	return update;
}
