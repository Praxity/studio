import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalStorageRuntime } from "../../../export-pipeline/src/scorm/local-storage-runtime";
import { createBlockStateRuntime } from "../../../export-pipeline/template/src/hosts/block-state-runtime";
import { choiceContentSignature, choiceStateQuestion, DONT_KNOW } from "../assessment-choice";
import {
	choiceDependencyStatus,
	createChoiceDependencyView,
	prepareChoiceAssessmentState,
} from "../choice-learner-state";
import { admitChoiceStateFacts } from "../choice-state-facts";
import { LocaleContext } from "../i18n/locale-context";
import type { LearnerStateValue } from "../learner-state";
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
	question: choiceStateQuestion(data, data._dontKnow === true),
	signature: choiceContentSignature(data, data._dontKnow === true),
});
afterEach(() => {
	cleanup();
	localStorage.clear();
	delete window.__praxityBlockState;
});

const variants = ["single", "multiple", "dontKnow"] as const;
// Independent short claims for the revised fixture, so a return to full saved or event evidence fails.
const revisedClaims = {
	single: "s96:BiNK_Ru_Zk68lN0e",
	multiple: "s96:fNrX0lOic7nXT_j6",
	dontKnow: "s96:J8UwD8ntOETjSVOb",
} as const;
it.each(
	(["en", "fr"] as const).flatMap((locale) => variants.map((variant) => ({ locale, variant }))),
)(
	"$locale $variant history has a described recovery action and retains the original answer",
	({ locale, variant }) => {
		const multiple = variant === "multiple";
		const role = multiple ? "checkbox" : "radio";
		const originalData: AssessmentBlockData = {
			...original,
			_dontKnow: variant === "dontKnow",
			response: {
				...(original.response as ChoiceResponse),
				selectionMode: multiple ? "multiple" : "single",
				options: [
					{ id: "a", label: "Stop", isCorrect: true },
					{ id: "b", label: "Continue", isCorrect: multiple },
				],
			},
		};
		const revisedData = { ...originalData, stem: revised.stem };
		const selection = multiple ? ["a", "b"] : variant === "dontKnow" ? [DONT_KNOW] : ["a"];
		const notice =
			locale === "en"
				? "This question changed after you answered it, so your earlier answer no longer counts. Select New attempt to answer it again."
				: "Cette question a été modifiée après votre réponse. Votre réponse précédente ne compte donc plus. Sélectionnez Nouvelle tentative pour y répondre de nouveau.";

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
				answer: multiple ? ["a", "b"] : ["a"],
			},
			facts(originalData),
			{ writtenAt: 1 },
		);
		runtime.setBlockState("question", JSON.parse(JSON.stringify(previous)));
		window.__praxityBlockState = createBlockStateRuntime(runtime);
		const provider = window.__praxityBlockState;
		const admitted = admitChoiceStateFacts({
			choiceStateQuestions: { question: facts(revisedData).question },
			choiceStateSignatures: { question: facts(revisedData).signature },
		});
		provider.getChoiceDependencyView = () =>
			createChoiceDependencyView(admitted, {
				rows: [
					{
						id: "question",
						contentSignature: facts(originalData).signature,
						correct: true,
					},
				],
				readState: provider.get,
			});
		render(
			<MantineProvider>
				<LocaleContext.Provider value={locale}>
					<PreviewAssessmentBlock
						blockId="question"
						data={revisedData}
						compiledChoiceFacts={facts(revisedData)}
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
		expect(screen.getByRole(multiple ? "group" : "radiogroup")).toHaveAccessibleDescription(notice);
		expect(document.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
		for (const input of screen.getAllByRole(role)) expect(input).toBeDisabled();
		expect(runtime.getBlockState("question")).toEqual(previous);
		const storedBytes = () =>
			Object.keys(localStorage)
				.sort()
				.map((key) => [key, localStorage.getItem(key)]);
		const bytes = storedBytes();
		action.focus();
		expect(action).toHaveFocus();
		let noticeMountedAtFocus = false;
		screen.getAllByRole(role)[0].addEventListener(
			"focus",
			() => {
				noticeMountedAtFocus = action.isConnected;
			},
			{ once: true },
		);
		fireEvent.click(action);
		expect(noticeMountedAtFocus).toBe(true);
		expect(screen.getAllByRole(role)[0]).toHaveFocus();
		for (const input of screen.getAllByRole(role)) expect(input).toBeEnabled();
		expect(runtime.getBlockState("question")).toEqual(previous);
		expect(storedBytes()).toEqual(bytes);
		// Merely opening recovery is not a draft. A remount still offers recovery.
		cleanup();
		const mount = () =>
			render(
				<MantineProvider>
					<LocaleContext.Provider value={locale}>
						<PreviewAssessmentBlock
							blockId="question"
							data={revisedData}
							compiledChoiceFacts={facts(revisedData)}
						/>
					</LocaleContext.Provider>
				</MantineProvider>,
			);
		mount();
		fireEvent.click(
			screen.getByRole("button", { name: locale === "en" ? "New attempt" : "Nouvelle tentative" }),
		);
		for (const id of selection) {
			const inputs = screen.getAllByRole<HTMLInputElement>(role);
			const input = inputs.find((input) => input.value === id);
			if (!input) throw new Error(`Missing choice ${id}`);
			fireEvent.click(input);
		}
		expect(runtime.getBlockState("question")).toMatchObject({
			answer: selection,
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
						data={revisedData}
						compiledChoiceFacts={facts(revisedData)}
					/>
				</LocaleContext.Provider>
			</MantineProvider>,
		);
		expect(
			screen.queryByRole("button", {
				name: locale === "en" ? "New attempt" : "Nouvelle tentative",
			}),
		).toBeNull();
		expect(
			screen
				.getAllByRole<HTMLInputElement>(role)
				.filter((input) => input.checked)
				.map((input) => input.value),
		).toEqual(selection);
		for (const input of screen.getAllByRole(role)) expect(input).toBeEnabled();
		expect(provider.getChoiceDependencyView()?.status("question")).toBe("history");
		const response = vi.fn((event: Event) => ({
			state: runtime.getBlockState("question"),
			detail: (event as CustomEvent).detail,
		}));
		document.addEventListener("praxity:assessment-response", response);
		try {
			fireEvent.click(
				screen.getByRole("button", { name: locale === "en" ? "Submit" : "Soumettre" }),
			);
			expect(response).toHaveBeenCalledOnce();
			expect(response.mock.results[0].value.state).toMatchObject({
				checked: true,
				answer: selection,
			});
			expect(response.mock.results[0].value.detail).toMatchObject({
				blockId: "question",
				submitted: true,
				contentSignature: revisedClaims[variant],
			});
			expect(runtime.getBlockState("question")).toMatchObject({
				checked: true,
				answer: selection,
				correct: variant !== "dontKnow",
				contentSignature: revisedClaims[variant],
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
			status(id) {
				return choiceDependencyStatus(id, this);
			},
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
		const contentSignature = signature;
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

// Characterization: compiled signatures alone must not select recovery or signed writes.
it.each([false, true])(
	"ordinary restoration stays selected with an empty capability: %s",
	(emptyCapability) => {
		const saved = prepareChoiceAssessmentState(
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
		const set = vi.fn();
		window.__praxityBlockState = {
			get: () => saved as unknown as LearnerStateValue,
			set,
			...(emptyCapability ? { getChoiceDependencyView: () => undefined } : {}),
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
		expect(screen.queryByRole("button", { name: "New attempt" })).toBeNull();
		expect(screen.getAllByRole("radio")[0]).toBeChecked();
		for (const input of screen.getAllByRole("radio")) expect(input).toBeDisabled();
		expect(set).not.toHaveBeenCalled();
	},
);

it("ordinary drafts and submission events retain their unsigned shape", () => {
	const set = vi.fn();
	window.__praxityBlockState = { get: () => undefined, set };
	render(
		<MantineProvider>
			<PreviewAssessmentBlock
				blockId="question"
				data={original}
				compiledChoiceFacts={facts(original)}
			/>
		</MantineProvider>,
	);
	const response = vi.fn();
	document.addEventListener("praxity:assessment-response", response);
	try {
		fireEvent.click(screen.getAllByRole("radio")[0]);
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(set).toHaveBeenCalledTimes(2);
		expect(set.mock.calls.map(([, state]) => state)).toEqual([
			{
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				attemptCount: 0,
				checked: false,
				correct: false,
				completed: false,
				interacted: true,
				answer: ["a"],
				reviewedChoiceIds: [],
			},
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
				reviewedChoiceIds: ["a"],
			},
		]);
		expect(response).toHaveBeenCalledOnce();
		expect(response.mock.calls[0][0].detail).not.toHaveProperty("contentSignature");
	} finally {
		document.removeEventListener("praxity:assessment-response", response);
	}
});
