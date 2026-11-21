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
	const configured = getEnv("PRAXITY_STUDIO_TYPST") || undefined;
	const releaseUrl = `https://github.com/typst/typst/releases/tag/v${TESTED_TYPST_VERSION}`;
	const installation =
		platform === "win32"
			? french
				? `Installez Typst ${TESTED_TYPST_VERSION} avec winget install --id Typst.Typst -e --version ${TESTED_TYPST_VERSION}, ou téléchargez l’archive Windows à ${releaseUrl}.`
				: `Install Typst ${TESTED_TYPST_VERSION} with winget install --id Typst.Typst -e --version ${TESTED_TYPST_VERSION}, or download the Windows release archive from ${releaseUrl}.`
			: french
				? `Téléchargez l’archive Typst ${TESTED_TYPST_VERSION} pour votre système à ${releaseUrl}.`
				: `Download the Typst ${TESTED_TYPST_VERSION} release archive for your system from ${releaseUrl}.`;
	const selection =
		explicit !== undefined
			? french
				? "Corrigez l’option typstExecutablePath fournie par l’application."
				: "Correct the host's explicit typstExecutablePath option."
			: configured !== undefined
				? french
					? "Corrigez PRAXITY_STUDIO_TYPST, ou supprimez cette variable pour chercher dans PATH."
					: "Correct PRAXITY_STUDIO_TYPST, or unset it to search PATH."
				: french
					? "Définissez PRAXITY_STUDIO_TYPST avec le chemin de l’exécutable typst, ou ajoutez son dossier à PATH."
					: "Set PRAXITY_STUDIO_TYPST to the Typst executable path, or add its directory to PATH.";
	const windowsNote =
		platform === "win32"
			? french
				? " Les scripts .cmd/.bat ne sont pas pris en charge; choisissez le véritable fichier typst.exe."
				: " Windows .cmd/.bat shims are unsupported; select the real typst.exe."
			: "";
	const fail = (reason: string): never => {
		throw new Error(`${reason} ${installation} ${selection}${windowsNote}`);
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
	const selected = explicit ?? configured;
	let executable: string | undefined;
	if (selected !== undefined) {
		executable = await usable(path.resolve(cwd, selected));
		if (!executable)
			fail(
				french
					? `Exécutable Typst inutilisable : ${JSON.stringify(selected)}.`
					: `Cannot use Typst executable ${JSON.stringify(selected)}.`,
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
		return fail(french ? "Typst est introuvable dans PATH." : "Typst was not found on PATH.");
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
