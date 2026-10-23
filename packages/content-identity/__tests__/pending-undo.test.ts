import { describe, expect, it } from "vitest";
import { type IdentityMapping, invertIdentityMapping } from "../src";

const id = "00000000-0000-4000-8000-000000000001";

describe("inverse mappings restore prior pending status", () => {
	it.each<IdentityMapping>([
		{ oldId: id, newId: id, fate: "pending" },
		{ oldId: id, newId: id, fate: "kept" },
	])("a continuing $fate node stays pending if it was already pending", (map) => {
		expect(invertIdentityMapping([map], new Set([id]))).toEqual([
			{ oldId: id, newId: id, fate: "pending" },
		]);
	});
	it.each<IdentityMapping>([
		{ oldId: id, newId: null, fate: "retired" },
		{ oldId: id, newId: null, fate: "pending" },
	])("a missing $fate node restores its recorded pending ID", (map) => {
		expect(invertIdentityMapping([map], new Set([id]))).toEqual([
			{ oldId: null, newId: id, fate: "pending" },
		]);
	});
	it("new provisional IDs retire even when other prior IDs were pending", () => {
		const fresh = "00000000-0000-4000-8000-000000000002";
		expect(
			invertIdentityMapping([{ oldId: null, newId: fresh, fate: "pending" }], new Set([id])),
		).toEqual([{ oldId: fresh, newId: null, fate: "retired" }]);
	});
});
