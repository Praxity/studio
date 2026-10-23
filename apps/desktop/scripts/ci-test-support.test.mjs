import assert from "node:assert/strict";
import test from "node:test";
import { couldBeSelfHosted, isPrivateWorkflow, workflowFunction } from "./ci-test-support.mjs";

test("workflow expression fixtures default to pre-cutover but retain an explicit source override", () => {
	const expression = "return github.repository == (vars.STUDIO_SOURCE_REPO || github.repository)";
	assert.equal(workflowFunction(expression)(), true);
	assert.equal(workflowFunction("github", expression)({ repository: "fixture/source" }), true);
	assert.equal(
		workflowFunction(
			"github",
			"vars",
			expression,
		)({ repository: "fixture/candidates" }, { STUDIO_SOURCE_REPO: "fixture/source" }),
		false,
	);
});

test("private workflow exemption requires the exact reviewed bytes, not only its name", () => {
	const manifest = {
		workflows: ["macos-nightly.yml"],
		workflowSha256: {
			"macos-nightly.yml": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		},
	};
	assert.equal(isPrivateWorkflow("macos-nightly.yml", Buffer.from("hello"), manifest), true);
	assert.equal(
		isPrivateWorkflow(
			"macos-nightly.yml",
			Buffer.from("runs-on: [self-hosted, praxity-mbp]"),
			manifest,
		),
		false,
	);
	assert.equal(isPrivateWorkflow("new.yml", Buffer.from("hello"), manifest), false);
	assert.equal(
		isPrivateWorkflow("macos-nightly.yml", Buffer.from("hello"), { workflows: manifest.workflows }),
		false,
	);
});

for (const matrix of [
	"${{ fromJSON(inputs.m) }}",
	{},
	{ runner: [] },
	{ include: "${{ fromJSON(inputs.m) }}" },
])
	test(`unresolved runner matrix is private: ${JSON.stringify(matrix)}`, () => {
		assert.equal(couldBeSelfHosted("${{ matrix.runner }}", matrix), true);
	});
