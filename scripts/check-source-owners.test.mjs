import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import {
	checkDisplayIdImports,
	checkDormantChoiceImports,
	checkIdentityWriterImports,
	checkLifetimeOwners,
	checkSelfCheckOwners,
	checkSourceOwners,
	checkWorkspaceSourceImports,
	selfCheckAuthorOwners,
	sourceOwnerAllowlist,
} from "./check-source-owners.mjs";

test("learner-state syntax keeps imports type-only so hashing cannot enter adapter bundles", () => {
	const path = "packages/shared-blocks/src/learner-state.ts";
	const file = ts.createSourceFile(
		path,
		readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const runtimeImports = [];
	function visit(node) {
		if (
			(ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
			(ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) ||
			(ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) ||
			(ts.isCallExpression(node) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					(ts.isIdentifier(node.expression) && node.expression.text === "require")))
		)
			runtimeImports.push(node.getText(file));
		ts.forEachChild(node, visit);
	}
	visit(file);
	assert.deepEqual(
		runtimeImports,
		[],
		"learner-state syntax must not load runtime hashing, directly or through another module",
	);
});

test("choice admission stays dormant in production consumers, including aliases and whole-module access", () => {
	for (const name of [
		"restoreChoiceAssessmentState",
		"prepareChoiceAssessmentState",
		"retainLegacyChoiceBuild",
		"choiceDependencyStatus",
		"choiceGroupDependencyIds",
		"choiceGroupSignature",
		"prepareChoiceGroupSubmission",
		"createChoiceDependencyView",
	]) {
		for (const source of [
			`import { ${name} as activate } from "@praxity/shared-blocks/choice-learner-state"; activate(input);`,
			`export { ${name} as activate } from "./choice-learner-state";`,
			`const { ${name}: activate } = states; activate(input);`,
			`states["${name}"](input);`,
		]) {
			for (const path of [
				"packages/export-pipeline/template/src/hosts/course-host.ts",
				"packages/shared-blocks/src/blocks/AssessmentBlock.tsx",
				"packages/shared-blocks/src/viewer/assessment-group-runtime.ts",
			]) {
				const groupOwner =
					name === "prepareChoiceGroupSubmission" &&
					path !== "packages/shared-blocks/src/blocks/AssessmentBlock.tsx";
				const statusOwner =
					name === "choiceDependencyStatus" &&
					path === "packages/export-pipeline/template/src/hosts/course-host.ts";
				if (groupOwner || statusOwner)
					assert.deepEqual(checkDormantChoiceImports(path, source), []);
				else assert.match(checkDormantChoiceImports(path, source).join("\n"), new RegExp(name));
			}
			assert.deepEqual(
				checkDormantChoiceImports(
					"packages/shared-blocks/src/choice-dependency-state.test.ts",
					source,
				),
				[],
			);
		}
	}
	for (const source of [
		'import * as state from "@praxity/shared-blocks/choice-learner-state";',
		'const state = await import("./choice-learner-state");',
		'const state = require("@praxity/shared-blocks/choice-learner-state");',
		'export * from "@praxity/shared-blocks/choice-learner-state";',
	])
		assert.match(
			checkDormantChoiceImports("packages/shared-blocks/src/viewer/planted.ts", source).join("\n"),
			/dormant/,
		);
});

test("dormant admission permits the existing envelope API, shared types and the canonical barrel", () => {
	assert.deepEqual(
		checkDormantChoiceImports(
			"packages/shared-blocks/src/blocks/AssessmentBlock.tsx",
			'import type { SavedAssessmentState } from "../learner-state";',
		),
		[],
	);
	assert.deepEqual(
		checkDormantChoiceImports(
			"packages/export-pipeline/src/scorm/local-storage-runtime.ts",
			'import { createLearnerState, parseLearnerState, serializeLearnerState } from "@praxity/shared-blocks/learner-state";',
		),
		[],
	);
	assert.deepEqual(
		checkDormantChoiceImports(
			"packages/shared-blocks/src/index.ts",
			'export * from "./learner-state";',
		),
		[],
	);
	assert.deepEqual(
		checkDormantChoiceImports(
			"packages/shared-blocks/src/choice-learner-state.ts",
			"choiceDependencyStatus(id, view);",
		),
		[],
	);
});

test("the dormant tracker imports evidence types without admission or hashing code", () => {
	const path = "packages/export-pipeline/src/scorm/tracking.ts";
	assert.deepEqual(
		checkDormantChoiceImports(
			path,
			'import type { ChoiceDependencyEvidence } from "@praxity/shared-blocks/choice-learner-state";',
		),
		[],
	);
	for (const source of [
		'import { choiceDependencyStatus as status } from "@praxity/shared-blocks/choice-learner-state"; status(id, view);',
		'import { prepareChoiceAssessmentState } from "@praxity/shared-blocks/choice-learner-state";',
		'import { createChoiceDependencyView as install } from "@praxity/shared-blocks/choice-learner-state";',
		'import * as states from "@praxity/shared-blocks/choice-learner-state";',
		'const states = await import("@praxity/shared-blocks/choice-learner-state");',
	])
		assert.notDeepEqual(checkDormantChoiceImports(path, source), []);
});

test("the dormant choice owner is unreachable from the production import graph", () => {
	for (const source of [
		'import "./choice-learner-state";',
		'import {} from "./choice-learner-state";',
		'import { futureExport } from "./choice-learner-state";',
		'export * from "./choice-learner-state";',
		'export { futureExport } from "./choice-learner-state";',
	]) {
		for (const path of [
			"packages/shared-blocks/src/learner-state.ts",
			"packages/shared-blocks/src/index.ts",
			"apps/desktop/src/inspection-frame.ts",
		])
			assert.match(checkDormantChoiceImports(path, source).join("\n"), /dormant/);
	}
	assert.deepEqual(
		checkDormantChoiceImports(
			"packages/shared-blocks/src/viewer/planted.ts",
			'import type { ChoiceDependencyView } from "./choice-learner-state";',
		),
		[],
	);
});

test("new-tab emitters require reviewed fixture coverage and the marking owner", () => {
	for (const source of [
		'export function newRenderer() { return `<a target="_blank">Open</a>`; }',
		'export const newRenderer = () => <a target="_blank">Open</a>;',
		'function newRenderer(link) { link.target = "_blank"; }',
		'function newRenderer(link) { link.setAttribute("target", "_blank"); }',
		'const target = "_blank"; export const newRenderer = () => ({ target });',
		'function newRenderer(link) { link.target = "_BLANK"; }',
	]) {
		for (const path of [
			"packages/export-pipeline/src/new-renderer.tsx",
			"packages/export-pipeline/template/src/islands/island-new.tsx",
			"packages/shared-blocks/src/viewer/new-renderer.tsx",
			"packages/content-model/src/new-renderer.tsx",
		]) {
			assert.match(checkSourceOwners(path, source).join("\n"), /new-tab link/);
		}
	}
	assert.match(
		checkSourceOwners(
			"packages/export-pipeline/src/render-block-html.ts",
			'function renderButton() { return `<a target="_blank">Open</a>`; }',
		).join("\n"),
		/marking owner/,
	);
});

test("new-tab inventory detects extra targets and changes from readers to writers", () => {
	const marked =
		'function renderButton() { return `<a target="_blank">Open${externalLinkIndicatorHtml(text)}</a>`; }';
	assert.deepEqual(
		checkSourceOwners("packages/export-pipeline/src/render-block-html.ts", marked),
		[],
	);
	assert.match(
		checkSourceOwners(
			"packages/export-pipeline/src/render-block-html.ts",
			marked.replace("</a>", '</a><a target="_blank">Other</a>'),
		).join("\n"),
		/reviewed compiler fixture coverage/,
	);
	assert.match(
		checkSourceOwners(
			"packages/export-pipeline/template/src/islands/island-nav.tsx",
			'function initializeLinks(link) { link.target = "_blank"; }',
		).join("\n"),
		/marking owner/,
	);
	assert.match(
		checkSourceOwners(
			"packages/export-pipeline/src/html-gen.ts",
			'function generateHtmlPage() { return `<a target="_blank">One${externalLinkIndicatorHtml(text)}</a><a target="_blank">Two</a>`; }',
		).join("\n"),
		/marking owner/,
	);
});

test("new-tab inventory counts every target within one string or template fragment", () => {
	for (const source of [
		'function renderButton() { return `<a target="_blank">Unmarked</a><a target="_blank">Marked${externalLinkIndicatorHtml(text)}</a>`; }',
		'function renderButton() { return \'<a target="_blank">Unmarked</a><a target="_BLANK">Marked\' + externalLinkIndicatorHtml(text) + "</a>"; }',
		'function renderButton() { return `<a target="_blank">Unmarked</a><a target="_blank">Marked` + externalLinkIndicatorHtml(text) + "</a>"; }',
	])
		assert.match(
			checkSourceOwners("packages/export-pipeline/src/render-block-html.ts", source).join("\n"),
			/reviewed compiler fixture coverage/,
		);
});

test("course outcome writes belong to the injected tracking writer", () => {
	const owner = "packages/shared-blocks/src/tracking.ts";
	for (const source of [
		'runtime.setCompletion("completed");',
		'runtime?.setSuccess?.("passed");',
		'runtime["setScore"](100, 0, 100);',
		'const method = "trackObjective"; runtime[method]("group", 100, true);',
		"runtime.terminate(true);",
		"runtime.suppressTerminationResult();",
		"const suppress = runtime.suppressTerminationResult; suppress();",
		"runtime.terminate(explicitFinish);",
		"const write = runtime.setScore; write(100, 0, 100);",
		"runtime.setScore.call(runtime, 100, 0, 100);",
		"Reflect.apply(runtime.setCompletion, runtime, ['completed']);",
		"const { setCompletion: write } = runtime; write('completed');",
	]) {
		for (const path of [
			"packages/export-pipeline/template/src/hosts/course-host.ts",
			"packages/export-pipeline/src/scorm/tracking.ts",
			"packages/shared-blocks/src/learner-block-state.ts",
			"packages/shared-blocks/src/viewer/tracking.ts",
			"packages/export-pipeline/src/scorm/api/scorm2004.ts",
			"packages/grammar/src/planted.ts",
		])
			assert.match(checkSourceOwners(path, source).join("\n"), /course outcome writes belong/);
		assert.deepEqual(checkSourceOwners(owner, source), []);
		assert.deepEqual(
			checkSourceOwners("packages/export-pipeline/tests/planted.test.ts", source),
			[],
		);
	}
	for (const source of ["runtime.terminate();", "runtime.terminate(false);", "runtime.commit();"])
		assert.deepEqual(
			checkSourceOwners("packages/export-pipeline/template/src/hosts/course-host.ts", source),
			[],
		);
	assert.deepEqual(
		checkSourceOwners(
			"packages/export-pipeline/src/scorm/api/scorm2004.ts",
			"this.setSuccess(status);",
		),
		[],
	);
});

test("only outcome owners may invoke the course writer", () => {
	for (const source of [
		'writeCourseOutcome(runtime, { kind: "decided", completion: "completed" });',
		"owner.writeCourseOutcome(runtime, outcome);",
		'owner["writeCourseOutcome"](runtime, outcome);',
		'import { writeCourseOutcome as write } from "./tracking"; write(runtime, outcome);',
		"const write = writeCourseOutcome; write(runtime, outcome);",
		"writeCourseOutcome.call(null, runtime, outcome);",
		"const { writeCourseOutcome: write } = owner; write(runtime, outcome);",
		"Reflect.apply(writeCourseOutcome, null, [runtime, outcome]);",
	]) {
		for (const path of [
			"packages/shared-blocks/src/viewer/tracking.ts",
			"packages/shared-blocks/src/learner-block-state.ts",
			"packages/export-pipeline/template/src/hosts/course-host.ts",
		])
			assert.match(checkSourceOwners(path, source).join("\n"), /course outcome decisions belong/);
		for (const path of [
			"packages/export-pipeline/src/scorm/tracking.ts",
			"packages/shared-blocks/src/tracking.ts",
		])
			assert.deepEqual(checkSourceOwners(path, source), []);
	}
	const result = runFixture({
		path: "packages/shared-blocks/src/planted.ts",
		source: 'writeCourseOutcome(runtime, { kind: "decided", completion: "completed" });',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /course outcome decisions belong/);
});

test("source-owner command rejects a planted LMS outcome write", () => {
	const result = runFixture({
		path: "packages/shared-blocks/src/planted.ts",
		source: 'runtime.setCompletion("completed");',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /course outcome writes belong/);
});

test("init may preserve the settings BOM but cannot detect Prax source", () => {
	const path = "apps/desktop/src/main/init-course.ts";
	assert.deepEqual(checkSourceOwners(path, 'original.startsWith("\\uFEFF")'), []);
	assert.notDeepEqual(checkSourceOwners(path, 'original.startsWith("---")'), []);
	assert.notDeepEqual(
		checkSourceOwners("apps/desktop/src/main/other.ts", 'original.startsWith("\\uFEFF")'),
		[],
	);
});

test("internal installer loads a reviewed Rubato checkout but cannot read authored Content", () => {
	const path = "scripts/install-internal-studio.mjs";
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			"const load = (path) => import(pathToFileURL(join(root, path)).href);",
		),
		[],
	);
	assert.notDeepEqual(
		checkSelfCheckOwners(path, 'import { readSelfCheckContent } from "@praxity/grammar";'),
		[],
	);
	assert.notDeepEqual(checkSelfCheckOwners(path, "import(unreviewedPath);"), []);
	assert.notDeepEqual(
		checkSelfCheckOwners("scripts/other.mjs", "import(pathToFileURL(join(root, path)).href);"),
		[],
	);
});

for (const source of [
	'import { reclaimProtectedArchives } from "./project-file-transactions";',
	'import { reclaimProtectedArchives as prune } from "./project-file-transactions";',
	'export { reclaimProtectedArchives } from "./project-file-transactions";',
	'import * as t1 from "./project-file-transactions";',
	'const t1 = await import("./project-file-transactions");',
]) {
	test(`protected archive deletion belongs only to I4: ${source}`, () => {
		assert.notDeepEqual(
			checkIdentityWriterImports("apps/desktop/src/main/narration-authoring.ts", source),
			[],
		);
	});
}
test("I4 may import protected pruning and other writers may import ordinary T1", () => {
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/identity-store.ts",
			'import { reclaimProtectedArchives } from "./project-file-transactions";',
		),
		[],
	);
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/narration-authoring.ts",
			'import { writeProjectFiles } from "./project-file-transactions";',
		),
		[],
	);
});
test("source-owner command rejects protected pruning outside I4", () => {
	const result = runFixture({
		path: "apps/desktop/src/main/narration-authoring.ts",
		source: 'import { reclaimProtectedArchives } from "./project-file-transactions";',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /reclaimProtectedArchives belongs only|protected archive deletion/u);
});

for (const source of [
	'import { loadIdentityStore } from "./identity-store";',
	'import type { Identity } from "./identity-types";',
	'export * from "./identity-lineage";',
	'const store = await import("./identity-store-files");',
	'const path = "./identity-store"; await import(path);',
	'import { assertPath } from "@praxity/content-identity/src/files.ts";',
	'import { parseIdentity } from "@praxity/content-identity";',
	'import { x } from "./identity/store";',
	'import { x } from "./Identity-store";',
	'import { x } from "../main/identity/store";',
	'import { x } from "../MAIN/Identity/store";',
	'import { assertPath } from "../../../../packages/content-identity/src/files.ts";',
	'export * from "../../../../PACKAGES/Content-Identity/src/files.ts";',
	'const path = "../../../../packages/content-identity/src/files.ts"; await import(path);',
]) {
	test(`T1 refuses identity dependencies: ${source}`, () => {
		assert.match(
			checkIdentityWriterImports("apps/desktop/src/main/project-file-transactions.ts", source).join(
				"\n",
			),
			/T1 must not import identity-/u,
		);
	});
}
test("T1 permits the protected-path leaf and identity may consume T1 facts", () => {
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/project-file-transactions.ts",
			'import { isIdentityLineagePath } from "./project-protected-paths";',
		),
		[],
	);
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/identity-store.ts",
			'import { readProjectRecoveryEvidence } from "./project-file-transactions";',
		),
		[],
	);
});
test("source-owner command rejects a planted T1 identity import", () => {
	const result = runFixture({
		path: "apps/desktop/src/main/project-file-transactions.ts",
		source: 'import { liveIdentityStoreIsIntact } from "./identity-store-files";',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /T1 must not import identity-/u);
});

test("source-owner command rejects a relative T1 content-identity import", () => {
	const result = runFixture({
		path: "apps/desktop/src/main/project-file-transactions.ts",
		source:
			'import { assertPath } from "../../../../packages/content-identity/src/files.ts"; assertPath("lesson.prax");',
		files: {
			"packages/content-identity/src/files.ts": "export function assertPath(path: string) {}",
		},
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /T1 must not import identity-/u);
});

for (const path of [
	"apps/desktop/src/shared/editor-session.ts",
	"apps/desktop/src/main/studio/project-session.ts",
]) {
	for (const source of [
		'import { buildPageNodes } from "@praxity/editor-core/frame-bridge";',
		'import * as frame from "@praxity/editor-core/frame-bridge";',
		'export { buildPageNodes } from "@praxity/editor-core/frame-bridge";',
		'export * from "@praxity/editor-core/frame-bridge";',
		'const frame = await import("@praxity/editor-core/frame-bridge");',
		'const entry = "@praxity/editor-core/frame-bridge"; await import(entry);',
		'import { buildPageNodes } from "../../../../../packages/editor-core/src/frame-bridge/index.ts";',
	]) {
		test(`Node source refuses browser frame barrel in ${path}: ${source}`, () => {
			assert.match(
				checkIdentityWriterImports(path, source).join("\n"),
				/Node source must import the pure frame-bridge\/view entry/u,
			);
		});
	}
	for (const source of [
		'import { buildPageNodes } from "@praxity/editor-core/frame-bridge/view";',
		'import type { FrameNode } from "@praxity/editor-core/frame-bridge";',
		'import { type FrameNode } from "@praxity/editor-core/frame-bridge";',
		'export type { FrameNode } from "@praxity/editor-core/frame-bridge";',
		'export { type FrameNode } from "@praxity/editor-core/frame-bridge";',
	]) {
		test(`Node source permits pure or type-only frame imports in ${path}: ${source}`, () => {
			assert.deepEqual(checkIdentityWriterImports(path, source), []);
		});
	}
}
for (const path of [
	"apps/desktop/src/inspection-frame.ts",
	"apps/desktop/src/main/__tests__/frame.test.ts",
]) {
	test(`browser frame barrel remains available in ${path}`, () => {
		assert.deepEqual(
			checkIdentityWriterImports(
				path,
				'import * as frame from "@praxity/editor-core/frame-bridge";',
			),
			[],
		);
	});
}

for (const name of ["planInverseGroup", "consumeInverseGroupIdentity"]) {
	for (const path of [
		"apps/desktop/src/renderer/planted.ts",
		"apps/desktop/src/shared/editor-session.ts",
		"apps/desktop/src/main/identity-store.ts",
	]) {
		for (const source of [
			`import { ${name} as candidate } from "@praxity/operations";`,
			`export { ${name} } from "@praxity/operations";`,
			`import * as operations from "@praxity/operations"; operations.${name}();`,
			`import { ${name} } from "../../packages/operations/src/inverse.ts";`,
		]) {
			test(`group history ownership refuses ${name} in ${path}: ${source}`, () => {
				assert.match(checkIdentityWriterImports(path, source).join("\n"), /group|belongs only/u);
			});
		}
	}
	test(`group history ownership permits named service import of ${name}`, () => {
		assert.deepEqual(
			checkIdentityWriterImports(
				"apps/desktop/src/main/operations/operation-service.ts",
				`import { ${name} } from "@praxity/operations";`,
			),
			[],
		);
	});
}

for (const source of [
	'import * as operations from "@praxity/operations";',
	'export * from "@praxity/operations";',
	'const operations = await import("@praxity/operations");',
	'const operations = await import("@praxity/operations/src/inverse.ts");',
]) {
	for (const path of [
		"apps/desktop/src/renderer/planted.ts",
		"apps/desktop/src/main/operations/operation-service.ts",
	]) {
		test(`group history ownership refuses whole-module access in ${path}: ${source}`, () => {
			assert.match(
				checkIdentityWriterImports(path, source).join("\n"),
				/import group history capabilities by name/u,
			);
		});
	}
}

test("group history ownership permits ordinary operations imports", () => {
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/shared/editor-session.ts",
			'import { applyOperation, type OperationSourceFile } from "@praxity/operations";',
		),
		[],
	);
});

for (const writer of [
	"resolveCourseIdentity",
	"persistCourseIdentity",
	"resolveLessonSourcesForWrite",
]) {
	for (const source of [
		`import { ${writer} as candidate } from "../identity-store";`,
		`export { ${writer} as candidate } from "../lesson-source";`,
		`import * as owner from "../identity-store"; owner.${writer}(root);`,
		`const { ${writer}: candidate } = require("../identity-store");`,
	]) {
		test(`identity writer ownership refuses reader access: ${source}`, () => {
			assert.ok(
				checkIdentityWriterImports("apps/desktop/src/main/studio/preview-scheduler.ts", source)
					.length > 0,
			);
		});
	}
}
for (const source of [
	'import * as owner from "../lesson-source";',
	'export * from "../identity-store";',
	'const owner = await import("../identity-store");',
	'const owner = require("../lesson-source");',
]) {
	test(`identity writer ownership refuses whole-module reader access: ${source}`, () => {
		assert.match(
			checkIdentityWriterImports("apps/desktop/src/main/studio/preview-scheduler.ts", source).join(
				"\n",
			),
			/import identity writers by name/u,
		);
	});
}

for (const source of [
	'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("../identity-store")[key];',
	'import { createRequire as make } from "module"; const load = make(import.meta.url); const spec = "../lesson-source"; load(spec);',
	'import { createRequire } from "node:module"; createRequire(import.meta.url)("../identity-store");',
	'import * as modules from "node:module"; const load = modules.createRequire(import.meta.url); load("../identity-store");',
	'import { writeIdentityFixture } from "../../test-utils/identity-fixture";',
	'export * from "../../test-utils/identity-fixture";',
	'const helper = await import("../../test-utils/identity-fixture");',
	'const helper = require("../../test-utils/identity-fixture");',
	'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("../../test-utils/identity-fixture");',
]) {
	test(`identity writer ownership refuses loader and test helper bypass: ${source}`, () => {
		assert.ok(
			checkIdentityWriterImports("apps/desktop/src/main/studio/preview-scheduler.ts", source)
				.length > 0,
		);
	});
}

test("identity writer ownership CLI confines direct identity fixture writes to tests", () => {
	const root = mkdtempSync(join(tmpdir(), "identity-test-helper-owner-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		for (const [path, source] of [
			[
				"apps/desktop/src/test-utils/identity-fixture.ts",
				"export function writeIdentityFixture() {}",
			],
			["apps/desktop/src/main/identity-store.ts", "export function resolveCourseIdentity() {}"],
			[
				"apps/desktop/src/main/studio/preview-scheduler.ts",
				'import { writeIdentityFixture } from "../../test-utils/identity-fixture";\nimport { createRequire } from "node:module"; const load = createRequire(import.meta.url); const spec = "../identity-store"; load(spec)[key];',
			],
		]) {
			const target = join(root, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, source);
		}
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /test helpers belong only in tests/u);
		assert.match(result.stderr, /import identity writers by name/u);
	} finally {
		rmSync(root, { recursive: true });
	}
});

for (const [path, allowed] of [
	["packages/export-pipeline/vitest.global-setup.ts", true],
	["packages/export-pipeline/scripts/update-page-compiler-baseline.mts", true],
	["scripts/preflight-gates.mts", true],
	["apps/desktop/src/main/__tests__/setup.ts", true],
	["apps/desktop/src/main/setup.test.ts", true],
	["apps/desktop/src/main/planted.ts", false],
	["packages/export-pipeline/src/planted.ts", false],
]) {
	test(`production test-helper scope ${allowed ? "permits" : "refuses"} ${path}`, () => {
		const failures = checkIdentityWriterImports(
			path,
			'import { writeIdentityFixture } from "@praxity/desktop/test-utils/identity-fixture";',
		);
		assert.deepEqual(failures, allowed ? [] : [`${path}:1: test helpers belong only in tests`]);
	});
}

for (const source of [
	'const owner = module.require("./identity-store"); owner[key];',
	'import nodeModule from "node:module"; nodeModule.createRequire(import.meta.url)("./identity-store")[key];',
	'const { createRequire: make } = await import("node:module"); make(import.meta.url)("./identity-store")[key];',
	'process.getBuiltinModule("node:module").createRequire(import.meta.url)("./identity-store")[key];',
	'(0, require)("./identity-store")[key];',
	'require.call(undefined, "./identity-store")[key];',
	'import nodeModule from "node:module"; let load = nodeModule.createRequire(import.meta.url); load("./identity-store")[key];',
	'function read(load: NodeRequire) { return load("./identity-store")[key]; } read(require);',
	'import nodeModule from "node:module"; nodeModule.createRequire(import.meta.url)("../test-utils/identity-fixture")[key];',
	'// @ts-expect-error Runtime loader suffix\nconst owner = await import("./identity-store?probe"); owner[key];',
	'const owner = await import("./lesson-source.ts?probe"); owner[key];',
	'const factory = nodeModule["createRequire"]; factory(import.meta.url)("./identity-store")[key];',
	'const factory = process["getBuiltinModule"]("node:module")["createRequire"]; factory(import.meta.url)("./identity-store")[key];',
]) {
	test(`desktop production loader refuses indirect access: ${source}`, () => {
		assert.ok(checkIdentityWriterImports("apps/desktop/src/main/planted.ts", source).length > 0);
	});
}

for (const path of [
	"apps/desktop/src/main/__tests__/loader.ts",
	"apps/desktop/src/main/loader.test.ts",
	"packages/export-pipeline/src/loader.ts",
]) {
	test(`desktop production loader permits other source ${path}`, () => {
		assert.deepEqual(
			checkIdentityWriterImports(
				path,
				'import nodeModule from "node:module"; let load = nodeModule.createRequire(import.meta.url); load("node:fs");',
			),
			[],
		);
	});
}

test("identity writer ownership permits read interfaces and named writer owners", () => {
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/studio/preview-scheduler.ts",
			'import { resolveLessonSources } from "../lesson-source";',
		),
		[],
	);
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/studio/project-session.ts",
			'import { resolveLessonSourcesForWrite } from "../lesson-source";',
		),
		[],
	);
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/operations/operation-service.ts",
			'import { resolveCourseIdentity, persistCourseIdentity } from "../identity-store";',
		),
		[],
	);
	assert.deepEqual(
		checkIdentityWriterImports(
			"apps/desktop/src/main/__tests__/identity-writer-admission.test.ts",
			'import { resolveCourseIdentity } from "../identity-store";',
		),
		[],
	);
});

test("identity writer ownership CLI follows aliased barrel exports", () => {
	const root = mkdtempSync(join(tmpdir(), "identity-writer-owner-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		for (const [path, source] of [
			["apps/desktop/src/main/identity-store.ts", "export function resolveCourseIdentity() {}"],
			[
				"apps/desktop/src/main/operations/operation-service.ts",
				'export { resolveCourseIdentity as admitted } from "../identity-store";',
			],
			[
				"apps/desktop/src/main/studio/preview-scheduler.ts",
				'import * as owner from "../operations/operation-service"; owner.admitted();',
			],
		]) {
			const target = join(root, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, source);
		}
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /preview-scheduler\.ts:1: import identity writers by name/u);
	} finally {
		rmSync(root, { recursive: true });
	}
});

for (const predicate of ["isRuntimeNodeId", "isDisplayNodeId"]) {
	for (const source of [
		`import { ${predicate} } from "@praxity/content-model/types";`,
		`import { ${predicate} as accepts } from "@praxity/shared-blocks/types";`,
		`export { ${predicate} as accepts } from "../../content-model/src/types";`,
		`import * as ids from "@praxity/content-model"; ids.${predicate}(input);`,
		`import * as ids from "@praxity/content-model"; ids["${predicate}"](input);`,
		`const { ${predicate}: accepts } = require("@praxity/content-model/types");`,
	]) {
		test(`display ID ownership rejects durable widening: ${source}`, () => {
			assert.ok(
				checkDisplayIdImports("apps/desktop/src/shared/editor-session.ts", source).length > 0,
			);
		});
	}
}
test("display ID ownership admits only each owner's predicate and test fixtures", () => {
	const runtime = 'import { isRuntimeNodeId } from "@praxity/content-model/types";';
	const display = 'import { isDisplayNodeId } from "@praxity/content-model/types";';
	assert.deepEqual(checkDisplayIdImports("packages/content-identity/src/files.ts", runtime), []);
	assert.deepEqual(checkDisplayIdImports("packages/shared-blocks/src/narration.ts", display), []);
	assert.deepEqual(checkDisplayIdImports("packages/content-identity/src/files.ts", display), []);
	assert.deepEqual(checkDisplayIdImports("packages/content-identity/src/resolve.ts", runtime), []);
	assert.deepEqual(checkDisplayIdImports("packages/content-identity/src/resolve.ts", display), []);
	assert.deepEqual(
		checkDisplayIdImports("apps/desktop/src/shared/narration-sidecar.ts", display),
		[],
	);
	assert.deepEqual(
		checkDisplayIdImports("apps/desktop/src/shared/edit-cli-schema.ts", display),
		[],
	);
	assert.equal(
		checkDisplayIdImports("apps/desktop/src/shared/edit-cli-schema.ts", runtime).length,
		1,
	);
	assert.equal(
		checkDisplayIdImports("apps/desktop/src/shared/narration-sidecar.ts", runtime).length,
		1,
	);
	assert.equal(checkDisplayIdImports("packages/shared-blocks/src/narration.ts", runtime).length, 1);
	assert.deepEqual(
		checkDisplayIdImports("packages/content-identity/__tests__/runtime-format.test.ts", display),
		[],
	);
	assert.deepEqual(
		checkDisplayIdImports(
			"apps/desktop/src/shared/editor-session.ts",
			'import { isIdentityNodeId } from "@praxity/content-model/types";',
		),
		[],
	);
});

test("read snapshot parser ownership keeps display admission in private matching", () => {
	const source = 'import { parseIdentityReadSnapshot as parse } from "./files.ts";';
	assert.ok(checkDisplayIdImports("apps/desktop/src/main/identity-store.ts", source).length > 0);
	assert.deepEqual(checkDisplayIdImports("packages/content-identity/src/resolve.ts", source), []);
});

for (const source of [
	'import * as ids from "@praxity/content-model/types";',
	'export * from "@praxity/shared-blocks/types";',
	'const ids = await import("@praxity/content-model/types");',
	'const ids = require("@praxity/content-model/types");',
]) {
	test(`display ID ownership rejects whole-module predicate imports: ${source}`, () => {
		assert.ok(
			checkDisplayIdImports("apps/desktop/src/shared/editor-session.ts", source).length > 0,
		);
	});
}
test("display ID ownership preserves canonical barrels and unrelated members", () => {
	assert.deepEqual(
		checkDisplayIdImports("packages/content-model/src/index.ts", 'export * from "./types";'),
		[],
	);
	assert.deepEqual(
		checkDisplayIdImports(
			"packages/shared-blocks/src/types.ts",
			'export * from "@praxity/content-model/types";',
		),
		[],
	);
	assert.deepEqual(
		checkDisplayIdImports(
			"apps/desktop/src/shared/editor-session.ts",
			"object.constructor; object.toString;",
		),
		[],
	);
});

test("display ID ownership CLI rejects a planted durable import", () => {
	const root = mkdtempSync(join(tmpdir(), "display-id-owner-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		const file = join(root, "apps/desktop/src/shared/editor-session.ts");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			'import { isDisplayNodeId as accepts } from "@praxity/content-model/types";',
		);
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/isDisplayNodeId belongs only in packages\/shared-blocks\/src\/narration\.ts/u,
		);
	} finally {
		rmSync(root, { recursive: true });
	}
});

for (const folder of [
	"packages/export-pipeline/template/src/islands",
	"packages/shared-blocks/src/viewer",
	"packages/shared-blocks/src/logic",
]) {
	const target = folder.endsWith("logic")
		? `${folder}/dom-logic-runtime.ts`
		: `${folder}/planted.ts`;
	for (const source of [
		"new ResizeObserver(callback);",
		"new MutationObserver(callback);",
		"new IntersectionObserver(callback);",
		"window.requestAnimationFrame(callback);",
		"setTimeout(callback, 100);",
		"const defer = window.setTimeout; defer(callback, 1);",
		"typeof setTimeout(callback, 1);",
		'const name = "Resize" + "Observer"; new window[name](callback);',
		"const { requestAnimationFrame: defer } = window; defer(callback);",
	])
		test(`lifetime owner rejects ${target}: ${source}`, () => {
			assert.ok(checkLifetimeOwners(target, source).length > 0);
		});
	test(`lifetime owner permits helpers and types in ${target}`, () => {
		assert.deepEqual(
			checkLifetimeOwners(
				target,
				"const id: ReturnType<typeof setTimeout> = setSelfCheckTimeout(callback, 1); createSelfCheckResizeObserver(current, callback);",
			),
			[],
		);
	});
}

test("the source-owner command refuses a planted raw observer", () => {
	const root = mkdtempSync(join(tmpdir(), "lifetime-owner-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		const target = join(root, "packages/export-pipeline/template/src/islands/planted.ts");
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, "new ResizeObserver(() => {});");
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /planted\.ts:1.*lifetime helpers/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the source-owner command refuses a provider write alias outside its owner", () => {
	const root = mkdtempSync(join(tmpdir(), "lifetime-write-owner-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		const owner = join(root, "packages/shared-blocks/src/learner-block-state.ts");
		const target = join(root, "packages/shared-blocks/src/viewer/planted.ts");
		mkdirSync(dirname(owner), { recursive: true });
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(
			owner,
			"export interface LearnerBlockStateRuntime { set(id: string, value: unknown): void; }",
		);
		writeFileSync(
			target,
			'import type {LearnerBlockStateRuntime} from "../learner-block-state"; declare const provider: LearnerBlockStateRuntime; const save = provider["set"]; save("check", {});',
		);
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /planted\.ts:1.*writeLearnerBlockState/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

for (const name of [
	"praxity:assessment-response",
	"praxity:assessment-group-complete",
	"praxity:block-interaction",
]) {
	test(`learner event ${name} must retain dispatch authority`, () => {
		const path = "packages/shared-blocks/src/viewer/planted.ts";
		assert.equal(
			checkLifetimeOwners(path, `document.dispatchEvent(new CustomEvent("${name}", {detail}));`)
				.length,
			1,
		);
		assert.deepEqual(
			checkLifetimeOwners(
				path,
				`dispatchSelfCheckEvent(new CustomEvent("${name}", {detail}), current);`,
			),
			[],
		);
	});
}

const path = "apps/desktop/src/planted.ts";
for (const source of [
	"const pages = source.match(/^---\\s/gm);",
	"const pages = source.match(/^#\\s+/gm);",
	"const page = line.startsWith('# ');",
	"const fence = line.trim() === '---';",
	"const fence = line.startsWith('---');",
	"const fence = source.startsWith('---\\n');",
	"const pages = source.split('\\n---\\n');",
	"const pages = new RegExp('^---\\\\s', 'gm');",
	"const bom = source.startsWith('\\uFEFF');",
	"const bom = source.charCodeAt(0) === 0xfeff;",
	"const bom = source.replace(/^\\uFEFF/, '');",
]) {
	test(`plants source detection: ${source}`, () => {
		assert.equal(checkSourceOwners(path, source).length, 1);
		assert.deepEqual(checkSourceOwners("packages/grammar/src/planted.ts", source), []);
	});
}

test("emitted fences, prose, comments and ordinary EOL detection are allowed", () => {
	assert.deepEqual(
		checkSourceOwners(
			path,
			"// --- fence\nconst text = '---\\ntitle: New\\n---'; const eol = /\\r?\\n/;",
		),
		[],
	);
});

test("a TypeScript generic arrow cannot hide a later detector", () => {
	assert.equal(
		checkSourceOwners(
			path,
			"const identity = <T>(value: T) => value; const pages = source.match(/^---\\s/gm);",
		).length,
		1,
	);
});

test("exceptions have reasons and cover only the recorded expression", () => {
	for (const entry of sourceOwnerAllowlist) {
		assert.ok(entry.reason.trim().length > 20);
		assert.deepEqual(checkSourceOwners(entry.path, `const allowed = ${entry.expression};`), []);
		assert.equal(checkSourceOwners(entry.path, "const planted = line === '---';").length, 1);
	}
});

test("an exception without a reason cannot bypass lint", () => {
	const entry = sourceOwnerAllowlist[0];
	assert.equal(
		checkSourceOwners(entry.path, `const allowed = ${entry.expression};`, [
			{ ...entry, reason: " " },
		]).length,
		1,
	);
});

test("the lint command fails on an untracked production violation", () => {
	const root = mkdtempSync(join(tmpdir(), "source-owners-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, "const pages = source.match(/^---\\s/gm);");
		const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /planted\.ts:1/);
		assert.match(result.stderr, /packages\/grammar\/src/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

for (const source of [
	'import { readSelfCheckContent as reveal } from "@praxity/grammar"; reveal(read, id);',
	'import { selfCheckContent as reveal } from "@praxity/grammar/src/v4/schema.ts";',
	'import type { LessonNodeRecord } from "@praxity/grammar";',
	'import { lessonNodeAtLine as rawNode } from "@praxity/grammar/src/read-lesson.ts";',
	'export { readSelfCheckContent as reveal } from "@praxity/grammar";',
	'import * as grammar from "@praxity/grammar";',
	'const grammar = await import("@praxity/grammar");',
	'const grammar = require("@praxity/grammar/src/read-lesson.ts");',
	'export * from "@praxity/grammar/src/read-lesson.ts";',
	"const content = grammar.readSelfCheckContent(read, id);",
	'const content = grammar["selfCheckContent"](node, ids);',
	'import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";',
	'import type { TreeNode } from "@praxity/grammar/src/v4/tree/types.ts";',
	'import type { LessonTree } from "@praxity/grammar/src/v4/tree/types.ts";',
	'import { analyzeLessonTree } from "@praxity/grammar/v4/tree";',
	'import { readSelfCheckContent as reveal } from "../author-content";',
	'import type { AnalyzedLessonTree as Raw } from "../author-content";',
	'import { tokenizeLesson } from "../../grammar/src/v4/lex";',
	'import { readLesson } from "@praxity/grammar"; const model = readLesson(source).tree;',
	'import type { ReadLessonResult } from "@praxity/grammar"; const { nodes } = read;',
	'import { readLesson } from "@praxity/grammar"; const raw = read["nodes"];',
	'const node = read.nodes.get(id); if (node.type === "self-check") publish(node.children);',
]) {
	test(`plants unauthorized self-check access: ${source}`, () => {
		assert.ok(checkSelfCheckOwners("packages/export-pipeline/src/planted.ts", source).length >= 1);
		for (const owner of selfCheckAuthorOwners)
			assert.deepEqual(
				checkSelfCheckOwners(owner.endsWith("/") ? `${owner}planted.ts` : owner, source),
				[],
			);
	});
}

test("the self-check state owner refuses a planted raw-content import", () => {
	const owner = "packages/shared-blocks/src/self-check-state.ts";
	const envelopeGuard = 'if (value.kind !== "self-check") return invalid;';
	assert.deepEqual(checkSelfCheckOwners(owner, envelopeGuard), []);
	assert.ok(
		checkSelfCheckOwners(
			owner,
			'import { readSelfCheckContent } from "@praxity/grammar"; readSelfCheckContent(read, id);' +
				envelopeGuard,
		).length >= 1,
	);
	assert.ok(
		checkSelfCheckOwners(owner, 'if (node.type === "self-check") publish(node.children);').length >=
			1,
	);
});

test("prompt readers and unrelated schema imports remain allowed", () => {
	assert.deepEqual(checkSelfCheckOwners(path, "function require() {} require();"), []);
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			'const fixture = await import("./tests/fixtures/load-grammar-fixture");',
		),
		[],
	);
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			'import { readLesson } from "@praxity/grammar"; import { getDefinition } from "@praxity/grammar/src/v4/schema.ts"; const blocks = readLesson(source).blocks;',
		),
		[],
	);
	assert.deepEqual(
		checkSelfCheckOwners(
			"apps/desktop/src/main/export/build-export-input-from-project.ts",
			'import { readLesson } from "@praxity/grammar"; if (!read || read.tree.stream.source !== input.lessonSource) throw Error("revision");',
		),
		[],
	);
	assert.equal(
		checkSelfCheckOwners(
			"apps/desktop/src/main/export/build-export-input-from-project.ts",
			'import { readLesson } from "@praxity/grammar"; publish(read.tree.root);',
		).length,
		1,
	);
});

test("retrieval advice has an exact author-owner exemption for source locations", () => {
	const source = "const nodes = read.nodes; const tree = read.tree;";
	assert.deepEqual(
		checkSelfCheckOwners("packages/editor-core/src/lib/a11y/retrieval-sheet-advice.ts", source),
		[],
	);
	assert.ok(
		checkSelfCheckOwners("packages/editor-core/src/lib/a11y/retrieval-sheet-other.ts", source)
			.length > 0,
	);
});

test("retrieval accessor imports and calls cannot bypass author ownership", () => {
	const source =
		'import { readRetrievalSheetContent as content } from "@praxity/grammar"; publish(content(read, id));';
	for (const path of [
		"packages/export-pipeline/template/src/patterns/planted.ts",
		"packages/shared-blocks/src/planted.ts",
		"apps/desktop/src/main/export/planted.ts",
	]) {
		assert.ok(checkSelfCheckOwners(path, source).length > 0, path);
	}
	assert.deepEqual(
		checkSelfCheckOwners("packages/editor-core/src/lib/a11y/retrieval-sheet-advice.ts", source),
		[],
	);
});

for (const accessor of [
	"readSelfCheckContent",
	"readRetrievalSheetContent",
	"readWriteDistractorsContent",
]) {
	test(`the lint command rejects a planted untracked ${accessor} import`, () => {
		const root = mkdtempSync(join(tmpdir(), "self-check-owners-"));
		try {
			execFileSync("git", ["init", "--quiet", root]);
			const target = join(root, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, `import { ${accessor} } from "@praxity/grammar";`);
			const result = spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
				cwd: root,
				encoding: "utf8",
			});
			assert.equal(result.status, 1);
			assert.match(result.stderr, /planted\.ts:1/);
			assert.match(result.stderr, /declared author owner/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

const exportBridge = "apps/desktop/src/main/export/build-export-input-from-project.ts";
const compilerOwner = "packages/export-pipeline/src/self-check.ts";
test("the self-check island may use library logic but cannot import raw author or compiler content", () => {
	const island = "packages/export-pipeline/template/src/islands/self-check-support.ts";
	assert.ok(
		checkSelfCheckOwners(
			"packages/export-pipeline/template/src/islands/island-self-check.ts",
			'import { feedback } from "learning-patterns/patterns/self-check/logic.js";',
		).length > 0,
	);
	assert.equal(
		checkSelfCheckOwners(
			island,
			'import { feedback, annotate } from "learning-patterns/patterns/self-check/logic.js";',
		).length,
		0,
	);
	assert.ok(
		checkSelfCheckOwners(island, 'import { readSelfCheckContent } from "@praxity/grammar";')
			.length > 0,
	);
	assert.ok(
		checkSelfCheckOwners(island, 'import { selfCheckRuntimeAssets } from "../../src/self-check";')
			.length > 0,
	);
});
const compilerBuild = "packages/export-pipeline/src/build.ts";
const compilerContext = "packages/export-pipeline/src/preview/course-context.ts";
const desktopConsumer = "apps/desktop/src/main/export/planted.ts";
const authorConsumer = "apps/desktop/src/main/identity-store.ts";

test("rejects a namespace re-export inside the compiler owner", () => {
	assert.equal(
		checkSelfCheckOwners(compilerOwner, 'export * as content from "./self-check";').length,
		1,
	);
});

for (const path of [compilerBuild, compilerContext, desktopConsumer, authorConsumer]) {
	test(`rejects a namespace re-export of the self-check owner in ${path}`, () => {
		assert.ok(
			checkSelfCheckOwners(
				path,
				'export * as content from "@praxity/export-pipeline/src/self-check.ts";',
			).length > 0,
		);
	});
}

for (const [name, owner] of [
	["writeSelfCheckAssets", compilerBuild],
	["captureSelfCheckRuntime", compilerContext],
]) {
	for (const path of [compilerBuild, compilerContext, desktopConsumer, authorConsumer]) {
		test(`restricts ${name} imports to its caller: ${path}`, () => {
			const failures = checkSelfCheckOwners(
				path,
				`import { ${name} as content } from "@praxity/export-pipeline/src/self-check.ts";`,
			);
			assert.equal(failures.length, path === owner ? 0 : 1);
		});
	}
	test(`rejects ${name} re-exports even from its allowed caller`, () => {
		assert.equal(checkSelfCheckOwners(owner, `export { ${name} } from "./self-check";`).length, 1);
	});
}

for (const source of [
	"publish(_selfCheckContent);",
	"publish({ _selfCheckContent });",
	"const alias = _selfCheckContent; publish(alias);",
	"_selfCheckContent = replacement;",
]) {
	test(`rejects a reference to stripped content: ${source}`, () => {
		for (const [input, prompt] of [
			["course", "promptCourse"],
			["config", "promptConfig"],
		]) {
			assert.equal(
				checkSelfCheckOwners(
					compilerContext,
					`const { selfCheckContents: _selfCheckContent, writeDistractorsContents: _writeDistractorsContent, ...${prompt} } = ${input}; ${source}`,
				).length,
				1,
			);
		}
	});
}

for (const source of [
	'import { selfCheckRuntimeAssets as bytes } from "@praxity/export-pipeline/src/self-check.ts";',
	'export { selfCheckRuntimeAssets } from "@praxity/export-pipeline/src/self-check.ts";',
	'import * as owner from "@praxity/export-pipeline/src/self-check.ts";',
	'export * from "@praxity/export-pipeline/src/self-check.ts";',
	'const owner = await import("@praxity/export-pipeline/src/self-check.ts");',
	'const owner = require("@praxity/export-pipeline/src/self-check.ts");',
	"owner.selfCheckRuntimeAssets(runtime);",
]) {
	test(`rejects runtime-byte access outside export-pipeline: ${source}`, () => {
		for (const path of [desktopConsumer, authorConsumer]) {
			assert.equal(checkSelfCheckOwners(path, source).length, 1);
		}
		assert.deepEqual(checkSelfCheckOwners("apps/desktop/src/tests/planted.ts", source), []);
	});
}

test("the command rejects a desktop deep import of compiler bytes", () => {
	const result = runFixture({
		path: desktopConsumer,
		source: 'import { selfCheckRuntimeAssets } from "@praxity/export-pipeline/src/self-check.ts";',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /declared author owner/);
});

test("compiler content owner has no raw author privileges", () => {
	assert.ok(!selfCheckAuthorOwners.includes(compilerOwner));
	assert.ok(
		checkSelfCheckOwners(compilerOwner, 'import { readSelfCheckContent } from "@praxity/grammar";')
			.length > 0,
	);
});
for (const source of [
	'import { selfCheckRuntimeAssets as bytes } from "./self-check"; bytes(runtime);',
	'export { selfCheckRuntimeAssets } from "./self-check";',
	'import * as owner from "./self-check"; owner.selfCheckRuntimeAssets(runtime);',
	'const owner = await import("./self-check");',
	'import { validateContent } from "learning-patterns/patterns/self-check/logic.js";',
	"const content = course.selfCheckContents;",
	'const content = course["selfCheckContents"];',
	"const { selfCheckContents: content } = course;",
])
	test(`plants compiler content ownership violation: ${source}`, () => {
		assert.ok(
			checkSelfCheckOwners("packages/export-pipeline/src/glossary-page.ts", source).length > 0,
		);
		assert.deepEqual(checkSelfCheckOwners(compilerOwner, source), []);
	});
test("compiler content strip sites allow only the declared destructuring", () => {
	const path = "packages/export-pipeline/src/preview/course-context.ts";
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			"const { selfCheckContents: _selfCheckContent, writeDistractorsContents: _writeDistractorsContent, ...promptCourse } = course;",
		),
		[],
	);
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			"const { selfCheckContents: _selfCheckContent, writeDistractorsContents: _writeDistractorsContent, ...promptConfig } = config;",
		),
		[],
	);
	assert.ok(
		checkSelfCheckOwners(path, "const { selfCheckContents: content } = course;").length > 0,
	);
	assert.ok(checkSelfCheckOwners(path, "publish(course.selfCheckContents);").length > 0);
});
test("compiler bridge admits only the typed content accessors", () => {
	for (const accessor of ["readSelfCheckContent", "readWriteDistractorsContent"])
		assert.deepEqual(
			checkSelfCheckOwners(
				exportBridge,
				`import { ${accessor} as content } from "@praxity/grammar"; content(read, id);`,
			),
			[],
		);
	for (const source of [
		'import { selfCheckContent } from "@praxity/grammar/src/v4/schema"; selfCheckContent(node);',
		'import { writeDistractorsContent } from "@praxity/grammar/src/v4/schema"; writeDistractorsContent(node);',
		"JSON.stringify(read.tree)",
	])
		assert.ok(checkSelfCheckOwners(exportBridge, source).length > 0);
});

const readerTypes = {
	"packages/export-pipeline/src/reader-types.ts":
		'export type { ReadLessonResult as LessonRead } from "@praxity/grammar";',
};
const readerExports = {
	"packages/export-pipeline/src/reader.ts":
		'export { readLesson as load, withLessonIds as rebuild, parseV4 as parse } from "@praxity/grammar";',
};
const rejectedFixtures = [
	{
		name: "namespace import with dot path segment",
		source:
			'import * as raw from "@praxity/grammar/./src/v4/tree/index.ts"; export const tree = raw.analyzeLessonTree;',
	},
	{
		name: "computed accessor through aliased CommonJS factory",
		source:
			'import {createRequire as make} from "module"; const load = make(import.meta.url); load("@praxity/grammar")[getKey()];',
	},
	...[
		"function leak(read: {tree: object; nodes: Map<string, object>}) { return JSON.stringify(read); }",
		"function leak(read: {tree: object; nodes: Map<string, object>}) { const { blocks, ...meta } = read; return meta; }",
		"function leak(read: {tree: object; nodes: Map<string, object>}) { return structuredClone(read); }",
		"function leak(read: {tree: object; nodes: Map<string, object>}) { return Object.values(read); }",
		"function leak(read: {tree: object; nodes: Map<string, object>}) { return {...read}; }",
		'function leak(read: {tree: object; nodes: Map<string, object>}) { return read[("tr"+"ee")]; }',
		'import {createRequire} from "node:module"; const k = getKey(); createRequire(import.meta.url)("@praxity/grammar")[k];',
		'import {createRequire as makeRequire} from "node:module"; const load = makeRequire(import.meta.url); load(moduleName);',
		"const raw = require(moduleName);",
		"const raw = import(moduleName);",
	].map((source) => ({ name: `whole read or computed import ${source}`, source })),
	{
		name: "sidecar is no longer an author owner",
		path: "apps/desktop/src/shared/narration-sidecar.ts",
		source: 'import {readSelfCheckContent} from "@praxity/grammar";',
	},

	{
		name: "raw tree re-export alias",
		files: {
			"packages/grammar/src/v4/tree/types.ts":
				"export interface TreeNode { raw: string; children: TreeNode[]; }",
			"packages/editor-core/src/session/raw-owner.ts":
				'export type { TreeNode as RawTree } from "../../../grammar/src/v4/tree/types";',
		},
		source:
			'import type { RawTree } from "../../editor-core/src/session/raw-owner"; function publishTree(tree: RawTree) { publish(tree); }',
	},
	{
		name: "rebuilt reader",
		source:
			'import { withLessonIds } from "@praxity/grammar"; const read = withLessonIds(input, ids); publish(read.nodes.get(id).node.raw);',
	},
	{
		name: "rebuilt reader alias",
		source:
			'import { withLessonIds as rebuild } from "@praxity/grammar"; const alias = rebuild; const read = alias(input, ids); publish(read.tree);',
	},
	{
		name: "reader re-export",
		files: readerExports,
		source: 'import { load } from "./reader"; publish(load(source).tree);',
	},
	{
		name: "rebuilder re-export",
		files: readerExports,
		source: 'import { rebuild } from "./reader"; publish(rebuild(input, ids).nodes);',
	},
	{
		name: "other parser re-export",
		files: readerExports,
		source: 'import { parse } from "./reader"; publish(parse(source).tree);',
	},
	{
		name: "unknown reader constructor",
		source: "const read = constructReader(source); publish(read.tree);",
	},
	{
		name: "reader argument",
		source: "function publishReader(value) { publish(value.nodes.get(id).node.raw); }",
	},
	{
		name: "known reader with array nodes",
		source:
			"function publishReader(value: { tree: { stream: { source: string } }; nodes: { id: string }[] }) { publish(value.nodes); }",
	},
	{
		name: "array of source records",
		source:
			"function publishReader(value: { nodes: { node: { raw: string } }[] }) { publish(value.nodes); }",
	},
	{
		name: "reader value alias",
		source: "function publishReader(value) { const alias = value; publish(alias.tree); }",
	},
	{
		name: "reader through local type re-export",
		files: readerTypes,
		source:
			'import type { LessonRead } from "./reader-types"; function publishReader(value: LessonRead) { publish(value.nodes.get(id).node.raw); }',
	},
	{
		name: "reader bracket access through local type",
		files: readerTypes,
		source:
			'import type { LessonRead } from "./reader-types"; function publishReader(value: LessonRead) { publish(value["tree"]); }',
	},
	{
		name: "destructured reader argument",
		files: readerTypes,
		source:
			'import type { LessonRead } from "./reader-types"; function publishReader({ nodes: records }: LessonRead) { publish(records.get(id).node.raw); }',
	},
	{
		name: "destructured tree alias",
		source:
			"function publishReader(value) { const { tree: sourceTree } = value; publish(sourceTree); }",
	},
	{
		name: "constant computed reader binding",
		source:
			'const field = "nodes"; function publishReader(value) { const { [field]: records } = value; publish(records); }',
	},
	{
		name: "constant dynamic import and accessor binding",
		source:
			'const moduleName = "@praxity/grammar"; const { readSelfCheckContent: reveal } = await import(moduleName); publish(reveal(read, id));',
	},
	{
		name: "constant dynamic import namespace",
		source: 'const moduleName = "@praxity/grammar"; const grammar = await import(moduleName);',
	},
	{
		name: "constant dynamic import with const assertion",
		source:
			'const moduleName = "@praxity/grammar" as const; const grammar = await import(moduleName);',
	},
	{
		name: "constant require",
		source: 'const moduleName = "@praxity/grammar"; const grammar = require(moduleName);',
	},
	{
		name: "constant module alias",
		source:
			'const moduleName = "@praxity/grammar"; const alias = moduleName; const grammar = await import(alias);',
	},
	{
		name: "destructured accessor alias",
		source: "const { readSelfCheckContent: reveal } = grammar; publish(reveal(read, id));",
	},
	{
		name: "destructured schema accessor",
		source: "function publishContent({ selfCheckContent: reveal }) { publish(reveal(node, ids)); }",
	},
	{
		name: "quoted destructured accessor",
		source: 'const { "readSelfCheckContent": reveal } = grammar; publish(reveal(read, id));',
	},
	{
		name: "constant computed accessor binding",
		source:
			'const accessor = "readSelfCheckContent" as const; const { [accessor]: reveal } = grammar; publish(reveal(read, id));',
	},
	...[
		["bridge call", "publish(read.tree.stream.source);"],
		["bridge initializer", "const text = read.tree.stream.source;"],
		["bridge assignment", "text = read.tree.stream.source;"],
		["bridge returned object", "function output() { return { source: read.tree.stream.source }; }"],
		[
			"bridge wrong operand",
			'if (!read || read.tree.stream.source !== source) throw Error("revision");',
		],
		["bridge comparison as argument", "publish(read.tree.stream.source !== input.lessonSource);"],
		[
			"bridge comparison as initializer",
			"const changed = read.tree.stream.source !== input.lessonSource;",
		],
		[
			"bridge comparison in returned object",
			"function output() { return { changed: read.tree.stream.source !== input.lessonSource }; }",
		],
		[
			"bridge comparison with publishing branch",
			"if (!read || read.tree.stream.source !== input.lessonSource) publish(read);",
		],
	].map(([name, source]) => ({
		name,
		path: exportBridge,
		source: `import type { ReadLessonResult } from "@praxity/grammar"; ${source}`,
	})),
];

function runFixture(fixture) {
	const root = mkdtempSync(join(tmpdir(), "self-check-owners-"));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		for (const [path, source] of Object.entries({
			...fixture.files,
			[fixture.path ?? "packages/export-pipeline/src/planted.ts"]: fixture.source,
		})) {
			const target = join(root, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, source);
		}
		return spawnSync(process.execPath, [resolve("scripts/check-source-owners.mjs")], {
			cwd: root,
			encoding: "utf8",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

for (const fixture of rejectedFixtures) {
	test(`fix1 command rejects ${fixture.name}`, () => {
		const result = runFixture(fixture);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /declared author owner/);
	});
}

for (const operator of ["===", "!==", "==", "!="]) {
	test(`fix1 command allows revision guard ${operator}`, () => {
		const result = runFixture({
			path: exportBridge,
			source: `if (!read || read.tree.stream.source ${operator} input.lessonSource) throw Error("revision");`,
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});
}

test("fix1 command allows known prompt, file-tree, frame and identity projections", () => {
	const result = runFixture({
		files: readerTypes,
		source: `import type { LessonRead } from "./reader-types";
function prompt(read: LessonRead) { return read.blocks; }
const files: { tree: { name: string }[] } = { tree: [] };
const frame: { nodes: { id: string }[] } = { nodes: [] };
const identity: { nodes: Record<string, { id: string }> } = { nodes: {} };
publish(files.tree, frame.nodes, identity.nodes);`,
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("author cache and browser URL exceptions cannot authorize other raw-reader uses", () => {
	for (const [path, source] of [
		[
			"apps/desktop/src/main/studio/project-session.ts",
			"function publishReader(read: {tree: object; nodes: Map<string, object>}) { return JSON.stringify(read); }",
		],
		["packages/export-pipeline/template/src/island-loader.ts", "const raw = require(moduleUrl);"],
	]) {
		const result = runFixture({ path, source });
		assert.equal(result.status, 1, result.stdout + result.stderr);
	}
});

const authorityNameForms = [
	"window.__praxityRuntime?.commit();",
	'window?.__praxityTracker?.trackPageVisit("next");',
	"const {__praxityFinishCourse: finish} = window; finish();",
	'(window as any).__praxityRuntime.setSuspendData("{}");',
	'const key = "__praxity" + "Runtime"; window[key].commit();',
];
for (const directory of [
	"packages/export-pipeline/template/src/components",
	"packages/shared-blocks/src/blocks",
])
	for (const source of authorityNameForms)
		test(`authority command rejects ${directory}: ${source}`, () => {
			const result = runFixture({ path: `${directory}/planted.ts`, source });
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stderr, /learner host access requires/);
		});

for (const [name, source, message] of [
	[
		"self-check completion",
		'document.dispatchEvent(new CustomEvent("praxity:self-check-completion", {detail}));',
		/dispatchSelfCheckEvent/,
	],
	[
		"unlisted event",
		'document.dispatchEvent(new CustomEvent("praxity:new-event", {detail}));',
		/dispatchSelfCheckEvent/,
	],
	[
		"head deck listener",
		'on(document, "praxity:assessment-response", (event) => {if (inspection) return; const detail = (event as CustomEvent).detail; const gate = pages[current].gates.find(item => item.id === detail?.blockId); if (gate) {released.add(gate.id); save(); refresh();}});',
		/selfCheckEpochTicket\(document, event\)/,
	],
	[
		"named listener",
		'function receive(event: Event) { save(); } document.addEventListener("praxity:block-interaction", receive);',
		/selfCheckEpochTicket\(document, event\)/,
	],
	[
		"after await",
		"async function run() { await work(); const current = selfCheckEpochTicket(); save(current); }",
		/inherit.*ticket/,
	],
	[
		"promise callback",
		"work().then(() => { const current = selfCheckEpochTicket(); save(current); });",
		/inherit.*ticket/,
	],
	[
		"named promise callback",
		"function later() {selfCheckEpochTicket();} work().then(later);",
		/inherit.*ticket/,
	],
	[
		"scheduler callback",
		"requestSelfCheckFrame(() => selfCheckEpochTicket(), current);",
		/inherit.*ticket/,
	],
	[
		"optional provider",
		'import type {LearnerBlockStateRuntime} from "../learner-block-state"; declare const provider: LearnerBlockStateRuntime | undefined; provider?.set("a", {});',
		/writeLearnerBlockState/,
	],
	[
		"union provider",
		'import type {LearnerBlockStateRuntime} from "../learner-block-state"; declare const provider: LearnerBlockStateRuntime | {read():void} | undefined; provider?.set("a", {});',
		/writeLearnerBlockState/,
	],
	[
		"destructured provider",
		'import type {LearnerBlockStateRuntime} from "../learner-block-state"; declare const provider: LearnerBlockStateRuntime | undefined; const {set:save} = provider!; save("a", {});',
		/writeLearnerBlockState/,
	],
	[
		"any public provider",
		'(window.__praxityBlockState as any).set("a", {});',
		/writeLearnerBlockState/,
	],
])
	test(`authority command rejects ${name}`, () => {
		const result = runFixture({
			path: "packages/shared-blocks/src/blocks/planted.ts",
			files: {
				"packages/shared-blocks/src/learner-block-state.ts":
					"export interface LearnerBlockStateRuntime {set(id:string, value:unknown):void;}",
			},
			source,
		});
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, message);
	});

test("authority permits gesture tickets and inherited event stamps", () => {
	const result = runFixture({
		path: "packages/shared-blocks/src/blocks/planted.ts",
		source: `
 function gesture() { const current = selfCheckEpochTicket(); requestSelfCheckFrame(() => save(current), current); }
 function receive(event: Event) { const current = selfCheckEpochTicket(document, event); save(current); }
 document.addEventListener("praxity:assessment-response", receive);
 dispatchSelfCheckEvent(new CustomEvent("praxity:self-check-completion", {detail}), current);
 document.dispatchEvent(new CustomEvent("praxity:active-page-change", {detail}));`,
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const source of ["setInterval(effect, 1);", "requestIdleCallback(effect);"])
	test(`authority rejects additional scheduler ${source}`, () => {
		const result = runFixture({
			path: "packages/export-pipeline/template/src/islands/planted.ts",
			source,
		});
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /lifetime helpers/);
	});

for (const source of [
	"export function Assessment() { const current = selfCheckEpochTicket(); return null; }",
	"const Assessment = () => { const current = selfCheckEpochTicket(document); return null; };",
	"function useTicket() { return selfCheckEpochTicket(); }",
	"const useTicket = () => selfCheckEpochTicket();",
	"useMemo(() => selfCheckEpochTicket(), []);",
	"React.useCallback(() => selfCheckEpochTicket(), []);",
	"export default function () { const current = selfCheckEpochTicket(); return <div/>; }",
	"useEffect(() => { const current = selfCheckEpochTicket(); save(current); }, []);",
	"useLayoutEffect(() => selfCheckEpochTicket(document), []);",
	"function effect() { selfCheckEpochTicket(); } React.useEffect(effect, []);",
	'document.addEventListener("praxity:assessment-response", (event) => { selfCheckEpochTicket(document, event); save(selfCheckEpochTicket()); });',
	'function receive(event) { selfCheckEpochTicket(document, event); selfCheckEpochTicket(document); } document.addEventListener("praxity:block-interaction", receive);',
	"learnerRuntime(() => true)?.commit?.();",
	"learnerTracker(function () { return true; })?.checkCompletion();",
	"finishLearnerCourse(() => true);",
	'writeLearnerBlockState("a", {}, () => true);',
	"learnerRuntime(selfCheckEpochTicket());",
	'writeLearnerBlockState("a", {}, selfCheckEpochTicket());',
])
	test(`authority rejects late or fabricated ticket: ${source}`, () => {
		const result = runFixture({ path: "packages/shared-blocks/src/blocks/planted.tsx", source });
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /ticket|authority/);
	});

test("authority permits mount tickets and captured ticket variables, parameters and refs", () => {
	const result = runFixture({
		path: "packages/shared-blocks/src/blocks/planted.tsx",
		source: `
 function Assessment() { const [mount] = useState(() => selfCheckEpochTicket()); const ticket = useRef(mount);
   useEffect(() => writeLearnerBlockState("a", {}, ticket.current), []); return <div/>; }
 function gesture() { const current = selfCheckEpochTicket(); learnerRuntime(current); }
 function save(current) { learnerTracker(current); finishLearnerCourse(current); }
 function receive(event) { const current = selfCheckEpochTicket(document, event); learnerRuntime(current); }
 document.addEventListener("praxity:block-interaction", receive);`,
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const accessor of ["readWriteDistractorsContent", "writeDistractorsContent"]) {
	test(`${accessor} stays inside declared author owners`, () => {
		for (const path of [
			"packages/export-pipeline/src/planted.ts",
			"packages/export-pipeline/template/src/planted.ts",
			"packages/shared-blocks/src/planted.ts",
		]) {
			for (const source of [
				`import { ${accessor} as reveal } from "@praxity/grammar"; reveal(read,id);`,
				`import * as grammar from "@praxity/grammar"; grammar.${accessor}(read,id);`,
				`export { ${accessor} } from "@praxity/grammar";`,
			])
				assert.ok(checkSelfCheckOwners(path, source).length > 0, path);
		}
		assert.deepEqual(
			checkSelfCheckOwners(
				"packages/grammar/src/read-lesson.ts",
				`import { ${accessor} } from "./v4/schema";`,
			),
			[],
		);
	});
}

for (const path of [
	"packages/shared-blocks/src/planted.ts",
	"packages/export-pipeline/src/planted.ts",
]) {
	test(`the real schema content deep import stays author-only in ${path}`, () => {
		assert.ok(
			checkSelfCheckOwners(
				path,
				'import { writeDistractorsContent as reveal } from "@praxity/grammar/src/v4/schema.ts"; reveal(node, id);',
			).length > 0,
		);
	});
}

const distractorOwner = "packages/export-pipeline/src/write-distractors.ts";
const distractorSources = [
	"publish(course.writeDistractorsContents);",
	'page.data.content = course["writeDistractorsContents"];',
	"const { writeDistractorsContents: content } = course; publish({ data: content });",
	'page.blocks = [{ data: course["write" + "DistractorsContents"] }];',
	'import { writeDistractorsRuntimeAssets as bytes } from "./write-distractors"; log(bytes(runtime));',
	'export { writeDistractorsRuntimeAssets } from "./write-distractors";',
	'import * as owner from "./write-distractors"; log(owner.writeDistractorsRuntimeAssets(runtime));',
	'const owner = await import("./write-distractors");',
	'const owner = require("./write-distractors");',
	'export * from "./write-distractors";',
	'import { validateContent } from "learning-patterns/patterns/write-distractors/logic.js";',
	'export { validateContent } from "learning-patterns/patterns/write-distractors/logic.js";',
];
for (const source of distractorSources) {
	test(`distractor compiler owner guard rejects bypass: ${source}`, () => {
		for (const path of [
			"packages/export-pipeline/src/html-pages.ts",
			"packages/export-pipeline/template/src/patterns/planted.ts",
		])
			assert.ok(checkSelfCheckOwners(path, source).length > 0, path);
		assert.deepEqual(checkSelfCheckOwners(distractorOwner, source), []);
	});
}
for (const [name, owner] of [
	["writeDistractorsRuntimeAssets", distractorOwner],
	["writeWriteDistractorsAssets", compilerBuild],
	["captureWriteDistractorsRuntime", compilerContext],
]) {
	test(`distractor compiler owner guard restricts ${name} to its named caller`, () => {
		for (const path of [compilerBuild, compilerContext, desktopConsumer, authorConsumer]) {
			const source = `import { ${name} as content } from "./write-distractors"; log(content(runtime));`;
			assert.equal(checkSelfCheckOwners(path, source).length === 0, path === owner, path);
		}
		if (name !== "writeDistractorsRuntimeAssets")
			assert.ok(
				checkSelfCheckOwners(owner, `export { ${name} } from "./write-distractors";`).length > 0,
			);
	});
}
test("distractor compiler owner guard permits only the revision owner's library import", () => {
	const source =
		'import { validateContent } from "learning-patterns/patterns/write-distractors/logic.js";';
	assert.deepEqual(
		checkSelfCheckOwners("packages/shared-blocks/src/write-distractors-content.ts", source),
		[],
	);
	for (const path of [compilerBuild, compilerContext, distractorOwner])
		assert.equal(
			checkSelfCheckOwners(path, 'export * as content from "./write-distractors";').length,
			1,
		);
});
for (const source of [
	"publish(_writeDistractorsContent);",
	"const alias = _writeDistractorsContent; page.data = alias;",
	"log({ _writeDistractorsContent });",
])
	test(`distractor compiler owner guard rejects stripped references: ${source}`, () => {
		const strip =
			"const { selfCheckContents: _selfCheckContent, writeDistractorsContents: _writeDistractorsContent, ...promptCourse } = course;";
		assert.equal(checkSelfCheckOwners(compilerContext, `${strip} ${source}`).length, 1);
	});
test("distractor compiler owner guard rejects bytes through the real command", () => {
	const result = runFixture({
		path: "packages/export-pipeline/src/html-pages.ts",
		source:
			'import { writeDistractorsRuntimeAssets as bytes } from "./write-distractors"; log(bytes(runtime)); page.data = course.writeDistractorsContents;',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /declared author owner/);
});

const distractorRawBypasses = [
	'Reflect.get(content, "rightAnswer");',
	'Object.getOwnPropertyDescriptor(content, "misconceptions").value;',
	'publish(content["authorOptions"]);',
	"Reflect.get(content, `rightAnswer`);",
	'import { validateContent as read } from "learning-patterns/patterns/write-distractors/logic.js";',
	'import type { Content } from "learning-patterns/patterns/write-distractors/logic.js";',
	"publish(block.data.content.rightAnswer);",
	'publish(block.data.content["author" + "Options"]);',
	"const { misconceptions: labels } = block.data.content; publish(labels);",
	'const key = "rightAnswer"; publish(block.data.content[key]);',
];
for (const source of [
	'import { validateState as decode } from "learning-patterns/patterns/write-distractors/logic.js";',
	'export { validateState } from "learning-patterns/patterns/write-distractors/logic.js";',
	'import * as decoder from "learning-patterns/patterns/write-distractors/logic.js"; decoder.validateState(saved);',
	'export * from "learning-patterns/patterns/write-distractors/logic.js";',
	'import { enhance } from "learning-patterns/patterns/write-distractors/enhance.js";',
	'const decoder = await import("learning-patterns/patterns/write-distractors/enhance.js");',
]) {
	test(`distractor saved-state decoder cannot bypass Studio's codec: ${source}`, () => {
		for (const path of [
			"packages/export-pipeline/template/src/islands/write-distractors.ts",
			"packages/grammar/src/read-lesson.ts",
			distractorOwner,
		])
			assert.ok(checkSelfCheckOwners(path, source).length > 0, path);
		assert.deepEqual(
			checkSelfCheckOwners("packages/shared-blocks/src/write-distractors-content.ts", source),
			[],
		);
	});
}
test("source-owner command refuses a planted upstream distractor enhancer bypass", () => {
	const result = runFixture({
		path: "packages/export-pipeline/template/src/islands/write-distractors.ts",
		source:
			'export { enhance as decode } from "learning-patterns/patterns/write-distractors/enhance.js";',
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /write-distractors/);
});
for (const source of distractorRawBypasses) {
	test(`distractor raw Content stays with its owners: ${source}`, () => {
		for (const path of [
			"packages/export-pipeline/src/patterns/text/render.ts",
			"packages/shared-blocks/src/grammar-adapter.ts",
			"apps/desktop/src/main/export/inspect-project-v1.ts",
		])
			assert.ok(checkSelfCheckOwners(path, source).length > 0, path);
		for (const path of [
			"packages/grammar/src/read-lesson.ts",
			distractorOwner,
			"packages/shared-blocks/src/write-distractors-content.ts",
		])
			assert.deepEqual(checkSelfCheckOwners(path, source), [], path);
	});
}

test("renderer cannot import even reference APIs from the internal distractor asset owner", () => {
	for (const path of [
		"packages/export-pipeline/src/patterns/text/render.ts",
		"packages/export-pipeline/src/render-block-html.ts",
		"packages/export-pipeline/template/src/islands/planted.ts",
	])
		assert.ok(
			checkSelfCheckOwners(
				path,
				'import { writeDistractorsAssetReferences } from "../../write-distractors";',
			).length > 0,
		);
});

for (const [name, source] of [
	[
		"raw content import",
		'import type { Content } from "learning-patterns/patterns/write-distractors/logic.js";',
	],
	["direct hidden key", "publish(block.data.content.rightAnswer);"],
	[
		"internal asset import",
		'import { writeDistractorsAssetReferences } from "../../write-distractors";',
	],
]) {
	test(`source-owner command refuses planted distractor ${name}`, () => {
		const result = runFixture({
			path:
				name === "raw content import"
					? "packages/shared-blocks/src/planted.ts"
					: "packages/export-pipeline/src/patterns/text/planted.ts",
			source,
		});
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /declared author owner/);
	});
}

for (const source of [
	"JSON.stringify(course.writeDistractorsContents);",
	'Object.values(course["writeDistractorsContents"]);',
	"const { writeDistractorsContents: content } = course; publish(content);",
	"publish([...course.writeDistractorsContents]);",
])
	test(`distractor compiler channel stays private repo-wide: ${source}`, () => {
		for (const path of [
			"apps/desktop/src/main/export/other.ts",
			"packages/shared-blocks/src/narration.ts",
		])
			assert.match(
				checkSelfCheckOwners(path, source).join("\n"),
				/full write-distractors source\/content/,
			);
	});

test("desktop bridge may only merge the prepared distractor channel at its named site", () => {
	const path = "apps/desktop/src/main/export/build-export-input-from-project.ts";
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			"writeDistractorsContents.push(...prepared.writeDistractorsContents);",
		),
		[],
	);
	for (const source of [
		"publish(prepared.writeDistractorsContents);",
		"JSON.stringify(prepared.writeDistractorsContents);",
		"other.push(...prepared.writeDistractorsContents);",
	])
		assert.match(
			checkSelfCheckOwners(path, source).join("\n"),
			/full write-distractors source\/content/,
		);
});

test("source-owner command rejects the distractor channel outside export-pipeline", () => {
	const result = runFixture({
		path: "apps/desktop/src/main/export/planted.ts",
		source: "JSON.stringify(course.writeDistractorsContents);",
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /full write-distractors source\/content/);
});

test("distractor accessor violations name write-distractors", () => {
	assert.match(
		checkSelfCheckOwners(
			"packages/shared-blocks/src/planted.ts",
			'import { readWriteDistractorsContent } from "@praxity/grammar";',
		).join("\n"),
		/full write-distractors source\/content/,
	);
});

test("distractor presentation folders cannot launder compiler Content through namespace imports", () => {
	for (const module of ["./patterns/write-distractors", "./patterns/write-distractors/render"]) {
		for (const source of [
			`import * as owner from "${module}"; publish(owner);`,
			`const owner = await import("${module}");`,
		])
			assert.ok(
				checkSelfCheckOwners("packages/export-pipeline/src/html-pages.ts", source).length > 0,
			);
	}
});
test("only the named imported i18n expression can read the right-answer string key", () => {
	const path = "packages/shared-blocks/src/i18n/practice-host-strings.ts";
	assert.deepEqual(
		checkSelfCheckOwners(
			path,
			"const label = distractorStrings[resolveLocale(locale)].rightAnswer;",
		),
		[],
	);
	assert.ok(checkSelfCheckOwners(path, "const label = upstream.rightAnswer;").length > 0);
	assert.ok(
		checkSelfCheckOwners(
			"packages/export-pipeline/src/patterns/write-distractors/render.ts",
			"const label = distractorStrings[resolveLocale(locale)].rightAnswer;",
		).length > 0,
	);
});

test("workspace src imports are refused across package boundaries in every module syntax", () => {
	for (const source of [
		'import { diagnostic } from "@praxity/grammar/src/diagnostic";',
		'import type { Diagnostic } from "@praxity/grammar/src/diagnostic.ts";',
		'export { diagnostic } from "@praxity/grammar/src/diagnostic.ts";',
		'export * from "@praxity/grammar/src/diagnostic.ts";',
		'const module = import("@praxity/grammar/src/diagnostic.ts");',
		'const module = require("@praxity/grammar/src/diagnostic.ts");',
		"const module = import(`@praxity/grammar/src/diagnostic.ts`);",
		'import { diagnostic } from "@praxity/grammar/./src/diagnostic.ts";',
	]) {
		assert.match(
			checkWorkspaceSourceImports("packages/editor-core/src/planted.ts", source).join("\n"),
			/through public entries/,
		);
	}
});

test("workspace src guard permits public entries, relative internals and same-package imports", () => {
	for (const source of [
		'import { readLesson } from "@praxity/grammar";',
		'import type { PraxityBlock } from "@praxity/shared-blocks/types";',
		'import { readLesson } from "./read-lesson.ts";',
		'import { readLesson } from "@praxity/grammar/src/read-lesson.ts";',
		"const example = 'import { readLesson } from \"@praxity/other/src/private.ts\";';",
	])
		assert.deepEqual(checkWorkspaceSourceImports("packages/grammar/src/planted.ts", source), []);
});

test("workspace src legacy exceptions permit only their exact caller and specifier", () => {
	const source = 'import { normalizeLineEndings } from "@praxity/grammar/src/line-endings.ts";';
	assert.deepEqual(
		checkWorkspaceSourceImports("apps/desktop/src/shared/editor-source.ts", source),
		[],
	);
	assert.equal(
		checkWorkspaceSourceImports("packages/editor-core/src/planted.ts", source).length,
		1,
	);
	assert.equal(
		checkWorkspaceSourceImports(
			"apps/desktop/src/shared/editor-source.ts",
			source.replace("line-endings.ts", "private.ts"),
		).length,
		1,
	);
});

test("workspace src guard keeps the real advice consumer on public package entries", () => {
	const path = "packages/editor-core/src/lib/a11y/write-distractors-advice.ts";
	assert.deepEqual(checkWorkspaceSourceImports(path, readFileSync(path, "utf8")), []);
});

const nativePdfPaths = {
	input: "apps/desktop/src/main/export/build-export-input-from-project.ts",
	host: "apps/desktop/src/main/export/export-project.ts",
	renderer: "packages/format-renderers/src/pipelines/course-pdf.ts",
};
test("native PDF author-content exceptions admit only the typed handoff and lookup sites", () => {
	for (const [path, source] of [
		[
			nativePdfPaths.input,
			"function prepareCourseLesson() { return {...pdfWriteDistractorsInputs(selfChecks.writeDistractorsContents, options.includeAnswerSheet)}; }",
		],
		[
			nativePdfPaths.host,
			"function pdfRefusalMessage() { for (const [block, content] of lesson.writeDistractorsContents ?? []) inspect(content, lesson.id, block); }",
		],
		[
			nativePdfPaths.renderer,
			'function buildCoursePdfSource() { if (block.type === "writeDistractors") { if (options.includeAnswerSheet === true) { const authored = lesson.writeDistractorsContents?.get(id); const text = full.rightAnswer; const labels = full.misconceptions; const options = full.authorOptions; } } }',
		],
	])
		assert.deepEqual(checkSelfCheckOwners(path, source), [], path);
});
for (const [name, path] of Object.entries(nativePdfPaths)) {
	test(`native PDF ${name} exception rejects a neighbouring Content bypass`, () => {
		for (const source of [
			"publish(lesson.writeDistractorsContents);",
			"publish(selfChecks.writeDistractorsContents);",
			"publish(full.rightAnswer);",
			"publish(full.misconceptions);",
			"publish(full.authorOptions);",
		])
			assert.ok(checkSelfCheckOwners(path, source).length > 0, source);
	});
	test(`source-owner command refuses a planted native PDF ${name} bypass`, () => {
		const result = runFixture({ path, source: "publish(lesson.writeDistractorsContents);" });
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stderr, /write-distractors.*declared author owner/);
	});
}

test("native PDF lookup still refuses outside its exact answer-sheet branch", () => {
	for (const source of [
		"lesson.writeDistractorsContents?.get(id);",
		'function buildCoursePdfSource() { if (block.type === "writeDistractors") { lesson.writeDistractorsContents?.get(id); } }',
		'function buildCoursePdfSource() { if (block.type === "writeDistractors") { if (options.includeAnswerSheet === false) { lesson.writeDistractorsContents?.get(id); } } }',
		'function buildCoursePdfSource() { if (block.type === "writeDistractors") { if (options.includeAnswerSheet === true) {} else { lesson.writeDistractorsContents?.get(id); } } }',
	])
		assert.ok(checkSelfCheckOwners(nativePdfPaths.renderer, source).length > 0, source);
});

test("native PDF host rejects other consumers inside pdfRefusalMessage", () => {
	for (const body of [
		"String(lesson.writeDistractorsContents ?? []);",
		"message += JSON.stringify(lesson.writeDistractorsContents ?? []);",
		"for (const [block, content] of lesson.writeDistractorsContents ?? []) publish(content);",
		"for (const [block, content] of lesson.writeDistractorsContents ?? []) { inspect(content, lesson.id, block); publish(content); }",
	])
		assert.ok(
			checkSelfCheckOwners(nativePdfPaths.host, `function pdfRefusalMessage() { ${body} }`).length >
				0,
			body,
		);
});

test("native PDF renderer exception is branch-scoped, not output-flow analysis", () => {
	const source =
		'function buildCoursePdfSource() { if (block.type === "writeDistractors") { if (options.includeAnswerSheet === true) { diagnostics.push(full.rightAnswer); } } }';
	assert.deepEqual(checkSelfCheckOwners(nativePdfPaths.renderer, source), []);
});
