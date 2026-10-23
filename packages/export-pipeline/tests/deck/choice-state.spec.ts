import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import type { ChoiceResponse } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse } from "../../src/build";
import { expectFocusRing } from "../focus-assertions";

let folder: string, base: string, server: Server;
const entries: Record<string, string> = {};
const questionId = "10000000-0000-4000-8000-000000000001";
const firstId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";

test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "choice-state-"));
	for (const locale of ["en", "fr"] as const) {
		const lesson = readLesson(
			`# Practice\n::: choice ${locale === "en" ? "Choose an action" : "Choisissez une action"} {scored points=10 attempts=2}\n(x) Stop\n( ) Continue\n:::\n`,
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
		for (const version of ["before", "after", "rich"] as const) {
			if (version === "after") {
				response.options[0].isCorrect = false;
				response.options[1].isCorrect = true;
			}
			if (version === "rich") {
				question.data.stem = [
					{
						id: "rich-stem",
						type: "text",
						data: {
							content:
								"<p>Choose <strong>safely</strong> — café, 日本語. <code>stop(&quot;é&quot;)</code></p>",
						},
					},
				];
				question.data.description = [
					{
						id: "rich-description",
						type: "text",
						data: {
							content:
								'<p>Compute <span class="praxity-math-inline" data-math-latex="x^2 + 1">x² + 1</span>.</p><pre><code>  if (é) {\n    stop();\n  }</code></pre>' +
								'<video controls src="media/safe.mp4"><source src="media/safe-alt.mp4" type="video/mp4"><track kind="captions" srclang="en" label="English" src="media/safe.vtt"></video><audio controls src="media/stop.mp3"></audio><img src="media/stop.png" srcset="media/stop2.png 2x" alt="Stop"><ol type="A" start="2" reversed><li value="3">Stop</li><li>Continue</li></ol><a href="procedure.html" lang="en" dir="ltr" aria-description="Safe procedure">Procedure</a>',
						},
					},
				];
				response.options[1].label = "**Continue** — résumé";
			}
			const artifact = await compileCourse({
				id: `choice-state-${locale}`,
				title: "Practice",
				requireKnowledgeChecks: true,
				sourceLocale: locale,
				content: lesson.pages,
			});
			try {
				const key = `${locale}-${version}`;
				entries[key] = `${key}/${artifact.manifest.pages[0].slug}.html`;
				new AdmZip((await deployCourse(artifact, { format: "html" })).zip).extractAllTo(
					join(folder, key),
					true,
				);
			} finally {
				await artifact.dispose();
			}
		}
	}
	server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			if (path.includes("..")) throw new Error("Invalid fixture path");
			const bytes = await readFile(join(folder, path));
			response.writeHead(200, {
				"Content-Type": path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".css")
						? "text/css"
						: "text/html; charset=utf-8",
			});
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	if (folder) await rm(folder, { recursive: true });
});

test("Node and the browser agree on a signed rich-content answer", async ({ page }) => {
	await page.goto(base + entries["en-rich"]);
	const activity = page.locator('[data-island="assessment"]');
	await expect(activity).toHaveAttribute("data-hydrated", "");
	await activity.getByRole("radio", { name: /Continue/ }).check();
	await activity.locator("[data-assessment-submit]").click();
	const result = await page.evaluate(
		(id) => ({
			compiled: JSON.parse(document.getElementById("praxity-host-config")?.textContent ?? "{}")
				.choiceStateSignatures[id],
			answer: window.__praxityBlockState?.get(id),
			score: window.__praxityTracker?.getCurrentScore?.(),
		}),
		questionId,
	);
	expect(result.compiled).toMatch(/^sha256:[a-f0-9]{64}$/);
	expect(result.answer).toMatchObject({
		contentSignature: result.compiled,
		correct: true,
		completed: true,
	});
	expect(result.score).toEqual({ raw: 100, min: 0, max: 100 });
});

for (const locale of ["en", "fr"] as const) {
	test(`material choice change has a described keyboard route to a new attempt in ${locale}`, async ({
		page,
	}, testInfo) => {
		await page.goto(base + entries[`${locale}-before`]);
		const activity = page.locator('[data-island="assessment"]');
		await expect(activity).toHaveAttribute("data-hydrated", "");
		const first = activity.getByRole("radio", { name: /Stop/ });
		await first.focus();
		await page.keyboard.press("Space");
		await activity.locator("[data-assessment-submit]").press("Enter");
		await expect(activity.locator(".praxity-block-assessment")).toHaveAttribute(
			"data-completed",
			"true",
		);
		const rows = await page.evaluate(() =>
			(window.__praxityRuntime as unknown as { getInteractions(): unknown[] }).getInteractions(),
		);
		const previous = await page.evaluate((id) => window.__praxityBlockState?.get(id), questionId);
		expect(previous).toMatchObject({ answer: [firstId], correct: true, completed: true });
		expect(
			await page.evaluate(() =>
				(window.__praxityRuntime as unknown as { getCompletion(): string }).getCompletion(),
			),
		).toBe("completed");
		expect(await page.evaluate(() => window.__praxityTracker?.getCurrentScore?.())).toEqual({
			raw: 100,
			min: 0,
			max: 100,
		});
		await page.goto(base + entries[`${locale}-after`]);
		await expect(activity).toHaveAttribute("data-hydrated", "");
		const card = activity.locator(".praxity-block-assessment");
		await expect(card).not.toHaveAttribute("data-completed");
		await expect(card).toHaveAttribute("data-score", "0");
		expect(
			await page.evaluate(() =>
				(window.__praxityRuntime as unknown as { getCompletion(): string }).getCompletion(),
			),
		).toBe("completed");
		expect(await page.evaluate(() => window.__praxityTracker?.getCurrentScore?.())).toBeNull();
		const action = activity.getByRole("button", {
			name: locale === "en" ? "New attempt" : "Nouvelle tentative",
			exact: true,
		});
		await expect(action).toHaveAccessibleDescription(
			locale === "en"
				? "Your previous answer is kept in history and does not count toward this version of the question. Start a new attempt to continue."
				: "Votre réponse précédente est conservée dans l’historique et ne compte pas pour cette version de la question. Commencez une nouvelle tentative pour continuer.",
		);
		for (
			let n = 0;
			n < 30 && !(await action.evaluate((element) => element === document.activeElement));
			n++
		)
			await page.keyboard.press("Tab");
		await expect(action).toBeFocused();
		await expectFocusRing(action, 2);
		expect(await page.evaluate((id) => window.__praxityBlockState?.get(id), questionId)).toEqual(
			previous,
		);
		expect(
			await page.evaluate(() =>
				(window.__praxityRuntime as unknown as { getInteractions(): unknown[] }).getInteractions(),
			),
		).toEqual(rows);
		const viewport = page.viewportSize();
		for (const [width, zoom, suffix] of [
			[320, 1, "320"],
			[640, 2, "200-percent"],
		] as const) {
			await page.setViewportSize({ width, height: 800 });
			await page.evaluate((scale) => {
				document.documentElement.style.zoom = String(scale);
			}, zoom);
			await page.keyboard.press("Escape");
			await expect(page.locator("[data-nav-menu-toggle]")).toHaveAttribute(
				"aria-expanded",
				"false",
			);
			await expect(page.locator("[data-native-outline]")).toHaveAttribute("inert", "");
			await expect
				.poll(() =>
					page
						.locator("[data-native-outline]")
						.evaluate((outline) => outline.getBoundingClientRect().right),
				)
				.toBeLessThanOrEqual(0);
			await action.scrollIntoViewIfNeeded();
			await action.focus();
			const reflow = await action.evaluate((button) => {
				const label = button.querySelector<HTMLElement>(".mantine-Button-label");
				const bounds = button.getBoundingClientRect();
				return {
					pageWidth: document.documentElement.scrollWidth,
					viewportWidth: window.innerWidth,
					labelWidth: label?.clientWidth,
					labelContentWidth: label?.scrollWidth,
					labelHeight: label?.clientHeight,
					labelContentHeight: label?.scrollHeight,
					whiteSpace: label && getComputedStyle(label).whiteSpace,
					insideViewport:
						bounds.left >= 0 &&
						bounds.top >= 0 &&
						bounds.right <= window.innerWidth &&
						bounds.bottom <= window.innerHeight,
					uncovered: [
						[bounds.left + 2, bounds.top + bounds.height / 2],
						[bounds.right - 2, bounds.top + bounds.height / 2],
						[bounds.left + bounds.width / 2, bounds.top + 2],
						[bounds.left + bounds.width / 2, bounds.bottom - 2],
					].every(([x, y]) => button.contains(document.elementFromPoint(x, y))),
				};
			});
			await testInfo.attach(`new-attempt-reflow-${suffix}`, {
				body: JSON.stringify(reflow),
				contentType: "application/json",
			});
			await testInfo.attach(`new-attempt-route-${suffix}`, {
				body: await page.screenshot(),
				contentType: "image/png",
			});
			expect(reflow.pageWidth).toBeLessThanOrEqual(reflow.viewportWidth);
			expect(reflow.labelContentWidth).toBe(reflow.labelWidth);
			expect(reflow.labelContentHeight).toBe(reflow.labelHeight);
			expect(reflow.whiteSpace).toBe("normal");
			expect(reflow.insideViewport).toBe(true);
			expect(reflow.uncovered).toBe(true);
		}
		await page.evaluate(() => {
			document.documentElement.style.zoom = "";
		});
		if (viewport) await page.setViewportSize(viewport);
		await action.focus();
		await testInfo.attach("new-attempt-route", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await page.keyboard.press("Enter");
		await expect(first).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(activity.getByRole("radio", { name: /Continue/ })).toBeChecked();
		await activity.locator("[data-assessment-submit]").press("Enter");
		expect(
			await page.evaluate((id) => window.__praxityBlockState?.get(id), questionId),
		).toMatchObject({
			answer: [secondId],
			correct: true,
			completed: true,
			attemptCount: 1,
			history: [previous],
		});
		const newRows = await page.evaluate(() =>
			(window.__praxityRuntime as unknown as { getInteractions(): unknown[] }).getInteractions(),
		);
		expect(newRows.slice(0, rows.length)).toEqual(rows);
		expect(newRows).toHaveLength(rows.length + 1);
		expect(newRows.at(-1)).toMatchObject({ id: questionId, correct: true });
		expect(
			await page.evaluate(() =>
				(window.__praxityRuntime as unknown as { getCompletion(): string }).getCompletion(),
			),
		).toBe("completed");
		expect(await page.evaluate(() => window.__praxityTracker?.getCurrentScore?.())).toEqual({
			raw: 100,
			min: 0,
			max: 100,
		});
		await page.reload();
		await expect(activity).toHaveAttribute("data-hydrated", "");
		await expect(
			activity.getByRole("button", {
				name: locale === "en" ? "New attempt" : "Nouvelle tentative",
				exact: true,
			}),
		).toHaveCount(0);
		expect(
			await page.evaluate((id) => window.__praxityBlockState?.get(id), questionId),
		).toMatchObject({ answer: [secondId], correct: true, completed: true, history: [previous] });
		const landmarks = await page
			.locator('main, nav, aside, header, footer, [role="region"]')
			.evaluateAll((elements) =>
				elements.map((element) => ({
					tag: element.tagName,
					role: element.getAttribute("role"),
					label: element.getAttribute("aria-label"),
				})),
			);
		await testInfo.attach("hydrated-landmarks", {
			body: JSON.stringify(landmarks),
			contentType: "application/json",
		});
	});
}
