import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { readLesson, readSelfCheckContent, readWriteDistractorsContent } from "@praxity/grammar";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { build } from "esbuild";
import {
	compileCourse,
	deployCourse,
	selfCheckContentInput,
	writeDistractorsContentInput,
} from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { moduleDeckFixture } from "../fixtures/module-deck";

const formats = ["html", "scorm12", "scorm2004"] as const;
let folder: string, base: string, server: Server;
let cacheBrowser: Browser | undefined;
type Probe = Window & {
	authority: {
		calls: string[];
		old?: () => boolean;
		event?: Event;
		completed?: boolean;
		identity?: number;
		persisted?: boolean;
		gateWrites?: unknown[];
		replaced?: boolean;
		interactions?: number;
	};
	Authority: { dispatchSelfCheckEvent(event: Event, current: () => boolean): boolean };
	cardTimers: (() => void)[];
	cardEvent: Event;
};
test.beforeAll(async ({ browserName, playwright }) => {
	folder = await mkdtemp(join(tmpdir(), "learner-authority-"));
	for (const variant of ["assessment", "self-check", "logic", "islands"] as const) {
		const course = moduleDeckFixture();
		course.id = `authority-${variant}`;
		for (const page of course.content)
			page.blocks = page.blocks.filter((block) => block.type !== "image" && block.type !== "audio");
		const read = readLesson(
			"# Practice\n::: self-check Explain. {required=false private=false}\nmodel: Model.\n:: Reason\nmissed: Reason.\n:::\n",
		);
		const check = read.blocks.find((block) => block.type === "selfCheck");
		if (!check) throw new Error("Missing self-check");
		const content = readSelfCheckContent(read, check.id);
		check.id = "self-check-gate";
		course.content[variant === "self-check" ? 1 : 0].blocks.push(check);
		course.selfCheckContents = [selfCheckContentInput(check.id, content)];
		if (variant === "self-check") {
			course.content[1].blocks = [check];
			course.moduleDeck = { gates: { "self-check-gate": "attempt" } };
		}
		if (variant === "logic" || variant === "islands") {
			course.moduleDeck = undefined;
			course.navigationStyle = "bottomBar";
			course.content[0].blocks.push(
				{
					id: "nav-action",
					type: "button",
					data: { action: "goToPage", targetPageId: "slide-2", text: "Continue" },
				},
				{
					id: "count",
					type: "variable",
					data: { variableName: "count", dataType: "number", source: "manual", defaultValue: 0 },
				},
				{
					id: "rule",
					type: "logic",
					data: {
						conditions: {
							operator: "and",
							rules: [
								variant === "islands"
									? { source: "block:rating", field: "ratingScore", comparison: "gte", value: 2 }
									: { source: "variable:count", comparison: "gte", value: 0 },
							],
						},
						actions: [
							{ type: "setVariable", targets: ["count"], value: { operation: "add", operand: 1 } },
						],
					},
				},
			);
		}
		if (variant === "islands") {
			const extra = readLesson(
				"# Activities\n::: rating Choose.\n1. Low\n2. High\n:::\n::: checklist Ready?\n- One\n- Two\n:::\n::: choice Choose. {required=false}\n(x) Correct\n( ) Incorrect\n:::\n::: group Review {mode=all requireAll=true}\n::: choice Choose. {required=false}\n(x) Correct\n( ) Incorrect\n:::\n:::\n",
			);
			let assessmentAdded = false;
			for (const block of extra.blocks) {
				if (["rating", "checklist", "assessment", "assessmentGroup"].includes(block.type)) {
					block.data.required = false;
					if (block.type === "assessmentGroup") block.data.requireAll = false;
					if (block.type !== "assessment" || !assessmentAdded)
						block.id = block.type === "assessmentGroup" ? "group" : block.type;
					if (block.type === "assessment") assessmentAdded = true;
					if (block.type === "checklist")
						block.data.items = [
							{ id: "check-one", text: "One" },
							{ id: "check-two", text: "Two" },
						];
					course.content[0].blocks.push(block);
				}
			}
			const image =
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=";
			course.content[0].blocks.push(
				...([
					{
						id: "signature",
						type: "signature",
						data: { mode: "type", label: "Sign", required: false },
					},
					{
						id: "comparison",
						type: "imageComparison",
						data: {
							display: "slider",
							beforeImage: { src: image, altText: "Before" },
							afterImage: { src: image, altText: "After" },
						},
					},
					{
						id: "graphic",
						type: "labeledGraphic",
						data: {
							imageSrc: image,
							imageAlt: "Diagram",
							reveal: "click",
							labels: [{ id: "pin", x: 50, y: 50, title: "Pin", body: "Explanation" }],
						},
					},
					{
						id: "cards",
						type: "card",
						data: {
							layout: "single",
							advance: 1,
							items: ["one", "two", "three"].map((id) => ({
								id,
								front: [{ id: `front-${id}`, type: "text", data: { content: id } }],
							})),
						},
					},
					{
						id: "sequence",
						type: "sequence",
						data: {
							variant: "timeline",
							orientation: "horizontal",
							scrollable: true,
							items: Array.from({ length: 20 }, (_, index) => ({
								id: `step-${index}`,
								label: `Step ${index}`,
								children: [],
							})),
						},
					},
				] as PraxityBlock[]),
			);
		}
		const artifact = await compileCourse(course);
		try {
			for (const format of formats)
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
					join(folder, `${variant}-${format}`),
				);
		} finally {
			await artifact.dispose();
		}
	}
	const distractorRead = readLesson(
		"# Introduction\n::: write-distractors When should access needs be considered?\nanswer: Throughout the design process.\n:: Access comes last\noption: Only at the end.\n:: Everyone has the same needs\noption: Only for average needs.\n:::\n",
		{
			ids: (node, role) =>
				!role && node.type === "write-distractors"
					? "wd"
					: `node-${node.span.start}-${role ?? node.kind}`,
		},
	);
	const distractorArtifact = await compileCourse({
		id: "authority-distractors",
		title: "Practice",
		sourceLocale: "en",
		content: distractorRead.pages,
		writeDistractorsContents: [
			writeDistractorsContentInput("wd", readWriteDistractorsContent(distractorRead, "wd")),
		],
	});
	try {
		for (const format of formats)
			new AdmZip((await deployCourse(distractorArtifact, { format })).zip).extractAllTo(
				join(folder, `distractors-${format}`),
			);
	} finally {
		await distractorArtifact.dispose();
	}

	const publisher = await build({
		stdin: {
			contents: `export {dispatchSelfCheckEvent} from "./packages/shared-blocks/src/self-check-consumers.ts";`,
			resolveDir: resolve("../.."),
			loader: "ts",
		},
		bundle: true,
		write: false,
		format: "iife",
		globalName: "Authority",
		platform: "browser",
	});
	await writeFile(join(folder, "publisher.js"), publisher.outputFiles[0].contents);
	server = createServer(async (request, response) => {
		const path = new URL(request.url ?? "/", "http://fixture").pathname.slice(1);
		response.setHeader("Content-Type", "text/html");
		if (path === "away") return void response.end("<p>Away</p>");
		try {
			response.setHeader(
				"Content-Type",
				path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
			);
			response.end(await readFile(join(folder, path)));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing address");
	base = `http://127.0.0.1:${address.port}/`;
	// Keep process startup outside case timings; cache-return cases use fresh contexts.
	if (browserName === "chromium")
		cacheBrowser = await playwright.chromium.launch({
			headless: true,
			channel: "chromium",
			ignoreDefaultArgs: ["--disable-back-forward-cache"],
		});
});
test.afterAll(async () => {
	await cacheBrowser?.close();
	if (server) await new Promise<void>((done) => server.close(() => done()));
	if (folder) await rm(folder, { recursive: true });
});
async function settle(page: Page) {
	await page.waitForFunction(
		() =>
			(!document.querySelector<HTMLElement>(".praxity-deck") ||
				document.querySelector<HTMLElement>(".praxity-deck")?.dataset.ready) &&
			// Distractors own a typed session rather than a self-check consumer.
			(document.querySelector("[data-write-distractors]")
				? document
						.querySelector('[data-distractor-action="check"]')
						?.getAttribute("aria-disabled") === "false"
				: window.__praxitySelfCheckDocument?.consumers.settled()) &&
			document.documentElement.dataset.praxityIslandsReady === "true",
	);
}
async function open(page: Page, variant: string, format: string) {
	await page.goto(`${base}${variant}-${format}/introduction.html`);
	await settle(page);
}
async function returned(page: Page) {
	await page.evaluate(() => {
		window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
		window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
	});
	await settle(page);
}
async function instrument(page: Page) {
	await page.evaluate(() => {
		const view = window as unknown as Probe,
			runtime = window.__praxityRuntime as SCORMRuntime;
		view.authority = { calls: [] };
		for (const name of [
			"setSuspendData",
			"commit",
			"trackInteraction",
			"trackObjective",
			"trackNavigation",
		] as const) {
			if (typeof runtime[name] !== "function") continue;
			const method = runtime[name].bind(runtime);
			Object.assign(runtime, {
				[name]: (...args: unknown[]) => {
					view.authority.calls.push(name);
					return Reflect.apply(method, runtime, args);
				},
			});
		}
	});
}
for (const format of formats) {
	for (const cause of [
		"held-selection",
		"selection",
		"submit-response",
		"submit-interaction",
		"control",
	] as const)
		test(`${format}: assessment persistence retains ${cause} authority`, async ({ page }) => {
			await page.addInitScript((cause) => {
				const view = window as unknown as Probe;
				view.authority = { calls: [], gateWrites: [], interactions: 0 };
				if (cause === "control") return;
				if (cause === "held-selection")
					document.addEventListener(
						"praxity:self-check-owner",
						(event) => {
							// Hold island teardown so the original handler's queued render can finish.
							// The owner revokes its ticket before publishing this UI notification.
							if (view.authority.replaced) event.stopImmediatePropagation();
						},
						{ capture: true },
					);
				document.addEventListener(
					cause === "submit-response" ? "praxity:assessment-response" : "praxity:block-interaction",
					(event) => {
						if ((event as CustomEvent).detail.blockId !== "practice-gate") return;
						view.authority.interactions = (view.authority.interactions ?? 0) + 1;
						if (
							view.authority.replaced ||
							(cause === "submit-interaction" && view.authority.interactions < 2)
						)
							return;
						view.authority.old = window.__praxitySelfCheckDocument?.loadTicket();
						view.authority.replaced = true;
						const previous = window.__praxityBlockState;
						window.__praxityBlockState = {
							get: () => undefined,
							getPolicy: (id) => previous?.getPolicy?.(id) ?? "lms",
							set(id, value) {
								if (id === "practice-gate") view.authority.gateWrites?.push(value);
							},
						};
					},
				);
			}, cause);
			await open(page, "assessment", format);
			await page.locator("#deck-next").click();
			if (cause === "control")
				await page.evaluate(() => {
					const view = window as unknown as Probe;
					const provider = window.__praxityBlockState;
					if (!provider) throw new Error("Missing provider");
					const set = provider.set.bind(provider);
					provider.set = (id, value) => {
						if (id === "practice-gate") view.authority.gateWrites?.push(value);
						set(id, value);
					};
				});
			// check() retries after replacement remounts the island, creating a second gesture.
			await page.locator('[data-block-id="practice-gate"] input[type=radio]').first().click();
			if (cause !== "selection" && cause !== "held-selection")
				await page.locator('[data-block-id="practice-gate"] [data-assessment-submit]').click();
			// Flush React's queued render and persistence effect without a timing delay.
			await page.evaluate(
				() =>
					new Promise<void>((done) =>
						requestAnimationFrame(() => requestAnimationFrame(() => done())),
					),
			);
			if (cause === "control") {
				expect(
					await page.evaluate(() => (window as unknown as Probe).authority.gateWrites),
				).toEqual(
					expect.arrayContaining([expect.objectContaining({ checked: true, interacted: true })]),
				);
				await page.locator("#deck-next").click();
				expect(await page.evaluate(() => location.hash)).toBe("#slide-3");
			} else {
				expect(await page.evaluate(() => (window as unknown as Probe).authority.replaced)).toBe(
					true,
				);
				expect(await page.evaluate(() => (window as unknown as Probe).authority.old?.())).toBe(
					false,
				);
				expect(
					await page.evaluate(() => (window as unknown as Probe).authority.gateWrites),
				).toEqual([]);
			}
		});
	test(`${format}: slide visit and bookmark after persisted return`, async ({ page }) => {
		await open(page, "assessment", format);
		await returned(page);
		await page.locator("#deck-next").click();
		await expect
			.poll(() => page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getVisitedPages()))
			.toContain("slide-2");
		expect(await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getBookmark())).toBe(
			"index.html?praxity-page=slide-2",
		);
	});
	test(`${format}: real cache return accepts a fresh slide visit`, async ({ browserName }) => {
		test.skip(browserName !== "chromium", "Real BFCache positive control uses Chromium");
		if (!cacheBrowser) throw new Error("Missing cache-return browser");
		const context = await cacheBrowser.newContext();
		try {
			const page = await context.newPage();
			await open(page, "assessment", format);
			await page.evaluate(() => {
				const view = window as unknown as Probe;
				view.authority = { calls: [], identity: 1475 };
				window.addEventListener("pageshow", (event) => {
					view.authority.persisted = event.persisted;
				});
			});
			await page.goto(`${base}away`);
			await page.goBack({ waitUntil: "commit" });
			await settle(page);
			expect(await page.evaluate(() => (window as unknown as Probe).authority.identity)).toBe(1475);
			expect(await page.evaluate(() => (window as unknown as Probe).authority.persisted)).toBe(
				true,
			);
			await page.locator("#deck-next").click();
			expect(
				await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getVisitedPages()),
			).toContain("slide-2");
			expect(
				await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getBookmark()),
			).toBe("index.html?praxity-page=slide-2");
		} finally {
			await context.close();
		}
	});
	for (const eventName of ["assessment-response", "self-check-completion"] as const)
		test(`${format}: early ${eventName} revocation leaves the gate locked`, async ({ page }) => {
			await page.addInitScript((eventName) => {
				document.addEventListener(`praxity:${eventName}`, (event) => {
					if (
						eventName === "self-check-completion" &&
						(event as CustomEvent).detail.completed !== true
					)
						return;
					if (
						(event as CustomEvent).detail.blockId !==
						(eventName === "assessment-response" ? "practice-gate" : "self-check-gate")
					)
						return;
					const view = window as unknown as Probe,
						runtime = window.__praxityRuntime as SCORMRuntime;
					if (view.authority?.completed) return;
					view.authority = {
						calls: [],
						old: window.__praxitySelfCheckDocument?.loadTicket(),
						completed: true,
					};
					for (const name of ["setSuspendData", "commit"] as const) {
						const method = runtime[name].bind(runtime);
						Object.assign(runtime, {
							[name]: (...args: unknown[]) => {
								view.authority.calls.push(name);
								return Reflect.apply(method, runtime, args);
							},
						});
					}
					// Hold the successor's admission at the implementation seam.
					window.__praxitySelfCheckCore.implementation = () => new Promise(() => {});
					window.__praxityBlockState = { get: () => undefined, set() {}, getPolicy: () => "lms" };
				});
			}, eventName);
			await open(page, eventName === "assessment-response" ? "assessment" : "self-check", format);
			await page.locator("#deck-next").click();
			if (eventName === "assessment-response") {
				await page.locator('[data-block-id="practice-gate"] input[type=radio]').first().check();
				await page.locator('[data-block-id="practice-gate"] [data-assessment-submit]').click();
			} else {
				const activity = page.locator("[data-self-check]");
				await activity.locator("textarea").fill("Tuesday");
				await activity.locator('[data-self-check-action="check"]').click();
				await activity.locator('[data-self-check-action="show-feedback"]').click();
			}
			await page.waitForFunction(() => (window as unknown as Probe).authority?.completed);
			expect(await page.evaluate(() => (window as unknown as Probe).authority.old?.())).toBe(false);
			expect(await page.evaluate(() => (window as unknown as Probe).authority.calls)).toEqual([]);
			expect(
				await page.evaluate(
					() =>
						JSON.parse((window.__praxityRuntime as SCORMRuntime).getSuspendData() ?? "{}").deck
							?.released ?? [],
				),
			).not.toContain(eventName === "assessment-response" ? "practice-gate" : "self-check-gate");
			await page.locator("#deck-next").click();
			expect(await page.evaluate(() => location.hash)).toBe("#slide-2");
		});
	test(`${format}: unstamped response replay has zero host and deck writes`, async ({ page }) => {
		await open(page, "assessment", format);
		await instrument(page);
		await page.evaluate(() => {
			const event = new CustomEvent("praxity:assessment-response", {
				detail: { blockId: "practice-gate", responseText: "Tuesday", submitted: true },
			});
			document.dispatchEvent(event);
			document.dispatchEvent(event);
		});
		expect(await page.evaluate(() => (window as unknown as Probe).authority.calls)).toEqual([]);
	});
	test(`${format}: unstamped block interaction has zero variable writes`, async ({ page }) => {
		await open(page, "logic", format);
		await instrument(page);
		await page.evaluate(async () => {
			document.dispatchEvent(
				new CustomEvent("praxity:block-interaction", {
					detail: { blockId: "input", blockType: "rating" },
				}),
			);
			await new Promise<void>((done) => requestAnimationFrame(() => done()));
		});
		expect(await page.evaluate(() => (window as unknown as Probe).authority.calls)).toEqual([]);
	});
	for (const eventName of [
		"assessment-response",
		"assessment-group-complete",
		"self-check-completion",
		"block-interaction",
	])
		test(`${format}: ended ${eventName} dispatch cannot write`, async ({ page }) => {
			await open(page, eventName === "block-interaction" ? "logic" : "assessment", format);
			if (eventName === "assessment-response" || eventName === "assessment-group-complete")
				await page.locator("#deck-next").click();
			await page.addScriptTag({ url: `${base}publisher.js` });
			await page.evaluate((eventName) => {
				const view = window as unknown as Probe,
					current = window.__praxitySelfCheckDocument?.loadTicket();
				if (!current) throw new Error("Missing lifetime");
				view.authority = {
					calls: [],
					event: new CustomEvent(`praxity:${eventName}`, {
						detail: {
							blockId: "practice-gate",
							groupId: "practice-gate",
							submitted: true,
							completed: true,
							responseText: "Tuesday",
							blockType: "rating",
						},
					}),
				};
				const event = view.authority.event;
				if (!event) throw new Error("Missing event");
				view.Authority.dispatchSelfCheckEvent(event, current);
			}, eventName);
			await returned(page);
			const event = await page.evaluateHandle(() => (window as unknown as Probe).authority.event);
			await instrument(page);
			await page.evaluate(async (event) => {
				document.dispatchEvent(event as Event);
				await new Promise<void>((done) => requestAnimationFrame(() => done()));
			}, event);
			expect(await page.evaluate(() => (window as unknown as Probe).authority.calls)).toEqual([]);
			await event.dispose();
		});
	test(`${format}: a current stamped response releases and saves after return`, async ({
		page,
	}) => {
		await open(page, "assessment", format);
		await returned(page);
		await page.locator("#deck-next").click();
		await instrument(page);
		await page.locator('[data-block-id="practice-gate"] input[type=radio]').first().check();
		await page.locator('[data-block-id="practice-gate"] [data-assessment-submit]').click();
		expect(await page.evaluate(() => (window as unknown as Probe).authority.calls)).toContain(
			"trackInteraction",
		);
		expect(
			await page.evaluate(
				() =>
					JSON.parse((window.__praxityRuntime as SCORMRuntime).getSuspendData() ?? "{}").deck
						.released,
			),
		).toContain("practice-gate");
		await page.locator("#deck-next").click();
		expect(await page.evaluate(() => location.hash)).toBe("#slide-3");
	});
}

// Every entry has either a learner action or an explicit absence of learner writes.
const returnActions: Record<string, ((page: Page) => Promise<void>) | "no learner writes"> = {
	"island-nav": async (page) => {
		await page.locator('[data-action="goToPage"][data-target-page="slide-2"]').click();
		await page.waitForURL("**/practice.html");
		await page.waitForFunction(() =>
			window.__praxityRuntime?.getVisitedPages?.().includes("slide-2"),
		);
		expect(
			await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getVisitedPages()),
		).toContain("slide-2");
		expect(await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getBookmark())).toBe(
			"slide-2",
		);
	},
	"island-accordion": "no learner writes",
	"island-tabs": "no learner writes",
	"island-assessment": async (page) => {
		const root = page.locator('[data-block-id="assessment"]');
		await root.locator('input[type="radio"]').first().check();
		await root.locator("[data-assessment-submit]").click();
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("assessment")))
			.toMatchObject({
				version: 1,
				kind: "assessment",
				attemptCount: 1,
				checked: true,
				correct: true,
				completed: true,
			});
	},
	"island-assessment-group": async (page) => {
		await page.locator('[data-assessment-group="group"] input[type="radio"]').first().check();
		await page.locator(".praxity-assessment-group-submit .praxity-ag-submit-btn").click();
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("group")))
			.toMatchObject({
				version: 1,
				kind: "assessmentGroup",
				mode: "all",
				selectedMemberId: null,
				completed: true,
			});
	},
	"island-logic": async (page) => {
		await page.locator('[data-block-id="rating"] label[for="rating-rating-2"]').click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse((window.__praxityRuntime as SCORMRuntime).getSuspendData() ?? "{}").v?.count,
				),
			)
			.toBe(1);
	},
	"island-self-check": async (page) => {
		await page.locator("[data-self-check] textarea").fill("Tuesday");
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("self-check-gate")))
			.toMatchObject({ draft: { answer: "Tuesday" } });
	},
	"island-write-distractors": async (page) => {
		await page.locator("[data-distractor-answer]").fill("Tuesday");
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("wd")))
			.toMatchObject({ value: { answer: "Tuesday" } });
		await page.getByRole("button", { name: "Check my answer", exact: true }).click();
		await page.getByRole("button", { name: "Yes", exact: true }).click();
		await page.locator("fieldset textarea").nth(0).fill("Only at the end");
		await page.locator("fieldset select").nth(0).selectOption({ label: "Access comes last" });
		await page.locator("fieldset textarea").nth(1).fill("Only for average needs");
		await page
			.locator("fieldset select")
			.nth(1)
			.selectOption({ label: "Everyone has the same needs" });
		const compare = page.getByRole("button", { name: "Compare with the author's", exact: true });
		await compare.click();
		await expect(compare).toBeFocused();
		await expect(compare).toHaveAttribute("aria-disabled", "true");
		const beforePrint = await page.evaluate(() =>
			JSON.stringify((window as unknown as { fixtureWrites: unknown[] }).fixtureWrites),
		);
		await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
		await expect(page.locator(".praxity-distractor-print")).not.toHaveCount(0);
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await expect(page.locator(".praxity-distractor-print")).toHaveCount(0);
		expect(
			await page.evaluate(() =>
				JSON.stringify((window as unknown as { fixtureWrites: unknown[] }).fixtureWrites),
			),
		).toBe(beforePrint);
		await expect(compare).toBeFocused();
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
		});
		await expect(compare).toHaveAttribute("aria-disabled", "true");
		await expect(compare).toBeFocused();
		await page.getByRole("button", { name: "Start over", exact: true }).click();
		await expect(page.locator("[data-distractor-answer]")).toHaveValue("");
	},
	"island-retrieval-sheet": "no learner writes",
	"island-highlight": "no learner writes",
	"island-checklist": async (page) => {
		await page.locator('[data-block-id="checklist"] [data-item-id="check-one"] input').check();
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("checklist")))
			.toEqual({ checkedItemIds: ["check-one"] });
	},
	"island-rating": async (page) => {
		await page.locator('[data-block-id="rating"] label[for="rating-rating-2"]').click();
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("rating")))
			.toEqual({ value: 2 });
	},
	"island-signature": async (page) => {
		await page.locator('[data-block-id="signature"] input[type="text"]').fill("Tuesday");
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("signature")))
			.toMatchObject({ method: "type", typedValue: "Tuesday" });
	},
	"island-image-comparison": async (page) => {
		await page
			.locator('[data-block-id="comparison"] input[type="range"]')
			.evaluate((input: HTMLInputElement) => {
				input.value = "72";
				input.dispatchEvent(new Event("input", { bubbles: true }));
			});
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("comparison")))
			.toEqual({ position: 72 });
	},
	"island-labeled-graphic": async (page) => {
		await page.locator('[data-block-id="graphic"] .praxity-labeled-graphic-dot').click();
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("graphic")))
			.toEqual({ revealedIds: ["pin"], activeId: "pin" });
	},
	"island-narration": "no learner writes",
	"island-deck": async (page) => {
		await page.locator("#deck-next").click();
		expect(
			await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getVisitedPages()),
		).toContain("slide-2");
		expect(await page.evaluate(() => (window.__praxityRuntime as SCORMRuntime).getBookmark())).toBe(
			"index.html?praxity-page=slide-2",
		);
	},
	"island-card": async (page) => {
		await page.locator('[data-block-id="cards"] [data-card-next]').click();
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("cards")))
			.toMatchObject({ currentId: "two" });
	},
	"island-table": "no learner writes",
	"island-code": "no learner writes",
	"island-tooltip": "no learner writes",
	"island-media": "no learner writes",
	"island-sequence": async (page) => {
		const viewport = page.locator('[data-block-id="sequence"] .praxity-sequence-scroll-viewport');
		await viewport.scrollIntoViewIfNeeded();
		await viewport.evaluate(async (element) => {
			element.scrollLeft = 72;
			element.dispatchEvent(new Event("scroll"));
			await new Promise<void>((done) => requestAnimationFrame(() => done()));
		});
		await expect
			.poll(() => page.evaluate(() => window.__praxityBlockState?.get("sequence")))
			.toEqual({ position: 72 });
	},
};
test("return-action table covers every island entry point", async () => {
	// Retrieval controls are memory-only: returning must not restore or report saved state.
	expect(returnActions["island-retrieval-sheet"]).toBe("no learner writes");
	expect(returnActions["island-highlight"]).toBe("no learner writes");
	const source = await readFile(resolve("src/bundle-viewer.ts"), "utf8");
	const declaration = source.split("const ISLAND_ENTRY_POINTS = {")[1]?.split("} as const;")[0];
	if (!declaration) throw new Error("Missing island entry declaration");
	expect(Object.keys(returnActions).sort()).toEqual(
		[...declaration.matchAll(/"(island-[\w-]+)":/g)].map((match) => match[1]).sort(),
	);
});
for (const [island, action] of Object.entries(returnActions))
	if (action !== "no learner writes")
		for (const format of formats)
			test(`${format}: return action ${island} retains learner writes`, async ({ page }) => {
				await open(
					page,
					island === "island-write-distractors"
						? "distractors"
						: island === "island-deck"
							? "assessment"
							: "islands",
					format,
				);
				await returned(page);
				await action(page);
			});

for (const format of formats)
	test(`${format}: ended card-playthrough dispatch cannot persist a turn`, async ({ page }) => {
		await page.addInitScript(() => {
			const view = window as unknown as Probe,
				schedule = window.setTimeout;
			view.cardTimers = [];
			window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
				if (delay === 1000 && typeof callback === "function") {
					view.cardTimers.push(() => callback(...args));
					return -view.cardTimers.length;
				}
				return schedule(callback, delay, ...args);
			}) as typeof window.setTimeout;
		});
		await open(page, "islands", format);
		await page.addScriptTag({ url: `${base}publisher.js` });
		await page.evaluate(() => {
			const view = window as unknown as Probe,
				card = document.querySelector<HTMLElement>('[data-card-root][data-block-id="cards"]'),
				current = window.__praxitySelfCheckDocument?.loadTicket();
			if (!card || !current) throw new Error("Missing card authority");
			card.dataset.cardPlaythroughMode = "narration";
			card.dataset.cardPlaythroughPlaying = "true";
			view.cardEvent = new Event("praxity:card-playthrough");
			view.Authority.dispatchSelfCheckEvent(view.cardEvent, current);
			card.dispatchEvent(view.cardEvent);
		});
		expect(await page.evaluate(() => (window as unknown as Probe).cardTimers.length)).toBe(1);
		await page.evaluate(() => {
			const card = document.querySelector<HTMLElement>('[data-card-root][data-block-id="cards"]');
			if (card) card.dataset.cardPlaythroughPlaying = "false";
		});
		await returned(page);
		await instrument(page);
		await page.evaluate(() => {
			const view = window as unknown as Probe;
			const card = document.querySelector<HTMLElement>('[data-card-root][data-block-id="cards"]');
			if (!card) throw new Error("Missing card");
			card.dataset.cardPlaythroughPlaying = "true";
			card.dispatchEvent(view.cardEvent);
			view.cardTimers.splice(0).forEach((deliver) => deliver());
		});
		expect(await page.evaluate(() => (window as unknown as Probe).authority.calls)).toEqual([]);
		expect(await page.evaluate(() => window.__praxityBlockState?.get("cards"))).toBeUndefined();
	});
