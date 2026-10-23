import { expect, it } from "vitest";
import { getGrammarTelemetryMetrics } from "../telemetry-utils";

it("counts parsed pages without an empty implicit first page", () => {
	expect(
		getGrammarTelemetryMetrics(
			"---\ntitle: Welcome\nlang: en\n---\n\n# Welcome {hideTitle}\n\n## One idea\n\nPraxity tools run on your computer.\n",
		),
	).toMatchObject({ pageCount: 1, blockCount: 2 });
	expect(getGrammarTelemetryMetrics("# Intro\n\n# Welcome {hideTitle}\n\nBody.\n").pageCount).toBe(
		2,
	);
	expect(getGrammarTelemetryMetrics("---\ntitle: Empty\n---\n").pageCount).toBe(0);
});
