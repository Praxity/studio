import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, aroundEach, beforeAll, expect, it, vi } from "vitest";
import { parseNarrationSidecarV2 } from "../../shared/narration-sidecar";
import { parseReviewState } from "../../shared/review/model";
import { interruptProjectWrite } from "../../test-utils/interrupted-project-write";
import { loadIdentityStore, persistCourseIdentity, resolveCourseIdentity } from "../identity-store";
import {
	acknowledgeProjectWrite,
	applyProjectFilePlan,
	readProjectRecoveryEvidence,
	reclaimProtectedArchives,
	withProjectFileFlushes,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";
import { killJournalWriter } from "./fixtures/kill-journal-writer";

const roots: string[] = [];
let writerRoot: string;
let journalWriter: string;
let captureWriter: string;
let budgetRoot: string;
beforeAll(async () => {
	writerRoot = await mkdtemp(join(tmpdir(), "retention-writers-"));
	journalWriter = join(writerRoot, "journal-writer.mjs");
	captureWriter = join(writerRoot, "capture-reader-writer.mjs");
	// Bundle code only; every crash still writes its own store and journal receipts.
	await build({
		entryPoints: ["journal-writer", "capture-reader-writer"].map((name) =>
			fileURLToPath(new URL(`./fixtures/${name}.ts`, import.meta.url)),
		),
		outdir: writerRoot,
		outExtension: { ".js": ".mjs" },
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
	// Prepare only the candidate-budget fixture here; generated histories keep independent setup.
	budgetRoot = join(writerRoot, "candidate-budget");
	await mkdir(budgetRoot);
	await writeFile(join(budgetRoot, "lesson.prax"), "# Original\n");
	await withProjectFileFlushes(
		{ syncFile: async () => {}, syncDirectory: async () => {} },
		async () => {
			await persist(budgetRoot);
			// Four seeded archives plus the save's own archive exceed one three-candidate pass.
			for (let index = 0; index < 4; index++) await seedHeadArchive(budgetRoot);
		},
	);
});
afterAll(async () => {
	if (writerRoot) await rm(writerRoot, { recursive: true, force: true });
});
// Retention uses real filesystem changes; project-journal-flush-dependency tests durability.
aroundEach((run) =>
	withProjectFileFlushes({ syncFile: async () => {}, syncDirectory: async () => {} }, run),
);
const pruneFault = vi.hoisted(() => ({
	root: "",
	raceRoot: "",
	hit: false,
	quarantine: "",
	damage: "",
	hideArchives: false,
	retireRoot: "",
	linkRoot: "",
	candidates: [] as string[],
	examined: new Set<string>(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		link: async (...args: Parameters<typeof fs.link>) => {
			if (
				pruneFault.linkRoot &&
				String(args[1]) === join(pruneFault.linkRoot, ".praxity-transaction.json")
			)
				throw Object.assign(new Error("Root journal link failed"), { code: "EIO" });
			return fs.link(...args);
		},
		readdir: async (...args: Parameters<typeof fs.readdir>) => {
			const path = resolve(String(args[0]));
			if (pruneFault.candidates.includes(path)) pruneFault.examined.add(path);
			const result = await fs.readdir(...args);
			if (pruneFault.hideArchives && resolve(String(args[0])) === resolve(pruneFault.raceRoot))
				return result.filter(
					(entry) =>
						!String(typeof entry === "string" ? entry : entry.name).startsWith(".praxity-write-"),
				);
			return result;
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (
				pruneFault.retireRoot &&
				String(args[0]) === join(pruneFault.retireRoot, ".praxity-transaction.json")
			)
				throw new Error("Journal retirement blocked");
			const result = await fs.rename(...args);
			if (
				pruneFault.raceRoot &&
				dirname(String(args[1])) === pruneFault.raceRoot &&
				String(args[1]).includes(".praxity-write-") &&
				String(args[1]).includes(".reclaim-") &&
				!pruneFault.hit
			) {
				pruneFault.hit = true;
				pruneFault.quarantine = String(args[1]);
				if (pruneFault.damage === "corrupt")
					await fs.writeFile(join(pruneFault.raceRoot, ".praxity/identity/course.json"), "{broken");
				else await fs.rm(join(pruneFault.raceRoot, ".praxity"), { recursive: true });
				pruneFault.hideArchives = pruneFault.damage === "absent";
			}
			return result;
		},
		rm: async (...args: Parameters<typeof fs.rm>) => {
			const path = String(args[0]);
			if (
				pruneFault.root &&
				path.startsWith(pruneFault.root) &&
				path.includes(".praxity-write-") &&
				path.includes(".reclaim-")
			)
				throw Object.assign(new Error("Archive pruning blocked"), { code: "EACCES" });
			return fs.rm(...args);
		},
	};
});
afterEach(async () => {
	pruneFault.root = "";
	pruneFault.raceRoot = "";
	pruneFault.retireRoot = "";
	pruneFault.linkRoot = "";
	pruneFault.hit = false;
	pruneFault.hideArchives = false;
	pruneFault.candidates = [];
	pruneFault.examined.clear();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project() {
	const root = await mkdtemp(join(tmpdir(), "i4-retention-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "# Original\n");
	return root;
}
async function persist(root: string) {
	// Archive retention exercises the confirmed writer that can retire identities.
	return withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
				[],
				{ retirements: "confirmed" },
			),
		"write",
		false,
	);
}
async function archives(root: string) {
	return (await readdir(root)).filter((name) => name.startsWith(".praxity-write-")).sort();
}
async function reclaim(root: string) {
	await withProjectFileTransaction(root, async () => {}, "write", true);
}
async function seedHeadArchive(root: string) {
	const [head] = await readdir(join(root, ".praxity/identity/lessons"));
	const path = `.praxity/identity/lessons/${head}`;
	await writeProjectFiles(root, [
		{ path, content: `${await readFile(join(root, path), "utf8")}\n` },
	]);
	return path;
}

it.each(["photo~1", "notes~1.yam", "NARRAT~1.PNG", "OTHER~1.YAM"])(
	"ordinary root name %s preserves committed facts and admits identity",
	async (path) => {
		const root = await project();
		await writeFile(join(root, path), "old");
		await writeProjectFiles(root, [{ path, content: "new" }]);
		expect(await readProjectRecoveryEvidence(root)).toMatchObject([
			{ outcome: "committed", files: [{ path, hadOriginal: true, installed: true }] },
		]);
		await expect(persist(root)).resolves.toMatchObject({ identity: { course: { schema: 1 } } });
	},
);

it("a real first write killed before journal link reports rollback and initializes on fresh open", async () => {
	const root = await project();
	await killJournalWriter(root, "identity-before-link", undefined, journalWriter);
	const [stage] = await archives(root);
	expect(await readFile(join(root, stage, "journal.publish"))).toEqual(
		await readFile(join(root, stage, "journal.tmp")),
	);
	await expect(readFile(join(root, ".praxity-transaction.json"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	for (let pass = 0; pass < 3; pass++) await reclaim(root);
	const evidence = await readProjectRecoveryEvidence(root);
	expect(evidence).toMatchObject([{ outcome: "rolled-back" }]);
	if (evidence[0].outcome !== "unknown")
		expect(evidence[0].files.every((file) => !file.hadOriginal && !file.installed)).toBe(true);
	expect((await loadIdentityStore(root)).course).toBeNull();
	expect((await persist(root)).identity.course.courseId).toMatch(/^[0-9a-f-]{36}$/);
});

it("an unpublished preparation with contradictory installation or commit evidence stays unknown", async () => {
	const root = await project();
	await killJournalWriter(root, "identity-before-link", undefined, journalWriter);
	const [stage] = await archives(root);
	const { checksum } = JSON.parse(await readFile(join(root, stage, "journal.tmp"), "utf8"));
	for (const marker of ["installed-0", "installed-0.tmp", "committed.tmp"]) {
		await writeFile(join(root, stage, marker), checksum);
		expect(await readProjectRecoveryEvidence(root)).toMatchObject([{ outcome: "unknown" }]);
		await rm(join(root, stage, marker));
	}
});

it("an unpublished established write still carries its protected originals", async () => {
	const root = await project();
	await persist(root);
	await writeFile(join(root, "lesson.prax"), "# Changed\n");
	await killJournalWriter(root, "identity-before-link", undefined, journalWriter);
	expect(await readProjectRecoveryEvidence(root)).toMatchObject([{ outcome: "rolled-back" }]);
	await rm(join(root, ".praxity"), { recursive: true });
	await expect(persist(root)).rejects.toMatchObject({
		messageRef: { key: "desktop.identity.missingEstablished" },
	});
});

function sidecar(path: string, courseId: string, lessonId: string) {
	return JSON.stringify(
		path === "narration.yaml"
			? {
					version: 2,
					courseId,
					lessons: {
						[lessonId]: { enabled: true, defaults: { voice: "author-voice" }, segments: [] },
					},
				}
			: {
					schema: 1,
					courseId,
					baseline: [],
					runs: [
						{
							id: "12345678-1234-1234-1234-123456789abc",
							author: "Retained reviewer",
							createdAt: "2026-10-17T00:00:00.000Z",
							summaries: [{ entityId: lessonId, summary: "Retained history" }],
						},
					],
					suggestions: [],
				},
	);
}

for (const path of ["narration.yaml", ".praxity/review/state.json"]) {
	it.each([
		"missing",
		"invalid UTF-8",
		"{broken",
		"<<<<<<< ours\n=======\n>>>>>>> theirs",
		"",
		"foreign course",
	])(`I4 preserves valid captured ${path} while live bytes are %s`, async (damage) => {
		const root = await project();
		const { identity } = await persist(root);
		const valid = sidecar(path, identity.course.courseId, identity.snapshots[0].lessonId);
		const parse = path === "narration.yaml" ? parseNarrationSidecarV2 : parseReviewState;
		expect(() => parse(valid, identity.course.courseId)).not.toThrow();
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), valid);
		await writeProjectFiles(root, [{ path, content: valid + "\n" }]);
		const before = await archives(root);
		expect(before).toHaveLength(1);
		if (damage === "missing") await rm(join(root, path));
		else
			await writeFile(
				join(root, path),
				damage === "invalid UTF-8"
					? Buffer.from([255])
					: damage === "foreign course"
						? sidecar(path, "11111111-1111-4111-8111-111111111111", identity.snapshots[0].lessonId)
						: damage,
			);
		await persist(root);
		expect(await archives(root)).toEqual(before);
		await writeFile(join(root, path), valid);
		await persist(root);
		expect(await archives(root)).toEqual([]);
	});
}

it.each(["{broken", "missing state", "foreign state"])(
	"I4 keeps next-run history with %s",
	async (damage) => {
		const root = await project();
		const { identity } = await persist(root);
		const directory = join(root, ".praxity/review");
		await mkdir(directory, { recursive: true });
		const state = sidecar(
			".praxity/review/state.json",
			identity.course.courseId,
			identity.snapshots[0].lessonId,
		);
		await writeFile(join(directory, "state.json"), state);
		const path = ".praxity/review/next-run.json";
		const valid = JSON.stringify({
			schema: 1,
			author: "Author",
			createdAt: "2026-10-17T00:00:00.000Z",
			summaries: [],
		});
		await writeFile(join(root, path), valid);
		await writeProjectFiles(root, [{ path, content: valid + "\n" }]);
		const before = await archives(root);
		if (damage === "{broken") await writeFile(join(root, path), damage);
		if (damage === "missing state") await rm(join(directory, "state.json"));
		if (damage === "foreign state")
			await writeFile(
				join(directory, "state.json"),
				sidecar(
					".praxity/review/state.json",
					"11111111-1111-4111-8111-111111111111",
					identity.snapshots[0].lessonId,
				),
			);
		await persist(root);
		expect(await archives(root)).toEqual(before);
		await writeFile(join(root, path), valid);
		await writeFile(join(directory, "state.json"), state);
		await persist(root);
		expect(await archives(root)).toEqual([]);
	},
);

it("I4 keeps legacy registry evidence without an active format owner", async () => {
	const root = await project();
	await persist(root);
	const path = ".praxity/content-identity.json";
	await writeFile(join(root, path), "legacy author bytes");
	await writeProjectFiles(root, [{ path, content: "{broken" }]);
	const before = await archives(root);
	await persist(root);
	expect(await archives(root)).toEqual(before);
});

it.each(["ready", "capture"])(
	"an unpublished preparation with %s stays unknown",
	async (marker) => {
		const root = await project();
		await killJournalWriter(root, "identity-before-link", undefined, journalWriter);
		const [stage] = await archives(root);
		const { checksum, plan } = JSON.parse(await readFile(join(root, stage, "journal.tmp"), "utf8"));
		if (marker === "ready") await writeFile(join(root, stage, "ready"), checksum);
		else
			await writeFile(
				join(root, stage, "rollback-0.capture-12345678-1234-1234-1234-123456789abc"),
				Buffer.from(plan.files[0].to, "base64"),
			);
		expect(await readProjectRecoveryEvidence(root)).toMatchObject([{ outcome: "unknown" }]);
	},
);

it("a failed root journal link retains protected preparation bytes", async () => {
	const root = await project();
	await writeFile(join(root, "narration.yaml"), "original narration");
	pruneFault.linkRoot = root;
	await expect(
		writeProjectFiles(root, [{ path: "narration.yaml", content: "planned narration" }]),
	).rejects.toThrow("Root journal link failed");
	pruneFault.linkRoot = "";
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe("original narration");
	expect(await archives(root)).toHaveLength(1);
	expect(await readProjectRecoveryEvidence(root)).toMatchObject([
		{
			outcome: "rolled-back",
			files: [{ path: "narration.yaml", hadOriginal: true, installed: false }],
		},
	]);
});

it("I4 examines at most three recovery archives per save", async () => {
	// Exercise real archive bytes and pruning without hardware flush latency.
	const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
	await withProjectFileFlushes(flushes, async () => {
		const root = budgetRoot;
		expect(await archives(root)).toHaveLength(4);
		const before = await archives(root);
		await persist(root);
		const after = await archives(root);
		expect(after).toHaveLength(before.length + 1 - 3);
		const removed = before.filter((name) => !after.includes(name));
		expect(removed.length).toBeGreaterThan(0);
		expect(removed.length).toBeLessThanOrEqual(3);
		for (let save = 0; save < 3; save++) await persist(root);
		expect(await archives(root)).toEqual([]);
	});
	expect(flushes.syncFile).toHaveBeenCalled();
	expect(flushes.syncDirectory).toHaveBeenCalled();
});

it("pruning examines at most three protected archives even when all must be kept", async () => {
	await withProjectFileFlushes(
		{ syncFile: async () => {}, syncDirectory: async () => {} },
		async () => {
			const root = await project();
			await writeFile(join(root, "narration.yaml"), "original narration");
			for (let index = 0; index < 4; index++)
				await writeProjectFiles(root, [{ path: "narration.yaml", content: `narration ${index}` }]);
			const before = await archives(root);
			expect(before).toHaveLength(4);
			const keep = vi.fn(async () => true);
			await withProjectFileTransaction(
				root,
				async (canonical) => {
					// Observe archive-byte examinations even if an extra candidate is never pruned.
					pruneFault.candidates = before.map((name) => resolve(canonical, name));
					await reclaimProtectedArchives(canonical, keep);
					pruneFault.candidates = [];
				},
				"write",
				false,
			);
			expect(keep).toHaveBeenCalledTimes(3);
			expect(pruneFault.examined.size).toBe(3);
			expect(keep.mock.calls).toEqual(Array.from({ length: 3 }, () => [["narration.yaml"]]));
			expect(await archives(root)).toEqual(before);
		},
	);
});

it.each(["lost", "corrupt", "absent"])(
	"I4 repeats its quarantine proof and fails closed with %s live store",
	async (damage) => {
		const root = await project();
		await persist(root);
		await seedHeadArchive(root);
		pruneFault.raceRoot = root;
		pruneFault.damage = damage;
		await persist(root);
		expect(pruneFault.hit).toBe(true);
		pruneFault.hideArchives = false;
		expect(await readdir(pruneFault.quarantine)).toContain("journal.tmp");
	},
);

it("pruning passes installed paths with no original to the keep proof", async () => {
	const root = await project();
	await mkdir(join(root, ".praxity/review"), { recursive: true });
	const path = ".praxity/review/first.json";
	await writeProjectFiles(root, [{ path, content: "first protected bytes" }]);
	const before = await archives(root);
	await rm(join(root, path));
	await withProjectFileTransaction(
		root,
		async (canonical) => {
			await reclaimProtectedArchives(canonical, async (paths) => paths.includes(path));
		},
		"write",
		false,
	);
	expect(await archives(root)).toEqual(before);
});

it("pruning skips archives needed by a committed active journal", async () => {
	const root = await project();
	pruneFault.retireRoot = root;
	const result = await acknowledgeProjectWrite(
		withProjectFileTransaction(
			root,
			async (canonical) => {
				await applyProjectFilePlan(canonical, [
					{ path: "narration.yaml", content: "committed narration" },
				]);
				const before = await archives(root);
				const keep = vi.fn(async () => false);
				await reclaimProtectedArchives(canonical, keep);
				expect(keep).not.toHaveBeenCalled();
				expect(await archives(root)).toEqual(before);
				expect(await readFile(join(root, ".praxity-transaction.json"), "utf8")).toContain(
					"checksum",
				);
			},
			"write",
			false,
		),
	);
	expect(result.cleanupError).toContain("Journal retirement blocked");
});

it.each(["missing course", "missing heads", "missing heads and snapshots", "corrupt course"])(
	"T1 retains protected archive names and bytes through repeated admissions with %s",
	async (damage) => {
		const root = await project();
		await persist(root);
		await seedHeadArchive(root);
		const before = await archives(root);
		expect(before.length).toBeGreaterThan(0);
		const journals = await Promise.all(
			before.map((name) => readFile(join(root, name, "journal.tmp"), "utf8")),
		);
		if (damage === "missing course") await rm(join(root, ".praxity/identity/course.json"));
		else if (damage === "corrupt course")
			await writeFile(join(root, ".praxity/identity/course.json"), "{broken");
		else {
			for (const name of await readdir(join(root, ".praxity/identity/lessons")))
				await rm(join(root, ".praxity/identity/lessons", name));
			if (damage === "missing heads and snapshots")
				for (const name of await readdir(join(root, ".praxity/identity/snapshots")))
					await rm(join(root, ".praxity/identity/snapshots", name));
		}
		for (let pass = 0; pass < 3; pass++) await reclaim(root);
		expect(await archives(root)).toEqual(before);
		expect(
			await Promise.all(before.map((name) => readFile(join(root, name, "journal.tmp"), "utf8"))),
		).toEqual(journals);
	},
);

it("I4 prunes protected archives only after persisting an intact live store", async () => {
	const root = await project();
	await persist(root);
	const courseId = (await loadIdentityStore(root)).course?.courseId;
	await seedHeadArchive(root);
	const before = await archives(root);
	await reclaim(root);
	expect(await archives(root)).toEqual(before);
	await persist(root);
	expect(await archives(root)).toEqual([]);
	expect((await loadIdentityStore(root)).course?.courseId).toBe(courseId);
});

it("an archive pruning failure acknowledges committed I4 identity with a cleanup warning", async () => {
	const root = await project();
	await persist(root);
	await seedHeadArchive(root);
	const originalHead = (await loadIdentityStore(root)).heads[0].head;
	await writeFile(join(root, "lesson.prax"), "# Changed\n");
	pruneFault.root = root;
	const result = await persist(root);
	expect(result.writeResult?.cleanupError).toContain("Archive pruning blocked");
	expect((await loadIdentityStore(root)).heads[0].head).not.toBe(originalHead);
	expect((await archives(root)).length).toBeGreaterThan(0);
	pruneFault.root = "";
	await persist(root);
	expect(await archives(root)).toEqual([]);
});

it("I4 keeps a captured head even when its missing snapshots leave an otherwise valid live store", async () => {
	const root = await project();
	await persist(root);
	await seedHeadArchive(root);
	const before = await archives(root);
	for (const directory of ["lessons", "snapshots"])
		for (const name of await readdir(join(root, ".praxity/identity", directory)))
			await rm(join(root, ".praxity/identity", directory, name));
	await persist(root);
	expect(await archives(root)).toEqual(before);
});

it("ordinary archives keep T1's existing reclamation", async () => {
	const root = await project();
	await writeFile(join(root, "settings.json"), "old");
	await writeProjectFiles(root, [{ path: "settings.json", content: "new" }]);
	expect(await archives(root)).toHaveLength(1);
	await reclaim(root);
	expect(await archives(root)).toEqual([]);
});

it("a failed protected preparation keeps outside bytes even before any capture", async () => {
	const root = await project();
	await writeFile(join(root, "narration.yaml"), "original narration");
	let stage = "";
	await expect(
		writeProjectFiles(root, [{ path: "narration.yaml", content: "planned narration" }], {
			onStep: async ({ kind }) => {
				if (kind !== "staged") return;
				[stage] = await archives(root);
				await writeFile(join(root, stage, "install-0"), "outside preparation bytes");
				throw new Error("Stop protected preparation");
			},
		}),
	).rejects.toThrow("Stop protected preparation");
	expect(await readFile(join(root, "narration.yaml"), "utf8")).toBe("original narration");
	await reclaim(root);
	expect(await readFile(join(root, stage, "install-0"), "utf8")).toBe("outside preparation bytes");
});

it.each(["narration.yaml", "NARRATION.YAML", ".praxity/review/state.json"])(
	"a protected first write without captures survives automatic cleanup: %s",
	async (path) => {
		const root = await project();
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeProjectFiles(root, [{ path, content: "first bytes" }]);
		const before = await archives(root);
		expect(before).toHaveLength(1);
		await rm(join(root, path));
		for (let pass = 0; pass < 2; pass++) await reclaim(root);
		expect(await archives(root)).toEqual(before);
	},
);

it("protected archive pruning requires write ownership and obeys the caller's keep decision", async () => {
	const root = await project();
	await persist(root);
	const head = await seedHeadArchive(root);
	const before = await archives(root);
	await expect(reclaimProtectedArchives(root, async () => false)).rejects.toMatchObject({
		code: "ECONFLICT",
	});
	await withProjectFileTransaction(root, async (canonical) => {
		await expect(reclaimProtectedArchives(canonical, async () => false)).rejects.toMatchObject({
			code: "ECONFLICT",
		});
	});
	const captured: string[][] = [];
	await withProjectFileTransaction(
		root,
		async (canonical) => {
			await reclaimProtectedArchives(canonical, async (paths) => {
				captured.push([...paths]);
				return true;
			});
		},
		"write",
	);
	expect(captured).toEqual([[head]]);
	expect(await archives(root)).toEqual(before);
	await withProjectFileTransaction(
		root,
		async (canonical) => {
			await reclaimProtectedArchives(canonical, async () => false);
		},
		"write",
	);
	expect(await archives(root)).toEqual([]);
});

it("a real first identity crash between installs recovers and initializes on fresh open", async () => {
	const root = await project();
	await killJournalWriter(root, "identity-first", undefined, journalWriter);
	await withProjectFileTransaction(
		root,
		async () => {
			expect(await archives(root)).toHaveLength(1);
			await expect(readFile(join(root, ".praxity/identity/course.json"))).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect((await persist(root)).identity.course.courseId).toMatch(/^[0-9a-f-]{36}$/);
		},
		"write",
		false,
	);
	// Rolled-back installations hold no original identity that needs a live replacement.
	expect(await archives(root)).toEqual([]);
});

it("I4 prunes a rolled-back established save once its protected originals are intact", async () => {
	const root = await project();
	const original = await persist(root);
	await writeFile(join(root, "lesson.prax"), "# Original\n\nNew block.\n");
	await killJournalWriter(root, "identity-first", undefined, journalWriter);
	await reclaim(root);
	expect(await readProjectRecoveryEvidence(root)).toMatchObject([{ outcome: "rolled-back" }]);
	expect(await archives(root)).toHaveLength(1);
	const saved = await persist(root);
	expect(saved.identity.course).toEqual(original.identity.course);
	expect(await archives(root)).toEqual([]);
});

it("a rolled-back archive still requires its protected original narration live", async () => {
	const root = await project();
	const { identity } = await persist(root);
	const valid = sidecar("narration.yaml", identity.course.courseId, identity.snapshots[0].lessonId);
	await writeFile(join(root, "narration.yaml"), valid);
	await interruptProjectWrite(root, "narration.yaml", valid + "\n", captureWriter);
	await reclaim(root);
	expect(await readProjectRecoveryEvidence(root)).toMatchObject([
		{ outcome: "rolled-back", files: [{ hadOriginal: true }] },
	]);
	const before = await archives(root);
	await rm(join(root, "narration.yaml"));
	await persist(root);
	expect(await archives(root)).toEqual(before);
	await writeFile(join(root, "narration.yaml"), valid);
	await persist(root);
	expect(await archives(root)).toEqual([]);
});

it("a real interrupted established write still refuses a fresh identity after recovery and loss", async () => {
	const root = await project();
	await persist(root);
	const path = ".praxity/identity/course.json";
	await interruptProjectWrite(
		root,
		path,
		`${await readFile(join(root, path), "utf8")}\n`,
		captureWriter,
	);
	await reclaim(root);
	const before = await archives(root);
	await rm(join(root, ".praxity"), { recursive: true });
	await reclaim(root);
	expect(await archives(root)).toEqual(before);
	await expect(persist(root)).rejects.toMatchObject({
		messageRef: { key: "desktop.identity.missingEstablished" },
	});
});

const generatedStarts = [
	"empty",
	"intact",
	"missing course",
	"missing heads",
	"missing snapshots",
	"missing heads and snapshots",
	"corrupt course",
] as const;

// The model tracks domain events and surviving copies, never production predicates.
for (const [seed, start] of generatedStarts.entries()) {
	it(`generated real-store retention history from ${start}`, async () => {
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		await withProjectFileFlushes(flushes, async () => {
			// Journal receipts belong to their original files, so prepare independent roots rather than copies.
			const root = await project();
			let retainedEvidence = false;
			let courseId = "11111111-1111-4111-8111-111111111111";
			let lessonId = "22222222-2222-4222-8222-222222222222";
			if (start !== "empty") {
				const { identity } = await persist(root);
				courseId = identity.course.courseId;
				lessonId = identity.snapshots[0].lessonId;
				if (start !== "intact") {
					await seedHeadArchive(root);
					retainedEvidence = true;
				}
				if (start === "missing course") await rm(join(root, ".praxity/identity/course.json"));
				if (start.includes("heads"))
					await rm(join(root, ".praxity/identity/lessons"), { recursive: true });
				if (start.includes("snapshots"))
					await rm(join(root, ".praxity/identity/snapshots"), { recursive: true });
				if (start === "corrupt course")
					await writeFile(join(root, ".praxity/identity/course.json"), "{broken");
			}
			await mkdir(join(root, ".praxity/review"), { recursive: true });
			// Match clearMocks after the former beforeAll, so setup flushes cannot satisfy assertions.
			flushes.syncFile.mockClear();
			flushes.syncDirectory.mockClear();
			// Keep real histories and child-process crashes; durability is covered by the flush suite.
			let randomState = seed + 17;
			const next = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0);
			const events = ["ordinary", "protected", "crash"];
			// Shuffle real writes and admissions; each seed also chooses a durable interruption point.
			for (let index = events.length - 1; index > 0; index--) {
				const other = next() % (index + 1);
				[events[index], events[other]] = [events[other], events[index]];
			}
			const stops = [
				"protected:before-link",
				"protected:journal:",
				"protected:staged:0",
				"protected:installed:0",
			];
			let protectedBytes = false;
			for (const event of events) {
				if (event === "ordinary")
					await writeProjectFiles(root, [
						{ path: `asset-${next() % 7}.txt`, content: "ordinary bytes" },
					]);
				if (event === "protected") {
					await writeProjectFiles(root, [
						{ path: "narration.yaml", content: sidecar("narration.yaml", courseId, lessonId) },
						{
							path: ".praxity/review/state.json",
							content: sidecar(".praxity/review/state.json", courseId, lessonId),
						},
					]);
					protectedBytes = true;
					retainedEvidence = true;
				}
				if (event === "crash") {
					await killJournalWriter(
						root,
						stops[(seed + next()) % stops.length],
						undefined,
						journalWriter,
					);
					// An interrupted first write has no committed namespace. Originals fence identity.
					retainedEvidence ||= protectedBytes;
				}
				await reclaim(root);
				// All protected journals survive T1, even an interrupted first preparation.
				if (retainedEvidence) expect((await archives(root)).length).toBeGreaterThan(0);
			}
			if (start === "intact") {
				await persist(root);
				retainedEvidence = false;
				expect(await archives(root)).toEqual([]);
			}
			await rm(join(root, ".praxity"), { recursive: true, force: true });
			await rm(join(root, "narration.yaml"), { force: true });
			if (retainedEvidence)
				await expect(loadIdentityStore(root)).rejects.toMatchObject({
					messageRef: { key: "desktop.identity.missingEstablished" },
				});
			else expect((await loadIdentityStore(root)).course).toBeNull();
		});
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	});
}
