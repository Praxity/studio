import { VariableStore } from "@praxity/shared-blocks/logic";
import { enhanceHighlight } from "../../../src/patterns/highlight/enhance";
import { Scorm12Runtime } from "../../../src/scorm/api/scorm12";
import { Scorm2004Runtime } from "../../../src/scorm/api/scorm2004";
import { XapiRuntime } from "../../../src/scorm/api/xapi";
import { LocalStorageRuntime } from "../../../src/scorm/local-storage-runtime";
import type { SCORMRuntime } from "../../../src/scorm/types";
import {
	type CourseHostFormat,
	initializeCourseHost,
	initializeScormCourseHost,
} from "../../../template/src/hosts/course-host";
import { attachIsland as assessment } from "../../../template/src/islands/island-assessment";

function start() {
	const params = new URLSearchParams(location.search);
	const format = params.get("format") as CourseHostFormat;
	const identified = params.get("identified") === "true";
	const calls: string[] = [];
	const apiData = new Map<string, string>([
		["cmi.interactions._count", "0"],
		["cmi.objectives._count", "0"],
		["cmi.core.lesson_status", "incomplete"],
		["cmi.completion_status", "incomplete"],
	]);
	const get = (key: string) => apiData.get(key) ?? "";
	const set = (key: string, value: string) => {
		calls.push(JSON.stringify(["LMS-write", key, value]));
		apiData.set(key, value);
		return "true";
	};
	const commit = () => {
		calls.push("LMS-commit");
		return "true";
	};
	const api = {
		LMSInitialize: () => "true",
		LMSFinish: () => "true",
		LMSCommit: commit,
		LMSGetValue: get,
		LMSSetValue: set,
		LMSGetLastError: () => "0",
		LMSGetErrorString: () => "",
		LMSGetDiagnostic: () => "",
		Initialize: () => "true",
		Terminate: () => "true",
		Commit: commit,
		GetValue: get,
		SetValue: set,
		GetLastError: () => "0",
		GetErrorString: () => "",
		GetDiagnostic: () => "",
	};
	Object.assign(window, { API: api, API_1484_11: api });
	for (const name of ["getItem", "setItem", "removeItem", "clear"] as const) {
		const original = Storage.prototype[name];
		Storage.prototype[name] = function (...args: unknown[]) {
			calls.push(JSON.stringify(["storage", name, ...args]));
			return Reflect.apply(original, this, args);
		};
	}
	const actor = { name: "Learner", mbox: "mailto:learner@example.com" };
	const runtime: SCORMRuntime =
		format === "scorm12"
			? new Scorm12Runtime()
			: format === "scorm2004"
				? new Scorm2004Runtime(window)
				: format === "xapi"
					? new XapiRuntime(
							{
								endpoint: "https://lrs.example/statements",
								auth: "test",
								actorMode: identified ? "manual" : "lms",
								...(identified ? { actor } : {}),
							},
							"reporting-proof",
							localStorage,
						)
					: new LocalStorageRuntime(localStorage, "reporting-proof");
	runtime.getLearnerIdentity = () =>
		identified ? { learnerId: "learner", attemptId: "attempt", newAttempt: false } : null;
	for (const name of [
		"setBlockState",
		"getBlockState",
		"setSuspendData",
		"trackInteraction",
		"trackObjective",
		"setCompletion",
		"commit",
	] as const) {
		const original = runtime[name];
		if (original)
			Reflect.set(runtime, name, (...args: unknown[]) => {
				calls.push(JSON.stringify([name, ...args]));
				return Reflect.apply(original, runtime, args);
			});
	}
	document.addEventListener("praxity:assessment-response", (event) =>
		calls.push(JSON.stringify(["response", (event as CustomEvent).detail])),
	);
	const adapter = {
		format,
		createRuntime: () => runtime,
		readDeploymentConfig: () => ({ format }),
		...(format === "electron-preview" ? { deviceStateRuntime: runtime } : {}),
	};
	const environment = { win: window, doc: document, location, history };
	const started =
		format === "scorm12" || format === "scorm2004"
			? initializeScormCourseHost({ ...adapter, format, readEntry: () => null }, environment)
			: initializeCourseHost(adapter, environment);
	if (!started) throw new Error("Host did not start");

	const provider = window.__praxityBlockState!;
	for (const name of ["get", "set"] as const) {
		const original = provider[name];
		Reflect.set(provider, name, (...args: unknown[]) => {
			calls.push(JSON.stringify(["provider", name, ...args]));
			return Reflect.apply(original, provider, args);
		});
	}
	let instances: ReturnType<typeof enhanceHighlight>[] = [];
	function attach() {
		instances = [...document.querySelectorAll<HTMLElement>("[data-highlight]")].map(
			enhanceHighlight,
		);
	}
	attach();
	assessment();
	const variables = new VariableStore(
		[{ name: "publicFlag", dataType: "boolean", defaultValue: false }],
		runtime,
	);
	Reflect.set(window, "ReportProof", {
		snapshot: () => ({
			calls: [...calls],
			data: [...apiData],
			storage: [localStorage, sessionStorage].flatMap((storage, scope) =>
				Array.from({ length: storage.length }, (_, i) => {
					const key = storage.key(i)!;
					return [String(scope), key, storage.getItem(key)];
				}),
			),
			suspend: runtime.getSuspendData(),
		}),
		calls: () => [...calls],
		attach,
		reset: () => {
			if (runtime instanceof LocalStorageRuntime) runtime.resetState();
			else runtime.setSuspendData("{}");
		},
		remount: () => {
			instances.forEach((instance) => instance.destroy());
			attach();
		},
		setPublic: () => variables.set("publicFlag", true),
		shutdown: () => {
			if (format === "scorm12" || format === "scorm2004") {
				if (!window.__praxityFinishCourse?.()) throw new Error("SCORM host did not finish");
			} else {
				runtime.commit();
				runtime.terminate();
				window.__praxityRuntime = undefined;
				window.__praxityTracker = undefined;
				window.__praxityBlockState = undefined;
			}
		},
	});
}
if (document.readyState === "loading")
	document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
