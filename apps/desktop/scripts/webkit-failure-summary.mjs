import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { internalCandidateSource, isCandidateWebkitJob } from "./admit-rubato-release.mjs";
import { githubRead } from "./github-read.mjs";
import { studioRepositories } from "./studio-repositories.mjs";

const recentRunLimit = 20;

export function webkitFailureSummary({ runId, sha }, execute = execFileSync) {
	try {
		const api = githubRead(execute);
		const { source, candidate: repo } = studioRepositories();
		// One page bounds job lookups while failures accumulate after cutover.
		const { workflow_runs: runs, total_count: totalCount } = api(
			`repos/${repo}/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=${recentRunLimit}`,
		);
		for (const run of runs
			.filter(
				(run) =>
					run.id < Number(runId) &&
					["push", "workflow_dispatch"].includes(run.event) &&
					run.head_branch === "main" &&
					internalCandidateSource(run, { strict: false }),
			)
			.sort((a, b) => b.id - a.id)) {
			const jobs = api.list(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, "jobs");
			if (jobs.some((job) => isCandidateWebkitJob(job) && job.conclusion === "success")) {
				const sourceSha = internalCandidateSource(run);
				return `Last WebKit pass: [run ${run.id}](https://github.com/${repo}/actions/runs/${run.id}), ${sourceSha}\n\nMerge range: https://github.com/${source}/compare/${sourceSha}..${sha}\n`;
			}
		}
		if (totalCount > runs.length)
			return `no earlier WebKit pass in the last ${recentRunLimit} runs; older runs were not checked\n`;
		return "no earlier WebKit pass; every candidate is refused until one passes\n";
	} catch (error) {
		return `WebKit merge-range lookup failed: ${error.message}\n`;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	appendFileSync(
		process.env.GITHUB_STEP_SUMMARY,
		webkitFailureSummary({ runId: process.env.GITHUB_RUN_ID, sha: process.env.SOURCE_SHA }),
	);
}
