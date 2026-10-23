import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import {
	assertIdentitySnapshotNamespace,
	parseIdentitySnapshot,
	parseIdentitySnapshotRecord,
	resolveIdentity,
	serializeIdentity,
} from "../src/index";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
	let id = 0;
	const result = resolveIdentity(
		{
			parsedDocuments: [{ path: "lesson.prax", tree: readLesson("# Page\n\nA sentence.\n").tree }],
			priorSnapshots: [],
		},
		{ digest, allocateId: () => uuid(++id) },
	);
	return result.snapshots[0];
}

it("validated records retain the original canonical serialization and its hash", () => {
	const snapshot = fixture();
	const canonical = serializeIdentity(snapshot);
	const expectedHash = digest(canonical);
	const text = JSON.stringify(snapshot, null, 2);
	const options = {
		digest,
		expectedHash,
		courseId: snapshot.courseId,
		lessonId: snapshot.lessonId,
	};
	const fresh = parseIdentitySnapshot(text, options);
	const inputs: string[] = [];
	const record = parseIdentitySnapshotRecord(text, {
		...options,
		digest: (text) => {
			inputs.push(text);
			return digest(text);
		},
	});
	expect(record.snapshot).toEqual(fresh);
	expect(record.canonical).toBe(canonical);
	expect(record.hash).toBe(expectedHash);
	expect(inputs.filter((text) => text === canonical)).toHaveLength(1);
	// Hash validation and head binding use the same namespace rule without another digest.
	assertIdentitySnapshotNamespace(record.snapshot, options);
	expect(inputs.filter((text) => text === canonical)).toHaveLength(1);
});

for (const options of [
	{ courseId: uuid(99) },
	{ lessonId: uuid(99) },
	{ courseId: "invalid" },
	{ lessonId: "invalid" },
]) {
	it(`head binding refuses namespace violations ${JSON.stringify(options)}`, () => {
		const snapshot = fixture();
		expect(() => assertIdentitySnapshotNamespace(snapshot, options)).toThrow(/namespace|UUID/);
		expect(() =>
			parseIdentitySnapshotRecord(serializeIdentity(snapshot), { ...options, digest }),
		).toThrow(/namespace|UUID/);
	});
}

it("record hashing refuses invalid digests and wrong or malformed content addresses", () => {
	const text = serializeIdentity(fixture());
	for (const expectedHash of ["bad", "0".repeat(64)])
		expect(() => parseIdentitySnapshotRecord(text, { expectedHash, digest })).toThrow(/hash/);
	expect(() => parseIdentitySnapshotRecord(text, { digest: () => "invalid" })).toThrow(/hash/);
	expect(() =>
		parseIdentitySnapshotRecord(text, {
			digest: (input) => (input === text ? "invalid" : digest(input)),
		}),
	).toThrow(/SHA-256 hash/);
});

it("records capture each digest configuration and never share mutable parsed state", () => {
	const text = serializeIdentity(fixture());
	const options = { digest, expectedHash: digest(text) };
	const expected = parseIdentitySnapshot(text, options);
	const first = parseIdentitySnapshotRecord(text, options);
	first.snapshot.nodes = {};
	expect(parseIdentitySnapshotRecord(text, options).snapshot).toEqual(expected);
	options.digest = () => "0".repeat(64);
	expect(() => parseIdentitySnapshotRecord(text, options)).toThrow(/fingerprint.*mismatch/);
});
