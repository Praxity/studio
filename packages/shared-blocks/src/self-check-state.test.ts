import type { Content } from "learning-patterns/patterns/self-check/logic.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSelfCheckDraftAnswer } from "./self-check-draft";
import {
	editSelfCheckDraft,
	resetSelfCheckState,
	restoreSelfCheckState,
	selfCheckContentRevision,
	submitSelfCheck,
} from "./self-check-state";

afterEach(() => vi.unstubAllGlobals());

const content: Content = {
	task: "Explain the delay.",
	model: "The data arrived late. Could I send it Tuesday?",
	parts: [
		{ id: "reason", label: "Reason", missed: "Explain why.", evidence: "The data arrived late." },
		{ id: "date", label: "Date", missed: "Give a date.", evidence: "Tuesday" },
	],
};
const metadata = { blockId: "activity-1", language: "en" };
const revision = "sha256:123912896d5191a34d713b43436d717a6e0b76a398d4f59379f824087e650dfa";

function submitted(ticked: string[] = []) {
	const draft = editSelfCheckDraft(content, undefined, {
		answer: "The file came late. May I send it Tuesday?",
		ticked,
		shown: false,
	});
	return submitSelfCheck(content, draft.state, metadata);
}

describe("self-check state owner", () => {
	it("updates an empty draft without content while retaining opaque submitted state", () => {
		const saved = {
			version: 1,
			kind: "self-check",
			draft: { answer: "Earlier draft", ticked: ["reason"], shown: false },
			submitted: {
				answer: "Earlier comparison",
				ticked: ["date"],
				shown: true,
				contentRevision: "old-revision",
			},
		};
		expect(updateSelfCheckDraftAnswer("", saved)).toEqual({
			version: 1,
			kind: "self-check",
			draft: { answer: "", ticked: ["reason"], shown: false },
			submitted: {
				answer: "Earlier comparison",
				ticked: ["date"],
				shown: true,
				contentRevision: "old-revision",
			},
		});
		expect(saved.draft.answer).toBe("Earlier draft");
		for (const invalid of [
			undefined,
			null,
			[],
			{ version: 2, kind: "self-check", draft: {} },
			{ version: 1, kind: "self-check", draft: [] },
		]) {
			expect(updateSelfCheckDraftAnswer("A new draft", invalid)).toEqual({
				version: 1,
				kind: "self-check",
				draft: { answer: "A new draft", ticked: [], shown: false },
				submitted: null,
			});
		}
	});
	it("uses the declared semantic Content digest", () => {
		expect(selfCheckContentRevision(content)).toBe(revision);
	});
	it("hashes exact multiline Unicode Content with the independently calculated digest", () => {
		expect(
			selfCheckContentRevision({
				task: "Répondez.\n  Explain.",
				model: "Café ☕\n  😀",
				context: {
					to: "Sam ",
					initials: "S",
					subject: "Report\t2026",
					placeholder: "Answer here\n",
				},
				parts: [{ id: "word", label: "Word é", missed: "Include it.\n  Exactly.", evidence: "😀" }],
			}),
		).toBe("sha256:69402e10bc9b221a809de6f996e11b7a7b54ddc62ce1d03443b3f411bfab7356");
	});

	it("returns a content-free code when text encoding fails", () => {
		vi.stubGlobal(
			"TextEncoder",
			class {
				encode() {
					throw new Error("PRIVATE_CONTENT");
				}
			},
		);
		expect(() => selfCheckContentRevision(content)).toThrow(/^ESELFCHECKREVISION$/);
	});

	it("starts empty and saves a draft without completion or a response", () => {
		expect(restoreSelfCheckState(content, undefined)).toEqual({
			status: "empty",
			state: {
				version: 1,
				kind: "self-check",
				draft: { answer: "", ticked: [], shown: false },
				submitted: null,
			},
			recoverableAnswer: "",
			attempted: false,
			completed: false,
			response: null,
		});
		expect(
			editSelfCheckDraft(content, undefined, {
				answer: "My draft",
				ticked: ["reason"],
				shown: false,
			}),
		).toEqual({
			status: "valid",
			state: {
				version: 1,
				kind: "self-check",
				draft: { answer: "My draft", ticked: ["reason"], shown: false },
				submitted: null,
			},
			recoverableAnswer: "My draft",
			attempted: false,
			completed: false,
			response: null,
		});
	});

	it("submits with zero ticks and emits only neutral answer data", () => {
		const result = submitted();
		expect(result).toMatchObject({ status: "valid", attempted: true, completed: true });
		expect(result.state?.submitted).toEqual({
			answer: "The file came late. May I send it Tuesday?",
			ticked: [],
			shown: true,
			contentRevision: revision,
		});
		expect(result.response).toEqual({
			blockId: "activity-1",
			assessmentType: "textResponse",
			responseText: "The file came late. May I send it Tuesday?",
			questionText: "Explain the delay.",
			language: "en",
			result: "neutral",
			submitted: true,
		});
		expect(Object.keys(result.state ?? {})).toEqual(["version", "kind", "draft", "submitted"]);
		const restored = restoreSelfCheckState(content, result.state);
		expect(restored).toMatchObject({
			status: "valid",
			attempted: true,
			completed: true,
			response: null,
		});
	});

	it("keeps the previous comparison through edits, including a blank draft", () => {
		const previous = submitted(["reason"]);
		const bytes = JSON.stringify(previous.state);
		const edited = editSelfCheckDraft(content, previous.state, {
			answer: "",
			ticked: ["date"],
			shown: false,
		});
		expect(edited.state?.draft).toEqual({ answer: "", ticked: ["date"], shown: false });
		expect(edited.state?.submitted?.answer).toBe("The file came late. May I send it Tuesday?");
		expect(edited.state?.submitted?.ticked).toEqual(["reason"]);
		expect(edited).toMatchObject({ attempted: true, completed: true, response: null });
		expect(JSON.stringify(previous.state)).toBe(bytes);
		expect(() => submitSelfCheck(content, edited.state, metadata)).toThrow("ESELFCHECKANSWER");
	});

	it("replaces a comparison only on another deliberate submit", () => {
		const previous = submitted(["reason"]);
		const edited = editSelfCheckDraft(content, previous.state, {
			answer: "A revised answer",
			ticked: ["date"],
			shown: false,
		});
		const result = submitSelfCheck(content, edited.state, metadata);
		expect(result.state?.submitted).toMatchObject({
			answer: "A revised answer",
			ticked: ["date"],
			shown: true,
		});
		expect(result.response?.responseText).toBe("A revised answer");
	});

	it("Start over clears the draft, comparison and completion", () => {
		submitted(["reason", "date"]);
		expect(resetSelfCheckState()).toEqual({
			status: "empty",
			state: {
				version: 1,
				kind: "self-check",
				draft: { answer: "", ticked: [], shown: false },
				submitted: null,
			},
			recoverableAnswer: "",
			attempted: false,
			completed: false,
			response: null,
		});
	});

	it.each([
		null,
		[],
		"raw answer",
		{},
		{
			version: 9,
			kind: "self-check",
			draft: { answer: "Recover me", ticked: [], shown: false },
			submitted: null,
		},
		{
			version: 1,
			kind: "assessment",
			draft: { answer: "Recover me", ticked: [], shown: false },
			submitted: null,
		},
		{
			version: 1,
			kind: "self-check",
			draft: { answer: "Recover me", ticked: [], shown: true },
			submitted: null,
		},
		{
			version: 1,
			kind: "self-check",
			draft: { answer: "Recover me", ticked: ["reason", "reason"], shown: false },
			submitted: null,
		},
		{
			version: 1,
			kind: "self-check",
			draft: { answer: "Recover me", ticked: [], shown: false, model: "spoiler" },
			submitted: null,
		},
		{
			version: 1,
			kind: "self-check",
			draft: { answer: "Recover me", ticked: [], shown: false },
			submitted: null,
			completed: true,
		},
	])("rejects malformed or unknown state without changing it: %j", (value) => {
		const bytes = JSON.stringify(value);
		const result = restoreSelfCheckState(content, value);
		expect(result).toMatchObject({
			status: "invalid",
			state: null,
			attempted: false,
			completed: false,
			response: null,
		});
		expect(result.recoverableAnswer).toBe(
			typeof value === "object" && value !== null && "draft" in value ? "Recover me" : null,
		);
		expect(JSON.stringify(value)).toBe(bytes);
		expect(() => submitSelfCheck(content, value, metadata)).toThrow("ESELFCHECKSTATE");
	});

	it("validates both nested states, revision format and nonblank submitted answers", () => {
		const original = submitted().state;
		for (const bad of [
			{ ...original, draft: { answer: 3, ticked: [], shown: false } },
			{ ...original, submitted: { ...original?.submitted, shown: false } },
			{ ...original, submitted: { ...original?.submitted, answer: " \n\t" } },
			{ ...original, submitted: { ...original?.submitted, ticked: ["unknown"] } },
			{ ...original, submitted: { ...original?.submitted, ticked: ["date", "date"] } },
			{ ...original, submitted: { ...original?.submitted, contentRevision: "unknown" } },
			{ ...original, submitted: { ...original?.submitted, model: "spoiler" } },
		]) {
			expect(restoreSelfCheckState(content, bad)).toMatchObject({
				status: "invalid",
				state: null,
				attempted: false,
				completed: false,
				response: null,
			});
		}
	});

	it("never filters changed criterion IDs into a valid saved comparison", () => {
		const saved = submitted(["reason"]).state;
		const changed = {
			...content,
			parts: [{ ...content.parts[0], id: "replacement" }, content.parts[1]],
		};
		const bytes = JSON.stringify(saved);
		expect(restoreSelfCheckState(changed, saved)).toMatchObject({
			status: "out-of-date",
			state: null,
			recoverableAnswer: "The file came late. May I send it Tuesday?",
			attempted: false,
			completed: false,
			response: null,
		});
		expect(JSON.stringify(saved)).toBe(bytes);
		const edited = editSelfCheckDraft(changed, saved, {
			answer: "Recovered answer",
			ticked: ["replacement"],
			shown: false,
		});
		expect(edited.state?.submitted).toBeNull();
		expect(edited).toMatchObject({ status: "valid", completed: false });
	});

	it("reports a model-only edit as out of date and keeps the draft recoverable", () => {
		const saved = submitted().state;
		const changed = {
			...content,
			model: "The data arrived late. Could I send it Tuesday? Thank you.",
		};
		const restored = restoreSelfCheckState(changed, saved);
		expect(restored).toMatchObject({
			status: "out-of-date",
			recoverableAnswer: "The file came late. May I send it Tuesday?",
			attempted: false,
			completed: false,
			response: null,
		});
		expect(restored.state?.submitted?.answer).toBe("The file came late. May I send it Tuesday?");
		const edited = editSelfCheckDraft(changed, saved, {
			answer: "A new draft",
			ticked: [],
			shown: false,
		});
		expect(edited).toMatchObject({ status: "out-of-date", completed: false, response: null });
		expect(edited.state?.submitted?.answer).toBe("The file came late. May I send it Tuesday?");
		expect(submitSelfCheck(changed, edited.state, metadata)).toMatchObject({
			status: "valid",
			attempted: true,
			completed: true,
		});
	});

	it.each([
		{ ...content, task: "Explain the revised delay." },
		{ ...content, parts: [{ ...content.parts[0], label: "Cause" }, content.parts[1]] },
		{
			...content,
			parts: [{ ...content.parts[0], missed: "Give a clear reason." }, content.parts[1]],
		},
		{ ...content, parts: [{ ...content.parts[0], evidence: null }, content.parts[1]] },
		{
			...content,
			parts: [
				...content.parts,
				{ id: "polite", label: "Polite", missed: "Ask politely.", evidence: null },
			],
		},
		{ ...content, parts: [{ ...content.parts[0], id: "replacement" }, content.parts[1]] },
	])("invalidates material content edits even without saved ticks: %j", (changed) => {
		expect(restoreSelfCheckState(changed, submitted().state)).toMatchObject({
			status: "out-of-date",
			attempted: false,
			completed: false,
			response: null,
		});
	});

	it("retains comparison through criterion reorder", () => {
		const saved = submitted(["reason"]).state;
		const reordered = { ...content, parts: [content.parts[1], content.parts[0]] };
		expect(restoreSelfCheckState(reordered, saved)).toMatchObject({
			status: "valid",
			attempted: true,
			completed: true,
			response: null,
		});
	});

	it.each([
		{ ...content, task: "  Explain\n the delay.  " },
		{ ...content, model: "The data arrived late.\nCould I send it Tuesday?" },
		{ ...content, parts: [{ ...content.parts[0], label: " Reason " }, content.parts[1]] },
		{ ...content, parts: [{ ...content.parts[0], missed: "Explain\twhy." }, content.parts[1]] },
	])("invalidates exact authored whitespace edits: %j", (changed) => {
		expect(restoreSelfCheckState(changed, submitted().state)).toMatchObject({
			status: "out-of-date",
			attempted: false,
			completed: false,
			response: null,
		});
	});

	it("invalidates the reviewer's Python indentation edit", () => {
		const python: Content = {
			task: "Write Python that sends when ready, then always finishes.",
			model: "if ready:\n    send()\nfinish()",
			parts: [
				{
					id: "send",
					label: "Conditional send",
					missed: "Send only when ready.",
					evidence: "send()",
				},
			],
		};
		const draft = editSelfCheckDraft(python, undefined, {
			answer: "My Python",
			ticked: [],
			shown: false,
		});
		const saved = submitSelfCheck(python, draft.state, metadata);
		expect(
			restoreSelfCheckState(
				{ ...python, model: "if ready:\n    send()\n    finish()" },
				saved.state,
			),
		).toMatchObject({
			status: "out-of-date",
			recoverableAnswer: "My Python",
			attempted: false,
			completed: false,
			response: null,
		});
	});

	it("invalidates whitespace changes inside the exact evidence range", () => {
		const evidence: Content = {
			task: "Identify the word.",
			model: "red  blue",
			parts: [{ id: "red", label: "Word", missed: "Include the word.", evidence: "red " }],
		};
		const draft = editSelfCheckDraft(evidence, undefined, {
			answer: "red",
			ticked: [],
			shown: false,
		});
		const saved = submitSelfCheck(evidence, draft.state, metadata);
		expect(
			restoreSelfCheckState(
				{ ...evidence, parts: [{ ...evidence.parts[0], evidence: "red  " }] },
				saved.state,
			),
		).toMatchObject({
			status: "out-of-date",
			attempted: false,
			completed: false,
			response: null,
		});
	});

	it("invalidates Unicode spelling edits", () => {
		const french = { ...content, task: "Rédigez." };
		const frenchDraft = editSelfCheckDraft(french, undefined, {
			answer: "Réponse",
			ticked: [],
			shown: false,
		});
		const frenchSaved = submitSelfCheck(french, frenchDraft.state, { ...metadata, language: "fr" });
		expect(
			restoreSelfCheckState({ ...french, task: "Re\u0301digez." }, frenchSaved.state),
		).toMatchObject({
			status: "out-of-date",
			completed: false,
			response: null,
		});
	});

	it.each([{}, undefined])("submits, restores and edits without Web Crypto: %j", (crypto) => {
		const platformCrypto = globalThis.crypto;
		try {
			vi.stubGlobal("crypto", crypto);
			const saved = submitted();
			expect(saved.state?.submitted?.contentRevision).toBe(revision);
			expect(restoreSelfCheckState(content, saved.state)).toMatchObject({
				status: "valid",
				completed: true,
				response: null,
			});
			const edited = editSelfCheckDraft(content, saved.state, {
				answer: "Recovered draft",
				ticked: [],
				shown: false,
			});
			expect(edited.state?.draft.answer).toBe("Recovered draft");
			expect(edited.state?.submitted?.contentRevision).toBe(revision);
			expect(edited).toMatchObject({ status: "valid", completed: true, response: null });
		} finally {
			vi.stubGlobal("crypto", platformCrypto);
		}
	});

	it("binds optional library context to the revision", () => {
		const contextual = {
			...content,
			context: { to: "Sam", initials: "S", subject: "Report", placeholder: "Answer here" },
		};
		const draft = editSelfCheckDraft(contextual, undefined, {
			answer: "My answer",
			ticked: [],
			shown: false,
		});
		const saved = submitSelfCheck(contextual, draft.state, metadata);
		expect(
			restoreSelfCheckState(
				{ ...contextual, context: { ...contextual.context, subject: "New report" } },
				saved.state,
			),
		).toMatchObject({ status: "out-of-date", completed: false });
	});
	it("distinguishes an omitted placeholder from explicitly empty text", () => {
		const contextual = { ...content, context: { to: "Sam", initials: "S", subject: "Report" } };
		const draft = editSelfCheckDraft(contextual, undefined, {
			answer: "My answer",
			ticked: [],
			shown: false,
		});
		const saved = submitSelfCheck(contextual, draft.state, metadata);
		expect(
			restoreSelfCheckState(
				{ ...contextual, context: { ...contextual.context, placeholder: "" } },
				saved.state,
			),
		).toMatchObject({
			status: "out-of-date",
			attempted: false,
			completed: false,
			response: null,
		});
	});
	it.each(["to", "initials", "subject", "placeholder"] as const)(
		"invalidates exact context whitespace in %s",
		(field) => {
			const contextual = {
				...content,
				context: { to: "Sam", initials: "S", subject: "Report", placeholder: "Answer here" },
			};
			const draft = editSelfCheckDraft(contextual, undefined, {
				answer: "My answer",
				ticked: [],
				shown: false,
			});
			const saved = submitSelfCheck(contextual, draft.state, metadata);
			expect(
				restoreSelfCheckState(
					{
						...contextual,
						context: { ...contextual.context, [field]: `${contextual.context[field]} ` },
					},
					saved.state,
				),
			).toMatchObject({
				status: "out-of-date",
				attempted: false,
				completed: false,
				response: null,
			});
		},
	);

	it("preserves a large answer exactly without adding model or feedback", () => {
		const answer = "Long answer <script> & é\n".repeat(20000);
		const draft = editSelfCheckDraft(content, undefined, {
			answer,
			ticked: [],
			shown: false,
		});
		const saved = submitSelfCheck(content, draft.state, metadata);
		const restored = restoreSelfCheckState(content, JSON.parse(JSON.stringify(saved.state)));
		expect(restored.state?.draft.answer).toBe(answer);
		expect(restored.state?.submitted?.answer).toBe(answer);
		expect(saved.response?.responseText).toBe(answer);
		expect(restored).toMatchObject({ completed: true, response: null });
		expect(JSON.stringify(saved.state)).not.toContain(content.model);
		expect(JSON.stringify(saved.state)).not.toContain(content.parts[0].missed);
	});

	it("rejects invalid edits and invalid full content with content-free errors", () => {
		for (const draft of [
			{ answer: "draft", ticked: ["unknown"], shown: false },
			{ answer: "draft", ticked: [], shown: true },
			{ answer: "draft", ticked: [], shown: false, feedback: "spoiler" },
		])
			expect(() => editSelfCheckDraft(content, undefined, draft)).toThrow("ESELFCHECKSTATE");
		expect(() =>
			restoreSelfCheckState(
				{ ...content, parts: [{ ...content.parts[0], evidence: "SECRET_DOES_NOT_EXIST" }] },
				undefined,
			),
		).toThrow(/^ESELFCHECKCONTENT$/);
	});
});
