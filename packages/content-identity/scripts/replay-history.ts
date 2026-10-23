import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { serializeIdentity } from "../src/index";
import { assertLeadershipGate, type HistoryCorpus, replayHistory } from "./history-replay";

const [manifest, report, archive] = process.argv.slice(2);
if (!manifest || !report || (process.argv.length !== 4 && process.argv.length !== 5))
	throw new Error(
		"Usage: pnpm exec tsx packages/content-identity/scripts/replay-history.ts <C2-manifest.json> <report.json> [C2-proof-directory]",
	);
const input: HistoryCorpus = JSON.parse(readFileSync(manifest, "utf8"));
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const proofDirectory = archive ? resolve(archive) : join(dirname(resolve(manifest)), "proofs");
// Canonical hash of the study's four {old,new,pairs} records, in chronological order.
// Changing an oracle requires a separately reviewed study, never a local gate override.
if (
	digest(serializeIdentity(input.transitions)) !==
	"d89c0815a83ec1f19a202a153df27cd1bc53f53d49291b22d155b667ad58df3e"
)
	throw new Error("Leadership history labels differ from the archived study");
const inventory = input.snapshots.map((snapshot) => ({
	commit: snapshot.commit,
	keys: Object.keys(snapshot.occurrences).sort(),
}));
if (
	digest(serializeIdentity(inventory)) !==
	"8ba40ccd50e45decde237a8438c8b958f3ba671fd018a7b2b96b0df20f71d7c3"
)
	throw new Error("Leadership history occurrence inventory differs from the archived study");
const result = replayHistory(input, {
	allocateId: randomUUID,
	digest,
	loadProof: (hash) => readFileSync(join(proofDirectory, `${hash}.json`), "utf8"),
});
// Archive wrong/lost cases before checking the gate, including a failing result.
writeFileSync(report, `${JSON.stringify(result, null, 2)}\n`, "utf8");
assertLeadershipGate(result);
console.log(JSON.stringify(result.counts));
