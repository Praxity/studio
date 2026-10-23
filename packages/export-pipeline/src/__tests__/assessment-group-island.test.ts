// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { initPublishedAssessmentGroups } from "../../template/src/islands/island-assessment-group";

afterEach(() => {
	document.body.replaceChildren();
	history.replaceState(null, "", "/");
	delete window.__praxityBlockState;
});

describe("assessment group island", () => {
	it("presents an inert choose-one group without hydration or learner state", async () => {
		history.replaceState(null, "", "/?praxity-small-preview=1");
		const get = vi.fn();
		const set = vi.fn();
		window.__praxityBlockState = { get, set };
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { mode: "oneOf", memberBlockIds: ["first", "second"] },
			},
			{ id: "first", type: "assessment", data: { scored: true } },
			{ id: "second", type: "assessment", data: { scored: false } },
		];
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ blocks })}</script><main id="main-content" inert><div data-assessment-group-header="group"></div>${["first", "second"].map((id) => `<div class="praxity-block" data-island="assessment" data-block-id="${id}"><p class="praxity-assessment-stem">${id} question</p></div>`).join("")}</main>`;
		const dispose = initPublishedAssessmentGroups();
		await vi.waitFor(() => expect(document.querySelectorAll(".praxity-ag-radio")).toHaveLength(2));
		const radios = [...document.querySelectorAll<HTMLInputElement>(".praxity-ag-radio")];
		expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
		expect(radios.every((radio) => radio.disabled)).toBe(true);
		expect(document.querySelector<HTMLElement>('[data-block-id="second"]')?.style.display).toBe(
			"none",
		);
		const submit = document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn");
		expect(submit?.disabled).toBe(true);
		expect(submit?.textContent).toBe("Submit selected");
		radios[1].dispatchEvent(new Event("change"));
		submit?.dispatchEvent(new Event("click"));
		expect(get).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(radios[0].checked).toBe(true);
		dispose();
	});
	it("waits for member assessment hydration without polling", async () => {
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { groupName: "Group", mode: "all", memberBlockIds: ["question"] },
			},
			{ id: "question", type: "assessment", data: { gradingMode: "none" } },
		];
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ sourceLocale: "en", blocks })}</script><main id="main-content"><div data-island="assessmentGroup" data-assessment-group-header="group"><h2 class="praxity-assessment-group-title">Group</h2></div><div class="praxity-block praxity-block-assessment" data-island="assessment" data-block-id="question" data-assessment-group="group" data-group-first data-group-last data-group-has-footer><form><fieldset disabled><legend>Question</legend></fieldset></form></div><div class="praxity-assessment-group-submit" data-assessment-group-submit="group"><button type="button" class="praxity-ag-submit-btn" disabled>Check all</button><div data-assessment-group-results role="status" aria-atomic="true"></div></div></main>`;
		const member = document.querySelector<HTMLElement>('[data-island="assessment"]');
		const footer = document.querySelector(".praxity-assessment-group-submit");
		const dispose = initPublishedAssessmentGroups();

		expect(document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.disabled).toBe(
			true,
		);
		if (member) {
			member.innerHTML =
				'<div class="praxity-block-assessment" data-block-id="question" data-assessment-display="standard"><button type="button" data-assessment-submit="true">Check</button></div>';
		}
		member?.setAttribute("data-hydrated", "");

		await vi.waitFor(() => {
			expect(document.querySelector(".praxity-ag-submit-btn")?.textContent).toBe("Check all");
			expect(document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.disabled).toBe(
				false,
			);
		});
		expect(document.querySelectorAll(".praxity-assessment-group-submit")).toHaveLength(1);
		expect(document.querySelector(".praxity-assessment-group-submit")).toBe(footer);

		dispose();
		expect(document.querySelector(".praxity-assessment-group-submit")).toBe(footer);
		expect(document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.disabled).toBe(
			true,
		);
		const onMemberSubmit = vi.fn();
		member?.querySelector("[data-assessment-submit]")?.addEventListener("click", onMemberSubmit);
		const disposeAgain = initPublishedAssessmentGroups();
		await vi.waitFor(() =>
			expect(document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.disabled).toBe(
				false,
			),
		);
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		expect(onMemberSubmit).toHaveBeenCalledTimes(1);
		disposeAgain();
	});

	it("activates the static choose-one picker without replacing or duplicating it", async () => {
		const blocks = [
			{
				id: "group",
				type: "assessmentGroup",
				data: { mode: "oneOf", memberBlockIds: ["first", "second"] },
			},
			{ id: "first", type: "assessment", data: { gradingMode: "none" } },
			{ id: "second", type: "assessment", data: { gradingMode: "none" } },
		];
		const options = ["first", "second"]
			.map(
				(id, index) =>
					`<div class="praxity-ag-radio-row"><input id="ag-radio-group-${id}" class="praxity-ag-radio" type="radio" name="ag-group" value="${id}"${index === 0 ? " checked" : ""} disabled><label for="ag-radio-group-${id}">${id}</label></div>`,
			)
			.join("");
		document.body.innerHTML = `<script id="praxity-config" type="application/json">${JSON.stringify({ blocks })}</script><main id="main-content"><div data-assessment-group-header="group"><fieldset class="praxity-assessment-group-picker"><legend>Choose one</legend><div class="praxity-assessment-group-options">${options}</div></fieldset></div>${["first", "second"].map((id, index) => `<div class="praxity-block praxity-block-assessment" data-block-id="${id}" data-assessment-group="group"${index === 0 ? " data-group-first" : " data-group-last data-group-has-footer data-group-oneof-unselected"}><p class="praxity-assessment-stem">${id}</p><button data-assessment-submit="true">Check</button></div>`).join("")}<div class="praxity-assessment-group-submit" data-assessment-group-submit="group"><button class="praxity-ag-submit-btn" disabled>Check selected</button><div data-assessment-group-results></div></div></main>`;
		const picker = document.querySelector(".praxity-assessment-group-picker");
		const radios = [...document.querySelectorAll<HTMLInputElement>(".praxity-ag-radio")];
		const dispose = initPublishedAssessmentGroups();
		await vi.waitFor(() => expect(radios[0].disabled).toBe(false));
		expect(document.querySelector(".praxity-assessment-group-picker")).toBe(picker);
		expect(document.querySelectorAll(".praxity-ag-radio")).toHaveLength(2);
		radios[1].checked = true;
		radios[1].dispatchEvent(new Event("change"));
		expect(document.querySelector<HTMLElement>('[data-block-id="first"]')?.style.display).toBe(
			"none",
		);
		expect(document.querySelector<HTMLElement>('[data-block-id="second"]')?.style.display).toBe("");
		dispose();
		const onMemberSubmit = vi.fn();
		document
			.querySelector('[data-block-id="first"] [data-assessment-submit]')
			?.addEventListener("click", onMemberSubmit);
		const disposeAgain = initPublishedAssessmentGroups();
		await vi.waitFor(() => expect(radios[0].disabled).toBe(false));
		document.querySelector<HTMLButtonElement>(".praxity-ag-submit-btn")?.click();
		expect(onMemberSubmit).toHaveBeenCalledTimes(1);
		disposeAgain();
	});
});
