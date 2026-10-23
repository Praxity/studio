import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [baselinePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !outputPath)
	throw new Error("Usage: capture-legacy-store.ts <baseline-checkout> <output-directory>");
const baseline = resolve(baselinePath);
const output = resolve(outputPath);
const revision = execFileSync("git", ["-C", baseline, "rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim();
if (revision !== "a7c88dfa4f2aa51e1bf70aa89f82a2ccd0796f66")
	throw new Error("Capture requires the documented pre-extension baseline revision");
const { readLesson } = (await import(
	pathToFileURL(join(baseline, "packages/grammar/src/read-lesson.ts")).href
)) as typeof import("@praxity/grammar");
const { resolveIdentity, serializeIdentity } = (await import(
	pathToFileURL(join(baseline, "packages/content-identity/src/index.ts")).href
)) as typeof import("../src/index.ts");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const fixtures = new URL("../__tests__/fixtures/legacy-store/", import.meta.url);

for (const mode of ["tree-only", "reader-roles", "duplicate-projections"]) {
	const readerRoles = mode !== "tree-only";
	const source = readFileSync(new URL(`${mode}/initial-source.prax`, fixtures), "utf8");
	const root = join(output, mode);
	mkdirSync(join(root, "snapshots"), { recursive: true });
	let nextId = 0;
	const dependencies = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
	};
	const document = (text: string) => {
		const read = readLesson(text);
		const errors = read.errors.filter(
			(error) => error.level === "error" || error.level === "critical",
		);
		if (errors.length) throw new Error(JSON.stringify(errors));
		return { path: "lesson.prax", tree: read.tree };
	};
	const writeJson = (file: string, value: unknown) =>
		writeFileSync(join(root, `${file}.txt`), serializeIdentity(value));
	const initial = resolveIdentity(
		{ parsedDocuments: [document(source)], priorSnapshots: [], readerRoles },
		dependencies,
	);
	writeFileSync(join(root, "initial-source.prax"), source);
	writeJson("initial-snapshot.json", initial.snapshots[0]);
	const question = Object.values(initial.snapshots[0].nodes).find((node) => node.type === "choice");
	if (!question) throw new Error("Missing synthetic choice");
	question.consumerRevisions = {
		state: { signature: digest("synthetic answer policy"), epoch: 3 },
	};
	initial.heads[0].head = digest(serializeIdentity(initial.snapshots[0]));
	let prior = initial;
	let text = source;
	const history: string[] = [];
	const save = () => {
		const hash = digest(serializeIdentity(prior.snapshots[0]));
		writeJson(`snapshots/${hash}.json`, prior.snapshots[0]);
		history.push(hash);
	};
	save();
	for (const [type, removed, fate] of [
		["note", "::: note\nCut explanation.\n:::\n\n", "cut"],
		["text", "::: text\nRetired explanation.\n:::\n", "retired"],
	] as const) {
		if (!text.includes(removed)) continue;
		const entry = Object.entries(prior.snapshots[0].nodes).find(([, node]) => node.type === type);
		if (!entry) throw new Error(`Missing synthetic ${type}`);
		const next = text.replace(removed, "");
		prior = resolveIdentity(
			{
				course: prior.course,
				priorHeads: prior.heads,
				priorSnapshots: prior.snapshots,
				parsedDocuments: [document(next)],
				readerRoles,
				operations: [
					{
						intent: "delete",
						files: [
							{
								path: "lesson.prax",
								fromRevision: digest(text),
								toRevision: digest(next),
								fromSnapshot: prior.heads[0].head,
							},
						],
						mapping: [{ oldId: entry[0], newId: null, fate }],
						placements: [],
					},
				],
			},
			dependencies,
		);
		if (prior.unresolved.length) throw new Error(JSON.stringify(prior.unresolved));
		text = next;
		save();
	}
	writeFileSync(join(root, "lesson.prax"), text);
	writeJson("course.json", prior.course);
	writeJson("head.json", prior.heads[0]);
	writeFileSync(
		join(root, "expected.json"),
		`${JSON.stringify(
			{
				readerRoles,
				history,
				lessonId: prior.snapshots[0].lessonId,
				sourceMappings: prior.sourceMappings,
				exportIds: prior.exportIds,
				statuses: Object.fromEntries(
					Object.entries(prior.snapshots[0].nodes).map(([id, node]) => [id, node.status]),
				),
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(mode, revision, Object.keys(prior.snapshots[0].nodes).length);
}
