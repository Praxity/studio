import { describe, expect, it, vi } from "vitest";

const ALLOWED_UNSCOPED_SELECTORS = new Set([
	// The published learner document owns these page roots.
	"html",
	"body",
	// These global fallbacks keep keyboard focus visible in published output.
	"a:focus-visible",
	"button:focus-visible",
	"input:focus-visible",
	"select:focus-visible",
	"textarea:focus-visible",
]);

type Selector = { text: string; line: number };

function splitSelectorList(prelude: string, offset: number, css: string): Selector[] {
	const selectors: Selector[] = [];
	let start = 0;
	let parentheses = 0;
	let brackets = 0;
	let quote = "";

	const addSelector = (end: number) => {
		const part = prelude.slice(start, end);
		const leadingWhitespace = part.search(/\S/);
		if (leadingWhitespace === -1) return;
		selectors.push({
			text: part.trim(),
			line: css.slice(0, offset + start + leadingWhitespace).split("\n").length,
		});
	};

	for (let index = 0; index < prelude.length; index += 1) {
		const character = prelude[index];
		if (quote) {
			if (character === quote && prelude[index - 1] !== "\\") quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "(") parentheses += 1;
		else if (character === ")") parentheses -= 1;
		else if (character === "[") brackets += 1;
		else if (character === "]") brackets -= 1;
		else if (character === "," && parentheses === 0 && brackets === 0) {
			addSelector(index);
			start = index + 1;
		}
	}
	addSelector(prelude.length);
	return selectors;
}

function topLevelSelectors(css: string): Selector[] {
	const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
	const selectors: Selector[] = [];
	const contexts: Array<"rules" | "declarations" | "ignored"> = ["rules"];
	let boundary = 0;
	let quote = "";

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (quote) {
			if (character === quote && source[index - 1] !== "\\") quote = "";
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === ";") {
			boundary = index + 1;
			continue;
		}
		if (character === "}") {
			if (contexts.length > 1) contexts.pop();
			boundary = index + 1;
			continue;
		}
		if (character !== "{") continue;

		const rawPrelude = source.slice(boundary, index);
		const leadingWhitespace = rawPrelude.search(/\S/);
		const prelude = leadingWhitespace === -1 ? "" : rawPrelude.slice(leadingWhitespace).trimEnd();
		const context = contexts.at(-1);

		if (context === "ignored" || context === "declarations") {
			contexts.push("ignored");
		} else if (prelude.startsWith("@")) {
			contexts.push(/^@(media|supports|layer|container)\b/.test(prelude) ? "rules" : "ignored");
		} else {
			selectors.push(
				...splitSelectorList(prelude, boundary + Math.max(leadingWhitespace, 0), source),
			);
			contexts.push("declarations");
		}
		boundary = index + 1;
	}

	return selectors;
}

function firstCompound(selector: string): string {
	let parentheses = 0;
	let brackets = 0;
	for (let index = 0; index < selector.length; index += 1) {
		const character = selector[index];
		if (character === "(") parentheses += 1;
		else if (character === ")") parentheses -= 1;
		else if (character === "[") brackets += 1;
		else if (character === "]") brackets -= 1;
		else if (parentheses === 0 && brackets === 0 && /[\s>+~]/.test(character)) {
			return selector.slice(0, index);
		}
	}
	return selector;
}

describe("viewer stylesheet scope", () => {
	it("keeps bare element selectors out of the author renderer", async () => {
		const { readFile } = await vi.importActual<{
			readFile(path: string, encoding: "utf-8"): Promise<string>;
		}>("node:fs/promises");
		const css = await readFile(
			`${(import.meta as ImportMeta & { dirname: string }).dirname}/viewer-shell.css`,
			"utf-8",
		);
		const unscoped = topLevelSelectors(css).filter(({ text }) => {
			const compound = firstCompound(text);
			return (
				/^[a-z]/i.test(compound) &&
				!compound.includes(".praxity-") &&
				!compound.includes("[data-praxity-root]")
			);
		});
		const offenders = unscoped.filter(({ text }) => !ALLOWED_UNSCOPED_SELECTORS.has(text));
		const message = offenders
			.map(
				({ text, line }) =>
					`Unscoped selector "${text}" at viewer-shell.css:${line}; scope it under \`.praxity-viewer-shell\`.`,
			)
			.join("\n");

		expect(offenders, message).toEqual([]);
		expect(new Set(unscoped.map(({ text }) => text))).toEqual(ALLOWED_UNSCOPED_SELECTORS);
	});
});
