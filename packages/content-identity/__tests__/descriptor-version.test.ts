import { expect, it } from "vitest";
import { parseIdentityReadSnapshot } from "../src/files.ts";
import {
	parseIdentitySnapshot,
	parseIdentitySnapshotRecord,
	serializeIdentity,
} from "../src/index.ts";
import { digest, legacyFixture } from "./legacy-store-fixture.ts";

const readers = [
	["snapshot", parseIdentitySnapshot],
	["retained record", parseIdentitySnapshotRecord],
	["runtime read snapshot", parseIdentityReadSnapshot],
] as const;
function versioned(version: unknown = 2) {
	const snapshot = legacyFixture("reader-roles").snapshot;
	const node = Object.values(snapshot.nodes).find((node) => node.type === "choice");
	if (!node) throw new Error("Missing choice fixture");
	Object.assign(node, { canonicalVersion: version });
	return snapshot;
}

it.each(readers)(
	"%s accepts mixed legacy and version-2 nodes without changing schema 1",
	(_name, parse) => {
		const snapshot = versioned();
		const text = serializeIdentity(snapshot);
		const result = parse(text, { digest, expectedHash: digest(text) });
		expect("snapshot" in result ? result.snapshot : result).toEqual(snapshot);
	},
);

it.each([[null], [0], [1], [3], ["2"], [true], [{}], [[]]])(
	"refuses an unsupported canonicalVersion %j",
	(version) => {
		for (const [, parse] of readers) {
			const text = serializeIdentity(versioned(version));
			expect(() => parse(text, { digest, expectedHash: digest(text) })).toThrow(
				"unknown canonical version",
			);
		}
	},
);

it("still refuses a version-2 fingerprint mismatch even at a valid new content address", () => {
	const snapshot = versioned();
	const node = Object.values(snapshot.nodes).find((node) => node.type === "choice");
	if (!node) throw new Error("Missing choice fixture");
	node.fingerprint = "0".repeat(64);
	const text = serializeIdentity(snapshot);
	for (const [, parse] of readers)
		expect(() => parse(text, { digest, expectedHash: digest(text) })).toThrow(
			"node fingerprint hash mismatch",
		);
});

it("refuses immutable snapshots changed only by adding a valid version field", () => {
	const fixture = legacyFixture("reader-roles");
	const text = serializeIdentity(versioned());
	for (const parse of [parseIdentitySnapshot, parseIdentitySnapshotRecord])
		expect(() => parse(text, { digest, expectedHash: fixture.head.head })).toThrow(
			"snapshot hash mismatch",
		);
});
