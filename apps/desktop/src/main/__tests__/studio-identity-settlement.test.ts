import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type IdentityNode,
	isDurableIdentity,
	resolveIdentity,
	serializeIdentity,
} from "@praxity/content-identity";
import { readLesson } from "@praxity/grammar";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import { initializeCourseIdentity, loadIdentityStore } from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { createStudioProjectSession } from "../studio/project-session";

const base = "# First\n\nRepeated.\n\nOther subject.\n";
const duplicate = `${base}\nRepeated.\n`;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});
async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, path));
		else result[path] = (await readFile(join(root, path))).toString("base64");
	}
	return result;
}
async function fixture(locale = "en", cleanup = roots) {
	const root = await mkdtemp(join(tmpdir(), "studio-identity-settlement-"));
	cleanup.push(root);
	await writeFile(
		join(root, "course.yaml"),
		`title: Example\nlocale: ${locale}\nlessons: [one.prax]\n`,
	);
	await writeFile(join(root, "one.prax"), base);
	await initializeCourseIdentity(root, ["one.prax"]);
	const prior = await loadIdentityStore(root);
	const donor = prior.snapshots
		.flatMap((snapshot) => Object.entries(snapshot.nodes))
		.find(([, node]) => node.kind === "block" && node.matchText === "Repeated.")?.[0];
	if (!donor) throw new Error("Missing original identity");
	await writeFile(join(root, "one.prax"), duplicate);
	return { root, donor };
}
const templates: string[] = [];
const initialized = new Map<string, Awaited<ReturnType<typeof fixture>>>();
// Each locale has a bounded setup hook; every case owns its source, store and history.
for (const locale of ["en", "fr"]) {
	beforeAll(async () => {
		initialized.set(locale, await fixture(locale, templates));
	});
}
afterAll(async () => {
	await Promise.all(templates.map((root) => rm(root, { recursive: true })));
});
async function initializedFixture(locale = "en") {
	const template = initialized.get(locale);
	if (!template) throw new Error("Missing initialized template");
	const root = await mkdtemp(join(tmpdir(), "studio-identity-settlement-"));
	roots.push(root);
	await cp(template.root, root, { recursive: true });
	return { root, donor: template.donor };
}
const init = (root: string, locale = "en") =>
	runPraxityCli(["identity", "init", root, "--lang", locale], {
		appVersion: "test",
		exportAssetsDir: "unused",
	});
const nodes = async (root: string): Promise<Record<string, IdentityNode>> =>
	Object.assign({}, ...(await loadIdentityStore(root)).snapshots.map((snapshot) => snapshot.nodes));

it.each(
	[false, true].flatMap((savedPending) =>
		["removed", "reworded"].map((change) => ({ savedPending, change })),
	),
)(
	"settles a $change copy through Studio save, saved pending $savedPending",
	async ({ savedPending, change }) => {
		const { root, donor } = await initializedFixture();
		let session = await createStudioProjectSession(root, "test");
		try {
			if (savedPending)
				await session.invoke("courseWriteLesson", {
					courseDir: root,
					filename: "one.prax",
					grammar: duplicate,
					expectedGrammar: duplicate,
				});
		} finally {
			await session.close();
		}
		const original = await bytes(root);
		session = await createStudioProjectSession(root, "test");
		try {
			expect(await bytes(root)).toEqual(original);
			expect((await session.readSnapshot()).project.grammar).toBe(duplicate);
			expect((await session.identityReview()).retirements).toEqual([]);
			expect(await bytes(root)).toEqual(original);
			const grammar = change === "removed" ? base : `${base}\nA distinct copy.\n`;
			await session.invoke("courseWriteLesson", {
				courseDir: root,
				filename: "one.prax",
				grammar,
				expectedGrammar: duplicate,
			});
			expect((await session.identityReview()).retirements).toEqual([]);
			expect((await nodes(root))[donor].status).toBe("active");
			expect(Object.values(await nodes(root)).filter((node) => node.status === "pending")).toEqual(
				[],
			);
			expect((await init(root)).exitCode).toBe(0);
			expect((await nodes(root))[donor].status).toBe("active");
		} finally {
			await session.close();
		}
	},
);

it.each(["removed", "reworded"])(
	"settles a legacy store with six accumulated provisional IDs when the copy is %s",
	async (change) => {
		const { root, donor } = await initializedFixture();
		let prior = await loadIdentityStore(root);
		// Omitting history preserves the former resolver contract, including minting on repeated opens.
		for (let opening = 0; opening < 3; opening++) {
			const legacy = resolveIdentity(
				{
					course: prior.course ?? undefined,
					priorHeads: prior.heads,
					priorSnapshots: prior.snapshots,
					parsedDocuments: [{ path: "one.prax", tree: readLesson(duplicate).tree }],
					readerRoles: true,
				},
				{ allocateId: randomUUID, digest },
			);
			for (const snapshot of legacy.snapshots) {
				const canonical = serializeIdentity(snapshot);
				await writeFile(
					join(root, ".praxity/identity/snapshots", `${digest(canonical)}.json`),
					canonical,
				);
			}
			for (const head of legacy.heads) {
				const snapshot = legacy.snapshots.find(
					(snapshot) => digest(serializeIdentity(snapshot)) === head.head,
				);
				if (!snapshot) throw new Error("Missing legacy head");
				await writeFile(
					join(root, ".praxity/identity/lessons", `${snapshot.lessonId}.json`),
					serializeIdentity(head),
				);
			}
			await writeFile(
				join(root, ".praxity/identity/course.json"),
				serializeIdentity(legacy.course),
			);
			prior = await loadIdentityStore(root);
		}
		const provisional = prior.snapshots
			.flatMap((snapshot) => Object.entries(snapshot.nodes))
			.filter(([id, node]) => id !== donor && node.matchText === "Repeated.");
		expect(provisional).toHaveLength(6);
		for (const [, node] of provisional) expect(node.status).toBe("pending");
		expect((await nodes(root))[donor].status).toBe("pending");
		const original = await bytes(root);
		const session = await createStudioProjectSession(root, "test");
		try {
			expect((await session.identityReview()).retirements).toEqual([]);
			expect((await session.readSnapshot()).project.grammar).toBe(duplicate);
			expect(await bytes(root)).toEqual(original);
			const grammar = change === "removed" ? base : `${base}\nA distinct copy.\n`;
			await session.invoke("courseWriteLesson", {
				courseDir: root,
				filename: "one.prax",
				grammar,
				expectedGrammar: duplicate,
			});
			expect((await session.identityReview()).retirements).toEqual([]);
			const current = await nodes(root);
			const read = await resolveLessonSources(root);
			expect(current[donor].status).toBe("active");
			for (const [id] of provisional) {
				expect(current[id].status).toBe("retired");
				expect(isDurableIdentity(id, current[id], read.activeHistoryIds)).toBe(false);
			}
			expect((await init(root)).exitCode).toBe(0);
			expect((await nodes(root))[donor].status).toBe("active");
		} finally {
			await session.close();
		}
	},
);

it.each(
	["en", "fr"].flatMap((locale) => ["removed", "reworded"].map((change) => ({ locale, change }))),
)(
	"settles a mixed $locale gate after fixing source on disk, copy $change",
	async ({ locale, change }) => {
		const { root, donor } = await initializedFixture(locale);
		const mixed = duplicate.replace("Other subject.", "An unrelated replacement.");
		await writeFile(join(root, "one.prax"), mixed);
		const original = await bytes(root);
		let session = await createStudioProjectSession(root, "test");
		try {
			const review = await session.identityReview();
			expect(review.retirements).toMatchObject([
				{ file: "one.prax", page: "First", label: "Other subject.", line: null },
			]);
			expect(review.confirmationBlocked).toBe(true);
			await expect(session.confirmIdentityRetirements(review.revision)).rejects.toMatchObject({
				code: "identity_duplicate_pending",
			});
			expect(await bytes(root)).toEqual(original);
		} finally {
			await session.close();
		}
		const fixed = change === "removed" ? base : `${base}\nA distinct copy.\n`;
		await writeFile(join(root, "one.prax"), fixed);
		session = await createStudioProjectSession(root, "test");
		try {
			expect((await session.identityReview()).retirements).toEqual([]);
			expect((await session.readSnapshot()).project.grammar).toBe(fixed);
			expect((await init(root, locale)).exitCode).toBe(0);
			expect((await nodes(root))[donor].status).toBe("active");
		} finally {
			await session.close();
		}
	},
);
