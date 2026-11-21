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
			"Build and verify standalone CLI archives",
			"Capture verified archive digests",
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
		'source "$GITHUB_WORKSPACE/workflow/apps/desktop/scripts/prepare-macos-tmpdir.sh"\nbash ../workflow/apps/desktop/scripts/build-cli-archives.sh\n',
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

test("formal release shards every packaged browser engine and gates publication on all shards", () => {
	const job = release.jobs["browser-editor"];
	assert.deepEqual(job.needs, ["admit", "build"]);
	assert.equal(job["runs-on"], "macos-15-intel");
	assert.equal(job.strategy["fail-fast"], false);
	assert.deepEqual(job.strategy.matrix, {
		browser: ["chromium", "firefox", "webkit"],
		shard: ["1/3", "2/3", "3/3"],
	});
	assert.equal(job["continue-on-error"], undefined);
	const step = (name) => job.steps.find((entry) => entry.name === name);
	assert.equal(step("Checkout source").with.ref, "${{ needs.admit.outputs.source_ref }}");
	assert.deepEqual(step("Download sealed CLI archives").with, {
		name: "cli-release-handoff",
		path: "source/apps/desktop/release",
	});
	const extract = step("Verify and extract native archive");
	assert.deepEqual(extract.env, {
		ARCHIVE_NAME: "${{ needs.build.outputs.x64_name }}",
		ARCHIVE_SHA256: "${{ needs.build.outputs.x64_sha256 }}",
	});
	assert.match(extract.run, /shasum -a 256 "\$ARCHIVE_NAME"/);
	assert.match(extract.run, /\[\[ "\$\{actual%% \*\}" == "\$ARCHIVE_SHA256" \]\] \|\| exit 1/);
	assert.match(extract.run, /tar -xzf "\$ARCHIVE_NAME" -C \.\.\/\.\.\/\.\.\/dist/);
	const journeys = step("Verify packaged browser journeys");
	assert.equal(journeys.if, undefined);
	assert.equal(journeys["continue-on-error"], undefined);
	assert.equal(journeys["timeout-minutes"], 45);
	assert.ok(job["timeout-minutes"] > journeys["timeout-minutes"]);
	assert.equal(
		journeys.run.split("\n")[1],
		'PRAXITY_BROWSER_ARTIFACT="$PWD/dist/studio-cli" pnpm --filter @praxity/desktop run e2e:browser-editor --project="${{ matrix.browser }}" --shard="${{ matrix.shard }}"',
	);
	assert.deepEqual(release.jobs.publish.needs, ["build", "browser-editor"]);
});

test("formal browser shards prepare source fixture assets before packaged journeys", () => {
	const steps = release.jobs["browser-editor"].steps;
	const prebuild = steps.find((step) => step.name === "Prepare source fixture assets");
	assert.ok(prebuild);
	assert.equal(prebuild.run, "pnpm --filter @praxity/desktop prebuild");
	assert.equal(prebuild.if, undefined);
	assert.equal(prebuild["continue-on-error"], undefined);
	const index = (name) => steps.findIndex((step) => step.name === name);
	assert.ok(index("Install dependencies") < steps.indexOf(prebuild));
	assert.ok(steps.indexOf(prebuild) < index("Verify and extract native archive"));
	assert.ok(index("Verify and extract native archive") < index("Verify packaged browser journeys"));
});
