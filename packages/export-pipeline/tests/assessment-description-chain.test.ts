import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readLesson as readSource } from "@praxity/grammar";
import { adaptGrammarPreviewBlocks } from "@praxity/shared-blocks/grammar-adapter";
import type { AssessmentBlockData, PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { renderBlockHtml } from "../src/render-block-html.ts";

const ROUNDTRIP_FIXTURE = resolve(
	import.meta.dirname,
	"../../../docs/test-fixtures/renderer-fidelity.prax",
);

/**
 * The editor preview, the desktop page preview, and the published viewer all
 * feed grammar through readSource → adaptGrammarPreviewBlocks → the shared
 * blocks. Asserting on that chain covers all three at once.
 */
function chain(source: string): PraxityBlock[] {
	return adaptGrammarPreviewBlocks(readSource(source).blocks);
}

function assessments(blocks: PraxityBlock[]): AssessmentBlockData[] {
	return blocks
		.filter((block) => block.type === "assessment")
		.map((block) => block.data as unknown as AssessmentBlockData);
}

describe("assessment description + placeholder — parse → adapt chain", () => {
	it("carries description and placeholder from grammar source to block data", () => {
		const blocks = chain(
			"---\ntitle: T\n---\n\n# Untitled {hideTitle}\n\n::: choice Which PPE is required? {level=3}\nYou are inspecting a **live** site at dusk.\n( ) Safety glasses only\n(x) Hard hat and high-vis vest\n:::\n\n# Untitled {hideTitle}\n\n::: free-response Describe three improvements. {level=3}\nConsider both physical and procedural changes.\nplaceholder: Type your three ideas here\n:::\n",
		);

		const [choice, freeResponse] = assessments(blocks);

		expect(choice.description?.[0]?.data.content).toBe(
			"<p>You are inspecting a <strong>live</strong> site at dusk.</p>",
		);
		expect(freeResponse.description?.[0]?.data.content).toBe(
			"<p>Consider both physical and procedural changes.</p>",
		);
		expect((freeResponse.response as { placeholder?: string }).placeholder).toBe(
			"Type your three ideas here",
		);
	});

	it("leaves description and placeholder unset when the author omits them", () => {
		const blocks = chain(
			"---\ntitle: T\n---\n\n# Untitled {hideTitle}\n\n::: choice Which PPE is required? {level=3}\n( ) Safety glasses only\n(x) Hard hat and high-vis vest\n:::\n",
		);
		const [choice] = assessments(blocks);
		expect(choice.description).toBeUndefined();
		expect((choice.response as { placeholder?: string }).placeholder).toBeUndefined();
	});

	it("renders the description into the no-JS fallback and points the fieldset at it", () => {
		const blocks = chain(
			"---\ntitle: T\n---\n\n# Untitled {hideTitle}\n\n::: choice Which PPE is required? {level=3}\nRead the site notice first.\n( ) Safety glasses only\n(x) Hard hat and high-vis vest\n:::\n",
		);
		const block = blocks.find((candidate) => candidate.type === "assessment");
		if (!block) throw new Error("expected an assessment block");
		const html = renderBlockHtml(block);

		expect(html).toContain(`id="${block.id}-description"`);
		expect(html).toContain("Read the site notice first.");
		const document = new JSDOM(html).window.document;
		const descriptionId = document.querySelector("fieldset")?.getAttribute("aria-describedby");
		expect(descriptionId).toBe(`${block.id}-description`);
		expect(document.getElementById(descriptionId ?? "")?.textContent).toContain(
			"Read the site notice first.",
		);
	});

	it("omits the fallback description wrapper when unset", () => {
		const blocks = chain(
			"---\ntitle: T\n---\n\n# Untitled {hideTitle}\n\n::: choice Which PPE is required? {level=3}\n( ) Safety glasses only\n(x) Hard hat and high-vis vest\n:::\n",
		);
		const block = blocks.find((candidate) => candidate.type === "assessment");
		if (!block) throw new Error("expected an assessment block");
		const html = renderBlockHtml(block);

		expect(html).not.toContain("praxity-assessment-description");
		const fieldset = new JSDOM(html).window.document.querySelector("fieldset");
		expect(fieldset).not.toBeNull();
		expect(fieldset?.hasAttribute("aria-describedby")).toBe(false);
	});

	it("carries the fixture's authored description and placeholder through the chain", async () => {
		const source = await readFile(ROUNDTRIP_FIXTURE, "utf-8");
		const all = assessments(chain(source));

		const withDescription = all.filter((data) => data.description);
		expect(withDescription.length).toBeGreaterThanOrEqual(3);

		const freeResponse = all.find((data) => data.assessmentType === "textResponse");
		expect((freeResponse?.response as { placeholder?: string })?.placeholder).toBe(
			"Type your three ideas here",
		);

		const matching = all.find((data) => data.assessmentType === "matching");
		expect((matching?.response as { placeholder?: string })?.placeholder).toBe("Choose a control");
	});
});
