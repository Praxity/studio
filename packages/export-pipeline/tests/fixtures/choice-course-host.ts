import {
	choiceContentSignature,
	choiceStateQuestion,
} from "@praxity/shared-blocks/assessment-choice";
import type { LearnerBlockStateRuntime } from "@praxity/shared-blocks/learner-block-state";
import type { AssessmentBlockData } from "@praxity/shared-blocks/types";
import { afterEach, expect, vi } from "vitest";
import { resolveAssessmentDontKnow } from "../../../content-model/src";
import { LocalStorageRuntime } from "../../src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../../src/scorm/types";
import { initializeScorm12Host } from "../../template/src/hosts/scorm12";
import { initializeStandaloneHost } from "../../template/src/hosts/standalone";

let active: (() => void) | undefined;
const storageKeys = new Set<string>();
afterEach(() => {
	active?.();
	active = undefined;
	for (const key of storageKeys) localStorage.removeItem(key);
	storageKeys.clear();
});

/** Install the production host, never a provider or evidence-view substitute. */
export function installChoiceCourseHost(
	id: string,
	data: AssessmentBlockData,
	format: "standalone" | "scorm12" = "standalone",
) {
	active?.();
	const block = resolveAssessmentDontKnow([
		{ id, type: "assessment", data: data as unknown as Record<string, unknown> },
	])[0];
	const dontKnow = block.data._dontKnow === true;
	const facts = {
		question: choiceStateQuestion(data, dontKnow),
		signature: choiceContentSignature(data, dontKnow),
	};
	const courseId = `choice-fixture-${id}`;
	storageKeys.add(`praxity:${encodeURIComponent(courseId)}:default:state`);
	const scripts = [
		[
			"praxity-host-config",
			{
				version: 1,
				courseId,
				pageId: "page",
				pageTitle: "Practice",
				currentPage: 1,
				totalPages: 2,
				currentSlug: "practice",
				availableSlugs: ["practice"],
				pageIdMap: { page: "practice" },
				completionMethod: "allPages",
				pageRole: "content",
				strings: {},
				choiceStateQuestions: { [id]: facts.question },
				choiceStateSignatures: { [id]: facts.signature },
			},
		],
		["praxity-deployment-config", { format }],
	].map(([id, value]) => {
		const script = document.createElement("script");
		script.id = id as string;
		script.type = "application/json";
		script.textContent = JSON.stringify(value);
		document.head.append(script);
		return script;
	});
	const disposals: Array<() => void> = [];
	const addDoc = document.addEventListener.bind(document),
		addWin = window.addEventListener.bind(window);
	const docSpy = vi.spyOn(document, "addEventListener").mockImplementation((...args) => {
		addDoc(...args);
		disposals.push(() => document.removeEventListener(...args));
	});
	const winSpy = vi.spyOn(window, "addEventListener").mockImplementation((...args) => {
		addWin(...args);
		disposals.push(() => window.removeEventListener(...args));
	});
	const ready = Object.getOwnPropertyDescriptor(document, "readyState");
	Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
	try {
		expect((format === "scorm12" ? initializeScorm12Host : initializeStandaloneHost)()).toBe(true);
	} finally {
		docSpy.mockRestore();
		winSpy.mockRestore();
	}
	const provider = window.__praxityBlockState as LearnerBlockStateRuntime;
	const runtime = window.__praxityRuntime as SCORMRuntime;
	expect(provider.getChoiceDependencyView?.()?.questions[id]).toEqual(facts.question);
	const write = vi.spyOn(provider, "set");
	active = () => {
		for (const dispose of disposals) dispose();
		for (const script of scripts) script.remove();
		if (ready) Object.defineProperty(document, "readyState", ready);
		else Reflect.deleteProperty(document, "readyState");
		for (const key of [
			"__praxityHostStarted",
			"__praxityRuntime",
			"__praxityBlockState",
			"__praxityTracker",
			"__praxityFinishCourse",
			"__praxityDecoratePageHref",
		])
			Reflect.deleteProperty(window, key);
	};
	return {
		provider,
		runtime,
		facts,
		write,
		values: {
			get: provider.get,
			clear: () => {
				expect(runtime).toBeInstanceOf(LocalStorageRuntime);
				(runtime as LocalStorageRuntime).resetState();
			},
		},
	};
}
