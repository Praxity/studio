import { expect, test } from "@playwright/test";
import {
	AUTHORING_CATALOG,
	AUTHORING_VISUAL_CASES,
	catalogSlug,
	visualCaseSlug,
} from "../fixtures/authoring-catalog";
import { readTestEnv } from "./helpers";

for (const serialized of [false, true]) {
	for (const mode of ["small", "full", "no-js"] as const) {
		test.describe(`hotspot ${serialized ? "saved" : "heading"} ${mode}`, () => {
			test.use({ javaScriptEnabled: mode !== "no-js" });
			test("retains a real learner question and named response group", async ({ page }) => {
				const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
				await page.goto(
					`${readTestEnv().url}/authoring-catalog/${catalogSlug("hotspot", serialized)}.html${query}`,
				);
				const block = page.locator('[data-block-type="assessment"]');
				if (mode === "full") await expect(block).toHaveAttribute("data-hydrated", "");
				await expect(block.locator(".praxity-assessment-stem")).toContainText(
					"Select the relevant areas on the image.",
				);
				await expect(
					block.getByRole("group", { name: /^Select the relevant areas on the image\./ }),
				).toBeVisible();
				await expect(block).not.toContainText("No question text");
				await expect(block.locator(".praxity-required-indicator")).toHaveText("Required");
				await expect(block.getByRole("button", { name: "Correct area", exact: true })).toBeEnabled({
					enabled: mode === "full",
				});
			});
		});
	}
}

for (const mode of ["small", "full"] as const) {
	test(`${mode} equation starter renders one visible named MathML expression`, async ({ page }) => {
		await page.goto(
			`${readTestEnv().url}/authoring-catalog/${catalogSlug("equation")}.html${mode === "small" ? "?minimal=1&praxity-small-preview=1" : ""}`,
		);
		const block = page.locator('[data-block-type="equation"]');
		await expect(block.locator("math")).toHaveCount(1);
		await expect(block.locator("math")).toBeVisible();
		await expect(block.locator(".katex-html")).toHaveCount(0);
		await expect(block.locator('[role="math"]')).toHaveAttribute("aria-label", /.+/);
	});
}

for (const mode of ["small", "full"] as const) {
	for (const keyword of ["card", "columns", "comparison", "sequence", "tabs", "accordion"]) {
		test(`${mode} preview keeps ${keyword} inside the content area`, async ({ page }) => {
			const entry = AUTHORING_CATALOG.find((item) => item.keyword === keyword);
			if (!entry) throw new Error(`Missing ${keyword} catalog entry`);
			const query = mode === "small" ? "?minimal=1&praxity-small-preview=1" : "";
			await page.goto(
				`${readTestEnv().url}/authoring-catalog/${catalogSlug(keyword)}.html${query}`,
			);
			const block = page.locator(`[data-block-type="${entry.type}"]`).first();
			await block.scrollIntoViewIfNeeded();
			const bounds = await block.evaluate((element) => {
				const parent = element.parentElement;
				if (!parent) throw new Error("Block has no content parent");
				const style = getComputedStyle(parent);
				const area = parent.getBoundingClientRect();
				const rect = element.getBoundingClientRect();
				return {
					left: rect.left,
					right: rect.right,
					start: area.left + Number.parseFloat(style.paddingLeft),
					end: area.right - Number.parseFloat(style.paddingRight),
					overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
				};
			});
			expect(bounds.left).toBeGreaterThanOrEqual(bounds.start - 1);
			expect(bounds.right).toBeLessThanOrEqual(bounds.end + 1);
			expect(bounds.overflow).toBeLessThanOrEqual(1);
		});
	}
}

test("matrix starter works by keyboard after hydration and stays inert in small preview", async ({
	page,
}) => {
	const url = `${readTestEnv().url}/authoring-catalog/${catalogSlug("matrix")}.html`;
	await page.goto(url);
	const block = page.locator('[data-block-type="assessment"]');
	await block.scrollIntoViewIfNeeded();
	await expect(block).toHaveAttribute("data-hydrated", "");
	const radio = block.getByRole("radio", { name: "Using the first skill: Not confident" });
	await radio.focus();
	await page.keyboard.press("Space");
	await expect(radio).toBeChecked();

	await page.goto(`${url}?minimal=1&praxity-small-preview=1`);
	await expect(block.getByRole("table")).toBeVisible();
	await expect(block.getByRole("radio").first()).toBeDisabled();
	await expect(block).not.toHaveAttribute("data-hydrated", "");
});

test("matching starter opens its choices after hydration", async ({ page }) => {
	await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("match")}.html`);
	const block = page.locator('[data-block-type="assessment"]');
	await block.scrollIntoViewIfNeeded();
	await expect(block).toHaveAttribute("data-hydrated", "");
	const input = block.getByRole("combobox").first();
	await input.click();
	await page.getByRole("option", { name: "Right item 1", exact: true }).click();
	await expect(input).toHaveValue("Right item 1");
});

for (const entry of AUTHORING_VISUAL_CASES) {
	test(`${entry.keyword} ${entry.parameter} respects the current compiled appearance`, async ({
		page,
	}) => {
		const appearances: Record<
			string,
			{
				background: string;
				border: string;
				shadow: string;
				size: string;
				transform: string;
				opacity: string;
				transition: string;
			}
		> = {};
		for (const value of entry.values) {
			await page.goto(
				`${readTestEnv().url}/authoring-catalog/${visualCaseSlug(entry.keyword, entry.parameter, value)}.html?minimal=1&praxity-small-preview=1`,
			);
			const target = page.locator(entry.selector).first();
			await expect(target).toHaveCount(1);
			appearances[value] = await target.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					background: style.backgroundColor,
					border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
					shadow: style.boxShadow,
					size: style.fontSize,
					transform: style.transform,
					opacity: style.opacity,
					transition: style.transitionDuration,
				};
			});
		}
		if (entry.keyword === "note") {
			for (const appearance of Object.values(appearances)) {
				expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
				expect(appearance.border).toMatch(/^1px solid /);
				expect(appearance.shadow).toBe("none");
				expect(appearance.size).toBe("19px");
			}
		} else if (entry.keyword === "stats") {
			for (const appearance of Object.values(appearances)) {
				expect(appearance.size).toBe("22px");
				expect(appearance.background).toBe("rgba(0, 0, 0, 0)");
				expect(appearance.shadow).toBe("none");
			}
		} else if (entry.keyword === "card" && ["style", "shadow"].includes(entry.parameter)) {
			expect(
				new Set(Object.values(appearances).map((appearance) => JSON.stringify(appearance))).size,
			).toBe(1);
		} else if (entry.parameter === "shadow") {
			expect(appearances.none.shadow).toBe("none");
			expect(appearances.subtle.shadow).not.toBe("none");
			expect(appearances.elevated.shadow).not.toBe(appearances.subtle.shadow);
		} else if (entry.parameter === "transition") {
			// Small previews omit the runtime: every authored card remains readable.
			for (const appearance of Object.values(appearances)) {
				expect(appearance.transition).toBe("0s");
				expect(appearance.opacity).toBe("1");
				expect(appearance.transform).toBe("none");
			}
		} else {
			const signatures = Object.values(appearances).map(
				({ background, border }) => `${background};${border}`,
			);
			expect(new Set(signatures).size).toBe(entry.values.length);
		}
	});
}

test.describe("JavaScript unavailable", () => {
	test.use({ javaScriptEnabled: false });
	test("retains the matrix question, rows, choices, and fallback explanation", async ({ page }) => {
		await page.goto(`${readTestEnv().url}/authoring-catalog/${catalogSlug("matrix")}.html`);
		const block = page.locator('[data-block-type="assessment"]');
		await expect(block).toContainText("How confident are you?");
		await expect(block.getByRole("rowheader", { name: "Using the first skill" })).toBeVisible();
		await expect(block.getByRole("radio")).toHaveCount(6);
		await expect(block.getByRole("radio").first()).toBeDisabled();
		await expect(block.locator("noscript")).toBeVisible();
		await expect(block).not.toHaveAttribute("data-hydrated", "");
	});
});
