import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const grammar = fileURLToPath(new URL("../", import.meta.url));
const forbidden = ["@praxity/content-identity", "@praxity/operations"];

function imports(source: ts.Node): string[] {
	const found: string[] = [];
	function visit(node: ts.Node): void {
		let specifier: ts.Node | undefined;
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			specifier = node.moduleSpecifier;
		} else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
			specifier = node.argument.literal;
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		) {
			specifier = node.moduleReference.expression;
		} else if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require"))
		) {
			specifier = node.arguments[0];
		}
		if (specifier && ts.isStringLiteralLike(specifier)) found.push(specifier.text);
		ts.forEachChild(node, visit);
	}
	visit(source);
	return found;
}

it("keeps grammar independent of identity and operation runtime packages", () => {
	const violations: string[] = [];
	for (const directory of ["src", "__tests__"]) {
		for (const entry of readdirSync(resolve(grammar, directory), {
			recursive: true,
			withFileTypes: true,
		})) {
			if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
			const path = resolve(entry.parentPath, entry.name);
			const source = ts.createSourceFile(
				path,
				readFileSync(path, "utf8"),
				ts.ScriptTarget.Latest,
				true,
			);
			for (const specifier of imports(source)) {
				if (forbidden.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
					violations.push(`${path}:${specifier}`);
				}
			}
		}
	}
	const manifest = JSON.parse(readFileSync(resolve(grammar, "package.json"), "utf8"));
	for (const section of [
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	])
		for (const name of forbidden)
			if (name in (manifest[section] ?? {})) violations.push(`package.json:${section}:${name}`);
	expect(violations).toEqual([]);
});
