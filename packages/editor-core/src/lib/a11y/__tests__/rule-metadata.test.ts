import { describe, expect, it } from "vitest";
import { getRuleMetadata, isExportBlockingIssue } from "../rule-metadata";

describe("accessibility rule policy", () => {
	it("blocks only proven high-confidence critical conformance failures", () => {
		expect(isExportBlockingIssue({ rule: "image-alt", outcome: "failed" })).toBe(true);
		expect(isExportBlockingIssue({ rule: "heading-hierarchy", outcome: "failed" })).toBe(false);
		expect(isExportBlockingIssue({ rule: "image-alt", outcome: "cantTell" })).toBe(false);
	});

	it("rejects emitted rules without reviewed metadata", () => {
		expect(() => getRuleMetadata("unregistered-rule")).toThrow(
			"Missing accessibility metadata for rule: unregistered-rule",
		);
	});
});
