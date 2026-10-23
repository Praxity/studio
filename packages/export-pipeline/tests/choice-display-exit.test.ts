import { finishLearnerCourse, learnerScore } from "@praxity/shared-blocks/learner-block-state";
import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import {
	factsA,
	signatureA,
	signatureB,
	signedSubmitted,
} from "../../shared-blocks/src/fixtures/choice-evidence";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { createBlockStateRuntime } from "../template/src/hosts/block-state-runtime";
import {
	initializeCourseHost,
	initializeScormCourseHost,
	readCourseDeploymentConfig,
} from "../template/src/hosts/course-host";

for (const format of ["scorm2004", "xapi"] as const)
	for (const variant of ["completion-only", "pass-mark", "history", "history-passed"] as const)
		it(`${format} ${variant} keeps main's display inputs and suspends a waiting End and pagehide`, () => {
			const passMark = variant !== "completion-only";
			const history = variant.startsWith("history");
			const page = {
				version: 1,
				courseId: "course",
				pageId: "summary",
				pageTitle: "Summary",
				currentPage: 2,
				totalPages: 2,
				currentSlug: "summary",
				availableSlugs: ["intro", "summary"],
				pageIdMap: { intro: "intro", summary: "summary" },
				completionMethod: "allPages",
				requiredAssessmentIds: ["question"],
				...(passMark ? { scoredAssessmentIds: ["question"], passMark: 80 } : {}),
				pageRole: "content",
				choiceStateSignatures: { question: signatureA },
				choiceStateQuestions: { question: factsA.question },
				strings: {},
			};
			const dom = new JSDOM(
				`<body><main><h1>Summary</h1></main><script id="praxity-host-config" type="application/json">${JSON.stringify(page)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify({ format })}</script></body>`,
				{ url: "https://course.example/summary.html" },
			);
			Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
			const values: Record<string, string> = {
				"cmi.completion_status": "completed",
				"cmi.success_status": variant === "history-passed" ? "passed" : "failed",
				"cmi.entry": "resume",
			};
			const writes: string[][] = [];
			const statements: { verb: { id: string } }[] = [];
			Object.assign(dom.window, {
				API_1484_11: {
					Initialize: () => "true",
					Terminate: () => "true",
					Commit: () => "true",
					GetLastError: () => "0",
					GetErrorString: () => "",
					GetDiagnostic: () => "",
					GetValue: (key: string) => values[key] ?? "",
					SetValue: (key: string, value: string) => {
						values[key] = value;
						writes.push([key, value]);
						return "true";
					},
				},
			});
			vi.stubGlobal("window", dom.window);
			vi.stubGlobal("document", dom.window.document);
			vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
				statements.push(JSON.parse(String(init.body)));
				return new Response(null, { status: 200 });
			});
			try {
				const runtime =
					format === "scorm2004"
						? new Scorm2004Runtime(dom.window as unknown as Window)
						: new XapiRuntime(
								{
									endpoint: "https://lrs.example/statements",
									auth: "Basic synthetic",
									actorMode: "manual",
									actor: { name: "Learner", mbox: "mailto:learner@example.com" },
								},
								"course",
								dom.window.localStorage,
							);
				expect(runtime.initialize()).toBe(true);
				const signature = history ? signatureB : signatureA;
				const state = {
					...signedSubmitted,
					contentSignature: signature,
					answer: ["b"],
					correct: false,
					completed: true,
					attemptCount: 2,
				};
				createBlockStateRuntime(runtime).set("question", state as unknown as LearnerStateValue);
				runtime.trackInteraction("question", "b", false, 0, {
					contentSignature: signature,
					attemptsUsed: 2,
					maxAttempts: 2,
				});
				runtime.trackInteraction("practice", "reflection", true, 100);
				if (passMark) runtime.setScore(47, 0, 100);
				const environment = {
					win: dom.window as unknown as Window,
					doc: dom.window.document,
					location: { href: dom.window.location.href, search: "", replace() {} },
					history: dom.window.history,
				};
				expect(
					format === "scorm2004"
						? initializeScormCourseHost(
								{ format, readEntry: () => null, createRuntime: () => runtime },
								environment,
							)
						: initializeCourseHost(
								{
									format,
									readDeploymentConfig: readCourseDeploymentConfig,
									createRuntime: () => runtime,
								},
								environment,
							),
				).toBe(true);
				const win = dom.window as unknown as Window;
				expect(win.__praxityTracker?.getOutcome?.()).toBeUndefined();
				expect(learnerScore(() => true, dom.window.document)).toEqual(
					variant === "completion-only"
						? null
						: { raw: variant === "pass-mark" ? 47 : 100, min: 0, max: 100 },
				);
				if (!history) expect(win.__praxityTracker?.isAssessmentFinal?.("question")).toBe(true);
				writes.length = 0;
				statements.length = 0;
				if (history) {
					dom.window.dispatchEvent(new dom.window.Event("pagehide"));
					if (format === "scorm2004") expect(values["cmi.exit"]).toBe("suspend");
					writes.length = 0;
				}
				finishLearnerCourse(() => true, dom.window.document);
				if (history) {
					if (format === "scorm2004") expect(values["cmi.exit"]).toBe("suspend");
					expect(
						writes.filter(([key]) =>
							/^cmi\.(?:objectives|score|success_status|completion_status)/.test(key),
						),
					).toEqual([]);
					expect(
						statements.filter((statement) =>
							/\/(?:completed|passed|failed)$/.test(statement.verb.id),
						),
					).toEqual([]);
				}
			} finally {
				dom.window.close();
				vi.unstubAllGlobals();
			}
		});
