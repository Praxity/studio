import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { projectIdentityRecoveryMessage } from "../../shared/project-write-errors";
import { runPraxityCli } from "../cli";
import { loadIdentityStore, persistCourseIdentity, resolveCourseIdentity } from "../identity-store";
import {
	withProjectFileFlushes,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

// Real bytes and recovery paths; project-journal tests own storage durability.
// Tested restore refusals precede flushing; no-op syncFile also skips its post-write path checks.
function withCountingFlushes<T>(work: (value: T) => Promise<void>) {
	return async (value: T) => {
		const flushes = { syncFile: vi.fn(async () => {}), syncDirectory: vi.fn(async () => {}) };
		await withProjectFileFlushes(flushes, () => work(value));
		expect(flushes.syncFile).toHaveBeenCalled();
		expect(flushes.syncDirectory).toHaveBeenCalled();
	};
}

const roots: string[] = [];
const runtime = { appVersion: "0.3.0", exportAssetsDir: "unused", editorAssetsDir: "missing" };
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function persist(root: string) {
	return withProjectFileTransaction(
		root,
		async () =>
			persistCourseIdentity(
				root,
				await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
			),
		"write",
		false,
	);
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "identity-restore-"));
	roots.push(root);
	await writeFile(join(root, "lesson.prax"), "# Original\n");
	const { identity } = await persist(root);
	const paths = [
		".praxity/identity/course.json",
		...(await Promise.all(
			["lessons", "snapshots"].map(async (directory) =>
				(
					await readdir(join(root, ".praxity/identity", directory))
				).map((name) => `.praxity/identity/${directory}/${name}`),
			),
		).then((paths) => paths.flat())),
	];
	const narration = JSON.stringify({ version: 2, courseId: identity.course.courseId, lessons: {} });
	await writeFile(join(root, "narration.yaml"), narration);
	paths.push("narration.yaml");
	const originals = new Map(
		await Promise.all(
			paths.map(async (path) => [path, await readFile(join(root, path), "utf8")] as const),
		),
	);
	await writeProjectFiles(
		root,
		paths.map((path) => ({ path, content: `${originals.get(path)}\n` })),
	);
	const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
	if (!stage) throw new Error("Missing archive");
	return { root, stage, identity, originals };
}

for (const locale of ["en", "fr"] as const) {
	it.each(["missing", "corrupt"])(
		`the ${locale} restore command preserves course and block IDs after %s identity and narration`,
		withCountingFlushes(async (damage: string) => {
			const { root, stage, identity, originals } = await fixture();
			const journal = await readFile(join(root, stage, "journal.tmp"));
			if (damage === "missing") {
				await rm(join(root, ".praxity"), { recursive: true });
				await rm(join(root, "narration.yaml"));
				await expect(persist(root)).rejects.toMatchObject({
					messageRef: { key: "desktop.identity.missingEstablished" },
				});
			} else for (const path of originals.keys()) await writeFile(join(root, path), "{broken");
			const message = projectIdentityRecoveryMessage(locale);
			expect(message).toContain("praxity recovery restore <project-dir> <archive> original <path>");
			expect(message.indexOf("recovery restore")).toBeLessThan(message.indexOf("recovery resolve"));
			expect(message).toContain("narration.yaml");
			expect(message).toContain(
				locale === "fr"
					? "Les fichiers existants dans .praxity/review sont conserv\u00e9s ; les modifications n'en \u00e9crivent plus."
					: "Existing .praxity/review evidence is kept; edits no longer write it.",
			);
			const listed = await runPraxityCli(["recovery", "list", root, "--lang", locale], runtime);
			expect(listed.exitCode, listed.stderr).toBe(0);
			expect(
				JSON.parse(listed.stdout).archives[0].files.map((file: { path: string }) => file.path),
			).toEqual([...originals.keys()]);
			const destination = join(root, "extracted");
			const extracted = await runPraxityCli(
				["recovery", "extract", root, stage, destination, "--lang", locale],
				runtime,
			);
			expect(extracted.exitCode, extracted.stderr).toBe(0);
			for (const [path, expected] of originals) {
				expect(await readFile(join(destination, "original", path), "utf8")).toBe(expected);
				const result = await runPraxityCli(
					["recovery", "restore", root, stage, "original", path, "--lang", locale],
					runtime,
				);
				expect(result.exitCode, result.stderr).toBe(0);
				expect(await readFile(join(root, path), "utf8")).toBe(expected);
			}
			expect(await readFile(join(root, stage, "journal.tmp"))).toEqual(journal);
			const restored = await persist(root);
			expect(restored.identity.course).toEqual(identity.course);
			expect(restored.identity.snapshots).toEqual(identity.snapshots);
		}),
	);
}

it(
	"replacement restores the chosen bytes and refuses unknown, absent and corrupt archive inputs without writes",
	withCountingFlushes(async () => {
		const { root, stage, originals } = await fixture();
		const path = "narration.yaml";
		await writeFile(join(root, path), "corrupt");
		for (const [archive, side, target] of [
			[stage, "other", path],
			[stage, "original", "../outside"],
			[stage, "original", "absent"],
			["../outside", "original", path],
		]) {
			const result = await runPraxityCli(
				["recovery", "restore", root, archive, side, target],
				runtime,
			);
			expect(result.exitCode).not.toBe(0);
			expect(await readFile(join(root, path), "utf8")).toBe("corrupt");
		}
		const result = await runPraxityCli(
			["recovery", "restore", root, stage, "replacement", path],
			runtime,
		);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(await readFile(join(root, path), "utf8")).toBe(`${originals.get(path)}\n`);
		await writeFile(join(root, stage, "journal.tmp"), "{broken");
		const refused = await runPraxityCli(
			["recovery", "restore", root, stage, "original", path],
			runtime,
		);
		expect(refused.exitCode).toBe(1);
		expect(await readFile(join(root, path), "utf8")).toBe(`${originals.get(path)}\n`);
	}),
);

it(
	"resolving an archive alone leaves the live narration fence; deliberate new-folder initialization changes IDs",
	withCountingFlushes(async () => {
		const { root, stage, identity } = await fixture();
		await rm(join(root, ".praxity"), { recursive: true });
		const resolved = await runPraxityCli(["recovery", "resolve", root, stage], runtime);
		expect(resolved.exitCode, resolved.stderr).toBe(0);
		await expect(loadIdentityStore(root)).rejects.toMatchObject({
			messageRef: { key: "desktop.identity.missingEstablished" },
		});
		const fresh = join(root, "fresh");
		await mkdir(fresh);
		await writeFile(join(fresh, "lesson.prax"), await readFile(join(root, "lesson.prax")));
		const initialized = await persist(fresh);
		expect(initialized.identity.course.courseId).not.toBe(identity.course.courseId);
		expect(initialized.identity.snapshots[0].lessonId).not.toBe(identity.snapshots[0].lessonId);
	}),
);

it(
	"restoring an absent original cannot delete live author bytes, and replacement preserves binary bytes",
	withCountingFlushes(async () => {
		const root = await mkdtemp(join(tmpdir(), "restore-binary-"));
		roots.push(root);
		const path = "narration.yaml";
		const replacement = Buffer.from([0, 255, 128, 10]);
		await writeProjectFiles(root, [{ path, content: replacement }]);
		const stages = JSON.parse(
			(await runPraxityCli(["recovery", "list", root], runtime)).stdout,
		).archives;
		expect(stages).toHaveLength(1);
		const stage = stages[0].stage;
		await writeFile(join(root, path), "outside author bytes");
		const refused = await runPraxityCli(
			["recovery", "restore", root, stage, "original", path, "--lang", "fr"],
			runtime,
		);
		expect(refused.exitCode).toBe(1);
		expect(JSON.parse(refused.stdout).error.message).toContain(
			"L'archive de r\u00e9cup\u00e9ration ne contient pas la copie",
		);
		expect(await readFile(join(root, path), "utf8")).toBe("outside author bytes");
		const restored = await runPraxityCli(
			["recovery", "restore", root, stage, "replacement", path],
			runtime,
		);
		expect(restored.exitCode, restored.stderr).toBe(0);
		expect(await readFile(join(root, path))).toEqual(replacement);
		const listed = JSON.parse(
			(await runPraxityCli(["recovery", "list", root], runtime)).stdout,
		).archives;
		const backup = listed.find((archive: { stage: string }) => archive.stage !== stage);
		expect(backup).toBeDefined();
		const destination = join(root, "displaced-backup");
		const extracted = await runPraxityCli(
			["recovery", "extract", root, backup.stage, destination],
			runtime,
		);
		expect(extracted.exitCode, extracted.stderr).toBe(0);
		expect(await readFile(join(destination, "original", path), "utf8")).toBe(
			"outside author bytes",
		);
	}),
);
