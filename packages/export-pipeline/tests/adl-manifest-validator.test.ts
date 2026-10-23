import { describe, expect, it } from "vitest";
import { assertAdlManifestPassed, resolveAdlManifestTools } from "./adl-manifest-validator";

const stdout = `The Manifest Test Subject Passed All Checkpoints
Total Files Tested : 1
Total Passed : 1
Total Failed : 0
`;

describe("ADL Manifest Tester result", () => {
	it("accepts exactly one passing package", () => {
		expect(() => assertAdlManifestPassed({ status: 0, stdout, stderr: "" })).not.toThrow();
	});
	it.each([
		[
			"zero-exit validation failure",
			stdout
				.replace("Total Passed : 1", "Total Passed : 0")
				.replace("Total Failed : 0", "Total Failed : 1"),
		],
		["no packages tested", stdout.replace("Total Files Tested : 1", "Total Files Tested : 0")],
		["multiple packages", stdout.replace("Total Files Tested : 1", "Total Files Tested : 2")],
		[
			"missing success marker",
			stdout.replace("The Manifest Test Subject Passed All Checkpoints", ""),
		],
		["missing summary", "The Manifest Test Subject Passed All Checkpoints"],
		["duplicate summary", `${stdout}Total Passed : 1\n`],
		["contradictory failure", `${stdout}\tFAILED : Missing controlling document\n`],
	] as const)("rejects %s even with exit zero", (_label, output) => {
		expect(() => assertAdlManifestPassed({ status: 0, stdout: output, stderr: "" })).toThrow();
	});
	it("rejects process failures and stderr even with passing output", () => {
		for (const result of [
			{ status: 1, stdout, stderr: "" },
			{ status: 0, stdout, stderr: "Java error" },
			{ status: null, stdout: "", stderr: "", error: new Error("spawn failed") },
		])
			expect(() => assertAdlManifestPassed(result)).toThrow();
	});
	it("skips absent tools in developer mode but throws in gate mode", () => {
		expect(resolveAdlManifestTools({})).toBeUndefined();
		for (const env of [
			{ PRAXITY_GATE: "1" },
			{ PRAXITY_GATE: "1", PRAXITY_JAVA: "java" },
			{ PRAXITY_GATE: "1", PRAXITY_ADL_VALIDATOR: "adlvalidator.jar" },
		])
			expect(() => resolveAdlManifestTools(env)).toThrow(/PRAXITY_(JAVA|ADL_VALIDATOR)/);
	});
});
