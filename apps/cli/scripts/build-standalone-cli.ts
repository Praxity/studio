import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleViewer } from "../../../packages/export-pipeline/src/bundle-viewer";
import {
	desktopExportInputs,
	preparedExportAssetPaths,
	verifyPreparedExportAssets,
} from "../../../packages/export-pipeline/src/export-assets";
import { assertLearningPatternsBundleInputs } from "../../../scripts/learning-patterns-admission.mjs";
import { STANDALONE_NODE_RANGE } from "../src/main/node-runtime";
import {
	filesIn,
	inventoryPayload,
	packagePraxFormat,
	STUDIO_BROWSER_COMPONENT,
} from "./standalone-cli-packaging.mjs";
import { portablePath } from "./standalone-cli-paths.mjs";

const legalFiles = ["LICENSE", "LICENSING.md"];
const platform = process.platform;
const arch = process.env.TYPST_ARCH ?? process.arch;

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = path.resolve(desktopDir, "../..");
execFileSync(process.execPath, [path.join(repoDir, "scripts/check-learning-patterns.mjs")], {
	stdio: "inherit",
});
const reviewDir = path.join(repoDir, "dist/studio-cli-review");
const outputDir = path.resolve(desktopDir, "../../dist/studio-cli");
const assetsDir = path.join(desktopDir, "resources/export-assets");
const { version } = JSON.parse(await readFile(path.join(desktopDir, "package.json"), "utf8"));
const metadata = JSON.parse(await readFile(path.join(assetsDir, "viewer.version.json"), "utf8"));
await verifyPreparedExportAssets(assetsDir, version);
const viewerInputs: string[] = [];
await bundleViewer(assetsDir, (inputs) => viewerInputs.push(...inputs));
const packageRoots = new Set<string>();
const runtimePackages: { name: string; version: string; path: string }[] = [];
const inputFiles = new Set<string>();
const inputRoles = new Map<string, Set<string>>();
const virtualInputs = new Set<string>();
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function recordInput(
	file: string,
	role = "course-delivery-runtime-and-inputs",
): Promise<void> {
	if (file.startsWith("\0") || (file.startsWith("<") && file.endsWith(">"))) {
		virtualInputs.add(file);
		return;
	}
	const resolved = await realpath(path.resolve(file));
	inputFiles.add(resolved);
	const roles = inputRoles.get(resolved) ?? new Set<string>();
	roles.add(portablePath(resolved).includes("/node_modules/") ? "third-party" : role);
	if (role === STUDIO_BROWSER_COMPONENT) roles.add(role);
	inputRoles.set(resolved, roles);
	const match = resolved.match(/^(.*[/\\]node_modules[/\\](?:@[^/\\]+[/\\])?[^/\\]+)/);
	if (match) packageRoots.add(match[1]);
}
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
execFileSync(
	process.execPath,
	[
		path.join(desktopDir, "scripts/prepare-typst.mjs"),
		"--platform",
		platform,
		"--arch",
		arch,
		"--assetsOnly",
		"--output",
		path.join(outputDir, "typst"),
	],
	{ stdio: "inherit" },
);
const bundle = await build({
	entryPoints: { praxity: path.join(desktopDir, "src/main/standalone-cli.ts") },
	outdir: outputDir,
	outExtension: { ".js": ".mjs" },
	splitting: true,
	bundle: true,
	metafile: true,
	platform: "node",
	format: "esm",
	target: "node24",
	minify: true,
	sourcemap: false,
	external: ["isomorphic-dompurify", "jsdom"],
	banner: {
		js: '#!/usr/bin/env node\nimport { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
	},
	define: {
		"process.env.NODE_ENV": '"production"',
		"process.env.PRAXITY_APP_VERSION": JSON.stringify(version),
		"process.env.PRAXITY_VIEWER_SOURCE_HASH": JSON.stringify(metadata.viewerSourceHash),
	},
});
async function copyRuntimePackage(
	name: string,
	from: string,
	destination: string,
	ancestors = new Set<string>(),
): Promise<void> {
	const require = createRequire(from);
	let entry: string;
	try {
		entry = require.resolve(`${name}/package.json`);
	} catch {
		entry = require.resolve(name);
	}
	let source = path.dirname(entry);
	let manifest: { name: string; version: string; dependencies?: Record<string, string> };
	while (true) {
		try {
			manifest = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
			if (manifest.name === name) break;
		} catch {}
		const parent = path.dirname(source);
		if (parent === source) throw new Error(`Cannot locate package ${name}`);
		source = parent;
	}
	await recordInput(path.join(source, "package.json"));
	const key = `${name}@${manifest.version}`;
	if (ancestors.has(key)) return;
	const target = path.join(destination, "node_modules", name);
	runtimePackages.push({
		name,
		version: manifest.version,
		path: portablePath(path.relative(outputDir, target)),
	});
	await cp(source, target, {
		recursive: true,
		dereference: true,
		filter: (file) => path.basename(file) !== "node_modules" && !file.endsWith(".map"),
	});
	for (const file of await filesIn(target))
		await recordInput(path.join(source, path.relative(target, file)), "third-party");
	for (const dependency of Object.keys(manifest.dependencies ?? {})) {
		await copyRuntimePackage(
			dependency,
			path.join(source, "package.json"),
			target,
			new Set([...ancestors, key]),
		);
	}
}
await copyRuntimePackage(
	"isomorphic-dompurify",
	path.resolve(desktopDir, "../../packages/shared-blocks/package.json"),
	outputDir,
);
const assetFiles = new Set(await preparedExportAssetPaths(assetsDir));
assetFiles.add("inspection-frame.js");
for (const file of JSON.parse(
	await readFile(path.join(assetsDir, "inspection-frame.inputs.json"), "utf8"),
) as string[])
	await recordInput(path.join(repoDir, file), STUDIO_BROWSER_COMPONENT);
await copyRuntimePackage("jsdom", path.join(desktopDir, "package.json"), outputDir);
await assertLearningPatternsBundleInputs(
	repoDir,
	[bundle.metafile],
	"node-build-time",
	process.cwd(),
);
for (const file of Object.keys(bundle.metafile.inputs)) await recordInput(file, "studio-module");
for (const file of viewerInputs) await recordInput(file);
for (const input of await desktopExportInputs()) {
	await recordInput(
		input.source,
		input.assetPath.startsWith("image-codecs/notices/")
			? "third-party-notice-provenance"
			: "course-delivery-runtime-and-inputs",
	);
}
for (const file of [...assetFiles].sort()) {
	if (path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
		throw new Error(`Invalid asset path: ${file}`);
	const target = path.join(outputDir, "export-assets", file);
	await mkdir(path.dirname(target), { recursive: true });
	await cp(path.join(assetsDir, file), target);
}
const dependencies: { name: string; version: string; license?: string; notices: string[] }[] = [];
dependencies.push({
	name: "mitex",
	version: "0.2.7",
	license: "Apache-2.0",
	notices: ["typst/mitex/LICENSE"],
});
for (const directory of [...packageRoots].sort()) {
	await recordInput(path.join(directory, "package.json"), "third-party-notice-provenance");
	const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
	const target = path.join(
		outputDir,
		"licenses",
		`${pkg.name.replaceAll("/", "-")}@${pkg.version}`,
	);
	await mkdir(target, { recursive: true });
	await writeFile(
		path.join(target, "package.json"),
		JSON.stringify({ name: pkg.name, version: pkg.version, license: pkg.license }, null, 2),
	);
	const notices: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (/^(licen[cs]e|notice|copying|ofl|readme)([._-]|$)/i.test(entry.name)) {
			const source = path.join(directory, entry.name);
			for (const file of entry.isDirectory() ? await filesIn(source) : [source])
				await recordInput(file, "third-party-notice-provenance");
			await cp(source, path.join(target, entry.name), { recursive: true });
			notices.push(portablePath(path.relative(outputDir, path.join(target, entry.name))));
		}
	}
	if (["saxes@6.0.0", "react-remove-scroll-bar@2.3.8"].includes(`${pkg.name}@${pkg.version}`)) {
		const supplement = path.join(
			desktopDir,
			"resources/third-party-notices",
			`${pkg.name}@${pkg.version}`,
		);
		for (const file of await filesIn(supplement)) {
			await cp(file, path.join(target, path.basename(file)));
			notices.push(portablePath(path.relative(outputDir, path.join(target, path.basename(file)))));
			await recordInput(file, "third-party-notice-provenance");
		}
	}
	dependencies.push({ name: pkg.name, version: pkg.version, license: pkg.license, notices });
}
await mkdir(path.join(outputDir, "legal"), { recursive: true });
for (const filename of legalFiles) {
	await cp(path.join(repoDir, filename), path.join(outputDir, "legal", filename));
}
for (const file of await packagePraxFormat(path.join(repoDir, "docs/prax-format"), outputDir))
	await recordInput(file, "prax-format-documentation");
await writeFile(
	path.join(outputDir, "package.json"),
	JSON.stringify(
		{
			name: "@praxity/studio",
			version,
			private: true,
			bin: { praxity: "praxity.mjs" },
			license: "MIT",
			repository: { type: "git", url: "https://github.com/Praxity/studio.git" },
			files: [
				"*.mjs",
				"export-assets/",
				"typst/",
				"legal/",
				"licenses/",
				"prax-format/",
				"inventory.json",
			],
			dependencies: Object.fromEntries(
				runtimePackages
					.filter((pkg) => !pkg.path.slice("node_modules/".length).includes("node_modules/"))
					.map((pkg) => [pkg.name, pkg.version]),
			),
			bundleDependencies: ["isomorphic-dompurify", "jsdom"],
			type: "module",
			engines: { node: STANDALONE_NODE_RANGE },
		},
		null,
		2,
	),
);
const payload = await inventoryPayload(outputDir, repoDir, { platform, arch });
for (const file of [
	"pnpm-lock.yaml",
	"package.json",
	"apps/cli/package.json",
	"apps/cli/scripts/build-standalone-cli.ts",
	"apps/cli/scripts/standalone-cli-paths.mjs",
	"apps/cli/scripts/standalone-cli-packaging.mjs",
	"apps/cli/scripts/prepare-typst.mjs",
	"apps/cli/resources/third-party-notices/typst-assets-0.15.1/NOTICE",
	"apps/cli/scripts/prebuild-viewer.ts",
	"packages/export-pipeline/src/bundle-viewer.ts",
	"packages/export-pipeline/src/export-css.ts",
	"packages/export-pipeline/src/export-assets.ts",
	"packages/export-pipeline/src/third-party-notices.ts",
])
	await recordInput(path.join(repoDir, file), "private-build-tooling");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: repoDir,
	encoding: "utf8",
}).trim();
const inventory = {
	schemaVersion: 1,
	name: "@praxity/studio",
	version,
	distribution: "npm-tarball",
	license: "MIT",
	sourceRevision,
	sourceTreeDirty: Boolean(
		execFileSync("git", ["status", "--porcelain"], { cwd: repoDir, encoding: "utf8" }).trim(),
	),
	node: STANDALONE_NODE_RANGE,
	buildNode: process.version,
	entrypoint: "praxity.mjs",
	legal: legalFiles.map((filename) => `legal/${filename}`),
	...payload,
	dependencies,
	runtimePackages,
};
await writeFile(path.join(outputDir, "inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
await mkdir(reviewDir, { recursive: true });
const inputs = [];
for (const file of [...inputFiles].sort()) {
	inputs.push({
		path: path.relative(repoDir, file).split(path.sep).join("/"),
		components: [...(inputRoles.get(file) ?? [])].sort(),
		sha256: sha256(await readFile(file)),
	});
}
await writeFile(
	path.join(reviewDir, "build-inputs.json"),
	`${JSON.stringify(
		{
			sourceRevision,
			virtualInputs: [...virtualInputs].sort(),
			sourceTreeDirty: inventory.sourceTreeDirty,
			artifactInventorySha256: sha256(await readFile(path.join(outputDir, "inventory.json"))),
			inputs,
		},
		null,
		2,
	)}\n`,
);
console.log(outputDir);
