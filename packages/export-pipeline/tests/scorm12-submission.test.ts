import { createHash } from "node:crypto";
import { choiceInteractionReport } from "@praxity/shared-blocks/assessment-choice";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import type { ChoiceResponse } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { CourseTracker } from "../src/scorm/tracking";
import type { CourseHostConfig } from "../template/src/hosts/course-host";
import { bufferPrivateBlockState } from "../template/src/hosts/privacy-bootstrap";
import { privacySupport } from "../template/src/hosts/privacy-support";
import { createPrivateBlockStateRuntime } from "../template/src/hosts/private-block-state";

const uuid = (seed: string) => {
	const hex = createHash("sha256").update(seed).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const answer = (selected: string[], checked = true) => ({
	version: 1,
	kind: "assessment",
	assessmentType: "choice",
	attemptCount: checked ? 1 : 0,
	checked,
	correct: checked,
	completed: checked,
	interacted: true,
	answer: selected,
	reviewedChoiceIds: checked ? selected : [],
});
function lms() {
	const values: Record<string, string> = {};
	const writes: string[][] = [];
	let refuse = false;
	const api = {
		LMSInitialize: () => "true",
		LMSFinish: () => "true",
		LMSCommit: () => "true",
		LMSGetLastError: () => "0",
		LMSGetErrorString: () => "",
		LMSGetDiagnostic: () => "",
		LMSGetValue: (key: string) => values[key] ?? "",
		LMSSetValue(key: string, value: string) {
			if (key === "cmi.suspend_data") {
				expect(value.length).toBeLessThanOrEqual(4096);
				if (refuse) return "false";
			}
			writes.push([key, value]);
			values[key] = value;
			const match = /^cmi.interactions\.(\d+)\.id$/.exec(key);
			if (match) values["cmi.interactions._count"] = String(Number(match[1]) + 1);
			return "true";
		},
	};
	const dom = new JSDOM("", { url: "https://course.example" });
	Object.assign(dom.window, { API: api });
	vi.stubGlobal("window", dom.window);
	return {
		api,
		values,
		writes,
		dom,
		refuse: (value: boolean) => {
			refuse = value;
		},
	};
}
afterEach(() => vi.unstubAllGlobals());

// The capacity reviews used unrelated UUIDs, one page per four-option question,
// a short readable response and every page visited before answering.
it.each([4, 6, 8, 10, 12, 14, 16, 18, 20])(
	"restores equal answer and row counts for %i UUID questions under the real cap",
	(count) => {
		const { values, dom } = lms();
		try {
			const runtime = new Scorm12Runtime();
			runtime.initialize();
			const provider = createPrivateBlockStateRuntime(
				runtime,
				{ courseId: "course", strings: {} } as CourseHostConfig,
				{} as Window,
			);
			const ids = Array.from({ length: count }, (_, n) => uuid(`question-${n}`));
			const tracker = new CourseTracker(runtime, {
				totalPages: count,
				completionMethod: "allPages",
				requiredAssessmentIds: ids,
			});
			for (let n = 0; n < count; n++) tracker.trackPageVisit(uuid(`page-${n}`));
			let accepted = 0;
			ids.forEach((id, n) => {
				const options = Array.from({ length: 4 }, (_, i) => uuid(`option-${n}-${i}`));
				const saved = answer([options[0]]);
				const before = values["cmi.suspend_data"];
				expect(
					provider.stageSubmission?.(id, () => {
						provider.set(id, saved);
						return provider.getSaveResult?.(id)?.status !== "not-saved";
					}),
				).toBe(true);
				try {
					tracker.trackInteraction(id, "option-0", true, 100, {
						assessmentType: "choice",
						attemptsUsed: 1,
						maxAttempts: 2,
					});
					accepted++;
				} catch (error) {
					expect(String(error)).toContain("ESCORM12STORAGE");
					expect(values["cmi.suspend_data"]).toBe(before);
					expect(provider.getSaveResult?.(id)?.status).toBe("not-saved");
				}
				runtime.commit();
			});
			const reload = new Scorm12Runtime();
			reload.initialize();
			const restored = createPrivateBlockStateRuntime(
				reload,
				{ courseId: "course", strings: {} } as CourseHostConfig,
				{} as Window,
			);
			expect(ids.filter((id) => restored.get(id) !== undefined)).toHaveLength(accepted);
			expect(reload.getInteractions()).toHaveLength(accepted);
			// Twelve questions must fit; larger attempts may refuse, never orphan an answer.
			expect(accepted).toBeGreaterThanOrEqual(Math.min(count, 12));
			if (accepted === count) expect(values["cmi.core.lesson_status"]).toBe("completed");
		} finally {
			dom.window.close();
		}
	},
);

it.each([70, 89])("restores all %i selected option UUIDs", (count) => {
	const { values, dom } = lms();
	try {
		const runtime = new Scorm12Runtime();
		runtime.initialize();
		const provider = createPrivateBlockStateRuntime(
			runtime,
			{ courseId: "course", strings: {} } as CourseHostConfig,
			{} as Window,
		);
		const response: ChoiceResponse = {
			type: "choice",
			selectionMode: "multiple",
			inputMethod: "click",
			display: "list",
			shuffle: false,
			options: Array.from({ length: count }, (_, n) => ({
				id: uuid(`option-${n}`),
				label: `Option ${n + 1}`,
			})),
		};
		const selected = response.options.map((option) => option.id);
		const saved = { ...answer(selected), correct: false };
		expect(
			provider.stageSubmission?.("q", () => {
				provider.set("q", saved);
				return true;
			}),
		).toBe(true);
		const report = choiceInteractionReport(response.options, new Set(selected), "en", 255);
		runtime.trackInteraction("q", report.responseText, undefined, undefined, {
			assessmentType: "choice",
		});
		expect(values["cmi.suspend_data"].length).toBeLessThanOrEqual(4096);
		const reload = new Scorm12Runtime();
		reload.initialize();
		expect(
			createPrivateBlockStateRuntime(
				reload,
				{ courseId: "course", strings: {} } as CourseHostConfig,
				{} as Window,
			).get("q"),
		).toEqual(saved);
		expect(reload.getInteractions()).toMatchObject([{ id: "q", response: report.responseText }]);
	} finally {
		dom.window.close();
	}
});

it.each(["ordinary", "private", "buffered-pending", "buffered-ready"])(
	"keeps prior bytes and the draft at capacity in the %s host",
	async (host) => {
		const { values, dom } = lms();
		try {
			const runtime = new Scorm12Runtime();
			runtime.initialize();
			const config: CourseHostConfig = {
				version: 1,
				courseId: "course",
				pageId: "page",
				pageTitle: "Practice",
				currentPage: 1,
				totalPages: 1,
				currentSlug: "page",
				availableSlugs: ["page"],
				pageIdMap: { page: "page" },
				completionMethod: "allPages",
				pageRole: "content",
				strings: {},
				blockStatePolicy: { private: "device" },
			};
			let load!: (support: typeof privacySupport) => void;
			const loaded = new Promise<typeof privacySupport>((resolve) => {
				load = resolve;
			});
			const provider = host.startsWith("buffered")
				? bufferPrivateBlockState([runtime, config, dom.window as unknown as Window], loaded)
				: host === "private"
					? createPrivateBlockStateRuntime(runtime, config, dom.window as unknown as Window)
					: createPrivateBlockStateRuntime(
							runtime,
							{ courseId: "course", strings: {} } as CourseHostConfig,
							{} as Window,
						);
			if (host === "buffered-ready") {
				load(privacySupport);
				await loaded;
			}
			const draft = answer([uuid("selected")], false);
			provider.set("q", draft);
			// Opaque data keeps its existing uncompressed size contract. Leave room
			// for the checked state alone, but not its additional interaction row.
			const custom = { blockState: { q: draft }, padding: "x".repeat(3500) };
			runtime.setSuspendData(JSON.stringify(custom));
			const before = values["cmi.suspend_data"];
			const saved = answer([uuid("selected")]);
			expect(
				provider.stageSubmission?.("q", () => {
					provider.set("q", saved);
					return true;
				}),
			).toBe(true);
			expect(values["cmi.suspend_data"]).toBe(before);
			// A second, unrelated current response can be too large even with compression.
			const noise = Array.from({ length: 200 }, (_, n) =>
				createHash("sha256").update(String(n)).digest("hex"),
			).join("");
			expect(() =>
				runtime.setSuspendData(JSON.stringify({ blockState: { q: saved }, noise })),
			).not.toThrow();
			expect(() =>
				runtime.trackInteraction("q", "stop", true, 100, { assessmentType: "choice" }),
			).toThrow(/ESCORM12STORAGE/);
			expect(values["cmi.suspend_data"]).toBe(before);
			expect(provider.get("q")).toEqual(draft);
			expect(provider.getSaveResult?.("q")).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			});
			expect(runtime.getInteractions()).toEqual([]);
			expect(
				provider.stageSubmission?.("q", () => {
					provider.set("q", saved);
					return true;
				}),
			).toBe(true);
			runtime.trackInteraction("q", "stop", true, 100, { assessmentType: "choice" });
			expect(provider.get("q")).toEqual(saved);
			expect(runtime.getInteractions()).toHaveLength(1);
		} finally {
			dom.window.close();
		}
	},
);

it.each(["refused write", "oversized response", "callback refuses", "callback throws"])(
	"abandons staging after %s, preserves an earlier answer, and permits retry",
	(failure) => {
		const { values, refuse, dom } = lms();
		try {
			const runtime = new Scorm12Runtime();
			runtime.initialize();
			const provider = createPrivateBlockStateRuntime(
				runtime,
				{ courseId: "course", strings: {} } as CourseHostConfig,
				{} as Window,
			);
			const saved = answer(["stop"]);
			provider.set("q", saved);
			runtime.trackInteraction("q", "stop", true, 100, { assessmentType: "choice" });
			const before = values["cmi.suspend_data"];
			const stage = () => {
				provider.set("q", answer(["go"]));
				return true;
			};
			if (failure === "callback throws") {
				expect(() =>
					provider.stageSubmission?.("q", () => {
						stage();
						throw new Error("refuse");
					}),
				).toThrow("refuse");
			} else if (failure === "callback refuses") {
				expect(
					provider.stageSubmission?.("q", () => {
						stage();
						return false;
					}),
				).toBe(false);
			} else {
				expect(provider.stageSubmission?.("q", stage)).toBe(true);
				refuse(failure === "refused write");
				expect(() =>
					runtime.trackInteraction(
						"q",
						failure === "oversized response" ? "x".repeat(256) : "go",
						false,
						0,
						{ assessmentType: "choice" },
					),
				).toThrow();
			}
			expect(values["cmi.suspend_data"]).toBe(before);
			expect(provider.get("q")).toEqual(saved);
			expect(runtime.getInteractions()).toHaveLength(1);
			expect(provider.getSaveResult?.("q")?.status).toBe("not-saved");
			refuse(false);
			expect(provider.stageSubmission?.("q", stage)).toBe(true);
			runtime.trackInteraction("q", "go", false, 0, { assessmentType: "choice" });
			expect(provider.getSaveResult?.("q")?.status).toBe("saved");
			expect(provider.get("q")).toEqual(answer(["go"]) as LearnerStateValue);
			expect(runtime.getInteractions()).toMatchObject([{ id: "q", response: "go", score: 0 }]);
		} finally {
			dom.window.close();
		}
	},
);
