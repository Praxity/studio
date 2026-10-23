import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { learnerAuthorityDirectories } from "../../../scripts/check-source-owners.mjs";
import {
	buildPlan,
	buildVitestPlan,
	changedFiles,
	execute,
	loadContext,
	matchedFilters,
	runPlan,
} from "./test-affected.mjs";
import { outputCoverage } from "./test-affected-output-map.mjs";

const root = resolve(import.meta.dirname, "../../..");
const context = await loadContext(root);
const plan = (files, options) => buildPlan(files, context, options);
const command = (steps, id) => steps.find((step) => step.id === id)?.args;

for (const path of [
	"NOTICE",
	"apps/desktop/resources/third-party-notices/feather-icons@4.29.2/LICENSE",
	"packages/future/third-party-notices/example/LICENSE",
	"packages/export-pipeline/schemas/license.txt",
	"packages/export-pipeline/schemas/adlcp_rootv1p2.xsd",
]) {
	test(`vendored notice input selects the repo notice check: ${path}`, () => {
		assert.ok(command(plan([path]), "node")?.includes("scripts/notice.test.mjs"));
	});
}

for (const path of [
	"apps/desktop/src/test-utils/setup-tests.ts",
	"packages/shared-blocks/tests/setup.ts",
	"packages/export-pipeline/vitest.global-setup.ts",
	"packages/grammar/__tests__/fixtures/v4/toolkit/welcome.tree",
	"packages/grammar/__tests__/fixtures/some.json",
	"packages/grammar/__tests__/fixtures/some.gif",
	"fixtures/v4/toolkit/welcome.tree",
	"packages/export-pipeline/schemas/adlcp_rootv1p2.xsd",
	"packages/editor-core/src/messages/en.json",
	"packages/editor-core/src/messages/fr.json",
	"scripts/slow-tests-reporter.mjs",
	"scripts/vitest-timings.json",
	"packages/export-pipeline/src/build.ts",
	"README.md",
]) {
	for (const deleted of [[], [path]]) {
		test(`runtime/config input requires full Vitest: ${path}, deleted=${deleted.length > 0}`, () => {
			const steps = buildVitestPlan([path], context, { deleted });
			assert.equal(
				steps.some((step) => step.id === "vitest-all") ? "full" : "partial-or-empty",
				"full",
			);
		});
	}
}

test("configured setup/global setup paths and their imports are discovered from config", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "affected-config-inputs-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const write = (file, source) => {
		mkdirSync(resolve(dir, file, ".."), { recursive: true });
		writeFileSync(resolve(dir, file), source);
	};
	write(".github/workflows/ci.yml", readFileSync(resolve(root, ".github/workflows/ci.yml")));
	write("pnpm-workspace.yaml", "packages: ['packages/*']\n");
	write("packages/example/package.json", '{"name":"example"}');
	write("vitest.config.mjs", 'import config from "./config-helper.mjs"; export default config;');
	write("config-helper.mjs", "export default {test: {}};");
	write(
		"packages/example/vitest.config.mjs",
		'const setup = "./custom-before.ts"; export default {test: {setupFiles: setup, globalSetup: ["./custom-global.ts"]}};',
	);
	write("packages/example/custom-before.ts", 'import "./setup-dependency.ts";');
	write("packages/example/custom-global.ts", "export default () => {};");
	write("packages/example/setup-dependency.ts", "export const setup = true;");
	const custom = await loadContext(dir);
	for (const path of [
		"config-helper.mjs",
		"packages/example/custom-before.ts",
		"packages/example/custom-global.ts",
		"packages/example/setup-dependency.ts",
	]) {
		for (const deleted of [[], [path]])
			assert.equal(
				buildVitestPlan([path], custom, { deleted }).some((step) => step.id === "vitest-all")
					? "full"
					: "partial-or-empty",
				"full",
				path,
			);
	}
	write("packages/example/custom-before.ts", 'import "./missing";');
	await assert.rejects(loadContext(dir), /Cannot resolve setup dependency/);
	write("packages/example/vitest.config.mjs", "export default {test: {setupFiles: [42]}};");
	await assert.rejects(loadContext(dir), /Invalid setup list/);
	rmSync(resolve(dir, "vitest.config.mjs"));
	rmSync(resolve(dir, "packages/example/vitest.config.mjs"));
	await assert.rejects(loadContext(dir), /No Vitest configurations found/);
});

test("Vitest-only selection retains related and prerequisite checks without browsers", () => {
	const steps = buildVitestPlan(["apps/desktop/src/main/cli.ts"], context);
	assert.deepEqual(
		steps.map((step) => step.id),
		["desktop-assets", "typst", "viewer-assets", "vitest-related"],
	);
	assert.ok(command(steps, "vitest-related").includes("apps/desktop/src/main/cli.ts"));
	assert.ok(command(steps, "vitest-related").includes("--passWithNoTests"));
	assert.deepEqual(buildVitestPlan([], context), []);
	assert.ok(command(buildVitestPlan(["README.md"], context), "vitest-all"));
});

for (const path of [
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"package.json",
	"packages/grammar/package.json",
	"vitest.config.ts",
	"vitest.workspace.ts",
	"vitest.workspace.mjs",
	"packages/grammar/vitest.config.ts",
	"packages/grammar/vitest.extra.mts",
	"tsconfig.base.json",
	"apps/desktop/tsconfig.main.json",
	"apps/desktop/scripts/test-affected.mjs",
	"apps/desktop/scripts/test-affected-output-map.mjs",
]) {
	test(`Vitest-only selection fails safe on configuration: ${path}`, () => {
		const steps = buildVitestPlan([path], context);
		assert.ok(command(steps, "vitest-all"), "Uncertain configuration requires full Vitest");
		assert.equal(steps.filter((step) => step.id.startsWith("vitest-")).length, 1);
	});
}

test("Vitest-only selection errors run full Vitest; deleted tests never reach direct selection", () => {
	const broken = { ...context, filters: {} };
	assert.ok(command(buildVitestPlan(["packages/grammar/src/index.ts"], broken), "vitest-all"));
	assert.ok(
		command(
			buildVitestPlan(["apps/desktop/src/main/cli.ts"], { ...context, vitestInputs: undefined }),
			"vitest-all",
		),
	);
	assert.ok(
		command(
			buildVitestPlan(["packages/grammar/src/index.ts"], context, {
				outputMap: [],
			}),
			"vitest-all",
		),
	);
	const path = "packages/grammar/src/removed.test.ts";
	const removed = buildVitestPlan([path], context, { deleted: [path] });
	assert.equal(command(removed, "vitest-direct"), undefined);
	assert.ok(removed.every((step) => !step.args.includes(path)));
});

for (const path of [
	"packages/export-pipeline/src/patterns/text/render.ts",
	"packages/export-pipeline/src/patterns/self-check/enhance.tsx",
	"scripts/check-source-owners.mjs",
	...learnerAuthorityDirectories.map((directory) => `${directory}future-runtime.json`),
]) {
	test(`published authority changes select real ownership and complete output checks: ${path}`, () => {
		const steps = plan([path]);
		assert.deepEqual(command(steps, "source-owners"), ["scripts/check-source-owners.mjs"]);
		assert.ok(command(steps, "vitest-export")?.includes("export-pipeline"));
		for (const suite of ["a11y", "deck"])
			assert.deepEqual(command(steps, suite), [
				"--filter",
				"@praxity/export-pipeline",
				`test:${suite}`,
				"--project=chromium",
			]);
	});
}

test("unknown guarded paths get full published coverage; missing coverage or CI admission throws", () => {
	for (const directory of [
		...learnerAuthorityDirectories,
		"packages/export-pipeline/src/patterns/text/",
	]) {
		const path = `${directory}future-file.json`;
		assert.throws(
			() => buildPlan([path], context, { outputMap: [] }),
			(error) => error.message.includes(path) && /published-output coverage/.test(error.message),
		);
		assert.throws(
			() =>
				buildPlan([path], {
					...context,
					filters: { ...context.filters, output: ["unrelated/**"] },
				}),
			(error) => error.message.includes(path) && /CI output filter/.test(error.message),
		);
		const steps = plan([path]);
		assert.ok(command(steps, "vitest-export"));
		for (const suite of ["a11y", "deck"])
			assert.deepEqual(command(steps, suite), [
				"--filter",
				"@praxity/export-pipeline",
				`test:${suite}`,
				"--project=chromium",
			]);
	}
});

test("export build keeps related tests across projects, including desktop importers", () => {
	const steps = plan(["packages/export-pipeline/src/build.ts"]);
	assert.deepEqual(command(steps, "vitest-related"), [
		"exec",
		"vitest",
		"related",
		"--run",
		"--config",
		"vitest.workspace.ts",
		"--maxWorkers=2",
		"packages/export-pipeline/src/build.ts",
	]);
	assert.ok(command(steps, "vitest-export"));
});

test("all code changes run the real source-owner check, including output feeders", () => {
	for (const path of [
		"apps/desktop/src/main/export/build-export-input-from-project.ts",
		"packages/format-renderers/src/future-renderer.ts",
		"apps/desktop/src/main/index.ts",
		"scripts/future-check.mjs",
		"packages/unrelated/future.ts",
	])
		assert.deepEqual(command(plan([path]), "source-owners"), ["scripts/check-source-owners.mjs"]);
});

test("every changed-file plan runs the timeout evidence guard", () => {
	assert.deepEqual(command(plan(["packages/grammar/src/parser.test.ts"]), "timeout-evidence"), [
		"scripts/check-test-timeouts.mjs",
	]);
});

test("CSS always selects both budget files and theme contrast", () => {
	const steps = plan(["packages/shared-blocks/src/viewer/deck-shell.css"]);
	assert.deepEqual(command(steps, "vitest-direct"), [
		"exec",
		"vitest",
		"run",
		"--config",
		"vitest.workspace.ts",
		"--maxWorkers=2",
		"packages/export-pipeline/src/__tests__/bundle-viewer.test.ts",
		"packages/export-pipeline/src/__tests__/html-gen.test.ts",
	]);
	assert.ok(command(steps, "a11y").includes("tests/a11y/contrast-themes.spec.ts"));
	assert.ok(command(steps, "deck").includes("tests/deck/focus-contrast.spec.ts"));
	assert.ok(command(steps, "deck").includes("--project=chromium"));
	assert.equal(command(steps, "deck").includes("--project=firefox"), false);
});

test("any CSS, including editor-only CSS, selects budgets and contrast", () => {
	const steps = plan(["apps/desktop/src/renderer/editor.css"]);
	assert.ok(
		command(steps, "vitest-direct").includes(
			"packages/export-pipeline/src/__tests__/html-gen.test.ts",
		),
	);
	assert.ok(command(steps, "a11y").includes("tests/a11y/contrast-themes.spec.ts"));
	assert.equal(command(steps, "deck"), undefined);
});

test("workflow changes select both CI guards and unmapped output suites", () => {
	const steps = plan([".github/workflows/ci.yml"]);
	assert.deepEqual(command(steps, "node"), [
		"--test",
		"apps/desktop/scripts/ci-minutes.test.mjs",
		"apps/desktop/scripts/cli-candidate.test.mjs",
	]);
	assert.deepEqual(command(steps, "a11y"), [
		"--filter",
		"@praxity/export-pipeline",
		"test:a11y",
		"--project=chromium",
	]);
	assert.deepEqual(command(steps, "deck"), [
		"--filter",
		"@praxity/export-pipeline",
		"test:deck",
		"--project=chromium",
	]);
});

test("desktop main selects related workspace tests without output browsers", () => {
	const steps = plan(["apps/desktop/src/main/cli.ts"]);
	assert.deepEqual(command(steps, "vitest-related"), [
		"exec",
		"vitest",
		"related",
		"--run",
		"--config",
		"vitest.workspace.ts",
		"--maxWorkers=2",
		"apps/desktop/src/main/cli.ts",
	]);
	assert.equal(command(steps, "a11y"), undefined);
	assert.equal(command(steps, "browser-editor"), undefined);
	assert.deepEqual(command(steps, "typecheck"), ["--filter", "...@praxity/desktop", "typecheck"]);
	assert.ok(command(steps, "lint").includes("apps/desktop/src/main/cli.ts"));
});

test("changed tests run directly; script implementation covers indirect Node consumers", () => {
	const steps = plan([
		"packages/grammar/src/parser.test.ts",
		"apps/desktop/scripts/standalone-cli-packaging.mjs",
		"scripts/preflight-gates.mts",
	]);
	assert.ok(command(steps, "vitest-direct").includes("packages/grammar/src/parser.test.ts"));
	assert.equal(command(steps, "vitest-related"), undefined);
	assert.deepEqual(command(steps, "node").slice(0, 3), ["--import", "tsx", "--test"]);
	for (const path of [
		"apps/desktop/scripts/standalone-cli-packaging.test.mjs",
		"scripts/preflight-gates.test.mts",
	])
		assert.ok(command(steps, "node").includes(path));
});

test("browser editor sources and Studio server select journeys in all requested engines", () => {
	for (const path of [
		"apps/desktop/src/renderer/browser/canvas.ts",
		"apps/desktop/src/main/studio/server.ts",
	]) {
		const args = command(plan([path], { engines: "all" }), "browser-editor");
		assert.deepEqual(args.slice(-3), [
			"--project=chromium",
			"--project=firefox",
			"--project=webkit",
		]);
	}
	const steps = plan(["apps/desktop/e2e/browser-editor/editor.spec.ts"]);
	assert.ok(command(steps, "browser-editor").includes("e2e/browser-editor/editor.spec.ts"));
	assert.equal(command(steps, "vitest-direct"), undefined);
});

test("filters come from workflow YAML, including dotfiles and future filters", () => {
	const custom = {
		...context,
		filters: { ...context.filters, output: ["custom/**"], future: ["**/.hidden.ts"] },
	};
	assert.equal(
		buildPlan(["packages/shared-blocks/src/viewer/deck-shell.css"], custom).find(
			(s) => s.id === "deck",
		),
		undefined,
	);
	assert.ok(buildPlan(["custom/.hidden.ts"], custom).find((s) => s.id === "deck"));
	assert.throws(() => buildPlan([], { ...context, filters: {} }), /code.*output.*format/);
});

test("unmapped output falls back to both full suites; format-only changes run grammar", () => {
	assert.equal(
		command(plan(["packages/grammar/src/parser.ts"]), "a11y").at(-1),
		"--project=chromium",
	);
	assert.deepEqual(command(plan(["docs/prax-format/reference/grammar.md"]), "vitest-format"), [
		"exec",
		"vitest",
		"run",
		"--config",
		"vitest.workspace.ts",
		"--maxWorkers=2",
		"--project",
		"grammar",
	]);
	assert.equal(command(plan(["README.md"]), "a11y"), undefined);
	assert.ok(command(plan(["README.md"]), "lint"));
});

test("shared package changes typecheck dependents; global config runs all workspace tests", () => {
	assert.deepEqual(command(plan(["packages/grammar/src/parser.ts"]), "typecheck"), [
		"--filter",
		"...@praxity/grammar",
		"typecheck",
	]);
	assert.deepEqual(command(plan(["pnpm-lock.yaml"]), "typecheck"), ["typecheck"]);
	assert.ok(command(plan(["pnpm-lock.yaml"]), "vitest-all"));
});

test("desktop roundtrip remains a direct Vitest test inside the Electron E2E directory", () => {
	const steps = plan(["apps/desktop/e2e/qa/10-roundtrip.test.ts"]);
	assert.ok(command(steps, "vitest-direct")?.includes("apps/desktop/e2e/qa/10-roundtrip.test.ts"));
});

test("git includes committed, staged, unstaged, untracked and both renamed paths", () => {
	const dir = mkdtempSync(join(tmpdir(), "test-affected-git-"));
	const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
	try {
		git("init", "--initial-branch=main");
		writeFileSync(join(dir, "old.ts"), "base");
		writeFileSync(join(dir, "unstaged.ts"), "base");
		git("add", ".");
		git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
		git("branch", "base");
		writeFileSync(join(dir, "committed.ts"), "change");
		git("add", ".");
		git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "change");
		git("mv", "old.ts", "renamed.ts");
		writeFileSync(join(dir, "unstaged.ts"), "modified");
		writeFileSync(join(dir, "untracked with space.ts"), "new");
		assert.deepEqual(changedFiles(dir, "base"), [
			"committed.ts",
			"old.ts",
			"renamed.ts",
			"unstaged.ts",
			"untracked with space.ts",
		]);
		assert.throws(() => changedFiles(dir, "missing-base"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runner continues after failures and returns a failing summary", async () => {
	const executed = [];
	const result = await runPlan(
		[
			{ id: "first", executable: "node", args: [] },
			{ id: "second", executable: "node", args: [] },
		],
		async (step) => {
			executed.push(step.id);
			return step.id === "first" ? 7 : 0;
		},
	);
	assert.deepEqual(executed, ["first", "second"]);
	assert.deepEqual(result, [
		{ id: "first", code: 7 },
		{ id: "second", code: 0 },
	]);
});

test("coverage table names existing browser specs", () => {
	for (const entry of outputCoverage) {
		for (const suite of ["a11y", "deck"]) {
			for (const spec of entry[suite].filter((spec) => spec !== "*")) {
				assert.ok(
					existsSync(resolve(root, `packages/export-pipeline/tests/${suite}/${spec}.spec.ts`)),
					`${suite}/${spec}`,
				);
			}
		}
	}
});

test("CI predicate matching handles negation, dotfiles and every", () => {
	const custom = {
		...context,
		filters: { ...context.filters, code: ["**/*.ts", "!**/ignore/**"] },
	};
	assert.equal(matchedFilters(["ignore/.hidden.ts"], custom).code, true);
	custom.quantifier = "every";
	assert.equal(matchedFilters(["ignore/.hidden.ts"], custom).code, false);
	assert.equal(matchedFilters(["src/.hidden.ts"], custom).code, true);
});

test("removed source and unmapped fixtures select a complete workspace gate", () => {
	assert.ok(
		command(
			plan(["packages/grammar/src/deleted.ts"], { deleted: ["packages/grammar/src/deleted.ts"] }),
			"vitest-all",
		),
	);
	assert.ok(command(plan(["docs/test-fixtures/new.prax"]), "vitest-all"));
	const removed = plan(["apps/desktop/e2e/browser-editor/editor.spec.ts"], {
		deleted: ["apps/desktop/e2e/browser-editor/editor.spec.ts"],
	});
	assert.equal(
		command(removed, "browser-editor").includes("e2e/browser-editor/editor.spec.ts"),
		false,
	);
});

test("Windows executor preserves literal filenames and child failure status", async () => {
	const dir = mkdtempSync(join(tmpdir(), "test-affected-spawn-"));
	try {
		const fakePnpm = join(dir, "fake-pnpm.cjs");
		const output = join(dir, "args.json");
		writeFileSync(
			fakePnpm,
			"require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3))); process.exit(7);",
		);
		const args = [output, "changed with spaces.ts", "literal;$()`name.ts"];
		assert.equal(await execute({ executable: "pnpm", args }, dir, fakePnpm), 7);
		assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), args.slice(1));
		await assert.rejects(execute({ executable: "pnpm", args: [] }, dir, ""), /through pnpm/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("CLI sample plans and argument errors return the correct exit status", () => {
	const cli = resolve(root, "apps/desktop/scripts/test-affected.mjs");
	const run = (...args) =>
		execFileSync(process.execPath, [cli, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	assert.match(run("--dry-run", "--files", "apps/desktop/src/main/cli.ts"), /\[vitest-related\]/);
	const vitest = run("--vitest-only", "--dry-run", "--files", "apps/desktop/src/main/cli.ts");
	assert.match(vitest, /\[vitest-related\]/);
	assert.doesNotMatch(vitest, /\[(?:node|lint|typecheck|browser-editor|a11y|deck)\]/);
	assert.match(run("--vitest-only", "--dry-run", "--files", "README.md"), /\[vitest-all\]/);
	assert.match(run("--vitest-only", "--dry-run", "--base", "missing-base"), /\[vitest-all\]/);
	assert.throws(
		() => run("--files", "README.md"),
		(error) => error.status === 1 && /only supported with --dry-run/.test(error.stderr),
	);
	assert.throws(
		() => run("--dry-run", "--engines", "invalid"),
		(error) => error.status === 1,
	);
	assert.throws(
		() => run("--dry-run", "--base", "missing-base"),
		(error) => error.status === 1,
	);
});

test("CI selection writes literal verdicts without setup; affected execution refuses full fallback", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "affected-selection-cli-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const output = join(dir, "output");
	const fakePnpm = join(dir, "refuse-execution.cjs");
	writeFileSync(fakePnpm, "process.exit(99)");
	const run = (...args) =>
		spawnSync(
			process.execPath,
			[resolve(root, "apps/desktop/scripts/test-affected.mjs"), "--vitest-only", ...args],
			{
				encoding: "utf8",
				env: { ...process.env, CI: "true", npm_execpath: fakePnpm, GITHUB_OUTPUT: output },
			},
		);
	for (const [args, expected] of [
		[["--files", "apps/desktop/src/main/cli.ts"], "vitest=affected\n"],
		[["--files", "packages/grammar/__tests__/fixtures/v4/toolkit/welcome.tree"], "vitest=full\n"],
		[["--base", "missing-base"], "vitest=full\n"],
	]) {
		writeFileSync(output, "");
		const result = run("--select-only", "--dry-run", ...args);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(readFileSync(output, "utf8"), expected);
	}
	const refused = run("--affected-only", "--dry-run", "--files", "pnpm-lock.yaml");
	assert.equal(refused.status, 1);
	assert.match(refused.stderr, /Full fallback requires the four-shard test job/);
	const invalid = spawnSync(
		process.execPath,
		[resolve(root, "apps/desktop/scripts/test-affected.mjs"), "--select-only"],
		{ encoding: "utf8" },
	);
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /Selection modes require --vitest-only/);
});
