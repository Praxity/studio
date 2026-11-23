import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Command,
	createSession,
	type Dependencies,
	type DraftSeed,
	dispatch,
	type Effect,
} from "@praxity/editor-core/session";
import { afterEach, expect, it } from "vitest";
import { persistFixtureIdentity } from "../../test-utils/identity-fixture";
import { resolveLessonSources } from "../lesson-source";
import { LocalEditorStore } from "../operations/local-editor-store";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const put = (effects: Effect[]) => {
	const effect = effects.find((e) => e.type === "persistDraft" && e.action === "put");
	assert(effect?.type === "persistDraft" && effect.action === "put");
	return effect;
};

async function editorFixture() {
	const root = await mkdtemp(join(tmpdir(), "draft-persistence-session-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await writeFile(join(root, "lesson.prax"), "# Page\n\n::: note\nText\n:::\n");
	await persistFixtureIdentity(root);
	const current = await resolveLessonSources(root);
	const mapping = current.identity.sourceMappings.find((node) => node.path.length === 2);
	assert(mapping);
	const seed: DraftSeed = {
		file: "lesson.prax",
		target: {
			kind: "node",
			nodeId: mapping.id,
			path: mapping.path,
			fingerprint: mapping.fingerprint,
		},
		baseRevision: createHash("sha256").update("# Page\n\n::: note\nText\n:::\n").digest("hex"),
		expectedText: "::: note\nText\n:::\n",
		editableText: "::: note\nText\n",
	};
	let state = createSession();
	const deps: Dependencies = {
		now: 0,
		validateDraft: () => ({ diagnostics: [], escapes: false }),
		helperTokens: () => [],
		focusNeighbours: () => ({ page: { file: seed.file, nodeId: mapping.id, role: "handle" } }),
		nameOfFocus: () => "Note",
		readDraft: () => seed,
		translate: (message) => message.key,
	};
	const send = (command: Command) => {
		const result = dispatch(state, command, deps);
		state = result.state;
		return result.effects;
	};
	const store = new LocalEditorStore(root);
	const reply = (effect: ReturnType<typeof put>, ok: boolean) =>
		send({
			type: "draftPersistenceReply",
			id: effect.draft.id,
			requestId: effect.requestId,
			generation: effect.draft.generation,
			ok,
		});
	const write = (effect: ReturnType<typeof put>) =>
		store.draftPut({
			draft: effect.draft,
			...(effect.expectedVersion === undefined ? {} : { expectedVersion: effect.expectedVersion }),
		});
	send({ type: "openSource", seed });
	expect(send({ type: "changeDraft", text: "New", selection: [0, 0] })).toEqual([
		{ type: "render" },
	]);
	return { root, seed, store, send, reply, write, deps, state: () => state };
}

it("D3 identical pending blur does not supersede the acknowledged store request", async () => {
	const h = await editorFixture();
	const first = put(h.send({ type: "blur" }));
	expect(h.send({ type: "blur" }).filter((effect) => effect.type === "persistDraft")).toEqual([]);
	expect((await h.write(first)).ok).toBe(true);
	h.reply(first, true);
	expect(h.state().drafts[first.draft.id]).toMatchObject({
		text: "New",
		generation: 1,
		persistedGeneration: 1,
	});
});

it("D3 a lost successful put reply can retry and acknowledge the durable version", async () => {
	const h = await editorFixture();
	const first = put(h.send({ type: "blur" }));
	expect((await h.write(first)).ok).toBe(true);
	h.reply(first, false);
	const retry = put(h.send({ type: "retryDraftPersistence", id: first.draft.id }));
	expect((await h.write(retry)).ok).toBe(true);
	h.reply(retry, true);
	expect(h.state().drafts[first.draft.id]).toMatchObject({
		text: "New",
		generation: 1,
		persistedGeneration: 1,
	});
	expect((await h.store.draftList()).map(({ text, generation }) => ({ text, generation }))).toEqual(
		[{ text: "New", generation: 1 }],
	);
});

it("D9 validation metadata retains the acknowledged predecessor before the next idle put", async () => {
	const h = await editorFixture();
	const first = put(h.send({ type: "blur" }));
	expect((await h.write(first)).ok).toBe(true);
	h.deps.validateDraft = () => ({ diagnostics: [], escapes: true });
	h.deps.now = 150;
	expect(h.send({ type: "tick" }).filter((effect) => effect.type === "persistDraft")).toEqual([]);
	h.reply(first, true);
	expect(h.state().drafts[first.draft.id]).toMatchObject({
		text: "New",
		generation: 1,
		status: "held",
		persistenceVersion: 2,
		persistedVersion: 1,
	});
	h.deps.now = 1000;
	const held = put(h.send({ type: "tick" }));
	expect(held.expectedVersion).toBe(1);
	expect((await h.write(held)).ok).toBe(true);
	h.reply(held, true);
	expect(h.state().drafts[first.draft.id]).toMatchObject({
		persistedGeneration: 1,
		persistedVersion: 2,
	});
	expect((await h.store.draftList()).map(({ text, status }) => ({ text, status }))).toEqual([
		{ text: "New", status: "held" },
	]);
});

it("D11 D17 guarded conflict metadata preserves the author's text through reload", async () => {
	const h = await editorFixture();
	const first = put(h.send({ type: "blur" }));
	expect((await h.write(first)).ok).toBe(true);
	h.reply(first, true);
	const outside = { ...h.seed, editableText: "Outside", expectedText: "Outside\n" };
	h.send({ type: "outsideChange", file: h.seed.file, revision: h.seed.baseRevision });
	const epoch = h.state().drafts[first.draft.id].resolutionEpoch;
	assert(epoch !== undefined);
	const conflict = put(
		h.send({
			type: "draftResolved",
			id: first.draft.id,
			generation: 1,
			epoch,
			resolution: { kind: "changed", seed: outside },
		}),
	);
	expect(conflict.draft).toMatchObject({
		text: "New",
		generation: 1,
		status: "conflict",
		persistenceVersion: 2,
	});
	expect(conflict.expectedVersion).toBe(1);
	expect((await h.write(conflict)).ok).toBe(true);
	h.reply(conflict, true);
	const [saved] = await new LocalEditorStore(h.root).draftList();
	const restored = dispatch(
		createSession(),
		{
			type: "restoreDrafts",
			drafts: [
				{
					draft: saved,
					resolution: { kind: "changed", seed: outside },
					page: "1",
				},
			],
		},
		h.deps,
	).state;
	expect(restored.drafts[first.draft.id]).toMatchObject({
		text: "New",
		generation: 1,
		status: "conflict",
		persistenceVersion: 2,
		persistedVersion: 2,
		outside: { editableText: "Outside", expectedText: "Outside\n" },
	});
	expect(restored.history).toEqual([]);
});

it.each([true, false])(
	"D9 metadata has a separate acknowledgement after prior put acknowledged=%s",
	async (acknowledged) => {
		const h = await editorFixture();
		const first = put(h.send({ type: "blur" }));
		expect((await h.write(first)).ok).toBe(true);
		if (acknowledged) h.reply(first, true);
		h.send({ type: "commit", trigger: "save" });
		const pending = h.state().pending;
		assert(pending?.kind === "commit");
		const held = put(
			h.send({
				type: "operationReply",
				result: {
					ok: false,
					transactionId: pending.request.transactionId,
					code: "not-allowed",
					message: { key: "op.not-allowed", params: {} },
				},
			}),
		);
		expect(held.draft).toMatchObject({ text: "New", generation: 1, status: "held" });
		expect(held.draft).toMatchObject({
			persistenceVersion: 2,
			persistedVersion: acknowledged ? 1 : -1,
		});
		expect(held.expectedVersion).toBe(1);
		h.reply(first, true);
		h.reply(held, false);
		const retry = put(h.send({ type: "retryDraftPersistence", id: held.draft.id }));
		expect((await h.write(retry)).ok).toBe(true);
		h.reply(retry, true);
		expect(h.state().drafts[held.draft.id]).toMatchObject({
			persistedVersion: 2,
			persistenceVersion: 2,
		});
		expect(
			(await new LocalEditorStore(h.root).draftList()).map(({ text, generation, status }) => ({
				text,
				generation,
				status,
			})),
		).toEqual([{ text: "New", generation: 1, status: "held" }]);
		expect(await readFile(join(h.root, "lesson.prax"), "utf8")).toBe(
			"# Page\n\n::: note\nText\n:::\n",
		);
	},
);

it.each(["old-first", "clean-first"])(
	"D3 reverting to base clears obsolete durable text with %s put completion",
	async (order) => {
		const root = await mkdtemp(join(tmpdir(), "draft-persistence-session-"));
		roots.push(root);
		const source = "# Page\n\n::: note\nText\n:::\n";
		await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
		await writeFile(join(root, "lesson.prax"), source);
		await persistFixtureIdentity(root);
		const current = await resolveLessonSources(root);
		const mapping = current.identity.sourceMappings.find((node) =>
			source.slice(node.span.start, node.span.end).startsWith("::: note"),
		);
		assert(mapping);
		const seed: DraftSeed = {
			file: "lesson.prax",
			target: {
				kind: "node",
				nodeId: mapping.id,
				path: mapping.path,
				fingerprint: mapping.fingerprint,
			},
			baseRevision: createHash("sha256").update(source).digest("hex"),
			expectedText: "::: note\nText\n:::\n",
			editableText: "::: note\nText\n",
		};
		let state = createSession();
		const deps: Dependencies = {
			now: 0,
			validateDraft: () => ({ diagnostics: [], escapes: false }),
			helperTokens: () => [],
			focusNeighbours: () => ({ page: { file: seed.file, nodeId: mapping.id, role: "handle" } }),
			nameOfFocus: () => "Note",
			readDraft: () => seed,
			translate: (message) => message.key,
		};
		const send = (command: Command) => {
			const result = dispatch(state, command, deps);
			state = result.state;
			return result.effects;
		};
		const store = new LocalEditorStore(root);
		const finishPut = async (effect: ReturnType<typeof put>) => {
			const result = await store.draftPut({ draft: effect.draft });
			send({
				type: "draftPersistenceReply",
				id: effect.draft.id,
				requestId: effect.requestId,
				generation: effect.draft.generation,
				ok: result.ok,
			});
			return result;
		};
		send({ type: "openSource", seed });
		send({ type: "changeDraft", text: "New", selection: [0, 0] });
		const old = put(send({ type: "blur" }));
		expect(
			send({ type: "changeDraft", text: "::: note\nText\n", selection: [0, 0] }).filter(
				(e) => e.type !== "render",
			),
		).toEqual([]);
		if (order === "old-first") {
			expect((await finishPut(old)).ok).toBe(true);
			expect((await store.draftList()).map((draft) => draft.text)).toEqual(["New"]);
		}
		deps.now = 1000;
		const clean = put(send({ type: "tick" }));
		expect(clean.draft).toMatchObject({
			text: "::: note\nText\n",
			status: "clean",
			generation: 2,
			persistedGeneration: -1,
		});
		expect((await finishPut(clean)).ok).toBe(true);
		if (order === "clean-first")
			expect(await finishPut(old)).toMatchObject({ ok: false, code: "stale" });
		expect(
			(await store.draftList()).map(({ text, generation, status }) => ({
				text,
				generation,
				status,
			})),
		).toEqual([{ text: "::: note\nText\n", generation: 2, status: "clean" }]);
		expect(state.drafts[clean.draft.id].persistedGeneration).toBe(2);
		expect(await readFile(join(root, "lesson.prax"), "utf8")).toBe(
			"# Page\n\n::: note\nText\n:::\n",
		);
	},
);
