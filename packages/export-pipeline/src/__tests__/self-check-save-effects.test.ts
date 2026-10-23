import type { LearnerStateValue } from "@praxity/shared-blocks/learner-state";
import {
	editSelfCheckDraft,
	resetSelfCheckState,
	restoreSelfCheckState,
	selfCheckContentRevision,
	submitSelfCheck,
} from "@praxity/shared-blocks/self-check-state";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { createBlockStateRuntime } from "../../template/src/hosts/block-state-runtime";
import { disposeSelfCheckDocument, selfCheckRuntime } from "../../template/src/self-check-runtime";
import { Scorm12Runtime } from "../scorm/api/scorm12";
import { Scorm2004Runtime } from "../scorm/api/scorm2004";
import { LocalStorageRuntime } from "../scorm/local-storage-runtime";

const content = {
	task: "Explain.",
	model: "A reason.",
	parts: [{ id: "reason", label: "Reason", missed: "Add a reason.", evidence: null }],
};
const revision = selfCheckContentRevision(content);
const actions = ["dispose", "replace", "reset", "edit", "retry"] as const;

afterEach(() => vi.unstubAllGlobals());

it.each(
	["file", "html", "scorm12", "scorm2004"].flatMap((host) =>
		actions.map((action) => ({ host, action })),
	),
)(
	"$host saves the submitted answer before a save receipt can $action its effects",
	async ({ host, action }) => {
		const dom = new JSDOM("", { url: "file:///course/page.html" });
		const storageDom = new JSDOM("", { url: "https://course.example/" });
		const doc = dom.window.document;
		vi.stubGlobal("window", dom.window);
		vi.stubGlobal("document", doc);
		vi.stubGlobal("Event", dom.window.Event);
		vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
		vi.stubGlobal("__PRAXITY_SELF_CHECK_BUILD__", "save-effects-test");
		vi.stubGlobal("__PRAXITY_SELF_CHECK_SUPPORT__", "self-check-support.js");
		const values = new Map<string, string>();
		const getValue = (key: string) => values.get(key) ?? (key.endsWith("entry") ? "resume" : "");
		const setValue = (key: string, value: string) => {
			values.set(key, value);
			return "true";
		};
		Object.assign(dom.window, {
			API: {
				LMSInitialize: () => "true",
				LMSFinish: () => "true",
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
				LMSGetValue: getValue,
				LMSSetValue: setValue,
			},
			API_1484_11: {
				Initialize: () => "true",
				Terminate: () => "true",
				Commit: () => "true",
				GetLastError: () => "0",
				GetValue: getValue,
				SetValue: setValue,
			},
			__praxitySelfCheckCore: { implementation: async () => undefined },
			__praxitySelfCheckSupport: {
				admit: async () => ({
					restore: (value: unknown) => restoreSelfCheckState(content, value),
					edit: (value: unknown, draft: Parameters<typeof editSelfCheckDraft>[2]) =>
						editSelfCheckDraft(content, value, draft),
					submit: (value: unknown) =>
						submitSelfCheck(content, value, { blockId: "check", language: "en" }),
					reset: resetSelfCheckState,
				}),
			},
		});
		// Exercise the real classic loader; only its external script transport is supplied here.
		const scripts = new dom.window.MutationObserver((records) => {
			for (const record of records)
				for (const node of record.addedNodes)
					if (node instanceof dom.window.HTMLScriptElement && node.src)
						node.dispatchEvent(new dom.window.Event("load"));
		});
		scripts.observe(doc.head, { childList: true });
		const providerForHost = () => {
			const runtime =
				host === "scorm12"
					? new Scorm12Runtime("course")
					: host === "scorm2004"
						? new Scorm2004Runtime()
						: new LocalStorageRuntime(storageDom.window.localStorage, "course");
			runtime.initialize();
			return createBlockStateRuntime(runtime);
		};
		try {
			const provider = providerForHost();
			Object.assign(dom.window, { __praxityBlockState: provider });
			doc.body.innerHTML = `<div data-self-check data-self-check-id="check" data-self-check-revision="${revision}" data-self-check-src="check.json"><textarea></textarea></div>`;
			const active = selfCheckRuntime(doc);
			active.session.startup("ready");
			await active.session.dispatch({ type: "edit", blockId: "check", answer: "Answer A" });
			await active.session.dispatch({ type: "retry", blockId: "check" });
			expect(active.session.read("check")).toMatchObject({ available: true, admitted: true });
			let fired = false;
			let successor: Promise<unknown> | undefined;
			const writes: LearnerStateValue[] = [];
			const set = provider.set;
			provider.set = (id, value) => {
				writes.push(structuredClone(value));
				set(id, value);
			};
			provider.getSaveResult = () => {
				if (!fired) {
					fired = true;
					if (action === "dispose") disposeSelfCheckDocument(doc);
					else if (action === "replace") dom.window.__praxityBlockState = providerForHost();
					else
						successor = active.session.dispatch(
							action === "edit"
								? { type: "edit", blockId: "check", answer: "Successor draft" }
								: { type: action === "reset" ? "start-over" : "retry", blockId: "check" },
						);
				}
				return {
					status: "saved",
					destination: host === "file" || host === "html" ? "device" : "lms",
				};
			};
			// Save-status projection may reenter; its receipt must follow the actual state write.
			const unsubscribe = active.subscribe((ticket) => {
				if (writes.length) ticket.call(() => provider.getSaveResult?.("check"));
			});
			await active.session.dispatch({ type: "show-feedback", blockId: "check" });
			await successor;
			const first = {
				version: 1,
				kind: "self-check",
				draft: { answer: "Answer A", ticked: [], shown: false },
				submitted: { answer: "Answer A", ticked: [], shown: true, contentRevision: revision },
			};
			const final =
				action === "reset"
					? { ...first, draft: { answer: "", ticked: [], shown: false }, submitted: null }
					: action === "edit"
						? { ...first, draft: { answer: "Successor draft", ticked: [], shown: false } }
						: first;
			expect(writes).toEqual(action === "reset" || action === "edit" ? [first, final] : [first]);
			expect(providerForHost().get("check")).toEqual(final);
			expect(fired).toBe(true);
			unsubscribe();
		} finally {
			disposeSelfCheckDocument(doc);
			scripts.disconnect();
			dom.window.close();
			storageDom.window.close();
		}
	},
);
