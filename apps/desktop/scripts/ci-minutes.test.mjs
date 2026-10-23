import assert from "node:assert/strict";
import { isUtf8 } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob, parse as parsePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { parse, parseDocument } from "yaml";
import privateCi from "../../../.github/private-ci.json" with { type: "json" };
import { browserRequired } from "./ci-browser.mjs";
import {
	assertNodeCheckPartition,
	assertNoRetiredCommands,
	assertNoRetiredRunner,
	assertSlowConfirmation,
	browserRunner,
	couldBeSelfHosted,
	isPrivateWorkflow,
	nodePartitionFixture,
	retentionFixture,
	runsSlowReporter,
	stepArguments,
	workflowFunction,
} from "./ci-test-support.mjs";

const workflow = (name) =>
	parse(readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
const ci = workflow("ci");
const security = workflow("security");
const actionlintConfig = parse(
	readFileSync(new URL("../../../.github/actionlint.yaml", import.meta.url), "utf8"),
);
const checkActionlintConfig = (config) =>
	assert.deepEqual(Object.keys(config), ["self-hosted-runner"]);

// Reviewed pins that do not create Actions artifacts. New refs need a fresh review.
const actionsWithoutUploads = new Map([
	["actions/checkout@11d5960a326750d5838078e36cf38b85af677262", "Checks out Git source."],
	[
		"actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
		"Installs Node and caches dependencies, not artifacts.",
	],
	[
		"actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3",
		"Installs Java and caches dependencies, not artifacts.",
	],
	["pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1", "Installs pnpm."],
	[
		"actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830",
		"Restores and saves the Playwright browser cache, not artifacts.",
	],
	[
		"actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830",
		"Restores dependency archives, not artifacts.",
	],
	[
		"actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830",
		"Saves dependency archives, not artifacts.",
	],
	[
		"dorny/paths-filter@0e4a8c6effa4802afeda77dc8d303f8176d7dfad",
		"Reports changed paths as job outputs.",
	],
]);

// shortcut: guards accidental omissions; YAML aliases/anchors and local directories named
// like upload-artifact@v4 can bypass detection. Harden when workflows use anchors.
function assertArtifactRetention(root) {
	const visited = new Set();
	function inspect(path, composite = false) {
		const file = new URL(path, root);
		assert.ok(
			file.href.startsWith(root.href),
			`${path}: cannot inspect uploads outside the repository`,
		);
		if (visited.has(file.href)) return;
		visited.add(file.href);
		const document = parseDocument(readFileSync(file, "utf8"));
		assert.deepEqual(document.errors, [], `${path}: invalid YAML`);
		const config = document.toJS();
		function steps(nodes, location) {
			for (const node of nodes?.items ?? []) {
				const step = node.toJSON();
				if (!step.uses) continue;
				const label = `${path}: ${location}: ${step.name ?? step.uses}`;
				if (/(^|\/)upload-artifact(?:\/[^@]*)?@/i.test(step.uses)) {
					const days = step.with?.["retention-days"];
					assert.ok(
						Number.isInteger(days) && days > 0 && days <= 90,
						`${label}: retention-days must be a literal positive integer from 1 to 90`,
					);
					if (days > 7) {
						const reason = node.getIn(["with", "retention-days"], true).comment ?? "";
						const citation =
							/retention:\s*(?:release|audit) evidence .+\b(docs\/[\w./-]+\.md) "([^"\r\n]+)"/i.exec(
								reason,
							);
						assert.ok(
							citation,
							`${label}: retention over seven days needs a release or audit evidence reason citing docs/file.md "exact phrase"`,
						);
						const source = new URL(citation[1], root);
						assert.ok(
							source.href.startsWith(root.href),
							`${label}: evidence citation must stay in the repository`,
						);
						assert.match(
							citation[2],
							/artifact|evidence/i,
							`${label}: cited release or audit evidence phrase must describe the evidence`,
						);
						assert.ok(
							readFileSync(source, "utf8").includes(citation[2]),
							`${label}: cited release or audit evidence phrase must exist in the document`,
						);
					}
				} else if (step.uses.startsWith("./")) {
					const action = ["action.yml", "action.yaml"]
						.map((name) => `${step.uses}/${name}`)
						.find((name) => existsSync(new URL(name, root)));
					assert.ok(action, `${label}: cannot inspect uploads without local action metadata`);
					inspect(action, true);
				} else {
					assert.ok(
						actionsWithoutUploads.get(step.uses.toLowerCase()),
						`${label}: cannot inspect uploads in an unknown action; inspect a local composite or add a reviewed pin and reason to actionsWithoutUploads`,
					);
				}
			}
		}
		if (composite) {
			assert.equal(
				config.runs?.using,
				"composite",
				`${path}: cannot inspect uploads in a non-composite local action`,
			);
			steps(document.getIn(["runs", "steps"], true), "composite");
		} else {
			for (const [name, job] of Object.entries(config.jobs)) {
				if (job.uses) {
					assert.ok(
						job.uses.startsWith("./.github/workflows/"),
						`${path}: ${name}: cannot inspect uploads in an external reusable workflow`,
					);
					inspect(job.uses);
				} else {
					steps(document.getIn(["jobs", name, "steps"], true), name);
				}
			}
		}
	}
	for (const file of readdirSync(new URL(".github/workflows/", root)).filter((name) =>
		/\.ya?ml$/.test(name),
	)) {
		inspect(`.github/workflows/${file}`);
	}
}

test("every artifact upload declares a positive retention period", () => {
	assertArtifactRetention(new URL("../../../", import.meta.url));
});

const uploadFixture = (uses, retention = "") =>
	`name: Probe\non: workflow_dispatch\njobs:\n  probe:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${uses}\n        with:\n          path: evidence\n${retention}`;

for (const uses of [
	"actions/upload-artifact@v4",
	"actions/upload-artifact/merge@v4",
	"Actions/Upload-Artifact@v4",
	"someorg/upload-artifact@v4",
	"someorg/upload-artifact/merge@v4",
	"SomeOrg/Upload-Artifact/Merge@v4",
]) {
	test(`artifact policy refuses missing retention for ${uses}`, (t) => {
		const root = retentionFixture(t, { ".github/workflows/probe.yaml": uploadFixture(uses) });
		assert.throws(() => assertArtifactRetention(root), /retention-days/);
	});
}

for (const days of ["0", "-1", "0.5", "'7'", "${{ inputs.days }}", "91"]) {
	test(`artifact policy refuses invalid literal ${days}`, (t) => {
		const root = retentionFixture(t, {
			".github/workflows/probe.yml": uploadFixture(
				"actions/upload-artifact@v4",
				`          retention-days: ${days}\n`,
			),
		});
		assert.throws(() => assertArtifactRetention(root), /retention-days/);
	});
}

test("artifact policy follows nested local actions and reusable workflows", (t) => {
	const root = retentionFixture(t, {
		".github/workflows/probe.yml": "jobs:\n  call:\n    uses: ./.github/workflows/called.yaml\n",
		".github/workflows/called.yaml": uploadFixture("./.github/actions/outer"),
		".github/actions/outer/action.yml":
			"runs:\n  using: composite\n  steps:\n    - uses: ./.github/actions/inner\n",
		".github/actions/inner/action.yaml":
			"runs:\n  using: composite\n  steps:\n    - uses: actions/upload-artifact/merge@v4\n",
	});
	assert.throws(() => assertArtifactRetention(root), /inner\/action.yaml.*retention-days/);
	writeFileSync(
		new URL(".github/actions/inner/action.yaml", root),
		"runs:\n  using: composite\n  steps:\n    - uses: actions/upload-artifact/merge@v4\n      with:\n        retention-days: 7\n",
	);
	assert.doesNotThrow(() => assertArtifactRetention(root));
});

for (const [label, files] of [
	[
		"external reusable workflow",
		{
			".github/workflows/probe.yml":
				"jobs:\n  call:\n    uses: example/shared/.github/workflows/evidence.yml@v1\n",
		},
	],
	[
		"unknown action",
		{ ".github/workflows/probe.yml": uploadFixture("example/publish-evidence@v1") },
	],
	[
		"unreviewed action ref",
		{ ".github/workflows/probe.yml": uploadFixture("actions/checkout@main") },
	],
	[
		"Docker action",
		{ ".github/workflows/probe.yml": uploadFixture("docker://example/evidence:latest") },
	],
	[
		"missing local action metadata",
		{ ".github/workflows/probe.yml": uploadFixture("./.github/actions/missing") },
	],
	[
		"opaque local action",
		{
			".github/workflows/probe.yml": uploadFixture("./.github/actions/opaque"),
			".github/actions/opaque/action.yml": "runs:\n  using: node24\n  main: index.js\n",
		},
	],
]) {
	test(`artifact policy refuses ${label}`, (t) => {
		assert.throws(
			() => assertArtifactRetention(retentionFixture(t, files)),
			/cannot inspect uploads/,
		);
	});
}

test("artifact policy permits longer retention only with cited release or audit evidence", (t) => {
	const root = retentionFixture(t, {
		".github/workflows/probe.yml": uploadFixture(
			"actions/upload-artifact@v4",
			"          retention-days: 90\n",
		),
		"docs/release.md": "Keep conformance artifacts before release.\n",
	});
	assert.throws(() => assertArtifactRetention(root), /release or audit evidence/);
	writeFileSync(
		new URL(".github/workflows/probe.yml", root),
		uploadFixture(
			"actions/upload-artifact@v4",
			'          retention-days: 90 # retention: Release evidence required by docs/release.md "Keep conformance artifacts before release."\n',
		),
	);
	assert.doesNotThrow(() => assertArtifactRetention(root));
	writeFileSync(
		new URL("docs/release.md", root),
		"# Release instructions\n\nUnrelated new instructions.\nKeep conformance artifacts before release.\n",
	);
	assert.doesNotThrow(() => assertArtifactRetention(root));
	writeFileSync(new URL("docs/release.md", root), "Unrelated release instructions.\n");
	assert.throws(
		() => assertArtifactRetention(root),
		/cited release or audit evidence phrase must exist/,
	);
	writeFileSync(
		new URL(".github/workflows/probe.yml", root),
		uploadFixture(
			"actions/upload-artifact@v4",
			'          retention-days: 90 # retention: Release evidence required by docs/release.md "Unrelated release instructions."\n',
		),
	);
	assert.throws(() => assertArtifactRetention(root), /phrase must describe the evidence/);
});

test("browser authoring failure traces remain available for seven days", () => {
	const uploads = ci.jobs["browser-editor"].steps.filter((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	);
	assert.equal(uploads.length, 1);
	assert.equal(uploads[0].with["retention-days"], 7);
});

// The engine outputs use the JS-compatible subset of Actions expressions.
// Evaluate them so the fixtures exercise what each event actually runs.
const engines = (output, event_name, inputs = {}) =>
	JSON.parse(
		workflowFunction(
			"github",
			"inputs",
			`return (${ci.jobs.changes.outputs[output].slice(3, -2)});`,
		)({ event_name }, inputs),
	);
const allPublished = [
	{ browser: "chromium", shard: "1/3", artifact: "chromium-1" },
	{ browser: "chromium", shard: "2/3", artifact: "chromium-2" },
	{ browser: "chromium", shard: "3/3", artifact: "chromium-3" },
	{ browser: "firefox", shard: "1/1", artifact: "firefox" },
	{ browser: "webkit", shard: "1/2", artifact: "webkit-1" },
	{ browser: "webkit", shard: "2/2", artifact: "webkit-2" },
];
const allDeck = [
	{ browser: "chromium", shard: "1/2", artifact: "chromium-1" },
	{ browser: "chromium", shard: "2/2", artifact: "chromium-2" },
	{ browser: "firefox", shard: "1/1", artifact: "firefox" },
	{ browser: "webkit", shard: "1/2", artifact: "webkit-1" },
	{ browser: "webkit", shard: "2/2", artifact: "webkit-2" },
];

test("candidate dispatches run Chromium only; nightly and ordinary manual runs gate every engine", () => {
	assert.deepEqual(engines("published_engines", "pull_request"), allPublished.slice(0, 3));
	assert.deepEqual(engines("deck_engines", "pull_request"), allDeck.slice(0, 2));
	assert.deepEqual(engines("editor_engines", "pull_request"), ["chromium"]);
	for (const event of ["schedule", "workflow_dispatch"]) {
		assert.deepEqual(engines("published_engines", event), allPublished);
		assert.deepEqual(engines("deck_engines", event), allDeck);
		assert.deepEqual(engines("editor_engines", event), ["chromium", "webkit"]);
	}
	for (const [output, expected] of [
		["published_engines", allPublished.slice(0, 3)],
		["deck_engines", allDeck.slice(0, 2)],
		["editor_engines", ["chromium"]],
	])
		assert.deepEqual(engines(output, "workflow_dispatch", { gate: "candidate" }), expected);
	for (const suite of ["a11y", "deck"])
		assert.equal(
			ci.jobs[`published-output-${suite}`].strategy.matrix.include,
			suite === "deck"
				? "${{ fromJSON(needs.changes.outputs.deck_engines) }}"
				: "${{ fromJSON(needs.changes.outputs.published_engines) }}",
		);
	assert.equal(
		ci.jobs["browser-editor"].strategy.matrix.browser,
		"${{ fromJSON(needs.changes.outputs.editor_engines) }}",
	);
});

test("module-deck coverage gates every engine with complete shards and retained evidence", () => {
	const job = ci.jobs["published-output-deck"];
	assert.ok(job, "Existing deck learner regressions must run in CI");
	assert.equal(job.strategy["fail-fast"], false);
	for (const browser of ["chromium", "webkit", "firefox"]) {
		const shards = engines("deck_engines", "schedule").filter((entry) => entry.browser === browser);
		assert.ok(shards.length > 0, `${browser} must run deck tests`);
		const total = Number(shards[0].shard.split("/")[1]);
		assert.deepEqual(
			shards.map((entry) => entry.shard).sort(),
			Array.from({ length: total }, (_, index) => `${index + 1}/${total}`),
		);
	}
	const prebuild = job.steps.findIndex(
		(step) => step.run === "pnpm --filter @praxity/export-pipeline prebuild:client",
	);
	const run = job.steps.findIndex((step) => step.run?.includes("test:deck"));
	assert.ok(
		prebuild >= 0 && prebuild < run,
		"Warm the shared compiler cache before browser workers",
	);
	assert.match(job.steps[run].run, /--project=\$\{\{ matrix\.browser \}\}/);
	assert.match(job.steps[run].run, /--shard=\$\{\{ matrix\.shard \}\}/);
	assert.equal(job.steps[run].if, "needs.changes.outputs.output == 'true'");
	const artifacts = job.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
	assert.deepEqual(
		artifacts.map((step) => step.with.name),
		Array(2).fill("published-output-deck-${{ matrix.artifact }}"),
	);
});

test("deck CLI exports prepare shipped assets and native PDF tools before learner journeys", () => {
	const steps = ci.jobs["published-output-deck"].steps;
	const run = steps.findIndex((step) => step.run?.includes("test:deck"));
	for (const command of [
		"pnpm --filter @praxity/desktop prebuild",
		"pnpm --filter @praxity/desktop prepare:typst",
		"./.github/actions/install-poppler",
	]) {
		const prepare = steps.findIndex((step) => (step.run ?? step.uses) === command);
		assert.ok(prepare >= 0 && prepare < run, `${command} must precede CLI exports`);
		assert.equal(steps[prepare].if, steps[run].if);
	}
});

const filters = (config) =>
	parse(config.jobs.changes.steps.find((step) => step.id === "filter").with.filters);
const changed = (globs, files) =>
	files.some((file) => globs.some((glob) => matchesGlob(file, glob)));

const browserSkipGlobs = (config = ci) =>
	JSON.parse(config.jobs.changes.steps.find((step) => step.id === "browser").env.BROWSER_SKIP);
const browserSelection = (files) =>
	browserRequired(browserSkipGlobs(), () => files.map((file) => `${file}\0`).join(""));

for (const [files, expected] of [
	[["docs/context/testing-strategy.md"], false],
	[["docs/context/testing-strategy.md", "packages/export-pipeline/src/html-gen.ts"], true],
	[["docs/superpowers/specs/evidence/x.vtt"], true],
	[["docs/test-fixtures/a.md"], true],
	[[".github/workflows/ci.yml"], true],
	[[".github/workflows/security.yml"], false],
	[[".github/actions/x/action.yml"], true],
	[["README.md"], false],
	[[], true],
	[["docs/research/x.md"], false],
	[["docs/wiki-learn/x.md"], false],
	[["docs/tasks/x.md"], false],
	[["docs/releases/x.md"], false],
	[["docs/rules/x.md"], false],
	[["docs/adr/x.md"], false],
	[["legal/x.txt"], false],
	[[".claude/skills/x.md"], false],
	[[".github/dependabot.yml"], false],
	[["nested/README.md"], true],
	[["apps/desktop/src/main/protocol.ts"], true],
]) {
	test(`ready browser skip-list: ${JSON.stringify(files)}`, () => {
		assert.equal(browserSelection(files), expected);
	});
}

test("candidate browser decision fetches full ancestry and uses the shared skip-list CLI", () => {
	const changes = ci.jobs.changes;
	const checkout = changes.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
	const depth = (inputs) =>
		workflowFunction("inputs", `return (${checkout.with["fetch-depth"].slice(3, -2)});`)(inputs);
	assert.equal(depth({ gate: "candidate" }), "0");
	assert.equal(depth({}), "2");
	const step = changes.steps.find((step) => step.id === "browser");
	assert.equal(step.if, "github.event_name == 'workflow_dispatch' && inputs.gate == 'candidate'");
	assert.equal(step.run, "node apps/desktop/scripts/ci-browser-cli.mjs --candidate");
	const source = readFileSync(new URL("./ci-browser.mjs", import.meta.url), "utf8");
	assert.doesNotMatch(source, /octokit|api\.github|GITHUB_EVENT|changed_files/);
	const setup = changes.steps.findIndex((step) => step.uses?.startsWith("actions/setup-node@"));
	assert.ok(setup >= 0 && setup < changes.steps.indexOf(step));
	assert.equal(
		changes.steps[setup].if,
		undefined,
		"Installed-byte admission also needs Node on schedules and ordinary dispatches",
	);
	assert.equal(changes.steps[setup].with["node-version"], "24.22.1");
	assert.equal(
		changes.steps.find((step) => step.id === "full_browser").if,
		"github.event_name != 'pull_request' && inputs.gate != 'candidate'",
	);
	for (const name of ["output", "browser_editor", "browser"]) {
		const expression = changes.outputs[name].slice(3, -2);
		const evaluate = (steps, event_name) =>
			workflowFunction("steps", "github", `return (${expression});`)(steps, { event_name });
		for (const selected of ["true", "false"]) {
			const steps = { full_browser: { outputs: {} }, browser: { outputs: { browser: selected } } };
			assert.equal(evaluate(steps, "workflow_dispatch"), selected);
			assert.equal(evaluate(steps, "pull_request"), "false");
		}
		assert.equal(
			evaluate({ full_browser: { outputs: {} }, browser: { outputs: {} } }, "workflow_dispatch"),
			"true",
			"Missing candidate output runs all suites",
		);
	}
});

// Include the shared source owners and CLI setup helpers as well as direct suite
// inputs, so a reference moved behind an import remains visible to this guard.
const browserInputPaths = [
	"packages/*/src/**/*",
	"packages/export-pipeline/template/**/*",
	"packages/export-pipeline/tests/{a11y,deck,fixtures}/**/*",
	"apps/desktop/{src,e2e}/**/*",
	"apps/desktop/browser.vite.config.ts",
	"apps/desktop/scripts/{prebuild-viewer.ts,standalone-cli-packaging.mjs,prepare-typst.mjs}",
	"docs/test-fixtures/**/*",
	"docs/prax-format/examples/**/*",
	// Literal closure of the suites' shared helpers and their fixture imports.
	// Keep these with the direct roots when adding a helper outside src/.
	"packages/grammar/__tests__/{helpers,fixtures}/**/*",
	"packages/export-pipeline/tests/{focus-assertions,muted-test}.ts",
	"packages/export-pipeline/tests/scorm-cloud/learner-simulation.ts",
	"apps/desktop/scripts/standalone-cli-paths.mjs",
	"packages/editor-core/test-support/**/*",
	"scripts/slow-tests-reporter.mjs",
	"vitest.workspace.ts",
];
const safeBrowserReferences = [
	...["cli", "export-handlers"].map((name) => ({
		file: `apps/desktop/src/main/__tests__/${name}.test.ts`,
		literal: '"legal"',
		count: 1,
		reason: "The PDF paper-size refusal fixture names a paper format, not a repository directory.",
	})),
	{
		file: "docs/test-fixtures/grammar3-published-baseline.md",
		literal: "../context/converter-archive.md",
		count: 1,
		reason:
			"This archived-baseline report links to reproduction instructions; it is not compiled fixture input.",
	},
	{
		file: "packages/export-pipeline/template/src/components/scorm-resume-focus.a11y.md",
		literal: "docs/context/published-output-runtime.md",
		count: 1,
		reason: "This accessibility design note links to policy; the template does not load the note.",
	},
	...["en", "fr"].map((language) => ({
		file: `packages/editor-core/src/messages/${language}.json`,
		literal: "docs/context/converter-archive.md",
		count: 1,
		reason: "The retired grammar diagnostic displays a documentation link; it never reads it.",
	})),
	{
		file: "packages/grammar/src/read-lesson.ts",
		literal: "docs/context/converter-archive.md",
		count: 1,
		reason: "The grammar refusal prints this link without reading the documentation.",
	},
	{
		file: "apps/desktop/scripts/standalone-cli-packaging.mjs",
		literal: '"README.md"',
		count: 1,
		reason: "packagePraxFormat copies the README under docs/prax-format, not the root README.",
	},
	{
		file: "apps/desktop/scripts/standalone-cli-packaging.mjs",
		literal: '"legal/"',
		count: 1,
		reason:
			"Payload inventory classifies an already copied notice; it does not read the root legal tree.",
	},
	{
		file: "apps/desktop/scripts/prepare-typst.mjs",
		literal:
			"https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/${name}.${extension}",
		count: 1,
		reason: "The URL downloads a pinned toolchain asset, not a file in docs/releases.",
	},
];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const root = new URL("../../../", import.meta.url);
function browserInputViolations(config, entries) {
	const references = browserSkipGlobs(config).flatMap((glob) => {
		if (glob.endsWith("/**")) {
			const parts = glob.split("/");
			const segment = escapeRegex(parts.at(-2)).replaceAll("\\*", "[^/\\s\"'`]*");
			if (parts.length === 2) return `${segment}(?:/|(?=["'\x60]))`;
			// A docs directory can be a separate join argument. Qualify it by its
			// parent so ordinary content fields named "context" remain valid.
			return [
				`${segment}/`,
				`(?<=/)${segment}(?=["'\x60])`,
				`(?<=["'\x60]${escapeRegex(parts.at(-3))}["'\x60]\\s*,\\s*["'\x60])${segment}(?=["'\x60])`,
			];
		}
		if (glob === "*.md")
			return readdirSync(root)
				.filter((file) => file.endsWith(".md"))
				.map(escapeRegex);
		if (glob === ".github/dependabot.yml") return "dependabot\\.yml";
		if (glob === ".github/workflows/!(ci).yml") return "workflows/(?!ci\\.yml)[^/\\s\"'`]+\\.yml";
		assert.fail(`Update the reference guard for unsupported skip glob: ${glob}`);
	});
	const reference = new RegExp(`(?<=[/"'\x60])(?:${references.join("|")})`, "g");
	const printer = ts.createPrinter({ removeComments: true });
	return entries.flatMap(([file, contents]) => {
		// Parse code before removing comments: URL slashes and template literals
		// are data, not comment delimiters. Fixture prose only has HTML comments.
		const source = /\.[cm]?[jt]sx?$/.test(file)
			? printer.printFile(ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true))
			: contents.replace(/<!--[\s\S]*?-->/g, "");
		return [...source.matchAll(reference)].flatMap((match) => {
			const safe = safeBrowserReferences.some(({ file: allowed, literal, count, reason }) => {
				assert.ok(reason);
				if (file !== allowed) return false;
				if (source.split(literal).length - 1 > count) return false;
				let start = source.indexOf(literal);
				while (start !== -1) {
					if (start <= match.index && match.index < start + literal.length) return true;
					start = source.indexOf(literal, start + 1);
				}
				return false;
			});
			return safe ? [] : [`${file}: ${match[0]}`];
		});
	});
}

const browserInputFiles = () =>
	[...new Set(globSync(browserInputPaths, { cwd: root }))]
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => statSync(new URL(file, root)).isFile())
		// Extra shared owners contribute executable code and messages, not their
		// unrelated unit tests or package documentation. Direct scope stays whole.
		.filter(
			(file) =>
				!file.startsWith("packages/") ||
				file.startsWith("packages/export-pipeline/") ||
				(!/\.(test|spec)\./.test(file) && !file.endsWith(".md")),
		);

test("browser sources and fixture data never read a skip-listed path", () => {
	const files = browserInputFiles();
	assert.ok(files.includes("apps/desktop/scripts/prebuild-viewer.ts"));
	assert.ok(files.includes("apps/desktop/src/inspection-frame.ts"));
	const entries = files
		.map((file) => [file, readFileSync(new URL(file, root))])
		// Inspect all text fixtures regardless of extension; media bytes are not source.
		.filter(([, bytes]) => isUtf8(bytes) && !bytes.includes(0))
		.map(([file, bytes]) => [file, bytes.toString("utf8")]);
	assert.deepEqual(browserInputViolations(ci, entries), []);
});

test("skip-path guard catches new source and data references, but ignores comments", () => {
	const fixtures = [
		["packages/export-pipeline/tests/fixtures/planted.ts", 'readFile("docs/context/x.md")'],
		["docs/test-fixtures/planted.json", '{"path":"../context/x.md"}'],
		["docs/prax-format/examples/planted.prax", "[file](../../context/x.md)"],
		["apps/desktop/e2e/fixtures/planted.md", "`context/x.md`"],
		["docs/test-fixtures/planted.csv", 'path\n"docs/context/x.md"'],
		["packages/export-pipeline/src/planted.ts", 'readFile("README.md")'],
		["apps/desktop/e2e/planted.ts", 'readFile("docs/wiki-learn/x.md")'],
	];
	for (const entry of fixtures)
		assert.equal(browserInputViolations(ci, [entry]).length, 1, entry[0]);
	assert.deepEqual(
		browserInputViolations(ci, [
			[
				"packages/export-pipeline/src/comment.ts",
				'// docs/context/x.md\n/* "README.md" */\nconst url = "https://example.com/x";',
			],
			["docs/test-fixtures/comment.md", "<!-- docs/context/x.md -->"],
		]),
		[],
	);
	assert.equal(
		browserInputViolations(ci, [
			["packages/grammar/src/read-lesson.ts", 'readFile("docs/context/x.md")'],
		]).length,
		1,
		"allowlist is literal-specific",
	);
});

for (const source of [
	'readFile(join(root, "docs", "context", "x.md"))',
	'readFile(join(repo, "legal", "notice.txt"))',
	'readFile(join(repo, ".claude", "settings.json"))',
	'readFile(join(repo, "README.md"))',
]) {
	test(`split path arguments remain guarded: ${source}`, () => {
		assert.ok(
			browserInputViolations(ci, [["apps/desktop/e2e/planted.ts", source]]).length > 0,
			source,
		);
	});
}

for (const file of [
	"apps/desktop/browser.vite.config.ts",
	"packages/export-pipeline/template/review-comments.js",
	"packages/grammar/__tests__/helpers/lesson-fixture.ts",
	"packages/grammar/__tests__/fixtures/grammar4-starters.json",
]) {
	test(`browser configuration, template and imported helper input is guarded: ${file}`, () => {
		const files = browserInputFiles();
		const entries = files.includes(file) ? [[file, 'readFile("docs/context/x.md")']] : [];
		assert.deepEqual(browserInputViolations(ci, entries), [`${file}: context/`], file);
	});
}

test("repeating an allowed literal in the same file cannot add a new read", () => {
	const file = "apps/desktop/scripts/standalone-cli-packaging.mjs";
	const source = readFileSync(new URL(file, root), "utf8");
	assert.deepEqual(browserInputViolations(ci, [[file, source]]), []);
	assert.ok(
		browserInputViolations(ci, [[file, `${source}\nreadFile(join(cwd, "README.md"));\n`]]).length >
			0,
	);
});

for (const file of [
	".github/actions/install-poppler/action.yml",
	".github/workflows/cli-candidate.yml",
	"apps/desktop/scripts/build-cli-archives.sh",
]) {
	test(`CLI packaging policy checks run for ${file}`, () => {
		assert.equal(changed(filters(ci).code, [file]), true);
	});
}

const bash =
	process.platform === "win32"
		? join(
				process.env.ProgramFiles ??
					join(process.env.SystemDrive ?? parsePath(process.execPath).root, "Program Files"),
				"Git/bin/bash.exe",
			)
		: "/bin/bash";

test("root Node checks run once while Vitest shards bypass the local test prefix", () => {
	const nodeJob = ci.jobs["node-checks"];
	assert.ok(nodeJob, "Root checks need their own job, outside the four Vitest shards");
	assert.equal(nodeJob.strategy, undefined);
	assertNodeCheckPartition(nodeJob);
	const nodeSteps = Object.values(ci.jobs).flatMap((job) =>
		(job.steps ?? []).filter((step) => /node --test\b/.test(step.run ?? "")),
	);
	assert.equal(nodeSteps.length, 2);
	assert.ok(nodeSteps.every((step) => nodeJob.steps.includes(step)));
	for (const event_name of ["pull_request", "workflow_dispatch", "schedule"])
		assert.equal(enabled(nodeJob.if.slice(3, -2), { event_name }, { code: "true" }), true);
	assert.equal(nodeJob["runs-on"], "ubuntu-24.04");
	assert.equal(nodeJob["timeout-minutes"], 15);
	assert.ok(ci.jobs.test.strategy.matrix.shard.includes(1));
	assert.ok(
		ci.jobs.test.steps.some(
			(step) =>
				step.run ===
				"bash scripts/run-vitest-isolated.sh pnpm exec vitest run --config vitest.workspace.ts --shard=${{ matrix.shard }}/4",
		),
	);
	const local = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
	assert.equal(
		local.scripts.test,
		"node --import tsx --test scripts/preflight-gates.test.mts && node --test --test-concurrency=3 scripts/*.test.mjs apps/desktop/scripts/*.test.mjs && vitest run --config vitest.workspace.ts",
	);
	const preflightSteps = nodeJob.steps.filter((step) =>
		step.run?.includes("scripts/preflight-gates.test.mts"),
	);
	assert.equal(preflightSteps.length, 1);
	assert.equal(preflightSteps[0].if, undefined);
	assert.ok(!ci.jobs.test.steps.some((step) => step.run?.includes("node --test")));
});

for (const [name, mutate, message] of [
	[
		"a dropped file",
		(job) => {
			const step = job.steps.find((step) => step.id === "node-parallel");
			step.run = step.run.replace('"${tests[@]}"', '"${tests[@]:1}"');
		},
		/Every Node test file must run exactly once/,
	],
	[
		"a file in both steps",
		(job) => {
			const step = job.steps.find((step) => step.id === "node-parallel");
			step.run = step.run.replace('[[ "$serial_tests" != *" $file "* ]]', "true");
		},
		/Every Node test file must run exactly once/,
	],
	[
		"serial concurrency four",
		(job) => {
			const step = job.steps.find((step) => step.id === "node-serial");
			step.run = step.run.replace("--test-concurrency=1", "--test-concurrency=4");
		},
		/--test-concurrency=1/,
	],
	[
		"failure hiding the parallel step",
		(job) => {
			delete job.steps.find((step) => step.id === "node-parallel").if;
		},
		/!cancelled/,
	],
	[
		"a parallel step after a failed install",
		(job) => {
			job.steps.find((step) => step.id === "node-parallel").if = "${{ !cancelled() }}";
		},
		/steps.install.outcome/,
	],
	[
		"an ignored failure",
		(job) => {
			job.steps.find((step) => step.id === "node-serial")["continue-on-error"] = true;
		},
		/Either test failure must fail the job/,
	],
]) {
	test(`Node partition policy refuses ${name}`, () => {
		const job = structuredClone(ci.jobs["node-checks"]);
		mutate(job);
		assert.throws(() => assertNodeCheckPartition(job), message);
	});
}

test("Node partition matches complete paths beside prefixed and same-basename files", (t) => {
	assertNodeCheckPartition(ci.jobs["node-checks"], 4, nodePartitionFixture(t));
});

for (const [name, job, workers, serialCondition] of [
	["CI", ci.jobs["node-checks"], 4, undefined],
]) {
	test(`${name} serial Node step refuses empty manifests before invoking Node`, (t) => {
		for (const contents of ["", "\n \t\n"]) {
			const directory = retentionFixture(t, { "scripts/serial-node-tests.txt": contents });
			assert.throws(
				() => assertNodeCheckPartition(job, workers, directory, serialCondition),
				/serial-node-tests.txt must list at least one test/,
			);
			const step = job.steps.find((entry) => entry.id === "node-serial");
			const result = spawnSync(
				bash,
				["-e", "-o", "pipefail", "-c", `node() { echo unexpected-node-invocation; }\n${step.run}`],
				{ cwd: directory, encoding: "utf8" },
			);
			assert.equal(result.status, 1, result.stderr);
			assert.equal(result.stdout, "", "Empty selection must never invoke Node");
			assert.match(result.stderr, /serial-node-tests.txt must list at least one test/);
		}
	});
}

for (const [name, original, replacement] of [
	["a dropped trailing boundary", '*" $file "*', '*" $file"*'],
	["a basename-only match", '*" $file "*', '*"${file##*/} "*'],
]) {
	test(`Node matcher fixture catches ${name}`, (t) => {
		const job = structuredClone(ci.jobs["node-checks"]);
		const parallel = job.steps.find((step) => step.id === "node-parallel");
		assert.ok(parallel.run.includes(original), "Mutation must reach the workflow matcher");
		parallel.run = parallel.run.replace(original, replacement);
		assert.throws(
			() => assertNodeCheckPartition(job, 4, nodePartitionFixture(t)),
			/Every Node test file must run exactly once/,
		);
	});
}

test("test shards have busy-runner headroom but retain a finite job deadline", () => {
	assert.equal(ci.jobs.test["timeout-minutes"], 15);
	const first = ci.jobs.test.steps[0];
	assert.equal(first.name, "Set confirmation deadline");
	assert.equal(Number(first.run.match(/\+ (\d+) \* 60 - 45/)[1]), ci.jobs.test["timeout-minutes"]);
	assert.match(first.run, /CI_JOB_DEADLINE_MS=.*date \+%s.*\* 1000.*GITHUB_ENV/);
});

test("fast checks validate every workflow with pinned, verified actionlint and retain its failure", () => {
	checkActionlintConfig(actionlintConfig);
	const job = ci.jobs["fast-checks"];
	const step = job.steps.find((entry) => entry.id === "actionlint");
	assert.ok(step, "Workflow syntax and expression errors must fail CI");
	assert.equal(step.if, "${{ !cancelled() && steps.install.outcome == 'success' }}");
	assert.equal(step["continue-on-error"], true);
	assert.match(step.run, /\/v1\.7\.11\/actionlint_1\.7\.11_linux_amd64\.tar\.gz/);
	assert.doesNotMatch(step.run, /latest/);
	assert.match(step.run, /900919a84f2229bac68ca9cd4103ea297abc35e9689ebb842c6e34a3d1b01b0a/);
	assert.match(step.run, /sha256sum --check/);
	assert.ok(step.run.indexOf("sha256sum --check") < step.run.indexOf("tar -xzf"));
	assert.match(step.run, /actionlint"? -shellcheck= \.github\/workflows\/\*\.\{yml,yaml\}\s*$/);
	assert.doesNotMatch(step.run, /\|\| true/);
	const script = job.steps
		.find((entry) => entry.id === "verdict")
		.run.match(/<<'NODE'\n([\s\S]*)\nNODE\s*$/)?.[1];
	assert.ok(script);
	const steps = Object.fromEntries(
		job.steps
			.filter((entry) => entry.id && entry.id !== "verdict")
			.map((entry) => [entry.id, { outcome: "success" }]),
	);
	const verdict = () =>
		spawnSync(process.execPath, ["--input-type=module", "-e", script], {
			encoding: "utf8",
			env: { ...process.env, CI_STEPS: JSON.stringify(steps) },
		});
	assert.equal(verdict().status, 0);
	for (const outcome of ["failure", "skipped", "cancelled"]) {
		steps.actionlint.outcome = outcome;
		assert.equal(verdict().status, 1, `actionlint ${outcome} must fail the verdict`);
	}
});

test("actionlint policy refuses ignored findings and shell success overrides", () => {
	assert.throws(() => checkActionlintConfig({ ...actionlintConfig, ignore: [".*"] }));
	const command = ci.jobs["fast-checks"].steps.find((step) => step.id === "actionlint").run;
	for (const suffix of [" || exit 0", " || true"]) {
		assert.throws(() =>
			assert.match(
				`${command.trimEnd()}${suffix}`,
				/actionlint"? -shellcheck= \.github\/workflows\/\*\.\{yml,yaml\}\s*$/,
			),
		);
	}
});

test("browser editor runs three complete Chromium shards with two workers", () => {
	assert.deepEqual(ci.jobs["browser-editor"].strategy.matrix.shard, ["1/3", "2/3", "3/3"]);
	assert.deepEqual(engines("editor_engines", "pull_request"), ["chromium"]);
	assert.ok(ci.jobs["browser-editor"].steps.some((step) => step.run?.endsWith("--workers=2")));
});

for (const name of ["published-output-a11y", "published-output-deck", "browser-editor"]) {
	test(`${name} caches the locked Playwright browser and installs system dependencies on hits and misses`, () => {
		const steps = ci.jobs[name].steps;
		const install = steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
		const version = steps.findIndex((step) => step.id === "playwright-version");
		const cache = steps.findIndex((step) => step.uses?.startsWith("actions/cache@"));
		const browser = steps.findIndex((step) => step.uses === "./.github/actions/install-playwright");
		assert.ok(install >= 0 && install < version && version < cache && cache < browser);
		assert.equal(steps[cache].with.path, "~/.cache/ms-playwright");
		assert.equal(
			steps[cache].with.key,
			"${{ runner.os }}-playwright-${{ steps.playwright-version.outputs.version }}-${{ matrix.browser }}",
		);
		assert.equal(steps[cache].with["restore-keys"], undefined);
		assert.equal(steps[cache].with["fail-on-cache-miss"], undefined);
		// The same admission on install and restore keeps apt and download recovery
		// active on both cache hits and misses.
		for (const index of [version, cache, browser]) assert.equal(steps[index].if, steps[install].if);
		assert.equal(steps[browser].with.browser, "${{ matrix.browser }}");
		assert.equal(
			steps[browser].with["playwright-version"],
			"${{ steps.playwright-version.outputs.version }}",
		);
		assert.equal(
			steps[browser].with.package,
			name === "browser-editor" ? "@praxity/desktop" : "@praxity/export-pipeline",
		);
		assert.match(steps[version].run, />> "\$GITHUB_OUTPUT"/);
		const script = steps[version].run.match(/node -e "([^"]+)"/)?.[1];
		assert.ok(script, "Execute the version output from the installed frozen-lockfile dependency");
		const workspace = name === "browser-editor" ? "apps/desktop" : "packages/export-pipeline";
		assert.ok(
			steps[version].run.startsWith(
				`pnpm --filter @praxity/${name === "browser-editor" ? "desktop" : "export-pipeline"} exec `,
			),
		);
		const run = spawnSync(process.execPath, ["-e", script], {
			cwd: new URL(`../../../${workspace}/`, import.meta.url),
			encoding: "utf8",
		});
		assert.equal(run.status, 0, run.stderr);
		const lock = parse(readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8"));
		assert.equal(
			run.stdout.trim(),
			`version=${lock.importers[workspace].devDependencies["@playwright/test"].version}`,
		);
	});
}

test("machine-path checks run on every PR, including docs-only changes", () => {
	assert.ok(ci.on.pull_request);
	const job = ci.jobs.changes;
	assert.equal(job.if, "github.repository == (vars.STUDIO_SOURCE_REPO || github.repository)");
	const checkout = job.steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
	const guard = job.steps.findIndex((step) => step.run === "node scripts/check-machine-paths.mjs");
	assert.ok(checkout >= 0 && guard > checkout);
	assert.equal(job.steps[checkout].if, undefined);
	assert.equal(job.steps[guard].if, undefined);
});

test("Linux Vitest shards prepare the native PDF compiler and Poppler before tests", () => {
	const job = ci.jobs.test;
	assert.equal(job["runs-on"], "ubuntu-24.04");
	assert.deepEqual(job.strategy.matrix.shard, [1, 2, 3, 4]);
	assert.equal(job.name, "Test ${{ matrix.shard }}/4");
	const run = job.steps.findIndex((step) => step.run?.includes("vitest run"));
	for (const command of [
		"pnpm --filter @praxity/desktop prepare:typst",
		"./.github/actions/install-poppler",
	]) {
		const prepare = job.steps.findIndex((step) => (step.run ?? step.uses) === command);
		assert.ok(prepare >= 0 && prepare < run, `${command} must precede native PDF tests`);
		assert.equal(job.steps[prepare].if, "needs.changes.outputs.code == 'true'");
	}
});

function assertPopplerSteps(workflow) {
	for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
		for (const step of job.steps ?? []) {
			assert.doesNotMatch(
				step.run ?? "",
				/apt-get\b[\s\S]*\bpoppler-utils\b/,
				`${jobName}: use the shared Poppler action`,
			);
			if (!/poppler/i.test(`${step.name ?? ""} ${step.uses ?? ""}`)) continue;
			assert.ok(
				Number.isInteger(step["timeout-minutes"]) &&
					step["timeout-minutes"] > 0 &&
					step["timeout-minutes"] <= 5,
				`${jobName}: Poppler needs a timeout-minutes limit of at most five`,
			);
		}
	}
}

test("every workflow uses bounded Poppler steps without raw apt installs", () => {
	const directory = new URL("../../../.github/workflows/", import.meta.url);
	for (const name of readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)))
		assertPopplerSteps(parse(readFileSync(new URL(name, directory), "utf8")));
	for (const [name, condition] of [
		["affected-test", undefined],
		["test", "needs.changes.outputs.code == 'true'"],
		["published-output-a11y", "needs.changes.outputs.output == 'true'"],
		["published-output-deck", "needs.changes.outputs.output == 'true'"],
	]) {
		const steps = ci.jobs[name].steps.filter(
			(step) => step.uses === "./.github/actions/install-poppler",
		);
		assert.equal(steps.length, 1, `${name}: prepare Poppler once`);
		assert.equal(steps[0].if, condition);
		assert.equal(steps[0]["timeout-minutes"], 5);
	}
});

test("Poppler policy catches planted raw installs and missing or excessive timeouts", () => {
	const valid = { uses: "./.github/actions/install-poppler", "timeout-minutes": 5 };
	const workflow = (step) => ({ jobs: { future: { steps: [step] } } });
	assertPopplerSteps(workflow(valid));
	for (const run of [
		"sudo apt-get install -y -qq --no-install-recommends poppler-utils",
		"sudo apt-get install -q \\\n  poppler-utils",
	])
		assert.throws(() => assertPopplerSteps(workflow({ run })), /use the shared Poppler action/);
	for (const timeout of [undefined, 0, 6, "5", "${{ inputs.timeout }}"])
		assert.throws(
			() => assertPopplerSteps(workflow({ ...valid, "timeout-minutes": timeout })),
			/Poppler needs a timeout-minutes limit/,
		);
	assert.throws(
		() => assertPopplerSteps(workflow({ name: "Install Poppler", run: "prepare-pdf-tools" })),
		/Poppler needs a timeout-minutes limit/,
	);
});

for (const [scenario, commands, status] of [
	["installed", [], 0],
	["fresh", ["install"], 0],
	["stale", ["install", "update", "install"], 0],
	["update-fails", ["install", "update"], 1],
	["install-fails", ["install", "update", "install"], 1],
	["broken", [], 1],
	["missing", ["install"], 1],
]) {
	test(`Poppler composite handles ${scenario} through its shell commands`, () => {
		const action = parse(
			readFileSync(
				new URL("../../../.github/actions/install-poppler/action.yml", import.meta.url),
				"utf8",
			),
		);
		assert.equal(action.runs.using, "composite");
		assert.equal(action.runs.steps.length, 1);
		assert.equal(action.runs.steps[0].shell, "bash");
		// External commands are the seam; execute the actual composite shell with fake apt and Poppler.
		const prefix = `scenario=${scenario}
available=false
[[ $scenario != installed && $scenario != broken ]] || available=true
attempts=0
command() {
  if [[ $1 == -v && $2 == pdftotext ]]; then
    [[ $available == true ]]
  else
    builtin command "$@"
  fi
}
sudo() {
  [[ $1 == apt-get ]] || return 99
  printf '%s\\n' "$*"
  case " $* " in
    *" install "*)
      attempts=$((attempts + 1))
      if [[ $scenario == install-fails || $scenario == update-fails || $scenario == stale && $attempts == 1 ]]; then
        return 1
      fi
      [[ $scenario == missing ]] || available=true
      ;;
    *" update "*) [[ $scenario != update-fails ]] || return 1 ;;
    *) return 98 ;;
  esac
}
pdftotext() {
  printf 'pdftotext %s\\n' "$*"
  [[ $1 == -v && $available == true && $scenario != broken ]]
}
`;
		const result = spawnSync(
			bash,
			["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", prefix + action.runs.steps[0].run],
			{
				encoding: "utf8",
			},
		);
		assert.equal(result.status, status, result.stderr || result.stdout);
		const apt = result.stdout.split("\n").filter((line) => line.startsWith("apt-get "));
		assert.deepEqual(
			apt.map((line) => /\b(install|update)\b/.exec(line)?.[1]),
			commands,
		);
		for (const line of apt) {
			for (const option of [
				"Acquire::Retries=1",
				"Acquire::http::Timeout=20",
				"Acquire::https::Timeout=20",
				"DPkg::Lock::Timeout=30",
			])
				assert.ok(line.includes(`-o ${option}`), line);
			assert.match(line, /(?:^| )-q(?: |$)/);
			assert.doesNotMatch(line, /-qq/);
			// A failed third-party source must not stop the retry install; that install and pdftotext -v fail loudly.
			assert.doesNotMatch(line, /--error-on/);
			if (line.includes(" install "))
				assert.match(line, /-y -q --no-install-recommends poppler-utils$/);
		}
		if (scenario === "installed") assert.match(result.stdout, /already.*skip/i);
		if (status === 0 || scenario === "broken" || scenario === "missing")
			assert.match(result.stdout, /pdftotext -v/);
	});
}

function assertShardTmpfs(job) {
	const prepare = job.steps.findIndex((step) => step.id === "test-tmpfs");
	const run = job.steps.findIndex((step) => step.run?.includes("vitest run"));
	const confirm = job.steps.findIndex(
		(step) => step.name === "Confirm slow tests after Vitest exits",
	);
	const cleanup = job.steps.findIndex((step) => step.name === "Clean Test tmpfs");
	assert.ok(prepare >= 0 && prepare < run && run < confirm && confirm < cleanup);
	const step = job.steps[prepare];
	assert.equal(step.if, "needs.changes.outputs.code == 'true'");
	assert.match(step.run, /mktemp -d \/dev\/shm\/vitest\.XXXXXX/);
	assert.match(
		step.run,
		/sudo mount -t tmpfs -o "size=1G,exec,mode=700,uid=\$\(id -u\),gid=\$\(id -g\)" tmpfs "\$directory"/,
	);
	assert.match(step.run, /printf 'TMPDIR=%s\\n' "\$directory" >> "\$GITHUB_ENV"/);
	assert.ok(step.run.indexOf("sudo mount") < step.run.indexOf("'TMPDIR="));
	assert.equal(job.steps[cleanup].if, "${{ !cancelled() && steps.test-tmpfs.outputs.path != '' }}");
	assert.equal(
		job.steps[cleanup].run.trim(),
		`printf 'TMPDIR=%s\\n' "$RUNNER_TEMP" >> "$GITHUB_ENV"`,
	);
}

test("only full Linux Test shards use bounded executable tmpfs and restore temp paths unless cancelled", () => {
	assertShardTmpfs(ci.jobs.test);
	for (const [name, job] of Object.entries(ci.jobs))
		if (name !== "test") assert.ok(!JSON.stringify(job).includes("/dev/shm/vitest."));
	for (const violation of ["unbounded", "noexec", "late prepare", "skip failed cleanup"]) {
		const job = structuredClone(ci.jobs.test);
		const prepare = job.steps.find((step) => step.id === "test-tmpfs");
		if (violation === "unbounded") prepare.run = prepare.run.replace("size=1G,", "");
		if (violation === "noexec") prepare.run = prepare.run.replace(",exec,", ",noexec,");
		if (violation === "late prepare")
			job.steps.push(job.steps.splice(job.steps.indexOf(prepare), 1)[0]);
		if (violation === "skip failed cleanup")
			job.steps.find((step) => step.name === "Clean Test tmpfs").if = "success()";
		assert.throws(() => assertShardTmpfs(job), undefined, violation);
	}
});

test("Test tmpfs scripts restore temp paths whether or not setup succeeded", () => {
	const prepare = ci.jobs.test.steps.find((step) => step.id === "test-tmpfs");
	const cleanup = ci.jobs.test.steps.find((step) => step.name === "Clean Test tmpfs");
	const directory = mkdtempSync(join(tmpdir(), "test-tmpfs-policy-"));
	try {
		const output = join(directory, "output");
		const env = join(directory, "env");
		const log = join(directory, "log");
		const prefix = `
mktemp() { if [ "$MKTEMP_STATUS" != 0 ]; then return "$MKTEMP_STATUS"; fi; printf '%s\\n' "$TEST_TMPFS"; }
sudo() { printf '%s\\n' "$*" >> "$TEST_LOG"; if [ "$1" = mount ]; then return "$MOUNT_STATUS"; fi; return 32; }
df() { :; }
free() { :; }
`;
		for (const [mountStatus, mktempStatus] of [
			[0, 0],
			[1, 0],
			[0, 1],
		]) {
			const mountedSuccessfully = mountStatus === 0 && mktempStatus === 0;
			writeFileSync(output, "");
			writeFileSync(env, "");
			writeFileSync(log, "");
			const options = {
				encoding: "utf8",
				env: {
					...process.env,
					GITHUB_ENV: env,
					GITHUB_OUTPUT: output,
					RUNNER_TEMP: "/disk-temp",
					TEST_TMPFS: "/dev/shm/vitest.fixture",
					TEST_LOG: log,
					MOUNT_STATUS: String(mountStatus),
					MKTEMP_STATUS: String(mktempStatus),
				},
			};
			const run = (step) =>
				spawnSync(bash, ["-e", "-o", "pipefail", "-c", prefix + step.run], options);
			const mounted = run(prepare);
			assert.equal(mounted.status, 0, mounted.stderr);
			assert.equal(
				readFileSync(output, "utf8"),
				mountedSuccessfully ? "path=/dev/shm/vitest.fixture\n" : "",
			);
			if (!mountedSuccessfully) assert.match(mounted.stdout, /tmpfs unavailable.*runner temp/i);
			assert.equal(
				readFileSync(env, "utf8"),
				mountedSuccessfully ? "TMPDIR=/dev/shm/vitest.fixture\n" : "TMPDIR=/disk-temp\n",
			);
			const cleaned = run(cleanup);
			assert.equal(cleaned.status, 0, cleaned.stderr);
			assert.ok(readFileSync(env, "utf8").endsWith("TMPDIR=/disk-temp\n"));
			assert.ok(!readFileSync(log, "utf8").includes("umount"));
		}
	} finally {
		rmSync(directory, { recursive: true });
	}
});

for (const [suite, output, shards] of [
	["a11y", "published_engines", ["1/3", "2/3", "3/3"]],
	["deck", "deck_engines", ["1/2", "2/2"]],
]) {
	test(`${suite} published output runs on four CPUs with complete Chromium shards`, () => {
		const job = ci.jobs[`published-output-${suite}`];
		assert.equal(job["runs-on"], browserRunner);
		assert.equal(job.strategy["fail-fast"], false);
		assert.deepEqual(
			engines(output, "workflow_dispatch", { gate: "candidate" }).map((entry) => entry.shard),
			shards,
		);
		assert.ok(job.steps.some((step) => step.run?.includes("--shard=${{ matrix.shard }}")));
	});

	test(`${suite} published output retains failed-run timestamps, reports and traces`, () => {
		const job = ci.jobs[`published-output-${suite}`];
		const after = job.steps.find((step) => step.name === "Summarize published-output timing");
		assert.ok(after, "Every suite needs an always-run timing summary");
		assert.equal(after.if, "${{ !cancelled() && needs.changes.outputs.output == 'true' }}");
		assert.match(after.run, /ended_at=/);
		assert.match(after.run, /timing-summary\.mjs/);
		assert.ok(job.steps.some((step) => step.run?.includes("started_at=")));
		const uploads = job.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
		const name =
			suite === "deck"
				? "published-output-deck-${{ matrix.artifact }}"
				: "published-output-${{ matrix.artifact }}";
		const results = `packages/export-pipeline/test-results/${suite}`;
		// Failed runs keep screenshots and traces; passing runs keep only timing and
		// results, because full evidence for every run filled the artifact quota.
		const failed = uploads.find((step) => step.if.startsWith("failure()"));
		assert.equal(failed?.if, "failure() && !cancelled() && needs.changes.outputs.output == 'true'");
		assert.equal(failed.with.name, name);
		assert.equal(failed.with.path, `${results}/`);
		const passed = uploads.find((step) => step.if.startsWith("success()"));
		assert.equal(passed?.if, "success() && needs.changes.outputs.output == 'true'");
		assert.equal(passed.with.name, name);
		assert.deepEqual(passed.with.path.trim().split(/\r?\n/), [
			`${results}/results.json`,
			`${results}/timing-summary.md`,
			`${results}/timestamps.txt`,
		]);
		assert.equal(uploads.length, 2);
		// Failure evidence stays a week; passing timing a day. Neither upload may
		// turn a test verdict red when the artifact store is full.
		assert.equal(failed.with["retention-days"], 7);
		assert.equal(passed.with["retention-days"], 1);
		for (const upload of uploads) assert.equal(upload["continue-on-error"], true);
	});

	test(`${suite} browser workers preserve complete muted journeys and isolated retry evidence`, async () => {
		const { default: config } = await import(
			`../../../packages/export-pipeline/tests/${suite}/playwright.config.ts`
		);
		assert.equal(config.workers, 2);
		assert.equal(config.fullyParallel, false);
		assert.equal(config.retries, process.env.CI ? 1 : 0);
		assert.equal(config.use.trace, "on-first-retry");
		assert.equal(config.use.headless, true);
		const project = (name) => config.projects.find((entry) => entry.name === name);
		// Chromium mutes by flag. Linux WebKit refuses to launch with --mute-audio,
		// and Firefox mutes through media.default_volume (asserted below).
		assert.ok(project("chromium").use.launchOptions.args.includes("--mute-audio"));
		for (const name of ["webkit", "firefox"]) {
			assert.ok(
				!(project(name).use.launchOptions?.args ?? []).includes("--mute-audio"),
				`${name} must not receive --mute-audio`,
			);
		}
		assert.equal(config.use.launchOptions, undefined, "launch flags are per engine");
		assert.equal(config.outputDir, `../../test-results/${suite}/artifacts`);
		assert.ok(Array.isArray(config.reporter), "Every suite needs JSON timing evidence");
		const json = config.reporter.find(([name]) => name === "json");
		assert.equal(json[1].outputFile, `../../test-results/${suite}/results.json`);
		assert.equal(
			config.projects.find((project) => project.name === "firefox").use.launchOptions
				.firefoxUserPrefs["media.default_volume"],
			"0.0",
		);
	});
}

// These gates use the JS-compatible subset of Actions expressions. Evaluate
// the workflow's expression so the fixtures exercise the actual job condition.
const enabled = (expression, github, outputs, labels = []) =>
	workflowFunction(
		"github",
		"needs",
		"contains",
		"cancelled",
		"labels",
		`return (${expression.replaceAll("github.event.pull_request.labels.*.name", "labels")});`,
	)(
		github,
		{ changes: { outputs, result: "success" } },
		(values, value) => values.includes(value),
		() => false,
		labels,
	);

// Browser suites run only when a change can reach published output or its tests.
for (const [name, files, expected] of [
	["docs-only", ["docs/context/testing-strategy.md"], false],
	[
		"CLI candidate workflow and archives",
		[".github/workflows/cli-candidate.yml", "apps/desktop/scripts/build-cli-archives.sh"],
		false,
	],
	["desktop main process", ["apps/desktop/src/main/protocol.ts"], false],
	["legal archive", ["legal/archive/0.2.0/COMPONENT-SCHEDULE.shipped.md"], false],
	["export pipeline", ["packages/export-pipeline/src/html-gen.ts"], true],
	["grammar", ["packages/grammar/src/read-lesson.ts"], true],
	[
		"compositions used by the suites",
		["apps/desktop/src/renderer/components/panels/compositions-data.ts"],
		true,
	],
	["suite fixture assets", ["docs/test-fixtures/assets/narration-sample.mp3"], true],
	["lockfile", ["pnpm-lock.yaml"], true],
	["this workflow", [".github/workflows/ci.yml"], true],
]) {
	test(`published-output suites selection: ${name}`, () => {
		assert.equal(changed(filters(ci).output, files), expected);
		for (const suite of ["a11y", "deck"]) {
			const run = ci.jobs[`published-output-${suite}`].steps.find((step) =>
				step.run?.includes(`test:${suite}`),
			);
			assert.equal(run.if, "needs.changes.outputs.output == 'true'");
		}
	});
}

for (const [name, event, files, expected] of [
	["renderer-only PR", "pull_request", ["apps/desktop/src/renderer/browser/canvas.ts"], false],
	["docs-only PR", "pull_request", ["docs/context/testing-strategy.md"], false],
	["root manifest PR", "pull_request", ["package.json"], true],
	["package manifest PR", "pull_request", ["packages/grammar/package.json"], true],
	["lockfile PR", "pull_request", ["pnpm-lock.yaml"], true],
	["override patch PR", "pull_request", ["patches/dompurify@3.4.16.patch"], true],
	["weekly audit", "schedule", [], true],
	["manual audit", "workflow_dispatch", [], true],
]) {
	test(`dependency audit selection: ${name}`, () => {
		assert.equal(
			enabled(
				security.jobs.audit.if,
				{ event_name: event, event: { schedule: "0 8 * * 1" } },
				{
					dependencies: String(changed(filters(security).dependencies, files)),
				},
			),
			expected,
		);
	});
}

test("weekly audit and workflow cancellation remain enabled", () => {
	assert.equal(security.on.schedule[0].cron, "0 8 * * 1");
	assert.equal(
		ci.concurrency.group,
		"ci-${{ github.event_name }}-${{ github.ref }}-${{ inputs.gate }}-${{ inputs.head_sha }}",
	);
	assert.equal(security.concurrency.group, "security-${{ github.ref }}");
	assert.equal(ci.concurrency["cancel-in-progress"], true);
	assert.equal(security.concurrency["cancel-in-progress"], true);
});

test("daily secret scans preserve the weekly dependency audit", () => {
	assert.deepEqual(security.on.schedule.map((entry) => entry.cron).sort(), [
		"0 7 * * *",
		"0 8 * * 1",
	]);
	for (const cron of ["0 7 * * *", "0 8 * * 1"]) {
		const github = { event_name: "schedule", event: { schedule: cron } };
		assert.equal(enabled(security.jobs.audit.if, github, {}), cron === "0 8 * * 1");
		assert.equal(enabled(security.jobs.gitleaks.if, github, {}), cron === "0 7 * * *");
	}
	for (const event_name of ["pull_request", "workflow_dispatch"])
		assert.equal(enabled(security.jobs.gitleaks.if, { event_name }, {}), true);
});

function secretRange(t, event, missingBase = false, merge) {
	const directory = mkdtempSync(join(tmpdir(), "secret-range-"));
	t.after(() => rmSync(directory, { recursive: true }));
	const gitEnv = {
		...process.env,
		GIT_CONFIG_GLOBAL: join(directory, "no-global-config"),
		GIT_CONFIG_NOSYSTEM: "1",
	};
	for (const name of Object.keys(gitEnv))
		if (/^GIT_(?:AUTHOR|COMMITTER)_/.test(name)) delete gitEnv[name];
	const git = (...args) => {
		const result = spawnSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
			cwd: directory,
			encoding: "utf8",
			env: gitEnv,
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	git("init", "-b", "main");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	const commit = (message) => git("commit", "--allow-empty", "-m", message);
	commit("common ancestor");
	const ancestor = git("rev-parse", "HEAD");
	git("checkout", "-b", "pr");
	commit("PR change");
	let head = git("rev-parse", "HEAD");
	git("checkout", "main");
	commit("base advanced independently");
	if (merge === "incoming-secret") {
		writeFileSync(join(directory, "incoming.txt"), "CI_S7_FAKE_MAIN_TOKEN\n");
		git("add", ".");
		commit("main token predates merge");
	}
	const base = git("rev-parse", "HEAD");
	if (merge) {
		if (merge === "octopus-secret") {
			for (const branch of ["one", "two"]) {
				git("checkout", "-b", branch, ancestor);
				writeFileSync(join(directory, `${branch}.txt`), `${branch}\n`);
				git("add", ".");
				commit(branch);
			}
			git("checkout", "pr");
			git("merge", "--no-ff", "--no-commit", "one", "two");
		} else {
			git("checkout", "pr");
			git("merge", "--no-ff", "--no-commit", "main");
		}
		if (merge === "secret" || merge === "octopus-secret") {
			writeFileSync(
				join(directory, "evil.txt"),
				merge === "secret" ? "CI_S7_FAKE_MERGE_TOKEN\n" : "CI_S7_FAKE_OCTOPUS_TOKEN\n",
			);
			git("add", ".");
		}
		commit("merge main");
		head = git("rev-parse", "HEAD");
	}
	const output = join(directory, "output");
	const step = security.jobs.gitleaks.steps.find((step) => step.id === "range");
	assert.ok(step, "select the scan range in an executable workflow step");
	assert.deepEqual(step.env, {
		EVENT_NAME: "${{ github.event_name }}",
		PR_BASE_SHA: "${{ github.event.pull_request.base.sha }}",
		PR_HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
	});
	const result = spawnSync(bash, ["--noprofile", "--norc", "-c", step.run], {
		cwd: directory,
		encoding: "utf8",
		env: {
			...process.env,
			EVENT_NAME: event,
			PR_BASE_SHA: missingBase ? "0".repeat(40) : base,
			PR_HEAD_SHA: head,
			GITHUB_OUTPUT: output.replaceAll("\\", "/"),
		},
	});
	assert.equal(result.status, 0, result.stderr);
	return {
		options: readFileSync(output, "utf8").trim(),
		log: result.stdout,
		ancestor,
		head,
		step,
		git,
	};
}

test("secret scanning uses the PR merge-base through head, excluding unrelated refs", (t) => {
	const { options, ancestor, head, step } = secretRange(t, "pull_request");
	assert.equal(options, `log_opts=${ancestor}..${head}`);
	assert.match(step.run, /git -c maintenance\.auto=false -c gc\.auto=0 merge-base/);
	const checkout = security.jobs.gitleaks.steps.find((step) =>
		step.uses?.startsWith("actions/checkout@"),
	);
	assert.equal(checkout.with["fetch-depth"], 0);
	assert.equal(checkout.with.ref, "${{ github.event.pull_request.head.sha || github.sha }}");
	const scan = security.jobs.gitleaks.steps.find((step) => step.run?.includes("--redact=100"));
	assert.equal(scan.env.GITLEAKS_LOG_OPTS, "${{ steps.range.outputs.log_opts }}");
	assert.match(scan.run, /--log-opts="--remerge-diff \$GITLEAKS_LOG_OPTS"/);
	assert.match(
		scan.run,
		/--log-opts="--diff-merges=first-parent --min-parents=3 \$GITLEAKS_LOG_OPTS"/,
	);
	assert.match(scan.run, /--config=\.gitleaks\.toml/);
});

for (const event of ["schedule", "workflow_dispatch"])
	test(`secret scanning uses all refs on ${event}`, (t) => {
		assert.equal(secretRange(t, event).options, "log_opts=--all");
	});

test("secret scanning falls back to all refs when merge-base fails", (t) => {
	const { options, log } = secretRange(t, "pull_request", true);
	assert.equal(options, "log_opts=--all");
	assert.match(log, /merge-base.*full history/i);
});

test("secret findings log and summary contain only safe location fields", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "secret-report-"));
	t.after(() => rmSync(directory, { recursive: true }));
	const finding = {
		RuleID: "fake-rule",
		File: "fake.txt",
		StartLine: 3,
		EndLine: 4,
		Commit: "a".repeat(40),
		Fingerprint: "fake-fingerprint",
		Secret: "FAKE_SECRET_NEVER_PRINT",
		Match: "FAKE_MATCH_NEVER_PRINT",
		Message: "PRIVATE_COMMIT_MESSAGE",
		Author: "PRIVATE_AUTHOR",
	};
	writeFileSync(
		join(directory, "input.json"),
		JSON.stringify([finding, { ...finding, File: "second.txt" }]),
	);
	const scan = security.jobs.gitleaks.steps.find((step) => step.run?.includes("--redact=100"));
	const source = scan.run.match(/<<'PY'\n([\s\S]*?)\nPY/);
	assert.ok(source, "exercise the workflow's report formatter");
	const result = spawnSync(
		process.platform === "win32" ? "python" : "python3",
		["-c", source[1], "input.json", "missing.json", "artifact.json"],
		{
			cwd: directory,
			encoding: "utf8",
			env: { ...process.env, GITHUB_STEP_SUMMARY: join(directory, "summary") },
		},
	);
	assert.equal(result.status, 0, result.stderr);
	const expected = ["fake.txt", "second.txt"].map((File) => ({
		RuleID: "fake-rule",
		File,
		StartLine: 3,
		Commit: "a".repeat(40),
		Fingerprint: "fake-fingerprint",
	}));
	const summary = readFileSync(join(directory, "summary"), "utf8").trim().split(/\r?\n/);
	assert.equal(summary.shift(), "```");
	assert.equal(summary.pop(), "```");
	for (const output of [result.stdout, summary.join("\n")]) {
		assert.deepEqual(
			output
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
			expected,
		);
		assert.doesNotMatch(
			output,
			/Secret|Match|FAKE_SECRET_NEVER_PRINT|FAKE_MATCH_NEVER_PRINT|PRIVATE_COMMIT_MESSAGE|PRIVATE_AUTHOR/,
		);
	}
	assert.deepEqual(JSON.parse(readFileSync(join(directory, "artifact.json"))), expected);
	const upload = security.jobs.gitleaks.steps.find((step) =>
		step.uses?.startsWith("actions/upload-artifact@"),
	);
	assert.equal(upload["continue-on-error"], true);
	assert.equal(upload.if, "failure()");
});

// Replace only the external download, archive and scanner executables; execute the real step.
function secretScanStep(
	t,
	status,
	report,
	logOptions = "--all",
	octopus = { status: 0, report: "[]" },
	stderr = "",
) {
	const directory = mkdtempSync(join(tmpdir(), "secret-step-"));
	t.after(() => rmSync(directory, { recursive: true }));
	if (report !== undefined) writeFileSync(join(directory, "report-input"), report);
	if (octopus.report !== undefined) writeFileSync(join(directory, "octopus-input"), octopus.report);
	writeFileSync(
		join(directory, "fake-gitleaks"),
		`#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "$TEST_ARGUMENTS"
status="$TEST_SCAN_STATUS"
report="$TEST_REPORT"
stderr="$TEST_SCAN_STDERR"
for arg in "$@"; do
  if [[ "$arg" == --report-path=* ]]; then
    if [[ "$arg" == */octopus.json ]]; then
      status="$TEST_OCTOPUS_STATUS"
      report="$TEST_OCTOPUS_REPORT"
      stderr="$TEST_OCTOPUS_STDERR"
    fi
    if [[ -f "$report" ]]; then cp "$report" "\${arg#--report-path=}"; fi
  fi
done
printf '%s' "$stderr" >&2
exit "$status"
`,
	);
	const scan = security.jobs.gitleaks.steps.find((step) => step.run?.includes("--redact=100"));
	const result = spawnSync(
		bash,
		[
			"--noprofile",
			"--norc",
			"-c",
			`
curl() { return 0; }
sha256sum() { cat > /dev/null; }
tar() { cp "$TEST_SCANNER" "$4/gitleaks"; chmod +x "$4/gitleaks"; }
${process.platform === "win32" ? 'python3() { python "$@"; }' : ""}
${scan.run}`,
		],
		{
			cwd: directory,
			encoding: "utf8",
			env: {
				...process.env,
				TMPDIR: directory.replaceAll("\\", "/"),
				TEST_SCANNER: join(directory, "fake-gitleaks").replaceAll("\\", "/"),
				TEST_ARGUMENTS: join(directory, "arguments").replaceAll("\\", "/"),
				TEST_REPORT: join(directory, "report-input").replaceAll("\\", "/"),
				TEST_SCAN_STATUS: String(status),
				TEST_SCAN_STDERR: stderr,
				TEST_OCTOPUS_STATUS: String(octopus.status),
				TEST_OCTOPUS_STDERR: octopus.stderr ?? "",
				TEST_OCTOPUS_REPORT: join(directory, "octopus-input").replaceAll("\\", "/"),
				GITLEAKS_LOG_OPTS: logOptions,
				GITLEAKS_REPORT_PATH: join(directory, "artifact.json").replaceAll("\\", "/"),
				GITHUB_STEP_SUMMARY: join(directory, "summary").replaceAll("\\", "/"),
			},
		},
	);
	assert.equal(result.error, undefined);
	const args = readFileSync(join(directory, "arguments"), "utf8").trim().split("\n");
	return {
		result,
		directory,
		logOptions: args.find((arg) => arg.startsWith("--log-opts=")).slice("--log-opts=".length),
		octopusLogOptions: args
			.filter((arg) => arg.startsWith("--log-opts="))[1]
			?.slice("--log-opts=".length),
	};
}

const fakeFinding = {
	RuleID: "fake-rule",
	File: "fake.txt",
	StartLine: 1,
	Commit: "a".repeat(40),
	Fingerprint: "fake-fingerprint",
	Secret: "FAKE_SECRET_NEVER_PRINT",
	Match: "FAKE_MATCH_NEVER_PRINT",
};

for (const [status, report] of [
	[0, "[]"],
	[1, JSON.stringify([fakeFinding])],
	[2, undefined],
]) {
	test(`secret scan step preserves scanner exit ${status}`, (t) => {
		const { result } = secretScanStep(t, status, report);
		assert.equal(result.status, status, result.stderr);
		assert.doesNotMatch(
			result.stdout + result.stderr,
			/FAKE_SECRET_NEVER_PRINT|FAKE_MATCH_NEVER_PRINT/,
		);
	});
}

test("secret scan step refuses a malformed report without printing its contents", (t) => {
	const { result } = secretScanStep(t, 0, "FAKE_SECRET_NEVER_PRINT");
	assert.notEqual(result.status, 0);
	assert.doesNotMatch(result.stdout + result.stderr, /FAKE_SECRET_NEVER_PRINT/);
});

for (const pass of [1, 2]) {
	for (const error of [
		"[git] fatal: Invalid revision range",
		"[git] error: cannot read history",
		"fatal: bad revision",
	]) {
		test(`secret scan step rejects exit-zero Git stderr in pass ${pass}: ${error}`, (t) => {
			const options = "0123012301230123012301230123012301230123..pr";
			const stderr = `${error} '${options}' FAKE_SECRET_NEVER_PRINT\n`;
			const { result } = secretScanStep(
				t,
				0,
				"[]",
				options,
				{
					status: 0,
					report: "[]",
					stderr: pass === 2 ? stderr : "",
				},
				pass === 1 ? stderr : "",
			);
			assert.equal(result.status, 2, result.stderr);
			assert.match(
				result.stdout + result.stderr,
				new RegExp(`infrastructure failure in pass ${pass}`),
			);
			assert.ok(!(result.stdout + result.stderr).includes(options), "never print the log options");
			assert.doesNotMatch(result.stdout + result.stderr, /FAKE_SECRET_NEVER_PRINT/);
		});
	}
}

test("secret scan step accepts ordinary scanner stderr", (t) => {
	const { result } = secretScanStep(
		t,
		0,
		"[]",
		"--all",
		{
			status: 0,
			report: "[]",
			stderr: "INF 0 commits scanned\n",
		},
		"INF no leaks found\n",
	);
	assert.equal(result.status, 0, result.stderr);
});

test("secret findings summary fences hostile filenames literally", (t) => {
	const File = `[x](https://example.invalid) <b>y</b> ${"`".repeat(40)}\n~~~`;
	const { result, directory } = secretScanStep(t, 1, JSON.stringify([{ ...fakeFinding, File }]));
	assert.equal(result.status, 1, result.stderr);
	const summary = readFileSync(join(directory, "summary"), "utf8").trim().split(/\r?\n/);
	assert.equal(summary.length, 3, "one JSON finding between opening and closing fences");
	assert.equal(summary[0], "`".repeat(41));
	assert.equal(summary[2], summary[0]);
	assert.equal(JSON.parse(summary[1]).File, File);
	assert.equal(result.stdout.trim(), summary[1]);
});

test("secret findings omit the summary block on clean scans", (t) => {
	const { result, directory } = secretScanStep(t, 0, "[]");
	assert.equal(result.status, 0, result.stderr);
	const summary = join(directory, "summary");
	assert.equal(existsSync(summary) ? readFileSync(summary, "utf8") : "", "");
	assert.equal(result.stdout, "");
	assert.deepEqual(JSON.parse(readFileSync(join(directory, "artifact.json"))), []);
});

for (const [first, second] of [
	[0, 1],
	[0, 2],
	[1, 2],
	[2, 1],
]) {
	test(`secret scan step preserves the larger status ${first}/${second}`, (t) => {
		const { result, directory } = secretScanStep(
			t,
			first,
			first === 2 ? undefined : "[]",
			"--all",
			{
				status: second,
				report: second === 1 ? JSON.stringify([fakeFinding]) : undefined,
			},
		);
		assert.equal(result.status, 2 === first || 2 === second ? 2 : 1, result.stderr);
		if (second === 1) {
			assert.deepEqual(JSON.parse(readFileSync(join(directory, "artifact.json"))), [
				{
					RuleID: "fake-rule",
					File: "fake.txt",
					StartLine: 1,
					Commit: "a".repeat(40),
					Fingerprint: "fake-fingerprint",
				},
			]);
			const summary = readFileSync(join(directory, "summary"), "utf8").trim().split(/\r?\n/);
			assert.equal(summary[0], "```");
			assert.equal(summary[2], "```");
			assert.equal(JSON.parse(summary[1]).File, "fake.txt");
			assert.doesNotMatch(
				result.stdout + summary.join("\n"),
				/FAKE_SECRET_NEVER_PRINT|FAKE_MATCH_NEVER_PRINT/,
			);
		}
	});
}

test("secret scan step combines both reports in one artifact and summary", (t) => {
	const { result, directory } = secretScanStep(t, 1, JSON.stringify([fakeFinding]), "--all", {
		status: 1,
		report: JSON.stringify([{ ...fakeFinding, File: "octopus.txt" }]),
	});
	assert.equal(result.status, 1, result.stderr);
	const findings = JSON.parse(readFileSync(join(directory, "artifact.json")));
	assert.deepEqual(
		findings.map((finding) => finding.File),
		["fake.txt", "octopus.txt"],
	);
	const summary = readFileSync(join(directory, "summary"), "utf8").trim().split(/\r?\n/);
	assert.equal(summary[0], "```");
	assert.equal(summary[3], "```");
	assert.deepEqual(
		summary.slice(1, -1).map((line) => JSON.parse(line)),
		findings,
	);
});

test("secret baseline allowlist requires both the exact path and digest line", () => {
	const config = readFileSync(new URL("../../../.gitleaks.toml", import.meta.url), "utf8");
	const result = spawnSync(
		process.platform === "win32" ? "python" : "python3",
		[
			"-c",
			`
import sys, tomllib
config = tomllib.loads(sys.stdin.read())
baseline = next(rule for rule in config["allowlists"] if rule["description"] == "Export output SHA-256 baselines")
assert baseline.get("condition") == "AND", "baseline path and digest checks must both match"
assert baseline["regexTarget"] == "line"
`,
		],
		{ input: config, encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
});

for (const event of ["pull_request", "schedule", "workflow_dispatch"]) {
	for (const merge of [
		"secret",
		"octopus-secret",
		"clean",
		...(event === "pull_request" ? ["incoming-secret"] : []),
	]) {
		test(`secret merge patches: ${event}, ${merge}`, (t) => {
			const range = secretRange(t, event, false, merge);
			const scan = secretScanStep(t, 0, "[]", range.options.slice("log_opts=".length));
			assert.equal(scan.result.status, 0, scan.result.stderr);
			// Gitleaks v8.30.1 consumes git log -p -U0. Check Git's real merge patches offline.
			const patches = range.git("log", "-p", "-U0", ...scan.logOptions.split(" "));
			assert.ok(scan.octopusLogOptions, "octopus pass must run for every event");
			assert.equal(
				scan.octopusLogOptions,
				`--diff-merges=first-parent --min-parents=3 ${range.options.slice("log_opts=".length)}`,
			);
			const octopusPatches = range.git("log", "-p", "-U0", ...scan.octopusLogOptions.split(" "));
			if (merge === "secret") {
				assert.match(patches, /\+CI_S7_FAKE_MERGE_TOKEN/);
				assert.equal(octopusPatches, "");
			} else if (merge === "octopus-secret") {
				assert.doesNotMatch(patches, /CI_S7_FAKE_OCTOPUS_TOKEN/);
				assert.match(octopusPatches, /\+CI_S7_FAKE_OCTOPUS_TOKEN/);
			} else {
				assert.doesNotMatch(patches, /CI_S7_FAKE_(?:MERGE|MAIN)_TOKEN/);
				assert.equal(octopusPatches, "");
			}
		});
	}
}

// A full gate on every merge was a fifth of the Ubicloud bill. Main gets the
// complete integrated gate nightly instead; PR path selection still applies.
test("nightly and manual runs run every gate; merges to main do not", () => {
	assert.equal(ci.on.push, undefined);
	assert.equal(ci.on.schedule[0].cron, "0 6 * * *");
	assert.ok(ci.on.pull_request);
	assert.ok("workflow_dispatch" in ci.on);
	const job = ci.jobs.changes;
	const full = job.steps.find((step) => step.id === "full");
	assert.equal(full?.if, undefined);
	for (const name of ["code", "format"]) {
		assert.match(full.run, new RegExp(`echo "${name}=true" >> "\\$GITHUB_OUTPUT"`));
		assert.equal(
			job.outputs[name],
			`\${{ steps.full.outputs.${name} || steps.filter.outputs.${name} }}`,
		);
	}
	assert.equal(
		job.steps.find((step) => step.id === "filter").if,
		"github.event_name == 'pull_request'",
	);
	for (const entry of Object.values(ci.jobs))
		assert.ok(entry["runs-on"] === "ubuntu-24.04" || entry["runs-on"] === browserRunner);
});

function assertForkRunner(job, name) {
	const github = {
		event_name: "pull_request",
		event: { pull_request: { head: { repo: { full_name: "someone/studio" } } } },
	};
	for (const code of ["true", "false"])
		for (const vitest of ["affected", "full"]) {
			const expression = job.if?.replace(/^\s*\$\{\{|\}\}\s*$/g, "");
			if (
				expression &&
				!enabled(expression, github, { code, vitest, browser: "true", format: "true" })
			)
				continue;
			const routing = job["runs-on"];
			const runner = routing.startsWith("${{")
				? workflowFunction(
						"github",
						"vars",
						`return (${routing.slice(3, -2)});`,
					)(
						{ ...github, repository: "fixture/studio" },
						{ STUDIO_BROWSER_RUNNER: "ubicloud-standard-4" },
					)
				: routing;
			assert.equal(runner, "ubuntu-24.04", name);
		}
}

test("fork routing policy detects a PR-reachable disjunction before a non-PR clause", () => {
	assert.throws(() =>
		assertForkRunner(
			{
				if: "${{ needs.changes.outputs.code == 'true' || github.event_name != 'pull_request' }}",
				"runs-on": "ubicloud-standard-2",
			},
			"unsafe",
		),
	);
	assert.doesNotThrow(() =>
		assertForkRunner(
			{
				if: "${{ needs.changes.outputs.code == 'true' && github.event_name != 'pull_request' }}",
				"runs-on": "ubicloud-standard-4",
			},
			"non-PR",
		),
	);
});

test("browser fallback defaults to free hosted runners and never routes fork PRs to the variable", () => {
	// GitHub sets these fields from the PR's head repository, not from anything the PR edits.
	const runner = (event_name, head, selected) =>
		workflowFunction(
			"github",
			"vars",
			`return (${browserRunner.slice(3, -2)});`,
		)(
			{
				event_name,
				repository: "fixture/studio",
				event: { pull_request: head && { head: { repo: { full_name: head } } } },
			},
			{ STUDIO_BROWSER_RUNNER: selected },
		);
	for (const selected of [undefined, "", "ubicloud-standard-4"])
		assert.equal(runner("pull_request", "someone/studio", selected), "ubuntu-24.04");
	for (const [event, head] of [
		["pull_request", "fixture/studio"],
		["schedule"],
		["workflow_dispatch"],
	]) {
		for (const selected of [undefined, ""])
			assert.equal(runner(event, head, selected), "ubuntu-24.04");
		assert.equal(runner(event, head, "ubicloud-standard-4"), "ubicloud-standard-4");
	}
	for (const name of ["published-output-a11y", "published-output-deck", "browser-editor"]) {
		assert.equal(ci.jobs[name]["runs-on"], browserRunner);
		assert.equal(
			enabled(ci.jobs[name].if.slice(3, -2), { event_name: "pull_request" }, { browser: "true" }),
			false,
		);
	}
	for (const config of [ci, security])
		for (const [name, job] of Object.entries(config.jobs)) assertForkRunner(job, name);
});

test("slow-test allowlist checks compare the complete Git base, including JSON-only edits", () => {
	assert.equal(
		ci.env.SLOW_TESTS_BASE,
		"${{ github.event.pull_request.base.sha || github.event.before || github.sha }}",
	);
	assert.equal(changed(filters(ci).code, ["scripts/slow-tests.json"]), true);
	const checkout = ci.jobs.test.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
	assert.equal(checkout.with["fetch-depth"], 0);
});

// Self-hosted jobs allow main pushes only for candidate build-ahead. Nothing may launch the frozen
// Electron app's QA suite (it opened Studio windows on the owner's screen).
const allWorkflows = readdirSync(new URL("../../../.github/workflows/", import.meta.url))
	.filter(
		(name) =>
			/\.ya?ml$/.test(name) &&
			!isPrivateWorkflow(
				name,
				readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url)),
				privateCi,
			),
	)
	.map((name) => [
		name.replace(/\.ya?ml$/, ""),
		parse(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), "utf8")),
	]);
function assertPublicRunners(name, config) {
	assertNoPaidLabel(name, JSON.stringify(config));
	for (const [jobName, job] of Object.entries(config.jobs)) {
		if (JSON.stringify(job).includes("STUDIO_BROWSER_RUNNER")) {
			assert.equal(name, "ci", "Only CI browser jobs may use the runner variable");
			assert.ok(
				["published-output-a11y", "published-output-deck", "browser-editor"].includes(jobName),
			);
			assert.equal(job["runs-on"], browserRunner, "The runner variable must guard fork PRs");
		}
	}
	const selfHosted = Object.values(config.jobs).some((job) =>
		couldBeSelfHosted(job["runs-on"], job.strategy?.matrix),
	);
	assert.equal(
		selfHosted,
		false,
		`${name} must use hosted runners or the guarded browser variable`,
	);
}
function assertNoPaidLabel(name, source) {
	assert.doesNotMatch(source, /ubicloud-[\w.-]+/i, `${name}: direct paid label`);
}
test("public workflows use free hosted runners with only the guarded browser fallback", () => {
	const directory = new URL("../../../.github/workflows/", import.meta.url);
	for (const name of readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)))
		assertNoPaidLabel(name, readFileSync(new URL(name, directory), "utf8"));
	for (const [name, config] of allWorkflows) assertPublicRunners(name, config);
});
test("runner policy rejects planted paid labels and unguarded or misplaced browser variables", () => {
	for (const [name, jobName, runner] of [
		["probe", "probe", "ubicloud-standard-2"],
		["probe", "probe", "ubicloud-standard-4"],
		["probe", "probe", "${{ matrix.runner }}"],
		["ci", "published-output-a11y", "${{ vars.STUDIO_BROWSER_RUNNER || 'ubuntu-24.04' }}"],
		["ci", "published-output-deck", "${{ vars.STUDIO_BROWSER_RUNNER || 'ubuntu-24.04' }}"],
		["ci", "browser-editor", "${{ vars.STUDIO_BROWSER_RUNNER || 'ubuntu-24.04' }}"],
		["ci", "test", browserRunner],
		["security", "browser-editor", browserRunner],
	]) {
		assert.throws(
			() =>
				assertPublicRunners(name, {
					jobs: {
						[jobName]: {
							"runs-on": runner,
							...(runner === "${{ matrix.runner }}"
								? { strategy: { matrix: { runner: ["ubicloud-standard-4"] } } }
								: {}),
						},
					},
				}),
			undefined,
			`${name}/${jobName}: ${runner}`,
		);
	}
	const safe = structuredClone(ci);
	for (const jobName of ["published-output-a11y", "published-output-deck", "browser-editor"])
		safe.jobs[jobName]["runs-on"] = browserRunner;
	for (const job of Object.values(safe.jobs))
		if (job["runs-on"] !== browserRunner) job["runs-on"] = "ubuntu-24.04";
	assert.doesNotThrow(() => assertPublicRunners("ci", safe));
});
test("public runner policy rejects planted self-hosted labels and unresolved matrices", () => {
	for (const runsOn of [
		["self-hosted", "praxity-mbp"],
		"praxity-mbp",
		"custom-runner",
		"ubuntu-untrusted",
		"macos-private-fleet",
		"${{ inputs.runner }}",
		{ group: "private", labels: "macOS" },
		"${{ matrix.runner }}",
	]) {
		assert.throws(() =>
			assertPublicRunners("public-probe", {
				on: { schedule: [{ cron: "0 0 * * *" }] },
				jobs: {
					probe: {
						"runs-on": runsOn,
						strategy: { matrix: { include: [{ runner: "praxity-mbp" }] } },
					},
				},
			}),
		);
	}
	assert.doesNotThrow(() =>
		assertPublicRunners("hosted", {
			jobs: {
				probe: {
					"runs-on": "${{ matrix.runner }}",
					strategy: { matrix: { runner: ["ubuntu-24.04", "macos-15", "macos-15-intel"] } },
				},
			},
		}),
	);
});
test("public workflows never reference a private-only script", () => {
	for (const [name, config] of allWorkflows)
		for (const path of privateCi.scripts)
			assert.ok(!JSON.stringify(config).includes(path), `${name} references ${path}`);
});

test("candidate CI records its fetched main base in a successful REST-visible step", () => {
	const step = ci.jobs.changes.steps.find(
		(entry) => entry.name === "Candidate base ${{ steps.browser.outputs.candidate_base }}",
	);
	assert.ok(step);
	assert.equal(step.if, "github.event_name == 'workflow_dispatch' && inputs.gate == 'candidate'");
	assert.equal(step.env.CANDIDATE_BASE, "${{ steps.browser.outputs.candidate_base }}");
	assert.match(step.run, /\^\[a-f0-9\]\{40\}\$/);
});

test("no workflow names the retired Air runner label", () => {
	const directory = new URL("../../../.github/workflows/", import.meta.url);
	for (const [name] of allWorkflows)
		assertNoRetiredRunner(name, readFileSync(new URL(`${name}.yml`, directory), "utf8"));
	assert.ok(!actionlintConfig["self-hosted-runner"].labels.includes("praxity-release"));
});

test("formal releases retain both native hosted smoke gates and a separate queue", () => {
	const config = workflow("cli-release");

	assert.equal(
		config.jobs["native-smoke"].if,
		"github.repository == (vars.STUDIO_SOURCE_REPO || github.repository) && (inputs.pack_version != '')",
	);
	assert.deepEqual(config.jobs["native-smoke"].strategy.matrix.include, [
		{ runner: "macos-15", arch: "arm64" },
		{ runner: "macos-15-intel", arch: "x64" },
	]);
	assert.equal(config.concurrency.group, "cli-release");
	assert.equal(config.concurrency["cancel-in-progress"], false);
});
test("the frozen Electron QA suite and its workflow commands are removed", () => {
	assert.equal(existsSync(new URL("../e2e/qa", import.meta.url)), false);
	assert.equal(
		existsSync(new URL("../../../.claude/skills/qa-check-desktop/SKILL.md", import.meta.url)),
		false,
	);
	const desktop = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
	assert.equal(desktop.scripts.e2e, undefined);
	assert.equal(desktop.scripts["e2e:stage"], undefined);
	for (const [name, config] of allWorkflows) assertNoRetiredCommands(name, config);
});

test("every Linux Vitest job confirms after process exit, including failed shards", () => {
	for (const [, config] of allWorkflows) assertSlowConfirmation(config);
});

test("confirmation policy catches missing, premature, success-only and unbounded confirmation", () => {
	for (const jobName of ["test", "affected-test", "format-contracts"]) {
		for (const mutate of [
			(job) => {
				delete job.env.SLOW_TESTS_PROCESS_GROUPS_FILE;
			},
			(job) => {
				const step = job.steps.find((step) => runsSlowReporter(step));
				step.run = step.run.replace("bash scripts/run-vitest-isolated.sh ", "");
			},
			(job) =>
				job.steps.splice(
					job.steps.findIndex((step) => step.run?.includes("node scripts/confirm-slow-tests.mjs")),
					1,
				),
			(job) => {
				const index = job.steps.findIndex((step) =>
					step.run?.includes("node scripts/confirm-slow-tests.mjs"),
				);
				job.steps.unshift(...job.steps.splice(index, 1));
			},
			(job) => {
				job.steps.find((step) => step.run?.includes("node scripts/confirm-slow-tests.mjs")).if =
					"success()";
			},
			(job) => {
				delete job.env.SLOW_TESTS_PENDING_FILE;
			},
			(job) => {
				job.steps[0].run = job.steps[0].run.replace("- 45", "- 0");
			},
		]) {
			const broken = structuredClone(ci);
			mutate(broken.jobs[jobName]);
			assert.throws(() => assertSlowConfirmation(broken), jobName);
		}
	}
});

test("all Linux workflows detect Vitest aliases and default config consumers", () => {
	for (const command of [
		"pnpm test",
		"pnpm run test",
		"pnpm test:gates",
		"pnpm test:affected --select-only\npnpm test",
		"pnpm vitest run",
		"pnpm exec vitest run",
		"vitest run",
		"pnpm exec vitest --config vitest.config.ts",
		"node run-tests.mjs --config vitest.workspace.ts",
		"pnpm test:affected --vitest-only --affected-only",
	]) {
		assert.equal(runsSlowReporter({ run: command }), true, command);
		const job = structuredClone(ci.jobs.test);
		job.steps = job.steps.filter((step) => !step.run?.includes("confirm-slow-tests.mjs"));
		job.steps.find((step) => step.run?.includes("pnpm exec vitest run")).run = command;
		assert.throws(() => assertSlowConfirmation({ jobs: { otherWorkflow: job } }), command);
		for (const runner of ["macos-15", "windows-latest"]) {
			job["runs-on"] = runner;
			assert.doesNotThrow(() => assertSlowConfirmation({ jobs: { otherWorkflow: job } }));
		}
	}
	for (const command of [
		"pnpm test:cli",
		"pnpm test:scorm-adl",
		"pnpm test:affected --vitest-only --select-only --base main",
	])
		assert.equal(runsSlowReporter({ run: command }), false, command);
});
