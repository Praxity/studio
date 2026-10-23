import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { compileBlockStatePolicy } from "@praxity/shared-blocks/block-state-policy";
import type { PraxityBlock } from "@praxity/shared-blocks/types";
import AdmZip from "adm-zip";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	assertViewerAssetsCurrent,
	assertViewerAssetsReady,
	bundleViewer,
	computeViewerSourceHash,
	type IslandManifestEntryName,
	islandFilesForEntries,
	requiredViewerAssetPaths,
	SELF_CHECK_INITIAL_RAW_CEILING,
	type ViewerBundleManifest,
	type ViewerHostName,
	viewerManifestAssetPaths,
	viewerSourceFiles,
} from "../bundle-viewer";
import { planModuleRuntime, planPageRuntime } from "../runtime-plan";
import { cacheViewerBundle, readCachedViewer } from "../viewer-cache.ts";

const { learnerAuthorityDirectories, scansLearnerAuthority } = createRequire(import.meta.url)(
	"../../../../scripts/check-source-owners.mjs",
) as {
	learnerAuthorityDirectories: string[];
	scansLearnerAuthority: (file: string, directories?: string[]) => boolean;
};

it("keeps AssessmentBlock's client directive as the first statement", async () => {
	const source = await readFile(
		new URL("../../../shared-blocks/src/blocks/AssessmentBlock.tsx", import.meta.url),
		"utf8",
	);
	const first = ts.createSourceFile(
		"AssessmentBlock.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	).statements[0];
	expect(
		first &&
			ts.isExpressionStatement(first) &&
			ts.isStringLiteral(first.expression) &&
			first.expression.text === "use client",
	).toBe(true);
});

const tempDirs: string[] = [];
const TEST_HOST_FILES = {
	standalone: "host-standalone-TEST.js",
	electronPreview: "host-electron-preview-TEST.js",
	scorm12: "host-scorm12-TEST.js",
	scorm2004: "host-scorm2004-TEST.js",
	xapi: "host-xapi-TEST.js",
} as const;
const TEST_RESUME_FILE = "course-resume-TEST.js";
const TEST_SHELL_FILE = "course-shell-TEST.js";
const TEST_ISLAND_ENTRIES = [
	"island-nav",
	"island-deck",
	"island-accordion",
	"island-tabs",
	"island-assessment",
	"island-assessment-group",
	"island-logic",
	"island-checklist",
	"island-self-check",
	"island-retrieval-sheet",
	"island-highlight",
	"island-write-distractors",
	"island-rating",
	"island-signature",
	"island-image-comparison",
	"island-labeled-graphic",
	"island-narration",
	"island-card",
	"island-code",
	"island-tooltip",
	"island-media",
	"island-sequence",
	"island-table",
	"island-loader",
] as const satisfies readonly IslandManifestEntryName[];
const TEST_ISLAND_FILES = Object.fromEntries(
	TEST_ISLAND_ENTRIES.map((entry) => [entry, `${entry}-TEST.js`]),
) as Record<IslandManifestEntryName, string>;
// Size caps don't block working features (owner rule): SHA-256 pair verification in the host bundle; tighten during final size work.
const HOST_GZIP_BUDGETS: Record<ViewerHostName, number> = {
	// Measured 10,573 B gzip; add 1 KiB rounded up to 256 B.
	standalone: 11776,
	// Measured 13,824 B gzip; add 1 KiB rounded up to 256 B.
	electronPreview: 14848,
	// Measured 17,484 B gzip; add 1 KiB rounded up to 256 B.
	scorm12: 18688,
	// Measured 11,656 B gzip; add 1 KiB rounded up to 256 B.
	scorm2004: 12800,
	// Measured 12,650 B gzip; add 1 KiB rounded up to 256 B.
	xapi: 13824,
};

const PRIVATE_HOST_GZIP_BUDGETS: Record<ViewerHostName, number> = {
	// Size caps don't block working features (owner rule): lossless suspend storage and outcome ownership measured 6,932 B gzip; add 1 KiB rounded up to 256 B, tighten during final size work.
	standalone: 8192,
	// Size caps don't block working features (owner rule): lossless suspend storage and outcome ownership measured 10,123 B gzip; add 1 KiB rounded up to 256 B, tighten during final size work.
	electronPreview: 11264,
	// Size caps don't block working features (owner rule): lossless suspend storage and outcome ownership measured 14,237 B gzip; add 1 KiB rounded up to 256 B, tighten during final size work.
	scorm12: 15360,
	// Size caps don't block working features (owner rule): lossless suspend storage and outcome ownership measured 8,223 B gzip; add 1 KiB rounded up to 256 B, tighten during final size work.
	scorm2004: 9472,
	// Size caps don't block working features (owner rule): lossless suspend storage and outcome ownership measured 9,258 B gzip; add 1 KiB rounded up to 256 B, tighten during final size work.
	xapi: 10496,
};

// Size caps don't block working features (owner rule): SHA-256 pair verification in the host bundle; tighten during final size work.
const COLD_HOST_GZIP_BUDGETS: Record<ViewerHostName, number> = {
	// Measured 10,573 B gzip; add 1 KiB rounded up to 256 B.
	standalone: 11776,
	// Measured 13,824 B gzip; add 1 KiB rounded up to 256 B.
	electronPreview: 14848,
	// Measured 17,484 B gzip; add 1 KiB rounded up to 256 B.
	scorm12: 18688,
	// Measured 11,656 B gzip; add 1 KiB rounded up to 256 B.
	scorm2004: 12800,
	// Measured 12,650 B gzip; add 1 KiB rounded up to 256 B.
	xapi: 13824,
};

// owner 2026-10-11: raised for S9b; size optimisation at the end
const LOGIC_INITIAL_RAW_CEILING = 30_976;
// Owner 2026-10-16: S14b reporting-destination types rename minified identifiers, 12,287 -> 12,288 B gzip.
const NAV_INITIAL_GZIP_CEILING = 13 * 1024;

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function assertBufferedPrivateHost(
	outDir: string,
	manifest: ViewerBundleManifest,
	hostName: "standalone" | "scorm12" | "scorm2004" | "xapi",
	fallback = false,
	failedLocale?: "en" | "fr-CA",
) {
	const privacy = manifest.privacy;
	const hostFile = manifest.privateHosts?.[hostName];
	if (!privacy || !hostFile) throw new Error("Missing private-state assets");
	const storageDom = new JSDOM("", { url: "https://course.example" });
	const deployment = {
		format: hostName,
		...(hostName === "xapi"
			? {
					xapiConfig: {
						endpoint: "https://lrs.example/statements",
						auth: "Basic test",
						actorMode: "manual",
						actor: { name: "Learner", mbox: "mailto:learner@example.com" },
					},
				}
			: {}),
	};
	const config = {
		version: 1,
		courseId: "course",
		pageId: "page",
		pageTitle: "Practice",
		currentPage: 1,
		totalPages: 2,
		currentSlug: "page",
		availableSlugs: ["page"],
		pageIdMap: { page: "page" },
		completionMethod: "allPages",
		pageRole: "content",
		strings: {},
		blockStatePolicy: compileBlockStatePolicy([
			{ id: "check", type: "selfCheck", data: {} } as PraxityBlock,
			{ id: "reported", type: "selfCheck", data: { private: false } } as PraxityBlock,
		]),
	};
	const dom = new JSDOM(
		`<html lang="${failedLocale ?? "en"}"><script id="praxity-host-config" type="application/json">${JSON.stringify(config)}</script><script id="praxity-deployment-config" type="application/json">${JSON.stringify(deployment)}</script>`,
		{ url: "file:///course/page.html", runScripts: "outside-only" },
	);
	const writes: string[] = [];
	try {
		Object.defineProperty(dom.window, "localStorage", { value: storageDom.window.localStorage });
		Object.defineProperty(dom.window.document, "readyState", { value: "complete" });
		const lmsData = new Map<string, string>();
		const getValue = (key: string) =>
			lmsData.get(key) ??
			(key.endsWith("student_id") || key.endsWith("learner_id")
				? "learner"
				: key.endsWith("entry")
					? "ab-initio"
					: key.endsWith("lesson_status")
						? "incomplete"
						: key.endsWith("suspend_data")
							? ""
							: "0");
		const setValue = (key: string, value: string) => {
			writes.push(`${key}:${value}`);
			lmsData.set(key, value);
			return "true";
		};
		Object.assign(dom.window, {
			API: {
				LMSInitialize: () => "true",
				LMSGetValue: getValue,
				LMSSetValue: setValue,
				LMSCommit: () => "true",
				LMSGetLastError: () => "0",
				LMSFinish: () => "true",
			},
			API_1484_11: {
				Initialize: () => "true",
				GetValue: getValue,
				SetValue: setValue,
				Commit: () => "true",
				GetLastError: () => "0",
				Terminate: () => "true",
			},
			fetch: (_url: string, init: { body: string }) => {
				writes.push(init.body);
				return Promise.resolve({ ok: true });
			},
		});
		if (fallback) {
			Reflect.deleteProperty(dom.window, "API");
			Reflect.deleteProperty(dom.window, "API_1484_11");
		}
		const script = dom.window.document.createElement("script");
		script.src = `file:///course/${privacy.bootstrap}`;
		script.dataset.privacySupport = privacy.support;
		Object.defineProperty(dom.window.document, "currentScript", { value: script });
		dom.window.eval(await readFile(path.join(outDir, privacy.bootstrap), "utf8"));
		const requested = dom.window.document.querySelector<HTMLScriptElement>("script[src]");
		expect(requested?.src).toBe(
			`file:///course/${privacy.support.replace(/\.js$/, ".classic.js")}`,
		);
		for (const dependency of manifest.hostDependencies?.[hostName] ?? [])
			dom.window.eval(await readFile(path.join(outDir, dependency), "utf8"));
		const runtimeReady = vi.fn();
		dom.window.addEventListener("praxity:runtime-ready", runtimeReady);
		dom.window.eval(await readFile(path.join(outDir, hostFile), "utf8"));
		expect(runtimeReady).not.toHaveBeenCalled();
		expect(dom.window.document.documentElement.dataset.praxityLearnerState).toBe("pending");
		const win = dom.window as unknown as {
			__praxityBlockState: import("@praxity/shared-blocks/learner-block-state").LearnerBlockStateRuntime;
			__praxityRuntime: import("../scorm/types").SCORMRuntime;
		};
		const state = win.__praxityBlockState;
		const draft = { answer: "PRIVATE ANSWER" };
		expect(state.set("check", draft)).toEqual({ status: "not-saved", code: "runtime-loading" });
		expect(state.get("check")).toEqual(draft);
		state.set("public", { answer: "PUBLIC ANSWER" });
		state.set("reported", { answer: "REPORTED ANSWER" });
		expect(state.get("public")).toEqual({ answer: "PUBLIC ANSWER" });
		const observed = vi.fn();
		dom.window.document.addEventListener("praxity:assessment-response", observed);
		dom.window.document.dispatchEvent(
			new dom.window.CustomEvent("praxity:assessment-response", {
				bubbles: true,
				detail: {
					blockId: "check",
					responseText: "PRIVATE ANSWER",
					correct: true,
					score: 100,
					maxScore: 100,
				},
			}),
		);
		win.__praxityRuntime.setSuspendData(
			JSON.stringify({
				...JSON.parse(win.__praxityRuntime.getSuspendData() ?? "{}"),
				blockState: {
					public: { answer: "PUBLIC ANSWER" },
					reported: { answer: "REPORTED ANSWER" },
					check: draft,
				},
			}),
		);
		win.__praxityRuntime.trackInteraction("check", "PRIVATE ANSWER", true, 100);
		win.__praxityRuntime.commit();
		expect(observed).not.toHaveBeenCalled();
		expect(writes.join("\n")).not.toContain("PRIVATE ANSWER");
		if (failedLocale) {
			requested?.dispatchEvent(new dom.window.Event("error"));
			await vi.waitFor(() => expect(runtimeReady).toHaveBeenCalledOnce());
			expect(state.getSaveResult?.("check")).toEqual({
				status: "not-saved",
				code: "runtime-write-failed",
			});
			expect(state.get("check")).toEqual(draft);
			expect(state.get("public")).toEqual({ answer: "PUBLIC ANSWER" });
			state.set("public", { answer: "ORDINARY AFTER FAILURE" });
			state.set("reported", { answer: "REPORTING AFTER FAILURE" });
			if (hostName === "scorm12") {
				win.__praxityRuntime.trackInteraction(
					"ordinary-after-failure",
					"PUBLIC REPORT",
					true,
					undefined,
					{ assessmentType: "choice" },
				);
				const suspend = JSON.parse(lmsData.get("cmi.suspend_data") ?? "null");
				expect(suspend.interactions).toEqual([
					expect.objectContaining({
						id: "ordinary-after-failure",
						response: "PUBLIC REPORT",
						correct: true,
					}),
				]);
				expect(
					Object.fromEntries([...lmsData].filter(([key]) => /^cmi\.interactions\.\d+\./.test(key))),
				).toEqual({
					"cmi.interactions.0.id": "ordinary-after-failure",
					"cmi.interactions.0.type": "performance",
					"cmi.interactions.0.result": "correct",
					"cmi.interactions.0.student_response": "PUBLIC REPORT",
				});
				expect(state.getSaveResult?.("check")).toEqual({
					status: "not-saved",
					code: "runtime-write-failed",
				});
			}
			win.__praxityRuntime.commit();
			expect.soft(writes.join("\n")).toContain("ORDINARY AFTER FAILURE");
			expect.soft(writes.join("\n")).toContain("REPORTING AFTER FAILURE");
			expect(writes.join("\n")).not.toContain("PRIVATE ANSWER");
			const strings = runtimeReady.mock.calls[0][0].detail.strings;
			expect(strings).toMatchObject(
				failedLocale === "en"
					? {
							selfCheckDeviceNotice:
								"Your answer is saved in this browser on this device. It is not sent to the LMS.",
							selfCheckLmsNotice:
								"Your answer is reported to the LMS. Drafts and comparison state may also be saved there.",
							selfCheckNotSavedDevice:
								"Your answer is not saved on this device. Keep a copy before leaving this page.",
							selfCheckNotSavedLms:
								"Your answer is not saved to the LMS. Keep a copy before leaving this page.",
						}
					: {
							selfCheckDeviceNotice:
								"Votre réponse est enregistrée dans ce navigateur sur cet appareil. Elle n'est pas envoyée au LMS.",
							selfCheckLmsNotice:
								"Votre réponse est transmise au LMS. Les brouillons et l'état de la comparaison peuvent aussi y être enregistrés.",
							selfCheckNotSavedDevice:
								"Votre réponse n'est pas enregistrée sur cet appareil. Gardez-en une copie avant de quitter cette page.",
							selfCheckNotSavedLms:
								"Votre réponse n'est pas enregistrée dans le LMS. Gardez-en une copie avant de quitter cette page.",
						},
			);
			return;
		}
		dom.window.eval(
			await readFile(path.join(outDir, privacy.support.replace(/\.js$/, ".classic.js")), "utf8"),
		);
		requested?.dispatchEvent(new dom.window.Event("load"));
		await vi.waitFor(() =>
			expect(state.getSaveResult?.("check")).toEqual({ status: "saved", destination: "device" }),
		);
		expect(runtimeReady).toHaveBeenCalledOnce();
		expect(dom.window.document.documentElement.dataset.praxityLearnerState).toBeUndefined();
		expect(state.set("public", { answer: "PUBLIC ANSWER" })).toEqual({
			status: "saved",
			destination: hostName === "standalone" || hostName === "xapi" || fallback ? "device" : "lms",
		});
		expect(state.get("check")).toEqual(draft);
		if (hostName === "scorm12" && !fallback) {
			// The actual lazy chunk owns append validation and the accepted-row high water.
			lmsData.set("cmi.interactions._count", "4");
			lmsData.set("cmi.interactions.3.id", "earlier-public");
			win.__praxityRuntime.trackInteraction("public-one", "PUBLIC REPORT");
			win.__praxityRuntime.trackInteraction("public-two", "PUBLIC REPORT");
			expect(lmsData.get("cmi.interactions.4.id")).toBe("public-one");
			expect(lmsData.get("cmi.interactions.5.id")).toBe("public-two");
			expect(lmsData.get("cmi.interactions.3.id")).toBe("earlier-public");
		}
		const stored = Array.from({ length: storageDom.window.localStorage.length }, (_, i) =>
			storageDom.window.localStorage.getItem(storageDom.window.localStorage.key(i) ?? ""),
		);
		if (hostName === "standalone" || fallback) expect(stored.join("\n")).toContain("PUBLIC ANSWER");
		else expect(stored.join("\n")).toContain("PRIVATE ANSWER");
		expect(writes.join("\n")).not.toContain("PRIVATE ANSWER");
	} finally {
		dom.window.close();
		storageDom.window.close();
	}
}

async function writeAssetPaths(outDir: string, relativePaths: Iterable<string>): Promise<void> {
	let hasManifest = false;
	for (const relativePath of relativePaths) {
		const targetPath = path.join(outDir, relativePath);
		if (path.extname(relativePath)) {
			await mkdir(path.dirname(targetPath), { recursive: true });
			await writeFile(targetPath, "test");
			if (relativePath === "viewer-manifest.json") hasManifest = true;
		} else {
			await mkdir(targetPath, { recursive: true });
		}
	}
	if (hasManifest) {
		const islandFiles = Object.values(TEST_ISLAND_FILES);
		const manifest: ViewerBundleManifest = {
			css: "viewer.css",
			deckCss: "deck-shell.css",
			retrievalSheetCss: "retrieval-sheet.css",
			highlightCss: "highlight.css",
			shell: TEST_SHELL_FILE,
			resume: TEST_RESUME_FILE,
			hosts: TEST_HOST_FILES,
			islands: TEST_ISLAND_FILES,
			islandFiles,
			islandDependencies: Object.fromEntries(
				TEST_ISLAND_ENTRIES.map((entry) => [entry, [TEST_ISLAND_FILES[entry]]]),
			) as Record<IslandManifestEntryName, string[]>,
		};
		await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));
		await writeFile(path.join(outDir, TEST_SHELL_FILE), "// shell");
		await writeFile(path.join(outDir, TEST_RESUME_FILE), "// resume");
		await Promise.all(
			islandFiles.map((filename) => writeFile(path.join(outDir, "islands", filename), "// island")),
		);
		await Promise.all(
			Object.values(TEST_HOST_FILES).map((filename) =>
				writeFile(path.join(outDir, filename), "// host"),
			),
		);
	}
}

async function isolatedViewerSources(complete = false) {
	// Import a private package-layout copy so hash regressions cannot race live builds.
	const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "viewer-sources-")));
	tempDirs.push(root);
	const repoRoot = path.resolve(import.meta.dirname, "../../../..");
	const files = [
		"packages/export-pipeline/src/bundle-viewer.ts",
		"packages/export-pipeline/src/third-party-notices.ts",
		"packages/export-pipeline/src/export-css.ts",
		"packages/export-pipeline/src/module-deck-strings.ts",
		"packages/export-pipeline/src/classic-island-filename.ts",
		"packages/export-pipeline/src/patterns/write-distractors/assets.ts",
		"packages/export-pipeline/src/course-home.ts",
		"packages/export-pipeline/src/course-session-time.ts",
		"packages/export-pipeline/template/COURSE-RUNTIME-LICENSE.txt",
		"packages/export-pipeline/package.json",
		"packages/shared-blocks/package.json",
		"packages/grammar/package.json",
		"packages/grammar/src/deck-design.ts",
		"packages/content-model/package.json",
		"packages/content-model/src/narration-display.ts",
		"pnpm-lock.yaml",
		"scripts/learning-patterns-admission.json",
		"scripts/learning-patterns-admission.mjs",
	];
	for (const file of files) {
		await mkdir(path.dirname(path.join(root, file)), { recursive: true });
		await cp(path.join(repoRoot, file), path.join(root, file));
	}
	for (const directory of [
		"packages/shared-blocks/src",
		"packages/export-pipeline/template/src",
		"packages/export-pipeline/src/scorm",
		"apps/desktop/resources/third-party-notices",
	]) {
		await mkdir(path.join(root, directory), { recursive: true });
	}
	await symlink(
		path.join(repoRoot, "packages/export-pipeline/node_modules"),
		path.join(root, "packages/export-pipeline/node_modules"),
		"junction",
	);
	if (complete) {
		await cp(
			path.join(repoRoot, "apps/desktop/resources/third-party-notices"),
			path.join(root, "apps/desktop/resources/third-party-notices"),
			{ recursive: true },
		);
		for (const pkg of ["export-pipeline", "shared-blocks", "grammar", "content-model"]) {
			for (const directory of [
				"src",
				...(pkg === "export-pipeline" ? ["template", "schemas"] : []),
			]) {
				await cp(
					path.join(repoRoot, "packages", pkg, directory),
					path.join(root, "packages", pkg, directory),
					{
						recursive: true,
						filter: (file) => !file.includes("/__tests__"),
					},
				);
			}
			if (pkg !== "export-pipeline")
				await symlink(
					path.join(repoRoot, "packages", pkg, "node_modules"),
					path.join(root, "packages", pkg, "node_modules"),
					"junction",
				);
		}
	}
	const viewer = await import(
		pathToFileURL(path.join(root, "packages/export-pipeline/src/bundle-viewer.ts")).href
	);
	return {
		root,
		viewer,
		computeHash: viewer.computeViewerSourceHash as typeof computeViewerSourceHash,
	};
}

describe("viewerManifestAssetPaths", () => {
	it("lists a shared host dependency once", () => {
		const manifest = {
			css: "viewer.css",
			deckCss: "deck-shell.css",
			retrievalSheetCss: "retrieval-sheet.css",
			highlightCss: "highlight.css",
			shell: TEST_SHELL_FILE,
			resume: TEST_RESUME_FILE,
			hosts: TEST_HOST_FILES,
			hostDependencies: {
				scorm12: ["scorm-support-TEST.js"],
				scorm2004: ["scorm-support-TEST.js"],
			},
			islandFiles: [],
		} as unknown as ViewerBundleManifest;
		expect(
			viewerManifestAssetPaths(manifest).filter((file) => file === "scorm-support-TEST.js"),
		).toEqual(["scorm-support-TEST.js"]);
	});
	it("lists every referenced file, including the deferred resume script", () => {
		const manifest = {
			css: "viewer.css",
			deckCss: "deck-shell.css",
			retrievalSheetCss: "retrieval-sheet.css",
			highlightCss: "highlight.css",
			shell: "course-shell-AAAA1111.js",
			resume: "course-resume-BBBB2222.js",
			hosts: { standalone: "host-standalone-CCCC3333.js" },
			islands: {},
			islandFiles: ["island-deck-DDDD4444.js", "chunk-EEEE5555.js"],
			islandDependencies: {},
		} as unknown as ViewerBundleManifest;
		expect(viewerManifestAssetPaths(manifest)).toEqual([
			"viewer.css",
			"deck-shell.css",
			"retrieval-sheet.css",
			"highlight.css",
			"course-shell-AAAA1111.js",
			"course-resume-BBBB2222.js",
			"host-standalone-CCCC3333.js",
			"islands/island-deck-DDDD4444.js",
			"islands/chunk-EEEE5555.js",
		]);
	});
});

function assertBundleInputsHashed(inputs: string[], hashInputs: string[]): void {
	const hashed = new Set(hashInputs);
	const missing = inputs.filter(
		(input) =>
			!input.includes("node_modules") &&
			!path.basename(input).startsWith("<") &&
			!input.startsWith("praxity-runtime:") &&
			!input.startsWith("praxity-privacy:") &&
			!hashed.has(path.resolve(input)),
	);
	expect(
		missing,
		`Real viewer bundle inputs missing from viewerSourceFiles:\n${missing.join("\n")}`,
	).toEqual([]);
}

describe("computeViewerSourceHash", () => {
	it("returns a 64-character hex string (SHA-256)", async () => {
		const hash = await computeViewerSourceHash();
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("returns the same hash on consecutive calls", async () => {
		const a = await computeViewerSourceHash();
		const b = await computeViewerSourceHash();
		expect(a).toBe(b);
	});

	it("ignores dotfiles and editor debris under pattern folders", async () => {
		const { root, computeHash } = await isolatedViewerSources();
		const before = await computeHash();
		for (const file of [
			".DS_Store",
			".hidden.ts",
			".cache/generated.ts",
			"enhance.ts.orig",
			"enhance.ts~",
			"enhance.swp",
		]) {
			const target = path.join(root, "packages/export-pipeline/src/patterns/example", file);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, "machine-local debris");
			expect(await computeHash(), file).toBe(before);
		}
	});

	it("refuses symlinked pattern directories with a clear diagnostic", async () => {
		const { root, computeHash } = await isolatedViewerSources();
		const pattern = path.join(root, "packages/export-pipeline/src/patterns/example");
		await mkdir(pattern, { recursive: true });
		await symlink(
			path.join(root, "packages/grammar/src"),
			path.join(pattern, "linked"),
			"junction",
		);
		await expect(computeHash()).rejects.toThrow(/Symlinked pattern directory.*linked/);
	});

	it.each([
		"packages/export-pipeline/src/classic-island-filename.ts",
		"scripts/learning-patterns-admission.json",
		"packages/export-pipeline/src/course-home.ts",
		"packages/export-pipeline/src/course-session-time.ts",
		"packages/grammar/src/deck-design.ts",
		"packages/content-model/src/narration-display.ts",
		"packages/grammar/package.json",
		"packages/content-model/package.json",
	])("invalidates the viewer hash when %s changes", async (relativePath) => {
		const { root, computeHash } = await isolatedViewerSources();
		const target = path.join(root, relativePath);
		const original = await readFile(target);
		const before = await computeHash();
		try {
			await writeFile(target, Buffer.concat([original, Buffer.from("\n")]));
			expect(await computeHash()).not.toBe(before);
		} finally {
			await writeFile(target, original);
		}
		expect(await computeHash()).toBe(before);
	});

	it.each([
		"enhance.ts",
		"render.tsx",
		"tests/bundled.test.ts",
		"nested/style.css",
		"fixtures/bundled.json",
		"fixtures/bundled.prax",
	])("invalidates cached viewer generations after adding and editing pattern %s", async (file) => {
		const { root, computeHash } = await isolatedViewerSources();
		const assets = path.join(root, "assets");
		await writeAssetPaths(assets, [
			...requiredViewerAssetPaths("html"),
			...Object.values(TEST_HOST_FILES),
		]);
		const manifest = JSON.parse(await readFile(path.join(assets, "viewer-manifest.json"), "utf8"));
		manifest.thirdPartyNotices = { packages: {}, outputs: {} };
		await writeFile(path.join(assets, "viewer-manifest.json"), JSON.stringify(manifest));
		const cache = path.join(root, "cache");
		const before = await computeHash();
		const original = await cacheViewerBundle(cache, assets, manifest, before);
		expect((await readCachedViewer(cache, before))?.directory).toBe(original);
		const target = path.join(root, "packages/export-pipeline/src/patterns/example", file);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, "first");
		const added = await computeHash();
		expect(added).not.toBe(before);
		expect(await readCachedViewer(cache, added)).toBeNull();
		await cacheViewerBundle(cache, assets, manifest, added);
		await writeFile(target, "other"); // Same-size edit, without relying on timestamps/watchers.
		const edited = await computeHash();
		expect(edited).not.toBe(added);
		expect(await readCachedViewer(cache, edited)).toBeNull();
		await rm(target);
		expect(await computeHash()).toBe(before);
		expect((await readCachedViewer(cache, before))?.directory).toBe(original);
	});

	it("reuses a cached generation after unrelated documentation and test edits", async () => {
		const { root, computeHash } = await isolatedViewerSources();
		const assets = path.join(root, "assets");
		await writeAssetPaths(assets, [
			...requiredViewerAssetPaths("html"),
			...Object.values(TEST_HOST_FILES),
		]);
		const manifest = JSON.parse(await readFile(path.join(assets, "viewer-manifest.json"), "utf8"));
		manifest.thirdPartyNotices = { packages: {}, outputs: {} };
		await writeFile(path.join(assets, "viewer-manifest.json"), JSON.stringify(manifest));
		const cache = path.join(root, "cache");
		const before = await computeHash();
		const generation = await cacheViewerBundle(cache, assets, manifest, before);
		for (const file of [
			"docs/pattern.md",
			"packages/export-pipeline/src/__tests__/unbundled.test.ts",
		]) {
			const target = path.join(root, file);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, "unrelated");
			expect(await computeHash()).toBe(before);
			expect((await readCachedViewer(cache, await computeHash()))?.directory).toBe(generation);
		}
	});

	describe("pattern offline inputs", () => {
		let root: string;
		let pattern: string;
		let output: string;
		let result: Awaited<ReturnType<typeof bundleViewer>>;
		let assets: typeof import("../export-assets.ts");
		let sourceZip: AdmZip;
		let desktopZip: AdmZip;
		let inputs: string[] = [];
		const css = ".pattern-closure-probe { color: rgb(1, 2, 3); }";
		const catalogPath = "css-sources/patterns/example/nested/style.css";

		// Compile one isolated fixture shared by inventory, deployment and refusal checks.
		beforeAll(async () => {
			const isolated = await isolatedViewerSources(true);
			root = isolated.root;
			const { viewer } = isolated;
			tempDirs.splice(tempDirs.indexOf(root), 1);
			const pipeline = path.join(root, "packages/export-pipeline");
			pattern = path.join(pipeline, "src/patterns/example");
			await mkdir(path.join(pattern, "nested"), { recursive: true });
			await writeFile(
				path.join(pattern, "enhance.ts"),
				'import data from "./nested/data.json"; globalThis.__patternProbe = data.value;',
			);
			await writeFile(path.join(pattern, "nested/data.json"), '{"value":"pattern-closure-probe"}');
			await writeFile(path.join(pattern, "nested/style.css"), css);
			for (const folder of ["fixtures", "tests", "__tests__"]) {
				await mkdir(path.join(pattern, folder), { recursive: true });
				await writeFile(path.join(pattern, folder, "probe.css"), ".unbundled {color: red}");
			}
			await writeFile(
				path.join(pattern, "unselected.ts"),
				'throw new Error("unselected-pattern-code");',
			);
			await writeFile(
				path.join(pattern, "nested/unselected.css"),
				".unselected-pattern-style {color: red}",
			);
			// Only explicit imports select output; the inventory must not create entries.
			await writeFile(
				path.join(pipeline, "template/src/islands/island-card.ts"),
				'import "../../../src/patterns/example/enhance.ts";',
			);
			await writeFile(
				path.join(pipeline, "template/src/styles/viewer.css"),
				'@import "../../../src/patterns/example/nested/style.css";',
			);
			// This imported helper is deliberately outside every hashed root/file.
			await writeFile(
				path.join(pipeline, "src/unhashed-helper.ts"),
				'globalThis.__unhashedProbe = "outside-roots";',
			);
			await writeFile(
				path.join(pattern, "enhance.ts"),
				'import "../../unhashed-helper.ts"; import data from "./nested/data.json"; globalThis.__patternProbe = data.value;',
			);
			output = path.join(root, "prepared");
			result = await viewer.bundleViewer(output, (files: string[]) => {
				inputs = files.map((file) => path.resolve(file));
			});

			assets = await import(pathToFileURL(path.join(pipeline, "src/export-assets.ts")).href);
			await assets.prepareDesktopExportInputs(output);
			// Source and desktop resolve the same emitted closure, including pattern code/data/CSS.
			await cacheViewerBundle(
				path.join(pipeline, "prebuilt"),
				output,
				result.manifest,
				await viewer.computeViewerSourceHash(),
			);
			const { buildScormPackage } = await import(
				pathToFileURL(path.join(pipeline, "src/build.ts")).href
			);
			const course = {
				courseId: "pattern-inputs",
				blocks: [{ id: "card", type: "card", data: { items: [] } }],
				frontmatter: { title: "Pattern inputs", lang: "en" },
				config: { completionThreshold: 0.8 },
				resolvedAssets: new Map(),
				viewerVersion: "test-viewer",
				locale: "en",
			};
			sourceZip = new AdmZip(
				(await buildScormPackage(course, { format: "html", mode: "source" })).zip,
			);
			desktopZip = new AdmZip(
				(
					await buildScormPackage(course, {
						format: "html",
						mode: "desktop",
						projectDir: root,
						prebuiltAssetsDir: output,
					})
				).zip,
			);

			await writeFile(
				path.join(output, "viewer.version.json"),
				JSON.stringify({ viewerSourceHash: (await viewer.computeViewerSourceHash()).slice(0, 12) }),
			);
		});

		afterAll(async () => {
			if (root) await rm(root, { recursive: true, force: true });
		});

		it("inventories nested code, CSS and bundled data without discovering entries", async () => {
			for (const file of ["enhance.ts", "nested/data.json", "nested/style.css"])
				expect(inputs).toContain(path.join(pattern, file));
			expect(Object.keys(result.manifest.islands).sort()).toEqual([...TEST_ISLAND_ENTRIES].sort());
			expect(
				await readFile(
					path.join(output, "islands", result.manifest.islands["island-card"]),
					"utf8",
				),
			).toContain("pattern-closure-probe");
			expect(await readFile(path.join(output, result.manifest.css), "utf8")).toContain(
				".pattern-closure-probe",
			);
		});

		it("rejects an imported helper outside the hash inventory", async () => {
			const viewer = await import(
				pathToFileURL(path.join(root, "packages/export-pipeline/src/bundle-viewer.ts")).href
			);
			const hashInputs = await viewer.viewerSourceFiles();
			// Workspace dependency symlinks resolve to the real repo; compare their
			// inputs with the corresponding source copies in this isolated tree.
			const repoRoot = path.resolve(import.meta.dirname, "../../../..");
			const fixtureInputs = inputs.map((input) =>
				input.startsWith(`${repoRoot}${path.sep}`)
					? path.join(root, path.relative(repoRoot, input))
					: input,
			);
			const helper = path.join(root, "packages/export-pipeline/src/unhashed-helper.ts");
			expect(inputs).toContain(helper);
			expect(() => assertBundleInputsHashed(fixtureInputs, hashInputs)).toThrow(
				"unhashed-helper.ts",
			);
			assertBundleInputsHashed(fixtureInputs, [...hashInputs, helper]);
		});

		it("reports only imported pattern files as delivery provenance", () => {
			for (const file of [
				"unselected.ts",
				"nested/unselected.css",
				"fixtures/probe.css",
				"tests/probe.css",
				"__tests__/probe.css",
			])
				expect(inputs).not.toContain(path.join(pattern, file));
		});

		it("excludes pattern fixture and test styles from the offline catalog", async () => {
			const catalog = await assets.desktopExportInputs();
			for (const folder of ["fixtures", "tests", "__tests__"]) {
				const assetPath = `css-sources/patterns/example/${folder}/probe.css`;
				expect(catalog.map((input) => input.assetPath)).not.toContain(assetPath);
				expect(await assets.preparedExportAssetPaths(output)).not.toContain(assetPath);
				await expect(readFile(path.join(output, assetPath))).rejects.toThrow();
			}
		});

		it("prepares nested pattern CSS through the desktop catalog owner", async () => {
			expect(await assets.desktopExportInputs()).toContainEqual({
				source: path.join(pattern, "nested/style.css"),
				assetPath: catalogPath,
				minify: true,
			});
			expect(await assets.preparedExportAssetPaths(output)).toContain(catalogPath);
			expect(await readFile(path.join(output, catalogPath), "utf8")).toBe(
				(await transform(css, { loader: "css", minify: true })).code,
			);
		});

		it("exports identical source and desktop script closures and explicitly selected pattern CSS", () => {
			const moduleFile = result.manifest.islands["island-card"];
			const scriptNames = (zip: AdmZip) =>
				zip
					.getEntries()
					.map((entry) => entry.entryName)
					.filter((name) => name.endsWith(".js"))
					.sort();
			expect(scriptNames(sourceZip)).toEqual(scriptNames(desktopZip));
			expect(scriptNames(sourceZip)).toContain(moduleFile);
			for (const name of scriptNames(sourceZip)) {
				expect(sourceZip.readFile(name)).toEqual(desktopZip.readFile(name));
				expect(sourceZip.readAsText(name)).not.toContain("unselected-pattern-code");
			}
			for (const zip of [sourceZip, desktopZip]) {
				const css = zip
					.getEntries()
					.filter((entry) => entry.entryName.endsWith(".css"))
					.map((entry) => entry.getData().toString("utf8"))
					.join("\n");
				expect(css).toContain(".pattern-closure-probe");
				expect(css).not.toContain(".unselected-pattern-style");
			}
		});

		it("refuses a missing pattern stylesheet from the prepared offline inventory", async () => {
			expect(await assets.preparedExportAssetPaths(output)).toContain(catalogPath);
			await assets.verifyPreparedExportAssets(output);
			const file = path.join(output, catalogPath);
			const bytes = await readFile(file);
			await rm(file);
			try {
				await expect(assets.verifyPreparedExportAssets(output)).rejects.toThrow(catalogPath);
			} finally {
				await writeFile(file, bytes);
			}
		});
	});

	it("rejects viewer metadata built from a different source hash", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-version-"));
		tempDirs.push(outDir);
		await writeAssetPaths(
			outDir,
			new Set([
				...requiredViewerAssetPaths("scorm-1.2", true),
				...requiredViewerAssetPaths("scorm-2004"),
			]),
		);
		await writeFile(
			path.join(outDir, "viewer.version.json"),
			JSON.stringify({ viewerSourceHash: "000000000000" }),
		);

		await expect(assertViewerAssetsCurrent(outDir)).rejects.toThrow("Export assets are stale");
	});

	it("requires only the assets used by the selected format", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-assets-"));
		tempDirs.push(outDir);
		expect(requiredViewerAssetPaths("html")).toContain("styles-lite.css");
		expect(requiredViewerAssetPaths("electron-preview")).not.toContain("schemas/scorm2004");
		expect(requiredViewerAssetPaths("scorm-1.2")).not.toContain("scorm-runtime.js");
		await writeAssetPaths(
			outDir,
			new Set([
				...requiredViewerAssetPaths("scorm-1.2"),
				...requiredViewerAssetPaths("scorm-2004"),
			]),
		);

		await expect(assertViewerAssetsReady(outDir, "html")).resolves.toBeUndefined();
		await expect(assertViewerAssetsReady(outDir, "electron-preview")).resolves.toBeUndefined();
		await rm(path.join(outDir, TEST_HOST_FILES.electronPreview));
		await expect(assertViewerAssetsReady(outDir, "electron-preview")).rejects.toThrow(
			`Missing export asset: ${TEST_HOST_FILES.electronPreview}`,
		);
		await rm(path.join(outDir, TEST_HOST_FILES.scorm2004));
		await expect(assertViewerAssetsReady(outDir, "scorm-1.2")).resolves.toBeUndefined();
		await expect(assertViewerAssetsReady(outDir, "xapi")).resolves.toBeUndefined();
		await expect(assertViewerAssetsReady(outDir, "scorm-2004")).rejects.toThrow(
			`Missing export asset: ${TEST_HOST_FILES.scorm2004}`,
		);
		await rm(path.join(outDir, TEST_HOST_FILES.scorm12));
		await expect(assertViewerAssetsReady(outDir, "scorm-1.2")).rejects.toThrow(
			`Missing export asset: ${TEST_HOST_FILES.scorm12}`,
		);
	});

	it("requires every host bundle when validating the complete prebuilt set", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-hosts-"));
		tempDirs.push(outDir);
		await writeAssetPaths(
			outDir,
			new Set([
				...requiredViewerAssetPaths("scorm-1.2", true),
				...requiredViewerAssetPaths("scorm-2004"),
			]),
		);
		await rm(path.join(outDir, TEST_HOST_FILES.xapi));

		await expect(assertViewerAssetsCurrent(outDir)).rejects.toThrow(
			`Missing export asset: ${TEST_HOST_FILES.xapi}`,
		);
	});

	it("rejects an empty course shell manifest entry", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-shell-manifest-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		await writeFile(
			path.join(outDir, "viewer-manifest.json"),
			JSON.stringify({
				css: "viewer.css",
				deckCss: "deck-shell.css",
				retrievalSheetCss: "retrieval-sheet.css",
				highlightCss: "highlight.css",
				shell: "",
				hosts: TEST_HOST_FILES,
				islands: TEST_ISLAND_FILES,
				islandFiles: Object.values(TEST_ISLAND_FILES),
				islandDependencies: Object.fromEntries(
					TEST_ISLAND_ENTRIES.map((entry) => [entry, [TEST_ISLAND_FILES[entry]]]),
				),
			}),
		);

		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			"Invalid viewer manifest",
		);
	});

	it.each(["island-nav", "island-write-distractors"] as const)(
		"rejects an incomplete island manifest before export: %s",
		async (entry) => {
			const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-island-manifest-"));
			tempDirs.push(outDir);
			await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
			const manifest = JSON.parse(
				await readFile(path.join(outDir, "viewer-manifest.json"), "utf-8"),
			) as ViewerBundleManifest;
			delete (manifest.islands as Partial<ViewerBundleManifest["islands"]>)[entry];
			await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));

			await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
				"Invalid viewer manifest",
			);
		},
	);

	it("requires only the selected host's dependencies", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-host-dependency-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("scorm-1.2"));
		const manifest = JSON.parse(await readFile(path.join(outDir, "viewer-manifest.json"), "utf-8"));
		manifest.hostDependencies = {
			scorm12: ["scorm-support-TEST.js"],
			scorm2004: ["scorm-support-TEST.js"],
		};
		await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));
		await expect(assertViewerAssetsReady(outDir, "html")).resolves.toBeUndefined();
		await expect(assertViewerAssetsReady(outDir, "scorm-1.2")).rejects.toThrow(
			"Missing export asset: scorm-support-TEST.js",
		);
		await writeFile(path.join(outDir, "scorm-support-TEST.js"), "// session");
		await expect(assertViewerAssetsReady(outDir, "scorm-1.2")).resolves.toBeUndefined();
	});

	it.each([
		["../outside.js", "../outside.classic.js"],
		["missing.js", "missing.classic.js"],
		[TEST_ISLAND_FILES["island-self-check"], TEST_ISLAND_FILES["island-deck"]],
	])("refuses unsafe, missing or mismatched deferred self-check support %j", async (...support) => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "self-check-support-manifest-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		const manifest = JSON.parse(await readFile(path.join(outDir, "viewer-manifest.json"), "utf-8"));
		manifest.selfCheckSupport = support;
		await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));
		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			"Invalid viewer manifest",
		);
	});

	it.each(["../outside.js", "missing.js"])(
		"refuses an unsafe or missing self-check document asset %s",
		async (asset) => {
			const outDir = await mkdtemp(path.join(os.tmpdir(), "self-check-document-manifest-"));
			tempDirs.push(outDir);
			await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
			const manifest = JSON.parse(
				await readFile(path.join(outDir, "viewer-manifest.json"), "utf-8"),
			);
			manifest.selfCheckDocument = asset;
			await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));
			await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
				"Invalid viewer manifest",
			);
		},
	);

	it.each([
		"../outside.js",
		"sub/../../outside.js",
		"C:/outside.js",
		"sub\\outside.js",
		"/outside.js",
	])("rejects unsafe host dependency %s", async (dependency) => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-unsafe-dependency-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		const manifest = JSON.parse(await readFile(path.join(outDir, "viewer-manifest.json"), "utf-8"));
		manifest.hostDependencies = { scorm12: [dependency] };
		await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));
		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			"Invalid viewer manifest",
		);
	});

	it.each([undefined, "../sheet.css", "/sheet.css"])(
		"rejects a stale or unsafe retrieval stylesheet manifest entry %s",
		async (entry) => {
			const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-sheet-manifest-"));
			tempDirs.push(outDir);
			await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
			const file = path.join(outDir, "viewer-manifest.json");
			const manifest = JSON.parse(await readFile(file, "utf8"));
			manifest.retrievalSheetCss = entry;
			await writeFile(file, JSON.stringify(manifest));
			await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
				"Invalid viewer manifest",
			);
		},
	);

	it.each(["retrieval-sheet.css", `islands/${TEST_ISLAND_FILES["island-retrieval-sheet"]}`])(
		"rejects missing retrieval-sheet asset %s before export",
		async (file) => {
			const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-sheet-file-"));
			tempDirs.push(outDir);
			await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
			await rm(path.join(outDir, file));
			await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
				`Missing export asset: ${file}`,
			);
		},
	);

	it.each([undefined, "../highlight.css", "/highlight.css"])(
		"rejects a stale or unsafe highlight stylesheet %s",
		async (entry) => {
			const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-highlight-manifest-"));
			tempDirs.push(outDir);
			await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
			const file = path.join(outDir, "viewer-manifest.json");
			const manifest = JSON.parse(await readFile(file, "utf8"));
			manifest.highlightCss = entry;
			await writeFile(file, JSON.stringify(manifest));
			await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
				"Invalid viewer manifest",
			);
		},
	);
	it.each(["electron-preview", "html", "scorm-1.2", "scorm-2004", "xapi"] as const)(
		"requires highlight build assets in %s inventory",
		async (format) => {
			const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-highlight-inventory-"));
			tempDirs.push(outDir);
			await writeAssetPaths(outDir, requiredViewerAssetPaths(format));
			await assertViewerAssetsReady(outDir, format);
			for (const file of ["highlight.css", `islands/${TEST_ISLAND_FILES["island-highlight"]}`]) {
				const absolute = path.join(outDir, file);
				const bytes = await readFile(absolute);
				await rm(absolute);
				await expect(assertViewerAssetsReady(outDir, format)).rejects.toThrow(
					`Missing export asset: ${file}`,
				);
				await writeFile(absolute, bytes);
			}
		},
	);

	it("requires the exact highlight CSS named by the prepared manifest", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-highlight-named-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		const file = path.join(outDir, "viewer-manifest.json");
		const manifest = JSON.parse(await readFile(file, "utf8"));
		manifest.highlightCss = "highlight-prepared.css";
		await writeFile(file, JSON.stringify(manifest));
		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			"Missing export asset: highlight-prepared.css",
		);
	});

	it("rejects a missing deferred resume asset before export", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-resume-file-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		await rm(path.join(outDir, TEST_RESUME_FILE));
		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			`Missing export asset: ${TEST_RESUME_FILE}`,
		);
	});

	it("rejects retired full-viewer manifests", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-retired-manifest-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		const manifest = JSON.parse(
			await readFile(path.join(outDir, "viewer-manifest.json"), "utf-8"),
		) as ViewerBundleManifest & { legacy?: string };
		manifest.legacy = "viewer-legacy.js";
		await writeFile(path.join(outDir, "viewer-manifest.json"), JSON.stringify(manifest));

		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			"Invalid viewer manifest",
		);
	});

	it("rejects a missing island file before export", async () => {
		const outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-island-file-"));
		tempDirs.push(outDir);
		await writeAssetPaths(outDir, requiredViewerAssetPaths("html"));
		await rm(path.join(outDir, "islands", TEST_ISLAND_FILES["island-nav"]));

		await expect(assertViewerAssetsReady(outDir, "html")).rejects.toThrow(
			`Missing export asset: ${path.join("islands", TEST_ISLAND_FILES["island-nav"])}`,
		);
	});

	describe("cold generated bundle", () => {
		let outDir: string;
		let islandsDir: string;
		let result: Awaited<ReturnType<typeof bundleViewer>>;
		let buildInputs: string[];
		beforeAll(async () => {
			outDir = await mkdtemp(path.join(os.tmpdir(), "viewer-bundle-"));
			islandsDir = path.join(outDir, "islands");
			await mkdir(path.join(islandsDir, "chunks"), { recursive: true });
			await writeFile(path.join(islandsDir, "manual.js"), "// keep");
			await writeFile(path.join(islandsDir, "island-nav-AAAAAAAA.js"), "// stale");
			await writeFile(path.join(islandsDir, "island-deck-AAAAAAAA.classic.js"), "// stale");
			await writeFile(path.join(islandsDir, "chunks", "stale-AAAAAAAA.js"), "// stale");
			await writeFile(path.join(outDir, "host-manual.js"), "// keep");
			await writeFile(path.join(outDir, "scorm-runtime.js"), "// retired");
			await writeFile(path.join(outDir, "viewer.js"), "// retired");
			await writeFile(path.join(outDir, "viewer-legacy.js"), "// retired");
			await writeFile(path.join(outDir, "viewer-legacy.css"), "/* retired */");
			await writeFile(path.join(outDir, "course-bootstrap-AAAAAAAA.js"), "// stale");
			await writeFile(path.join(outDir, "scorm-support-AAAAAAAA.js"), "// stale");
			for (const hostName of Object.keys(TEST_HOST_FILES) as ViewerHostName[]) {
				await writeFile(
					path.join(
						outDir,
						`host-${hostName === "electronPreview" ? "electron-preview" : hostName}-AAAAAAAA.js`,
					),
					"// stale",
				);
			}

			buildInputs = [];
			result = await bundleViewer(outDir, (inputs) => {
				buildInputs = inputs.map((input) => path.resolve(input));
			});
		});
		afterAll(async () => {
			if (outDir) await rm(outDir, { recursive: true, force: true });
		});

		it("keeps private choice presentation out of every existing privacy asset", async () => {
			const notice = result.manifest.privateChoice;
			if (!notice || !result.manifest.privacy) throw new Error("Missing private choice entry");
			expect(result.manifest.privacy.files).not.toContain(notice);
			expect(await readFile(path.join(outDir, notice), "utf8")).toContain("data-practice-mode");
			for (const file of result.manifest.privacy.files)
				expect(await readFile(path.join(outDir, file), "utf8")).not.toContain("data-practice-mode");
		});

		it("keeps dormant recovery admission in the assessment UI and out of SCORM support", async () => {
			expect(buildInputs).toContain(
				path.resolve(import.meta.dirname, "../../../shared-blocks/src/choice-learner-state.ts"),
			);
			const support = result.manifest.hostDependencies?.scorm12?.[0];
			if (!support) throw new Error("Missing SCORM support");
			const source = await readFile(path.join(outDir, support), "utf8");
			expect(source).not.toContain("Invalid compiled choice facts");
			expect(source).not.toContain("choiceEvidenceInvalid");
			expect(result.manifest.thirdPartyNotices?.outputs[support] ?? []).not.toEqual(
				expect.arrayContaining([expect.stringMatching(/^@noble\/hashes@/)]),
			);
		});

		it("keeps dormant interaction evidence out of ordinary host bundles", async () => {
			const files = new Set([
				...Object.values(result.manifest.hosts),
				...Object.values(result.manifest.hostDependencies ?? {}).flat(),
				...(result.manifest.privacy?.files ?? []),
			]);
			for (const file of files) {
				const code = await readFile(path.join(outDir, file), "utf8");
				expect(code, file).not.toContain("Unidentifiable interaction evidence");
				expect(code, file).not.toContain("choiceEvidenceInvalid");
			}
		});

		it("budgets the entire highlight initial JS closure with default navigation", async () => {
			// Size caps don't block working features (owner rule): SHA-256 pair verification in the host bundle; tighten during final size work.
			// Earlier full enhancer maxima: page 43,137 B gzip; deck 135,602 B gzip.
			// Owner C5 previously measured
			// 39,577 / 131,639 B; HL04 caps were 36,864 / 129,024 B.
			// Size caps don't block working features (owner rule): waiting and exit mechanics measure 136,755 B gzip for the deck, plus 1 KiB rounded up to 256 B; tighten during final size work.
			const caps = { page: 44_288, deck: 137_984 };
			const page = {
				id: "highlight-page",
				title: "Highlight",
				blocks: [{ id: "highlight", type: "highlight" as const, data: {} }],
			};
			const config = { sourceLocale: "en", pages: [page] };
			for (const deck of [false, true])
				for (const classic of [false, true]) {
					const plan = deck
						? planModuleRuntime(config, [page], true)
						: planPageRuntime(config, page, true);
					expect(plan.islands).toEqual(deck ? ["deck", "highlight"] : ["highlight", "nav"]);
					const entries: IslandManifestEntryName[] = [
						"island-loader",
						...plan.islands.map((island) => `island-${island}` as IslandManifestEntryName),
					];
					const islands = entries.flatMap((entry) => {
						const dependencies = result.manifest.islandDependencies[entry];
						const classicFile = result.manifest.islands[entry].replace(/\.js$/, ".classic.js");
						return (
							classic && dependencies.includes(classicFile)
								? [classicFile]
								: dependencies.filter((file) => !file.endsWith(".classic.js"))
						).map((file) => `islands/${file}`);
					});
					for (const [host, entry] of Object.entries(result.manifest.hosts)) {
						const files = [
							...new Set([
								result.manifest.shell,
								entry,
								...(result.manifest.hostDependencies?.[host as ViewerHostName] ?? []),
								...islands,
							]),
						];
						if (!deck) expect(files).toContain(`islands/${result.manifest.islands["island-nav"]}`);
						const gzip = (
							await Promise.all(
								files.map(
									async (file) => gzipSync(await readFile(path.join(outDir, file))).byteLength,
								),
							)
						).reduce((sum, bytes) => sum + bytes, 0);
					expect.soft(
							gzip,
							`highlight ${host} ${deck ? "deck" : "page"} ${classic ? "classic" : "ESM"} full initial JS gzip`,
						).toBeLessThanOrEqual(deck ? caps.deck : caps.page);
					}
				}
		});
		it("inventories highlight CSS, both adapters, source hashes and the copied MIT notice", async () => {
			const entry = result.manifest.islands["island-highlight"];
			const loader = await readFile(
				path.join(outDir, "islands", result.manifest.islands["island-loader"]),
				"utf8",
			);
			expect(loader).not.toContain("data-highlight-chunk");
			expect(loader).not.toContain("data-praxity-js-control");
			expect(islandFilesForEntries(result.manifest, ["island-highlight"])).toEqual(
				[entry, entry.replace(/\.js$/, ".classic.js")].sort(),
			);
			expect(viewerManifestAssetPaths(result.manifest)).toContain("highlight.css");
			expect(
				result.manifest.thirdPartyNotices?.outputs[
					`islands/${result.manifest.islands["island-loader"]}`
				],
			).not.toContain("learning-patterns@0.1.0");
			expect(result.manifest.thirdPartyNotices?.outputs["highlight.css"]).toContain(
				"learning-patterns@0.1.0",
			);
			expect(
				result.manifest.thirdPartyNotices?.packages["learning-patterns@0.1.0"]?.texts.LICENSE,
			).toContain("Permission is hereby granted");
			const hashes = await viewerSourceFiles();
			for (const file of [
				"../patterns/highlight/style.css",
				"../patterns/highlight/enhance.ts",
				"../patterns/highlight/format-count.ts",
				"../patterns/highlight/recovery.ts",
				"../../template/src/islands/island-highlight.ts",
			]) {
				const source = path.resolve(import.meta.dirname, file);
				expect(buildInputs).toContain(source);
				expect(hashes).toContain(source);
				expect(() =>
					assertBundleInputsHashed(
						buildInputs,
						hashes.filter((input) => input !== source),
					),
				).toThrow("Real viewer bundle inputs missing");
			}
		});

		it("budgets the full distractor no-gesture closure and each support variant", async () => {
			expect(result.manifest.writeDistractorsSupport).toHaveLength(4);
			const distractorFiles = islandFilesForEntries(result.manifest, [
				"island-loader",
				"island-write-distractors",
			]);
			for (const classic of [false, true]) {
				const entry = result.manifest.islands["island-write-distractors"];
				const files = [
					...distractorFiles,
					...(result.manifest.writeDistractorsSupport ?? []).filter(
						(file) => file.endsWith(".classic.js") === classic,
					),
				].filter(
					(file) =>
						file === result.manifest.selfCheckLifetime ||
						file !== (classic ? entry : entry.replace(/\.js$/, ".classic.js")),
				);
				const gzip = (
					await Promise.all(
						files.map(
							async (file) => gzipSync(await readFile(path.join(islandsDir, file))).byteLength,
						),
					)
				).reduce((sum, bytes) => sum + bytes, 0);
				expect(
					gzip,
					`distractors ${classic ? "classic" : "ESM"} initial full island closure gzip bytes`,
					// Size caps don't block working features (owner rule); tighten during final size work. Candidate: Web Crypto digest instead of @noble/hashes, but crypto.subtle needs a secure context, so plain-HTTP LMS hosts need a fallback first.
				).toBeLessThanOrEqual(23_040);
				for (const file of (result.manifest.writeDistractorsSupport ?? []).filter(
					(file) => file.endsWith(".classic.js") === classic,
				)) {
					const bytes = gzipSync(await readFile(path.join(islandsDir, file))).byteLength;
					expect(bytes, `${file} support gzip bytes`).toBeLessThanOrEqual(
						file.includes("-draft-") ? 5500 : 8192,
					);
				}
			}
		});

		it("removes old generated islands but preserves hand-maintained files", async () => {
			for (const runtimeSource of [
				"grammar/src/deck-design.ts",
				"content-model/src/narration-display.ts",
			]) {
				expect(buildInputs).toContain(path.resolve(import.meta.dirname, "../../..", runtimeSource));
			}
			const hashInputs = await viewerSourceFiles();
			assertBundleInputsHashed(buildInputs, hashInputs);
			const sheetCssInput = path.resolve(
				import.meta.dirname,
				"../patterns/retrieval-sheet/style.css",
			);
			const sheetIslandInput = path.resolve(
				import.meta.dirname,
				"../../template/src/islands/island-retrieval-sheet.ts",
			);
			expect(buildInputs).toEqual(expect.arrayContaining([sheetCssInput, sheetIslandInput]));
			for (const removed of [sheetCssInput, sheetIslandInput]) {
				expect(() =>
					assertBundleInputsHashed(
						buildInputs,
						hashInputs.filter((input) => input !== removed),
					),
				).toThrow("Real viewer bundle inputs missing");
			}
			const sheetEntry = result.manifest.islands["island-retrieval-sheet"];
			const sheetFiles = islandFilesForEntries(result.manifest, ["island-retrieval-sheet"]);
			expect(sheetFiles).toContain(sheetEntry);
			expect(sheetFiles).toEqual([sheetEntry]);
			expect(viewerManifestAssetPaths(result.manifest)).toContain(
				result.manifest.retrievalSheetCss,
			);

			expect(
				buildInputs.some((input) =>
					input.replaceAll("\\", "/").endsWith("/learning-patterns/lib/text-limits.js"),
				),
			).toBe(true);
			const patternNotice = result.manifest.thirdPartyNotices?.packages["learning-patterns@0.1.0"];
			expect(patternNotice?.name).toBe("learning-patterns");
			expect(
				createHash("sha256")
					.update(patternNotice?.texts.LICENSE ?? "")
					.digest("hex"),
			).toBe("d817c04f10efaffd1ab6dba0792a6567dce98f8ab41e86c64833a7b9cff7ecc5");
			expect(buildInputs).toContain(path.resolve(import.meta.dirname, "../bundle-viewer.ts"));
			expect(buildInputs.some((input) => input.includes("praxity-runtime:"))).toBe(false);
			const repoRoot = path.resolve(import.meta.dirname, "../../../..");
			const runtimeInputs = buildInputs
				.filter((input) => !input.includes("node_modules") && /\.[cm]?[jt]sx?$/.test(input))
				.map((input) => path.relative(repoRoot, input).replaceAll("\\", "/"));
			expect(runtimeInputs.filter((input) => !scansLearnerAuthority(input))).toEqual([]);
			// Removing a package from the scan must expose a real input, not merely a planted path.
			expect(
				runtimeInputs.filter(
					(input) =>
						!scansLearnerAuthority(
							input,
							learnerAuthorityDirectories.filter(
								(directory) => directory !== "packages/grammar/src/",
							),
						),
				),
			).toContain("packages/grammar/src/deck-design.ts");

			expect(await readFile(path.join(islandsDir, "manual.js"), "utf-8")).toBe("// keep");
			expect(await readFile(path.join(outDir, "host-manual.js"), "utf-8")).toBe("// keep");
			await expect(readFile(path.join(islandsDir, "island-nav-AAAAAAAA.js"))).rejects.toThrow();
			await expect(
				readFile(path.join(islandsDir, "island-deck-AAAAAAAA.classic.js")),
			).rejects.toThrow();
			await expect(
				readFile(path.join(islandsDir, "chunks", "stale-AAAAAAAA.js")),
			).rejects.toThrow();
			await expect(readFile(path.join(outDir, "course-bootstrap-AAAAAAAA.js"))).rejects.toThrow();
			await expect(readFile(path.join(outDir, "scorm-support-AAAAAAAA.js"))).rejects.toThrow();
			await expect(readFile(path.join(outDir, "scorm-runtime.js"))).rejects.toThrow();
			await expect(readFile(path.join(outDir, "viewer.js"))).rejects.toThrow();
			await expect(readFile(path.join(outDir, "viewer-legacy.js"))).rejects.toThrow();
			await expect(readFile(path.join(outDir, "viewer-legacy.css"))).rejects.toThrow();
			for (const hostName of Object.keys(TEST_HOST_FILES) as ViewerHostName[]) {
				await expect(
					readFile(
						path.join(
							outDir,
							`host-${hostName === "electronPreview" ? "electron-preview" : hostName}-AAAAAAAA.js`,
						),
					),
				).rejects.toThrow();
			}
			expect(result.manifest.islandFiles.length).toBeGreaterThan(0);
			const classicDeck = result.manifest.islandDependencies["island-deck"].find((file) =>
				file.endsWith(".classic.js"),
			);
			expect(classicDeck).toMatch(/^island-deck-[A-Z0-9]{8}\.classic\.js$/u);
			if (!classicDeck) throw new Error("Missing classic deck asset");
			expect(result.manifest.islandFiles).toContain(classicDeck);
			const classicDeckSource = await readFile(path.join(islandsDir, classicDeck), "utf-8");
			expect(classicDeckSource).not.toMatch(/(?:^|[;}])\s*(?:import|export)\s/u);
			expect(result.manifest.thirdPartyNotices?.outputs[`islands/${classicDeck}`]).toBeDefined();
			const classicSelfCheck = result.manifest.islandDependencies["island-self-check"].find(
				(file) => file.endsWith(".classic.js"),
			);
			expect(classicSelfCheck).toMatch(/^island-self-check-[A-Z0-9]{8}\.classic\.js$/u);
			if (!classicSelfCheck) throw new Error("Missing classic self-check asset");
			expect(result.manifest.islandFiles).toContain(classicSelfCheck);
			const classicSelfCheckSource = await readFile(
				path.join(islandsDir, classicSelfCheck),
				"utf-8",
			);
			expect(classicSelfCheckSource).not.toMatch(/(?:^|[;}])\s*(?:import|export)\s/u);
			expect(classicSelfCheckSource).toContain("PraxitySelfCheckIsland");
			const moduleSelfCheckSource = await readFile(
				path.join(islandsDir, result.manifest.islands["island-self-check"]),
				"utf-8",
			);
			const documentSelfCheckSource = await readFile(
				path.join(islandsDir, result.manifest.selfCheckDocument ?? ""),
				"utf-8",
			);
			expect(result.manifest.selfCheckDocument).toMatch(
				/^chunks\/self-check-document-[a-f0-9]{16}\.classic\.js$/u,
			);
			expect(result.manifest.islandDependencies["island-self-check"]).toContain(
				result.manifest.selfCheckDocument,
			);
			expect(
				result.manifest.thirdPartyNotices?.outputs[`islands/${result.manifest.selfCheckDocument}`],
			).toBeDefined();
			expect(moduleSelfCheckSource).toContain(
				`/* implementation ${createHash("sha256").update(documentSelfCheckSource).digest("hex")} */`,
			);
			expect(
				result.manifest.thirdPartyNotices?.outputs[`islands/${classicSelfCheck}`],
			).toBeDefined();
			expect(result.manifest).not.toHaveProperty("legacy");
			const viewerCss = await readFile(result.cssPath, "utf-8");
			// Owner 2026-10-19: main styling plus palette gates measure 31,871 B gzip; 1,153 B headroom.
			// Keep main's 33,024 B cap; tighten during final size work.
			expect(gzipSync(viewerCss).byteLength).toBeLessThanOrEqual(33_024);
			const deckCss = await readFile(result.deckCssPath, "utf-8");
			expect(result.manifest.deckCss).toBe(path.basename(result.deckCssPath));
			// Size caps don't block working features (owner rule): distinct deck focus rings measured 2,845 B gzip; tighten during final size work.
			expect(gzipSync(deckCss).byteLength).toBeLessThanOrEqual(4_096);
			expect(deckCss).toContain(".praxity-deck");
			expect(deckCss).toContain("@media print");
			for (const selector of [
				".praxity-block",
				".praxity-viewer-shell",
				".praxity-floating-toc",
				".praxity-slide",
				"forced-colors",
				"prefers-reduced-motion",
			]) {
				expect(viewerCss).toContain(selector);
			}
			expect(result.manifest.hosts).toEqual({
				standalone: expect.stringMatching(/^host-standalone-[A-Z0-9]{8}\.js$/u),
				electronPreview: expect.stringMatching(/^host-electron-preview-[A-Z0-9]{8}\.js$/u),
				scorm12: expect.stringMatching(/^host-scorm12-[A-Z0-9]{8}\.js$/u),
				scorm2004: expect.stringMatching(/^host-scorm2004-[A-Z0-9]{8}\.js$/u),
				xapi: expect.stringMatching(/^host-xapi-[A-Z0-9]{8}\.js$/u),
			});
			expect(result.manifest.shell).toMatch(/^course-shell-[A-Z0-9]{8}\.js$/u);
			expect(path.basename(result.shellPath)).toBe(result.manifest.shell);
			expect(path.basename(result.resumePath)).toBe(result.manifest.resume);
			expect(result.manifest.resume).toMatch(/^course-resume-[A-Z0-9]{8}\.js$/u);
			const sessionFilename = result.manifest.hostDependencies?.scorm12?.[0];
			expect(sessionFilename).toMatch(/^scorm-support-[A-Z0-9]{8}\.js$/u);
			expect(result.manifest.hostDependencies).toEqual({
				scorm12: [sessionFilename],
				scorm2004: [sessionFilename],
			});
			const session = await readFile(path.join(outDir, sessionFilename as string), "utf-8");
			// Size caps don't block working features (owner rule): outcome owner refactor measured 2,480 B gzip; tighten during final size work.
			expect(gzipSync(session).byteLength, "SCORM support gzip bytes").toBeLessThanOrEqual(
				3.5 * 1024,
			);
			expect(session).not.toMatch(/\bimport\b/u);
			const api = { LMSInitialize: () => "true" };
			const windows = [createContext({ window: {} }), createContext({ window: {} })];
			const sessions = windows.map((context) => {
				runInContext(session, context);
				return context.window.__praxityScormSupport as typeof import("../scorm/api/session") &
					typeof import("../scorm/api-discovery");
			});
			const api2004 = { GetValue: () => "resume" };
			const dualApiWindow = { API: api, API_1484_11: api2004 };
			expect(sessions[0].findScormApi(dualApiWindow, "1.2")?.api).toBe(api);
			expect(sessions[0].findScormApi(dualApiWindow, "2004")?.api).toBe(api2004);
			const state = sessions[0].writeSessionState(api, true);
			expect(state).not.toBeNull();
			expect(sessions[1].getSessionState(api)).toBe(state);
			if (state) state.closed = true;
			expect(sessions[1].readSessionState(api)).toBe(false);
			const resume = await readFile(result.resumePath, "utf-8");
			expect(resume).not.toMatch(/\bimport\b/u);
			expect(resume).toContain("__PRAXITY_FOCUS_SCORM_RESUME__");
			expect(resume).toContain("praxity-resume-prefix");
			const shell = await readFile(result.shellPath);
			expect(shell.toString("utf-8")).not.toContain("praxity-resume-prefix");
			expect(shell.toString("utf-8")).not.toMatch(/\breact(?:-dom)?\b/iu);
			expect(shell.toString("utf-8")).not.toMatch(/\bmantine\b/iu);
			// owner 2026-10-11: raised for S9b lifetime enforcement; size optimisation at the end
			expect(gzipSync(shell).byteLength).toBeLessThanOrEqual(5.75 * 1024);
			const writtenManifest = JSON.parse(await readFile(result.manifestPath, "utf-8")) as {
				hosts: unknown;
			};
			expect(writtenManifest.hosts).toEqual(result.manifest.hosts);
			for (const hostName of Object.keys(result.manifest.hosts) as ViewerHostName[]) {
				expect(path.basename(result.hostPaths[hostName])).toBe(result.manifest.hosts[hostName]);
				const host = await readFile(result.hostPaths[hostName]);
				const source = host.toString("utf-8");
				if (hostName === "scorm12" || hostName === "scorm2004") {
					const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
					try {
						expect(() => dom.window.eval(source)).toThrow("Missing SCORM support runtime.");
						dom.window.eval(session);
						expect(() => dom.window.eval(source)).not.toThrow();
					} finally {
						dom.window.close();
					}
				} else {
					expect(source).not.toContain("__praxityScormSupport");
				}
				expect(source).not.toContain("appendPrivateScorm12Interaction");
				expect(source).not.toContain("interactionNextIndex");
				expect(source).not.toMatch(/\bimport\b/u);
				expect(source).not.toMatch(/\breact(?:-dom)?\b/iu);
				expect(source).not.toMatch(/\bmantine\b/iu);
				expect(gzipSync(host).byteLength, `${hostName} host gzip bytes`).toBeLessThanOrEqual(
					HOST_GZIP_BUDGETS[hostName],
				);
				// Cold host ceilings have their own owning constants above.
				expect(gzipSync(host).byteLength, `${hostName} no-self-check growth`).toBeLessThanOrEqual(
					COLD_HOST_GZIP_BUDGETS[hostName],
				);
			}
			for (const hostName of Object.keys(HOST_GZIP_BUDGETS) as ViewerHostName[]) {
				const privateFile = result.manifest.privateHosts?.[hostName];
				if (!privateFile) throw new Error("Missing private host");
				expect(
					gzipSync(await readFile(path.join(outDir, privateFile))).byteLength,
					`${hostName} private host gzip bytes`,
				).toBeLessThanOrEqual(PRIVATE_HOST_GZIP_BUDGETS[hostName]);
			}
			const navFiles = islandFilesForEntries(result.manifest, ["island-loader", "island-nav"]);
			const ratingFiles = islandFilesForEntries(result.manifest, ["island-rating"]);
			expect(ratingFiles).toContain(result.manifest.selfCheckLifetime);
			expect(ratingFiles).not.toContain(result.manifest.selfCheckDocument);
			expect(navFiles).toContain(result.manifest.islands["island-loader"]);
			expect(navFiles).toContain(result.manifest.islands["island-nav"]);
			expect(result.manifest.islands["island-code"]).toMatch(/^island-code-/u);
			expect(result.manifest.islands["island-tooltip"]).toMatch(/^island-tooltip-/u);
			expect(result.manifest.islands["island-media"]).toMatch(/^island-media-/u);
			expect(result.manifest.islands["island-sequence"]).toMatch(/^island-sequence-/u);
			expect(result.manifest.islands["island-card"]).toMatch(/^island-card-/u);
			expect(result.manifest.islands["island-narration"]).toMatch(/^island-narration-/u);
			expect(result.manifest.islands["island-logic"]).toMatch(/^island-logic-/u);
			expect(result.manifest.islands["island-assessment-group"]).toMatch(
				/^island-assessment-group-/u,
			);
			// Highlight has its own full-closure budget; this ceiling is retrieval-only.
			const retrievalFiles = islandFilesForEntries(result.manifest, [
				"island-loader",
				"island-retrieval-sheet",
			]);
			for (const file of islandFilesForEntries(result.manifest, ["island-highlight"]))
				expect(retrievalFiles).not.toContain(file);
			const retrievalGzip = (
				await Promise.all(
					retrievalFiles.map(
						async (file) => gzipSync(await readFile(path.join(islandsDir, file))).byteLength,
					),
				)
			).reduce((total, bytes) => total + bytes, 0);
			expect(retrievalGzip, "retrieval page island closure gzip bytes").toBeLessThanOrEqual(
				10 * 1024,
			);
			const cardBytes = (
				await Promise.all(
					islandFilesForEntries(result.manifest, ["island-card"]).map((file) =>
						readFile(path.join(islandsDir, file)),
					),
				)
			).reduce((total, file) => total + file.byteLength, 0);
			expect(cardBytes).toBeLessThan(64 * 1024);
			const groupFiles = islandFilesForEntries(result.manifest, ["island-assessment-group"]);
			// Package the generator for offline use, but charge it only after a download click.
			const downloadChunk = groupFiles.find((file) =>
				file.startsWith("chunks/text-response-download-"),
			);
			expect(downloadChunk).toBeDefined();
			const groupEntry = await readFile(
				path.join(islandsDir, result.manifest.islands["island-assessment-group"]),
				"utf-8",
			);
			expect(groupEntry).toContain(`import("./${downloadChunk}")`);
			for (const island of [
				"island-accordion",
				"island-tabs",
				"island-checklist",
				"island-self-check",
				"island-retrieval-sheet",
				"island-highlight",
				"island-rating",
				"island-signature",
				"island-image-comparison",
				"island-labeled-graphic",
				"island-assessment-group",
				"island-code",
				"island-tooltip",
				"island-media",
				"island-sequence",
				"island-table",
			] as const) {
				const islandFiles = islandFilesForEntries(result.manifest, [island]).filter(
					(file) => island !== "island-assessment-group" || file !== downloadChunk,
				);
				const files = await Promise.all(
					islandFiles.map((file) => readFile(path.join(islandsDir, file))),
				);
				const bytes = files.reduce((total, file) => total + file.byteLength, 0);
				// Reflection-journal combined downloads and partial-save/resume need more first-render code.
				// owner 2026-10-11: raised for S9b lifetime enforcement; size optimisation at the end
				// owner 2026-10-17: allow 18 KiB with margin; measured 2026-10-18: owner 4,217 bytes, rating total 16,636.
				if (island === "island-highlight") {
					// Owner C5: 25,209 B measured + 1 KiB, rounded up to 256 B.
					// Owner C5: focus restoration adds 2,541 B across the two adapters.
					// Measured 27,750 B + 1 KiB, rounded up to 256 B. Full page/deck caps stay unchanged.
					expect(bytes, `${island} initial raw bytes`).toBeLessThanOrEqual(28_928);
				} else
					expect(bytes, `${island} initial raw bytes`).toBeLessThan(
						island === "island-self-check"
							? SELF_CHECK_INITIAL_RAW_CEILING
							: (island === "island-assessment-group"
									? 24.25
									: island === "island-rating"
										? 18
										: 16) * 1024,
					);
				for (const file of islandFiles) {
					const source = await readFile(path.join(islandsDir, file), "utf-8");
					expect(source).not.toContain("react-dom");
					expect(source).not.toContain("mantine");
				}
			}
			const navBytes = (
				await Promise.all(
					islandFilesForEntries(result.manifest, ["island-nav"]).map((file) =>
						readFile(path.join(islandsDir, file)),
					),
				)
			).reduce((total, file) => total + file.byteLength, 0);
			// Size caps don't block working features (owner rule): Check scroll with shared outcomes measured 30,343 B raw; tighten during final size work.
			// Add 1 KiB and round up to 256 B, matching the CSS budget allowance.
			expect(navBytes).toBeLessThan(31_488);
			const navGzipBytes = (
				await Promise.all(
					navFiles.map(
						async (file) => gzipSync(await readFile(path.join(islandsDir, file))).byteLength,
					),
				)
			).reduce((total, bytes) => total + bytes, 0);
			expect(navGzipBytes).toBeLessThan(NAV_INITIAL_GZIP_CEILING);
			for (const file of islandFilesForEntries(result.manifest, ["island-nav"])) {
				const source = await readFile(path.join(islandsDir, file), "utf-8");
				expect(source).not.toContain("react-dom");
				expect(source).not.toContain("mantine");
			}
			const logicFiles = islandFilesForEntries(result.manifest, ["island-logic"]);
			const logicBytes = (
				await Promise.all(logicFiles.map((file) => readFile(path.join(islandsDir, file))))
			).reduce((total, file) => total + file.byteLength, 0);
			expect(logicBytes).toBeLessThan(LOGIC_INITIAL_RAW_CEILING);
			for (const file of logicFiles) {
				const source = await readFile(path.join(islandsDir, file), "utf-8");
				expect(source).not.toContain("react-dom");
				expect(source).not.toContain("mantine");
			}
			const narrationFiles = islandFilesForEntries(result.manifest, ["island-narration"]);
			const narrationBytes = (
				await Promise.all(narrationFiles.map((file) => readFile(path.join(islandsDir, file))))
			).reduce((total, file) => total + file.byteLength, 0);
			expect(narrationBytes).toBeLessThan(256 * 1024);
			const narrationGzipBytes = (
				await Promise.all(
					narrationFiles.map(
						async (file) => gzipSync(await readFile(path.join(islandsDir, file))).byteLength,
					),
				)
			).reduce((total, bytes) => total + bytes, 0);
			// Recovery's shared closure measures 82,156 B gzip; add 1 KiB rounded up to 256 B.
			expect(narrationGzipBytes).toBeLessThan(83_200);
			for (const file of narrationFiles) {
				expect(await readFile(path.join(islandsDir, file), "utf-8")).not.toContain("mantine");
			}
			const assessmentFiles = islandFilesForEntries(result.manifest, ["island-assessment"]);
			const assessmentGzipBytes = (
				await Promise.all(
					assessmentFiles.map(
						async (file) => gzipSync(await readFile(path.join(islandsDir, file))).byteLength,
					),
				)
			).reduce((total, bytes) => total + bytes, 0);
			// owner 2026-10-11: raise size limits when they block working features; size optimisation at the end.
			// 248 KiB for the standalone pass mark's finality and outcome reads (246,259 bytes).
			expect(assessmentGzipBytes).toBeLessThan(248 * 1024);
			expect(navFiles.length).toBeLessThan(result.manifest.islandFiles.length);
			for (const file of navFiles) {
				expect(await readFile(path.join(islandsDir, file), "utf-8")).not.toBe("");
			}
		});

		it.each([
			["standalone", false, undefined],
			["scorm12", false, undefined],
			["scorm2004", false, undefined],
			["xapi", false, undefined],
			["scorm12", true, undefined],
			["scorm2004", true, undefined],
			["scorm12", false, "en"],
			["scorm12", false, "fr-CA"],
			["scorm2004", false, "en"],
			["scorm2004", false, "fr-CA"],
		] as const)(
			"buffers self-check course state (%s, fallback=%s, support failure=%s)",
			async (hostName, fallback, failedLocale) => {
				await assertBufferedPrivateHost(outDir, result.manifest, hostName, fallback, failedLocale);
			},
		);
	});
});
