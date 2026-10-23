import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalStorageRuntime } from "../../../export-pipeline/src/scorm/local-storage-runtime";
import { createBlockStateRuntime } from "../../../export-pipeline/template/src/hosts/block-state-runtime";
import { choiceContentSignature, choiceStateQuestion } from "../assessment-choice";
import {
	choiceDependencyStatus,
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
} from "../choice-learner-state";
import { admitChoiceStateFacts } from "../choice-state-facts";
import { LocaleContext } from "../i18n/locale-context";
import { choiceEvidenceSignature } from "../learner-state";
import type { AssessmentBlockData, ChoiceResponse } from "../types";
import { PreviewAssessmentBlock } from "./AssessmentBlock";

const original: AssessmentBlockData = {
	assessmentType: "choice",
	gradingMode: "exact",
	attempts: 2,
	feedback: {},
	stem: [{ id: "stem", type: "text", data: { content: "Choose an action" } }],
	response: {
		type: "choice",
		selectionMode: "single",
		inputMethod: "click",
		display: "list",
		shuffle: false,
		options: [
			{ id: "a", label: "Stop", isCorrect: true },
			{ id: "b", label: "Continue" },
		],
	},
};
const revised: AssessmentBlockData = {
	...original,
	stem: [{ id: "stem", type: "text", data: { content: "Choose the revised action" } }],
};
const facts = (data: AssessmentBlockData) => ({
	question: choiceStateQuestion(data, false),
	signature: choiceContentSignature(data, false),
});
afterEach(() => {
	cleanup();
	localStorage.clear();
	delete window.__praxityBlockState;
});

it.each(["en", "fr"] as const)(
	"%s history has a described recovery action and retains the original answer",
	(locale) => {
		const runtime = new LocalStorageRuntime(localStorage, "course", "attempt");
		const previous = prepareChoiceAssessmentState(
			undefined,
			{
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				attemptCount: 1,
				checked: true,
				correct: true,
				completed: true,
				interacted: true,
				answer: ["a"],
			},
			facts(original),
			{ writtenAt: 1 },
		);
		runtime.setBlockState("question", JSON.parse(JSON.stringify(previous)));
		window.__praxityBlockState = createBlockStateRuntime(runtime);
		const provider = window.__praxityBlockState;
		const admitted = admitChoiceStateFacts({
			choiceStateQuestions: { question: facts(revised).question },
			choiceStateSignatures: { question: facts(revised).signature },
		});
		provider.getChoiceDependencyView = () =>
			createChoiceDependencyView(admitted, {
				rows: [{ id: "question", contentSignature: facts(original).signature, correct: true }],
				readState: provider.get,
			});
		render(
			<MantineProvider>
				<LocaleContext.Provider value={locale}>
					<PreviewAssessmentBlock
						blockId="question"
						data={revised}
						compiledChoiceFacts={facts(revised)}
					/>
				</LocaleContext.Provider>
			</MantineProvider>,
		);
		const action = screen.getByRole("button", {
			name: locale === "en" ? "New attempt" : "Nouvelle tentative",
		});
		expect(action).toHaveAccessibleDescription(
			locale === "en"
				? /This question changed after you answered it/
				: /Cette question a été modifiée/,
		);
		for (const input of screen.getAllByRole("radio")) expect(input).toBeDisabled();
		expect(runtime.getBlockState("question")).toEqual(previous);
		fireEvent.click(action);
		expect(screen.getAllByRole("radio")[0]).toHaveFocus();
		for (const input of screen.getAllByRole("radio")) expect(input).toBeEnabled();
		expect(runtime.getBlockState("question")).toEqual(previous);
		fireEvent.click(screen.getAllByRole("radio")[0]);
		expect(runtime.getBlockState("question")).toMatchObject({
			checked: false,
			attemptCount: 0,
			history: [previous],
		});
		cleanup();
		render(
			<MantineProvider>
				<LocaleContext.Provider value={locale}>
					<PreviewAssessmentBlock
						blockId="question"
						data={revised}
						compiledChoiceFacts={facts(revised)}
					/>
				</LocaleContext.Provider>
			</MantineProvider>,
		);
		expect(
			screen.queryByRole("button", {
				name: locale === "en" ? "New attempt" : "Nouvelle tentative",
			}),
		).toBeNull();
		expect(screen.getAllByRole("radio")[0]).toBeChecked();
		expect(screen.getAllByRole("radio")[0]).toBeEnabled();
		expect(choiceDependencyStatus("question", provider.getChoiceDependencyView())).toBe("history");
		const response = vi.fn();
		document.addEventListener("praxity:assessment-response", response);
		try {
			fireEvent.click(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			);
			expect(response).toHaveBeenCalledOnce();
			expect(response.mock.calls[0][0].detail).toMatchObject({
				blockId: "question",
				submitted: true,
				contentSignature: facts(revised).signature,
			});
			expect(runtime.getBlockState("question")).toMatchObject({
				checked: true,
				correct: true,
				contentSignature: facts(revised).signature,
				history: [previous],
			});
		} finally {
			document.removeEventListener("praxity:assessment-response", response);
		}
	},
);

it("a current draft cannot hide the history status of its submitted evidence", () => {
	window.__praxityBlockState = {
		get: () => ({
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 0,
			checked: false,
			correct: false,
			completed: false,
			interacted: true,
			answer: ["a"],
			contentSignature: facts(revised).signature,
		}),
		set() {},
		getChoiceDependencyView: () => ({
			questions: { question: facts(revised).question },
			signatures: { question: facts(revised).signature },
			rows: [],
			invalidIds: ["question"],
			readState: () => undefined,
		}),
	};
	render(
		<MantineProvider>
			<PreviewAssessmentBlock
				blockId="question"
				data={revised}
				compiledChoiceFacts={facts(revised)}
			/>
		</MantineProvider>,
	);
	expect(screen.getByRole("button", { name: "New attempt" })).toBeVisible();
	for (const input of screen.getAllByRole("radio")) expect(input).toBeDisabled();
});

it.each(["en", "fr"] as const)(
	"%s SCORM 1.2 added distractor shows New attempt without rewriting the answer",
	(locale) => {
		const signature = facts(original).signature;
		const contentSignature = choiceEvidenceSignature(signature, "scorm12");
		const saved = {
			version: 1,
			kind: "assessment",
			assessmentType: "choice",
			attemptCount: 1,
			checked: true,
			correct: true,
			completed: true,
			interacted: true,
			answer: ["a"],
			contentSignature,
		};
		const response = original.response as ChoiceResponse;
		const changed = {
			...original,
			response: { ...response, options: [...response.options, { id: "c", label: "Wait" }] },
		};
		const changedFacts = facts(changed);
		const admitted = admitChoiceStateFacts({
			choiceStateQuestions: { question: changedFacts.question },
			choiceStateSignatures: { question: changedFacts.signature },
		});
		const set = vi.fn();
		const evidence = createChoiceDependencyView(admitted, {
			rows: [{ id: "question", contentSignature, correct: true }],
			readState: () => saved,
		});
		window.__praxityBlockState = { get: () => saved, set, getChoiceDependencyView: () => evidence };
		render(
			<MantineProvider>
				<LocaleContext.Provider value={locale}>
					<PreviewAssessmentBlock
						blockId="question"
						data={changed}
						compiledChoiceFacts={changedFacts}
					/>
				</LocaleContext.Provider>
			</MantineProvider>,
		);
		expect(choiceDependencyStatus("question", evidence)).toBe("history");
		expect(
			screen.getByRole("button", { name: locale === "en" ? "New attempt" : "Nouvelle tentative" }),
		).toBeVisible();
		expect(screen.getByRole("radiogroup")).toHaveAccessibleDescription(
			locale === "en"
				? /This question changed after you answered it/
				: /Cette question a été modifiée/,
		);
		for (const input of screen.getAllByRole("radio")) expect(input).toBeDisabled();
		expect(set).not.toHaveBeenCalled();
	},
);
