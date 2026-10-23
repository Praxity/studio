import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkTimeoutChanges, timeoutRaises } from "./check-test-timeouts.mjs";

const filename = "tests/example.test.ts";
const raised = (before, after, options) => timeoutRaises(before, after, filename, options);

test("raises need a same-line evidence reference; lowering and unchanged pass", () => {
	const before = 'test("example", () => {}, 5000);';
	assert.equal(raised(before, 'test("example", () => {}, 15000);').length, 1);
	assert.deepEqual(
		raised(before, 'test("example", () => {}, 15000); // timeout: logs/failed.log'),
		[],
	);
	assert.equal(raised(before, 'test("example", () => {}, 15000); // timeout: slow').length, 1);
	assert.equal(
		raised(before, '// timeout: logs/failed.log\ntest("example", () => {}, 15000);').length,
		1,
	);
	assert.deepEqual(raised(before, 'test("example", () => {}, 3000);'), []);
	assert.deepEqual(raised(before, before), []);
	assert.deepEqual(
		raised('test("example", () => {}, 90000);', 'test("example", { timeout: 60000 }, () => {});'),
		[],
	);
});

test("detects Vitest options, config, arithmetic and new deadlines above the default", () => {
	for (const source of [
		'test("example", { timeout: 15_000 }, () => {});',
		'it.only("example", async () => {}, 3 * 5000);',
		"vi.setConfig({ testTimeout: 15000 });",
	])
		assert.equal(raised("", source).length, 1, source);
	assert.equal(
		timeoutRaises("", "export default { test: { testTimeout: 15000 } };", "vitest.config.ts")
			.length,
		1,
	);
	assert.deepEqual(raised("", 'test("example", () => {}, 5000);'), []);
	assert.deepEqual(raised("", 'test("example", () => {}, 15000);', { test: 30000 }), []);
	assert.equal(
		raised("", 'const deadline = 15000; test("example", () => {}, deadline);').length,
		1,
	);
	assert.equal(
		raised(
			"",
			'import { test as spec, vi as mock } from "vitest"; spec("example", () => {}, 15000); mock.setConfig({ testTimeout: 15000 });',
		).length,
		2,
	);
	assert.equal(
		timeoutRaises(
			"export default { test: { testTimeout: native ? 60000 : 5000 } };",
			"export default { test: { testTimeout: native ? 60000 : 15000 } };",
			"vitest.config.ts",
		).length,
		1,
	);
	assert.deepEqual(
		timeoutRaises(
			"export default { test: { testTimeout: native ? 60000 : 15000 } };",
			"export default { test: { testTimeout: native ? 60000 : 5000 } };",
			"vitest.config.ts",
		),
		[],
	);
});

test("detects Playwright test, expectation, action deadlines and slow", () => {
	for (const source of [
		"test.setTimeout(90000);",
		"test.slow();",
		"test.info().slow();",
		"await expect(page).toHaveTitle('Example', { timeout: 15000 });",
		"await expect.poll(() => value, { timeout: 15000 }).toBe(1);",
	])
		assert.equal(timeoutRaises("", source, "tests/example.spec.ts").length, 1, source);
	assert.equal(
		timeoutRaises(
			"await page.click('a', { timeout: 1000 });",
			"await page.click('a', { timeout: 15000 });",
			"tests/example.spec.ts",
		).length,
		1,
	);
	assert.deepEqual(
		timeoutRaises("", "await page.click('a', { timeout: 15000 });", "tests/example.spec.ts"),
		[],
	);
	assert.equal(
		timeoutRaises("test.setTimeout(5000);", "test.setTimeout(0);", "tests/example.spec.ts").length,
		1,
	);
	assert.equal(
		timeoutRaises(
			"",
			"export default { timeout: 90000, expect: { timeout: 15000 } };",
			"playwright.config.ts",
		).length,
		2,
	);
});

test("ignores unrelated numbers, timeout properties, strings and comments", () => {
	assert.deepEqual(
		raised(
			"",
			`
const count = 90000;
const options = { timeout: 90000 };
fetch('/api', { timeout: 90000 });
const example = "test.setTimeout(90000)";
// test.slow();
`,
		),
		[],
	);
	assert.deepEqual(timeoutRaises("", "const testTimeout = 90000;", "src/service.ts"), []);
	assert.deepEqual(
		raised("", 'import test from "node:test"; test("example", { timeout: 10000 }, () => {});'),
		[],
	);
	assert.equal(
		timeoutRaises(
			"",
			'import { test } from "vitest"; test("example", () => {}, 10000);',
			"example.spec.ts",
		).length,
		1,
	);
});

test("multiline changes point to the timeout line, and moved unchanged deadlines pass", () => {
	const before = 'test("example", {\n timeout: 15000\n}, () => {});';
	assert.deepEqual(raised(before, `// moved\n${before}`), []);
	assert.deepEqual(
		raised(
			before,
			'test("example", {\n timeout: 20000, // timeout: reports/failed.md\n}, () => {});',
		),
		[],
	);
	assert.equal(raised(before, 'test("example", {\n timeout: 20000\n}, () => {});')[0].line, 2);
});

test("a changed local constant needs evidence on its changed line", () => {
	const before = 'const deadline = 5000;\ntest("example", () => {}, deadline);';
	const after = 'const deadline = 15000;\ntest("example", () => {}, deadline);';
	assert.equal(timeoutRaises(before, after, filename, {}, new Set([1])).length, 1);
	assert.deepEqual(
		timeoutRaises(
			before,
			after.replace("15000;", "15000; // timeout: reports/failure.md"),
			filename,
			{},
			new Set([1]),
		),
		[],
	);
});

test("same-named constants in another test cannot hide a timeout raise", () => {
	const before =
		'test("one", () => { const deadline = 5000; test.setTimeout(deadline); });\ntest("two", () => { const deadline = 5000; test.setTimeout(deadline); });';
	const after = before.replace("deadline = 5000", "deadline = 15000");
	assert.deepEqual(timeoutRaises(before, after, filename, {}, new Set([1])), [
		{ filename, line: 1, kind: "test" },
	]);
});

test("shared local options use their changed initializer and preserve lowering/evidence", () => {
	for (const [call, kind] of [
		['test("shared", options, () => {});', "test"],
		['expect(page).toHaveTitle("X", options);', "expect"],
		['page.click("a", options);', "action"],
		['page.goto("/", options);', "navigation"],
		["vi.setConfig(options);", "test"],
	]) {
		const property = call.startsWith("vi.") ? "testTimeout" : "timeout";
		const before = `const original = {\n ${property}: 5000\n};\nconst options = original;\n${call}`;
		const after = before.replace("5000", "15000");
		assert.deepEqual(timeoutRaises(before, after, filename, {}, new Set([2])), [
			{ filename, line: 2, kind },
		]);
		assert.deepEqual(timeoutRaises(after, before, filename, {}, new Set([2])), []);
		assert.deepEqual(
			timeoutRaises(
				before,
				after.replace("15000", "15000 // timeout: reports/failed.md"),
				filename,
				{},
				new Set([2]),
			),
			[],
		);
	}
	assert.deepEqual(raised("", "const options = options; test('cycle', options, () => {});"), []);
});

test("Playwright default setters and test.use detect raises, lowering and unlimited", () => {
	const file = "example.spec.ts";
	for (const [source, kind] of [
		["page.setDefaultTimeout(5000);", "action"],
		["context.setDefaultTimeout(5000);", "action"],
		["page.setDefaultNavigationTimeout(5000);", "navigation"],
		["context.setDefaultNavigationTimeout(5000);", "navigation"],
		["test.use({ actionTimeout: 5000 });", "action"],
		["test.use({ navigationTimeout: 5000 });", "navigation"],
	]) {
		const after = source.replace("5000", "15000");
		assert.deepEqual(timeoutRaises(source, after, file), [{ filename: file, line: 1, kind }]);
		assert.deepEqual(timeoutRaises(after, source, file), []);
		assert.equal(timeoutRaises(source, source.replace("5000", "0"), file).length, 1);
		assert.deepEqual(timeoutRaises(source.replace("5000", "0"), after, file), []);
		assert.deepEqual(timeoutRaises(source, `${after} // timeout: failed.log`, file), []);
	}
	assert.equal(
		timeoutRaises("", "const options = { actionTimeout: 15000 }; test.use(options);", file, {
			action: 5000,
		}).length,
		1,
	);
});

test("conditional slow omits false and requires evidence for changed unknown conditions", () => {
	const file = "example.spec.ts";
	const before = 'test.slow(false, "condition");';
	assert.deepEqual(timeoutRaises("", before, file), []);
	assert.equal(timeoutRaises(before, before.replace("false", "true"), file).length, 1);
	assert.equal(timeoutRaises(before, before.replace("false", "enabled"), file).length, 1);
	assert.equal(timeoutRaises("test.slow(first);", "test.slow(second);", file).length, 1);
	assert.deepEqual(timeoutRaises("test.slow(enabled);", "test.slow(enabled);", file), []);
	assert.deepEqual(timeoutRaises(before, "test.slow(enabled); // timeout: slow.log", file), []);
	assert.equal(
		timeoutRaises(
			"const enabled = false;\ntest.slow(enabled);",
			"const enabled = unknown;\ntest.slow(enabled);",
			file,
			{},
			new Set([1]),
		).length,
		1,
	);
	assert.deepEqual(timeoutRaises("", "const enabled = false; test.slow(enabled);", file), []);
	assert.equal(timeoutRaises("", "const enabled = true; test.slow(enabled);", file).length, 1);
	assert.equal(timeoutRaises("", "test.slow(enabled());", file).length, 1);
	assert.equal(timeoutRaises("test.slow(true);", "test.slow(enabled());", file).length, 1);
	assert.equal(
		timeoutRaises(
			"const enabled = first;\ntest.slow(enabled);",
			"const enabled = second;\ntest.slow(enabled);",
			file,
			{},
			new Set([1]),
		).length,
		1,
	);
});

test("evidence identifies a log/report basename or an HTTP run with host and path", () => {
	const before = 'test("example", () => {}, 5000);';
	for (const evidence of [
		"/",
		"\\",
		"foo/bar",
		".log",
		"reports/.md",
		"https:///",
		"https:///run",
		"https://example.com",
		"https://example.com/",
		"ftp://example.com/run",
		"https://example.com/report.log",
		"failed.log/extra",
	]) {
		// A report URL is valid; every other planted reference lacks the required form.
		const expected = evidence === "https://example.com/report.log" ? 0 : 1;
		assert.equal(
			raised(before, `test("example", () => {}, 15000); // timeout: ${evidence}`).length,
			expected,
			evidence,
		);
	}
	for (const evidence of [
		"failed.log",
		"reports/failed.md",
		"logs\\failed.txt",
		"report.json",
		"report.html",
		"https://github.com/example/studio/actions/runs/123",
	]) {
		assert.deepEqual(
			raised(before, `test("example", () => {}, 15000); // timeout: ${evidence}`),
			[],
			evidence,
		);
	}
});

test("CommonJS Node test bindings are excluded alongside ESM imports", () => {
	for (const binding of [
		'const test = require("node:test");',
		'const { test } = require("node:test");',
	]) {
		const before = `${binding} test("node", { timeout: 5000 }, () => {});`;
		assert.deepEqual(
			timeoutRaises(before, before.replace("5000", "15000"), "example.test.cjs"),
			[],
		);
	}
});

test("CLI uses the merge base, includes uncommitted/new files and reads config defaults", (t) => {
	const root = mkdtempSync(join(tmpdir(), "timeout-guard-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	git("init", "-b", "main");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.invalid");
	writeFileSync(
		join(root, "vitest.config.ts"),
		"export default { test: { testTimeout: native ? 60000 : 10000 } };",
	);
	mkdirSync(join(root, "pw"));
	writeFileSync(
		join(root, "pw/playwright.config.ts"),
		"export default { use: { actionTimeout: 10000, navigationTimeout: 60000 } };",
	);
	writeFileSync(join(root, "example.test.ts"), 'test("example", () => {}, 10000);');
	git("add", ".");
	git("commit", "-m", "base");
	git("branch", "base");
	git("checkout", "-b", "feature");
	writeFileSync(join(root, "example.test.ts"), 'test("example", () => {}, 15000);');
	git("add", ".");
	git("commit", "-m", "raise");
	git("checkout", "base");
	writeFileSync(join(root, "example.test.ts"), 'test("example", () => {}, 20000);');
	git("add", ".");
	git("commit", "-m", "base advances");
	git("checkout", "feature");
	assert.equal(checkTimeoutChanges(root, "base").length, 1);
	const script = resolve(import.meta.dirname, "check-test-timeouts.mjs");
	const result = spawnSync(process.execPath, [script, "--base", "base"], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /example.test.ts:1/);
	writeFileSync(
		join(root, "example.test.ts"),
		'test("example", () => {}, 15000); // timeout: reports/failure.md',
	);
	mkdirSync(join(root, "new"));
	writeFileSync(join(root, "new/small.test.ts"), 'test("new", () => {}, 9000);');
	assert.deepEqual(checkTimeoutChanges(root, "base"), []);
	writeFileSync(join(root, "new/conditional.test.ts"), 'test("conditional", () => {}, 15000);');
	assert.deepEqual(checkTimeoutChanges(root, "base"), [
		{ filename: "new/conditional.test.ts", line: 1, kind: "test" },
	]);
	writeFileSync(
		join(root, "new/conditional.test.ts"),
		'test("conditional", () => {}, 15000); // timeout: reports/failure.md',
	);
	writeFileSync(
		join(root, "pw/action.spec.ts"),
		"await page.click('a', { timeout: 15000 });\nawait page.goto('/example', { timeout: 30000 });",
	);
	assert.deepEqual(checkTimeoutChanges(root, "base"), [
		{ filename: "pw/action.spec.ts", line: 1, kind: "action" },
	]);
});

test("evidence after regex and template literals is still found", () => {
	const prefix = "const re = /a\\/b/g;\nconst t = `x ${1} y`;\n";
	const before = `${prefix}test("example", () => {}, 5000);`;
	const raise = `${prefix}test("example", () => {}, 15000);`;
	assert.deepEqual(
		raised(before, `${raise} // timeout: https://github.com/o/r/actions/runs/1`),
		[],
	);
	assert.equal(raised(before, raise).length, 1);
});
