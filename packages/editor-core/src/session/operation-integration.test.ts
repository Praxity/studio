// @vitest-environment node
import { createHash } from "node:crypto";
import type { OperationRequest } from "@praxity/grammar/src/operations/contract.ts";
import { applyEdits } from "@praxity/grammar/src/source-edit.ts";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { describe, expect, it } from "vitest";
import { resolveIdentity } from "../../../content-identity/src";
import { applyOperation } from "../../../operations/src";
import { draftRange } from "../../../operations/src/ranges";
import { createSession, dispatch } from "./index";
import type { Command, Dependencies, DraftSeed, Focus } from "./types";

const file = "lesson.prax";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function service(initial: string) {
	let source = initial;
	let allocated = 0;
	const identityDeps = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(++allocated).toString(16).padStart(12, "0")}`,
	};
	const document = () => ({
		path: file,
		tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
	});
	let identity = resolveIdentity(
		{ parsedDocuments: [document()], priorSnapshots: [] },
		identityDeps,
	);
	let state = createSession();
	const seedFor = (focus: Focus): DraftSeed => {
		const mapping = identity.sourceMappings.find((m) => m.id === focus.nodeId);
		if (!mapping) throw new Error("Missing test target");
		let node = document().tree.root;
		for (const index of mapping.path) node = node.children[index];
		const range = draftRange(node);
		return {
			file,
			target: {
				kind: "node",
				nodeId: mapping.id,
				path: mapping.path,
				fingerprint: mapping.fingerprint,
			},
			baseRevision: digest(source),
			expectedText: node.raw,
			editableText: source.slice(range.start, range.end),
		};
	};
	const dependencies: Dependencies = {
		now: 0,
		validateDraft: () => ({ diagnostics: [], escapes: false }),
		helperTokens: () => [],
		readDraft: seedFor,
		translate: (m) => m.key,
		focusNeighbours: () => ({
			page: {
				file,
				nodeId: identity.sourceMappings.find((m) => m.path.length === 1)?.id ?? null,
				role: "handle",
			},
		}),
		nameOfFocus: () => "Page: Lesson",
	};
	const send = (command: Command) => {
		const result = dispatch(state, command, dependencies);
		state = result.state;
		return result.effects;
	};
	const target = (type: string) => {
		const mapping = identity.sourceMappings.find(
			(m) => identity.snapshots[0].nodes[m.id].type === type,
		);
		if (!mapping) throw new Error(`Missing ${type}`);
		return { file, nodeId: mapping.id, role: "handle" as const };
	};
	const apply = (request: OperationRequest) => {
		const result = applyOperation([{ path: file, source }], request, { ...identityDeps, identity });
		if (result.ok) {
			source = applyEdits(source, result.files[0].edits);
			identity = result.identity;
		}
		const effects = send({
			type: "operationReply",
			result: result.ok ? { ...result, historyId: "service-entry" } : result,
		});
		for (const effect of effects)
			if (effect.type === "focus" && effect.requestId)
				send({ type: "focusResult", requestId: effect.requestId, success: true });
		return { result, effects };
	};
	const commit = (text: string) => {
		send({ type: "changeDraft", text, selection: [0, 0] });
		const post = send({ type: "escape" }).find(
			(e) => e.type === "post" && e.method === "operationApply",
		);
		if (post?.type !== "post" || post.method !== "operationApply")
			throw new Error("Missing commit");
		return apply(post.request);
	};
	return {
		send,
		target,
		seedFor,
		commit,
		apply,
		get source() {
			return source;
		},
		get state() {
			return state;
		},
	};
}

describe("controller with the real operation registry", () => {
	it("D6 D7 D8 F8: typo keeps identity, split uses the registry's lexical survivor and focus", () => {
		const s = service(
			"# Lesson\n\nAn original paragraph with several words.\n\nUntouched neighbour.\n",
		);
		const focus = s.target("body");
		s.send({ type: "openSource", seed: s.seedFor(focus) });
		const typo = s.commit("An original paragraph with several wordz.\n");
		expect(typo.result.ok).toBe(true);
		if (!typo.result.ok) throw new Error(typo.result.code);
		expect(typo.result.intent).toBe("modify");
		expect(s.state.focus?.nodeId).toBe(focus.nodeId);
		expect(s.source).toContain("Untouched neighbour.\n");
		s.send({ type: "openSource", seed: s.seedFor(focus) });
		const split = s.commit("New text.\n\nAn original paragraph with several wordz.\n");
		expect(split.result.ok).toBe(true);
		if (!split.result.ok) throw new Error(split.result.code);
		expect(split.result.intent).toBe("split");
		expect(split.result.mapping).toContainEqual({
			oldId: focus.nodeId,
			newId: focus.nodeId,
			fate: "survivor",
		});
		expect(s.state.focus?.nodeId).toBe(focus.nodeId);
	});
	it("D9: contained errors commit once with pending identity; escaping source stays held and leaves exact bytes", () => {
		const original = "# Lesson\r\n\r\n::: note {tone=note}\r\nCafé 😀\r\n:::\r\n\r\nOutside.\r\n";
		const s = service(original);
		const focus = s.target("note");
		s.send({ type: "openSource", seed: s.seedFor(focus) });
		const invalid = s.commit("::: note {tone=purple}\nCafé 😀\n");
		expect(invalid.result.ok).toBe(true);
		if (!invalid.result.ok) throw new Error(invalid.result.code);
		expect(invalid.result.diagnostics.length).toBeGreaterThan(0);
		expect(invalid.effects.filter((e) => e.type === "announce")).toHaveLength(1);
		expect(invalid.effects.find((e) => e.type === "announce")).toMatchObject({
			message: { key: "session.announcements.savedInvalid" },
		});
		expect(s.source.endsWith("\r\n\r\nOutside.\r\n")).toBe(true);
		const before = s.source;
		s.send({ type: "openSource", seed: s.seedFor(focus) });
		const escaping = s.commit("::: note\n:::\n# Escaped\n");
		expect(escaping.result.ok).toBe(false);
		expect(s.source).toBe(before);
		expect(Object.values(s.state.drafts)[0].status).toBe("held");
	});
	it("D14: history sends only the service acknowledgement ID as one transaction", () => {
		const s = service("# Lesson\n\nOriginal.\n");
		const focus = s.target("body");
		s.send({ type: "openSource", seed: s.seedFor(focus) });
		const applied = s.commit("Modified.\n");
		if (!applied.result.ok) throw new Error(applied.result.code);
		const post = s
			.send({ type: "undo", inTextField: false })
			.find((e) => e.type === "post" && e.method === "historyApply");
		expect(post).toMatchObject({
			method: "historyApply",
			historyId: "service-entry",
		});
	});
	it("F8: delete uses the registry's next-sibling focus without advancing it again", () => {
		const s = service("# Lesson\n\nFirst.\n\nNext.\n\nLast.\n");
		const focus = s.target("body");
		s.send({ type: "openSource", seed: s.seedFor(focus) });
		const deleted = s.commit("");
		if (!deleted.result.ok) throw new Error(deleted.result.code);
		expect(deleted.result.intent).toBe("delete");
		expect(deleted.result.focus.nodeId).not.toBe(focus.nodeId);
		expect(s.state.focus?.nodeId).toBe(deleted.result.focus.nodeId);
		expect(s.seedFor(s.state.focus as Focus).editableText).toBe("Next.\n");
	});
});
