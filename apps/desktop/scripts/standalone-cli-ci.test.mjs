import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import picomatch from "picomatch";
import { parse } from "yaml";

test("standalone CLI proof runs nightly on hosted Intel macOS, never on PR code", async () => {
	const workflow = parse(
		await readFile(new URL("../../../.github/workflows/cli-proof.yml", import.meta.url), "utf8"),
	);
	assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
	assert.equal(workflow.on.schedule.length, 1);
	assert.equal(workflow.on.schedule[0].cron, "0 12 * * *");
	assert.deepEqual(workflow.jobs.proof["runs-on"], "macos-15-intel");
	assert.deepEqual(workflow.permissions, { contents: "read" });
	const checkout = workflow.jobs.proof.steps.find((step) =>
		String(step.uses).startsWith("actions/checkout@"),
	);
	assert.equal(checkout.with.ref, "main");
	const commands = workflow.jobs.proof.steps.map((step) => step.run).filter(Boolean);
	assert.ok(commands.includes("pnpm install --frozen-lockfile"));
	assert.ok(commands.indexOf("pnpm build:cli") < commands.indexOf("pnpm test:cli"));
	assert.ok(commands.includes("pnpm test:cli"));
	const ci = parse(
		await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
	);
	const filters = parse(ci.jobs.changes.steps.find((step) => step.id === "filter").with.filters);
	assert.ok(
		picomatch(filters.code)(".github/workflows/cli-proof.yml"),
		"Workflow-only changes must run the CI contract test",
	);
});
