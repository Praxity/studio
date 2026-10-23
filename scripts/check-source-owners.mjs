import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
// Exact legacy caller/import pairs from abaf1f3f; remove each pair when its owner migrates.
import legacyWorkspaceSourceImports from "./workspace-source-imports-legacy.json" with {
	type: "json",
};

// Exceptions name an expression, not a whole file. New detection still fails.
export const sourceOwnerAllowlist = [
	...[
		String.raw`/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu`,
		String.raw`/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu`,
	].map((expression) => ({
		path: "apps/desktop/src/main/comments-cli.ts",
		expression,
		reason:
			"Comment output escapes invisible characters, including BOM, for agent transcripts. It never detects or parses Prax source.",
	})),
	{
		path: "apps/desktop/src/main/init-course.ts",
		expression: 'original.startsWith("\\uFEFF")',
		reason:
			"Init preserves the optional BOM of VS Code JSONC settings. It never reads or parses Prax source.",
	},
	...[
		'node.text.includes("---")',
		'node.text === "# "',
		'node.text.includes("\\uFEFF")',
		"Number(node.text) === 65279",
		"/---|\\^#\\\\s|\\\\u(?:FEFF|feff)|\\\\u\\{(?:FEFF|feff)\\}|\\uFEFF/",
		"/---|\\^#\\\\s|\\\\u(?:FEFF|feff)|\\uFEFF/",
	].map((expression) => ({
		path: "scripts/check-source-owners.mjs",
		expression,
		reason:
			"The ownership lint recognizes detection expressions in program ASTs; it does not parse authored Prax source.",
	})),
	{
		path: "packages/editor-core/src/components/extensions/focus-mode-extension.ts",
		expression: "/^---(?:\\s+.+)?$/",
		reason:
			"Legacy ProseMirror focus dimming only classifies display lines; it neither edits bytes nor supplies page positions. Retire with the legacy source editor.",
	},
	{
		path: "packages/editor-core/src/components/extensions/desktop-grammar-decoration-extension.ts",
		expression: 'trimmed === "---"',
		reason:
			"Legacy source decorations recognize metadata and divider display lines; page badges use reader spans. Retire with the legacy source editor.",
	},
	{
		path: "packages/editor-core/src/components/extensions/grammar-highlight-extension.ts",
		expression: 'trimmed === "---"',
		reason:
			"Legacy ProseMirror metadata folding uses paragraph positions, not source offsets, and performs no save. Retire with the legacy source editor.",
	},
	{
		path: "packages/editor-core/src/components/extensions/grammar-highlight-extension.ts",
		expression: "/^\\s*---\\s*$/",
		reason:
			"Legacy ProseMirror metadata folding uses paragraph positions, not source offsets, and performs no save. Retire with the legacy source editor.",
	},
	{
		path: "apps/desktop/src/main/telemetry-utils.ts",
		expression: "/^#\\s+.+/gm",
		reason:
			"Telemetry uses this estimate only if the grammar reader throws. It may count fenced examples and never supplies editor positions or saved data. Replace when telemetry gains a reader-failure metric.",
	},
	{
		path: "packages/shared-blocks/src/narration.ts",
		expression: "/^\\uFEFF/u",
		reason:
			"This detects the optional WebVTT BOM for caption admission, not Prax source. Caption parsing belongs to the narration owner.",
	},
	{
		path: "packages/content-identity/src/canonical.ts",
		expression: "/[\\p{White_Space}\\uFEFF]+/gu",
		reason:
			"Identity canonicalization treats embedded BOMs as Unicode whitespace for fingerprints; it does not detect a source prefix or change authored bytes.",
	},
	{
		path: "packages/shared-blocks/src/self-check-state.ts",
		expression: "/[\\p{White_Space}\\uFEFF]+/gu",
		reason:
			"Only the self-check response question display collapses whitespace and BOMs; the comparison revision hashes exact Content. This does not parse Prax source.",
	},
];

// Raw self-check access is for author owners. Owners receiving explicit Content
// need no raw-source exemption; generic output utilities stay prompt-only.
export const selfCheckAuthorOwners = [
	"packages/grammar/src/",
	"packages/content-identity/src/",
	"packages/content-identity/scripts/",
	"packages/operations/src/",
	"packages/editor-core/src/session/",
	"packages/editor-core/src/frame-bridge/",
	"packages/editor-core/src/components/",
	// Source checker advice returns only rule codes and source locations.
	"packages/editor-core/src/lib/a11y/self-check-advice.ts",
	"packages/editor-core/src/lib/a11y/retrieval-sheet-advice.ts",
	"packages/editor-core/src/lib/a11y/highlight-advice.ts",
	"packages/editor-core/src/lib/a11y/write-distractors-advice.ts",
	"apps/desktop/src/main/identity-store.ts",
	"apps/desktop/src/main/lesson-source.ts",
	"apps/desktop/src/main/operations/",
	// Author inspection drafts project full container source with the identity owner.
	"apps/desktop/src/main/studio/preview-scheduler.ts",
	// Review retains exact authored revisions locally, alongside identity snapshots.
	// The author-only snapshot owner prepares and validates source and node ranges.
	"apps/desktop/src/shared/editor-session.ts",
	// This source-aware host gives author advice about explicit narration duplication.
	"apps/desktop/src/shared/self-check-narration-advice.ts",
];
const testPath = /(?:^|\/)(?:__tests__|tests|e2e|fixtures|test-utils)(?:\/|$)|\.(?:test|spec)\./;

// Test-like names inside pattern roots are not an enforcement exemption: these
// files can also be explicit browser entry points. Literal data is not code.
const patternRoots = [
	"packages/export-pipeline/src/patterns/",
	"packages/export-pipeline/template/src/patterns/",
];
const patternPath = (path) => patternRoots.some((root) => path.startsWith(root));
const exemptTestPath = (path) => !patternPath(path) && testPath.test(path);

// No raw scheduler exceptions: mount disposal and domain guards supplement the lifetime helpers.
export const learnerAuthorityDirectories = [
	"packages/export-pipeline/template/src/",
	"packages/shared-blocks/src/",
	"packages/grammar/src/",
	"packages/content-model/src/",
	"packages/export-pipeline/src/",
];

/** New cross-package consumers use public entries. Exact legacy pairs remain until migrated. */
export function checkWorkspaceSourceImports(path, source) {
	const owner = path.match(/^(?:packages|apps)\/([^/]+)\//u)?.[1];
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
	const failures = [];
	function visit(node) {
		const specifier =
			ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
				? node.moduleSpecifier
				: ts.isCallExpression(node) &&
						(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
							(ts.isIdentifier(node.expression) && node.expression.text === "require"))
					? node.arguments[0]
					: undefined;
		if (specifier && ts.isStringLiteralLike(specifier)) {
			const target = specifier.text.match(/^@praxity\/([^/]+)\/(?:\.\/)*src\//u)?.[1];
			if (
				target &&
				target !== owner &&
				!legacyWorkspaceSourceImports[path]?.includes(specifier.text)
			) {
				const line = file.getLineAndCharacterOfPosition(specifier.getStart(file)).line + 1;
				failures.push(
					`${path}:${line}: import workspace packages through public entries, not ${specifier.text}`,
				);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

export function scansLearnerAuthority(path, directories = learnerAuthorityDirectories) {
	return !exemptTestPath(path) && directories.some((directory) => path.startsWith(directory));
}

// These events have no learner-state effects. New events require dispatch authority by default.
const uiOnlyLearnerEvents = {
	"praxity:active-page-change": "Current-page display and playback pause",
	"praxity:visibility-change": "Visibility display refresh",
	"praxity:runtime-ready": "Host admission notification",
	"praxity:self-check-owner": "Lifetime invalidation notification",
	"praxity:islands-ready": "Bootstrap display readiness",
	"praxity:islands-failed": "Bootstrap unavailable display",
	"praxity:focus-mode-change": "Focus preference display",
	"praxity:focus-page-content": "Navigation focus cue",
	"praxity:narration-reveal": "Narration display reveal",
	"praxity:narration-manual-navigation": "Playback follow preference",
	"praxity:assessment-response-truncated": "Content-free reporting notice with its own ticket",
};
const writeCapableLearnerEvents = new Set([
	"praxity:assessment-response",
	"praxity:assessment-group-complete",
	"praxity:block-interaction",
	"praxity:self-check-completion",
	"praxity:card-playthrough",
]);

export function checkLearnerAuthority(path, file, literal, checker) {
	if (!scansLearnerAuthority(path)) return [];
	const host = path.startsWith("packages/export-pipeline/template/src/hosts/");
	const owner = path === "packages/shared-blocks/src/learner-block-state.ts";
	const failures = [],
		functions = new Map(),
		aliases = new Map(),
		scheduledFunctions = new Set();
	const rawGlobals = new Set(["__praxityRuntime", "__praxityTracker", "__praxityFinishCourse"]);
	const scheduled = new Set([
		"then",
		"catch",
		"finally",
		"setTimeout",
		"setInterval",
		"requestAnimationFrame",
		"requestIdleCallback",
		"ResizeObserver",
		"MutationObserver",
		"IntersectionObserver",
		"requestSelfCheckFrame",
		"setSelfCheckTimeout",
		"createSelfCheckResizeObserver",
		"createSelfCheckMutationObserver",
		"createSelfCheckIntersectionObserver",
		"observeSelfCheckLifetime",
		"useEffect",
		"useLayoutEffect",
		"useMemo",
		"useCallback",
	]);
	const name = (node) =>
		!node
			? undefined
			: ts.isIdentifier(node)
				? node.text
				: ts.isStringLiteralLike(node)
					? node.text
					: ts.isPropertyAccessExpression(node)
						? node.name.text
						: ts.isElementAccessExpression(node)
							? literal(node.argumentExpression)
							: ts.isBindingElement(node) && node.propertyName
								? ts.isComputedPropertyName(node.propertyName)
									? literal(node.propertyName.expression)
									: literal(node.propertyName)
								: undefined;
	const functionNode = (node) =>
		node &&
		(ts.isFunctionDeclaration(node) ||
			ts.isFunctionExpression(node) ||
			ts.isArrowFunction(node) ||
			ts.isMethodDeclaration(node));
	function component(fn) {
		const label = fn.name ?? (ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined);
		if (label && ts.isIdentifier(label) && /^(?:[A-Z]|use[A-Z])/.test(label.text)) return true;
		let jsx = false;
		function visit(node) {
			if (node !== fn && functionNode(node)) return;
			if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
				jsx = true;
			ts.forEachChild(node, visit);
		}
		visit(fn);
		return jsx;
	}
	function ticketVariable(node) {
		if (!node) return false;
		if (ts.isIdentifier(node)) return true;
		if (
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isNonNullExpression(node)
		)
			return ticketVariable(node.expression);
		return ts.isPropertyAccessExpression(node) && ticketVariable(node.expression);
	}
	function operation(node, seen = new Set()) {
		if (!node) return undefined;
		const symbol = checker?.getSymbolAtLocation(node);
		if (symbol?.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol).name;
		const text = name(node);
		if (!seen.has(text) && aliases.has(text)) {
			seen.add(text);
			return operation(aliases.get(text), seen);
		}
		return text;
	}
	function resolveFunction(node) {
		if (functionNode(node)) return node;
		const declaration = node && checker?.getSymbolAtLocation(node)?.valueDeclaration;
		if (declaration?.getSourceFile() === file) {
			if (functionNode(declaration)) return declaration;
			if (declaration.initializer && functionNode(declaration.initializer))
				return declaration.initializer;
		}
		return node && ts.isIdentifier(node) ? functions.get(node.text) : undefined;
	}
	const fail = (node, reason) =>
		failures.push(
			`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${reason}: ${node.getText(file)}`,
		);
	function collect(node) {
		if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer &&
			functionNode(node.initializer)
		)
			functions.set(node.name.text, node.initializer);
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.initializer &&
			!functionNode(node.initializer)
		)
			aliases.set(node.name.text, node.initializer);
		if (ts.isImportSpecifier(node) && node.propertyName)
			aliases.set(node.name.text, node.propertyName);
		ts.forEachChild(node, collect);
	}
	collect(file);
	function eventInitializer(node, seen = new Set()) {
		if (!node || !ts.isIdentifier(node)) return node;
		if (seen.has(node)) return undefined;
		seen.add(node);
		const declaration = checker?.getSymbolAtLocation(node)?.valueDeclaration;
		if (checker) {
			if (
				!declaration ||
				declaration.getSourceFile() !== file ||
				!ts.isVariableDeclaration(declaration) ||
				!(declaration.parent.flags & ts.NodeFlags.Const)
			)
				return undefined;
			return eventInitializer(declaration.initializer, seen);
		}
		return eventInitializer(aliases.get(node.text), seen);
	}
	function callbacks(node) {
		if (
			(ts.isCallExpression(node) || ts.isNewExpression(node)) &&
			scheduled.has(operation(node.expression))
		)
			for (const argument of node.arguments ?? []) {
				const fn = resolveFunction(argument);
				if (fn) scheduledFunctions.add(fn);
			}
		ts.forEachChild(node, callbacks);
	}
	callbacks(file);
	function stamped(handler) {
		handler = resolveFunction(handler);
		if (!handler || !functionNode(handler)) return false;
		const event = handler.parameters[0]?.name;
		if (!event || !ts.isIdentifier(event)) return false;
		let found = false;
		function visit(node) {
			if (node !== handler && functionNode(node)) return;
			if (ts.isCallExpression(node) && operation(node.expression) === "selfCheckEpochTicket") {
				if (
					node.arguments[1] &&
					ts.isIdentifier(node.arguments[1]) &&
					node.arguments[1].text === event.text
				)
					found = true;
				else fail(node, "learner-event tickets must use the listener's event stamp");
			}
			ts.forEachChild(node, visit);
		}
		visit(handler);
		return found;
	}
	function visit(node) {
		if (patternPath(path) && writeCapableLearnerEvents.has(literal(node)))
			fail(node, "pattern write-capable learner event strings belong to captured-authority owners");
		if (!host && !owner && rawGlobals.has(name(node)))
			fail(
				node,
				"learner host access requires learnerRuntime, learnerTracker or finishLearnerCourse with captured authority",
			);
		if (ts.isNewExpression(node)) {
			const event = literal(node.arguments?.[0]);
			if (
				patternPath(path) &&
				["Event", "CustomEvent"].includes(operation(node.expression)) &&
				event === undefined
			)
				fail(
					node,
					"pattern dispatch has an unresolved learner event name; use captured-authority accessors",
				);
			const dynamic =
				node.arguments?.[0] &&
				ts.isTemplateExpression(node.arguments[0]) &&
				node.arguments[0].head.text.startsWith("praxity:");
			if (
				(event?.startsWith("praxity:") || dynamic) &&
				!Object.hasOwn(uiOnlyLearnerEvents, event) &&
				!(
					ts.isCallExpression(node.parent) &&
					operation(node.parent.expression) === "dispatchSelfCheckEvent"
				)
			)
				fail(node, "learner events require dispatchSelfCheckEvent with captured authority");
		}
		if (ts.isCallExpression(node)) {
			const method = operation(node.expression);
			const receiver =
				ts.isPropertyAccessExpression(node.expression) ||
				ts.isElementAccessExpression(node.expression)
					? node.expression.expression
					: undefined;
			const indirectDispatch =
				["call", "apply", "bind"].includes(method) && operation(receiver) === "dispatchEvent";
			if (
				patternPath(path) &&
				method === "construct" &&
				operation(receiver) === "Reflect" &&
				["Event", "CustomEvent"].includes(operation(node.arguments[0]))
			)
				fail(
					node,
					"pattern Reflect.construct of event constructors requires captured-authority accessors",
				);
			if (patternPath(path) && (method === "dispatchEvent" || indirectDispatch)) {
				const argument = indirectDispatch ? node.arguments[1] : node.arguments[0];
				const event = eventInitializer(
					method === "apply" && argument && ts.isArrayLiteralExpression(argument)
						? argument.elements[0]
						: argument,
				);
				if (
					!event ||
					!ts.isNewExpression(event) ||
					!["Event", "CustomEvent"].includes(operation(event.expression)) ||
					literal(event.arguments?.[0]) === undefined
				)
					fail(
						node,
						"pattern dispatch has an unresolved learner event name; use captured-authority accessors",
					);
			}
			const ticketIndex =
				method === "writeLearnerBlockState"
					? 2
					: ["learnerRuntime", "learnerTracker", "finishLearnerCourse"].includes(method)
						? 0
						: undefined;
			if (ticketIndex !== undefined && !ticketVariable(node.arguments[ticketIndex]))
				fail(node, "learner writes require a captured ticket variable or parameter");
			if (["addEventListener", "on"].includes(method)) {
				const eventIndex = node.arguments.findIndex((arg) =>
					writeCapableLearnerEvents.has(literal(arg)),
				);
				if (eventIndex >= 0 && !stamped(node.arguments[eventIndex + 1]))
					fail(node, "learner-event listeners require selfCheckEpochTicket(document, event)");
			}
			if (
				method === "selfCheckEpochTicket" &&
				(node.arguments.length < 2 ||
					(ts.isIdentifier(node.arguments[1]) && node.arguments[1].text === "undefined"))
			) {
				let enclosing = node.parent;
				while (enclosing && !functionNode(enclosing)) enclosing = enclosing.parent;
				if (enclosing) {
					if (component(enclosing))
						fail(node, "React render must inherit a mount or handler ticket");
					let afterAwait = false;
					function awaits(part) {
						if (part !== enclosing && functionNode(part)) return;
						if (
							(ts.isAwaitExpression(part) || (ts.isForOfStatement(part) && part.awaitModifier)) &&
							part.getStart(file) < node.getStart(file)
						)
							afterAwait = true;
						ts.forEachChild(part, awaits);
					}
					awaits(enclosing);
					if (afterAwait) fail(node, "deferred work must inherit its cause's ticket after await");
				}
				for (let parent = node.parent; parent; parent = parent.parent) {
					if (functionNode(parent)) {
						if (scheduledFunctions.has(parent))
							fail(node, "scheduled callbacks must inherit their cause's ticket");
						break;
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

// These callbacks retain their own guards; other raw uses still fail.
const learnerSchedulerExceptions = [
	{
		path: "packages/shared-blocks/src/viewer/NarrationBar.tsx",
		expression: "window.requestIdleCallback",
		reason: "Metadata next() checks its lifetime current() and cancelled flag before work.",
	},
	{
		path: "packages/shared-blocks/src/blocks/video-player/use-youtube-player.ts",
		expression: "setInterval",
		reason:
			"The YouTube poll checks destroyed, playerRef and readyRef before UI-only time updates.",
	},
];
export function checkLifetimeOwners(path, source, program) {
	path = path.replaceAll("\\", "/");
	if (exemptTestPath(path)) return [];
	const consumers =
		path.startsWith("packages/export-pipeline/template/src/islands/") ||
		// Pattern enhancers retain the same lifetime rules when moved out of template/src.
		patternPath(path) ||
		path.startsWith("packages/shared-blocks/src/viewer/") ||
		path === "packages/shared-blocks/src/logic/dom-logic-runtime.ts";
	const file =
		program?.getSourceFile(resolve(path)) ??
		ts.createSourceFile(
			path,
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.getScriptKindFromFileName(path),
		);
	const raw = new Set([
		"ResizeObserver",
		"MutationObserver",
		"IntersectionObserver",
		"requestAnimationFrame",
		"setTimeout",
		"setInterval",
		"requestIdleCallback",
	]);
	const constants = new Map();
	const failures = [];
	function literal(node) {
		if (!node) return undefined;
		if (
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isNonNullExpression(node) ||
			ts.isSatisfiesExpression(node)
		)
			return literal(node.expression);
		if (ts.isStringLiteralLike(node)) return node.text;
		if (ts.isIdentifier(node)) return constants.get(node.text);
		if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
			const left = literal(node.left),
				right = literal(node.right);
			if (left !== undefined && right !== undefined) return left + right;
		}
		return undefined;
	}
	function collect(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
			const value = literal(node.initializer);
			if (value !== undefined) constants.set(node.name.text, value);
		}
		ts.forEachChild(node, collect);
	}
	collect(file);
	failures.push(...checkLearnerAuthority(path, file, literal, program?.getTypeChecker()));
	function visit(node) {
		// Type annotations do not schedule work.
		if (ts.isTypeNode(node)) return;
		if (ts.isTypeOfExpression(node) && !ts.isCallExpression(node.expression)) return;
		const name = ts.isPropertyAccessExpression(node)
			? node.name.text
			: ts.isElementAccessExpression(node)
				? literal(node.argumentExpression)
				: ts.isIdentifier(node)
					? node.text
					: undefined;
		if (consumers && raw.has(name)) {
			if (
				learnerSchedulerExceptions.some(
					(entry) => entry.path === path && entry.expression === node.getText(file),
				)
			)
				return;
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(
				`${path}:${line}: deferred viewer work requires self-check-consumers lifetime helpers: ${node.getText(file)}`,
			);
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	// Keep the public provider's set method behind its one write owner, including aliases.
	// privacy-bootstrap delegates to its internal storage adapters after its captured lifetime check.
	if (program && path !== "packages/shared-blocks/src/learner-block-state.ts") {
		const typedFile = program.getSourceFile(resolve(path));
		const checker = program.getTypeChecker();

		function providerType(type) {
			const nonNullable = checker.getNonNullableType(type);
			return (nonNullable.isUnion() ? nonNullable.types : [nonNullable]).some((member) =>
				member
					.getProperty("set")
					?.declarations?.some((declaration) =>
						declaration
							.getSourceFile()
							.fileName.replaceAll("\\", "/")
							.endsWith("/learner-block-state.ts"),
					),
			);
		}
		function writes(node) {
			if (
				ts.isTypeNode(node) ||
				(ts.isTypeOfExpression(node) && !ts.isCallExpression(node.expression))
			)
				return;
			const binding = ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent);
			const key = binding ? (node.propertyName ?? node.name) : undefined;
			const field =
				key &&
				(ts.isComputedPropertyName(key)
					? literal(key.expression)
					: ts.isIdentifier(key)
						? key.text
						: literal(key));
			if (
				(ts.isPropertyAccessExpression(node) && node.name.text === "set") ||
				(ts.isElementAccessExpression(node) && literal(node.argumentExpression) === "set") ||
				field === "set"
			) {
				const expression = binding ? node.parent : node.expression;
				if (
					providerType(checker.getTypeAtLocation(expression)) ||
					/__praxityBlockState\b/.test(expression.getText(typedFile))
				) {
					if (
						path === "packages/export-pipeline/template/src/hosts/privacy-bootstrap.ts" &&
						["provider.set", "ordinary.set"].includes(node.getText(typedFile))
					)
						return;
					const line = typedFile.getLineAndCharacterOfPosition(node.getStart(typedFile)).line + 1;
					failures.push(
						path +
							":" +
							line +
							": learner provider writes require writeLearnerBlockState with captured authority: " +
							node.getText(typedFile),
					);
				}
			}
			ts.forEachChild(node, writes);
		}
		if (typedFile) writes(typedFile);
	}
	return failures;
}

function moduleLoaders(file, checker, pattern = false) {
	const constants = new Map();
	function collect(node) {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			ts.isVariableDeclarationList(node.parent) &&
			node.parent.flags & ts.NodeFlags.Const
		)
			constants.set(node.name.text, node.initializer);
		ts.forEachChild(node, collect);
	}
	collect(file);
	function literal(node, seen = new Set()) {
		if (!node) return null;
		if (ts.isStringLiteralLike(node)) return node.text;
		if (
			ts.isComputedPropertyName(node) ||
			ts.isParenthesizedExpression(node) ||
			ts.isAsExpression(node) ||
			ts.isTypeAssertionExpression(node) ||
			ts.isSatisfiesExpression(node) ||
			ts.isNonNullExpression(node)
		)
			return literal(node.expression, seen);
		if (
			pattern &&
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.PlusToken
		) {
			const left = literal(node.left, new Set(seen));
			const right = literal(node.right, new Set(seen));
			if (left !== null && right !== null) return left + right;
		}
		if (pattern && ts.isTemplateExpression(node)) {
			let value = node.head.text;
			for (const span of node.templateSpans) {
				const part = literal(span.expression, new Set(seen));
				if (part === null) return null;
				value += part + span.literal.text;
			}
			return value;
		}
		if (pattern && ts.isExpression(node)) {
			const type = checker?.getTypeAtLocation(node);
			if (type?.flags & ts.TypeFlags.StringLiteral) return type.value;
		}
		if (!ts.isIdentifier(node) || seen.has(node.text)) return null;
		seen.add(node.text);
		const declaration = checker?.getSymbolAtLocation(node)?.valueDeclaration;
		return literal(
			declaration && ts.isVariableDeclaration(declaration)
				? declaration.parent.flags & ts.NodeFlags.Const
					? declaration.initializer
					: undefined
				: constants.get(node.text),
			seen,
		);
	}
	const requireFactories = new Set(["createRequire"]);
	const requireNamespaces = new Set();
	for (const statement of file.statements) {
		if (
			ts.isImportDeclaration(statement) &&
			["node:module", "module"].includes(statement.moduleSpecifier.text) &&
			statement.importClause?.namedBindings &&
			ts.isNamedImports(statement.importClause.namedBindings)
		) {
			for (const binding of statement.importClause.namedBindings.elements)
				if ((binding.propertyName ?? binding.name).text === "createRequire")
					requireFactories.add(binding.name.text);
		}
		if (
			ts.isImportDeclaration(statement) &&
			["node:module", "module"].includes(statement.moduleSpecifier.text) &&
			statement.importClause?.namedBindings &&
			ts.isNamespaceImport(statement.importClause.namedBindings)
		)
			requireNamespaces.add(statement.importClause.namedBindings.name.text);
	}
	function loader(node, seen = new Set()) {
		if (ts.isIdentifier(node)) {
			if (node.text === "require") return true;
			if (seen.has(node.text)) return false;
			seen.add(node.text);
			const initial = constants.get(node.text);
			return initial ? loader(initial, seen) : false;
		}
		return (
			ts.isCallExpression(node) &&
			((ts.isIdentifier(node.expression) && requireFactories.has(node.expression.text)) ||
				(ts.isPropertyAccessExpression(node.expression) &&
					ts.isIdentifier(node.expression.expression) &&
					requireNamespaces.has(node.expression.expression.text) &&
					node.expression.name.text === "createRequire"))
		);
	}
	return { literal, loader };
}

export function checkSelfCheckOwners(path, source, program) {
	path = path.replaceAll("\\", "/");
	if (exemptTestPath(path)) return [];
	const authorOwner = selfCheckAuthorOwners.some((owner) =>
		owner.endsWith("/") ? path.startsWith(owner) : path === owner,
	);
	const file =
		program?.getSourceFile(resolve(path)) ??
		ts.createSourceFile(
			path,
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.getScriptKindFromFileName(path),
		);
	const checker = program?.getTypeChecker();
	const accessors = new Set([
		"readSelfCheckContent",
		"selfCheckContent",
		"readRetrievalSheetContent",
		"readWriteDistractorsContent",
		"writeDistractorsContent",
	]);
	const authorImports = new Set([
		"lessonNodeAtLine",
		"LessonNodeRecord",
		"TreeNode",
		"AnalyzedLessonTree",
		"LessonTree",
		"buildLessonTree",
		"analyzeLessonTree",
		"tokenizeLesson",
	]);
	const rawImports =
		/(?:grammar\/(?:src\/)?|^\.\/|^\.\.\/)(?:v4\/)?(?:tree|lex|to-blocks)(?:[/.]|$)/;
	const grammarModule = /(?:^|\/)grammar(?:\/src\/|$)|(?:^|\/)read-lesson(?:\.[cm]?[jt]s)?$/;
	const { literal, loader } = moduleLoaders(file, checker, patternPath(path));
	// Resolve computed compiler-channel names without widening legacy raw-source checks.
	const compilerLiteral = patternPath(path) ? literal : moduleLoaders(file, checker, true).literal;
	const fullRead = (node) => {
		const type = checker?.getTypeAtLocation(node);
		return !!(type?.getProperty("tree") && type.getProperty("nodes"));
	};

	const memberName = (node) =>
		ts.isPropertyAccessExpression(node)
			? node.name.text
			: ts.isElementAccessExpression(node)
				? literal(node.argumentExpression)
				: ts.isBindingElement(node)
					? ts.isIdentifier(node.propertyName ?? node.name)
						? (node.propertyName ?? node.name).text
						: literal(node.propertyName)
					: null;
	// Unknown values fail closed. Types exempt only ordinary arrays and indexed
	// projection records, never a lossless tree or the reader's node-record Map.
	function unrelatedProjection(node, name) {
		if (!checker) return false;
		const receiver = checker.getTypeAtLocation(
			ts.isBindingElement(node) ? node.parent : node.expression,
		);
		if (receiver.getProperty("tree") && receiver.getProperty("nodes")) return false;
		function projectionEntry(entry) {
			if (entry.isUnion()) return entry.types.every(projectionEntry);
			return (
				entry.flags & ts.TypeFlags.Object &&
				!["node", "raw", "tree", "stream"].some((key) => entry.getProperty(key))
			);
		}
		const type = checker.getTypeAtLocation(ts.isBindingElement(node) ? node.name : node);
		const parts = (type.isUnion() ? type.types : [type]).filter(
			(part) => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)),
		);
		return (
			parts.length > 0 &&
			parts.every((part) => {
				const entry =
					checker.isArrayType(part) || checker.isTupleType(part)
						? checker.getIndexTypeOfType(part, ts.IndexKind.Number)
						: name === "nodes" && checker.getIndexTypeOfType(part, ts.IndexKind.String);
				return entry && projectionEntry(entry);
			})
		);
	}
	function revisionAdmission(node) {
		if (
			path !== "apps/desktop/src/main/export/build-export-input-from-project.ts" ||
			node.getText(file) !== "read.tree.stream.source"
		)
			return false;
		const comparison = node.parent;
		if (
			!ts.isBinaryExpression(comparison) ||
			comparison.left !== node ||
			comparison.right.getText(file) !== "input.lessonSource" ||
			![
				ts.SyntaxKind.EqualsEqualsToken,
				ts.SyntaxKind.EqualsEqualsEqualsToken,
				ts.SyntaxKind.ExclamationEqualsToken,
				ts.SyntaxKind.ExclamationEqualsEqualsToken,
			].includes(comparison.operatorToken.kind)
		)
			return false;
		const guard = comparison.parent;
		if (
			!ts.isBinaryExpression(guard) ||
			guard.right !== comparison ||
			guard.operatorToken.kind !== ts.SyntaxKind.BarBarToken ||
			guard.left.getText(file) !== "!read"
		)
			return false;
		const statement = guard.parent;
		return (
			ts.isIfStatement(statement) &&
			statement.expression === guard &&
			ts.isThrowStatement(statement.thenStatement)
		);
	}
	const failures = [];
	// This bridge may call the accessor; raw tree/node traversal stays forbidden.
	const admittedAccessor = (name) =>
		path === "apps/desktop/src/main/export/build-export-input-from-project.ts" &&
		["readSelfCheckContent", "readWriteDistractorsContent"].includes(name);
	function authorBinding(node) {
		if (!ts.isImportSpecifier(node) && !ts.isExportSpecifier(node)) return false;
		const importedName = (node.propertyName ?? node.name).text;
		const symbol = checker?.getSymbolAtLocation(node.name);
		const originalName =
			symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol).name : symbol?.name;
		return [importedName, originalName].some(
			(name) => (!admittedAccessor(name) && accessors.has(name)) || authorImports.has(name),
		);
	}
	const compilerContentOwners = [
		{
			path: "packages/export-pipeline/src/self-check.ts",
			contentName: "selfCheckContents",
			strippedName: "_selfCheckContent",
			module: /(?:^|\/)self-check(?:\.[cm]?[jt]s)?$/,
			logic: /learning-patterns\/patterns\/self-check\/logic(?:\.js)?$/,
			logicOwner: "packages/export-pipeline/template/src/islands/self-check-support.ts",
			callers: new Map([
				["selfCheckRuntimeAssets", "packages/export-pipeline/src/self-check.ts"],
				["writeSelfCheckAssets", "packages/export-pipeline/src/build.ts"],
				["captureSelfCheckRuntime", "packages/export-pipeline/src/preview/course-context.ts"],
			]),
		},
		{
			path: "packages/export-pipeline/src/write-distractors.ts",
			contentName: "writeDistractorsContents",
			strippedName: "_writeDistractorsContent",
			module:
				/^(?!learning-patterns\/)(?:.*\/)?(?:patterns\/write-distractors(?:\/.*)?|write-distractors(?:\.[cm]?[jt]s)?)$/,
			logic: /learning-patterns\/patterns\/write-distractors\/logic(?:\.js)?$/,
			logicOwner: "packages/shared-blocks/src/write-distractors-content.ts",
			callers: new Map([
				["writeDistractorsRuntimeAssets", "packages/export-pipeline/src/write-distractors.ts"],
				["writeWriteDistractorsAssets", "packages/export-pipeline/src/build.ts"],
				[
					"captureWriteDistractorsRuntime",
					"packages/export-pipeline/src/preview/course-context.ts",
				],
			]),
		},
	];
	// Grammar, asset admission and revision hashing own full distractor values. Author tree retention
	// does not grant generic collectors permission to read answer-bearing fields.
	const distractorContentOwner = [
		"packages/grammar/src/read-lesson.ts",
		"packages/grammar/src/v4/schema.ts",
		"packages/export-pipeline/src/write-distractors.ts",
		"packages/shared-blocks/src/write-distractors-content.ts",
	].includes(path);
	// Name-based guard: key-agnostic serialization relies on the output invariant;
	// upgrade to a type-based Content check like fullRead if new bypasses need it.
	const distractorHiddenKeys = new Set(["rightAnswer", "misconceptions", "authorOptions"]);
	const distractorUiStringKey = "rightAnswer";

	function stripSite(node) {
		return (
			path === "packages/export-pipeline/src/preview/course-context.ts" &&
			ts.isBindingElement(node) &&
			ts.isVariableDeclaration(node.parent.parent) &&
			[
				"{ selfCheckContents: _selfCheckContent, writeDistractorsContents: _writeDistractorsContent, ...promptCourse } = course",
				"{ selfCheckContents: _selfCheckContent, writeDistractorsContents: _writeDistractorsContent, ...promptConfig } = config",
			].includes(node.parent.parent.getText(file).replace(/\s+/g, " "))
		);
	}
	function preparedMergeSite(node, owner) {
		return (
			path === "apps/desktop/src/main/export/build-export-input-from-project.ts" &&
			owner.contentName === "writeDistractorsContents" &&
			ts.isPropertyAccessExpression(node) &&
			node.getText(file) === `prepared.${owner.contentName}` &&
			ts.isSpreadElement(node.parent) &&
			ts.isCallExpression(node.parent.parent) &&
			node.parent.parent.getText(file).replace(/\s+/g, " ") ===
				`${owner.contentName}.push(...prepared.${owner.contentName})`
		);
	}

	function nativePdfSite(node) {
		const expression = node.getText(file).replace(/\s+/g, " ");
		const parent = node.parent
			?.getText(file)
			.replace(/\s+/g, " ")
			.replace(/\( /g, "(")
			.replace(/, \)/g, ")");
		const withinFunction = (names) => {
			for (let owner = node.parent; owner; owner = owner.parent)
				if (ts.isFunctionDeclaration(owner)) return names.includes(owner.name?.text);
			return false;
		};
		if (path === "apps/desktop/src/main/export/build-export-input-from-project.ts")
			return (
				expression === "selfChecks.writeDistractorsContents" &&
				parent ===
					"pdfWriteDistractorsInputs(selfChecks.writeDistractorsContents, options.includeAnswerSheet)" &&
				withinFunction(["buildLessonInputFromProject", "prepareCourseLesson"])
			);
		if (path === "apps/desktop/src/main/export/export-project.ts")
			return (
				expression === "lesson.writeDistractorsContents" &&
				parent === "lesson.writeDistractorsContents ?? []" &&
				ts.isForOfStatement(node.parent.parent) &&
				node.parent.parent.expression === node.parent &&
				node.parent.parent.initializer.getText(file).replace(/\s+/g, " ") ===
					"const [block, content]" &&
				node.parent.parent.statement.getText(file).replace(/\s+/g, " ") ===
					"inspect(content, lesson.id, block);" &&
				withinFunction(["pdfRefusalMessage"])
			);
		if (path !== "packages/format-renderers/src/pipelines/course-pdf.ts") return false;
		if (
			ts.isImportDeclaration(node) &&
			expression ===
				'import { validateContent as validateWriteDistractors, type Content as WriteDistractorsContent, } from "learning-patterns/patterns/write-distractors/logic.js";'
		)
			return true;
		if (!withinFunction(["buildCoursePdfSource"])) return false;
		const lookup =
			expression === "lesson.writeDistractorsContents" &&
			parent === "lesson.writeDistractorsContents?.get";
		if (
			!lookup &&
			![
				"full.rightAnswer",
				"full.misconceptions",
				"full.authorOptions",
				"labels.rightAnswer",
			].includes(expression)
		)
			return false;
		// Both lexical branches are required. The same lookup outside answer-sheet admission refuses.
		for (let owner = node.parent; owner; owner = owner.parent) {
			if (
				!ts.isIfStatement(owner) ||
				owner.expression.getText(file) !== "options.includeAnswerSheet === true" ||
				owner.thenStatement.pos > node.pos ||
				node.end > owner.thenStatement.end
			)
				continue;
			for (let block = owner.parent; block; block = block.parent)
				if (
					ts.isIfStatement(block) &&
					block.expression.getText(file) === 'block.type === "writeDistractors"' &&
					block.thenStatement.pos <= node.pos &&
					node.end <= block.thenStatement.end
				)
					return true;
		}
		return false;
	}

	function visit(node) {
		if (revisionAdmission(node) || nativePdfSite(node)) return;
		// This declaration owns the guard's key names, not authored Content.
		if (
			path === "scripts/check-source-owners.mjs" &&
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			["distractorHiddenKeys", "distractorUiStringKey"].includes(node.name.text)
		)
			return;
		const expression = node.getText(file).replace(/\s+/g, " ");
		// This exact envelope discriminator validates saved state, not a source node.
		if (
			path === "packages/shared-blocks/src/self-check-state.ts" &&
			expression === 'value.kind !== "self-check"'
		)
			return;
		// This author session retains admitted reads, then the export-input owner
		// constructs the prompt projection. These exact cache writes publish nothing.
		if (
			path === "apps/desktop/src/main/studio/project-session.ts" &&
			[
				"goodLessons.set(file, structuredClone(read))",
				"lessons.set(file, good ? structuredClone(good) : { ...read, blocks: [], pages: [] })",
			].includes(expression)
		)
			return;
		// Published islands load browser URLs; they cannot resolve Node grammar modules.
		if (
			path === "packages/export-pipeline/template/src/island-loader.ts" &&
			expression === "import(moduleUrl)"
		)
			return;
		// This loader imports installer APIs from a reviewed external Rubato checkout.
		if (
			path === "scripts/install-internal-studio.mjs" &&
			expression === "import(pathToFileURL(join(root, path)).href)"
		)
			return;
		const binding = authorBinding(node);
		const name = memberName(node);
		const compilerName = ts.isElementAccessExpression(node)
			? compilerLiteral(node.argumentExpression)
			: ts.isBindingElement(node) &&
					node.propertyName &&
					ts.isComputedPropertyName(node.propertyName)
				? compilerLiteral(node.propertyName.expression)
				: name;
		// Unknown keys could select raw Content. Restrict this fail-closed rule to
		// pattern block-data reads; ordinary indexed presentation records stay usable.
		const computedDataKey = ts.isElementAccessExpression(node)
			? memberName(node.expression) === "data" && node.argumentExpression
			: ts.isBindingElement(node) &&
				node.propertyName &&
				ts.isComputedPropertyName(node.propertyName) &&
				ts.isVariableDeclaration(node.parent.parent) &&
				node.parent.parent.initializer &&
				memberName(node.parent.parent.initializer) === "data" &&
				node.propertyName.expression;
		if (patternPath(path) && computedDataKey && literal(computedDataKey) === null) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(
				`${path}:${line}: pattern unresolved computed block data key requires a declared author owner: ${node.getText(file)}`,
			);
			return;
		}
		const module =
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
				? node.moduleSpecifier.text
				: null;
		const compilerBinding =
			ts.isImportSpecifier(node) || ts.isExportSpecifier(node)
				? (node.propertyName ?? node.name).text
				: null;
		// Only the Content owner may call upstream validation, through its trimmed
		// value bridge. Studio's codec alone admits persisted envelopes (W07/W08).
		const upstreamModule =
			module ??
			(ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword || loader(node.expression))
				? literal(node.arguments[0])
				: null);
		const upstreamBindings = ts.isImportDeclaration(node)
			? node.importClause?.namedBindings
			: node.exportClause;
		const stateDecoder =
			upstreamModule &&
			(/learning-patterns\/patterns\/write-distractors\/enhance(?:\.js)?$/.test(upstreamModule) ||
				(/learning-patterns\/patterns\/write-distractors\/logic(?:\.js)?$/.test(upstreamModule) &&
					(!module ||
						!upstreamBindings ||
						ts.isNamespaceImport(upstreamBindings) ||
						ts.isNamespaceExport(upstreamBindings) ||
						upstreamBindings.elements?.some(
							(binding) => (binding.propertyName ?? binding.name).text === "validateState",
						))));
		if (path !== "packages/shared-blocks/src/write-distractors-content.ts" && stateDecoder) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(
				`${path}:${line}: upstream write-distractors saved-state validation belongs only to the Content owner; persisted state uses Studio's codec`,
			);
			return;
		}
		const symbol = compilerBinding && checker?.getSymbolAtLocation(node.name);
		const originalName =
			symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol).name : symbol?.name;
		let compilerPattern = "self-check";
		const compilerContent = compilerContentOwners.some((owner) => {
			const consumer =
				path !== owner.path ||
				(ts.isExportDeclaration(node) &&
					node.exportClause &&
					ts.isNamespaceExport(node.exportClause));
			if (!consumer) return false;
			const strippedReference =
				path === "packages/export-pipeline/src/preview/course-context.ts" &&
				ts.isIdentifier(node) &&
				node.text === owner.strippedName &&
				!stripSite(node.parent);
			const violation =
				[compilerName, compilerBinding, originalName].some(
					(accessor) =>
						owner.callers.has(accessor) &&
						(path !== owner.callers.get(accessor) || ts.isExportSpecifier(node)),
				) ||
				strippedReference ||
				(compilerName === owner.contentName &&
					(owner.contentName === "writeDistractorsContents" ||
						path.startsWith("packages/export-pipeline/")) &&
					!stripSite(node) &&
					!preparedMergeSite(node, owner)) ||
				(path.startsWith("packages/export-pipeline/") &&
					module &&
					owner.logic.test(module) &&
					path !== owner.logicOwner) ||
				(module &&
					owner.module.test(module) &&
					((node.importClause?.namedBindings &&
						ts.isNamespaceImport(node.importClause.namedBindings)) ||
						(ts.isExportDeclaration(node) &&
							(!node.exportClause || ts.isNamespaceExport(node.exportClause))))) ||
				(ts.isCallExpression(node) &&
					(node.expression.kind === ts.SyntaxKind.ImportKeyword || loader(node.expression)) &&
					(owner.module.test(literal(node.arguments[0]) ?? "") ||
						owner.logic.test(literal(node.arguments[0]) ?? "")));
			if (violation)
				compilerPattern =
					owner.contentName === "writeDistractorsContents" ? "write-distractors" : "self-check";
			return violation;
		});
		const distractorRawContent =
			!distractorContentOwner &&
			((module && /learning-patterns\/patterns\/write-distractors\/logic(?:\.js)?$/.test(module)) ||
				((distractorHiddenKeys.has(compilerName) ||
					(ts.isStringLiteralLike(node) && distractorHiddenKeys.has(node.text))) &&
					!(
						// This i18n owner aliases the imported plain string, never authored Content.
						(
							(path === "packages/shared-blocks/src/i18n/practice-host-strings.ts" &&
								ts.isPropertyAccessExpression(node) &&
								node.expression.getText(file) === "distractorStrings[resolveLocale(locale)]" &&
								node.name.text === distractorUiStringKey) ||
							// The closed prompt constructor reads schema bounds, never Content.
							(path === "packages/shared-blocks/src/write-distractors-prompt.ts" &&
								ts.isPropertyAccessExpression(node) &&
								node.expression.getText(file) === "schema.properties")
						)
					)) ||
				(module &&
					/(?:^|\/)write-distractors(?:\.[cm]?[jt]s)?$/.test(module) &&
					![
						"packages/export-pipeline/src/build.ts",
						"packages/export-pipeline/src/preview/course-context.ts",
						"packages/export-pipeline/src/preview/compile-page.ts",
						"packages/export-pipeline/src/html-pages.ts",
					].includes(path)));

		// Pattern modules cannot hide Content keys in exported constants or strings.
		const member =
			(!admittedAccessor(name) && accessors.has(name)) ||
			(patternPath(path) && accessors.has(literal(node)));
		const rawImport =
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			(rawImports.test(node.moduleSpecifier.text.replaceAll("/./", "/")) ||
				(grammarModule.test(node.moduleSpecifier.text.replaceAll("/./", "/")) &&
					((node.importClause?.namedBindings &&
						ts.isNamespaceImport(node.importClause.namedBindings)) ||
						(ts.isExportDeclaration(node) && !node.exportClause))));

		const specifier = ts.isCallExpression(node)
			? literal(node.arguments[0])?.replaceAll("/./", "/")
			: null;
		const dynamicImport =
			ts.isCallExpression(node) &&
			node.arguments.length > 0 &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword || loader(node.expression)) &&
			(specifier == null || grammarModule.test(specifier) || rawImports.test(specifier));
		const wholeRead =
			((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && fullRead(node.expression)) ||
			(ts.isBindingElement(node) && node.dotDotDotToken && fullRead(node.parent)) ||
			(ts.isElementAccessExpression(node) && fullRead(node.expression) && name === null) ||
			(ts.isCallExpression(node) &&
				[
					"JSON.stringify",
					"structuredClone",
					"Object.values",
					"Object.entries",
					"Object.assign",
				].includes(node.expression.getText(file)) &&
				node.arguments.some(fullRead));

		const rawReader = ["tree", "nodes"].includes(name) && !unrelatedProjection(node, name);
		const sourceType =
			path !== "scripts/check-source-owners.mjs" &&
			ts.isStringLiteralLike(node) &&
			node.text === "self-check" &&
			(ts.isBinaryExpression(node.parent) || ts.isCaseClause(node.parent));
		if (
			distractorRawContent ||
			compilerContent ||
			(!authorOwner &&
				(binding || member || rawImport || dynamicImport || rawReader || wholeRead || sourceType))
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			const pattern =
				distractorRawContent ||
				[name, compilerBinding, originalName].some((key) =>
					["readWriteDistractorsContent", "writeDistractorsContent"].includes(key),
				)
					? "write-distractors"
					: compilerPattern;
			failures.push(
				`${path}:${line}: full ${pattern} source/content requires a declared author owner: ${node.getText(file)}`,
			);
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}
const marker = (node) =>
	(ts.isStringLiteralLike(node) &&
		(node.text.includes("---") || node.text === "# " || node.text.includes("\uFEFF"))) ||
	(ts.isNumericLiteral(node) && Number(node.text) === 65279);

// Runtime recognition in the durable parser only improves its refusal message.
// Display acceptance belongs to narration hashing and private read matching.
const displayIdOwners = {
	parseIdentityReadSnapshot: ["packages/content-identity/src/resolve.ts"],
	isRuntimeNodeId: [
		"packages/content-identity/src/files.ts",
		"packages/content-identity/src/resolve.ts",
	],
	isDisplayNodeId: [
		"packages/shared-blocks/src/narration.ts",
		"packages/content-identity/src/files.ts",
		"packages/content-identity/src/resolve.ts",
		"apps/desktop/src/shared/narration-sidecar.ts",
		"apps/desktop/src/shared/edit-cli-schema.ts",
	],
};

const identityWriterOwners = {
	resolveCourseIdentity: [
		"apps/desktop/src/main/lesson-source.ts",
		"apps/desktop/src/main/operations/operation-service.ts",
	],
	persistCourseIdentity: [
		"apps/desktop/src/main/lesson-source.ts",
		"apps/desktop/src/main/operations/operation-service.ts",
		"apps/desktop/src/main/export/build-export-input-from-project.ts",
		"apps/desktop/src/main/studio/project-session.ts",
	],
	resolveLessonSourcesForWrite: [
		"apps/desktop/src/main/export/build-export-input-from-project.ts",
		"apps/desktop/src/main/studio/project-session.ts",
	],
};

export function checkIdentityWriterImports(path, source, program) {
	return [
		...checkProductionImports(path, source, program),
		...checkOwnedImports(
			path,
			source,
			program,
			{
				reclaimProtectedArchives: ["apps/desktop/src/main/identity-store.ts"],
			},
			{
				definition: "apps/desktop/src/main/project-file-transactions.ts",
				module: /(?:^|\/)project-file-transactions(?:\.[cm]?[jt]s)?(?:[?#].*)?$/u,
				barrels: [],
				message: "protected archive deletion belongs only to I4",
			},
		),
		...checkOwnedImports(
			path,
			source,
			program,
			{
				planInverseGroup: ["apps/desktop/src/main/operations/operation-service.ts"],
				consumeInverseGroupIdentity: ["apps/desktop/src/main/operations/operation-service.ts"],
			},
			{
				definition: "packages/operations/src/index.ts",
				module:
					/(?:^@praxity\/operations(?:\/.*)?$|(?:^|\/)operations\/src\/(?:index|inverse)(?:\.[cm]?[jt]s)?(?:[?#].*)?$)/u,
				barrels: [],
				message: "import group history capabilities by name only in the operation service",
			},
		),
		...checkOwnedImports(path, source, program, identityWriterOwners, {
			definition: "apps/desktop/src/main/identity-store.ts",
			module: /(?:^|\/)(?:identity-store|lesson-source)(?:\.[cm]?[jt]s)?(?:[?#].*)?$/u,
			barrels: [],
			message: "import identity writers by name in their allowed write owners",
		}),
	];
}

function checkProductionImports(path, source, program) {
	path = path.replaceAll("\\", "/");
	if (!/^(?:apps|packages)\/[^/]+\/src\//u.test(path) || exemptTestPath(path)) return [];
	const file =
		program?.getSourceFile(resolve(path)) ??
		ts.createSourceFile(
			path,
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.getScriptKindFromFileName(path),
		);
	const checker = program?.getTypeChecker();
	const { literal, loader } = moduleLoaders(file, checker);
	const failures = [];
	function visit(node) {
		// Desktop uses ESM imports so runtime loaders cannot bypass writer ownership.
		const name = ts.isIdentifier(node)
			? node.text
			: ts.isElementAccessExpression(node)
				? literal(node.argumentExpression)
				: ts.isBindingElement(node)
					? literal(node.propertyName)
					: undefined;
		if (
			path.startsWith("apps/desktop/src/") &&
			["createRequire", "getBuiltinModule", "require"].includes(name)
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(`${path}:${line}: desktop source requires ESM imports`);
		}
		const specifier =
			ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
				? node.moduleSpecifier
				: ts.isCallExpression(node) &&
						(node.expression.kind === ts.SyntaxKind.ImportKeyword || loader(node.expression))
					? node.arguments[0]
					: undefined;
		const text = literal(specifier);
		const target = text?.startsWith(".")
			? resolve(dirname(path), text).replaceAll("\\", "/")
			: text;
		if (
			path === "apps/desktop/src/main/project-file-transactions.ts" &&
			target &&
			/(?:^|\/)(?:identity-[^/]+|identity\/.*|(?:@praxity|packages)\/content-identity(?:\/.*)?)$/iu.test(
				target,
			)
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(
				`${path}:${line}: T1 must not import identity- modules; use the protected-path leaf`,
			);
		}
		const typeOnly = ts.isImportDeclaration(node)
			? node.importClause?.isTypeOnly ||
				(!node.importClause?.name &&
					node.importClause?.namedBindings &&
					ts.isNamedImports(node.importClause.namedBindings) &&
					node.importClause.namedBindings.elements.length > 0 &&
					node.importClause.namedBindings.elements.every((binding) => binding.isTypeOnly))
			: ts.isExportDeclaration(node) &&
				(node.isTypeOnly ||
					(node.exportClause &&
						ts.isNamedExports(node.exportClause) &&
						node.exportClause.elements.length > 0 &&
						node.exportClause.elements.every((binding) => binding.isTypeOnly)));
		// The frame barrel evaluates page-lens CSS; Node owners use the pure view entry.
		if (
			/^apps\/desktop\/src\/(?:shared|main)\//u.test(path) &&
			target &&
			/^(?:@praxity\/editor-core\/frame-bridge|.*\/editor-core\/src\/frame-bridge)(?:\/index(?:\.[cm]?[jt]s)?)?(?:[?#].*)?$/u.test(
				target,
			) &&
			!typeOnly
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(`${path}:${line}: Node source must import the pure frame-bridge/view entry`);
		}
		const declarations = specifier
			? (checker?.getSymbolAtLocation(specifier)?.declarations ?? [])
			: [];
		if (
			(target && testPath.test(target)) ||
			declarations.some((declaration) =>
				testPath.test(declaration.getSourceFile().fileName.replaceAll("\\", "/")),
			)
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(`${path}:${line}: test helpers belong only in tests`);
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

export function checkDisplayIdImports(path, source, program) {
	return checkOwnedImports(path, source, program, displayIdOwners, {
		definition: "packages/content-model/src/types.ts",
		module:
			/(?:^@praxity\/(?:content-model|shared-blocks)(?:\/types)?$|(?:content-model|shared-blocks)\/src\/(?:types|index)(?:\.[cm]?[jt]s)?$)/u,
		barrels: [
			"packages/content-model/src/index.ts",
			"packages/shared-blocks/src/types.ts",
			"packages/shared-blocks/src/index.ts",
		],
		message: "import display ID predicates by name in their allowed owners",
	});
}

/** History must not activate before the reporting wait and learner recovery ship together. */
export function checkDormantChoiceImports(path, source, program) {
	const owner = "packages/shared-blocks/src/choice-learner-state.ts";
	const host = "packages/export-pipeline/template/src/hosts/course-host.ts";
	const group = "packages/shared-blocks/src/viewer/assessment-group-runtime.ts";
	return checkOwnedImports(
		path,
		source,
		program,
		Object.fromEntries(
			[
				"restoreChoiceAssessmentState",
				"prepareChoiceAssessmentState",
				"retainLegacyChoiceBuild",
				"choiceDependencyStatus",
				"choiceGroupDependencyIds",
				"choiceGroupSignature",
				"prepareChoiceGroupSubmission",
				"createChoiceDependencyView",
			].map((name) => [
				name,
				name === "prepareChoiceGroupSubmission"
					? [owner, host, group]
					: name === "choiceDependencyStatus"
						? [owner, host]
						: [owner],
			]),
		),
		{
			definition: owner,
			module:
				/(?:^@praxity\/shared-blocks\/choice-learner-state$|(?:^|\/)choice-learner-state(?:\.[cm]?[jt]s)?$)/u,
			barrels: [],
			forbidModuleLoads: true,
			message:
				"choice admission is dormant until reporting waits and learner recovery is available",
		},
	);
}

function checkOwnedImports(path, source, program, ownership, options) {
	path = path.replaceAll("\\", "/");
	if (exemptTestPath(path) || path === options.definition) return [];
	const file =
		program?.getSourceFile(resolve(path)) ??
		ts.createSourceFile(
			path,
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.getScriptKindFromFileName(path),
		);
	const checker = program?.getTypeChecker();
	const { literal, loader } = moduleLoaders(file, checker);
	const failures = [];
	const fail = (node, message) => {
		const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
		failures.push(`${path}:${line}: ${message}`);
	};
	function modulePredicates(specifier) {
		const symbol = checker?.getSymbolAtLocation(specifier);
		if (symbol) {
			const names = checker
				.getExportsOfModule(symbol)
				.map((entry) =>
					entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry).name : entry.name,
				)
				.filter((name) => Object.hasOwn(ownership, name));
			if (names.length) return names;
		}
		const text = literal(specifier);
		return text && options.module.test(text) ? Object.keys(ownership) : [];
	}
	function visit(node) {
		const bindings = ts.isImportDeclaration(node)
			? node.importClause?.namedBindings
			: ts.isExportDeclaration(node)
				? node.exportClause
				: undefined;
		const typeOnlyBindings =
			bindings &&
			(ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
			bindings.elements.length > 0 &&
			bindings.elements.every((binding) => binding.isTypeOnly);
		const declaration =
			options.forbidModuleLoads &&
			!typeOnlyBindings &&
			((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
				(ts.isExportDeclaration(node) && !node.isTypeOnly));
		const namespace =
			ts.isImportDeclaration(node) &&
			node.importClause?.namedBindings &&
			ts.isNamespaceImport(node.importClause.namedBindings);
		const star = ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier;
		const loads =
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword || loader(node.expression));
		const specifier =
			declaration || namespace || star
				? node.moduleSpecifier
				: loads
					? node.arguments[0]
					: undefined;
		const barrel = star && options.barrels.includes(path);
		if (specifier && !barrel && modulePredicates(specifier).length) fail(node, options.message);
		const imported = ts.isImportSpecifier(node) || ts.isExportSpecifier(node);
		const member = ts.isPropertyAccessExpression(node) || ts.isBindingElement(node);
		const nameNode =
			imported || member
				? (node.propertyName ?? node.name)
				: ts.isElementAccessExpression(node)
					? node.argumentExpression
					: undefined;
		if (nameNode) {
			let name = nameNode.text;
			const symbol = imported ? checker?.getSymbolAtLocation(nameNode) : undefined;
			if (symbol && !Object.hasOwn(ownership, name))
				name = (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
					.name;
			const owners = Object.hasOwn(ownership, name) ? ownership[name] : undefined;
			if (owners && !owners.includes(path)) {
				fail(node, `${name} belongs only in ${owners.join(", ")}`);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

function checkOutcomeOwners(path, file) {
	const owner = "packages/shared-blocks/src/tracking.ts";
	if (path === owner || exemptTestPath(path)) return [];
	const writes = new Set([
		"setCompletion",
		"setSuccess",
		"setScore",
		"trackObjective",
		"suppressTerminationResult",
	]);
	const constants = new Map();
	const writerNames = new Set(["writeCourseOutcome"]);
	function collect(node) {
		if (
			ts.isImportSpecifier(node) &&
			(node.propertyName ?? node.name).text === "writeCourseOutcome"
		)
			writerNames.add(node.name.text);
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			ts.isVariableDeclarationList(node.parent) &&
			node.parent.flags & ts.NodeFlags.Const
		)
			constants.set(node.name.text, node.initializer);
		ts.forEachChild(node, collect);
	}
	collect(file);
	function name(node, seen = new Set()) {
		if (ts.isStringLiteralLike(node)) return node.text;
		if (!ts.isIdentifier(node) || seen.has(node.text)) return null;
		seen.add(node.text);
		const value = constants.get(node.text);
		return value ? name(value, seen) : null;
	}

	const failures = [];
	function visit(node) {
		const call = ts.isCallExpression(node);
		const member = call ? node.expression : node;
		const method = ts.isPropertyAccessExpression(member)
			? member.name.text
			: ts.isElementAccessExpression(member)
				? name(member.argumentExpression)
				: ts.isBindingElement(member)
					? (member.propertyName ?? member.name).text
					: null;
		const extracted =
			ts.isBindingElement(node) ||
			((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
				!(ts.isCallExpression(node.parent) && node.parent.expression === node) &&
				!(
					ts.isPrefixUnaryExpression(node.parent) &&
					node.parent.operator === ts.SyntaxKind.ExclamationToken
				) &&
				!ts.isTypeOfExpression(node.parent));
		// Reject references too: aliases and Reflect.apply must not bypass ownership.
		if (
			path !== "packages/export-pipeline/src/scorm/tracking.ts" &&
			((ts.isIdentifier(node) &&
				writerNames.has(node.text) &&
				!ts.isImportSpecifier(node.parent) &&
				!ts.isExportSpecifier(node.parent)) ||
				(method === "writeCourseOutcome" && (call || extracted)))
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(
				`${path}:${line}: course outcome decisions belong in CourseTracker or the runtime-only End owner: ${node.getText(file)}`,
			);
			return;
		}

		// An adapter may translate its own combined status into its own success field.
		const internalSuccess =
			path === "packages/export-pipeline/src/scorm/api/scorm2004.ts" &&
			method === "setSuccess" &&
			member.expression?.kind === ts.SyntaxKind.ThisKeyword;
		if (
			!internalSuccess &&
			(call || extracted) &&
			(writes.has(method) ||
				(method === "terminate" &&
					(extracted ||
						(node.arguments.length > 0 && node.arguments[0].kind !== ts.SyntaxKind.FalseKeyword))))
		) {
			const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
			failures.push(
				`${path}:${line}: course outcome writes belong in ${owner}: ${node.getText(file)}`,
			);
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

// Each emitting function is exercised by new-tab-links.test.ts. Counts make a
// new target in an existing renderer require the same coverage review. Each
// pair counts target literals and marker calls; the tooltip sanitizer also reads
// the target before marking it in one DOM loop.
const newTabRenderers = {
	"packages/export-pipeline/src/render-block-html.ts": {
		renderAudio: [1, 1],
		renderEmbed: [1, 1],
		renderMediaLink: [1, 1],
		renderButton: [1, 1],
		renderDocument: [1, 1],
		renderResourceEntry: [1, 1],
	},
	"packages/export-pipeline/src/html-gen.ts": { generateHtmlPage: [2, 2], renderDeckBody: [1, 1] },
	"packages/export-pipeline/src/resources-page.ts": { renderSection: [1, 1] },
	"packages/shared-blocks/src/viewer/inline-tooltips.ts": {
		sanitizeTooltipHtml: [2, 1],
		show: [1, 1],
	},
};

function checkNewTabLinkOwners(path, file) {
	if (
		!/^packages\/(?:export-pipeline\/(?:src|template\/src)|shared-blocks\/src|content-model\/src|format-renderers\/src)\//.test(
			path,
		)
	)
		return [];
	const groups = new Map();
	function visit(node) {
		if (
			(ts.isStringLiteralLike(node) ||
				ts.isTemplateHead(node) ||
				ts.isTemplateMiddle(node) ||
				ts.isTemplateTail(node)) &&
			node.text.toLowerCase().includes("_blank")
		) {
			let owner = node.parent;
			while (
				owner &&
				!(
					ts.isFunctionDeclaration(owner) ||
					ts.isFunctionExpression(owner) ||
					(ts.isArrowFunction(owner) && ts.isVariableDeclaration(owner.parent))
				)
			)
				owner = owner.parent;
			const group = groups.get(owner) ?? [];
			for (const _target of node.text.matchAll(/_blank/gi)) group.push(node);
			groups.set(owner, group);
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	const failures = [];
	for (const [owner, literals] of groups) {
		const name = owner?.name?.getText(file) ?? owner?.parent?.name?.getText(file) ?? "<module>";
		// These two consumers only read a target; changing the expression to a
		// writer must still fail, even if the literal count stays the same.
		const reader =
			(path === "packages/export-pipeline/template/src/course-shell.ts" &&
				name === "bindGlossaryLinks") ||
			(path === "packages/export-pipeline/template/src/islands/island-nav.tsx" &&
				name === "initializeLinks");
		const readOnly = (node) =>
			(ts.isBinaryExpression(node.parent) &&
				[
					ts.SyntaxKind.EqualsEqualsToken,
					ts.SyntaxKind.EqualsEqualsEqualsToken,
					ts.SyntaxKind.ExclamationEqualsToken,
					ts.SyntaxKind.ExclamationEqualsEqualsToken,
				].includes(node.parent.operatorToken.kind)) ||
			(ts.isCallExpression(node.parent) &&
				ts.isPropertyAccessExpression(node.parent.expression) &&
				["querySelector", "querySelectorAll"].includes(node.parent.expression.name.text));
		if (reader && literals.length === 1 && literals.every(readOnly)) continue;
		let markerCalls = 0;
		function findMarker(node) {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "externalLinkIndicatorHtml"
			)
				markerCalls++;
			ts.forEachChild(node, findMarker);
		}
		if (owner) findMarker(owner);
		const [literalCount, markerCount] = newTabRenderers[path]?.[name] ?? [];
		if (literalCount === literals.length && markerCount === markerCalls) continue;
		const line = file.getLineAndCharacterOfPosition(literals[0].getStart(file)).line + 1;
		failures.push(
			`${path}:${line}: new-tab link in ${name} needs reviewed compiler fixture coverage and the externalLinkIndicatorHtml marking owner`,
		);
	}
	return failures;
}

export function checkSourceOwners(path, source, allowlist = sourceOwnerAllowlist) {
	path = path.replaceAll("\\", "/");
	// Fixtures intentionally contain hostile source. The lint itself is tested by planting it.
	if (exemptTestPath(path)) return [];
	const file = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.getScriptKindFromFileName(path),
	);
	const failures = [...checkOutcomeOwners(path, file), ...checkNewTabLinkOwners(path, file)];
	if (path.startsWith("packages/grammar/src/")) return failures;
	const fail = (node) => {
		const expression = node.getText(file);
		if (
			allowlist.some(
				(entry) =>
					entry.path === path &&
					entry.expression === expression &&
					typeof entry.reason === "string" &&
					entry.reason.trim(),
			)
		)
			return;
		const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
		failures.push(
			`${path}:${line}: source detection belongs in packages/grammar/src: ${expression}`,
		);
	};
	function visit(node) {
		if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
			if (/---|\^#\\s|\\u(?:FEFF|feff)|\\u\{(?:FEFF|feff)\}|\uFEFF/.test(node.getText(file)))
				fail(node);
		} else if (
			ts.isBinaryExpression(node) &&
			[
				ts.SyntaxKind.EqualsEqualsToken,
				ts.SyntaxKind.EqualsEqualsEqualsToken,
				ts.SyntaxKind.ExclamationEqualsToken,
				ts.SyntaxKind.ExclamationEqualsEqualsToken,
			].includes(node.operatorToken.kind) &&
			(marker(node.left) || marker(node.right))
		) {
			fail(node);
			return;
		} else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
			const args = node.arguments ?? [];
			const regexp = ts.isIdentifier(node.expression) && node.expression.text === "RegExp";
			const detection =
				ts.isPropertyAccessExpression(node.expression) &&
				[
					"startsWith",
					"endsWith",
					"includes",
					"indexOf",
					"lastIndexOf",
					"replace",
					"replaceAll",
					"split",
					"match",
					"matchAll",
					"search",
				].includes(node.expression.name.text);
			if (
				(detection && args.some(marker)) ||
				(regexp &&
					args.some(
						(arg) =>
							ts.isStringLiteralLike(arg) && /---|\^#\\s|\\u(?:FEFF|feff)|\uFEFF/.test(arg.text),
					))
			) {
				fail(node);
				return;
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
	const program = ts.createProgram(
		files.filter((path) => !exemptTestPath(path)),
		{
			allowJs: true,
			noEmit: true,
			strict: true,
			target: ts.ScriptTarget.Latest,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			jsx: ts.JsxEmit.ReactJSX,
		},
	);
	const failures = [...new Set(files)].flatMap((path) => {
		const source = readFileSync(path, "utf8");
		return [
			...checkWorkspaceSourceImports(path, source),
			...checkDisplayIdImports(path, source, program),
			...checkDormantChoiceImports(path, source, program),
			...checkIdentityWriterImports(path, source, program),
			...checkSourceOwners(path, source),
			...checkSelfCheckOwners(path, source, program),
			...checkLifetimeOwners(path, source, program),
		];
	});
	for (const failure of failures) console.error(failure);
	if (failures.length) process.exitCode = 1;
	else console.log("Source ownership checks passed.");
}
