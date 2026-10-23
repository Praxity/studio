import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Draft } from "@praxity/editor-core/session";
import { afterEach, expect, it, vi } from "vitest";
import { LocalEditorStore } from "../operations/local-editor-store";
import { withProjectFileTransaction } from "../project-file-transactions";
import { createStudioProjectSession } from "../studio/project-session";
import { type StudioServer, startStudioServer } from "../studio/server";

const roots: string[] = [];
const sessions: { close(): Promise<void> }[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

it("D3 reconciliation refuses a different draft, target, action or version for the same attempt", async () => {
	const { session, lifetime } = await fixture();
	const identity = { ...lifetime, attemptId: randomUUID() };
	const operation = { action: "put", draft };
	await session.invoke("draftPersistenceSubmit", { ...identity, operation });
	for (const changed of [
		{ action: "put", draft: { ...draft, id: "other" } },
		{ action: "put", draft: { ...draft, target: { ...draft.target, nodeId: randomUUID() } } },
		{ action: "put", draft: { ...draft, persistenceVersion: 2 } },
		{ action: "remove", file: "a.prax", id: draft.id },
	])
		expect(
			await session.invoke("draftPersistenceReconcile", { ...identity, operation: changed }),
		).toMatchObject({ state: "unavailable", reason: "attempt-conflict" });
	expect(
		await session.invoke("draftPersistenceReconcile", { ...identity, operation }),
	).toMatchObject({ state: "terminal", operation });
});
it("D3 evicted terminal receipts never execute again and unseen fences survive retention", async () => {
	const { session, lifetime } = await fixture();
	const operation = { action: "put", draft };
	const first = { ...lifetime, attemptId: randomUUID(), operation };
	const fenced = { ...lifetime, attemptId: randomUUID(), operation };
	await session.invoke("draftPersistenceReconcile", fenced);
	const execute = vi
		.spyOn(LocalEditorStore.prototype, "draftPersist")
		.mockResolvedValue({ status: "succeeded", writeResult: {} });
	await session.invoke("draftPersistenceSubmit", first);
	for (let index = 0; index < 128; index++)
		await session.invoke("draftPersistenceSubmit", {
			...lifetime,
			attemptId: randomUUID(),
			operation,
		});
	expect(await session.invoke("draftPersistenceReconcile", first)).toMatchObject({
		state: "unavailable",
		reason: "evicted",
	});
	expect(await session.invoke("draftPersistenceSubmit", first)).toMatchObject({
		state: "unavailable",
		reason: "evicted",
	});
	expect(await session.invoke("draftPersistenceSubmit", fenced)).toMatchObject({ state: "fenced" });
	expect(execute).toHaveBeenCalledTimes(129);
});
it("D3 the unfenced persistence RPC is unavailable", async () => {
	const { session } = await fixture();
	await expect(session.invoke("draftPersist", { action: "put", draft })).rejects.toThrow();
	expect(await session.invoke("draftList", {})).toEqual([]);
});
const draft: Draft = {
	id: "author",
	file: "a.prax",
	target: { kind: "node", nodeId: null, path: [0], fingerprint: "a".repeat(64) },
	baseRevision: "b".repeat(64),
	expectedText: "Original",
	editableText: "Original",
	baseText: "Original",
	text: "Late author text",
	selection: [2, 2],
	generation: 4,
	status: "held",
	diagnostics: [],
	changedAt: 0,
	validatedGeneration: 4,
	persistedGeneration: -1,
	persistenceVersion: 1,
	persistedVersion: -1,
};
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((receive) => {
		resolve = receive;
	});
	return { promise, resolve };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "draft-receipt-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [a.prax]\n");
	await writeFile(join(root, "a.prax"), "# First\n\nOriginal\n");
	const session = await createStudioProjectSession(root, "test");
	sessions.push(session);
	const lifetime = (await session.invoke("draftPersistenceSession", {})) as { serviceId: string };
	return { root, session, lifetime };
}
it("D3 reconciliation fences an unseen late request instead of certifying absence alone", async () => {
	const { session, lifetime } = await fixture();
	const identity = { ...lifetime, attemptId: randomUUID() };
	expect(
		await session.invoke("draftPersistenceReconcile", {
			...identity,
			operation: { action: "put", draft },
		}),
	).toEqual({
		...identity,
		state: "fenced",
	});
	expect(
		await session.invoke("draftPersistenceSubmit", {
			...identity,
			operation: { action: "put", draft },
		}),
	).toEqual({ ...identity, state: "fenced" });
	expect(await session.invoke("draftList", {})).toEqual([]);
});
it("D3 an accepted request stays pending through deletion and a reopening read", async () => {
	const { root, session, lifetime } = await fixture();
	const entered = deferred<void>(),
		release = deferred<void>();
	const blocker = withProjectFileTransaction(root, async () => {
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	const identity = { ...lifetime, attemptId: randomUUID() };
	const submitted = session.invoke("draftPersistenceSubmit", {
		...identity,
		operation: { action: "put", draft },
	});
	const reconciliation = session.invoke("draftPersistenceReconcile", {
		...identity,
		operation: { action: "put", draft },
	});
	const deleted = session.invoke("draftPersistenceSubmit", {
		...lifetime,
		attemptId: randomUUID(),
		operation: { action: "remove", file: "a.prax", id: "author" },
	});
	const duplicate = session.invoke("draftPersistenceSubmit", {
		...identity,
		operation: { action: "put", draft },
	});
	const reopened = session.invoke("draftList", {});
	const settled: string[] = [];
	void submitted.then(() => settled.push("put"));
	void reconciliation.then(() => settled.push("reconciled"));
	void deleted.then(() => settled.push("delete"));
	void reopened.then(() => settled.push("read"));
	try {
		await flush();
		expect(settled).toEqual([]);
	} finally {
		release.resolve();
		await blocker;
	}
	expect(await reconciliation).toEqual(await submitted);
	expect(await duplicate).toEqual(await submitted);
	expect(await submitted).toMatchObject({
		...identity,
		state: "terminal",
		outcome: { status: "succeeded", writeResult: {} },
	});
	expect(await deleted).toMatchObject({ state: "terminal", outcome: { status: "succeeded" } });
	expect(await reopened).toEqual([]);
	expect(settled.indexOf("delete")).toBeGreaterThan(settled.indexOf("put"));
	expect(settled.indexOf("read")).toBeGreaterThan(settled.indexOf("put"));
});
it("D3 duplicate IDs retain their immutable operation and terminal result after deletion", async () => {
	const { root, session, lifetime } = await fixture();
	const identity = { ...lifetime, attemptId: randomUUID() };
	const operation = { action: "put", draft };
	const result = await session.invoke("draftPersistenceSubmit", { ...identity, operation });
	await new LocalEditorStore(root).draftPersist({ action: "remove", file: "a.prax", id: "author" });
	expect(await session.invoke("draftPersistenceSubmit", { ...identity, operation })).toEqual(
		result,
	);
	expect(
		await session.invoke("draftPersistenceReconcile", {
			...identity,
			operation: { action: "put", draft },
		}),
	).toEqual(result);
	for (const changed of [
		{ action: "put", draft: { ...draft, text: "Mine author text" } },
		{ action: "put", draft, expectedVersion: 99 },
		{ action: "remove", file: "a.prax", id: "author" },
	])
		expect(
			await session.invoke("draftPersistenceSubmit", { ...identity, operation: changed }),
		).toEqual({ ...identity, state: "unavailable", reason: "attempt-conflict" });
	expect(await session.invoke("draftList", {})).toEqual([]);
});
it("D3 a new service lifetime cannot certify an old registry from its empty map", async () => {
	const { root, session, lifetime } = await fixture();
	const identity = { ...lifetime, attemptId: randomUUID() };
	await session.invoke("draftPersistenceSubmit", {
		...identity,
		operation: { action: "put", draft },
	});
	await session.close();
	const replacement = await createStudioProjectSession(root, "test");
	sessions.push(replacement);
	expect(
		await replacement.invoke("draftPersistenceReconcile", {
			...identity,
			operation: { action: "put", draft },
		}),
	).toEqual({
		...identity,
		state: "unavailable",
		reason: "service-lifetime",
	});
	expect(
		await replacement.invoke("draftPersistenceSubmit", {
			...identity,
			operation: { action: "remove", file: "a.prax", id: "author" },
		}),
	).toEqual({ ...identity, state: "unavailable", reason: "service-lifetime" });
	expect(await replacement.invoke("draftList", {})).toEqual([draft]);
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
it("D3 a reply lost before execution is reconciled before the real HTTP request arrives", async () => {
	const { root, session } = await fixture();
	await session.close();
	const ui = await mkdtemp(join(tmpdir(), "draft-receipt-ui-"));
	roots.push(ui);
	await writeFile(join(ui, "index.html"), "<!doctype html><title>Test</title>");
	await writeFile(join(ui, "canvas.js"), "void 0;");
	await writeFile(
		join(ui, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	const server = await startStudioServer({
		projectDir: root,
		editorAssetsDir: ui,
		appVersion: "test",
	});
	sessions.push(server);
	const serviceId = (await rpc(server, "draftPersistenceSession", {})).result.serviceId;
	const identity = { serviceId, attemptId: randomUUID() };
	const body = JSON.stringify({
		method: "draftPersistenceSubmit",
		args: { ...identity, operation: { action: "put", draft } },
	});
	const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
	const received = deferred<{ status: number | undefined; result: unknown }>();
	const late = request(
		`${server.origin}/api/rpc`,
		{
			method: "POST",
			headers: {
				Origin: server.origin,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body),
			},
		},
		(response) => {
			let bytes = "";
			response.on("data", (chunk) => {
				bytes += chunk;
			});
			response.on("end", () =>
				received.resolve({ status: response.statusCode, result: JSON.parse(bytes).result }),
			);
		},
	);
	late.on("error", (error) => received.resolve({ status: 0, result: String(error) }));
	late.write(body.slice(0, -1));
	try {
		// The caller has no reply while the original authenticated body can still arrive.
		expect(
			await rpc(server, "draftPersistenceReconcile", {
				...identity,
				operation: { action: "put", draft },
			}),
		).toMatchObject({
			status: 200,
			result: { ...identity, state: "fenced" },
		});
		expect(
			await rpc(server, "draftPersistenceSubmit", {
				serviceId,
				attemptId: randomUUID(),
				operation: { action: "remove", file: "a.prax", id: "author" },
			}),
		).toMatchObject({ result: { state: "terminal", outcome: { status: "succeeded" } } });
		late.end(body.slice(-1));
		expect(await received.promise).toEqual({
			status: 200,
			result: { ...identity, state: "fenced" },
		});
		expect(await rpc(server, "draftList", {})).toMatchObject({ result: [] });
	} finally {
		late.destroy();
	}
});
it("D3 malformed receipt identity and changed payload schema never write", async () => {
	const { session, lifetime } = await fixture();
	for (const args of [
		{ ...lifetime, attemptId: "__proto__" },
		{ ...lifetime, attemptId: randomUUID(), extra: true },
	])
		await expect(session.invoke("draftPersistenceReconcile", args)).rejects.toMatchObject({
			name: "ZodError",
		});
	await expect(
		session.invoke("draftPersistenceSubmit", {
			...lifetime,
			attemptId: randomUUID(),
			operation: { action: "put", draft: { ...draft, generation: -1 } },
		}),
	).rejects.toMatchObject({ name: "ZodError" });
	expect(await session.invoke("draftList", {})).toEqual([]);
});
it("D3 a caller cannot mutate a retained terminal receipt", async () => {
	const { session, lifetime } = await fixture();
	const identity = { ...lifetime, attemptId: randomUUID() };
	const result = (await session.invoke("draftPersistenceSubmit", {
		...identity,
		operation: { action: "put", draft },
	})) as { state: string; outcome: { status: string; writeResult: { cleanupError?: string } } };
	result.state = "fenced";
	result.outcome.writeResult.cleanupError = "Invented warning";
	expect(
		await session.invoke("draftPersistenceReconcile", {
			...identity,
			operation: { action: "put", draft },
		}),
	).toEqual({
		...identity,
		state: "terminal",
		operation: { action: "put", draft },
		outcome: { status: "succeeded", writeResult: {} },
	});
});
it("D3 service close drains an accepted attempt while rejecting new commands", async () => {
	const { root, session, lifetime } = await fixture();
	const entered = deferred<void>(),
		release = deferred<void>();
	const blocker = withProjectFileTransaction(root, async () => {
		entered.resolve();
		await release.promise;
	});
	await entered.promise;
	const identity = { ...lifetime, attemptId: randomUUID() };
	const accepted = session.invoke("draftPersistenceSubmit", {
		...identity,
		operation: { action: "put", draft },
	});
	let closed = false;
	const closing = session.close().then(() => {
		closed = true;
	});
	try {
		await flush();
		expect(closed).toBe(false);
		await expect(session.invoke("draftList", {})).rejects.toMatchObject({ code: "session_closed" });
	} finally {
		release.resolve();
		await blocker;
	}
	expect(await accepted).toMatchObject({ state: "terminal", outcome: { status: "succeeded" } });
	await closing;
});
