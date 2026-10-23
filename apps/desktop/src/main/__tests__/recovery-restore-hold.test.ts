import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import { persistCourseIdentity, resolveCourseIdentity } from "../identity-store";
import {
	listProjectRecovery,
	readProjectRecoveryEvidence,
	restoreProjectRecovery,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const roots: string[] = [];
const runtime = { appVersion: "0.3.0", exportAssetsDir: "unused" };
let writerRoot: string;
let writerEntry: string;
beforeAll(async () => {
	writerRoot = await mkdtemp(join(tmpdir(), "restore-hold-writer-"));
	writerEntry = join(writerRoot, "writer.mjs");
	// Compile once; the crash case still kills a fresh process after real durable publication.
	await build({
		entryPoints: [fileURLToPath(new URL("./fixtures/restore-hold-writer.ts", import.meta.url))],
		outfile: writerEntry,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
		},
	});
});
afterAll(async () => {
	if (writerRoot) await rm(writerRoot, { recursive: true, force: true });
});
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function project(track = true) {
	const root = await mkdtemp(join(tmpdir(), "restore-hold-"));
	if (track) roots.push(root);
	await writeFile(join(root, "lesson.prax"), "# Original\n");
	return root;
}
async function command(root: string, action: string, ...args: string[]) {
	const result = await runPraxityCli(["recovery", action, root, ...args], runtime);
	expect(result.exitCode, result.stderr || result.stdout).toBe(0);
	return JSON.parse(result.stdout);
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
async function save(root: string, files: Array<{ path: string; content: string }>) {
	await withProjectFileTransaction(root, () => writeProjectFiles(root, files), "write", false);
	const stages = (await command(root, "list")).archives as Array<{ stage: string }>;
	return stages.map(({ stage }) => stage);
}

describe.each(["oldest", "newest"])(
	"CLI restores all four originals from the %s archive between reclaiming saves",
	(position) => {
		let root: string;
		let source: string;
		const originals = { "a.prax": "A0", "b.prax": "B0", "c.prax": "C0", "d.prax": "D0" };
		beforeAll(async () => {
			root = await project(false);
			for (const [path, content] of Object.entries(originals))
				await writeFile(join(root, path), content);
			if (position === "newest")
				await save(root, [{ path: "lesson.prax", content: "# Earlier\n" }]);
			const before = new Set(
				(await command(root, "list")).archives.map(({ stage }: { stage: string }) => stage),
			);
			const stages = await save(
				root,
				Object.keys(originals).map((path) => ({ path, content: "replacement" })),
			);
			const archive = stages.find((stage) => !before.has(stage));
			if (!archive) throw new Error("Missing four-file archive");
			source = archive;
			if (position === "oldest") await save(root, [{ path: "lesson.prax", content: "# Later\n" }]);
		});
		afterAll(async () => {
			if (root) await rm(root, { recursive: true, force: true });
		});
		for (const [path, content] of Object.entries(originals)) {
			it(`restores ${path} across a reclaiming save`, async () => {
				await command(root, "restore", source, "original", path);
				await writeProjectFiles(root, [{ path: "settings.json", content: path }]);
				expect(await readFile(join(root, path), "utf8")).toBe(content);
				expect((await command(root, "list")).archives).toContainEqual(
					expect.objectContaining({ stage: source, status: "held" }),
				);
			});
		}
	},
);

it.each(["en", "fr"])("CLI reports a held source and explains resolve in %s", async (locale) => {
	const root = await project();
	const [source] = await save(root, [{ path: "lesson.prax", content: "# Saved\n" }]);
	expect((await command(root, "list", "--lang", locale)).archives).toContainEqual(
		expect.objectContaining({ stage: source, status: "unverified" }),
	);
	const result = await command(
		root,
		"restore",
		source,
		"original",
		"lesson.prax",
		"--lang",
		locale,
	);
	expect(result.message).toBe(
		locale === "en"
			? "Archive kept. Delete it with praxity recovery resolve when you no longer need it."
			: "Archive conservée. Supprimez-la avec praxity recovery resolve quand vous n'en avez plus besoin.",
	);
	const journal = JSON.parse(await readFile(join(root, source, "journal.tmp"), "utf8"));
	expect(await readFile(join(root, source, "held"), "utf8")).toBe(journal.checksum);
	expect((await command(root, "list", "--lang", locale)).archives).toContainEqual(
		expect.objectContaining({ stage: source, status: "held" }),
	);
	await command(root, "resolve", source);
	expect(await readdir(root)).not.toContain(source);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Original\n");
});

it.each(["en", "fr"])("a refused CLI restore reports its published hold in %s", async (locale) => {
	const root = await project();
	const [source] = await save(root, [{ path: "lesson.prax", content: "# Saved\n" }]);
	expect((await command(root, "list", "--lang", locale)).archives).toContainEqual(
		expect.objectContaining({ stage: source, status: "unverified" }),
	);
	await rm(join(root, "lesson.prax"));
	await mkdir(join(root, "lesson.prax"));
	await writeFile(join(root, "lesson.prax", "outside.txt"), "retained live bytes");
	const result = await runPraxityCli(
		["recovery", "restore", root, source, "original", "lesson.prax", "--lang", locale],
		runtime,
	);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("Project transaction target is not a regular file");
	expect(result.stderr).toContain(
		locale === "en"
			? "Archive kept. Delete it with praxity recovery resolve when you no longer need it."
			: "Archive conservée. Supprimez-la avec praxity recovery resolve quand vous n'en avez plus besoin.",
	);
	expect((await command(root, "list")).archives).toContainEqual(
		expect.objectContaining({ stage: source, status: "held" }),
	);
	expect(await readFile(join(root, "lesson.prax", "outside.txt"), "utf8")).toBe(
		"retained live bytes",
	);
});

it("a malformed held directory stays listable, extractable and explicitly resolvable", async () => {
	const root = await project();
	const [source] = await save(root, [{ path: "lesson.prax", content: "# Saved\n" }]);
	const stages = await save(root, [{ path: "lesson.prax", content: "# Healthy\n" }]);
	const healthy = stages.find((stage) => stage !== source);
	if (!healthy) throw new Error("Missing healthy archive");
	await mkdir(join(root, source, "held"));
	await writeFile(join(root, source, "held", "outside.txt"), "retained hold bytes");
	expect((await command(root, "list")).archives).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ stage: source, status: "unverified" }),
			expect.objectContaining({ stage: healthy, status: "unverified" }),
		]),
	);
	const output = join(root, "extracted");
	await command(root, "extract", source, output);
	expect(await readFile(join(output, "captured", "held", "outside.txt"), "utf8")).toBe(
		"retained hold bytes",
	);
	expect(await readFile(join(output, "original", "lesson.prax"), "utf8")).toBe("# Original\n");
	await command(root, "resolve", source);
	expect(await readdir(root)).not.toContain(source);
	expect(await readdir(root)).toContain(healthy);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Healthy\n");
});

describe.each([false, true])("protected pruning with three restored sources: %s", (restore) => {
	let root: string;
	let courseId: string;
	let lessonId: string;
	const held: string[] = [];
	const narration = (tail = "") =>
		JSON.stringify({
			version: 2,
			courseId,
			lessons: { [lessonId]: { enabled: true, defaults: { voice: "author-voice" }, segments: [] } },
		}) + tail;
	beforeAll(async () => {
		root = await project(false);
		const { identity } = await persist(root);
		courseId = identity.course.courseId;
		lessonId = identity.snapshots[0].lessonId;
		await writeFile(join(root, "narration.yaml"), narration());
		await writeFile(join(root, "settings.json"), "S0");
	});
	afterAll(async () => {
		if (root) await rm(root, { recursive: true, force: true });
	});
	for (let index = 1; index <= 12; index++) {
		it(`prepares ordinary archive ${index}`, async () => {
			await save(root, [{ path: "settings.json", content: `S${index}` }]);
			expect(await readFile(join(root, "settings.json"), "utf8")).toBe(`S${index}`);
		});
	}
	it("holds the first three candidates before reclaiming ordinary archives", async () => {
		if (restore) {
			held.push(...(await listProjectRecovery(root)).map(({ stage }) => stage).slice(0, 3));
			for (const stage of held)
				await restoreProjectRecovery(root, stage, "original", "settings.json");
		}
		await withProjectFileTransaction(root, async () => {}, "write", true);
		expect(
			(await listProjectRecovery(root)).filter(({ status }) => status === "held"),
		).toHaveLength(restore ? 3 : 0);
	});
	for (let index = 0; index < 30; index++) {
		it(`bounds protected archives after narration and I4 persist ${index + 1}`, async () => {
			await writeProjectFiles(root, [
				{ path: "narration.yaml", content: narration("\n".repeat(index + 1)) },
			]);
			await writeFile(join(root, "lesson.prax"), `# Changed ${index}\n`);
			await persist(root);
			const archives = await listProjectRecovery(root);
			expect(
				archives.filter(({ files }) => files.some(({ path }) => path !== "settings.json")).length,
			).toBeLessThanOrEqual(3);
			if (index === 29) {
				expect(
					archives.filter(({ files }) => files.some(({ path }) => path !== "settings.json")),
				).toHaveLength(0);
				expect(
					archives.filter(({ status }) => status === "held").map(({ stage }) => stage),
				).toEqual(held);
			}
		});
	}
});

describe.each(["ordinary", "protected"])(
	"a held %s archive across ten admissions and I4 persists",
	(kind) => {
		let root: string;
		let source: string;
		let original: string;
		const coursePath = ".praxity/identity/course.json";
		beforeAll(async () => {
			root = await project(false);
			const { identity } = await persist(root);
			const narration = JSON.stringify({
				version: 2,
				courseId: identity.course.courseId,
				lessons: {},
			});
			if (kind === "protected") {
				await writeFile(join(root, "narration.yaml"), narration);
				original = await readFile(join(root, coursePath), "utf8");
			}
			const before = new Set(await save(root, []));
			const stages = await save(
				root,
				kind === "ordinary"
					? [{ path: "lesson.prax", content: "# Saved\n" }]
					: [
							{ path: "narration.yaml", content: `${narration}\n` },
							{ path: coursePath, content: `${original}\n` },
						],
			);
			const stage = stages.find((stage) => !before.has(stage));
			if (!stage) throw new Error("Missing source archive");
			source = stage;
			await command(
				root,
				"restore",
				source,
				"original",
				kind === "ordinary" ? "lesson.prax" : "narration.yaml",
			);
		});
		afterAll(async () => {
			if (root) await rm(root, { recursive: true, force: true });
		});
		for (let index = 0; index < 10; index++) {
			it(`retains the source after admission and I4 prune ${index + 1}`, async () => {
				await writeProjectFiles(root, [{ path: "settings.json", content: String(index) }]);
				await persist(root);
				expect(await readdir(root)).toContain(source);
			});
		}
		it("can restore again from the same source", async () => {
			await command(
				root,
				"restore",
				source,
				"original",
				kind === "ordinary" ? "lesson.prax" : coursePath,
			);
			expect(
				await readFile(join(root, kind === "ordinary" ? "lesson.prax" : coursePath), "utf8"),
			).toBe(kind === "ordinary" ? "# Original\n" : original);
		});
		it("explicit resolve releases the source", async () => {
			await command(root, "resolve", source);
			expect(await readdir(root)).not.toContain(source);
		});
	},
);

it.each(["held", "held.tmp"])(
	"%s preserves ordinary recovery facts and fresh-course I4 initialization",
	async (marker) => {
		const root = await project();
		const [source] = await save(root, [{ path: "lesson.prax", content: "# Saved\n" }]);
		const before = await readProjectRecoveryEvidence(root);
		expect(before).toEqual([
			{
				path: source,
				outcome: "committed",
				files: [{ path: "lesson.prax", hadOriginal: true, installed: true }],
			},
		]);
		const journal = JSON.parse(await readFile(join(root, source, "journal.tmp"), "utf8"));
		await writeFile(
			join(root, source, marker),
			marker === "held.tmp" ? journal.checksum.slice(0, 8) : journal.checksum,
		);
		expect(await readProjectRecoveryEvidence(root)).toEqual(before);
		await expect(persist(root)).resolves.toMatchObject({ identity: { course: { schema: 1 } } });
	},
);

it.each(["bad checksum", "changed capture", "conflict"])(
	"list does not certify a hold with %s",
	async (damage) => {
		const root = await project();
		const [source] = await save(root, [{ path: "lesson.prax", content: "# Saved\n" }]);
		await command(root, "restore", source, "original", "lesson.prax");
		if (damage === "changed capture") {
			const capture = (await readdir(join(root, source))).find((name) =>
				/^install-0\.capture-/.test(name),
			);
			if (!capture) throw new Error("Missing capture");
			await writeFile(join(root, source, capture), "outside edit");
		} else
			await writeFile(join(root, source, damage === "conflict" ? "conflict" : "held"), "invalid");
		expect((await command(root, "list")).archives).toContainEqual(
			expect.objectContaining({
				stage: source,
				status: damage === "conflict" ? "conflict" : "unverified",
			}),
		);
		await writeProjectFiles(root, [{ path: "settings.json", content: "next" }]);
		expect(await readdir(root)).toContain(source);
	},
);

it("a process killed after durable hold publication leaves live bytes sound and can retry", async () => {
	const root = await project();
	const [source] = await save(root, [{ path: "lesson.prax", content: "# Saved\n" }]);
	const child = fork(writerEntry, [root, source], {
		execArgv: [],
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	let errors = "";
	child.stderr?.on("data", (chunk) => {
		errors += chunk;
	});
	const exited = once(child, "exit");
	try {
		await Promise.race([
			once(child, "message").then(([message]) => {
				expect(message, errors).toEqual({ held: true });
			}),
			exited.then(() => {
				throw new Error(`Restore exited before publishing a hold: ${errors}`);
			}),
		]);
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await exited;
	}
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Saved\n");
	await withProjectFileTransaction(root, async () => {}, "write");
	expect((await command(root, "list")).archives).toContainEqual(
		expect.objectContaining({ stage: source, status: "held" }),
	);
	await command(root, "restore", source, "original", "lesson.prax");
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe("# Original\n");
});
