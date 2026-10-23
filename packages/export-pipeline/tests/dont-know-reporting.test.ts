import { afterEach, expect, it, vi } from "vitest";
import { Scorm12Runtime } from "../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../src/scorm/api/scorm2004";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { assessmentReportingOptions } from "../src/scorm/types";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const definition = {
	interactionType: "choice" as const,
	choices: [
		{ id: "stop", description: { en: "Stop", fr: "Arrêter" } },
		{ id: "dont-know", description: { en: "I don't know", fr: "Je ne sais pas" } },
	],
};
const options = () =>
	assessmentReportingOptions(
		{
			assessmentType: "choice",
			questionText: "Que faire ?",
			language: "fr",
			result: "neutral",
			choiceDefinition: definition,
		},
		"Page",
	);

it.each(["scorm12", "scorm2004"])(
	"records uncertainty as neutral in %s while keeping a zero scored result",
	(format) => {
		const values = new Map<string, string>();
		const set = vi.fn((key: string, value: string) => {
			values.set(key, value);
			return "true";
		});
		const get = (key: string) => values.get(key) ?? "";
		const ok = () => "true",
			error = () => "0",
			empty = () => "";
		const win = {
			parent: null as unknown,
			opener: null,
			API: {
				LMSInitialize: ok,
				LMSFinish: ok,
				LMSCommit: ok,
				LMSGetValue: get,
				LMSSetValue: set,
				LMSGetLastError: error,
				LMSGetErrorString: empty,
				LMSGetDiagnostic: empty,
			},
			API_1484_11: {
				Initialize: ok,
				Terminate: ok,
				Commit: ok,
				GetValue: get,
				SetValue: set,
				GetLastError: error,
				GetErrorString: empty,
				GetDiagnostic: empty,
			},
		};
		win.parent = win;
		vi.stubGlobal("window", win);
		const runtime =
			format === "scorm12" ? new Scorm12Runtime() : new Scorm2004Runtime(win as never);
		expect(runtime.initialize()).toBe(true);
		runtime.trackInteraction("q", "dont-know", false, 0, options());
		expect(set).toHaveBeenCalledWith("cmi.interactions.0.result", "neutral");
		expect(set).toHaveBeenCalledWith(
			format === "scorm12"
				? "cmi.interactions.0.student_response"
				: "cmi.interactions.0.learner_response",
			"dont-know",
		);
		if (format === "scorm2004")
			expect(set).toHaveBeenCalledWith("cmi.interactions.0.description", "{lang=fr}Que faire ?");
		expect(runtime.getInteractions()[0]).toMatchObject({
			response: "dont-know",
			correct: false,
			score: 0,
		});
	},
);

it("records the literal xAPI choice definition and unsuccessful uncertainty response", () => {
	const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
	vi.stubGlobal("fetch", fetch);
	const runtime = new XapiRuntime(
		{
			endpoint: "https://lrs.example/xapi/statements",
			auth: "Basic test",
			actor: { name: "Learner", mbox: "mailto:learner@example.com" },
		},
		"course",
	);
	expect(runtime.initialize()).toBe(true);
	runtime.trackInteraction("q", "dont-know", false, 0, options());
	const statement = JSON.parse(fetch.mock.calls.at(-1)?.[1].body ?? "null");
	expect(statement.object.definition).toMatchObject({
		interactionType: "choice",
		choices: [
			{ id: "stop", description: { en: "Stop", fr: "Arrêter" } },
			{ id: "dont-know", description: { en: "I don't know", fr: "Je ne sais pas" } },
		],
	});
	expect(statement.result).toEqual({ response: "dont-know", success: false, score: { raw: 0 } });
});

it("refuses an invalid result override at the reporting event boundary", () => {
	expect(assessmentReportingOptions({ result: "wrong" }, "Page").result).toBeUndefined();
	expect(options().result).toBe("neutral");
});
