import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export const manifestPath = "scripts/learning-patterns-admission.json";
const roles = new Set(["learner-bundle", "studio-browser", "node-build-time", "css", "legal"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const portable = (file) => file.split(path.sep).join("/");
const git = (root, ...args) =>
	execFileSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
		cwd: root,
		encoding: "utf8",
	});

// pnpm's package-directory link is expected. Every component *inside* its real
// package must be an ordinary file/directory, including esbuild's helper inputs.
async function admittedPath(packageRoot, file) {
	const relative = path.relative(packageRoot, path.resolve(file));
	if (
		!relative ||
		relative.startsWith(`..${path.sep}`) ||
		relative === ".." ||
		path.isAbsolute(relative)
	)
		throw new Error(`Outside learning-patterns package: ${file}`);
	let current = packageRoot;
	for (const part of relative.split(path.sep)) {
		current = path.join(current, part);
		if ((await lstat(current)).isSymbolicLink())
			throw new Error(`Symlink in learning-patterns package: ${relative}`);
	}
	if (!(await lstat(current)).isFile() || (await realpath(current)) !== current)
		throw new Error(`Not a canonical learning-patterns file: ${relative}`);
	return portable(relative);
}

function readPin(lock, workspace) {
	const specifier = workspace.catalog?.["learning-patterns"];
	const match = /^github:Praxity\/learning-patterns#([a-f0-9]{40})$/.exec(specifier ?? "");
	if (!match || lock.catalogs?.default?.["learning-patterns"]?.specifier !== specifier)
		throw new Error("learning-patterns catalog/lockfile pin mismatch");
	const pin = match[1];
	const tarball = `https://codeload.github.com/Praxity/learning-patterns/tar.gz/${pin}`;
	const key = `learning-patterns@${tarball}`;
	if (lock.packages?.[key]?.resolution?.tarball !== tarball || !lock.snapshots?.[key])
		throw new Error("Missing pinned learning-patterns lockfile resolution/snapshot");
	if (
		Object.keys(lock.packages).some((name) => name.startsWith("learning-patterns@") && name !== key)
	)
		throw new Error("Multiple learning-patterns lockfile pins");
	let consumers = 0;
	for (const importer of Object.values(lock.importers ?? {})) {
		for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
			const dependency = importer[kind]?.["learning-patterns"];
			if (!dependency) continue;
			consumers++;
			if (dependency.specifier !== "catalog:" || dependency.version !== tarball)
				throw new Error("learning-patterns importer lockfile pin mismatch");
		}
	}
	if (!consumers) throw new Error("No learning-patterns lockfile consumers");
	return pin;
}

async function canonicalPackageRoot(root) {
	const packageRoot = await realpath(
		path.join(root, "packages/export-pipeline/node_modules/learning-patterns"),
	);
	await admittedPath(packageRoot, path.join(packageRoot, "package.json"));
	const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	if (["exports", "imports", "browser"].some((key) => key in metadata))
		throw new Error("Unsupported learning-patterns resolution conditions");
	return packageRoot;
}

/** Parse source and bundle installed imports without evaluating upstream code. */
export async function inventoryLearningPatterns(root) {
	root = await realpath(root);
	const require = createRequire(path.join(root, "package.json"));
	const ts = require("typescript");
	const toolingRequire = createRequire(path.join(root, "apps/desktop/package.json"));
	const { build } = toolingRequire("esbuild");
	const { parse } = toolingRequire("yaml");
	const pin = readPin(
		parse(await readFile(path.join(root, "pnpm-lock.yaml"), "utf8")),
		parse(await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8")),
	);
	const packageRoot = await canonicalPackageRoot(root);
	const reached = new Map();
	const add = async (file, role) => {
		const relative = await admittedPath(packageRoot, file);
		const entry = reached.get(relative) ?? new Set();
		entry.add(relative.endsWith(".css") ? "css" : role);
		reached.set(relative, entry);
	};
	const entries = new Map();
	const files = git(root, "ls-files", "-co", "--exclude-standard", "-z")
		.split("\0")
		.filter(
			(file) =>
				/\.(?:[cm]?[jt]sx?|css|json)$/.test(file) && !file.split("/").includes("node_modules"),
		);
	for (const file of new Set(files)) {
		const absolute = path.join(root, file);
		const source = await readFile(absolute, "utf8");
		const imports = discoverImports(ts, file, source);
		for (const specifier of imports) {
			const namesPackage = /^learning-patterns(?:\/|$)/.test(specifier);
			let resolved;
			try {
				resolved = createRequire(absolute).resolve(specifier);
			} catch (error) {
				if (namesPackage) throw error;
				// Other workspace/type/bundler imports belong to their own gates.
				continue;
			}
			if (!namesPackage && !resolved.startsWith(`${packageRoot}${path.sep}`)) continue;
			if (specifier.startsWith("learning-patterns/"))
				await admittedPath(
					packageRoot,
					path.join(packageRoot, specifier.slice("learning-patterns/".length)),
				);
			await admittedPath(packageRoot, resolved);
			const entryRoles = entries.get(resolved) ?? new Set();
			entryRoles.add("node-build-time");
			entries.set(resolved, entryRoles);
		}
	}
	if (!entries.size) throw new Error("No learning-patterns production imports discovered");
	for (const role of ["node-build-time"]) {
		const entryPoints = [...entries].filter(([, values]) => values.has(role)).map(([file]) => file);
		if (!entryPoints.length) continue;
		const result = await build({
			absWorkingDir: root,
			entryPoints,
			outdir: path.join(root, ".learning-patterns-in-memory"),
			bundle: true,
			write: false,
			metafile: true,
			treeShaking: false,
			platform: role === "learner-bundle" ? "browser" : "node",
			format: "esm",
			preserveSymlinks: true,
			logLevel: "silent",
			plugins: [
				{
					name: "admitted-package-only",
					setup(builder) {
						builder.onResolve({ filter: /.*/ }, async (args) => {
							// Upstream imports are explicit relative files. Refuse unknown
							// package/builtin imports rather than externalizing unscanned code.
							if (args.importer && !args.path.startsWith("."))
								throw new Error(`External learning-patterns import: ${args.path}`);
							const resolved = args.importer
								? path.resolve(path.dirname(args.importer), args.path)
								: args.path;
							await admittedPath(packageRoot, resolved);
							return { path: resolved };
						});
						builder.onLoad({ filter: /.*/ }, async (args) => {
							await admittedPath(packageRoot, args.path);
							if (/\.[cm]?js$/.test(args.path)) {
								const ast = ts.createSourceFile(
									args.path,
									await readFile(args.path, "utf8"),
									ts.ScriptTarget.Latest,
									true,
								);
								const visit = (node) => {
									if (
										ts.isCallExpression(node) &&
										(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
											node.expression.getText(ast) === "require") &&
										(!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))
									)
										throw new Error(`Unresolved learning-patterns import: ${args.path}`);
									ts.forEachChild(node, visit);
								};
								visit(ast);
							}
							return undefined;
						});
					},
				},
			],
		});
		if (result.warnings.length)
			throw new Error(`Unresolved dependency closure: ${result.warnings[0].text}`);
		for (const input of Object.keys(result.metafile.inputs))
			await add(path.resolve(root, input), role);
	}
	await add(path.join(packageRoot, "package.json"), "legal");
	// These are the same root notice families copied by standalone packaging.
	const legal = async (directory) => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) await legal(file);
			else await add(file, "legal");
		}
	};
	for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
		if (!/^(licen[cs]e|notice|copying|ofl|readme|copyright)([._-]|$)/i.test(entry.name)) continue;
		if (entry.isDirectory()) await legal(path.join(packageRoot, entry.name));
		else await add(path.join(packageRoot, entry.name), "legal");
	}
	if (![...reached.keys()].some((file) => /^(licen[cs]e|copying)([._-]|$)/i.test(file)))
		throw new Error("Missing learning-patterns licence input");
	return {
		version: 1,
		package: "learning-patterns",
		files: await Promise.all(
			[...reached]
				.sort(([a], [b]) => a.localeCompare(b, "en"))
				.map(async ([file, values]) => ({
					path: file,
					sha256: sha256(await readFile(path.join(packageRoot, file))),
					sourceCommit: pin,
					roles: [...values].sort(),
					reviewer: "",
					reviewDate: "",
					reviewReceipt: "",
				})),
		),
	};
}

export async function readAdmissionManifest(root) {
	const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
	if (
		manifest.version !== 1 ||
		manifest.package !== "learning-patterns" ||
		!Array.isArray(manifest.files) ||
		!manifest.files.length
	)
		throw new Error("Invalid learning-patterns admission manifest");
	const paths = new Set();
	for (const file of manifest.files) {
		if (
			typeof file.path !== "string" ||
			!file.path ||
			file.path.includes("\\") ||
			file.path.split("/").some((part) => !part || part === "." || part === "..") ||
			paths.has(file.path)
		)
			throw new Error("Invalid or duplicate admission path");
		paths.add(file.path);
		if (
			!/^[a-f0-9]{64}$/.test(file.sha256 ?? "") ||
			!/^[a-f0-9]{40}$/.test(file.sourceCommit ?? "") ||
			!Array.isArray(file.roles) ||
			!file.roles.length ||
			file.roles.some((role) => !roles.has(role)) ||
			new Set(file.roles).size !== file.roles.length
		)
			throw new Error(`Incomplete admission digest/pin/roles: ${file.path}`);
		if (
			![file.reviewer, file.reviewReceipt].every(
				(value) => typeof value === "string" && value.trim(),
			) ||
			!/^\d{4}-\d{2}-\d{2}$/.test(file.reviewDate ?? "") ||
			new Date(file.reviewDate).toISOString().slice(0, 10) !== file.reviewDate
		)
			throw new Error(`Incomplete review metadata: ${file.path}`);
	}
	if (new Set(manifest.files.map((file) => file.sourceCommit)).size !== 1)
		throw new Error("Admission sourceCommit mismatch: manifest entries");
	return manifest;
}

export async function verifyLearningPatterns(root) {
	const manifest = await readAdmissionManifest(root);
	const actual = await inventoryLearningPatterns(root);
	const expected = new Map(manifest.files.map((file) => [file.path, file]));
	for (const file of actual.files) {
		const admitted = expected.get(file.path);
		if (!admitted) throw new Error(`Unadmitted reached file: ${file.path}`);
		for (const key of ["sha256", "sourceCommit"])
			if (admitted[key] !== file[key]) throw new Error(`Admission ${key} mismatch: ${file.path}`);
		if (file.roles.some((role) => !admitted.roles.includes(role)))
			throw new Error(`Admission roles mismatch: ${file.path}`);
		expected.delete(file.path);
	}
	// Entries seen only by a real bundle remain valid; verify their bytes too.
	for (const file of expected.values()) {
		if (!file.roles.some((role) => ["learner-bundle", "studio-browser", "css"].includes(role)))
			throw new Error(`Manifest files not reached: ${file.path}`);
	}
	await verifyAdmittedFiles(root);
	return manifest;
}

// Existing bounded workspace/module-loader imports. New spellings require review.
const reviewedDynamicImports = {
	"packages/export-pipeline/src/__tests__/learning-patterns-admission.test.ts": [
		'import(pathToFileURL(path.join(root,"packages/export-pipeline/src/bundle-viewer.ts")).href)',
	],
	"apps/desktop/e2e/browser-editor/event-stream.spec.ts": ["import(moduleUrl)"],
	"apps/desktop/scripts/ci-minutes.test.mjs": [
		"import(`../../../packages/export-pipeline/tests/${suite}/playwright.config.ts`)",
	],
	"apps/desktop/scripts/published-output-timing.test.mjs": [
		"import(`../../../packages/export-pipeline/tests/${suite}/playwright.config.ts`)",
	],
	"apps/desktop/src/main/__tests__/fixtures/review2-writer.mjs": [
		"import(`${repo}/apps/desktop/src/main/project-file-transactions.ts`)",
		"import(`${repo}/apps/desktop/src/main/course-manifest-io.ts`)",
		'import(newURL("../../lesson-source.ts",import.meta.url).href)',
		"import(`${repo}/apps/desktop/src/main/lesson-source.ts`)",
	],
	"apps/desktop/src/main/__tests__/fixtures/review3-writer.mjs": [
		"import(`${repo}/apps/desktop/src/main/project-file-transactions.ts`)",
	],
	"packages/content-identity/scripts/capture-legacy-store.ts": [
		'import(pathToFileURL(join(baseline,"packages/grammar/src/read-lesson.ts")).href)',
		'import(pathToFileURL(join(baseline,"packages/content-identity/src/index.ts")).href)',
	],
	"packages/export-pipeline/src/__tests__/bundle-viewer.test.ts": [
		'import(pathToFileURL(path.join(root,"packages/export-pipeline/src/bundle-viewer.ts")).href)',
		'import(pathToFileURL(path.join(pipeline,"src/export-assets.ts")).href)',
		'import(pathToFileURL(path.join(pipeline,"src/build.ts")).href)',
	],
	"packages/export-pipeline/template/src/island-loader.ts": ["import(moduleUrl)"],
	"packages/export-pipeline/tests/deck/dont-know-acceptance.spec.ts": [
		"import(/*@vite-ignore*/`${location.origin}/reset-owner.js`)",
	],
	"packages/export-pipeline/tests/deck/dont-know-private.spec.ts": [
		"import(/*@vite-ignore*/`${location.origin}/reset-owner.js`)",
	],
	"packages/export-pipeline/tests/deck/self-check-assets.spec.ts": [
		'import(newURL(document.documentElement.getAttribute("data-island-self-check")??"",document.baseURI,).href)',
	],
	"packages/export-pipeline/tests/deck/self-check-island.spec.ts": [
		"import(newURL(entry,document.baseURI).href)",
		'import(newURL(document.documentElement.getAttribute("data-island-self-check")??"",document.baseURI,).href)',
		"import(`${url}?consumer=a`)",
		"import(`${url}?consumer=b`)",
	],
	"scripts/install-internal-studio.mjs": ["import(pathToFileURL(join(root,path)).href)"],
};

function discoverImports(ts, file, source) {
	const imports = new Set();
	const namesPackage = (value) => /(?:^|[/])learning-patterns[/]/.test(value);
	// JSON is data. Package dependency declarations are checked against the lock;
	// bundler/tsconfig alias targets into the package are refused explicitly.
	if (file.endsWith(".json")) {
		if (!source.includes("learning-patterns")) return imports;
		const data = JSON.parse(source);
		const visitData = (value, key = "") => {
			if (
				typeof value === "string" &&
				((namesPackage(value) &&
					!value.startsWith("https://codeload.github.com/Praxity/learning-patterns/")) ||
					(value === "learning-patterns" && /alias|paths|browser/i.test(key)))
			)
				throw new Error(`Stray learning-patterns alias: ${file}`);
			if (value && typeof value === "object")
				for (const [child, content] of Object.entries(value)) visitData(content, `${key}/${child}`);
		};
		visitData(data);
		return imports;
	}
	if (file.endsWith(".css")) {
		let remaining = source.replace(/\/\*[\s\S]*?\*\//g, "");
		remaining = remaining.replace(
			/@import\s+(?:url\(\s*)?(?:["']([^"']+)["']|([^\s;)]+))\s*\)?|url\(\s*(?:["']([^"']+)["']|([^\s)]+))\s*\)/g,
			(match, a, b, c, d) => {
				const target = a ?? b ?? c ?? d;
				if (namesPackage(target)) imports.add(target);
				return "";
			},
		);
		if (remaining.includes("learning-patterns"))
			throw new Error(`Stray learning-patterns CSS reference: ${file}`);
		return imports;
	}
	const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const visit = (node) => {
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				node.expression.getText(ast) === "require") &&
			(!node.arguments[0] || !ts.isStringLiteral(node.arguments[0]))
		) {
			const expression = node.getText(ast).replace(/\s/g, "");
			if (!reviewedDynamicImports[file]?.includes(expression))
				throw new Error(
					`Unresolved learning-patterns import boundary: ${file}: ${node.getText(ast)}`,
				);
		}
		if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
			const text = ts.isTemplateExpression(node) ? node.getText(ast) : node.text;
			const parent = node.parent;
			const isImport =
				ts.isStringLiteral(node) &&
				((ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) ||
					ts.isImportDeclaration(parent) ||
					ts.isExportDeclaration(parent) ||
					(ts.isCallExpression(parent) &&
						(parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
							/^(?:require|vi\.(?:mock|importActual))$/.test(parent.expression.getText(ast)))));
			if (isImport) imports.add(text);
			else if (
				namesPackage(text) &&
				!/^learning-patterns\/(?:package\.json|LICENSE|NOTICE|README\.md)$/.test(text) &&
				!text
					.replace(/^`/, "")
					.startsWith("https://codeload.github.com/Praxity/learning-patterns/") &&
				!(
					/(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/)/.test(file) &&
					ts.isArrayLiteralExpression(parent)
				) &&
				![
					"scripts/learning-patterns-admission.mjs",
					"scripts/check-learning-patterns.mjs",
				].includes(file) &&
				!(
					/(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/)/.test(file) &&
					/[\n;]|^\s*(?:import|export|const|let|var|function|\/\/)/.test(text)
				) &&
				!(
					ts.isCallExpression(parent) &&
					ts.isPropertyAccessExpression(parent.expression) &&
					["endsWith", "includes", "startsWith", "lastIndexOf"].includes(
						parent.expression.name.text,
					)
				)
			)
				throw new Error(`Stray learning-patterns specifier/read: ${file}: ${text}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(ast);
	return imports;
}

export function admissionDigest(manifest) {
	return sha256(
		JSON.stringify(
			[...manifest.files]
				.sort((a, b) => a.path.localeCompare(b.path, "en"))
				.map(({ path, sha256, sourceCommit, roles }) => ({ path, sha256, sourceCommit, roles })),
		),
	);
}

export function verificationReceipt(manifest) {
	return `learning-patterns admission verified: ${manifest.files.length} files at ${manifest.files[0].sourceCommit} manifest-sha256 ${admissionDigest(manifest)}`;
}

export function requireVerificationReceipt(stdout) {
	const line = stdout
		.split(/\r?\n/)
		.find((line) =>
			/^learning-patterns admission verified: [1-9]\d* files at [a-f0-9]{40} manifest-sha256 [a-f0-9]{64}$/.test(
				line,
			),
		);
	if (!line) throw new Error("Missing positive learning-patterns verification receipt");
	return line;
}

export async function verifyAdmittedFiles(root) {
	const manifest = await readAdmissionManifest(root);
	const packageRoot = await canonicalPackageRoot(root);
	for (const file of manifest.files) {
		await admittedPath(packageRoot, path.join(packageRoot, file.path));
		if (sha256(await readFile(path.join(packageRoot, file.path))) !== file.sha256)
			throw new Error(`Admission sha256 mismatch: ${file.path}`);
	}
	return manifest;
}

export async function learningPatternsBundleInventory(
	root,
	metafiles,
	role,
	workingDirectory = root,
) {
	if (!metafiles.length || metafiles.some((meta) => !meta?.inputs))
		throw new Error("Bundle admission requires a nonempty metafile collection with inputs");
	const packageRoot = await canonicalPackageRoot(root);
	const files = new Map();
	for (const input of new Set(metafiles.flatMap((meta) => Object.keys(meta.inputs)))) {
		if (/^(?:praxity-runtime:|praxity-privacy:|<)/.test(input)) continue;
		const absolute = path.resolve(workingDirectory, input);
		const resolved = await realpath(absolute);
		if (!resolved.startsWith(`${packageRoot}${path.sep}`)) {
			if (portable(absolute).includes("/node_modules/learning-patterns/"))
				throw new Error(`Outside learning-patterns package: ${input}`);
			continue;
		}
		await admittedPath(
			packageRoot,
			absolute.startsWith(`${packageRoot}${path.sep}`) ? absolute : resolved,
		);
		const relative = await admittedPath(packageRoot, resolved);
		files.set(relative, {
			path: relative,
			sha256: sha256(await readFile(resolved)),
			roles: [relative.endsWith(".css") ? "css" : role],
		});
	}
	return [...files.values()];
}

export async function assertLearningPatternsBundleInputs(
	root,
	metafiles,
	role,
	workingDirectory = root,
) {
	const actual = await learningPatternsBundleInventory(root, metafiles, role, workingDirectory);
	try {
		const manifest = await verifyAdmittedFiles(root);
		for (const file of actual) {
			const entry = manifest.files.find((entry) => entry.path === file.path);
			if (!entry) throw new Error(`Unadmitted bundle input: ${file.path}`);
			if (entry.sha256 !== file.sha256)
				throw new Error(`Bundle admission sha256 mismatch: ${file.path}`);
			if (!entry.roles.includes(file.roles[0]))
				throw new Error(`Bundle admission role mismatch: ${file.path}: ${file.roles[0]}`);
		}
		if (role === "learner-bundle") {
			const reached = new Set(actual.map((file) => file.path));
			for (const entry of manifest.files)
				if (entry.roles.includes(role) && !reached.has(entry.path))
					throw new Error(`Manifest learner input not reached: ${entry.path}`);
		}
	} catch (error) {
		error.code = "LEARNING_PATTERNS_ADMISSION";
		throw error;
	}
	return actual;
}

export async function installedLearningPatternsDigest(root) {
	const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
	const packageRoot = await canonicalPackageRoot(root);
	const hash = createHash("sha256");
	for (const file of manifest.files) {
		await admittedPath(packageRoot, path.join(packageRoot, file.path));
		hash.update(`${file.path}\0${sha256(await readFile(path.join(packageRoot, file.path)))}\n`);
	}
	return hash.digest("hex");
}
