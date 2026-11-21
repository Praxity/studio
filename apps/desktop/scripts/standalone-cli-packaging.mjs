import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { selectTypstRelease } from "./prepare-typst.mjs";
import { assertNoPrivateCheckoutPath, portablePath } from "./standalone-cli-paths.mjs";

export const STUDIO_BROWSER_COMPONENT = "studio-browser-editor";

export function assertCanvasInputs(inputs) {
	for (const input of inputs) {
		const file = portablePath(input).split("?")[0];
		if (
			/(?:^|\/)renderer\/(?:App|EditorView)\.tsx$/.test(file) ||
			/(?:^|\/)renderer\/browser\/bridge\.ts$/.test(file) ||
			/(?:^|\/)renderer\/components\/(?:lens|course-map)\//.test(file) ||
			/(?:^|\/)editor-core\/src\/shortcuts\/regions\.ts$/.test(file) ||
			/(?:^|\/)editor-core\/src\/(?:session|frame-bridge)\//.test(file) ||
			/(?:^|\/)renderer\/new-editor\/(?:draft-persistence|lesson-session|project-sessions)\.ts$/.test(
				file,
			) ||
			/(?:^|\/)main\/operations\/local-editor-store\.ts$/.test(file)
		)
			throw new Error(`Forbidden canvas dependency: ${file}`);
	}
}

export function canvasBundlePlugin(entry) {
	const api = { inputs: [] };
	return {
		name: "studio-canvas-bundle",
		api,
		async generateBundle() {
			const { build } = await import("esbuild");
			const result = await build({
				entryPoints: [entry],
				bundle: true,
				write: false,
				metafile: true,
				format: "iife",
				globalName: "PraxityCanvas",
				platform: "browser",
				target: "esnext",
				minify: true,
				sourcemap: false,
			});
			const inputs = Object.keys(result.metafile.inputs);
			assertCanvasInputs(inputs);
			api.inputs = inputs.map((file) => path.resolve(file));
			this.emitFile({
				type: "asset",
				fileName: "canvas.js",
				source: result.outputFiles[0].text,
			});
			this.emitFile({
				type: "asset",
				fileName: "canvas.sha256",
				source: `${createHash("sha256").update(result.outputFiles[0].contents).digest("hex")}\n`,
			});
		},
	};
}

export function assertStandaloneTarget(platform, arch) {
	if (platform !== "darwin" && platform !== "win32")
		throw new Error(`Unsupported standalone CLI platform: ${platform}`);
	selectTypstRelease(platform, arch);
}

export async function filesIn(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await filesIn(file)));
		else if (entry.isFile()) files.push(file);
		else throw new Error(`Unexpected non-regular artifact file: ${file}`);
	}
	return files.sort();
}

export async function packagePraxFormat(sourceDir, outputDir) {
	const sources = ["SKILL.md", "README.md", "inline-icons.md", "cli.md", "LICENSE"].map((file) =>
		path.join(sourceDir, file),
	);
	for (const directory of ["skill", "reference", "examples"])
		sources.push(...(await filesIn(path.join(sourceDir, directory))));
	for (const source of sources.sort()) {
		const target = path.join(outputDir, "prax-format", path.relative(sourceDir, source));
		await mkdir(path.dirname(target), { recursive: true });
		await cp(source, target);
	}
	return sources;
}

export async function inventoryPayload(outputDir, repoDir, { platform, arch }) {
	assertStandaloneTarget(platform, arch);
	const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
	const files = [];
	for (const file of await filesIn(outputDir)) {
		const relative = portablePath(path.relative(outputDir, file));
		if (relative.endsWith(".map")) throw new Error(`Unexpected artifact source map: ${relative}`);
		const bytes = await readFile(file);
		assertNoPrivateCheckoutPath(bytes, relative, repoDir);
		files.push({
			path: relative,
			bytes: bytes.length,
			sha256: sha256(bytes),
			component:
				relative.startsWith("node_modules/") ||
				relative.startsWith("typst/") ||
				relative.startsWith("licenses/") ||
				relative.startsWith("export-assets/image-codecs/")
					? "third-party"
					: relative.startsWith("legal/")
						? "operative-legal-notice"
						: relative.startsWith("prax-format/")
							? "prax-format-documentation"
							: relative === "export-assets/inspection-frame.js"
								? STUDIO_BROWSER_COMPONENT
								: relative.startsWith("export-assets/")
									? "course-delivery-runtime-and-inputs"
									: relative.startsWith("editor/")
										? STUDIO_BROWSER_COMPONENT
										: "studio-module",
		});
	}
	return { platform, arch, payloadSha256: sha256(JSON.stringify(files)), files };
}
