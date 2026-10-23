import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { internalCandidateSource } from "./admit-rubato-release.mjs";
import { githubRead } from "./github-read.mjs";
import { studioRepositories } from "./studio-repositories.mjs";

export function checkCandidateFreshness({ head, activity, runs, now = Date.now() }) {
	const sha = head.sha;
	if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error(`Invalid main head ${sha}`);
	const updates = activity
		.filter((item) => item.ref === "refs/heads/main")
		.map((item) => ({ ...item, time: Date.parse(item.timestamp) }))
		.sort((a, b) => b.time - a.time || b.id - a.id);
	if (updates.some((item) => !Number.isFinite(item.time) || item.time > now + 5 * 60 * 1000))
		throw new Error(`Invalid main push/merge timestamp for ${sha}`);
	const index = updates.findIndex((item) => item.after === sha);
	if (index < 0) throw new Error(`No server push/merge activity for main ${sha}`);
	const backed = new Set(
		runs.workflow_runs
			.filter(
				(run) =>
					["push", "workflow_dispatch"].includes(run.event) &&
					run.head_branch === "main" &&
					(run.status === "in_progress" ||
						(run.status === "completed" && run.conclusion === "success")),
			)
			.map((run) => internalCandidateSource(run, { strict: false })),
	);
	const history = updates.slice(index);
	const lastBacked = history.findIndex((item) => backed.has(item.after));
	const uncovered = lastBacked < 0 ? history : history.slice(0, lastBacked);
	// Allow two hours from the first uncovered server push/merge, not from each new head.
	// This covers 30 minutes capacity + 75 minutes build/setup without resetting during busy days.
	if (!uncovered.length || now - uncovered.at(-1).time <= 2 * 60 * 60 * 1000) return sha;
	throw new Error(
		`Main ${sha} has no successful or in-progress CLI build-ahead since uncovered main ${uncovered.at(-1).after} at ${uncovered.at(-1).timestamp}`,
	);
}

export function checkMainCandidate(execute = execFileSync, env = process.env) {
	const api = githubRead(execute);
	const { source: repo, candidate } = studioRepositories(env);
	const sha = api(`repos/${repo}/git/ref/heads/main`).object?.sha;
	if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error(`Invalid main head ${sha}`);
	const activity = api.list(
		`repos/${repo}/activity?ref=refs/heads/main&time_period=year&per_page=100`,
	);
	const runs = {
		workflow_runs: api.list(
			`repos/${candidate}/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=100`,
			"workflow_runs",
		),
	};
	return checkCandidateFreshness({ head: { sha }, activity, runs });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		console.log(`CLI build-ahead freshness passed for ${checkMainCandidate()}`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
