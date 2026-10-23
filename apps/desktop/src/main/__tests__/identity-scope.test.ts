import { createHash } from "node:crypto";
import {
	cp,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeIdentity } from "@praxity/content-identity";
import { afterEach, expect, it } from "vitest";
import { writeIdentityFixture } from "../../test-utils/identity-fixture";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import {
	CourseIdentitySession,
	persistCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import { withProjectFileTransaction } from "../project-file-transactions";

const roots: string[] = [];
const paths = ["a.prax", "b.prax"];
const alpha = "# Alpha\n\nA clear emergency exit must remain accessible.\n\nDistinct donor.\n";
const beta =
	"# Beta\n\nUse the appropriate safety equipment for each task and inspect it before working in the controlled area.\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(parent = tmpdir()) {
	const root = await mkdtemp(join(parent, "identity-scope-"));
	roots.push(root);
	await writeFile(join(root, paths[0]), alpha);
	await writeFile(join(root, paths[1]), beta);
	const seed = await resolveCourseIdentity(root, { lessonPaths: paths });
	// Seed valid persisted bytes directly; each scenario measures admission, not journal setup.
	await writeIdentityFixture(root, seed);
	const identitySession = new CourseIdentitySession(root);
	const initial = await resolveCourseIdentity(root, { lessonPaths: paths, identitySession });
	return { root, identitySession, initial };
}
for (const name of ["paragraph edit", "move across lessons"] as const) {
	it(`session admission equals full bytes for ${name}, including an unannounced donor edit`, async () => {
		const f = await fixture();
		const source =
			name === "paragraph edit"
				? beta.replace("appropriate", "correct")
				: `${beta}\nDistinct donor.\n`;
		if (name === "move across lessons")
			await writeFile(join(f.root, "a.prax"), alpha.replace("\nDistinct donor.\n", ""));
		await writeFile(join(f.root, "b.prax"), source);
		return withProjectFileTransaction(
			f.root,
			async () => {
				const scoped = await resolveCourseIdentity(f.root, {
					lessonPaths: paths,
					identitySession: f.identitySession,
				});
				const full = await resolveCourseIdentity(f.root, { lessonPaths: paths });
				expect(serializeIdentity(scoped.identity)).toBe(serializeIdentity(full.identity));
				expect(serializeIdentity([...scoped.lessons])).toBe(serializeIdentity([...full.lessons]));
				for (const [path, lesson] of scoped.lessons) {
					const provider = scoped.ids.get(path);
					const expected = full.lessons.get(path);
					if (!provider || !expected) throw new Error("Missing reader fixture");
					expect([...lesson.nodes.keys()]).toEqual([...expected.nodes.keys()]);
					for (const [id, record] of lesson.nodes)
						expect(provider(record.node, record.role)).toBe(id);
					expect(provider.transient).toBe(true);
				}
				if (name === "paragraph edit")
					expect(scoped.identity.heads[0]).toEqual(f.initial.identity.heads[0]);
				else
					expect(
						scoped.identity.heads.every((h, i) => h.head !== f.initial.identity.heads[i].head),
					).toBe(true);
				const saved = await persistCourseIdentity(f.root, scoped);
				expect(saved.identity.heads).toEqual(full.identity.heads);
				await writeFile(
					join(f.root, "b.prax"),
					source.replace("equipment", "protective equipment"),
				);
				const afterSave = await resolveCourseIdentity(f.root, {
					lessonPaths: paths,
					identitySession: f.identitySession,
				});
				expect(serializeIdentity(afterSave.identity)).toBe(
					serializeIdentity((await resolveCourseIdentity(f.root, { lessonPaths: paths })).identity),
				);
			},
			"write",
			false,
		);
	});
}

it("counts an earlier unpersisted donor edit when only the recipient changes on disk now", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "a.prax"), alpha.replace("\nDistinct donor.\n", ""));
	await resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession });
	await writeFile(join(f.root, "b.prax"), `${beta}\nDistinct donor.\n`);
	const scoped = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		identitySession: f.identitySession,
	});
	const full = await resolveCourseIdentity(f.root, { lessonPaths: paths });
	expect(serializeIdentity(scoped.identity)).toBe(serializeIdentity(full.identity));
	expect(scoped.identity.heads.every((h, i) => h.head !== f.initial.identity.heads[i].head)).toBe(
		true,
	);
	const donor = f.initial.identity.sourceMappings.find(
		(m) => m.file === "a.prax" && m.path.join("/") === "0/1",
	);
	if (!donor) throw new Error("Missing fixture donor");
	expect(
		scoped.identity.sourceMappings.find((m) => m.file === "b.prax" && m.path.join("/") === "0/1")
			?.id,
	).toBe(donor.id);
});

it("retained validation notices corrupt immutable history and does not conceal its error", async () => {
	const f = await fixture();
	const head = f.initial.identity.heads[0].head;
	const snapshot = join(f.root, `.praxity/identity/snapshots/${head}.json`);
	const original = await readFile(snapshot, "utf8");
	await writeFile(snapshot, "{broken}");
	await expect(
		resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession }),
	).rejects.toThrow(/Identity file/);
	expect(f.identitySession.lessonReads().size).toBe(0);
	await writeFile(snapshot, original);
	expect(
		serializeIdentity(
			(
				await resolveCourseIdentity(f.root, {
					lessonPaths: paths,
					identitySession: f.identitySession,
				})
			).identity,
		),
	).toBe(serializeIdentity(f.initial.identity));
});

it("inventory changes and watcher errors discard retained parses", async () => {
	const f = await fixture();
	expect(f.identitySession.lessonReads().size).toBe(2);
	f.identitySession.invalidate();
	expect(f.identitySession.lessonReads().size).toBe(0);
	await resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession });
	expect(f.identitySession.lessonReads().size).toBe(2);
	// A store-independent copy changes the inventory and requires the full copy rules.
	await cp(join(f.root, "a.prax"), join(f.root, "c.prax"));
	const added = await resolveCourseIdentity(f.root, {
		lessonPaths: [...paths, "c.prax"],
		identitySession: f.identitySession,
	});
	expect(added.identity.heads).toHaveLength(3);
	expect(added.identity.heads.slice(0, 2)).toEqual(f.initial.identity.heads);
	expect(f.identitySession.lessonReads().size).toBe(0);
	await writeFile(join(f.root, "b.prax"), beta.replace("appropriate", "correct"));
	const result = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		identitySession: f.identitySession,
	});
	expect(serializeIdentity(result.identity)).toBe(
		serializeIdentity((await resolveCourseIdentity(f.root, { lessonPaths: paths })).identity),
	);
});

it("result mutation cannot poison a session's validated store or lesson reads", async () => {
	const f = await fixture();
	f.initial.identity.snapshots[0].nodes = {};
	const lesson = f.initial.lessons.get("a.prax");
	if (!lesson) throw new Error("Missing fixture lesson");
	lesson.tree.stream.source = "tampered";
	const scoped = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		identitySession: f.identitySession,
	});
	expect(serializeIdentity(scoped.identity)).toBe(
		serializeIdentity((await resolveCourseIdentity(f.root, { lessonPaths: paths })).identity),
	);
	expect(scoped.lessons.get("a.prax")?.tree.stream.source).toBe(alpha);
});

it("same-size source writes with unchanged timestamps still equal fresh admission", async () => {
	const f = await fixture();
	const path = join(f.root, "b.prax");
	const before = await stat(path);
	const changed = beta.replace("appropriate", "recommended");
	expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(beta));
	await writeFile(path, changed);
	await utimes(path, before.atime, before.mtime);
	const scoped = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		identitySession: f.identitySession,
	});
	const fresh = await resolveCourseIdentity(f.root, { lessonPaths: paths });
	expect(serializeIdentity(scoped.identity)).toBe(serializeIdentity(fresh.identity));
	expect(scoped.identity.heads[1]).not.toEqual(f.initial.identity.heads[1]);
});

it("refuses retained evidence from a different project", async () => {
	const f = await fixture();
	const other = await mkdtemp(join(tmpdir(), "identity-other-"));
	roots.push(other);
	await expect(
		resolveCourseIdentity(other, { lessonPaths: paths, identitySession: f.identitySession }),
	).rejects.toThrow(/another project/);
	expect(f.identitySession.lessonReads().size).toBe(0);
});

it("admits the same project through a linked session path and refuses a retargeted link", async () => {
	const f = await fixture();
	const alias = join(f.root, "linked-project");
	await symlink(f.root, alias, "junction");
	const identitySession = new CourseIdentitySession(alias);
	for (const directory of [f.root, alias]) {
		const admitted = await resolveCourseIdentity(directory, {
			lessonPaths: paths,
			identitySession,
		});
		expect(serializeIdentity(admitted.identity)).toBe(serializeIdentity(f.initial.identity));
		expect(identitySession.lessonReads().size).toBe(2);
	}
	const other = await mkdtemp(join(tmpdir(), "identity-retargeted-"));
	roots.push(other);
	await rm(alias);
	await symlink(other, alias, "junction");
	await expect(
		resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession }),
	).rejects.toThrow(/another project/);
	expect(identitySession.lessonReads().size).toBe(0);
});

it.each(["alias", "canonical target"] as const)(
	"keeps the first admitted project when a retargeted %s is supplied",
	async (directory) => {
		const first = await fixture();
		const other = await fixture();
		const alias = join(first.root, "linked-project");
		await symlink(first.root, alias, "junction");
		const identitySession = new CourseIdentitySession(alias);
		const admitted = await resolveCourseIdentity(alias, { lessonPaths: paths, identitySession });
		expect(admitted.identity.course.courseId).toBe(first.initial.identity.course.courseId);
		expect(identitySession.lessonReads().size).toBe(2);
		await rm(alias);
		await symlink(other.root, alias, "junction");
		const courseDir = directory === "alias" ? alias : other.root;
		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(
				resolveCourseIdentity(courseDir, { lessonPaths: paths, identitySession }),
			).rejects.toThrow("Identity: admission session belongs to another project");
			expect(identitySession.lessonReads().size).toBe(0);
			identitySession.invalidate();
		}
		await rm(alias);
		await symlink(first.root, alias, "junction");
		const restored = await resolveCourseIdentity(alias, { lessonPaths: paths, identitySession });
		expect(restored.identity.course.courseId).toBe(first.initial.identity.course.courseId);
	},
);

it("a failed first admission does not bind the session to that project", async () => {
	const first = await fixture();
	const other = await fixture();
	const alias = join(first.root, "linked-project");
	await symlink(first.root, alias, "junction");
	const identitySession = new CourseIdentitySession(alias);
	await expect(
		resolveCourseIdentity(alias, { lessonPaths: ["missing.prax"], identitySession }),
	).rejects.toThrow();
	await rm(alias);
	await symlink(other.root, alias, "junction");
	const admitted = await resolveCourseIdentity(other.root, { lessonPaths: paths, identitySession });
	expect(admitted.identity.course.courseId).toBe(other.initial.identity.course.courseId);
});

it.runIf(process.platform === "win32" || process.platform === "darwin")(
	"admits case aliases before and after retained reads are invalidated",
	async () => {
		const f = await fixture();
		const alias = f.root.replace("identity-scope-", "IDENTITY-SCOPE-");
		const identitySession = new CourseIdentitySession(alias);
		for (const courseDir of [f.root, alias]) {
			const admitted = await resolveCourseIdentity(courseDir, {
				lessonPaths: paths,
				identitySession,
			});
			expect(admitted.identity.course.courseId).toBe(f.initial.identity.course.courseId);
			identitySession.invalidate();
		}
	},
);

it.runIf(process.platform === "darwin")(
	"admits /var and /private/var aliases before and after retained reads are invalidated",
	async () => {
		const f = await fixture("/var/tmp");
		const canonical = await realpath(f.root);
		expect(canonical).toBe(`/private${f.root}`);
		const identitySession = new CourseIdentitySession(f.root);
		for (const courseDir of [canonical, f.root]) {
			const admitted = await resolveCourseIdentity(courseDir, {
				lessonPaths: paths,
				identitySession,
			});
			expect(admitted.identity.course.courseId).toBe(f.initial.identity.course.courseId);
			identitySession.invalidate();
		}
	},
);

it("a retargeted or restored store junction refuses; a plain copy recovers", async () => {
	const f = await fixture();
	const original = join(f.root, "saved-store");
	const link = join(f.root, ".praxity");
	await rename(link, original);
	await symlink(original, link, "junction");
	const before = await projectDiskSnapshot(original);
	const refusal = {
		messageRef: { key: "desktop.identity.plainStoreRequired", args: { path: ".praxity" } },
	};
	await expect(
		resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession }),
	).rejects.toMatchObject(refusal);
	expect(await projectDiskSnapshot(original)).toEqual(before);
	const outside = await mkdtemp(join(tmpdir(), "identity-outside-"));
	roots.push(outside);
	await cp(original, outside, { recursive: true });
	const outsideBefore = await projectDiskSnapshot(outside);
	await rm(link);
	await symlink(outside, link, "junction");
	await expect(
		resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession }),
	).rejects.toMatchObject(refusal);
	expect(await projectDiskSnapshot(outside)).toEqual(outsideBefore);
	expect(f.identitySession.lessonReads().size).toBe(0);
	await rm(link);
	await symlink(original, link, "junction");
	await expect(
		resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession }),
	).rejects.toMatchObject(refusal);
	expect(await projectDiskSnapshot(original)).toEqual(before);
	await rm(link);
	await rename(original, link);
	const scoped = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		identitySession: f.identitySession,
	});
	const fresh = await resolveCourseIdentity(f.root, { lessonPaths: paths });
	expect(serializeIdentity(scoped.identity)).toBe(serializeIdentity(fresh.identity));
});

it("historical slug reservations remain enforced after retained admission", async () => {
	const f = await fixture();
	const page = Object.entries(f.initial.identity.snapshots[0].nodes).find(
		([, n]) => n.kind === "page",
	);
	if (!page) throw new Error("Missing fixture page");
	const renamed = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		slugRenames: { [page[0]]: "old-page" },
	});
	await writeIdentityFixture(f.root, renamed);
	await resolveCourseIdentity(f.root, { lessonPaths: paths, identitySession: f.identitySession });
	await writeFile(join(f.root, "b.prax"), `${beta}\n# Alpha\n\nAnother page.\n`);
	const scoped = await resolveCourseIdentity(f.root, {
		lessonPaths: paths,
		identitySession: f.identitySession,
	});
	expect(
		scoped.identity.snapshots
			.flatMap((s) => Object.values(s.nodes))
			.filter((n) => n.kind === "page" && n.slug === "alpha-2"),
	).toHaveLength(1);
	await expect(
		resolveCourseIdentity(f.root, {
			lessonPaths: paths,
			identitySession: f.identitySession,
			slugRenames: { [page[0]]: "beta" },
		}),
	).rejects.toThrow(/reserved/);
	expect(digest(await readFile(join(f.root, "a.prax"), "utf8"))).toBe(
		renamed.identity.snapshots[0].sourceHash,
	);
});
