import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import picomatch from "picomatch";
import { parse } from "yaml";
import { browserRunner } from "./ci-test-support.mjs";

const ci = parse(
	await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8"),
);

test("browser editor CI selects its source, fixtures, assets and configuration on PRs", () => {
	const filters = parse(ci.jobs.changes.steps.find((step) => step.id === "filter").with.filters);
	assert.ok(Array.isArray(filters.browser_editor), "Browser editor needs its own PR path filter");
	const covered = picomatch(filters.browser_editor, { dot: true });
	for (const path of [
		"apps/desktop/e2e/browser-editor/canvas-text.spec.ts",
		"apps/desktop/e2e/browser-editor/playwright.config.ts",
		"apps/desktop/e2e/raw-css.ts",
		"apps/desktop/src/renderer/browser/canvas-text.ts",
		"apps/desktop/src/main/preview/preview-service.ts",
		"apps/desktop/src/inspection-frame.ts",
		"apps/desktop/src/shared/preview-types.ts",
		"apps/desktop/browser.vite.config.ts",
		"apps/desktop/scripts/prebuild-viewer.ts",
		"apps/desktop/resources/export-assets/viewer.css",
		"apps/desktop/package.json",
		"apps/desktop/tsconfig.renderer.json",
		"packages/editor-core/src/frame-bridge/page-lens.ts",
		"packages/export-pipeline/src/preview/compile-page.ts",
		"packages/grammar/src/read-lesson.ts",
		"docs/test-fixtures/assets/image.png",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"package.json",
		"patches/dependency.patch",
		"tsconfig.base.json",
		".github/workflows/ci.yml",
	])
		assert.ok(covered(path), `${path} must run browser authoring journeys`);
	for (const path of ["README.md", "docs/context/architecture.md", "legal/notice.txt"])
		assert.equal(covered(path), false, `${path} does not change browser authoring`);
	assert.equal(
		ci.jobs.changes.outputs.browser_editor,
		"${{ github.event_name == 'pull_request' && 'false' || steps.full_browser.outputs.browser_editor || steps.browser.outputs.browser || 'true' }}",
	);
	assert.ok(
		ci.jobs.changes.steps
			.find((step) => step.id === "full_browser")
			.run.includes('echo "browser_editor=true"'),
	);
});

test("browser editor CI gates the selected engines in Linux shards with prepared assets", () => {
	const job = ci.jobs["browser-editor"];
	assert.ok(job, "Browser authoring must have a CI job");
	assert.equal(
		job.if,
		"${{ github.repository == (vars.STUDIO_SOURCE_REPO || github.repository) && (!cancelled() && needs.changes.result == 'success' && needs.changes.outputs.browser == 'true' && github.event_name != 'pull_request') }}",
	);
	assert.equal(job["runs-on"], browserRunner);
	assert.equal(job.strategy["fail-fast"], false);
	assert.equal(
		job.strategy.matrix.browser,
		"${{ fromJSON(needs.changes.outputs.editor_engines) }}",
	);
	assert.deepEqual(job.strategy.matrix.shard, ["1/3", "2/3", "3/3"]);
	const commands = job.steps.map((step) => step.run).filter(Boolean);
	const run = commands.find((command) => command.includes("e2e:browser-editor"));
	assert.ok(run?.includes("--project=${{ matrix.browser }}"));
	assert.ok(run.includes("--shard=${{ matrix.shard }}"));
	assert.ok(run.includes("--workers=2"));
	assert.ok(run.startsWith("pnpm "));
	assert.ok(!commands.some((command) => command.includes("electron/install.js")));
	for (const prerequisite of [
		"pnpm install --frozen-lockfile",
		"pnpm --filter @praxity/desktop prebuild",
		"pnpm --filter @praxity/export-pipeline prebuild",
		"pnpm --filter @praxity/desktop prepare:typst",
	]) {
		assert.ok(commands.includes(prerequisite), `${prerequisite} must run`);
		assert.ok(commands.indexOf(prerequisite) < commands.indexOf(run));
	}
	const browserInstall = job.steps.findIndex(
		(step) => step.uses === "./.github/actions/install-playwright",
	);
	assert.ok(
		browserInstall >= 0 && browserInstall < job.steps.findIndex((step) => step.run === run),
	);
	assert.equal(job.steps[browserInstall].with.package, "@praxity/desktop");
	assert.equal(job["continue-on-error"], undefined);
});

test("WebKit browser journeys keep Studio scratch and temp files on a bounded tmpfs", () => {
	const steps = ci.jobs["browser-editor"].steps;
	const prepare = steps.findIndex((step) => step.name === "Prepare browser authoring scratch");
	const journeys = steps.findIndex((step) => step.run?.includes("e2e:browser-editor"));
	assert.ok(prepare >= 0 && prepare < journeys, "Scratch must be prepared before the journeys");
	const script = steps[prepare].run;
	assert.ok(script.startsWith('scratch="$RUNNER_TEMP/browser-editor"\n'));
	assert.ok(script.includes('if [ "${{ matrix.browser }}" = webkit ]; then\n'));
	assert.ok(script.includes("scratch=/dev/shm/browser-editor\n"));
	assert.match(
		script,
		/sudo mount -t tmpfs -o "size=4G,mode=700,uid=\$\(id -u\),gid=\$\(id -g\)" tmpfs "\$scratch"/,
	);
	assert.ok(script.includes(`printf 'TMPDIR=%s\\n' "$scratch/tmp" >> "$GITHUB_ENV"`));
	assert.ok(
		script.trimEnd().endsWith(`printf 'PRAXITY_TEST_ARTIFACTS=%s\\n' "$scratch" >> "$GITHUB_ENV"`),
	);
	assert.equal(steps[journeys].env, undefined, "Journeys must read the prepared scratch");
	const upload = steps.find((step) => step.name === "Upload browser authoring failure evidence");
	assert.equal(upload.with.path, "${{ env.PRAXITY_TEST_ARTIFACTS }}/browser-editor-results/");
});

test("failed WebKit browser journeys report core dumps and I/O pressure", () => {
	const steps = ci.jobs["browser-editor"].steps;
	const report = steps.findIndex(
		(step) => step.name === "Report WebKit core dumps and I/O pressure",
	);
	const journeys = steps.findIndex((step) => step.run?.includes("e2e:browser-editor"));
	assert.ok(report > journeys, "The report must follow the journeys");
	assert.equal(steps[report].if, "failure() && !cancelled() && matrix.browser == 'webkit'");
	assert.equal(steps[report]["continue-on-error"], true);
	assert.equal(
		steps[report].run,
		"sudo coredumpctl list --no-pager || true\ncat /proc/pressure/io\n",
	);
});

test("no CI job reads the runner context in job-level env", () => {
	for (const [name, job] of Object.entries(ci.jobs))
		assert.doesNotMatch(JSON.stringify(job.env ?? {}), /\brunner\./, name);
});
