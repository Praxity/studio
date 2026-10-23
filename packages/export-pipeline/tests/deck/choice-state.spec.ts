import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import {
	choiceContentSignature,
	choiceStateQuestion,
	DONT_KNOW,
} from "@praxity/shared-blocks/assessment-choice";
import { prepareChoiceAssessmentState } from "@praxity/shared-blocks/choice-learner-state";
import type { AssessmentBlockData, ChoiceResponse } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import { compileCourse, deployCourse } from "../../src/build";
import { extractDesktopDesignFromFrontmatter } from "../../src/desktop-design";
import { expectFocusRing } from "../focus-assertions";

const questionId = "10000000-0000-4000-8000-000000000001";
const firstId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const files = new Map<string, Buffer>();
const entries: Record<string, string> = {};
const previous: Record<string, unknown> = {};
let server: Server;
let base: string;

const cases = (["en", "fr"] as const).flatMap((locale) =>
	(["single", "multiple", "dontKnow"] as const).flatMap((variant) =>
		(["pages", "deck"] as const).flatMap((presentation) =>
			(["light", "dark"] as const).map((theme) => ({
				locale,
				variant,
				presentation,
				theme,
				key: `${locale}-${variant}-${presentation}-${theme}`,
			})),
		),
	),
);

test.beforeAll(async () => {
	// Bind the permanent evidence interface only in these fixtures. Production
	// hosts still construct their ordinary provider and tracker without it.
	const fixture = await build({
		stdin: {
			resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
			loader: "ts",
			contents: `
import { admitChoiceStateFacts } from '@praxity/shared-blocks/choice-state-facts';
import { createChoiceDependencyView } from '@praxity/shared-blocks/choice-learner-state';
import { CourseTracker } from './src/scorm/tracking';
const seed = JSON.parse(document.getElementById('recovery-fixture').textContent);
const config = JSON.parse(document.getElementById('praxity-host-config').textContent);
const facts = admitChoiceStateFacts(config);
let provider, tracker;
Object.defineProperty(window, '__praxityBlockState', {
    configurable: true, get: () => provider,
    set(value) {
        provider = value;
        if (!provider) return;
        if (!provider.get(seed.id)) {
            provider.set(seed.id, seed.answer);
            window.__praxityRuntime.trackInteraction(seed.id, 'stop', false, 0);
        }
        // Submitted saved answers are evidence in their own right. Transport row
        // admission and signed reporting remain part of the later host activation.
        provider.getChoiceDependencyView = () => createChoiceDependencyView(facts, {
            rows: [], readState: provider.get,
        });
    },
});
Object.defineProperty(window, '__praxityTracker', {
    configurable: true, get: () => tracker,
    set(value) {
        tracker = value && new CourseTracker(window.__praxityRuntime, {
            ...config, reportOutcome: false,
            getAssessmentState: id => provider.get(id),
            getChoiceDependencyView: () => provider.getChoiceDependencyView(),
        });
    },
});`,
		},
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
	});
	for (const item of cases) {
		const { locale, variant, presentation, theme, key } = item;
		const lesson = readLesson(
			`# Practice\n::: choice ${locale === "en" ? "Choose an action" : "Choisissez une action"} {scored points=10 attempts=2}\n( ) Stop\n(x) Continue\n:::\n\n# Continue\n\nRead the next page.\n`,
		);
		if (lesson.hasErrors) throw new Error(JSON.stringify(lesson.errors));
		const question = lesson.pages
			.flatMap((page) => page.blocks)
			.find((block) => block.type === "assessment");
		if (!question) throw new Error("Missing choice fixture");
		question.id = questionId;
		const response = question.data.response as ChoiceResponse;
		response.options[0].id = firstId;
		response.options[1].id = secondId;
		response.shuffle = false;
		response.selectionMode = variant === "multiple" ? "multiple" : "single";
		response.options[0].isCorrect = variant === "multiple";
		question.data._dontKnow = variant === "dontKnow";
		question.data.dontKnow = variant === "dontKnow";
		const oldFacts = {
			question: choiceStateQuestion(
				question.data as unknown as AssessmentBlockData,
				variant === "dontKnow",
			),
			signature: choiceContentSignature(
				question.data as unknown as AssessmentBlockData,
				variant === "dontKnow",
			),
		};
		previous[key] = prepareChoiceAssessmentState(
			undefined,
			{
				version: 1,
				kind: "assessment",
				assessmentType: "choice",
				attemptCount: 2,
				checked: true,
				correct: false,
				completed: true,
				interacted: true,
				answer: [firstId],
			},
			oldFacts,
			{ writtenAt: 1 },
		);
		question.data.stem = [
			{
				id: "revised-stem",
				type: "text",
				data: {
					content: locale === "en" ? "Choose the revised action" : "Choisissez l'action révisée",
				},
			},
		];
		lesson.pages.forEach((page, index) => {
			page.id = `recovery-page-${index + 1}`;
			page.lessonId = "recovery";
			page.lessonTitle = "Practice";
			page.isFirstPageOfLesson = index === 0;
		});
		const artifact = await compileCourse({
			...extractDesktopDesignFromFrontmatter({ design: { colorMode: theme } } as never),
			id: `choice-recovery-${key}`,
			title: "Practice",
			sourceLocale: locale,
			content: lesson.pages,
			requireKnowledgeChecks: true,
			passingScore: 70,
			navigationStyle: presentation === "deck" ? "slides" : "sidebar",
			...(presentation === "deck" ? { moduleDeck: { gates: { [questionId]: "pass" } } } : {}),
		});
		try {
			const deployed = await deployCourse(artifact, { format: "html" });
			for (const entry of new AdmZip(deployed.zip).getEntries()) {
				if (entry.isDirectory) continue;
				let bytes = entry.getData();
				const html = bytes.toString();
				if (entry.entryName.endsWith(".html") && html.includes('id="praxity-host-config"')) {
					const seed = JSON.stringify({ id: questionId, answer: previous[key] }).replace(
						/</g,
						"\\u003c",
					);
					// Config scripts precede the deferred host. The injected binding
					// is ready before either the host or assessment island starts.
					bytes = Buffer.from(
						html.replace(
							"</body>",
							`<script type="application/json" id="recovery-fixture">${seed}</script><script>${fixture.outputFiles[0].text}</script></body>`,
						),
					);
					if (html.includes(`data-block-id="${questionId}"`))
						entries[key] = `${key}/${entry.entryName}`;
				}
				files.set(`/${key}/${entry.entryName}`, bytes);
			}
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		const bytes = files.get(path);
		const types: Record<string, string> = {
			js: "text/javascript",
			css: "text/css",
			html: "text/html; charset=utf-8",
			woff2: "font/woff2",
		};
		response.writeHead(bytes ? 200 : 404, {
			"Content-Type": types[path.split(".").pop() ?? ""] ?? "application/octet-stream",
		});
		response.end(bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
	if (server) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	files.clear();
});

for (const { locale, variant, presentation, theme, key } of cases) {
	test(`${locale} ${variant} ${presentation} ${theme} recovery retains history through draft reload`, async ({
		page,
	}, testInfo) => {
		await page.goto(base + entries[key]);
		await expect(page.locator("html")).toHaveAttribute("data-praxity-mode", theme);
		await page.evaluate(() => document.fonts.ready.then(() => {}));
		const activity = page.locator(`[data-island="assessment"][data-block-id="${questionId}"]`);
		await expect(activity).toHaveAttribute("data-hydrated", "");
		const controls = activity.getByRole(variant === "multiple" ? "checkbox" : "radio");
		const action = activity.getByRole("button", {
			name: locale === "en" ? "New attempt" : "Nouvelle tentative",
			exact: true,
		});
		const notice =
			locale === "en"
				? "This question changed after you answered it, so your earlier answer no longer counts. Select New attempt to answer it again."
				: "Cette question a été modifiée après votre réponse. Votre réponse précédente ne compte donc plus. Sélectionnez Nouvelle tentative pour y répondre de nouveau.";
		const saved = () => page.evaluate((id) => window.__praxityBlockState?.get(id), questionId);
		const outcome = () =>
			page.evaluate(
				() =>
					(window.__praxityTracker as unknown as { outcome(): { kind: string } }).outcome().kind,
			);
		const rows = await page.evaluate(() =>
			(window.__praxityRuntime as unknown as { getInteractions(): unknown[] }).getInteractions(),
		);
		expect(await saved()).toEqual(previous[key]);
		expect(await outcome()).toBe("waiting");
		await expect(action).toHaveAccessibleDescription(notice);
		await expect(
			activity.getByRole(variant === "multiple" ? "group" : "radiogroup"),
		).toHaveAccessibleDescription(notice);
		for (const control of await controls.all()) await expect(control).toBeDisabled();
		await expect(activity.locator('[aria-live], [role="status"], [role="alert"]')).toHaveCount(0);
		if (presentation === "deck") {
			await page.locator("#deck-next").click();
			await expect(page.locator('[data-deck-slide="recovery-page-1"]')).toBeVisible();
			await expect(page.locator(".deck-gate-notice")).toBeVisible();
			await page.locator(".deck-gate-notice").press("Enter");
		}
		const tabStops: string[] = [];
		for (
			let n = 0;
			n < 40 && !(await action.evaluate((element) => element === document.activeElement));
			n++
		) {
			await page.keyboard.press("Tab");
			tabStops.push(
				await page.evaluate(
					() =>
						`${document.activeElement?.tagName}: ${document.activeElement?.textContent?.slice(0, 80)}`,
				),
			);
		}
		await testInfo.attach("keyboard-route", {
			body: JSON.stringify(tabStops),
			contentType: "application/json",
		});
		await expect(action).toBeFocused();
		await expectFocusRing(action, 2);
		await testInfo.attach("waiting-1280", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		const viewport = page.viewportSize();
		for (const [width, zoom] of [
			[320, 1],
			[640, 2],
		] as const) {
			// Browser zoom reduces the CSS viewport. CSS `zoom` on the root
			// does not model this consistently for WebKit's fixed deck shell.
			await page.setViewportSize({ width: width / zoom, height: 800 / zoom });
			await page.keyboard.press("Escape");
			const readLayout = () =>
				action.evaluate((button) => {
					const bounds = button.getBoundingClientRect();
					const label = button.querySelector<HTMLElement>(".mantine-Button-label");
					if (!label) throw new Error("Missing action label");
					return {
						bounds: bounds.toJSON(),
						viewportHeight: innerHeight,
						pageWidth: document.documentElement.scrollWidth,
						viewport: innerWidth,
						clipped:
							label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight,
						insideViewport:
							bounds.left >= 0 &&
							bounds.top >= 0 &&
							bounds.right <= innerWidth &&
							bounds.bottom <= innerHeight,
						uncovered: [
							[bounds.left + 2, bounds.top + bounds.height / 2],
							[bounds.right - 2, bounds.top + bounds.height / 2],
							[bounds.left + bounds.width / 2, bounds.top + 2],
							[bounds.left + bounds.width / 2, bounds.bottom - 2],
						].every(([x, y]) => button.contains(document.elementFromPoint(x, y))),
					};
				});
			// Deck resize observers can move its scrolling pane after the viewport
			// changes. Wait for a fully visible, uncovered action after native scroll.
			try {
				await action.evaluate((element) =>
					element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" }),
				);
				await action.hover();
				// Leave room above the action for its focus outline in the short pane.
				await page.mouse.wheel(0, -16);
				await action.focus({ preventScroll: true });
				await expect(async () => {
					const layout = await readLayout();
					expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewport);
					expect(layout.clipped).toBe(false);
					expect(layout.insideViewport).toBe(true);
					expect(layout.uncovered).toBe(true);
				}).toPass({ timeout: 5_000 });
			} finally {
				await testInfo.attach(`reflow-${width}-${zoom}`, {
					body: JSON.stringify({
						physicalViewport: { width, height: 800 },
						zoom,
						...(await readLayout()),
					}),
					contentType: "application/json",
				});
				await testInfo.attach(`waiting-${width}-${zoom}`, {
					body: await page.screenshot(),
					contentType: "image/png",
				});
			}
		}
		if (viewport) await page.setViewportSize(viewport);
		await action.focus();
		await action.press("Enter");
		await expect(controls.first()).toBeFocused();
		await testInfo.attach("new-attempt", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		expect(await saved()).toEqual(previous[key]);
		await expect(activity.locator('[aria-live], [role="status"], [role="alert"]')).toHaveCount(0);
		// Opening recovery without editing preserves the original bytes on reload.
		await page.reload();
		await expect(action).toBeVisible();
		expect(await saved()).toEqual(previous[key]);
		await action.press("Enter");
		const draftIds =
			variant === "multiple"
				? [firstId, secondId]
				: variant === "dontKnow"
					? [DONT_KNOW]
					: [secondId];
		for (const id of draftIds) {
			const input = activity.locator(`input[value="${id}"]`);
			await input.focus();
			await page.keyboard.press("Space");
		}
		await page.reload();
		await expect(activity).toHaveAttribute("data-hydrated", "");
		await expect(action).toHaveCount(0);
		expect(await saved()).toMatchObject({
			answer: draftIds,
			checked: false,
			attemptCount: 0,
			history: [previous[key]],
		});
		expect(
			await controls.evaluateAll((inputs) =>
				inputs
					.filter((input) => (input as HTMLInputElement).checked)
					.map((input) => (input as HTMLInputElement).value),
			),
		).toEqual(draftIds);
		for (const control of await controls.all()) await expect(control).toBeEnabled();
		expect(await outcome()).toBe("waiting");
		expect(
			await page.evaluate(
				(id) => window.__praxityBlockState?.getChoiceDependencyView?.()?.status(id),
				questionId,
			),
		).toBe("history");
		await testInfo.attach("draft-reload", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await testInfo.attach("draft-reload-state", {
			body: JSON.stringify({
				answer: await saved(),
				outcome: await outcome(),
				accessibility: await activity.ariaSnapshot(),
			}),
			contentType: "application/json",
		});
		expect(
			await page.evaluate(() =>
				(window.__praxityRuntime as unknown as { getInteractions(): unknown[] }).getInteractions(),
			),
		).toEqual(rows);
		if (variant === "dontKnow") await activity.locator(`input[value="${secondId}"]`).check();
		await activity.locator("[data-assessment-submit]").press("Enter");
		expect(await saved()).toMatchObject({
			answer: variant === "multiple" ? [firstId, secondId] : [secondId],
			checked: true,
			correct: true,
			completed: true,
			attemptCount: 1,
			history: [previous[key]],
		});
		expect(await outcome()).toBe("decided");
		if (presentation === "deck") {
			await page.locator("#deck-next").click();
			await expect(page.locator('[data-deck-slide="recovery-page-2"]')).toBeVisible();
		}
		await testInfo.attach("recovered", { body: await page.screenshot(), contentType: "image/png" });
	});
}
