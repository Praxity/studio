import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { choiceDependencyStatus } from "../../shared-blocks/src/choice-learner-state";
import {
	factsA,
	groupState,
	groupSubmission,
	groupView,
	signedSubmitted,
} from "../../shared-blocks/src/fixtures/choice-evidence";
import { initAssessmentGroups } from "../../shared-blocks/src/viewer/assessment-group-runtime";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { CourseTracker } from "../src/scorm/tracking";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import { initializeScormCourseHost } from "../template/src/hosts/course-host";

function open(format: "scorm12" | "scorm2004") {
	const dom = new JSDOM("", { url: "https://course.example/lesson.html", pretendToBeVisual: true });
	const values = new Map([
		["cmi.core.lesson_status", "incomplete"],
		["cmi.completion_status", "incomplete"],
		["cmi.success_status", "unknown"],
	]);
	const writes: string[][] = [];
	const get = (key: string) => values.get(key) ?? "";
	const set = (key: string, value: string) => {
		values.set(key, value);
		writes.push([key, value]);
		return "true";
	};
	Object.assign(dom.window, {
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: () => "true",
			LMSGetValue: get,
			LMSSetValue: set,
			LMSGetLastError: () => "0",
			LMSGetErrorString: () => "",
			LMSGetDiagnostic: () => "",
		},
		API_1484_11: {
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: () => "true",
			GetValue: get,
			SetValue: set,
			GetLastError: () => "0",
			GetErrorString: () => "",
			GetDiagnostic: () => "",
		},
	});
	vi.stubGlobal("window", dom.window);
	const runtime =
		format === "scorm12"
			? new Scorm12Runtime()
			: new Scorm2004Runtime(dom.window as unknown as Window);
	runtime.initialize();
	return { dom, values, writes, runtime };
}

const outcomes = (writes: string[][]) =>
	writes.filter(([key]) =>
		/^(?:cmi\.(?:objectives|score|success_status|completion_status)|cmi\.core\.(?:score|lesson_status))/.test(
			key,
		),
	);
for (const format of ["scorm12", "scorm2004"] as const) {
	it(`${format}: waiting Finish does not flush a completion queued before oneOf reselection`, () => {
		const { dom, runtime, writes } = open(format);
		try {
			const submitted = groupSubmission("oneOf", "signed");
			const states: Record<string, unknown> = {
				a: signedSubmitted,
				b: signedSubmitted,
				g: groupState("oneOf", submitted, "a", true),
			};
			runtime.trackInteraction("a", "a", true, 100, { contentSignature: factsA.signature });
			runtime.trackInteraction("b", "a", true, 100, { contentSignature: factsA.signature });
			runtime.trackInteraction("g", "100%", true, 100, {
				contentSignature: submitted.contentSignature,
				memberIds: ["a"],
			});
			const view = () =>
				groupView(
					states,
					runtime.getInteractions(),
					{ a: factsA, b: factsA },
					{ mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
				);
			const tracker = new CourseTracker(runtime, {
				totalPages: 1,
				completionMethod: "allPages",
				requiredAssessmentIds: ["g"],
				getChoiceDependencyView: view,
			});
			expect(choiceDependencyStatus("g", view())).toBe("current");
			tracker.trackPageVisit("page");
			expect(runtime.getCompletion()).toBe("completed");
			states.g = groupState("oneOf", submitted, "b", false);
			expect(choiceDependencyStatus("g", view())).toBe("history");
			expect(tracker.outcome().kind).toBe("waiting");
			writes.length = 0;
			tracker.checkCompletion();
			tracker.finish(true);
			expect(outcomes(writes)).toEqual([]);
		} finally {
			dom.window.close();
			vi.unstubAllGlobals();
		}
	});

	for (const event of ["finish", "pagehide"] as const)
		it(`${format}: installed host and native picker cancel pending completion on ${event}`, async () => {
			const { dom, runtime, writes } = open(format);
			let dispose: undefined | (() => void);
			try {
				const win = dom.window as unknown as Window;
				const doc = dom.window.document;
				vi.stubGlobal("document", doc);
				vi.stubGlobal("CSS", { escape: (value: string) => value });
				vi.stubGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
				vi.stubGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
				const submitted = groupSubmission("oneOf", "signed");
				const provider = createBlockStateRuntime(runtime);
				provider.set("a", JSON.parse(JSON.stringify(signedSubmitted)));
				provider.set("b", JSON.parse(JSON.stringify(signedSubmitted)));
				provider.set("g", JSON.parse(JSON.stringify(groupState("oneOf", submitted, "a", false))));
				runtime.trackInteraction("a", "a", true, 100, { contentSignature: factsA.signature });
				runtime.trackInteraction("b", "a", true, 100, { contentSignature: factsA.signature });
				runtime.trackInteraction("g", "100%", true, 100, {
					contentSignature: submitted.contentSignature,
					memberIds: ["a"],
				});
				runtime.commit();
				const page = {
					version: 1,
					courseId: "course",
					pageId: "page",
					pageTitle: "Lesson",
					currentPage: 1,
					totalPages: 1,
					currentSlug: "lesson",
					availableSlugs: ["lesson"],
					pageIdMap: { page: "lesson" },
					completionMethod: "allPages",
					requiredAssessmentIds: ["g"],
					pageRole: "content",
					strings: {},
					choiceStateQuestions: { a: factsA.question, b: factsA.question },
					choiceStateSignatures: { a: factsA.signature, b: factsA.signature },
					choiceStateGroups: {
						g: { mode: "oneOf", memberIds: ["a", "b"], requiredIds: ["a", "b"] },
					},
				};
				doc.body.innerHTML = `<main>${["a", "b"].map((id) => `<div class="praxity-block praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard" data-assessment-answered="true" data-completed="true" data-result="correct" data-score="100" data-max-score="100" data-passed="true"><p class="praxity-assessment-stem">Question ${id}</p><input type="radio" aria-label="Answer ${id}"><button data-assessment-submit="true">Submit</button></div>`).join("")}</main><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script>`;
				Object.defineProperty(doc, "readyState", { value: "complete" });
				expect(
					initializeScormCourseHost(
						{ format, readEntry: () => null, createRuntime: () => runtime },
						{
							win,
							doc,
							location: { href: dom.window.location.href, search: "", replace() {} },
							history: dom.window.history,
						},
					),
				).toBe(true);
				expect(runtime.getCompletion()).toBe("completed");
				dispose = initAssessmentGroups({
					root: doc.body,
					blocks: [
						{
							id: "g",
							type: "assessmentGroup",
							data: {
								mode: "oneOf",
								memberBlockIds: ["a", "b"],
								requireAll: true,
								showResultsSummary: true,
							},
						},
						...["a", "b"].map((id) => ({
							id,
							type: "assessment" as const,
							data: { gradingMode: "exact" as const },
						})),
					],
				});
				await vi.waitFor(() =>
					expect(doc.querySelector('input[name="ag-g"][value="b"]')).not.toBeNull(),
				);
				const picker = doc.querySelector<HTMLInputElement>('input[name="ag-g"][value="b"]')!;
				expect(picker.disabled).toBe(false);
				picker.click();
				expect(
					choiceDependencyStatus("g", win.__praxityBlockState!.getChoiceDependencyView!()),
				).toBe("history");
				writes.length = 0;
				if (event === "finish") win.__praxityFinishCourse!();
				else dom.window.dispatchEvent(new dom.window.Event("pagehide"));
				expect(outcomes(writes)).toEqual([]);
			} finally {
				dispose?.();
				dom.window.close();
				vi.unstubAllGlobals();
			}
		});
}
