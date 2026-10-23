import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadIdentityStore, persistCourseIdentity, resolveCourseIdentity } from "../identity-store";
import {
	readProjectRecoveryEvidence,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";
import oldShortNameArchive from "./fixtures/old-short-name-archive.json";

const roots: string[] = [];
const source = "# Safety\n\nKeep the exit clear.\n";
const missingEstablished = {
	messageRef: { key: "desktop.identity.missingEstablished", args: {} },
};
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project() {
	const root = await mkdtemp(join(tmpdir(), "i4-recovery-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), source);
	return root;
}

async function inProject(work: (root: string) => Promise<void>) {
	const root = await project();
	// Seed retained archives after T1's eager reclamation. Slice 4 owns retention.
	return withProjectFileTransaction(root, work, "write", false);
}

async function disk(root: string): Promise<unknown[]> {
	const result: unknown[] = [];
	for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const path = join(root, entry.name);
		const stat = await lstat(path);
		result.push([
			entry.name,
			stat.mode,
			stat.ino,
			stat.mtimeMs,
			entry.isDirectory() ? await disk(path) : (await readFile(path)).toString("base64"),
		]);
	}
	return result;
}

async function archive(
	root: string,
	path: string,
	options: { original?: boolean; rollback?: "staged" | "installed" } = {},
) {
	await mkdir(join(root, path, ".."), { recursive: true });
	if (options.original) await writeFile(join(root, path), "original");
	let checkpoint: { stage: string; files: Map<string, Buffer> } | undefined;
	const saving = writeProjectFiles(
		root,
		[{ path, content: path.endsWith(".prax") ? "# Saved\n\nsaved\n" : "saved" }],
		{
			onStep: async ({ kind }) => {
				if (kind !== (options.rollback ?? "installed")) return;
				const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
				if (!stage) throw new Error("Missing checkpoint stage");
				const files = new Map<string, Buffer>();
				for (const name of await readdir(join(root, stage)))
					files.set(name, await readFile(join(root, stage, name)));
				checkpoint = { stage, files };
				if (options.rollback) throw new Error("Planned rollback");
			},
		},
	);
	if (options.rollback) await expect(saving).rejects.toThrow("Planned rollback");
	else await saving;
	let stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
	if (!stage && checkpoint) {
		// Current cleanup drops stages without captures. Retain the real checkpoint
		// as an older writer/crash would, including its durable retirement decision.
		stage = checkpoint.stage;
		await mkdir(join(root, stage));
		for (const [name, bytes] of checkpoint.files) await writeFile(join(root, stage, name), bytes);
		const journal = JSON.parse(await readFile(join(root, stage, "journal.tmp"), "utf8"));
		await writeFile(join(root, stage, options.rollback ? "abort" : "committed"), journal.checksum);
	}
	if (!stage) throw new Error("Missing retained archive");
	// Remove live lineage so only the archive can fence a new namespace.
	if (path.startsWith(".praxity/")) await rm(join(root, ".praxity"), { recursive: true });
	else if (path !== "lesson.prax") await rm(join(root, path), { force: true });
	return stage;
}

async function admission(root: string, refuses: boolean) {
	const before = await disk(root);
	if (refuses) await expect(loadIdentityStore(root)).rejects.toMatchObject(missingEstablished);
	else expect(await loadIdentityStore(root)).toEqual({ course: null, heads: [], snapshots: [] });
	expect(await disk(root)).toEqual(before);
	await withProjectFileTransaction(
		root,
		async () => {
			const admitted = await disk(root);
			const resolving = resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] });
			if (refuses) {
				await expect(resolving).rejects.toMatchObject(missingEstablished);
				expect(await disk(root)).toEqual(admitted);
				return;
			}
			const result = await resolving;
			expect(result.identity.course.courseId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
			);
			expect(result.identity.heads).toHaveLength(1);
			expect(Object.keys(result.identity.snapshots[0].nodes).length).toBeGreaterThan(0);
			await persistCourseIdentity(root, result);
			expect((await loadIdentityStore(root)).course?.courseId).toBe(
				result.identity.course.courseId,
			);
		},
		"write",
		false,
	);
}

// Literal policy cases from the C03c split, independent of T1's path predicate.
for (const path of [
	"settings.json",
	"lesson.prax",
	"leçon-1.prax",
	"Été.prax",
	"le\u0301çon.prax",
	"assets/image.png",
	"assets/château.png",
	"château.png",
	"photo~1.png",
])
	it(`I4 initializes after an ordinary committed ${path} archive`, () =>
		inProject(async (root) => {
			await archive(root, path, { original: true });
			await admission(root, false);
		}));

for (const rollback of ["staged", "installed"] as const)
	it(`I4 initializes after an ordinary rollback at ${rollback}`, () =>
		inProject(async (root) => {
			await archive(root, "settings.json", { original: true, rollback });
			await admission(root, false);
		}));

for (const path of ["narration.yaml", ".praxity/identity/course.json"])
	it(`I4 initializes after an uninstalled first-write rollback of ${path}`, () =>
		inProject(async (root) => {
			const stage = await archive(root, path, { rollback: "staged" });
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{
					path: stage,
					outcome: "rolled-back",
					files: [{ path, hadOriginal: false, installed: false }],
				},
			]);
			await admission(root, false);
		}));

for (const path of [
	".praxity/identity/course.json",
	".praxity/identity/lessons/head.json",
	".praxity/identity/snapshots/snapshot.json",
	".praxity/content-identity.json",
	"narration.yaml",
	".praxity/review/runs.json",
])
	it(`I4 refuses a committed first-write ${path} archive with zero writes`, () =>
		inProject(async (root) => {
			await archive(root, path);
			await admission(root, true);
		}));

for (const original of [false, true])
	it(`I4 ${original ? "refuses" : "admits"} rollback lineage with ${original ? "an original but no install" : "a first installation"}`, () =>
		inProject(async (root) => {
			const stage = await archive(root, "narration.yaml", {
				original,
				rollback: original ? "staged" : "installed",
			});
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{
					path: stage,
					outcome: "rolled-back",
					files: [{ path: "narration.yaml", hadOriginal: original, installed: !original }],
				},
			]);
			await admission(root, original);
		}));

for (const original of [false, true])
	it(`I4 checks protected-file facts separately from an ordinary installation, original ${original}`, () =>
		inProject(async (root) => {
			await writeFile(join(root, "settings.json"), "original");
			if (original) await writeFile(join(root, "narration.yaml"), "original narration");
			await expect(
				writeProjectFiles(
					root,
					[
						{ path: "settings.json", content: "saved" },
						{ path: "narration.yaml", content: "saved narration" },
					],
					{
						onStep: async ({ kind, index }) => {
							if (kind === "installed" && index === 0) throw new Error("Stop before narration");
						},
					},
				),
			).rejects.toThrow("Stop before narration");
			await rm(join(root, "narration.yaml"), { force: true });
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{
					path: expect.any(String),
					outcome: "rolled-back",
					files: [
						{ path: "settings.json", hadOriginal: true, installed: true },
						{ path: "narration.yaml", hadOriginal: original, installed: false },
					],
				},
			]);
			await admission(root, original);
		}));

it("I4 refuses a committed first identity write without installed markers", () =>
	inProject(async (root) => {
		const stage = await archive(root, ".praxity/identity/course.json");
		await rm(join(root, stage, "installed-0"));
		expect(await readProjectRecoveryEvidence(root)).toEqual([
			{
				path: stage,
				outcome: "committed",
				files: [{ path: ".praxity/identity/course.json", hadOriginal: false, installed: true }],
			},
		]);
		await admission(root, true);
	}));

for (const state of ["unknown", "conflicting", "contradictory", "changed"] as const)
	it(`I4 refuses ${state} ordinary recovery evidence with zero writes`, () =>
		inProject(async (root) => {
			const stage = await archive(root, "settings.json", { original: true });
			if (state === "unknown") await rm(join(root, stage, "journal.tmp"));
			else if (state === "changed") {
				const capture = (await readdir(join(root, stage))).find((name) =>
					name.includes(".capture-"),
				);
				if (!capture) throw new Error("Missing captured original");
				await writeFile(join(root, stage, capture), "changed");
			} else
				await writeFile(
					join(root, stage, state === "conflicting" ? "conflict" : "abort"),
					await readFile(join(root, stage, "committed")),
				);
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{ path: stage, outcome: "unknown" },
			]);
			await admission(root, true);
		}));

it("I4 refuses an old writer's NARRAT~1.YAM archive with zero writes", () =>
	inProject(async (root) => {
		const journal = JSON.parse(
			Buffer.from(oldShortNameArchive.entries["journal.tmp"], "base64").toString(),
		);
		const canonical = await realpath(root);
		journal.plan.course =
			process.platform === "win32" || process.platform === "darwin"
				? canonical.toLowerCase()
				: canonical;
		journal.checksum = createHash("sha256").update(JSON.stringify(journal.plan)).digest("hex");
		const directory = join(root, oldShortNameArchive.stage);
		await mkdir(directory);
		for (const [name, encoded] of Object.entries(oldShortNameArchive.entries))
			await writeFile(
				join(directory, name),
				name === "journal.tmp"
					? JSON.stringify(journal)
					: Buffer.from(encoded, "base64").toString().replaceAll("<checksum>", journal.checksum),
			);
		await admission(root, true);
	}));
