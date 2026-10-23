import { readLesson } from "@praxity/grammar";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { expect, it } from "vitest";
import { generateHtmlPage } from "../src/html-gen";
import { renderBlockHtml } from "../src/render-block-html";
import { planPageRuntime } from "../src/runtime-plan";
import { compilerIslandAssets } from "./fixtures/page-compiler";

const activity = (task: string) =>
	`::: self-check ${task}\nmodel: Model answer.\n:: A part\nmissed: A hint.\n:::\n`;
const config = {
	id: "course",
	title: "Practice",
	sourceLocale: "en",
	navigationStyle: "sidebar" as const,
	navToggles: { navTopBar: false, showA11yPill: false },
};

it.each([
	[
		"en",
		"Your answer",
		"Check my answer",
		"Show feedback",
		"Start over",
		"Comparing your answer with the model requires JavaScript.",
	],
	[
		"fr",
		"Votre réponse",
		"Vérifier ma réponse",
		"Afficher la rétroaction",
		"Recommencer",
		"La comparaison de votre réponse avec le modèle nécessite JavaScript.",
	],
])(
	"renders the %s native baseline with one empty status and prepared controls",
	(locale, label, check, show, restart, notice) => {
		const read = readLesson(`# Practice\n${activity("Write an answer.")}`);
		const block = read.pages[0].blocks.find((block) => block.type === "selfCheck");
		if (!block) throw new Error("Missing baseline fixture.");
		const doc = new JSDOM(renderBlockHtml({ ...block, locale }, { strings: getStrings(locale) }))
			.window.document;
		expect(doc.querySelector("h2")?.textContent).toBe("Write an answer.");
		expect(doc.querySelector("[data-self-check]")?.getAttribute("lang")).toBe(locale);
		expect(doc.querySelector("label")?.textContent).toBe(label);
		expect(doc.querySelector("label")?.htmlFor).toBe(doc.querySelector("textarea")?.id);
		expect(doc.querySelector("textarea")?.disabled).toBe(false);
		expect(doc.querySelectorAll('[role="status"]')).toHaveLength(1);
		expect(doc.querySelector('[role="status"]')?.innerHTML).toBe("");
		expect([...doc.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
			check,
			show,
			restart,
		]);
		expect(doc.querySelectorAll("button[data-praxity-js-control]")).toHaveLength(3);
		expect(doc.querySelector("[data-self-check-notice]")?.textContent).toBe(notice);
		expect(doc.querySelector("[data-self-check-error]")?.textContent).toBe(
			locale === "fr" ? "Écrivez d'abord votre réponse." : "Write your answer first.",
		);
		expect(doc.querySelector("[data-self-check-error]")?.hasAttribute("hidden")).toBe(true);
		expect(doc.querySelector("[data-self-check]")?.getAttribute("data-self-check-incomplete")).toBe(
			locale === "fr"
				? "Écrivez une réponse, vérifiez ses éléments, puis affichez la rétroaction pour terminer cette activité."
				: "Write an answer, check its parts, then show feedback to complete this activity.",
		);
		expect(doc.querySelector("textarea")?.getAttribute("aria-describedby")).toBe(
			doc.querySelector("[data-self-check-notice]")?.id,
		);
		expect(doc.querySelector(".praxity-scene-icon path")?.getAttribute("d")).toBe(
			"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2",
		);
	},
);

it("keeps hostile task text literal and IDs tied to identity and source order", () => {
	const task =
		'<img src=x onerror="alert(1)"> & [TERM]{definition} **bold** </textarea><script>alert(2)</script>';
	const block: PraxityBlock = {
		id: "activity",
		type: "selfCheck",
		data: { content: { task, parts: [{ id: "part" }] } },
	};
	const doc = new JSDOM([0, 1].map((blockIndex) => renderBlockHtml(block, { blockIndex })).join(""))
		.window.document;
	expect([...doc.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
		task,
		task,
	]);
	expect(doc.querySelectorAll("script,img,template,.inline-tooltip-trigger")).toHaveLength(0);
	const ids = [...doc.querySelectorAll("[data-self-check] [id]")].map((node) => node.id);
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids.every((id) => /^activity-[01]-self-check-/.test(id))).toBe(true);
});

it("uses derived heading levels for nested self-checks and keeps their native fields", () => {
	const read = readLesson(
		`# Practice\n## Context\n::: accordion\n:: Panel\n${activity("Write inside the panel.")}:::\n`,
	);
	const doc = new JSDOM(read.pages[0].blocks.map((block) => renderBlockHtml(block)).join("")).window
		.document;
	expect(doc.querySelector("[data-self-check] h4")?.textContent).toBe("Write inside the panel.");
	expect(doc.querySelector("[data-accordion-item] textarea")).toBeTruthy();
	expect(doc.querySelectorAll('[role="status"]')).toHaveLength(1);
});

it("keeps every ID unique for repeated authored instances and inherits French inside containers", () => {
	const read = readLesson(
		`# Practice\n${activity("Repeat this task.")}${activity("Repeat this task.")}::: accordion\n:: Panel\n${activity("Repeat this task.")}:::\n`,
	);
	const doc = new JSDOM(
		read.pages[0].blocks
			.map((block, blockIndex) => renderBlockHtml(block, { blockIndex, sourceLocale: "fr" }))
			.join(""),
	).window.document;
	const ids = [...doc.querySelectorAll("[id]")].map((node) => node.id);
	expect(new Set(ids).size).toBe(ids.length);
	expect(doc.querySelectorAll("[data-self-check]")).toHaveLength(3);
	for (const root of doc.querySelectorAll("[data-self-check]")) {
		expect(root.getAttribute("lang")).toBe("fr");
		expect(root.querySelector("label")?.textContent).toBe("Votre réponse");
	}
});

it("plans the self-check island and refuses a missing asset with a content-free code", () => {
	const read = readLesson(`# Practice\n${activity("Write an answer.")}`);
	expect(planPageRuntime(config, read.pages[0], true).islands).toEqual(["selfCheck"]);
	expect(() => planPageRuntime(config, read.pages[0], new Set())).toThrowError(
		expect.objectContaining({ code: "EISLANDASSET" }),
	);
	expect(read.diagnostics.map(({ code }) => code)).toEqual([]);
});

it("uses the same baseline in full and lite output with the page locale", () => {
	const read = readLesson(`# Practice\n${activity("Rédigez une réponse.")}`);
	const page = { ...read.pages[0], locale: "fr" };
	const output = (lite: boolean) =>
		new JSDOM(
			generateHtmlPage({
				config: { ...config, pages: [page], totalPages: 1 },
				page,
				index: 0,
				currentSlug: "practice",
				slugList: [{ pageId: page.id, slug: "practice", title: "Practice" }],
				slugMap: new Map([[page.id, "practice"]]),
				runtimePlan: {
					mode: "islands",
					islands: lite ? ["selfCheck"] : ["assessment", "selfCheck"],
					legacyReasons: [],
				},
				islandAssets: compilerIslandAssets,
				stylesheetFilename: "styles.css",
				liteStylesheetFilename: "styles-lite.css",
			}),
		).window.document;
	const full = output(false);
	const lite = output(true);
	expect(full.querySelector("[data-self-check]")?.outerHTML).toBe(
		lite.querySelector("[data-self-check]")?.outerHTML,
	);
	expect(full.querySelector("[data-self-check]")?.getAttribute("lang")).toBe("fr");
	expect(full.querySelector("label")?.textContent).toBe("Votre réponse");
	expect(full.querySelector('link[href="styles.css"]')).toBeTruthy();
	expect(lite.querySelector('link[href="styles-lite.css"]')).toBeTruthy();
});
