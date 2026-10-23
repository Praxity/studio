import type { LearnerBlockSaveResult } from "@praxity/shared-blocks/learner-block-state";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { CourseHostConfig } from "../../template/src/hosts/course-host";
import { bufferPrivateBlockState } from "../../template/src/hosts/privacy-bootstrap";
import { privacySupport } from "../../template/src/hosts/privacy-support";
import { createPrivateBlockStateRuntime } from "../../template/src/hosts/private-block-state";
import { createPrivateChoiceProvider } from "../../template/src/hosts/private-choice-bootstrap";
import { installPrivateChoiceNotices } from "../patterns/choice/enhance";
import { renderBlockHtml } from "../render-block-html";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";

const config = {
	version: 1,
	courseId: "course",
	pageId: "page",
	pageTitle: "Practice",
	currentPage: 1,
	totalPages: 1,
	currentSlug: "page",
	availableSlugs: ["page"],
	pageIdMap: { page: "page" },
	completionMethod: "allPages",
	pageRole: "content",
	strings: {},
	blockStatePolicy: { q: "device" },
} as CourseHostConfig;
const block: PraxityBlock = {
	id: "q",
	type: "assessment",
	data: {
		assessmentType: "choice",
		private: true,
		gradingMode: "none",
		stem: [],
		response: { type: "choice", selectionMode: "single", options: [] },
	},
};
const literal = {
	en: {
		mode: "Your answers stay in this browser and aren’t sent to the LMS.",
		shared: "Anyone using this browser may see them.",
		identified: "A new attempt starts fresh.",
		restoring: "Restoring your progress.",
		failure: "Your answer is not saved on this device. Keep a copy before leaving this page.",
	},
	fr: {
		mode: "Vos réponses restent dans ce navigateur et ne sont pas envoyées au LMS.",
		shared: "Toute personne qui utilise ce navigateur peut les voir.",
		identified: "Une nouvelle tentative repart de zéro.",
		restoring: "Restauration de votre progression.",
		failure:
			"Votre réponse n’est pas enregistrée sur cet appareil. Gardez-en une copie avant de quitter cette page.",
	},
};
function fixture(locale: "en" | "fr" = "en") {
	const html = `<div data-island="assessment" data-block-json='${JSON.stringify(block)}'>${renderBlockHtml(block, { sourceLocale: locale })}</div>`;
	const dom = new JSDOM(
		`<html lang="${locale}"><body>${html}<div role="status" id="unrelated">Unrelated</div></body></html>`,
		{ url: "https://course.test", pretendToBeVisual: true },
	);
	const win = dom.window as unknown as Window;
	vi.stubGlobal("MutationObserver", dom.window.MutationObserver);
	vi.stubGlobal("window", win);
	const node = (name: string) =>
		win.document.querySelector<HTMLElement>(`[data-practice-${name}]`)!;
	let result: LearnerBlockSaveResult | undefined;
	const provider = {
		get: () => undefined,
		set: () => {},
		getPolicy: () => "device" as const,
		getDeviceScope: () => "shared-device" as "identified" | "shared-device",
		getSaveResult: () => result,
	};
	win.__praxityBlockState = provider;
	return {
		dom,
		win,
		node,
		provider,
		result: (value: LearnerBlockSaveResult | undefined) => {
			result = value;
		},
		close: () => {
			dom.window.close();
			vi.unstubAllGlobals();
		},
	};
}
for (const locale of ["en", "fr"] as const)
	describe(`${locale} private choice notices`, () => {
		it("renders literal localized text, with only the device sentence initially visible", () => {
			const f = fixture(locale);
			try {
				expect(f.node("mode").firstChild?.textContent).toBe(literal[locale].mode);
				for (const name of ["shared", "identified", "restoring", "save"])
					expect(f.node(name).hidden).toBe(true);
				expect(f.node("shared").textContent?.trim()).toBe(literal[locale].shared);
				expect(f.node("identified").textContent?.trim()).toBe(literal[locale].identified);
				expect(f.node("restoring").textContent).toBe(literal[locale].restoring);
				expect(f.node("save").textContent).toBe(literal[locale].failure);
				expect(f.node("save").className).toBe("praxity-text-error");
			} finally {
				f.close();
			}
		});
		it.each(["identified", "shared-device"] as const)(
			"selects the %s provider capability",
			(scope) => {
				const f = fixture(locale);
				try {
					f.provider.getDeviceScope = () => scope;
					installPrivateChoiceNotices(f.win.document);
					expect(f.node("identified").hidden).toBe(scope !== "identified");
					expect(f.node("shared").hidden).toBe(scope !== "shared-device");
				} finally {
					f.close();
				}
			},
		);
		it("announces the first deliberate failure after passive failure, then once per recovery", () => {
			const f = fixture(locale);
			try {
				// An unrelated status inside the root must never be adopted.
				f.node("mode").parentElement!.append(f.win.document.querySelector("#unrelated")!);
				f.result({ status: "not-saved", code: "storage-unavailable" });
				const update = installPrivateChoiceNotices(f.win.document);
				expect(f.node("save").hidden).toBe(false);
				expect(f.node("status").textContent).toBe("");
				update("q", true);
				expect(f.node("status").textContent).toBe(literal[locale].failure);
				const text = f.node("status").firstChild;
				update("q", true);
				expect(f.node("status").firstChild).toBe(text);
				f.result({ status: "saved", destination: "device" });
				update();
				expect(f.node("status").textContent).toBe("");
				f.result({ status: "not-saved", code: "storage-unavailable" });
				update("q", true);
				expect(f.node("status").textContent).toBe(literal[locale].failure);
				expect(f.win.document.querySelector("#unrelated")?.textContent).toBe("Unrelated");
			} finally {
				f.close();
			}
		});
		it("keeps restore silent and remembers deliberate writes until the buffer settles", () => {
			const f = fixture(locale);
			try {
				f.result({ status: "not-saved", code: "runtime-loading" });
				const update = installPrivateChoiceNotices(f.win.document);
				update("q", true);
				expect(f.node("restoring").hidden).toBe(false);
				expect(f.node("shared").hidden).toBe(true);
				expect(f.node("status").textContent).toBe("");
				f.result({ status: "not-saved", code: "storage-unavailable" });
				update();
				expect(f.node("restoring").hidden).toBe(true);
				expect(f.node("status").textContent).toBe(literal[locale].failure);
				const root = f.win.document.querySelector("[data-island]")!;
				root.innerHTML = '<div class="praxity-assessment-actions"></div>';
				update();
				expect(f.node("status").textContent).toBe(literal[locale].failure);
				expect(root.querySelectorAll("[data-practice-status]")).toHaveLength(1);
			} finally {
				f.close();
			}
		});
	});

it.each([
	[null, false, "shared-device"],
	[{ learnerId: "learner" }, false, "shared-device"],
	[{ learnerId: "learner", attemptId: "attempt" }, false, "identified"],
	[{ learnerId: "learner", attemptId: "attempt" }, true, "shared-device"],
] as const)(
	"claims identified storage only after admission: %j / unavailable %s",
	(identity, unavailable, scope) => {
		const f = fixture();
		try {
			const runtime = new LocalStorageRuntime(f.win.localStorage, "course", "attempt");
			Object.assign(runtime, { getLearnerIdentity: () => identity });
			if (unavailable)
				Object.defineProperty(f.win, "localStorage", {
					get() {
						throw new Error("blocked");
					},
				});
			const args = [runtime, config, f.win] as const;
			const provider = createPrivateChoiceProvider([...args], createPrivateBlockStateRuntime);
			expect(provider.getDeviceScope("q")).toBe(scope);
		} finally {
			f.close();
		}
	},
);

it("does not announce passive failure for navigation or an empty Check", async () => {
	const f = fixture();
	try {
		f.result({ status: "not-saved", code: "storage-unavailable" });
		const actions = f.win.document.querySelector(".praxity-assessment-actions");
		if (!actions) throw new Error("Missing actions");
		actions.innerHTML = "<button>Continue</button><button data-assessment-submit>Check</button>";
		installPrivateChoiceNotices(f.win.document);
		for (const button of actions.querySelectorAll("button")) button.click();
		await new Promise((resolve) => f.win.requestAnimationFrame(resolve));
		expect(f.node("status").textContent).toBe("");
	} finally {
		f.close();
	}
});

it("waits for the actual store admission and preserves one new-attempt identity lookup", async () => {
	const f = fixture();
	try {
		const runtime = new LocalStorageRuntime(f.win.localStorage, "course", "attempt");
		const identity = vi.fn(() => ({
			learnerId: "learner",
			attemptId: "attempt",
			newAttempt: true,
		}));
		Object.assign(runtime, { getLearnerIdentity: identity });
		let resolve!: (support: typeof privacySupport) => void;
		const loaded = new Promise<typeof privacySupport>((done) => {
			resolve = done;
		});
		const provider = createPrivateChoiceProvider([runtime, config, f.win], (...args) =>
			bufferPrivateBlockState(args, loaded),
		);
		f.win.__praxityBlockState = provider;
		expect(identity).not.toHaveBeenCalled();
		expect(provider.getDeviceScope("q")).toBe("shared-device");
		resolve(privacySupport);
		await loaded;
		await Promise.resolve();
		expect(identity).toHaveBeenCalledOnce();
		expect(provider.getDeviceScope("q")).toBe("identified");
		expect(identity).toHaveBeenCalledOnce();
	} finally {
		f.close();
	}
});

it("settles a rejected privacy-support load into silent failure after runtime-ready", async () => {
	const f = fixture();
	try {
		let reject!: (reason: Error) => void;
		const loaded = new Promise<typeof privacySupport>((_resolve, fail) => {
			reject = fail;
		});
		// Match the bootstrap's promise ordering exactly.
		const ready = loaded.then(
			() => {},
			() => {},
		);
		const runtime = new LocalStorageRuntime(f.win.localStorage, "course", "attempt");
		f.win.__praxityBlockState = bufferPrivateBlockState([runtime, config, f.win], loaded);
		installPrivateChoiceNotices(f.win.document);
		reject(new Error("asset unavailable"));
		await ready;
		f.win.dispatchEvent(new f.dom.window.Event("praxity:runtime-ready"));
		await new Promise((resolve) => f.win.requestAnimationFrame(resolve));
		expect(f.node("restoring").hidden).toBe(true);
		expect(f.node("save").hidden).toBe(false);
		expect(f.node("status").textContent).toBe("");
	} finally {
		f.close();
	}
});

it("observes only cached private roots and installs nothing on an ordinary page", () => {
	const f = fixture();
	try {
		const observe = vi.spyOn(f.dom.window.MutationObserver.prototype, "observe");
		installPrivateChoiceNotices(f.win.document);
		expect(observe).toHaveBeenCalledTimes(1);
		expect(observe.mock.calls[0][0]).toBe(f.win.document.querySelector("[data-island]"));
		observe.mockClear();
		f.win.document.body.innerHTML =
			'<div data-island="assessment" data-block-json="invalid"></div>';
		installPrivateChoiceNotices(f.win.document);
		expect(observe).not.toHaveBeenCalled();
	} finally {
		f.close();
	}
});
