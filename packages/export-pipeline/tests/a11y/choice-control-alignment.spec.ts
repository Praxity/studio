import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { choiceBaselines } from "./choice-baselines";
import { readTestEnv } from "./helpers";

const SHOTS = process.env.PRAXITY_ALIGNMENT_SHOTS;
const PHASE = process.env.PRAXITY_ALIGNMENT_PHASE;

function choice(page: Page, title: string): Locator {
	return page.locator('[data-island="assessment"]').filter({
		has: page
			.locator(".praxity-assessment-stem-content")
			.filter({ hasText: new RegExp(`^${title}$`) }),
	});
}

async function textPositions(options: Locator): Promise<number[]> {
	return options.evaluateAll((rows) =>
		rows.map((row) => {
			const label = row.querySelector(".praxity-choice-label") ?? row.querySelector("span");
			if (!label) throw new Error("Choice option has no label text");
			const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const offset = node.textContent?.search(/\S/);
				if (offset === undefined || offset < 0) continue;
				const range = document.createRange();
				range.setStart(node, offset);
				range.setEnd(node, offset + 1);
				return range.getBoundingClientRect().left;
			}
			throw new Error("Choice option has no visible text");
		}),
	);
}

async function geometry(options: Locator) {
	return options.evaluateAll((rows) =>
		rows.map((row) => {
			const input = row.querySelector<HTMLInputElement>("input");
			const label = row.querySelector<HTMLElement>("label");
			if (!input || !label) throw new Error("Missing control or label");
			const control = input.getBoundingClientRect();
			const wrapper = input.parentElement?.getBoundingClientRect();
			if (!wrapper) throw new Error("Missing control wrapper");
			const labelBox = label.getBoundingClientRect();
			const style = getComputedStyle(label);
			const declaredLineHeight = Number.parseFloat(style.lineHeight);
			const choiceLabel = label.querySelector(".praxity-choice-label");
			const inlineLineHeight = choiceLabel
				? Number.parseFloat(getComputedStyle(choiceLabel).lineHeight)
				: declaredLineHeight;
			// The nested choice span can have a taller line height than Mantine's
			// label and expands the actual first line box. Native labels use their
			// own line height because they have no nested choice span.
			const lineHeight = Math.max(declaredLineHeight, inlineLineHeight);
			if (!Number.isFinite(lineHeight)) throw new Error("Label has no measurable line height");
			// Mantine's block label box starts at its first line box. Glyph bounds
			// differ across font engines, so alignment uses the CSS line box.
			const firstLineCenter =
				labelBox.top +
				Number.parseFloat(style.borderTopWidth) +
				Number.parseFloat(style.paddingTop) +
				lineHeight / 2;
			const rowBox = row.getBoundingClientRect();
			return {
				label: label.textContent,
				centerDifference: Math.abs(control.top + control.height / 2 - firstLineCenter),
				gapDifference: Math.abs(control.top - rowBox.top - (rowBox.bottom - control.bottom)),
				controlWidth: control.width,
				controlHeight: control.height,
				wrapperWidth: wrapper.width,
				wrapperHeight: wrapper.height,
				overflow: Math.max(
					0,
					wrapper.left - control.left,
					control.right - wrapper.right,
					wrapper.top - control.top,
					control.bottom - wrapper.bottom,
				),
				lineCount: Math.round(labelBox.height / lineHeight),
			};
		}),
	);
}

async function checkedColors(input: Locator) {
	return input.evaluate((element) => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas 2D context unavailable");
		const hex = () =>
			`#${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
				.map((channel) => channel.toString(16).padStart(2, "0"))
				.join("")}`;
		const ancestors: Element[] = [];
		for (let node = element.parentElement; node; node = node.parentElement) ancestors.unshift(node);
		context.fillStyle = "#fff";
		context.fillRect(0, 0, 1, 1);
		for (const ancestor of ancestors) {
			context.fillStyle = getComputedStyle(ancestor).backgroundColor;
			context.fillRect(0, 0, 1, 1);
		}
		const surrounding = hex();
		// Canvas converts rgb/oklch to the same sRGB bytes and composites alpha.
		const paint = (color: string, background: string, opacity = 1) => {
			context.globalAlpha = 1;
			context.fillStyle = background;
			context.fillRect(0, 0, 1, 1);
			context.globalAlpha = opacity;
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return hex();
		};
		const key = element
			.closest(".praxity-assessment-choice-option")
			?.querySelector(".praxity-choice-key");
		const style = getComputedStyle(key ?? element);
		const fill = paint(style.backgroundColor, surrounding, Number(style.opacity));
		const boundary = paint(style.borderTopColor, surrounding, Number(style.opacity));
		const icon = element.parentElement?.querySelector("svg");
		const iconStyle = icon ? getComputedStyle(icon) : null;
		const shape = icon?.querySelector("circle, path");
		let mark =
			iconStyle && shape
				? paint(getComputedStyle(shape).fill, fill, Number(iconStyle.opacity))
				: null;
		const nativeChoice = element.parentElement?.matches(".praxity-assessment-choice-option");
		const tick = nativeChoice && !key ? getComputedStyle(element, "::after") : null;
		if (key) mark = paint(style.color, fill);
		else if (tick) mark = paint(tick.borderTopColor, fill, Number(tick.opacity));
		const disabledColor = (token: string) => {
			const probe = document.createElement("span");
			probe.hidden = true;
			probe.style.color = `var(${token})`;
			element.parentElement?.append(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		};
		return {
			surrounding,
			fill,
			boundary,
			mark,
			disabledGrey: {
				fill: paint(disabledColor("--mantine-color-disabled"), surrounding),
				boundary: paint(disabledColor("--mantine-color-disabled-border"), surrounding),
				mark: paint(disabledColor("--mantine-color-disabled-color"), fill),
			},
			background: style.backgroundColor,
			border: style.borderTopColor,
			icon: iconStyle?.color ?? null,
			opacity: style.opacity,
			markOpacity: key ? "1" : (tick?.opacity ?? iconStyle?.opacity ?? null),
		};
	});
}

async function waitForControlPaint(page: Page): Promise<void> {
	await expect
		.poll(() =>
			page
				.locator(
					".praxity-assessment-choice-option, .praxity-matrix-table, .praxity-categorize-table",
				)
				.evaluateAll((elements) =>
					elements.some((element) => {
						// Animation reports alone can miss a newly selected fill. Resolve
						// its owning CSS token and wait for the actual painted colour too.
						const probe = document.createElement("span");
						probe.hidden = true;
						probe.style.backgroundColor = "var(--praxity-color-accent)";
						element.append(probe);
						const pendingFill = Array.from(element.querySelectorAll("input:checked")).some(
							(control) => {
								const row = control.closest(".praxity-assessment-choice-option");
								const key = row?.querySelector(".praxity-choice-key");
								row?.append(probe);
								probe.style.backgroundColor = row?.hasAttribute("data-choice-result")
									? "var(--choice-status-ink)"
									: "var(--praxity-color-accent)";
								return (
									getComputedStyle(key ?? control).backgroundColor !==
									getComputedStyle(probe).backgroundColor
								);
							},
						);
						probe.remove();
						return (
							pendingFill ||
							element
								.getAnimations({ subtree: true })
								.some((animation) => animation.playState === "running")
						);
					}),
				),
		)
		.toBe(false);
}

async function selectThroughRowAndWrapper(rows: Locator): Promise<void> {
	const row = rows.first();
	const input = row.locator("input");
	const clearSelection = async () => {
		if ((await input.getAttribute("type")) === "radio") {
			await rows.nth(1).locator("input").check();
		} else {
			await input.uncheck();
		}
	};
	await clearSelection();
	const bounds = await row.boundingBox();
	if (!bounds) throw new Error("Missing choice row bounds");
	await row.click({ position: { x: bounds.width - 14, y: bounds.height - 10 } });
	await expect(input, "Selecting row padding selects its control").toBeChecked();
	// The letter key/checkbox remains a direct target within the full row label.
	await clearSelection();
	const controlBounds = await row
		.locator(".praxity-choice-key, input[type=checkbox]")
		.boundingBox();
	const rowBounds = await row.boundingBox();
	if (!controlBounds || !rowBounds) throw new Error("Missing choice control bounds");
	// The invisible native radio covers the key, so hit its painted position
	// through the enclosing label rather than asking the key to receive events.
	await row.click({
		position: {
			x: controlBounds.x - rowBounds.x + controlBounds.width / 2,
			y: controlBounds.y - rowBounds.y + controlBounds.height / 2,
		},
	});
	await expect(input).toBeChecked();
}

test("choice paint waits for the generated key fill even without animation reports", async ({
	page,
}) => {
	await page.goto(`${readTestEnv().url}/choice-control-alignment/choice-control-alignment.html`);
	const assessment = choice(page, "Select one answer");
	await assessment.scrollIntoViewIfNeeded();
	await expect(assessment).toHaveAttribute("data-hydrated", "");
	const input = assessment.locator("input").first();
	await page.addStyleTag({
		content: ".praxity-choice-key { transition: background-color 1s linear; }",
	});
	// Reproduce missing browser animation reports while the real CSS colour
	// transition still runs. The measurement must wait for the selected fill.
	await assessment.locator(".praxity-assessment-choice-option").evaluateAll((rows) => {
		for (const row of rows) row.getAnimations = () => [];
	});
	await input.check();
	await waitForControlPaint(page);
	const colors = await checkedColors(input);
	expect(colors.fill).toBe("#294c78");
});

for (const width of [1280, 390]) {
	for (const textSize of ["default", "large"] as const) {
		test(`choice controls align at ${width}px with ${textSize} text`, async ({
			page,
		}, testInfo) => {
			test.setTimeout(60_000);
			await page.setViewportSize({ width, height: 900 });
			await page.addInitScript((textSize) => {
				localStorage.setItem("praxity-a11y", JSON.stringify({ textSize, focusChoice: false }));
				const mute = () => {
					for (const media of document.querySelectorAll("audio, video")) {
						(media as HTMLMediaElement).muted = true;
					}
				};
				document.addEventListener("DOMContentLoaded", mute);
			}, textSize);
			let releaseLoader = () => {};
			const loaderGate = new Promise<void>((resolveGate) => {
				releaseLoader = resolveGate;
			});
			await page.route("**/island-loader-*.js", async (route) => {
				await loaderGate;
				await route.continue();
			});
			const url = `${readTestEnv().url}/choice-control-alignment/choice-control-alignment.html`;
			let before: Awaited<ReturnType<typeof textPositions>>[];
			try {
				await page.goto(url, { waitUntil: "commit" });
				const single = choice(page, "Select one answer");
				const multiple = choice(page, "Select several answers");
				await expect(single).toBeVisible();
				if (textSize === "large") {
					await expect(page.locator("html")).toHaveAttribute("data-praxity-text-size", "large");
				} else {
					await expect(page.locator("html")).not.toHaveAttribute("data-praxity-text-size", "large");
				}
				await page.waitForFunction(() =>
					Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).every(
						(link) => link.sheet !== null,
					),
				);
				await page.evaluate(async () => {
					const label = document.querySelector(".praxity-choice-label");
					if (!label) throw new Error("Missing server-rendered option label");
					const style = getComputedStyle(label);
					// fonts.ready also waits for document loading. The paused deferred
					// loader deliberately keeps that pending until SSR is measured.
					await document.fonts.load(
						`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
						label.textContent ?? "First answer",
					);
				});
				const singleRows = single.locator(".praxity-assessment-choice-option");
				const multipleRows = multiple.locator(".praxity-assessment-choice-option");
				await expect(singleRows).toHaveCount(3);
				await expect(multipleRows).toHaveCount(3);
				before = [await textPositions(singleRows), await textPositions(multipleRows)];
				await expect(single).not.toHaveAttribute("data-hydrated");
			} finally {
				releaseLoader();
			}
			const single = choice(page, "Select one answer");
			const multiple = choice(page, "Select several answers");
			const singleRows = single.locator(".praxity-assessment-choice-option");
			const multipleRows = multiple.locator(".praxity-assessment-choice-option");
			for (const island of await page.locator("#main-content [data-island]").all()) {
				if (await island.isVisible()) {
					await island.scrollIntoViewIfNeeded();
					await expect(island).toHaveAttribute("data-hydrated", "");
				}
			}
			await page.evaluate(() => document.fonts.ready);
			const after = [await textPositions(singleRows), await textPositions(multipleRows)];
			const textButton = page.locator('[data-a11y-action="text"]');
			await expect(textButton).toHaveAttribute("aria-pressed", String(textSize === "large"));
			await textButton.click();
			await textButton.click();
			await single.locator("input").first().check();
			await multiple.locator("input").nth(0).check();
			await multiple.locator("input").nth(1).check();
			const screenshot = async (target: Locator, state: string) => {
				const name = `${testInfo.project.name}-${width}-${textSize}-${state}.png`;
				await target.screenshot({ path: testInfo.outputPath(name) });
				if (PHASE && SHOTS) {
					await mkdir(SHOTS, { recursive: true });
					await target.screenshot({ path: resolve(SHOTS, `${PHASE}-${name}`) });
				}
			};
			// Keep all requested visual evidence even when the first geometry check fails.
			await screenshot(single, "selected-single");
			await screenshot(multiple, "selected-multiple");
			await single.locator("input").nth(2).check();
			await screenshot(single, "selected-wrapped");
			await single.locator("input").first().check();
			await selectThroughRowAndWrapper(singleRows);
			await selectThroughRowAndWrapper(multipleRows);
			const geometryByChoice = [
				await choiceBaselines(singleRows),
				await choiceBaselines(multipleRows),
			];
			await waitForControlPaint(page);
			const enabled = [
				await checkedColors(single.locator("input").first()),
				await checkedColors(multiple.locator("input").first()),
			];
			for (const assessment of [single, multiple]) {
				await assessment.locator('[data-assessment-submit="true"]').click();
				await expect(assessment.locator("input").first()).toBeDisabled();
				await expect(assessment.locator("input").first()).toBeChecked();
			}
			await waitForControlPaint(page);
			const disabled = [
				await checkedColors(single.locator("input").first()),
				await checkedColors(multiple.locator("input").first()),
			];
			await testInfo.attach("choice-measurements", {
				body: JSON.stringify({ before, after, geometryByChoice, enabled, disabled }, null, 2),
				contentType: "application/json",
			});
			for (let group = 0; group < 2; group += 1) {
				for (let option = 0; option < 3; option += 1) {
					const result = geometryByChoice[group][option];
					const description = `${group === 0 ? "single" : "multiple"} option ${option + 1}`;
					expect.soft(result.delta, `${description} first-line baseline`).toBeLessThanOrEqual(1);
					expect
						.soft(result.shift, `${description} probe preserves geometry`)
						.toBeLessThanOrEqual(0.1);
					expect
						.soft(
							Math.abs(before[group][option] - after[group][option]),
							`${description} hydration text shift`,
						)
						.toBeLessThanOrEqual(1);
				}
				expect.soft(geometryByChoice[group][0].lines, "First answer is one line").toBe(1);
				expect.soft(geometryByChoice[group][2].lines, "Long answer wraps").toBeGreaterThan(1);
				// Submitted choices now take the status ink, preserving readable selection.
				for (const property of ["fill", "boundary", "mark"] as const) {
					expect
						.soft(disabled[group][property], `Submitted ${property} avoids Mantine disabled grey`)
						.not.toBe(disabled[group].disabledGrey[property]);
				}
				for (const state of [enabled[group], disabled[group]]) {
					expect.soft(state.opacity, "Checked control stays opaque").toBe("1");
					expect.soft(state.markOpacity, "Checked indicator stays opaque").toBe("1");
					expect
						.soft(
							contrastRatio(state.boundary, state.surrounding),
							"Checked control boundary contrasts with its surrounding row",
						)
						.toBeGreaterThanOrEqual(3);
					expect.soft(state.mark, "Checked control has a painted indicator").not.toBeNull();
					if (state.mark)
						expect
							.soft(
								contrastRatio(state.mark, state.fill),
								"Checked indicator contrasts with its fill",
							)
							.toBeGreaterThanOrEqual(3);
				}
			}
			const checklistRows = page.locator("[data-checklist-item]");
			await checklistRows.first().locator("input").check();
			const checklistGeometry = await geometry(checklistRows);
			for (const result of checklistGeometry) {
				expect.soft(result.controlWidth, `${result.label} checklist width`).toBe(22);
				expect.soft(result.controlHeight, `${result.label} checklist height`).toBe(22);
			}
			for (const row of await checklistRows.all())
				expect(
					(await row.boundingBox())?.height,
					"Checklist label retains a 44px target",
				).toBeGreaterThanOrEqual(44);
			const pickerRows = page.locator(".praxity-ag-radio-row");
			const pickerGeometry = await geometry(pickerRows);
			for (const result of [...checklistGeometry, ...pickerGeometry]) {
				if (pickerGeometry.includes(result)) {
					expect
						.soft(result.controlWidth, `${result.label} minimum width`)
						.toBeGreaterThanOrEqual(24);
					expect
						.soft(result.controlHeight, `${result.label} minimum height`)
						.toBeGreaterThanOrEqual(24);
				}
				expect
					.soft(result.centerDifference, `${result.label} first line alignment`)
					.toBeLessThanOrEqual(1);
				expect.soft(result.controlWidth).toBeLessThanOrEqual(result.wrapperWidth);
				expect.soft(result.controlHeight).toBeLessThanOrEqual(result.wrapperHeight);
				expect
					.soft(result.overflow, `${result.label} wrapper containment`)
					.toBeLessThanOrEqual(0.1);
			}
			for (const table of [".praxity-matrix-table", ".praxity-categorize-table"]) {
				const input = page.locator(`${table} input`).first();
				await input.check();
				await waitForControlPaint(page);
				const size = await input.evaluate((element) => ({
					control: element.getBoundingClientRect().toJSON(),
					wrapper: element.parentElement?.getBoundingClientRect().toJSON(),
				}));
				if (!size.wrapper) throw new Error("Table control has no wrapper");
				expect
					.soft(
						Math.max(
							0,
							size.wrapper.left - size.control.left,
							size.control.right - size.wrapper.right,
							size.wrapper.top - size.control.top,
							size.control.bottom - size.wrapper.bottom,
						),
						`${table} wrapper containment`,
					)
					.toBeLessThanOrEqual(0.1);
				expect.soft(size.control.width, `${table} minimum width`).toBeGreaterThanOrEqual(24);
				expect.soft(size.control.height, `${table} minimum height`).toBeGreaterThanOrEqual(24);
				expect
					.soft(size.control.width, `${table} control width`)
					.toBeLessThanOrEqual(size.wrapper?.width ?? 0);
				expect
					.soft(size.control.height, `${table} control height`)
					.toBeLessThanOrEqual(size.wrapper?.height ?? 0);
				const colors = await checkedColors(input);
				expect
					.soft(contrastRatio(colors.fill, colors.surrounding), `${table} checked control contrast`)
					.toBeGreaterThanOrEqual(3);
			}
		});
	}
}
