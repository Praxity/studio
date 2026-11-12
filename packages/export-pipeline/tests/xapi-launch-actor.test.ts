import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { XapiRuntime } from "../src/scorm/api/xapi";

const windows: JSDOM[] = [];
afterEach(() => {
	for (const dom of windows.splice(0)) dom.window.close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const config = {
	endpoint: "https://lrs.example/statements",
	auth: "test",
	actorMode: "lms" as const,
};
function launch(actor: unknown) {
	const dom = new JSDOM("", {
		url: `https://course.example/lesson.html?actor=${encodeURIComponent(JSON.stringify(actor))}`,
	});
	windows.push(dom);
	vi.stubGlobal("window", dom.window);
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
	return dom;
}
it.each([undefined, ""])(
	"accepts a mailbox-identified learner with optional display name %j and restores their progress",
	(name) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const dom = launch({
			mbox: "mailto:learner@example.com",
			...(name === undefined ? {} : { name }),
		});
		const runtime = new XapiRuntime(config, "course");
		expect(runtime.initialize()).toBe(true);
		expect(runtime.getLearnerIdentity()).toEqual({ learnerId: "mailto:learner@example.com" });
		runtime.trackPageVisit("p1");
		expect(runtime.setSuspendData('{"blockState":{"journal":"saved"}}')).toBe(true);
		runtime.trackInteraction("ordinary", "answer", true, 100);
		expect(
			runtime.buildStatement("answered", { id: "https://course.example/question" }).actor,
		).toEqual({ mbox: "mailto:learner@example.com" });
		dom.window.history.replaceState(null, "", "/second.html");
		const restored = new XapiRuntime(config, "course");
		expect(restored.getLearnerIdentity()).toEqual({ learnerId: "mailto:learner@example.com" });
		expect(restored.getVisitedPages()).toEqual(["p1"]);
		expect(restored.getSuspendData()).toBe('{"blockState":{"journal":"saved"}}');
		expect(restored.getInteractions()[0].response).toBe("answer");
		expect(warn).not.toHaveBeenCalled();
	},
);
it.each([
	{},
	{ name: "Learner" },
	{ mbox: "" },
	{ mbox: 42 },
	{ mbox: "mailto:learner@example.com", name: 42 },
])("still refuses malformed or unidentified launch actor %j", (actor) => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	launch(actor);
	const runtime = new XapiRuntime(config, "course");
	expect(runtime.getLearnerIdentity()).toBeNull();
	expect(runtime.setSuspendData('{"saved":true}')).toBe(false);
});
