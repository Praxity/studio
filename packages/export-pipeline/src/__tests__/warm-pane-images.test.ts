import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { warmPaneImages } from "../../template/src/components/warm-pane-images";

function fixture() {
	const dom = new JSDOM(
		`<main>${Array.from(
			{ length: 6 },
			(_, index) =>
				`<section${index === 3 ? "" : " hidden inert"}><img src="${index}-a.png" loading="lazy"><img src="${index}-b.png" loading="lazy"></section>`,
		).join("")}</main>`,
	);
	const panes = Array.from(dom.window.document.querySelectorAll("section"));
	return { dom, panes };
}

describe("pane image warming", () => {
	it("warms only the expanded disclosure panel in a neighbouring slide", () => {
		const { dom, panes } = fixture();
		panes[2].innerHTML += `<div class="praxity-tabs-static" data-disclosure="true">${[0, 1, 2]
			.map(
				(panel) =>
					`<button class="praxity-tabs-tab" aria-expanded="${panel === 1}" aria-controls="disclosure-${panel}"></button><div class="praxity-tabs-panel" id="disclosure-${panel}"${panel === 1 ? "" : " hidden"}><img src="disclosure-${panel}.png" loading="lazy"></div>`,
			)
			.join("")}</div>`;
		warmPaneImages(panes, 3);
		expect(
			Array.from(panes[2].querySelectorAll(".praxity-tabs-panel img"), (image) => [
				image.getAttribute("loading"),
				image.getAttribute("fetchpriority"),
			]),
		).toEqual([
			["lazy", null],
			["eager", "low"],
			["lazy", null],
		]);
		dom.window.close();
	});

	it("follows only selected nested tab paths in current and neighbouring slides", () => {
		const { dom, panes } = fixture();
		const tabs = (prefix: string, nested: boolean): string =>
			`<div class="praxity-tabs-static"><div class="praxity-tabs-list">${[0, 1, 2].map((tab) => `<button class="praxity-tabs-tab" aria-selected="${tab === 1}" aria-controls="${prefix}-${tab}"></button>`).join("")}</div>${[0, 1, 2].map((tab) => `<div class="praxity-tabs-panel" id="${prefix}-${tab}"${tab === 1 ? "" : " hidden"}><img src="${prefix}-${tab}.png" loading="lazy">${nested ? tabs(`${prefix}-inner-${tab}`, false) : ""}</div>`).join("")}</div>`;
		for (const [index, pane] of panes.entries()) {
			pane.innerHTML += tabs(`nested-${index}`, true);
		}
		warmPaneImages(panes, 3);
		for (const [index, pane] of panes.entries()) {
			const panels = Array.from(
				pane.querySelectorAll<HTMLElement>(":scope > .praxity-tabs-static > .praxity-tabs-panel"),
			);
			const neighbour = index === 2 || index === 4;
			expect(
				panels.map((panel) => panel.querySelector(":scope > img")?.getAttribute("loading")),
			).toEqual(neighbour ? ["lazy", "eager", "lazy"] : ["lazy", "lazy", "lazy"]);
			expect(
				panels.map((panel) =>
					Array.from(
						panel.querySelectorAll(":scope > .praxity-tabs-static > .praxity-tabs-panel > img"),
						(image) => image.getAttribute("loading"),
					),
				),
			).toEqual(
				neighbour
					? [
							["lazy", "lazy", "lazy"],
							["lazy", "eager", "lazy"],
							["lazy", "lazy", "lazy"],
						]
					: [
							["lazy", "lazy", "lazy"],
							["lazy", "lazy", "lazy"],
							["lazy", "lazy", "lazy"],
						],
			);
			if (neighbour) {
				expect(panels[1].querySelector(":scope > img")?.getAttribute("fetchpriority")).toBe("low");
				expect(
					panels[1]
						.querySelectorAll(":scope > .praxity-tabs-static > .praxity-tabs-panel > img")[1]
						?.getAttribute("fetchpriority"),
				).toBe("low");
			}
		}
		panes[3].hidden = true;
		panes[4].hidden = false;
		warmPaneImages(panes, 4);
		expect(
			Array.from(
				panes[4].querySelectorAll(":scope > .praxity-tabs-static > .praxity-tabs-panel > img"),
				(image) => image.getAttribute("loading"),
			),
		).toEqual(["lazy", "eager", "lazy"]);
		dom.window.close();
	});

	it("waits for deck initialization even before inactive slides become hidden", () => {
		const { dom, panes } = fixture();
		const main = dom.window.document.querySelector("main");
		if (!main) throw new Error("Missing fixture main");
		main.className = "praxity-deck";
		warmPaneImages(panes, 3);
		expect(
			Array.from(dom.window.document.images, (image) => image.getAttribute("loading")),
		).toEqual(Array(12).fill("lazy"));
		main.dataset.ready = "true";
		warmPaneImages(panes, 3);
		expect(panes[2].querySelector("img")?.getAttribute("loading")).toBe("eager");
		dom.window.close();
	});

	it("warms every current and neighbouring image without fetching the rest", () => {
		const { dom, panes } = fixture();
		panes[3].querySelector("img")?.setAttribute("fetchpriority", "high");
		panes[2].querySelector("img")?.setAttribute("fetchpriority", "high");
		warmPaneImages(panes, 3);
		expect(
			panes.map((pane) =>
				Array.from(pane.querySelectorAll("img"), (image) => image.getAttribute("loading")),
			),
		).toEqual([
			["lazy", "lazy"],
			["lazy", "lazy"],
			["eager", "eager"],
			["eager", "eager"],
			["eager", "eager"],
			["lazy", "lazy"],
		]);
		expect(panes[2].querySelector("img")?.getAttribute("fetchpriority")).toBe("low");
		expect(panes[4].querySelector("img")?.getAttribute("fetchpriority")).toBe("low");
		expect(panes[3].querySelector("img")?.getAttribute("fetchpriority")).toBe("high");
		expect(panes[2].hidden).toBe(true);
		expect(panes[2].hasAttribute("inert")).toBe(true);
		dom.window.close();
	});

	it("does not warm nested panes while their ancestor is hidden", () => {
		const { dom, panes } = fixture();
		panes[3].parentElement?.setAttribute("hidden", "");
		warmPaneImages(panes, 3);
		expect(
			Array.from(dom.window.document.images, (image) => image.getAttribute("loading")),
		).toEqual(Array(12).fill("lazy"));
		dom.window.close();
	});

	it("bounds the first and last pane and ignores an absent selection", () => {
		for (const active of [0, 5]) {
			const { dom, panes } = fixture();
			for (const [index, pane] of panes.entries()) pane.hidden = index !== active;
			warmPaneImages(panes, -1);
			expect(
				Array.from(dom.window.document.images, (image) => image.getAttribute("loading")),
			).toEqual(Array(12).fill("lazy"));
			warmPaneImages(panes, active);
			expect(panes.map((pane) => pane.querySelector("img")?.getAttribute("loading"))).toEqual(
				active === 0
					? ["eager", "eager", "lazy", "lazy", "lazy", "lazy"]
					: ["lazy", "lazy", "lazy", "lazy", "eager", "eager"],
			);
			dom.window.close();
		}
	});

	it("still warms the active slide when a replacing panel makes its main inert", () => {
		const { dom, panes } = fixture();
		panes[3].parentElement?.setAttribute("inert", "");
		warmPaneImages(panes, 3);
		expect(panes[2].querySelector("img")?.getAttribute("loading")).toBe("eager");
		expect(panes[4].querySelector("img")?.getAttribute("loading")).toBe("eager");
		dom.window.close();
	});
});
