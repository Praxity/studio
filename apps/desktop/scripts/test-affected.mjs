import { execFileSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import picomatch from "picomatch";
import ts from "typescript";
import { parse } from "yaml";
import {
	cssBudgetTests,
	guardsPublishedOutput,
	outputCoverage,
} from "./test-affected-output-map.mjs";

const unique = (paths) => [...new Set(paths)].sort();
const nodeTest = (path) => /\.test\.(mjs|mts|js|ts)$/.test(path);
const scriptPath = (path) => /^(apps\/desktop\/scripts|scripts)\//.test(path);
const vitestTest = (path) =>
	/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
	!scriptPath(path) &&
	(!path.includes("/e2e/") || path.includes(".test.")) &&
	!path.includes("/tests/a11y/") &&
	!path.includes("/tests/deck/");
const sourcePath = (path) =>
	/\.[cm]?[jt]sx?$/.test(path) &&
	!scriptPath(path) &&
	!path.includes("/e2e/") &&
	!path.includes("/tests/a11y/") &&
	!path.includes("/tests/deck/") &&
	!vitestTest(path);
const matches = (path, globs) => globs.some((glob) => picomatch(glob, { dot: true })(path));
const globalConfigGlobs = [
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"tsconfig*.json",
	"vitest*.{ts,mts,js,mjs}",
	"patches/**",
];
const fullVitestConfigGlobs = [
	...globalConfigGlobs,
	"**/vitest*.{ts,mts,js,mjs}",
	"**/tsconfig*.json",
	"**/package.json",
	"apps/desktop/scripts/test-affected*.mjs",
];
const vitest = ["--config", "vitest.workspace.ts", "--maxWorkers=2"];
const vitestSetup = () =>
	[
		["desktop-assets", "@praxity/desktop", "prebuild"],
		["typst", "@praxity/desktop", "prepare:typst"],
		["viewer-assets", "@praxity/export-pipeline", "prebuild:client"],
	].map(([id, pkg, command]) => ({ id, executable: "pnpm", args: ["--filter", pkg, command] }));
const fullVitestPlan = () => [
	...vitestSetup(),
	{ id: "vitest-all", executable: "pnpm", args: ["exec", "vitest", "run", ...vitest] },
];

export function buildVitestPlan(paths, context, options = {}) {
	try {
		if (!Array.isArray(context.vitestInputs)) throw new Error("Vitest input metadata unavailable");
		if (
			paths.some((path) => {
				const file = path.replaceAll("\\", "/");
				// Format docs select the grammar project below; context prose has no Vitest owner.
				const documentation =
					file.endsWith(".md") &&
					(file.startsWith("docs/context/") ||
						(file.startsWith("docs/prax-format/") && matchedFilters([file], context).format));
				return (
					(!sourcePath(file) && !vitestTest(file) && !documentation) ||
					matches(file, fullVitestConfigGlobs) ||
					context.vitestInputs?.includes(file) ||
					/\/(?:__)?fixtures(?:__)?\//.test(file)
				);
			})
		)
			return fullVitestPlan();
		const steps = buildPlan(paths, context, options).filter((step) =>
			step.id.startsWith("vitest-"),
		);
		for (const step of steps) {
			if (step.id === "vitest-direct")
				step.args = step.args.filter((arg) => !options.deleted?.includes(arg));
			step.args.push("--passWithNoTests");
		}
		const runnable = steps.filter(
			(step) => step.id !== "vitest-direct" || step.args.some(vitestTest),
		);
		return runnable.length ? [...vitestSetup(), ...runnable] : [];
	} catch (error) {
		console.warn(`Affected selection unavailable; running full Vitest: ${error.message}`);
		return fullVitestPlan();
	}
}

async function vitestInputs(root) {
	const require = createRequire(new URL("../package.json", import.meta.url));
	const { loadConfigFromFile } = require("vite");
	const inputs = new Set();
	const local = (file) => relative(root, realpathSync(file)).replaceAll("\\", "/");
	const visit = (file) => {
		const name = local(file);
		if (name.startsWith("../") || name.includes("node_modules/") || inputs.has(name)) return;
		inputs.add(name);
		if (!/\.[cm]?[jt]sx?$/.test(file)) return;
		for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8"), true, true)
			.importedFiles) {
			const resolved = ts.resolveModuleName(
				fileName,
				file,
				{
					moduleResolution: ts.ModuleResolutionKind.Bundler,
					allowJs: true,
				},
				ts.sys,
			).resolvedModule;
			if (resolved) visit(resolved.resolvedFileName);
			else if (fileName.startsWith(".") && (!extname(fileName) || /\.[cm]?[jt]sx?$/.test(fileName)))
				throw new Error(`Cannot resolve setup dependency ${fileName} in ${name}`);
		}
	};
	const configs = globSync(
		["**/vitest.config.{ts,mts,cts,js,mjs,cjs}", "vitest.workspace.{ts,mts,cts,js,mjs,cjs}"],
		{ cwd: root, exclude: ["**/node_modules/**", "**/.git/**"] },
	);
	if (!configs.length) throw new Error("No Vitest configurations found");
	for (const config of configs) {
		const file = resolve(root, config);
		const loaded = await loadConfigFromFile({ command: "serve", mode: "test" }, file);
		if (!loaded) throw new Error(`Cannot read Vitest configuration ${config}`);
		for (const dependency of loaded.dependencies) inputs.add(local(resolve(dependency)));
		const test = loaded.config.test ?? {};
		for (const setup of [test.setupFiles ?? [], test.globalSetup ?? []].flat()) {
			if (typeof setup !== "string" || !setup) throw new Error(`Invalid setup list in ${config}`);
			visit(resolve(dirname(file), loaded.config.root ?? ".", setup));
		}
	}
	return [...inputs];
}

export async function loadContext(root) {
	const workflow = parse(readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"));
	const filter = workflow.jobs?.changes?.steps?.find((step) => step.id === "filter");
	if (!filter?.with?.filters) throw new Error("CI changes job has no filter YAML");
	const filters = parse(filter.with.filters);
	const quantifier = filter.with["predicate-quantifier"] ?? "some";
	if (!["some", "every"].includes(quantifier))
		throw new Error(`Unsupported CI predicate: ${quantifier}`);
	const workspace = parse(readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8"));
	const packages = globSync(
		workspace.packages.map((glob) => `${glob}/package.json`),
		{ cwd: root },
	).map((path) => ({
		dir: path.replaceAll("\\", "/").replace(/\/package.json$/, ""),
		...JSON.parse(readFileSync(resolve(root, path), "utf8")),
	}));
	const scriptTests = globSync(
		["scripts/**/*.test.{mjs,mts,js,ts}", "apps/desktop/scripts/**/*.test.{mjs,mts,js,ts}"],
		{ cwd: root },
	).map((path) => path.replaceAll("\\", "/"));
	return {
		filters,
		quantifier,
		packages,
		scriptTests,
		vitestInputs: await vitestInputs(root),
	};
}

export function changedFiles(root, base) {
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
			.split("\0")
			.filter(Boolean);
	// --no-renames retains both the removed and added path for moves across owners.
	return unique([
		...git("diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`, "--"),
		...git("diff", "--name-only", "--no-renames", "-z", "HEAD", "--"),
		...git("ls-files", "--others", "--exclude-standard", "-z"),
	]);
}

export function matchedFilters(paths, context) {
	for (const name of ["code", "output", "format"]) {
		if (!Array.isArray(context.filters[name]))
			throw new Error("CI must define code, output and format filters");
	}
	return Object.fromEntries(
		Object.entries(context.filters).map(([name, patterns]) => {
			const globs = patterns.flat(Infinity);
			if (globs.some((pattern) => typeof pattern !== "string"))
				throw new Error(
					`Unsupported CI filter rule in ${name}; update the local matcher before running`,
				);
			const matchers = globs.map((glob) => picomatch(glob, { dot: true }));
			return [
				name,
				paths.some((path) =>
					context.quantifier === "every"
						? matchers.every((match) => match(path))
						: matchers.some((match) => match(path)),
				),
			];
		}),
	);
}

export function buildPlan(
	changed,
	context,
	{ engines = "chromium", deleted = [], outputMap = outputCoverage } = {},
) {
	if (!["chromium", "all"].includes(engines)) throw new Error("--engines must be chromium or all");
	const paths = unique(changed.map((path) => path.replaceAll("\\", "/")));
	const filters = matchedFilters(paths, context);
	// A new published file must never disappear through either selection layer.
	for (const path of paths.filter(guardsPublishedOutput)) {
		const entry = outputMap.find((entry) => matches(path, entry.paths));
		// Existing narrow mappings continue to follow the workflow's output filter.
		// Future files admitted by the exhaustive fallback must be admitted by CI too.
		if ((!entry || entry.exhaustive) && !matchedFilters([path], context).output)
			throw new Error(`${path}: published runtime/check requires the CI output filter`);
		if (!entry?.a11y?.length || !entry.deck?.length)
			throw new Error(`${path}: missing published-output coverage for a11y and deck`);
	}
	const publishedChecks = paths.some(guardsPublishedOutput);
	const steps = [];
	const pnpm = (id, ...args) => steps.push({ id, executable: "pnpm", args });
	if (paths.length)
		steps.push({
			id: "timeout-evidence",
			executable: "node",
			args: ["scripts/check-test-timeouts.mjs"],
		});
	if (paths.length)
		steps.push({
			id: "editor-ownership",
			executable: "node",
			args: ["scripts/check-editor-ownership.mjs"],
		});
	if (publishedChecks || paths.some((path) => /\.[cm]?[jt]sx?$/.test(path)))
		steps.push({
			id: "source-owners",
			executable: "node",
			args: ["scripts/check-source-owners.mjs"],
		});
	if (paths.length) pnpm("lint", "exec", "biome", "check", "--no-errors-on-unmatched", ...paths);
	const owners = context.packages.filter((pkg) =>
		paths.some((path) => path.startsWith(`${pkg.dir}/`)),
	);
	const globalConfig = paths.some((path) => matches(path, globalConfigGlobs));
	if (globalConfig || (filters.code && owners.length === 0)) pnpm("typecheck", "typecheck");
	else if (owners.length)
		pnpm("typecheck", ...owners.flatMap((pkg) => ["--filter", `...${pkg.name}`]), "typecheck");

	const nodeTests = new Set();
	if (
		paths.some((path) =>
			matches(path, ["NOTICE", "**/third-party-notices/**", "packages/export-pipeline/schemas/**"]),
		)
	)
		nodeTests.add("scripts/notice.test.mjs");
	if (globalConfig) for (const path of context.scriptTests) nodeTests.add(path);
	for (const path of paths.filter(scriptPath)) {
		if (nodeTest(path)) nodeTests.add(path);
		else {
			// Script tests also spawn scripts and inspect their text. Static imports
			// cannot capture those consumers; the small sibling suite is the safe gate.
			for (const candidate of context.scriptTests.filter((candidate) =>
				candidate.startsWith(path.startsWith("scripts/") ? "scripts/" : "apps/desktop/scripts/"),
			))
				nodeTests.add(candidate);
		}
	}
	if (paths.some((path) => path.startsWith(".github/workflows/"))) {
		nodeTests.add("apps/desktop/scripts/ci-minutes.test.mjs");
		nodeTests.add("apps/desktop/scripts/cli-candidate.test.mjs");
	}
	if (nodeTests.size)
		steps.push({
			id: "node",
			executable: "node",
			args: [
				...(Array.from(nodeTests).some((path) => /\.m?ts$/.test(path)) ? ["--import", "tsx"] : []),
				"--test",
				...unique(nodeTests),
			],
		});

	const css = paths.some((path) => path.endsWith(".css"));
	const direct = unique([...paths.filter(vitestTest), ...(css ? cssBudgetTests : [])]);
	// Full export coverage supplements related tests across every workspace
	// project, including desktop consumers of export-pipeline source.
	const sources = paths.filter(sourcePath);
	const allTests =
		paths.some((path) => matches(path, fullVitestConfigGlobs)) ||
		paths.some(
			(path) =>
				path.endsWith(".prax") ||
				path.startsWith("docs/test-fixtures/") ||
				path === "docs/prax-format/reference/blocks.json",
		) ||
		deleted.some(sourcePath);
	if (allTests || sources.length || direct.length || publishedChecks) {
		steps.push(...vitestSetup());
	}
	if (allTests) pnpm("vitest-all", "exec", "vitest", "run", ...vitest);
	else {
		if (publishedChecks)
			pnpm("vitest-export", "exec", "vitest", "run", ...vitest, "--project", "export-pipeline");
		if (sources.length)
			pnpm("vitest-related", "exec", "vitest", "related", "--run", ...vitest, ...sources);
		if (direct.length) pnpm("vitest-direct", "exec", "vitest", "run", ...vitest, ...direct);
	}
	if (filters.format && !allTests)
		pnpm("vitest-format", "exec", "vitest", "run", ...vitest, "--project", "grammar");

	const suites = { a11y: new Set(), deck: new Set() };
	let unmapped = false;
	for (const path of paths) {
		if (!matchedFilters([path], context).output) continue;
		const spec = path.match(/^packages\/export-pipeline\/tests\/(a11y|deck)\/(.+)\.spec\.ts$/);
		if (spec && !deleted.includes(path)) {
			suites[spec[1]].add(spec[2]);
			continue;
		}
		const entry = outputMap.find((entry) => matches(path, entry.paths));
		if (!entry) {
			unmapped = true;
			continue;
		}
		for (const suite of ["a11y", "deck"]) for (const spec of entry[suite]) suites[suite].add(spec);
	}
	if (filters.output && unmapped) for (const suite of Object.values(suites)) suite.add("*");
	if (css) suites.a11y.add("contrast-themes");
	const projects = (engines === "all" ? ["chromium", "firefox", "webkit"] : ["chromium"]).map(
		(engine) => `--project=${engine}`,
	);
	if (suites.deck.size && !steps.some((step) => step.id === "viewer-assets"))
		pnpm("viewer-assets", "--filter", "@praxity/export-pipeline", "prebuild:client");
	for (const [suite, specs] of Object.entries(suites)) {
		if (specs.size)
			pnpm(
				suite,
				"--filter",
				"@praxity/export-pipeline",
				`test:${suite}`,
				...(specs.has("*") ? [] : unique(specs).map((name) => `tests/${suite}/${name}.spec.ts`)),
				...projects,
			);
	}
	const browserPaths = paths.filter((path) =>
		matches(path, [
			"apps/desktop/src/renderer/browser/**",
			"apps/desktop/src/main/studio/**",
			"apps/desktop/e2e/browser-editor/**",
		]),
	);
	if (browserPaths.length) {
		if (!steps.some((step) => step.id === "desktop-assets"))
			pnpm("desktop-assets", "--filter", "@praxity/desktop", "prebuild");
		const onlySpecs = browserPaths.every(
			(path) => path.endsWith(".spec.ts") && !deleted.includes(path),
		);
		pnpm(
			"browser-editor",
			"--filter",
			"@praxity/desktop",
			"e2e:browser-editor",
			...(onlySpecs ? browserPaths.map((path) => path.replace("apps/desktop/", "")) : []),
			...projects,
		);
	}
	return steps;
}

export async function runPlan(steps, execute) {
	// Tests mkdtemp inside tmpdir() and PRAXITY_TEST_ARTIFACTS. Workers often point both at folders
	// that don't exist yet, and wrappers call runPlan without main(), so create them here.
	mkdirSync(tmpdir(), { recursive: true });
	if (process.env.PRAXITY_TEST_ARTIFACTS)
		mkdirSync(process.env.PRAXITY_TEST_ARTIFACTS, { recursive: true });
	const results = [];
	for (const step of steps) {
		try {
			results.push({ id: step.id, code: await execute(step) });
		} catch (error) {
			results.push({ id: step.id, code: 1, error: error.message });
		}
	}
	return results;
}

export function execute(step, root, pnpmEntry = process.env.npm_execpath) {
	return new Promise((resolveResult, reject) => {
		// Invoke pnpm's JS entry point instead of a .cmd file or shell. Arguments
		// remain literal on Windows, including filenames containing shell syntax.
		if (step.executable === "pnpm" && !pnpmEntry)
			throw new Error("Run this command through pnpm test:affected");
		const args = step.executable === "pnpm" ? [pnpmEntry, ...step.args] : step.args;
		const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
		child.once("error", reject);
		child.once("close", (code) => resolveResult(code ?? 1));
	});
}

export function classifyTimeouts(report) {
	if (!Array.isArray(report.testResults) || !Number.isInteger(report.numFailedTests))
		throw new Error("Invalid Vitest failure report");
	const files = [];
	let failedTests = 0;
	let hardFailure = Boolean(report.numUnhandledErrors || report.nonTestErrors);
	for (const file of report.testResults) {
		const failed = file.assertionResults.filter((test) => test.status === "failed");
		failedTests += failed.length;
		if (file.status !== "failed" && failed.length === 0) continue;
		const timeoutOnly =
			!file.message &&
			!file.nonTestErrors &&
			failed.length > 0 &&
			failed.every(
				(test) =>
					test.failureMessages.length > 0 &&
					test.failureMessages.every((message) =>
						/^(?:Error: )?Test timed out in \d+\s*ms\.(?:\r?\n|$)/.test(message),
					),
			);
		if (timeoutOnly) files.push(file.name);
		else hardFailure = true;
	}
	if (failedTests !== report.numFailedTests || files.length === 0) hardFailure = true;
	return { files: unique(files), hardFailure };
}

export async function executeVitest(step, root, options = {}) {
	const run = options.execute ?? ((command) => execute(command, root));
	const log = options.log ?? console.log;
	if ((options.ci ?? process.env.CI) === "true") return run(step);
	const dir = mkdtempSync(resolve(tmpdir(), "affected-vitest-"));
	try {
		const reportPath = resolve(dir, "results.json");
		const code = await run({
			...step,
			args: [
				...step.args,
				"--reporter=default",
				`--reporter=${resolve(root, "apps/desktop/scripts/test-affected-reporter.mjs")}`,
				`--outputFile=${reportPath}`,
			],
		});
		if (code === 0) return 0;
		const { files, hardFailure } = classifyTimeouts(JSON.parse(readFileSync(reportPath, "utf8")));
		let failed = hardFailure;
		for (const file of files) {
			// Rebuild the command, so related/source selectors cannot broaden this retry.
			// Vitest matches filename prefixes, including foo.test.tsx for foo.test.ts.
			const longerPaths = `${file.replaceAll("\\", "/").replace(/([?*[\]{}()!])/g, "\\$1")}?*`;
			const alone = await run({
				...step,
				args: [
					"exec",
					"vitest",
					"run",
					"--config",
					"vitest.workspace.ts",
					"--maxWorkers=1",
					`--exclude=${longerPaths}`,
					file,
				],
			});
			log(`${file}: ${alone === 0 ? "load timeout, passed alone" : "failed alone"}`);
			if (alone !== 0) failed = true;
		}
		return failed ? code : 0;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			base: { type: "string", default: "origin/main" },
			"dry-run": { type: "boolean", default: false },
			engines: { type: "string", default: "chromium" },
			files: { type: "string", multiple: true },
			"vitest-only": { type: "boolean", default: false },
			"select-only": { type: "boolean", default: false },
			"affected-only": { type: "boolean", default: false },
		},
	});
	if (values.files && !values["dry-run"])
		throw new Error("--files is only supported with --dry-run for sample diffs");
	if ((values["select-only"] || values["affected-only"]) && !values["vitest-only"])
		throw new Error("Selection modes require --vitest-only");
	const root = resolve(import.meta.dirname, "../../..");
	let paths = [];
	let deleted = [];
	let steps;
	try {
		const context = await loadContext(root);
		paths = values.files ?? changedFiles(root, values.base);
		deleted = values.files ? [] : paths.filter((path) => !existsSync(resolve(root, path)));
		steps = (values["vitest-only"] ? buildVitestPlan : buildPlan)(paths, context, {
			engines: values.engines,
			deleted,
		});
		console.log(`CI filters: ${JSON.stringify(matchedFilters(paths, context))}`);
	} catch (error) {
		if (!values["vitest-only"]) throw error;
		console.warn(`Affected selection unavailable; running full Vitest: ${error.message}`);
		steps = fullVitestPlan();
	}
	const timeoutCheck = steps.find((step) => step.id === "timeout-evidence");
	if (timeoutCheck) timeoutCheck.args.push("--base", values.base);
	// Deleted files still select their owners and related tests, but cannot be linted
	// or passed directly to a test runner. Their surviving consumers stay selected.
	for (const step of steps) {
		if (["lint", "node", "vitest-direct"].includes(step.id))
			step.args = step.args.filter((arg) => !deleted.includes(arg));
	}
	const runnable = steps.filter(
		(step) =>
			(step.id !== "vitest-direct" || step.args.some(vitestTest)) &&
			(step.id !== "node" || step.args.some(nodeTest)) &&
			(step.id !== "lint" || step.args.some((arg) => paths.includes(arg))),
	);
	console.log(
		`Changed files (${paths.length}, base ${values.base}):\n${paths.map((path) => `  ${path}`).join("\n")}`,
	);
	console.log("Plan:");
	for (const step of runnable)
		console.log(
			`  [${step.id}] ${step.executable} ${step.args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`,
		);
	const selection = runnable.some((step) => step.id === "vitest-all")
		? "full"
		: runnable.length
			? "affected"
			: "empty";
	if (values["select-only"]) {
		appendFileSync(process.env.GITHUB_OUTPUT, `vitest=${selection}\n`);
		return;
	}
	if (values["affected-only"] && selection === "full")
		throw new Error("Full fallback requires the four-shard test job");
	if (values["dry-run"]) {
		console.log(`Summary: dry run, ${runnable.length} commands`);
		return;
	}
	const results = await runPlan(runnable, (step) =>
		step.id.startsWith("vitest-") ? executeVitest(step, root) : execute(step, root),
	);
	console.log("\nSummary:");
	for (const result of results)
		console.log(
			`  ${result.code === 0 ? "PASS" : "FAIL"} ${result.id} (${result.code})${result.error ? `: ${result.error}` : ""}`,
		);
	const failed = results.filter((result) => result.code !== 0);
	console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
	process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	main().catch((error) => {
		console.error(`Summary: FAIL selection: ${error.message}`);
		process.exitCode = 1;
	});
}
