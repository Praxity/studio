import { describe, expect, it } from "vitest";
import {
	clearRegisteredSchemas,
	ensureBuiltInSchemasRegistered,
	getSchemaForBlockType,
	registerSchema,
} from "../../src/validation/schema-registry.ts";
import type { BlockSchema } from "../../src/validation/validation-types.ts";

const customTextSchema: BlockSchema = {
	keyword: "text",
	blockType: "text",
	attributes: {},
};

describe("schema registry", () => {
	it("contains built-in schemas", () => {
		expect(getSchemaForBlockType("image")).toBeDefined();
		expect(getSchemaForBlockType("assessment")).toBeDefined();
		expect(getSchemaForBlockType("assessmentGroup")).toBeDefined();
	});

	it("registers custom schemas", () => {
		registerSchema(customTextSchema);
		expect(getSchemaForBlockType("text")).toEqual(customTextSchema);
	});

	it("can clear and restore built-in schemas", () => {
		clearRegisteredSchemas();
		expect(getSchemaForBlockType("image")).toBeUndefined();

		ensureBuiltInSchemasRegistered();
		expect(getSchemaForBlockType("image")).toBeDefined();
	});
});
