import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { registerPublisherGuardTests } from "./cli-publisher-test-support.mjs";

const release = parse(
	readFileSync(new URL("../../../.github/workflows/cli-release.yml", import.meta.url), "utf8"),
);
registerPublisherGuardTests(release);
test("formal handoff downloader explicitly grants Actions read", () => {
	assert.match(release.jobs.publish.steps[0].run, /gh run download/);
	assert.equal(release.jobs.publish.permissions.actions, "read");
});
test("formal build has only the admitted archive and browser commands, without secrets or write access", () => {
	const job = release.jobs.build;
	assert.equal(release.permissions.contents, "read");
	assert.deepEqual(release.env, {
		STUDIO_SOURCE_REPO: "${{ github.repository }}",
		STUDIO_CANDIDATE_REPO: "${{ github.repository }}",
	});
	assert.deepEqual(release.permissions, { contents: "read" });
	assert.equal(job.permissions, undefined);
	assert.doesNotMatch(
		JSON.stringify(job),
		/secrets\.|contents":"write|dist:mac|codesign|notari|authoring-smoke|action-gh-release|gh release/,
	);
	for (const entry of job.steps) {
		assert.equal(entry["continue-on-error"], undefined);
		assert.equal(
			entry.if,
			["Restore macOS keyboard navigation", "Clean candidate workspace and downloads"].includes(
				entry.name,
			)
				? "always()"
				: undefined,
		);
	}
	assert.deepEqual(
		job.steps.map((entry) => entry.name),
		[
			"Checkout workflow tooling",
			"Prepare candidate workspace",
			"Checkout source",
			"Setup pnpm",
			"Setup Node.js",
			"Install dependencies",
			"Install headless browsers",
			"Enable macOS keyboard navigation",
			"Build and verify standalone CLI archives",
			"Capture verified archive digests",
			"Restore macOS keyboard navigation",
			"Hand off private CLI candidate",
			"Upload release handoff",
			"Clean candidate workspace and downloads",
		],
	);
	const commands = job.steps
		.filter(
			(entry) =>
				entry.run &&
				![
					"Prepare candidate workspace",
					"Enable macOS keyboard navigation",
					"Capture verified archive digests",
					"Restore macOS keyboard navigation",
					"Hand off private CLI candidate",
					"Clean candidate workspace and downloads",
				].includes(entry.name),
		)
		.map((entry) => entry.run);
	assert.deepEqual(commands, [
		'pnpm install --frozen-lockfile --store-dir "$RUNNER_TEMP/cli-candidate-$GITHUB_RUN_ID/pnpm-store"',
		"pnpm --filter @praxity/desktop exec playwright install chromium firefox webkit",
		'source "$GITHUB_WORKSPACE/workflow/apps/desktop/scripts/prepare-macos-tmpdir.sh"\nbash ../workflow/apps/desktop/scripts/build-cli-archives.sh --browser-editor\n',
	]);
});

test("formal publisher binds both digest inputs to the build outputs", () => {
	const env = release.jobs.publish.steps.find((step) => step.id === "candidate").env;
	for (const arch of ["ARM64", "X64"]) {
		assert.equal(
			env[`EXPECTED_${arch}_NAME`],
			`\${{ needs.build.outputs.${arch.toLowerCase()}_name }}`,
		);
		assert.equal(
			env[`EXPECTED_${arch}_SHA256`],
			`\${{ needs.build.outputs.${arch.toLowerCase()}_sha256 }}`,
		);
	}
});
