import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Metafile } from "esbuild";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export interface PackageNotice {
	name: string;
	version: string;
	texts: Record<string, string>;
}

export interface RuntimeNotices {
	packages: Record<string, PackageNotice>;
	outputs: Record<string, string[]>;
}

export function assertPackageNotice(
	notice: PackageNotice | undefined,
	input: string,
): asserts notice is PackageNotice {
	if (
		!notice?.texts ||
		!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(notice.name) ||
		!/^[a-z0-9.+_-]+$/i.test(notice.version) ||
		!Object.entries(notice.texts).some(
			([filename, text]) =>
				/^(licen[cs]e|copying|ofl)([._-]|$)/i.test(filename) &&
				typeof text === "string" &&
				text.trim(),
		)
	)
		throw new Error(
			`Missing required third-party notices: ${input}${notice?.texts ? "" : ".texts"}. Rebuild the export assets.`,
		);
}

/** Shared by export consumption and complete prepared-asset verification. */
export function assertRuntimeLegalInputs(
	manifest: { courseRuntimeLicense?: string; thirdPartyNotices?: RuntimeNotices },
	assetPaths: string[],
	selectablePackages: string[] = [],
): asserts manifest is { courseRuntimeLicense: string; thirdPartyNotices: RuntimeNotices } {
	if (typeof manifest.courseRuntimeLicense !== "string" || !manifest.courseRuntimeLicense.trim())
		throw new Error(
			"Missing course runtime permission notice: viewer-manifest.json#courseRuntimeLicense. Rebuild the export assets.",
		);
	const notices = manifest.thirdPartyNotices;
	for (const [field, value] of [
		["thirdPartyNotices", notices],
		["thirdPartyNotices.packages", notices?.packages],
		["thirdPartyNotices.outputs", notices?.outputs],
	] as const) {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error(
				`Missing required third-party notices: viewer-manifest.json#${field}. Rebuild the export assets.`,
			);
	}
	const packages = new Set(selectablePackages);
	for (const file of assetPaths) {
		const names = notices?.outputs[file];
		if (!Array.isArray(names))
			throw new Error(
				`Missing third-party notice mapping: viewer-manifest.json#thirdPartyNotices.outputs.${file}`,
			);
		for (const name of names) packages.add(name);
	}
	for (const name of packages)
		assertPackageNotice(
			notices?.packages[name],
			`viewer-manifest.json#thirdPartyNotices.packages.${name}`,
		);
}

/** Packages selected later by CSS generation and server-rendered markup. */
export async function selectableRuntimeNoticeInputs(): Promise<string[]> {
	const manifest = JSON.parse(
		await readFile(path.resolve(repoRoot, "packages/export-pipeline/package.json"), "utf8"),
	);
	const sharedRequire = createRequire(path.join(repoRoot, "packages/shared-blocks/package.json"));
	return [
		require.resolve("@mantine/core/styles.css"),
		require.resolve("prism-react-renderer"),
		sharedRequire.resolve("katex"),
		...[
			"@tabler/icons",
			...Object.keys(manifest.dependencies).filter((name) => name.startsWith("@fontsource/")),
		].map((name) =>
			path.join(repoRoot, "packages/export-pipeline/node_modules", name, "package.json"),
		),
	];
}

/** Read upstream text verbatim. Never substitute a licence identifier for its terms. */
export async function readPackageNotice(input: string): Promise<PackageNotice> {
	let directory = path.dirname(path.resolve(input));
	let metadata: { name: string; version: string } | undefined;
	while (!metadata) {
		const file = path.join(directory, "package.json");
		if (existsSync(file)) {
			const parsed = JSON.parse(await readFile(file, "utf8"));
			if (typeof parsed.name === "string" && typeof parsed.version === "string") metadata = parsed;
			else if (parsed.name !== undefined || parsed.version !== undefined)
				throw new Error(`Invalid package metadata for notice: ${input}`);
			// A nested {type:"module"} file sets module scope, not package ownership.
		}
		if (metadata) break;
		const parent = path.dirname(directory);
		if (parent === directory || path.basename(directory) === "node_modules")
			throw new Error(`Missing package metadata for notice: ${input}`);
		directory = parent;
	}
	const { name, version } = metadata;
	const texts: Record<string, string> = {};
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isFile() && /^(licen[cs]e|notice|copying|ofl|copyright)([._-]|$)/i.test(entry.name)) {
			texts[entry.name] = await readFile(path.join(directory, entry.name), "utf8");
		}
	}
	const supplement = path.join(
		repoRoot,
		"apps/desktop/resources/third-party-notices",
		`${name}@${version}`,
	);
	if (existsSync(supplement)) {
		for (const filename of await readdir(supplement)) {
			texts[filename] = await readFile(path.join(supplement, filename), "utf8");
		}
	}
	if (
		!Object.entries(texts).some(
			([filename, text]) => /^(licen[cs]e|copying|ofl)([._-]|$)/i.test(filename) && text.trim(),
		)
	) {
		throw new Error(`Missing third-party license text: ${name}@${version}`);
	}
	return { name, version, texts };
}

/** The metadata travels with prebuilt assets; export never needs installed dependencies. */
export async function collectRuntimeNotices(
	metafiles: Metafile[],
	outDir: string,
): Promise<RuntimeNotices> {
	const packages: Record<string, PackageNotice> = {};
	const outputs: Record<string, string[]> = {};
	const byInput = new Map<string, string>();
	for (const metafile of metafiles) {
		for (const [output, metadata] of Object.entries(metafile.outputs)) {
			const names = new Set<string>();
			for (const [input, contribution] of Object.entries(metadata.inputs)) {
				if (!contribution.bytesInOutput) continue;
				let name = byInput.get(input);
				if (!name) {
					let notice: PackageNotice;
					if (
						path.resolve(input) ===
						path.join(repoRoot, "packages/shared-blocks/src/blocks/shared-blocks.css")
					) {
						// The embedded signature cursor contributes artwork outside node_modules.
						notice = {
							name: "feather-icons",
							version: "4.29.2",
							texts: {
								LICENSE: await readFile(
									path.join(
										repoRoot,
										"apps/desktop/resources/third-party-notices/feather-icons@4.29.2/LICENSE",
									),
									"utf8",
								),
							},
						};
					} else if (
						path.dirname(path.resolve(input)) ===
							path.join(repoRoot, "packages/export-pipeline/src/patterns/highlight") &&
						["render.ts", "enhance.ts", "style.css"].includes(path.basename(input))
					) {
						// Copied presentation needs MIT attribution even without an upstream JS import.
						notice = {
							name: "learning-patterns",
							version: "0.1.0",
							texts: {
								LICENSE: await readFile(
									path.join(repoRoot, "packages/export-pipeline/src/patterns/highlight/LICENSE"),
									"utf8",
								),
							},
						};
					} else if (input.includes("node_modules/")) notice = await readPackageNotice(input);
					else continue;
					name = `${notice.name}@${notice.version}`;
					packages[name] = notice;
					byInput.set(input, name);
				}
				names.add(name);
			}
			outputs[path.relative(outDir, path.resolve(output)).split(path.sep).join("/")] = [
				...names,
			].sort();
		}
	}
	for (const input of await selectableRuntimeNoticeInputs()) {
		const notice = await readPackageNotice(input);
		packages[notice.name] = notice;
	}
	return { packages, outputs };
}

export async function writePackageNotice(
	outputDir: string,
	notice: PackageNotice | undefined,
): Promise<void> {
	assertPackageNotice(notice, "viewer-manifest.json#thirdPartyNotices.packages");
	const noticeDir = path.join(outputDir, "third-party-notices");
	await mkdir(noticeDir, { recursive: true });
	const text = `${notice.name}@${notice.version}\n\n${Object.entries(notice.texts)
		.map(([filename, contents]) => `===== ${filename} =====\n${contents}`)
		.join("\n\n")}`;
	await writeFile(
		path.join(noticeDir, `${notice.name.replaceAll("/", "-")}@${notice.version}.txt`),
		text,
	);
}
