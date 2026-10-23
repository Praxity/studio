import { isSectionPalette } from "@praxity/content-model";
import type { PraxityBlock } from "./types";

export const promptBlockKeys = [
	"id",
	"type",
	"data",
	"name",
	"visible",
	"locale",
	"sectionTheme",
	"a11y",
	"layout",
];

/** The shared explicit outer metadata whitelist for staged-answer prompts. */
export function constructPromptBlockMetadata(
	block: Record<string, unknown>,
	invalidPrompt: () => Error,
	validateName: (value: unknown) => string,
): Omit<PraxityBlock, "id" | "type" | "data"> {
	const result: Omit<PraxityBlock, "id" | "type" | "data"> = {};
	function record(value: unknown): Record<string, unknown> {
		if (
			!value ||
			typeof value !== "object" ||
			![Object.prototype, null].includes(Object.getPrototypeOf(value))
		)
			throw invalidPrompt();
		return value as Record<string, unknown>;
	}
	function onlyKeys(value: object, keys: readonly string[]) {
		if (
			Reflect.ownKeys(value).some(
				(key) =>
					typeof key !== "string" ||
					!keys.includes(key) ||
					!Object.getOwnPropertyDescriptor(value, key)?.enumerable,
			)
		)
			throw invalidPrompt();
	}
	function nonblank(value: unknown): string {
		if (typeof value !== "string" || !value.trim()) throw invalidPrompt();
		return value;
	}
	if (Object.hasOwn(block, "name")) result.name = validateName(block.name) as string;
	if (Object.hasOwn(block, "locale")) {
		const locale = nonblank(block.locale);
		if (!/^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i.test(locale)) throw invalidPrompt();
		Intl.getCanonicalLocales(locale);
		result.locale = locale;
	}
	if (Object.hasOwn(block, "visible")) {
		const visible = block.visible;
		if (typeof visible !== "boolean") throw invalidPrompt();
		result.visible = visible;
	}
	if (Object.hasOwn(block, "sectionTheme")) {
		const sectionTheme = block.sectionTheme;
		if (!isSectionPalette(sectionTheme)) throw invalidPrompt();
		result.sectionTheme = sectionTheme;
	}
	if (Object.hasOwn(block, "a11y")) {
		const a11y = record(block.a11y);
		onlyKeys(a11y, ["altText", "ariaLabel", "decorative"]);
		result.a11y = {};
		for (const key of ["altText", "ariaLabel"] as const) {
			if (!Object.hasOwn(a11y, key)) continue;
			const value = a11y[key];
			if (typeof value !== "string") throw invalidPrompt();
			result.a11y[key] = value;
		}
		if (Object.hasOwn(a11y, "decorative")) {
			const decorative = a11y.decorative;
			if (typeof decorative !== "boolean") throw invalidPrompt();
			result.a11y.decorative = decorative;
		}
	}
	if (Object.hasOwn(block, "layout")) {
		const layout = record(block.layout);
		onlyKeys(layout, ["width", "alignment"]);
		const width = layout.width;
		if (width !== "full" && width !== "half" && width !== "third") throw invalidPrompt();
		result.layout = { width };
		if (Object.hasOwn(layout, "alignment")) {
			const alignment = layout.alignment;
			if (alignment !== "left" && alignment !== "center" && alignment !== "right")
				throw invalidPrompt();
			result.layout.alignment = alignment;
		}
	}
	return result;
}
