import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tokenizeLesson } from "../../grammar/src/v4/lex";
import { getDefinition } from "../../grammar/src/v4/schema";
import { analyzeLessonTree } from "../../grammar/src/v4/tree";
import {
	type IdentityResolution,
	mergeIdentity,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const deps = { digest, allocateId: randomUUID };
const documents = (sources: Record<string, string>) =>
	Object.entries(sources).map(([path, source]) => ({
		path,
		tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
	}));
const first = "# First\n\nThe course keeps every paragraph on this page.\n";
const second = "# Second\n\nA separate lesson has its own stable paragraph.\n";
const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) {
		if (!resolve(folder).startsWith(`${resolve(tmpdir())}${sep}identity-merge-`))
			throw new Error("Unsafe fixture cleanup");
		rmSync(folder, { recursive: true, force: true });
	}
});

/** Each test reads actual branch commits and the git common base, never mocks git. */
function fixture(
	sources = { "first.prax": first, "second.prax": second },
	prepare?: (state: IdentityResolution) => void,
) {
	const folder = mkdtempSync(join(tmpdir(), "identity-merge-"));
	folders.push(folder);
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
	git("init", "-b", "base");
	git("config", "user.name", "Identity fixture");
	git("config", "user.email", "identity@example.invalid");
	git("config", "core.autocrlf", "false");
	const base = resolveIdentity({ parsedDocuments: documents(sources), priorSnapshots: [] }, deps);
	prepare?.(base);
	const save = (state: IdentityResolution, content: Record<string, string>) => {
		writeFileSync(join(folder, "identity.json"), serializeIdentity(state));
		for (const [path, source] of Object.entries(content)) writeFileSync(join(folder, path), source);
		git("add", "-A");
		git("commit", "-m", "Fixture revision");
	};
	save(base, sources);
	const branch = (name: string, content: Record<string, string>, state?: IdentityResolution) => {
		git("checkout", "-b", name, "base");
		for (const path of Object.keys(sources)) rmSync(join(folder, path), { force: true });
		const next =
			state ??
			resolveIdentity(
				{
					course: base.course,
					priorSnapshots: base.snapshots,
					priorHeads: base.heads,
					parsedDocuments: documents(content),
				},
				deps,
			);
		save(next, content);
		return next;
	};
	const read = (ref: string) =>
		JSON.parse(git("show", `${ref}:identity.json`)) as IdentityResolution;
	const common = () => read(git("merge-base", "ours", "theirs"));
	return { base, branch, read, common, folder };
}

function ids(state: IdentityResolution, file: string) {
	return state.sourceMappings.filter((m) => m.file === file).map((m) => m.id);
}
function present<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error("Missing fixture value");
	return value;
}

// Real git subprocesses share this machine with builds and other worktrees.
describe("course-wide identity on real git branches", { timeout: 30_000 }, () => {
	it("retains both branches' lineage for a shared addition absent from the base", () => {
		const f = fixture();
		const source = `${first}\nA shared addition appears on both branches.\n`;
		const left = f.branch("ours", { "first.prax": source, "second.prax": second });
		const addedId = present(
			ids(left, "first.prax").find((id) => !ids(f.base, "first.prax").includes(id)),
		);
		const donorId = present(
			f.base.sourceMappings.find((m) => m.file === "first.prax" && m.path.length === 2),
		).id;
		const right = structuredClone(left);
		right.snapshots[0].nodes[addedId].lineage = [donorId];
		right.heads[0].head = digest(serializeIdentity(right.snapshots[0]));
		f.branch("theirs", { "first.prax": source, "second.prax": second }, right);
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": source, "second.prax": second }),
			deps,
		);
		expect(result.conflicts).toEqual([]);
		expect(present(result.resolution).snapshots[0].nodes[addedId].lineage).toEqual([donorId]);
	});
	it.each([
		[2, true],
		[3, false],
	] as const)(
		"cross-file blocks respect the ownerless boundary with %s changed characters",
		(count, keep) => {
			const original = "%".repeat(52);
			const edited = "%".repeat(25) + "!".repeat(count) + "%".repeat(27 - count);
			const f = fixture({ "first.prax": `# From\n${original}\n`, "second.prax": "# To\n" });
			f.branch("ours", { "first.prax": "# From\n", "second.prax": `# To\n${edited}\n` });
			f.branch("theirs", { "first.prax": `# From\n${original}\n`, "second.prax": "# To\n" });
			const previous = present(
				f.common().sourceMappings.find((m) => m.file === "first.prax" && m.path.length === 2),
			);
			const moved = present(
				f.read("ours").sourceMappings.find((m) => m.file === "second.prax" && m.path.length === 2),
			);
			expect(moved.id === previous.id).toBe(keep);
		},
	);
	it.each(["first.prax", "renamed.prax"])("never revives a retired lesson at %s", (file) => {
		const f = fixture(undefined, (state) => {
			for (const node of Object.values(state.snapshots[0].nodes)) node.status = "retired";
			state.heads[0].head = digest(serializeIdentity(state.snapshots[0]));
		});
		f.branch("ours", { [file]: first, "second.prax": second });
		f.branch("theirs", { "first.prax": first, "second.prax": second });
		const retiredIds = Object.keys(f.common().snapshots[0].nodes);
		for (const id of ids(f.read("ours"), file)) expect(retiredIds).not.toContain(id);
	});
	it("a whole-file copy cannot steal IDs from an edited original that still exists", () => {
		const f = fixture();
		f.branch("ours", {
			"first.prax": first.replace("every", "evrey"),
			"second.prax": second,
			"copy.prax": first,
		});
		f.branch("theirs", { "first.prax": first, "second.prax": second });
		expect(ids(f.read("ours"), "first.prax")).toEqual(ids(f.common(), "first.prax"));
		for (const id of ids(f.read("ours"), "copy.prax"))
			expect(ids(f.common(), "first.prax")).not.toContain(id);
	});
	it("returns a conflict when disjoint ownership changes form a merged parent cycle", () => {
		const source = `${first}\nAnother block shares the same parent.\n`;
		const f = fixture({ "first.prax": source, "second.prax": second });
		const blocks = f.base.sourceMappings.filter(
			(m) => m.file === "first.prax" && m.path.length === 2,
		);
		const left = structuredClone(f.base);
		left.snapshots[0].nodes[blocks[0].id].parent = blocks[1].id;
		left.heads[0].head = digest(serializeIdentity(left.snapshots[0]));
		const right = structuredClone(f.base);
		right.snapshots[0].nodes[blocks[1].id].parent = blocks[0].id;
		right.heads[0].head = digest(serializeIdentity(right.snapshots[0]));
		f.branch("ours", { "first.prax": source, "second.prax": second }, left);
		f.branch("theirs", { "first.prax": source, "second.prax": second }, right);
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": source, "second.prax": second }),
			deps,
		);
		expect(result.resolution).toBeNull();
		expect(result.conflicts).toContainEqual(
			expect.objectContaining({ reason: "divergent-change", field: "parent-cycle" }),
		);
	});
	it("detects simultaneous lesson renames with a small external edit using whole-lesson evidence", () => {
		const f = fixture();
		f.branch("ours", {
			"renamed.prax": first.replace("every", "evrey"),
			"also-renamed.prax": second.replace("separate", "separat"),
		});
		f.branch("theirs", { "first.prax": first, "second.prax": second });
		expect(ids(f.read("ours"), "renamed.prax")).toEqual(ids(f.common(), "first.prax"));
		expect(ids(f.read("ours"), "also-renamed.prax")).toEqual(ids(f.common(), "second.prax"));
	});
	it("refuses merged documents that silently discard one branch's added entity", () => {
		const f = fixture();
		const added = `${first}\nThis addition must survive the identity merge.\n`;
		f.branch("ours", { "first.prax": added, "second.prax": second });
		f.branch("theirs", {
			"first.prax": first,
			"second.prax": second.replace("separate", "separat"),
		});
		const addedId = present(
			ids(f.read("ours"), "first.prax").find((id) => !ids(f.base, "first.prax").includes(id)),
		);
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": first, "second.prax": second.replace("separate", "separat") }),
			deps,
		);
		expect(result.resolution).toBeNull();
		expect(result.conflicts).toContainEqual(
			expect.objectContaining({ reason: "documents-mismatch", ids: [addedId] }),
		);
	});
	it("merges independent insertions without treating shifted orders as content conflicts", () => {
		const source = `${first}\nThe final paragraph follows both independently added paragraphs.\n`;
		const f = fixture({ "first.prax": source, "second.prax": second });
		const left = source.replace("The course", "Our new introduction.\n\nThe course");
		const right = source.replace(
			"The course",
			"Their new introduction.\n\nAnother separate introduction.\n\nThe course",
		);
		f.branch("ours", { "first.prax": left, "second.prax": second });
		f.branch("theirs", { "first.prax": right, "second.prax": second });
		const merged = source.replace(
			"The course",
			"Our new introduction.\n\nTheir new introduction.\n\nAnother separate introduction.\n\nThe course",
		);
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": merged, "second.prax": second }),
			deps,
		);
		expect(result.conflicts).toEqual([]);
		expect(result.resolution?.exportable).toBe(true);
		for (const branch of [f.read("ours"), f.read("theirs")])
			for (const id of ids(branch, "first.prax"))
				expect(ids(present(result.resolution), "first.prax")).toContain(id);
	});
	it("moves a page between lessons, preserving nested IDs, slug and aliases", () => {
		const movedPage = "# Moving\n\nThis entire page moves to the other lesson.\n";
		const f = fixture({ "first.prax": `${first}\n${movedPage}`, "second.prax": second });
		const moving = f.base.sourceMappings.filter((m) => m.file === "first.prax" && m.path[0] === 1);
		const pageId = present(moving.find((m) => m.path.length === 1)).id;
		f.base.snapshots[0].nodes[pageId].slug = "moving";
		f.base.snapshots[0].nodes[pageId].aliases = ["old-moving"];
		f.base.heads[0].head = digest(serializeIdentity(f.base.snapshots[0]));
		f.branch("ours", { "first.prax": first, "second.prax": `${second}\n${movedPage}` });
		f.branch("theirs", {
			"first.prax": `${first}\n${movedPage}`,
			"second.prax": second.replace("separate", "separat"),
		});
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({
				"first.prax": first,
				"second.prax": `${second.replace("separate", "separat")}\n${movedPage}`,
			}),
			deps,
		);
		expect(result.conflicts).toEqual([]);
		for (const m of moving) expect(ids(present(result.resolution), "second.prax")).toContain(m.id);
		const page = present(
			present(result.resolution)
				.snapshots.flatMap((s) => Object.entries(s.nodes))
				.find(([id]) => id === pageId),
		)[1];
		expect(page).toMatchObject({ status: "active", slug: "moving", aliases: ["old-moving"] });
	});
	it("reports two branch UUIDs for a single new entity without choosing either", () => {
		const f = fixture();
		const added = `${first}\nA newly added paragraph appears on both branches.\n`;
		f.branch("ours", { "first.prax": added, "second.prax": second });
		f.branch("theirs", { "first.prax": added, "second.prax": second });
		const left = present(
			ids(f.read("ours"), "first.prax").find((id) => !ids(f.base, "first.prax").includes(id)),
		);
		const right = present(
			ids(f.read("theirs"), "first.prax").find((id) => !ids(f.base, "first.prax").includes(id)),
		);
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": added, "second.prax": second }),
			deps,
		);
		expect(result.resolution).toBeNull();
		expect(result.conflicts).toContainEqual(
			expect.objectContaining({
				reason: "two-ids-for-entity",
				ids: expect.arrayContaining([left, right]),
			}),
		);
	});
	it("reports different edits to the same continuing block", () => {
		const f = fixture();
		f.branch("ours", { "first.prax": first.replace("every", "evrey"), "second.prax": second });
		f.branch("theirs", { "first.prax": first.replace("every", "everry"), "second.prax": second });
		const blockId = present(
			f.base.sourceMappings.find((m) => m.file === "first.prax" && m.path.length === 2),
		).id;
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": first.replace("every", "evrey"), "second.prax": second }),
			deps,
		);
		expect(result.resolution).toBeNull();
		expect(result.conflicts).toContainEqual({
			reason: "divergent-change",
			ids: [blockId],
			field: "content",
		});
	});
	it("reports one added ID claimed by different entities on the branches", () => {
		const f = fixture();
		const added = `${first}\nA new paragraph was written on our branch.\n`;
		const left = f.branch("ours", { "first.prax": added, "second.prax": second });
		const theirs = `${first}\nAn entirely unrelated paragraph was written elsewhere.\n`;
		const right = resolveIdentity(
			{
				course: f.base.course,
				priorSnapshots: f.base.snapshots,
				priorHeads: f.base.heads,
				parsedDocuments: documents({ "first.prax": theirs, "second.prax": second }),
			},
			deps,
		);
		const leftId = present(
			ids(left, "first.prax").find((id) => !ids(f.base, "first.prax").includes(id)),
		);
		const rightId = present(
			ids(right, "first.prax").find((id) => !ids(f.base, "first.prax").includes(id)),
		);
		const snapshot = present(right.snapshots.find((s) => s.nodes[rightId]));
		snapshot.nodes[leftId] = snapshot.nodes[rightId];
		delete snapshot.nodes[rightId];
		right.heads[0].head = digest(serializeIdentity(snapshot));
		f.branch("theirs", { "first.prax": theirs, "second.prax": second }, right);
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": added, "second.prax": second }),
			deps,
		);
		expect(result.resolution).toBeNull();
		expect(result.conflicts).toContainEqual({ reason: "id-claimed-by-entities", ids: [leftId] });
	});
	it("never revives a retired ID when matching restored content", () => {
		const f = fixture();
		const retiredId = present(
			f.base.sourceMappings.find((m) => m.file === "first.prax" && m.path.length === 2),
		).id;
		const deleted = { "first.prax": "# First\n", "second.prax": second };
		f.branch("ours", deleted);
		f.branch("theirs", { "first.prax": first, "second.prax": second });
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": first, "second.prax": second }),
			deps,
		);
		expect(result.conflicts).toEqual([]);
		expect(ids(present(result.resolution), "first.prax")).not.toContain(retiredId);
		expect(present(result.resolution).snapshots[0].nodes[retiredId].status).toBe("retired");
	});
	it("merges disjoint block edits in the same lesson against the actual common base", () => {
		const source = `${first}\nA second paragraph stays separate and retains its identity.\n`;
		const f = fixture({ "first.prax": source, "second.prax": second });
		f.branch("ours", { "first.prax": source.replace("every", "evrey"), "second.prax": second });
		f.branch("theirs", {
			"first.prax": source.replace("separate", "separat"),
			"second.prax": second,
		});
		const merged = source.replace("every", "evrey").replace("separate", "separat");
		const result = mergeIdentity(
			f.common(),
			f.read("ours"),
			f.read("theirs"),
			documents({ "first.prax": merged, "second.prax": second }),
			deps,
		);
		expect(result.conflicts).toEqual([]);
		expect(result.resolution?.exportable).toBe(true);
		expect(ids(present(result.resolution), "first.prax")).toEqual(ids(f.base, "first.prax"));
		const snapshot = present(
			present(result.resolution).snapshots.find((s) => s.lessonId === f.base.snapshots[0].lessonId),
		);
		expect(snapshot.sourceHash).toBe(digest(merged));
		expect(snapshot.parents.sort()).toEqual(
			[
				digest(serializeIdentity(f.read("ours").snapshots[0])),
				digest(serializeIdentity(f.read("theirs").snapshots[0])),
			].sort(),
		);
	});
	it("renames metadata-identical lessons and keeps every ID and page URL", () => {
		const f = fixture();
		const page = Object.values(f.base.snapshots[0].nodes).find((n) => n.kind === "page");
		if (!page) throw new Error("Missing page");
		page.slug = "first-page";
		page.aliases = ["original-page"];
		f.base.heads[0].head = digest(serializeIdentity(f.base.snapshots[0]));
		const renamed = resolveIdentity(
			{
				course: f.base.course,
				priorSnapshots: f.base.snapshots,
				priorHeads: f.base.heads,
				parsedDocuments: documents({ "renamed.prax": first, "also-renamed.prax": second }),
			},
			deps,
		);
		f.branch("ours", { "renamed.prax": first, "also-renamed.prax": second }, renamed);
		f.branch("theirs", { "first.prax": first, "second.prax": second });
		expect(f.common().course).toEqual(f.base.course);
		expect(ids(f.read("ours"), "renamed.prax")).toEqual(ids(f.base, "first.prax"));
		const lesson = f
			.read("ours")
			.snapshots.find((s) => s.lessonId === f.base.snapshots[0].lessonId);
		expect(Object.values(lesson?.nodes ?? {}).find((n) => n.kind === "page")).toMatchObject({
			slug: "first-page",
			aliases: ["original-page"],
		});
		expect(readFileSync(join(f.folder, "first.prax"), "utf8")).toBe(first);
	});
});
