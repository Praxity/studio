import { expect, it } from "vitest";
import { parseCourseManifest } from "../course-manifest";
import { parseNarrationSidecarV2 } from "../narration-sidecar";

it("parses CRLF course metadata and narration scripts as LF text", () => {
	expect(
		parseCourseManifest(
			"title: Course\r\ndescription: |\r\n  First.\r\n  Second.\r\nlessons: []\r\n",
		),
	).toMatchObject({ title: "Course", description: "First.\nSecond.\n" });
	const narration = parseNarrationSidecarV2(
		"version: 2\r\ncourseId: 00000000-0000-4000-8000-000000000001\r\nlessons:\r\n  00000000-0000-4000-8000-000000000002:\r\n    segments:\r\n      - target:\r\n          id: 00000000-0000-4000-8000-000000000003\r\n          role: title\r\n        script: |\r\n          First.\r\n          Second.\r\n",
	);
	expect(narration.lessons["00000000-0000-4000-8000-000000000002"].segments?.[0].script).toBe(
		"First.\nSecond.\n",
	);
});
