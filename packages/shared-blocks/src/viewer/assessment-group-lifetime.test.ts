// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { getStrings } from "../i18n/strings";
import { initAssessmentGroups } from "./assessment-group-runtime";

for (const mode of ["all", "oneOf"] as const)
	for (const phase of ["member-submit", "group-complete", "results-focus"] as const) {
		it(`${mode} ${phase} replacement rejects the obsolete group completion write`, () => {
			const frames: FrameRequestCallback[] = [],
				timers: (() => void)[] = [];
			vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
				frames.push(cb);
				return frames.length;
			});
			vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
			vi.spyOn(window, "setTimeout").mockImplementation(((cb: () => void) => {
				timers.push(cb);
				return timers.length;
			}) as typeof window.setTimeout);
			vi.stubGlobal("CSS", { escape: (value: string) => value });
			document.body.innerHTML =
				'<div class="praxity-block" data-block-id="q1"><div class="praxity-block-assessment" data-block-id="q1" data-assessment-display="standard" data-assessment-answered="true" data-score="100" data-max-score="100" data-passed="true"><p class="praxity-assessment-stem">Question</p><input type="radio"><button type="button" data-assessment-submit="true">Submit</button></div></div>';
			const blocks = [
				{
					id: "group",
					type: "assessmentGroup",
					data: { mode, requireAll: true, memberBlockIds: ["q1"] },
				},
				{ id: "q1", type: "assessment", data: { gradingMode: "exact", required: true } },
			] as never;
			let epoch = 0;
			const stamps = new WeakMap<Event, () => boolean>();
			const successorWrites: unknown[] = [],
				completions: unknown[] = [];
			Object.assign(window, {
				__praxitySelfCheckDocument: {
					captureEvent: (event: Event, current: () => boolean) => stamps.set(event, current),
					eventTicket: (event: Event) => stamps.get(event),
					loadTicket() {
						const captured = epoch;
						return () => captured === epoch;
					},
				},
				__praxityBlockState: { get: () => undefined, set: () => {} },
			});
			const replace = () => {
				epoch++;
				Object.assign(window, {
					__praxityBlockState: {
						get: () => undefined,
						set: (id: string, value: unknown) => successorWrites.push({ id, value }),
					},
				});
				document.dispatchEvent(new Event("praxity:self-check-owner"));
			};
			const member = document.querySelector<HTMLElement>("[data-assessment-display]");
			member?.querySelector("button")?.addEventListener("click", () => {
				if (!member) throw new Error("Missing member");
				member.dataset.completed = "true";
				if (phase === "member-submit") replace();
			});
			const completed = (event: Event) => {
				completions.push((event as CustomEvent).detail);
				if (phase === "group-complete") replace();
			};
			document.addEventListener("praxity:assessment-group-complete", completed);
			const focus = () => {
				if (
					phase === "results-focus" &&
					document.activeElement?.classList.contains("praxity-ag-results-score")
				)
					replace();
			};
			document.addEventListener("focusin", focus);
			const release = initAssessmentGroups({
				blocks,
				root: document.body,
				labels: getStrings("en"),
			});
			try {
				frames.splice(0).forEach((cb) => cb(0));
				if (mode === "oneOf") {
					const radio = document.querySelector<HTMLInputElement>(".praxity-ag-radio");
					if (!radio) throw new Error("Missing group selection");
					radio.checked = true;
					radio.dispatchEvent(new Event("change", { bubbles: true }));
				}
				document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
				timers.splice(0).forEach((cb) => cb());
				expect(epoch).toBe(1);
				expect(successorWrites).toEqual([]);
				if (phase === "member-submit") expect(completions).toEqual([]);
			} finally {
				release();
				document.removeEventListener("focusin", focus);
				document.removeEventListener("praxity:assessment-group-complete", completed);
				Reflect.deleteProperty(window, "__praxitySelfCheckDocument");
				Reflect.deleteProperty(window, "__praxityBlockState");
				vi.restoreAllMocks();
				vi.unstubAllGlobals();
			}
		});
	}
