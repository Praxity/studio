import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { silentWav } from "../fixtures/silent-audio";

const activity =
	"::: self-check Explain. {required}\nmodel: Model.\n:: Reason\nmissed: Reason.\n:::\n";
const formats = ["html", "scorm12", "scorm2004", "file"] as const;
let folder: string, base: string, server: Server;
type AttackWindow = Window & {
	groupAttack: {
		writes: unknown[];
		completions: unknown[];
		old(): boolean;
		replaced: boolean;
		timers: (() => void)[];
	};
	earlyGroup?: { replaced: boolean; tracking: unknown[] };
	resizeAttack: (ResizeObserver & { callback: ResizeObserverCallback; targets: Element[] })[];
};

test.beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "self-check-lifetime-consumers-"));
	for (const mode of ["all", "oneOf"]) {
		const read = readLesson(
			`# Practice\n${activity}\n::: group Review {mode=${mode} requireAll=true}\n::: choice Choose. {required}\n(x) Correct\n( ) Incorrect\n:::\n:::\n# Next\nDone.\n`,
		);
		const check = read.blocks.find((block) => block.type === "selfCheck");
		if (!check) throw new Error("Missing self-check fixture");
		const artifact = await compileCourse({
			id: `lifetime-group-${mode}`,
			title: "Group reentry",
			sourceLocale: "en",
			navigationStyle: "bottomBar",
			content: read.pages,
			selfCheckContents: [selfCheckContentInput(check.id, readSelfCheckContent(read, check.id))],
		});
		try {
			for (const format of formats.filter((format) => format !== "file"))
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
					join(folder, `group-${mode}-${format}`),
				);
		} finally {
			await artifact.dispose();
		}
	}
	const course = moduleDeckFixture("https://lifetime-consumers.example/narration.wav");
	for (const page of course.content)
		page.blocks = page.blocks.filter((block) => block.type !== "image" && block.type !== "audio");
	const read = readLesson(`# Practice\n${activity}`),
		check = read.blocks.find((block) => block.type === "selfCheck");
	if (!check) throw new Error("Missing self-check fixture");
	course.content[0].blocks.push(check);
	course.selfCheckContents = [
		selfCheckContentInput(check.id, readSelfCheckContent(read, check.id)),
	];
	const fetch = globalThis.fetch;
	globalThis.fetch = (input, options) =>
		String(input).startsWith("https://lifetime-consumers.example/")
			? Promise.resolve(
					new Response(new Uint8Array(silentWav(10)), { headers: { "Content-Type": "audio/wav" } }),
				)
			: fetch(input, options);
	try {
		const artifact = await compileCourse(course);
		try {
			for (const format of formats.filter((format) => format !== "file"))
				new AdmZip((await deployCourse(artifact, { format })).zip).extractAllTo(
					join(folder, `narration-${format}`),
				);
		} finally {
			await artifact.dispose();
		}
	} finally {
		globalThis.fetch = fetch;
	}
	server = createServer(async (request, response) => {
		try {
			const path = new URL(request.url ?? "/", "http://fixture").pathname.slice(1);
			response.setHeader(
				"Content-Type",
				path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".css")
						? "text/css"
						: path.endsWith(".wav")
							? "audio/wav"
							: "text/html",
			);
			response.end(await readFile(join(folder, path)));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}/`;
});
test.afterAll(async () => {
	await new Promise<void>((resolve) => server?.close(() => resolve()));
	await rm(folder, { recursive: true, force: true });
});

function url(path: string, format: (typeof formats)[number]) {
	return format === "file"
		? pathToFileURL(join(folder, path.replace("-file/", "-html/"))).href
		: base + path;
}

for (const mode of ["all", "oneOf"])
	for (const format of formats.filter((format) => format !== "file"))
		for (const phase of ["member-submit", "group-complete", "group-before-host"] as const)
			test(`${mode} ${format}: ${phase} revocation refuses the old group result`, async ({
				page,
			}) => {
				if (phase === "group-before-host")
					await page.addInitScript(() => {
						const view = window as unknown as AttackWindow;
						const early = { replaced: false, tracking: [] as unknown[] };
						view.earlyGroup = early;
						document.addEventListener("praxity:assessment-group-complete", () => {
							const runtime = window.__praxityRuntime as unknown as SCORMRuntime | undefined;
							if (!runtime) throw new Error("Missing runtime");
							const track = runtime.trackInteraction.bind(runtime);
							runtime.trackInteraction = (...args: Parameters<typeof track>) => {
								early.tracking.push(args[0]);
								return track(...args);
							};
							early.replaced = true;
							window.__praxityBlockState = {
								get: () => undefined,
								getPolicy: () => "lms",
								set: (id, value) => {
									view.groupAttack.writes.push({ id, value });
								},
							};
						});
					});
				await page.goto(url(`group-${mode}-${format}/practice.html`, format));
				await page.waitForFunction(() => window.__praxitySelfCheckDocument?.consumers.settled());
				if (mode === "oneOf") await page.locator(".praxity-ag-radio").check();
				await page.locator("[data-assessment-display] input[type=radio]").first().check();
				await page.evaluate((phase) => {
					const view = window as unknown as AttackWindow;
					const state = {
						writes: [] as unknown[],
						completions: [] as unknown[],
						old: window.__praxitySelfCheckDocument?.loadTicket() ?? (() => false),
						replaced: false,
						timers: [] as (() => void)[],
					};
					view.groupAttack = state;
					const replace = () => {
						if (state.replaced) return;
						state.replaced = true;
						window.__praxityBlockState = {
							get: () => undefined,
							getPolicy: () => "lms",
							set: (id, value) => {
								state.writes.push({ id, value });
							},
						};
					};
					document.addEventListener("praxity:assessment-response", () => {
						if (phase === "member-submit") replace();
					});
					document.addEventListener("praxity:assessment-group-complete", (event) => {
						state.completions.push((event as CustomEvent).detail);
						if (phase === "group-complete") replace();
					});
					const schedule = window.setTimeout;
					window.setTimeout = ((
						callback: (...args: unknown[]) => void,
						delay: number,
						...args: unknown[]
					) => {
						if (delay === 100) {
							state.timers.push(() => callback(...args));
							return 987654;
						}
						return schedule(callback, delay, ...args);
					}) as typeof window.setTimeout;
					document
						.querySelector<HTMLButtonElement>(
							"[data-assessment-group-submit] .praxity-ag-submit-btn",
						)
						?.click();
				}, phase);
				if (phase === "group-complete" || phase === "group-before-host")
					await page.waitForFunction(
						() =>
							document
								.querySelector("[data-assessment-display]")
								?.getAttribute("data-completed") === "true",
					);
				const result = await page.evaluate(() => {
					const state = (window as unknown as AttackWindow).groupAttack;
					state.timers.splice(0).forEach((callback) => callback());
					return {
						writes: state.writes,
						completions: state.completions.length,
						oldCurrent: state.old(),
						replaced:
							state.replaced || (window as unknown as AttackWindow).earlyGroup?.replaced === true,
						tracking: (window as unknown as AttackWindow).earlyGroup?.tracking ?? [],
					};
				});
				expect(result.replaced).toBe(true);
				expect(result.oldCurrent).toBe(false);
				expect(result.writes).toEqual([]);
				expect(result.tracking).toEqual([]);
				expect(result.completions).toBe(phase === "member-submit" ? 0 : 1);
			});

for (const format of formats)
	test(`${format}: retained narration resize leaves successor settings unchanged`, async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const view = window as unknown as AttackWindow;
			view.resizeAttack = [];
			window.ResizeObserver = class {
				targets: Element[] = [];
				constructor(public callback: ResizeObserverCallback) {
					view.resizeAttack.push(this);
				}
				observe(target: Element) {
					this.targets.push(target);
				}
				unobserve() {}
				disconnect() {}
			};
		});
		await page.goto(url(`narration-${format}/introduction.html`, format));
		await page.waitForFunction(
			() =>
				document.querySelector<HTMLElement>(".praxity-deck")?.dataset.ready &&
				window.__praxitySelfCheckDocument?.consumers.settled(),
		);
		const result = await page.evaluate(() => {
			const root = document.querySelector<HTMLElement>(".praxity-deck"),
				settings = root?.querySelector<HTMLElement>("#deck-more-playback");
			const observer = (window as unknown as AttackWindow).resizeAttack.find(
				(observer) => observer.targets.length === 1 && observer.targets[0] === root,
			);
			if (!settings || !observer) throw new Error("Narration observer absent");
			const old = window.__praxitySelfCheckDocument?.loadTicket();
			window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
			window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
			settings.style.display = "none";
			const before = settings.innerHTML;
			observer.callback([], observer as ResizeObserver);
			return { oldCurrent: old?.(), before, after: settings.innerHTML };
		});
		expect(result.oldCurrent).toBe(false);
		expect(result.before).toContain("praxity-narration-settings");
		expect(result.after).toBe(result.before);
	});
