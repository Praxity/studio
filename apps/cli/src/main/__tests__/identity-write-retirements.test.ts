import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOperation } from "@praxity/operations";
import { afterEach, expect, it } from "vitest";
import {
	initializeCourseIdentity,
	loadIdentityStore,
	persistCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { withProjectFileTransaction } from "../project-file-transactions";

const source = "# Page\n\n::: video clip.mp4\ncaption: Existing caption.\n:::\n\n## Heading\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, file));
		else result[file] = (await readFile(join(root, file))).toString("base64");
	}
	return result;
}

it.each(["rewrite", "move and reword", "none"])(
	"recorded page deletion refuses an earlier outside loss: %s",
	async (outside) => {
		const root = await mkdtemp(join(tmpdir(), "identity-page-retirements-"));
		roots.push(root);
		const saved =
			"# Page\n\nAlpha paragraph about safety rules here.\n\nBeta paragraph about tools here.\n\n# Second\n\nOther page text.\n";
		await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), saved);
		await initializeCourseIdentity(root, ["lesson.prax"]);
		const current =
			outside === "rewrite"
				? saved.replace(
						"Alpha paragraph about safety rules here.",
						"Completely unrelated outside text.",
					)
				: outside === "move and reword"
					? saved
							.replace("Alpha paragraph about safety rules here.\n\n", "")
							.replace(
								"Other page text.",
								"Other page text.\n\nAlpha: safety rules, reworded and moved here.",
							)
					: saved;
		await writeFile(join(root, "lesson.prax"), current);
		const before = await bytes(root);
		await withProjectFileTransaction(
			root,
			async () => {
				const base = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				const page = base.identity.sourceMappings.find((node) => node.path.join() === "0");
				if (!page) throw new Error("Missing page deletion target");
				const plan = applyOperation(
					[{ path: "lesson.prax", source: current }],
					{
						transactionId: randomUUID(),
						operation: "deletePage",
						files: [{ path: "lesson.prax", baseRevision: digest(current) }],
						targets: [
							{
								file: "lesson.prax",
								ref: {
									kind: "node",
									nodeId: page.id,
									path: page.path,
									fingerprint: page.fingerprint,
								},
								expectedText: current.slice(page.span.start, page.span.end),
							},
						],
						args: {},
					},
					{
						identity: base.identity,
						activeHistoryIds: base.activeHistoryIds,
						readerRoles: true,
						allocateId: randomUUID,
						digest,
					},
				);
				if (!plan.ok) throw new Error(`Page deletion refused: ${plan.code}`);
				const candidate = await resolveCourseIdentity(root, {
					lessonPaths: ["lesson.prax"],
					operationBase: base,
					operationPlan: plan,
					operations: plan.evidence,
					sources: Object.fromEntries(plan.history.after.map((file) => [file.path, file.source])),
				});
				if (outside === "none") {
					await persistCourseIdentity(root, candidate);
					expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
						"# Second\n\nOther page text.\n",
					);
				} else {
					await expect(persistCourseIdentity(root, candidate)).rejects.toMatchObject({
						retirements: expect.arrayContaining([
							expect.objectContaining({
								file: "lesson.prax",
								page: "Page",
								label: "Alpha paragraph about safety rules here.",
							}),
						]),
					});
					expect(await bytes(root)).toEqual(before);
				}
			},
			"write",
			false,
		);
	},
);

it.each(["recorded", "outside", "outside before a recorded heading edit"])(
	"I4 admits only the recorded caption clear: %s",
	async (mode) => {
		const root = await mkdtemp(join(tmpdir(), "identity-write-retirements-"));
		roots.push(root);
		await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), source);
		await initializeCourseIdentity(root, ["lesson.prax"]);
		if (mode !== "recorded")
			await writeFile(join(root, "lesson.prax"), source.replace("Existing caption.", ""));
		const original = await bytes(root);
		await withProjectFileTransaction(
			root,
			async () => {
				const base = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				let candidate = base;
				if (mode !== "outside") {
					const text = base.lessons.get("lesson.prax")?.tree.stream.source;
					const path = mode === "recorded" ? [0, 0, 0] : [0, 1];
					const target = base.identity.sourceMappings.find(
						(node) => node.path.join() === path.join(),
					);
					if (!target || text === undefined) throw new Error("Missing operation target");
					const plan = applyOperation(
						[{ path: "lesson.prax", source: text }],
						{
							transactionId: randomUUID(),
							operation: "setText",
							files: [{ path: "lesson.prax", baseRevision: digest(text) }],
							targets: [
								{
									file: "lesson.prax",
									ref: { kind: "node", nodeId: target.id, path, fingerprint: target.fingerprint },
									expectedText: text.slice(target.span.start, target.span.end),
								},
							],
							args:
								mode === "recorded"
									? { field: "value", text: "" }
									: { field: "subject", text: "Saved heading" },
						},
						{
							identity: base.identity,
							activeHistoryIds: base.activeHistoryIds,
							readerRoles: true,
							allocateId: randomUUID,
							digest,
						},
					);
					if (!plan.ok) throw new Error(`Operation refused: ${plan.code}`);
					candidate = await resolveCourseIdentity(root, {
						lessonPaths: ["lesson.prax"],
						operationBase: base,
						operationPlan: plan,
						operations: plan.evidence,
						sources: Object.fromEntries(plan.history.after.map((file) => [file.path, file.source])),
					});
				}
				if (mode === "recorded") {
					await persistCourseIdentity(root, candidate);
					expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
						source.replace("Existing caption.", ""),
					);
				} else {
					await expect(persistCourseIdentity(root, candidate)).rejects.toMatchObject({
						retirements: [
							{ file: "lesson.prax", page: "Page", label: "clip.mp4", line: null },
							{ file: "lesson.prax", page: "Page", label: "caption", line: null },
							{ file: "lesson.prax", page: "Page", label: "caption", line: null },
						],
					});
					expect(await bytes(root)).toEqual(original);
				}
			},
			"write",
			false,
		);
	},
);

it("I4 recorded page title changes cover their live reader title retirement", async () => {
	const root = await mkdtemp(join(tmpdir(), "identity-write-retirements-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
	await writeFile(join(root, "lesson.prax"), source);
	await initializeCourseIdentity(root, ["lesson.prax"]);
	await withProjectFileTransaction(
		root,
		async () => {
			const base = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			const page = base.identity.sourceMappings.find((node) => node.path.join() === "0");
			if (!page) throw new Error("Missing page");
			const title = base.identity.snapshots
				.flatMap((snapshot) => Object.entries(snapshot.nodes))
				.find(([, node]) => node.kind === "part" && node.parent === page.id);
			if (!title) throw new Error("Missing reader title");
			const after = source.replace("# Page", "# A wholly different title");
			const candidate = await resolveCourseIdentity(root, {
				lessonPaths: ["lesson.prax"],
				operationBase: base,
				sources: { "lesson.prax": after },
				operations: [
					{
						intent: "modify",
						files: [
							{
								path: "lesson.prax",
								fromRevision: digest(source),
								toRevision: digest(after),
								fromSnapshot: base.identity.heads[0].head,
							},
						],
						mapping: [{ oldId: page.id, newId: page.id, fate: "kept" }],
						placements: [{ mappingIndex: 0, file: "lesson.prax", path: [0] }],
					},
				],
			});
			expect(
				candidate.identity.snapshots
					.flatMap((snapshot) => Object.entries(snapshot.nodes))
					.find(([id]) => id === title[0])?.[1].status,
			).toBe("retired");
			await persistCourseIdentity(root, candidate);
			expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(after);
		},
		"write",
		false,
	);
});

it.each(
	["text", "note"].flatMap((type) => [false, true, "target"].map((outside) => ({ type, outside }))),
)(
	"I4 recorded $type subtree replacement, prior outside loss $outside",
	async ({ type, outside }) => {
		const root = await mkdtemp(join(tmpdir(), "identity-recorded-subtree-"));
		roots.push(root);
		const saved = `# Page\n\n::: ${type}\nOriginal body.\n:::\n\nOther subject.\n`;
		await writeFile(join(root, "course.yaml"), "title: Test\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), saved);
		await initializeCourseIdentity(root, ["lesson.prax"]);
		const savedTarget = (await loadIdentityStore(root)).snapshots
			.flatMap((snapshot) => Object.entries(snapshot.nodes))
			.find(([, node]) => node.type === type)?.[0];
		if (outside)
			await writeFile(
				join(root, "lesson.prax"),
				saved.replace(
					outside === "target" ? "Original body." : "Other subject.",
					"A completely unrelated outside replacement.",
				),
			);
		const before = await bytes(root);
		await withProjectFileTransaction(
			root,
			async () => {
				const base = await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
				const text = base.lessons.get("lesson.prax")?.tree.stream.source;
				const target = base.identity.sourceMappings.find((node) => node.path.join() === "0,0");
				if (!target || text === undefined) throw new Error("Missing recorded target");
				if (outside === "target") expect(target.id).not.toBe(savedTarget);
				const plan = applyOperation(
					[{ path: "lesson.prax", source: text }],
					{
						transactionId: randomUUID(),
						operation: "editSource",
						files: [{ path: "lesson.prax", baseRevision: digest(text) }],
						targets: [
							{
								file: "lesson.prax",
								ref: {
									kind: "node",
									nodeId: target.id,
									path: target.path,
									fingerprint: target.fingerprint,
								},
								expectedText: text.slice(target.span.start, target.span.end),
							},
						],
						args: { text: `::: ${type}\nEntirely replaced text.\n` },
					},
					{
						identity: base.identity,
						activeHistoryIds: base.activeHistoryIds,
						readerRoles: true,
						allocateId: randomUUID,
						digest,
					},
				);
				if (!plan.ok) throw new Error(`Operation refused: ${plan.code}`);
				const result = await resolveCourseIdentity(root, {
					lessonPaths: ["lesson.prax"],
					operationBase: base,
					operationPlan: plan,
					operations: plan.evidence,
					sources: Object.fromEntries(plan.history.after.map((file) => [file.path, file.source])),
				});
				if (outside) {
					await expect(persistCourseIdentity(root, result)).rejects.toMatchObject({
						retirements:
							outside === "target"
								? [
										{ file: "lesson.prax", page: "Page", label: type, line: null },
										{ file: "lesson.prax", page: "Page", label: "Original body.", line: null },
									]
								: [{ file: "lesson.prax", page: "Page", label: "Other subject.", line: null }],
					});
					expect(await bytes(root)).toEqual(before);
				} else {
					await persistCourseIdentity(root, result);
					expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
						saved.replace("Original body.", "Entirely replaced text."),
					);
				}
			},
			"write",
			false,
		);
	},
);
