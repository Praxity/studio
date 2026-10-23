import assert from "node:assert/strict";
import test from "node:test";
import { assertEsmBundlePaths } from "./check-bundle-paths.mjs";

test("checks Windows bundle paths through the CLI's absolute-path interface", () => {
	assert.throws(
		() => assertEsmBundlePaths('require("fs");', "C" + ":\\build\\index.js"),
		/unbound require/,
	);
});

test("rejects unbound CommonJS runtime globals in ESM", () => {
	for (const source of [
		'require("node:fs");',
		"module.exports = {};",
		"exports.answer = 42;",
		"const globals = { require, module, exports };",
		"function dependency(require) { return require; } require('fs');",
	])
		assert.throws(() => assertEsmBundlePaths(source), /unbound (require|module|exports)/);
});

test("accepts createRequire shims, local bindings and CommonJS property names", () => {
	for (const source of [
		'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); require("node:fs");',
		"function dependency(require, module, exports) { require('fs'); module.exports = exports; }",
		"const module = {}; const exports = {}; const require = () => {}; const globals = { module, exports, require };",
		"obj.require(); obj.module; obj.exports;",
		"const obj = { require: 1, module: 2, exports() {} };",
		"const { require: loader, module: mod, exports: values } = obj;",
	])
		assert.doesNotThrow(() => assertEsmBundlePaths(source));
});

test("rejects unshimmed CommonJS paths in the main ESM bundle", () => {
	assert.throws(
		() => assertEsmBundlePaths('loadFile(__dirname + "/index.html");'),
		/unbound __dirname/,
	);
	assert.throws(() => assertEsmBundlePaths("console.log(__filename);"), /unbound __filename/);
	assert.throws(
		() =>
			assertEsmBundlePaths("function dependency(__dirname) { return __dirname; } load(__dirname);"),
		/unbound __dirname/,
	);
});

test("accepts ESM paths and locally shimmed dependency paths", () => {
	assert.doesNotThrow(() => assertEsmBundlePaths("loadFile(import.meta.dirname);"));
	assert.doesNotThrow(() =>
		assertEsmBundlePaths("const __dirname = import.meta.dirname; loadFile(__dirname);"),
	);
	assert.doesNotThrow(() =>
		assertEsmBundlePaths(
			'function dependency(__filename) { return __filename; } // __dirname\n"__dirname";',
		),
	);
});

test("rejects an unbound __dirname shorthand value", () => {
	assert.throws(() => assertEsmBundlePaths("const paths = { __dirname };"), /unbound __dirname/);
});

test("rejects an unbound __filename shorthand value", () => {
	assert.throws(() => assertEsmBundlePaths("const paths = { __filename };"), /unbound __filename/);
});

test("accepts property names and bound shorthand values", () => {
	for (const source of [
		"console.log(globalThis.__dirname);",
		"console.log(obj.__filename);",
		"console.log(obj?.__dirname);",
		"console.log(import.meta.__dirname);",
		"const paths = { __dirname: 1, __filename: 2 };",
		"const paths = { __dirname() {}, get __filename() { return 1; } };",
		"const { __dirname: directory, __filename: filename } = obj;",
		"__dirname: for (;;) { break __dirname; }",
		"const __dirname = import.meta.dirname; const paths = { __dirname };",
		"const __filename = import.meta.filename; const paths = { __filename };",
	]) {
		assert.doesNotThrow(() => assertEsmBundlePaths(source));
	}
});

test("rejects unbound computed property names and property values", () => {
	assert.throws(
		() => assertEsmBundlePaths("const paths = { [__dirname]: 1 };"),
		/unbound __dirname/,
	);
	assert.throws(() => assertEsmBundlePaths("console.log(obj[__filename]);"), /unbound __filename/);
	assert.throws(
		() => assertEsmBundlePaths("const paths = { path: __dirname };"),
		/unbound __dirname/,
	);
	assert.throws(
		() => assertEsmBundlePaths("let path; ({ path = __dirname } = obj);"),
		/unbound __dirname/,
	);
});
