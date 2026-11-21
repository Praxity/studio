import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const LAYOUT_UNIT = 1 / 60;

export function textFitsWithin(element: Locator): Promise<boolean> {
	return element.evaluate((button, layoutUnit) => {
		const bounds = button.getBoundingClientRect();
		const range = document.createRange();
		range.selectNodeContents(button);
		return [...range.getClientRects()].every(
			(rect) =>
				rect.width === 0 ||
				(rect.left >= bounds.left - layoutUnit && rect.right <= bounds.right + layoutUnit),
		);
	}, LAYOUT_UNIT);
}

export interface TestEnv {
	url: string;
	tmpDir: string;
	pages: CoursePageMeta[];
	navVariants?: Record<string, string>;
	themeVariants?: Record<string, string>;
	fullFixtureVariants?: Record<string, string>;
	slidesNarrationUrl?: string;
	hiddenBlocksUrl?: string;
	hiddenBlocksPages?: CoursePageMeta[];
	captionedVideoUrl?: string;
	frenchMatrixUrls?: string[];
	coursePages?: Record<string, CoursePageMeta[]>;
	selectorPages?: Record<string, Record<string, CoursePageMeta[] | null>>;
}

export interface CoursePageMeta {
	slug: string;
	title: string;
}

export interface VariantEnv {
	navVariants: Record<string, string>;
	themeVariants: Record<string, string>;
	fullFixtureVariants: Record<string, string>;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

const pageSelectorCache = new Map<string, CoursePageMeta>();

export const DISCOVERY_SELECTORS = [
	"[data-block-type='accordion']",
	"[data-block-type='accordion'] button, [data-block-type='accordion'] summary",
	"[data-block-type='accordion'] summary, [data-block-type='accordion'] button",
	"[data-block-type='tabs'] [role='tab']",
	"[data-block-type='assessment']:visible",
	"[data-block-type='assessment']:visible input:visible",
	"[data-block-type='assessment'] textarea",
	"[data-block-type='chart']",
	"[data-block-type='columns'] .praxity-column",
	"[data-block-type='checklist'] input[type='checkbox']",
	"[data-block-type='video'] iframe",
	"[data-block-type='embed'] iframe",
	".inline-tooltip-trigger",
	".praxity-assessment-stem",
	".praxity-fill-blank-input",
	...["matching", "sequence", "textResponse"].map(
		(type) => `[data-island="assessment"][data-block-json*='"assessmentType":"${type}"']`,
	),
];

function normalizeText(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function readJsonFile<T>(filePath: string): T | null {
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

export function readTestEnv(): TestEnv {
	const path = process.env.PRAXITY_A11Y_ENV_PATH;
	const parsed = path ? readJsonFile<TestEnv>(path) : null;
	if (!parsed?.url) {
		throw new Error(`Missing or invalid test env file: ${path ?? "PRAXITY_A11Y_ENV_PATH unset"}`);
	}
	const pages = Array.isArray(parsed.pages)
		? parsed.pages
				.filter((entry) => typeof entry?.slug === "string" && entry.slug.trim().length > 0)
				.map((entry) => ({
					slug: entry.slug,
					title:
						typeof entry.title === "string" && entry.title.trim().length > 0
							? entry.title
							: entry.slug,
				}))
		: [];
	return {
		url: parsed.url,
		tmpDir: parsed.tmpDir,
		pages,
		coursePages: parsed.coursePages,
		selectorPages: parsed.selectorPages,
		navVariants:
			parsed.navVariants && typeof parsed.navVariants === "object" ? parsed.navVariants : {},
		themeVariants:
			parsed.themeVariants && typeof parsed.themeVariants === "object" ? parsed.themeVariants : {},
		fullFixtureVariants:
			parsed.fullFixtureVariants && typeof parsed.fullFixtureVariants === "object"
				? parsed.fullFixtureVariants
				: {},
		slidesNarrationUrl:
			typeof parsed.slidesNarrationUrl === "string" ? parsed.slidesNarrationUrl : undefined,
		hiddenBlocksUrl:
			typeof parsed.hiddenBlocksUrl === "string" ? parsed.hiddenBlocksUrl : undefined,
		hiddenBlocksPages: Array.isArray(parsed.hiddenBlocksPages) ? parsed.hiddenBlocksPages : [],
		captionedVideoUrl:
			typeof parsed.captionedVideoUrl === "string" ? parsed.captionedVideoUrl : undefined,
		frenchMatrixUrls: Array.isArray(parsed.frenchMatrixUrls) ? parsed.frenchMatrixUrls : undefined,
	};
}

export function readSlidesNarrationUrl(): string | undefined {
	return readTestEnv().slidesNarrationUrl;
}

export function readHiddenBlocksFixture(): { url: string; pages: CoursePageMeta[] } {
	const env = readTestEnv();
	if (!env.hiddenBlocksUrl || !env.hiddenBlocksPages?.length) {
		throw new Error("Missing hidden-block accessibility fixture");
	}
	return { url: env.hiddenBlocksUrl, pages: env.hiddenBlocksPages };
}

export function readVariantEnv(): VariantEnv {
	const env = readTestEnv();
	return {
		navVariants: env.navVariants ?? {},
		themeVariants: env.themeVariants ?? {},
		fullFixtureVariants: env.fullFixtureVariants ?? {},
	};
}

export function readFullFixtureVariantUrl(name: string): string | undefined {
	return readVariantEnv().fullFixtureVariants[name];
}

export function readNavVariantUrl(name: string): string | undefined {
	return readVariantEnv().navVariants[name];
}

export function readThemeVariantUrl(name: string): string | undefined {
	return readVariantEnv().themeVariants[name];
}

export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForSelector("html.praxity-js-loaded", { timeout: 15_000 });

	await expect(page.locator('[data-island="nav"]:not([data-hydrated])')).toHaveCount(0);
	await expect
		.poll(() =>
			page.locator('[data-entrance="visible"]').evaluateAll((elements) =>
				elements.every((element) => {
					const style = getComputedStyle(element);
					const opacity = element.matches(".praxity-block")
						? style.getPropertyValue("--praxity-reading-guide-opacity").trim() || "1"
						: "1";
					return Number(style.opacity) === Number(opacity);
				}),
			),
		)
		.toBe(true);
}

export async function waitForSettledStyles(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const moving = () =>
					document
						.getAnimations()
						.some((animation) => animation.pending || animation.playState === "running");
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				if (moving()) return false;
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				return !moving();
			}),
		)
		.toBe(true);
}

export async function analyzeAxe(
	page: Page,
	builder = new AxeBuilder({ page }),
): Promise<Awaited<ReturnType<AxeBuilder["analyze"]>>> {
	await waitForSettledStyles(page);
	return builder.analyze();
}

export async function getCoursePages(page: Page, baseUrl: string): Promise<CoursePageMeta[]> {
	const env = readTestEnv();
	const courseUrl = baseUrl.replace(/\/$/, "");
	const envPages = env.coursePages?.[courseUrl] ?? (courseUrl === env.url ? env.pages : []);
	if (envPages.length > 0) {
		return envPages;
	}

	await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
	await page.waitForFunction(
		() =>
			!window.location.pathname.endsWith("/index.html") &&
			!window.location.pathname.endsWith("index.html"),
		undefined,
		{ timeout: 20_000 },
	);
	await page.waitForSelector("#praxity-config", { state: "attached", timeout: 20_000 });

	const pages = await page.evaluate(() => {
		const script = document.getElementById("praxity-config");
		if (!script?.textContent) return [];
		const parsed = JSON.parse(script.textContent) as {
			pages?: Array<{ slug?: string; title?: string }>;
		};
		if (!Array.isArray(parsed.pages)) return [];
		return parsed.pages
			.filter((entry) => typeof entry.slug === "string" && entry.slug.trim().length > 0)
			.map((entry) => ({
				slug: String(entry.slug),
				title:
					typeof entry.title === "string" && entry.title.trim().length > 0
						? entry.title
						: String(entry.slug),
			}));
	});

	if (pages.length === 0) {
		throw new Error("No canonical pages found in praxity config");
	}

	return pages;
}

function formatAxeViolations(
	violations: Array<{
		id: string;
		impact?: string | null;
		description: string;
		nodes: unknown[];
	}>,
): string {
	return violations
		.map(
			(v) =>
				`[${v.id}] impact=${v.impact ?? "unknown"} nodes=${v.nodes.length} :: ${normalizeText(v.description)}`,
		)
		.join("\n");
}

export async function assertAxeScenario(page: Page, scenarioKey: string): Promise<void> {
	const results = await analyzeAxe(
		page,
		new AxeBuilder({ page }).withTags(AXE_TAGS).setLegacyMode(),
	);
	expect(
		results.violations,
		`${scenarioKey} violations:\n${formatAxeViolations(results.violations)}`,
	).toEqual([]);
}

export async function findPageWithSelector(
	page: Page,
	baseUrl: string,
	pages: CoursePageMeta[],
	selector: string,
): Promise<CoursePageMeta | null> {
	const courseUrl = baseUrl.replace(/\/$/, "");
	const cacheKey = `${process.env.PRAXITY_A11Y_ENV_PATH}\n${courseUrl}\n${selector}`;
	const inventory = process.env.PRAXITY_A11Y_ENV_PATH
		? readTestEnv().selectorPages?.[courseUrl]
		: undefined;
	const indexed = inventory?.[selector];
	if (indexed === null) return null;
	const cached = pageSelectorCache.get(cacheKey);
	const candidates = indexed ?? (cached ? [cached] : pages);
	for (const candidate of candidates) {
		await page.goto(`${baseUrl}/${candidate.slug}.html`);
		await waitForHydration(page);
		const ownerSelector = selector.match(/^\[data-(?:block-type|island)=[^\]]+\]/)?.[0];
		const target = page.locator(selector).first();
		const owners =
			(await target.count()) > 0
				? target.locator("xpath=ancestor-or-self::*[@data-island][1]")
				: ownerSelector
					? page.locator(`${ownerSelector}[data-island]`).first()
					: page.locator("[data-missing-discovery-owner]");
		for (const owner of await owners.all()) {
			if (await owner.isVisible()) {
				await owner.scrollIntoViewIfNeeded();
				await expect(owner).toHaveAttribute("data-hydrated", "");
			}
		}
		if ((await target.count()) > 0 && (await target.isVisible())) {
			pageSelectorCache.set(cacheKey, candidate);
			return candidate;
		}
	}
	pageSelectorCache.delete(cacheKey);
	return null;
}

export function normalizeHeadingText(value: string): string {
	return normalizeText(value).toLowerCase();
}

export const WEBKIT_TAB_ORDER_SKIP =
	"Sequential Tab order is a macOS/Safari user setting Playwright's WebKit cannot represent";
