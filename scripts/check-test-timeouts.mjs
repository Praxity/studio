import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

const actions = new Set([
	"click",
	"dblclick",
	"fill",
	"press",
	"pressSequentially",
	"check",
	"uncheck",
	"setChecked",
	"selectOption",
	"setInputFiles",
	"hover",
	"focus",
	"tap",
	"dragTo",
	"dragAndDrop",
	"goto",
	"reload",
	"goBack",
	"goForward",
	"waitFor",
	"waitForSelector",
	"waitForURL",
	"waitForEvent",
	"waitForResponse",
	"waitForRequest",
	"waitForFunction",
	"waitForLoadState",
	"screenshot",
	"toHaveScreenshot",
	"scrollIntoViewIfNeeded",
	"selectText",
	"textContent",
	"innerText",
	"innerHTML",
	"getAttribute",
	"inputValue",
	"isChecked",
	"isEnabled",
	"isDisabled",
	"isEditable",
	"isHidden",
	"isVisible",
	"boundingBox",
	"evaluate",
	"evaluateHandle",
]);
const parse = (source, filename) =>
	ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);

function framework(filename, source) {
	const file = parse(source, filename);
	const imports = file.statements
		.filter(ts.isImportDeclaration)
		.map((node) => node.moduleSpecifier.text);
	if (imports.includes("@playwright/test")) return "playwright";
	if (imports.includes("vitest")) return "vitest";
	if (imports.includes("node:test")) return "node";
	let nodeTest = false;
	function visit(node) {
		if (
			ts.isVariableDeclaration(node) &&
			node.initializer &&
			ts.isCallExpression(node.initializer) &&
			node.initializer.expression.getText() === "require" &&
			node.initializer.arguments[0]?.text === "node:test"
		)
			nodeTest = true;
		ts.forEachChild(node, visit);
	}
	visit(file);
	if (nodeTest) return "node";
	return filename.includes(".spec.") || filename.includes("playwright") ? "playwright" : "vitest";
}

function deadlines(source, filename, defaults, configDefaults = false) {
	const file = parse(source, filename);
	const aliases = new Map();
	for (const statement of file.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!["vitest", "@playwright/test"].includes(statement.moduleSpecifier.text)
		)
			continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings && ts.isNamedImports(bindings))
			for (const binding of bindings.elements)
				aliases.set(binding.name.text, (binding.propertyName ?? binding.name).text);
	}
	const callName = (node) =>
		node.expression
			.getText()
			.replace(/\s/g, "")
			.replace(/^\w+/, (name) => aliases.get(name) ?? name);
	const testCall = (node) =>
		ts.isCallExpression(node) && /^(test|it|describe)(\.|\(|$)/.test(callName(node));
	const options = { allowJs: true, noLib: true, noResolve: true };
	const host = ts.createCompilerHost(options);
	host.getSourceFile = (path) => (path === filename ? file : undefined);
	const checker = ts.createProgram([filename], options, host).getTypeChecker();
	function constant(node) {
		const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
		return declaration && ts.isVariableDeclaration(declaration)
			? declaration.initializer
			: undefined;
	}
	function localValue(node, seen = new Set()) {
		if (!node) return undefined;
		if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
			return localValue(node.expression, seen);
		if (ts.isIdentifier(node) && !seen.has(node)) {
			const initializer = constant(node);
			if (initializer) return localValue(initializer, new Set([...seen, node]));
		}
		return node;
	}
	function numeric(node, seen = new Set(), smallest = configDefaults) {
		if (!node) return undefined;
		if (ts.isNumericLiteral(node)) return Number(node.text);
		if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
			return numeric(node.expression, seen, smallest);
		if (ts.isIdentifier(node) && !seen.has(node.text))
			return numeric(constant(node), new Set([...seen, node.text]), smallest);
		if (ts.isConditionalExpression(node)) {
			const yes = numeric(node.whenTrue, seen, smallest),
				no = numeric(node.whenFalse, seen, smallest);
			return yes === undefined || no === undefined
				? undefined
				: (smallest ? Math.min : Math.max)(yes, no);
		}
		if (ts.isBinaryExpression(node)) {
			const left = numeric(node.left, seen, smallest),
				right = numeric(node.right, seen, smallest);
			if (left === undefined || right === undefined) return undefined;
			switch (node.operatorToken.kind) {
				case ts.SyntaxKind.PlusToken:
					return left + right;
				case ts.SyntaxKind.MinusToken:
					return left - right;
				case ts.SyntaxKind.AsteriskToken:
					return left * right;
				case ts.SyntaxKind.SlashToken:
					return left / right;
			}
		}
		return undefined;
	}
	const sites = [],
		counts = new Map();
	function add(node, kind, name, value = node, slow = false, scopeNode = node) {
		const scope = [];
		for (let parent = scopeNode.parent; parent; parent = parent.parent) {
			if (testCall(parent) && ts.isStringLiteralLike(parent.arguments[0]))
				scope.unshift(parent.arguments[0].text);
		}
		const key = JSON.stringify([scope, kind, name]);
		const index = counts.get(key) ?? 0;
		counts.set(key, index + 1);
		const condition = slow ? localValue(value) : undefined;
		const amount = slow
			? value !== node && condition.kind !== ts.SyntaxKind.TrueKeyword
				? undefined
				: defaults.test * 3
			: numeric(value);
		const line = file.getLineAndCharacterOfPosition(value.getStart()).line + 1;
		const dependencies = [];
		function references(current, seen = new Set()) {
			const initializer = ts.isIdentifier(current) ? constant(current) : undefined;
			if (initializer && !seen.has(current.text)) {
				dependencies.push(file.getLineAndCharacterOfPosition(initializer.getStart()).line + 1);
				references(initializer, new Set([...seen, current.text]));
			}
			ts.forEachChild(current, (child) => references(child, seen));
		}
		references(value);
		sites.push({
			key: `${key}:${index}`,
			kind,
			amount,
			minimum: slow ? amount : numeric(value, new Set(), true),
			expression: (condition ?? value).getText(),
			line,
			dependencies,
		});
	}
	function visit(node) {
		if (ts.isCallExpression(node)) {
			const name = callName(node);
			if (/^test(?:\.info\(\))?\.setTimeout$/.test(name))
				add(node, "test", name, node.arguments[0]);
			else if (/^test(?:\.info\(\))?\.slow$/.test(name)) {
				const condition = node.arguments[0] ?? node;
				if (localValue(condition).kind !== ts.SyntaxKind.FalseKeyword)
					add(node, "test", name, condition, true);
			} else if (/^(?:page|context)\.setDefault(?:Navigation)?Timeout$/.test(name))
				add(node, name.includes("Navigation") ? "navigation" : "action", name, node.arguments[0]);
			else if (testCall(node) && !name.startsWith("describe") && node.arguments.length >= 3) {
				const last = node.arguments.at(-1);
				if (
					!ts.isArrowFunction(last) &&
					!ts.isFunctionExpression(last) &&
					!ts.isObjectLiteralExpression(localValue(last))
				)
					add(last, "test", "registration", last);
			}
			for (const argument of node.arguments) {
				const options = localValue(argument);
				if (options !== argument && options && ts.isObjectLiteralExpression(options))
					for (const property of options.properties)
						if (ts.isPropertyAssignment(property)) propertyDeadline(property, node, argument);
			}
		}
		if (ts.isPropertyAssignment(node)) propertyDeadline(node);
		ts.forEachChild(node, visit);
	}
	function propertyDeadline(node, call, scopeNode = node) {
		if (
			ts.isPropertyAssignment(node) &&
			["timeout", "testTimeout", "actionTimeout", "navigationTimeout"].includes(node.name.getText())
		) {
			if (!call) {
				call = node.parent;
				while (call && !ts.isCallExpression(call) && !ts.isSourceFile(call)) {
					if (ts.isFunctionLike(call)) return;
					call = call.parent;
				}
			}
			const name = ts.isCallExpression(call) ? callName(call) : "";
			const config =
				/(?:vitest|playwright)(?:\.workspace)?\.config\.[cm]?[jt]s$/.test(filename) ||
				/vitest\.workspace\.ts$/.test(filename);
			let kind;
			if (node.name.getText() === "testTimeout" && (config || /^vi\.setConfig$/.test(name)))
				kind = "test";
			else if (node.name.getText() === "timeout") {
				if (testCall(call)) kind = "test";
				else if (/^expect(?:\.|\()/.test(name)) kind = "expect";
				else if (actions.has(name.match(/\.([A-Za-z]+)$/)?.[1]))
					kind = ["goto", "reload", "goBack", "goForward", "waitForURL"].includes(
						name.match(/\.([A-Za-z]+)$/)?.[1],
					)
						? "navigation"
						: "action";
				else if (config && filename.includes("playwright")) {
					kind =
						ts.isPropertyAssignment(node.parent.parent) &&
						node.parent.parent.name.getText() === "expect"
							? "expect"
							: "test";
				}
			} else if ((config && filename.includes("playwright")) || name === "test.use")
				kind = node.name.getText() === "navigationTimeout" ? "navigation" : "action";
			if (kind) {
				const parents = [];
				for (let parent = node.parent; parent; parent = parent.parent)
					if (ts.isPropertyAssignment(parent)) parents.unshift(parent.name.getText());
				add(
					node,
					kind,
					testCall(call) ? "registration" : `${name}:${parents.join(".")}:${node.name.getText()}`,
					node.initializer,
					false,
					scopeNode,
				);
			}
		}
	}
	visit(file);
	return sites;
}

export function timeoutRaises(before, after, filename, defaults = {}, changedLines) {
	if (
		!/(?:\.(?:test|spec)\.[cm]?[jt]sx?$|(?:vitest|playwright).*\.[cm]?[jt]s$|(?:tests?|e2e)\/.*\.[cm]?[jt]sx?$)/.test(
			filename,
		)
	)
		return [];
	const runner = framework(filename, after);
	if (runner === "node") return [];
	defaults = {
		test: runner === "playwright" ? 30000 : 5000,
		expect: 5000,
		action: 0,
		navigation: 0,
		...defaults,
	};
	const previous = new Map(deadlines(before, filename, defaults).map((site) => [site.key, site]));
	const evidence = new Set();
	function evidenceReference(comment) {
		const reference = comment.match(/^\/\/\s*timeout:\s*(\S+)/)?.[1];
		if (!reference) return false;
		if (/^https?:\/\//i.test(reference)) {
			try {
				const url = new URL(reference);
				return (
					/^https?:\/\/[^/\\?#]+\//i.test(reference) && !!url.hostname && /[^/]/.test(url.pathname)
				);
			} catch {
				return false;
			}
		}
		return (
			!reference.includes("://") && /(?:^|[/\\])[^/\\]+\.(?:log|md|json|txt|html)$/i.test(reference)
		);
	}
	// Match per line: a bare token scanner loses its place after regex or template literals
	// (it can't tell `/` division from a regex without the parser) and skipped real comments.
	after.split("\n").forEach((text, index) => {
		const comment = text.match(/\/\/\s*timeout:.*$/)?.[0];
		if (comment && evidenceReference(comment)) evidence.add(index + 1);
	});
	const unlimited = (amount) => (amount === 0 ? Infinity : amount);
	return deadlines(after, filename, defaults)
		.filter((site) => {
			const old = previous.get(site.key);
			if (old?.expression === site.expression && old.amount === site.amount) return false;
			if (changedLines && !changedLines.has(site.line)) {
				const dependency = site.dependencies.find((line) => changedLines.has(line));
				if (!dependency) return false;
				site.line = dependency;
			}
			const prior = old?.amount ?? defaults[site.kind];
			const raises =
				site.amount === undefined ||
				unlimited(site.amount) > unlimited(prior) ||
				unlimited(site.minimum) > unlimited(old?.minimum ?? defaults[site.kind]);
			return raises && !evidence.has(site.line);
		})
		.map((site) => ({ filename, line: site.line, kind: site.kind }));
}

export function checkTimeoutChanges(root, base = "origin/main", head) {
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
	const ancestor = git("merge-base", base, head ?? "HEAD").trim();
	const paths = git(
		"diff",
		"--name-only",
		"--no-renames",
		"-z",
		ancestor,
		...(head ? [head] : []),
		"--",
	)
		.split("\0")
		.filter(Boolean);
	if (!head)
		paths.push(
			...git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean),
		);
	const tracked = new Set(git("ls-tree", "-r", "--name-only", "-z", ancestor).split("\0"));
	const headPaths = head
		? new Set(git("ls-tree", "-r", "--name-only", "-z", head).split("\0"))
		: undefined;
	const read = (path, revision) =>
		revision ? git("show", `${revision}:${path}`) : readFileSync(resolve(root, path), "utf8");
	const has = (path, revision) =>
		revision
			? (revision === ancestor ? tracked : headPaths).has(path)
			: existsSync(resolve(root, path));
	function defaults(path, source) {
		const playwright = framework(path, source) === "playwright";
		for (
			let dir = dirname(path).replaceAll("\\", "/");
			;
			dir = dirname(dir).replaceAll("\\", "/")
		) {
			const config = `${dir === "." ? "" : `${dir}/`}${playwright ? "playwright" : "vitest"}.config.ts`;
			if (has(config, ancestor)) {
				const initial = { test: playwright ? 30000 : 5000, expect: 5000, action: 0, navigation: 0 };
				for (const site of deadlines(read(config, ancestor), config, initial, true))
					if (site.amount !== undefined) initial[site.kind] = site.amount;
				return initial;
			}
			if (dir === ".") return {};
		}
	}
	const errors = [];
	for (const path of new Set(paths)) {
		if (!/\.[cm]?[jt]sx?$/.test(path) || !has(path, head)) continue;
		const before = tracked.has(path) ? read(path, ancestor) : "";
		const after = read(path, head);
		const diff = git(
			"diff",
			"--unified=0",
			"--no-ext-diff",
			ancestor,
			...(head ? [head] : []),
			"--",
			path,
		);
		const changed = new Set();
		for (const match of diff.matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm)) {
			const start = Number(match[1]),
				count = Number(match[2] ?? 1);
			for (let line = start; line < start + count; line++) changed.add(line);
		}
		if (!diff && !tracked.has(path))
			for (let line = 1; line <= after.split("\n").length; line++) changed.add(line);
		errors.push(...timeoutRaises(before, after, path, defaults(path, after), changed));
	}
	return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const { values } = parseArgs({ options: { base: { type: "string", default: "origin/main" } } });
		const errors = checkTimeoutChanges(process.cwd(), values.base);
		for (const error of errors)
			console.error(
				`${error.filename}:${error.line}: timeout raise needs // timeout: <log, run URL or report path>`,
			);
		process.exitCode = errors.length ? 1 : 0;
	} catch (error) {
		console.error(`Timeout check failed: ${error.message}`);
		process.exitCode = 1;
	}
}
