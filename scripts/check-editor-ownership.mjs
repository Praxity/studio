import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const newEditor =
	/^(?:packages\/editor-core\/src\/(?:frame-bridge|session|editing)\/|packages\/editor-core\/src\/components\/LiveRegion\.tsx$|apps\/desktop\/src\/renderer\/editing\/)/;
const trustEditor = /^packages\/editor-core\/src\/(?:frame-bridge|shortcuts|session)\//;
const trustAttribute = /\b(?:data-praxity-[\w-]+|data-focus-role|data-node-id)\b/i;
const trustDataset = /^(?:praxity.*|focusRole|nodeId)$/;
const inputEvent =
	/^(?:key(?:down|up|press)|pointer\w+|(?:got|lost)pointercapture|mouse\w+|click|dblclick|auxclick|contextmenu|wheel|drag\w*|drop|touch\w+|focus\w*|blur|message|messageerror|cancel)$/;

function member(node) {
	if (ts.isPropertyAccessExpression(node)) return node.name.text;
	if (
		ts.isElementAccessExpression(node) &&
		node.argumentExpression &&
		ts.isStringLiteralLike(node.argumentExpression)
	)
		return node.argumentExpression.text;
	return null;
}
export function checkEditorSource(path, source) {
	if ((!newEditor.test(path) && !trustEditor.test(path)) || /\.(?:test|spec)\./.test(path))
		return [];
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const failures = [];
	const fail = (node, rule) =>
		failures.push(
			`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${rule}`,
		);
	const liveOwner = path === "packages/editor-core/src/components/LiveRegion.tsx";
	const escapeOwner = path === "packages/editor-core/src/frame-bridge/escape.ts";
	const trust = trustEditor.test(path);
	const listenerOwner = path === "packages/editor-core/src/frame-bridge/listeners.ts";
	const registryOwner = path === "packages/editor-core/src/frame-bridge/page-lens.ts";
	// Indirect names fail closed. Following local identifiers without a type
	// checker would miss reassignment and shadowing, allowing marker reads back in.
	const literal = (node) => (node && ts.isStringLiteralLike(node) ? node.text : null);
	function visit(node) {
		const binding = ts.isBindingElement(node)
			? (node.propertyName ?? node.name).getText(file).replace(/["']/g, "")
			: null;
		if (trust && !listenerOwner) {
			const name = member(node);
			if (name === "addEventListener") {
				const call = node.parent;
				const event =
					ts.isCallExpression(call) && call.expression === node ? literal(call.arguments[0]) : null;
				if (event === null || inputEvent.test(event))
					fail(node, "T1: register input and message listeners through frame-bridge/listeners.ts");
			}
			if (name?.startsWith("on") && inputEvent.test(name.slice(2)))
				fail(node, "T1: register input and message listeners through frame-bridge/listeners.ts");
			if (binding === "addEventListener")
				fail(node, "T1: register input and message listeners through frame-bridge/listeners.ts");
		}
		if (trust && !registryOwner) {
			const selectors = ["getAttribute", "closest", "querySelector", "querySelectorAll"];
			if (selectors.includes(member(node))) {
				const call = node.parent;
				const value =
					ts.isCallExpression(call) && call.expression === node ? literal(call.arguments[0]) : null;
				if (value === null || trustAttribute.test(value))
					fail(node, "T2: resolve trust markers through the page-lens WeakSet registry");
			}
			if (binding === "dataset" || selectors.includes(binding))
				fail(node, "T2: resolve trust markers through the page-lens WeakSet registry");
			if (member(node) === "dataset") {
				const parent = node.parent;
				const key =
					(ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
					parent.expression === node
						? member(parent)
						: null;
				if (key === null || trustDataset.test(key))
					fail(node, "T2: resolve trust markers through the page-lens WeakSet registry");
			}
		}
		// Keep M2/A1's original scope; T1/T2 also cover shortcuts and course-map.
		if (!newEditor.test(path)) {
			ts.forEachChild(node, visit);
			return;
		}
		if (ts.isStringLiteralLike(node)) {
			if (!escapeOwner && ["Escape", "Esc"].includes(node.text))
				fail(node, "M2: route cancellation through frame-bridge/escape.ts");
			if (
				!liveOwner &&
				/<[^>]*\b(?:aria-live\s*=|role\s*=\s*["'](?:status|alert)["'])/.test(node.text)
			)
				fail(node, "A1: use LiveRegion.tsx");
		}
		if (!liveOwner) {
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isPropertyAccessExpression(node.left)
			) {
				const name = node.left.name.text;
				if (
					name === "ariaLive" ||
					(name === "role" &&
						ts.isStringLiteralLike(node.right) &&
						["status", "alert"].includes(node.right.text))
				)
					fail(node, "A1: use LiveRegion.tsx");
			}
			if (
				ts.isJsxAttribute(node) &&
				(node.name.getText(file) === "aria-live" ||
					(node.name.getText(file) === "role" &&
						node.initializer &&
						/["'](?:status|alert)["']/.test(node.initializer.getText(file))))
			)
				fail(node, "A1: use LiveRegion.tsx");
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "setAttribute"
			) {
				const [name, value] = node.arguments;
				if (
					name &&
					ts.isStringLiteralLike(name) &&
					(name.text === "aria-live" ||
						(name.text === "role" &&
							value &&
							ts.isStringLiteralLike(value) &&
							["status", "alert"].includes(value.text)))
				)
					fail(node, "A1: use LiveRegion.tsx");
			}
			if (ts.isPropertyAssignment(node)) {
				const name = node.name.getText(file).replace(/["']/g, "");
				if (
					name === "aria-live" ||
					(name === "role" &&
						ts.isStringLiteralLike(node.initializer) &&
						["status", "alert"].includes(node.initializer.text))
				)
					fail(node, "A1: use LiveRegion.tsx");
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const files = execFileSync(
		"git",
		["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
		{ encoding: "utf8" },
	)
		.split("\0")
		.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
	const failures = [...new Set(files)].flatMap((path) =>
		checkEditorSource(path, readFileSync(path, "utf8")),
	);
	for (const failure of failures) console.error(failure);
	if (failures.length) process.exitCode = 1;
	else console.log("Editor ownership checks passed.");
}
