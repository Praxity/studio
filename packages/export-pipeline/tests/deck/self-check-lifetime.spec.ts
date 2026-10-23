import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";

type Format = "html" | "scorm12" | "scorm2004" | "file";
type Probe = Window & {
	lifetimeProbe: {
		ready: number;
		islands: number;
		errors: string[];
		release?(): void;
		held?: HTMLScriptElement;
	};
};
let folder: string, base: string, server: Server;
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-lifetime-"));
	const read = readLesson(`# Practice
::: self-check Explain A. {name=first required private=false}
model: Model A.
:: Reason A
missed: Reason A.
:::
::: self-check Explain B. {name=second}
model: Model B.
:: Reason B
missed: Reason B.
:::
::: rating Rate. {name=rating}
1. Low
2. High
:::
# Next
Continue.
`);
	const rating = read.blocks.find((block) => block.type === "rating");
	if (!rating) throw new Error("Missing rating");
	read.pages[0].blocks.push(
		{ id: "observer-target", type: "text", visible: false, data: { text: "Observer target" } },
		{
			id: "observer-rule",
			type: "logic",
			data: {
				conditions: {
					operator: "and",
					rules: [
						{ source: `block:${rating.id}`, field: "ratingScore", comparison: "gte", value: 2 },
					],
				},
				actions: [{ type: "show", target: "observer-target" }],
			},
		},
	);
	const artifact = await compileCourse({
		id: "lifetime",
		title: "Document lifetime",
		sourceLocale: "en",
		navigationStyle: "bottomBar",
		content: read.pages,
		selfCheckContents: read.blocks
			.filter((b) => b.type === "selfCheck")
			.map((b) => selfCheckContentInput(b.id, readSelfCheckContent(read, b.id))),
	});
	try {
		for (const format of ["html", "scorm12", "scorm2004"] as const) {
			new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(join(folder, format));
			const html = await readFile(join(folder, format, "practice.html"), "utf8");
			const late = html.replace(
				/<script[^>]*src="([^"]*island-loader[^"]*)"[^>]*><\/script>/,
				'<script type="application/json" data-held-bootstrap src="$1"></script>',
			);
			if (late === html) throw new Error("Missing compiled bootstrap");
			await writeFile(join(folder, format, "late-bootstrap.html"), late);
		}
	} finally {
		await artifact.dispose();
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
function entry(format: Format) {
	return format === "file"
		? pathToFileURL(join(folder, "html/practice.html")).href
		: `${base}${format}/practice.html`;
}
async function probe(page: Page) {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(() => {
		const state = { ready: 0, islands: 0, errors: [] as string[] };
		Object.assign(window, { lifetimeProbe: state });
		window.addEventListener("praxity:runtime-ready", () => state.ready++);
		window.addEventListener("praxity:islands-ready", () => state.islands++);
	});
	return errors;
}
async function settled(page: Page) {
	await page.waitForFunction(
		() =>
			window.__praxitySelfCheckDocument?.consumers.settled() &&
			window.__praxitySelfCheckSession?.session.startup() === "ready",
	);
}
async function hide(page: Page) {
	await page.evaluate(() =>
		window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
	);
}
async function show(page: Page) {
	await page.evaluate(() =>
		window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
	);
}
async function holdPrivacy(page: Page, format: Format) {
	let release!: () => Promise<void>;
	let reached!: () => void;
	const request = new Promise<void>((resolve) => {
		reached = resolve;
	});
	if (format === "file")
		await page.addInitScript(() => {
			const append = Element.prototype.append;
			Element.prototype.append = function (...nodes) {
				const support = nodes.find(
					(node) => node instanceof HTMLScriptElement && node.src.includes("privacy-support"),
				);
				if (support) {
					const state = (window as unknown as Probe).lifetimeProbe;
					state.held = support as HTMLScriptElement;
					state.release = () => Reflect.apply(append, this, [support]);
					return;
				}
				return Reflect.apply(append, this, nodes);
			};
		});
	else
		await page.route("**/*privacy-support*.js", (route) => {
			release = () => route.continue();
			reached();
		});
	return {
		async reached() {
			if (format === "file")
				await page.waitForFunction(() => !!(window as unknown as Probe).lifetimeProbe.held);
			else await request;
		},
		async release() {
			if (format === "file")
				await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.release?.());
			else await release();
			await page.evaluate(async () => {
				await window.__praxityPrivacyReady;
				await Promise.resolve();
				await Promise.resolve();
			});
		},
	};
}
for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	test(`lifetime ${format} late bootstrap joins admitted host and retains native typing`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.goto(entry(format).replace("practice.html", "late-bootstrap.html"));
		await page.waitForFunction(() => (window as unknown as Probe).lifetimeProbe.ready === 1);
		expect(await page.evaluate(() => !!window.__praxitySelfCheckDocument)).toBe(true);
		expect(await page.evaluate(() => !!window.__praxitySelfCheckSession)).toBe(false);
		await page
			.locator("[data-self-check]")
			.first()
			.locator("textarea")
			.fill("Typed before bootstrap");
		await page.evaluate(
			() =>
				new Promise<void>((resolve, reject) => {
					const held = document.querySelector<HTMLScriptElement>("[data-held-bootstrap]");
					if (!held) throw new Error("Missing held bootstrap");
					const script = document.createElement("script");
					script.src = held.src;
					script.onload = () => resolve();
					script.onerror = () => reject(new Error("Bootstrap load failed"));
					document.head.append(script);
				}),
		);
		await expect(page.locator("[data-self-check-comparison]")).toHaveCount(2);
		await settled(page);
		expect(
			await page.evaluate(() => {
				const id =
					document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
				return window.__praxitySelfCheckSession?.session.draftAnswer(id);
			}),
		).toBe("Typed before bootstrap");
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
		expect(errors).toEqual([]);
	});
	for (const order of ["suspended", "returned"] as const)
		test(`lifetime ${format} actual privacy support released ${order} admits returned page once`, async ({
			page,
		}) => {
			const errors = await probe(page),
				barrier = await holdPrivacy(page, format);
			await page.goto(entry(format), { waitUntil: "domcontentloaded" });
			await barrier.reached();
			expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(0);
			await hide(page);
			if (order === "suspended") {
				await barrier.release();
				expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(0);
			}
			await show(page);
			if (order === "returned") await barrier.release();
			await page.evaluate(async () => {
				await window.__praxityPrivacyReady;
				await Promise.resolve();
			});
			expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
			await settled(page);
			expect(
				await page.evaluate(() => document.documentElement.dataset.praxityLearnerState),
			).toBeUndefined();
			expect(await page.evaluate(() => document.documentElement.dataset.praxityIslandsReady)).toBe(
				"true",
			);
			const root = page.locator("[data-self-check]").first();
			await root.locator("textarea").fill("Returned draft");
			await root.locator('[data-self-check-action="check"]').click();
			await expect(root.locator('input[type="checkbox"]')).toHaveCount(1);
			await root.locator('[data-self-check-action="show-feedback"]').click();
			await expect(root.locator(".praxity-self-check-columns")).toContainText("Model A.");
			await show(page);
			expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
			await expect(root.locator('[data-self-check-action="retry"]')).toHaveCount(1);
			expect(errors).toEqual([]);
		});
	test(`lifetime ${format} fresh startup has an early owner and zero page errors`, async ({
		page,
	}) => {
		const errors = await probe(page),
			barrier = await holdPrivacy(page, format);
		await page.goto(entry(format), { waitUntil: "domcontentloaded" });
		await barrier.reached();
		expect(await page.evaluate(() => !!window.__praxitySelfCheckDocument)).toBe(true);
		expect(
			await page.evaluate(() => window.__praxitySelfCheckDocument?.consumers.forwardReady()),
		).toBe(false);
		await barrier.release();
		await settled(page);
		expect(errors).toEqual([]);
	});
	test(`lifetime ${format} fresh startup reports no unattached-session errors`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.goto(entry(format));
		await page.waitForFunction(
			() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		expect(errors).toEqual([]);
	});
	test(`lifetime ${format} replacement rejects old privacy activation and admits its successor`, async ({
		page,
	}) => {
		const errors = await probe(page),
			barrier = await holdPrivacy(page, format);
		await page.goto(entry(format), { waitUntil: "domcontentloaded" });
		await barrier.reached();
		await page.evaluate(() => {
			const owner = window.__praxitySelfCheckDocument,
				old = owner?.loadTicket();
			window.__praxityBlockState = {
				get: () => undefined,
				set: () => {},
				getPolicy: () => "device",
			};
			Object.assign(window, { oldLifetimeCurrent: old?.() });
		});
		await barrier.release();
		expect(
			await page.evaluate(
				() => (window as unknown as { oldLifetimeCurrent?: boolean }).oldLifetimeCurrent,
			),
		).toBe(false);
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
		await settled(page);
		expect(errors).toEqual([]);
	});
	test(`lifetime ${format} explicit empty and failed-save drafts survive return silently`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.goto(entry(format));
		await settled(page);
		await page.evaluate(() => {
			window.__praxityBlockState = {
				get: () => undefined,
				getPolicy: () => "device",
				set: () => ({ status: "not-saved", code: "storage-unavailable" }),
			};
		});
		await settled(page);
		const roots = page.locator("[data-self-check]");
		await roots.nth(0).locator("textarea").fill("Erase");
		await roots.nth(0).locator("textarea").fill("");
		await roots.nth(1).locator("textarea").fill("Failed save B");
		await roots.nth(1).locator("textarea").focus();
		await page.evaluate(() => {
			const events: unknown[] = [];
			document.addEventListener("praxity:assessment-response", (event) =>
				events.push((event as CustomEvent).detail),
			);
			Object.assign(window, { lifetimeResponses: events });
		});
		await hide(page);
		await show(page);
		await settled(page);
		await expect(roots.nth(0).locator("textarea")).toHaveValue("");
		await expect(roots.nth(1).locator("textarea")).toHaveValue("Failed save B");
		await expect(roots.nth(1).locator("textarea")).toBeFocused();
		expect(
			await page.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
					window.__praxitySelfCheckSession?.session.draftAnswer(root.dataset.selfCheckId ?? ""),
				),
			),
		).toEqual(["", "Failed save B"]);
		expect(
			await page.evaluate(
				() => (window as unknown as { lifetimeResponses: unknown[] }).lifetimeResponses,
			),
		).toEqual([]);
		await expect(roots.nth(0).locator('[data-self-check-action="retry"]')).toHaveCount(1);
		await expect(roots.nth(1).locator('[data-self-check-action="retry"]')).toHaveCount(1);
		expect(errors).toEqual([]);
	});
	test(`lifetime ${format} provider replacement and same-provider reset restore ordinary rating`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.goto(entry(format));
		await settled(page);
		await page.evaluate(() => {
			const rating =
				document.querySelector<HTMLElement>('[data-island="rating"]')?.dataset.blockId ?? "";
			const values = new Map([[rating, { value: 2 }]]);
			window.__praxityBlockState = {
				get: (id) => values.get(id),
				set: () => {},
				getPolicy: () => "device",
			};
			Object.assign(window, {
				resetRating: () => {
					values.set(rating, { value: 1 });
					window.__praxitySelfCheckDocument?.reset();
				},
			});
		});
		await settled(page);
		await expect(page.locator('[data-island="rating"] input[value="2"]')).toBeChecked();
		await page.evaluate(() => (window as unknown as { resetRating(): void }).resetRating());
		await settled(page);
		await expect(page.locator('[data-island="rating"] input[value="1"]')).toBeChecked();
		await expect(page.locator('[data-island="rating"] input[value="2"]')).not.toBeChecked();
		expect(errors).toEqual([]);
	});
}

for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	test(`lifetime ${format} held DOM callback cannot replace the returned admission`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.addInitScript(() => {
			const add = document.addEventListener.bind(document);
			const callbacks: EventListener[] = [];
			let waiting = true;
			Object.defineProperty(document, "readyState", {
				configurable: true,
				get: () => (waiting ? "loading" : "complete"),
			});
			Object.assign(window, {
				domParsed: () => {
					waiting = false;
				},
			});
			document.addEventListener = ((
				name: string,
				callback: EventListener,
				options?: AddEventListenerOptions | boolean,
			) => {
				if (name === "DOMContentLoaded") {
					callbacks.push(callback);
					return;
				}
				add(name, callback, options);
			}) as typeof document.addEventListener;
			Object.assign(window, { heldDom: callbacks });
		});
		await page.goto(entry(format), { waitUntil: "domcontentloaded" });
		await page.waitForFunction(
			() => (window as unknown as { heldDom: EventListener[] }).heldDom.length > 0,
		);
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(0);
		await hide(page);
		await page.evaluate(() => (window as unknown as { domParsed(): void }).domParsed());
		await show(page);
		await page.evaluate(async () => {
			await window.__praxityPrivacyReady;
			await Promise.resolve();
		});
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
		await settled(page);
		await page.evaluate(() => {
			for (const callback of (window as unknown as { heldDom: EventListener[] }).heldDom)
				callback(new Event("DOMContentLoaded"));
		});
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
		expect(errors).toEqual([]);
	});
	test(`lifetime ${format} hide inside the initial provider assignment rearms admission`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.addInitScript(() => {
			let provider: Window["__praxityBlockState"],
				interrupted = false;
			Object.defineProperty(window, "__praxityBlockState", {
				configurable: true,
				get: () => provider,
				set: (value) => {
					if (!interrupted) {
						interrupted = true;
						window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
					}
					provider = value;
				},
			});
		});
		await page.goto(entry(format), { waitUntil: "domcontentloaded" });
		await page.evaluate(async () => {
			await window.__praxityPrivacyReady;
			await Promise.resolve();
		});
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(0);
		await show(page);
		await page.evaluate(async () => {
			await window.__praxityPrivacyReady;
			await Promise.resolve();
		});
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
		await settled(page);
		expect(errors).toEqual([]);
	});
	for (const boundary of ["return", "provider", "build"] as const)
		for (const outcome of ["success", "error"] as const)
			test(`lifetime ${format} obsolete canonical ${outcome} after ${boundary} preserves successor`, async ({
				page,
			}) => {
				const errors = await probe(page);
				await page.addInitScript(() => {
					const append = Element.prototype.append;
					let held = false;
					Object.assign(window, { canonicalInsertions: 0 });
					Element.prototype.append = function (...nodes) {
						const script = nodes.find(
							(node) =>
								node instanceof HTMLScriptElement && node.src.includes("self-check-document"),
						) as HTMLScriptElement | undefined;
						if (script)
							(window as unknown as { canonicalInsertions: number }).canonicalInsertions++;
						if (script && !held) {
							held = true;
							const success = script.onload,
								failure = script.onerror;
							Object.assign(window, {
								obsoleteCanonical: {
									success: () => success?.call(script, new Event("load")),
									error: () => {
										if (typeof failure === "function") failure.call(script, new Event("error"));
									},
								},
							});
							return;
						}
						return Reflect.apply(append, this, nodes);
					};
				});
				await page.goto(entry(format), { waitUntil: "domcontentloaded" });
				await page.waitForFunction(
					() => "obsoleteCanonical" in window && window.__praxitySelfCheckSession,
				);
				await page.locator("[data-self-check]").nth(0).locator("textarea").fill("Successor A");
				await page.locator("[data-self-check]").nth(1).locator("textarea").fill("Successor B");
				if (boundary === "return") {
					await hide(page);
					await show(page);
				} else if (boundary === "provider")
					await page.evaluate(() => {
						window.__praxityBlockState = {
							get: () => undefined,
							set: () => {},
							getPolicy: () => "device",
						};
					});
				else
					await page.evaluate(() => {
						const owner = window.__praxitySelfCheckDocument;
						if (owner) owner.build = "previous-build";
						window.__praxitySelfCheckCore.selfCheckRuntime(document);
					});
				await page.evaluate(
					() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
				);
				expect(
					await page.evaluate(
						() => (window as unknown as { canonicalInsertions: number }).canonicalInsertions,
					),
				).toBe(2);
				await settled(page);
				const before = await page.evaluate(() => ({
					drafts: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map(
						(root) => root.querySelector("textarea")?.value,
					),
					completed: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map(
						(root) => root.closest<HTMLElement>("[data-block-id]")?.dataset.completed ?? null,
					),
					controls: document.querySelectorAll('[data-self-check-action="retry"]').length,
					ready: (window as unknown as Probe).lifetimeProbe.ready,
					focused: document.activeElement?.id,
				}));
				await page.evaluate(
					(outcome) =>
						(
							window as unknown as { obsoleteCanonical: Record<string, () => void> }
						).obsoleteCanonical[outcome](),
					outcome,
				);
				await page.evaluate(() => Promise.resolve());
				const after = await page.evaluate(() => ({
					drafts: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map(
						(root) => root.querySelector("textarea")?.value,
					),
					completed: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map(
						(root) => root.closest<HTMLElement>("[data-block-id]")?.dataset.completed ?? null,
					),
					controls: document.querySelectorAll('[data-self-check-action="retry"]').length,
					ready: (window as unknown as Probe).lifetimeProbe.ready,
					focused: document.activeElement?.id,
				}));
				expect(before.drafts).toEqual(["Successor A", "Successor B"]);
				expect(before.controls).toBe(2);
				expect(after).toEqual(before);
				expect(errors).toEqual([]);
			});
}
for (const format of ["scorm12", "scorm2004"] as const)
	test(`lifetime ${format} forced obsolete API polling has zero effects`, async ({ page }) => {
		const errors = await probe(page);
		await page.addInitScript(() => {
			Object.defineProperty(window, "opener", { configurable: true, value: {} });
			const set = window.setInterval;
			const callbacks: (() => void)[] = [];
			window.setInterval = ((callback: () => void, delay: number) => {
				if (delay === 200) {
					callbacks.push(callback);
					return callbacks.length;
				}
				return set(callback, delay);
			}) as typeof set;
			Object.assign(window, { discoveryCallbacks: callbacks });
		});
		await page.goto(entry(format), { waitUntil: "domcontentloaded" });
		await page.waitForFunction(
			() =>
				(window as unknown as { discoveryCallbacks: unknown[] }).discoveryCallbacks.length === 1,
		);
		await hide(page);
		await show(page);
		expect(
			await page.evaluate(
				() => (window as unknown as { discoveryCallbacks: unknown[] }).discoveryCallbacks.length,
			),
		).toBe(2);
		await page.evaluate(() => {
			const callbacks = (window as unknown as { discoveryCallbacks: (() => void)[] })
				.discoveryCallbacks;
			for (let i = 0; i < 5; i++) callbacks[0]();
		});
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(0);
		expect(await page.evaluate(() => !!window.__praxityBlockState)).toBe(false);
		await page.evaluate(() => {
			const callbacks = (window as unknown as { discoveryCallbacks: (() => void)[] })
				.discoveryCallbacks;
			for (let i = 0; i < 5; i++) callbacks[1]();
		});
		await settled(page);
		expect(await page.evaluate(() => (window as unknown as Probe).lifetimeProbe.ready)).toBe(1);
		expect(errors).toEqual([]);
	});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const boundary of ["provider", "return"] as const)
		test(`lifetime ${format} retained MutationObserver after ${boundary} cannot reveal successor content`, async ({
			page,
		}) => {
			const errors = await probe(page);
			await page.addInitScript(() => {
				const Native = MutationObserver;
				const callbacks: (() => void)[] = [];
				class Recorded extends Native {
					constructor(private callback: MutationCallback) {
						super(callback);
					}
					override observe(target: Node, options?: MutationObserverInit) {
						if (options?.attributeFilter?.includes("data-hydrated"))
							callbacks.push(() => this.callback([], this));
						super.observe(target, options);
					}
				}
				Object.assign(window, { MutationObserver: Recorded, hydrationCallbacks: callbacks });
			});
			await page.goto(entry(format));
			await settled(page);
			await page.evaluate(() => {
				const callbacks = (window as unknown as { hydrationCallbacks: (() => void)[] })
					.hydrationCallbacks;
				Object.assign(window, { obsoleteHydration: callbacks[0] });
			});
			if (boundary === "return") {
				await hide(page);
				await show(page);
			} else
				await page.evaluate(() => {
					window.__praxityBlockState = {
						get: () => undefined,
						set: () => {},
						getPolicy: () => "device",
					};
				});
			await settled(page);
			// Complete current hydration frames before forcing the retained observer delivery.
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
					),
			);
			await page.locator("[data-self-check]").first().locator("textarea").fill("Successor draft");
			await page.locator("[data-self-check]").first().locator("textarea").focus();
			await page.evaluate(() => {
				const rating = document.querySelector<HTMLElement>('[data-island="rating"]');
				if (rating) rating.dataset.ratingValue = "2";
			});
			expect(
				await page
					.locator('[data-block-id="observer-target"]')
					.evaluate((element: HTMLElement) => element.hidden),
			).toBe(true);
			const before = await page.evaluate(() => ({
				focus: document.activeElement?.id,
				draft: document.querySelector("textarea")?.value,
				controls: document.querySelectorAll('[data-self-check-action="retry"]').length,
				gate: document.querySelector("[data-continue-button]")?.getAttribute("aria-disabled"),
				completed: document
					.querySelector('[data-block-type="selfCheck"]')
					?.getAttribute("data-completed"),
			}));
			await page.evaluate(() =>
				(window as unknown as { obsoleteHydration(): void }).obsoleteHydration(),
			);
			expect(
				await page
					.locator('[data-block-id="observer-target"]')
					.evaluate((element: HTMLElement) => element.hidden),
			).toBe(true);
			expect(
				await page.evaluate(() => ({
					focus: document.activeElement?.id,
					draft: document.querySelector("textarea")?.value,
					controls: document.querySelectorAll('[data-self-check-action="retry"]').length,
					gate: document.querySelector("[data-continue-button]")?.getAttribute("aria-disabled"),
					completed: document
						.querySelector('[data-block-type="selfCheck"]')
						?.getAttribute("data-completed"),
				})),
			).toEqual(before);
			await page.evaluate(() =>
				(window as unknown as { hydrationCallbacks: (() => void)[] }).hydrationCallbacks.at(-1)?.(),
			);
			expect(
				await page
					.locator('[data-block-id="observer-target"]')
					.evaluate((element: HTMLElement) => element.hidden),
			).toBe(false);
			expect(errors).toEqual([]);
		});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	test(`lifetime ${format} returned comparison retains criterion focus without a new summary`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.goto(entry(format));
		await settled(page);
		const root = page.locator("[data-self-check]").first();
		await root.locator("textarea").fill("Compared answer");
		await root.locator('[data-self-check-action="check"]').click();
		await expect(root.locator('input[type="checkbox"]')).toHaveCount(1);
		await root.locator('[data-self-check-action="show-feedback"]').click();
		await root.locator('input[type="checkbox"]').focus();
		expect(await root.locator("[data-self-check-status]").textContent()).not.toBe("");
		await hide(page);
		await expect(root.locator("[data-self-check-comparison]")).toContainText("Model A.");
		await show(page);
		await settled(page);
		await expect(root.locator('input[type="checkbox"]')).toBeFocused();
		await expect(root.locator("[data-self-check-comparison]")).toContainText("Model A.");
		expect(await root.locator("[data-self-check-status]").textContent()).toBe("");
		expect(errors).toEqual([]);
	});

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	test(`lifetime ${format} reentrant build replacement restores the provider descriptor before rebinding`, async ({
		page,
	}) => {
		const errors = await probe(page);
		await page.goto(entry(format));
		await settled(page);
		const root = page.locator("[data-self-check]").first();
		await root.locator("textarea").fill("First build");
		await root.locator('[data-self-check-action="check"]').click();
		await expect(root.locator('input[type="checkbox"]')).toHaveCount(1);
		await page.evaluate(() => {
			let replaced = false;
			document.addEventListener("praxity:self-check-completion", (event) => {
				if (replaced || !(event as CustomEvent).detail.completed) return;
				replaced = true;
				const owner = window.__praxitySelfCheckDocument;
				if (owner) owner.build = "retired-build";
				window.__praxitySelfCheckCore.selfCheckRuntime(document);
			});
		});
		await root.locator('[data-self-check-action="show-feedback"]').click();

		await settled(page);
		expect(
			await page.evaluate(async () => {
				const provider = {
					get: () => undefined,
					set: () => {},
					getPolicy: () => "device" as const,
				};
				window.__praxityBlockState = provider;
				await window.__praxitySelfCheckSession?.session.ready;
				return (
					window.__praxityBlockState === provider &&
					window.__praxitySelfCheckSession?.provider === provider
				);
			}),
		).toBe(true);
		await settled(page);
		await expect(root.locator('[data-self-check-action="retry"]')).toHaveCount(1);
		expect(errors).toEqual([]);
	});
