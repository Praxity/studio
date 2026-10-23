import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";

type ConsumerWindow = Window & { __praxityRuntime?: { getSuspendData?: () => string | null } };

let folder: string, base: string, server: Server;
const entries: Record<string, string> = {};
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-consumers-"));
	for (const locale of ["en", "fr"])
		for (const deck of [false, true]) {
			const read = readLesson(
				"# Practice\n" +
					["A", "B", "C"]
						.map(
							(name) =>
								`::: self-check Explain ${name}. {required}\nmodel: Model ${name}.\n:: Reason\nmissed: Hint ${name}.\n:::\n`,
						)
						.join("\n"),
			);
			const checks = read.blocks.filter((block) => block.type === "selfCheck");
			const content = deck
				? checks.map((block, index) => ({
						id: `slide-${index}`,
						title: `Slide ${index}`,
						lessonId: `module-${index}`,
						blocks: [block],
					}))
				: [
						{ id: "practice", title: "Practice", blocks: read.blocks },
						{
							id: "next",
							title: "Next",
							blocks: [{ id: "next-text", type: "text" as const, data: { content: "Next page" } }],
						},
					];
			const artifact = await compileCourse({
				id: `consumers-${locale}-${deck}`,
				title: "Practice",
				sourceLocale: locale,
				content,
				...(deck ? { moduleDeck: {} } : {}),
				selfCheckContents: checks.map((block) =>
					selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)),
				),
			});
			try {
				for (const format of ["html", "scorm12", "scorm2004"] as const) {
					const key = `${format}-${locale}-${deck}`;
					entries[key] = `${key}/${artifact.manifest.pages[0].slug}.html`;
					new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
						join(folder, key),
					);
				}
			} finally {
				await artifact.dispose();
			}
		}
	for (const locale of ["en", "fr"])
		for (const variant of ["logic", "optional", "remote", "remote-logic", "require"] as const) {
			const read = readLesson(
				"# Practice\n" +
					["A", "B", "C"]
						.map(
							(name) =>
								`::: self-check Explain ${name}. {required}\nmodel: Model ${name}.\n:: Reason\nmissed: Hint ${name}.\n:::\n`,
						)
						.join("\n"),
			);
			const checks = read.blocks.filter((block) => block.type === "selfCheck");
			const predicate = (index: number, comparison: "is" | "isNot" = "is") => ({
				source: `block:${checks[index].id}`,
				field: "isCompleted",
				comparison,
				value: true,
			});
			const logic: PraxityBlock[] = [
				{
					id: "count",
					type: "variable",
					data: { variableName: "count", dataType: "number", source: "manual", defaultValue: 0 },
				},
				{
					id: "flag",
					type: "variable",
					data: {
						variableName: "flag",
						dataType: "boolean",
						source: "manual",
						defaultValue: false,
					},
				},
				{ id: "reveal-A", type: "text", data: { content: "A effects applied", hidden: true } },
				{ id: "hide-A", type: "text", data: { content: "Author content hidden by A" } },
				{ id: "wrong", type: "text", data: { content: "Unavailable branch", hidden: true } },
				{
					id: "positive",
					type: "logic",
					data: {
						conditions: { operator: "and", rules: [predicate(0)] },
						actions: [
							{ type: "show", targets: ["reveal-A"] },
							{ type: "hide", targets: ["hide-A"] },
							{ type: "setVariable", targets: ["count"], value: { operation: "add", operand: 1 } },
							{ type: "jumpToPage", targets: ["__end_lesson__"] },
						],
					},
				},
				{
					id: "writer",
					type: "logic",
					data: {
						conditions: { operator: "and", rules: [predicate(0)] },
						actions: [{ type: "setVariable", targets: ["flag"], value: true }],
					},
				},
				{
					id: "negative-or",
					type: "logic",
					data: {
						conditions: {
							operator: "or",
							rules: [
								predicate(1, "isNot"),
								{ source: "variable:flag", comparison: "is", value: false },
							],
						},
						actions: [
							{ type: "show", targets: ["wrong"] },
							{ type: "disableCompletion", targets: [], reason: "Unavailable branch" },
							{ type: "setVariable", targets: ["count"], value: 999 },
						],
					},
				},
				{
					id: "compound",
					type: "logic",
					data: {
						conditions: { operator: "and", rules: [predicate(0)] },
						actions: [
							{
								type: "setVariable",
								targets: ["flag"],
								value: {
									operation: "assign",
									operand: { ref: `block:${checks[1].id}`, field: "isCompleted" },
								},
							},
						],
					},
				},
			];
			const requiredLogic: PraxityBlock[] = [
				...logic
					.filter((block) => ["count", "reveal-A", "positive"].includes(block.id))
					.map((block) =>
						block.id === "positive"
							? {
									...block,
									data: {
										...block.data,
										actions: [
											...(block.data.actions as unknown[]),
											{ type: "require", targets: ["rating"], value: 2 },
										],
									},
								}
							: block,
					),
				{
					id: "rating",
					type: "rating",
					data: { label: "Choose a rating", maxValue: 3, style: "numeric" },
				},
				{
					id: "ordinary",
					type: "variable",
					data: { variableName: "ordinary", dataType: "number", source: "manual", defaultValue: 0 },
				},
				{
					id: "ordinary-rule",
					type: "logic",
					data: {
						conditions: {
							operator: "and",
							rules: [{ source: "variable:ordinary", comparison: "is", value: 0 }],
						},
						actions: [{ type: "setVariable", targets: ["ordinary"], value: 1 }],
					},
				},
				{
					id: "rating-gate",
					type: "logic",
					data: {
						conditions: {
							operator: "and",
							rules: [
								predicate(0),
								{ source: "block:rating", field: "ratingScore", comparison: "lt", value: 2 },
							],
						},
						actions: [{ type: "disableCompletion", reason: "Choose two or higher." }],
					},
				},
			];
			const content = variant.startsWith("remote")
				? [
						{
							id: "intro",
							title: "Intro",
							lessonId: "intro-module",
							blocks:
								variant === "remote-logic"
									? [
											...logic,
											{
												id: "slow",
												type: "logic" as const,
												data: {
													conditions: { operator: "and", rules: [predicate(2)] },
													actions: [{ type: "show", targets: ["reveal-A"] }],
												},
											},
										]
									: [{ id: "intro", type: "text" as const, data: { content: "Introduction" } }],
						},
						...checks.map((block, index) => ({
							id: `slide-${index}`,
							title: `Slide ${index}`,
							lessonId: `module-${index}`,
							blocks: [block],
						})),
					]
				: [
						{
							id: "practice",
							title: "Practice",
							blocks: [
								...checks.map((block, index) =>
									variant === "optional" && index === 2
										? { ...block, data: { ...block.data, required: false } }
										: block,
								),
								...(variant === "logic" ? logic : []),
								...(variant === "require" ? requiredLogic : []),
							],
						},
						{
							id: "next",
							title: "Next",
							blocks: [{ id: "next-text", type: "text" as const, data: { content: "Next" } }],
						},
					];
			const artifact = await compileCourse({
				id: `consumers-${locale}-${variant}`,
				title: "Practice",
				sourceLocale: locale,
				content,
				...(variant === "remote" ? { moduleDeck: {} } : {}),
				selfCheckContents: checks.map((block) =>
					selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)),
				),
			});
			try {
				for (const format of ["html", "scorm12", "scorm2004"] as const) {
					const key = `${format}-${locale}-${variant}`;
					entries[key] = `${key}/${artifact.manifest.pages[0].slug}.html`;
					new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
						join(folder, key),
					);
				}
			} finally {
				await artifact.dispose();
			}
		}
	server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			response.setHeader(
				"Content-Type",
				path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
			);
			response.end(await readFile(join(folder, path)));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
});
test.afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(folder, { recursive: true });
});

async function holdAdmissions(page: Page, seedVariables = false) {
	await page.addInitScript((seedVariables) => {
		const held = new Map<string, HTMLScriptElement>();
		const probes = {
			navigation: [] as string[],
			completion: [] as string[],
			writes: [] as unknown[],
		};
		const visits: unknown[] = [],
			variableWrites: unknown[] = [];
		Object.assign(window, { consumerVisits: visits, consumerVariableWrites: variableWrites });
		let runtime: Window["__praxityRuntime"];
		Object.defineProperty(window, "__praxityRuntime", {
			configurable: true,
			get: () => runtime,
			set(value) {
				runtime = value;
				const full = value as unknown as {
					getSuspendData(): string | null;
					setSuspendData(data: string): void;
					trackPageVisit(id: string): void;
				};
				if (full?.trackPageVisit) {
					const track = full.trackPageVisit.bind(full);
					full.trackPageVisit = (id) => {
						visits.push({
							id,
							finalized: window.__praxitySelfCheckDocument?.consumers.settled(),
							count: JSON.parse(full.getSuspendData() || "{}").v?.count,
						});
						track(id);
					};
				}
				if (seedVariables && full?.getSuspendData) {
					const read = full.getSuspendData.bind(full),
						write = full.setSuspendData.bind(full);
					full.getSuspendData = () => {
						const data = JSON.parse(read() || "{}");
						data.v ??= { count: 7, flag: true };
						return JSON.stringify(data);
					};
					full.setSuspendData = (data) => {
						variableWrites.push(JSON.parse(data));
						write(data);
					};
				}
				if (!value?.setCompletion) return;
				const original = value.setCompletion.bind(value);
				value.setCompletion = (status: string) => {
					probes.completion.push(status);
					return original(status);
				};
			},
		});
		window.__praxityNavigatePageHref = (href) => {
			probes.navigation.push(href);
			return true;
		};
		const append = Element.prototype.append;
		Element.prototype.append = function (...nodes) {
			for (const node of nodes)
				if (node instanceof HTMLScriptElement && node.src.includes("/self-check/")) {
					const config = JSON.parse(document.getElementById("praxity-config")?.textContent || "{}");
					const reference = config.selfChecks.references.find((reference: { path: string }) =>
						node.src.endsWith(reference.path),
					);
					held.set(reference.blockId, node);
					return;
				}
			return Reflect.apply(append, this, nodes);
		};
		window.addEventListener(
			"praxity:runtime-ready",
			() => {
				const config = JSON.parse(document.getElementById("praxity-config")?.textContent || "{}");
				const saved = new Map(
					config.selfChecks.references.map(
						(reference: { blockId: string; contentRevision: string }) => [
							reference.blockId,
							{
								version: 1,
								kind: "self-check",
								draft: { answer: `Answer ${reference.blockId}`, ticked: [], shown: false },
								submitted: {
									answer: `Answer ${reference.blockId}`,
									ticked: [],
									shown: true,
									contentRevision: reference.contentRevision,
								},
							},
						],
					),
				);
				window.__praxityBlockState = {
					finalizeLearner: window.__praxityBlockState?.finalizeLearner,
					get: (id) => saved.get(id) as never,
					set: (id, value) => {
						saved.set(id, value);
						probes.writes.push(value);
					},
					getPolicy: () => "device",
				};
			},
			{ once: true },
		);
		Object.assign(window, {
			consumerProbe: probes,
			consumerHeld: held,
			releaseConsumer(id: string, success = true) {
				const script = held.get(id);
				if (!script) throw new Error("Missing request barrier");
				held.delete(id);
				if (success) Reflect.apply(append, document.head, [script]);
				else script.dispatchEvent(new Event("error"));
			},
		});
	}, seedVariables);
}

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const locale of ["en", "fr"] as const)
		for (const deck of [false, true])
			for (const failed of [0, 1])
				test(`${format} ${locale} deck=${deck} failed=${failed} waits for held siblings before forward or tracking`, async ({
					page,
				}) => {
					await holdAdmissions(page);
					const entry = entries[`${format === "file" ? "html" : format}-${locale}-${deck}`];
					await page.goto(
						format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry,
						{ waitUntil: "domcontentloaded" },
					);
					await page.waitForFunction(
						() =>
							(window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.size === 3,
					);
					const ids = await page.evaluate(
						() =>
							JSON.parse(document.getElementById("praxity-config")?.textContent || "{}").selfChecks
								.dependencies as string[],
					);
					await page.evaluate(
						(id) =>
							(
								window as unknown as { releaseConsumer(id: string, success: boolean): void }
							).releaseConsumer(id, false),
						ids[failed],
					);
					await page.waitForFunction(
						(id) => window.__praxitySelfCheckSession?.session.read(id)?.outcome === "unavailable",
						ids[failed],
					);
					const forward = deck ? "#deck-next" : "[data-continue-button]";
					await page
						.locator(forward)
						.first()
						.evaluate((element: HTMLButtonElement) => element.click());
					await page.keyboard.press("ArrowRight");
					expect(
						await page.evaluate(
							() => (window as unknown as { consumerProbe: unknown }).consumerProbe,
						),
					).toEqual({ navigation: [], completion: [], writes: [] });
					await page.evaluate(
						(id) =>
							(window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
						ids[1 - failed],
					);
					await page.waitForFunction(
						(id) => window.__praxitySelfCheckSession?.session.read(id)?.outcome === "submitted",
						ids[1 - failed],
					);
					expect(await page.locator('[data-block-id][data-completed="true"]').count()).toBe(0);
					await page.evaluate(
						(id) =>
							(window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
						ids[2],
					);
					await page.waitForFunction(
						(id) =>
							window.__praxitySelfCheckDocument?.consumers.settled() &&
							window.__praxitySelfCheckSession?.session.read(id)?.ready,
						ids[2],
					);
					await expect(page.locator(forward).first()).toHaveAttribute("aria-disabled", "true");
					await expect(page.locator("[data-completion-reason]")).toContainText(
						locale === "fr" ? "comparaison" : "Comparison",
					);
					await expect(page.locator("[data-self-check-gate-retry]")).toBeVisible();
					await expect(page.locator("[data-self-check-gate-reset]")).toBeVisible();
					await page
						.locator(forward)
						.first()
						.evaluate((element: HTMLButtonElement) => element.click());
					expect(
						await page.evaluate(
							() => (window as unknown as { consumerProbe: unknown }).consumerProbe,
						),
					).toEqual({ navigation: [], completion: [], writes: [] });
				});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const locale of ["en", "fr"] as const)
		for (const failed of [0, 1])
			test(`${format} ${locale} logic failed=${failed} applies admitted effects without provisional branches or restored mutations`, async ({
				page,
			}) => {
				await holdAdmissions(page, true);
				const entry = entries[`${format === "file" ? "html" : format}-${locale}-logic`];
				await page.goto(
					format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry,
					{ waitUntil: "domcontentloaded" },
				);
				await page.waitForFunction(
					() =>
						(window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.size === 3,
				);
				const ids = await page.evaluate(
					() =>
						JSON.parse(document.getElementById("praxity-config")?.textContent || "{}").selfChecks
							.dependencies as string[],
				);
				await page.evaluate(
					(id) =>
						(
							window as unknown as { releaseConsumer(id: string, success: boolean): void }
						).releaseConsumer(id, false),
					ids[failed],
				);
				await page
					.locator("[data-continue-button]")
					.first()
					.evaluate((element: HTMLButtonElement) => element.click());
				expect(
					await page.evaluate(
						() => (window as unknown as { consumerVisits: unknown[] }).consumerVisits,
					),
				).toEqual([]);
				expect(
					await page.evaluate(
						() =>
							(window as unknown as { consumerVariableWrites: unknown[] }).consumerVariableWrites,
					),
				).toEqual([]);
				await expect(page.locator('[data-block-id="reveal-A"]')).toBeHidden();
				await page.evaluate(
					(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
					ids[1 - failed],
				);
				await page.waitForFunction(
					(id) => window.__praxitySelfCheckSession?.session.read(id)?.outcome === "submitted",
					ids[1 - failed],
				);
				await expect(page.locator('[data-block-id="reveal-A"]')).toBeHidden();
				await page.evaluate(
					(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
					ids[2],
				);
				await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
				await expect(page.locator('[data-block-id="reveal-A"]')).toBeVisible({
					visible: failed === 1,
				});
				await expect(page.locator('[data-block-id="wrong"]')).toBeHidden();
				await expect(page.locator('[data-block-id="hide-A"]')).toBeVisible({
					visible: failed === 0,
				});
				expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
				expect(
					await page.evaluate(
						() =>
							(window as unknown as { consumerVariableWrites: unknown[] }).consumerVariableWrites,
					),
				).toEqual([]);
				await expect(page.locator("[data-self-check-gate-retry]")).toBeVisible();
				await page.locator("[data-self-check-gate-retry]").click();
				await page.waitForFunction(
					(id) =>
						(window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.has(id),
					ids[failed],
				);
				await page.evaluate(
					(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
					ids[failed],
				);
				await page.waitForFunction(() =>
					window.__praxitySelfCheckDocument?.consumers.forwardReady(),
				);
				const observations = await page.evaluate(
					() =>
						(window as unknown as { consumerVisits: { finalized: boolean; count: number }[] })
							.consumerVisits,
				);
				expect(observations).toHaveLength(1);
				expect(observations[0]).toMatchObject({ finalized: true, count: 7 });
				expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
				if (locale === "en") {
					const activity = page.locator(`[data-self-check-id="${ids[1]}"]`);
					await activity.locator('[data-self-check-action="start-over"]').click();
					await activity.locator("textarea").fill("A deliberate new answer");
					await activity.locator('[data-self-check-action="check"]').click();
					await activity.locator('[data-self-check-action="show-feedback"]').click();
					await page.waitForFunction(
						() =>
							JSON.parse((window as ConsumerWindow).__praxityRuntime?.getSuspendData?.() || "{}").v
								?.count === 8,
					);
					expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBe(
						"__end_lesson__",
					);
				}
			});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const variant of ["optional", "remote", "remote-logic"] as const)
		test(`${format} ${variant} uses the dependency owner for optional failures and remote-only documents`, async ({
			page,
		}) => {
			await holdAdmissions(page, variant === "remote-logic");
			const entry = entries[`${format === "file" ? "html" : format}-en-${variant}`];
			await page.goto(format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry, {
				waitUntil: "domcontentloaded",
			});
			await page.waitForFunction(
				() => (window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.size === 3,
			);
			const ids = await page.evaluate(
				() =>
					JSON.parse(
						document.getElementById("praxity-config")?.textContent || "{}",
					).selfChecks.references.map(
						(reference: { blockId: string }) => reference.blockId,
					) as string[],
			);
			await page.evaluate(
				(id) =>
					(
						window as unknown as { releaseConsumer(id: string, success: boolean): void }
					).releaseConsumer(id, false),
				ids[2],
			);
			if (variant === "remote-logic") {
				await page
					.locator("[data-continue-button]")
					.first()
					.evaluate((element: HTMLButtonElement) => element.click());
				await expect(page.locator('[data-block-id="reveal-A"]')).toBeHidden();
				expect(
					await page.evaluate(
						() => (window as unknown as { consumerVisits: unknown[] }).consumerVisits,
					),
				).toEqual([]);
			}
			for (const id of ids.slice(0, 2))
				await page.evaluate(
					(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
					id,
				);
			await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
			if (variant === "optional") {
				await page.waitForFunction(() =>
					window.__praxitySelfCheckDocument?.consumers.forwardReady(),
				);
				await page
					.locator("[data-continue-button]")
					.first()
					.evaluate((element: HTMLButtonElement) => element.click());
				expect(
					await page.evaluate(
						() =>
							(window as unknown as { consumerProbe: { navigation: unknown[] } }).consumerProbe
								.navigation,
					),
				).toHaveLength(1);
			} else {
				await expect(page.locator("[data-self-check]")).toHaveCount(0);
				await expect(
					page.locator(variant === "remote" ? "#deck-next" : "[data-continue-button]").first(),
				).toHaveAttribute("aria-disabled", "true");
				const link = page.locator('a[data-page-number="2"]').first();
				await expect(link).not.toHaveAttribute("href");
				await expect(link).toHaveAttribute("aria-describedby", /praxity-completion-reason/);
				await expect(
					page.locator("#praxity-live-region, #deck-announcement").first(),
				).toContainText(/unavailable/i);
				if (variant === "remote-logic") {
					await expect(page.locator('[data-block-id="reveal-A"]')).toBeVisible();
					await expect(page.locator('[data-block-id="wrong"]')).toBeHidden();
					expect(
						await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget()),
					).toBeNull();
					expect(
						await page.evaluate(
							() =>
								(window as unknown as { consumerVariableWrites: unknown[] }).consumerVariableWrites,
						),
					).toEqual([]);
				}
				await expect(
					page.getByRole("link", { name: "Return to activity", exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole("link", { name: "Return to activity", exact: true }),
				).toHaveAttribute("href", /\.html$/);
			}
		});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	test(`${format} restores require and disable while running an unrelated initial rule once`, async ({
		page,
	}) => {
		await holdAdmissions(page, true);
		const entry = entries[`${format === "file" ? "html" : format}-en-require`];
		await page.goto(format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForFunction(
			() => (window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.size === 3,
		);
		const ids = await page.evaluate(
			() =>
				JSON.parse(document.getElementById("praxity-config")?.textContent || "{}").selfChecks
					.dependencies as string[],
		);
		await page.evaluate(
			(id) =>
				(
					window as unknown as { releaseConsumer(id: string, success?: boolean): void }
				).releaseConsumer(id, false),
			ids[1],
		);
		const next = page.locator("[data-continue-button]").first();
		await next.evaluate((element: HTMLButtonElement) => element.click());
		expect(
			await page.evaluate(
				() => (window as unknown as { consumerVariableWrites: unknown[] }).consumerVariableWrites,
			),
		).toEqual([]);
		await expect(page.locator('[data-block-id="rating"]')).not.toHaveAttribute("data-required");
		for (const id of [ids[0], ids[2]])
			await page.evaluate(
				(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
				id,
			);
		await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
		const rating = page.locator('[data-block-id="rating"]');
		await expect(rating).toHaveAttribute("data-required-min", "2");
		await expect(rating.locator(".praxity-required-indicator")).toBeVisible();
		await expect(next).toHaveAttribute("aria-disabled", "true");
		expect(
			await page.evaluate(
				() => JSON.parse((window as ConsumerWindow).__praxityRuntime?.getSuspendData?.() || "{}").v,
			),
		).toMatchObject({ count: 7, ordinary: 1 });
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
		await page.locator("[data-self-check-gate-retry]").click();
		await page.waitForFunction(
			(id) => (window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.has(id),
			ids[1],
		);
		await page.evaluate(
			(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
			ids[1],
		);
		await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
		expect(
			await page.evaluate(
				() => (window as unknown as { consumerVisits: unknown[] }).consumerVisits,
			),
		).toEqual([]);
		await rating.locator('label[for="rating-rating-2"]').click();
		await page.waitForFunction(
			() => window.__praxityLogicEngine?.isCompletionBlocked?.() === false,
		);
		expect(
			await page.evaluate(
				() => (window as unknown as { consumerVisits: unknown[] }).consumerVisits,
			),
		).toHaveLength(1);
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { consumerVisits: { finalized: boolean; count: number }[] })
						.consumerVisits[0],
			),
		).toMatchObject({ finalized: true, count: 7 });
		await page
			.locator(`[data-self-check-id="${ids[0]}"] [data-self-check-action="start-over"]`)
			.click();
		await expect(rating).not.toHaveAttribute("data-required");
		expect(
			await page.evaluate(
				() => JSON.parse((window as ConsumerWindow).__praxityRuntime?.getSuspendData?.() || "{}").v,
			),
		).toMatchObject({ count: 7, ordinary: 1 });
		await next.evaluate((element: HTMLButtonElement) => element.click());
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { consumerProbe: { navigation: unknown[] } }).consumerProbe
						.navigation,
			),
		).toEqual([]);
	});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	test(`${format} a context-pending preview stays outside admitted compiler references`, async ({
		page,
	}) => {
		await holdAdmissions(page);
		const entry = entries[`${format === "file" ? "html" : format}-en-false`];
		await page.goto(format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForFunction(
			() => (window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.size === 3,
		);
		const ids = await page.evaluate(
			() =>
				JSON.parse(document.getElementById("praxity-config")?.textContent || "{}").selfChecks
					.dependencies as string[],
		);
		for (const id of ids)
			await page.evaluate(
				(id) => (window as unknown as { releaseConsumer(id: string): void }).releaseConsumer(id),
				id,
			);
		await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
		await page.evaluate((id) => {
			const root = document.querySelector<HTMLElement>(`[data-self-check-id="${id}"]`);
			if (!root) throw new Error("Missing activity");
			root.setAttribute("data-self-check-context-pending", "");
			window.__praxitySelfCheckCore.disposeSelfCheckDocument();
			window.__praxitySelfCheckCore.initSelfCheckEnhancements();
		}, ids[0]);
		await page.waitForFunction(
			() => (window as unknown as { consumerHeld: Map<string, unknown> }).consumerHeld.size >= 2,
		);
		await page.evaluate(() => {
			const held = window as unknown as {
				consumerHeld: Map<string, unknown>;
				releaseConsumer(id: string): void;
			};
			for (const id of [...held.consumerHeld.keys()]) held.releaseConsumer(id);
		});
		const state = await page.evaluate(async (id) => {
			const runtime = window.__praxitySelfCheckCore.selfCheckRuntime(document);
			await runtime.session.ready;
			return runtime.session.read(id) ?? null;
		}, ids[0]);
		expect(state).toBeNull();
		await expect(
			page.locator(`[data-self-check-id="${ids[0]}"] [data-self-check-comparison]`),
		).toBeEmpty();
		const next = page.locator("[data-continue-button]").first();
		await next.evaluate((element: HTMLElement) => element.click());
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { consumerProbe: { navigation: unknown[] } }).consumerProbe
						.navigation,
			),
		).toEqual([]);
	});
