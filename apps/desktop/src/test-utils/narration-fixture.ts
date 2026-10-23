import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type NarrationSidecarV2, updateNarrationV2Entry } from "@praxity/shared-blocks/narration";
import { parseLessonSource, resolveLessonSources } from "../main/lesson-source";
import { resolveLessonNarration } from "../shared/narration-sidecar";
import { persistFixtureIdentity } from "./identity-fixture";

/** Fixture setup pins identity before sidecars exist. Target roles come from the
 * same public resolver used by host preview, export and inspection. */
export async function narrationFixture(
	root: string,
	filename: string,
	sidecar?: NarrationSidecarV2,
) {
	await persistFixtureIdentity(root);
	const identity = await resolveLessonSources(root);
	const source = await readFile(join(root, filename), "utf8");
	const read = await parseLessonSource(root, filename, source, { identity });
	let current: NarrationSidecarV2 = sidecar ?? { version: 2, courseId: read.courseId, lessons: {} };
	current.lessons[read.lessonId] ??= { enabled: true, segments: [] };
	const resolved = resolveLessonNarration({
		read,
		courseId: read.courseId,
		lessonId: read.lessonId,
		sidecar: current,
		locale: "en",
		enabled: true,
		digest: (text) => createHash("sha256").update(text).digest("hex"),
	});
	return {
		read,
		get sidecar() {
			return current;
		},
		items: resolved.items,
		update: (
			target: Parameters<typeof updateNarrationV2Entry>[2],
			patch: Parameters<typeof updateNarrationV2Entry>[3],
		) => {
			current = updateNarrationV2Entry(current, read.lessonId, target, patch);
			return current;
		},
	};
}
