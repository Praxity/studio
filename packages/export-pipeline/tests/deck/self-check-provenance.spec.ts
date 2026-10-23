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
import type { SCORMRuntime } from "../../src/scorm/types";

type ProbeWindow = Window & {
	__praxityRuntime?: Pick<SCORMRuntime, "getSuspendData" | "setSuspendData">;
	provenanceFrames: FrameRequestCallback[];
	provenanceRequest: typeof requestAnimationFrame;
};
let folder: string, base: string, server: Server;
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-provenance-"));
	for (const variant of ["direct", "indirect", "unavailable"] as const) {
		const read = readLesson(`---
variables:
  firstCount: 0
  secondCount: 0
  thirdCount: 0
  restoredOnly: 0
  ordinary: 0
  carried: 0
  forbidden: 0
---
# Practice
::: self-check Explain. {name=practice}
model: A model.
:: Reason
missed: A reason.
:::
::: rating First rating. {name=first}
1. Low
2. High
:::
::: rating Second rating. {name=second}
1. Low
2. High
:::
::: rating Third rating. {name=third}
1. Low
2. High
:::
First {{firstCount}}. Second {{secondCount}}. Restored {{restoredOnly}}.
::: rule
if: practice.isCompleted is true
and: first.ratingScore >= 2
then: add firstCount + 1
then: jump @destination
:::
::: rule
if: practice.isCompleted is true
and: second.ratingScore >= 2
then: add secondCount + 1
:::
::: rule
if: practice.isCompleted is true
and: third.ratingScore >= 2
then: add thirdCount + 1
:::
::: rule
if: practice.isCompleted is true
then: add restoredOnly + 1
then: jump @forbidden
:::
::: rule
if: ordinary >= 0
then: add ordinary + 1
:::
# Next
Continue.
# Destination {name=destination}
Done.
# Forbidden {name=forbidden}
Restored-only destination.
`);
		const activity = read.blocks.find((block) => block.type === "selfCheck");
		if (!activity) throw new Error("Missing provenance activity");
		const firstPage = read.pages[0];
		const rules = firstPage.blocks.filter((block) => block.type === "logic");
		if (variant === "indirect") {
			firstPage.blocks.splice(firstPage.blocks.indexOf(rules[0]), 0, {
				id: "writer",
				type: "logic",
				data: {
					conditions: {
						operator: "and",
						rules: [{ source: "block:first", field: "ratingScore", comparison: "gte", value: 2 }],
					},
					actions: [{ type: "setVariable", targets: ["carried"], value: 1 }],
				},
			} as PraxityBlock);
			const firstData = rules[0].data as { conditions: { rules: unknown[] } };
			firstData.conditions.rules[1] = { source: "variable:carried", comparison: "gte", value: 1 };
			const secondData = rules[1].data as { conditions: { rules: unknown[] }; actions: unknown[] };
			secondData.conditions.rules.splice(1);
			secondData.actions = [
				{
					type: "setVariable",
					targets: ["secondCount"],
					value: { operation: "add", operand: { ref: "block:second", field: "ratingScore" } },
				},
			];
		}
		if (variant === "unavailable")
			for (const operator of ["and", "or"] as const)
				firstPage.blocks.push({
					id: `unavailable-${operator}`,
					type: "logic",
					data: {
						conditions: {
							operator,
							rules: [
								{
									source: "block:practice",
									field: "isCompleted",
									comparison: operator === "and" ? "isNot" : "is",
									value: true,
								},
								{ source: "block:first", field: "ratingScore", comparison: "gte", value: 2 },
							],
						},
						actions: [
							{ type: "setVariable", targets: ["forbidden"], value: 99 },
							{ type: "jumpToPage", targets: ["forbidden"] },
						],
					},
				} as PraxityBlock);
		const artifact = await compileCourse({
			id: `provenance-${variant}`,
			title: "Input provenance",
			sourceLocale: "en",
			navigationStyle: "bottomBar",
			content: read.pages.map((page, index) => ({
				...page,
				id: ["practice", "next", "destination", "forbidden"][index],
			})),
			selfCheckContents: [
				selfCheckContentInput(activity.id, readSelfCheckContent(read, activity.id)),
			],
		});
		try {
			for (const format of ["html", "scorm12", "scorm2004"] as const)
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
					join(folder, variant, format),
				);
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
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
	if (folder) await rm(folder, { recursive: true });
});

async function ready(page: Page) {
	await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
}
async function resumed(page: Page, format: string, variant = "direct") {
	const entry = `${variant}/${format === "file" ? "html" : format}/practice.html`;
	await page.goto(format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry);
	await ready(page);
	const activity = page.locator("[data-self-check]");
	await activity.locator("textarea").fill("A reason.");
	await activity.locator('[data-self-check-action="check"]').click();
	await expect(activity.getByRole("checkbox")).toHaveCount(1);
	await activity.locator('[data-self-check-action="show-feedback"]').click();
	await expect(page.locator('[data-block-type="selfCheck"]')).toHaveAttribute(
		"data-completed",
		"true",
	);
	await page.evaluate(() => {
		const runtime = (window as unknown as ProbeWindow).__praxityRuntime;
		if (!runtime?.getSuspendData || !runtime.setSuspendData)
			throw new Error("Missing variable provider");
		runtime.setSuspendData(
			JSON.stringify({ ...JSON.parse(runtime.getSuspendData() || "{}"), v: { restoredOnly: 7 } }),
		);
	});
	await page.reload();
	await ready(page);
	expect(await values(page)).toEqual({
		firstCount: 0,
		secondCount: 0,
		restoredOnly: 7,
		ordinary: 1,
		forbidden: 0,
	});
}
async function values(page: Page) {
	return page.evaluate(() => {
		const saved =
			JSON.parse((window as unknown as ProbeWindow).__praxityRuntime?.getSuspendData() || "{}").v ??
			{};
		return Object.fromEntries(
			["firstCount", "secondCount", "restoredOnly", "ordinary", "forbidden"].map((name) => [
				name,
				saved[name] ?? 0,
			]),
		);
	});
}
async function queue(page: Page, clicks: Array<[number, number]>) {
	await page.evaluate((clicks) => {
		const view = window as unknown as ProbeWindow;
		view.provenanceFrames = [];
		view.provenanceRequest = window.requestAnimationFrame;
		window.requestAnimationFrame = (frame) => view.provenanceFrames.push(frame);
		const roots = document.querySelectorAll('[data-island="rating"]');
		for (const [index, value] of clicks) {
			const input = roots[index]?.querySelector<HTMLInputElement>(
				`input[type="radio"][value="${value}"]`,
			);
			if (!input) throw new Error("Missing native rating");
			input.click();
		}
	}, clicks);
}
async function restoreFrames(page: Page) {
	await page.evaluate(() => {
		window.requestAnimationFrame = (window as unknown as ProbeWindow).provenanceRequest;
	});
}
async function flush(page: Page, restore = true) {
	await page.evaluate((restore) => {
		const view = window as unknown as ProbeWindow;
		view.provenanceFrames.splice(0).forEach((frame) => frame(performance.now()));
		if (restore) window.requestAnimationFrame = view.provenanceRequest;
	}, restore);
}

for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	for (const variant of ["direct", "indirect"])
		for (const reverse of [false, true])
			test(`${format} ${variant} same-frame origins, reverse ${reverse}`, async ({ page }) => {
				await resumed(page, format, variant);
				await queue(
					page,
					reverse
						? [
								[1, 2],
								[0, 2],
							]
						: [
								[0, 2],
								[1, 2],
							],
				);
				await flush(page);
				expect(await values(page)).toEqual({
					firstCount: 1,
					secondCount: variant === "indirect" ? 2 : 1,
					restoredOnly: 7,
					ordinary: 2,
					forbidden: 0,
				});
				expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBe(
					"destination",
				);
			});
	test(`${format} duplicate origins evaluate final values once; a later frame can act again`, async ({
		page,
	}) => {
		await resumed(page, format);
		await queue(page, [
			[0, 2],
			[0, 1],
			[0, 2],
			[1, 2],
			[1, 1],
		]);
		await flush(page);
		expect(await values(page)).toEqual({
			firstCount: 1,
			secondCount: 0,
			restoredOnly: 7,
			ordinary: 2,
			forbidden: 0,
		});
		await queue(page, [
			[0, 1],
			[0, 2],
		]);
		await flush(page);
		expect(await values(page)).toEqual({
			firstCount: 2,
			secondCount: 0,
			restoredOnly: 7,
			ordinary: 3,
			forbidden: 0,
		});
	});
	test(`${format} separate-frame control retains both input actions`, async ({ page }) => {
		await resumed(page, format);
		await queue(page, [[0, 2]]);
		await flush(page);
		await queue(page, [[1, 2]]);
		await flush(page);
		expect(await values(page)).toEqual({
			firstCount: 1,
			secondCount: 1,
			restoredOnly: 7,
			ordinary: 3,
			forbidden: 0,
		});
	});
	test(`${format} reentrant native input belongs to the next frame`, async ({ page }) => {
		await resumed(page, format);
		await page.evaluate(() => {
			const runtime = (window as unknown as ProbeWindow).__praxityRuntime;
			if (!runtime?.setSuspendData) throw new Error("Missing reentrant provider");
			const write = runtime.setSuspendData.bind(runtime);
			runtime.setSuspendData = (data) => {
				write(data);
				runtime.setSuspendData = write;
				document
					.querySelectorAll('[data-island="rating"]')[2]
					.querySelector<HTMLInputElement>('input[value="2"]')
					?.click();
			};
		});
		await queue(page, [
			[0, 2],
			[1, 2],
		]);
		await flush(page, false);
		expect(await values(page)).toEqual({
			firstCount: 1,
			secondCount: 1,
			restoredOnly: 7,
			ordinary: 2,
			forbidden: 0,
		});
		expect(
			await page.evaluate(
				() =>
					JSON.parse((window as unknown as ProbeWindow).__praxityRuntime?.getSuspendData() || "{}")
						.v?.thirdCount ?? 0,
			),
		).toBe(0);
		await flush(page);
		expect(await values(page)).toEqual({
			firstCount: 1,
			secondCount: 1,
			restoredOnly: 7,
			ordinary: 3,
			forbidden: 0,
		});
		expect(
			await page.evaluate(
				() =>
					JSON.parse((window as unknown as ProbeWindow).__praxityRuntime?.getSuspendData() || "{}")
						.v?.thirdCount ?? 0,
			),
		).toBe(1);
	});
	test(`${format} malformed origins stay suppressed; Show and hydration retain their established pass`, async ({
		page,
	}) => {
		await resumed(page, format);
		await queue(page, [
			[0, 2],
			[1, 2],
		]);
		await page.evaluate(() => window.dispatchEvent(new Event("praxity:runtime-ready")));
		await flush(page);
		await page.evaluate(() => {
			const owner = window.__praxitySelfCheckDocument;
			if (!owner) throw new Error("Missing event owner");
			const current = owner.loadTicket();
			for (const blockId of [undefined, "", 123, {}, "unknown"]) {
				const event = new CustomEvent("praxity:block-interaction", { detail: { blockId } });
				owner.captureEvent(event, current);
				document.dispatchEvent(event);
			}
		});
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
		);
		expect(await values(page)).toEqual({
			firstCount: 0,
			secondCount: 0,
			restoredOnly: 7,
			ordinary: 2,
			forbidden: 0,
		});
		await page.locator('[data-self-check-action="show-feedback"]').click();
		expect(await values(page)).toEqual({
			firstCount: 1,
			secondCount: 1,
			restoredOnly: 8,
			ordinary: 3,
			forbidden: 0,
		});
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBe(
			"forbidden",
		);
		await page
			.locator('[data-island="rating"]')
			.first()
			.evaluate((root) => root.toggleAttribute("data-hydrated"));
		expect(await values(page)).toEqual({
			firstCount: 1,
			secondCount: 1,
			restoredOnly: 8,
			ordinary: 3,
			forbidden: 0,
		});
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBe(
			"forbidden",
		);
	});
	test(`${format} full same-provider reset admits fresh state without old effects`, async ({
		page,
	}) => {
		await resumed(page, format);
		await page.evaluate(() => {
			const saved = new Map<string, never>();
			window.__praxityBlockState = {
				get: (id) => saved.get(id),
				set: (id, value) => saved.set(id, structuredClone(value) as never),
				getPolicy: () => "device",
			};
			Object.assign(window, { resetSaved: saved });
		});
		await ready(page);
		const answer = page.locator("[data-self-check] textarea");
		await answer.fill("Old editable draft");
		await queue(page, [
			[0, 2],
			[1, 2],
		]);
		await restoreFrames(page);
		await page.evaluate(() => {
			const events: unknown[] = [];
			document.addEventListener("praxity:assessment-response", (event) =>
				events.push((event as CustomEvent).detail),
			);
			(document.getElementById("praxity-live-region") as HTMLElement).textContent = "";
			(window as unknown as { resetSaved: Map<string, unknown> }).resetSaved.clear();
			(window as unknown as ProbeWindow).__praxityRuntime?.setSuspendData("{}");
			const owner = window.__praxitySelfCheckDocument;
			const old = owner?.current;
			const provider = window.__praxityBlockState;
			owner?.reset();
			Object.assign(window, {
				resetResponses: events,
				resetProviderSame: provider === window.__praxityBlockState,
				resetRuntimeNew: old !== owner?.current,
			});
		});
		await ready(page);
		await flush(page);
		await expect(answer).toHaveValue("");
		expect(await values(page)).toEqual({
			firstCount: 0,
			secondCount: 0,
			restoredOnly: 0,
			ordinary: 1,
			forbidden: 0,
		});
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
		expect(
			await page.evaluate(() => {
				const view = window as unknown as {
					resetResponses: unknown[];
					resetProviderSame: boolean;
					resetRuntimeNew: boolean;
				};
				return {
					responses: view.resetResponses,
					sameProvider: view.resetProviderSame,
					newRuntime: view.resetRuntimeNew,
					summary: document.getElementById("praxity-live-region")?.textContent,
				};
			}),
		).toEqual({ responses: [], sameProvider: true, newRuntime: true, summary: "" });
	});
	for (const boundary of [
		"provider",
		"pagehide",
		"retry",
		"start-over",
		"ready",
		"dispose",
	] as const)
		test(`${format} ${boundary} clears the multiorigin batch before forced old delivery`, async ({
			page,
		}) => {
			await resumed(page, format);
			await page
				.locator('[data-island="rating"]')
				.nth(2)
				.evaluate((root) => root.setAttribute("data-required", "true"));
			await page.locator(".praxity-nav-next").click();
			await expect(page.locator(".praxity-required-message")).toHaveCount(1);
			await queue(page, [
				[0, 2],
				[1, 2],
			]);
			await restoreFrames(page);
			await page.evaluate(async (boundary) => {
				const owner = window.__praxitySelfCheckDocument;
				if (!owner) throw new Error("Missing document owner");
				if (boundary === "provider") {
					const provider = window.__praxityBlockState;
					if (!provider) throw new Error("Missing state provider");
					window.__praxityBlockState = {
						...provider,
						get: provider.get.bind(provider),
						set: provider.set.bind(provider),
						getPolicy: provider.getPolicy?.bind(provider),
					};
				} else if (boundary === "pagehide") {
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
					window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
				} else if (boundary === "ready") window.dispatchEvent(new Event("praxity:runtime-ready"));
				else if (boundary === "dispose") owner.dispose();
				else {
					const blockId =
						document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId;
					if (!blockId) throw new Error("Missing activity ID");
					await owner.current.session.dispatch({ type: boundary, blockId });
				}
			}, boundary);
			if (boundary !== "dispose") await ready(page);
			await page
				.locator('[data-island="rating"]')
				.nth(2)
				.evaluate((root) => root.setAttribute("data-completed", "true"));
			await flush(page);
			expect(await values(page)).toEqual({
				firstCount: 0,
				secondCount: 0,
				restoredOnly: 7,
				ordinary: boundary === "provider" || boundary === "pagehide" ? 2 : 1,
				forbidden: 0,
			});
			expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
			await expect(page.locator(".praxity-required-message")).toHaveCount(1);
			if (boundary !== "dispose" && boundary !== "start-over") {
				await queue(page, [
					[1, 1],
					[1, 2],
				]);
				await flush(page);
				expect(await values(page)).toMatchObject({
					firstCount: 0,
					secondCount: 1,
					restoredOnly: 7,
				});
				await queue(page, [
					[0, 1],
					[0, 2],
					[1, 1],
					[1, 2],
				]);
				await flush(page);
				expect(await values(page)).toMatchObject({
					firstCount: 1,
					secondCount: 2,
					restoredOnly: 7,
				});
			} else if (boundary === "dispose") {
				await page.reload();
				await ready(page);
				await queue(page, [
					[1, 1],
					[1, 2],
				]);
				await flush(page);
				expect(await values(page)).toEqual({
					firstCount: 0,
					secondCount: 1,
					restoredOnly: 7,
					ordinary: 3,
					forbidden: 0,
				});
			} else {
				await queue(page, [
					[1, 1],
					[1, 2],
				]);
				await flush(page);
				expect(await values(page)).toEqual({
					firstCount: 0,
					secondCount: 0,
					restoredOnly: 7,
					ordinary: 2,
					forbidden: 0,
				});
				const activity = page.locator("[data-self-check]");
				await activity.locator("textarea").fill("A fresh reason.");
				await activity.locator('[data-self-check-action="check"]').click();
				await activity.locator('[data-self-check-action="show-feedback"]').click();
				expect(await values(page)).toEqual({
					firstCount: 1,
					secondCount: 1,
					restoredOnly: 8,
					ordinary: 3,
					forbidden: 0,
				});
			}
		});
	test(`${format} unavailable dependencies skip negative and OR rules despite fresh inputs`, async ({
		page,
	}) => {
		await resumed(page, format, "unavailable");
		await page.evaluate(() => {
			const provider = window.__praxityBlockState;
			const blockId = document.querySelector<HTMLElement>("[data-self-check]")?.dataset.selfCheckId;
			if (!provider || !blockId) throw new Error("Missing failed-admission provider");
			window.__praxityBlockState = {
				...provider,
				get: (id) => (id === blockId ? { invalid: true } : provider.get(id)),
				set: provider.set.bind(provider),
				getPolicy: provider.getPolicy?.bind(provider),
			};
		});
		await ready(page);
		await queue(page, [
			[0, 2],
			[1, 2],
		]);
		await flush(page);
		expect(await values(page)).toEqual({
			firstCount: 0,
			secondCount: 0,
			restoredOnly: 7,
			ordinary: 3,
			forbidden: 0,
		});
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
	});
}
