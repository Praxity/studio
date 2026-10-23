import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";

let folder: string, base: string, server: Server;
test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-round9-"));
	for (const kind of ["deck", "rating"] as const) {
		const read = readLesson(
			kind === "deck"
				? "# Practice\n::: self-check Explain. {name=practice}\nmodel: A model.\n:: Reason\nmissed: A reason.\n:::\n# Later\nLater content.\n# End\nEnd content.\n"
				: "---\nvariables:\n  count: 0\n  ordinary: 0\n---\n# Practice\n::: self-check Explain. {name=practice}\nmodel: A model.\n:: Reason\nmissed: A reason.\n:::\n::: rating Choose. {name=rating}\n:::\nCount {{count}}. Ordinary {{ordinary}}.\n::: rule\nif: practice.isCompleted is true\nand: rating.ratingScore >= 2\nthen: add count + 1\nthen: jump @destination\n:::\n::: rule\nif: ordinary >= 0\nthen: add ordinary + 1\n:::\n# Next page\nContinue.\n# Destination {name=destination}\nDone.\n",
		);
		const activity = read.blocks.find((block) => block.type === "selfCheck");
		if (!activity) throw new Error("Missing self-check fixture");
		const artifact = await compileCourse({
			id: `round9-${kind}`,
			title: "Round 9",
			sourceLocale: "en",
			navigationStyle: "bottomBar",
			content: read.pages.map((page, index) => ({
				...page,
				id:
					kind === "deck"
						? ["practice", "later", "end"][index]
						: index === 2
							? "destination"
							: page.id,
				...(kind === "deck" ? { lessonId: `module-${index}` } : {}),
			})),
			...(kind === "deck" ? { moduleDeck: { gates: { [activity.id]: "attempt" as const } } } : {}),
			selfCheckContents: [
				selfCheckContentInput(activity.id, readSelfCheckContent(read, activity.id)),
			],
		});
		try {
			if (kind === "deck")
				expect(artifact.manifest.pages.map((page) => page.runtime.islands)).toEqual([
					["deck", "selfCheck"],
					["deck", "selfCheck"],
					["deck", "selfCheck"],
				]);
			for (const format of ["html", "scorm12", "scorm2004"] as const)
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
					join(folder, kind, format),
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

async function open(page: Page, kind: string, format: string, slug = "practice") {
	const entry = `${kind}/${format === "file" ? "html" : format}/${slug}.html`;
	await page.goto(format === "file" ? pathToFileURL(join(folder, entry)).href : base + entry);
}
async function ready(page: Page) {
	await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
}
async function submit(page: Page) {
	const activity = page.locator("[data-self-check]");
	await activity.locator("textarea").fill("A reason.");
	await activity.locator('[data-self-check-action="check"]').click();
	await expect(activity.getByRole("checkbox")).toHaveCount(1);
	await activity.locator('[data-self-check-action="show-feedback"]').click();
	await expect(page.locator('[data-block-type="selfCheck"]')).toHaveAttribute(
		"data-completed",
		"true",
	);
}
async function probe(page: Page) {
	await page.addInitScript(() => {
		const navigation: string[] = [];
		Object.assign(window, { round9Navigation: navigation });
		window.__praxityNavigatePageHref = (href) => {
			navigation.push(href);
			return true;
		};
	});
}
async function navigation(page: Page) {
	return page.evaluate(() =>
		(window as unknown as { round9Navigation: string[] }).round9Navigation.map((href) => {
			const url = new URL(href, location.href);
			return `${url.pathname.split("/").at(-1)}${url.hash}`;
		}),
	);
}

for (const format of ["html", "scorm12", "scorm2004", "file"] as const) {
	test(`${format} options-only optional attempt gate initializes every dependent module and permits both directions`, async ({
		page,
	}) => {
		await probe(page);
		await open(page, "deck", format);
		await ready(page);
		await submit(page);
		await open(page, "deck", format, "later");
		await ready(page);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator("#deck-next")).toBeVisible();
		await expect(page.locator("#deck-next")).not.toHaveAttribute("aria-disabled", "true");
		await page.locator("#deck-next").click();
		await expect(page.locator("#deck-completion")).toBeVisible();
		await page.locator("#deck-next").click();
		expect(await navigation(page)).toEqual(["end.html#end"]);
		await open(page, "deck", format, "later");
		await ready(page);
		await page.locator("#deck-previous").click();
		expect(await navigation(page)).toEqual(["practice.html#practice"]);
	});
	test(`${format} options-only remote gate presents pending and failed recovery, then Retry admits navigation`, async ({
		page,
	}) => {
		await probe(page);
		await page.addInitScript(() => {
			const append = Element.prototype.append;
			const held: HTMLScriptElement[] = [];
			Element.prototype.append = function (...nodes) {
				if (
					nodes.some(
						(node) => node instanceof HTMLScriptElement && node.src.includes("/self-check/"),
					)
				) {
					held.push(
						...nodes.filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement),
					);
					return;
				}
				return Reflect.apply(append, this, nodes);
			};
			window.addEventListener(
				"praxity:runtime-ready",
				() => {
					const config = JSON.parse(document.getElementById("praxity-config")?.textContent ?? "{}");
					const reference = config.selfChecks.references[0];
					window.__praxityBlockState = {
						get: () =>
							({
								version: 1,
								kind: "self-check",
								draft: { answer: "A reason.", ticked: [], shown: false },
								submitted: {
									answer: "A reason.",
									ticked: [],
									shown: true,
									contentRevision: reference.contentRevision,
								},
							}) as never,
						set() {},
						getPolicy: () => "device",
					};
				},
				{ once: true },
			);
			Object.assign(window, {
				round9Held: held,
				releaseRound9(success: boolean) {
					const script = held.shift();
					if (!script) throw new Error("Missing admission barrier");
					if (success) Reflect.apply(append, document.head, [script]);
					else script.dispatchEvent(new Event("error"));
				},
			});
		});
		await open(page, "deck", format, "later");
		await page.waitForFunction(
			() => (window as unknown as { round9Held: unknown[] }).round9Held.length === 1,
		);
		await expect(page.locator("[data-completion-reason]")).toBeVisible();
		await expect(page.locator("[data-completion-reason]")).toContainText("Restoring");
		await expect(page.locator("#deck-next")).toHaveAttribute("aria-disabled", "true");
		await page.locator("#deck-next").evaluate((element: HTMLButtonElement) => element.click());
		expect(await navigation(page)).toEqual([]);
		await page.evaluate(() =>
			(window as unknown as { releaseRound9(success: boolean): void }).releaseRound9(false),
		);
		await ready(page);
		await expect(page.locator("[data-completion-reason]")).toBeVisible();
		await expect(page.locator("[data-completion-reason]")).toContainText("Comparison");
		await expect(page.locator("[data-self-check-gate-retry]")).toBeVisible();
		await page.locator("[data-self-check-gate-retry]").click();
		await page.waitForFunction(
			() => (window as unknown as { round9Held: unknown[] }).round9Held.length === 1,
		);
		await page.evaluate(() =>
			(window as unknown as { releaseRound9(success: boolean): void }).releaseRound9(true),
		);
		await ready(page);
		// A failed remote prerequisite may have routed the deck back to its owning module.
		await open(page, "deck", format, "later");
		await page.waitForFunction(
			() => (window as unknown as { round9Held: unknown[] }).round9Held.length === 1,
		);
		await page.evaluate(() =>
			(window as unknown as { releaseRound9(success: boolean): void }).releaseRound9(true),
		);
		await ready(page);
		await expect(page.locator("#deck-next")).toBeVisible();
		await expect(page.locator("#deck-next")).not.toHaveAttribute("aria-disabled", "true");
	});
	test(`${format} a new rating after resume writes count one and navigates to the authored destination`, async ({
		page,
	}) => {
		await probe(page);
		await open(page, "rating", format);
		await ready(page);
		await submit(page);
		await page.reload();
		await ready(page);
		await expect(page.locator('[data-mention="variable:count"]')).toHaveText("0");
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
		await page.locator('label[for$="-rating-2"]').click();
		await expect(page.locator('[data-mention="variable:count"]')).toHaveText("1");
		expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBe(
			"destination",
		);
		await page.locator(".praxity-nav-next").evaluate((element: HTMLElement) => element.click());
		expect(await navigation(page)).toEqual(["destination.html"]);
	});
	for (const boundary of ["provider", "pagehide"] as const)
		test(`${format} ${boundary} rejects a revoked rating frame before successor effects`, async ({
			page,
		}) => {
			await open(page, "rating", format);
			await ready(page);
			await submit(page);
			await page.reload();
			await ready(page);
			await page.evaluate((boundary) => {
				const frames: FrameRequestCallback[] = [];
				const request = window.requestAnimationFrame;
				window.requestAnimationFrame = (callback) => {
					frames.push(callback);
					return 987654;
				};
				document.dispatchEvent(
					new CustomEvent("praxity:block-interaction", {
						detail: { blockId: "rating", blockType: "rating" },
					}),
				);
				window.requestAnimationFrame = request;
				Object.assign(window, { round9Frames: frames });
				const runtime = window.__praxityRuntime as
					| Pick<SCORMRuntime, "setSuspendData" | "commit">
					| undefined;
				if (!runtime) throw new Error("Missing runtime fixture");
				runtime.setSuspendData('{"v":{"count":0,"ordinary":4}}');
				if (boundary === "provider") {
					const provider = window.__praxityBlockState;
					if (!provider) throw new Error("Missing provider fixture");
					window.__praxityBlockState = {
						...provider,
						get: provider.get.bind(provider),
						set: provider.set.bind(provider),
						getPolicy: provider.getPolicy?.bind(provider),
					};
				} else {
					window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
					window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
				}
			}, boundary);
			await ready(page);
			await expect(page.locator('[data-mention="variable:ordinary"]')).toHaveText("5");
			await page.evaluate(() =>
				(window as unknown as { round9Frames: FrameRequestCallback[] }).round9Frames
					.splice(0)
					.forEach((frame) => frame(0)),
			);
			await expect(page.locator('[data-mention="variable:ordinary"]')).toHaveText("5");
			await expect(page.locator('[data-mention="variable:count"]')).toHaveText("0");
			expect(await page.evaluate(() => window.__praxityLogicEngine?.getJumpTarget())).toBeNull();
		});
}
