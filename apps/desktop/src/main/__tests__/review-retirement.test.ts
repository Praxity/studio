import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { loadIdentityStore } from "../identity-store";
import { OperationService } from "../operations/operation-service";
import { createStudioProjectSession } from "../studio/project-session";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function hashes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await hashes(root, path));
		else
			result[path] = createHash("sha256")
				.update(await readFile(join(root, path)))
				.digest("hex");
	}
	return result;
}

const fields = [
	{ kind: "page", block: "# Page {style=none}", old: "Page", text: "Revised page" },
	{ kind: "heading", block: "## Heading {level=3}", old: "Heading", text: "Revised heading" },
	{ kind: "body", block: "Paragraph *text*.", old: "Paragraph *text*.", text: "New **text**." },
	{ kind: "list-entry", block: "- Leaf item", old: "Leaf item", text: "Revised leaf" },
	{
		kind: "option",
		block: "::: choice Pick\n(x) First\n( ) Second\n:::",
		old: "Second",
		text: "Revised option",
	},
	{
		kind: "feedback",
		block: "::: choice Pick\ncorrect: Keep listening.\n(x) First\n( ) Second\n:::",
		old: "Keep listening.",
		text: "Listen carefully.",
	},
	{
		kind: "figure caption",
		block: "::: figure\n![Exact alt](image.png)\nFigure *caption*.\n:::",
		old: "Figure *caption*.",
		text: "Revised **figure**.",
	},
	{
		kind: "media caption",
		block: "::: video clip.mp4\ncaption: Media *caption*.\ntranscript: Keep transcript\n:::",
		old: "Media *caption*.",
		text: "Revised **media**.",
	},
];

it.each(
	fields.flatMap((field) =>
		["CLI", "canvas RPC"].flatMap((transport) =>
			["absent", "existing", "malformed"].map((review) => ({ ...field, transport, review })),
		),
	),
)("$transport $kind leaves $review review evidence untouched", async (scenario) => {
	const root = await mkdtemp(join(tmpdir(), "review-retirement-"));
	roots.push(root);
	const source =
		`\uFEFF${scenario.kind === "page" ? "" : "# Before\n\n"}${scenario.block}\n\nTail.`.replaceAll(
			"\n",
			"\r\n",
		);
	await writeFile(join(root, "lesson.prax"), source);
	await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
	await persistFixtureIdentity(root);
	const stored = await loadIdentityStore(root);
	if (!stored.course) throw new Error("Missing fixture identity");
	if (scenario.review !== "absent") {
		await mkdir(join(root, ".praxity/review/accepted"), { recursive: true });
		await writeFile(
			join(root, ".praxity/review/next-run.json"),
			scenario.review === "existing"
				? '{ "schema": 1, "author": "Previous author", "createdAt": "2026-10-12T00:00:00Z", "summaries": [] }\n'
				: '{"schema":99}',
		);
		await writeFile(
			join(root, ".praxity/review/state.json"),
			JSON.stringify({
				schema: 1,
				courseId: stored.course.courseId,
				baseline: [{ path: "lesson.prax", snapshotRef: stored.heads[0].head }],
				runs: [],
				suggestions: [],
			}) + "\n",
		);
		await writeFile(join(root, ".praxity/review/accepted/lesson.prax"), source);
		await writeFile(join(root, ".praxity/review/other.bin"), Buffer.from([0, 255, 13, 10]));
	}
	const before = await hashes(root);
	const service = new OperationService(root);
	const session =
		scenario.transport === "canvas RPC"
			? await createStudioProjectSession(root, "test")
			: undefined;
	if (session) sessions.push(session);
	expect(await hashes(root)).toEqual(before);
	const snapshot = await service.canvasTextSnapshot();
	const field = snapshot.fields.find((field) => field.text === scenario.old);
	if (!field) throw new Error(`Missing ${scenario.kind} fixture field`);
	const input = {
		transactionId: randomUUID(),
		operation: "setText",
		file: field.file,
		nodeId: field.nodeId,
		baseRevision: field.baseRevision,
		expectedText: field.text,
		field: field.field,
		text: scenario.text,
	};
	if (session) {
		expect(await session.invoke("canvasTextApply", input)).toMatchObject({ ok: true });
	} else {
		const args = [
			"edit",
			root,
			"setText",
			"--at",
			field.nodeId,
			"--rendered",
			"--arg",
			`field=${field.field}`,
			"--arg",
			`text=${JSON.stringify(scenario.text)}`,
			"--expect-revision",
			field.baseRevision,
			"--json",
		];
		expect(
			(
				await runPraxityCli([...args, "--dry-run"], {
					appVersion: "test",
					exportAssetsDir: "unused",
				})
			).exitCode,
		).toBe(0);
		expect(await hashes(root)).toEqual(before);
		const result = await runPraxityCli(args, { appVersion: "test", exportAssetsDir: "unused" });
		expect(result.exitCode, result.stdout || result.stderr).toBe(0);
	}
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
		source.replace(scenario.old, scenario.text),
	);
	const after = await hashes(root);
	const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
		(path) => before[path] !== after[path] && !path.startsWith(".praxity-write-"),
	);
	expect(
		changed.filter(
			(path) =>
				path !== "lesson.prax" && !/^\.praxity\/identity\/(snapshots|lessons)\//u.test(path),
		),
	).toEqual([]);
	expect(changed.filter((path) => path.startsWith(".praxity/identity/snapshots/"))).toHaveLength(1);
	expect(changed.filter((path) => path.startsWith(".praxity/identity/lessons/"))).toHaveLength(1);
	const updated = await service.canvasTextSnapshot();
	expect(updated.fields.map((field) => [field.nodeId, field.ownerId])).toEqual(
		snapshot.fields.map((field) => [field.nodeId, field.ownerId]),
	);
});
