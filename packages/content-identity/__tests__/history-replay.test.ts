import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertLeadershipGate, type HistoryCorpus, replayHistory } from "../scripts/history-replay";
import { serializeIdentity } from "../src/index";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const text =
	"Praxity tools run on your computer and help authors prepare clear practical lessons for learners with useful examples.";
const occurrence = (path: number[]) => ({
	file: "welcome.prax",
	path,
	kind:
		path.length === 0
			? ("lesson" as const)
			: path.length === 1
				? ("page" as const)
				: ("block" as const),
	type: path.length === 0 ? "lesson" : path.length === 1 ? "page" : "body",
});
function fixture() {
	const input: HistoryCorpus = {
		schema: 1,
		snapshots: [
			{
				commit: "before",
				proofHash: "",
				sources: { "welcome.prax": `# Page\n${text}\n` },
				occurrences: {
					lesson: occurrence([]),
					page: occurrence([0]),
					paragraph: occurrence([0, 0]),
				},
			},
			{
				commit: "after",
				proofHash: "",
				sources: {
					"welcome.prax": `# Page\n${text.replace("computer", "computre")}\n\nNew material.\n`,
				},
				occurrences: {
					lesson: occurrence([]),
					page: occurrence([0]),
					paragraph: occurrence([0, 0]),
					inserted: occurrence([0, 1]),
				},
			},
		],
		transitions: [
			{
				old: "before",
				new: "after",
				pairs: { lesson: "lesson", page: "page", paragraph: "paragraph" },
			},
		],
	};
	const proofs = new Map<string, string>();
	const archive = (snapshot: HistoryCorpus["snapshots"][number], override = {}) => {
		const proof = {
			schema: 1,
			commit: snapshot.commit,
			checks: { semantic: true, literal: true, publishedOutput: true, mutations: true },
			sourceHashes: Object.fromEntries(
				Object.entries(snapshot.sources).map(([file, source]) => [file, digest(source)]),
			),
			occurrences: structuredClone(snapshot.occurrences),
			aliases: [] as { keys: string[]; reason: string }[],
			...override,
		};
		const raw = serializeIdentity(proof);
		snapshot.proofHash = digest(raw);
		proofs.set(snapshot.proofHash, raw);
		return proof;
	};
	input.snapshots.forEach((snapshot) => archive(snapshot));
	let n = 1;
	const deps = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`,
		loadProof: (hash: string) => {
			const raw = proofs.get(hash);
			if (raw === undefined) throw new Error(`Missing archived C2 proof ${hash}`);
			return raw;
		},
	};
	return { input, deps, proofs, archive };
}

describe("I2 C2 history replay interface", () => {
	it("scores proven converted occurrences against independent labels through the resolver", () => {
		const { input, deps } = fixture();
		const unchanged = JSON.stringify(input);
		const result = replayHistory(input, deps);
		expect(result.counts).toEqual({ continuing: 3, retained: 3, lost: 0, wrong: 0, new: 1 });
		expect(result.failures).toEqual([]);
		expect(JSON.stringify(input)).toBe(unchanged);
		expect(result.proofs).toEqual(
			input.snapshots.map((s) => ({ commit: s.commit, proofHash: s.proofHash })),
		);
	});
	it("wrong author labels remain visible in the report", () => {
		const { input, deps } = fixture();
		delete input.transitions[0].pairs.paragraph;
		const result = replayHistory(input, deps);
		expect(result.counts.wrong).toBe(1);
		expect(result.failures).toEqual([
			expect.objectContaining({ key: "paragraph", result: "wrong" }),
		]);
	});
	it("each transition gets its complete previous snapshot even after a lesson disappears", () => {
		const { input, deps, archive } = fixture();
		input.snapshots[0].sources["removed.prax"] = "# Removed\nOld material.\n";
		input.snapshots[0].occurrences.removed = { ...occurrence([]), file: "removed.prax" };
		archive(input.snapshots[0]);
		input.snapshots.push({ ...structuredClone(input.snapshots[1]), commit: "third" });
		archive(input.snapshots[2]);
		input.transitions.push({
			old: "after",
			new: "third",
			pairs: { lesson: "lesson", page: "page", paragraph: "paragraph", inserted: "inserted" },
		});
		expect(replayHistory(input, deps).counts).toEqual({
			continuing: 7,
			retained: 7,
			lost: 0,
			wrong: 0,
			new: 1,
		});
	});
	it.each(["old", "new"] as const)("missing %s occurrence fails closed", (side) => {
		const { input, deps } = fixture();
		delete input.snapshots[side === "old" ? 0 : 1].occurrences.paragraph;
		expect(() => replayHistory(input, deps)).toThrow(/occurrence/i);
	});
	it("an occurrence outside the converted parse fails closed even if archived", () => {
		const { input, deps, archive } = fixture();
		input.snapshots[1].occurrences.paragraph.path = [0, 9];
		archive(input.snapshots[1]);
		expect(() => replayHistory(input, deps)).toThrow(/occurrence/i);
	});
	it("invalid proven converted source fails closed", () => {
		const { input, deps, archive } = fixture();
		input.snapshots[1].sources["welcome.prax"] = "# Page\n@icon{INVALID}\n";
		archive(input.snapshots[1]);
		expect(() => replayHistory(input, deps)).toThrow(/invalid/i);
	});
	it.each(["", "0".repeat(64)])("a missing archived proof fails closed, hash=%j", (hash) => {
		const { input, deps } = fixture();
		input.snapshots[0].proofHash = hash;
		expect(() => replayHistory(input, deps)).toThrow(/proof/i);
	});
	it("proof bytes must hash to their archive address", () => {
		const { input, deps, proofs } = fixture();
		proofs.set(input.snapshots[0].proofHash, `${proofs.get(input.snapshots[0].proofHash)} `);
		expect(() => replayHistory(input, deps)).toThrow(/proof.*hash/i);
	});
	it("an archived proof must belong to this commit", () => {
		const { input, deps } = fixture();
		input.snapshots[0].proofHash = input.snapshots[1].proofHash;
		expect(() => replayHistory(input, deps)).toThrow(/proof.*commit/i);
	});
	it.each(["semantic", "literal", "publishedOutput", "mutations"])(
		"C2 check %s must have passed",
		(check) => {
			const { input, deps, archive } = fixture();
			archive(input.snapshots[0], {
				checks: {
					semantic: true,
					literal: true,
					publishedOutput: true,
					mutations: true,
					[check]: false,
				},
			});
			expect(() => replayHistory(input, deps)).toThrow(/proof.*check/i);
		},
	);
	it.each(["changed", "added", "removed"])(
		"proof source hashes bind the complete source inventory, %s",
		(change) => {
			const { input, deps } = fixture();
			if (change === "changed") input.snapshots[0].sources["welcome.prax"] += "\n";
			if (change === "added") input.snapshots[0].sources["extra.prax"] = "# Extra\n";
			if (change === "removed") delete input.snapshots[0].sources["welcome.prax"];
			expect(() => replayHistory(input, deps)).toThrow(/proof.*source/i);
		},
	);
	it.each(["lost", "wrong"] as const)(
		"lesson-root aliases cannot conceal an honest %s match",
		(result) => {
			const { input, deps, archive } = fixture();
			if (result === "lost")
				input.snapshots[1].sources["welcome.prax"] =
					"# Page\nCompletely different material.\n\nNew material.\n";
			else {
				input.snapshots[0].sources["welcome.prax"] += "\nDifferent older paragraph.\n";
				input.snapshots[0].occurrences.paragraph.path = [0, 1];
			}
			input.snapshots.forEach((s) => archive(s));
			expect(replayHistory(input, deps).counts[result]).toBe(1);
			input.snapshots.forEach((s) => {
				s.occurrences.paragraph = occurrence([]);
			});
			expect(() => replayHistory(input, deps)).toThrow(/occurrence/i);
		},
	);
	it.each(["kind", "type"] as const)(
		"proof occurrence %s must match the converted node",
		(field) => {
			const { input, deps, archive } = fixture();
			input.snapshots[0].occurrences.paragraph[field] = "lesson";
			archive(input.snapshots[0]);
			expect(() => replayHistory(input, deps)).toThrow(/occurrence.*kind\/type/i);
		},
	);
	it.each([
		{ aliases: [] },
		{ aliases: [{ keys: ["lesson"], reason: "Incomplete alias" }] },
		{ aliases: [{ keys: ["lesson", "paragraph"], reason: "" }] },
	])("duplicate addresses require an exact justified C2 alias, $aliases", ({ aliases }) => {
		const { input, deps, archive } = fixture();
		input.snapshots[0].occurrences.paragraph = occurrence([]);
		archive(input.snapshots[0], { aliases });
		expect(() => replayHistory(input, deps)).toThrow(/alias|duplicate/i);
	});
	it("an explicit C2 conversion alias permits its exact occurrence group", () => {
		const { input, deps, archive } = fixture();
		input.snapshots.forEach((snapshot) => {
			snapshot.occurrences.overlap = structuredClone(snapshot.occurrences.paragraph);
			archive(snapshot, {
				aliases: [
					{
						keys: ["paragraph", "overlap"],
						reason: "The study body and paragraph convert to one grammar-4 body.",
					},
				],
			});
		});
		input.transitions[0].pairs.overlap = "overlap";
		expect(replayHistory(input, deps).counts).toEqual({
			continuing: 4,
			retained: 4,
			lost: 0,
			wrong: 0,
			new: 1,
		});
	});
	it("out-of-order or duplicate snapshots fail closed", () => {
		const { input, deps } = fixture();
		input.snapshots.reverse();
		expect(() => replayHistory(input, deps)).toThrow(/order/i);
		input.snapshots[0].commit = input.snapshots[1].commit;
		expect(() => replayHistory(input, deps)).toThrow(/duplicate/i);
	});
	it("the leadership gate refuses partial coverage, losses below target, and wrong matches", () => {
		const valid = {
			snapshots: 5,
			transitions: 4,
			counts: { continuing: 831, retained: 804, lost: 27, wrong: 0, new: 66 },
			failures: [],
			proofs: [],
		};
		expect(() => assertLeadershipGate(valid)).not.toThrow();
		for (const counts of [
			{ ...valid.counts, continuing: 830 },
			{ ...valid.counts, retained: 803, lost: 28 },
			{ ...valid.counts, wrong: 1 },
			{ ...valid.counts, new: 65 },
		])
			expect(() => assertLeadershipGate({ ...valid, counts })).toThrow(/gate/i);
		expect(() => assertLeadershipGate({ ...valid, snapshots: 4 })).toThrow(/gate/i);
	});
});
