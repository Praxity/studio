import { tokenizeLesson } from "../../grammar/src/v4/lex";
import { getDefinition } from "../../grammar/src/v4/schema";
import { analyzeLessonTree } from "../../grammar/src/v4/tree";
import {
	describeDocument,
	type IdentityDependencies,
	type IdentityResolution,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

export interface HistoryOccurrence {
	file: string;
	path: number[];
	kind: "lesson" | "page" | "block" | "part";
	type: string;
}
/** C2 archives this binding with its conversion evidence; it is not manifest authority. */
export interface HistoryConversionProof {
	schema: 1;
	commit: string;
	checks: { semantic: true; literal: true; publishedOutput: true; mutations: true };
	sourceHashes: Record<string, string>;
	occurrences: Record<string, HistoryOccurrence>;
	aliases: { keys: string[]; reason: string }[];
}
export interface HistoryReplayDependencies extends IdentityDependencies {
	/** Load exact UTF-8 bytes of <proofHash>.json from the independent C2 archive. */
	loadProof: (proofHash: string) => string;
}
export interface HistoryCorpus {
	schema: 1;
	snapshots: {
		commit: string;
		/** SHA-256 of C2's archived conversion proof for this snapshot. */
		proofHash: string;
		sources: Record<string, string>;
		/** Study node key to converted tree address, supplied by the converter. */
		occurrences: Record<string, HistoryOccurrence>;
	}[];
	transitions: { old: string; new: string; pairs: Record<string, string> }[];
}
export interface HistoryReplayResult {
	snapshots: number;
	transitions: number;
	counts: { continuing: number; retained: number; lost: number; wrong: number; new: number };
	failures: {
		transition: string;
		key: string;
		expected: string | null;
		actual: string;
		result: "wrong" | "lost";
	}[];
	proofs: { commit: string; proofHash: string }[];
}
const fail = (message: string): never => {
	throw new Error(`History replay: ${message}`);
};
function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(`invalid ${label}`);
	return value as Record<string, unknown>;
}
const address = (occurrence: Pick<HistoryOccurrence, "file" | "path">) =>
	serializeIdentity([occurrence.file, occurrence.path]);

function verifyProof(
	snapshot: HistoryCorpus["snapshots"][number],
	descriptors: ReturnType<typeof describeDocument>,
	dependencies: HistoryReplayDependencies,
): void {
	if (!/^[a-f0-9]{64}$/u.test(snapshot.proofHash)) fail("missing C2 proof hash");
	if (typeof dependencies.loadProof !== "function") fail("missing archived C2 proof loader");
	const raw = dependencies.loadProof(snapshot.proofHash);
	if (dependencies.digest(raw) !== snapshot.proofHash) fail("C2 proof content hash mismatch");
	const proof = record(JSON.parse(raw), "C2 proof");
	if (proof.schema !== 1) fail("invalid C2 proof schema");
	if (proof.commit !== snapshot.commit) fail("C2 proof commit mismatch");
	const checks = record(proof.checks, "C2 proof checks");
	for (const check of ["semantic", "literal", "publishedOutput", "mutations"])
		if (checks[check] !== true) fail(`C2 proof check ${check} did not pass`);
	const hashes = record(proof.sourceHashes, "C2 proof source hashes");
	const sourceHashes = Object.fromEntries(
		Object.entries(snapshot.sources).map(([file, source]) => [file, dependencies.digest(source)]),
	);
	if (!Object.keys(hashes).length || serializeIdentity(hashes) !== serializeIdentity(sourceHashes))
		fail("C2 proof source hashes or inventory mismatch");
	if (!descriptors.length || descriptors.some((d) => !d.valid)) fail("invalid converted source");
	const occurrences = record(proof.occurrences, "C2 proof occurrences");
	if (
		!Object.keys(occurrences).length ||
		serializeIdentity(occurrences) !== serializeIdentity(snapshot.occurrences)
	)
		fail("C2 proof occurrence bindings or inventory mismatch");
	const nodes = new Map(descriptors.map((d) => [address(d), d]));
	const groups = new Map<string, string[]>();
	for (const [key, value] of Object.entries(occurrences)) {
		const occurrence = record(value, `proof occurrence ${key}`);
		if (
			typeof occurrence.file !== "string" ||
			!Array.isArray(occurrence.path) ||
			occurrence.path.some((i) => !Number.isSafeInteger(i) || i < 0)
		)
			fail(`invalid proof occurrence address ${key}`);
		const target = address(occurrence as unknown as HistoryOccurrence);
		const node =
			nodes.get(target) ??
			fail(`occurrence ${snapshot.commit}/${key} is outside the converted parse`);
		if (node.kind !== occurrence.kind || node.type !== occurrence.type)
			fail(`occurrence ${snapshot.commit}/${key} kind/type differs from converted node`);
		groups.set(target, [...(groups.get(target) ?? []), key]);
	}
	const aliases = Array.isArray(proof.aliases) ? proof.aliases : fail("missing C2 proof aliases");
	const justified = new Set<string>();
	for (const value of aliases) {
		const alias = record(value, "C2 proof alias");
		if (
			!Array.isArray(alias.keys) ||
			alias.keys.length < 2 ||
			alias.keys.some((key) => typeof key !== "string") ||
			new Set(alias.keys).size !== alias.keys.length ||
			typeof alias.reason !== "string" ||
			!alias.reason.trim()
		)
			fail("invalid C2 proof alias justification");
		const keys = alias.keys as string[];
		const first = occurrences[keys[0]] as HistoryOccurrence | undefined;
		const target = address(first ?? fail("unknown C2 proof alias occurrence"));
		if (
			justified.has(target) ||
			serializeIdentity([...keys].sort()) !==
				serializeIdentity([...(groups.get(target) ?? [])].sort())
		)
			fail("C2 proof alias does not justify the exact duplicate address group");
		justified.add(target);
	}
	for (const [target, keys] of groups)
		if (keys.length > 1 && !justified.has(target))
			fail(`duplicate occurrence address without C2 alias: ${keys.join(", ")}`);
}
export function replayHistory(
	input: HistoryCorpus,
	dependencies: HistoryReplayDependencies,
): HistoryReplayResult {
	if (
		input.schema !== 1 ||
		!input.snapshots.length ||
		input.transitions.length !== input.snapshots.length - 1
	)
		fail("schema or incomplete snapshot order");
	if (new Set(input.snapshots.map((s) => s.commit)).size !== input.snapshots.length)
		fail("duplicate snapshot");
	for (const [index, transition] of input.transitions.entries())
		if (
			transition.old !== input.snapshots[index].commit ||
			transition.new !== input.snapshots[index + 1].commit
		)
			fail("invalid transition order");
	const parsed = input.snapshots.map((snapshot) => {
		const documents = Object.entries(snapshot.sources).map(([path, source]) => ({
			path,
			tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
		}));
		verifyProof(
			snapshot,
			documents.flatMap((document) => describeDocument(document)),
			dependencies,
		);
		return documents;
	});
	const result: HistoryReplayResult = {
		snapshots: input.snapshots.length,
		transitions: input.transitions.length,
		counts: { continuing: 0, retained: 0, lost: 0, wrong: 0, new: 0 },
		failures: [],
		proofs: input.snapshots.map((s) => ({ commit: s.commit, proofHash: s.proofHash })),
	};
	const project = (snapshot: HistoryCorpus["snapshots"][number], state: IdentityResolution) => {
		const addresses = new Map(state.sourceMappings.map((m) => [address(m), m.id]));
		const ids = new Map<string, string>();
		for (const [key, occurrence] of Object.entries(snapshot.occurrences)) {
			const id =
				addresses.get(address(occurrence)) ??
				fail(`occurrence ${snapshot.commit}/${key} is outside the converted parse`);
			ids.set(key, id);
		}
		return ids;
	};
	for (let index = 0; index < input.transitions.length; index++) {
		const transition = input.transitions[index];
		const previous = input.snapshots[index];
		const next = input.snapshots[index + 1];
		// evaluate.py scores each pair independently. Preserve that denominator and oracle.
		const before = resolveIdentity(
			{ parsedDocuments: parsed[index], priorSnapshots: [] },
			dependencies,
		);
		const oldIds = project(previous, before);
		const state = resolveIdentity(
			{
				course: before.course,
				parsedDocuments: parsed[index + 1],
				priorHeads: before.heads,
				priorSnapshots: before.snapshots,
			},
			dependencies,
		);
		const newIds = project(next, state);
		for (const [key, oldKey] of Object.entries(transition.pairs)) {
			if (!newIds.has(key) || !oldIds.has(oldKey))
				fail(`missing labelled occurrence ${key}/${oldKey}`);
		}
		const priorIds = new Set(before.sourceMappings.map((m) => m.id));
		for (const [key, actual] of newIds) {
			const oldKey = transition.pairs[key];
			const expected = oldKey === undefined ? undefined : oldIds.get(oldKey);
			if (expected !== undefined) result.counts.continuing++;
			else result.counts.new++;
			if (expected === actual) result.counts.retained++;
			else if (priorIds.has(actual)) {
				result.counts.wrong++;
				result.failures.push({
					transition: `${transition.old}..${transition.new}`,
					key,
					expected: oldKey ?? null,
					actual,
					result: "wrong",
				});
			} else if (expected !== undefined) {
				result.counts.lost++;
				result.failures.push({
					transition: `${transition.old}..${transition.new}`,
					key,
					expected: oldKey,
					actual,
					result: "lost",
				});
			}
		}
	}
	return result;
}
export function assertLeadershipGate(result: HistoryReplayResult): void {
	if (
		result.snapshots !== 5 ||
		result.transitions !== 4 ||
		result.counts.continuing !== 831 ||
		result.counts.new !== 66 ||
		result.counts.retained < 804 ||
		result.counts.wrong !== 0 ||
		result.counts.retained + result.counts.lost !== 831
	)
		throw new Error(`Leadership history gate failed: ${JSON.stringify(result.counts)}`);
}
