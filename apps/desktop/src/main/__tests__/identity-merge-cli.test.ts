import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFile,
	cp,
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeIdentity } from "@praxity/content-identity";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { writeIdentityFixture } from "../../test-utils/identity-fixture";
import { runPraxityCli } from "../cli";
import { loadIdentityStore, resolveCourseIdentity } from "../identity-store";

const roots: string[] = [];
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const source =
	"# Safety\n\nKeep a clear path to every emergency exit.\n\n# Practice\n\nCheck every emergency exit before starting work.\n";
const hidden = "SC_en_HIDDEN_MODEL_UNIQUE";
const initial = `# Practice\n\n::: accordion Public panel\n:: Item\n::: self-check Write your answer.\nmodel: ${hidden}\n:: Secret criterion\nmissed: Secret hint.\n:::\n:::\n`;
const templateRoots: string[] = [];
const templates = new Map<string, Awaited<ReturnType<typeof fixture>>>();
afterAll(async () => {
	await Promise.all(templateRoots.map((root) => rm(root, { recursive: true, force: true })));
});
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function files(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await files(root, path));
		else result[path] = (await readFile(join(root, path))).toString("base64");
	}
	return result;
}

async function fixture(crlf = false, initialSource = source, template = false) {
	const root = await mkdtemp(join(tmpdir(), "i3b cli "));
	(template ? templateRoots : roots).push(root);
	const course = join(root, "course with spaces");
	const text = crlf ? initialSource.replaceAll("\n", "\r\n") : initialSource;
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
	const commit = () => {
		git(
			"add",
			"--",
			"course with spaces/course.yaml",
			"course with spaces/*.prax",
			"course with spaces/.praxity/identity",
		);
		git("commit", "-m", "Fixture revision");
	};
	let base: Awaited<ReturnType<typeof resolveCourseIdentity>>;
	if (template) {
		await mkdir(course);
		git("init", "-b", "base");
		// Keep byte snapshots free of fsmonitor sockets and detached object maintenance.
		await appendFile(
			join(root, ".git/config"),
			"\n[user]\nname = Identity merge fixture\nemail = fixture@example.invalid\n[core]\nautocrlf = false\nfsmonitor = false\n[gc]\nauto = 0\n[maintenance]\nauto = false\n",
		);
		await writeFile(join(course, "course.yaml"), "title: Safety\nlessons: [lesson.prax]\n");
		await writeFile(join(course, "lesson.prax"), text);
		base = await resolveCourseIdentity(course, { lessonPaths: ["lesson.prax"] });
		await writeIdentityFixture(course, base);
		commit();
	} else {
		const key = JSON.stringify([crlf, initialSource]);
		let saved = templates.get(key);
		if (!saved) {
			saved = await fixture(crlf, initialSource, true);
			templates.set(key, saved);
		}
		await cp(saved.root, root, { recursive: true });
		base = saved.base;
	}
	const branch = async (name: string, next: string, path = "lesson.prax") => {
		git("checkout", "-b", name, "base");
		if (path !== "lesson.prax") {
			await rename(join(course, "lesson.prax"), join(course, path));
			await writeFile(
				join(course, "course.yaml"),
				`title: Safety\nlessons: [${JSON.stringify(path)}]\n`,
			);
		}
		await writeFile(join(course, path), next);
		// Branch edits carry the author's modify intent, so identity retention does
		// not depend on the external-edit matcher's lexical threshold.
		const result =
			path !== "lesson.prax"
				? await resolveCourseIdentity(course, { lessonPaths: [path] })
				: await resolveCourseIdentity(course, {
						lessonPaths: [path],
						operations: [
							{
								intent: "modify",
								files: [
									{
										path,
										fromRevision: base.identity.snapshots[0].sourceHash,
										toRevision: createHash("sha256").update(next).digest("hex"),
										fromSnapshot: base.identity.heads[0].head,
									},
								],
								mapping: base.identity.sourceMappings.map((m) => ({
									oldId: m.id,
									newId: m.id,
									fate: "kept",
								})),
								placements: base.identity.sourceMappings.map((m, mappingIndex) => ({
									file: path,
									path: m.path,
									mappingIndex,
								})),
							},
						],
					});
		await writeIdentityFixture(course, result);
		commit();
		return result;
	};
	const merge = () => {
		git("checkout", "ours");
		expect(() => git("merge", "--no-commit", "theirs")).toThrow();
		expect(git("rev-parse", "MERGE_HEAD")).toMatch(/^[a-f0-9]{40}$/);
	};
	return { root, course, text, git, base, branch, merge };
}

describe("identity merge CLI on real git repositories", { timeout: 60_000 }, () => {
	describe("discarded records", () => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		beforeAll(async () => {
			f = await fixture();
			const id = "00000000-0000-4000-8000-000000000001";
			for (const name of ["ours", "theirs"]) {
				const result = await f.branch(name, f.text.replace("clear path", `${name} path`));
				const snapshot = result.identity.snapshots[0];
				const paragraph = Object.values(snapshot.nodes).find((node) => node.kind === "block");
				if (!paragraph) throw new Error("Missing fixture paragraph");
				const canonical = JSON.stringify(`Discarded copy ${name}.`);
				snapshot.nodes[id] = {
					...paragraph,
					status: "retired",
					canonical,
					fingerprint: createHash("sha256").update(canonical).digest("hex"),
					label: `Discarded copy ${name}.`,
				};
				result.identity.heads[0].head = createHash("sha256")
					.update(serializeIdentity(snapshot))
					.digest("hex");
				await writeIdentityFixture(f.course, result);
				f.git("add", "--", "course with spaces/.praxity/identity");
				f.git("commit", "-m", "Retain discarded fixture record");
			}
			f.merge();
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it("describes discarded provisional records as additions rather than deletions", async () => {
			expect(result.exitCode, result.stderr).toBe(3);
			expect(result.stderr).toContain('added body "Discarded copy ours." [lesson.prax]');
			expect(result.stderr).toContain('added body "Discarded copy theirs." [lesson.prax]');
			expect(result.stderr).toContain('ajout de body "Discarded copy ours." [lesson.prax]');
			expect(result.stderr).not.toContain('deleted body "Discarded copy');
		});
	});
	describe("plain-store refusal", () => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		let before: Awaited<ReturnType<typeof files>>;
		beforeAll(async () => {
			f = await fixture();
			await f.branch("ours", f.text.replace("clear path", "clean path"));
			await f.branch("theirs", f.text.replace("before starting", "before beginning"));
			f.merge();
			await writeFile(
				join(f.course, "lesson.prax"),
				f.text.replace("clear path", "clean path").replace("before starting", "before beginning"),
			);
			// Merge admission sees the alias before parsing the working conflicted identity records.
			await link(
				join(f.course, ".praxity/identity/course.json"),
				join(f.course, "course-alias.json"),
			);
			before = await files(f.course);
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it("explains a plain-store refusal in both languages without changing merge bytes", async () => {
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe("EIDENTITY");
			expect(result.stderr).toContain("Studio needs a plain copy of .praxity/identity/course.json");
			expect(result.stderr).toContain(
				"Studio a besoin d'une copie ordinaire de .praxity/identity/course.json",
			);
			expect(result.stderr).toContain("cp -R -L");
			expect(result.stderr).toContain("Copy-Item -LiteralPath");
			expect(await files(f.course)).toEqual(before);
		});
	});
	describe.each([false, true])("disjoint edits, CRLF=%s", (crlf) => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let ours: Awaited<ReturnType<typeof resolveCourseIdentity>>;
		let theirs: Awaited<ReturnType<typeof resolveCourseIdentity>>;
		let merged: string;
		let index: Buffer;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		beforeAll(async () => {
			f = await fixture(crlf);
			ours = await f.branch("ours", f.text.replace("clear path", "clean path"));
			theirs = await f.branch("theirs", f.text.replace("before starting", "before beginning"));
			f.merge();
			merged = f.text
				.replace("clear path", "clean path")
				.replace("before starting", "before beginning");
			await writeFile(join(f.course, "lesson.prax"), merged);
			index = await readFile(join(f.root, ".git/index"));
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it(`merges disjoint edits with stable IDs and exact source bytes, CRLF=${crlf}`, async () => {
			expect(result.exitCode, result.stderr).toBe(0);
			const resolved = await resolveCourseIdentity(f.course, { lessonPaths: ["lesson.prax"] });
			expect(resolved.identity.unresolved).toEqual([]);
			expect(resolved.identity.sourceMappings.map((m) => m.id)).toEqual(
				f.base.identity.sourceMappings.map((m) => m.id),
			);
			const stored = await loadIdentityStore(f.course);
			expect(stored.snapshots[0].parents).toEqual(
				[ours.identity.heads[0].head, theirs.identity.heads[0].head].sort(),
			);
			expect(await readFile(join(f.course, "lesson.prax"), "utf8")).toBe(merged);
			expect(await readFile(join(f.root, ".git/index"))).toEqual(index);
			expect(f.git("rev-parse", "MERGE_HEAD")).toMatch(/^[a-f0-9]{40}$/);
		});
	});

	describe.each(["container", "criterion"])("public labels for %s", (kind) => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		const before = kind === "container" ? "Public panel" : "Secret criterion";
		beforeAll(async () => {
			f = await fixture(false, initial);
			await f.branch("ours", initial.replace(before, `${before} ours`));
			await f.branch("theirs", initial.replace(before, `${before} theirs`));
			f.merge();
			await writeFile(join(f.course, "lesson.prax"), initial.replace(before, `${before} ours`));
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it(`merge conflict uses public labels for ${kind}`, async () => {
			expect(result.exitCode, result.stderr).toBe(3);
			expect(result.stderr).not.toContain(hidden);
			expect(result.stderr).not.toContain("Secret criterion");
			if (kind === "container") expect(result.stderr).toContain("Public panel ours");
		});
	});

	describe("same-block changes", () => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		let before: Awaited<ReturnType<typeof files>>;
		beforeAll(async () => {
			f = await fixture();
			await f.branch("ours", f.text.replace("clear path", "clean path"));
			await f.branch("theirs", f.text.replace("clear path", "wide path"));
			f.merge();
			await writeFile(join(f.course, "lesson.prax"), f.text.replace("clear path", "clean path"));
			before = await files(f.root);
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it("reports same-block changes in English and French, leaving every file unchanged", async () => {
			expect(result.exitCode, result.stderr).toBe(3);
			expect(result.stderr).toContain('page "Safety"');
			expect(result.stderr).toContain("lesson.prax");
			expect(result.stderr).toContain("block");
			expect(result.stderr).toContain("bloc");
			expect(result.stderr).toContain("clean path");
			expect(result.stderr).toContain("wide path");
			expect(await files(f.root)).toEqual(before);
		});
	});

	describe("renamed lesson", () => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		beforeAll(async () => {
			f = await fixture();
			await f.branch("ours", f.text, "renamed lesson.prax");
			await f.branch("theirs", f.text.replace("clear path", "clean path"));
			f.merge();
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it("preserves IDs when one branch renames a lesson and the other edits it", async () => {
			expect(result.exitCode, result.stderr).toBe(0);
			const resolved = await resolveCourseIdentity(f.course, {
				lessonPaths: ["renamed lesson.prax"],
			});
			expect(resolved.identity.unresolved).toEqual([]);
			expect(resolved.identity.sourceMappings.map((m) => m.id)).toEqual(
				f.base.identity.sourceMappings.map((m) => m.id),
			);
			expect(await readFile(join(f.course, "renamed lesson.prax"), "utf8")).toContain("clean path");
		});
	});

	describe("independent additions", () => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		let before: Awaited<ReturnType<typeof files>>;
		beforeAll(async () => {
			f = await fixture();
			const added = `${f.text}\nA shared addition has independently allocated identity.\n`;
			await f.branch("ours", added);
			await f.branch("theirs", added);
			f.merge();
			before = await files(f.root);
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it("reports competing UUIDs for the same added entity without writing", async () => {
			expect(result.exitCode, result.stderr).toBe(3);
			expect(result.stderr).toContain("Two UUIDs");
			expect(result.stderr).toContain("Deux UUID");
			expect(await files(f.root)).toEqual(before);
		});
	});

	it("refuses outside a merge without changing any file", async () => {
		const f = await fixture();
		const before = await files(f.root);
		const result = await runPraxityCli(["identity", "merge", f.course], runtime);
		expect(result.exitCode, result.stderr).toBe(1);
		expect(result.stderr).toContain("No git merge is in progress");
		expect(result.stderr).toContain("Aucune fusion git");
		expect(await files(f.root)).toEqual(before);
	});

	describe("several merge heads", () => {
		let f: Awaited<ReturnType<typeof fixture>>;
		let result: Awaited<ReturnType<typeof runPraxityCli>>;
		let before: Awaited<ReturnType<typeof files>>;
		beforeAll(async () => {
			f = await fixture();
			await f.branch("ours", f.text.replace("clear path", "clean path"));
			await f.branch("theirs", f.text.replace("before starting", "before beginning"));
			f.merge();
			await writeFile(
				join(f.course, "lesson.prax"),
				f.text.replace("clear path", "clean path").replace("before starting", "before beginning"),
			);
			await writeFile(
				join(f.root, ".git/MERGE_HEAD"),
				`${f.git("rev-parse", "theirs")}\n${f.git("rev-parse", "base")}\n`,
			);
			before = await files(f.root);
			result = await runPraxityCli(["identity", "merge", f.course], runtime);
		});
		it("refuses several MERGE_HEAD entries without changing any file", async () => {
			expect(result.exitCode, result.stderr).toBe(1);
			expect(result.stderr).toContain("Several merge heads");
			expect(await files(f.root)).toEqual(before);
		});
	});

	describe.each(["conflict markers", "invalid UTF-8", "corrupt snapshot", "unexpected head"])(
		"refuses %s without writing",
		(damage) => {
			let f: Awaited<ReturnType<typeof fixture>>;
			let result: Awaited<ReturnType<typeof runPraxityCli>>;
			let before: Awaited<ReturnType<typeof files>>;
			beforeAll(async () => {
				f = await fixture();
				await f.branch("ours", f.text.replace("clear path", "clean path"));
				await f.branch("theirs", f.text.replace("before starting", "before beginning"));
				f.merge();
				if (damage === "conflict markers")
					await writeFile(
						join(f.course, "lesson.prax"),
						`${f.text}\n<<<<<<< ours\nOurs\n=======\nTheirs\n>>>>>>> theirs\n`,
					);
				else if (damage === "invalid UTF-8")
					await writeFile(join(f.course, "lesson.prax"), Buffer.from([0xff, 0xfe]));
				else if (damage === "unexpected head") {
					await writeFile(
						join(f.course, ".praxity/identity/lessons/unexpected.json"),
						"Uncommitted head must survive refusal",
					);
					await writeFile(
						join(f.course, "lesson.prax"),
						f.text
							.replace("clear path", "clean path")
							.replace("before starting", "before beginning"),
					);
				} else {
					const snapshot = (await readdir(join(f.course, ".praxity/identity/snapshots")))[0];
					await writeFile(
						join(f.course, `.praxity/identity/snapshots/${snapshot}`),
						"corrupt snapshot",
					);
					await writeFile(
						join(f.course, "lesson.prax"),
						f.text
							.replace("clear path", "clean path")
							.replace("before starting", "before beginning"),
					);
				}
				before = await files(f.root);
				result = await runPraxityCli(["identity", "merge", f.course], runtime);
			});
			it(`refuses ${damage} without writing`, async () => {
				expect(result.exitCode, result.stderr).toBe(damage === "conflict markers" ? 3 : 1);
				expect(await files(f.root)).toEqual(before);
			});
		},
	);

	it("advertises the optional course and refuses unknown identity commands", async () => {
		expect((await runPraxityCli(["--help"], runtime)).stdout).toContain(
			"identity merge [<course>]",
		);
		expect((await runPraxityCli(["identity", "other"], runtime)).exitCode).toBe(2);
	});
});
