import { afterEach, expect, it, vi } from "vitest";
import { ScormCloudClient } from "../src/scorm-cloud/client";

afterEach(() => vi.unstubAllGlobals());
it.each([{ includeRuntime: true }, { includeInteractionsAndObjectives: true }])(
	"requests child activities for detailed progress %j",
	async (options) => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					registrationCompletion: "INCOMPLETE",
					registrationSuccess: "UNKNOWN",
					score: null,
					activityDetails: { children: [{ runtime: { suspendData: "saved", location: "quiz" } }] },
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		const progress = await new ScormCloudClient("synthetic", "synthetic").getProgress(
			"own-registration",
			options,
		);
		const url = new URL(fetchMock.mock.calls[0]?.[0]);
		expect(url.searchParams.get("includeChildResults")).toBe("true");
		if (options.includeRuntime)
			expect(progress.runtime).toMatchObject({ suspendData: "saved", location: "quiz" });
	},
);
