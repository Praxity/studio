import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { viewerSourceFiles } from "../bundle-viewer";

// Only statements executed on the branch count: a callback, nested condition or
// unawaited promise cannot stand in for an assertion of the no-palette rendering.
function unassertedBranches(source: string, requireBranch = false): number {
	const file = ts.createSourceFile("spec.ts", source, ts.ScriptTarget.Latest, true);
	let missing = 0;
	let noPaletteBranches = 0;
	type Bindings = Map<string, ts.Expression>;
	function values(node: ts.Expression, palette: boolean, bindings: Bindings): boolean[] {
		if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
			return values(node.expression, palette, bindings);
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === "forcedPalette"
		)
			return [palette];
		if (ts.isIdentifier(node) && bindings.has(node.text)) {
			const next = new Map(bindings);
			const initializer = next.get(node.text);
			next.delete(node.text);
			if (initializer) return values(initializer, palette, next);
		}
		if (node.kind === ts.SyntaxKind.TrueKeyword) return [true];
		if (node.kind === ts.SyntaxKind.FalseKeyword) return [false];
		if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken)
			return values(node.operand, palette, bindings).map((value) => !value);
		if (ts.isBinaryExpression(node)) {
			const operator = node.operatorToken.kind;
			if (
				operator === ts.SyntaxKind.AmpersandAmpersandToken ||
				operator === ts.SyntaxKind.BarBarToken
			)
				return [
					...new Set(
						values(node.left, palette, bindings).flatMap((left) =>
							values(node.right, palette, bindings).map((right) =>
								operator === ts.SyntaxKind.AmpersandAmpersandToken ? left && right : left || right,
							),
						),
					),
				];
		}
		return [false, true];
	}
	function asserted(branch: ts.Statement | undefined): boolean {
		if (!branch) return false;
		const statements = ts.isBlock(branch) ? branch.statements : [branch];
		for (const statement of statements) {
			if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return false;
			if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression))
				continue;
			const call = statement.expression.expression;
			if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
			if (call.expression.text === "expectForcedEmulationInert") return true;
			// expectFocusRing's normal-palette path owns the >=3:1 floor. A literal
			// true third argument selects forced-palette behavior instead.
			if (
				call.expression.text === "expectFocusRing" &&
				call.arguments.length >= 2 &&
				ts.isNumericLiteral(call.arguments[1]) &&
				Number(call.arguments[1].text) >= 2 &&
				(!call.arguments[2] || call.arguments[2].kind === ts.SyntaxKind.FalseKeyword)
			)
				return true;
		}
		return false;
	}
	function visit(node: ts.Node, inherited: Bindings) {
		const bindings = new Map(inherited);
		if (ts.isBlock(node) || ts.isSourceFile(node)) {
			for (const statement of node.statements) {
				if (ts.isVariableStatement(statement)) {
					for (const declaration of statement.declarationList.declarations)
						if (ts.isIdentifier(declaration.name) && declaration.initializer)
							bindings.set(declaration.name.text, declaration.initializer);
				}
				visit(statement, bindings);
			}
			return;
		}
		if (ts.isIfStatement(node)) {
			const absent = values(node.expression, false, bindings);
			const present = values(node.expression, true, bindings);
			for (const [truth, branch] of [
				[true, node.thenStatement],
				[false, node.elseStatement],
			] as const)
				if (absent.includes(truth) && !present.includes(truth)) {
					noPaletteBranches += 1;
					if (!asserted(branch)) missing += 1;
				}
		}
		ts.forEachChild(node, (child) => visit(child, bindings));
	}
	visit(file, new Map());
	return missing + Number(requireBranch && noPaletteBranches === 0);
}

// These journeys assert the same semantics, geometry or visible indicator in both
// palettes. New emulating specs require a palette branch unless reviewed here.
const PALETTE_INDEPENDENT_SPECS = new Map([
	[
		"deck/highlight-acceptance.spec.ts",
		"Optional Chromium-only forced-color screenshots after tests",
	],
	["a11y/highlight-enhance.spec.ts", "Checked content reflow and axe; optional screenshots only"],
	[
		"a11y/assessment-choice-preview.spec.ts",
		"Submitted state and review contrast in either palette",
	],
	["a11y/continue-gate.spec.ts", "Blocked activation, visible reason and reflow"],
	["a11y/module-navigation.spec.ts", "Drawer navigation, focus delivery and reflow"],
	["a11y/outline-regressions.spec.ts", "Independent prefers-contrast more supplies the 3px ring"],
	["a11y/sequential-pins.spec.ts", "Visible numbered pins and a solid focus outline"],
	["a11y/standalone-outcome.spec.ts", "Outcome word and nonempty icon stroke"],
	["deck/dont-know-private.spec.ts", "State, focus delivery, reflow and axe"],
	["deck/module-deck.spec.ts", "Existing forced-palette assertion runs in Chromium only"],
	["deck/self-check-island.spec.ts", "Visible focus outline in either palette"],
	[
		"deck/self-check-release.spec.ts",
		"Same reflow, interaction and contrast checks in either palette",
	],
]);

function emulatesForcedColors(source: string): boolean {
	// Include named/indirect media objects conservatively, not only inline options.
	if (!/\bforcedColors\b/.test(source)) return false;
	const file = ts.createSourceFile("spec.ts", source, ts.ScriptTarget.Latest, true);
	let emulates = false;
	function visit(node: ts.Node) {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === "emulateMedia"
		)
			emulates = true;
		ts.forEachChild(node, visit);
	}
	visit(file);
	return emulates;
}

function assertPaletteCoverage(source: string, spec: string): void {
	expect(
		unassertedBranches(source, !PALETTE_INDEPENDENT_SPECS.has(spec)),
		`${spec}: missing no-palette rendering branch or awaited assertion`,
	).toBe(0);
}

describe("unsupported forced-color coverage", () => {
	it("discovers every published spec that emulates forced colors", async () => {
		const tests = path.resolve(import.meta.dirname, "../../tests");
		const filenames = execFileSync("git", ["ls-files", "-z", "--", "."], {
			cwd: tests,
			encoding: "utf8",
		})
			.split("\0")
			.filter((filename) => filename.endsWith(".spec.ts"));
		const discovered = [];
		for (const spec of filenames) {
			const source = await readFile(path.join(tests, spec), "utf8");
			if (!emulatesForcedColors(source)) continue;
			discovered.push(spec);
			assertPaletteCoverage(source, spec);
		}
		for (const spec of [
			"a11y/sidebar-feedback-visibility.spec.ts",
			"a11y/highlight-baseline.spec.ts",
			"a11y/highlight-enhance.spec.ts",
		])
			expect(discovered).toContain(spec);
		for (const spec of PALETTE_INDEPENDENT_SPECS.keys()) expect(discovered).toContain(spec);
	});

	it.each([
		'await page.emulateMedia({ forcedColors: "active" });',
		"await page.emulateMedia({ forcedColors });",
		'const media = { forcedColors: "active" }; await page.emulateMedia(media);',
	])("discovers and rejects an unbranched new spec: %s", (source) => {
		expect(emulatesForcedColors(source)).toBe(true);
		expect(() => assertPaletteCoverage(source, "a11y/new-forced.spec.ts")).toThrow(
			"missing no-palette rendering branch",
		);
	});

	it("rejects an imported, commented or unused palette check without a branch", () => {
		for (const source of [
			'import { forcedPalette } from "../focus-assertions";',
			"// if (!(await forcedPalette(page))) { await expectForcedEmulationInert(page, [target]); }",
			"await forcedPalette(page);",
		])
			expect(() => assertPaletteCoverage(source, "a11y/new-forced.spec.ts")).toThrow();
	});

	it("ignores print-only emulation", () => {
		expect(emulatesForcedColors('await page.emulateMedia({ media: "print" });')).toBe(false);
	});

	it("rejects a no-palette branch with no assertion", () => {
		expect(
			unassertedBranches(
				"if (!(await forcedPalette(page))) {} else { await expectFocusRing(target, 3); }",
			),
		).toBe(1);
		expect(
			unassertedBranches(
				"if (!(await forcedPalette(page))) { await expectForcedEmulationInert(page, [target]); }",
			),
		).toBe(0);
	});
	it.each([
		"if (!(await forcedPalette(page))) { const unused = () => expectForcedEmulationInert(page, [target]); }",
		"if (!(await forcedPalette(page))) { expectForcedEmulationInert(page, [target]); }",
		"if (await forcedPalette(page)) { await expectFocusRing(target, 3); } else {}",
		"const palette = await forcedPalette(page); if (!palette) {}",
		"const palette = await forcedPalette(page); if (palette) {} else {}",
	])("rejects a branch without an executed, awaited assertion: %s", (source) => {
		expect(unassertedBranches(source)).toBe(1);
	});
	it.each([
		"if (await forcedPalette(page)) {} else { await expectForcedEmulationInert(page, [target]); }",
		"if (!(await forcedPalette(page))) { await expectFocusRing(target, 2); }",
		"const palette = await forcedPalette(page); if (!palette) { await expectForcedEmulationInert(page, [target]); }",
		"const palette = await forcedPalette(page); if (palette) {} else { await expectFocusRing(target, 3); }",
	])("accepts a direct assertion on the no-palette path: %s", (source) => {
		expect(unassertedBranches(source)).toBe(0);
	});

	it.each([
		"if (!(await forcedPalette(page))) { return; await expectForcedEmulationInert(page, [target]); }",
		"if (!(await forcedPalette(page))) { if (false) await expectForcedEmulationInert(page, [target]); }",
		"if (!(await forcedPalette(page))) { await expectFocusRing(target, 2, true); }",
	])("rejects an unreachable or forced-only assertion: %s", (source) => {
		expect(unassertedBranches(source)).toBe(1);
	});
});

const PALETTE_OWNERS = new Set([
	"packages/shared-blocks/src/forced-palette.ts",
	"packages/export-pipeline/src/slide-artwork-css.ts",
]);
const REVIEW_CLIENT = "packages/export-pipeline/template/review-comments.js";

function unexpectedForcedColors(source: string, filename: string): boolean {
	if (PALETTE_OWNERS.has(filename)) return false;
	// One explicit exception: this observer query invalidates marker geometry.
	// It never reads matches or chooses palette-specific rendering. Remove only
	// that one literal, so any additional reference still fails ownership.
	if (filename === REVIEW_CLIENT)
		source = source.replace(/^\s*"\(forced-colors: active\)",\r?$/m, "");
	// Join adjacent quoted fragments to catch the reviewed split-literal query.
	return /forced-colors/i.test(source.replace(/["'`]\s*\+\s*["'`]/g, ""));
}

function isRuntimeTs(filename: string): boolean {
	return (
		/\.tsx?$/.test(filename) &&
		!/(?:^|\/)(?:__tests__|tests|fixtures)\/|\.(?:test|spec|stories)\./.test(filename)
	);
}

function trackedRuntimeSources(root: string): string[] {
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--",
			"packages/export-pipeline/src",
			"packages/shared-blocks/src",
			"packages/grammar/src",
			"packages/content-model/src",
			"packages/export-pipeline/template/src",
		],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter(isRuntimeTs);
}

function assertRuntimeSourcesCovered(scanned: string[], inputs: string[]): void {
	const included = new Set(scanned);
	expect(
		inputs.filter((input) => !included.has(input)),
		"Published runtime inputs missing from text scan",
	).toEqual([]);
}

describe("published forced-color runtime ownership", () => {
	it("keeps feature references in their owners across all tracked runtime TS", async () => {
		const root = path.resolve(import.meta.dirname, "../../../..");
		const sources = trackedRuntimeSources(root);
		for (const owner of ["html-gen.ts", "export-css.ts", "build.ts"])
			expect(sources).toContain(`packages/export-pipeline/src/${owner}`);
		for (const filename of [...sources, REVIEW_CLIENT]) {
			const source = await readFile(path.join(root, filename), "utf-8");
			expect(unexpectedForcedColors(source, filename), filename).toBe(false);
		}
	});

	it("covers the bundler's complete runtime source inventory", async () => {
		const root = path.resolve(import.meta.dirname, "../../../..");
		// bundle-viewer.test.ts checks this inventory against every bundle's metafile.
		const inputs = (await viewerSourceFiles())
			.map((filename) => path.relative(root, filename).replaceAll("\\", "/"))
			.filter(isRuntimeTs);
		const sources = trackedRuntimeSources(root);
		assertRuntimeSourcesCovered(sources, inputs);
	});

	it.each(["packages/grammar/src/", "packages/content-model/src/"])(
		"rejects an inventory missing the bundled folder %s",
		async (folder) => {
			const root = path.resolve(import.meta.dirname, "../../../..");
			const inputs = (await viewerSourceFiles())
				.map((filename) => path.relative(root, filename).replaceAll("\\", "/"))
				.filter(isRuntimeTs);
			expect(inputs.some((filename) => filename.startsWith(folder))).toBe(true);
			expect(() =>
				assertRuntimeSourcesCovered(
					trackedRuntimeSources(root).filter((filename) => !filename.startsWith(folder)),
					inputs,
				),
			).toThrow("Published runtime inputs missing from text scan");
		},
	);

	it.each([
		'matchMedia("(forced-colors: active)").matches;',
		'const Q = "(forced-colors: active)"; matchMedia(Q).matches;',
		'matchMedia("(forced-" + "colors: active)").matches;',
		'const state = "active"; matchMedia(`(forced-colors: ${state})`).matches;',
		'window.matchMedia.call(window, "(forced-colors: active)");',
		'const mm = window.matchMedia.bind(window); mm("(forced-colors: active)");',
		'window.matchMedia?.("(FORCED-COLORS: active)");',
		'const BRAND_CSS = "@media (forced-colors) { a { color: Highlight; } }";',
	])("rejects feature text outside its owners: %s", (source) => {
		expect(unexpectedForcedColors(source, "packages/export-pipeline/src/html-gen.ts")).toBe(true);
	});

	it("allows exactly the two TS owners and one layout-observer literal", () => {
		const source = 'matchMedia("(forced-colors: active)");';
		for (const owner of PALETTE_OWNERS) expect(unexpectedForcedColors(source, owner)).toBe(false);
		expect(unexpectedForcedColors('matchMedia("(prefers-contrast: more)");', "other.ts")).toBe(
			false,
		);
		const observer = 'var queries = new Set([\n"(forced-colors: active)",\n]);';
		expect(unexpectedForcedColors(observer, REVIEW_CLIENT)).toBe(false);
		expect(unexpectedForcedColors(observer + "\n" + observer, REVIEW_CLIENT)).toBe(true);
		expect(unexpectedForcedColors(source, REVIEW_CLIENT)).toBe(true);
		expect(unexpectedForcedColors(source + source, REVIEW_CLIENT)).toBe(true);
		expect(unexpectedForcedColors('const Q = "(forced-colors)";', REVIEW_CLIENT)).toBe(true);
	});
});
