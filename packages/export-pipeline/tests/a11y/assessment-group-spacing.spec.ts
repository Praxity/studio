import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { buildSync } from "esbuild";
import { type CourseConfig, generateCourseCss } from "../../src/html-gen";
import { generateHtmlPages } from "../../src/html-pages";
import { groupedDeckFixture } from "../fixtures/module-deck";

const styles = [
	"../../../shared-blocks/src/reading-rhythm.css",
	"../../template/src/styles/global.css",
	"../../../shared-blocks/src/blocks/shared-blocks.css",
	"../../../shared-blocks/src/viewer/viewer-shell.css",
	"../../../shared-blocks/src/viewer/deck-shell.css",
]
	.map((path) =>
		readFileSync(resolve(import.meta.dirname, path), "utf8").replace(/^@import[^;]+;/gm, ""),
	)
	.join("\n");
const previewScript = buildSync({
	stdin: {
		contents: `import { initAssessmentGroups } from "../shared-blocks/src/viewer/assessment-group-runtime";
const blocks = JSON.parse(document.getElementById("praxity-config").textContent).blocks;
initAssessmentGroups({ blocks, root: document.getElementById("main-content"), readOnly: true });`,
		resolveDir: resolve(import.meta.dirname, "../.."),
	},
	bundle: true,
	write: false,
	format: "iife",
}).outputFiles[0].text;

const following = [
	...readLesson("# Untitled {hideTitle}\n\n*Demonstration note.*\n").pages[0].blocks,
	...readLesson(
		"# Untitled {hideTitle}\n\n::: free-response Ordinary question {scored=false level=3}\n:::\n",
	).pages[0].blocks,
	...readLesson("# Untitled {hideTitle}\n\nOrdinary following text.\n").pages[0].blocks,
];
following.forEach((block, index) => {
	block.id = ["after-group", "ordinary-assessment", "after-ordinary"][index];
});
const journal = readLesson(`# Fixture {hideTitle}

::: group Weekly journal {level=2}
${[1, 2, 3].map((index) => `::: free-response Reflection ${index} {scored=false level=3}\n:::`).join("\n\n")}
:::
`).pages[0].blocks;
const deck = groupedDeckFixture();
const survey = deck.content[1];
survey.blocks.push(...following);
const configs: Record<"page" | "deck", CourseConfig> = {
	page: {
		id: "journal-spacing",
		title: "Journal spacing",
		sourceLocale: "en",
		totalPages: 1,
		pages: [{ id: "journal", title: "Journal", blocks: [...journal, ...following] }],
	},
	deck: {
		id: deck.id,
		title: deck.title,
		sourceLocale: deck.sourceLocale ?? "en",
		navigationStyle: deck.navigationStyle,
		moduleDeck: { gates: { "experience-survey": "attempt" } },
		pages: [survey],
		totalPages: 1,
	},
};
const html: Partial<Record<"page" | "deck", string>> = {};
let directory: string;

test.beforeAll(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "group-spacing-"));
	for (const layout of ["page", "deck"] as const) {
		const target = resolve(directory, layout);
		const result = await generateHtmlPages(configs[layout], target, {
			loaderFilename: "loader.js",
			islandFilenames: {
				assessment: "assessment.js",
				assessmentGroup: "assessment-group.js",
				deck: "deck.js",
				nav: "nav.js",
			},
		});
		html[layout] = await readFile(resolve(target, `${result.pages[0].slug}.html`), "utf8");
	}
});
test.afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

for (const layout of ["page", "deck"] as const) {
	for (const width of [390, 1200]) {
		test(`${layout} keeps the ordinary assessment-to-text gap after a group at ${width}px`, async ({
			page,
		}) => {
			await page.setViewportSize({ width, height: 900 });
			await page.route("**/*", (route) => route.abort());
			const documentHtml = html[layout];
			if (!documentHtml) throw new Error(`Missing ${layout} fixture`);
			await page.setContent(
				documentHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (script) =>
					script.includes('type="application/json"') ? script : "",
				),
			);
			await page.addStyleTag({ content: styles + generateCourseCss(configs[layout]) });
			if (layout === "deck") {
				await page.locator(".praxity-deck").evaluate((deck) => {
					deck.setAttribute("data-ready", "true");
				});
			}
			for (const preview of [false, true]) {
				if (preview) {
					await page.addScriptTag({ content: previewScript });
					await page.evaluate(
						() =>
							new Promise<void>((resolve) =>
								requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
							),
					);
				}
				for (const scale of [1, 5 / 3]) {
					await page.locator("body").evaluate((body, value) => {
						body.style.setProperty("--praxity-block-spacing-scale", String(value));
					}, scale);
					const gaps = await page.evaluate(() => {
						const afterGroup = document.querySelector('[data-block-id="after-group"]');
						const ordinary = document.querySelector('[data-block-id="ordinary-assessment"]');
						const afterOrdinary = document.querySelector('[data-block-id="after-ordinary"]');
						const footer = afterGroup?.previousElementSibling;
						if (
							!afterGroup ||
							!ordinary ||
							!afterOrdinary ||
							!footer?.matches("[data-assessment-group-submit]")
						)
							throw new Error("Missing group footer or ordinary comparison blocks");
						return {
							group: afterGroup.getBoundingClientRect().top - footer.getBoundingClientRect().bottom,
							ordinary:
								afterOrdinary.getBoundingClientRect().top - ordinary.getBoundingClientRect().bottom,
						};
					});
					expect(gaps.ordinary).toBeGreaterThan(0);
					expect(gaps.group, `preview=${preview}, scale=${scale}`).toBeCloseTo(gaps.ordinary, 1);
				}
			}
		});
	}
}
