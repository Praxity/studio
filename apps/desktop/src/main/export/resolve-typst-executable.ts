import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const TESTED_TYPST_VERSION = "0.15.1";

const runVersion = (executable: string): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(executable, ["--version"], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout.trim());
		});
	});

export async function resolveTypstExecutable(
	explicit?: string,
	options: {
		env?: NodeJS.ProcessEnv;
		platform?: NodeJS.Platform;
		cwd?: string;
		locale?: "en" | "fr";
		runVersion?: (executable: string) => Promise<string>;
	} = {},
): Promise<string> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const cwd = options.cwd ?? process.cwd();
	const getEnv = (key: string) =>
		platform === "win32"
			? Object.entries(env).find(([name]) => name.toUpperCase() === key)?.[1]
			: env[key];
	const french = options.locale === "fr";
	const guidance = french
		? `Installez Typst ${TESTED_TYPST_VERSION} avec les installateurs officiels (winget install --id Typst.Typst ou brew install typst), ou l’archive à https://github.com/typst/typst#installation. Définissez PRAXITY_STUDIO_TYPST avec le véritable exécutable typst.exe sous Windows ou typst.`
		: `Install Typst ${TESTED_TYPST_VERSION} using the official installers (winget install --id Typst.Typst or brew install typst), or the release archive at https://github.com/typst/typst#installation. Set PRAXITY_STUDIO_TYPST to the real typst.exe on Windows or typst executable.`;
	const fail = (reason: string): never => {
		throw new Error(`${reason} ${guidance}`);
	};
	const usable = async (candidate: string) => {
		if (platform === "win32" && ![".exe", ".com"].includes(path.extname(candidate).toLowerCase()))
			return undefined;
		try {
			if (!(await stat(candidate)).isFile()) return undefined;
			await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
			const resolved = await realpath(candidate);
			if (platform === "win32" && ![".exe", ".com"].includes(path.extname(resolved).toLowerCase()))
				return undefined;
			return resolved;
		} catch (error) {
			if (["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
				return undefined;
			throw error;
		}
	};
	const selected = explicit ?? (getEnv("PRAXITY_STUDIO_TYPST") || undefined);
	let executable: string | undefined;
	if (selected !== undefined) {
		executable = await usable(path.resolve(cwd, selected));
		if (!executable)
			fail(
				french
					? `Exécutable Typst inutilisable : ${JSON.stringify(selected)}. Les scripts Windows .cmd/.bat ne sont pas pris en charge.`
					: `Cannot use Typst executable ${JSON.stringify(selected)}. Windows .cmd/.bat shims are unsupported.`,
			);
	} else {
		const extensions = platform === "win32" ? [".exe", ".com"] : [""];
		for (const directory of (getEnv("PATH") ?? "")
			.split(platform === "win32" ? ";" : ":")
			.filter(Boolean)) {
			for (const extension of extensions) {
				executable = await usable(
					path.resolve(cwd, directory.replace(/^"|"$/g, ""), `typst${extension}`),
				);
				if (executable) break;
			}
			if (executable) break;
		}
	}
	if (!executable)
		return fail(
			french
				? "Typst est introuvable dans PATH. Les scripts Windows .cmd/.bat ne sont pas pris en charge."
				: "Typst was not found on PATH. Windows .cmd/.bat shims are unsupported.",
		);
	let version: string;
	try {
		version = await (options.runVersion ?? runVersion)(executable);
	} catch (error) {
		return fail(
			`${french ? "Impossible de lancer Typst" : "Cannot run Typst"}: ${error instanceof Error ? error.message : String(error)}.`,
		);
	}
	if (version.match(/^typst (\S+)(?:\s|$)/)?.[1] !== TESTED_TYPST_VERSION)
		fail(
			french
				? `Typst ${TESTED_TYPST_VERSION} est requis; version trouvée : ${JSON.stringify(version)}.`
				: `Typst ${TESTED_TYPST_VERSION} is required; found ${JSON.stringify(version)}.`,
		);
	return executable;
}
