import { expect, type Locator } from "@playwright/test";
import { contrastRatio } from "@praxity/shared-blocks/color-math";

type ColorQuery = {
	selector?: string;
	foreground: string;
	ownBackground?: boolean;
	mark?: boolean;
};

/** One browser round trip, with the same painted-background composition for every pair. */
function readReviewColors(rootOrRoots: Element | Element[], queries: ColorQuery[]) {
	const roots = Array.isArray(rootOrRoots) ? rootOrRoots : [rootOrRoots];
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 1;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Missing canvas context");
	const hex = () =>
		`#${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
			.map((channel) => channel.toString(16).padStart(2, "0"))
			.join("")}`;
	const measure = (element: Element, { foreground, ownBackground = true }: ColorQuery) => {
		const ancestry: Element[] = [];
		for (
			let node: Element | null = ownBackground ? element : element.parentElement;
			node;
			node = node.parentElement
		)
			ancestry.unshift(node);
		context.fillStyle = "#fff";
		context.fillRect(0, 0, 1, 1);
		for (const node of ancestry) {
			context.fillStyle = getComputedStyle(node).backgroundColor;
			context.fillRect(0, 0, 1, 1);
		}
		// Mantine paints its mark over the adjacent input's fill.
		const svg = element.closest("svg");
		if (svg?.previousElementSibling?.matches("input")) {
			context.fillStyle = getComputedStyle(svg.previousElementSibling).backgroundColor;
			context.fillRect(0, 0, 1, 1);
		}
		const background = hex();
		// Matching keeps semantic state on its input and paints the full answer
		// in a wrapping sibling. Measure that visible copy over the input's fill.
		const copy =
			foreground === "-webkit-text-fill-color"
				? element.closest(".praxity-matching-control")?.querySelector(".praxity-matching-value")
				: null;
		const choice = element.closest(".praxity-assessment-choice-option");
		const key = choice?.querySelector(".praxity-choice-key");
		const visibleKey = key && getComputedStyle(key).display !== "none" ? key : null;
		if (visibleKey && foreground === "background-color") {
			context.fillStyle = getComputedStyle(visibleKey).backgroundColor;
			context.fillRect(0, 0, 1, 1);
			return {
				foreground: hex(),
				background,
				opacity: "1",
				disabled: element.matches(":disabled"),
				checked: element.matches(":checked"),
			};
		}
		const styles = getComputedStyle(copy ?? visibleKey ?? element);
		context.fillStyle = styles.getPropertyValue(copy ? "color" : foreground);
		context.fillRect(0, 0, 1, 1);
		return {
			foreground: hex(),
			background,
			opacity: styles.opacity,
			disabled: element.matches(":disabled"),
			checked: element.matches(":checked"),
		};
	};
	return roots.map((root) => ({
		blockId: root.getAttribute("data-block-id"),
		colors: queries.map((query) => {
			const elements = query.selector ? Array.from(root.querySelectorAll(query.selector)) : [root];
			return elements.map((element) => {
				if (!query.mark) return measure(element, query);
				const choice = element.closest(".praxity-assessment-choice-option");
				if (choice) {
					const key = choice.querySelector(".praxity-choice-key");
					if (key && getComputedStyle(key).display !== "none")
						return measure(key, { foreground: "color" });
					if (getComputedStyle(element).appearance === "auto")
						return measure(element, { foreground: "color" });
					// The checkbox tick is a CSS border, painted over its input's fill.
					const tick = getComputedStyle(element, "::after");
					const pair = measure(element, { foreground: "background-color" });
					context.fillStyle = tick.borderTopColor;
					context.fillRect(0, 0, 1, 1);
					return { ...pair, foreground: hex(), opacity: tick.opacity };
				}
				let icon = element.nextElementSibling;
				while (icon && icon.localName !== "svg") icon = icon.nextElementSibling;
				const mark = icon?.querySelector("circle, path");
				if (!mark) throw new Error("Missing submitted selection mark");
				return measure(mark, query);
			});
		}),
	}));
}

type ColorPair = ReturnType<typeof readReviewColors>[number]["colors"][number][number];

function measuredContrast(pair: ColorPair) {
	expect(pair.opacity).toBe("1");
	return contrastRatio(pair.foreground, pair.background);
}

/** Composite the actual CSS colors over their painted ancestor backgrounds. */
export async function reviewContrast(target: Locator, foreground = "color", ownBackground = true) {
	const [result] = await target.evaluate(readReviewColors, [{ foreground, ownBackground }]);
	return measuredContrast(result.colors[0][0]);
}

/** Check all six submitted islands in the current viewport/text/forced-color state. */
export async function expectSubmittedReview(islands: Locator) {
	const evidence = await islands.evaluateAll(readReviewColors, [
		{ selector: "input:checked", foreground: "border-top-color", ownBackground: false },
		{ selector: "input:checked", foreground: "background-color", ownBackground: false },
		{ selector: "input:checked", foreground: "fill", mark: true },
		{ selector: 'select, [role="combobox"]', foreground: "-webkit-text-fill-color" },
		{ selector: 'button[aria-pressed="true"] + span', foreground: "color" },
	]);
	// Literal fixture inventory prevents a missing control from turning into an empty pass.
	expect(
		evidence.map(({ colors }) => [colors[0].length, colors[3].length, colors[4].length]),
	).toEqual([
		[1, 0, 0],
		[1, 0, 0],
		[0, 3, 0],
		[2, 0, 0],
		[4, 0, 0],
		[0, 0, 1],
	]);
	for (const {
		blockId,
		colors: [boundaries, fills, marks, selects, markers],
	} of evidence) {
		for (const [index, boundary] of boundaries.entries()) {
			expect(boundary.disabled, `${blockId}: submitted input disabled`).toBe(true);
			expect(boundary.checked, `${blockId}: submitted input checked`).toBe(true);
			// Either the border or fill identifies the control; the mark has its own threshold.
			expect(
				Math.max(measuredContrast(boundary), measuredContrast(fills[index])),
				`${blockId}: submitted control boundary against its row`,
			).toBeGreaterThanOrEqual(3);
			expect(
				measuredContrast(marks[index]),
				`${blockId}: submitted selection mark`,
			).toBeGreaterThanOrEqual(3);
		}
		for (const select of selects) {
			expect(select.disabled, `${blockId}: submitted matching select disabled`).toBe(true);
			expect(
				measuredContrast(select),
				`${blockId}: submitted matching text`,
			).toBeGreaterThanOrEqual(4.5);
		}
		for (const marker of markers)
			expect(measuredContrast(marker), `${blockId}: submitted hotspot text`).toBeGreaterThanOrEqual(
				4.5,
			);
	}
	return evidence;
}
