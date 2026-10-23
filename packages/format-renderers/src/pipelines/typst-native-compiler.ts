import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface CompileOptions {
	pdfStandard?: "ua-1" | "a-2b" | "a-3b";
	/** Host-owned parent for recoverable private compiler workspaces. */
	temporaryRoot?: string;
	executablePath?: string;
	signal?: AbortSignal;
	files?: ReadonlyMap<string, Uint8Array>;
	a11yExtras?: boolean;
}

export class TypstCliUnavailableError extends Error {}

function validateOptions(options: CompileOptions): void {
	options.signal?.throwIfAborted();
	if ("rootDir" in options || "fontPaths" in options) {
		throw new Error(
			"ETYPSTHOSTOPTIONS: rootDir and fontPaths are unsupported; supply assets and fonts through files for private staging.",
		);
	}
	if (options.files !== undefined) {
		for (const filename of options.files.keys()) {
			if (
				!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(filename) ||
				filename.split("/").some((part) => part === "." || part === "..")
			) {
				throw new Error(`Invalid staged Typst path: ${filename}`);
			}
		}
	}
	if (options.executablePath !== undefined && !path.isAbsolute(options.executablePath)) {
		throw new Error("Typst executablePath must be absolute.");
	}
}

/** Native-only entry keeps the optional legacy WASM compiler out of host bundles. */
export async function compileTypstNative(
	source: string,
	options: CompileOptions & { executablePath: string },
): Promise<Buffer> {
	if (!options?.executablePath) throw new Error("The native Typst engine requires executablePath.");
	validateOptions(options);
	try {
		return await compileInWorkspace(source, options);
	} catch (error) {
		options.signal?.throwIfAborted();
		throw error;
	}
}

async function compileInWorkspace(
	source: string,
	options: CompileOptions & { executablePath: string },
): Promise<Buffer> {
	const workingDir = await mkdtemp(path.join(options.temporaryRoot ?? tmpdir(), "praxity-typst-"));
	const inputPath = path.join(workingDir, "input.typ");
	const outputPath = path.join(workingDir, "output.pdf");

	try {
		options.signal?.throwIfAborted();
		for (const [filename, bytes] of options.files ?? []) {
			options.signal?.throwIfAborted();
			const target = path.join(workingDir, filename);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, bytes, { flag: "wx", signal: options.signal });
		}
		await writeFile(inputPath, source, "utf-8");
		const args = ["compile", "--ignore-system-fonts"];
		if (options.a11yExtras) args.push("--features", "a11y-extras");
		if ([...(options.files?.keys() ?? [])].some((file) => file.startsWith("fonts/"))) {
			args.push("--font-path", path.join(workingDir, "fonts"));
		}

		if (options.pdfStandard) {
			args.push("--pdf-standard", options.pdfStandard);
		}

		args.push("--root", workingDir, inputPath, outputPath);

		await new Promise<void>((resolve, reject) => {
			execFile(
				options.executablePath,
				args,
				{
					timeout: 45_000,
					signal: options.signal,
					// The explicit engine must not inherit host Typst, font or package settings.
					env: { LANG: "C.UTF-8" },
				},
				(error: Error | null, _stdout, stderr) => {
					if (options.signal?.aborted) {
						reject(options.signal.reason);
						return;
					}
					if (error) {
						reject(
							(error as NodeJS.ErrnoException).code === "ENOENT"
								? new TypstCliUnavailableError(`Typst CLI unavailable: ${error.message}`, {
										cause: error,
									})
								: new Error(`Typst compilation failed: ${stderr || error.message}`, {
										cause: error,
									}),
						);
						return;
					}
					if (stderr.trim()) {
						reject(new Error(`Typst compilation diagnostics: ${stderr.trim()}`));
						return;
					}
					resolve();
				},
			);
		});

		options.signal?.throwIfAborted();
		return await readFile(outputPath, { signal: options.signal });
	} finally {
		await rm(workingDir, { recursive: true, force: true });
	}
}
