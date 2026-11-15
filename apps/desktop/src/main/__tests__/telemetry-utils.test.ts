import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { getMetricsFromBlocks } from "../telemetry-utils";

// PDF export reports these counts in the CLI result.
const metrics = (source: string) => getMetricsFromBlocks(readLesson(source).blocks);

it("counts parsed pages without an empty implicit first page", () => {
	expect(
		metrics(
			"---\ntitle: Welcome\nlang: en\n---\n\n# Welcome {hideTitle}\n\n## One idea\n\nPraxity tools run on your computer.\n",
		),
	).toMatchObject({ pageCount: 1, blockCount: 2 });
	expect(metrics("# Intro\n\n# Welcome {hideTitle}\n\nBody.\n").pageCount).toBe(2);
	expect(metrics("---\ntitle: Empty\n---\n").pageCount).toBe(0);
});
