import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import {
	parseIdentitySnapshot,
	parseIdentitySnapshotRecord,
	resolveIdentity,
	serializeIdentity,
} from "../src/index.ts";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

function fixture() {
	let nextId = 0;
	const identity = resolveIdentity(
		{
			parsedDocuments: [{ path: "lesson.prax", tree: readLesson("# Page\nText.\n").tree }],
			priorSnapshots: [],
		},
		{
			digest,
			allocateId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
		},
	);
	return identity.snapshots[0];
}

it("snapshot parsing and retained records reject malformed canonical digests", () => {
	const canonical = serializeIdentity(fixture());
	const options = {
		expectedHash: digest(canonical),
		digest: (text: string) => (text === canonical ? "invalid" : digest(text)),
	};
	for (const parse of [parseIdentitySnapshot, parseIdentitySnapshotRecord])
		expect(() => parse(canonical, options)).toThrow("invalid SHA-256 hash");
});

it("snapshot parsing and retained records preserve the digest hook receiver", () => {
	const snapshot = fixture();
	const canonical = serializeIdentity(snapshot);
	const options = {
		expectedHash: digest(canonical),
		hash: digest,
		digest(text: string): string {
			return this.hash(text);
		},
	};
	expect(parseIdentitySnapshot(canonical, options)).toEqual(snapshot);
	expect(parseIdentitySnapshotRecord(canonical, options)).toEqual({
		snapshot,
		canonical,
		hash: options.expectedHash,
	});
});
