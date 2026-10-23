import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { resolveIdentity, serializeIdentity } from "../src/index.ts";
import { digest, legacyFixture, modes, resolveLegacyFixture } from "./legacy-store-fixture.ts";

it.each(modes)("preserves the literal %s legacy assignments and store bytes", (mode) => {
	const fixture = legacyFixture(mode);
	const result = resolveLegacyFixture(mode);
	expect(result.course).toEqual(fixture.course);
	expect(result.heads).toEqual([fixture.head]);
	expect(result.sourceMappings).toEqual(fixture.expected.sourceMappings);
	expect(result.exportIds).toEqual(fixture.expected.exportIds);
	expect(result.unresolved).toEqual([]);
	expect(result.exportable).toBe(true);
	expect(serializeIdentity(result.snapshots[0])).toBe(
		fixture.read(`snapshots/${fixture.head.head}.json`),
	);
	expect(
		Object.fromEntries(Object.entries(result.snapshots[0].nodes).map(([id, n]) => [id, n.status])),
	).toEqual(fixture.expected.statuses);
	const cold = JSON.parse(
		execFileSync(
			process.execPath,
			["--import", "tsx", fileURLToPath(new URL("./legacy-store-cold.ts", import.meta.url)), mode],
			{ encoding: "utf8" },
		),
	);
	expect(cold).toEqual(result);
});

it.each(modes)("keeps fresh legacy writer bytes identical to the captured %s baseline", (mode) => {
	const fixture = legacyFixture(mode);
	let nextId = 0;
	const result = resolveIdentity(
		{
			parsedDocuments: [
				{ path: "lesson.prax", tree: readLesson(fixture.read("initial-source.prax")).tree },
			],
			priorSnapshots: [],
			readerRoles: fixture.expected.readerRoles,
		},
		{
			digest,
			allocateId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
		},
	);
	expect(serializeIdentity(result.course)).toBe(fixture.read("course.json"));
	expect(serializeIdentity(result.snapshots[0])).toBe(fixture.read("initial-snapshot.json"));
	expect(serializeIdentity(result.heads[0])).toBe(
		serializeIdentity({
			schema: 1,
			path: "lesson.prax",
			head: digest(fixture.read("initial-snapshot.json")),
		}),
	);
});
