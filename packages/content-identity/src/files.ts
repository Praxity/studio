import { isDisplayNodeId, isIdentityNodeId, isRuntimeNodeId } from "@praxity/content-model/types";
import { serializeIdentity } from "./canonical.ts";
import type { CourseIdentity, IdentityNode, IdentitySnapshot, LessonHead } from "./types.ts";

function fail(message: string): never {
	throw new Error(`Identity: ${message}`);
}
export function assertId(value: unknown): asserts value is string {
	if (isRuntimeNodeId(value)) fail("runtime ID cannot be durable");
	if (!isIdentityNodeId(value)) fail("invalid UUID");
}
export function assertHash(value: unknown): asserts value is string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) fail("invalid SHA-256 hash");
}
export function assertPath(value: unknown): asserts value is string {
	if (
		typeof value !== "string" ||
		!value.endsWith(".prax") ||
		/[\\:\u0000-\u001f]/u.test(value) ||
		value.split("/").some((p) => !p || p === "." || p === "..")
	)
		fail("unsafe relative lesson path");
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
	return value as Record<string, unknown>;
}
function json(text: string): Record<string, unknown> {
	if (/^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/mu.test(text)) fail("conflict markers");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		fail("corrupt JSON");
	}
	const result = record(parsed);
	if (result.schema !== 1) fail("unknown schema");
	return result;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`unknown field ${key}`);
}
function strings(value: unknown): asserts value is string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
		fail("expected string array");
}
function integer(value: unknown): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) fail("expected nonnegative integer");
}
export function parseCourseIdentity(text: string, expectedCourseId?: string): CourseIdentity {
	const value = json(text);
	keys(value, ["schema", "courseId"]);
	assertId(value.courseId);
	if (expectedCourseId !== undefined) {
		assertId(expectedCourseId);
		if (value.courseId !== expectedCourseId) fail("course namespace mismatch");
	}
	return value as unknown as CourseIdentity;
}
export function parseLessonHead(text: string): LessonHead {
	const value = json(text);
	keys(value, ["schema", "path", "head"]);
	assertPath(value.path);
	assertHash(value.head);
	return value as unknown as LessonHead;
}
interface SnapshotOptions {
	courseId?: string;
	lessonId?: string;
	expectedHash?: string;
	digest?: (text: string) => string;
}

/** Namespace checks also apply when a store binds an already validated snapshot to a head. */
export function assertIdentitySnapshotNamespace(
	snapshot: Pick<IdentitySnapshot, "courseId" | "lessonId">,
	options: Pick<SnapshotOptions, "courseId" | "lessonId">,
): void {
	assertNamespace(snapshot, options, assertId);
}
function assertNamespace(
	snapshot: Pick<IdentitySnapshot, "courseId" | "lessonId">,
	options: Pick<SnapshotOptions, "courseId" | "lessonId">,
	checkId: typeof assertId,
): void {
	if (options.courseId !== undefined) checkId(options.courseId);
	if (options.lessonId !== undefined) checkId(options.lessonId);
	if (
		(options.courseId !== undefined && options.courseId !== snapshot.courseId) ||
		(options.lessonId !== undefined && options.lessonId !== snapshot.lessonId)
	)
		fail("namespace mismatch");
}

export { assertIdentitySnapshotNamespace as assertSnapshotNamespace };

function parseSnapshot(
	text: string,
	options: SnapshotOptions,
	checkId: typeof assertId = assertId,
): IdentitySnapshot {
	const value = json(text);
	keys(value, ["schema", "courseId", "lessonId", "parents", "sourceHash", "nodes"]);
	checkId(value.courseId);
	checkId(value.lessonId);
	assertNamespace({ courseId: value.courseId, lessonId: value.lessonId }, options, checkId);
	assertHash(value.sourceHash);
	strings(value.parents);
	value.parents.forEach(assertHash);
	if (new Set(value.parents).size !== value.parents.length) fail("duplicate snapshot parents");
	const nodes = record(value.nodes);
	for (const [id, raw] of Object.entries(nodes)) {
		checkId(id);
		const node = record(raw);
		keys(node, [
			"kind",
			"type",
			"parent",
			"order",
			"canonical",
			"canonicalVersion",
			"matchText",
			"label",
			"span",
			"fingerprint",
			"revision",
			"status",
			"lineage",
			"slug",
			"aliases",
			"consumerRevisions",
		]);
		if (node.canonicalVersion !== undefined && node.canonicalVersion !== 2)
			fail("unknown canonical version");
		if (!["lesson", "page", "block", "part"].includes(String(node.kind))) fail("unknown node kind");
		if (!["active", "retired", "pending", "cut"].includes(String(node.status)))
			fail("unknown node status");
		for (const key of ["type", "canonical", "matchText", "label"])
			if (typeof node[key] !== "string") fail(`invalid node ${key}`);
		if (node.parent !== null) {
			checkId(node.parent);
			if (!Object.hasOwn(nodes, node.parent)) fail("missing parent");
		}
		integer(node.order);
		const span = record(node.span);
		keys(span, ["start", "end", "tokenStart", "tokenEnd"]);
		for (const key of ["start", "end", "tokenStart", "tokenEnd"]) integer(span[key]);
		if (
			(span.start as number) > (span.end as number) ||
			(span.tokenStart as number) > (span.tokenEnd as number)
		)
			fail("invalid span");
		assertHash(node.fingerprint);
		assertHash(node.revision);
		strings(node.lineage);
		node.lineage.forEach(checkId);
		if (new Set(node.lineage).size !== node.lineage.length || node.lineage.includes(id))
			fail("invalid lineage");
		if (node.kind === "page") {
			if (node.slug !== null && typeof node.slug !== "string") fail("invalid page slug");
			strings(node.aliases);
		} else if (node.slug !== undefined || node.aliases !== undefined)
			fail("page fields on nonpage node");
		if (node.consumerRevisions !== undefined) {
			const revisions = record(node.consumerRevisions);
			keys(revisions, ["state"]);
			if (revisions.state !== undefined) {
				const state = record(revisions.state);
				keys(state, ["signature", "epoch"]);
				assertHash(state.signature);
				integer(state.epoch);
			}
		}
	}
	const root = record(nodes[value.lessonId]);
	if (root.kind !== "lesson" || root.parent !== null) fail("invalid lesson root parent");
	for (const [id, raw] of Object.entries(nodes)) {
		const node = raw as IdentityNode;
		if (node.kind === "lesson" && id !== value.lessonId) fail("extra lesson root");
		if (node.parent === null && id !== value.lessonId) fail("orphan node parent");
		const seen = new Set([id]);
		let parent = node.parent;
		while (parent !== null) {
			if (seen.has(parent)) fail("parent cycle");
			seen.add(parent);
			parent = (nodes[parent] as IdentityNode).parent;
		}
		if (options.digest) {
			const fingerprint = options.digest(node.canonical);
			assertHash(fingerprint);
			if (fingerprint !== node.fingerprint) fail("node fingerprint hash mismatch");
		}
	}
	return value as unknown as IdentitySnapshot;
}

export function parseIdentitySnapshot(
	text: string,
	options: SnapshotOptions = {},
): IdentitySnapshot {
	const snapshot = parseSnapshot(text, options);
	if (options.expectedHash !== undefined) {
		assertHash(options.expectedHash);
		if (!options.digest) fail("digest required for snapshot hash validation");
		if (hashIdentitySnapshot(snapshot, options.digest.bind(options)).hash !== options.expectedHash)
			fail("snapshot hash mismatch");
	}
	return snapshot;
}

/** Parsing the extension does not authorize the legacy matcher to consume it. */
export function assertLegacyIdentitySnapshot(snapshot: IdentitySnapshot): void {
	if (Object.values(snapshot.nodes).some((node) => node.canonicalVersion === 2))
		throw Object.assign(
			new Error("Identity: canonical version 2 requires a version-aware matcher"),
			{
				code: "EIDENTITY_CANONICAL_VERSION",
			},
		);
}

/** Package-private parser for the read session's own graphs, never durable ingress. */
export function parseIdentityReadSnapshot(
	text: string,
	options: Pick<SnapshotOptions, "courseId" | "digest">,
): IdentitySnapshot {
	function checkId(value: unknown): asserts value is string {
		if (!isDisplayNodeId(value)) fail("invalid display ID");
	}
	return parseSnapshot(text, options, checkId);
}

/** Plans and retained store records use the same canonical bytes and content address. */
export function hashIdentitySnapshot(
	snapshot: IdentitySnapshot,
	digest: (text: string) => string,
): { canonical: string; hash: string } {
	const canonical = serializeIdentity(snapshot);
	const hash = digest(canonical);
	assertHash(hash);
	return { canonical, hash };
}

/** Fresh validated data. The retaining store owns this record and its canonical bytes. */
export function parseIdentitySnapshotRecord(
	text: string,
	options: SnapshotOptions & { digest: (text: string) => string },
): { snapshot: IdentitySnapshot; canonical: string; hash: string } {
	const snapshot = parseSnapshot(text, options);
	if (options.expectedHash !== undefined) assertHash(options.expectedHash);
	const { canonical, hash } = hashIdentitySnapshot(snapshot, options.digest.bind(options));
	if (options.expectedHash !== undefined && hash !== options.expectedHash)
		fail("snapshot hash mismatch");
	return { snapshot, canonical, hash };
}
