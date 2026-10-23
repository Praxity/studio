import { readFileSync } from "node:fs";

function invalid(detail) {
	throw new Error(`Invalid Playwright timing report: ${detail}`);
}

function summarize(report) {
	const { stats, suites } = report;
	if (!Array.isArray(suites) || !stats || !Number.isFinite(stats.duration) || stats.duration < 0) {
		invalid("expected suites and nonnegative stats.duration");
	}
	const started = new Date(stats.startTime);
	if (!Number.isFinite(started.getTime())) invalid("expected stats.startTime");
	const tests = [];
	function visit(suite, parents = []) {
		const titles = [...parents, suite.title].filter(Boolean);
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				if (!Array.isArray(test.results)) invalid("expected test.results");
				for (const result of test.results) {
					if (
						!Number.isFinite(result.duration) ||
						result.duration < 0 ||
						!Number.isInteger(result.retry) ||
						result.retry < 0 ||
						typeof result.status !== "string"
					) {
						invalid("expected nonnegative duration, retry and status for each attempt");
					}
				}
				tests.push({
					name: [test.projectName, ...titles, spec.title].join(" > "),
					location: `${spec.file}:${spec.line}`,
					status: test.status,
					all: test.results.reduce((sum, result) => sum + result.duration, 0),
					first: test.results.find((result) => result.retry === 0)?.duration ?? 0,
					attempts: test.results,
				});
			}
		}
		for (const child of suite.suites ?? []) visit(child, titles);
	}
	for (const suite of suites) visit(suite);
	const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
	const seconds = (duration) => (duration / 1000).toFixed(3);
	function ranking(key) {
		return [
			"| Test | Location | All attempts s | First attempt s | Outcome | Attempts |",
			"| --- | --- | ---: | ---: | --- | --- |",
			...[...tests]
				.sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
				.slice(0, 30)
				.map(
					(entry) =>
						`| ${escapeCell(entry.name)} | ${escapeCell(entry.location)} | ${seconds(entry.all)} | ${seconds(entry.first)} | ${escapeCell(entry.status)} | ${entry.attempts.map((attempt) => `${attempt.retry}:${escapeCell(attempt.status)}`).join(", ")} |`,
				),
		].join("\n");
	}
	return [
		"# Published-output timing",
		"",
		`Started: ${started.toISOString()}`,
		`Ended: ${new Date(started.getTime() + stats.duration).toISOString()}`,
		`Runner elapsed: ${seconds(stats.duration)} s. ${tests.length} tests, ${tests.reduce((count, test) => count + test.attempts.length, 0)} attempts.`,
		`Outcomes: ${stats.expected ?? 0} expected, ${stats.unexpected ?? 0} unexpected, ${stats.flaky ?? 0} flaky, ${stats.skipped ?? 0} skipped.`,
		"",
		"Durations cover test attempts, not fixture setup or worker startup. All-attempt totals include failed and retried work. Raw JSON and traces remain in the artifact.",
		"",
		"## Slowest all attempts",
		"",
		ranking("all"),
		"",
		"## Slowest first attempts",
		"",
		ranking("first"),
		...(report.errors?.length
			? [
					"",
					"## Runner errors",
					"",
					...report.errors.map((error) => `- ${escapeCell(error.message ?? error.value)}`),
				]
			: []),
		"",
	].join("\n");
}

if (process.argv.length !== 3) {
	throw new Error("Usage: node timing-summary.mjs <playwright-results.json>");
}
process.stdout.write(summarize(JSON.parse(readFileSync(process.argv[2], "utf8"))));
