import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { test } from "node:test";
import { admitRelease } from "../apps/desktop/scripts/admit-rubato-release.mjs";

// Rubato installs docs/prax-format/ as the skill folder: SKILL.md plus its topic guides.
const formatRoot = new URL("../docs/prax-format/", import.meta.url);
const skills = ["SKILL.md", ...globSync("skill/*.md", { cwd: formatRoot })].map((path) => ({
	path: posix.normalize(path.replaceAll("\\", "/")),
	text: readFileSync(new URL(path, formatRoot), "utf8"),
}));

test("briefs route to Rubato's composer while prax-format owns source authoring", () => {
	const skill = skills.find(({ path }) => path === "SKILL.md").text;
	const description = skill.match(/^description: (.*)$/m)[1];
	assert.doesNotMatch(description, /build a course from a brief/);
	assert.match(description, /Write, edit, validate and export/);
	assert.match(skill, /`composer` skill/);
	assert.ok(skill.includes("https://github.com/Praxity/rubato/blob/main/skills/composer/SKILL.md"));
});

test("learner guidance owns French register, regional variety and the recorded answer", () => {
	const guidance = skills.find(({ path }) => path === "skill/learners.md").text;
	assert.match(guidance, /Ask the person[^\n]*`tu`[^\n]*`vous`/);
	assert.match(guidance, /Québec French/);
	assert.match(guidance, /Record the answer[^\n]*outline\.md/);
	assert.match(guidance, /or in the report to the person/);
	assert.doesNotMatch(guidance, /authoring notes/);
	assert.match(
		guidance,
		/adult professional courses[^\n]*`vous`[^\n]*unless the brief says otherwise/,
	);
});

test("French register defaults cover school-age learners and adults with brief overrides", () => {
	const guidance = skills.find(({ path }) => path === "skill/learners.md").text;
	assert.match(guidance, /school-age learners, use `tu`[^\n]*unless the brief says otherwise/);
	assert.match(
		guidance,
		/adults, including older adults[^\n]*`vous`[^\n]*unless the brief says otherwise/,
	);
	assert.match(guidance, /stated location[^\n]*Québec[^\n]*regional choice/);
	assert.match(guidance, /still ask for confirmation/);
});

test("tu courses disclose Studio's vous controls and preserve character voices", () => {
	const guidance = skills.find(({ path }) => path === "skill/learners.md").text;
	assert.match(guidance, /built-in French controls use `vous` for now[^\n]*course text uses `tu`/);
	assert.match(guidance, /never replace them with authored text/);
	assert.match(guidance, /composer tells the person about this mismatch/);
	assert.match(guidance, /text that addresses the learner/);
	assert.match(guidance, /Characters and quoted messages keep their own voices/);
});

test("choice guidance names Rubato's assessment-writing skill instead of a host path", () => {
	const guidance = skills.find(({ path }) => path === "skill/assessments.md").text;
	assert.match(guidance, /`assessment-writing` skill/);
	assert.ok(
		guidance.includes(
			"https://github.com/Praxity/rubato/blob/main/skills/assessment-writing/SKILL.md",
		),
	);
	// A relative link would leave the installed skill folder.
	assert.doesNotMatch(guidance, /\]\(\.\.\/\.\.\//);
});

test("the build order attacks choice questions before identity and marks rederivation planned", () => {
	const skill = skills.find(({ path }) => path === "SKILL.md").text;
	const order = skill.split("## Build or change a course")[1].split("Write source this way")[0];
	const attack = order.indexOf("`assessment-writing` skill");
	assert.ok(
		attack > 0 && attack < order.indexOf("Record identity"),
		"probe choices before identity and export",
	);
	// The CLI on main accepts no rederive flag; a person decides until it ships.
	assert.match(skill, /Rederivation is planned; the current CLI doesn't accept it\./);
	assert.match(skill, /has never been published, stop and let the person decide\./);
});

test("skill links resolve inside the installed prax-format folder", () => {
	for (const { path, text } of skills) {
		// Fenced and inline code hold placeholder destinations, not documentation links.
		const prose = text
			.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
			.replace(/(`+)[\s\S]*?\1/g, "");
		for (const [, href] of prose.matchAll(/\]\(([^\s)]+)\)/g)) {
			if (/^(?:[a-z][\w+.-]*:|#)/i.test(href)) continue;
			const target = posix.join(posix.dirname(path), href.split("#")[0]);
			assert.ok(!target.startsWith(".."), `${path} links outside the skill: ${href}`);
			assert.doesNotThrow(() => readFileSync(new URL(target, formatRoot)), `${path}: ${href}`);
		}
	}
});

test("pack admission requires the assessment skill at the exact pinned Rubato revision", () => {
	const sha = "1".repeat(40);
	const rubatoSha = "2".repeat(40);
	const required = `repos/Praxity/rubato/contents/skills/assessment-writing/SKILL.md?ref=${rubatoSha}`;
	const routes = [];
	const env = {
		STUDIO_SOURCE_REPO: "fixture/studio",
		STUDIO_CANDIDATE_REPO: "fixture/studio",
		INPUT_REF: sha,
		PACK_VERSION: "0.1.2",
		PUBLISH_PACK: "false",
		GITHUB_REF: "refs/heads/main",
		GITHUB_REF_TYPE: "branch",
	};
	const api = (skill) => (_command, args) => {
		const route = args.at(-1);
		routes.push(route);
		if (route.includes("/rubato/git/")) return JSON.stringify({ object: { sha: rubatoSha } });
		if (route === required) return JSON.stringify(skill);
		if (route.endsWith("/git/ref/heads/main")) return JSON.stringify({ object: { sha } });
		if (route.includes("/compare/")) return JSON.stringify({ merge_base_commit: { sha } });
		if (route.includes("/workflows/ci.yml/runs"))
			return JSON.stringify({
				workflow_runs: [
					{
						id: 1,
						head_sha: sha,
						head_branch: "main",
						event: "workflow_dispatch",
						status: "completed",
						conclusion: "success",
					},
				],
			});
		if (route.endsWith("/jobs?per_page=100"))
			return JSON.stringify([{ jobs: [{ name: "merge-gate", conclusion: "success" }] }]);
		throw new Error(`Unexpected route ${route}`);
	};
	const content = Buffer.from(
		"---\nname: assessment-writing\ndescription: Write choices.\n---\n",
	).toString("base64");
	assert.deepEqual(admitRelease(env, api({ type: "file", encoding: "base64", content })), {
		source_ref: sha,
		rubato_sha: rubatoSha,
	});
	assert.ok(routes.includes(required));
	for (const missing of [
		{},
		{ type: "dir" },
		{ type: "file", encoding: "base64", content: Buffer.from("other skill").toString("base64") },
	]) {
		assert.throws(() => admitRelease(env, api(missing)), /assessment-writing/);
	}
});
const confirmation =
	"Never pass `--rederive` unless the person has confirmed in this conversation that no version of the course was published.";
const praxityCommands =
	/(?<![\w-])(?:"(?:[^"\r\n`]*[/\\])?praxity"|'(?:[^'\r\n`]*[/\\])?praxity'|[^\s"'`;&|]*[/\\]praxity|praxity)\s+(identity\s+init|export)\b([^\r\n`;&|]*)/g;

function assertExportCommands(text) {
	let fence;
	const blockInits = new Set();
	const sectionInits = new Set();
	let exports = 0;
	for (const line of text.split(/\r?\n/)) {
		const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
		if (!fence && marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
			fence = marker[1];
			blockInits.clear();
			continue;
		} else if (
			fence &&
			marker &&
			marker[1][0] === fence[0] &&
			marker[1].length >= fence.length &&
			marker[2].trim() === ""
		) {
			fence = undefined;
			continue;
		}
		if (!fence && /^\s*(?:#{1,6}\s|(?:=+|-+)\s*$)/.test(line)) sectionInits.clear();
		// Scan every language and prose with the same detector, including prefixed executables.
		const commands = line.matchAll(praxityCommands);
		for (const [, command, args] of commands) {
			const argument = args.trim();
			const course = argument.match(/^("[^"]+"|'[^']+'|[^\s-]\S*)(?:\s|$)/)?.[1];
			if (command !== "export") {
				if (course && argument === course) {
					blockInits.add(course);
					sectionInits.add(course);
				}
				continue;
			}
			assert.ok(course, `Export needs a course argument: ${line}`);
			assert.ok(
				(fence ? blockInits : sectionInits).has(course),
				`Export needs preceding flagless init for ${course}: ${line}`,
			);
			exports++;
		}
	}
	// Even an unparsed Markdown construct must not hide an export from the guard.
	assert.equal(
		exports,
		[...text.matchAll(praxityCommands)].filter(([, command]) => command === "export").length,
	);
	return exports;
}

function assertRederivation(text) {
	assert.ok(!text.replaceAll(confirmation, "").includes("--rederive"));
}

test("every shipped export has preceding flagless init for the same course", () => {
	assert.ok(skills.length > 0);
	assert.equal(
		skills.reduce((count, { text }) => count + assertExportCommands(text), 0),
		1,
	);
});

test("shipped skills mention rederivation only in the agreed confirmation sentence", () => {
	assert.ok(skills.find(({ path }) => path === "SKILL.md").text.includes(confirmation));
	for (const { text } of skills) assertRederivation(text);
});

const init = "praxity identity init ./course";
const exportCommand = "praxity export ./course --format html --output ./course.zip";
const shellBlock = (commands) => `\`\`\`sh\n${commands}\n\`\`\`\n`;
const valid = shellBlock(`${init}\n${exportCommand}`);

test("command guards accept initialized exports in every supported context", () => {
	for (const tag of ["", "text", "console", 'sh title="export"', "SH"]) {
		assert.equal(assertExportCommands(valid.replace("```sh", `\`\`\`${tag}`)), 1);
	}
	for (const executable of [
		"npx praxity",
		'"praxity"',
		'"$RUBATO_TOOLS_DIR/bin/praxity"',
		"${RUBATO_TOOLS_DIR}/bin/praxity",
		"./bin/praxity",
		'"/path with spaces/praxity"',
	]) {
		assert.equal(assertExportCommands(valid.replaceAll("praxity", executable)), 1);
	}
	for (const separator of [" && ", "; "]) {
		assert.equal(
			assertExportCommands(
				shellBlock(`cd ./course${separator}${init}${separator}${exportCommand}`),
			),
			1,
		);
	}
	assert.equal(
		assertExportCommands(`## Export\nFirst run \`${init}\`.\nThen run \`${exportCommand}\`.`),
		1,
	);
	assert.equal(assertExportCommands(valid.replaceAll("```", "    ~~~")), 1);
	assert.equal(assertExportCommands(valid.replaceAll("./course", '"./a course"')), 1);
	assert.equal(assertExportCommands(`Run \`${init}\`, then \`\`\`${exportCommand}\`\`\`.`), 1);
});

test("command guards reject the required mutations", async (t) => {
	assert.equal(assertExportCommands(valid), 1);
	assertRederivation(confirmation);
	for (const [name, text] of [
		["init removed", shellBlock(exportCommand)],
		["init moved after export", shellBlock(`${exportCommand}\n${init}`)],
		["init given --yes", shellBlock(`${init} --yes\n${exportCommand}`)],
		["init given another course", shellBlock(`${init}-other\n${exportCommand}`)],
		["second export block without init", valid + shellBlock(exportCommand)],
		["untagged block", `${valid}\`\`\`\n${exportCommand}\n\`\`\``],
		["text block", valid + shellBlock(exportCommand).replace("```sh", "```text")],
		["console block", valid + shellBlock(`$ ${exportCommand}`).replace("```sh", "```console")],
		["npx prefix", valid + shellBlock(`npx ${exportCommand}`)],
		[
			"tools directory",
			valid + shellBlock(exportCommand.replace("praxity", '"$RUBATO_TOOLS_DIR/bin/praxity"')),
		],
		["chained command", valid + shellBlock(`cd ./course && ${exportCommand}`)],
		["semicolon chain", valid + shellBlock(`cd ./course; ${exportCommand}`)],
		["inline export", `${valid}\n## Export\nThen run \`${exportCommand}\`.`],
		["init in another section", `## Init\nRun \`${init}\`.\n## Export\nRun \`${exportCommand}\`.`],
		["init after inline export", `Run \`${exportCommand}\`, then \`${init}\`.`],
		["triple backtick inline export", `\`\`\`${exportCommand}\`\`\``],
		["export hidden in fence metadata", `\`\`\`sh ${exportCommand}\n\`\`\``],
		[
			"fence info string",
			valid + shellBlock(exportCommand).replace("```sh", '```sh title="export"'),
		],
		["uppercase tag", valid + shellBlock(exportCommand).replace("```sh", "```SH")],
		["indented fence", valid + shellBlock(exportCommand).replaceAll("```", "    ```")],
	]) {
		await t.test(name, () =>
			assert.throws(() => assertExportCommands(text), assert.AssertionError),
		);
	}
	await t.test("stray --rederive", () =>
		assert.throws(
			() => assertRederivation(`${confirmation}\n${init} --rederive`),
			assert.AssertionError,
		),
	);
});
