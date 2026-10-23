import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubRead } from "./github-read.mjs";
import { studioRepositories } from "./studio-repositories.mjs";

class AdmissionRefused extends Error {}

function candidateMatchesMain(studioSha, headSha, candidate, testedBase) {
	return (
		candidate?.source.sha === studioSha &&
		candidate.head.sha === headSha &&
		/^[a-f0-9]{40}$/.test(candidate.source.tree_sha ?? "") &&
		candidate.source.tree_sha === candidate.head.tree_sha &&
		/^[a-f0-9]{40}$/.test(candidate.source.parents?.[0]?.sha ?? "") &&
		candidate.comparison.merge_base_commit?.sha === candidate.source.parents[0].sha &&
		testedBase === candidate.source.parents[0].sha
	);
}

export function admitStudioRevision({
	studioSha,
	comparison,
	runs,
	jobs,
	internal = false,
	candidate,
}) {
	if (!/^[a-f0-9]{40}$/.test(studioSha))
		throw new AdmissionRefused("Release requires a full Studio SHA");
	if (comparison.merge_base_commit?.sha !== studioSha)
		throw new AdmissionRefused("Release SHA must belong to Studio main");
	// The newest CI run wins. An older success cannot mask a later failure.
	const run = runs.workflow_runs[0];
	const mainRun =
		run?.head_branch === "main" && ["push", "schedule", "workflow_dispatch"].includes(run.event);
	// REST run responses omit dispatch inputs. ci.yml emits this exact title only for gate=candidate.
	const candidateRun =
		run?.event === "workflow_dispatch" &&
		/^[a-f0-9]{40}$/.test(run.head_sha ?? "") &&
		run.display_title === `CI candidate ${run.head_sha}`;
	const recorded = jobs.jobs
		.filter((job) => job.name === "changes" && job.conclusion === "success")
		.flatMap((job) => job.steps ?? [])
		.filter((step) => step.conclusion === "success")
		.map((step) => /^Candidate base ([a-f0-9]{40})$/.exec(step.name)?.[1])
		.filter(Boolean);
	if (internal && candidateRun && !mainRun && recorded.length !== 1)
		throw new AdmissionRefused(
			`CI candidate ${run.head_sha} has no unique recorded main base. Run ci.yml on main with workflow_dispatch for ${studioSha}, or run a new candidate gate.`,
		);
	if (
		!run ||
		!(
			(run.head_sha === studioSha && (mainRun || candidateRun)) ||
			(internal &&
				candidateRun &&
				(run.head_sha === studioSha ||
					candidateMatchesMain(studioSha, run.head_sha, candidate, recorded[0])))
		) ||
		run.status !== "completed" ||
		run.conclusion !== "success"
	)
		throw new AdmissionRefused(
			internal
				? `Run the candidate gate successfully for ${run?.head_sha ?? studioSha}, with its recorded main base matching ${studioSha}'s parent, or dispatch full ci.yml on main.`
				: "Run full CI successfully on this main SHA before publishing",
		);
	if (!jobs.jobs.some((job) => job.name === "merge-gate" && job.conclusion === "success"))
		throw new AdmissionRefused(
			`Release requires a successful full merge gate${internal ? ` for candidate ${run.head_sha}` : ""}`,
		);
	return studioSha;
}

function mergedCandidate(api, repo, studioSha) {
	const commitFields = "{sha, tree_sha: .commit.tree.sha, parents}";
	const source = api(`repos/${repo}/commits/${studioSha}`, commitFields);
	const parent = source.parents?.[0]?.sha;
	if (!/^[a-f0-9]{40}$/.test(parent ?? ""))
		throw new AdmissionRefused("Main revision requires a first parent");
	const pulls = api
		.list(`repos/${repo}/commits/${studioSha}/pulls?per_page=100`)
		.filter(
			(pr) =>
				Number.isSafeInteger(pr.number) &&
				pr.number > 0 &&
				pr.merged_at &&
				pr.merge_commit_sha === studioSha &&
				pr.base?.ref === "main",
		)
		.sort((a, b) => b.number - a.number);
	for (const pr of pulls) {
		const sha = pr.head?.sha;
		if (!/^[a-f0-9]{40}$/.test(sha ?? "")) continue;
		const head = api(`repos/${repo}/commits/${sha}`, commitFields);
		const comparison = api(
			`repos/${repo}/compare/${parent}...${sha}`,
			"{merge_base_commit: {sha: .merge_base_commit.sha}}",
		);
		const candidate = { source, head, comparison };
		if (candidateMatchesMain(studioSha, sha, candidate, parent)) return candidate;
	}
	throw new AdmissionRefused(
		`No merge candidate with matching tree and main parent for ${studioSha}. Dispatch full ci.yml on main.`,
	);
}

function mainComparison(api, repo, studioSha, mainSha) {
	if (!/^[a-f0-9]{40}$/.test(mainSha)) throw new Error("Invalid Studio main revision");
	const comparison = api(
		`repos/${repo}/compare/${studioSha}...${mainSha}`,
		"{merge_base_commit: {sha: .merge_base_commit.sha}}",
	);
	if (comparison.merge_base_commit?.sha !== studioSha)
		throw new AdmissionRefused("Release SHA must belong to Studio main");
	return comparison;
}

function readAdmission(studioSha, internal, api, mainSha, repo) {
	if (!/^[a-f0-9]{40}$/.test(studioSha))
		throw new AdmissionRefused("Release requires a full Studio SHA");
	const comparison = mainComparison(api, repo, studioSha, mainSha);
	// Filter remotely before selecting the newest run, so fork PR runs cannot displace CI.
	const trustedRuns = (sha) => ({
		workflow_runs: ["push", "schedule", "workflow_dispatch"]
			.flatMap((event) =>
				api(
					`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1&event=${event}${event === "workflow_dispatch" ? "" : "&branch=main"}`,
				).workflow_runs.filter(
					(run) =>
						run.event === event && (event === "workflow_dispatch" || run.head_branch === "main"),
				),
			)
			.sort((a, b) => b.id - a.id)
			.slice(0, 1),
	});
	let runs = trustedRuns(studioSha);
	let candidate;
	if (internal && !runs.workflow_runs.length) {
		candidate = mergedCandidate(api, repo, studioSha);
		runs = trustedRuns(candidate.head.sha);
	}
	const run = runs.workflow_runs[0];
	if (!Number.isSafeInteger(run?.id)) throw new AdmissionRefused("No CI run for the requested SHA");
	const jobs = { jobs: api.list(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, "jobs") };
	admitStudioRevision({ studioSha, comparison, runs, jobs, internal, candidate });
	return run;
}

export function admitInternalStudioRevision(studioSha, execute = execFileSync, env = process.env) {
	const api = githubRead(execute);
	const { source } = studioRepositories(env);
	const mainSha = api(`repos/${source}/git/ref/heads/main`).object?.sha;
	return { sha: studioSha, run: readAdmission(studioSha, true, api, mainSha, source) };
}

export function isCandidateWebkitJob(job) {
	return job.name === "webkit";
}

export function admitInternalCandidateRun(run, jobs) {
	internalCandidateSource(run);
	if (!jobs.jobs.some((job) => isCandidateWebkitJob(job) && job.conclusion === "success"))
		throw new AdmissionRefused(
			`CLI candidate ${run.id} requires a successful WebKit job on its source SHA`,
		);
	return run;
}

// The run title records source identity before a job starts, including dispatches
// whose head_sha belongs to the private workflow repository.
export function internalCandidateSource(run, { strict = true } = {}) {
	const sha = /^CLI candidate ([a-f0-9]{40})$/.exec(run.display_title ?? "")?.[1];
	if (
		!sha ||
		run.display_title !== `CLI candidate ${sha}` ||
		(run.event === "push" && run.head_sha !== sha)
	) {
		if (strict)
			throw new AdmissionRefused("CLI candidate requires an exact source SHA in its run title");
		return undefined;
	}
	return sha;
}

export function isAdmittedInternalCandidateRun(run, sha, api, repository) {
	return (
		run.head_branch === "main" &&
		/^[a-f0-9]{40}$/.test(run.head_sha) &&
		["workflow_dispatch", "push"].includes(run.event) &&
		run.path === ".github/workflows/cli-candidate.yml" &&
		internalCandidateSource(run, { strict: false }) === sha &&
		api(`repos/${repository}/compare/${run.head_sha}...main`).merge_base_commit?.sha ===
			run.head_sha
	);
}

// Draft tags belong to the tooling repository; their body identifies the built source.
export function internalCandidateReleaseSource(release) {
	const match = /^Studio SHA: ([a-f0-9]{40})$/.exec(release.body ?? "");
	return match && match[0] === release.body ? match[1] : undefined;
}

export function selectNewestInternalStudioRevision(execute = execFileSync, env = process.env) {
	const api = githubRead(execute);
	const { source, candidate: candidateRepo } = studioRepositories(env);
	const repo = `repos/${source}`;
	const mainSha = api(`${repo}/git/ref/heads/main`).object?.sha;
	if (!/^[a-f0-9]{40}$/.test(mainSha ?? ""))
		throw new Error("Invalid main SHA. Check GitHub access and rerun.");
	const candidates = api.list(
		`repos/${candidateRepo}/actions/workflows/cli-candidate.yml/runs?branch=main&per_page=100`,
		"workflow_runs",
	);
	let sha = mainSha;
	// Walk the main first-parent chain, not date-sorted commits from merged branches.
	for (let count = 0; sha && count < 100; count++) {
		const commit = api(
			`${repo}/commits/${sha}`,
			"{sha, parents, commit: {committer: .commit.committer}}",
		);
		if (commit.sha !== sha) throw new Error(`Commit response does not match ${sha}`);
		try {
			const run = readAdmission(sha, true, api, mainSha, source);
			for (const candidate of candidates.filter((candidate) =>
				isAdmittedInternalCandidateRun(candidate, sha, api, candidateRepo),
			)) {
				try {
					const jobs = {
						jobs: api.list(
							`repos/${candidateRepo}/actions/runs/${candidate.id}/jobs?per_page=100`,
							"jobs",
						),
					};
					admitInternalCandidateRun(candidate, jobs);
					return { sha, mainSha, commit, run };
				} catch (error) {
					if (!(error instanceof AdmissionRefused)) throw error;
				}
			}
		} catch (error) {
			if (!(error instanceof AdmissionRefused)) throw error;
		}
		sha = commit.parents?.[0]?.sha;
	}
	throw new AdmissionRefused(
		"No main SHA in the last 100 commits passed full Ubicloud CI and candidate WebKit. Wait for a successful main WebKit run, then rerun.",
	);
}

// GitHub serves fork and pull-request commits through this repository too. A private
// candidate builds only a commit on main or the head of a branch pushed here.
function admitPrivateRef(ref, api, repo) {
	if (/^[a-f0-9]{40}$/.test(ref)) {
		mainComparison(api, repo, ref, api(`repos/${repo}/git/ref/heads/main`).object?.sha);
		return ref;
	}
	const branch = ref.replace(/^refs\/heads\//, "");
	if (
		branch.startsWith("refs/") ||
		/^(?:dependabot|gh-readonly-queue|copilot|renovate)\//.test(branch)
	)
		throw new AdmissionRefused(
			"Private candidate ref must be a full SHA on main or a Studio branch",
		);
	try {
		// Git owns branch syntax, including Unicode and punctuation such as c++.
		const checked = execFileSync("git", ["check-ref-format", "--branch", branch], {
			encoding: "utf8",
			stdio: "pipe",
		}).trimEnd();
		if (checked !== branch) throw new Error("Branch shorthand is not an exact ref");
	} catch {
		throw new AdmissionRefused(
			"Private candidate ref must be a full SHA on main or a Studio branch",
		);
	}
	const head = api(`repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
	if (
		head.ref !== `refs/heads/${branch}` ||
		head.object?.type !== "commit" ||
		!/^[a-f0-9]{40}$/.test(head.object.sha ?? "")
	)
		throw new AdmissionRefused(`No Studio branch named ${branch}`);
	return head.object.sha;
}

export function admitRelease(env, execute = execFileSync) {
	const { INPUT_REF: studioSha, PACK_VERSION: version } = env;
	// shortcut: refuse publication until Rubato verifies this exact pack on native arm64.
	if (env.PUBLISH_PACK === "true")
		throw new Error(
			"Formal release needs the native arm64 install check on Rubato's macos-15 job; not wired yet.",
		);
	const internal = !version && env.INTERNAL_INSTALL === "true" && env.PUBLISH_PACK !== "true";
	if (!version && !internal && env.FORMAL_RELEASE !== "true") {
		return {
			source_ref: admitPrivateRef(
				studioSha ?? "",
				githubRead(execute),
				studioRepositories(env).source,
			),
		};
	} else {
		if (!internal && (env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REF_TYPE !== "branch"))
			throw new Error("Dispatch public releases from the main workflow only");
		if ((!internal && !/^\d+\.\d+\.\d+$/.test(version)) || !/^[a-f0-9]{40}$/.test(studioSha))
			throw new Error("Release requires a stable pack version and full Studio SHA");
		if (internal) return { source_ref: admitInternalStudioRevision(studioSha, execute, env).sha };
		const api = githubRead(execute);
		const { source: repo } = studioRepositories(env);
		const mainSha = api(`repos/${repo}/git/ref/heads/main`).object?.sha;
		readAdmission(studioSha, internal, api, mainSha, repo);
		const rubatoSha = api("repos/Praxity/rubato/git/ref/heads/main").object?.sha;
		if (!/^[a-f0-9]{40}$/.test(rubatoSha)) throw new Error("Invalid Rubato revision");
		// The publisher builds from this SHA, so the guide and its sibling ship in one pack.
		const skill = api(
			`repos/Praxity/rubato/contents/skills/assessment-writing/SKILL.md?ref=${rubatoSha}`,
		);
		if (
			skill.type !== "file" ||
			skill.encoding !== "base64" ||
			!/^name: assessment-writing\s*$/m.test(
				Buffer.from(skill.content ?? "", "base64").toString("utf8"),
			)
		)
			throw new Error(
				"Pinned Rubato pack must include the assessment-writing skill before publishing the choice guide",
			);
		return { source_ref: studioSha, rubato_sha: rubatoSha };
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const outputs = admitRelease(process.env);
		for (const [name, value] of Object.entries(outputs))
			appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
