import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import { computeViewerSourceHash, SELF_CHECK_INITIAL_RAW_CEILING } from "../../src/bundle-viewer";
import { readCachedViewer, VIEWER_CACHE_DIR } from "../../src/viewer-cache";

let folder: string, base: string, criterionId: string, server: Server;
const entries: Record<string, string> = {};
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const errors: string[] = [];
		window.addEventListener("error", (event) => errors.push(event.message));
		Object.assign(window, { selfCheckStartupErrors: errors });
	});
});
test.afterEach(async ({ page }, info) => {
	if (info.status === info.expectedStatus) return;
	const state = await page.evaluate(async () => {
		const owner = window.__praxitySelfCheckDocument;
		const runtime = window.__praxitySelfCheckSession;
		let privacy = window.__praxityPrivacyReady ? "pending" : "absent";
		void window.__praxityPrivacyReady?.then(() => {
			privacy = "settled";
		});
		await Promise.resolve();
		await Promise.resolve();
		return {
			privacy,
			hostRuntime: !!(window as unknown as { __praxityRuntime?: unknown }).__praxityRuntime,
			tracker: !!(window as unknown as { __praxityTracker?: unknown }).__praxityTracker,
			dom: document.readyState,
			active: owner?.active(),
			lifetime: owner?.lifetime()?.reason,
			current: owner?.loadTicket()(),
			startup: runtime?.session.startup(),
			settled: owner?.consumers.settled(),
			providerMatches: runtime?.provider === window.__praxityBlockState,
			islands: document.documentElement.dataset.praxityIslandsReady,
			canonical: !!window.PraxitySelfCheckIsland,
			errors: (window as unknown as { selfCheckStartupErrors: string[] }).selfCheckStartupErrors,
			activities: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) => {
				const activity = runtime?.session.read(root.dataset.selfCheckId ?? "");
				return { outcome: activity?.outcome, ready: activity?.ready, admitted: activity?.admitted };
			}),
		};
	});
	await info.attach("startup-state", {
		body: JSON.stringify(state),
		contentType: "application/json",
	});
});
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-effects-"));
	const read = readLesson(
		"# Practice\n::: self-check Explain A. {private=false}\nmodel: Model A.\n:: Reason\nmissed: Hint A.\n:::\n\n::: self-check Explain B. {private=false}\nmodel: Model B.\n:: Reason\nmissed: Hint B.\n:::\n",
	);
	const blocks = read.blocks.filter((block) => block.type === "selfCheck");
	criterionId = readSelfCheckContent(read, blocks[0].id).parts[0].id;
	const artifact = await compileCourse({
		id: "self-check-effects",
		title: "Practice",
		sourceLocale: "en",
		content: read.pages,
		selfCheckContents: blocks.map((block) =>
			selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)),
		),
	});
	try {
		for (const format of ["html", "scorm12", "scorm2004"] as const) {
			entries[format] = `${format}/${artifact.manifest.pages[0].slug}.html`;
			new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(join(folder, format));
		}
	} finally {
		await artifact.dispose();
	}
	await writeFile(
		join(folder, "html", "foreign.html"),
		(await readFile(join(folder, entries.html), "utf8")).replace(
			/<script\b[^>]*>[\s\S]*?<\/script>/gi,
			"",
		),
	);
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

const actions = ["dispose", "replace", "reset", "edit", "retry"] as const;
for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const boundary of [
		"completion-A",
		"completion-B",
		"interaction-B",
		"response-B",
		"pagehide-B",
	] as const)
		for (const action of ["dispose", "replace"] as const)
			test(`slice 3 ${format} ${action} at ${boundary} fences both activities`, async ({
				page,
			}) => {
				await page.goto(
					format === "file"
						? pathToFileURL(join(folder, entries.html)).href
						: base + entries[format],
				);
				await page.waitForFunction(
					() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
				);
				if (!boundary.startsWith("completion")) {
					for (const [index, answer] of ["Answer A", "Answer B"].entries()) {
						const root = page.locator("[data-self-check]").nth(index);
						await root.locator("textarea").fill(answer);
						await root.locator('[data-self-check-action="check"]').click();
						await expect(root.locator("[data-self-check-parts] input")).toBeVisible();
						if (index === 0) await root.locator('[data-self-check-action="show-feedback"]').click();
					}
				}
				const result = await page.evaluate(
					async ({ boundary, action }) => {
						const api = window.__praxitySelfCheckCore;
						const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
						const ids = roots.map((root) => root.dataset.selfCheckId ?? "");
						const envelopes = roots.map((root, index) => ({
							version: 1,
							kind: "self-check",
							draft: { answer: index === 0 ? "Answer A" : "Answer B", ticked: [], shown: false },
							submitted: {
								answer: index === 0 ? "Answer A" : "Answer B",
								ticked: [],
								shown: true,
								contentRevision: root.dataset.selfCheckRevision,
							},
						}));
						const events: string[] = [],
							writes: unknown[] = [],
							summaries: string[] = [];
						let armed = false,
							fired = false;
						const successorWrites: unknown[] = [];
						let interrupted = window.__praxitySelfCheckSession;
						const original = window.__praxitySelfCheckSession?.provider;
						if (!original) throw new Error("Missing provider");
						const originalSet = original.set;
						original.set = (id, value) => {
							if (armed) writes.push(structuredClone(value));
							originalSet(id, value);
						};
						const interrupt = () => {
							if (fired) return;
							fired = true;
							if (action === "dispose") api.disposeSelfCheckDocument();
							else
								window.__praxityBlockState = {
									get: () => undefined,
									set: (_id, value) => {
										successorWrites.push(structuredClone(value));
									},
									getPolicy: () => "lms",
								};
						};
						if (boundary === "pagehide-B")
							window.addEventListener("pagehide", interrupt, { once: true });
						for (const [name, code] of [
							["praxity:self-check-completion", "C"],
							["praxity:block-interaction", "I"],
							["praxity:assessment-response", "R"],
						])
							document.addEventListener(name, (event) => {
								if (!armed) return;
								const detail = (event as CustomEvent).detail;
								const activity = detail.blockId === ids[0] ? "A" : "B";
								events.push(`${code}:${activity}${code === "C" ? `:${detail.completed}` : ""}`);
								if (code === "C" && detail.completed && boundary === `completion-${activity}`)
									interrupt();
								if (
									activity === "B" &&
									((code === "I" && boundary === "interaction-B") ||
										(code === "R" && boundary === "response-B"))
								)
									interrupt();
								if (
									code === "C" &&
									detail.completed &&
									activity === "B" &&
									boundary === "pagehide-B"
								)
									window.dispatchEvent(new Event("pagehide"));
							});
						const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
						for (const root of roots)
							Object.defineProperty(root.querySelector("[data-self-check-status]"), "textContent", {
								configurable: true,
								get() {
									return descriptor?.get?.call(this);
								},
								set(value) {
									if (armed && value) summaries.push(value);
									descriptor?.set?.call(this, value);
								},
							});
						if (boundary.startsWith("completion")) {
							window.__praxityBlockState = {
								get: (id) => envelopes[ids.indexOf(id)] as never,
								set: (_id, value) => {
									writes.push(structuredClone(value));
								},
								getPolicy: () => "lms",
							};
							interrupted = window.__praxitySelfCheckSession;
							armed = true;
							await window.__praxitySelfCheckSession?.session.ready;
						} else {
							armed = true;
							roots[1]
								.querySelector<HTMLButtonElement>('[data-self-check-action="show-feedback"]')
								?.click();
						}
						if (boundary === "pagehide-B" && action === "replace")
							window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
						await window.__praxitySelfCheckSession?.session.ready;
						return {
							startup: interrupted?.session.read(ids[0])?.startup,
							fired,
							events,
							writes,
							summaries,
							successorWrites,
							controls: roots.map(
								(root) => root.querySelectorAll('[data-self-check-action="retry"]').length,
							),
							attributes: roots.map(
								(root) => root.closest<HTMLElement>("[data-block-id]")?.dataset.completed ?? null,
							),
							saved: ids.map((id) => original.get(id)),
							revisions: roots.map((root) => root.dataset.selfCheckRevision),
						};
					},
					{ boundary, action },
				);
				const prefix =
					boundary === "completion-A"
						? ["C:A:true"]
						: boundary === "completion-B"
							? ["C:A:true", "C:B:true"]
							: boundary === "interaction-B"
								? ["C:B:true", "I:B"]
								: boundary === "response-B"
									? ["C:B:true", "I:B", "R:B"]
									: ["C:B:true"];
				expect(result.fired).toBe(true);
				expect(result.events).toEqual([
					...prefix,
					"C:A:false",
					"C:B:false",
					...(action === "replace" ? ["C:A:false", "C:B:false"] : []),
				]);
				expect(result.summaries).toEqual([]);
				expect(result.startup).toBe("cancelled");
				expect(result.successorWrites).toEqual(
					boundary === "pagehide-B" && action === "replace"
						? ["Answer A", "Answer B"].map((answer) => ({
								version: 1,
								kind: "self-check",
								draft: { answer, ticked: [], shown: false },
								submitted: null,
							}))
						: [],
				);
				expect(result.writes).toHaveLength(boundary.startsWith("completion") ? 0 : 1);
				expect(result.attributes).toEqual([null, null]);
				expect(result.controls).toEqual(action === "dispose" ? [0, 0] : [1, 1]);
				if (!boundary.startsWith("completion"))
					expect(result.saved).toEqual(
						["Answer A", "Answer B"].map((answer, index) => ({
							version: 1,
							kind: "self-check",
							draft: { answer, ticked: [], shown: false },
							submitted: {
								answer,
								ticked: [],
								shown: true,
								contentRevision: result.revisions[index],
							},
						})),
					);
			});
test("held Retry retains checked criteria across answer-only edits and feedback", async ({
	page,
}) => {
	await page.goto(base + entries.html);
	await page.waitForFunction(
		() =>
			window.__praxitySelfCheckSession &&
			document.querySelectorAll("[data-self-check-comparison]").length === 2,
	);
	await page.evaluate(() => {
		const values = new Map<string, unknown>();
		let failWrite = false;
		Object.assign(window, { failTickSave: () => (failWrite = true) });
		window.__praxityBlockState = {
			get: (id) => values.get(id) as never,
			set: (id, value) => {
				if (failWrite) {
					failWrite = false;
					throw new Error("held-ticks-save");
				}
				values.set(id, structuredClone(value));
			},
			getPolicy: () => "lms",
		};
	});
	const root = page.locator("[data-self-check]").first(),
		checkbox = root.locator("[data-self-check-parts] input").first();
	await root.locator("textarea").fill("Initial");
	await root.locator('[data-self-check-action="check"]').click();
	await expect(checkbox).toBeVisible();
	await page.evaluate(() => (window as unknown as { failTickSave(): void }).failTickSave());
	await root.locator("textarea").fill("Save fails");
	await expect(root.locator('[data-self-check-action="retry"]')).toBeVisible();
	await page.evaluate(async () => {
		const adapter = await window.__praxitySelfCheckSession?.support();
		if (!adapter) throw new Error("Missing support");
		const admit = adapter.admit;
		adapter.admit = async (...args) => {
			const operations = await admit(...args);
			return new Promise((resolve) => {
				Object.assign(window, { releaseTickAdmission: () => resolve(operations) });
			});
		};
	});
	await root.locator('[data-self-check-action="retry"]').click();
	await page.waitForFunction(() => "releaseTickAdmission" in window);
	await checkbox.check();
	await root.locator("textarea").fill("Latest answer");
	const readDraft = () =>
		page.evaluate(() => {
			const runtime = window.__praxitySelfCheckSession,
				id = document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
			return {
				stored: runtime?.provider?.get(id),
				projected: runtime?.results.get(id)?.state,
				view: runtime?.session.read(id),
			};
		});
	const expected = {
		version: 1,
		kind: "self-check",
		draft: { answer: "Latest answer", ticked: [criterionId], shown: false },
		submitted: null,
	};
	expect(await readDraft()).toMatchObject({
		stored: expected,
		view: { outcome: "pending", available: false },
	});
	await page.evaluate(() =>
		(window as unknown as { releaseTickAdmission(): void }).releaseTickAdmission(),
	);
	await page.waitForFunction(() => {
		const id = document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
		return window.__praxitySelfCheckSession?.session.read(id)?.outcome !== "pending";
	});
	expect(await readDraft()).toMatchObject({ stored: expected, projected: expected });
	await expect(checkbox).toBeChecked();
	await root.locator('[data-self-check-action="show-feedback"]').click();
	const submitted = await readDraft();
	expect(submitted.stored).toMatchObject({
		...expected,
		submitted: { answer: "Latest answer", ticked: [criterionId], shown: true },
	});
	expect(submitted.projected).toEqual(submitted.stored);
	await expect(root.locator("[data-self-check-comparison]")).toContainText("Model A.");
	await expect(root.locator("[data-self-check-comparison]")).not.toContainText("Hint A.");
});
const boundaries = [
	"completion",
	"interaction",
	"response",
	"write",
	"policy",
	"save",
	"truncation",
] as const;
test("provider replacement inside mounting leaves only the successor's controls", async ({
	page,
}) => {
	await page.goto(base + entries.html);
	await page.waitForFunction(
		() =>
			window.__praxitySelfCheckSession &&
			document.querySelectorAll("[data-self-check-comparison]").length === 2,
	);
	const result = await page.evaluate(async () => {
		let replaced = false,
			writes = 0;
		const finalProvider = {
			get: () => undefined,
			set: () => {
				++writes;
			},
			getPolicy: () => "device" as const,
		};
		window.__praxityBlockState = {
			get: () => undefined,
			set: () => {
				++writes;
			},
			getPolicy: () => {
				if (!replaced) {
					replaced = true;
					window.__praxityBlockState = finalProvider;
				}
				return "device";
			},
		};
		await window.__praxitySelfCheckSession?.session.ready;
		return {
			replaced,
			writes,
			final: window.__praxitySelfCheckSession?.provider === finalProvider,
			controls: [...document.querySelectorAll("[data-self-check]")].map((root) =>
				["retry", "mode", "save", "recovery", "comparison"].map(
					(name) =>
						root.querySelectorAll(
							name === "retry" ? '[data-self-check-action="retry"]' : `[data-self-check-${name}]`,
						).length,
				),
			),
		};
	});
	expect(result).toEqual({
		replaced: true,
		writes: 0,
		final: true,
		controls: [
			[1, 1, 1, 1, 1],
			[1, 1, 1, 1, 1],
		],
	});
});
for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	for (const boundary of boundaries) {
		for (const action of actions) {
			test(`${format} ${boundary} ${action} invalidates the old feedback effects`, async ({
				page,
			}) => {
				await page.goto(
					format === "file"
						? pathToFileURL(join(folder, entries.html)).href
						: base + entries[format],
				);
				await page.waitForFunction(
					() =>
						window.__praxitySelfCheckSession &&
						document.querySelectorAll("[data-self-check-comparison]").length === 2,
				);
				await page.evaluate(() => {
					const values = new Map<string, unknown>();
					window.__praxityBlockState = {
						get: (id) => values.get(id) as never,
						set: (id, value) => {
							values.set(id, structuredClone(value));
						},
						getPolicy: () => "lms",
						getSaveResult: () => ({ status: "saved", destination: "lms" }),
					};
				});
				const root = page.locator("[data-self-check]").first();
				await root.locator("textarea").fill("Answer A");
				await root.locator('[data-self-check-action="check"]').click();
				await root.locator("[data-self-check-parts] input").first().waitFor({ state: "visible" });
				const result = await page.evaluate(
					async ({ boundary, action }) => {
						const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
						const [a, b] = roots.map((root) => root.dataset.selfCheckId ?? "");
						const runtime = window.__praxitySelfCheckSession;
						const api = (
							window as Window & {
								PraxitySelfCheckIsland?: typeof import("../../template/src/islands/island-self-check");
							}
						).PraxitySelfCheckIsland;
						if (!runtime || !api) throw new Error("Missing owner");
						const provider = runtime.provider;
						if (!provider) throw new Error("Missing provider");
						const events: string[] = [],
							summaries: string[] = [],
							writes: unknown[] = [];
						let fired = false;
						let successorWrites = 0;
						let successor: Promise<unknown> | undefined;
						const interrupt = () => {
							if (fired) return;
							fired = true;
							if (action === "dispose") api.disposeSelfCheckDocument();
							else if (action === "replace")
								window.__praxityBlockState = {
									get: () => undefined,
									set: () => {
										++successorWrites;
									},
									getPolicy: () => "lms",
								};
							else
								successor = runtime.session.dispatch(
									action === "edit"
										? { type: "edit", blockId: a, answer: "Successor draft" }
										: { type: action === "reset" ? "start-over" : "retry", blockId: a },
								);
						};
						const originalSet = provider.set;
						provider.set = (id, value) => {
							writes.push(structuredClone(value));
							originalSet(id, value);
							if (boundary === "write") interrupt();
						};
						const originalPolicy = provider.getPolicy;
						provider.getPolicy = (id) => {
							if (boundary === "policy") interrupt();
							return originalPolicy?.(id) ?? "lms";
						};
						const originalSave = provider.getSaveResult;
						provider.getSaveResult = (id) => {
							if (boundary === "save") interrupt();
							return originalSave?.(id);
						};
						const status = roots[0].querySelector("[data-self-check-status]");
						const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
						if (!descriptor?.set) throw new Error("Missing DOM setter");
						Object.defineProperty(status, "textContent", {
							get() {
								return descriptor.get?.call(this);
							},
							set(value) {
								if (value) summaries.push(value);
								descriptor.set?.call(this, value);
							},
							configurable: true,
						});
						for (const [name, code] of [
							["praxity:self-check-completion", "C"],
							["praxity:block-interaction", "I"],
							["praxity:assessment-response", "R"],
							["praxity:assessment-response-truncated", "T"],
						]) {
							document.addEventListener(name, (event) => {
								const detail = (event as CustomEvent).detail;
								events.push(
									`${code}:${detail.blockId === a ? "A" : "B"}${code === "C" ? `:${detail.completed}` : ""}`,
								);
								if (
									(boundary === "completion" &&
										code === "C" &&
										detail.blockId === a &&
										detail.completed) ||
									(boundary === "interaction" && code === "I") ||
									(boundary === "response" && code === "R") ||
									(boundary === "truncation" && code === "T")
								)
									interrupt();
								if (boundary === "truncation" && code === "R")
									document.dispatchEvent(
										new CustomEvent("praxity:assessment-response-truncated", {
											detail: { blockId: a, responseLimit: 255 },
										}),
									);
							});
						}
						roots[0]
							.querySelector<HTMLButtonElement>('[data-self-check-action="show-feedback"]')
							?.click();
						await successor;
						const current = window.__praxitySelfCheckSession;
						if (current) await current.session.ready;
						return {
							fired,
							events,
							summaries,
							writes,
							successorWrites,
							saved: provider.get(a),
							old: runtime.session.read(a),
							current: current?.session.read(a),
							attributes: roots.map(
								(root) => root.closest<HTMLElement>("[data-block-id]")?.dataset.completed ?? null,
							),
							controls: roots.map(
								(root) => root.querySelectorAll('[data-self-check-action="retry"]').length,
							),
							draft: current?.results.get(a)?.state?.draft,
							submission: current?.results.get(a)?.state?.submitted,
							revision: roots[0].dataset.selfCheckRevision,
							b: current?.session.read(b),
						};
					},
					{ boundary, action },
				);
				expect(result.fired).toBe(true);
				expect(result.summaries).toEqual(action === "reset" ? ["Answer cleared."] : []);
				expect(result.successorWrites).toBe(0);
				const late = boundary === "response" || boundary === "truncation";
				const projected = !["write", "policy", "save"].includes(boundary);
				const expected = projected ? ["C:A:true"] : [];
				if (["interaction", "response", "truncation"].includes(boundary)) expected.push("I:A");
				if (late) expected.push("R:A");
				if (boundary === "truncation") expected.push("T:A");
				if (action === "dispose" || action === "replace") expected.push("C:A:false", "C:B:false");
				if (action === "replace") expected.push("C:A:false", "C:B:false");
				if (action === "reset") expected.push("C:A:false");
				if (action === "retry") expected.push("C:A:true");
				if (action === "edit" && !projected) expected.push("C:A:true");
				expect(result.events).toEqual(expected);
				expect(result.attributes).toEqual(
					action === "edit" || action === "retry" ? ["true", null] : [null, null],
				);
				expect(result.controls).toEqual(action === "dispose" ? [0, 0] : [1, 1]);
				const submitted = {
					answer: "Answer A",
					ticked: [],
					shown: true,
					contentRevision: result.revision,
				};
				const first = {
					version: 1,
					kind: "self-check",
					draft: { answer: "Answer A", ticked: [], shown: false },
					submitted,
				};
				const final =
					action === "reset"
						? {
								version: 1,
								kind: "self-check",
								draft: { answer: "", ticked: [], shown: false },
								submitted: null,
							}
						: action === "edit"
							? { ...first, draft: { answer: "Successor draft", ticked: [], shown: false } }
							: first;
				expect(result.writes).toEqual(
					action === "reset" || action === "edit" ? [first, final] : [first],
				);
				expect(result.saved).toEqual(final);
			});
		}
	}
}

for (const action of actions) {
	test(`restored siblings ${action} at A completion project together and stop the old B event`, async ({
		page,
	}) => {
		await page.goto(base + entries.html);
		await page.waitForFunction(
			() =>
				window.__praxitySelfCheckSession &&
				document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		const result = await page.evaluate(async (action) => {
			const api = (
				window as Window & {
					PraxitySelfCheckIsland?: typeof import("../../template/src/islands/island-self-check");
				}
			).PraxitySelfCheckIsland;
			if (!api) throw new Error("Missing implementation");
			const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
			const ids = roots.map((root) => root.dataset.selfCheckId ?? "");
			const saved = roots.map((root, i) => ({
				version: 1 as const,
				kind: "self-check" as const,
				draft: { answer: `Saved ${i}`, ticked: [], shown: false },
				submitted: {
					answer: `Saved ${i}`,
					ticked: [],
					shown: true,
					contentRevision: root.dataset.selfCheckRevision ?? "",
				},
			}));
			let armed = false,
				fired = false,
				successor: Promise<unknown> | undefined;
			const events: string[] = [],
				firstAttributes: unknown[] = [],
				writes: unknown[] = [];
			document.addEventListener("praxity:self-check-completion", (event) => {
				if (!armed) return;
				const detail = (event as CustomEvent).detail;
				events.push(`${detail.blockId === ids[0] ? "A" : "B"}:${detail.completed}`);
				if (fired || !detail.completed || detail.blockId !== ids[0]) return;
				fired = true;
				firstAttributes.push(
					...roots.map((root) => root.closest<HTMLElement>("[data-block-id]")?.dataset.completed),
				);
				const current = window.__praxitySelfCheckSession;
				if (action === "dispose") api.disposeSelfCheckDocument();
				else if (action === "replace")
					window.__praxityBlockState = {
						get: () => undefined,
						set: (id, value) => {
							writes.push({ id, value });
						},
					};
				else
					successor = current?.session.dispatch(
						action === "edit"
							? { type: "edit", blockId: ids[0], answer: "New draft" }
							: { type: action === "reset" ? "start-over" : "retry", blockId: ids[0] },
					);
			});
			window.__praxityBlockState = {
				get: (id) => saved[ids.indexOf(id)] as never,
				set: (id, value) => {
					writes.push(structuredClone(value));
					saved[ids.indexOf(id)] = value as never;
				},
			};
			const pending = window.__praxitySelfCheckSession;
			armed = true;
			await pending?.session.ready;
			await successor;
			await window.__praxitySelfCheckSession?.session.ready;
			return {
				events,
				firstAttributes,
				writes,
				attributes: roots.map(
					(root) => root.closest<HTMLElement>("[data-block-id]")?.dataset.completed ?? null,
				),
			};
		}, action);
		expect(result.firstAttributes).toEqual(["true", "true"]);
		expect(result.events).toEqual(
			action === "dispose"
				? ["A:true", "A:false", "B:false"]
				: action === "replace"
					? ["A:true", "A:false", "B:false", "A:false", "B:false"]
					: action === "reset"
						? ["A:true", "A:false", "B:true"]
						: action === "retry"
							? ["A:true", "A:true", "B:true"]
							: ["A:true", "B:true"],
		);
		expect(result.attributes).toEqual(
			action === "dispose" || action === "replace"
				? [null, null]
				: action === "reset"
					? [null, "true"]
					: ["true", "true"],
		);
		expect(result.writes).toHaveLength(action === "reset" || action === "edit" ? 1 : 0);
	});
}

for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	for (const reset of [false, true])
		test(`${format} retains every queued activity draft, reset=${reset}`, async ({ page }) => {
			await page.goto(
				format === "file" ? pathToFileURL(join(folder, entries.html)).href : base + entries[format],
			);
			await page.waitForFunction(
				() =>
					window.__praxitySelfCheckSession &&
					document.querySelectorAll("[data-self-check-comparison]").length === 2,
			);
			const result = await page.evaluate(async (reset) => {
				const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
				const ids = roots.map((r) => r.dataset.selfCheckId ?? "");
				const values = new Map<string, unknown>(),
					writes: unknown[] = [],
					events: string[] = [],
					responses: unknown[] = [];
				let armed = false;
				window.__praxityBlockState = {
					get: (id) => values.get(id) as never,
					set(id, value) {
						writes.push([ids.indexOf(id), structuredClone(value)]);
						if (armed) {
							armed = false;
							void window.__praxitySelfCheckSession?.session.dispatch(
								reset
									? { type: "start-over", blockId: ids[0] }
									: { type: "edit", blockId: ids[0], answer: "Second A" },
							);
							void window.__praxitySelfCheckSession?.session.dispatch({
								type: "edit",
								blockId: ids[1],
								answer: "Second B",
							});
						}
						values.set(id, structuredClone(value));
					},
					getPolicy: () => "lms",
					getSaveResult: () => ({ status: "saved", destination: "lms" }),
				};
				const runtime = window.__praxitySelfCheckSession;
				if (!runtime) throw new Error("Missing runtime");
				await runtime.session.ready;
				document.addEventListener("praxity:self-check-completion", (event) => {
					const d = (event as CustomEvent).detail;
					events.push(`${ids.indexOf(d.blockId)}:${d.completed}`);
				});
				document.addEventListener("praxity:assessment-response", (event) =>
					responses.push((event as CustomEvent).detail),
				);
				armed = true;
				await runtime.session.dispatch({ type: "edit", blockId: ids[0], answer: "First A" });
				return {
					stored: ids.map((id) => values.get(id)),
					projected: ids.map((id) => runtime.results.get(id)?.state),
					answers: roots.map((r) => r.querySelector("textarea")?.value),
					writes,
					events,
					responses,
					statuses: roots.map((r) => r.querySelector("[data-self-check-status]")?.textContent),
					controls: roots.map((r) => r.querySelectorAll('[data-self-check-action="retry"]').length),
					captured: runtime.provider === window.__praxityBlockState,
				};
			}, reset);
			const a = {
				version: 1,
				kind: "self-check",
				draft: { answer: reset ? "" : "Second A", ticked: [], shown: false },
				submitted: null,
			};
			const b = {
				version: 1,
				kind: "self-check",
				draft: { answer: "Second B", ticked: [], shown: false },
				submitted: null,
			};
			expect(result).toEqual({
				stored: [a, b],
				projected: [a, b],
				answers: [reset ? "" : "Second A", "Second B"],
				writes: [
					[
						0,
						{
							version: 1,
							kind: "self-check",
							draft: { answer: "First A", ticked: [], shown: false },
							submitted: null,
						},
					],
					[0, a],
					[1, b],
				],
				events: reset ? ["0:false"] : [],
				responses: [],
				statuses: ["", ""],
				controls: [1, 1],
				captured: true,
			});
		});
	for (const boundary of ["read", "restore", "read-failure"] as const)
		test(`${format} resumes initialization after edit in ${boundary}`, async ({ page }) => {
			if (boundary === "read-failure")
				await page.addInitScript(() => {
					const append = Element.prototype.append;
					Element.prototype.append = function (...nodes) {
						for (const node of nodes)
							if (node instanceof HTMLScriptElement && /\/self-check\//.test(node.src))
								node.src += ".missing";
						return Reflect.apply(append, this, nodes);
					};
				});
			await page.goto(
				format === "file" ? pathToFileURL(join(folder, entries.html)).href : base + entries[format],
			);
			await page.waitForFunction(
				() =>
					window.__praxitySelfCheckSession &&
					document.querySelectorAll("[data-self-check-comparison]").length === 2,
			);
			const result = await page.evaluate(async (boundary) => {
				const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")],
					ids = roots.map((r) => r.dataset.selfCheckId ?? "");
				const envelope = (answer: string) => ({
					version: 1,
					kind: "self-check",
					draft: { answer, ticked: [], shown: false },
					submitted: null,
				});
				const values = new Map(
						ids.map((id, index) => [id, envelope(index ? "Saved B" : "Saved A")]),
					),
					events: string[] = [],
					responses: unknown[] = [];
				let fired = false;
				const edit = () => {
					if (fired) return;
					fired = true;
					void window.__praxitySelfCheckSession?.session.dispatch({
						type: "edit",
						blockId: ids[0],
						answer: "Edit inside admission",
					});
				};
				if (boundary === "restore") {
					const adapter = await window.__praxitySelfCheckSession?.support();
					if (!adapter) throw new Error("Missing support");
					const wrap = (adapter: typeof window.__praxitySelfCheckSupport) => {
						if (!adapter) throw new Error("Missing support");
						const admit = adapter.admit;
						adapter.admit = async (...args) => {
							const operations = await admit(...args);
							return {
								...operations,
								restore(value) {
									if (args[0].blockId === ids[0]) edit();
									return operations.restore(value);
								},
							};
						};
					};
					wrap(adapter);
					if (document.location.protocol === "file:") {
						let current = window.__praxitySelfCheckSupport;
						Object.defineProperty(window, "__praxitySelfCheckSupport", {
							configurable: true,
							get: () => current,
							set(value) {
								wrap(value);
								current = value;
							},
						});
					}
				}
				const provider = {
					get(id: string) {
						const captured = values.get(id);
						if (boundary !== "restore" && id === ids[0]) edit();
						return captured as never;
					},
					set(id: string, value: unknown) {
						values.set(id, structuredClone(value) as ReturnType<typeof envelope>);
					},
					getPolicy: () => "lms" as const,
					getSaveResult: () => ({ status: "saved" as const, destination: "lms" as const }),
				};
				window.__praxityBlockState = provider;
				const runtime = window.__praxitySelfCheckSession;
				if (!runtime) throw new Error("Missing runtime");
				document.addEventListener("praxity:self-check-completion", (event) => {
					const d = (event as CustomEvent).detail;
					events.push(`${ids.indexOf(d.blockId)}:${d.completed}`);
				});
				document.addEventListener("praxity:assessment-response", (event) =>
					responses.push((event as CustomEvent).detail),
				);
				const ready = await runtime.session.ready;
				return {
					ready: ready.ready,
					views: ids.map((id) => runtime.session.read(id)?.outcome),
					stored: ids.map((id) => values.get(id)),
					projected: ids.map((id) => runtime.results.get(id)?.state),
					answers: roots.map((r) => r.querySelector("textarea")?.value),
					events,
					responses,
					controls: roots.map((r) => r.querySelectorAll('[data-self-check-action="retry"]').length),
					captured: runtime.provider === provider,
				};
			}, boundary);
			const a = {
					version: 1,
					kind: "self-check",
					draft: { answer: "Edit inside admission", ticked: [], shown: false },
					submitted: null,
				},
				b = {
					version: 1,
					kind: "self-check",
					draft: { answer: "Saved B", ticked: [], shown: false },
					submitted: null,
				};
			expect(result).toEqual({
				ready: true,
				views: boundary === "read-failure" ? ["unavailable", "unavailable"] : ["draft", "draft"],
				stored: [a, b],
				projected: boundary === "read-failure" ? [a, undefined] : [a, b],
				answers: ["Edit inside admission", "Saved B"],
				events: ["0:false", "1:false"],
				responses: [],
				controls: [1, 1],
				captured: true,
			});
		});
	for (const failure of ["save", "retry"] as const)
		test(`${format} projects latest native draft after failed ${failure}`, async ({ page }) => {
			if (failure === "retry") {
				if (format === "file")
					await page.addInitScript(() => {
						const append = Element.prototype.append;
						Element.prototype.append = function (...nodes) {
							for (const node of nodes)
								if (node instanceof HTMLScriptElement && /self-check-support/.test(node.src))
									node.src += ".missing";
							return Reflect.apply(append, this, nodes);
						};
					});
				else await page.route(/self-check-support.*\.js/, (route) => route.abort());
			}
			await page.goto(
				format === "file" ? pathToFileURL(join(folder, entries.html)).href : base + entries[format],
			);
			await page.waitForFunction(
				() =>
					window.__praxitySelfCheckSession &&
					document.querySelectorAll("[data-self-check-comparison]").length === 2,
			);
			const result = await page.evaluate(async (failure) => {
				const root = document.querySelector<HTMLElement>("[data-self-check]");
				if (!root) throw new Error("Missing root");
				const id = root.dataset.selfCheckId ?? "",
					values = new Map<string, unknown>();
				let fail = failure === "save";
				window.__praxityBlockState = {
					get: () => undefined,
					set(id, value) {
						if (fail) {
							fail = false;
							throw new Error("Save sentinel");
						}
						values.set(id, structuredClone(value));
					},
					getPolicy: () => "lms",
				};
				const runtime = window.__praxitySelfCheckSession;
				if (!runtime) throw new Error("Missing runtime");
				await runtime.session.ready;
				if (failure === "retry") await runtime.session.dispatch({ type: "retry", blockId: id });
				else await runtime.session.dispatch({ type: "edit", blockId: id, answer: "First" });
				await runtime.session.dispatch({ type: "edit", blockId: id, answer: "Latest" });
				return {
					stored: values.get(id),
					projected: runtime.results.get(id)?.state,
					answer: root.querySelector("textarea")?.value,
					view: runtime.session.read(id),
					complete: root.closest("[data-block-id]")?.hasAttribute("data-completed"),
					status: root.querySelector("[data-self-check-status]")?.textContent,
				};
			}, failure);
			const value = {
				version: 1,
				kind: "self-check",
				draft: { answer: "Latest", ticked: [], shown: false },
				submitted: null,
			};
			expect(result).toMatchObject({
				stored: value,
				projected: value,
				answer: "Latest",
				view: { ready: true, outcome: "unavailable", available: false, completed: false },
				complete: false,
				status: "",
			});
		});
}

for (const interveningEdit of [false, true])
	test(`Check queued inside a write uses its admission receipt, edit=${interveningEdit}`, async ({
		page,
	}) => {
		let release!: () => void, held!: () => void;
		const barrier = new Promise<void>((resolve) => (release = resolve)),
			requested = new Promise<void>((resolve) => (held = resolve));
		await page.route(/self-check-support.*\.js/, async (route) => {
			held();
			await barrier;
			await route.continue();
		});
		await page.goto(base + entries.html);
		await page.waitForFunction(
			() =>
				window.__praxitySelfCheckSession &&
				document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		await page.evaluate((interveningEdit) => {
			const root = document.querySelector<HTMLElement>("[data-self-check]");
			if (!root) throw new Error("Missing root");
			const id = root.dataset.selfCheckId ?? "";
			let armed = true;
			const values = new Map<string, unknown>();
			window.__praxityBlockState = {
				get: () => undefined,
				set(key, value) {
					values.set(key, structuredClone(value));
					if (!armed) return;
					armed = false;
					root.querySelector<HTMLButtonElement>('[data-self-check-action="check"]')?.click();
					if (interveningEdit)
						void window.__praxitySelfCheckSession?.session.dispatch({
							type: "edit",
							blockId: id,
							answer: "Newer answer",
						});
				},
				getPolicy: () => "lms",
			};
			const answer = root.querySelector("textarea");
			if (!answer) throw new Error("Missing answer");
			answer.value = "First answer";
			answer.dispatchEvent(new Event("input", { bubbles: true }));
		}, interveningEdit);
		await requested;
		release();
		const root = page.locator("[data-self-check]").first();
		await page.waitForFunction(() => {
			const id =
				document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
			const state = window.__praxitySelfCheckSession?.session.read(id);
			return state?.admitted && state.outcome === "draft";
		});
		if (interveningEdit) await expect(root.locator("[data-self-check-parts]")).toBeHidden();
		else await expect(root.locator("[data-self-check-parts] input").first()).toBeVisible();
		await expect(root.locator("textarea")).toHaveValue(
			interveningEdit ? "Newer answer" : "First answer",
		);
		await expect(root.locator("[data-self-check-status]")).toBeEmpty();
		await expect(root.locator('[data-self-check-action="retry"]')).toHaveCount(1);
	});

test("throwing session and document subscribers leave sibling projection and report phases intact", async ({
	page,
}) => {
	await page.goto(base + entries.html);
	await page.waitForFunction(
		() =>
			window.__praxitySelfCheckSession &&
			document.querySelectorAll("[data-self-check-comparison]").length === 2,
	);
	const result = await page.evaluate(async () => {
		const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")],
			ids = roots.map((root) => root.dataset.selfCheckId ?? ""),
			errors: string[] = [],
			events: string[] = [],
			responses: unknown[] = [];
		window.addEventListener("error", (event) => {
			errors.push(event.error?.message ?? event.message);
			event.preventDefault();
		});
		window.__praxityBlockState = { get: () => undefined, set() {}, getPolicy: () => "lms" };
		const runtime = window.__praxitySelfCheckSession;
		if (!runtime) throw new Error("Missing runtime");
		await runtime.session.ready;
		let later = 0,
			finished = 0;
		const off1 = runtime.session.subscribe(() => {
			throw new Error("Session sentinel");
		});
		const off2 = runtime.session.subscribe(() => later++);
		const off3 = runtime.subscribe(
			() => {
				throw new Error("Project sentinel");
			},
			() => {
				throw new Error("Finish sentinel");
			},
		);
		const off4 = runtime.subscribe(
			() => {},
			() => finished++,
		);
		document.addEventListener("praxity:self-check-completion", (event) => {
			const detail = (event as CustomEvent).detail;
			events.push(`${ids.indexOf(detail.blockId)}:${detail.completed}`);
		});
		document.addEventListener("praxity:assessment-response", (event) =>
			responses.push((event as CustomEvent).detail),
		);
		await runtime.session.dispatch({ type: "edit", blockId: ids[0], answer: "Answer" });
		await runtime.session.dispatch({ type: "retry", blockId: ids[0] });
		await runtime.session.dispatch({ type: "show-feedback", blockId: ids[0] });
		off1();
		off2();
		off3();
		off4();
		return {
			later,
			finished,
			errors,
			events,
			responses: responses.length,
			view: runtime.session.read(ids[0]),
			completed: roots[0].closest("[data-block-id]")?.getAttribute("data-completed"),
		};
	});
	expect(result).toMatchObject({
		finished: 3,
		events: ["0:false", "0:true"],
		responses: 1,
		view: { ready: true, admitted: true, available: true, completed: true, outcome: "submitted" },
		completed: "true",
	});
	expect(result.later).toBeGreaterThan(3);
	expect(result.errors).toContain("Session sentinel");
	expect(result.errors).toContain("Project sentinel");
	expect(result.errors).toContain("Finish sentinel");
});

for (const mode of ["esm", "file"] as const)
	test(`independent ${mode} document loads support in its owning realm`, async ({
		page,
		browserName,
	}) => {
		test.skip(
			mode === "file" && browserName !== "firefox",
			"Chromium/WebKit deny cross-file document access",
		);
		await page.goto(
			mode === "file" ? pathToFileURL(join(folder, entries.html)).href : base + entries.html,
		);
		await page.waitForFunction(
			() =>
				window.__praxitySelfCheckSession &&
				document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		const result = await page.evaluate(async () => {
			const iframe = document.createElement("iframe"),
				loaded = new Promise<void>((resolve) => (iframe.onload = () => resolve()));
			iframe.src = new URL("foreign.html", document.baseURI).href;
			document.body.append(iframe);
			await loaded;
			const doc = iframe.contentDocument,
				view = iframe.contentWindow;
			if (!doc || !view) throw new Error("Missing independent document");
			view.__praxityBlockState = { get: () => undefined, set() {}, getPolicy: () => "device" };
			const api = (
				window as Window & {
					PraxitySelfCheckIsland?: typeof import("../../template/src/islands/island-self-check");
				}
			).PraxitySelfCheckIsland;
			if (!api) throw new Error("Missing attachment interface");
			api.initSelfCheckEnhancements(doc);
			const runtime = view.__praxitySelfCheckSession,
				root = doc.querySelector<HTMLElement>("[data-self-check]");
			if (!runtime || !root) throw new Error("Missing foreign runtime");
			const id = root.dataset.selfCheckId ?? "";
			await runtime.session.dispatch({ type: "edit", blockId: id, answer: "Foreign draft" });
			await runtime.session.dispatch({ type: "retry", blockId: id });
			return {
				view: runtime.session.read(id),
				support: !!view.__praxitySelfCheckSupport,
				answer: root.querySelector("textarea")?.value,
				controls: root.querySelectorAll('[data-self-check-action="retry"]').length,
				parent: !!window.__praxitySelfCheckSession,
			};
		});
		expect(result).toMatchObject({
			view: { ready: true, admitted: true, available: true, outcome: "draft" },
			answer: "Foreign draft",
			controls: 1,
			parent: true,
		});
		if (mode === "file") expect(result.support).toBe(true);
	});

test("provider replacement during cancellation retains the final provider", async ({ page }) => {
	await page.goto(base + entries.html);
	await page.waitForFunction(
		() =>
			window.__praxitySelfCheckSession &&
			document.querySelectorAll("[data-self-check-comparison]").length === 2,
	);
	const result = await page.evaluate(async () => {
		const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
		const ids = roots.map((root) => root.dataset.selfCheckId ?? "");
		const provider = () => ({ get: () => undefined, set() {}, getPolicy: () => "device" as const });
		window.__praxityBlockState = provider();
		await window.__praxitySelfCheckSession?.session.ready;
		const old = window.__praxitySelfCheckSession;
		const final = provider();
		const events: { blockId: string; completed: boolean }[] = [];
		let replaced = false;
		document.addEventListener("praxity:self-check-completion", (event) => {
			const detail = (event as CustomEvent<{ blockId: string; completed: boolean }>).detail;
			events.push({ ...detail });
			if (!replaced && !detail.completed) {
				replaced = true;
				window.__praxityBlockState = final;
			}
		});
		window.__praxityBlockState = provider();
		await window.__praxitySelfCheckSession?.session.ready;
		return {
			final: window.__praxitySelfCheckSession?.provider === final,
			oldCancelled: ids.map((id) => old?.session.read(id)?.outcome),
			controls: roots.map(
				(root) => root.querySelectorAll('[data-self-check-action="retry"]').length,
			),
			events: events.map((event) => [ids.indexOf(event.blockId), event.completed]),
		};
	});
	expect(result).toEqual({
		final: true,
		oldCancelled: ["cancelled", "cancelled"],
		controls: [1, 1],
		events: [
			[0, false],
			[1, false],
			[0, false],
			[1, false],
		],
	});
});

test("queued reset clears the completed comparison before a sibling edit publishes", async ({
	page,
}) => {
	await page.goto(base + entries.html);
	await page.waitForFunction(
		() =>
			window.__praxitySelfCheckSession &&
			document.querySelectorAll("[data-self-check-comparison]").length === 2,
	);
	await page.evaluate(() => {
		const values = new Map<string, unknown>();
		window.__praxityBlockState = {
			get: (id) => values.get(id) as never,
			set: (id, value) => {
				values.set(id, structuredClone(value));
			},
			getPolicy: () => "lms",
		};
	});
	const roots = page.locator("[data-self-check]"),
		a = roots.first();
	await a.locator("textarea").fill("Old answer");
	await a.locator('[data-self-check-action="check"]').click();
	await a.locator("[data-self-check-parts] input").first().waitFor({ state: "visible" });
	await a.locator('[data-self-check-action="show-feedback"]').click();
	await expect(a.locator("[data-self-check-comparison]")).toContainText("Model A.");
	await roots.nth(1).locator("textarea").focus();
	const result = await page.evaluate(async () => {
		const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")],
			ids = roots.map((root) => root.dataset.selfCheckId ?? ""),
			runtime = window.__praxitySelfCheckSession;
		if (!runtime?.provider) throw new Error("Missing provider");
		const set = runtime.provider.set;
		let armed = true;
		const events: string[] = [],
			responses: unknown[] = [];
		document.addEventListener("praxity:self-check-completion", (event) => {
			const d = (event as CustomEvent).detail;
			events.push(`${ids.indexOf(d.blockId)}:${d.completed}`);
		});
		document.addEventListener("praxity:assessment-response", (event) =>
			responses.push((event as CustomEvent).detail),
		);
		runtime.provider.set = (id, value) => {
			if (armed) {
				armed = false;
				void runtime.session.dispatch({ type: "start-over", blockId: ids[0] });
				void runtime.session.dispatch({ type: "edit", blockId: ids[1], answer: "Second B" });
			}
			set(id, value);
		};
		await runtime.session.dispatch({ type: "edit", blockId: ids[0], answer: "First A" });
		return {
			stored: ids.map((id) => runtime.provider?.get(id)),
			answers: roots.map((root) => root.querySelector("textarea")?.value),
			comparison: roots[0].querySelector("[data-self-check-comparison]")?.textContent,
			hidden: roots[0].querySelector<HTMLElement>("[data-self-check-parts]")?.hidden,
			focus: document.activeElement === roots[1].querySelector("textarea"),
			events,
			responses,
			status: roots[0].querySelector("[data-self-check-status]")?.textContent,
		};
	});
	expect(result).toEqual({
		stored: [
			{
				version: 1,
				kind: "self-check",
				draft: { answer: "", ticked: [], shown: false },
				submitted: null,
			},
			{
				version: 1,
				kind: "self-check",
				draft: { answer: "Second B", ticked: [], shown: false },
				submitted: null,
			},
		],
		answers: ["", "Second B"],
		comparison: "",
		hidden: true,
		focus: true,
		events: ["0:false"],
		responses: [],
		status: "",
	});
});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	for (const scenario of [
		"canonical-failure",
		"support-failure",
		"early-replacement",
		"pagehide-pageshow",
	] as const) {
		test(`initial owner ${format} ${scenario} retains both drafts and fences attachment`, async ({
			page,
		}) => {
			await page.addInitScript(
				({ base, scenario }) => {
					const hostReady = () => {
						const values = new Map<string, unknown>();
						const writes: unknown[] = [];
						const provider = {
							get: (id: string) => values.get(id) as never,
							set: (id: string, value: unknown) => {
								values.set(id, structuredClone(value));
								writes.push([id, structuredClone(value)]);
							},
							getPolicy: () => "device" as const,
							getSaveResult: () => ({ status: "saved" as const, destination: "device" as const }),
						};
						window.__praxityBlockState = provider;
						Object.assign(window, { initialWrites: writes, initialValues: values });
					};
					window.addEventListener("praxity:runtime-ready", hostReady, { once: true });
					const append = Element.prototype.append;
					let failed = false;
					Element.prototype.append = function (...nodes) {
						for (const node of nodes)
							if (node instanceof HTMLScriptElement) {
								if (node.src.includes("self-check-document")) {
									if (scenario === "early-replacement" || scenario === "pagehide-pageshow") {
										Object.assign(window, {
											releaseCanonical: () => Reflect.apply(append, document.head, [node]),
										});
										return;
									}
									if (scenario === "canonical-failure" && !failed) {
										failed = true;
										node.src = `${base}missing-canonical.js`;
									}
								}
								if (
									scenario === "support-failure" &&
									node.src.includes("self-check-support") &&
									!failed
								) {
									failed = true;
									node.src = `${base}missing-support.js`;
								}
							}
						return Reflect.apply(append, this, nodes);
					};
					Object.assign(window, {
						stopHoldingCanonical: () => {
							Element.prototype.append = append;
						},
					});
				},
				{ base, scenario },
			);
			if (scenario === "support-failure" && format !== "file") {
				let failed = false;
				await page.route("**/self-check-support-*.js*", async (route) => {
					if (!failed) {
						failed = true;
						await route.fulfill({ status: 503, body: "" });
					} else await route.continue();
				});
			}
			await page.goto(
				format === "file" ? pathToFileURL(join(folder, entries.html)).href : base + entries[format],
			);
			await page.waitForFunction(() => window.__praxitySelfCheckSession);
			const roots = page.locator("[data-self-check]");
			await roots.nth(0).locator("textarea").fill("Latest A");
			await roots.nth(1).locator("textarea").fill("Latest B");
			if (scenario === "support-failure")
				await roots.nth(0).locator('[data-self-check-action="check"]').click();
			if (scenario.endsWith("failure")) {
				await expect(roots.nth(0).locator('[data-self-check-action="retry"]')).toBeVisible();
				await expect(roots.nth(0).locator("[data-self-check-recovery]")).toHaveText(
					"If this keeps happening, tell whoever runs this course.",
				);
				await roots.nth(0).locator('[data-self-check-action="retry"]').click();
			} else {
				await page.waitForFunction(() => "releaseCanonical" in window);
				await page.evaluate(async (scenario) => {
					const hooks = window as unknown as {
						releaseCanonical(): void;
						stopHoldingCanonical(): void;
						initialWrites: unknown[];
					};
					const events: unknown[] = [];
					document.addEventListener("praxity:self-check-completion", (event) =>
						events.push((event as CustomEvent).detail),
					);
					Object.assign(window, { arrivalEvents: events });
					if (scenario === "early-replacement") {
						const values = new Map<string, unknown>();
						window.__praxityBlockState = {
							get: (id) => values.get(id) as never,
							set: (id, value) => {
								values.set(id, structuredClone(value));
							},
							getPolicy: () => "device",
						};
						Object.assign(window, { successorValues: values });
					} else {
						window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
						Object.assign(window, { writesAtHide: hooks.initialWrites.length });
					}
					hooks.stopHoldingCanonical();
					hooks.releaseCanonical();
				}, scenario);
				if (scenario === "pagehide-pageshow") {
					await page.waitForFunction(() => window.PraxitySelfCheckIsland);
					const stale = await page.evaluate(() => {
						const hooks = window as unknown as {
							initialWrites: unknown[];
							writesAtHide: number;
							arrivalEvents: { completed: boolean }[];
						};
						return {
							writes: hooks.initialWrites.length - hooks.writesAtHide,
							trueEvents: hooks.arrivalEvents.filter((event) => event.completed).length,
							controls: document.querySelectorAll("[data-self-check-comparison]").length,
						};
					});
					expect(stale).toEqual({ writes: 0, trueEvents: 0, controls: 0 });
					await page.evaluate(() =>
						window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
					);
				}
			}
			await expect(roots.nth(0).locator("[data-self-check-comparison]")).toHaveCount(1);
			await expect(roots.nth(1).locator("[data-self-check-comparison]")).toHaveCount(1);
			await expect(roots.nth(0).locator("textarea")).toHaveValue("Latest A");
			await expect(roots.nth(1).locator("textarea")).toHaveValue("Latest B");
			await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
			const drafts = await page.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) => {
					const id = root.dataset.selfCheckId ?? "";
					return window.__praxitySelfCheckSession?.provider?.get(id);
				}),
			);
			expect(drafts).toEqual(
				["Latest A", "Latest B"].map((answer) => ({
					version: 1,
					kind: "self-check",
					draft: { answer, ticked: [], shown: false },
					submitted: null,
				})),
			);
		});
	}
	test(`initial closure ${format} equals every fresh self-check request`, async ({
		page,
	}, testInfo) => {
		const requests: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		await page.addInitScript(() => {
			const urls: string[] = [];
			Object.assign(window, { insertedSelfCheckScripts: urls });
			// Gecko can omit a cached file request from its protocol events; DOM load still records it.
			document.addEventListener(
				"load",
				(event) => {
					if (event.target instanceof HTMLScriptElement && event.target.src)
						urls.push(event.target.src);
				},
				true,
			);
			const append = Element.prototype.append;
			Element.prototype.append = function (...nodes) {
				for (const node of nodes)
					if (node instanceof HTMLScriptElement && node.src) urls.push(node.src);
				return Reflect.apply(append, this, nodes);
			};
		});
		await page.goto(
			format === "file" ? pathToFileURL(join(folder, entries.html)).href : base + entries[format],
		);
		await page.waitForFunction(
			() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		await page.evaluate(async () => {
			await window.__praxitySelfCheckSession?.session.ready;
			await document.fonts.ready;
		});
		const inserted = await page.evaluate(
			() => (window as unknown as { insertedSelfCheckScripts: string[] }).insertedSelfCheckScripts,
		);
		const resources = await page.evaluate(() =>
			performance.getEntriesByType("resource").map((entry) => entry.name),
		);
		const files = [
			...new Set(
				[...requests, ...inserted, ...resources]
					.map((url) => decodeURIComponent(new URL(url).pathname))
					.map((path) =>
						format === "file"
							? path.slice(
									path.toLowerCase().indexOf(folder.replaceAll("\\", "/").toLowerCase()) +
										folder.length +
										1,
								)
							: path.slice(1),
					),
			),
		];
		const cached = await readCachedViewer(VIEWER_CACHE_DIR, await computeViewerSourceHash());
		if (!cached) throw new Error("Missing compiled viewer generation");
		const manifest = cached.manifest;
		const entry = manifest.islands["island-self-check"] as string;
		const expected = (manifest.islandDependencies["island-self-check"] as string[])
			.filter((file) => format !== "file" || file !== entry)
			.sort();
		const otherInitial = new Set<string>([
			...Object.entries(manifest.islandDependencies)
				.filter(([name]) => name !== "island-self-check")
				.flatMap(([, files]) => files as string[]),
			manifest.shell,
			...Object.values(manifest.hosts),
			...Object.values(manifest.privateHosts ?? {}),
			...(Object.values(manifest.hostDependencies ?? {}).flat() as string[]),
			...(manifest.privacy?.files ?? []),
		]);
		const actual = files
			.filter((file) => file.endsWith(".js"))
			.map((file) => file.replace(/^(?:html|scorm12|scorm2004)\//u, ""))
			.filter((file) => expected.includes(file) || !otherInitial.has(file))
			.sort();
		await testInfo.attach("request-ledger", {
			body: JSON.stringify({
				requests,
				inserted,
				resources,
				actual,
				expected,
				scripts: await page
					.locator("script[src]")
					.evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src)),
			}),
			contentType: "application/json",
		});
		expect(actual).toEqual(expected);
		const sizes = await Promise.all(
			files
				.filter((file) => file.endsWith(".js"))
				.map(async (file) => ({ file, bytes: (await readFile(join(folder, file))).byteLength })),
		);
		const selfCheckBytes = sizes
			.filter((row) => actual.includes(row.file.replace(/^(?:html|scorm12|scorm2004)\//u, "")))
			.reduce((sum, row) => sum + row.bytes, 0);
		const packaged = await Promise.all(
			(manifest.islandDependencies["island-self-check"] as string[]).map((file) =>
				readFile(join(folder, format === "file" ? "html" : format, file)),
			),
		);
		const packagedBytes = packaged.reduce((sum, bytes) => sum + bytes.byteLength, 0);
		await testInfo.attach("startup-bytes", {
			body: JSON.stringify({
				requests: sizes,
				packagedBytes,
				selfCheckBytes,
				fullPageBytes: requests.length ? sizes.reduce((sum, row) => sum + row.bytes, 0) : null,
			}),
			contentType: "application/json",
		});
		expect(packagedBytes).toBeLessThan(SELF_CHECK_INITIAL_RAW_CEILING);
	});
}
