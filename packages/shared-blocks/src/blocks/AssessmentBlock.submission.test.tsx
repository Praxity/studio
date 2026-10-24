import { MantineProvider } from "@mantine/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { scorm12CompactSuspendDataCodec } from "../../../export-pipeline/src/scorm/scorm12-suspend-data";
import { installChoiceCourseHost } from "../../../export-pipeline/tests/fixtures/choice-course-host";
import { LocaleContext } from "../i18n/locale-context";
import type { LearnerStateValue } from "../learner-state";

type SavedAssessmentState = { [key: string]: LearnerStateValue };

import type { AssessmentBlockData } from "../types";
import { PreviewAssessmentBlock } from "./AssessmentBlock";

it.each(["en", "fr"])(
	"keeps a failed full-store submission editable and permits retry and reload in %s",
	(locale) => {
		const data: AssessmentBlockData = {
			assessmentType: "choice",
			gradingMode: "exact",
			points: 100,
			attempts: 1,
			feedback: {},
			stem: [{ id: "stem", type: "text", data: { content: "Choose safely" } }],
			response: {
				type: "choice",
				selectionMode: "single",
				inputMethod: "click",
				display: "list",
				shuffle: false,
				options: [
					{ id: "stop", label: "Stop", isCorrect: true },
					{ id: "go", label: "Go" },
				],
			},
		};
		const values: Record<string, string> = {};
		Object.assign(window, {
			API: {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetValue: (key: string) => values[key] ?? "",
				LMSSetValue: (key: string, value: string) => {
					if (key === "cmi.suspend_data") expect(value.length).toBeLessThanOrEqual(4096);
					values[key] = value;
					return "true";
				},
				LMSGetLastError: () => "0",
			},
		});
		let { runtime, provider } = installChoiceCourseHost("q", data, "scorm12");
		const mount = () =>
			render(
				<MantineProvider>
					<LocaleContext.Provider value={locale}>
						<PreviewAssessmentBlock blockId="q" data={data} />
					</LocaleContext.Provider>
				</MantineProvider>,
			);
		try {
			let view = mount();
			fireEvent.click(screen.getByRole("radio", { name: /Stop/ }));
			const draft = provider.get("q") as unknown as SavedAssessmentState;
			const final = {
				...draft,
				checked: true,
				correct: true,
				completed: true,
				attemptCount: 1,
				reviewedChoiceIds: ["stop"],
			};
			const noise = Array.from({ length: 200 }, (_, n) =>
				bytesToHex(sha256(new TextEncoder().encode(`noise-${n}`))),
			).join("");
			const fits = (length: number) =>
				[draft, final].every((q) => {
					try {
						scorm12CompactSuspendDataCodec.serialize({
							visitedPages: runtime.getVisitedPages(),
							interactions: [],
							custom: JSON.stringify({
								blockState: { q, reflection: { answer: noise.slice(0, length) } },
							}),
						});
						return true;
					} catch (error) {
						if (!(error instanceof Error) || !error.message.includes("ESCORM12STORAGE"))
							throw error;
						return false;
					}
				});
			let low = 0,
				high = noise.length;
			while (low < high) {
				const mid = Math.ceil((low + high) / 2);
				if (fits(mid)) low = mid;
				else high = mid - 1;
			}
			const filler = noise.slice(0, low);
			expect(
				runtime.setSuspendData(
					JSON.stringify({ blockState: { q: draft, reflection: { answer: filler } } }),
				),
			).toBe(true);
			const before = values["cmi.suspend_data"];
			fireEvent.click(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			);
			expect(screen.getByRole("status")).toHaveTextContent(
				locale === "en"
					? "This answer could not be saved. Your previously saved progress is kept."
					: "Cette réponse n’a pas pu être enregistrée. Votre progression enregistrée précédemment est conservée.",
			);
			expect(screen.getByRole("radio", { name: /Stop/ })).toBeEnabled();
			expect(screen.getByRole("radio", { name: /Stop/ })).toBeChecked();
			expect(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			).toBeEnabled();
			expect(values["cmi.suspend_data"]).toBe(before);
			expect(provider.get("q")).toEqual(draft);
			expect(runtime.getInteractions()).toEqual([]);
			expect(document.querySelector('[data-completed="true"]')).toBeNull();
			view.unmount();
			({ runtime, provider } = installChoiceCourseHost("q", data, "scorm12"));
			view = mount();
			expect(screen.getByRole("radio", { name: /Stop/ })).toBeEnabled();
			expect(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			).toBeEnabled();
			view.unmount();
			({ runtime, provider } = installChoiceCourseHost("q", data, "scorm12"));
			view = mount();
			expect(
				runtime.setSuspendData(
					JSON.stringify({ blockState: { q: draft, reflection: { answer: "shorter" } } }),
				),
			).toBe(true);
			fireEvent.click(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			);
			expect(runtime.getInteractions()).toMatchObject([{ id: "q", correct: true, score: 100 }]);
			expect(provider.get("q")).toMatchObject({
				checked: true,
				correct: true,
				completed: true,
				attemptCount: 1,
			});
			expect(screen.queryByRole("status")).toBeNull();
			view.unmount();
			({ runtime, provider } = installChoiceCourseHost("q", data, "scorm12"));
			view = mount();
			expect(screen.getByRole("radio", { name: /Stop/ })).toBeDisabled();
			expect(
				screen.queryByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			).toBeNull();
			view.unmount();
		} finally {
			cleanup();
			delete window.__praxityBlockState;
			delete (window as Window & { API?: unknown }).API;
			vi.restoreAllMocks();
		}
	},
);
