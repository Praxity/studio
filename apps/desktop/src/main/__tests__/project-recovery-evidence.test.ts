import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	applyProjectFilePlan,
	readProjectRecoveryEvidence,
	withProjectFileFlushes,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";
import { classifyIdentityLineagePath } from "../project-protected-paths";
import oldShortNameArchive from "./fixtures/old-short-name-archive.json";

it("one canonical-name classifier distinguishes lineage, ordinary paths and historical aliases", () => {
	for (const path of [
		"narration.yaml",
		"NARRATION.YAML",
		".praxity",
		".PRAXITY/identity/course.json",
	])
		expect(classifyIdentityLineagePath(path), path).toBe("lineage");
	for (const path of [
		"settings.json",
		"leçon-1.prax",
		"Été.prax",
		"photo~1.png",
		"assets/château.png",
		"assets/photo~1.png",
		".praxity/local/draft.json",
		".praxity/state.json",
	])
		expect(classifyIdentityLineagePath(path), path).toBe("ordinary");
	for (const path of [
		"NARRAT~1.YAM",
		"NADF84~1.YAM",
		"PR1234~1/identity/course.json",
		"PRAXIT~1/identity/course.json",
		".praxıty/identity/course.json",
		".praxity/content-identity.jſon",
		".PRAXITY/IDENTI~1/course.json",
	])
		expect(classifyIdentityLineagePath(path), path).toBe("unknown");
});

const outsideWriter = vi.hoisted(() => ({
	committedReads: 0,
	change: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			if (/[/\\]committed$/.test(String(args[0]))) {
				const read = handle.readFile.bind(handle);
				vi.spyOn(handle, "readFile").mockImplementation(async (...options) => {
					const bytes = await read(...options);
					// Change bytes after the initial fingerprint and orphan verification.
					if (outsideWriter.change && ++outsideWriter.committedReads === 3)
						await outsideWriter.change();
					return bytes;
				});
			}
			return handle;
		},
	};
});

// Real journal bytes, admissions and recovery remain; journal-flush tests own durability.
// No-op syncFile also omits the default adapter's post-write path checks.
function withCountingFlushes<Args extends unknown[]>(work: (...args: Args) => Promise<void>) {
	return async (...args: Args) => {
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		await withProjectFileFlushes(flushes, () => work(...args));
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	};
}

const roots: string[] = [];
async function onPlatform(platform: NodeJS.Platform, work: () => Promise<void>) {
	const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
	if (!descriptor) throw new Error("Missing platform descriptor");
	Object.defineProperty(process, "platform", { value: platform });
	try {
		await work();
	} finally {
		Object.defineProperty(process, "platform", descriptor);
	}
}
afterEach(async () => {
	outsideWriter.change = undefined;
	outsideWriter.committedReads = 0;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it(
	"an archive changed after byte verification stays unknown and keeps the outside edit",
	withCountingFlushes(async () => {
		const root = await project();
		const { stage } = await archive(root);
		const capture = (await readdir(join(root, stage))).find((name) =>
			/^install-0\.capture-/.test(name),
		);
		if (!capture) throw new Error("Missing original capture");
		outsideWriter.change = () =>
			writeFile(join(root, stage, capture), "outside edit during facts read");
		expect(await readProjectRecoveryEvidence(root)).toEqual([{ path: stage, outcome: "unknown" }]);
		expect(await readFile(join(root, stage, capture), "utf8")).toBe(
			"outside edit during facts read",
		);
		expect(await readdir(join(root, stage))).not.toContain("conflict");
	}),
);
async function project() {
	const root = await mkdtemp(join(tmpdir(), "recovery-evidence-"));
	roots.push(root);
	return root;
}
async function snapshot(root: string): Promise<unknown[]> {
	const entries: unknown[] = [];
	for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const path = join(root, entry.name);
		const info = await lstat(path);
		entries.push([
			entry.name,
			info.mode,
			info.ino,
			info.mtimeMs,
			entry.isDirectory()
				? await snapshot(path)
				: entry.isSymbolicLink()
					? await readlink(path)
					: (await readFile(path)).toString("base64"),
		]);
	}
	return entries;
}
async function archive(root: string, path = "settings.json") {
	await mkdir(join(root, path, ".."), { recursive: true });
	await writeFile(join(root, path), "original");
	await writeProjectFiles(root, [{ path, content: "saved" }]);
	const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
	if (!stage) throw new Error("Missing retained archive");
	const journal = JSON.parse(await readFile(join(root, stage, "journal.tmp"), "utf8"));
	return { stage, journal };
}

// Recorded from the previous writer, with only course/checksum placeholders.
// Do not resolve the live basename: main could install the literal short name.
for (const path of [
	"NARRAT~1.YAM",
	"NADF84~1.YAM",
	"PR1234~1/identity/course.json",
	"PRAXIT~1/identity/course.json",
	".praxity/content-identity.jſon",
])
	for (const live of [false, true])
		it(`an old-writer ambiguous-name archive stays unknown, ${path}, live ${live}`, async () => {
			const root = await project();
			const journal = JSON.parse(
				Buffer.from(oldShortNameArchive.entries["journal.tmp"], "base64").toString(),
			);
			const canonical = await realpath(root);
			journal.plan.course =
				process.platform === "win32" || process.platform === "darwin"
					? canonical.toLowerCase()
					: canonical;
			// The second spelling is a native APFS alias of the legacy registry.
			journal.plan.files[0].path = path;
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
			if (live) {
				await mkdir(join(root, path, ".."), { recursive: true });
				await writeFile(join(root, path), "saved narration");
			}
			const before = await snapshot(root);
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{ path: oldShortNameArchive.stage, outcome: "unknown" },
			]);
			expect(await snapshot(root)).toEqual(before);
			const archiveBefore = await snapshot(directory);
			for (let pass = 0; pass < 3; pass++)
				await withProjectFileTransaction(root, async () => {}, "write", true);
			expect((await readdir(root)).filter((name) => name.startsWith(".praxity-write-"))).toEqual([
				oldShortNameArchive.stage,
			]);
			expect(await snapshot(directory)).toEqual(archiveBefore);
		});

// Ordinary author paths cannot alias C01 sidecars through their later segments.
for (const path of [
	"assets/château.png",
	"leçon-1.prax",
	"Été.prax",
	"château.png",
	"assets/e\u0301te\u0301.png",
	"lessons/leçon-1.prax",
	"assets/photo~1.png",
	"notes/ÉTÉ/plan.md",
])
	for (const content of ["saved", null])
		it(`ordinary ${content === null ? "delete" : "overwrite"} of ${path} reports committed facts`, async () => {
			const root = await project();
			await mkdir(join(root, path, ".."), { recursive: true });
			await writeFile(join(root, path), "original");
			await writeProjectFiles(root, [{ path, content }]);
			const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
			const before = await snapshot(root);
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{
					path: stage,
					outcome: "committed",
					files: [{ path, hadOriginal: true, installed: true }],
				},
			]);
			expect(await snapshot(root)).toEqual(before);
		});

for (const path of [
	"settings.json",
	"lesson.prax",
	"assets/image.svg",
	".praxity/identity/course.json",
]) {
	it(`reports canonical committed facts for ${path} without changing disk`, async () => {
		const root = await project();
		const { stage } = await archive(root, path);
		const before = await snapshot(root);
		expect(await readProjectRecoveryEvidence(root)).toEqual([
			{
				path: stage,
				outcome: "committed",
				files: [{ path, hadOriginal: true, installed: true }],
			},
		]);
		expect(await snapshot(root)).toEqual(before);
	});
}

it("reports per-file originals and partial installations after rollback", async () => {
	const root = await project();
	await writeFile(join(root, "settings.json"), "original");
	await expect(
		writeProjectFiles(
			root,
			[
				{ path: "new.prax", content: "new lesson" },
				{ path: "settings.json", content: "saved" },
			],
			{
				onStep: async ({ kind, index }) => {
					if (kind === "installed" && index === 0) throw new Error("Refuse second installation");
				},
			},
		),
	).rejects.toThrow("Refuse second installation");
	const before = await snapshot(root);
	const evidence = await readProjectRecoveryEvidence(root);
	expect(evidence).toEqual([
		{
			path: expect.stringMatching(/^\.praxity-write-/),
			outcome: "rolled-back",
			files: [
				{ path: "new.prax", hadOriginal: false, installed: true },
				{ path: "settings.json", hadOriginal: true, installed: false },
			],
		},
	]);
	expect(await snapshot(root)).toEqual(before);
});

it("a durable commit proves every installation even when installed markers are missing", async () => {
	const root = await project();
	await writeFile(join(root, "settings.json"), "original");
	await writeProjectFiles(root, [
		{ path: "settings.json", content: "saved" },
		{ path: "new.prax", content: "new" },
	]);
	const [stage] = (await readdir(root)).filter((name) => name.startsWith(".praxity-write-"));
	await rm(join(root, stage, "installed-0"));
	await rm(join(root, stage, "installed-1"));
	expect(await readProjectRecoveryEvidence(root)).toEqual([
		{
			path: stage,
			outcome: "committed",
			files: [
				{ path: "settings.json", hadOriginal: true, installed: true },
				{ path: "new.prax", hadOriginal: false, installed: true },
			],
		},
	]);
});

it("ready and every installed marker prove the durable commit before its redundant marker", async () => {
	const root = await project();
	const { stage } = await archive(root);
	await rm(join(root, stage, "committed"));
	expect(await readProjectRecoveryEvidence(root)).toEqual([
		{
			path: stage,
			outcome: "committed",
			files: [{ path: "settings.json", hadOriginal: true, installed: true }],
		},
	]);
});

it("ready with only one of two installed markers stays unknown without a root journal", async () => {
	const root = await project();
	await mkdir(join(root, ".praxity/identity/lessons"), { recursive: true });
	await writeFile(join(root, "settings.json"), "original");
	await writeProjectFiles(root, [
		{ path: "settings.json", content: "saved" },
		{ path: ".praxity/identity/lessons/new.json", content: "head" },
	]);
	const [stage] = (await readdir(root)).filter((name) => name.startsWith(".praxity-write-"));
	await rm(join(root, stage, "committed"));
	await rm(join(root, stage, "installed-1"));
	expect(await readdir(root)).not.toContain(".praxity-transaction.json");
	const before = await snapshot(root);
	expect(await readProjectRecoveryEvidence(root)).toEqual([{ path: stage, outcome: "unknown" }]);
	expect(await snapshot(root)).toEqual(before);
});

for (const mutation of [
	"contradiction",
	"capture",
	"journal",
	"forged-path",
	"marker",
	"no-decision",
	"conflict",
	"unknown-entry",
] as const) {
	it(`${mutation} recovery bytes remain unknown and unchanged by inspection`, async () => {
		const root = await project();
		const { stage, journal } = await archive(root);
		const directory = join(root, stage);
		if (mutation === "contradiction") await writeFile(join(directory, "abort"), journal.checksum);
		if (mutation === "capture") {
			const capture = (await readdir(directory)).find((name) => /^install-0\.capture-/.test(name));
			if (!capture) throw new Error("Missing original capture");
			await writeFile(join(directory, capture), "outside edit");
		}
		if (mutation === "journal") await writeFile(join(directory, "journal.tmp"), "changed journal");
		if (mutation === "forged-path") {
			journal.plan.files[0].path = ".praxity/../settings.json";
			journal.checksum = createHash("sha256").update(JSON.stringify(journal.plan)).digest("hex");
			await writeFile(join(directory, "journal.tmp"), JSON.stringify(journal));
		}
		if (mutation === "marker") await writeFile(join(directory, "installed-0"), "changed marker");
		if (mutation === "no-decision") {
			await rm(join(directory, "committed"));
			await rm(join(directory, "installed-0"));
		}
		if (mutation === "conflict") await writeFile(join(directory, "conflict"), journal.checksum);
		if (mutation === "unknown-entry") await writeFile(join(directory, "author-copy"), "keep");
		const before = await snapshot(root);
		expect(await readProjectRecoveryEvidence(root)).toEqual([{ path: stage, outcome: "unknown" }]);
		expect(await snapshot(root)).toEqual(before);
	});
}

it("an active journal is unknown inside a writer and through standalone inspection", async () => {
	const root = await project();
	await writeFile(join(root, "settings.json"), "original");
	let activeJournal = Buffer.alloc(0);
	await writeProjectFiles(root, [{ path: "settings.json", content: "saved" }], {
		onStep: async ({ kind }) => {
			if (kind !== "installed") return;
			activeJournal = await readFile(join(root, ".praxity-transaction.json"));
			const before = await snapshot(root);
			const facts = await readProjectRecoveryEvidence(root);
			expect(facts).toContainEqual({ path: ".praxity-transaction.json", outcome: "unknown" });
			expect(facts.every((fact) => fact.outcome === "unknown")).toBe(true);
			expect(await snapshot(root)).toEqual(before);
		},
	});
	await writeFile(join(root, ".praxity-transaction.json"), activeJournal);
	const before = await snapshot(root);
	expect(await readProjectRecoveryEvidence(root)).toContainEqual({
		path: ".praxity-transaction.json",
		outcome: "unknown",
	});
	expect(await snapshot(root)).toEqual(before);
});

it("legacy and unknown recovery entries are unknown", async () => {
	const root = await project();
	await mkdir(join(root, ".praxity", ".praxity-write-content-identity.json.old"), {
		recursive: true,
	});
	await writeFile(join(root, ".praxity-write-unknown"), "keep");
	const before = await snapshot(root);
	expect(await readProjectRecoveryEvidence(root)).toEqual(
		expect.arrayContaining([
			{ path: ".praxity/.praxity-write-content-identity.json.old", outcome: "unknown" },
			{ path: ".praxity-write-unknown", outcome: "unknown" },
		]),
	);
	expect(await snapshot(root)).toEqual(before);
});

it.runIf(process.platform === "win32")("refuses a stream directory before staging", () =>
	onPlatform("win32", async () => {
		const root = await project();
		const before = await snapshot(root);
		await expect(
			withProjectFileTransaction(
				root,
				(canonical) =>
					applyProjectFilePlan(canonical, [], { createDirectories: ["folder:stream"] }),
				"write",
				false,
			),
		).rejects.toThrow("Invalid project journal file path");
		expect(await snapshot(root)).toEqual(before);
	}),
);

it.runIf(process.platform === "win32")(
	"a fully checksummed journal with a stream path remains unknown",
	() =>
		onPlatform("win32", async () => {
			const root = await project();
			const { stage, journal } = await archive(root);
			const oldChecksum = journal.checksum;
			journal.plan.files[0].path = "settings.json:stream";
			journal.checksum = createHash("sha256").update(JSON.stringify(journal.plan)).digest("hex");
			for (const name of await readdir(join(root, stage))) {
				const path = join(root, stage, name);
				const bytes = await readFile(path, "utf8");
				await writeFile(
					path,
					name === "journal.tmp"
						? JSON.stringify(journal)
						: bytes.replaceAll(oldChecksum, journal.checksum),
				);
			}
			const before = await snapshot(root);
			expect(await readProjectRecoveryEvidence(root)).toEqual([
				{ path: stage, outcome: "unknown" },
			]);
			expect(await snapshot(root)).toEqual(before);
		}),
);

for (const path of [
	"narration.yaml:voice",
	"narration.yaml::$DATA",
	"settings.json:stream",
	"folder:stream/file.json",
]) {
	it.runIf(process.platform === "win32")(`refuses stream path ${path} before any plan writes`, () =>
		onPlatform("win32", async () => {
			const root = await project();
			await writeFile(join(root, "narration.yaml"), "original narration");
			const before = await snapshot(root);
			await expect(
				withProjectFileTransaction(
					root,
					(canonical) => applyProjectFilePlan(canonical, [{ path, content: "changed" }]),
					"write",
					false,
				),
			).rejects.toThrow("Invalid project journal file path");
			expect(await snapshot(root)).toEqual(before);
		}),
	);
}

for (const platform of ["linux", "darwin"] as const)
	it.skipIf(process.platform === "win32")(
		`${platform} imports, deletes and recovers an older colon-name journal before a later save`,
		withCountingFlushes(() =>
			onPlatform(platform, async () => {
				const root = await project();
				await mkdir(join(root, "assets"));
				await writeProjectFiles(root, [{ path: "assets/Q3:Q4.png", content: "png" }]);
				expect(await readFile(join(root, "assets/Q3:Q4.png"), "utf8")).toBe("png");
				await writeProjectFiles(root, [{ path: "assets/Q3:Q4.png", content: null }]);
				expect(await readdir(join(root, "assets"))).toEqual([]);
				const { stage } = await archive(root, "assets/a:b.png");
				const before = await snapshot(root);
				expect(await readProjectRecoveryEvidence(root)).toEqual([
					{
						path: stage,
						outcome: "committed",
						files: [{ path: "assets/a:b.png", hadOriginal: true, installed: true }],
					},
				]);
				expect(await snapshot(root)).toEqual(before);
				// Main used this same journal format. Reintroduce its active commit,
				// which must recover before the unrelated settings write can proceed.
				await writeFile(
					join(root, ".praxity-transaction.json"),
					await readFile(join(root, stage, "journal.tmp")),
				);
				await writeProjectFiles(root, [{ path: "settings.json", content: "later save" }]);
				expect(await readFile(join(root, "settings.json"), "utf8")).toBe("later save");
				expect(await readFile(join(root, "assets/a:b.png"), "utf8")).toBe("saved");
				expect(await readdir(root)).not.toContain(".praxity-transaction.json");
				await withProjectFileTransaction(
					root,
					(canonical) =>
						applyProjectFilePlan(canonical, [], {
							createDirectories: ["assets/folder:charts"],
						}),
					"write",
					false,
				);
				expect(await readdir(join(root, "assets"))).toContain("folder:charts");
			}),
		),
	);

it.runIf(process.platform === "win32")(
	"8.3 and case aliases record narration's native basename and classify as protected",
	async () => {
		const root = await project();
		await writeFile(join(root, "narration.yaml"), "original");
		const short = execFileSync(
			"cmd.exe",
			["/d", "/c", "for %I in (narration.yaml) do @echo %~snxI"],
			{ cwd: root, encoding: "utf8" },
		).trim();
		expect(short.toLowerCase()).not.toBe("narration.yaml");
		expect(await realpath(join(root, short))).toBeDefined();
		const { isIdentityLineagePath } = await import("../project-protected-paths");
		for (const alias of [short, "NARRATION.YAML"]) {
			await writeProjectFiles(root, [{ path: alias, content: "saved" }]);
			const [fact] = await readProjectRecoveryEvidence(root);
			expect(fact).toEqual({
				path: expect.any(String),
				outcome: "committed",
				files: [{ path: "narration.yaml", hadOriginal: true, installed: true }],
			});
			if (fact.outcome === "unknown") throw new Error("Unverified alias archive");
			expect(isIdentityLineagePath(fact.files[0].path)).toBe(true);
		}
		expect(isIdentityLineagePath("NARRATION.YAML")).toBe(true);
	},
);

it("the protected-path contract includes C01 sidecars and excludes neighboring names", async () => {
	const { isIdentityLineagePath } = await import("../project-protected-paths");
	for (const path of [
		".praxity",
		".praxity/identity",
		".praxity/identity/lessons/a.json",
		".praxity/identity/snapshots/a.json",
		".praxity/content-identity.json",
		"narration.yaml",
		"NARRATION.YAML",
		".praxity/review",
		".praxity/review/runs.json",
	])
		expect(isIdentityLineagePath(path), path).toBe(true);
	for (const path of [
		".praxity-other/course.json",
		".praxity/state.json",
		".praxity/local/drafts/file-a.json",
		"narration.yaml.backup",
		"lesson.prax",
		"settings.json",
		"assets/image.svg",
	])
		expect(isIdentityLineagePath(path), path).toBe(false);
});

it("records canonical paths under new directories reached through a reverse alias", async () => {
	const root = await project();
	await mkdir(join(root, ".praxity", "identity"), { recursive: true });
	await symlink(join(root, ".praxity", "identity"), join(root, "store-alias"), "junction");
	await writeFile(join(root, "settings.json"), "original");
	await withProjectFileTransaction(
		root,
		(canonical) =>
			applyProjectFilePlan(
				canonical,
				[
					{ path: "settings.json", content: "saved" },
					{ path: "store-alias/lessons/new.json", content: "head" },
				],
				{ createDirectories: ["store-alias/lessons"] },
			),
		"write",
		false,
	);
	expect(await readProjectRecoveryEvidence(root)).toEqual([
		{
			path: expect.any(String),
			outcome: "committed",
			files: [
				{ path: "settings.json", hadOriginal: true, installed: true },
				{ path: ".praxity/identity/lessons/new.json", hadOriginal: false, installed: true },
			],
		},
	]);
	expect(await readFile(join(root, ".praxity", "identity", "lessons", "new.json"), "utf8")).toBe(
		"head",
	);
});
