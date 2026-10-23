import { fileURLToPath } from "node:url";
import type { ChoiceResponse, PraxityBlock } from "@praxity/shared-blocks/types";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateHtmlPage } from "../src/html-gen";
import { parseScorm12SuspendData } from "../src/scorm/scorm12-suspend-data";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
let runtimeScript: string;

beforeAll(async () => {
	const result = await build({
		absWorkingDir: packageRoot,
		stdin: {
			contents: `
import { initializeCourseHost } from './template/src/hosts/course-host';
import { Scorm2004Runtime } from './src/scorm/api/scorm2004';
import { Scorm12Runtime } from './src/scorm/api/scorm12';
initializeCourseHost({
  format: window.reportFormat,
  createRuntime: () => window.reportFormat === 'scorm12' ? new Scorm12Runtime() : new Scorm2004Runtime(),
});
void import('./template/src/islands/island-assessment');
void import('./template/src/islands/island-assessment-group');`,
			resolveDir: packageRoot,
			loader: "ts",
		},
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		loader: { ".css": "empty" },
		define: { "process.env.NODE_ENV": '"production"' },
	});
	runtimeScript = result.outputFiles[0].text;
});

function choice(
	id: string,
	stem: string,
	labels = ["École & astres", "Ecole & astres", "Ecole astres 2"],
): PraxityBlock {
	return {
		id,
		type: "assessment",
		data: {
			assessmentType: "choice",
			stem: stem ? [{ id: `${id}-stem`, type: "text", data: { content: stem } }] : [],
			gradingMode: "none",
			required: false,
			response: {
				type: "choice",
				selectionMode: "multiple",
				options: labels.map((label, index) => ({ id: `${id}-choice-option-${index}`, label })),
			},
		},
	};
}

async function launch(
	blocks: PraxityBlock[],
	format = "scorm2004",
	language = "fr",
	failure?: { field: string; throws: boolean },
	initialChoiceAnswers?: Record<string, string[]>,
) {
	const page = { id: "page", title: "Page &amp; title", blocks };
	const html = generateHtmlPage({
		config: {
			id: "course",
			title: "Course",
			sourceLocale: language,
			pages: [page],
			totalPages: 1,
			...(failure ? { completionMethod: "quiz", passingScore: 80 } : {}),
		},
		page,
		index: 0,
		currentSlug: "page",
		slugList: [{ pageId: "page", slug: "page", title: page.title }],
		slugMap: new Map([["page", "page"]]),
		islandAssets: {
			loaderFilename: "loader.js",
			islandFilenames: { assessment: "assessment.js", assessmentGroup: "group.js", nav: "nav.js" },
		},
	});
	const data = new Map<string, string>();
	if (initialChoiceAnswers) {
		data.set(
			"cmi.suspend_data",
			JSON.stringify({
				visitedPages: [],
				interactions: [],
				custom: JSON.stringify({
					blockState: Object.fromEntries(
						Object.entries(initialChoiceAnswers).map(([id, answer]) => [
							id,
							{
								version: 1,
								kind: "assessment",
								assessmentType: "choice",
								attemptCount: 0,
								checked: false,
								correct: false,
								completed: false,
								interacted: true,
								answer,
							},
						]),
					),
				}),
			}),
		);
	}
	const rejected: { key: string; value: string; error: number }[] = [];
	let lastError = "0";
	const failWrite = (key: string, value: string) => {
		lastError = "0";
		if (key !== `cmi.interactions.0.${failure?.field}`) return false;
		if (failure?.throws) throw new Error("LMS field write threw");
		lastError = "351";
		rejected.push({ key, value, error: 351 });
		return true;
	};
	const dom = new JSDOM(
		html.replace(
			"<!--praxity-deployment-head-->",
			`<script id="praxity-deployment-config" type="application/json">{"format":"${format}"}</script>`,
		),
		{
			url: "https://course.example/page.html",
			runScripts: "outside-only",
			pretendToBeVisual: true,
		},
	);
	const win = dom.window;
	Object.defineProperty(win.document, "readyState", { value: "complete" });
	Object.assign(win, {
		CSS: { escape: (value: string) => value },
		reportFormat: format,
		matchMedia: (media: string) => ({
			matches: false,
			media,
			addEventListener() {},
			removeEventListener() {},
		}),
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
		API_1484_11: {
			Initialize: () => "true",
			Terminate: () => "true",
			Commit: () => "true",
			GetValue: (key: string) => {
				lastError = "0";
				return data.get(key) ?? "";
			},
			SetValue: (key: string, value: string) => {
				if (failWrite(key, value)) return "false";
				if (key.endsWith(".description")) {
					const delimiter = value.match(/^\{lang=([^}]*)\}/);
					const text = delimiter ? value.slice(delimiter[0].length) : value;
					if (
						(value.startsWith("{lang=") && !delimiter) ||
						(delimiter && !/^(?:en|fr)(?:-[A-Za-z0-9]{1,8})*$/.test(delimiter[1])) ||
						Array.from(text).length > 250
					) {
						lastError = "406";
						rejected.push({ key, value, error: 406 });
						return "false";
					}
				}
				data.set(key, value);
				return "true";
			},
			GetLastError: () => lastError,
			GetErrorString: () => "",
			GetDiagnostic: () => "",
		},
		API: {
			LMSInitialize: () => "true",
			LMSFinish: () => "true",
			LMSCommit: () => "true",
			LMSGetValue: (key: string) => {
				lastError = "0";
				return data.get(key) ?? "";
			},
			LMSSetValue: (key: string, value: string) => {
				if (failWrite(key, value)) return "false";
				if (key === "cmi.suspend_data") expect(value.length).toBeLessThanOrEqual(4096);
				data.set(key, value);
				return "true";
			},
			LMSGetLastError: () => lastError,
			LMSGetErrorString: () => "",
			LMSGetDiagnostic: () => "",
		},
	});
	win.eval(runtimeScript);
	await new Promise((resolve) => win.setTimeout(resolve, 0));
	return {
		dom,
		data,
		rejected,
		async answer(id: string, text?: string) {
			const root = win.document.querySelector<HTMLElement>(
				`[data-island="assessment"][data-block-id="${id}"]`,
			);
			expect(root).not.toBeNull();
			if (initialChoiceAnswers?.[id]) {
				expect(
					Array.from(root?.querySelectorAll<HTMLInputElement>("input:checked") ?? []).map(
						(input) => input.value,
					),
				).toEqual(initialChoiceAnswers[id]);
				for (const input of root?.querySelectorAll<HTMLInputElement>(
					"input[type=checkbox]:not(:checked)",
				) ?? []) {
					input.click();
				}
			} else if (text !== undefined) {
				const input = root?.querySelector("textarea, input[type=text]") as HTMLInputElement;
				const prototype =
					input.tagName === "TEXTAREA"
						? win.HTMLTextAreaElement.prototype
						: win.HTMLInputElement.prototype;
				Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, text);
				input.dispatchEvent(new win.Event("input", { bubbles: true }));
			} else {
				root?.querySelector<HTMLInputElement>("input[type=radio]")?.click();
				for (const input of root?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ??
					[]) {
					input.click();
				}
			}
			await new Promise((resolve) => win.setTimeout(resolve, 0));
			root?.querySelector<HTMLButtonElement>("[data-assessment-submit]")?.click();
			await new Promise((resolve) => win.setTimeout(resolve, 0));
		},
	};
}

describe("readable interaction reports from a rendered course", () => {
	it.each([
		...["type", "learner_response", "result", "description", "weighting", "timestamp"].flatMap(
			(field) => [false, true].map((throws) => ({ format: "scorm2004", field, throws })),
		),
		...["type", "result", "weighting", "student_response"].flatMap((field) =>
			[false, true].map((throws) => ({ format: "scorm12", field, throws })),
		),
	])(
		"preserves answers and scoring when $format $field fails, throws=$throws",
		async ({ format, field, throws }) => {
			const questions = [
				choice("first", "First question", ["First answer"]),
				choice("second", "Second question", ["Second answer"]),
			];
			for (const question of questions) {
				question.data.gradingMode = "exact";
				question.data.required = true;
				question.data.response = {
					type: "choice",
					selectionMode: "single",
					options: [
						{ id: `${question.id}-option`, label: `${question.id} answer`, isCorrect: true },
					],
				};
			}
			const { dom, data, answer, rejected } = await launch(questions, format, "en", {
				field,
				throws,
			});
			const warnings = vi.spyOn(dom.window.console, "warn").mockImplementation(() => {});
			const errors: string[] = [];
			const savedInteractions = () => {
				const raw = data.get("cmi.suspend_data") ?? "{}";
				return (format === "scorm12" ? parseScorm12SuspendData(raw) : JSON.parse(raw))
					?.interactions;
			};
			dom.window.addEventListener("error", (event) => {
				errors.push(event.message);
				event.preventDefault();
			});
			try {
				await answer("first");
				expect(data.get("cmi.interactions.0.id")).toBe("first");
				expect(savedInteractions()).toEqual([
					expect.objectContaining({ id: "first", response: "first-answer", score: 100 }),
				]);
				const reportFields = {
					type: format === "scorm2004" ? "choice" : "performance",
					result: "correct",
					weighting: "100",
					...(format === "scorm2004"
						? {
								learner_response: "first-answer",
								description: "{lang=en}First question",
								timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}Z$/),
							}
						: { student_response: "first-answer" }),
				};
				for (const [name, value] of Object.entries(reportFields)) {
					expect(data.get(`cmi.interactions.0.${name}`)).toEqual(
						name === field ? undefined : value,
					);
				}
				expect(warnings).toHaveBeenCalledTimes(1);
				const diagnostic = warnings.mock.calls[0].map(String).join(" ");
				expect(diagnostic).toContain(`cmi.interactions.0.${field}`);
				expect(diagnostic).toContain(throws ? "LMS field write threw" : "351");
				await answer("second");
				expect(errors).toEqual([]);
				expect(data.get("cmi.interactions.0.id")).toBe("first");
				expect(data.get("cmi.interactions.1.id")).toBe("second");
				const responseField = format === "scorm2004" ? "learner_response" : "student_response";
				if (field === "description")
					expect(data.get(`cmi.interactions.0.${responseField}`)).toBe("first-answer");
				expect(data.get(`cmi.interactions.1.${responseField}`)).toBe("second-answer");
				expect(savedInteractions()).toEqual([
					expect.objectContaining({ id: "first", response: "first-answer", score: 100 }),
					expect.objectContaining({ id: "second", response: "second-answer", score: 100 }),
				]);
				expect(data.get(format === "scorm2004" ? "cmi.score.raw" : "cmi.core.score.raw")).toBe(
					"100",
				);
				expect(
					data.get(format === "scorm2004" ? "cmi.completion_status" : "cmi.core.lesson_status"),
				).toBe(format === "scorm2004" ? "completed" : "passed");
				if (format === "scorm2004") expect(data.get("cmi.success_status")).toBe("passed");
				if (!throws)
					expect(rejected).toEqual([
						expect.objectContaining({ key: `cmi.interactions.0.${field}`, error: 351 }),
					]);
			} finally {
				warnings.mockRestore();
				dom.window.close();
			}
		},
	);

	it.each([
		["different", ["x".repeat(260), "y".repeat(260)], `${"x".repeat(126)}[,]${"y".repeat(126)}`],
		["collision", ["x".repeat(260), "x".repeat(260)], `${"x".repeat(126)}[,]${"x".repeat(124)}-2`],
		["non-Latin", ["東京", "北京", "مرحبا"], "choice[,]choice-2[,]choice-3"],
		[
			"minimal",
			Array.from({ length: 70 }, (_, index) => `Option ${index + 1}`),
			Array.from({ length: 70 }, (_, index) => index + 1).join(","),
		],
		[
			"bitmap",
			// The encoder's comma list is 254 chars at 88 positions, 257 at 89: the first bitmap.
			Array.from({ length: 89 }, (_, index) => `Option ${index + 1}`),
			"positions-hex:ffffffffffffffffffffff1",
		],
	])("retains every SCORM 1.2 selection with %s labels", async (_name, labels, expected) => {
		const question = choice("poll", "Pick all", labels);
		// Resume all but the last option to exercise learner input at the large-selection boundary.
		const selected = (question.data.response as ChoiceResponse).options.map((option) => option.id);
		const { dom, data, answer } = await launch([question], "scorm12", "fr", undefined, {
			poll: selected.slice(0, -1),
		});
		try {
			expect(data.get("cmi.interactions.0.student_response")).toBeUndefined();
			await answer("poll");
			expect(
				Array.from(dom.window.document.querySelectorAll<HTMLInputElement>("input:checked")).map(
					(input) => input.value,
				),
			).toEqual(selected);
			expect(data.get("cmi.interactions.0.student_response")).toBe(expected);
			expect(expected.length).toBeLessThanOrEqual(255);
			expect(
				parseScorm12SuspendData(data.get("cmi.suspend_data") ?? "{}")?.interactions[0].response,
			).toBe(expected);
		} finally {
			dom.window.close();
		}
	});

	it.each([
		["fr", "{lang= fr} Quelle réponse?", "{lang=fr}{lang= fr} Quelle réponse?"],
		["fr", "À propos du télescope?", "{lang=fr}À propos du télescope?"],
		["en", "Which answer?", "{lang=en}Which answer?"],
	])("serializes literal question text in %s: %s", async (language, stem, expected) => {
		const { dom, data, answer, rejected } = await launch(
			[choice("poll", stem)],
			"scorm2004",
			language,
		);
		try {
			await answer("poll");
			expect(rejected).toEqual([]);
			expect(data.get("cmi.interactions.0.description")).toBe(expected);
		} finally {
			dom.window.close();
		}
	});

	it("uses the same decoded title for a member and its submitted group", async () => {
		const { dom, data, answer } = await launch([
			{
				id: "group",
				type: "assessmentGroup",
				data: { groupName: "Groupe &amp; **télescope**", memberBlockIds: ["poll"] },
			},
			choice("poll", ""),
		]);
		try {
			await new Promise((resolve) => dom.window.setTimeout(resolve, 160));
			await answer("poll");
			await new Promise((resolve) => dom.window.setTimeout(resolve, 160));
			const submit = dom.window.document.querySelector<HTMLButtonElement>(
				'[data-assessment-group-submit="group"] button',
			);
			expect(submit).not.toBeNull();
			expect(submit?.disabled).toBe(false);
			submit?.click();
			await new Promise((resolve) => dom.window.setTimeout(resolve, 160));
			expect(data.get("cmi.interactions.0.description")).toBe("{lang=fr}Groupe & télescope");
			expect(data.get("cmi.interactions.1.id")).toBe("group");
			expect(data.get("cmi.interactions.1.description")).toBe("{lang=fr}Groupe & télescope");
		} finally {
			dom.window.close();
		}
	});
	it("writes the authored stem, bounded description and unchanged free response to SCORM 2004", async () => {
		const { dom, data, answer } = await launch([
			choice("poll", "<p>  À propos&nbsp;des <strong>astres</strong> &amp; du télescope? </p>"),
			{
				id: "free",
				type: "assessment",
				data: {
					assessmentType: "textResponse",
					stem: [
						{ id: "free-stem", type: "text", data: { content: `<p>${"word ".repeat(60)}</p>` } },
					],
					gradingMode: "none",
					required: false,
					response: { type: "textResponse", inputType: "short" },
				},
			},
		]);
		try {
			await answer("poll");
			await answer("free", "My own answer, unchanged.");
			expect(data.get("cmi.interactions.0.id")).toBe("poll");
			expect(data.get("cmi.interactions.0.description")).toBe(
				"{lang=fr}À propos des astres & du télescope?",
			);
			expect(data.get("cmi.interactions.1.description")).toBe(
				`{lang=fr}${"word ".repeat(49).trim()}…`,
			);
			expect(data.get("cmi.interactions.1.learner_response")).toBe("My own answer, unchanged.");
			expect(data.get("cmi.interactions.1.type")).toBe("long-fill-in");
		} finally {
			dom.window.close();
		}
	});

	it.each(["scorm2004", "scorm12"])(
		"writes readable multiselect identifiers, collisions and a neutral survey to %s",
		async (format) => {
			const { dom, data, answer } = await launch([choice("poll", "Vos objectifs")], format);
			try {
				await answer("poll");
				expect(
					data.get(
						`cmi.interactions.0.${format === "scorm12" ? "student_response" : "learner_response"}`,
					),
				).toBe("ecole-astres[,]ecole-astres-2[,]ecole-astres-2-2");
				expect(data.get("cmi.interactions.0.result")).toBe("neutral");
				expect(data.get("cmi.interactions.0.type")).toBe(
					format === "scorm12" ? "performance" : "choice",
				);
				if (format === "scorm12") expect(data.has("cmi.interactions.0.description")).toBe(false);
			} finally {
				dom.window.close();
			}
		},
	);

	it("writes the readable single choice while retaining the scored result and block ID", async () => {
		const question = choice("graded", "Quel objectif?");
		question.data.gradingMode = "exact";
		question.data.response = {
			type: "choice",
			selectionMode: "single",
			options: [{ id: "opaque", label: "École & astres", isCorrect: true }],
		};
		const { dom, data, answer } = await launch([question]);
		try {
			await answer("graded");
			expect(data.get("cmi.interactions.0.id")).toBe("graded");
			expect(data.get("cmi.interactions.0.description")).toBe("{lang=fr}Quel objectif?");
			expect(data.get("cmi.interactions.0.learner_response")).toBe("ecole-astres");
			expect(data.get("cmi.interactions.0.result")).toBe("correct");
		} finally {
			dom.window.close();
		}
	});

	it("uses group then page titles for an empty stem and keeps long choice identifiers unique", async () => {
		const { dom, data, answer } = await launch([
			choice("page-question", ""),
			{
				id: "group",
				type: "assessmentGroup",
				data: { groupName: "Groupe &amp; télescope", memberBlockIds: ["group-question"] },
			},
			choice("group-question", "", ["x".repeat(260), "x".repeat(260)]),
		]);
		try {
			await answer("page-question");
			await answer("group-question");
			expect(data.get("cmi.interactions.0.description")).toBe("{lang=fr}Page & title");
			expect(data.get("cmi.interactions.1.description")).toBe("{lang=fr}Groupe & télescope");
			expect(data.get("cmi.interactions.1.learner_response")).toBe(
				`${"x".repeat(250)}[,]${"x".repeat(248)}-2`,
			);
		} finally {
			dom.window.close();
		}
	});
});
