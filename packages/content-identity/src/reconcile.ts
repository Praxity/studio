import { lexicalScore, lexicalTokens, normalizeText, serializeIdentity } from "./canonical.ts";
import type { CanonicalDescriptor, IdentityNode } from "./types.ts";

export interface PriorDescriptor {
	id: string;
	file: string;
	node: IdentityNode;
}
export const identityKey = (node: Pick<IdentityNode, "kind" | "type" | "canonical">) =>
	serializeIdentity([node.kind, node.type, node.canonical]);
const parentKey = (d: CanonicalDescriptor) => serializeIdentity([d.file, d.parentPath]);
const compatible = (a: IdentityNode, b: CanonicalDescriptor) =>
	a.kind === b.kind && a.type === b.type;

/** Reject multi-fragment coverage, including small tails the study's guard misses. */
function fragments<D, P>(
	donors: readonly D[],
	parts: readonly P[],
	donorText: (donor: D) => string,
	partText: (part: P) => string,
	sameType: (donor: D, part: P) => boolean,
	adjacent: (a: P, b: P) => boolean,
	order: (part: P) => number,
): { donors: Set<D>; parts: Set<P> } {
	const blocked = { donors: new Set<D>(), parts: new Set<P>() };
	for (const donor of donors) {
		const x = lexicalTokens(donorText(donor));
		if (x.length < 2) continue;
		const chunks: { start: number; end: number; part: P }[] = [];
		for (const part of parts) {
			if (!sameType(donor, part)) continue;
			const y = lexicalTokens(partText(part));
			if (!y.length || y.length >= x.length) continue;
			const starts: number[] = [];
			for (let i = 0; i <= x.length - y.length; i++)
				if (y.every((word, j) => word === x[i + j])) starts.push(i);
			for (const start of starts) chunks.push({ start, end: start + y.length, part });
		}
		chunks.sort((a, b) => a.start - b.start || a.end - b.end);
		// Repeated words may give a tail several possible positions. Memoize coverage
		// instead of enumerating every path; monotonic sibling order forbids reusing a part.
		const paths = new Map<string, Set<P> | null>();
		const visit = (index: number, coverage: number, direction: number): Set<P> | null => {
			const key = `${index}:${coverage}:${direction}`;
			if (paths.has(key)) return paths.get(key) ?? null;
			const last = chunks[index];
			let found =
				direction && last.end >= 0.95 * x.length && coverage >= 0.95 * x.length
					? new Set([last.part])
					: null;
			for (let j = index + 1; j < chunks.length; j++) {
				const next = chunks[j];
				if (last.end > next.start || !adjacent(last.part, next.part)) continue;
				const step = Math.sign(order(next.part) - order(last.part));
				if (direction && step !== direction) continue;
				const suffix = visit(j, coverage + next.end - next.start, step);
				if (!suffix) continue;
				found ??= new Set([last.part]);
				for (const part of suffix) found.add(part);
			}
			paths.set(key, found);
			return found;
		};
		for (let i = 0; i < chunks.length; i++) {
			const first = chunks[i];
			if (first.start >= 0.05 * x.length) continue;
			const parts = visit(i, first.end - first.start, 0);
			if (!parts) continue;
			blocked.donors.add(donor);
			for (const part of parts) blocked.parts.add(part);
		}
	}
	return blocked;
}

/** Returns only mutual, sufficiently separated matches. No IDs are allocated here. */
export function matchSimilar(
	old: readonly PriorDescriptor[],
	current: readonly CanonicalDescriptor[],
	bindings: ReadonlyMap<CanonicalDescriptor, string>,
	kind: IdentityNode["kind"],
	/** Accept this depth only; all unmatched descriptors still compete in the frozen matrix. */
	targets?: ReadonlySet<CanonicalDescriptor>,
): [CanonicalDescriptor, string][] {
	const used = new Set(bindings.values());
	const previous = old.filter((a) => a.node.kind === kind && !used.has(a.id));
	const next = current.filter((b) => b.kind === kind && !bindings.has(b) && b.valid);
	const split = fragments(
		previous,
		next,
		(a) => a.node.matchText,
		(b) => b.matchText,
		(a, b) => compatible(a.node, b),
		(a, b) => parentKey(a) === parentKey(b) && Math.abs(a.order - b.order) === 1,
		(b) => b.order,
	);
	const merge = fragments(
		next,
		previous,
		(b) => b.matchText,
		(a) => a.node.matchText,
		(b, a) => compatible(a.node, b),
		(a, b) => a.node.parent === b.node.parent && Math.abs(a.node.order - b.node.order) === 1,
		(a) => a.node.order,
	);
	const oldCounts = new Map<string, number>();
	const newCounts = new Map<string, number>();
	for (const a of old) {
		const key = identityKey(a.node);
		oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
	}
	for (const b of current) {
		const key = identityKey(b);
		newCounts.set(key, (newCounts.get(key) ?? 0) + 1);
	}
	const owners = new Map(
		current.map((b) => [serializeIdentity([b.file, b.path]), bindings.get(b)]),
	);
	const scores: {
		a: PriorDescriptor;
		b: CanonicalDescriptor;
		lexical: number;
		score: number;
		owner: boolean;
	}[] = [];
	for (const b of next) {
		if (split.parts.has(b) || merge.donors.has(b) || (newCounts.get(identityKey(b)) ?? 0) > 1)
			continue;
		for (const a of previous) {
			if (
				split.donors.has(a) ||
				merge.parts.has(a) ||
				!compatible(a.node, b) ||
				(oldCounts.get(identityKey(a.node)) ?? 0) > 1
			)
				continue;
			const l = lexicalScore(a.node.matchText, b.matchText);
			const owner =
				kind === "lesson"
					? a.file === b.file
					: a.node.parent !== null && owners.get(parentKey(b)) === a.node.parent;
			const oldSiblings = old
				.filter((x) => x.node.kind === kind && x.node.parent === a.node.parent)
				// An absent pending record can share an ordinal and start with a shifted sibling.
				.sort(
					(x, y) =>
						x.node.order - y.node.order ||
						x.node.span.start - y.node.span.start ||
						x.file.localeCompare(y.file) ||
						y.node.span.end - x.node.span.end ||
						x.node.canonical.localeCompare(y.node.canonical),
				);
			const newSiblings = current
				.filter((x) => x.kind === kind && parentKey(x) === parentKey(b))
				.sort((x, y) => x.order - y.order);
			const oi = oldSiblings.indexOf(a);
			const ni = newSiblings.indexOf(b);
			let anchors = 0;
			if (owner && oi === 0 && ni === 0) anchors++;
			if (owner && oi + 1 === oldSiblings.length && ni + 1 === newSiblings.length) anchors++;
			if (oi > 0 && ni > 0 && bindings.get(newSiblings[ni - 1]) === oldSiblings[oi - 1].id)
				anchors++;
			if (
				oi + 1 < oldSiblings.length &&
				ni + 1 < newSiblings.length &&
				bindings.get(newSiblings[ni + 1]) === oldSiblings[oi + 1].id
			)
				anchors++;
			const label = normalizeText(a.node.label);
			if (
				(kind === "lesson" || kind === "page") &&
				label &&
				label === normalizeText(b.label) &&
				previous.filter((x) => normalizeText(x.node.label) === label).length === 1 &&
				next.filter((x) => normalizeText(x.label) === label).length === 1
			)
				anchors = Math.max(anchors, 2);
			// Integer weights keep the inclusive .90 boundary exact when L=1 and A=0.
			let score = (70 * l + 20 * Number(owner) + 10 * (anchors / 2)) / 100;
			if (!owner && l >= 0.96) score = Math.max(score, l);
			scores.push({ a, b, lexical: l, score, owner });
		}
	}
	const result: [CanonicalDescriptor, string][] = [];
	for (const b of next) {
		if (targets && !targets.has(b)) continue;
		const ranked = scores.filter((s) => s.b === b).sort((a, b) => b.score - a.score);
		const best = ranked[0];
		if (!best || best.score < 0.9 || best.lexical < 0.8 || (!best.owner && best.lexical < 0.96))
			continue;
		// Keep sub-threshold competitors. Filtering them first defeats the mutual margin.
		const otherOld = ranked.slice(1).map((s) => s.score);
		const otherNew = scores.filter((s) => s.a === best.a && s.b !== b).map((s) => s.score);
		// One machine epsilon compensates for subtraction at an exact .15 margin.
		if (
			best.score - Math.max(0, ...otherOld) + Number.EPSILON < 0.15 ||
			best.score - Math.max(0, ...otherNew) + Number.EPSILON < 0.15
		)
			continue;
		result.push([b, best.a.id]);
	}
	return result;
}
