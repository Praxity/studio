import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owner = "packages/grammar/src/operations/contract.ts";
const operations = [
	resolve(root, "packages/grammar/src/operations"),
	resolve(root, "packages/operations/src"),
];
const names = new Set(["OperationRequest", "OperationResult", "OperationRefusal"]);

function isSentence(value: string): boolean {
	return /[\p{L}][.!?:,]?\s+[\p{L}]|[\p{L}][.!?](?:\s|$)/u.test(value);
}

function parse(path: string, source: string): ts.SourceFile {
	return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
}

function declarations(path: string, text: string): string[] {
	// Escaped identifiers need parsing even when their decoded names are absent.
	if (![...names].some((name) => text.includes(name)) && !text.includes("\\u")) return [];
	const found: string[] = [];
	function visit(node: ts.Node): void {
		if (
			(ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
			names.has(node.name.text)
		) {
			found.push(node.name.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(parse(path, text));
	return found;
}

function sentences(source: ts.Node): string[] {
	const found: string[] = [];
	function visit(node: ts.Node): void {
		// Comments document the contract; string and template values can reach callers.
		if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
			const keyPrefix =
				ts.isTemplateHead(node) &&
				ts.isTemplateLiteralTypeNode(node.parent) &&
				/^[a-z][\w-]*\.$/.test(node.text);
			if (!keyPrefix && isSentence(node.text)) found.push(node.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return found;
}

describe("operation contract ownership", () => {
	it("declares the three public types only in their owner across the repository", async () => {
		const listed = execFileSync(
			"git",
			["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
			{
				cwd: root,
				encoding: "utf8",
			},
		)
			.split("\0")
			.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
		const paths = [...new Set(listed)];
		const found: string[] = [];
		for (let index = 0; index < paths.length; index += 64) {
			const sources = await Promise.all(
				paths.slice(index, index + 64).map(async (path) => ({
					path,
					source: await readFile(resolve(root, path), "utf8"),
				})),
			);
			for (const { path, source } of sources) {
				for (const name of declarations(path, source)) found.push(`${path}:${name}`);
			}
		}
		expect(found.sort()).toEqual([...names].map((name) => `${owner}:${name}`).sort());
	});

	it("keeps user-facing sentences out of operations", async () => {
		const violations: string[] = [];
		const entries = await Promise.all(
			operations.map((directory) => readdir(directory, { recursive: true, withFileTypes: true })),
		);
		const sources = await Promise.all(
			entries
				.flat()
				.filter((entry) => entry.isFile())
				.map(async (entry) => {
					const path = resolve(entry.parentPath, entry.name);
					return { path, source: await readFile(path, "utf8") };
				}),
		);
		for (const { path, source } of sources) {
			const values = /\.[cm]?[jt]sx?$/.test(path) ? sentences(parse(path, source)) : [source];
			for (const value of values) {
				if (isSentence(value)) {
					violations.push(`${relative(root, path)}:${value}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("detects aliases and nested declarations without flagging imports", () => {
		expect(
			declarations("probe.ts", 'import type { OperationRequest } from "./contract.ts";'),
		).toEqual([]);
		expect(
			declarations(
				"probe.ts",
				"export type OperationRequest = {}; declare namespace Other { interface OperationRefusal {} }",
			),
		).toEqual(["OperationRequest", "OperationRefusal"]);
	});

	it("detects escaped contract names and ignores unrelated declarations", () => {
		expect(declarations("probe.ts", "export type Ordinary = {};")).toEqual([]);
		expect(declarations("probe.ts", "export type \\u004fperationResult = {};")).toEqual([
			"OperationResult",
		]);
		expect(declarations("probe.ts", "interface Oper\\u{61}tionRequest {}")).toEqual([
			"OperationRequest",
		]);
	});

	it("detects sentence literals and interpolated messages, allowing keys and comments", () => {
		expect(
			sentences(
				parse(
					"probe.ts",
					'// Explains why it exists.\nconst key = "op.moved"; type Key = `op.${string}`;',
				),
			),
		).toEqual([]);
		expect(sentences(parse("probe.ts", 'const message = "Nothing was applied.";'))).toEqual([
			"Nothing was applied.",
		]);
		expect(sentences(parse("probe.ts", 'const message = "Saved.";'))).toEqual(["Saved."]);
		expect(sentences(parse("probe.ts", "const message = `Cannot undo ${name}`;"))).toEqual([
			"Cannot undo ",
		]);
	});
});
