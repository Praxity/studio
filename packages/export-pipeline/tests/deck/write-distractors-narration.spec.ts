import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { renderWriteDistractors } from "../../src/patterns/write-distractors/render";
import { renderBlockHtml } from "../../src/render-block-html";
import {
	admitWriteDistractorsRuntime,
	captureWriteDistractorsRuntime,
	writeDistractorsContentInput,
	writeDistractorsPageAssets,
	writeDistractorsRuntimeAssets,
} from "../../src/write-distractors";
import { writeDistractorsHarness } from "../a11y/fixtures/write-distractors-harness";
import { silentWav } from "../fixtures/silent-audio";

let directory: string;
let url: string;
let server: Server;

test.beforeAll(async ({ browser }) => {
	// Keep the engine's cold start in shared setup, outside each case's 2 s budget.
	const warmup = await browser.newPage();
	await warmup.close();
	directory = await mkdtemp(join(tmpdir(), "distractor-narration-"));
	const manifest = await writeDistractorsHarness(directory);
	await writeFile(join(directory, "question.wav"), silentWav(10));
	for (const locale of ["en", "fr"]) {
		const html = await readFile(join(directory, `${locale}-light.html`), "utf8");
		const question =
			locale === "en"
				? "When should access needs be considered?"
				: "Quand faut-il prendre en compte les besoins d'accès ?";
		const config = {
			narrationPlaylist: {
				items: [{ id: "question", blockId: "wd", src: "question.wav", duration: 10 }],
				stops: [],
			},
		};
		const strings = {
			play: "Play",
			pause: "Pause",
			seek: "Position",
			durationLoading: "Loading",
			durationUnavailable: "Unavailable",
			speed: "Speed",
			narrationLabel: "Narration",
			narrationOptions: "Narration options",
			noNarration: "No narration",
			listen: "Listen",
			previousSentence: "Previous sentence",
			nextSentence: "Next sentence",
			followNarration: "Follow narration",
		};
		// The prepared runtime fixture retains the real compiler's publication refusal.
		await writeFile(
			join(directory, `${locale}-narration.html`),
			html
				.replace("<main ", '<div data-island="narration"></div><main id="main-content" ')
				.replace(
					'class="praxity-write-distractors',
					'data-block-id="wd" data-block-type="writeDistractors" class="praxity-block praxity-write-distractors',
				)
				.replace(
					"</body>",
					`<script id="praxity-config" type="application/json">${JSON.stringify(config)}</script><script>window.__PRAXITY_STRINGS__=${JSON.stringify(strings)};</script><script type="module">import {initNarrationIsland} from "./${manifest.islands["island-narration"]}"; initNarrationIsland();</script></body>`,
				),
		);
		expect(html).toContain(question);
	}
	const nestedQuestion = "Nested question control?";
	const input = writeDistractorsContentInput("nested", {
		question: nestedQuestion,
		rightAnswer: "NESTED_RIGHT",
		count: 1,
		misconceptions: [{ id: "mistake", label: "NESTED_LABEL" }],
		authorOptions: [{ misconception: "mistake", text: "AUTHOR-OPTION-PRIVATE-NESTED" }],
	});
	const prompt = { question: nestedQuestion, count: 1 as const, items: [{ id: "mistake" }] };
	const nestedBlocks: PraxityBlock[] = [
		{ id: "nested", type: "writeDistractors", data: { content: prompt } },
	];
	const runtime = admitWriteDistractorsRuntime(
		[{ id: "page", title: "Practice", blocks: nestedBlocks }],
		captureWriteDistractorsRuntime({ writeDistractorsContents: [input] }),
	);
	const [asset] = writeDistractorsRuntimeAssets(runtime);
	const [reference] = writeDistractorsPageAssets(runtime, nestedBlocks);
	if (!asset || !reference) throw new Error("Missing nested activity asset");
	await writeFile(join(directory, asset.path), asset.bytes);
	const nestedMarkup = `<div data-block-id="nested" data-block-type="writeDistractors" class="praxity-block">${renderWriteDistractors(prompt, { prefix: "nested", lang: "en", headingLevel: 3, reference })}</div>`;
	const slot: PraxityBlock = { id: "nested-slot", type: "divider", data: {} };
	const accordion = renderBlockHtml(
		{
			id: "accordion",
			type: "accordion",
			data: { items: [{ id: "panel", label: "Nested practice", children: [slot] }] },
		},
		{ enabledIslands: new Set(["accordion"]) },
	).replace(renderBlockHtml(slot), nestedMarkup);
	expect(accordion).toContain('data-block-id="nested"');
	await writeFile(join(directory, "cue.wav"), silentWav(1));
	await writeFile(
		join(directory, "question.vtt"),
		`WEBVTT\n\n00:00:00.050 --> 00:00:00.800\n${nestedQuestion}\n`,
	);
	const nestedConfig = {
		narrationPlaylist: {
			items: [
				{
					id: "nested-question",
					blockId: "nested",
					src: "cue.wav",
					timingsSrc: "question.vtt",
					duration: 1,
				},
			],
			stops: [],
		},
	};
	const nestedHtml = (await readFile(join(directory, "en-narration.html"), "utf8"))
		.replace("</main>", `${accordion}</main>`)
		.replace(
			/(<script id="praxity-config" type="application\/json">)[\s\S]*?(<\/script>)/,
			(_match, open, close) => open + JSON.stringify(nestedConfig) + close,
		)
		.replace(
			"</body>",
			`<script type="module">import {attachIsland} from "./${manifest.islands["island-accordion"]}"; attachIsland();</script></body>`,
		);
	await writeFile(join(directory, "nested-narration.html"), nestedHtml);
	server = createServer(async (request, response) => {
		const file = resolve(directory, `.${new URL(request.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			response.writeHead(403).end();
			return;
		}
		try {
			response.setHeader(
				"Content-Type",
				file.endsWith(".js")
					? "text/javascript"
					: file.endsWith(".vtt")
						? "text/vtt"
						: file.endsWith(".wav")
							? "audio/wav"
							: file.endsWith(".css")
								? "text/css"
								: "text/html; charset=utf-8",
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (directory) await rm(directory, { recursive: true });
});

for (const locale of ["en", "fr"] as const)
	for (const stage of ["unchecked", "checked", "rated"] as const) {
		test.describe(`${locale} ${stage}`, () => {
			test.beforeEach(async ({ page }) => {
				await page.goto(`${url}/${locale}-narration.html`);
				const check = page.getByRole("button", {
					name: locale === "en" ? "Check my answer" : "Vérifier ma réponse",
					exact: true,
				});
				await expect(check).toBeVisible();
				await page.locator("[data-distractor-answer]").fill("LEARNER_PRIVATE_MARKER");
				if (stage !== "unchecked") {
					await check.click();
					await expect(
						page.getByRole("button", { name: locale === "en" ? "Yes" : "Oui", exact: true }),
					).toBeVisible();
					if (stage === "rated")
						await page
							.getByRole("button", { name: locale === "en" ? "Yes" : "Oui", exact: true })
							.click();
				}
				// Settle the real audio before the per-case timing budget.
				await page.getByRole("button", { name: "Listen", exact: true }).click();
				await expect
					.poll(() =>
						page
							.locator("audio[data-narration-player]")
							.evaluate((node) => (node as HTMLAudioElement).readyState),
					)
					.toBeGreaterThan(0);
			});
			test("Follow never Checks, rates or Compares", async ({ page }) => {
				const activity = page.locator("[data-write-distractors]");
				const controls = activity.locator("[data-distractor-controls]");
				const before = await controls.innerHTML();
				const writes = await page.evaluate(
					() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
				);
				await page.getByRole("button", { name: "Play", exact: true }).click();
				await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
				await expect(activity).toHaveAttribute("data-narration-active", "true");
				expect(await controls.innerHTML()).toBe(before);
				expect(
					await page.evaluate(
						() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
					),
				).toBe(writes);
				await expect(activity).not.toContainText("AUTHOR-OPTION-PRIVATE");
				await expect(
					activity.getByRole("button", {
						name:
							locale === "en"
								? "Compare with the author's"
								: "Comparer avec les réponses de l'auteur",
						exact: true,
					}),
				).toHaveCount(stage === "rated" ? 1 : 0);
				if (stage === "unchecked") {
					await expect(activity).not.toContainText(
						locale === "en"
							? "Throughout the design process."
							: "Tout au long du processus de conception.",
					);
					await expect(activity).not.toContainText(
						locale === "en" ? "Access comes last" : "L'accès vient en dernier",
					);
				}
			});
		});
	}

test.describe("timed nested Follow", () => {
	test.beforeEach(async ({ page }) => {
		// As in card-narration.spec.ts, drive media events without a decoder clock.
		await page.addInitScript(() => {
			HTMLMediaElement.prototype.play = async () => {};
		});
		await page.goto(`${url}/nested-narration.html`);
		await expect(page.locator('[data-block-id="accordion"]')).toHaveAttribute("data-hydrated", "");
		await page.getByRole("button", { name: "Nested practice", exact: true }).press("Enter");
		await page
			.locator('[data-block-id="nested"] [data-distractor-answer]')
			.fill("NESTED_LEARNER_PRIVATE");
		await page.getByRole("button", { name: "Nested practice", exact: true }).press("Enter");
		await page.getByRole("button", { name: "Listen", exact: true }).press("Enter");
		await page.locator("audio[data-narration-player]").evaluate((audio) => {
			// Native seeking can stay at zero without playback; control the clock too.
			Object.defineProperty(audio, "currentTime", { value: 0, writable: true });
		});
	});
	test("cue reveal and clip end never Check, rate, Compare or write", async ({ page }) => {
		const nested = page.locator('[data-block-id="nested"]');
		const toggle = page.getByRole("button", { name: "Nested practice", exact: true });
		await expect(toggle).toHaveAttribute("aria-expanded", "false");
		const before = await page
			.locator("[data-distractor-controls]")
			.evaluateAll((nodes) => nodes.map((node) => node.innerHTML));
		const writes = await page.evaluate(
			() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
		);
		await page.evaluate(() => {
			const root = document.querySelector('[data-block-id="accordion"]');
			if (!root) throw new Error("Missing accordion");
			root.setAttribute("data-observed-reveals", "0");
			root.addEventListener("praxity:narration-reveal", () =>
				root.setAttribute(
					"data-observed-reveals",
					String(Number(root.getAttribute("data-observed-reveals")) + 1),
				),
			);
		});
		await page.getByRole("button", { name: "Play", exact: true }).press("Enter");
		await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
		await page.locator("audio[data-narration-player]").evaluate((node) => {
			const audio = node as HTMLAudioElement;
			audio.currentTime = 0.2;
			audio.dispatchEvent(new Event("timeupdate"));
		});
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights;
						return [...(registry?.get("praxity-narration-current") ?? [])].map((range) =>
							range.toString(),
						);
					}),
				{ intervals: [25] },
			)
			.toEqual(["Nested question control?"]);
		await expect(toggle).toHaveAttribute("aria-expanded", "true");
		await expect(page.locator('[data-block-id="accordion"]')).not.toHaveAttribute(
			"data-observed-reveals",
			"0",
		);
		const assertPracticeUntouched = async () => {
			expect(
				await page
					.locator("[data-distractor-controls]")
					.evaluateAll((nodes) => nodes.map((node) => node.innerHTML)),
			).toEqual(before);
			expect(
				await page.evaluate(
					() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
				),
			).toBe(writes);
			await expect(
				nested.getByRole("button", { name: "Check my answer", exact: true }),
			).toHaveCount(1);
			await expect(nested.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
			await expect(
				nested.getByRole("button", { name: "Compare with the author's", exact: true }),
			).toHaveCount(0);
			await expect(page.locator("main")).not.toContainText("AUTHOR-OPTION-PRIVATE");
			await expect(nested).not.toContainText("NESTED_RIGHT");
			await expect(nested).not.toContainText("NESTED_LABEL");
		};
		await assertPracticeUntouched();
		// Exercise the player's end handlers even when native playback cannot advance.
		await page.locator("audio[data-narration-player]").evaluate(async (node) => {
			const audio = node as HTMLAudioElement;
			audio.currentTime = 1;
			audio.dispatchEvent(new Event("timeupdate"));
			audio.dispatchEvent(new Event("ended"));
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			);
		});
		await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
		await assertPracticeUntouched();
	});
});
