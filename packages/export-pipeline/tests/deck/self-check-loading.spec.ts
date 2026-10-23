import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import { analyzeAxe } from "../a11y/helpers";

// Hold the canonical request before insertion in both HTTP and file documents.
async function holdSlice3Canonical(page: Page) {
	await page.addInitScript(() => {
		const append = Element.prototype.append;
		Element.prototype.append = function (...nodes) {
			for (const node of nodes)
				if (node instanceof HTMLScriptElement && node.src.includes("self-check-document")) {
					Object.assign(window, {
						releaseSlice3Canonical: (success = true) => {
							Element.prototype.append = append;
							if (success) Reflect.apply(append, document.head, [node]);
							else node.dispatchEvent(new Event("error"));
						},
					});
					return;
				}
			return Reflect.apply(append, this, nodes);
		};
	});
}

let folder: string, base: string, server: Server;
const entries: Record<string, string> = {};
for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const transition of [
		"canonical failure",
		"provisional replacement",
		"canonical replacement",
		"canonical attachment",
	] as const)
		for (const focus of ["restore", "later focus", "later focus then blur"] as const)
			test(`round 7 ${format} print ${transition} preserves ${focus} on the owning activity`, async ({
				page,
			}, info) => {
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await holdSlice3Canonical(page);
				await page.goto(
					format === "file"
						? pathToFileURL(join(folder, entries["html-en"])).href
						: base + entries[`${format}-en`],
					{ waitUntil: "domcontentloaded" },
				);
				await page.waitForFunction(
					() => "releaseSlice3Canonical" in window && window.__praxitySelfCheckSession,
				);
				const roots = page.locator("[data-self-check]");
				const root = roots.nth(1);
				await roots.nth(0).locator("textarea").fill("Print edge A");
				await root.locator("textarea").fill("Print edge B\n<script>literal</script> & final");
				if (transition === "provisional replacement" || transition === "canonical replacement") {
					await page.evaluate((canonical) => {
						(
							window as unknown as { releaseSlice3Canonical(success: boolean): void }
						).releaseSlice3Canonical(canonical);
					}, transition === "canonical replacement");
					if (transition === "canonical replacement") {
						await page.waitForFunction(
							() => window.__praxitySelfCheckSession?.session.startup() === "ready",
						);
						await page.evaluate(() => {
							window.__praxityBlockState = {
								get: () => {
									throw new Error("probe read failure");
								},
								set: () => {},
								getPolicy: () => "device",
							};
						});
					}
					await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
					await expect(root.locator('[data-self-check-action="retry"]')).toBeVisible();
				}
				await root
					.locator(
						transition === "canonical attachment"
							? "textarea"
							: `[data-self-check-action="${transition === "canonical failure" ? "check" : "retry"}"]`,
					)
					.focus();
				await page.evaluate(() => {
					const other = document.createElement("button");
					other.id = "round-seven-other-control";
					other.textContent = "Another control";
					document.body.append(other);
				});
				await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
				await page.emulateMedia({ media: "print" });
				// Firefox refuses focus changes in print media; choose focus before afterprint on screen.
				if (focus !== "restore") await page.emulateMedia({ media: "screen" });
				await page.evaluate(
					({ transition, focus }) => {
						(document.activeElement as HTMLElement).blur();
						if (focus !== "restore") {
							const other = document.getElementById("round-seven-other-control");
							other?.focus();
							if (document.activeElement !== other) throw new Error("User focus did not change");
							if (focus === "later focus then blur") other?.blur();
						}
						if (transition === "canonical failure" || transition === "canonical attachment")
							(
								window as unknown as { releaseSlice3Canonical(success: boolean): void }
							).releaseSlice3Canonical(transition === "canonical attachment");
						else
							window.__praxityBlockState = {
								get: () => {
									if (transition === "canonical replacement")
										throw new Error("probe successor read failure");
									return undefined;
								},
								set: () => {},
								getPolicy: () => "device",
							};
					},
					{ transition, focus },
				);
				await page.waitForFunction(
					() => window.__praxitySelfCheckSession?.session.startup() !== "pending",
				);
				await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
				const output = await page.locator("[data-self-check-print-answer]").allTextContents();
				expect(output).toEqual(["Print edge A", "Print edge B\n<script>literal</script> & final"]);
				await page.emulateMedia({ media: "screen" });
				await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
				if (focus === "restore") {
					const target = root.locator(
						transition === "canonical attachment" ? "textarea" : '[data-self-check-action="retry"]',
					);
					expect(await target.evaluate((node) => node === document.activeElement)).toBe(true);
					await expect(target).toBeVisible();
				} else if (focus === "later focus")
					expect(
						await page
							.locator("#round-seven-other-control")
							.evaluate((node) => node === document.activeElement),
					).toBe(true);
				else expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
				expect(await page.locator("[data-self-check-print-answer]").allTextContents()).toEqual([
					"",
					"",
				]);
				expect(errors).toEqual([]);
				await info.attach("print-recovery", {
					body: JSON.stringify({
						transition,
						focus,
						output,
						focusAfter: await page.evaluate(() => ({
							tag: document.activeElement?.tagName,
							action: document.activeElement?.getAttribute("data-self-check-action"),
							activity:
								document.activeElement?.closest<HTMLElement>("[data-self-check]")?.dataset
									.selfCheckId,
						})),
						errors,
					}),
					contentType: "application/json",
				});
			});
for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	test(`slice 3 ${format} readiness waits for both canonical mounts before completion`, async ({
		page,
	}, info) => {
		await page.addInitScript(() => {
			const observations: { mounted: number; oldControls: boolean[] }[] = [];
			let previous: Element[] = [];
			Object.assign(window, {
				readinessMounts: observations,
				rememberPreviousMounts: () => {
					previous = [...document.querySelectorAll("[data-self-check-comparison]")];
					observations.length = 0;
				},
			});
			document.addEventListener("praxity:self-check-completion", () => {
				if (window.__praxitySelfCheckSession?.session.startup() !== "ready") return;
				const controls = [...document.querySelectorAll("[data-self-check-comparison]")];
				observations.push({
					mounted: controls.length,
					oldControls: controls.map((control) => previous.includes(control)),
				});
			});
		});
		await page.goto(
			format === "file"
				? pathToFileURL(join(folder, entries["html-en"])).href
				: base + entries[`${format}-en`],
		);
		await page.waitForFunction(() => window.__praxitySelfCheckSession);
		await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
		const observations = () =>
			page.evaluate(() => (window as unknown as { readinessMounts: unknown[] }).readinessMounts);
		const expected = [
			{ mounted: 2, oldControls: [false, false] },
			{ mounted: 2, oldControls: [false, false] },
		];
		expect(await observations()).toEqual(expected);
		await page.evaluate(() => {
			(window as unknown as { rememberPreviousMounts(): void }).rememberPreviousMounts();
			window.__praxityBlockState = {
				get: () => undefined,
				set: () => {},
				getPolicy: () => "device",
			};
		});
		await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
		expect(await observations()).toEqual(expected);
		await info.attach("readiness-mounts", {
			body: JSON.stringify(await observations()),
			contentType: "application/json",
		});
	});
	test(`slice 3 ${format} startup readiness fails closed and recovers through Retry`, async ({
		page,
	}, info) => {
		await holdSlice3Canonical(page);
		await page.goto(
			format === "file"
				? pathToFileURL(join(folder, entries["html-en"])).href
				: base + entries[`${format}-en`],
			{ waitUntil: "domcontentloaded" },
		);
		await page.waitForFunction(
			() => "releaseSlice3Canonical" in window && window.__praxitySelfCheckSession,
		);
		const read = () =>
			page.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
					window.__praxitySelfCheckSession?.session.read(root.dataset.selfCheckId ?? ""),
				),
			);
		expect(await read()).toEqual([
			expect.objectContaining({ ready: false, available: false, completed: false }),
			expect.objectContaining({ ready: false, available: false, completed: false }),
		]);
		await page.evaluate(() =>
			(
				window as unknown as { releaseSlice3Canonical(success: boolean): void }
			).releaseSlice3Canonical(false),
		);
		await expect(page.locator('[data-self-check-action="retry"]').first()).toBeVisible();
		expect(await read()).toEqual([
			expect.objectContaining({
				ready: true,
				startup: "unavailable",
				outcome: "unavailable",
				available: false,
				code: "comparison-unavailable",
			}),
			expect.objectContaining({ startup: "unavailable", available: false }),
		]);
		const roots = page.locator("[data-self-check]");
		await roots.nth(0).locator("textarea").fill("Latest A");
		await roots.nth(1).locator("textarea").fill("Latest B");
		expect((await read()).map((state) => state?.available)).toEqual([false, false]);
		await roots.nth(0).locator('[data-self-check-action="retry"]').click();
		await page.waitForFunction(
			() =>
				document.querySelectorAll("[data-self-check-comparison]").length === 2 &&
				window.__praxitySelfCheckSession?.session.read(
					document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
				)?.ready,
		);
		expect(
			(await read()).map((state) => ({
				startup: state?.startup,
				ready: state?.ready,
				available: state?.available,
				completed: state?.completed,
			})),
		).toEqual([
			{ startup: "ready", ready: true, available: true, completed: false },
			{ startup: "ready", ready: true, available: true, completed: false },
		]);
		await expect(roots.nth(0).locator("textarea")).toHaveValue("Latest A");
		await expect(roots.nth(1).locator("textarea")).toHaveValue("Latest B");
		await info.attach("startup-readiness", {
			body: JSON.stringify(await read()),
			contentType: "application/json",
		});
	});
	for (const focused of ["answer", "retry"] as const)
		test(`slice 3 ${format} print transfers ${focused} focus and literal output during attachment`, async ({
			page,
		}, info) => {
			await holdSlice3Canonical(page);
			await page.goto(
				format === "file"
					? pathToFileURL(join(folder, entries["html-en"])).href
					: base + entries[`${format}-en`],
				{ waitUntil: "domcontentloaded" },
			);
			await page.waitForFunction(
				() => "releaseSlice3Canonical" in window && window.__praxitySelfCheckSession,
			);
			const roots = page.locator("[data-self-check]");
			await roots.nth(0).locator("textarea").fill("Print A\n<script>literal</script> & final");
			await roots.nth(1).locator("textarea").fill("Print B\nDeuxième ligne");
			if (focused === "retry") {
				await page.evaluate(() =>
					(
						window as unknown as { releaseSlice3Canonical(success: boolean): void }
					).releaseSlice3Canonical(false),
				);
				await expect(roots.nth(0).locator('[data-self-check-action="retry"]')).toBeVisible();
				// Retry owns a new, held canonical request.
				await page.evaluate(() => {
					const append = Element.prototype.append;
					Element.prototype.append = function (...nodes) {
						for (const node of nodes)
							if (node instanceof HTMLScriptElement && node.src.includes("self-check-document")) {
								Object.assign(window, {
									releasePrintRetry: () => {
										Element.prototype.append = append;
										Reflect.apply(append, document.head, [node]);
									},
								});
								return;
							}
						return Reflect.apply(append, this, nodes);
					};
				});
				await roots.nth(0).locator('[data-self-check-action="retry"]').click();
				await page.waitForFunction(() => "releasePrintRetry" in window);
			} else await roots.nth(0).locator("textarea").focus();
			const before = await page.evaluate(() => ({
				saved: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
					window.__praxityBlockState?.get(root.dataset.selfCheckId ?? ""),
				),
				focus:
					document.activeElement?.getAttribute("data-self-check-action") ??
					document.activeElement?.tagName,
			}));
			await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
			await page.emulateMedia({ media: "print" });
			const output = () =>
				page.evaluate(() =>
					[...document.querySelectorAll("[data-self-check-print-answer]")].map((node) => ({
						text: node.textContent,
						whiteSpace: getComputedStyle(node).whiteSpace,
						overflowWrap: getComputedStyle(node).overflowWrap,
					})),
				);
			const literal = [
				{
					text: "Print A\n<script>literal</script> & final",
					whiteSpace: "pre-wrap",
					overflowWrap: "anywhere",
				},
				{ text: "Print B\nDeuxième ligne", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
			];
			const beforeOutput = await output();
			expect(beforeOutput).toEqual(literal);
			await page.evaluate((focused) => {
				(document.activeElement as HTMLElement)?.blur();
				if (focused === "retry")
					(window as unknown as { releasePrintRetry(): void }).releasePrintRetry();
				else (window as unknown as { releaseSlice3Canonical(): void }).releaseSlice3Canonical();
			}, focused);
			await page.waitForFunction(
				() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
			);
			const afterOutput = await output();
			expect(afterOutput).toEqual(literal);
			await page.emulateMedia({ media: "screen" });
			await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
			await expect(
				roots
					.nth(0)
					.locator(focused === "answer" ? "textarea" : '[data-self-check-action="retry"]'),
			).toBeFocused();
			expect(await page.locator("[data-self-check-print-answer]").allTextContents()).toEqual([
				"",
				"",
			]);
			expect(
				await page.evaluate(() =>
					[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
						window.__praxityBlockState?.get(root.dataset.selfCheckId ?? ""),
					),
				),
			).toEqual(before.saved);
			await info.attach("print-transfer", {
				body: JSON.stringify({
					before,
					beforeOutput,
					afterOutput,
					focusAfter: await page.evaluate(
						() =>
							document.activeElement?.getAttribute("data-self-check-action") ??
							document.activeElement?.tagName,
					),
				}),
				contentType: "application/json",
			});
		});
}
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-loading-"));
	for (const locale of ["en", "fr"]) {
		const read = readLesson(
			"# Practice\n::: self-check Explain A.\nmodel: Model A.\n:: Reason\nmissed: Hint A.\n:::\n\n::: self-check Explain B.\nmodel: Model B.\n:: Reason\nmissed: Hint B.\n:::\n",
		);
		const blocks = read.blocks.filter((block) => block.type === "selfCheck");
		const artifact = await compileCourse({
			id: `loading-${locale}`,
			title: "Practice",
			sourceLocale: locale,
			content: read.pages,
			selfCheckContents: blocks.map((block) =>
				selfCheckContentInput(block.id, readSelfCheckContent(read, block.id)),
			),
		});
		try {
			for (const format of ["html", "scorm12", "scorm2004"] as const) {
				const key = `${format}-${locale}`;
				entries[key] = `${key}/${artifact.manifest.pages[0].slug}.html`;
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(join(folder, key));
			}
		} finally {
			await artifact.dispose();
		}
	}
	server = createServer(async (request, response) => {
		try {
			const file = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			response.setHeader(
				"Content-Type",
				file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html",
			);
			response.end(await readFile(join(folder, file)));
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

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	test(`native edits before ${format} entry and during canonical loading retain explicit emptiness`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const values = new Map<string, unknown>();
			window.addEventListener(
				"praxity:runtime-ready",
				() => {
					window.__praxityBlockState = {
						get: (id) =>
							(values.get(id) ?? {
								version: 1,
								kind: "self-check",
								draft: { answer: "Saved answer", ticked: [], shown: false },
								submitted: { rejected: "retain before admission" },
							}) as never,
						set: (id, value) => {
							values.set(id, structuredClone(value));
						},
						getPolicy: () => "device",
					};
				},
				{ once: true },
			);
			const append = Element.prototype.append;
			Element.prototype.append = function (...nodes) {
				for (const node of nodes)
					if (node instanceof HTMLScriptElement) {
						if (/island-self-check-.*\.classic\.js$/.test(node.src)) {
							Object.assign(window, {
								releaseEntry: () => Reflect.apply(append, document.head, [node]),
							});
							return;
						}
						if (node.src.includes("self-check-document")) {
							Object.assign(window, {
								releaseCanonical: () => Reflect.apply(append, document.head, [node]),
							});
							return;
						}
					}
				return Reflect.apply(append, this, nodes);
			};
		});
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let requested!: () => void;
		const request = new Promise<void>((resolve) => {
			requested = resolve;
		});
		if (format !== "file")
			await page.route("**/island-self-check-*.classic.js", async (route) => {
				requested();
				await barrier;
				await route.continue();
			});
		await page.goto(
			format === "file"
				? pathToFileURL(join(folder, entries["html-en"])).href
				: base + entries[`${format}-en`],
			{ waitUntil: "domcontentloaded" },
		);
		if (format === "file") await page.waitForFunction(() => "releaseEntry" in window);
		else await request;
		const roots = page.locator("[data-self-check]");
		await roots.nth(0).locator("textarea").fill("Erase this");
		await roots.nth(0).locator("textarea").fill("");
		await roots.nth(1).locator("textarea").fill("Before entry B");
		if (format === "file")
			await page.evaluate(() => (window as unknown as { releaseEntry(): void }).releaseEntry());
		else release();
		await page.waitForFunction(
			() => window.__praxitySelfCheckSession && "releaseCanonical" in window,
		);
		const beforeAdmission = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
				window.__praxityBlockState?.get(root.dataset.selfCheckId ?? ""),
			),
		);
		expect(beforeAdmission).toEqual(
			["", "Before entry B"].map((answer) => ({
				version: 1,
				kind: "self-check",
				draft: { answer, ticked: [], shown: false },
				submitted: { rejected: "retain before admission" },
			})),
		);
		await roots.nth(1).locator("textarea").fill("During canonical B");
		await page.evaluate(() =>
			(window as unknown as { releaseCanonical(): void }).releaseCanonical(),
		);
		await page.waitForFunction(
			() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
		await expect(roots.nth(0).locator("textarea")).toHaveValue("");
		await expect(roots.nth(1).locator("textarea")).toHaveValue("During canonical B");
		const saved = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
				window.__praxityBlockState?.get(root.dataset.selfCheckId ?? ""),
			),
		);
		expect(saved).toEqual(
			["", "During canonical B"].map((answer) => ({
				version: 1,
				kind: "self-check",
				draft: { answer, ticked: [], shown: false },
				submitted: null,
			})),
		);
		await roots.nth(0).locator('[data-self-check-action="check"]').click();
		await expect(roots.nth(0).locator("textarea")).toHaveAttribute("aria-invalid", "true");
	});

for (const locale of ["en", "fr"] as const)
	for (const width of [1280, 320])
		for (const focus of ["answer", "check"] as const)
			test(`canonical failure ${locale} ${width} retains rejected bytes and ${focus} focus`, async ({
				page,
			}, info) => {
				await page.setViewportSize({ width, height: 900 });
				await page.addInitScript((base) => {
					const saved = {
						version: 1,
						kind: "self-check",
						draft: { answer: "Saved answer", ticked: ["unknown"], shown: false },
						submitted: { rejected: "keep these bytes" },
					};
					const writes: unknown[] = [];
					Object.assign(window, { loadFailureWrites: writes });
					window.addEventListener(
						"praxity:runtime-ready",
						() => {
							window.__praxityBlockState = {
								get: () => saved as never,
								set: (_id, value) => {
									writes.push(value);
								},
								getPolicy: () => "device",
								getSaveResult: () => ({ status: "saved", destination: "device" }),
							};
						},
						{ once: true },
					);
					const append = Element.prototype.append;
					Element.prototype.append = function (...nodes) {
						for (const node of nodes)
							if (node instanceof HTMLScriptElement && node.src.includes("self-check-document")) {
								Object.assign(window, {
									failCanonical: () => {
										Element.prototype.append = append;
										node.src = `${base}missing.js`;
										Reflect.apply(append, document.head, [node]);
									},
								});
								return;
							}
						return Reflect.apply(append, this, nodes);
					};
				}, base);
				await page.goto(base + entries[`html-${locale}`]);
				await page.waitForFunction(() => "failCanonical" in window);
				const root = page.locator("[data-self-check]").first();
				await expect(root.locator("textarea")).toHaveValue("Saved answer");
				await (focus === "answer"
					? root.locator("textarea")
					: root.locator('[data-self-check-action="check"]')
				).focus();
				await page.evaluate(() => (window as unknown as { failCanonical(): void }).failCanonical());
				const retry = root.locator('[data-self-check-action="retry"]');
				await expect(retry).toBeVisible();
				for (const field of await page.locator("[data-self-check] textarea").all())
					await expect(field).toHaveAccessibleDescription(
						locale === "en"
							? "Comparison is unavailable. You can still write and copy your answer. Your answer is saved in this browser on this device. It is not sent to the LMS."
							: "La comparaison n'est pas disponible. Vous pouvez encore écrire et copier votre réponse. Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
					);
				await expect(focus === "answer" ? root.locator("textarea") : retry).toBeFocused();
				await expect(root.locator('[data-self-check-action="start-over"]')).toBeVisible();
				await expect(root.locator("[data-self-check-recovery]")).toHaveText(
					locale === "en"
						? "If this keeps happening, tell whoever runs this course."
						: "Si le probl\u00e8me persiste, pr\u00e9venez la personne responsable de ce cours.",
				);
				expect(
					await page.evaluate(
						() => (window as unknown as { loadFailureWrites: unknown[] }).loadFailureWrites,
					),
				).toEqual([]);
				expect(await page.evaluate(() => window.__praxityBlockState?.get("any"))).toEqual({
					version: 1,
					kind: "self-check",
					draft: { answer: "Saved answer", ticked: ["unknown"], shown: false },
					submitted: { rejected: "keep these bytes" },
				});
				expect((await analyzeAxe(page, new AxeBuilder({ page }))).violations).toEqual([]);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
				).toBe(true);
				if (focus === "answer") {
					const path = info.outputPath(`${locale}-${width}-unavailable.png`);
					await page.screenshot({ path, fullPage: true });
					await info.attach("recovery", { path, contentType: "image/png" });
				}
				await retry.click();
				await page.waitForFunction(
					() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
				);
				await expect(root.locator('[data-self-check-action="retry"]')).toBeFocused();
				for (const field of await page.locator("[data-self-check] textarea").all())
					await expect(field).toHaveAccessibleDescription(
						locale === "en"
							? "Your answer is saved in this browser on this device. It is not sent to the LMS."
							: "Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
					);
			});

test("pending facade leases release the final owner before canonical arrival", async ({ page }) => {
	await page.addInitScript(() => {
		const append = Element.prototype.append;
		Element.prototype.append = function (...nodes) {
			for (const node of nodes)
				if (node instanceof HTMLScriptElement && node.src.includes("self-check-document")) {
					Object.assign(window, {
						releaseCanonical: () => {
							Element.prototype.append = append;
							Reflect.apply(append, document.head, [node]);
						},
					});
					return;
				}
			return Reflect.apply(append, this, nodes);
		};
	});
	await page.goto(base + entries["html-en"]);
	await page.waitForFunction(() => "releaseCanonical" in window);
	const outcomes = await page.evaluate(() => {
		const api = window.__praxitySelfCheckCore;
		api.disposeSelfCheckDocument();
		const a = api.initSelfCheckEnhancements(),
			b = api.initSelfCheckEnhancements();
		const runtime = window.__praxitySelfCheckSession,
			id = document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "";
		a();
		const sibling = runtime?.session.read(id)?.outcome;
		b();
		return [sibling, runtime?.session.read(id)?.outcome];
	});
	expect(outcomes).toEqual(["empty", "cancelled"]);
	await page.evaluate(() => (window as unknown as { releaseCanonical(): void }).releaseCanonical());
	await page.waitForFunction(() => window.PraxitySelfCheckIsland);
	expect(await page.evaluate(() => !!window.__praxitySelfCheckSession)).toBe(false);
	await expect(page.locator("[data-self-check-comparison]")).toHaveCount(0);
});

for (const transition of ["pageshow", "replacement", "edited replacement"] as const)
	test(`${transition === "edited replacement" ? "explicit draft" : "passive"} ${transition} before canonical arrival reads current saved bytes`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const saved = (answer: string, shown = false) => ({
				version: 1,
				kind: "self-check",
				draft: { answer, ticked: [], shown },
				submitted: null,
			});
			const writes: unknown[] = [];
			Object.assign(window, {
				passiveWrites: writes,
				replacePassiveProvider: (shown = false) => {
					window.__praxityBlockState = {
						get: () => saved("New saved answer", shown) as never,
						set: (_id, value) => {
							writes.push(value);
						},
						getPolicy: () => "device",
					};
				},
			});
			window.addEventListener(
				"praxity:runtime-ready",
				() => {
					window.__praxityBlockState = {
						get: () => saved("Saved answer") as never,
						set: (_id, value) => {
							writes.push(value);
						},
						getPolicy: () => "device",
					};
				},
				{ once: true },
			);
			const append = Element.prototype.append;
			Element.prototype.append = function (...nodes) {
				for (const node of nodes)
					if (node instanceof HTMLScriptElement && node.src.includes("self-check-document")) {
						Object.assign(window, {
							releaseCanonical: () => {
								Element.prototype.append = append;
								Reflect.apply(append, document.head, [node]);
							},
						});
						return;
					}
				return Reflect.apply(append, this, nodes);
			};
		});
		await page.goto(base + entries["html-en"]);
		await page.waitForFunction(() => "releaseCanonical" in window);
		if (transition === "edited replacement")
			await page.locator("[data-self-check]").first().locator("textarea").fill("New saved answer");
		await page.evaluate((transition) => {
			if (transition === "pageshow") {
				window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
				window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
			} else
				(
					window as unknown as { replacePassiveProvider(shown: boolean): void }
				).replacePassiveProvider(transition === "edited replacement");
		}, transition);
		await expect(page.locator("[data-self-check]").first().locator("textarea")).toHaveValue(
			transition === "pageshow" ? "Saved answer" : "New saved answer",
		);
		const expectedWrites =
			transition === "edited replacement"
				? [
						{
							version: 1,
							kind: "self-check",
							draft: { answer: "New saved answer", ticked: [], shown: false },
							submitted: null,
						},
						{
							version: 1,
							kind: "self-check",
							draft: { answer: "New saved answer", ticked: [], shown: false },
							submitted: null,
						},
					]
				: [];
		expect(
			await page.evaluate(() => (window as unknown as { passiveWrites: unknown[] }).passiveWrites),
		).toEqual(expectedWrites);
		await page.evaluate(() =>
			(window as unknown as { releaseCanonical(): void }).releaseCanonical(),
		);
		await page.waitForFunction(
			() => document.querySelectorAll("[data-self-check-comparison]").length === 2,
		);
		await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
		expect(
			await page.evaluate(() => (window as unknown as { passiveWrites: unknown[] }).passiveWrites),
		).toEqual(
			transition === "edited replacement"
				? [
						...expectedWrites,
						{
							version: 1,
							kind: "self-check",
							draft: { answer: "New saved answer", ticked: [], shown: false },
							submitted: null,
						},
					]
				: [],
		);
	});

type Round5Probe = {
	evaluated: boolean;
	replaced: boolean;
	releaseCanonical(): void;
	releaseLoad(): void;
	releaseOld(): Promise<void>;
	failCanonical(): void;
	replaceProvider(): void;
};
async function holdRound5Canonical(page: Page, scenario: string) {
	await page.addInitScript((scenario) => {
		const values = new Map<string, unknown>();
		const provider = (prefix: string) => ({
			get: (id: string) =>
				(values.get(prefix + id) ??
					(prefix === "old" && scenario.startsWith("reset")
						? {
								version: 1,
								kind: "self-check",
								draft: { answer: "Saved answer", ticked: [], shown: false },
								submitted: null,
							}
						: undefined)) as never,
			set: (id: string, value: unknown) => {
				values.set(prefix + id, structuredClone(value));
			},
			getPolicy: () => "device" as const,
			getSaveResult: () => ({ status: "saved" as const, destination: "device" as const }),
		});
		window.addEventListener(
			"praxity:runtime-ready",
			() => {
				window.__praxityBlockState = provider("old");
			},
			{ once: true },
		);
		const probe: Round5Probe = {
			evaluated: false,
			replaced: false,
			releaseCanonical() {},
			releaseLoad() {},
			releaseOld: () => Promise.resolve(),
			failCanonical() {},
			replaceProvider() {
				window.__praxityBlockState = provider("new");
				probe.replaced = true;
			},
		};
		Object.assign(window, { round5: probe });
		if (scenario === "microtask") {
			let implementation: Window["PraxitySelfCheckIsland"];
			Object.defineProperty(window, "PraxitySelfCheckIsland", {
				configurable: true,
				get: () => implementation,
				set: (value) => {
					implementation = value;
					queueMicrotask(() => probe.replaceProvider());
				},
			});
		}
		const append = Element.prototype.append;
		let held = false;
		Element.prototype.append = function (...nodes) {
			for (const node of nodes)
				if (
					!held &&
					node instanceof HTMLScriptElement &&
					node.src.includes("self-check-document")
				) {
					held = true;
					const load = node.onload;
					if (scenario === "evaluation")
						node.onload = (event) => {
							probe.evaluated = true;
							probe.releaseLoad = () => load?.call(node, event);
						};
					probe.releaseCanonical = () => Reflect.apply(append, document.head, [node]);
					probe.releaseOld = () =>
						new Promise<void>((resolve, reject) => {
							node.onload = () => resolve();
							node.onerror = () => reject(new Error("Late canonical did not evaluate"));
							Reflect.apply(append, document.head, [node]);
						});
					probe.failCanonical = () => node.dispatchEvent(new Event("error"));
					Object.assign(window, { round5CanonicalHeld: true });
					return;
				}
			return Reflect.apply(append, this, nodes);
		};
	}, scenario);
}
function round5Entry(format: "http" | "file") {
	return format === "file"
		? pathToFileURL(join(folder, entries["html-en"])).href
		: base + entries["html-en"];
}

for (const format of ["http", "file"] as const) {
	for (const timing of ["evaluation", "microtask"] as const)
		test(`round 5 ${format} provider replacement after ${timing} retains two explicit drafts`, async ({
			page,
		}) => {
			await holdRound5Canonical(page, timing);
			await page.goto(round5Entry(format));
			await page.waitForFunction(() => "round5CanonicalHeld" in window);
			const roots = page.locator("[data-self-check]");
			await roots.nth(0).locator("textarea").fill("Latest A");
			await roots.nth(1).locator("textarea").fill("Latest B");
			await page.evaluate(() =>
				(window as unknown as { round5: Round5Probe }).round5.releaseCanonical(),
			);
			if (timing === "evaluation") {
				await page.waitForFunction(
					() => (window as unknown as { round5: Round5Probe }).round5.evaluated,
				);
				await page.evaluate(() => {
					const probe = (window as unknown as { round5: Round5Probe }).round5;
					probe.replaceProvider();
					probe.releaseLoad();
				});
			} else
				await page.waitForFunction(
					() => (window as unknown as { round5: Round5Probe }).round5.replaced,
				);
			await expect(page.locator("[data-self-check-comparison]")).toHaveCount(2);
			await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
			expect(
				await page.evaluate(() =>
					[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
						window.__praxitySelfCheckSession?.session.draftAnswer(root.dataset.selfCheckId ?? ""),
					),
				),
			).toEqual(["Latest A", "Latest B"]);
			expect(
				await page.evaluate(() =>
					[...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
						window.__praxityBlockState?.get(root.dataset.selfCheckId ?? ""),
					),
				),
			).toEqual(
				["Latest A", "Latest B"].map((answer) => ({
					version: 1,
					kind: "self-check",
					draft: { answer, ticked: [], shown: false },
					submitted: null,
				})),
			);
			await roots.nth(0).locator('[data-self-check-action="check"]').click();
			await expect(roots.nth(0).locator("[data-self-check-parts] input")).toBeVisible();
			await expect(roots.nth(0).locator("textarea")).toHaveValue("Latest A");
			await expect(roots.nth(0).locator("textarea")).not.toHaveAttribute("aria-invalid", "true");
			await expect(roots.nth(1).locator("textarea")).toHaveValue("Latest B");
		});

	test(`round 5 ${format} late old evaluation keeps one registry for concurrent scopes`, async ({
		page,
	}) => {
		await holdRound5Canonical(page, "late");
		await page.goto(round5Entry(format));
		await page.waitForFunction(() => "round5CanonicalHeld" in window);
		const roots = page.locator("[data-self-check]");
		await roots.nth(0).locator("textarea").fill("Latest A");
		await roots.nth(1).locator("textarea").fill("Latest B");
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
		});
		await expect(page.locator("[data-self-check-comparison]")).toHaveCount(2);
		await page.evaluate(() => window.__praxitySelfCheckSession?.session.ready);
		await page.evaluate(() => (window as unknown as { round5: Round5Probe }).round5.releaseOld());
		const scopes = await page.evaluate(() => {
			const release = window.__praxitySelfCheckCore.initSelfCheckEnhancements();
			const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
			const counts = () =>
				roots.map((root) => [
					root.querySelectorAll('[data-self-check-action="retry"]').length,
					root.querySelectorAll("[data-self-check-comparison]").length,
				]);
			const attached = counts();
			release();
			return [attached, counts()];
		});
		expect(scopes).toEqual([
			[
				[1, 1],
				[1, 1],
			],
			[
				[1, 1],
				[1, 1],
			],
		]);
		await expect(roots.nth(0).locator("textarea")).toHaveValue("Latest A");
		await expect(roots.nth(1).locator("textarea")).toHaveValue("Latest B");
	});

	test(`round 5 ${format} canonical handoff retains the active empty-answer error`, async ({
		page,
	}) => {
		await holdRound5Canonical(page, "validation");
		await page.goto(round5Entry(format));
		await page.waitForFunction(() => "round5CanonicalHeld" in window);
		const root = page.locator("[data-self-check]").first();
		const answer = root.locator("textarea"),
			error = root.locator("[data-self-check-error]");
		await root.locator('[data-self-check-action="check"]').click();
		await expect(answer).toHaveAttribute("aria-invalid", "true");
		await expect(error).toBeVisible();
		await expect(answer).toBeFocused();
		const description =
			"Your answer is saved in this browser on this device. It is not sent to the LMS. Write your answer first.";
		await expect(answer).toHaveAccessibleDescription(description);
		await page.evaluate(() =>
			(window as unknown as { round5: Round5Probe }).round5.releaseCanonical(),
		);
		await expect(page.locator("[data-self-check-comparison]")).toHaveCount(2);
		expect(await answer.getAttribute("aria-invalid")).toBe("true");
		await expect(error).toBeVisible();
		await expect(answer).toHaveAccessibleDescription(description);
		await expect(answer).toBeFocused();
		await answer.fill("Corrected answer");
		await expect(error).toBeHidden();
		await expect(answer).not.toHaveAttribute("aria-invalid", "true");
	});

	for (const phase of ["pending", "failed"] as const)
		test(`round 5 ${format} provisional reset while ${phase} focuses the answer and keeps recovery copy`, async ({
			page,
		}) => {
			await holdRound5Canonical(page, "reset");
			await page.goto(round5Entry(format));
			await page.waitForFunction(() => "round5CanonicalHeld" in window);
			const root = page.locator("[data-self-check]").first();
			const reset = root.locator('[data-self-check-action="start-over"]');
			await expect(root.locator("textarea")).toHaveValue("Saved answer");
			if (phase === "failed") {
				await page.evaluate(() =>
					(window as unknown as { round5: Round5Probe }).round5.failCanonical(),
				);
				await expect(root.locator('[data-self-check-action="retry"]')).toBeVisible();
			}
			await reset.focus();
			await reset.press("Space");
			await expect(root.locator("textarea")).toHaveValue("");
			expect(
				await root.locator("textarea").evaluate((answer) => answer === document.activeElement),
			).toBe(true);
			await expect(root.locator("[data-self-check-recovery]")).toHaveText(
				phase === "failed"
					? "If this keeps happening, tell whoever runs this course."
					: "Restoring your progress. You can still write and copy your answer.",
			);
			if (phase === "failed") await root.locator('[data-self-check-action="retry"]').click();
			else
				await page.evaluate(() =>
					(window as unknown as { round5: Round5Probe }).round5.releaseCanonical(),
				);
			await expect(page.locator("[data-self-check-comparison]")).toHaveCount(2);
			if (phase === "pending") await expect(root.locator("textarea")).toBeFocused();
			await expect(reset).toBeHidden();
		});
}

for (const format of ["html", "scorm12", "scorm2004", "file"] as const)
	for (const phase of ["before-admission", "before-mount"] as const)
		test(`slice 3 ${format} deterministic two-activity edits ${phase} retain previous submissions`, async ({
			page,
		}) => {
			await page.addInitScript((phase) => {
				const saved = new Map<string, unknown>();
				const observations: unknown[] = [];
				Object.assign(window, { slice3EditObservations: observations });
				window.addEventListener(
					"praxity:runtime-ready",
					() => {
						window.__praxityBlockState = {
							get: (id) => {
								if (!saved.has(id)) {
									const roots = [...document.querySelectorAll<HTMLElement>("[data-self-check]")];
									const root = roots.find((root) => root.dataset.selfCheckId === id);
									const answer = root === roots[0] ? "Saved A" : "Saved B";
									saved.set(id, {
										version: 1,
										kind: "self-check",
										draft: { answer, ticked: [], shown: false },
										submitted: {
											answer,
											ticked: [],
											shown: true,
											contentRevision: root?.dataset.selfCheckRevision,
										},
									});
								}
								return saved.get(id) as never;
							},
							set: (id, value) => {
								saved.set(id, structuredClone(value));
							},
							getPolicy: () => "device",
							getSaveResult: () => ({ status: "saved", destination: "device" }),
						};
					},
					{ once: true },
				);
				if (phase === "before-admission") {
					const append = Element.prototype.append;
					const pending: HTMLScriptElement[] = [];
					Element.prototype.append = function (...nodes) {
						for (const node of nodes)
							if (node instanceof HTMLScriptElement && node.src.includes("/self-check/")) {
								pending.push(node);
								Object.assign(window, {
									slice3HeldAssets: pending.length,
									releaseSlice3Assets: () => {
										Element.prototype.append = append;
										for (const script of pending) Reflect.apply(append, document.head, [script]);
									},
								});
								return;
							}
						return Reflect.apply(append, this, nodes);
					};
				} else {
					let adapter: Window["__praxitySelfCheckSupport"];
					Object.defineProperty(window, "__praxitySelfCheckSupport", {
						configurable: true,
						get: () => adapter,
						set(value: NonNullable<typeof adapter>) {
							adapter = value;
							const enhance = value.enhance;
							const edited = new Set<HTMLElement>();
							value.enhance = (...args) => {
								const root = args[0];
								if (!edited.has(root)) {
									edited.add(root);
									const state = args[2].session.read(root.dataset.selfCheckId ?? "");
									observations.push({
										admitted: state?.admitted,
										inputs: root.querySelectorAll("[data-self-check-parts] input").length,
									});
									const answer = root.querySelector("textarea");
									if (answer) {
										answer.value =
											root === document.querySelector("[data-self-check]") ? "" : "Latest B";
										answer.dispatchEvent(new Event("input", { bubbles: true }));
									}
								}
								return enhance(...args);
							};
						},
					});
				}
			}, phase);
			await page.goto(
				format === "file"
					? pathToFileURL(join(folder, entries["html-en"])).href
					: base + entries[`${format}-en`],
				{ waitUntil: "domcontentloaded" },
			);
			const roots = page.locator("[data-self-check]");
			if (phase === "before-admission") {
				await page.waitForFunction(
					() => (window as unknown as { slice3HeldAssets: number }).slice3HeldAssets === 2,
				);
				await roots.nth(0).locator("textarea").fill("");
				await roots.nth(1).locator("textarea").fill("Latest B");
				await roots.nth(0).locator("textarea").focus();
				await page.evaluate(() =>
					(window as unknown as { releaseSlice3Assets(): void }).releaseSlice3Assets(),
				);
			} else await roots.nth(0).locator("textarea").focus();
			for (const [index, answer] of ["", "Latest B"].entries()) {
				await expect(roots.nth(index).locator("[data-self-check-comparison-title]")).toHaveText(
					"Previous comparison",
				);
				await expect(roots.nth(index).locator("textarea")).toHaveValue(answer);
				await expect(roots.nth(index).getByRole("status")).toHaveText("");
				await expect(roots.nth(index).locator('[data-self-check-action="retry"]')).toHaveCount(1);
			}
			await expect(roots.nth(0).locator("textarea")).toBeFocused();
			const result = await page.evaluate(() => ({
				startup: window.__praxitySelfCheckSession?.session.read(
					document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId ?? "",
				)?.startup,
				observations: (window as unknown as { slice3EditObservations: unknown[] })
					.slice3EditObservations,
				saved: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map((root) =>
					window.__praxityBlockState?.get(root.dataset.selfCheckId ?? ""),
				),
				revisions: [...document.querySelectorAll<HTMLElement>("[data-self-check]")].map(
					(root) => root.dataset.selfCheckRevision,
				),
			}));
			if (phase === "before-mount")
				expect(result.observations).toEqual([
					{ admitted: true, inputs: 0 },
					{ admitted: true, inputs: 0 },
				]);
			expect(result.startup).toBe("ready");
			expect(result.saved).toEqual(
				["", "Latest B"].map((answer, index) => ({
					version: 1,
					kind: "self-check",
					draft: { answer, ticked: [], shown: false },
					submitted: {
						answer: index === 0 ? "Saved A" : "Saved B",
						ticked: [],
						shown: true,
						contentRevision: result.revisions[index],
					},
				})),
			);
		});
