import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft } from "@praxity/editor-core/session";
import { afterEach, expect, it, vi } from "vitest";
import { LocalEditorStore } from "../operations/local-editor-store";
import { createStudioProjectSession } from "../studio/project-session";
import { type StudioServer, startStudioServer } from "../studio/server";

const fault = vi.hoisted(() => ({
	cleanup: false,
	code: undefined as string | undefined,
	rollbackPath: undefined as string | undefined,
}));
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return {
		...fs,
		lstat: async (...args: Parameters<typeof fs.lstat>) => {
			if (fault.code) {
				const code = fault.code;
				fault.code = undefined;
				throw Object.assign(new Error("Injected no-write admission failure"), { code });
			}
			return fs.lstat(...args);
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			if (fault.rollbackPath && String(args[1]).endsWith("installed-0")) {
				const path = fault.rollbackPath;
				fault.rollbackPath = undefined;
				await fs.writeFile(path, "Outside writer");
				throw Object.assign(new Error("Injected write failure after installation"), {
					code: "EFILEBUSY",
				});
			}
			return fs.rename(...args);
		},
		unlink: async (...args: Parameters<typeof fs.unlink>) => {
			if (fault.cleanup && String(args[0]).endsWith("journal.retired")) {
				fault.rollbackPath = undefined;
				fault.cleanup = false;
				throw new Error("Injected draft cleanup failure");
			}
			return fs.unlink(...args);
		},
	};
});
const roots: string[] = [];
const sessions: { close(): Promise<void> }[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	fault.cleanup = false;
	fault.code = undefined;
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

it.each(["put", "remove"])(
	"D3 non-directory draft storage refuses %s without changing bytes",
	async (action) => {
		const { root, store } = await fixture();
		await mkdir(join(root, ".praxity/local"), { recursive: true });
		const path = join(root, ".praxity/local/drafts");
		await writeFile(path, "retained bytes");
		expect(
			await store.draftPersist(
				action === "put" ? { action, draft } : { action, file: "a.prax", id: draft.id },
			),
		).toMatchObject({ status: "refused", reason: "unsafe-path" });
		expect(await readFile(path, "utf8")).toBe("retained bytes");
	},
);
it.each(["EFILEBUSY", "EPROJECTBUSY", "EPERM", "ENOSPC", "ECONFLICT"])(
	"D3 rollback conflict takes priority over original %s",
	async (code) => {
		const { store } = await fixture();
		vi.spyOn(store, "draftPut").mockRejectedValueOnce(
			Object.assign(
				new Error(
					"File changed on disk: project rollback conflict: draft.json. Recovery copies retained",
				),
				{ code },
			),
		);
		expect(await store.draftPersist({ action: "put", draft })).toMatchObject({
			status: "unknown",
			code: "EPROJECTRECOVERY",
		});
	},
);
const draft: Draft = {
	id: "author-draft",
	file: "a.prax",
	target: { kind: "node", nodeId: null, path: [0], fingerprint: "a".repeat(64) },
	baseRevision: "b".repeat(64),
	expectedText: "Original",
	editableText: "Original",
	baseText: "Original",
	text: "Author text",
	selection: [2, 2],
	generation: 2,
	status: "held",
	diagnostics: [],
	changedAt: 10,
	validatedGeneration: 2,
	persistedGeneration: -1,
	persistenceVersion: 1,
	persistedVersion: -1,
};
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "draft-outcome-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), "# First\n\nOriginal\n");
	return { root, store: new LocalEditorStore(root) };
}
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
it("D3 typed seam retains stored version facts for a missing metadata prerequisite", async () => {
	const { store } = await fixture();
	await store.draftPut({ draft });
	expect(
		await store.draftPersist({
			action: "put",
			draft: { ...draft, selection: [4, 4], persistenceVersion: 3 },
			expectedVersion: 2,
		}),
	).toMatchObject({
		status: "refused",
		code: "stale",
		reason: "metadata-conflict",
		stored: { text: "Author text", generation: 2, persistenceVersion: 1 },
	});
	expect(await store.draftList()).toEqual([draft]);
});
it.each([
	{
		name: "superseded generation",
		change: { generation: 1 },
		reason: "superseded-generation",
		code: "stale",
	},
	{
		name: "competing metadata",
		change: { text: "Other text", persistenceVersion: 2 },
		reason: "metadata-conflict",
		code: "stale",
	},
	{
		name: "target collision",
		change: { scope: "file" as const, generation: 9 },
		reason: "target-conflict",
		code: "conflict",
	},
])(
	"D3 typed seam refuses $name without changing stored bytes",
	async ({ change, reason, code }) => {
		const { store, root } = await fixture();
		await store.draftPut({ draft });
		const path = join(
			root,
			".praxity/local/drafts",
			`file-${createHash("sha256").update("a.prax").digest("hex")}.json`,
		);
		const before = await readFile(path);
		expect(
			await store.draftPersist({
				action: "put",
				draft: { ...draft, ...change },
				expectedVersion: 1,
			}),
		).toMatchObject({
			status: "refused",
			reason,
			code,
			stored: { text: "Author text", generation: 2 },
		});
		expect(await readFile(path)).toEqual(before);
	},
);
it.each(["put", "remove"] as const)(
	"D3 corrupt stored schema survives typed %s refusal",
	async (action) => {
		const { store, root } = await fixture();
		await mkdir(join(root, ".praxity/local/drafts"), { recursive: true });
		const path = join(root, ".praxity/local/drafts/file-" + "a".repeat(64) + ".json");
		await writeFile(path, '{"schema":99}');
		expect(
			await store.draftPersist(
				action === "put" ? { action, draft } : { action, file: "a.prax", id: draft.id },
			),
		).toMatchObject({ status: "refused", reason: "corrupt-storage" });
		expect(await readFile(path, "utf8")).toBe('{"schema":99}');
		await expect(store.draftList()).rejects.toThrow();
	},
);
it("D3 typed delete acknowledges absence and a committed cleanup warning", async () => {
	const { store } = await fixture();
	expect(await store.draftPersist({ action: "remove", file: "a.prax", id: draft.id })).toEqual({
		status: "succeeded",
		writeResult: {},
	});
	await store.draftPut({ draft });
	fault.cleanup = true;
	expect(
		await store.draftPersist({ action: "remove", file: "a.prax", id: draft.id }),
	).toMatchObject({
		status: "succeeded",
		writeResult: { cleanupError: expect.stringContaining("Injected draft cleanup failure") },
	});
	expect(await store.draftList()).toEqual([]);
});
it("D3 project service and HTTP retain corruption rather than bad request schema", async () => {
	const { root } = await fixture();
	const ui = await mkdtemp(join(tmpdir(), "draft-outcome-ui-"));
	roots.push(ui);
	await writeFile(join(ui, "index.html"), "<!doctype html><title>Test</title>");
	await writeFile(join(ui, "canvas.js"), "void 0;");
	await writeFile(
		join(ui, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	await mkdir(join(root, ".praxity/local/drafts"), { recursive: true });
	await writeFile(join(root, ".praxity/local/drafts/file-" + "a".repeat(64) + ".json"), "{");
	const project = await createStudioProjectSession(root, "test");
	sessions.push(project);
	const lifetime = (await project.invoke("draftPersistenceSession", {})) as { serviceId: string };
	expect(
		(
			(await project.invoke("draftPersistenceSubmit", {
				...lifetime,
				attemptId: randomUUID(),
				operation: { action: "put", draft },
			})) as { outcome: unknown }
		).outcome,
	).toMatchObject({
		status: "refused",
		reason: "corrupt-storage",
	});
	const server = await startStudioServer({
		projectDir: root,
		editorAssetsDir: ui,
		appVersion: "test",
	});
	sessions.push(server);
	const serverLifetime = (await rpc(server, "draftPersistenceSession", {})).result;
	expect(
		await rpc(server, "draftPersistenceSubmit", {
			...serverLifetime,
			attemptId: randomUUID(),
			operation: { action: "remove", file: "a.prax", id: draft.id },
		}),
	).toMatchObject({
		status: 200,
		ok: true,
		result: { outcome: { status: "refused", reason: "corrupt-storage" } },
	});
});
it("D3 typed admission refuses a symlink and missing lesson while preserving author text", async () => {
	const { root, store } = await fixture();
	expect(
		await store.draftPersist({ action: "put", draft: { ...draft, file: "removed.prax" } }),
	).toMatchObject({ status: "refused", reason: "missing-membership" });
	expect(
		await store.draftPersist({ action: "put", draft: { ...draft, generation: -1 } }),
	).toMatchObject({ status: "refused", reason: "invalid-input" });
	await mkdir(join(root, ".praxity"), { recursive: true });
	const outside = await mkdtemp(join(tmpdir(), "draft-outcome-outside-"));
	roots.push(outside);
	await symlink(outside, join(root, ".praxity/local"), "junction");
	for (const operation of [
		{ action: "put", draft },
		{ action: "remove", file: "a.prax", id: draft.id },
	])
		expect(await store.draftPersist(operation)).toMatchObject({
			status: "refused",
			reason: "unsafe-path",
		});
	expect(draft.text).toBe("Author text");
});
it.each([
	["EPROJECTBUSY", "busy"],
	["EFILEBUSY", "busy"],
	["ECONFLICT", "admission-race"],
	["ERECOVERYREQUIRED", "environment"],
	["EPROJECTFILESYSTEM", "environment"],
	["ELOCKCACHE", "environment"],
	["EACCES", "environment"],
	["EPERM", "environment"],
	["ENOSPC", "environment"],
	["EROFS", "environment"],
	["EPLAINYAML", "environment"],
])("D3 typed no-write %s admission carries %s disposition", async (code, reason) => {
	const { store } = await fixture();
	fault.code = code;
	expect(await store.draftPersist({ action: "put", draft })).toEqual({
		status: "refused",
		code,
		reason,
	});
	expect(await store.draftList()).toEqual([]);
});
it("D3 recovery ambiguity stays unknown instead of promising no write", async () => {
	const { store } = await fixture();
	fault.code = "EPROJECTRECOVERY";
	expect(await store.draftPersist({ action: "put", draft })).toEqual({
		status: "unknown",
		code: "EPROJECTRECOVERY",
	});
});

it("D3 a real rollback conflict through the store keeps Unknown and outside bytes", async () => {
	const { root, store } = await fixture();
	await store.draftPut({ draft });
	const bucket = join(
		root,
		".praxity/local/drafts",
		"file-" + createHash("sha256").update("a.prax").digest("hex") + ".json",
	);
	fault.rollbackPath = bucket;
	expect(
		await store.draftPersist({
			action: "put",
			draft: { ...draft, text: "Later", generation: 3, persistenceVersion: 2 },
		}),
	).toMatchObject({ status: "unknown", code: "EPROJECTRECOVERY" });
	expect(await readFile(bucket, "utf8")).toBe("Outside writer");
});

for (const change of ["text", "generation", "version", "target", "metadata"] as const)
	it("D3 guarded-remove model preserves another writer's " + change, async () => {
		const { root, store } = await fixture();
		const seen = { ...draft, persistenceVersion: 1 };
		const winner = structuredClone(seen);
		if (change === "text") winner.text = "B winner";
		if (change === "generation") winner.generation++;
		if (change === "version") winner.persistenceVersion++;
		if (change === "target")
			winner.target = { kind: "node", nodeId: null, path: [1], fingerprint: "c".repeat(64) };
		if (change === "metadata") winner.selection = [1, 1];
		await store.draftPut({ draft: winner });
		const before = await store.draftList();
		const result = await store.draftPersist({
			action: "remove",
			file: seen.file,
			id: seen.id,
			expectedDraft: seen,
		});
		expect(result).toMatchObject({
			status: "refused",
			reason: "metadata-conflict",
			stored: winner,
		});
		expect(await store.draftList()).toEqual(before);
	});
it("D3 guarded-remove model matching and missing versions settle successfully", async () => {
	const { store } = await fixture();
	await store.draftPut({ draft });
	const seen = { ...draft, persistedGeneration: 999, persistedVersion: 999 };
	const operation = { action: "remove", file: draft.file, id: draft.id, expectedDraft: seen };
	expect(await store.draftPersist(operation)).toMatchObject({ status: "succeeded" });
	expect(await store.draftList()).toEqual([]);
	expect(await store.draftPersist(operation)).toMatchObject({ status: "succeeded" });
});
