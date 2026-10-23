import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import {
	confirmationProcessBudgetMs,
	confirmationTestName,
	confirmSlowTests,
	readPendingSlowTests,
	slowTestBudgetMs,
	testNameParts,
} from "./confirm-slow-tests.mjs";

export { slowTestBudgetMs };

const key = ({ file, name }) => JSON.stringify([file, name]);
const datedFields = ["added", "run", "backlog"];
const isDated = (entry) => datedFields.some((field) => Object.hasOwn(entry, field));
const runId = (run) => {
	if (typeof run === "number") return Number.isSafeInteger(run) && run > 0 ? String(run) : null;
	if (typeof run !== "string") return null;
	if (/^[1-9]\d*$/.test(run)) return run;
	return (
		/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/([1-9]\d*)\/?$/.exec(run)?.[1] ?? null
	);
};

function validateEntries(entries, today) {
	if (!Array.isArray(entries)) throw new Error("Slow-test allowlist must be an array");
	const seen = new Set();
	for (const entry of entries) {
		if (
			typeof entry.file !== "string" ||
			!/^(apps|packages)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.file) ||
			posix.normalize(entry.file) !== entry.file ||
			entry.file.includes("\\")
		)
			throw new Error("Slow-test file must be repo-relative under apps/ or packages/");
		if (typeof entry.name !== "string" || !entry.name.trim())
			throw new Error("Slow-test name is required");
		if (typeof entry.reason !== "string" || !entry.reason.trim())
			throw new Error(`Slow-test reason is required: ${key(entry)}`);
		if (seen.has(key(entry))) throw new Error(`Duplicate slow-test entry: ${key(entry)}`);
		seen.add(key(entry));
		if (!isDated(entry)) continue;
		if (!datedFields.every((field) => Object.hasOwn(entry, field)))
			throw new Error(
				`Slow-test allowlist may only shrink unless added, run and backlog are provided: ${key(entry)}`,
			);
		const added = Date.parse(entry.added);
		if (
			typeof entry.added !== "string" ||
			!/^\d{4}-\d{2}-\d{2}$/.test(entry.added) ||
			!Number.isFinite(added) ||
			new Date(added).toISOString().slice(0, 10) !== entry.added
		)
			throw new Error(`Slow-test added must be an ISO date YYYY-MM-DD: ${key(entry)}`);
		if (!runId(entry.run))
			throw new Error(
				`Slow-test run must be a GitHub Actions run URL or numeric run ID: ${key(entry)}`,
			);
		if (typeof entry.backlog !== "string" || !entry.backlog.trim())
			throw new Error(`Slow-test backlog pointer is required: ${key(entry)}`);
		if (today !== undefined) {
			if (entry.added > today)
				throw new Error(`Slow-test added must not be in the future: ${key(entry)}`);
			if ((Date.parse(today) - added) / 86400000 > 14)
				throw new Error(
					`Slow-test entry expired after 14 days: ${key(entry)}; fix the test or re-add it deliberately with a new date and run`,
				);
		}
	}
}

export function validateAllowlist(entries, previous, now = Date.now()) {
	validateEntries(entries, new Date(now).toISOString().slice(0, 10));
	if (previous !== undefined) {
		// Expired base entries must still permit removal or a deliberate re-add.
		validateEntries(previous);
		const allowed = new Map(previous.map((entry) => [key(entry), entry]));
		for (const entry of entries) {
			const prior = allowed.get(key(entry));
			if (!prior && !isDated(entry))
				throw new Error(`Slow-test allowlist may only shrink: ${key(entry)}`);
			if (prior && isDated(prior)) {
				if (!isDated(entry))
					throw new Error(`Slow-test dated metadata cannot be removed: ${key(entry)}`);
				if (entry.added !== prior.added && runId(entry.run) === runId(prior.run))
					throw new Error(`Slow-test new added date requires a different run: ${key(entry)}`);
			}
		}
	}
}

export default class SlowTestsReporter {
	constructor(run, now = Date.now) {
		this.run = run;
		this.now = now;
	}

	onInit(ctx) {
		this.ctx = ctx;
		this.reportOnly = process.env.SLOW_TESTS_REPORT_ONLY === "true";
		this.confirmationTimedOut = false;
		if (this.reportOnly) {
			// Vitest logs pool teardown timeouts after onTestRunEnd without setting exitCode.
			const error = ctx.logger.error.bind(ctx.logger);
			ctx.logger.error = (...args) => {
				if (
					args.length === 1 &&
					typeof args[0] === "string" &&
					/^\[vitest-pool\]: Timeout terminating forks worker for test files [^\r\n]+\.$/.test(
						args[0],
					)
				) {
					if (this.confirmationTimedOut) {
						ctx.logger.log(`::warning::${args[0]}`);
						return;
					}
					process.exitCode = 1;
				}
				error(...args);
			};
		}
		const entries = JSON.parse(readFileSync(new URL("./slow-tests.json", import.meta.url), "utf8"));
		validateAllowlist(entries);
		this.allowed = new Set(entries.map(key));
		this.violations = [];
	}

	onTestRunStart() {
		if (this.reportOnly) {
			this.confirmationTimedOut = false;
			this.violations = [];
		}
	}

	onTestCaseResult(test) {
		const duration = test.diagnostic()?.duration;
		const entry = {
			file: relative(this.ctx.config.root, test.module.moduleId).replaceAll("\\", "/"),
			name: test.fullName,
		};
		if (this.reportOnly && duration > slowTestBudgetMs)
			this.ctx.logger.log(
				`Slow-test timing: ${entry.file} > ${entry.name}: ${Math.round(duration)} ms in shard`,
			);
		if (duration > slowTestBudgetMs && !this.allowed.has(key(entry)))
			this.violations.push({
				entry,
				nameParts: testNameParts(test),
				duration,
				moduleId: test.module.moduleId,
				projectRoot: test.module.project.config.root,
				projectName: test.module.project.name,
				configFile: test.module.project.vite.config.configFile,
			});
	}

	async onTestRunEnd(testModules = []) {
		for (const module of testModules) {
			const file = relative(this.ctx.config.root, module.moduleId).replaceAll("\\", "/");
			const seen = new Set();
			const seenConfirmationNames = new Set();
			for (const test of module.children.allTests()) {
				const parts = testNameParts(test);
				const name = parts.join(" > ");
				const confirmationName = confirmationTestName(parts);
				if (seen.has(name) || seenConfirmationNames.has(confirmationName)) {
					this.ctx.logger.error(`Duplicate test name: ${file} > ${name}`);
					process.exitCode = 1;
				}
				seen.add(name);
				seenConfirmationNames.add(confirmationName);
			}
		}
		if (this.violations.length === 0) return;
		// Confirmation also verifies the isolated job's workers have exited.
		if (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && !this.reportOnly) {
			const file =
				process.env.SLOW_TESTS_PENDING_FILE ??
				resolve(this.ctx.config.root, ".slow-tests-pending.json");
			const pending = existsSync(file)
				? readPendingSlowTests(file)
				: { root: this.ctx.config.root, violations: [] };
			if (pending.root !== this.ctx.config.root)
				throw new Error("Slow-test pending file belongs to another root");
			pending.violations.push(...this.violations);
			writeFileSync(file, JSON.stringify(pending));
			return;
		}
		if (
			await confirmSlowTests(
				{ root: this.ctx.config.root, violations: this.violations },
				{
					run: this.run,
					now: this.now,
					logger: this.ctx.logger,
					reportOnly: this.reportOnly,
					jobDeadline: Math.min(
						Number(process.env.CI_JOB_DEADLINE_MS ?? Infinity),
						this.now() + confirmationProcessBudgetMs,
					),
					onConfirmationTimeout: () => {
						this.confirmationTimedOut = true;
					},
				},
			)
		)
			process.exitCode = 1;
	}
}
