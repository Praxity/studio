import { describe, expect, it } from "vitest";
import { STANDALONE_NODE_RANGE, supportsStandaloneNode } from "../node-runtime";

describe("standalone Node LTS support", () => {
	it("declares the npm envelope for Node 24 and 26", () => {
		expect(STANDALONE_NODE_RANGE).toBe(">=24.22.1 <27");
	});
	it.each(["v24.22.1", "v24.23.0", "v26.1.0", "v26.13.1"])("accepts %s", (version) => {
		expect(supportsStandaloneNode(version)).toBe(true);
	});
	it.each(["v24.22.0", "v24.21.9", "v23.0.0", "v27.0.0", "v26.0.0-rc.1", "invalid"])(
		"rejects %s",
		(version) => {
			expect(supportsStandaloneNode(version)).toBe(false);
		},
	);
	it("rejects odd Node 25 even though it is inside the npm range", () => {
		expect(supportsStandaloneNode("v25.0.0")).toBe(false);
	});
});
