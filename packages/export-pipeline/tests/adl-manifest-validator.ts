import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

interface AdlManifestTools {
	java: string;
	validator: string;
}

export function resolveAdlManifestTools(
	env: NodeJS.ProcessEnv = process.env,
): AdlManifestTools | undefined {
	const missing = ["PRAXITY_JAVA", "PRAXITY_ADL_VALIDATOR"].filter((name) => !env[name]?.trim());
	if (missing.length) {
		if (env.PRAXITY_GATE === "1") {
			throw new Error(`ADL Manifest Tester requires ${missing.join(" and ")}.`);
		}
		return undefined;
	}
	return {
		java: env.PRAXITY_JAVA as string,
		validator: resolve(env.PRAXITY_ADL_VALIDATOR as string),
	};
}

export function assertAdlManifestPassed(result: {
	status: number | null;
	stdout: string | null;
	stderr: string | null;
	error?: Error;
}): void {
	const stdout = result.stdout ?? "";
	const count = (label: string) => {
		const matches = [
			...stdout.matchAll(new RegExp(`^${label}[ \\t]*:[ \\t]*(\\d+)[ \\t]*\\r?$`, "gm")),
		];
		return matches.length === 1 ? Number(matches[0][1]) : undefined;
	};
	// ADL exits zero for invalid manifests. Its summary and checkpoint marker decide passage.
	if (
		result.error ||
		result.status !== 0 ||
		result.stderr?.trim() ||
		count("Total Files Tested") !== 1 ||
		count("Total Passed") !== 1 ||
		count("Total Failed") !== 0 ||
		!/^The Manifest Test Subject Passed All Checkpoints\r?$/m.test(stdout) ||
		/^\s*FAILED\s*:/m.test(stdout)
	) {
		throw new Error(
			`ADL Manifest Tester failed: ${result.error?.message ?? `exit ${result.status}`}\n${stdout}\n${result.stderr ?? ""}`,
		);
	}
}

export function validateAdlManifest(packagePath: string, tools: AdlManifestTools): string {
	const lib = dirname(tools.validator);
	const result = spawnSync(
		tools.java,
		["-Djava.awt.headless=true", "-jar", tools.validator, resolve(packagePath)],
		{
			cwd: lib,
			// The official distribution loads its schemas/resources relative to this suite root.
			env: { ...process.env, SCORM4ED_TS111_HOME: dirname(lib) },
			encoding: "utf8",
			timeout: 60_000,
			windowsHide: true,
		},
	);
	assertAdlManifestPassed(result);
	return result.stdout;
}
