import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { studioRepositories } from "./studio-repositories.mjs";

test("source and candidate repositories have independent explicit settings", () => {
	assert.deepEqual(
		studioRepositories({
			STUDIO_SOURCE_REPO: "fixture/source",
			STUDIO_CANDIDATE_REPO: "fixture/candidates",
		}),
		{ source: "fixture/source", candidate: "fixture/candidates" },
	);
});

test("Actions defaults both repositories to its current repository", () => {
	assert.deepEqual(
		studioRepositories({ GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "fixture/current" }),
		{ source: "fixture/current", candidate: "fixture/current" },
	);
});

for (const name of ["STUDIO_SOURCE_REPO", "STUDIO_CANDIDATE_REPO"]) {
	test(`${name} is required outside Actions, even with GITHUB_REPOSITORY set`, () => {
		const env = {
			STUDIO_SOURCE_REPO: "fixture/source",
			STUDIO_CANDIDATE_REPO: "fixture/candidates",
			GITHUB_REPOSITORY: "fixture/current",
		};
		delete env[name];
		assert.throws(() => studioRepositories(env), new RegExp(name));
	});
	for (const value of [
		"",
		"owner",
		"owner/repo/extra",
		"../repo",
		"owner/..",
		"owner/repo?x=1",
		" owner/repo",
		"owner/repo\n",
	]) {
		test(`${name} refuses malformed owner/name ${JSON.stringify(value)}`, () => {
			assert.throws(
				() =>
					studioRepositories({
						STUDIO_SOURCE_REPO: "fixture/source",
						STUDIO_CANDIDATE_REPO: "fixture/candidates",
						[name]: value,
					}),
				new RegExp(name),
			);
		});
	}
	test(`installer refuses missing ${name} before starting`, () => {
		const env = {
			...process.env,
			GITHUB_ACTIONS: "false",
			STUDIO_SOURCE_REPO: "fixture/source",
			STUDIO_CANDIDATE_REPO: "fixture/candidates",
		};
		delete env[name];
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL("../../../scripts/install-internal-studio.mjs", import.meta.url)),
				"--rubato",
				"unused",
			],
			{ env, encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr + result.stdout, new RegExp(name));
	});
}
