import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function assertEsmBundlePaths(source, filename = "index.js") {
	filename = filename.replaceAll("\\", "/");
	const options = { allowJs: true, noLib: true, noResolve: true };
	const host = ts.createCompilerHost(options);
	host.getSourceFile = (path) =>
		path === filename
			? // TS binding avoids the implicit CommonJS module/exports symbols in JS files.
				ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
			: undefined;
	const program = ts.createProgram([filename], options, host);
	const checker = program.getTypeChecker();
	const errors = [];
	function visit(node) {
		if (
			ts.isIdentifier(node) &&
			["__dirname", "__filename", "require", "module", "exports"].includes(node.text)
		) {
			const parent = node.parent;
			const nonValueName =
				(parent.name === node &&
					(ts.isPropertyAccessExpression(parent) ||
						ts.isPropertyAssignment(parent) ||
						ts.isMethodDeclaration(parent) ||
						ts.isGetAccessorDeclaration(parent) ||
						ts.isSetAccessorDeclaration(parent))) ||
				(ts.isBindingElement(parent) && parent.propertyName === node) ||
				parent.label === node;
			if (!nonValueName) {
				const symbol =
					ts.isShorthandPropertyAssignment(parent) && parent.name === node
						? checker.getShorthandAssignmentValueSymbol(parent)
						: checker.getSymbolAtLocation(node);
				if (!symbol) {
					const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
					errors.push(`${filename}:${line + 1}: unbound ${node.text}`);
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(program.getSourceFile(filename));
	if (errors.length) throw new Error(errors.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const filename = resolve(process.argv[2] ?? "dist/main/index.js");
	assertEsmBundlePaths(await readFile(filename, "utf8"), filename);
}
