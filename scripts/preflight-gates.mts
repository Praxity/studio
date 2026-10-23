import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { parseEnv } from "node:util";
import {
	RUSTICI_FILES,
	resolveXmllint,
	rusticiDriverDir,
} from "../packages/export-pipeline/tests/gate-prerequisites";

interface Probe {
	command: (file: string, args: string[]) => Promise<string | undefined>;
	isFile: (path: string) => Promise<boolean>;
	read: (path: string) => Promise<string>;
	browser: (name: "chromium" | "firefox" | "webkit") => Promise<{ path: string; version: string }>;
	cloud: (appId: string, secretKey: string) => Promise<number>;
}

interface Summary {
	checkedAt: string;
	versions: Record<string, string>;
	checks: Record<string, { present: boolean; path?: string; version?: string; status?: number }>;
	credentials: { appIdLength: number; secretKeyLength: number };
	missing: string[];
}

function systemProbe(root: string): Probe {
	return {
		command: (file, args) =>
			new Promise((done) => {
				execFile(file, args, { timeout: 15_000, windowsHide: true }, (error, stdout, stderr) => {
					done(error ? undefined : `${stdout}${stderr}`.trim());
				});
			}),
		isFile: async (path) => {
			try {
				return (await stat(path)).isFile();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
				throw error;
			}
		},
		read: (path) => readFile(path, "utf8"),
		browser: async (name) => {
			const require = createRequire(join(root, "packages/export-pipeline/package.json"));
			const playwright = require("@playwright/test");
			const browser = await playwright[name].launch({ headless: true, timeout: 15_000 });
			try {
				return { path: playwright[name].executablePath(), version: browser.version() };
			} finally {
				await browser.close();
			}
		},
		cloud: async (appId, secretKey) => {
			const response = await fetch("https://cloud.scorm.com/api/v2/courses?limit=1", {
				headers: {
					Authorization: `Basic ${Buffer.from(`${appId}:${secretKey}`).toString("base64")}`,
				},
				signal: AbortSignal.timeout(15_000),
				redirect: "error",
			});
			await response.body?.cancel();
			return response.status;
		},
	};
}

export async function collectGatePreflight({
	root,
	env = process.env,
	// Worktrees have no .env; PRAXITY_ENV_FILE points at the clone that holds it.
	credentialsPath = env.PRAXITY_ENV_FILE ?? join(root, ".env"),
	probe = systemProbe(root),
}: {
	root: string;
	env?: NodeJS.ProcessEnv;
	credentialsPath?: string;
	probe?: Probe;
}): Promise<Summary> {
	const summary: Summary = {
		checkedAt: new Date().toISOString(),
		versions: { node: process.version },
		checks: {},
		credentials: { appIdLength: 0, secretKeyLength: 0 },
		missing: [],
	};
	const record = (name: string, check: Summary["checks"][string]) => {
		summary.checks[name] = check;
		if (!check.present) summary.missing.push(name);
	};
	try {
		const pkg = JSON.parse(await probe.read(join(root, "package.json")));
		summary.versions.nodeRequired = pkg.engines.node;
		summary.versions.pnpmRequired = pkg.packageManager;
		const lock = await probe.read(join(root, "pnpm-lock.yaml"));
		const version = /^lockfileVersion:\s*['"]?([^'"\s]+)/m.exec(lock)?.[1];
		record("lockfile", { present: Boolean(version), version });
		if (version) summary.versions.lockfile = version;
	} catch {
		record("package metadata / lockfile", { present: false });
	}
	// pnpm is a .cmd shim on Windows. Run its JS entry point with Node, without a shell.
	const pnpmVersion = env.npm_execpath
		? await probe.command(process.execPath, [env.npm_execpath, "--version"])
		: await probe.command("pnpm", ["--version"]);
	if (pnpmVersion) summary.versions.pnpm = pnpmVersion;
	record("pnpm", { present: Boolean(pnpmVersion), version: pnpmVersion });
	for (const [name, label] of [
		["chromium", "Chromium"],
		["firefox", "Firefox"],
		["webkit", "WebKit"],
	] as const) {
		try {
			record(label, { present: true, ...(await probe.browser(name)) });
		} catch {
			record(label, { present: false });
		}
	}
	for (const [name, path] of [
		[
			"Typst",
			env.PRAXITY_TEST_TYPST ??
				join(
					root,
					"apps/desktop/resources/typst",
					process.platform === "win32" ? "typst.exe" : "typst",
				),
		],
		["xmllint", resolveXmllint(env)],
	]) {
		const version = await probe.command(path, ["--version"]);
		record(name, { present: Boolean(version), path, version });
	}
	for (const format of ["scorm12", "scorm2004"] as const) {
		const path = rusticiDriverDir(format, env);
		const present = (
			await Promise.all(RUSTICI_FILES.map((file) => probe.isFile(join(path, file))))
		).every(Boolean);
		record(`Rustici ${format}`, { present, path });
	}
	const java = env.PRAXITY_JAVA;
	const javaVersion = java?.trim() ? await probe.command(java, ["-version"]) : undefined;
	record("Java", { present: Boolean(javaVersion), path: java, version: javaVersion });
	const validator = env.PRAXITY_ADL_VALIDATOR;
	record("ADL Manifest Tester", {
		present: Boolean(validator?.trim()) && (await probe.isFile(validator as string)),
		path: validator,
	});
	const nvdaPaths = [
		env.PRAXITY_NVDA,
		join(
			env.ProgramFiles ?? join(env.SystemDrive ?? parse(process.execPath).root, "Program Files"),
			"NVDA/nvda.exe",
		),
		join(
			env["ProgramFiles(x86)"] ??
				join(env.SystemDrive ?? parse(process.execPath).root, "Program Files (x86)"),
			"NVDA/nvda.exe",
		),
	].filter((path): path is string => Boolean(path));
	let nvdaPath: string | undefined;
	for (const path of nvdaPaths)
		if (await probe.isFile(path)) {
			nvdaPath = path;
			break;
		}
	record("NVDA", { present: Boolean(nvdaPath), path: nvdaPath });
	// Only lengths enter the summary. Never persist the env source, response body or exception.
	let credentials: Record<string, string | undefined> = {};
	try {
		credentials = parseEnv(await probe.read(credentialsPath));
	} catch {
		/* Missing/unreadable credentials are reported individually below. */
	}
	const appId = credentials.SCORM_CLOUD_APP_ID ?? "";
	const secretKey = credentials.SCORM_CLOUD_SECRET_KEY ?? "";
	summary.credentials = { appIdLength: appId.length, secretKeyLength: secretKey.length };
	record("SCORM_CLOUD_APP_ID", { present: appId.length > 0 });
	record("SCORM_CLOUD_SECRET_KEY", { present: secretKey.length > 0 });
	if (appId && secretKey) {
		try {
			const status = await probe.cloud(appId, secretKey);
			record("SCORM Cloud API", { present: status >= 200 && status < 300, status });
		} catch {
			record("SCORM Cloud API", { present: false });
		}
	} else {
		record("SCORM Cloud API", { present: false });
	}
	return summary;
}

export function reportGatePreflight(summary: Summary, emit: (line: string) => void): number {
	emit(JSON.stringify(summary, null, 2));
	for (const item of summary.missing) emit(`Missing gate prerequisite: ${item}`);
	return summary.missing.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	try {
		const root = resolve(import.meta.dirname, "..");
		const summary = await collectGatePreflight({ root });
		const output =
			process.env.PRAXITY_PREFLIGHT_JSON ?? join(root, "test-results/gates/preflight.json");
		await mkdir(dirname(output), { recursive: true });
		await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
		process.exitCode = reportGatePreflight(summary, console.log);
	} catch {
		console.error("Gate preflight could not complete or write its JSON summary.");
		process.exitCode = 1;
	}
}
