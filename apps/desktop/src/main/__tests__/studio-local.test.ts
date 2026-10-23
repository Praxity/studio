import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import type { Draft } from "@praxity/editor-core/session";
import { parseFrontmatter } from "@praxity/grammar";
import { afterEach, expect, it, vi } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { buildCourseExportInput } from "../export/build-export-input-from-project";
import { resolveLessonSources } from "../lesson-source";
import { createStudioProjectSession } from "../studio/project-session";
import { type StudioServer, startStudioServer } from "../studio/server";

const roots: string[] = [];
const sessions: { close(): Promise<void> }[] = [];
const fault = vi.hoisted(() => ({
	outside: undefined as { path: string; text: string; reads: number } | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			const outside = fault.outside;
			if (outside && String(args[0]) === outside.path && ++outside.reads === 2) {
				fault.outside = undefined;
				await fs.writeFile(outside.path, outside.text);
			}
			return file;
		},
	};
});
const source =
	"---\ntitle: Lesson\n---\n\n# Safety\n\n::: note Exit {tone=info}\nKeep clear. Leave room for colleagues to reach the emergency door safely and follow the marked route to the nearest exit.\n:::\n\nOther paragraph.\n";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const git = promisify(execFile);
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "studio-local-"));
	roots.push(root);
	await writeFile(
		join(root, "course.yaml"),
		"# Course comment\ntitle: Course\nlessons: [lesson.prax]\n",
	);
	await writeFile(join(root, "lesson.prax"), source);
	await persistFixtureIdentity(root);
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const current = await resolveLessonSources(root);
	const mapping = current.identity.sourceMappings.find((node) =>
		source.slice(node.span.start, node.span.end).startsWith("::: note"),
	);
	if (!mapping) throw new Error("Missing fixture note");
	const text = source.slice(mapping.span.start, mapping.span.end);
	const draft: Draft = {
		id: "draft-1",
		file: "lesson.prax",
		target: {
			kind: "node",
			nodeId: mapping.id,
			path: mapping.path,
			fingerprint: mapping.fingerprint,
		},
		baseRevision: digest(source),
		expectedText: text,
		editableText: text.slice(0, text.lastIndexOf(":::")),
		baseText: text,
		text: "My unsaved text",
		selection: [2, 4],
		generation: 1,
		status: "held",
		diagnostics: [],
		changedAt: 10,
		validatedGeneration: 1,
		persistedGeneration: 1,
	};
	return { root, session, draft };
}
async function bytes(root: string, directory = root): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const full = join(directory, entry.name);
		if (entry.isDirectory()) Object.assign(result, await bytes(root, full));
		else if (entry.isFile())
			result[full.slice(root.length)] = (await readFile(full)).toString("base64");
	}
	return result;
}
afterEach(async () => {
	fault.outside = undefined;
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function rpc(server: StudioServer, method: string, args: unknown) {
	const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
	const response = await fetch(`${server.origin}/api/rpc`, {
		method: "POST",
		headers: {
			Origin: server.origin,
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ method, args }),
	});
	return { status: response.status, ...(await response.json()) };
}
it("D17 drafts and clipboard survive a restart on a different port", async () => {
	const { root, session, draft } = await fixture();
	await session.close();
	const editorAssetsDir = await mkdtemp(join(tmpdir(), "studio-local-ui-"));
	roots.push(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "index.html"), "<!doctype html><title>Test</title>");
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	const first = await startStudioServer({ projectDir: root, editorAssetsDir, appVersion: "test" });
	sessions.push(first);
	expect((await rpc(first, "draftPut", { draft })).status).toBe(200);
	const clipboard = {
		file: draft.file,
		nodeIds: [draft.target.kind === "node" ? draft.target.nodeId : randomUUID()],
		text: draft.expectedText,
	};
	expect((await rpc(first, "clipboardPut", { clipboard })).status).toBe(200);
	const before = await bytes(root);
	for (const path of [["design", "__proto__"], ["constructor"], ["design", "toString"]]) {
		expect(
			(
				await rpc(first, "manifestEdit", {
					file: "course.yaml",
					baseRevision: digest(""),
					path,
					value: "x",
				})
			).status,
		).toBe(400);
	}
	for (const method of ["draftList", "clipboardGet", "clipboardDiscard", "assetList"]) {
		expect((await rpc(first, method, JSON.parse('{"__proto__":{}}'))).status).toBe(400);
	}
	expect(await bytes(root)).toEqual(before);
	// Keep the old listener alive until the new one binds, so its port cannot be reused.
	const second = await startStudioServer({ projectDir: root, editorAssetsDir, appVersion: "test" });
	sessions.push(second);
	await first.close();
	expect(second.origin).not.toBe(first.origin);
	expect((await rpc(second, "draftList", {})).result).toEqual([draft]);
	expect((await rpc(second, "clipboardGet", {})).result).toEqual(clipboard);
	expect((await rpc(second, "draftResolve", { draft })).result.kind).toBe("unchanged");
	expect((await rpc(second, "draftDelete", { file: draft.file, id: draft.id })).status).toBe(200);
	expect((await rpc(second, "clipboardDiscard", {})).status).toBe(200);
	expect((await rpc(second, "draftList", {})).result).toEqual([]);
	expect((await rpc(second, "clipboardGet", {})).result).toBeNull();
}, 25_000);
it.each(["unrelated", "changed", "removed"])(
	"D11 resolves an %s outside edit without writing",
	async (kind) => {
		const { root, session, draft } = await fixture();
		const outside =
			kind === "unrelated"
				? source.replace("Other paragraph.", "Outside paragraph.")
				: kind === "changed"
					? source.replace("Keep clear.", "Outside note.")
					: source.replace(draft.expectedText, "");
		await writeFile(join(root, "lesson.prax"), outside);
		const before = await bytes(root);
		const result = await session.invoke("draftResolve", { draft });
		expect(result).toMatchObject({ kind: kind === "unrelated" ? "unchanged" : kind });
		if (kind !== "removed")
			expect(result).toMatchObject({
				seed: {
					baseRevision: digest(outside),
					expectedText:
						kind === "changed"
							? draft.expectedText.replace("Keep clear.", "Outside note.")
							: draft.expectedText,
				},
			});
		expect(await bytes(root)).toEqual(before);
		expect(draft.text).toBe("My unsaved text");
	},
);
it("manifestEdit refuses a stale revision and preserves comments on an admitted edit", async () => {
	const { root, session } = await fixture();
	const original = await readFile(join(root, "course.yaml"), "utf8");
	const input = {
		file: "course.yaml",
		baseRevision: digest(original),
		path: ["design", "colorAccent"],
		value: "#123456",
	};
	await writeFile(join(root, "course.yaml"), original.replace("Course\n", "Outside\n"));
	const before = await bytes(root);
	expect(await session.invoke("manifestEdit", input)).toMatchObject({ ok: false, code: "stale" });
	expect(await bytes(root)).toEqual(before);
	await writeFile(join(root, "course.yaml"), original);
	expect(await session.invoke("manifestEdit", input)).toMatchObject({ ok: true });
	expect(await readFile(join(root, "course.yaml"), "utf8")).toContain("# Course comment\n");
	expect(await readFile(join(root, "course.yaml"), "utf8")).toContain('colorAccent: "#123456"');
});
it("manifestEdit writes frontmatter design and identity together, retaining lesson body bytes", async () => {
	const { root, session } = await fixture();
	expect(
		await session.invoke("manifestEdit", {
			file: "lesson.prax",
			baseRevision: digest(source),
			path: ["design", "colorAccent"],
			value: "#123456",
		}),
	).toMatchObject({ ok: true });
	const saved = await readFile(join(root, "lesson.prax"), "utf8");
	expect(saved.slice(saved.indexOf("# Safety"))).toBe(source.slice(source.indexOf("# Safety")));
	const resolved = await resolveLessonSources(root, {}, { strict: true });
	expect(
		resolved.identity.snapshots.some((snapshot) => snapshot.sourceHash === digest(saved)),
	).toBe(true);
});

it("manifestEdit edits BOM-prefixed frontmatter once and retains its title and body", async () => {
	const { root, session } = await fixture();
	const original = `\uFEFF${source}`;
	await writeFile(join(root, "lesson.prax"), original);
	expect(
		await session.invoke("manifestEdit", {
			file: "lesson.prax",
			baseRevision: digest(original),
			path: ["design", "colorAccent"],
			value: "#123456",
		}),
	).toMatchObject({ ok: true });
	const saved = await readFile(join(root, "lesson.prax"), "utf8");
	expect(saved.charCodeAt(0)).toBe(0xfeff);
	expect(parseFrontmatter(saved).frontmatter.title).toBe("Lesson");
	expect(saved.slice(saved.indexOf("# Safety"))).toBe(source.slice(source.indexOf("# Safety")));
});

it("manifestEdit refuses unclosed frontmatter without changing any bytes", async () => {
	const { root, session } = await fixture();
	const original = "---\ntitle: Lesson\ndesign:\n  colorAccent: red\n\n# Safety\n";
	await writeFile(join(root, "lesson.prax"), original);
	const before = await bytes(root);
	expect(
		await session.invoke("manifestEdit", {
			file: "lesson.prax",
			baseRevision: digest(original),
			path: ["design", "colorAccent"],
			value: "blue",
		}),
	).toMatchObject({ ok: false, code: "invalid-args" });
	expect(await bytes(root)).toEqual(before);
});

it.each(["same-value", "absent-key"])("manifestEdit refuses an unapplied %s edit", async (kind) => {
	const { root, session } = await fixture();
	const original = await readFile(join(root, "course.yaml"), "utf8");
	const before = await bytes(root);
	expect(
		await session.invoke("manifestEdit", {
			file: "course.yaml",
			baseRevision: digest(original),
			path: kind === "same-value" ? ["title"] : ["design", "colorAccent"],
			value: kind === "same-value" ? "Course" : null,
		}),
	).toMatchObject({ ok: false, code: "not-allowed" });
	expect(await bytes(root)).toEqual(before);
});

it("manifestEdit changes only the course scalar bytes, retaining BOM, mixed endings and flow sequences", async () => {
	const { root, session } = await fixture();
	const original =
		"\uFEFFtitle: Course\r\nlessons: [lesson.prax]\ndesign:\r\n  colorAccent: red # author colour\n";
	await writeFile(join(root, "course.yaml"), original);
	expect(
		await session.invoke("manifestEdit", {
			file: "course.yaml",
			baseRevision: digest(original),
			path: ["design", "colorAccent"],
			value: "blue",
		}),
	).toMatchObject({ ok: true });
	expect(await readFile(join(root, "course.yaml"))).toEqual(
		Buffer.from(original.replace("red #", "blue #")),
	);
});

it.each([1, 7])("two windows refuse draft generation %s after generation 7", async (generation) => {
	const { root, session, draft } = await fixture();
	const saved = { ...draft, generation: 7, text: "Window A unsaved work" };
	await session.invoke("draftPut", { draft: saved });
	const second = await createStudioProjectSession(root, "test");
	sessions.push(second);
	const before = await bytes(root);
	expect(
		await second.invoke("draftPut", {
			draft: { ...draft, generation, text: "Window B unsaved work" },
		}),
	).toMatchObject({ ok: false, code: "stale", message: { key: "op.stale" } });
	expect(await session.invoke("draftList", {})).toEqual([saved]);
	expect(await bytes(root)).toEqual(before);
});

it("D3 exact draft retries succeed without changing durable bytes", async () => {
	const { root, session, draft } = await fixture();
	expect(await session.invoke("draftPut", { draft })).toMatchObject({ ok: true });
	const before = await bytes(root);
	expect(await session.invoke("draftPut", { draft })).toMatchObject({ ok: true });
	expect(await bytes(root)).toEqual(before);
	const second = await createStudioProjectSession(root, "test");
	sessions.push(second);
	expect(
		await second.invoke("draftPut", { draft: { ...draft, persistedGeneration: -1 } }),
	).toMatchObject({ ok: true });
	expect(await bytes(root)).toEqual(before);
});

it("D9 D17 guarded held metadata survives restart at the same text generation", async () => {
	const { root, session, draft } = await fixture();
	const dirty = { ...draft, text: "New", status: "dirty", persistenceVersion: 0 };
	expect(await session.invoke("draftPut", { draft: dirty })).toMatchObject({ ok: true });
	const held = { ...dirty, status: "held", persistenceVersion: 1, persistedVersion: 0 };
	expect(await session.invoke("draftPut", { draft: held, expectedVersion: 0 })).toMatchObject({
		ok: true,
	});
	const second = await createStudioProjectSession(root, "test");
	sessions.push(second);
	expect(await second.invoke("draftList", {})).toEqual([held]);
	const before = await bytes(root);
	expect(await second.invoke("draftPut", { draft: held, expectedVersion: 0 })).toMatchObject({
		ok: true,
	});
	expect(await bytes(root)).toEqual(before);
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(source);
});

it("D11 stale metadata guards and equal-generation changed text preserve the winning window", async () => {
	const { root, session, draft } = await fixture();
	const dirty = { ...draft, text: "New", status: "dirty", persistenceVersion: 0 };
	await session.invoke("draftPut", { draft: dirty });
	const second = await createStudioProjectSession(root, "test");
	sessions.push(second);
	const held = { ...dirty, status: "held", persistenceVersion: 1 };
	expect(await session.invoke("draftPut", { draft: held, expectedVersion: 0 })).toMatchObject({
		ok: true,
	});
	const before = await bytes(root);
	for (const request of [
		{ draft: { ...dirty, status: "conflict", persistenceVersion: 1 }, expectedVersion: 0 },
		{ draft: { ...dirty, status: "conflict", persistenceVersion: 2 }, expectedVersion: 0 },
		{ draft: { ...held, text: "Other window", persistenceVersion: 2 }, expectedVersion: 1 },
		{ draft: { ...held, status: "conflict", persistenceVersion: 2 } },
		{ draft: { ...dirty, generation: 0, persistenceVersion: 100 }, expectedVersion: 1 },
	]) {
		expect(await second.invoke("draftPut", request)).toMatchObject({ ok: false, code: "stale" });
	}
	expect(await second.invoke("draftList", {})).toEqual([held]);
	expect(await bytes(root)).toEqual(before);
});

it("D3 draft versions refuse invalid counters before changing stored bytes", async () => {
	const { root, session, draft } = await fixture();
	await session.invoke("draftPut", { draft });
	const before = await bytes(root);
	for (const request of [
		{ draft: { ...draft, persistenceVersion: -1 } },
		{ draft: { ...draft, persistenceVersion: Number.MAX_SAFE_INTEGER + 1 } },
		{ draft: { ...draft, persistedVersion: -2 } },
		{ draft: { ...draft, persistedVersion: 0.5 } },
		{ draft, expectedVersion: -2 },
		{ draft, expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
	])
		await expect(session.invoke("draftPut", request)).rejects.toMatchObject({ name: "ZodError" });
	expect(await bytes(root)).toEqual(before);
});

it("two windows refuse a node-to-insertion draft ID collision and retain the owner's bytes", async () => {
	const { root, session, draft } = await fixture();
	await session.invoke("draftPut", { draft });
	const second = await createStudioProjectSession(root, "test");
	sessions.push(second);
	const before = await bytes(root);
	expect(
		await second.invoke("draftPut", {
			draft: {
				...draft,
				generation: 2,
				text: "Window B new paragraph",
				target: { kind: "insertion", parentId: null, after: randomUUID(), before: null },
			},
		}),
	).toMatchObject({ ok: false, code: "conflict", message: { key: "op.conflict" } });
	expect(await session.invoke("draftList", {})).toEqual([draft]);
	expect(await bytes(root)).toEqual(before);
});

it.each(["id-free-node", "insertion", "scope"])(
	"draftPut refuses a changed %s owner",
	async (kind) => {
		const { root, session, draft } = await fixture();
		const target =
			kind === "insertion"
				? { kind: "insertion" as const, parentId: null, after: randomUUID(), before: null }
				: { kind: "node" as const, nodeId: null, path: [0, 0], fingerprint: digest("owner") };
		const saved = { ...draft, target };
		await session.invoke("draftPut", { draft: saved });
		const other =
			kind === "scope"
				? { ...saved, scope: "file" as const }
				: {
						...saved,
						target:
							target.kind === "insertion"
								? { ...target, before: randomUUID() }
								: { ...target, fingerprint: digest("different-owner") },
					};
		const before = await bytes(root);
		expect(await session.invoke("draftPut", { draft: { ...other, generation: 2 } })).toMatchObject({
			ok: false,
			code: "conflict",
		});
		expect(await session.invoke("draftList", {})).toEqual([saved]);
		expect(await bytes(root)).toEqual(before);
	},
);

it("draftPut accepts a higher generation for the same identified node after it moves", async () => {
	const { session, draft } = await fixture();
	expect(await session.invoke("draftPut", { draft })).toMatchObject({ ok: true });
	if (draft.target.kind !== "node") throw new Error("Fixture needs a node draft");
	const updated = {
		...draft,
		generation: 2,
		text: "Newer work",
		target: {
			...draft.target,
			path: [9, 2],
			fingerprint: digest("changed-node"),
		},
	};
	expect(await session.invoke("draftPut", { draft: updated })).toMatchObject({ ok: true });
	expect(await session.invoke("draftList", {})).toEqual([updated]);
}, 15_000);

it("manifestEdit returns a conflict when an outside writer changes the lesson after revision checking", async () => {
	const { root, session } = await fixture();
	const outside = source.replace("Other paragraph.", "Outside writer paragraph.");
	const before = await bytes(root, join(root, ".praxity", "identity"));
	fault.outside = { path: join(root, "lesson.prax"), text: outside, reads: 0 };
	expect(
		await session.invoke("manifestEdit", {
			file: "lesson.prax",
			baseRevision: digest(source),
			path: ["design", "colorAccent"],
			value: "#123456",
		}),
	).toMatchObject({ ok: false, code: "conflict" });
	expect(fault.outside).toBeUndefined();
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(outside);
	expect(await bytes(root, join(root, ".praxity", "identity"))).toEqual(before);
});

it("manifestEdit keeps a revision conflict ahead of retirement review when an outside writer deletes content", async () => {
	const { root, session } = await fixture();
	const outside = "# Safety\n\nReplacement from another writer.\n";
	const before = await bytes(root, join(root, ".praxity", "identity"));
	fault.outside = { path: join(root, "lesson.prax"), text: outside, reads: 0 };
	expect(
		await session.invoke("manifestEdit", {
			file: "lesson.prax",
			baseRevision: digest(source),
			path: ["design", "colorAccent"],
			value: "#123456",
		}),
	).toMatchObject({ ok: false, code: "conflict" });
	expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(outside);
	expect(await bytes(root, join(root, ".praxity", "identity"))).toEqual(before);
});
it.each(["__proto__", "constructor", "toString"])(
	"manifest and draft RPC reject prototype name %s cleanly",
	async (name) => {
		const { root, session, draft } = await fixture();
		const before = await bytes(root);
		await expect(
			session.invoke("manifestEdit", {
				file: "course.yaml",
				baseRevision: digest(""),
				path: ["design", name],
				value: "x",
			}),
		).rejects.toMatchObject({ name: "ZodError" });
		await expect(
			session.invoke("draftPut", { draft: { ...draft, id: name } }),
		).rejects.toMatchObject({ name: "ZodError" });
		expect(await bytes(root)).toEqual(before);
	},
);
it("assetList lists nested files and refuses symlinks leaving the root", async () => {
	const { root, session } = await fixture();
	await mkdir(join(root, "assets", "nested"), { recursive: true });
	await writeFile(join(root, "assets", "one.png"), "image");
	await writeFile(join(root, "assets", "nested", "two.mp3"), "audio");
	expect(await session.invoke("assetList", {})).toEqual([
		"assets/nested/two.mp3",
		"assets/one.png",
	]);
	const outside = await mkdtemp(join(tmpdir(), "studio-assets-outside-"));
	roots.push(outside);
	await symlink(outside, join(root, "assets", "escape"), "junction");
	await expect(session.invoke("assetList", {})).rejects.toThrow("Path traversal blocked");
});

it("per-lesson draft buckets retain siblings and survive removal of the lesson", async () => {
	const { root, session, draft } = await fixture();
	const second = { ...draft, id: "draft-2", text: "Second draft" };
	await session.invoke("draftPut", { draft });
	await session.invoke("draftPut", { draft: second });
	expect(await session.invoke("draftList", {})).toEqual([draft, second]);
	const files = await readdir(join(root, ".praxity", "local", "drafts"));
	expect(files).toHaveLength(1);
	expect(files[0]).toMatch(/^file-[a-f0-9]{64}\.json$/u);
	await session.invoke("draftDelete", { file: draft.file, id: draft.id });
	expect(await session.invoke("draftList", {})).toEqual([second]);
	await rm(join(root, "lesson.prax"));
	const edited = { ...second, text: "Still editable", generation: 2 };
	expect(await session.invoke("draftPut", { draft: edited })).toMatchObject({ ok: true });
	expect(await session.invoke("draftList", {})).toEqual([edited]);
	expect(await session.invoke("draftResolve", { draft: second })).toEqual({ kind: "removed" });
	await session.invoke("draftDelete", { file: second.file, id: second.id });
	expect(await session.invoke("draftList", {})).toEqual([]);
}, 30_000);

it("draft and clipboard persistence are gitignored inside an author's own project", async () => {
	const { root, session, draft } = await fixture();
	await git("git", ["init", "--quiet", root]);
	await session.invoke("draftPut", { draft });
	await session.invoke("clipboardPut", {
		clipboard: { file: draft.file, text: draft.expectedText, nodeIds: [randomUUID()] },
	});
	const paths = [
		".praxity/local/clipboard.json",
		".praxity/local/drafts/future.json",
		".praxity/local/future.txt",
	];
	const { stdout } = await git("git", ["-C", root, "check-ignore", "--no-index", ...paths]);
	expect(stdout.trim().split(/\r?\n/u)).toEqual(paths);
	const { stdout: status } = await git("git", [
		"-C",
		root,
		"status",
		"--porcelain",
		"--untracked-files=all",
	]);
	expect(status).not.toContain(".praxity/local/");
}, 20_000);

it.each(["lesson", "target"])(
	"refuses a draft ID collision across %s owners without replacing either author's text",
	async (owner) => {
		const { root, session, draft } = await fixture();
		await session.invoke("draftPut", { draft });
		await writeFile(join(root, "second.prax"), source);
		const before = await bytes(root);
		const other = {
			...draft,
			text: "Another author's draft",
			...(owner === "lesson"
				? { file: "second.prax" }
				: {
						target: {
							...draft.target,
							kind: "node" as const,
							nodeId: randomUUID(),
							path: [0, 1],
							fingerprint: digest("other"),
						},
					}),
		};
		expect(await session.invoke("draftPut", { draft: other })).toMatchObject({
			ok: false,
			code: "conflict",
			message: { key: "op.conflict", params: {} },
		});
		expect(await session.invoke("draftList", {})).toEqual([draft]);
		expect(await bytes(root)).toEqual(before);
	},
);

it("refuses corrupt local records and local symlink parents instead of returning empty success", async () => {
	const { root, session, draft } = await fixture();
	await session.invoke("draftPut", { draft });
	const dir = join(root, ".praxity", "local", "drafts");
	const [filename] = await readdir(dir);
	await writeFile(join(dir, filename), '{"schema":2}');
	await expect(session.invoke("draftList", {})).rejects.toMatchObject({ name: "ZodError" });
	await expect(session.invoke("draftPut", { draft })).rejects.toMatchObject({ name: "ZodError" });
	await expect(
		session.invoke("draftDelete", { file: draft.file, id: draft.id }),
	).rejects.toMatchObject({ name: "ZodError" });
	await rm(join(root, ".praxity", "local"), { recursive: true });
	const outside = await mkdtemp(join(tmpdir(), "studio-local-outside-"));
	roots.push(outside);
	await symlink(outside, join(root, ".praxity", "local"), "junction");
	for (const [method, args] of [
		["draftList", {}],
		["draftPut", { draft }],
		["clipboardGet", {}],
		["clipboardDiscard", {}],
	] as const) {
		await expect(session.invoke(method, args)).rejects.toThrow(
			"Local editor paths cannot be symbolic links",
		);
	}
	expect(await readdir(outside)).toEqual([]);
});

it("strict local schemas refuse extra keys and non-project lesson paths before writing", async () => {
	const { root, session, draft } = await fixture();
	const before = await bytes(root);
	for (const file of [
		"../outside.prax",
		"/outside.prax",
		win32.resolve("Q:", "/outside.prax"),
		"\\\\server\\course\\lesson.prax",
		"lesson.prax:stream",
		"LESSON.PRAX",
	]) {
		await expect(session.invoke("draftPut", { draft: { ...draft, file } })).rejects.toBeInstanceOf(
			Error,
		);
	}
	for (const [method, args] of [
		["draftPut", { draft: { ...draft, extra: true } }],
		["draftDelete", { file: draft.file, id: draft.id, extra: true }],
		[
			"clipboardPut",
			{ clipboard: { file: draft.file, text: "text", nodeIds: [randomUUID()], extra: true } },
		],
		[
			"manifestEdit",
			{
				file: "course.yaml",
				path: ["title"],
				value: "Title",
				baseRevision: digest(""),
				extra: true,
			},
		],
	] as const) {
		await expect(session.invoke(method, args)).rejects.toMatchObject({ name: "ZodError" });
	}
	expect(await bytes(root)).toEqual(before);
});
it(".praxity/local never enters an export, including an asset alias", async () => {
	const { root, session, draft } = await fixture();
	await session.invoke("draftPut", { draft });
	const versionPath = join(root, "viewer.version.json");
	await writeFile(versionPath, '{"viewerSourceHash":"test"}');
	const options = {
		projectDir: root,
		completionThreshold: 0.8,
		viewerVersionPath: versionPath,
		manifestPolicy: "read-only" as const,
		inheritWorkspaceSettings: false,
	};
	const input = await buildCourseExportInput(options);
	expect([...(input.resolvedAssets ?? new Map()).keys()]).toEqual([]);
	expect(JSON.stringify(input.blocks)).not.toContain(draft.text);
	await mkdir(join(root, "assets"));
	await symlink(join(root, ".praxity", "local"), join(root, "assets", "local-alias"), "junction");
	await expect(buildCourseExportInput(options)).rejects.toMatchObject({
		code: "asset-internal-refused",
	});
});

it.each(["list", "export"])(
	"%s refuses local data whose canonical directory moved into assets",
	async (operation) => {
		const { root, session, draft } = await fixture();
		await session.invoke("draftPut", { draft });
		await mkdir(join(root, "assets"));
		await rename(join(root, ".praxity", "local"), join(root, "assets", "private"));
		await symlink(join(root, "assets", "private"), join(root, ".praxity", "local"), "junction");
		const versionPath = join(root, "viewer.version.json");
		await writeFile(versionPath, '{"viewerSourceHash":"test"}');
		const result =
			operation === "list"
				? session.invoke("assetList", {})
				: buildCourseExportInput({
						projectDir: root,
						completionThreshold: 0.8,
						viewerVersionPath: versionPath,
						manifestPolicy: "read-only",
						inheritWorkspaceSettings: false,
					});
		await expect(result).rejects.toMatchObject({ code: "asset-internal-refused" });
	},
);
