import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRequiredValidation, showRequiredValidation } from "../viewer/required-blocks.ts";
import { initDomLogicRuntime } from "./dom-logic-runtime.ts";

const config = {
	courseId: "logic-test",
	pageId: "page-1",
	pageIdMap: { "page-2": "next" },
	blocks: [
		{ id: "rating", type: "rating", data: {} },
		{ id: "reveal", type: "text", data: {} },
		{ id: "conditional", type: "text", data: {} },
		{ id: "next", type: "heading", data: { level: 2 } },
	],
	logic: {
		variables: [
			{ name: "flag", dataType: "boolean", defaultValue: false },
			{ name: "stored", dataType: "boolean", defaultValue: false },
		],
		visibility: [
			{
				blockId: "conditional",
				conditions: {
					operator: "and",
					rules: [{ source: "variable:flag", comparison: "is", value: true }],
				},
			},
		],
		rules: [
			{
				blockId: "hide-reveal",
				conditions: {
					operator: "and",
					rules: [{ source: "block:rating", field: "ratingScore", comparison: "lt", value: 3 }],
				},
				actions: [{ type: "hide", target: "reveal" }],
			},
			{
				blockId: "persist-variable",
				conditions: {
					operator: "and",
					rules: [{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 5 }],
				},
				actions: [{ type: "setVariable", target: "stored", value: true }],
			},
		],
	},
};

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
	Element.prototype,
	"scrollIntoView",
);

let runtime: ReturnType<typeof initDomLogicRuntime>;

beforeEach(() => {
	localStorage.clear();
	document.body.innerHTML = `
		<main id="praxity-root">
			<div class="praxity-block" data-block-id="rating" data-rating-value="5"></div>
			<div class="praxity-block" data-block-id="reveal"><button type="button">Current</button></div>
			<div class="praxity-block" data-block-id="conditional">
				<span data-mention="variable:flag" data-fallback="missing"></span>
			</div>
			<div class="praxity-block" data-block-id="next"><h2>Next section</h2></div>
		</main>`;
	delete (window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime;
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		callback(0);
		return 1;
	});
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	clearRequiredValidation();
	runtime?.destroy();
	runtime = null;
	vi.restoreAllMocks();
	if (scrollIntoViewDescriptor) {
		Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
	} else {
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	}
});

describe("initDomLogicRuntime", () => {
	it("refreshes restored fields on hydration without replaying rule actions", async () => {
		document.body.innerHTML = `
			<div class="praxity-block" data-island="assessment" data-block-id="gate"></div>
			<div class="praxity-block" data-block-id="conditional" hidden><span data-mention="blockOutput:gate:passed"></span></div>
			<nav id="navigation" data-island="nav"></nav>
			<button data-continue-button>Continue</button>`;
		runtime = initDomLogicRuntime({
			...config,
			blocks: [
				{ id: "gate", type: "assessment", data: {} },
				{ id: "conditional", type: "text", data: {} },
			],
			logic: {
				variables: [{ name: "count", dataType: "number", defaultValue: 0 }],
				rules: [
					{
						blockId: "increment",
						conditions: {
							operator: "and",
							rules: [{ source: "variable:count", comparison: "gte", value: 0 }],
						},
						actions: [
							{ type: "setVariable", target: "count", value: { operation: "add", operand: 1 } },
						],
					},
					{
						blockId: "gate-actions",
						conditions: {
							operator: "and",
							rules: [{ source: "block:gate", field: "passed", comparison: "is", value: true }],
						},
						actions: [
							{ type: "jumpToPage", target: "page-2" },
							{ type: "disableCompletion" },
							{ type: "require", target: "gate" },
						],
					},
				],
				visibility: [
					{
						blockId: "conditional",
						conditions: {
							operator: "and",
							rules: [{ source: "block:gate", field: "passed", comparison: "is", value: true }],
						},
					},
				],
			},
		});
		expect(block("conditional").hidden).toBe(true);
		const savedCount = () =>
			JSON.parse(localStorage.getItem("praxity:logic:logic-test") ?? "{}").v.count;
		expect(savedCount()).toBe(1);
		document.getElementById("navigation")?.setAttribute("data-hydrated", "");
		await Promise.resolve();
		expect(savedCount()).toBe(1);

		// The island restores durable results into its renderer after logic has started.
		block("gate").innerHTML =
			'<div data-block-id="gate" data-passed="true" data-score="100"></div>';
		const changed = vi.fn();
		document.addEventListener("praxity:visibility-change", changed);
		block("gate").setAttribute("data-hydrated", "");
		await vi.waitFor(() => expect(block("conditional").hidden).toBe(false));
		expect(changed).toHaveBeenCalledOnce();
		document.removeEventListener("praxity:visibility-change", changed);
		expect(document.querySelector("[data-mention]")).toHaveTextContent("true");
		expect(savedCount()).toBe(1);
		block("gate").setAttribute("data-hydrated", "");
		await Promise.resolve();
		expect(savedCount()).toBe(1);
		expect(runtime?.getJumpTarget()).toBeNull();
		expect(runtime?.isCompletionBlocked()).toBe(true);
		expect(document.querySelector("[data-continue-button]")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(block("gate")).toHaveAttribute("data-required", "true");
		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));
		expect(savedCount()).toBe(2);
		expect(runtime?.getJumpTarget()).toBe("page-2");
		expect(document.querySelector("[data-continue-button]")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(block("gate")).toHaveAttribute("data-required", "true");
	});

	it("keeps duplicate forward controls discoverable, blocks activation and restores exact attributes", () => {
		document.body.innerHTML += `<nav><a data-continue-button href="next.html?mode=1" role="button" tabindex="2" aria-describedby="existing" aria-disabled="false" style="display:inline-flex">Continue</a><a data-continue-button href="next.html" tabindex="-1">Duplicate</a><a data-page-number="2" data-page-slug="next" href="next.html">Outline jump</a><a data-page-number="0" href="previous.html">Previous</a><button data-continue-button>Native Continue</button></nav><p id="existing">Existing help</p>`;
		const controls = Array.from(document.querySelectorAll<HTMLElement>("[data-continue-button]"));
		const attributes = (el: HTMLElement) =>
			Object.fromEntries(Array.from(el.attributes, (attr) => [attr.name, attr.value]));
		const original = controls.map(attributes);
		const activated = vi.fn();
		for (const el of controls) el.addEventListener("click", activated);
		controls[0].focus();
		runtime = initDomLogicRuntime({
			...config,
			currentPage: 1,
			logic: {
				variables: [],
				rules: [
					{
						blockId: "gate",
						conditions: {
							operator: "and",
							rules: [{ source: "block:rating", field: "ratingScore", comparison: "lt", value: 6 }],
						},
						actions: [
							{
								type: "disableCompletion",
								reason: "<img src=x onerror=alert(1)> Complete the check.",
							},
						],
					},
				],
			},
		});
		expect(runtime?.isCompletionBlocked()).toBe(true);
		expect(runtime?.getCompletionReasons()).toEqual([
			"<img src=x onerror=alert(1)> Complete the check.",
		]);
		expect(document.activeElement).toBe(controls[0]);
		for (const el of controls) {
			expect(el).toHaveAttribute("aria-disabled", "true");
			expect(el).not.toHaveAttribute("disabled");
			const ids = el.getAttribute("aria-describedby")?.split(" ") ?? [];
			const reason = document.getElementById(ids.at(-1) ?? "");
			expect(reason).toHaveTextContent("<img src=x onerror=alert(1)> Complete the check.");
			expect(reason?.querySelector("img")).toBeNull();
			el.click();
		}
		expect(activated).not.toHaveBeenCalled();
		expect(controls[0]).not.toHaveAttribute("href");
		expect(controls[0]).toHaveAttribute("role", "link");
		expect(controls[0]).toHaveAttribute("tabindex", "2");
		expect(controls[1]).toHaveAttribute("tabindex", "-1");
		expect(document.querySelector('[data-page-number="2"]')).not.toHaveAttribute("href");
		expect(document.querySelector('[data-page-number="0"]')).toHaveAttribute(
			"href",
			"previous.html",
		);
		block("rating").dataset.ratingValue = "6";
		runtime?.evaluate();
		expect(runtime?.isCompletionBlocked()).toBe(false);
		expect(controls.map(attributes)).toEqual(original);
		expect(document.querySelectorAll("[data-completion-reason]")).toHaveLength(0);
		block("rating").dataset.ratingValue = "5";
		block("reveal").querySelector("button")?.focus();
		runtime?.evaluate();
		expect(document.activeElement?.textContent).toBe("Current");
		runtime?.destroy();
		expect(controls.map(attributes)).toEqual(original);
	});

	it.each([undefined, "   ", 42, { text: "unsafe" }])(
		"uses a French fallback for an older or malformed reason %j",
		(reason) => {
			document.documentElement.lang = "fr-CA";
			document.body.innerHTML += '<a data-continue-button href="next.html">Continuer</a>';
			runtime = initDomLogicRuntime({
				...config,
				logic: {
					rules: [
						{
							blockId: "gate",
							conditions: {
								operator: "and",
								rules: [
									{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 1 },
								],
							},
							actions: [{ type: "disableCompletion", reason }],
						},
					],
				},
			});
			expect(runtime?.isCompletionBlocked()).toBe(true);
			expect(document.querySelector("[data-completion-reason]")).toHaveTextContent(
				"La page suivante est indisponible.",
			);
			document.documentElement.lang = "en";
		},
	);

	it("syncs visibility eagerly, resolves mentions, and persists without an LMS", () => {
		runtime = initDomLogicRuntime(config);

		expect(block("reveal").hidden).toBe(false);
		expect(block("conditional").hidden).toBe(true);
		expect(document.querySelector("[data-mention]")).toHaveTextContent("false");

		const saved = JSON.parse(localStorage.getItem("praxity:logic:logic-test") ?? "{}");
		expect(saved.v).toEqual({ stored: true });
		expect(saved.learnerTracking["page-1"].visitCount).toBe(1);
	});

	it("re-evaluates interactions and restores focus when the active block is hidden", () => {
		runtime = initDomLogicRuntime(config);
		const button = block("reveal").querySelector("button");
		button?.focus();
		block("rating").setAttribute("data-rating-value", "1");

		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));

		expect(block("reveal").hidden).toBe(true);
		expect(document.activeElement).toBe(block("next").querySelector("h2"));
	});

	it("signals a changed logic wrapper once after sync and preserves focus recovery", () => {
		const changed = vi.fn();
		document.addEventListener("praxity:visibility-change", changed);
		runtime = initDomLogicRuntime(config);
		const initial = changed.mock.calls.length;
		runtime?.evaluate();
		expect(changed).toHaveBeenCalledTimes(initial);
		block("reveal").querySelector("button")?.focus();
		block("rating").dataset.ratingValue = "1";
		document.dispatchEvent(new Event("praxity:block-interaction"));
		expect(changed).toHaveBeenCalledTimes(initial + 1);
		expect(block("reveal").hidden).toBe(true);
		expect(document.activeElement).toBe(block("next").querySelector("h2"));
		document.removeEventListener("praxity:visibility-change", changed);
	});

	it("clears stale required validation when an interaction completes the block", () => {
		runtime = initDomLogicRuntime(config);
		block("reveal").setAttribute("data-required", "true");
		block("reveal").setAttribute("data-block-type", "assessment");
		expect(showRequiredValidation()).toBe(true);

		block("reveal").setAttribute("data-completed", "true");
		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));

		expect(document.querySelector(".praxity-required-message")).toBeNull();
		expect(block("reveal").querySelector("button")).not.toHaveAttribute("aria-invalid");
	});

	it("shows and hides a conditional heading with its section contents", () => {
		document.body.innerHTML = `
			<main id="praxity-root">
				<div class="praxity-block" data-block-id="rating" data-rating-value="1"></div>
				<section class="praxity-section">
					<div class="praxity-block" data-block-id="section"><h2>Conditional section</h2></div>
					<div class="praxity-block" data-block-id="detail">Detail</div>
				</section>
				<div class="praxity-block" data-block-id="next"><h2>Next section</h2></div>
			</main>`;
		const sectionConfig = {
			...config,
			blocks: [
				{ id: "rating", type: "rating", data: {} },
				{ id: "section", type: "heading", data: { level: 2 } },
				{ id: "detail", type: "text", data: {} },
				{ id: "next", type: "heading", data: { level: 2 } },
			],
			logic: {
				variables: [],
				visibility: [
					{
						blockId: "section",
						conditions: {
							operator: "and",
							rules: [
								{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 3 },
							],
						},
					},
				],
				rules: [],
			},
		};

		runtime = initDomLogicRuntime(sectionConfig);
		expect(block("section").hidden).toBe(true);
		expect(block("detail").hidden).toBe(true);
		expect(document.querySelector<HTMLElement>(".praxity-section")?.hidden).toBe(true);

		block("rating").setAttribute("data-rating-value", "5");
		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));

		expect(block("section").hidden).toBe(false);
		expect(block("detail").hidden).toBe(false);
		expect(document.querySelector<HTMLElement>(".praxity-section")?.hidden).toBe(false);
	});

	it("keeps hidden nested containers out of section visibility and focus recovery", () => {
		document.body.innerHTML = `
			<main id="praxity-root">
				<div class="praxity-block" data-block-id="rating" data-rating-value="5"></div>
				<section class="praxity-section">
					<div class="praxity-block" data-block-id="container">
						<div class="praxity-block" data-block-id="nested"><button type="button">Nested</button></div>
					</div>
				</section>
				<div class="praxity-block" data-block-id="next"><h2>Next section</h2></div>
			</main>`;
		const nestedConfig = {
			...config,
			blocks: [
				{ id: "rating", type: "rating", data: {} },
				{
					id: "container",
					type: "columns",
					data: {
						items: [{ children: [{ id: "nested", type: "text", data: { content: "Nested" } }] }],
					},
				},
				{ id: "next", type: "heading", data: { level: 2 } },
			],
			logic: {
				variables: [],
				rules: [],
				visibility: [
					{
						blockId: "container",
						conditions: {
							operator: "and",
							rules: [
								{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 3 },
							],
						},
					},
				],
			},
		};

		runtime = initDomLogicRuntime(nestedConfig);
		block("nested").querySelector("button")?.focus();
		block("rating").setAttribute("data-rating-value", "1");
		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));

		expect(block("container").hidden).toBe(true);
		expect(block("nested").hidden).toBe(false);
		expect(document.querySelector<HTMLElement>(".praxity-section")?.hidden).toBe(true);
		expect(document.activeElement).toBe(block("next").querySelector("h2"));
	});

	it("evaluates visibility after variable-setting rules in the same pass", () => {
		const samePass = {
			...config,
			logic: {
				variables: [{ name: "flag", dataType: "boolean", defaultValue: false }],
				rules: [
					{
						blockId: "set-flag",
						conditions: {
							operator: "and",
							rules: [
								{ source: "block:rating", field: "ratingScore", comparison: "gte", value: 5 },
							],
						},
						actions: [{ type: "setVariable", target: "flag", value: true }],
					},
				],
				visibility: [
					{
						blockId: "conditional",
						conditions: {
							operator: "and",
							rules: [{ source: "variable:flag", comparison: "is", value: true }],
						},
					},
				],
			},
		};

		runtime = initDomLogicRuntime(samePass);
		expect(block("conditional").hidden).toBe(false);
	});

	it("switches to a late LMS runtime and ignores duplicate ready events", () => {
		runtime = initDomLogicRuntime(config);
		let suspendData = JSON.stringify({ v: { flag: true } });
		const commit = vi.fn();
		(window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime = {
			getSuspendData: () => suspendData,
			setSuspendData: (value: string) => {
				suspendData = value;
			},
			commit,
		};

		window.dispatchEvent(new CustomEvent("praxity:runtime-ready"));
		window.dispatchEvent(new CustomEvent("praxity:runtime-ready"));

		expect(block("conditional").hidden).toBe(false);
		expect(document.querySelector("[data-mention]")).toHaveTextContent("true");
		expect(JSON.parse(suspendData).learnerTracking["page-1"].visitCount).toBe(1);
	});

	it("replaces prior listeners and cleans up its globals", () => {
		const firstRuntime = initDomLogicRuntime(config);
		runtime = initDomLogicRuntime(config);
		const animationFrame = vi.mocked(window.requestAnimationFrame);

		expect(runtime).toBe(firstRuntime);
		expect(
			JSON.parse(localStorage.getItem("praxity:logic:logic-test") ?? "{}").learnerTracking["page-1"]
				.visitCount,
		).toBe(1);
		document.dispatchEvent(new CustomEvent("praxity:block-interaction"));
		expect(animationFrame).toHaveBeenCalledTimes(1);

		runtime?.destroy();
		expect(
			(window as unknown as { __praxityLogicEngine?: unknown }).__praxityLogicEngine,
		).toBeUndefined();
	});
});

function block(id: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
	if (!element) throw new Error(`Missing test block ${id}`);
	return element;
}

it("refreshes restored completion predicates on hydration without replaying authored variables", async () => {
	document.body.innerHTML += '<a data-continue-button href="next.html">Continue</a>';
	runtime = initDomLogicRuntime({
		...config,
		logic: {
			variables: [{ name: "count", dataType: "number", defaultValue: 0 }],
			rules: [
				{
					blockId: "gate",
					conditions: {
						operator: "and",
						rules: [{ source: "block:rating", field: "ratingScore", comparison: "lt", value: 6 }],
					},
					actions: [
						{ type: "disableCompletion", reason: "Select six." },
						{ type: "setVariable", target: "count", value: { operation: "add", operand: 1 } },
					],
				},
			],
		},
	});
	expect(runtime?.isCompletionBlocked()).toBe(true);
	block("rating").dataset.ratingValue = "6";
	block("rating").setAttribute("data-hydrated", "");
	await vi.waitFor(() => expect(runtime?.isCompletionBlocked()).toBe(false));
	expect(document.querySelector("[data-continue-button]")).toHaveAttribute("href", "next.html");
	expect(JSON.parse(localStorage.getItem("praxity:logic:logic-test") ?? "{}").v.count).toBe(1);
});
