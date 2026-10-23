import type { PraxityBlock } from "@praxity/content-model/types";
import { afterEach, describe, expect, it } from "vitest";
import { clearRegisteredSchemas, registerSchema } from "../../src/validation/schema-registry.ts";
import { validate } from "../../src/validation/validate.ts";
import type { BlockSchema } from "../../src/validation/validation-types.ts";
import { readBlockFixture as readBlockSource } from "../helpers/lesson-fixture.ts";

const testSchema: BlockSchema = {
	keyword: "text",
	blockType: "text",
	attributes: {
		title: {
			type: "string",
			required: true,
		},
	},
	validate(block) {
		return [
			{
				id: "test-info",
				level: "info",
				message: "Informational finding",
				blockId: block.id,
				blockType: block.type,
			},
			{
				id: "test-critical",
				level: "critical",
				message: "Critical finding",
				blockId: block.id,
				blockType: block.type,
			},
		];
	},
};

function createTextBlock(id: string, data: Record<string, unknown> = {}): PraxityBlock {
	return {
		id,
		type: "text",
		data,
	};
}

afterEach(() => {
	clearRegisteredSchemas();
});

describe("validate", () => {
	it("applies strictness filtering", () => {
		registerSchema(testSchema);
		const blocks = [createTextBlock("text-1")];
		const source = "Only one paragraph";

		const strict = validate(blocks, source, { strictness: "strict" });
		expect(strict.errors.map((error) => error.id)).toEqual([
			"missing-title",
			"test-info",
			"test-critical",
		]);

		const normal = validate(blocks, source, { strictness: "normal" });
		expect(normal.errors.map((error) => error.id)).toEqual(["missing-title", "test-critical"]);

		const lenient = validate(blocks, source, { strictness: "lenient" });
		expect(lenient.errors.map((error) => error.id)).toEqual(["missing-title", "test-critical"]);
	});

	it("applies suppressions by error id", () => {
		registerSchema(testSchema);
		const blocks = [createTextBlock("text-1")];
		const source = "Only one paragraph";

		const result = validate(blocks, source, {
			strictness: "strict",
			suppressions: ["missing-title", "test-critical"],
		});

		expect(result.errors.map((error) => error.id)).toEqual(["test-info"]);
		expect(result.hasErrors).toBe(false);
		expect(result.hasCritical).toBe(false);
	});

	it("returns counts and aggregate booleans", () => {
		registerSchema(testSchema);
		const blocks = [createTextBlock("text-1")];
		const source = "Only one paragraph";

		const result = validate(blocks, source, { strictness: "strict" });

		expect(result.counts).toEqual({
			debug: 0,
			info: 1,
			warning: 0,
			error: 1,
			critical: 1,
		});
		expect(result.hasErrors).toBe(true);
		expect(result.hasCritical).toBe(true);
	});

	it("reports source line numbers from supplied reader coordinates", () => {
		registerSchema(testSchema);
		const blocks = [createTextBlock("text-1"), createTextBlock("text-2")];
		const source = "---\ntitle: Test\n---\n\nFirst paragraph\n\nSecond paragraph";

		const result = validate(blocks, source, {
			strictness: "normal",
			spans: new Map([
				["text-1", { startLine: 4, endLine: 4 }],
				["text-2", { startLine: 6, endLine: 6 }],
			]),
		});

		expect(result.errors).toHaveLength(4);
		const missingTitleErrors = result.errors.filter((error) => error.id === "missing-title");
		expect(missingTitleErrors).toHaveLength(2);
		expect(missingTitleErrors[0]?.line).toBe(5);
		expect(missingTitleErrors[1]?.line).toBe(7);
	});

	it.each(["#####", "######"])(
		"locates a scored-choice diagnostic under a %s heading",
		(heading) => {
			const source = `---
title: Test
---

# Introduction

::: choice Test {scored level=${heading.length}}
( ) A
( ) B
:::
`;
			const { blocks, spans } = readBlockSource(source);
			const assessment = blocks.find((block) => block.type === "assessment");
			expect(assessment).toBeDefined();

			const result = validate(blocks, source, { spans });
			expect(
				result.errors.find((error) => error.id === "assessment-no-correct-answer"),
			).toMatchObject({ blockId: assessment?.id, line: 7 });
		},
	);
});
