import { readLesson as readBlockSource } from "@praxity/grammar";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createChoiceDependencyView } from "../choice-learner-state";
import { admitChoiceStateFacts } from "../choice-state-facts";
import { getStrings } from "../i18n/strings";
import type { PraxityBlock } from "../types";
import { initAssessmentGroups, resolveAssessmentGroupLayout } from "./assessment-group-runtime";

afterEach(() => {
	document.body.replaceChildren();
	delete window.__praxityBlockState;
});

function installLearnerBlockState() {
	const values = new Map<string, unknown>();
	window.__praxityBlockState = {
		get: (blockId) => values.get(blockId) as never,
		set: (blockId, value) => values.set(blockId, value),
	};
	return values;
}

function assessmentMember(id: string, completed = false): string {
	return `<div class="praxity-block praxity-block-assessment" data-block-id="${id}"><div class="praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard" data-assessment-answered="false" data-score="100" data-max-score="100" data-passed="true"${completed ? ' data-completed="true"' : ""}><p class="praxity-assessment-stem">Question ${id}</p><input type="radio" name="${id}" aria-label="Answer ${id}"><button type="button" data-assessment-submit="true">Submit</button></div></div>`;
}

it.each([
	["mode mismatch", "all", "q1"],
	["removed oneOf member", "oneOf", "removed"],
])("starts fresh after a saved %s", async (_reason, mode, selectedMemberId) => {
	const values = installLearnerBlockState();
	const saved = {
		version: 1,
		kind: "assessmentGroup",
		mode: "oneOf",
		selectedMemberId,
		completed: true,
	};
	values.set("group", saved);
	document.body.innerHTML = assessmentMember("q1", true) + assessmentMember("q2", true);
	for (const card of document.querySelectorAll("[data-assessment-display]"))
		card.setAttribute("data-assessment-answered", "true");
	const dispose = initAssessmentGroups({
		blocks: [
			{ id: "group", type: "assessmentGroup", data: { mode, memberBlockIds: ["q1", "q2"] } },
			{ id: "q1", type: "assessment", data: { gradingMode: "exact" } },
			{ id: "q2", type: "assessment", data: { gradingMode: "exact" } },
		] as PraxityBlock[],
		root: document.body,
	});
	try {
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		expect(document.querySelector("[data-assessment-group-results]")).toBeEmptyDOMElement();
		if (mode === "oneOf")
			expect(document.querySelector<HTMLInputElement>('input[value="q1"]')).toBeChecked();
		expect(values.get("group")).toEqual(saved);
	} finally {
		dispose();
	}
});

it("picker writes retain the raw capture through the view's single preparation path", async () => {
	const values = installLearnerBlockState();
	const submitted = {
		payload: { mode: "oneOf", selectedMemberId: "q1", dependencies: [["q1", null]] },
		contentSignature: "s96:qqqqqqqqqqqqqqqq",
	};
	values.set("group", {
		version: 1,
		kind: "assessmentGroup",
		mode: "oneOf",
		selectedMemberId: "q1",
		completed: false,
		submitted,
	});
	const view = createChoiceDependencyView(admitChoiceStateFacts({}), {
		rows: [],
		readState: (id) => values.get(id) as never,
	});
	assert(window.__praxityBlockState);
	Object.assign(window.__praxityBlockState, { getChoiceDependencyView: () => view });
	const prepare = vi.spyOn(view, "prepareGroupState");
	document.body.innerHTML = assessmentMember("q1") + assessmentMember("q2");
	const dispose = initAssessmentGroups({
		blocks: [
			{
				id: "group",
				type: "assessmentGroup",
				data: { mode: "oneOf", memberBlockIds: ["q1", "q2"] },
			},
			{ id: "q1", type: "assessment", data: { gradingMode: "exact" } },
			{ id: "q2", type: "assessment", data: { gradingMode: "exact" } },
		] as PraxityBlock[],
		root: document.body,
	});
	try {
		const second = await vi.waitFor(() => {
			const input = document.querySelector<HTMLInputElement>('input[value="q2"]');
			expect(input).not.toBeNull();
			return input;
		});
		prepare.mockClear();
		second?.click();
		expect(prepare).toHaveBeenCalledOnce();
		expect(prepare.mock.calls[0][1]).not.toHaveProperty("submitted");
		expect(values.get("group")).toEqual({
			version: 1,
			kind: "assessmentGroup",
			mode: "oneOf",
			selectedMemberId: "q2",
			completed: false,
			submitted,
		});
	} finally {
		dispose();
	}
});

it.each([
	["en", 1, '1 of 2 correct, 1 "I don\'t know" · Not passed'],
	["fr", 1, "1 sur 2 correctes, 1 « Je ne sais pas » · Non réussi"],
	["en", 2, '0 of 2 correct, 2 "I don\'t know" · Not passed'],
	["fr", 2, "0 sur 2 correctes, 2 « Je ne sais pas » · Non réussi"],
])("counts unknown separately in %s with %s unknown", async (locale, unknown, sentence) => {
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { mode: "all", requireAll: true, memberBlockIds: ["q1", "q2"] },
		},
		...["q1", "q2"].map((id) => ({ id, type: "assessment", data: { gradingMode: "none" } })),
	] as PraxityBlock[];
	document.body.innerHTML = ["q1", "q2"].map((id) => assessmentMember(id, true)).join("");
	for (const [index, card] of [
		...document.querySelectorAll<HTMLElement>("[data-assessment-display]"),
	].entries()) {
		card.removeAttribute("data-score");
		card.removeAttribute("data-passed");
		card.setAttribute("data-assessment-answered", "true");
		card.setAttribute("data-result", index < Number(unknown) ? "unknown" : "correct");
	}
	const complete = vi.fn();
	document.addEventListener("praxity:assessment-group-complete", complete);
	const destroy = initAssessmentGroups({
		blocks,
		root: document.body,
		labels: getStrings(String(locale)),
	});
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() =>
		expect(document.querySelector(".praxity-ag-results-score")?.textContent).toBe(sentence),
	);
	expect(document.activeElement?.textContent).toBe(sentence);
	expect(document.activeElement).not.toHaveAttribute("role");
	expect(document.activeElement).toHaveAccessibleName("");
	expect(document.querySelector("[data-assessment-group-status]")).toBeEmptyDOMElement();
	expect(complete.mock.calls.at(-1)?.[0].detail).toMatchObject({
		passed: false,
		completed: true,
	});
	expect(complete.mock.calls.at(-1)?.[0].detail).not.toHaveProperty("unknownCount");
	destroy();
	document.removeEventListener("praxity:assessment-group-complete", complete);
});

it.each([
	["en", "What should you do?"],
	["fr", "Que devriez-vous faire ?"],
	["en", "How do $& and $$ behave?"],
	["fr", "Comment $& et $$ fonctionnent-ils ?"],
])(
	"summarizes question results and focuses review destinations in %s: %s",
	async (locale, question) => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		const ids = ["q1", "q2", "q3", "q4"];
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { mode: "all", requireAll: true, memberBlockIds: ids },
			},
			...ids.map((id) => ({ id, type: "assessment", data: { gradingMode: "exact" } })),
		] as PraxityBlock[];
		document.body.innerHTML = ids.map((id) => assessmentMember(id, true)).join("");
		const stems = document.querySelectorAll(".praxity-assessment-stem");
		for (const [index, stem] of [...stems].entries()) {
			stem.innerHTML = `${index === 1 ? question : `<span class="praxity-assessment-stem-content">${question}</span>`}<span class="praxity-required-indicator">${locale === "en" ? "Required" : "Obligatoire"}</span>`;
		}
		for (const [index, card] of [
			...document.querySelectorAll<HTMLElement>("[data-assessment-display]"),
		].entries()) {
			card.setAttribute("data-assessment-answered", "true");
			card.setAttribute("data-result", index === 3 ? "incorrect" : "correct");
			card.setAttribute("data-score", index === 3 ? "0" : "100");
			card.setAttribute("data-passed", String(index !== 3));
		}
		const complete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", complete);
		const dispose = initAssessmentGroups({
			blocks,
			root: document.body,
			labels: getStrings(locale),
		});
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		await vi.waitFor(() =>
			expect(document.querySelector(".praxity-ag-results-score")?.textContent).toContain(
				locale === "en" ? "3 of 4 correct" : "3 sur 4 correctes",
			),
		);
		expect(document.activeElement).toBe(document.querySelector(".praxity-ag-results-score"));
		expect(
			document.querySelector(".praxity-ag-results-title, [data-assessment-group-results] ul"),
		).toBeNull();
		const links = [
			...document.querySelectorAll<HTMLAnchorElement>("[data-assessment-group-results] a"),
		];
		expect(links.map((link) => link.textContent)).toEqual(
			ids.map((_, index) =>
				locale === "en"
					? `Question ${index + 1}: ${question}`
					: `Question ${index + 1}\u00a0: ${question}`,
			),
		);
		expect(new Set(links.map((link) => link.textContent)).size).toBe(4);
		const liveSelector = '[aria-live], [role="status"]';
		expect(links.every((link) => link.closest(liveSelector) === null)).toBe(true);
		const summary = document.querySelector(".praxity-ag-results-score");
		expect(summary?.closest(liveSelector)).toBeNull();
		expect(document.activeElement).toBe(summary);
		expect(document.querySelector('[role="status"]')).toBeEmptyDOMElement();
		for (const [index, link] of links.entries()) {
			link.click();
			expect(document.activeElement).toBe(
				document.querySelector(`[data-block-id="${ids[index]}"] .praxity-assessment-stem`),
			);
		}
		expect(complete.mock.calls[0][0].detail).toMatchObject({
			score: 75,
			passed: false,
			completed: true,
			memberCount: 4,
		});
		dispose();
		document.removeEventListener("praxity:assessment-group-complete", complete);
	},
);

it.each([
	["open response", { gradingMode: "none", assessmentType: "textResponse" }, false],
	["scored question", { gradingMode: "exact", assessmentType: "choice" }, true],
	[
		"unscored auto-check",
		{
			gradingMode: "none",
			assessmentType: "choice",
			response: { type: "choice", options: [{ isCorrect: true }] },
		},
		true,
	],
	[
		"unscored survey",
		{
			gradingMode: "none",
			assessmentType: "choice",
			response: { type: "choice", options: [{ isCorrect: false }] },
		},
		false,
	],
] as const)("shows group progress for %s", async (_name, memberData, showProgress) => {
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { groupName: "Journal", memberBlockIds: ["q1"] },
		},
		{ id: "q1", type: "assessment", data: memberData },
	] as PraxityBlock[];
	document.body.innerHTML = `<div data-assessment-group-header="group" aria-labelledby="title progress"><h2 id="title" class="praxity-assessment-group-title">Journal</h2><p id="progress" data-assessment-group-progress>Questions completed: 0 of 1</p></div>${assessmentMember("q1")}`;
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	expect(document.querySelector<HTMLElement>("[data-assessment-group-progress]")?.hidden).toBe(
		!showProgress,
	);
	dispose();
});

it("offers one journal download control for two configured responses", async () => {
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { groupName: "Journal", memberBlockIds: ["q1", "q2"] },
		},
		...["q1", "q2"].map((id) => ({
			id,
			type: "assessment",
			data: {
				assessmentType: "textResponse",
				gradingMode: "none",
				response: { type: "textResponse", downloadAs: "both" },
			},
		})),
	] as PraxityBlock[];
	document.body.innerHTML = `<div data-assessment-group-header="group"><h2 class="praxity-assessment-group-title">Journal</h2></div>${["q1", "q2"].map((id, index) => `<div class="praxity-block praxity-block-assessment" data-block-id="${id}"><div class="praxity-block-assessment" data-block-id="${id}" data-assessment-display="standard"><p class="praxity-assessment-stem">${index ? "Action plan" : "Reflection"}</p><div class="praxity-assessment-stem-body"><p>${index ? "Choose one step." : "Consider the day."}</p><p>${index ? "Name a date." : "Name a change."}</p></div><textarea>${index ? "Act tomorrow" : "Think today"}</textarea><div class="praxity-text-response-downloads"><button>TXT</button><button>DOCX</button></div></div></div>`).join("")}`;
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() =>
		expect(document.querySelectorAll("[data-assessment-group-download] button")).toHaveLength(2),
	);
	const downloads = [
		...document.querySelectorAll<HTMLButtonElement>("[data-assessment-group-download] button"),
	];
	expect(downloads.map((button) => button.textContent)).toEqual([
		"Download as text",
		"Download as Word",
	]);
	expect(downloads.every((button) => button.classList.contains("praxity-btn-outline"))).toBe(true);
	expect(
		document.querySelectorAll<HTMLElement>(".praxity-text-response-downloads[hidden]"),
	).toHaveLength(2);
	expect(
		document.querySelector<HTMLButtonElement>(
			'[data-assessment-group-download] button[aria-label*="Journal"]',
		),
	).not.toBeNull();
	let blob: Blob | undefined;
	const create = vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
		blob = value as Blob;
		return "blob:journal";
	});
	const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	document
		.querySelector<HTMLButtonElement>('[data-assessment-group-download] button[aria-label*="text"]')
		?.click();
	await vi.waitFor(() => expect(blob).toBeDefined());
	expect(await blob?.text()).toBe(
		"Reflection\n\nConsider the day.\n\nName a change.\n\nThink today\n\nAction plan\n\nChoose one step.\n\nName a date.\n\nAct tomorrow\n",
	);
	blob = undefined;
	document
		.querySelector<HTMLButtonElement>('[data-assessment-group-download] button[aria-label*="Word"]')
		?.click();
	await vi.waitFor(() => expect(blob).toBeDefined());
	const reader = new FileReader();
	const bytes = await new Promise<Uint8Array>((resolve) => {
		reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
		reader.readAsArrayBuffer(blob as Blob);
	});
	const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
	expect(xml.indexOf("Reflection")).toBeLessThan(xml.indexOf("Consider the day."));
	expect(xml.indexOf("Consider the day.")).toBeLessThan(xml.indexOf("Name a change."));
	expect(xml.indexOf("Name a change.")).toBeLessThan(xml.indexOf("Think today"));
	expect(xml.indexOf("Action plan")).toBeLessThan(xml.indexOf("Choose one step."));
	expect(xml.indexOf("Choose one step.")).toBeLessThan(xml.indexOf("Name a date."));
	expect(xml.indexOf("Name a date.")).toBeLessThan(xml.indexOf("Act tomorrow"));
	create.mockRestore();
	click.mockRestore();
	dispose();
});

it("keeps the item download when only one group member enables it", async () => {
	const blocks = [
		{ id: "group", type: "assessmentGroup", data: { memberBlockIds: ["q1", "q2"] } },
		{ id: "q1", type: "assessment", data: { response: { downloadAs: "txt" } } },
		{ id: "q2", type: "assessment", data: {} },
	] as PraxityBlock[];
	document.body.innerHTML = assessmentMember("q1") + assessmentMember("q2");
	const itemControls = document.createElement("div");
	itemControls.className = "praxity-text-response-downloads";
	document.querySelector('[data-block-id="q1"] [data-assessment-display]')?.append(itemControls);
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	expect(document.querySelector("[data-assessment-group-download]")).toBeNull();
	expect(itemControls.hidden).toBe(false);
	dispose();
});

it("combines two downloads in a mixed group while keeping its counter and submission", async () => {
	const blocks = [
		{ id: "group", type: "assessmentGroup", data: { memberBlockIds: ["scored", "q1", "q2"] } },
		{ id: "scored", type: "assessment", data: { gradingMode: "exact", assessmentType: "choice" } },
		...["q1", "q2"].map((id) => ({
			id,
			type: "assessment",
			data: {
				gradingMode: "none",
				assessmentType: "textResponse",
				response: { downloadAs: "txt" },
			},
		})),
	] as PraxityBlock[];
	document.body.innerHTML = `<div data-assessment-group-header="group"><p data-assessment-group-progress>Questions completed: 0 of 3</p></div>${assessmentMember("scored")}${assessmentMember("q1")}${assessmentMember("q2")}`;
	const itemControls = ["q1", "q2"].map((id) => {
		const controls = document.createElement("div");
		controls.className = "praxity-text-response-downloads";
		document.querySelector(`[data-block-id="${id}"] [data-assessment-display]`)?.append(controls);
		return controls;
	});
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	expect(document.querySelectorAll("[data-assessment-group-download] button")).toHaveLength(1);
	expect(itemControls.every((controls) => controls.hidden)).toBe(true);
	expect(document.querySelector<HTMLElement>("[data-assessment-group-progress]")?.hidden).toBe(
		false,
	);
	const completed = vi.fn();
	document.addEventListener("praxity:assessment-group-complete", completed);
	document.querySelectorAll<HTMLElement>("[data-assessment-display]").forEach((card) => {
		card.setAttribute("data-assessment-answered", "true");
		card
			.querySelector("[data-assessment-submit]")
			?.addEventListener("click", () => card.setAttribute("data-completed", "true"));
	});
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
	expect(completed.mock.calls[0][0].detail.completed).toBe(true);
	document.removeEventListener("praxity:assessment-group-complete", completed);
	dispose();
});

it("keeps the group action after required completion with an optional member empty", async () => {
	const values = installLearnerBlockState();
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { memberBlockIds: ["required", "optional"], showResultsSummary: false },
		},
		{ id: "required", type: "assessment", data: { gradingMode: "none", required: true } },
		{ id: "optional", type: "assessment", data: { gradingMode: "none", required: false } },
	] as PraxityBlock[];
	document.body.innerHTML = assessmentMember("required") + assessmentMember("optional");
	const required = document.querySelector<HTMLElement>(
		'[data-block-id="required"] [data-assessment-display]',
	);
	assert(required);
	required.setAttribute("data-assessment-answered", "true");
	required
		.querySelector("[data-assessment-submit]")
		?.addEventListener("click", () => required.setAttribute("data-completed", "true"));
	const completed = vi.fn();
	document.addEventListener("praxity:assessment-group-complete", completed);
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(values.get("group")).toMatchObject({ completed: true }));
	expect(completed.mock.calls[0][0].detail.completed).toBe(true);
	expect(
		document.querySelector('[data-block-id="optional"] [data-assessment-display]'),
	).not.toHaveAttribute("data-completed");
	expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	document.removeEventListener("praxity:assessment-group-complete", completed);
	dispose();
	const restore = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	restore();
});

it("keeps a group with no required members open while one response is empty", async () => {
	const values = installLearnerBlockState();
	const blocks = [
		{ id: "group", type: "assessmentGroup", data: { memberBlockIds: ["first", "second"] } },
		{ id: "first", type: "assessment", data: { gradingMode: "none" } },
		{ id: "second", type: "assessment", data: { gradingMode: "none" } },
	] as PraxityBlock[];
	document.body.innerHTML = assessmentMember("first") + assessmentMember("second");
	document
		.querySelector('[data-block-id="first"] [data-assessment-display]')
		?.setAttribute("data-completed", "true");
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(values.get("group")).toMatchObject({ completed: false }));
	expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	dispose();
});

it("waits for unanswered graded members when no question is required", async () => {
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { memberBlockIds: ["first", "second"], passingScore: 70 },
		},
		{ id: "first", type: "assessment", data: { gradingMode: "exact", required: false } },
		{ id: "second", type: "assessment", data: { gradingMode: "exact", required: false } },
	] as PraxityBlock[];
	document.body.innerHTML = assessmentMember("first", true) + assessmentMember("second");
	document
		.querySelector('[data-block-id="first"] [data-assessment-display]')
		?.setAttribute("data-assessment-answered", "true");
	const second = document.querySelector<HTMLElement>(
		'[data-block-id="second"] [data-assessment-display]',
	);
	assert(second);
	second.setAttribute("data-score", "0");
	second.setAttribute("data-passed", "false");
	const onSubmit = vi.fn(() => {
		second.setAttribute("data-result", "incorrect");
		second.setAttribute("data-completed", "true");
	});
	second.querySelector("[data-assessment-submit]")?.addEventListener("click", onSubmit);
	const onComplete = vi.fn();
	document.addEventListener("praxity:assessment-group-complete", onComplete);
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await new Promise((resolve) => setTimeout(resolve, 150));
	expect(onSubmit).not.toHaveBeenCalled();
	expect(onComplete).not.toHaveBeenCalled();
	expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	second.setAttribute("data-assessment-answered", "true");
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
	expect(onComplete.mock.calls[0][0].detail).toMatchObject({ score: 50, passed: false });
	document.removeEventListener("praxity:assessment-group-complete", onComplete);
	dispose();
});

describe("initAssessmentGroups", () => {
	it.each([false, true])(
		"frames context before and between questions (slots: %s)",
		async (slots) => {
			const blocks = [
				{ id: "before", type: "text", data: {} },
				{
					id: "group",
					type: "assessmentGroup",
					data: { memberBlockIds: ["q1", "q2"] },
				},
				{ id: "intro", type: "text", data: {} },
				{ id: "q1", type: "assessment", data: { layout: "wide" } },
				{ id: "context", type: "text", data: {} },
				{ id: "q2", type: "assessment", data: {} },
				{ id: "after", type: "text", data: {} },
			] as PraxityBlock[];
			document.body.innerHTML = blocks
				.map((block) => {
					const html =
						block.type === "assessment"
							? assessmentMember(block.id)
							: `<div class="praxity-block" data-block-id="${block.id}">${block.id}</div>`;
					return slots ? `<div class="praxity-block-slot">${html}</div>` : html;
				})
				.join("");
			const dispose = initAssessmentGroups({ blocks, root: document.body, readOnly: true });
			await vi.waitFor(() =>
				expect(document.querySelectorAll("[data-assessment-group-context]")).toHaveLength(2),
			);
			const context = [...document.querySelectorAll("[data-assessment-group-context]")];
			expect(context.map((el) => el.getAttribute("data-block-id"))).toEqual(["intro", "context"]);
			for (const el of context) expect(el).toHaveClass("praxity-layout-wide");
			for (const id of ["group", "q1", "q2"]) {
				expect(document.querySelector(`[data-block-id="${id}"]`)).toHaveClass(
					"praxity-layout-wide",
				);
			}
			expect(document.querySelector("[data-assessment-group-submit]")).toHaveClass(
				"praxity-layout-wide",
			);
			expect(document.querySelector('[data-block-id="q2"]')?.nextElementSibling).toHaveAttribute(
				"data-assessment-group-submit",
				"group",
			);
			dispose();
			expect(document.querySelectorAll("[data-assessment-group-context]")).toHaveLength(0);
			for (const el of context) expect(el).not.toHaveClass("praxity-layout-wide");
		},
	);

	it.each([false, true])(
		"frames floated context once and restores its layout (slots: %s)",
		async (slots) => {
			const blocks = [
				{ id: "group", type: "assessmentGroup", data: { memberBlockIds: ["q1"] } },
				{ id: "image", type: "image", data: {} },
				{ id: "context", type: "text", data: {} },
				{ id: "q1", type: "assessment", data: { layout: "wide" } },
			] as PraxityBlock[];
			const context = ["image", "context"]
				.map((id) => {
					const block = `<div class="praxity-block praxity-layout-wide" data-block-id="${id}">${id}</div>`;
					return slots ? `<div class="praxity-block-slot">${block}</div>` : block;
				})
				.join("");
			document.body.innerHTML = `<div class="praxity-block" data-block-id="group"></div><div class="praxity-float-region">${context}</div>${assessmentMember("q1")}`;
			const dispose = initAssessmentGroups({ blocks, root: document.body, readOnly: true });
			await vi.waitFor(() =>
				expect(document.querySelectorAll("[data-assessment-group-context]")).toHaveLength(1),
			);
			const region = document.querySelector(".praxity-float-region");
			expect(region).toHaveAttribute("data-assessment-group-context", "group");
			expect(region).toHaveClass("praxity-layout-wide");
			expect(region?.querySelectorAll(".praxity-layout-wide")).toHaveLength(0);
			dispose();
			expect(region).not.toHaveAttribute("data-assessment-group-context");
			expect(region).not.toHaveClass("praxity-layout-wide");
			expect(region?.querySelectorAll(".praxity-layout-wide")).toHaveLength(2);
		},
	);

	it("uses the widest member layout unless the group specifies its own", () => {
		const group = {
			id: "g",
			type: "assessmentGroup",
			data: { memberBlockIds: ["a", "b"] },
		} as PraxityBlock;
		const members = [
			{ id: "a", type: "assessment", data: { layout: "wide" } },
			{ id: "b", type: "assessment", data: { layoutMode: "breakout" } },
		] as PraxityBlock[];
		expect(resolveAssessmentGroupLayout(group, members)).toBe("breakout");
		expect(
			resolveAssessmentGroupLayout({ ...group, data: { ...group.data, layout: "wide" } }, members),
		).toBe("wide");
	});

	it("keeps normal members wider than narrow members unless the group owns narrow", () => {
		const group = {
			id: "g",
			type: "assessmentGroup",
			data: { memberBlockIds: ["a", "b"] },
		} as PraxityBlock;
		const members = [
			{ id: "a", type: "assessment", data: { layout: "narrow" } },
			{ id: "b", type: "assessment", data: {} },
		] as PraxityBlock[];
		expect(resolveAssessmentGroupLayout(group, members)).toBeNull();
		expect(
			resolveAssessmentGroupLayout(
				{ ...group, data: { ...group.data, layout: "narrow" } },
				members,
			),
		).toBe("narrow");
		members[1].data.layoutMode = "narrow";
		expect(resolveAssessmentGroupLayout(group, members)).toBe("narrow");
	});

	it("ignores malformed saved group and member layout data", () => {
		expect(
			resolveAssessmentGroupLayout(
				{ id: "group", type: "assessmentGroup", data: null } as unknown as PraxityBlock,
				[{ id: "q1", type: "assessment", data: null } as unknown as PraxityBlock],
			),
		).toBeNull();
	});

	it("creates a submit control for a named member parsed from grammar", async () => {
		const { blocks, warnings } = readBlockSource(
			"# Check {hideTitle}\n\n::: group Check {mode=all requireAll=false}\n::: choice Question {name=example}\n(x) Yes\n( ) No\n:::\n:::\n",
		);
		expect(warnings).toEqual([]);
		const member = blocks.find((block) => block.type === "assessment");
		if (!member) throw new Error("Missing fixture assessment");
		document.body.innerHTML = assessmentMember(member.id);
		document
			.querySelector("[data-assessment-display]")
			?.setAttribute("data-assessment-answered", "true");
		const dispose = initAssessmentGroups({ blocks, root: document.body });
		await vi.waitFor(() =>
			expect(document.querySelectorAll(".praxity-ag-submit-btn")).toHaveLength(1),
		);
		const submit = document.querySelector<HTMLButtonElement>('[data-assessment-submit="true"]');
		const onSubmit = vi.fn();
		submit?.addEventListener("click", onSubmit);
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		expect(onSubmit).toHaveBeenCalledOnce();
		dispose();
	});

	it("round-trips one-of selection and completion without replaying completion", async () => {
		const values = installLearnerBlockState();
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: {
					groupName: "Safety check",
					mode: "oneOf",
					memberBlockIds: ["q1", "q2"],
					showResultsSummary: true,
				},
			},
			{ id: "q1", type: "assessment", data: { gradingMode: "exact" } },
			{ id: "q2", type: "assessment", data: { gradingMode: "exact" } },
		] as PraxityBlock[];
		const renderDom = (completedId?: string) => {
			document.body.innerHTML = `<main id="root"><div role="group" data-assessment-group-header="group"><h2 class="praxity-assessment-group-title">Safety check</h2><p data-assessment-group-progress>Questions completed: 0 of 2</p></div>${assessmentMember("q1", completedId === "q1")}${assessmentMember("q2", completedId === "q2")}</main>`;
			if (completedId)
				document
					.querySelector(`[data-block-id="${completedId}"] [data-assessment-display]`)
					?.setAttribute("data-assessment-answered", "true");
			return document.getElementById("root") as HTMLElement;
		};

		const firstRoot = renderDom();
		firstRoot
			.querySelectorAll<HTMLButtonElement>('[data-assessment-submit="true"]')
			.forEach((button) => {
				button.addEventListener("click", () => {
					button.parentElement?.setAttribute("data-completed", "true");
				});
			});
		const firstDispose = initAssessmentGroups({ blocks, root: firstRoot });
		const secondChoice = await vi.waitFor(() => {
			const input = firstRoot.querySelector<HTMLInputElement>('input[value="q2"]');
			expect(input).not.toBeNull();
			return input;
		});
		expect(
			[...firstRoot.querySelectorAll(".praxity-ag-radio-label")].map((label) => label.textContent),
		).toEqual(["Question q1", "Question q2"]);
		expect(secondChoice).not.toBeNull();
		secondChoice?.click();
		(firstRoot.querySelector(".praxity-ag-submit-btn") as HTMLButtonElement).click();
		await vi.waitFor(() =>
			expect(values.get("group")).toMatchObject({
				selectedMemberId: "q2",
				completed: true,
			}),
		);
		firstDispose();

		const restoredRoot = renderDom("q2");
		const onComplete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", onComplete);
		const dispose = initAssessmentGroups({ blocks, root: restoredRoot });

		await vi.waitFor(() =>
			expect(restoredRoot.querySelector<HTMLInputElement>('input[value="q2"]')).toBeChecked(),
		);
		expect(
			restoredRoot.querySelector<HTMLElement>('[data-block-id="q1"]')?.closest(".praxity-block"),
		).toHaveStyle({ display: "none" });
		expect(restoredRoot.querySelector(".praxity-ag-submit-btn")).toBeNull();
		expect(restoredRoot.querySelector("[data-assessment-group-results]")).toHaveTextContent(
			"Score: 100% - Passed",
		);
		expect(onComplete).not.toHaveBeenCalled();

		dispose();
		document.removeEventListener("praxity:assessment-group-complete", onComplete);
	});

	it("focuses the first unanswered control and emits completion once", async () => {
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		document.body.innerHTML = `<main id="root"><div role="group" data-assessment-group-header="group"><h2 class="praxity-assessment-group-title">Safety check</h2><p data-assessment-group-progress>Questions completed: 0 of 2</p></div>${assessmentMember("q1")}${assessmentMember("q2")}</main>`;
		const root = document.getElementById("root") as HTMLElement;
		root
			.querySelectorAll<HTMLButtonElement>('[data-assessment-submit="true"]')
			.forEach((button) => {
				button.addEventListener("click", () => {
					button.parentElement?.setAttribute("data-completed", "true");
				});
			});
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: {
					groupName: "Safety check",
					mode: "all",
					memberBlockIds: ["q1", "q2"],
					requireAll: true,
					showResultsSummary: true,
				},
			},
			{ id: "q1", type: "assessment", data: { gradingMode: "exact" } },
			{ id: "q2", type: "assessment", data: { gradingMode: "exact" } },
		] as PraxityBlock[];
		const onComplete = vi.fn();
		document.addEventListener("praxity:assessment-group-complete", onComplete);
		const dispose = initAssessmentGroups({ blocks, root });

		await vi.waitFor(() => {
			expect(root.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
		});
		(root.querySelector(".praxity-ag-submit-btn") as HTMLButtonElement).click();
		const firstInput = root.querySelector<HTMLInputElement>('[name="q1"]');
		expect(document.activeElement).toBe(firstInput);
		expect(firstInput).toHaveAttribute("aria-invalid", "true");
		expect(firstInput).toHaveAttribute("aria-required", "true");
		expect(root.querySelector('[role="alert"]')).toHaveTextContent(
			"Answer all required questions before submitting.",
		);
		expect(onComplete).not.toHaveBeenCalled();

		root
			.querySelectorAll<HTMLElement>("[data-assessment-display]")
			.forEach((member) => member.setAttribute("data-assessment-answered", "true"));
		(root.querySelector(".praxity-ag-submit-btn") as HTMLButtonElement).click();

		await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
		expect(root.querySelector(".praxity-ag-submit-btn")).toBeNull();
		expect(root.querySelector("[data-assessment-group-results]")).toHaveTextContent(
			"Score: 100% - Passed",
		);

		dispose();
		document.removeEventListener("praxity:assessment-group-complete", onComplete);
	});

	it("checks an answered member in a graded group without requireAll", async () => {
		const blocks = [
			{ id: "group", type: "assessmentGroup", data: { memberBlockIds: ["q1", "q2"] } },
			...["q1", "q2"].map((id) => ({ id, type: "assessment", data: { gradingMode: "exact" } })),
		] as PraxityBlock[];
		document.body.innerHTML = assessmentMember("q1") + assessmentMember("q2");
		const submit = vi.fn();
		document
			.querySelector('[data-block-id="q1"] [data-assessment-submit]')
			?.addEventListener("click", submit);
		const dispose = initAssessmentGroups({ blocks, root: document.body });
		await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
		document
			.querySelector('[data-block-id="q1"] [data-assessment-display]')
			?.setAttribute("data-assessment-answered", "true");
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		expect(submit).toHaveBeenCalledOnce();
		expect(document.querySelector('[role="alert"]')).toBeNull();
		dispose();
	});
});

it("reports aggregate attempts and threshold passes while keeping retry submission available", async () => {
	const blocks = [
		{
			id: "group",
			type: "assessmentGroup",
			data: { mode: "all", passingScore: 50, memberBlockIds: ["q1", "q2"], requireAll: false },
		},
		...["q1", "q2"].map((id) => ({ id, type: "assessment", data: { gradingMode: "exact" } })),
	] as PraxityBlock[];
	document.body.innerHTML = assessmentMember("q1", true) + assessmentMember("q2");
	document
		.querySelector('[data-block-id="q1"] [data-assessment-display]')
		?.setAttribute("data-assessment-answered", "true");
	const second = document.querySelector<HTMLElement>(
		'[data-block-id="q2"] [data-assessment-display]',
	);
	assert(second);
	second.setAttribute("data-assessment-answered", "true");
	second.setAttribute("data-result", "incorrect");
	second.setAttribute("data-score", "0");
	second.setAttribute("data-passed", "false");
	const onComplete = vi.fn();
	document.addEventListener("praxity:assessment-group-complete", onComplete);
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
	expect(onComplete.mock.calls[0][0].detail).toMatchObject({
		score: 50,
		passed: true,
		completed: false,
		memberIds: ["q1", "q2"],
	});
	expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	second.setAttribute("data-result", "correct");
	second.setAttribute("data-score", "100");
	second.setAttribute("data-passed", "true");
	second.setAttribute("data-completed", "true");
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
	expect(onComplete.mock.calls[1][0].detail).toMatchObject({
		score: 100,
		passed: true,
		completed: true,
	});
	expect(document.querySelector(".praxity-ag-submit-btn")).toBeNull();
	dispose();
	document.removeEventListener("praxity:assessment-group-complete", onComplete);
});

it("reports failed ungraded knowledge checks without labelling them completed or inventing scores", async () => {
	const blocks = [
		{ id: "group", type: "assessmentGroup", data: { mode: "oneOf", memberBlockIds: ["check"] } },
		{ id: "check", type: "assessment", data: { gradingMode: "none" } },
	] as PraxityBlock[];
	document.body.innerHTML = assessmentMember("check");
	const card = document.querySelector<HTMLElement>("[data-assessment-display]");
	assert(card);
	for (const attribute of ["data-score", "data-max-score", "data-passed"])
		card.removeAttribute(attribute);
	card.setAttribute("data-result", "incorrect");
	const complete = vi.fn();
	document.addEventListener("praxity:assessment-group-complete", complete);
	const dispose = initAssessmentGroups({ blocks, root: document.body });
	await vi.waitFor(() => expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull());
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
	expect(complete.mock.calls[0][0].detail).toMatchObject({
		passed: false,
		correct: false,
		completed: false,
	});
	expect(complete.mock.calls[0][0].detail).not.toHaveProperty("score");
	expect(document.querySelector(".praxity-ag-results-score")?.textContent).toBe(
		"0 of 1 correct · Not passed",
	);
	expect(document.querySelector(".praxity-ag-submit-btn")).not.toBeNull();
	card.setAttribute("data-completed", "true");
	document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
	await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
	expect(complete.mock.calls[1][0].detail).toMatchObject({ passed: false, completed: true });
	dispose();
	document.removeEventListener("praxity:assessment-group-complete", complete);
});
