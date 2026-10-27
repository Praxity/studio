import type { Locator } from "@playwright/test";

// A zero-size inline box exposes the actual text baseline, independent of glyph
// ascent or the line box's top. The generated key is measured with an equivalent
// text child; its dimensions must stay identical while the probe is installed.
export async function choiceBaselines(rows: Locator) {
	return rows.evaluateAll((elements) =>
		elements.map((row) => {
			const text = row.querySelector<HTMLElement>(".praxity-choice-label");
			const input = row.querySelector<HTMLInputElement>("input");
			if (!text || !input) throw new Error("Missing choice text or input");
			const probe = () => {
				const span = document.createElement("span");
				span.style.cssText =
					"display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline";
				return span;
			};
			const textProbe = probe();
			text.prepend(textProbe);
			const baseline = textProbe.getBoundingClientRect().top;
			const key = row.querySelector<HTMLElement>(".praxity-choice-key");
			let controlBaseline = input.getBoundingClientRect().bottom;
			let shift = 0;
			if (key) {
				const before = key.getBoundingClientRect();
				const rule = document.createElement("style");
				rule.textContent = ".praxity-choice-key[data-baseline-probe]::before { content:none }";
				document.head.append(rule);
				key.dataset.baselineProbe = "";
				const letter = document.createElement("span");
				letter.style.setProperty(
					"text-box",
					getComputedStyle(key, "::before").getPropertyValue("text-box"),
				);
				letter.textContent = "A";
				const keyProbe = probe();
				letter.append(keyProbe);
				key.append(letter);
				controlBaseline = keyProbe.getBoundingClientRect().top;
				shift = Math.abs(before.top - key.getBoundingClientRect().top);
				letter.remove();
				delete key.dataset.baselineProbe;
				rule.remove();
			}
			const range = document.createRange();
			range.selectNodeContents(text);
			const lines = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
			textProbe.remove();
			return {
				delta: Math.abs(baseline - controlBaseline),
				shift,
				lines: new Set(lines.map((r) => r.top)).size,
			};
		}),
	);
}
