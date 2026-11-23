import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

for (const name of ["ci", "security", "cli-proof", "cli-release"])
	test(`${name} runs only in the source repository, including every environment job`, () => {
		const workflow = parse(
			readFileSync(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), "utf8"),
		);
		for (const [id, job] of Object.entries(workflow.jobs)) {
			assert.match(
				job.if,
				/github\.repository == \(vars\.STUDIO_SOURCE_REPO \|\| github\.repository\)/,
				id,
			);
			const expression = job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
			for (const event_name of ["pull_request", "schedule", "workflow_dispatch"])
				assert.equal(
					Function(
						"github",
						"vars",
						`return (${expression});`,
					)(
						{ repository: "fixture/candidates", event_name },
						{ STUDIO_SOURCE_REPO: "fixture/source" },
					),
					false,
					`${name}/${id}/${event_name}`,
				);
		}
	});
