import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readLesson } from "@praxity/grammar";
import {
	type IdentityStatus,
	parseCourseIdentity,
	parseIdentitySnapshot,
	parseLessonHead,
	resolveIdentity,
	type SourceMapping,
	serializeIdentity,
} from "../src/index.ts";

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const modes = ["tree-only", "reader-roles", "duplicate-projections"] as const;
export type LegacyMode = (typeof modes)[number];

export function legacyFixture(mode: LegacyMode) {
	const root = new URL(`./fixtures/legacy-store/${mode}/`, import.meta.url);
	const read = (file: string) =>
		readFileSync(
			new URL(file.endsWith(".json") && file !== "expected.json" ? `${file}.txt` : file, root),
			"utf8",
		);
	const expected = JSON.parse(read("expected.json")) as {
		readerRoles: boolean;
		history: string[];
		lessonId: string;
		sourceMappings: SourceMapping[];
		exportIds: string[];
		statuses: Record<string, IdentityStatus>;
	};
	const course = parseCourseIdentity(read("course.json"));
	const head = parseLessonHead(read("head.json"));
	const history = expected.history.map((hash) =>
		parseIdentitySnapshot(read(`snapshots/${hash}.json`), {
			courseId: course.courseId,
			lessonId: expected.lessonId,
			expectedHash: hash,
			digest,
		}),
	);
	const snapshot = history.find((_, index) => expected.history[index] === head.head);
	if (!snapshot) throw new Error("Missing legacy fixture head");
	const source = read("lesson.prax");
	return { read, expected, course, head, history, snapshot, source };
}

export function resolveLegacyFixture(mode: LegacyMode) {
	const fixture = legacyFixture(mode);
	return resolveIdentity(
		{
			course: fixture.course,
			priorHeads: [fixture.head],
			priorSnapshots: [fixture.snapshot],
			parsedDocuments: [{ path: "lesson.prax", tree: readLesson(fixture.source).tree }],
			// Deliberately infer reader roles from stored records.
		},
		{
			digest,
			allocateId: () => {
				throw new Error("Unchanged legacy source must not allocate an ID");
			},
		},
	);
}

/** Synthetic future descriptor, deliberately different from the legacy subtree. */
export function version2Fixture() {
	const fixture = legacyFixture("reader-roles");
	const node = Object.values(fixture.snapshot.nodes).find((node) => node.type === "accordion");
	if (!node) throw new Error("Missing accordion fixture");
	node.canonicalVersion = 2;
	node.canonical =
		'{"kind":"block","settings":{},"subject":[{"kind":"text","value":"Resources"}],"type":"accordion"}';
	node.matchText = "Resources";
	node.fingerprint = digest(node.canonical);
	fixture.head.head = digest(serializeIdentity(fixture.snapshot));
	return fixture;
}
