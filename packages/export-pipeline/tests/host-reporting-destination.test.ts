import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { XapiRuntime } from "../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../src/scorm/types";
import type { CourseHostConfig, CourseHostFormat } from "../template/src/hosts/course-host";
import { bufferPrivateBlockState } from "../template/src/hosts/privacy-bootstrap";
import { privacySupport } from "../template/src/hosts/privacy-support";
import { createPrivateBlockStateRuntime } from "../template/src/hosts/private-block-state";

it.each(["standalone", "scorm12", "scorm2004", "xapi"] as const)(
	"exposes %s reporting destination through the buffered and loaded provider",
	async (format: CourseHostFormat) => {
		const dom = new JSDOM("<!doctype html><html lang='en'>", { url: "https://course.example" });
		try {
			const local = new LocalStorageRuntime(dom.window.localStorage, "course");
			// The LMS adapter seam has no device-storage capability. xAPI stores drafts locally.
			const runtime =
				format === "standalone"
					? local
					: format === "xapi"
						? new XapiRuntime(
								{
									endpoint: "https://lrs.example/statements",
									auth: "",
									actor: { name: "Learner", mbox: "mailto:learner@example.com" },
								},
								"course",
								dom.window.localStorage,
							)
						: ({
								destinations: { reporting: "lms", state: "lms" },
								getSuspendData: () => null,
								hasPersistentStorage: () => true,
							} as SCORMRuntime);
			const page = {
				courseId: "course",
				strings: {},
				blockStatePolicy: { private: "device", reporting: "lms" },
			} as unknown as CourseHostConfig;
			let load!: (support: typeof privacySupport) => void;
			const loaded = new Promise<typeof privacySupport>((resolve) => {
				load = resolve;
			});
			const win = dom.window as unknown as Window;
			const buffer = bufferPrivateBlockState([runtime, page, win, local, format], loaded);
			const provider = createPrivateBlockStateRuntime(runtime, page, win, local, format);
			for (const state of [buffer, provider]) {
				expect(state.getPolicy?.("reporting")).toBe("lms");
				expect(state.getReportingDestination?.("private")).toBe("device");
				expect(state.getReportingDestination?.("reporting")).toBe(
					format === "standalone" ? "device" : "lms",
				);
			}
			load(privacySupport);
			await loaded;
			expect(buffer.getReportingDestination?.("reporting")).toBe(
				format === "standalone" ? "device" : "lms",
			);
			if (format === "xapi") {
				provider.set("reporting", "Answer");
				expect(provider.getSaveResult?.("reporting")).toEqual({
					status: "saved",
					destination: "device",
				});
				expect(
					createPrivateBlockStateRuntime(local, page, win, local, format).getReportingDestination?.(
						"reporting",
					),
				).toBe("device");
			}
		} finally {
			dom.window.close();
		}
	},
);

it.each([true, false])("exposes the resolved xAPI actor capability (%s)", async (actor) => {
	const query = actor
		? `?actor=${encodeURIComponent(JSON.stringify({ name: "Learner", mbox: "mailto:learner@example.com" }))}`
		: "";
	const dom = new JSDOM("<!doctype html>", { url: `https://course.example/${query}` });
	vi.stubGlobal("window", dom.window);
	try {
		const runtime = new XapiRuntime(
			{ endpoint: "https://lrs.example/statements", auth: "", actorMode: "lms" },
			"course",
			dom.window.localStorage,
		);
		const local = new LocalStorageRuntime(dom.window.localStorage, "private-course");
		const page = {
			courseId: "course",
			strings: {},
			blockStatePolicy: { private: "device", reporting: "lms" },
		} as unknown as CourseHostConfig;
		let load!: (support: typeof privacySupport) => void;
		const loaded = new Promise<typeof privacySupport>((resolve) => {
			load = resolve;
		});
		const win = dom.window as unknown as Window;
		const buffer = bufferPrivateBlockState([runtime, page, win, local, "xapi"], loaded);
		const provider = createPrivateBlockStateRuntime(runtime, page, win, local, "xapi");
		const check = (state: typeof provider) => {
			expect(state.getReportingDestination?.("private")).toBe("device");
			expect(state.getReportingDestination?.("reporting")).toBe(actor ? "lms" : "device");
		};
		check(buffer);
		check(provider);
		load(privacySupport);
		await loaded;
		check(buffer);
		for (const state of [buffer, provider]) {
			state.set("private", "Private answer");
			expect(state.getSaveResult?.("private")).toEqual({ status: "saved", destination: "device" });
			state.set("reporting", "Answer");
			expect(state.getSaveResult?.("reporting")).toEqual(
				actor
					? { status: "saved", destination: "device" }
					: { status: "not-saved", code: "storage-unavailable" },
			);
		}
	} finally {
		vi.unstubAllGlobals();
		dom.window.close();
	}
});
