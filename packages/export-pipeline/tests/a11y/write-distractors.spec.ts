import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { writeDistractorsHarness } from "./fixtures/write-distractors-harness";

function heldRoute(route: Route | undefined): Route {
	if (!route) throw new Error("No held request");
	return route;
}

let directory: string, url: string, server: ReturnType<typeof createServer>;
test.beforeAll(async ({ browser }) => {
	// Launch the worker browser once, outside the per-case timing budget.
	if (!browser.isConnected()) throw new Error("Browser disconnected");
	directory =
		process.env.PRAXITY_DISTRACTORS_HARNESS ??
		(await mkdtemp(join(tmpdir(), "write-distractors-")));
	if (!process.env.PRAXITY_DISTRACTORS_HARNESS) await writeDistractorsHarness(directory);
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
					: file.endsWith(".css")
						? "text/css"
						: file.endsWith(".woff2")
							? "font/woff2"
							: "text/html; charset=utf-8",
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	// Initialise fonts and axe once, without sharing learner state between cases.
	const warmContext = await browser.newContext();
	try {
		const warmPage = await warmContext.newPage();
		await warmPage.goto(`${url}/en-light.html?pending`);
		await warmPage.evaluate(async () => {
			await document.fonts.ready;
		});
		expect(
			(
				await new AxeBuilder({ page: warmPage })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
	} finally {
		await warmContext.close();
	}
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
});

for (const [lang, theme, width] of [
	["en", "light", 1280],
	["en", "light", 320],
	["fr", "dark", 320],
] as const)
	test.describe(`${lang} ${theme} ${width}`, () => {
		let page: Page, context: BrowserContext, startup: Route | undefined, asset: Route | undefined;
		let available = false,
			requests = 0;
		const copy =
			lang === "en"
				? {
						check: "Check my answer",
						retry: "Retry",
						yes: "Yes",
						no: "Not quite",
						reset: "Start over",
						other: "Something else",
						right: "Throughout the design process.",
					}
				: {
						check: "Vérifier ma réponse",
						retry: "Réessayer",
						yes: "Oui",
						no: "Pas tout à fait",
						reset: "Recommencer",
						other: "Autre idée fausse",
						right: "Tout au long du processus de conception.",
					};
		const answer = () => page.locator("[data-distractor-answer]");
		const check = () => page.getByRole("button", { name: copy.check, exact: true });
		// This fixture has no frames. The single-page axe runner keeps all rules and avoids a temporary tab in WebKit.
		const evidence = async (state: string) => {
			expect(await page.locator("iframe").count()).toBe(0);
			expect(await page.locator("[maxlength]").count()).toBe(0);
			expect(await page.locator("body").innerText()).not.toContain("AUTHOR-OPTION-PRIVATE");
			expect(
				await page.locator("main").evaluate((node) => node.scrollWidth - node.clientWidth),
			).toBeLessThanOrEqual(1);
			expect(
				(
					await new AxeBuilder({ page })
						.include("main")
						.setLegacyMode(true)
						.options({ resultTypes: ["violations"] })
						.analyze()
				).violations,
			).toEqual([]);
			if (process.env.PRAXITY_DISTRACTORS_SCREENSHOTS)
				await page.screenshot({
					path: join(
						process.env.PRAXITY_DISTRACTORS_SCREENSHOTS,
						`${state}-${lang}-${theme}-${width}.png`,
					),
					fullPage: true,
				});
		};
		test.beforeAll(async ({ browser }) => {
			context = await browser.newContext({ viewport: { width, height: 900 } });
		});
		test.afterAll(async () => {
			await context?.close();
		});
		test.beforeEach(async ({ browserName: _browserName }, info) => {
			startup = asset = undefined;
			available = false;
			requests = 0;
			page = await context.newPage();
			await page.route("**/island-write-distractors-*.js", (route) => {
				startup = route;
			});
			await page.route("**/write-distractors/*.js", async (route) => {
				requests++;
				if (available) await route.continue();
				else asset = route;
			});
			await page.goto(`${url}/${lang}-${theme}.html`, { waitUntil: "commit" });
			await expect(answer()).toBeVisible();
			await expect.poll(() => !!startup, { intervals: [10, 25, 50] }).toBe(true);
			// Only the context is shared; learner state and routes belong to each fresh page.
			const title = info.title;
			if (title.startsWith("baseline:") || title.startsWith("ready:")) return;
			await heldRoute(startup).continue();
			await expect(check()).toBeVisible();
			await answer().fill("My answer");
			await expect(check()).toHaveAttribute("aria-disabled", "false");
			if (title.startsWith("refusal:") || title.startsWith("loading:")) return;
			if (
				title.startsWith("unavailable:") ||
				title.startsWith("Retry loading") ||
				title.startsWith("revealed:")
			) {
				await check().press("Enter");
				await expect.poll(() => !!asset).toBe(true);
				if (title.startsWith("unavailable:")) return;
				await heldRoute(asset).abort();
				await expect(page.getByRole("button", { name: copy.retry, exact: true })).toBeVisible();
				asset = undefined;
				if (title.startsWith("Retry loading")) return;
				await page.getByRole("button", { name: copy.retry, exact: true }).press("Enter");
				await expect.poll(() => !!asset).toBe(true);
				return;
			}
			available = true;
			await check().press("Enter");
			await expect(page.getByRole("button", { name: copy.yes, exact: true })).toBeVisible();
			if (title.startsWith("rated:")) return;
			await page.getByRole("button", { name: copy.yes, exact: true }).press("Enter");
			if (title.startsWith("wrong-option")) return;
			await page.locator("fieldset textarea").first().fill("Only after the course is finished.");
			const select = page.getByRole("combobox").first();
			await select.selectOption("other");
			if (title.startsWith("custom draft stays")) return;
			await page.locator("fieldset input").first().fill("Access is a final repair.");
			if (title.startsWith("Start over") || title.startsWith("rated custom")) return;
			await select.selectOption("late");
			if (title.startsWith("selecting Something")) return;
			await select.selectOption("other");
		});
		test.afterEach(async () => {
			await page?.close();
		});
		test("baseline: prompt and unsaved editable answer", async () => {
			await expect(check()).toHaveCount(0);
			await evidence("baseline");
		});
		test("ready: preactivation input saves silently on a fresh page", async () => {
			// This guards the UI; the base enhancer skips pending-read projections, so session tests prove the fix.
			await page.evaluate(() => {
				const status = document.querySelector("[data-distractor-status]");
				if (!status) throw new Error("Missing status");
				const outcomes: string[] = [];
				(window as unknown as { statusOutcomes: string[] }).statusOutcomes = outcomes;
				new MutationObserver(() => outcomes.push(status.textContent ?? "")).observe(status, {
					childList: true,
					subtree: true,
					characterData: true,
				});
			});
			await answer().fill("My first answer");
			if (!startup) throw new Error("No held island request");
			await startup.continue();
			await expect(check()).toBeVisible();
			await expect(answer()).toHaveValue("My first answer");
			await expect(answer()).not.toHaveAttribute("aria-describedby");
			await expect
				.poll(() =>
					page.evaluate(() =>
						(
							window as unknown as {
								fixtureWrites: Array<{ value: { value: { answer: string } } }>;
							}
						).fixtureWrites.map((write) => write.value.value.answer),
					),
				)
				.toEqual(["My first answer"]);
			await page.evaluate(
				() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
			);
			expect(
				await page.evaluate(() =>
					(window as unknown as { statusOutcomes: string[] }).statusOutcomes.filter(Boolean),
				),
			).toEqual([]);
			await expect(page.locator("[data-distractor-status]")).toBeEmpty();
			expect(requests).toBe(0);
			await expect(page.getByText(copy.right, { exact: true })).toHaveCount(0);
			await evidence("ready");
		});
		test("refusal: blank keeps text, associates error and focuses answer", async () => {
			await answer().fill(" ");
			await check().press("Enter");
			await expect(answer()).toBeFocused();
			await expect(answer()).toHaveAttribute("aria-invalid", "true");
			await expect(answer()).toHaveAttribute("aria-describedby", "wd-error");
			await expect(page.getByRole("status")).toHaveText(
				lang === "en" ? "1 field needs attention." : "1 champ demande votre attention.",
			);
			expect(requests).toBe(0);
			await evidence("refusal");
		});
		test("loading: valid Check alone requests authored content", async () => {
			await answer().fill("My answer");
			await check().press("Enter");
			await expect(check()).toHaveAttribute("aria-disabled", "true");
			await expect(check()).toBeFocused();
			await expect(page.getByRole("status")).toHaveText(
				lang === "en"
					? "Loading the comparison. Your answer is kept."
					: "Chargement de la comparaison. Votre réponse est conservée.",
			);
			await expect(page.getByText(copy.right, { exact: true })).toHaveCount(0);
			await expect(answer()).toBeEditable();
			await evidence("loading");
		});
		test("unavailable: deliberate failure retains the answer and enables Retry", async () => {
			await expect.poll(() => !!asset).toBe(true);
			if (!asset) throw new Error("No held asset");
			await asset.abort();
			await expect(page.getByRole("button", { name: copy.retry, exact: true })).toBeVisible();
			await expect(answer()).toHaveValue("My answer");
			await expect(page.getByText(copy.right, { exact: true })).toHaveCount(0);
			await expect(check()).toBeHidden();
			await expect(page.getByRole("button", { name: copy.retry, exact: true })).toBeFocused();
			await evidence("unavailable");
		});
		test("Retry loading guards its action, keeps focus and announces loading", async () => {
			asset = undefined;
			const retry = page.getByRole("button", { name: copy.retry, exact: true });
			await retry.press("Enter");
			await expect.poll(() => !!asset).toBe(true);
			await expect(retry).toHaveAttribute("aria-disabled", "true");
			await expect(retry).toBeFocused();
			await expect(page.getByRole("status")).toHaveText(
				lang === "en"
					? "Loading the comparison. Your answer is kept."
					: "Chargement de la comparaison. Votre réponse est conservée.",
			);
			expect(
				(
					await new AxeBuilder({ page })
						.include("main")
						.setLegacyMode(true)
						.options({ resultTypes: ["violations"] })
						.analyze()
				).violations,
			).toEqual([]);
		});
		test("revealed: Retry succeeds, retains action focus, announces no authored text", async () => {
			available = true;
			if (!asset) throw new Error("No held Retry asset");
			await asset.continue();
			await expect(page.getByText(copy.right, { exact: true })).toBeVisible();
			await expect(answer()).toHaveAttribute("readonly", "");
			await expect(answer()).toBeEnabled();
			await expect(
				page.getByRole("button", { name: copy.reset, exact: true }),
			).toHaveAccessibleDescription(
				lang === "en"
					? "Start over clears your answer, options and comparison. Copy anything you want to keep first."
					: "Recommencer efface votre réponse, vos propositions et la comparaison. Copiez d'abord ce que vous voulez conserver.",
			);
			await expect(page.getByRole("status")).toHaveText(
				lang === "en"
					? "The right answer is shown. Decide whether your answer was right."
					: "La bonne réponse est affichée. Décidez si votre réponse était bonne.",
			);
			// Check is the retained reveal action, including a deliberate Retry.
			await expect(check()).toBeFocused();
			await evidence("revealed");
		});
		test("rated: native fields B/C, retained custom draft and rating focus", async ({
			browserName,
		}) => {
			const yes = page.getByRole("button", { name: copy.yes, exact: true });
			await yes.press("Enter");
			await expect(yes).toBeFocused();
			await expect(yes).toHaveAttribute("aria-pressed", "true");
			await page.keyboard.press(
				browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
			);
			await expect(page.getByRole("button", { name: copy.no, exact: true })).toBeFocused();
			await page.keyboard.press(
				browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
			);
			await expect(page.locator("fieldset textarea").first()).toBeFocused();
			await expect(page.locator("fieldset")).toHaveCount(2);
			await expect(page.locator("fieldset legend")).toHaveText(
				lang === "en"
					? ["Wrong option B", "Wrong option C"]
					: ["Mauvaise réponse B", "Mauvaise réponse C"],
			);
		});
		test("wrong-option text and native select reveal the custom field", async () => {
			await page.locator("fieldset textarea").first().fill("Only after the course is finished.");
			const select = page.getByRole("combobox").first();
			await expect(select).toHaveCSS("appearance", "auto");
			const spacing = await page
				.locator("fieldset")
				.first()
				.evaluate((group) => {
					const text = group.querySelector("textarea"),
						label = group.querySelector("label"),
						select = group.querySelector("select");
					if (!text || !label || !select) throw new Error("Missing native fields");
					return {
						afterControl: label.getBoundingClientRect().top - text.getBoundingClientRect().bottom,
						afterLabel: select.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
					};
				});
			expect(spacing.afterControl).toBeGreaterThan(spacing.afterLabel);
			await select.focus();
			await select.selectOption({ label: copy.other });
			await expect(select).toBeFocused();
		});
		test("custom draft stays while another mistaken idea is selected", async () => {
			const select = page.getByRole("combobox").first();
			await page.locator("fieldset input").first().fill("Access is a final repair.");
			await select.selectOption("late");
			await expect(page.locator("fieldset input").first()).toBeHidden();
		});
		test("selecting Something else restores the custom draft", async () => {
			await page.getByRole("combobox").first().selectOption("other");
			await expect(page.locator("fieldset input").first()).toHaveValue("Access is a final repair.");
			await expect(page.getByRole("button", { name: /Compare|Comparer/ })).toHaveCount(1);
		});
		test("rated custom fields retain reflow and accessibility", async () => {
			await evidence("rated");
		});
		if (lang === "en" && width === 320) {
			test("rated at 400 percent scale and 320 CSS pixels", async ({ browserName }) => {
				if (browserName === "chromium" && process.env.PRAXITY_DISTRACTORS_SCREENSHOTS) {
					const cdp = await context.newCDPSession(page);
					await cdp.send("Emulation.setDeviceMetricsOverride", {
						width: 320,
						height: 225,
						deviceScaleFactor: 4,
						mobile: false,
					});
					expect(
						await page.evaluate(() => ({ width: innerWidth, scale: devicePixelRatio })),
					).toEqual({ width: 320, scale: 4 });
					await evidence("rated-zoom400");
					await cdp.send("Emulation.clearDeviceMetricsOverride");
					await cdp.detach();
				} else await evidence("rated-zoom400");
			});
			test("rated text spacing overrides retain reflow", async () => {
				await page.addStyleTag({
					content:
						"* {line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important;} p {margin-bottom: 2em !important;}",
				});
				await evidence("rated-spacing");
			});
		}
		test("Start over clears all stages and returns focus", async () => {
			await page.getByRole("button", { name: copy.reset, exact: true }).press("Enter");
			await expect(answer()).toBeFocused();
			await expect(answer()).toHaveValue("");
			await expect(answer()).toBeEditable();
			await expect(page.locator("fieldset")).toHaveCount(0);
			await expect(page.getByText(copy.right, { exact: true })).toHaveCount(0);
			await expect(page.getByRole("status")).toHaveText(
				lang === "en" ? "Answer and options cleared." : "Réponses effacées.",
			);
			expect(
				(
					await new AxeBuilder({ page })
						.include("main")
						.setLegacyMode(true)
						.options({ resultTypes: ["violations"] })
						.analyze()
				).violations,
			).toEqual([]);
		});
	});

test.describe("activation boundaries", () => {
	let page: Page, context: BrowserContext;
	test.beforeAll(async ({ browser }) => {
		context = await browser.newContext();
	});
	test.afterAll(async () => {
		await context?.close();
	});
	test.beforeEach(async () => {
		page = await context.newPage();
	});
	test.afterEach(async () => {
		await page?.close();
	});
	test("empty edit during provider pending survives admission", async () => {
		await page.goto(`${url}/en-light.html?pending`);
		await expect(page.locator("[data-distractor-notice]")).toBeVisible({ timeout: 500 });
		await expect(page.locator("[data-distractor-notice]")).toHaveText("Restoring your progress.");
		await page.locator("[data-distractor-answer]").fill("will clear");
		await page.locator("[data-distractor-answer]").fill("");
		expect(
			(
				await new AxeBuilder({ page })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
		await page.evaluate(() =>
			(window as unknown as { installFixtureProvider(): void }).installFixtureProvider(),
		);
		await expect(page.getByRole("button", { name: "Check my answer", exact: true })).toBeVisible();
		await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
		expect(
			await page.evaluate(
				() =>
					(
						window as unknown as { fixtureWrites: Array<{ value: { value: { answer: string } } }> }
					).fixtureWrites.at(-1)?.value.value.answer,
			),
		).toBe("");
	});
	test("support failure during editing cannot turn Retry into Check", async () => {
		let authoredRequests = 0;
		await page.route("**/chunks/write-distractors-draft-*.js", (route) => route.abort());
		await page.route("**/write-distractors/*.js", (route) => {
			authoredRequests++;
			return route.continue();
		});
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My draft");
		await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
		await page.unroute("**/chunks/write-distractors-draft-*.js");
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Check my answer", exact: true }),
		).toHaveAttribute("aria-disabled", "false");
		await expect(page.getByRole("button", { name: "Check my answer", exact: true })).toBeFocused();
		expect(authoredRequests).toBe(0);
		await expect(page.getByText("Throughout the design process.", { exact: true })).toHaveCount(0);
		await page.unroute("**/write-distractors/*.js");
	});
	test("empty edit while session code loads never replays an older draft", async () => {
		let held: Route | undefined;
		await page.route("**/chunks/write-distractors-draft-*.js", (route) => {
			held = route;
		});
		await page.goto(`${url}/en-light.html`);
		const answer = page.locator("[data-distractor-answer]");
		await answer.fill("Will clear");
		await answer.fill("");
		await expect.poll(() => !!held).toBe(true);
		if (!held) throw new Error("No held session support");
		await held.continue();
		await expect(
			page.getByRole("button", { name: "Check my answer", exact: true }),
		).toHaveAttribute("aria-disabled", "false");
		await expect(answer).toHaveValue("");
		expect(
			await page.evaluate(() =>
				(
					window as unknown as { fixtureWrites: Array<{ value: { value: { answer: string } } }> }
				).fixtureWrites.map((write) => write.value.value.answer),
			),
		).toEqual([""]);
		await page.unroute("**/chunks/write-distractors-draft-*.js");
	});
	test("reentrant provider replacement during the initial read cannot suspend its successor", async () => {
		let startup: Route | undefined;
		await page.route("**/island-write-distractors-*.js", (route) => {
			startup = route;
		});
		await page.goto(`${url}/en-light.html`, { waitUntil: "commit" });
		await expect(page.locator("[data-distractor-answer]")).toBeVisible();
		await page.evaluate(() => {
			const current = window.__praxityBlockState;
			if (!current) throw new Error("No fixture provider");
			let replaced = false;
			window.__praxityBlockState = {
				...current,
				get(id) {
					if (!replaced) {
						replaced = true;
						window.__praxityBlockState = current;
						const owner = window.__praxitySelfCheckDocument,
							life = owner?.lifetime();
						if (life) owner?.admit(life);
					}
					return current.get(id);
				},
			};
			const owner = window.__praxitySelfCheckDocument,
				life = owner?.lifetime();
			if (life) owner?.admit(life);
		});
		if (!startup) throw new Error("No initial module");
		await startup.continue();
		await expect(
			page.getByRole("button", { name: "Check my answer", exact: true }),
		).toHaveAttribute("aria-disabled", "false");
		await page.locator("[data-distractor-answer]").fill("Successor draft");
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							window as unknown as {
								fixtureWrites: Array<{ value: { value: { answer: string } } }>;
							}
						).fixtureWrites.at(-1)?.value.value.answer,
				),
			)
			.toBe("Successor draft");
		await page.unroute("**/island-write-distractors-*.js");
	});
	test("releasing a mount revokes its held code load before a successor attaches", async () => {
		let held: Route | undefined;
		await page.route("**/chunks/write-distractors-draft-*.js", (route) => {
			held = route;
		});
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("Retained native draft");
		await expect.poll(() => !!held).toBe(true);
		await page.evaluate(() =>
			(window as unknown as { releaseDistractors(): void }).releaseDistractors(),
		);
		if (!held) throw new Error("No held support");
		await held.continue();
		await page.unroute("**/chunks/write-distractors-draft-*.js");
		// A later task observes completion of the revoked import before the replacement mounts.
		await page.evaluate(async () => {
			await new Promise<void>((done) => requestAnimationFrame(() => done()));
		});
		expect(
			await page.evaluate(() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites),
		).toEqual([]);
		await page.evaluate(() =>
			(window as unknown as { remountDistractors(): void }).remountDistractors(),
		);
		await page.locator("[data-distractor-answer]").fill("Current native draft");
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							window as unknown as {
								fixtureWrites: Array<{ value: { value: { answer: string } } }>;
							}
						).fixtureWrites.at(-1)?.value.value.answer,
				),
			)
			.toBe("Current native draft");
	});
	test("provider replacement during native input never transfers the old draft", async () => {
		await page.goto(`${url}/en-light.html`);
		const answer = page.locator("[data-distractor-answer]");
		await answer.fill("Prior learner answer");
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
				),
			)
			.toBe(1);
		await page.evaluate(() => {
			document.body.addEventListener(
				"input",
				() => {
					const view = window as unknown as { replacementWrites: unknown[] };
					view.replacementWrites = [];
					window.__praxityBlockState = {
						get: () => undefined,
						set: (_id, value) => {
							view.replacementWrites.push(value);
						},
						getSaveResult: () => ({ status: "saved", destination: "device" }),
					};
					const owner = window.__praxitySelfCheckDocument,
						life = owner?.lifetime();
					if (life) owner?.admit(life);
				},
				{ once: true, capture: true },
			);
		});
		await answer.fill("Old input must not transfer");
		await expect(answer).toHaveValue("");
		expect(
			await page.evaluate(
				() => (window as unknown as { replacementWrites: unknown[] }).replacementWrites,
			),
		).toEqual([]);
		await answer.fill("Current learner answer");
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						window as unknown as { replacementWrites: Array<{ value: { answer: string } }> }
					).replacementWrites.map((value) => value.value.answer),
				),
			)
			.toEqual(["Current learner answer"]);
	});
	test("a remounted field cannot migrate its earlier provider's native bytes", async () => {
		await page.goto(`${url}/en-light.html`);
		const answer = page.locator("[data-distractor-answer]");
		await answer.fill("Earlier provider draft");
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
				),
			)
			.toBe(1);
		await page.evaluate(() => {
			const view = window as unknown as {
				releaseDistractors(): void;
				remountDistractors(): void;
				replacementWrites: unknown[];
			};
			view.releaseDistractors();
			view.replacementWrites = [];
			window.__praxityBlockState = {
				get: () => undefined,
				set: (_id, value) => {
					view.replacementWrites.push(value);
				},
				getSaveResult: () => ({ status: "saved", destination: "device" }),
			};
			const owner = window.__praxitySelfCheckDocument,
				life = owner?.lifetime();
			if (life) owner?.admit(life);
			view.remountDistractors();
		});
		await expect(answer).toHaveValue("");
		expect(
			await page.evaluate(
				() => (window as unknown as { replacementWrites: unknown[] }).replacementWrites,
			),
		).toEqual([]);
		await answer.fill("Fresh provider draft");
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						window as unknown as { replacementWrites: Array<{ value: { answer: string } }> }
					).replacementWrites.map((value) => value.value.answer),
				),
			)
			.toEqual(["Fresh provider draft"]);
	});
	test("oversized paste is retained and refused without content request", async () => {
		await page.goto(`${url}/en-light.html`);
		const answer = page.locator("[data-distractor-answer]");
		await answer.fill("x".repeat(2001));
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		await expect(answer).toHaveValue("x".repeat(2001));
		await expect(answer).toBeFocused();
		await expect(page.locator("[data-distractor-error]")).toHaveText(
			"Keep your answer to 2000 characters or fewer.",
		);
		await expect(answer).toHaveAttribute("aria-describedby", "wd-error");
		expect(
			(
				await new AxeBuilder({ page })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
	});
	test("successful Check keeps focus, Not quite selects builder, return retains writes", async () => {
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My answer");
		const check = page.getByRole("button", { name: "Check my answer", exact: true });
		await check.press("Enter");
		await expect(page.getByRole("button", { name: "Not quite", exact: true })).toBeVisible();
		await expect(check).toBeFocused();
		const no = page.getByRole("button", { name: "Not quite", exact: true });
		await no.press("Enter");
		await expect(no).toHaveAttribute("aria-pressed", "true");
		await expect(no).toBeFocused();
		expect(
			(
				await new AxeBuilder({ page })
					.include("main")
					.setLegacyMode(true)
					.options({ resultTypes: ["violations"] })
					.analyze()
			).violations,
		).toEqual([]);
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
		});
		await expect(page.locator("fieldset textarea").first()).toBeVisible();
		await expect(no).toBeFocused();
		await page.locator("fieldset textarea").first().fill("After publication");
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(
							window as unknown as {
								fixtureWrites: Array<{ value: { value: { options: Array<{ text: string }> } } }>;
							}
						).fixtureWrites.at(-1)?.value.value.options[0].text,
				),
			)
			.toBe("After publication");
	});
});

for (const protocol of ["http", "file"] as const)
	test(`${protocol}: explicit bootstrap attaches the island and reveals after Check`, async ({
		page,
	}) => {
		await page.goto(
			protocol === "http"
				? `${url}/en-light-bootstrap.html`
				: pathToFileURL(join(directory, "en-light-bootstrap.html")).href,
		);
		const check = page.getByRole("button", { name: "Check my answer", exact: true });
		await expect(check).toHaveAttribute("aria-disabled", "false");
		await page.locator("[data-distractor-answer]").fill("My answer");
		await check.click();
		await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
		await expect(check).toBeFocused();
		await expect(page.getByText("Throughout the design process.", { exact: true })).toBeVisible();
	});

test.describe("review regressions", () => {
	let page: Page, context: BrowserContext;
	test.beforeAll(async ({ browser }) => {
		context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	});
	test.afterAll(async () => {
		await context?.close();
	});
	test.beforeEach(async () => {
		page = await context.newPage();
	});
	test.afterEach(async () => {
		await page?.close();
	});
	test("draft saving and unchecked restore defer comparison support until valid Check", async () => {
		const requested: string[] = [];
		page.on("request", (request) => {
			if (/write-distractors-(?:draft|support)-/.test(request.url())) requested.push(request.url());
		});
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My draft");
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { fixtureWrites: unknown[] }).fixtureWrites.length,
				),
			)
			.toBe(1);
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
		});
		await expect(page.locator("[data-distractor-notice]")).toBeHidden();
		expect(requested.filter((url) => url.includes("-support-"))).toEqual([]);
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
		expect(requested.filter((url) => url.includes("-support-"))).toHaveLength(1);
	});
	test("Retry can restore draft support after the answer is cleared", async () => {
		await page.route("**/chunks/write-distractors-draft-*.js", (route) => route.abort());
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("Draft");
		const retry = page.getByRole("button", { name: "Retry", exact: true });
		await expect(retry).toBeVisible();
		await page.locator("[data-distractor-answer]").fill("");
		await page.unroute("**/chunks/write-distractors-draft-*.js");
		await retry.press("Enter");
		await expect(page.getByRole("button", { name: "Check my answer", exact: true })).toBeVisible({
			timeout: 500,
		});
		await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
	});
	test("Retry recovers a failed Check-only module without refetching draft code", async () => {
		let drafts = 0;
		page.on("request", (request) => {
			if (request.url().includes("/chunks/write-distractors-draft-")) drafts++;
		});
		await page.route("**/chunks/write-distractors-support-*.js", (route) => route.abort());
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My answer");
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		const retry = page.getByRole("button", { name: "Retry", exact: true });
		await expect(retry).toBeVisible();
		await page.unroute("**/chunks/write-distractors-support-*.js");
		await retry.click();
		await expect(page.getByRole("button", { name: "Yes", exact: true })).toBeVisible({
			timeout: 500,
		});
		expect(drafts).toBe(1);
	});
	test("rating remains keyboard changeable after either selection", async ({ browserName }) => {
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My answer");
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		const yes = page.getByRole("button", { name: "Yes", exact: true }),
			no = page.getByRole("button", { name: "Not quite", exact: true });
		await yes.focus();
		await page.keyboard.press("Enter");
		await page.keyboard.press(
			browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
		);
		await expect(no).toBeFocused({ timeout: 500 });
		await page.keyboard.press("Enter");
		await expect(no).toHaveAttribute("aria-pressed", "true");
		await expect(yes).toHaveAttribute("aria-pressed", "false");
		await page.keyboard.press(
			browserName === "webkit" && process.platform === "darwin" ? "Alt+Shift+Tab" : "Shift+Tab",
		);
		await expect(yes).toBeFocused();
		await page.keyboard.press("Space");
		await expect(yes).toHaveAttribute("aria-pressed", "true");
		await expect(no).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator("fieldset")).toHaveCount(2);
	});
	test("Start over describes its visible loss hint", async () => {
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My answer");
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		const reset = page.getByRole("button", { name: "Start over", exact: true });
		await expect(reset).toHaveAccessibleDescription(
			"Start over clears your answer, options and comparison. Copy anything you want to keep first.",
			{ timeout: 500 },
		);
		await expect(
			page.getByText(
				"Start over clears your answer, options and comparison. Copy anything you want to keep first.",
				{ exact: true },
			),
		).toBeVisible();
	});
	test("blank refusal survives persisted return and clears only after an edit", async () => {
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill(" ");
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		await expect(page.locator("[data-distractor-answer]")).toHaveAttribute("aria-invalid", "true");
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
		});
		await expect(page.locator("[data-distractor-notice]")).toBeHidden();
		await expect(page.locator("[data-distractor-answer]")).toHaveAttribute(
			"aria-describedby",
			"wd-error",
			{ timeout: 500 },
		);
		await expect(page.locator("[data-distractor-error]")).toBeVisible();
		await page.locator("[data-distractor-answer]").fill("Now valid");
		await expect(page.locator("[data-distractor-error]")).toBeHidden();
	});
	for (const remount of [false, true])
		test(`${remount ? "a remounted" : "a"} blank refusal belongs to its provider and clears in a new empty scope`, async () => {
			await page.goto(`${url}/en-light.html`);
			await page.getByRole("button", { name: "Check my answer", exact: true }).press("Enter");
			await expect(page.locator("[data-distractor-error]")).toBeVisible();
			await page.evaluate((remount) => {
				const fixture = window as unknown as {
					releaseDistractors(): void;
					remountDistractors(): void;
				};
				if (remount) fixture.releaseDistractors();
				window.__praxityBlockState = {
					get: () => undefined,
					set() {},
					getSaveResult: () => ({ status: "saved", destination: "device" }),
				};
				const owner = window.__praxitySelfCheckDocument,
					life = owner?.lifetime();
				if (life) owner?.admit(life);
				if (remount) fixture.remountDistractors();
			}, remount);
			await expect(page.locator("[data-distractor-error]")).toBeHidden({ timeout: 500 });
			await expect(page.locator("[data-distractor-answer]")).not.toHaveAttribute("aria-invalid");
		});
	test("identical aborted Retries each mutate the live status", async () => {
		await page.route("**/write-distractors/*.js", (route) => route.abort());
		await page.goto(`${url}/en-light.html`);
		await page.locator("[data-distractor-answer]").fill("My answer");
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		const retry = page.getByRole("button", { name: "Retry", exact: true });
		await expect(retry).toBeVisible();
		await page.evaluate(() => {
			const status = document.querySelector("[role=status]");
			if (!status) throw new Error("Missing status");
			(window as unknown as { statusOutcomes: string[] }).statusOutcomes = [];
			new MutationObserver(() => {
				(window as unknown as { statusOutcomes: string[] }).statusOutcomes.push(
					status.textContent ?? "",
				);
			}).observe(status, { childList: true, subtree: true, characterData: true });
		});
		for (let attempt = 0; attempt < 2; attempt++) {
			await retry.click();
			await expect(retry).toHaveAttribute("aria-disabled", "false");
			await expect(page.getByRole("status")).toHaveText(
				"Comparison is unavailable. You can still write and copy your answer.",
			);
		}
		const outcomes = await page.evaluate(
			() => (window as unknown as { statusOutcomes: string[] }).statusOutcomes,
		);
		expect(outcomes.filter((text) => text === "").length).toBeGreaterThanOrEqual(2);
		expect(
			outcomes.filter(
				(text) => text === "Comparison is unavailable. You can still write and copy your answer.",
			).length,
		).toBeGreaterThanOrEqual(2);
	});
});

type DistractorFixture = {
	fixtureState: Map<string, unknown>;
	fixtureWrites: Array<{ id: string; value: unknown }>;
	fixtureSaveFailure: boolean;
	fixtureDeviceScope: string;
	installFixtureProvider(): void;
	liveOutcomes: string[];
};
async function observeDistractorNotice(page: Page) {
	await page.evaluate(() => {
		const fixture = window as unknown as { noticeMoves: number; noticeTextChanges: number };
		fixture.noticeMoves = fixture.noticeTextChanges = 0;
		const notice = document.querySelector("[data-distractor-notice]");
		if (!notice?.parentElement) throw new Error("Missing notice");
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				if ([...record.addedNodes, ...record.removedNodes].includes(notice)) fixture.noticeMoves++;
				if (record.target === notice || notice.contains(record.target)) fixture.noticeTextChanges++;
			}
		});
		observer.observe(notice.parentElement, { childList: true });
		observer.observe(notice, { childList: true, characterData: true, subtree: true });
	});
}
async function savedStage(
	page: Page,
	stage: "draft" | "builder" | "result" | "invalid" | "changed" | "oversized",
	lang = "en",
	theme = "light",
	custom = false,
) {
	await page.goto(`${url}/${lang}-${theme}.html?pending`);
	await page.evaluate(
		({ stage, custom }) => {
			const fixture = window as unknown as DistractorFixture;
			const root = document.querySelector<HTMLElement>("[data-write-distractors]");
			if (!root) throw new Error("No activity");
			fixture.fixtureState.set("wd", {
				version: 1,
				kind: "write-distractors",
				contentRevision:
					stage === "changed" ? `sha256:${"0".repeat(64)}` : root.dataset.distractorRevision,
				value: {
					answer: stage === "oversized" ? "x".repeat(2001) : "Saved answer",
					hadIt: stage === "draft" ? null : true,
					shown: stage === "result",
					options: [
						{
							text: "Only at the end",
							misconception: stage === "invalid" ? "retired-id" : "late",
							custom: "Old custom",
						},
						{
							text: "Only for average needs",
							misconception: custom ? "other" : "average",
							custom: custom ? "My own idea $& $' $` $$" : "",
						},
					],
				},
			});
			const heading = document.querySelector("h1");
			if (heading) {
				heading.tabIndex = -1;
				heading.focus();
			}
			fixture.liveOutcomes = [];
			const status = document.querySelector("[data-distractor-status]");
			if (status)
				new MutationObserver(() => fixture.liveOutcomes.push(status.textContent ?? "")).observe(
					status,
					{ childList: true, characterData: true, subtree: true },
				);
			fixture.installFixtureProvider();
		},
		{ stage, custom },
	);
}
async function newStateEvidence(page: Page) {
	expect(
		await page.locator("[data-write-distractors]").evaluate((root) => {
			const actions = root.querySelector("[data-distractor-controls]");
			const save = root.querySelector("[data-distractor-save]");
			const destination = root.querySelector("[data-distractor-destination]");
			const notice = root.querySelector("[data-distractor-notice]");
			return (
				(actions?.nextElementSibling === save ||
					(actions?.nextElementSibling === notice && notice?.nextElementSibling === save)) &&
				destination === root.lastElementChild
			);
		}),
	).toBe(true);
	expect(await page.locator("[maxlength]").count()).toBe(0);
	expect(
		await page.locator("main").evaluate((node) => node.scrollWidth - node.clientWidth),
	).toBeLessThanOrEqual(1);
	expect(
		(
			await new AxeBuilder({ page })
				.include("main")
				.setLegacyMode(true)
				.options({ resultTypes: ["violations"] })
				.analyze()
		).violations,
	).toEqual([]);
}

for (const [lang, theme, width] of [
	["en", "light", 1280],
	["en", "light", 320],
	["fr", "dark", 320],
] as const)
	test.describe(`comparison and recovery ${lang} ${width}`, () => {
		let context: BrowserContext, page: Page;
		const compareName =
			lang === "en" ? "Compare with the author's" : "Comparer avec les réponses de l'auteur";
		const resetName = lang === "en" ? "Start over" : "Recommencer";
		test.beforeAll(async ({ browser }) => {
			context = await browser.newContext({ viewport: { width, height: 900 } });
		});
		test.afterAll(async () => {
			await context?.close();
		});
		test.beforeEach(async () => {
			page = await context.newPage();
		});
		test.afterEach(async () => {
			await page?.close();
		});
		test("loading and unavailable status follows actions; recovery notice precedes fields", async () => {
			let content: Route | undefined;
			await page.route("**/write-distractors/*.js", (route) => {
				content = route;
			});
			await savedStage(page, "draft", lang, theme);
			await expect(page.locator("[data-distractor-answer]")).toHaveValue("Saved answer");
			await page.locator('[data-distractor-action="check"]').click();
			await expect.poll(() => !!content).toBe(true);
			const normalOrder = () =>
				page
					.locator("[data-write-distractors]")
					.evaluate(
						(root) =>
							root.querySelector("[data-distractor-controls]")?.nextElementSibling ===
							root.querySelector("[data-distractor-notice]"),
					);
			await expect(page.locator("[data-distractor-notice]")).toHaveText(
				lang === "en"
					? "Loading the comparison. Your answer is kept."
					: "Chargement de la comparaison. Votre réponse est conservée.",
			);
			expect(await normalOrder()).toBe(true);
			await heldRoute(content).abort();
			await expect(page.locator('[data-distractor-action="retry"]')).toBeVisible();
			expect(await normalOrder()).toBe(true);
			await page.unroute("**/write-distractors/*.js");
			await savedStage(page, "invalid", lang, theme);
			await expect(page.locator("[data-distractor-recovery] textarea").first()).toHaveValue(
				"Saved answer",
			);
			expect(
				await page.locator("[data-write-distractors]").evaluate((root) => {
					const notice = root.querySelector("[data-distractor-notice]");
					const recovery = root.querySelector("[data-distractor-recovery]");
					return (
						notice?.nextElementSibling === recovery &&
						recovery?.nextElementSibling === root.querySelector("[data-distractor-controls]")
					);
				}),
			).toBe(true);
		});
		test("successful Compare does not repeat an already announced save failure", async () => {
			await savedStage(page, "builder", lang, theme);
			await expect(page.locator("fieldset")).toHaveCount(2);
			await page.evaluate(() => {
				(window as unknown as DistractorFixture).fixtureSaveFailure = true;
			});
			await page.locator("fieldset textarea").first().fill("My revised option");
			const failure =
				lang === "en"
					? "Your latest work is not saved. Keep a copy before leaving this page."
					: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.";
			await expect(page.locator("[data-distractor-status]")).toHaveText(failure);
			await page.getByRole("button", { name: compareName, exact: true }).click();
			const result =
				lang === "en"
					? "Your labels match 2 of the author's 2 mistaken ideas. You added 0 of your own."
					: "Idées fausses en commun avec l'auteur : 2 sur 2. Autres idées fausses : 0.";
			await expect(page.locator("[data-distractor-status]")).toHaveText(result);
			expect(
				await page.evaluate(() =>
					(window as unknown as DistractorFixture).liveOutcomes.filter(Boolean),
				),
			).toEqual([failure, result]);
			await expect(page.locator("[data-distractor-save]")).toBeVisible();
		});

		for (const stage of ["draft", "builder", "result"] as const)
			test(`silently restores ${stage} without saving or moving focus`, async () => {
				await savedStage(page, stage, lang, theme);
				const answer = page.locator("[data-distractor-answer]");
				await expect(answer).toHaveValue("Saved answer");
				await expect(page.locator("h1")).toBeFocused();
				await expect(page.locator("[data-distractor-status]")).toHaveText("");
				await expect(page.locator("[data-distractor-notice]")).toBeHidden();
				if (stage === "draft") {
					await expect(answer).toBeEditable();
					await expect(
						page.getByRole("button", { name: lang === "en" ? "Yes" : "Oui", exact: true }),
					).toHaveCount(0);
				} else if (stage === "builder")
					await expect(page.locator("fieldset textarea").first()).toBeEditable();
				else {
					await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
					await expect(
						page.getByRole("button", { name: compareName, exact: true }),
					).toHaveAttribute("aria-disabled", "true");
					await expect(
						page.getByRole("button", { name: lang === "en" ? "Yes" : "Oui", exact: true }),
					).toHaveAttribute("aria-disabled", "true");
				}
				expect(
					await page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites),
				).toEqual([]);
				await newStateEvidence(page);
			});
		for (const stage of ["invalid", "changed", "oversized"] as const)
			test(`${stage} restore retains full copyable text and its notice through edits`, async () => {
				await savedStage(page, stage, lang, theme);
				const recovery = page.locator("[data-distractor-recovery] textarea").first();
				await expect(recovery).toHaveValue(
					stage === "oversized" ? "x".repeat(2001) : "Saved answer",
				);
				await expect(recovery).toHaveAttribute("readonly", "");
				await expect(recovery).toBeEnabled();
				expect(
					await page
						.locator("[data-distractor-recovery] textarea")
						.evaluateAll((nodes) =>
							nodes.every((node) => (node as HTMLTextAreaElement).value !== ""),
						),
				).toBe(true);
				expect(
					await page.locator("[data-write-distractors]").evaluate((root) => {
						const notice = root.querySelector("[data-distractor-notice]");
						const recovery = root.querySelector("[data-distractor-recovery]");
						const reset = root.querySelector('[data-distractor-action="start-over"]');
						return (
							!!notice &&
							!!recovery &&
							!!reset &&
							!!(notice.compareDocumentPosition(recovery) & Node.DOCUMENT_POSITION_FOLLOWING) &&
							!!(recovery.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING)
						);
					}),
				).toBe(true);
				await expect(page.locator("h1")).toBeFocused();
				await expect(page.locator("[data-distractor-status]")).toHaveText("");
				const notice = await page.locator("[data-distractor-notice]").innerText();
				expect(notice).toContain(
					stage === "changed"
						? lang === "en"
							? "activity has changed"
							: "activité a changé"
						: lang === "en"
							? "could not be restored"
							: "pu être restauré",
				);
				await observeDistractorNotice(page);
				await page.locator("[data-distractor-answer]").fill("New memory draft");
				await expect(page.locator("[data-distractor-notice]")).toHaveText(notice);
				await expect(page.locator("[data-distractor-save]")).toBeVisible();
				const failure =
					lang === "en"
						? "Your latest work is not saved. Keep a copy before leaving this page."
						: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.";
				await expect(page.locator("[data-distractor-status]")).toHaveText(failure);
				await page.locator("[data-distractor-answer]").fill("");
				await page.evaluate(
					() =>
						new Promise<void>((done) =>
							requestAnimationFrame(() => requestAnimationFrame(() => done())),
						),
				);
				expect(
					await page.evaluate(() =>
						(window as unknown as DistractorFixture).liveOutcomes.filter(Boolean),
					),
				).toEqual([failure]);
				await expect(page.locator("[data-distractor-notice]")).toHaveText(notice);
				expect(
					await page.evaluate(() => {
						const fixture = window as unknown as { noticeMoves: number; noticeTextChanges: number };
						return { moves: fixture.noticeMoves, textChanges: fixture.noticeTextChanges };
					}),
				).toEqual({ moves: 0, textChanges: 0 });
				await expect(recovery).toHaveValue(
					stage === "oversized" ? "x".repeat(2001) : "Saved answer",
				);
				expect(
					await page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites),
				).toEqual([]);
				await newStateEvidence(page);
			});
		test("right and duplicate refusals associate errors and focus first invalid field", async () => {
			await savedStage(page, "builder", lang, theme);
			const texts = page.locator("fieldset textarea");
			await texts
				.nth(0)
				.fill(
					lang === "en"
						? "Throughout the design process."
						: "Tout au long du processus de conception.",
				);
			await page.getByRole("button", { name: compareName, exact: true }).click();
			await expect(texts.nth(0)).toBeFocused();
			await expect(texts.nth(0)).toHaveAttribute("aria-describedby", "wd-answer-option-B-error");
			await expect(page.locator("[data-distractor-status]")).toHaveText(
				lang === "en" ? "1 field needs attention." : "1 champ demande votre attention.",
			);
			await texts.nth(0).fill("Only for average needs");
			await page.getByRole("button", { name: compareName, exact: true }).press("Enter");
			await expect(texts.nth(1)).toBeFocused();
			await expect(texts.nth(1)).toHaveAttribute("aria-invalid", "true");
			await expect(page.locator("[data-distractor-comparison]")).toBeHidden();
			await newStateEvidence(page);
		});
		test("custom labels compare without grading", async () => {
			await savedStage(page, "builder", lang, theme, true);
			const compare = page.getByRole("button", { name: compareName, exact: true });
			await compare.click();
			await expect(compare).toBeFocused();
			await expect(compare).toHaveAttribute("aria-disabled", "true");
			await expect(page.locator("[data-distractor-match]")).toHaveCount(1);
			await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
			await expect(page.locator('[data-distractor-preview="learner"]')).toContainText(
				"My own idea $& $' $` $$",
			);
			await expect(page.locator("[data-distractor-status]")).toHaveText(
				lang === "en"
					? "Your labels match 1 of the author's 2 mistaken ideas. You added 1 of your own."
					: "Idées fausses en commun avec l'auteur : 1 sur 2. Autres idées fausses : 1.",
			);
			await newStateEvidence(page);
		});
		test("Start over after a result restores the empty answer stage", async () => {
			await savedStage(page, "result", lang, theme);
			const reset = page.getByRole("button", { name: resetName, exact: true });
			await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
			await reset.click();
			await expect(page.locator("[data-distractor-answer]")).toBeFocused();
			await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
			await expect(page.locator("[data-distractor-comparison], fieldset")).toHaveCount(0);
			await expect(page.locator("[data-distractor-status]")).toHaveText(
				lang === "en" ? "Answer and options cleared." : "Réponses effacées.",
			);
			await newStateEvidence(page);
		});
		for (const action of ["Compare", "Start over"] as const)
			test(`${action} announces its result then save failure in one live update`, async () => {
				await savedStage(page, action === "Compare" ? "builder" : "result", lang, theme);
				await expect(
					page.locator(action === "Compare" ? "fieldset" : "[data-distractor-no-grade]").first(),
				).toBeVisible();
				const saved = await page.evaluate(() => {
					const fixture = window as unknown as DistractorFixture;
					fixture.fixtureSaveFailure = true;
					return fixture.fixtureState.get("wd");
				});
				await page
					.getByRole("button", {
						name: action === "Compare" ? compareName : resetName,
						exact: true,
					})
					.click();
				const failure =
					lang === "en"
						? "Your latest work is not saved. Keep a copy before leaving this page."
						: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.";
				const result =
					action === "Compare"
						? lang === "en"
							? "Your labels match 2 of the author's 2 mistaken ideas. You added 0 of your own."
							: "Idées fausses en commun avec l'auteur : 2 sur 2. Autres idées fausses : 0."
						: lang === "en"
							? "Answer and options cleared."
							: "Réponses effacées.";
				await expect(page.locator("[data-distractor-status]")).toHaveText(`${result} ${failure}`);
				expect(
					await page.evaluate(() =>
						(window as unknown as DistractorFixture).liveOutcomes.filter(Boolean),
					),
				).toEqual([`${result} ${failure}`]);
				await expect(page.locator("[data-distractor-save]")).toBeVisible();
				if (action === "Compare")
					await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
				else {
					await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
					await expect(page.locator("[data-distractor-answer]")).toBeFocused();
				}
				expect(
					await page.evaluate(() =>
						(window as unknown as DistractorFixture).fixtureState.get("wd"),
					),
				).toEqual(saved);
				expect(
					await page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites),
				).toEqual([]);
				await newStateEvidence(page);
			});

		test("passive failure keeps recovery and memory draft through successful conflicting Retry", async () => {
			await page.route("**/write-distractors/*.js", (route) => route.abort());
			await savedStage(page, "builder", lang, theme);
			const retry = page.getByRole("button", {
				name: lang === "en" ? "Retry" : "Réessayer",
				exact: true,
			});
			await expect(retry).toBeVisible();
			await expect(page.locator("[data-distractor-status]")).toHaveText("");
			await page.locator("[data-distractor-answer]").fill("My newer memory answer");
			await expect(page.locator("[data-distractor-save]")).toBeVisible();
			const notice = await page.locator("[data-distractor-notice]").innerText();
			const failure =
				lang === "en"
					? "Your latest work is not saved. Keep a copy before leaving this page."
					: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.";
			await expect(page.locator("[data-distractor-status]")).toHaveText(failure);
			await page.locator("[data-distractor-answer]").fill("My newer memory answer, continued");
			await page.evaluate(
				() =>
					new Promise<void>((done) =>
						requestAnimationFrame(() => requestAnimationFrame(() => done())),
					),
			);
			expect(
				await page.evaluate(() =>
					(window as unknown as DistractorFixture).liveOutcomes.filter(Boolean),
				),
			).toEqual([failure]);
			await expect(page.locator("[data-distractor-notice]")).toHaveText(notice);
			await page.unroute("**/write-distractors/*.js");
			await retry.click();
			await expect(retry).toHaveAttribute("aria-disabled", "true");
			await expect(retry).toBeFocused();
			await expect(page.locator("[data-distractor-recovery] textarea").first()).toHaveValue(
				"Saved answer",
			);
			await expect(page.locator("[data-distractor-answer]")).toHaveValue(
				"My newer memory answer, continued",
			);
			await expect(page.locator("[data-distractor-notice]")).toBeVisible();
			await expect(page.locator("fieldset")).toHaveCount(0);
			await expect(page.locator("[data-distractor-status]")).not.toHaveText(
				/right answer is shown|bonne réponse est affichée/,
			);
			await newStateEvidence(page);
			expect(
				await page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites),
			).toEqual([]);
		});
		test("save failure keeps the current builder and announces once per transition", async () => {
			await savedStage(page, "builder", lang, theme);
			await expect(page.locator("fieldset")).toHaveCount(2);
			await page.evaluate(() => {
				(window as unknown as DistractorFixture).fixtureSaveFailure = true;
			});
			await page.locator("fieldset textarea").first().fill("Kept in memory");
			const failure =
				lang === "en"
					? "Your latest work is not saved. Keep a copy before leaving this page."
					: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.";
			await expect(page.locator("[data-distractor-status]")).toHaveText(failure);
			await page.locator("fieldset textarea").first().fill("Still kept in memory");
			await expect(page.locator("fieldset textarea").first()).toHaveValue("Still kept in memory");
			expect(
				(await page.evaluate(() => (window as unknown as DistractorFixture).liveOutcomes)).filter(
					(text) => text === failure,
				),
			).toHaveLength(1);
			await page.evaluate(() => {
				(window as unknown as DistractorFixture).fixtureSaveFailure = false;
			});
			await page.locator("fieldset textarea").first().fill("Saved again");
			await expect(page.locator("[data-distractor-save]")).toBeHidden();
			await page.evaluate(() => {
				(window as unknown as DistractorFixture).fixtureSaveFailure = true;
			});
			await page.locator("fieldset textarea").first().fill("Another unsaved transition");
			await expect(page.locator("[data-distractor-status]")).toHaveText(failure);
			expect(
				(await page.evaluate(() => (window as unknown as DistractorFixture).liveOutcomes)).filter(
					(text) => text === failure,
				),
			).toHaveLength(2);
			await newStateEvidence(page);
		});
	});

test.describe("comparison edge cases", () => {
	let context: BrowserContext, page: Page;
	test.beforeAll(async ({ browser }) => {
		context = await browser.newContext();
	});
	test.afterAll(async () => {
		await context?.close();
	});
	test.beforeEach(async () => {
		page = await context.newPage();
	});
	test.afterEach(async () => {
		await page?.close();
	});
	for (const [field, value, expected, focus] of [
		["text", "", "Write wrong option B.", "textarea"],
		["text", "x".repeat(301), "Keep option B to 300 characters or fewer.", "textarea"],
		["misconception", "", "Choose the mistaken idea behind option B.", "select"],
		["custom", "", "Describe the mistaken idea for option B.", "input"],
		[
			"custom",
			"x".repeat(121),
			"Keep the mistaken idea for option B to 120 characters or fewer.",
			"input",
		],
	] as const)
		test(`Compare refuses ${field} ${value.length} characters without truncating`, async () => {
			await savedStage(page, "builder");
			if (field === "custom") await page.locator("fieldset select").first().selectOption("other");
			const input = page.locator(`fieldset ${focus}`).first();
			if (field === "misconception") await input.selectOption(value);
			else await input.fill(value);
			await page.getByRole("button", { name: "Compare with the author's", exact: true }).click();
			await expect(input).toBeFocused();
			await expect(input).toHaveValue(value);
			await expect(input).toHaveAccessibleDescription(expected);
			await expect(page.locator("[data-distractor-status]")).toHaveText("1 field needs attention.");
			await newStateEvidence(page);
		});
	test("Compare announces all invalid fields and keeps author options hidden", async () => {
		await savedStage(page, "builder");
		await page.locator("fieldset textarea").first().fill("");
		await page.locator("fieldset select").first().selectOption("");
		await page
			.getByRole("button", { name: "Compare with the author's", exact: true })
			.press("Enter");
		await expect(page.locator("[data-distractor-status]")).toHaveText("2 fields need attention.");
		await expect(page.locator("fieldset textarea").first()).toBeFocused();
		await expect(page.locator("[data-distractor-comparison]")).toBeHidden();
		await newStateEvidence(page);
	});
	test("pending passive restore exposes full recovery silently and Start over cancels its load", async () => {
		let held: Route | undefined;
		await page.route("**/write-distractors/*.js", (route) => {
			held = route;
		});
		await savedStage(page, "result");
		await expect(page.locator("[data-distractor-notice]")).toHaveText("Restoring your progress.");
		await expect(page.locator("[data-distractor-recovery] textarea").first()).toHaveValue(
			"Saved answer",
		);
		await expect(page.locator("h1")).toBeFocused();
		await expect(page.locator("[data-distractor-status]")).toHaveText("");
		await newStateEvidence(page);
		await page.getByRole("button", { name: "Start over", exact: true }).click();
		await expect(page.locator("[data-distractor-answer]")).toBeFocused();
		await heldRoute(held).continue();
		await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
		await expect(page.locator("[data-distractor-recovery] textarea")).toHaveCount(0);
		await expect(page.locator("fieldset")).toHaveCount(0);
	});
	test("Retry restores a saved result silently when there are no interim edits", async () => {
		await page.route("**/write-distractors/*.js", (route) => route.abort());
		await savedStage(page, "result");
		const retry = page.getByRole("button", { name: "Retry", exact: true });
		await expect(retry).toBeVisible();
		await page.unroute("**/write-distractors/*.js");
		await retry.click();
		await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
		await expect(page.locator("[data-distractor-status]")).not.toHaveText(
			/labels match|right answer is shown/,
		);
		expect(
			await page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites),
		).toEqual([]);
		await newStateEvidence(page);
	});
	test("provider replacement suspends result geometry, then keeps equivalent Compare focus", async () => {
		await savedStage(page, "result");
		const compare = page.getByRole("button", { name: "Compare with the author's", exact: true });
		await expect(compare).toBeVisible();
		await compare.focus();
		let held: Route | undefined;
		await page.route("**/write-distractors/*.js", (route) => {
			held = route;
		});
		await page.evaluate(() => (window as unknown as DistractorFixture).installFixtureProvider());
		await expect(page.locator("[data-distractor-notice]")).toHaveText("Restoring your progress.");
		await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
		await expect(compare).toBeFocused();
		await expect(compare).toHaveAttribute("aria-disabled", "true");
		await heldRoute(held).continue();
		await expect(page.locator("[data-distractor-notice]")).toBeHidden();
		await expect(compare).toBeFocused();
		await newStateEvidence(page);
	});
	for (const moved of ["none", "heading", "body"] as const)
		test(`provider admission restores displaced select focus unless learner moved to ${moved}`, async () => {
			await savedStage(page, "builder");
			const select = page.locator("fieldset select").first();
			await expect(select).toBeVisible();
			await select.focus();
			let held: Route | undefined;
			await page.route("**/write-distractors/*.js", (route) => {
				held = route;
			});
			await page.evaluate(() => (window as unknown as DistractorFixture).installFixtureProvider());
			await expect(page.locator("[data-distractor-notice]")).toHaveText("Restoring your progress.");
			if (moved === "heading") await page.locator("h1").focus();
			if (moved === "body") await page.mouse.click(0, 0);
			await expect.poll(() => !!held).toBe(true);
			await heldRoute(held).continue();
			await expect(page.locator("[data-distractor-notice]")).toBeHidden();
			await expect(
				moved === "none" ? select : page.locator(moved === "heading" ? "h1" : "body"),
			).toBeFocused();
		});
	for (const scope of ["identified", "shared-device"] as const)
		test(`scope ${scope} is truthful before a first save and stays unchanged afterward`, async () => {
			await page.goto(`${url}/en-light.html?pending`);
			await page.evaluate((scope) => {
				const fixture = window as unknown as DistractorFixture;
				fixture.fixtureDeviceScope = scope;
				fixture.installFixtureProvider();
				const provider = window.__praxityBlockState;
				if (!provider) throw new Error("No provider");
				provider.getSaveResult = () =>
					fixture.fixtureWrites.length ? { status: "saved", destination: "device" } : undefined;
			}, scope);
			const expected =
				"Your answers stay in this browser and aren’t sent to the LMS. " +
				(scope === "identified"
					? "A new attempt starts fresh."
					: "Anyone using this browser may see them.");
			await expect(page.locator("[data-distractor-destination]")).toHaveText(expected);
			await page.locator("[data-distractor-answer]").fill("First saved answer");
			await expect
				.poll(() =>
					page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites.length),
				)
				.toBeGreaterThan(0);
			await expect(page.locator("[data-distractor-destination]")).toHaveText(expected);
		});

	test("scope reads cannot repaint an obsolete provider's restore notice", async () => {
		await savedStage(page, "result");
		await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
		await page.evaluate(() => {
			const provider = window.__praxityBlockState;
			if (!provider) throw new Error("No provider");
			let replaced = false;
			window.__praxityBlockState = {
				...provider,
				getDeviceScope() {
					if (!replaced) {
						replaced = true;
						const fixture = window as unknown as DistractorFixture;
						fixture.fixtureState.clear();
						fixture.installFixtureProvider();
					}
					return "identified" as const;
				},
			} as typeof provider;
			const owner = window.__praxitySelfCheckDocument,
				life = owner?.lifetime();
			if (life) owner?.admit(life);
		});
		await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
		await expect(page.locator("[data-distractor-no-grade]")).toHaveCount(0);
		await expect(page.locator("[data-distractor-notice]")).toBeHidden();
		await expect(page.locator("[data-distractor-destination]")).toContainText(
			"Anyone using this browser may see them.",
		);
	});
	test("Compare settlement cannot announce or focus for a replacement provider", async () => {
		await savedStage(page, "builder");
		await expect(page.locator("fieldset textarea").first()).toBeVisible();
		await page.evaluate(() => {
			const root = document.querySelector("[data-write-distractors]");
			if (!root) throw new Error("No activity");
			const observer = new MutationObserver(() => {
				if (!root.querySelector("[data-distractor-no-grade]")) return;
				observer.disconnect();
				const fixture = window as unknown as DistractorFixture;
				fixture.fixtureState.clear();
				fixture.installFixtureProvider();
			});
			observer.observe(root, { childList: true, subtree: true });
		});
		await page.getByRole("button", { name: "Compare with the author's", exact: true }).click();
		await expect(page.locator("[data-distractor-no-grade]")).toHaveCount(0);
		await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
		await expect(page.locator("[data-distractor-answer]")).toBeFocused();
		await page.evaluate(async () => {
			await new Promise<void>((done) =>
				requestAnimationFrame(() => requestAnimationFrame(() => done())),
			);
		});
		await expect(page.locator("[data-distractor-status]")).toHaveText("");
	});
	test("long result tokens wrap at 320 px with text spacing", async () => {
		await page.setViewportSize({ width: 320, height: 900 });
		await savedStage(page, "result");
		await expect(page.locator("[data-distractor-no-grade]")).toBeVisible();
		await page.evaluate(() => {
			const fixture = window as unknown as DistractorFixture;
			const saved = fixture.fixtureState.get("wd") as {
				value: { options: Array<{ text: string; misconception: string; custom: string }> };
			};
			saved.value.options[0] = {
				text: "x".repeat(300),
				misconception: "other",
				custom: "z".repeat(120),
			};
			fixture.installFixtureProvider();
		});
		await expect(page.locator('[data-distractor-preview="learner"]')).toContainText(
			"x".repeat(300),
		);
		await page.addStyleTag({
			content:
				"* {letter-spacing: .12em !important; word-spacing: .16em !important; line-height: 1.5 !important;} p {margin-bottom: 2em !important;}",
		});
		await newStateEvidence(page);
	});
	test("pending provider keeps the persistent device destination", async () => {
		await page.goto(`${url}/en-light.html?pending`);
		await expect(page.locator("[data-distractor-destination]")).toHaveText(
			"Your answers stay in this browser and aren’t sent to the LMS.",
		);
		await newStateEvidence(page);
	});
	test("unavailable draft support still shows the admitted provider scope", async () => {
		await page.route("**/chunks/write-distractors-draft-*.js", (route) => route.abort());
		await savedStage(page, "builder");
		await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
		await expect(page.locator("[data-distractor-destination]")).toHaveText(
			"Your answers stay in this browser and aren’t sent to the LMS. Anyone using this browser may see them.",
		);
	});
	test("scope follows admitted provider and print hides all activity chrome", async () => {
		await savedStage(page, "builder");
		await expect(page.locator("[data-distractor-destination]")).toHaveText(
			"Your answers stay in this browser and aren’t sent to the LMS. Anyone using this browser may see them.",
		);
		await page.evaluate(() => {
			const fixture = window as unknown as DistractorFixture;
			fixture.fixtureDeviceScope = "identified";
			fixture.installFixtureProvider();
		});
		await expect(page.locator("[data-distractor-destination]")).toHaveText(
			"Your answers stay in this browser and aren’t sent to the LMS. A new attempt starts fresh.",
		);
		await page.emulateMedia({ media: "print" });
		await expect(
			page.getByRole("button", { name: "Compare with the author's", exact: true }),
		).toBeHidden();
		await expect(page.locator("[data-distractor-destination]")).toBeHidden();
		await expect(
			page
				.locator("[data-distractor-save], [data-distractor-status], [data-distractor-notice]")
				.filter({ visible: true }),
		).toHaveCount(0);
	});
});

// Failed initial reads must expose recovery controls, protect saved bytes and
// keep memory edits with one first-edit announcement and a stable notice.
for (const [lang, theme, width] of [
	["en", "light", 1280],
	["en", "light", 320],
	["fr", "dark", 320],
] as const)
	test.describe(`failed initial read ${lang} ${width}`, () => {
		let context: BrowserContext, page: Page;
		const unavailable =
			lang === "en"
				? "Comparison is unavailable. You can still write and copy your answer."
				: "La comparaison n'est pas disponible. Vous pouvez encore écrire et copier votre réponse.";
		const notSaved =
			lang === "en"
				? "Your latest work is not saved. Keep a copy before leaving this page."
				: "Votre travail le plus récent n'est pas enregistré. Gardez-en une copie avant de quitter cette page.";
		const retry = () => page.locator('[data-distractor-action="retry"]');
		const reset = () => page.locator('[data-distractor-action="start-over"]');
		const answer = () => page.locator("[data-distractor-answer]");
		const notice = () => page.locator("[data-distractor-notice]");
		test.beforeAll(async ({ browser }) => {
			context = await browser.newContext({ viewport: { width, height: 900 } });
		});
		test.afterAll(async () => {
			await context?.close();
		});
		test.beforeEach(async () => {
			page = await context.newPage();
		});
		test.afterEach(async () => {
			await page?.close();
		});
		const failRead = async (kind: "thrown" | "transient" | "no provider") => {
			await page.goto(`${url}/${lang}-${theme}.html?pending`);
			await expect(page.locator("[data-distractor-destination]")).toBeVisible();
			await page.evaluate((kind) => {
				const fixture = window as unknown as DistractorFixture & { readFailure: boolean };
				const root = document.querySelector<HTMLElement>("[data-write-distractors]");
				if (!root) throw new Error("Missing activity");
				fixture.fixtureState.set("wd", {
					version: 1,
					kind: "write-distractors",
					contentRevision: root.dataset.distractorRevision,
					value: {
						answer: "Unread saved answer",
						hadIt: null,
						shown: false,
						options: [
							{ text: "", misconception: "", custom: "" },
							{ text: "", misconception: "", custom: "" },
						],
					},
				});
				fixture.liveOutcomes = [];
				const status = root.querySelector("[data-distractor-status]");
				if (!status) throw new Error("Missing status");
				new MutationObserver(() => fixture.liveOutcomes.push(status.textContent ?? "")).observe(
					status,
					{ childList: true, characterData: true, subtree: true },
				);
				fixture.readFailure = true;
				if (kind !== "no provider") {
					let failed = false;
					window.__praxityBlockState = {
						get(id) {
							failed = fixture.readFailure;
							if (failed && kind === "thrown") throw new Error("Unread storage");
							return failed ? undefined : (fixture.fixtureState.get(id) as never);
						},
						set(id, value) {
							fixture.fixtureState.set(id, value);
							fixture.fixtureWrites.push({ id, value });
						},
						getSaveResult: () => {
							const outcome = failed;
							failed = false;
							return outcome
								? { status: "not-saved", code: "storage-unavailable" }
								: fixture.fixtureWrites.length
									? { status: "saved", destination: "device" }
									: undefined;
						},
					};
				}
				const owner = window.__praxitySelfCheckDocument;
				if (!owner) throw new Error("Missing owner");
				const captured = owner.lifetime();
				if (!captured) throw new Error("Missing lifetime");
				owner.admit(captured);
			}, kind);
			await expect(notice()).toHaveText(unavailable);
			await expect(retry()).toBeVisible();
			await expect(reset()).toBeVisible();
			await expect(retry()).toHaveAttribute("aria-disabled", "false");
			await expect(reset()).toHaveAttribute("aria-disabled", "false");
			const hintId = await reset().getAttribute("aria-describedby");
			if (!hintId) throw new Error("Missing loss hint");
			await expect(page.locator(`[id="${hintId}"]`)).toBeVisible();
			await expect(reset()).toHaveAccessibleDescription(
				lang === "en"
					? "Start over clears your answer, options and comparison. Copy anything you want to keep first."
					: "Recommencer efface votre réponse, vos propositions et la comparaison. Copiez d'abord ce que vous voulez conserver.",
			);
			await expect(answer()).toBeEditable();
			await expect(page.locator('[data-distractor-action="check"]')).toBeHidden();
			await expect(page.locator('[data-distractor-action="check"]')).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			await expect(page.locator("[data-distractor-status]")).toHaveText("");
		};
		for (const kind of ["thrown", "transient", "no provider"] as const) {
			test(`${kind}: memory edits announce once, keep unread bytes and leave the notice in place`, async () => {
				await failRead(kind);
				if (kind === "thrown" && process.env.PRAXITY_DISTRACTORS_SCREENSHOTS)
					await page.screenshot({
						path: join(
							process.env.PRAXITY_DISTRACTORS_SCREENSHOTS,
							`failed-initial-read-${lang}-${theme}-${width}.png`,
						),
						fullPage: true,
					});
				await observeDistractorNotice(page);
				const before = await page.evaluate(() =>
					JSON.stringify((window as unknown as DistractorFixture).fixtureState.get("wd")),
				);
				await answer().fill("Memory draft");
				await expect(page.locator("[data-distractor-status]")).toHaveText(notSaved);
				await answer().fill("");
				await answer().fill("Later memory draft");
				await page.evaluate(
					() =>
						new Promise<void>((done) =>
							requestAnimationFrame(() => requestAnimationFrame(() => done())),
						),
				);
				await expect(notice()).toHaveText(unavailable);
				expect(
					await page.evaluate(() => {
						const fixture = window as unknown as DistractorFixture & {
							noticeMoves: number;
							noticeTextChanges: number;
						};
						return {
							saved: JSON.stringify(fixture.fixtureState.get("wd")),
							writes: fixture.fixtureWrites,
							announcements: fixture.liveOutcomes.filter(Boolean),
							moves: fixture.noticeMoves,
							textChanges: fixture.noticeTextChanges,
							followsActions:
								document.querySelector("[data-distractor-controls]")?.nextElementSibling ===
								document.querySelector("[data-distractor-notice]"),
						};
					}),
				).toEqual({
					saved: before,
					writes: [],
					announcements: [notSaved],
					moves: 0,
					textChanges: 0,
					followsActions: true,
				});
			});
			test(`${kind}: Retry keeps unread bytes until the provider recovers`, async () => {
				await failRead(kind);
				await retry().focus();
				if (kind === "no provider") {
					await retry().press("Enter");
					await expect(page.locator("[data-distractor-status]")).toHaveText(unavailable);
					await page.evaluate(() =>
						(window as unknown as DistractorFixture).installFixtureProvider(),
					);
				} else {
					await page.evaluate(() => {
						(window as unknown as { readFailure: boolean }).readFailure = false;
					});
					await retry().press("Enter");
				}
				await expect(answer()).toHaveValue("Unread saved answer");
				await expect(notice()).toBeHidden();
				if (kind !== "no provider")
					await expect(page.locator('[data-distractor-action="check"]')).toBeFocused();
				else
					await expect(page.locator('[data-distractor-action="check"]')).toHaveAttribute(
						"aria-disabled",
						"false",
					);
				expect(
					await page.evaluate(() => (window as unknown as DistractorFixture).fixtureWrites),
				).toEqual([]);
			});
			test(`${kind}: Start over clears memory with its loss hint and reports no false deletion`, async () => {
				await failRead(kind);
				await answer().fill("Discard this memory draft");
				await reset().focus();
				await reset().press("Enter");
				await expect(answer()).toBeFocused();
				await expect(answer()).toHaveValue("");
				const saved = await page.evaluate(() =>
					(window as unknown as DistractorFixture).fixtureState.get("wd"),
				);
				// With no provider this checks no false deletion claim; arrival protection is tested below.
				expect(saved).toMatchObject({
					value: { answer: kind === "no provider" ? "Unread saved answer" : "" },
				});
				if (kind === "no provider")
					await expect(page.locator("[data-distractor-save]")).toBeVisible();
				else await expect(page.locator("[data-distractor-save]")).toBeHidden();
			});
		}
		const expectBothDraftsHeld = async (before: string) => {
			await expect(answer()).toHaveValue("Memory draft while unavailable");
			await expect(answer()).toBeEditable();
			const recovery = page.locator("[data-distractor-recovery] textarea").first();
			await expect(recovery).toHaveValue("Unread saved answer");
			await expect(recovery).toBeVisible();
			await expect(recovery).toHaveAttribute("readonly", "");
			await expect(recovery).toBeEnabled();
			await expect(recovery).not.toHaveCSS("user-select", "none");
			await recovery.focus();
			await recovery.selectText();
			await expect(recovery).toBeFocused();
			expect(
				await recovery.evaluate((node: HTMLTextAreaElement) =>
					node.value.slice(node.selectionStart, node.selectionEnd),
				),
			).toBe("Unread saved answer");
			await expect(notice()).toHaveText(unavailable);
			await expect(page.locator('[data-distractor-action="check"]')).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			await answer().fill("Later memory edit, still held");
			await page.evaluate(
				() =>
					new Promise<void>((done) =>
						requestAnimationFrame(() => requestAnimationFrame(() => done())),
					),
			);
			await expect(recovery).toHaveValue("Unread saved answer");
			await expect(answer()).toHaveValue("Later memory edit, still held");
			expect(
				await page.evaluate(() => {
					const fixture = window as unknown as DistractorFixture;
					return {
						saved: JSON.stringify(fixture.fixtureState.get("wd")),
						writes: fixture.fixtureWrites,
					};
				}),
			).toEqual({ saved: before, writes: [] });
		};
		test("no provider: arriving provider keeps saved recovery and the memory draft", async () => {
			await failRead("no provider");
			const before = await page.evaluate(() =>
				JSON.stringify((window as unknown as DistractorFixture).fixtureState.get("wd")),
			);
			await answer().fill("Memory draft while unavailable");
			await expect(page.locator("[data-distractor-status]")).toHaveText(notSaved);
			await page.evaluate(() => (window as unknown as DistractorFixture).installFixtureProvider());
			await expectBothDraftsHeld(before);
		});
		if (lang === "en" && width === 1280)
			test("thrown: Retry after memory editing keeps both drafts and the write hold", async () => {
				await failRead("thrown");
				const before = await page.evaluate(() =>
					JSON.stringify((window as unknown as DistractorFixture).fixtureState.get("wd")),
				);
				await answer().fill("Memory draft while unavailable");
				await expect(page.locator("[data-distractor-status]")).toHaveText(notSaved);
				await page.evaluate(() => {
					(window as unknown as { readFailure: boolean }).readFailure = false;
				});
				await retry().focus();
				await retry().press("Enter");
				await expectBothDraftsHeld(before);
			});
		test("passive draft support failure places its notice after actions, including after Retry", async () => {
			await page.route("**/chunks/write-distractors-draft-*.js*", (route) => route.abort());
			await page.goto(`${url}/${lang}-${theme}.html?pending`);
			await expect(page.locator("[data-distractor-destination]")).toBeVisible();
			await answer().fill("Native draft");
			await page.evaluate(() => (window as unknown as DistractorFixture).installFixtureProvider());
			await expect(notice()).toHaveText(unavailable);
			const followsActions = () =>
				page.evaluate(
					() =>
						document.querySelector("[data-distractor-controls]")?.nextElementSibling ===
						document.querySelector("[data-distractor-notice]"),
				);
			expect(await followsActions()).toBe(true);
			await retry().press("Enter");
			await expect(page.locator("[data-distractor-status]")).toHaveText(unavailable);
			expect(await followsActions()).toBe(true);
		});
	});
