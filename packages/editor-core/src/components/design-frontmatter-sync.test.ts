import {
	findFrontmatterEndOffset,
	type GrammarFrontmatter,
	parseFrontmatter,
	serializeFrontmatter,
} from "@praxity/grammar";
import { GRAMMAR_YTEXT_FIELD } from "@praxity/shared-blocks/constants";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

function syncDesignFrontmatter(doc: Y.Doc, design: Record<string, unknown>) {
	const ytext = doc.getText(GRAMMAR_YTEXT_FIELD);
	const currentText = ytext.toString();
	if (!currentText) return;

	const { frontmatter: existing, body } = parseFrontmatter(currentText);
	const merged = { ...existing, design };
	const newText = serializeFrontmatter(merged as unknown as GrammarFrontmatter, body);

	if (newText === currentText) return;

	const oldFmEnd = findFrontmatterEndOffset(currentText);
	const newFmEnd = findFrontmatterEndOffset(newText);
	const newFmSection = newText.slice(0, newFmEnd);

	doc.transact(() => {
		ytext.delete(0, oldFmEnd);
		if (newFmSection.length > 0) {
			ytext.insert(0, newFmSection);
		}
	});
}

describe("design frontmatter sync", () => {
	it("writes design variants into Y.Text frontmatter", () => {
		const doc = new Y.Doc();
		const ytext = doc.getText(GRAMMAR_YTEXT_FIELD);
		ytext.insert(0, "---\ntitle: Test\n---\n\n# Hello");

		syncDesignFrontmatter(doc, { palette: "bold" });

		const result = parseFrontmatter(ytext.toString());
		expect(result.frontmatter.title).toBe("Test");
		// `bold` is a legacy palette name; the parser normalizes it to the current
		// `plum` via the shared course preset alias map.
		expect(result.frontmatter.design).toEqual({ palette: "plum" });
		expect(result.body).toBe("# Hello");
		expect(ytext.toString()).toMatch(/\n---\n\n# Hello$/);
	});

	it("creates frontmatter in Y.Text when none exists", () => {
		const doc = new Y.Doc();
		const ytext = doc.getText(GRAMMAR_YTEXT_FIELD);
		ytext.insert(0, "# Hello\nBody text");

		syncDesignFrontmatter(doc, { palette: "ocean" });

		const result = parseFrontmatter(ytext.toString());
		// Legacy `ocean` normalizes to `forest`.
		expect(result.frontmatter.design).toEqual({ palette: "forest" });
		expect(result.body).toBe("# Hello\nBody text");
	});

	it("round-trips design variants through Y.Text", () => {
		const doc = new Y.Doc();
		const ytext = doc.getText(GRAMMAR_YTEXT_FIELD);

		const design = {
			// Use the canonical palette so the
			// round-trip assertion is about Y.Text fidelity, not palette aliasing.
			palette: "ink",
			colorMode: "dark",
			accentHue: 300,
			backgroundTexture: "paper",
			highlightStyle: "scribble",
			imageHoverEffect: "glow",
			imageEffects: {
				colorWash: { intensity: 45, color: "#12abef" },
				progressiveBlur: { intensity: 8 },
				accentBlur: { intensity: 6 },
				motionBlur: { intensity: 10, direction: 45 },
				grain: { intensity: 25 },
				halftone: { intensity: 6 },
			},
			imageEffectsAuto: true,
			componentDefaults: { note: { style: "warning" } },
		};

		ytext.insert(0, serializeFrontmatter({ design } as unknown as GrammarFrontmatter, "# Content"));

		const { frontmatter } = parseFrontmatter(ytext.toString());
		expect(frontmatter.design).toEqual(design);
	});
});
