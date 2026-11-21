import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const source = readFile(new URL("../template/course-help.js", import.meta.url), "utf-8");

interface Call {
	url: string;
	method: string;
	credentials: string;
	body: unknown;
}

async function mount(locale = "en", respond?: (call: Call) => Response) {
	const dom = new JSDOM(
		`<!doctype html><html><head><title>Course</title>
		<script data-praxity-course-help="true" src="course-help.js?v=abc" data-help-endpoint="https://help.example.org/q?drop=me" data-help-locale="${locale}" data-help-page-id="page-1" data-help-page-title="Lifting safely"></script>
		</head><body><main><section data-deck-slide="page-1"><h1>Lifting safely</h1></section>
		<section data-deck-slide="page-2" hidden><h1>Carrying loads</h1><p id="tip">Keep loads close.</p></section></main></body></html>`,
		{
			url: "https://courses.example.org/safety/module.html",
			runScripts: "outside-only",
			pretendToBeVisual: true,
		},
	);
	const { window } = dom;
	const calls: Call[] = [];
	const view = {
		threads: [
			{
				id: 1,
				pageId: "page-1",
				pageTitle: "Lifting safely",
				quote: "",
				body: "Why bend?",
				createdAt: "2026-11-20T10:00:00.000Z",
				replies: [
					{
						id: 2,
						body: "To protect your back.",
						fromStaff: true,
						read: false,
						createdAt: "2026-11-20T11:00:00.000Z",
					},
				],
			},
		],
		unread: 1,
	};
	Object.assign(window, {
		CSS: { escape: (value: string) => value },
		fetch: vi.fn(async (url: URL, init: RequestInit) => {
			const call = {
				url: String(url),
				method: init.method ?? "GET",
				credentials: String(init.credentials),
				body: init.body ? JSON.parse(String(init.body)) : undefined,
			};
			calls.push(call);
			return respond?.(call) ?? Response.json(view, { status: call.method === "POST" ? 201 : 200 });
		}),
	});
	// jsdom has no modal dialogs; open and close are enough here.
	window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.open = true;
	};
	window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.open = false;
		this.dispatchEvent(new window.Event("close"));
	};
	window.eval(await source);
	await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
	const doc = window.document;
	const button = doc.querySelector<HTMLButtonElement>(".praxity-help-button") as HTMLButtonElement;
	return { window, doc, calls, button };
}

describe("course help client", () => {
	it("shows a labelled button, loads its stylesheet and the unread count from the endpoint", async () => {
		const { window, doc, calls, button } = await mount();
		expect(button.querySelector(".praxity-help-label")?.textContent).toBe("Ask the course team");
		expect(button.querySelector(".praxity-help-icon")?.getAttribute("aria-hidden")).toBe("true");
		expect(button.getAttribute("aria-haspopup")).toBe("dialog");
		expect(doc.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href).toBe(
			"https://courses.example.org/safety/course-help.css?v=abc",
		);
		expect(calls[0]).toEqual({
			url: "https://help.example.org/q/threads",
			method: "GET",
			credentials: "include",
			body: undefined,
		});
		await vi.waitFor(() =>
			expect(button.querySelector(".praxity-help-badge")?.textContent).toBe("1, 1 new reply"),
		);
		await vi.waitFor(() =>
			expect(doc.querySelector('.praxity-help > p[role="status"]')?.textContent).toBe(
				"1 new reply",
			),
		);
		expect(window.sessionStorage.getItem("praxity.help.told")).toBe("2");
	});

	it("marks replies read when the panel shows them, and labels every field", async () => {
		const { doc, calls, button } = await mount();
		await vi.waitFor(() =>
			expect(button.querySelector<HTMLElement>(".praxity-help-badge")?.hidden).toBe(false),
		);
		button.click();
		const dialog = doc.querySelector("dialog") as HTMLDialogElement;
		expect(dialog.open).toBe(true);
		expect(doc.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
			"Ask the course team",
		);
		await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/q/read"))).toBe(true));
		expect(doc.querySelector(".praxity-help-thread")?.textContent).toContain(
			"To protect your back.",
		);
		for (const field of doc.querySelectorAll("textarea"))
			expect(doc.querySelector(`label[for="${field.id}"]`)?.textContent).toBeTruthy();
		(doc.querySelector(".praxity-help-close") as HTMLButtonElement).click();
		expect(dialog.open).toBe(false);
		expect(doc.activeElement).toBe(button);
	});

	it("sends the question with the deck's active page and a pointed-at quote", async () => {
		const { window, doc, calls, button } = await mount();
		window.dispatchEvent(
			new window.CustomEvent("praxity:active-page-change", { detail: { pageId: "page-2" } }),
		);
		button.click();
		(
			doc.querySelector(
				".praxity-help-form .praxity-help-actions .praxity-help-secondary",
			) as HTMLButtonElement
		).click();
		expect(doc.querySelector<HTMLElement>(".praxity-help-picker")?.hidden).toBe(false);
		const tip = doc.getElementById("tip") as HTMLElement;
		Object.defineProperty(tip, "innerText", { value: tip.textContent });
		tip.click();
		const question = doc.getElementById("praxity-help-question") as HTMLTextAreaElement;
		expect(doc.activeElement).toBe(question);
		question.value = "  How close?  ";
		(doc.querySelector(".praxity-help-form") as HTMLFormElement).requestSubmit();
		await vi.waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
		expect(calls.find((call) => call.method === "POST")).toEqual({
			url: "https://help.example.org/q/threads",
			method: "POST",
			credentials: "include",
			body: {
				pageId: "page-2",
				pageTitle: "Carrying loads",
				body: "How close?",
				quote: "Keep loads close.",
			},
		});
	});

	it("explains the write limit, in French for a French course", async () => {
		const { doc, button } = await mount("fr", (call) =>
			call.method === "POST"
				? new Response("{}", { status: 429 })
				: Response.json({ threads: [], unread: 0 }),
		);
		expect(button.querySelector(".praxity-help-label")?.textContent).toBe(
			"Poser une question à l’équipe du cours",
		);
		button.click();
		(doc.getElementById("praxity-help-question") as HTMLTextAreaElement).value = "Pourquoi?";
		(doc.querySelector(".praxity-help-form") as HTMLFormElement).requestSubmit();
		await vi.waitFor(() =>
			expect(doc.querySelector(".praxity-help-form .praxity-help-status")?.textContent).toContain(
				"Attendez une minute",
			),
		);
	});
});
