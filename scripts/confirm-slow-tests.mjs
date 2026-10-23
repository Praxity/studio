import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clearVitestProcessGroups } from "./vitest-processes.mjs";

export const slowTestBudgetMs = 2000;
export const confirmationProcessBudgetMs = 120000;
const confirmationBudgetMs = 180000;

export function testNameParts(test) {
	const names = [test.name];
	for (let parent = test.parent; parent && parent.type !== "module"; parent = parent.parent)
		names.unshift(parent.name);
	return names;
}

export function confirmationTestName(parts) {
	return parts.join(" ");
}

export function assertConfirmationTargets(assertions, targets) {
	const requested = new Set(targets.map((parts) => JSON.stringify(parts)));
	if (requested.size !== targets.length)
		throw new Error("confirmation has duplicate pending targets; names cannot identify one test");
	for (const assertion of assertions) {
		const key = JSON.stringify([...assertion.ancestorTitles, assertion.title]);
		if (
			!requested.has(key) &&
			((assertion.status !== "skipped" && assertion.status !== "todo") ||
				assertion.duration !== undefined)
		)
			throw new Error(`confirmation ran an unrequested test: ${key}`);
	}
	for (const parts of targets) {
		const measured = assertions.filter(
			(assertion) =>
				JSON.stringify([...assertion.ancestorTitles, assertion.title]) === JSON.stringify(parts),
		);
		if (
			measured.length !== 1 ||
			measured[0].status !== "passed" ||
			!Number.isFinite(measured[0].duration) ||
			measured[0].duration < 0
		)
			throw new Error(`confirmation must measure exactly one passing target: ${parts.join(" > ")}`);
		if (measured[0].retryCount !== 0 || measured[0].repeatCount !== 0)
			throw new Error(
				`confirmation retried target or ran more than one attempt: ${parts.join(" > ")}`,
			);
	}
}

export function observeConfirmationHost({ platform = process.platform, read = readFileSync } = {}) {
	if (platform !== "linux") return () => undefined;
	const ioPressure = () => {
		try {
			return (
				read("/proc/pressure/io", "utf8")
					.split("\n")
					.find((line) => line.startsWith("some ")) ?? null
			);
		} catch (error) {
			return error.code === "ENOENT" ? null : `unavailable: ${error.message}`;
		}
	};
	const snapshot = () => {
		try {
			const [heading, ...fields] = read("/proc/stat", "utf8").split("\n", 1)[0].trim().split(/\s+/);
			const cpu = fields.slice(0, 8).map(Number);
			if (
				heading !== "cpu" ||
				cpu.length !== 8 ||
				cpu.some((value) => !Number.isSafeInteger(value) || value < 0)
			)
				throw new Error("Invalid aggregate CPU counters");
			return { cpu, loadavg: read("/proc/loadavg", "utf8").trim(), ioPressure: ioPressure() };
		} catch (error) {
			// Telemetry must report its own failure without changing the timing gate.
			return { error: error.message };
		}
	};
	const before = snapshot();
	return () => {
		const after = snapshot();
		if (before.error || after.error) return { error: before.error ?? after.error };
		// guest/guest_nice are already included in user/nice, so sum only the first eight fields.
		const cpuTicks =
			after.cpu.reduce((sum, value) => sum + value, 0) -
			before.cpu.reduce((sum, value) => sum + value, 0);
		const stealTicks = after.cpu[7] - before.cpu[7];
		// Linux documents that iowait may decrease; retain the signed delta for diagnosis.
		const iowaitTicks = after.cpu[4] - before.cpu[4];
		return {
			loadavgStart: before.loadavg,
			loadavgEnd: after.loadavg,
			cpuTicks,
			stealTicks,
			stealPercent: cpuTicks > 0 ? Math.round((10000 * stealTicks) / cpuTicks) / 100 : null,
			iowaitTicks,
			iowaitPercent: cpuTicks > 0 ? Math.round((10000 * iowaitTicks) / cpuTicks) / 100 : null,
			ioPressureStart: before.ioPressure,
			ioPressureEnd: after.ioPressure,
		};
	};
}

export function runConfirmation(
	executable,
	args,
	{ encoding, timeout, killSignal, ...options },
	{ platform = process.platform, spawnProcess = spawn, killProcess = process.kill } = {},
) {
	return new Promise((resolve) => {
		// Own a process group so a timed-out attempt cannot affect later measurements.
		const child = spawnProcess(executable, args, { ...options, detached: platform !== "win32" });
		let error;
		child.on("error", (failure) => {
			error = failure;
		});
		let started = false;
		child.once("spawn", () => {
			started = true;
		});
		const kill = () => {
			if (platform === "win32" || !child.pid) return child.kill(killSignal);
			try {
				killProcess(-child.pid, killSignal);
			} catch (failure) {
				if (failure.code !== "ESRCH") error = failure;
			}
		};
		let stdout = "";
		let stderr = "";
		let outputBytes = 0;
		const timer = setTimeout(() => {
			error = Object.assign(new Error("spawn ETIMEDOUT"), { code: "ETIMEDOUT" });
			kill();
		}, timeout);
		// EMFILE/ENFILE can return a child without creating its stdio streams.
		child.stdout?.setEncoding(encoding);
		child.stderr?.setEncoding(encoding);
		child.stdout?.on("data", (data) => {
			checkOutput(data);
			stdout += data;
		});
		child.stderr?.on("data", (data) => {
			checkOutput(data);
			stderr += data;
		});
		function checkOutput(data) {
			outputBytes += Buffer.byteLength(data, encoding);
			// Preserve spawnSync's default output cap when switching to streams.
			if (outputBytes > 1024 * 1024 && !error) {
				error = Object.assign(new Error("confirmation output exceeded 1 MiB"), { code: "ENOBUFS" });
				kill();
			}
		}
		child.on("close", (status, signal) => {
			clearTimeout(timer);
			resolve({ started, status, signal, error, stdout, stderr });
		});
	});
}

function confirmationPath(file) {
	try {
		return realpathSync(file);
	} catch (error) {
		// Vitest reports missing files as failures; keep their path for that diagnostic.
		if (error.code === "ENOENT") return resolve(file);
		throw error;
	}
}

function readConfirmationReport(reportPath, result, file) {
	let report;
	try {
		report = JSON.parse(readFileSync(reportPath, "utf8"));
	} catch (error) {
		throw new Error(
			`confirmation produced no usable JSON (exit ${result.status}): ${error.message}\n${result.stdout}${result.stderr}`,
		);
	}
	if (!Array.isArray(report.unhandledErrors))
		throw new Error("confirmation must report unhandled errors");
	if (report.testResults.length !== 1 || confirmationPath(report.testResults[0].name) !== file)
		throw new Error("confirmation must report exactly the selected file");
	return report;
}

export async function confirmSlowTests(
	{ root, violations },
	{
		run = runConfirmation,
		now = Date.now,
		logger = console,
		reportOnly = process.env.SLOW_TESTS_REPORT_ONLY === "true",
		onConfirmationTimeout = () => {},
		jobDeadline = process.env.CI_JOB_DEADLINE_MS,
		cleanup = (options) => {
			if (
				process.platform === "linux" &&
				process.env.CI === "true" &&
				process.env.GITHUB_ACTIONS === "true" &&
				!reportOnly
			)
				clearVitestProcessGroups(process.env.SLOW_TESTS_PROCESS_GROUPS_FILE, options);
		},
	} = {},
) {
	if (violations.length === 0) return;
	const deadline = Math.min(now() + confirmationBudgetMs, Number(jobDeadline ?? Infinity));
	try {
		cleanup({ deadline, now, logger });
	} catch (error) {
		logger.error(`Slow-test confirmation infrastructure failed:\n${error.message}`);
		return true;
	}
	const dir = mkdtempSync(resolve(tmpdir(), "slow-confirmation-"));
	const failures = [];
	const confirmationFailures = [];
	const infrastructureFailures = [];
	const unconfirmed = reportOnly ? [] : infrastructureFailures;
	let confirmationTimedOut = false;
	let timeoutObserved = false;
	const files = Map.groupBy(violations, ({ moduleId, projectRoot, projectName, configFile }) =>
		JSON.stringify([moduleId, projectRoot, projectName, configFile]),
	);
	try {
		// Confirm serially after the shard, with the same project setup and test timeouts.
		for (const [index, violations] of [...files.values()].entries()) {
			const { moduleId, projectRoot, projectName, configFile, entry } = violations[0];
			const targets = violations.map(({ nameParts }) => nameParts);
			const names = violations.map(({ entry }) => entry.name).join("; ");
			if (confirmationTimedOut) {
				unconfirmed.push(
					`${entry.file}, previous confirmation timed out; slow tests remain unconfirmed: ${names}`,
				);
				continue;
			}
			const remaining = Math.floor(deadline - now());
			if (remaining <= 0) {
				unconfirmed.push(
					`${entry.file}, confirmation deadline exceeded (${confirmationBudgetMs} ms maximum or CI job deadline); slow tests remain unconfirmed: ${names}`,
				);
				continue;
			}
			logger.log(`Confirming slow tests in file: ${entry.file}`);
			let timeoutError;
			try {
				// Vitest discovers real paths, including /private/var behind macOS's /var.
				const file = confirmationPath(moduleId);
				const longerPaths = `${file.replaceAll("\\", "/").replace(/([?*[\]{}()!])/g, "\\$1")}?*`;
				const pattern = targets
					.map((parts) => `^(?:${RegExp.escape(confirmationTestName(parts))})$`)
					.join("|");
				let result;
				let reportPath;
				for (let attempt = 0; attempt < 2; attempt++) {
					reportPath = resolve(dir, `results-${index}-${attempt}.json`);
					result = await run(
						process.execPath,
						[
							resolve(
								dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
								"vitest.mjs",
							),
							"run",
							...(configFile ? ["--config", configFile] : []),
							`--root=${confirmationPath(projectRoot)}`,
							...(projectName ? [`--project=${projectName}`] : []),
							"--maxWorkers=1",
							"--no-file-parallelism",
							"--retry=0",
							`--testNamePattern=${pattern}`,
							`--exclude=${longerPaths}`,
							// Override configured reporters so confirmation cannot recursively rerun itself.
							"--reporter=default",
							`--reporter=${fileURLToPath(new URL("./slow-tests-confirmation-reporter.mjs", import.meta.url))}`,
							`--outputFile=${reportPath}`,
							file,
						],
						{
							cwd: root,
							env: { ...process.env, SLOW_TESTS_CONFIRMATION_TARGETS: JSON.stringify(targets) },
							encoding: "utf8",
							timeout: Math.min(confirmationProcessBudgetMs, Math.floor(deadline - now())),
							killSignal: "SIGKILL",
							windowsHide: true,
						},
					);
					if (result.error?.code === "ETIMEDOUT") {
						if (reportOnly && !timeoutObserved) onConfirmationTimeout();
						timeoutObserved = true;
					}
					if (
						!result.error ||
						result.started !== false ||
						result.error.code === "ETIMEDOUT" ||
						result.error.code === "ENOBUFS"
					)
						break;
					// Vitest writes JSON after afterAll: missing JSON cannot prove nothing ran.
					// Only a failed start can retry; any finished report is final as well.
					if (existsSync(reportPath)) break;
					if (attempt === 1 || deadline - now() <= 0) break;
					logger.log(
						`Retrying slow-test confirmation: ${entry.file} > ${names}, ${result.error.message}`,
					);
				}
				if (result.error) {
					if (result.error.code === "ETIMEDOUT") {
						confirmationTimedOut = true;
						timeoutError = result.error;
					}
					// A completed report can still contain failures before child teardown times out.
					if (!existsSync(reportPath)) throw result.error;
				}
				const report = readConfirmationReport(reportPath, result, file);
				const rerun = report.testResults[0];
				for (const error of report.unhandledErrors)
					infrastructureFailures.push(
						`${entry.file}, confirmation unhandled error: ${JSON.stringify(error)}`,
					);
				if (!result.error && result.status !== 0 && result.status !== 1)
					throw new Error(`confirmation exited ${result.status}\n${result.stdout}${result.stderr}`);
				if (
					rerun.status === "failed" ||
					rerun.assertionResults.some((assertion) => assertion.status === "failed")
				) {
					confirmationFailures.push(
						`${entry.file}, test failed alone:\n${rerun.message}\n${result.stdout}${result.stderr}`,
					);
					continue;
				}
				if (report.unhandledErrors.length) continue;
				if (report.selectionErrors?.length) throw new Error(report.selectionErrors.join("\n"));
				assertConfirmationTargets(rerun.assertionResults, targets);
				if (!result.error && result.status !== 0)
					throw new Error(`confirmation exited ${result.status}\n${result.stdout}${result.stderr}`);
				for (const { entry, duration, nameParts } of violations) {
					const label = `${entry.file} > ${entry.name}: ${Math.round(duration)} ms in shard`;
					const measured = rerun.assertionResults.filter(
						(assertion) =>
							JSON.stringify([...assertion.ancestorTitles, assertion.title]) ===
							JSON.stringify(nameParts),
					);
					const alone = measured[0].duration;
					if (alone > slowTestBudgetMs) failures.push(`${label}, ${Math.round(alone)} ms alone`);
					else logger.log(`Slow test passed alone: ${label}, ${Math.round(alone)} ms alone`);
				}
				if (result.error) throw result.error;
			} catch (error) {
				const diagnostic = `${entry.file}, confirmation could not run: ${names}: ${error.message}`;
				if (error === timeoutError) unconfirmed.push(diagnostic);
				else infrastructureFailures.push(diagnostic);
			}
		}
	} finally {
		rmSync(dir, { recursive: true });
	}
	if (reportOnly && unconfirmed.length) {
		if (!timeoutObserved) onConfirmationTimeout();
		const diagnostic = unconfirmed
			.join("\n")
			.replaceAll("%", "%25")
			.replaceAll("\r", "%0D")
			.replaceAll("\n", "%0A");
		logger.log(`::warning::Slow-test confirmation timed out: ${diagnostic}`);
	}
	if (failures.length) {
		logger.error(`Slow-test budget exceeded (${slowTestBudgetMs} ms):\n${failures.join("\n")}`);
	}
	if (confirmationFailures.length)
		logger.error(`Slow-test confirmation failed:\n${confirmationFailures.join("\n")}`);
	if (infrastructureFailures.length)
		logger.error(
			`Slow-test confirmation infrastructure failed:\n${infrastructureFailures.join("\n")}`,
		);
	// Owner decision 2026-10-12: macOS nightly timings are advisory; correctness still fails.
	return Boolean(
		(!reportOnly && failures.length) ||
			confirmationFailures.length ||
			infrastructureFailures.length,
	);
}

export function readPendingSlowTests(file) {
	const pending = JSON.parse(readFileSync(file, "utf8"));
	if (
		!pending ||
		typeof pending.root !== "string" ||
		!pending.root ||
		!Array.isArray(pending.violations)
	)
		throw new Error("Invalid slow-test pending file");
	for (const violation of pending.violations) {
		if (
			!violation ||
			typeof violation.moduleId !== "string" ||
			!violation.moduleId ||
			typeof violation.projectRoot !== "string" ||
			!violation.projectRoot ||
			(violation.projectName !== undefined && typeof violation.projectName !== "string") ||
			(violation.configFile !== undefined &&
				violation.configFile !== false &&
				typeof violation.configFile !== "string") ||
			typeof violation.entry?.file !== "string" ||
			typeof violation.entry?.name !== "string" ||
			!Array.isArray(violation.nameParts) ||
			violation.nameParts.length === 0 ||
			violation.nameParts.some((part) => typeof part !== "string") ||
			violation.nameParts.join(" > ") !== violation.entry.name ||
			!Number.isFinite(violation.duration) ||
			violation.duration <= slowTestBudgetMs
		)
			throw new Error("Invalid slow-test pending violation");
	}
	return pending;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	const fail = (error) => {
		console.error(`Slow-test confirmation infrastructure failed:\n${error.message}`);
		process.exitCode = 1;
	};
	try {
		if (!process.argv[2])
			throw new Error("Usage: node scripts/confirm-slow-tests.mjs <pending.json>");
		const pending = readPendingSlowTests(process.argv[2]);
		const finishHostObservation = observeConfirmationHost();
		confirmSlowTests(pending)
			.finally(() => {
				const sample = finishHostObservation();
				if (sample) console.log(`Slow-test confirmation host: ${JSON.stringify(sample)}`);
			})
			.then((failed) => {
				if (failed) process.exitCode = 1;
			}, fail);
	} catch (error) {
		fail(error);
	}
}
