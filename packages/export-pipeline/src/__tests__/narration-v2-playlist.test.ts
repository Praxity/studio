import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { type NarrationSidecarV2, resolveNarrationV2 } from "@praxity/shared-blocks/narration";
import { expect, it } from "vitest";
import { narrationPlaylistFromConfig } from "../narration-playlist";

it("N1 grammar 4 playback keeps recorded order and assessment stops", () => {
	let sequence = 0;
	const id = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
	const courseId = id(),
		lessonId = id();
	const read = readLesson(
		"# Welcome\n\nStart.\n\n::: choice Choose\n(x) Yes\n( ) No\n:::\n\nEnd.\n",
		{ ids: id },
	);
	expect(read.hasErrors).toBe(false);
	const sidecar: NarrationSidecarV2 = {
		version: 2,
		courseId,
		lessons: { [lessonId]: { enabled: true, segments: [] } },
	};
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	const first = resolveNarrationV2({
		courseId,
		lessonId,
		pages: read.pages,
		sidecar,
		locale: "en",
		digest,
	});
	sidecar.lessons[lessonId].segments = first.pages[0].segments.map((s, index) => ({
		target: s.target,
		reviewedRevision: s.revision,
		audio: `${index}.mp3`,
	}));
	const resolved = resolveNarrationV2({
		courseId,
		lessonId,
		pages: read.pages,
		sidecar,
		locale: "en",
		digest,
	});
	const playlist = narrationPlaylistFromConfig({
		narrationEnabled: true,
		narrationSegments: resolved.pages[0].segments,
	});
	expect(playlist.items.map((item) => [item.src, item.authoredIndex, item.pauseAfter])).toEqual([
		["0.mp3", 0, false],
		["1.mp3", 1, false],
		["2.mp3", 2, true],
		["3.mp3", 3, false],
	]);
	const question = read.pages[0].blocks.find((block) => block.type === "assessment");
	expect(playlist.stops).toEqual([{ after: 3, blockId: question?.id }]);
});

it("N1 grammar 4 refuses a missing identity-resolved playlist", () => {
	expect(() => narrationPlaylistFromConfig({ grammarVersion: 4, narrationEnabled: true })).toThrow(
		/resolved/i,
	);
});
