import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

// Firefox uses 1/60px layout units; serialized rectangle differences can fall one unit short.
export const LAYOUT_UNIT = 1 / 60;

export function textFitsWithin(element: Locator): Promise<boolean> {
	return element.evaluate((button, layoutUnit) => {
		const bounds = button.getBoundingClientRect();
		const range = document.createRange();
		range.selectNodeContents(button);
		// Linux WebKit measured RTL text ending at 296.0000305px inside a 296px link,
		// a 0.00003px serialization overrun. Allow only one layout unit on either edge.
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

interface AxeBaselineEntry {
	id: string;
	count?: number;
}

type AxeBaseline = Record<string, AxeBaselineEntry[]>;

const AXE_BASELINE_PATH = resolve(import.meta.dirname, "axe-baseline.json");

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

let baselineCache: AxeBaseline | null = null;
const pageSelectorCache = new Map<string, CoursePageMeta>();

// SSR selector inventory for direct addressing. Visibility and hydration are
// still checked in the browser; compiled absence cannot be a timing miss.
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

function readAxeBaseline(): AxeBaseline {
	if (baselineCache) {
		return baselineCache;
	}
	baselineCache = readJsonFile<AxeBaseline>(AXE_BASELINE_PATH) ?? {};
	return baselineCache;
}

// Waits for the shell and navigation only. Reveal lazy blocks and await their own
// data-hydrated marker before interacting with or measuring their rendered content.
export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForSelector("html.praxity-js-loaded", { timeout: 15_000 });

	await expect(page.locator('[data-island="nav"]:not([data-hydrated])')).toHaveCount(0);
	// Hydration can finish during an authored entrance. Measure contrast after
	// visible rows reach their final opacity, keeping off-screen rows pending.
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
	// Visibility and hydration precede the final paint. Include ancestors via
	// document.getAnimations(), and recheck after another frame for chained motion.
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
		new AxeBuilder({ page })
			.withTags(AXE_TAGS)
			// Courses embed third-party players. Without this, axe descends into their
			// cross-origin documents and reports violations in markup we cannot fix --
			// and only when the embed happens to have loaded, so the suite fails about
			// one run in three. Our own iframe elements are still checked.
			.setLegacyMode(),
	);
	const baseline = readAxeBaseline();
	const expected = baseline[scenarioKey] ?? baseline["*"];
	if (!expected) {
		expect(
			results.violations,
			`${scenarioKey} violations:\n${formatAxeViolations(results.violations)}`,
		).toEqual([]);
		return;
	}

	const actual = results.violations.map((violation) => ({
		id: violation.id,
		count: violation.nodes.length,
	}));
	const allowedById = new Map(expected.map((entry) => [entry.id, entry]));
	const unexpected = actual.filter((entry) => !allowedById.has(entry.id));
	const unexpectedDetails = results.violations
		.filter((violation) => unexpected.some((entry) => entry.id === violation.id))
		.map((violation) => {
			const nodes = violation.nodes
				.map((node) => {
					const target = Array.isArray(node.target) ? node.target.join(", ") : String(node.target);
					return `${target} :: ${normalizeText(node.html)}`;
				})
				.join("\n");
			return `[${violation.id}] ${violation.help}\n${nodes}`;
		})
		.join("\n\n");
	expect(
		unexpected,
		`${scenarioKey} has violations outside baseline\n${unexpectedDetails}`,
	).toEqual([]);

	for (const entry of actual) {
		const expectedEntry = allowedById.get(entry.id);
		if (expectedEntry?.count != null) {
			expect(
				entry.count,
				`${scenarioKey} baseline mismatch for ${entry.id}: expected ${expectedEntry.count}, received ${entry.count}`,
			).toBe(expectedEntry.count);
		}
	}
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
		// Hydrate only an owning island. Generated controls must not be probed
		// before its import has completed, nor should unrelated blocks be woken.
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

/**
 * Reason string for skipping sequential-Tab assertions outside Chromium.
 *
 * Playwright's WebKit ships WebKit's default focus model: Tab reaches form fields
 * only, and skips `<a href>` and `<button>` entirely. Verified 2026-08 with a probe
 * page containing all three -- Chromium tabbed link -> button -> input, WebKit tabbed
 * to the input alone. On real macOS this is governed by two *user settings* (System
 * Settings -> Keyboard -> Keyboard Navigation, and Safari -> Settings -> Advanced ->
 * "Press Tab to highlight each item on a webpage"), neither of which Playwright
 * exposes, so a Tab-order assertion here measures the harness, not the page.
 *
 * Do NOT "fix" this by adding `tabindex="0"` to native controls -- that is a widely
 * circulated non-fix, unreliable even in Safari, and it breaks roving-tabindex
 * widgets. See `/a11y` sections 2.1 and 5. WebKit tab-order verification is manual,
 * with Full Keyboard Access on.
 *
 * Everything else in this suite -- axe, contrast, landmarks, headings, interactions,
 * text spacing -- still runs in both engines, which is where the WebKit-only defect
 * classes actually show up.
 */
export const WEBKIT_TAB_ORDER_SKIP =
	"Sequential Tab order is a macOS/Safari user setting Playwright's WebKit cannot represent";
