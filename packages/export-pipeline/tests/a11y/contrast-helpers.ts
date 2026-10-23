import type { Locator } from "@playwright/test";
import { contrastRatio } from "@praxity/shared-blocks/color-math";
import { waitForSettledStyles } from "./helpers";

export async function computedContrast(
	locator: Locator,
	foreground:
		| "color"
		| "backgroundColor"
		| "outlineColor"
		| "borderTopColor"
		| "borderLeftColor" = "color",
	includeOwnBackground = foreground === "color" || foreground === "borderTopColor",
	pseudoElement: string | null = null,
): Promise<number> {
	await waitForSettledStyles(locator.page());
	const pair = await locator.evaluate(
		(element, { foreground, includeOwnBackground, pseudoElement }) => {
			const canvas = document.createElement("canvas");
			canvas.width = 1;
			canvas.height = 1;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas 2D context unavailable");
			const ancestry: Element[] = [];
			for (
				let current: Element | null = includeOwnBackground ? element : element.parentElement;
				current;
				current = current.parentElement
			) {
				ancestry.unshift(current);
			}
			context.fillStyle = "#fff";
			context.fillRect(0, 0, 1, 1);
			for (const current of ancestry) {
				context.fillStyle = getComputedStyle(current).backgroundColor;
				context.fillRect(0, 0, 1, 1);
			}
			const toHex = () =>
				`#${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
					.map((channel) => channel.toString(16).padStart(2, "0"))
					.join("")}`;
			const background = toHex();
			context.fillStyle = getComputedStyle(element, pseudoElement)[foreground];
			context.fillRect(0, 0, 1, 1);
			return { foreground: toHex(), background };
		},
		{ foreground, includeOwnBackground, pseudoElement },
	);
	return contrastRatio(pair.foreground, pair.background);
}
