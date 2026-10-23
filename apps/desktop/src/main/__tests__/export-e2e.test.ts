import {
	copyFile,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IdentityNode } from "@praxity/content-identity";
import { buildScormPackage } from "@praxity/export-pipeline";
import { ISLAND_MANIFEST_ENTRY_NAMES } from "@praxity/export-pipeline/bundle-viewer";
import AdmZip from "adm-zip";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	persistLegacyPendingFixture,
	readIdentityFixture,
} from "../../test-utils/identity-fixture";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import { runPraxityCli } from "../cli";
import { buildExportInputFromProject } from "../export/build-export-input-from-project";
import { exportProject } from "../export/export-project";
import { loadIdentityStore } from "../identity-store";
import { createStudioProjectSession } from "../studio/project-session";
import { killJournalWriter } from "./fixtures/kill-journal-writer";

const HOST_FILENAMES = {
	standalone: "host-standalone-TEST1234.js",
	electronPreview: "host-electron-preview-TEST1234.js",
	scorm12: "host-scorm12-TEST1234.js",
	scorm2004: "host-scorm2004-TEST1234.js",
	xapi: "host-xapi-TEST1234.js",
} as const;
const SHELL_FILENAME = "course-shell-TEST1234.js";
const RESUME_FILENAME = "course-resume-TEST1234.js";
const ISLAND_FILENAMES = Object.fromEntries(
	ISLAND_MANIFEST_ENTRY_NAMES.map((name) => [name, `${name}-TEST1234.js`]),
);

const pipelineRoot = new URL("../../../../../packages/export-pipeline/", import.meta.url);
const fixtureCourseRuntimeLicense = () =>
	readFile(new URL("template/COURSE-RUNTIME-LICENSE.txt", pipelineRoot), "utf8");

describe("SCORM export end-to-end", () => {
	let projectDir: string;
	let exportAssetsDir: string;
	let projectTemplate: string;
	let exportAssetsTemplate: string;
	const fixtureRoots: string[] = [];

	beforeAll(async () => {
		projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-e2e-"));
		projectTemplate = projectDir;
		fixtureRoots.push(projectTemplate);
		await mkdir(path.join(projectDir, "assets"), { recursive: true });

		await writeFile(
			path.join(projectDir, "course.yaml"),
			[
				"title: Workplace Safety 101",
				"locale: en",
				"badge: true",
				"lessons:",
				"  - lesson-1.prax",
			].join("\n"),
			"utf-8",
		);

		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"---\ntitle: Workplace Safety 101\n---\n\n# Untitled {hideTitle}\n\nWelcome to workplace safety training.\n\n![Safety gear](assets/safety.webp)\n\n# Untitled {hideTitle}\n\n::: quote\nHard hats are required in all construction zones.\n:::\n",
			"utf-8",
		);

		await writeFile(
			path.join(projectDir, "assets", "safety.webp"),
			Buffer.from([0x52, 0x49, 0x46, 0x46]),
		);

		exportAssetsDir = await mkdtemp(path.join(os.tmpdir(), "praxity-e2e-assets-"));
		exportAssetsTemplate = exportAssetsDir;
		fixtureRoots.push(exportAssetsTemplate);
		await writeFile(path.join(exportAssetsDir, "viewer.css"), "body{margin:0}", "utf-8");
		await writeFile(path.join(exportAssetsDir, "deck-shell.css"), ".praxity-deck{}", "utf-8");
		await writeFile(path.join(exportAssetsDir, "highlight.css"), ".praxity-highlight{}", "utf-8");
		await writeFile(
			path.join(exportAssetsDir, "retrieval-sheet.css"),
			".praxity-retrieval-sheet{}",
			"utf-8",
		);
		await writeFile(path.join(exportAssetsDir, SHELL_FILENAME), "window.shell={};", "utf-8");
		await writeFile(path.join(exportAssetsDir, RESUME_FILENAME), "", "utf-8");
		await writeFile(
			path.join(exportAssetsDir, "styles.css"),
			"body{font-family:Source Sans 3}",
			"utf-8",
		);
		await writeFile(path.join(exportAssetsDir, "styles-lite.css"), "", "utf-8");
		await mkdir(path.join(exportAssetsDir, "schemas", "scorm2004"), { recursive: true });
		await writeFile(path.join(exportAssetsDir, "review-comments.js"), "", "utf-8");
		await writeFile(path.join(exportAssetsDir, "review-comments.css"), "", "utf-8");
		await mkdir(path.join(exportAssetsDir, "islands"), { recursive: true });
		for (const filename of Object.values(ISLAND_FILENAMES)) {
			await writeFile(path.join(exportAssetsDir, "islands", filename), "", "utf-8");
		}
		for (const filename of Object.values(HOST_FILENAMES)) {
			await writeFile(path.join(exportAssetsDir, filename), "window.PraxityHost={};", "utf-8");
		}
		await writeFile(
			path.join(exportAssetsDir, "viewer.version.json"),
			JSON.stringify({ appVersion: "1.0.0", viewerSourceHash: "e2etest12345" }),
			"utf-8",
		);
		// Synthetic JS has no dependencies; CSS, note icons and selected fonts retain real notices.
		const packages = Object.fromEntries(
			await Promise.all(
				[
					"@mantine/core",
					"@tabler/icons",
					"@fontsource/source-sans-3",
					"@fontsource/source-serif-4",
				].map(async (name) => {
					const directory = new URL(`node_modules/${name}/`, pipelineRoot);
					const { version } = JSON.parse(
						await readFile(new URL("package.json", directory), "utf8"),
					);
					return [
						name,
						{
							name,
							version,
							texts: { LICENSE: await readFile(new URL("LICENSE", directory), "utf8") },
						},
					];
				}),
			),
		);
		await writeFile(
			path.join(exportAssetsDir, "viewer-manifest.json"),
			JSON.stringify({
				courseRuntimeLicense: await fixtureCourseRuntimeLicense(),
				thirdPartyNotices: {
					packages,
					outputs: Object.fromEntries(
						[
							"viewer.css",
							"deck-shell.css",
							"retrieval-sheet.css",
							"highlight.css",
							SHELL_FILENAME,
							RESUME_FILENAME,
							...Object.values(HOST_FILENAMES),
							...Object.values(ISLAND_FILENAMES).map((file) => `islands/${file}`),
						].map((file) => [file, []]),
					),
				},
				css: "viewer.css",
				deckCss: "deck-shell.css",
				retrievalSheetCss: "retrieval-sheet.css",
				highlightCss: "highlight.css",
				shell: SHELL_FILENAME,
				resume: RESUME_FILENAME,
				hosts: HOST_FILENAMES,
				islands: ISLAND_FILENAMES,
				islandFiles: Object.values(ISLAND_FILENAMES),
				islandDependencies: Object.fromEntries(
					Object.entries(ISLAND_FILENAMES).map(([name, filename]) => [name, [filename]]),
				),
			}),
			"utf-8",
		);
	});

	beforeEach(async () => {
		projectDir = await mkdtemp(path.join(os.tmpdir(), "praxity-e2e-"));
		exportAssetsDir = await mkdtemp(path.join(os.tmpdir(), "praxity-e2e-assets-"));
		await cp(projectTemplate, projectDir, { recursive: true });
		await cp(exportAssetsTemplate, exportAssetsDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(projectDir, { recursive: true, force: true });
		await rm(exportAssetsDir, { recursive: true, force: true });
	});
	afterAll(async () => {
		await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));
	});

	const repeated = "# First\n\nRepeated.\n\nOld subject.\n\nRepeated.\n";
	const second = "# Second\n\nSecond body.\n";
	const note = "::: note\nInside.\n:::\n";
	const identityTemplates = new Map<
		string,
		{ root: string; original: Record<string, IdentityNode> }
	>();
	describe.each([
		[
			"leaf to another lesson",
			[repeated, second],
			["# First\n\nRepeated.\n\nOld subject.\n", `${second}\nRepeated.\n`],
		],
		[
			"original to another lesson",
			[repeated, second],
			["# First\n\nOld subject.\n\nRepeated.\n", "# Second\n\nRepeated.\n\nSecond body.\n"],
		],
		[
			"leaf to another page",
			[`${repeated}\n# Third\n\nThird body.\n`, second],
			["# First\n\nRepeated.\n\nOld subject.\n\n# Third\n\nThird body.\n\nRepeated.\n", second],
		],
		[
			"leaf into new container",
			[repeated, second],
			["# First\n\nRepeated.\n\nOld subject.\n\n::: note\nRepeated.\n:::\n", second],
		],
		[
			"leaf into saved container, CR3 limit retires only the rewritten container",
			[`${repeated}\n::: note\nInside note.\n:::\n`, second],
			[
				"# First\n\nRepeated.\n\nOld subject.\n\n::: note\nInside note.\n\nRepeated.\n:::\n",
				second,
			],
			"Inside note.",
		],
		[
			"leaf out of saved container, CR3 limit retires only the rewritten container",
			["# First\n\n::: note\nRepeated.\n\nRepeated.\n:::\n\nOld subject.\n", second],
			["# First\n\n::: note\nRepeated.\n:::\n\nOld subject.\n\nRepeated.\n", second],
			"Repeated. Repeated.",
		],
		[
			"copy into earlier lesson",
			["# First\n\nRepeated.\n\nOld subject.\n", "# Second\n\nRepeated.\n\nSecond body.\n"],
			[repeated, second],
		],
		["three copies", [`${repeated}\nRepeated.\n`, second], [repeated, `${second}\nRepeated.\n`]],
		[
			"container to another lesson",
			[`# First\n\n${note}\nOld subject.\n\n${note}`, second],
			[`# First\n\n${note}\nOld subject.\n`, `${second}\n${note}`],
		],
		[
			"container to another page",
			[`# First\n\n${note}\nOld subject.\n\n${note}\n# Third\n\nThird body.\n`, second],
			[`# First\n\n${note}\nOld subject.\n\n# Third\n\nThird body.\n\n${note}`, second],
		],
		[
			"move with rewrite in source lesson",
			[repeated, second],
			["# First\n\nRepeated.\n\nNew subject.\n", `${second}\nRepeated.\n`],
			"Old subject.",
		],
		[
			"move with rewrite in destination lesson",
			[repeated, second],
			["# First\n\nRepeated.\n\nOld subject.\n", "# Second\n\nNew second.\n\nRepeated.\n"],
			"Second body.",
		],
		[
			"move into new container with rewrite",
			[repeated, second],
			["# First\n\nRepeated.\n\nNew subject.\n\n::: note\nRepeated.\n:::\n", second],
			"Old subject.",
		],
	] satisfies [string, [string, string], [string, string], string?][])(
		"exports HTML with durable copy IDs after %s",
		(_, before, after, rewritten = undefined) => {
			let template: { root: string; original: Record<string, IdentityNode> };
			beforeAll(async () => {
				const key = JSON.stringify(before);
				const existing = identityTemplates.get(key);
				if (existing) {
					template = existing;
					return;
				}
				const root = await mkdtemp(path.join(os.tmpdir(), "praxity-e2e-identity-"));
				fixtureRoots.push(root);
				await writeFile(
					path.join(root, "course.yaml"),
					"title: Example\nlocale: en\nlessons: [lesson-1.prax, lesson-2.prax]\n",
				);
				await writeFile(path.join(root, "lesson-1.prax"), before[0]);
				await writeFile(path.join(root, "lesson-2.prax"), before[1]);
				const init = () =>
					runPraxityCli(["identity", "init", root], {
						appVersion: "1.0.0",
						exportAssetsDir: exportAssetsTemplate,
					});
				expect((await init()).exitCode).toBe(0);
				template = {
					root,
					original: Object.assign(
						{},
						...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes),
					),
				};
				identityTemplates.set(key, template);
			});
			it("preserves the original IDs in exported HTML", async () => {
				await cp(template.root, projectDir, { recursive: true });
				const runtime = { appVersion: "1.0.0", exportAssetsDir };
				const write = async (sources: [string, string]) => {
					await writeFile(path.join(projectDir, "lesson-1.prax"), sources[0]);
					await writeFile(path.join(projectDir, "lesson-2.prax"), sources[1]);
				};
				const init = () => runPraxityCli(["identity", "init", projectDir], runtime);
				const nodes = async (): Promise<Record<string, IdentityNode>> =>
					Object.assign({}, ...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes));
				const original = template.original;
				await write(after);
				const beforeRefusal = rewritten ? await projectDiskSnapshot(projectDir) : undefined;
				const initialized = await init();
				if (rewritten) {
					expect(initialized.exitCode).toBe(1);
					expect(JSON.parse(initialized.stdout).error.message).toBe(
						`Identity initialization refused: existing blocks could not be matched. Run praxity identity init '${projectDir}' --rederive --confirm-unpublished only if this course has never been published.`,
					);
					expect(await nodes()).toEqual(original);
					expect(await projectDiskSnapshot(projectDir)).toEqual(beforeRefusal);
					expect(await readFile(path.join(projectDir, "lesson-1.prax"), "utf8")).toBe(after[0]);
					expect(await readFile(path.join(projectDir, "lesson-2.prax"), "utf8")).toBe(after[1]);
					const retiredIds = Object.entries(original)
						.filter(
							([, node]) =>
								node.matchText === rewritten &&
								node.parent !== null &&
								original[node.parent].kind === "page",
						)
						.map(([id]) => id);
					expect(retiredIds).toHaveLength(1);
					const confirmed = await runPraxityCli(
						["identity", "init", projectDir, "--rederive", "--confirm-unpublished"],
						runtime,
					);
					expect(confirmed.exitCode, confirmed.stderr).toBe(0);
					expect(
						JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id),
					).toEqual(retiredIds);
				} else {
					expect(initialized.exitCode, initialized.stderr).toBe(0);
				}
				const stored = await nodes();
				for (const [id, node] of Object.entries(original)) {
					expect(stored[id].status).toBe(
						node.matchText === rewritten &&
							node.parent !== null &&
							original[node.parent].kind === "page"
							? "retired"
							: "active",
					);
					if (
						node.parent &&
						original[node.parent].kind === "block" &&
						original[node.parent].matchText !== rewritten
					)
						expect(stored[id].parent).toBe(node.parent);
				}
				expect(
					Object.values(stored)
						.filter((n) => n.status === "retired")
						.map((n) => n.matchText),
				).toEqual(rewritten ? [rewritten] : []);
				const output = path.join(exportAssetsDir, "moved.zip");
				const exported = await runPraxityCli(
					["export", projectDir, "--format", "html", "--output", output],
					runtime,
				);
				expect(exported.exitCode, exported.stderr).toBe(0);
				const zip = new AdmZip(output);
				const html = zip
					.getEntries()
					.filter((entry) => entry.entryName.endsWith(".html"))
					.map((entry) => zip.readAsText(entry))
					.join("\n");
				for (const [id, node] of Object.entries(original)) {
					if (node.kind === "block" && ["Repeated.", "Inside."].includes(node.matchText))
						expect(html).toContain(id);
				}
				expect((await init()).stdout.trim()).toBe('{"ok":true,"changed":false}');
			});
		},
	);

	const untitled = "# Untitled {hideTitle}\n\n";
	const secondPage = "# Second\n\nSecond body.\n";
	describe.each([
		[
			"Beta moved to lesson two",
			[`${untitled}Alpha text.\n\n${untitled}Beta text.\n`, secondPage],
			[`${untitled}Alpha text.\n`, `${secondPage}\n${untitled}Beta text.\n`],
			1,
		],
		[
			"Beta moved into a lesson with the same title",
			[`${untitled}Alpha text.\n`, `${untitled}Beta text.\n\n${secondPage}`],
			[`${untitled}Alpha text.\n\n${untitled}Beta text.\n`, secondPage],
			5,
		],
	] satisfies [string, [string, string], [string, string], number][])(
		"same-titled page repair: %s",
		(_, before, moved, line) => {
			let template: string;
			let original: Record<string, IdentityNode>;
			beforeAll(async () => {
				template = await mkdtemp(path.join(os.tmpdir(), "praxity-page-identity-"));
				fixtureRoots.push(template);
				await writeFile(
					path.join(template, "course.yaml"),
					"title: Example\nlessons: [lesson-1.prax, lesson-2.prax]\n",
				);
				await writeFile(path.join(template, "lesson-1.prax"), before[0]);
				await writeFile(path.join(template, "lesson-2.prax"), before[1]);
				expect(
					(
						await runPraxityCli(["identity", "init", template], {
							appVersion: "1.0.0",
							exportAssetsDir: exportAssetsTemplate,
						})
					).exitCode,
				).toBe(0);
				original = Object.assign(
					{},
					...(await loadIdentityStore(template)).snapshots.map((s) => s.nodes),
				);
			});
			describe.each(["en", "fr"])("%s", (locale) => {
				it.each(["move back", "confirmed rederive"])(
					"completes %s through init and HTML export",
					async (repair) => {
						const course = path.join(projectDir, "course{course}{file}{line}");
						await mkdir(course);
						await cp(template, course, { recursive: true });
						const runtime = { appVersion: "1.0.0", exportAssetsDir };
						const init = (...flags: string[]) =>
							runPraxityCli(["identity", "init", course, "--lang", locale, ...flags], runtime);
						const output = path.join(exportAssetsDir, "same-title.zip");
						const exportHtml = () =>
							runPraxityCli(
								["export", course, "--format", "html", "--output", output, "--lang", locale],
								runtime,
							);
						await writeFile(path.join(course, "lesson-1.prax"), moved[0]);
						await writeFile(path.join(course, "lesson-2.prax"), moved[1]);
						const bytes = await projectDiskSnapshot(course);
						const refusedInit = await init();
						expect(await projectDiskSnapshot(course)).toEqual(bytes);
						const refusedExport = await exportHtml();
						expect(refusedInit.exitCode).toBe(1);
						expect(refusedExport.exitCode).toBe(1);
						expect(JSON.parse(refusedInit.stdout).error.message).toBe(
							locale === "fr"
								? `Initialisation des identités refusée : lesson-1.prax:${line} est une page qui porte le même titre qu'une autre page ; Praxity ne peut pas savoir quelle page garde quel identifiant. Pour conserver les identifiants des pages, remettez la page où elle était, puis lancez praxity identity init '${course}'. Seulement si ce cours n'a jamais été publié, vous pouvez plutôt lancer praxity identity init '${course}' --rederive --confirm-unpublished ; ces pages recevront alors de nouveaux identifiants.`
								: `Identity initialization refused: lesson-1.prax:${line} is a page with the same title as another page, so Praxity can't tell which page keeps which ID. To keep the page IDs, move the page back to where it was, then run praxity identity init '${course}'. Only if this course has never been published, you can instead run praxity identity init '${course}' --rederive --confirm-unpublished; those pages then get new IDs.`,
						);
						expect(JSON.parse(refusedExport.stdout).error.message).toBe(
							locale === "fr"
								? `Export refusé : lesson-1.prax:${line} est une page qui porte le même titre qu'une autre page ; Praxity ne peut pas savoir quelle page garde quel identifiant. Pour conserver les identifiants des pages, remettez la page où elle était, lancez praxity identity init '${course}', puis relancez l'export. Seulement si ce cours n'a jamais été publié, vous pouvez plutôt lancer praxity identity init '${course}' --rederive --confirm-unpublished ; ces pages recevront alors de nouveaux identifiants.`
								: `Export refused: lesson-1.prax:${line} is a page with the same title as another page, so Praxity can't tell which page keeps which ID. To keep the page IDs, move the page back to where it was, run praxity identity init '${course}', then export again. Only if this course has never been published, you can instead run praxity identity init '${course}' --rederive --confirm-unpublished; those pages then get new IDs.`,
						);
						expect(await projectDiskSnapshot(course)).toEqual(bytes);
						const pageIds = Object.entries(original)
							.filter(([, node]) => node.kind === "page" && node.label === "Untitled")
							.map(([id]) => id);
						expect(pageIds).toHaveLength(2);
						if (repair === "move back") {
							await writeFile(path.join(course, "lesson-1.prax"), before[0]);
							await writeFile(path.join(course, "lesson-2.prax"), before[1]);
							const restored = await init();
							expect(restored.exitCode, restored.stderr).toBe(0);
							expect(JSON.parse(restored.stdout)).toEqual({ ok: true, changed: false });
						} else {
							const confirmed = await init("--rederive", "--confirm-unpublished");
							expect(confirmed.exitCode, confirmed.stderr).toBe(0);
							expect(
								JSON.parse(confirmed.stdout)
									.retired.map((node: { id: string }) => node.id)
									.sort(),
							).toEqual([...pageIds].sort());
						}
						const stored: Record<string, IdentityNode> = Object.assign(
							{},
							...(await loadIdentityStore(course)).snapshots.map((s) => s.nodes),
						);
						for (const [id, node] of Object.entries(original)) {
							expect(stored[id].status).toBe(
								repair === "confirmed rederive" && pageIds.includes(id) ? "retired" : "active",
							);
							if (node.kind === "block")
								expect(stored[stored[id].parent ?? ""]?.status).toBe("active");
						}
						for (const [index, source] of (repair === "move back" ? before : moved).entries())
							expect(await readFile(path.join(course, `lesson-${index + 1}.prax`))).toEqual(
								Buffer.from(source),
							);
						const exported = await exportHtml();
						expect(exported.exitCode, exported.stderr).toBe(0);
						const zip = new AdmZip(output);
						const html = zip
							.getEntries()
							.filter((entry) => entry.entryName.endsWith(".html"))
							.map((entry) => zip.readAsText(entry))
							.join("\n");
						for (const [id, node] of Object.entries(original))
							if (node.kind === "block") expect(html).toContain(id);
						const unchanged = await init();
						expect(unchanged.exitCode).toBe(0);
						expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
					},
				);
			});
		},
	);

	describe.each([
		[
			"distinct titles moved across lessons",
			["# Alpha\n\nAlpha text.\n\n# Beta\n\nBeta text.\n", secondPage],
			["# Alpha\n\nAlpha text.\n", `${secondPage}\n# Beta\n\nBeta text.\n`],
		],
		[
			"same titles swapped within one lesson",
			["# Practice\n\nAlpha text.\n\n# Practice\n\nBeta text.\n", secondPage],
			["# Practice\n\nBeta text.\n\n# Practice\n\nAlpha text.\n", secondPage],
		],
	] satisfies [string, [string, string], [string, string]][])(
		"same-titled page control: %s",
		(_, before, after) => {
			let template: string;
			let original: Record<string, IdentityNode>;
			beforeAll(async () => {
				template = await mkdtemp(path.join(os.tmpdir(), "praxity-page-control-"));
				fixtureRoots.push(template);
				await writeFile(
					path.join(template, "course.yaml"),
					"title: Example\nlessons: [lesson-1.prax, lesson-2.prax]\n",
				);
				await writeFile(path.join(template, "lesson-1.prax"), before[0]);
				await writeFile(path.join(template, "lesson-2.prax"), before[1]);
				expect(
					(
						await runPraxityCli(["identity", "init", template], {
							appVersion: "1.0.0",
							exportAssetsDir: exportAssetsTemplate,
						})
					).exitCode,
				).toBe(0);
				original = Object.assign(
					{},
					...(await loadIdentityStore(template)).snapshots.map((s) => s.nodes),
				);
			});
			it.each(["en", "fr"])("keeps every ID through init and HTML export in %s", async (locale) => {
				await cp(template, projectDir, { recursive: true });
				const runtime = { appVersion: "1.0.0", exportAssetsDir };
				const init = () =>
					runPraxityCli(["identity", "init", projectDir, "--lang", locale], runtime);
				await writeFile(path.join(projectDir, "lesson-1.prax"), after[0]);
				await writeFile(path.join(projectDir, "lesson-2.prax"), after[1]);
				const moved = await init();
				expect(moved.exitCode, moved.stderr).toBe(0);
				const stored = Object.assign(
					{},
					...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
				);
				for (const id of Object.keys(original)) expect(stored[id].status).toBe("active");
				const exported = await runPraxityCli(
					[
						"export",
						projectDir,
						"--format",
						"html",
						"--output",
						path.join(exportAssetsDir, "page-control.zip"),
						"--lang",
						locale,
					],
					runtime,
				);
				expect(exported.exitCode, exported.stderr).toBe(0);
				expect(JSON.parse((await init()).stdout)).toEqual({ ok: true, changed: false });
			});
		},
	);

	it.each(["en", "fr"])(
		"same-titled page count raised keeps duplicate advice in %s",
		async (locale) => {
			const first = `${untitled}Alpha text.\n\n${untitled}Beta text.\n`;
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Example\nlessons: [lesson-1.prax, lesson-2.prax]\n",
			);
			await writeFile(path.join(projectDir, "lesson-1.prax"), first);
			await writeFile(path.join(projectDir, "lesson-2.prax"), secondPage);
			const runtime = { appVersion: "1.0.0", exportAssetsDir };
			const init = () => runPraxityCli(["identity", "init", projectDir, "--lang", locale], runtime);
			expect((await init()).exitCode).toBe(0);
			const original = Object.assign(
				{},
				...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
			);
			await writeFile(path.join(projectDir, "lesson-1.prax"), `${first}\n${untitled}Gamma text.\n`);
			const bytes = await projectDiskSnapshot(projectDir);
			const refused = await init();
			expect(await projectDiskSnapshot(projectDir)).toEqual(bytes);
			const refusedExport = await runPraxityCli(
				[
					"export",
					projectDir,
					"--format",
					"html",
					"--output",
					path.join(exportAssetsDir, "extra-page.zip"),
					"--lang",
					locale,
				],
				runtime,
			);
			expect(refused.exitCode).toBe(1);
			expect(refusedExport.exitCode).toBe(1);
			expect(JSON.parse(refused.stdout).error.message).toBe(
				locale === "fr"
					? `Initialisation des identités refusée : lesson-1.prax:9 répète un bloc qui a déjà un identifiant ; Praxity ne peut pas savoir quelle copie le garde. Modifiez ou supprimez la copie en trop, puis lancez praxity identity init '${projectDir}'. La copie dont le texte n'a pas changé garde l'identifiant d'origine.`
					: `Identity initialization refused: lesson-1.prax:9 repeats a block that already has an ID, so Praxity can't tell which copy keeps it. Change or remove the extra copy, then run praxity identity init '${projectDir}'. The copy with the unchanged text keeps the original ID.`,
			);
			expect(JSON.parse(refusedExport.stdout).error.message).toBe(
				locale === "fr"
					? `Export refusé : lesson-1.prax:9 répète un bloc qui a déjà un identifiant. Modifiez ou supprimez la copie en trop, lancez praxity identity init '${projectDir}', puis relancez l'export.`
					: `Export refused: lesson-1.prax:9 repeats a block that already has an ID. Change or remove the extra copy, run praxity identity init '${projectDir}', then export again.`,
			);
			expect(await projectDiskSnapshot(projectDir)).toEqual(bytes);
			await writeFile(path.join(projectDir, "lesson-1.prax"), first);
			expect(JSON.parse((await init()).stdout)).toEqual({ ok: true, changed: false });
			const stored = Object.assign(
				{},
				...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
			);
			for (const id of Object.keys(original)) expect(stored[id].status).toBe("active");
			const exported = await runPraxityCli(
				[
					"export",
					projectDir,
					"--format",
					"html",
					"--output",
					path.join(exportAssetsDir, "extra-page.zip"),
					"--lang",
					locale,
				],
				runtime,
			);
			expect(exported.exitCode, exported.stderr).toBe(0);
		},
	);

	it("exports a hand-written multi-lesson course only after explicit identity initialization", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Example\nlocale: en\nlessons: [lesson-1.prax, lesson-2.prax]\n",
		);
		await writeFile(path.join(projectDir, "lesson-1.prax"), "# First page\n\nFirst lesson.\n");
		await writeFile(path.join(projectDir, "lesson-2.prax"), "# Second page\n\nSecond lesson.\n");
		const runtime = { appVersion: "1.0.0", exportAssetsDir };
		const output = path.join(exportAssetsDir, "course.zip");
		const args = ["export", projectDir, "--format", "html", "--output", output];
		for (const [locale, advice] of [
			[
				"en",
				`Run praxity identity init '${projectDir}' to record page and block identity, then export again. Resolve any reported source or identity errors first.`,
			],
			[
				"fr",
				`Exécutez praxity identity init '${projectDir}' pour enregistrer les identités des pages et des blocs, puis relancez l'export. Corrigez d'abord toute erreur de source ou d'identité signalée.`,
			],
		]) {
			const refused = await runPraxityCli([...args, "--lang", locale], runtime);
			expect(refused.exitCode).toBe(1);
			expect(JSON.parse(refused.stdout).error.code).toBe("project_invalid");
			expect(JSON.parse(refused.stdout).error.message).toContain(advice);
			expect(refused.stderr).toContain(advice);
			expect(JSON.parse(refused.stdout).error.message.split("\n")[0]).toBe(
				locale === "fr"
					? "Export refusé : les identités du cours doivent être enregistrées ou examinées avant l'export."
					: "Export refused: course identity must be recorded or reviewed before export.",
			);
			await expect(
				readFile(path.join(projectDir, ".praxity/identity/course.json")),
			).rejects.toMatchObject({ code: "ENOENT" });
		}
		expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
		const identityDirectory = ".praxity/identity";
		const paths = [
			"course.yaml",
			"lesson-1.prax",
			"lesson-2.prax",
			...(await readdir(path.join(projectDir, identityDirectory), { recursive: true }))
				.filter((file) => file.endsWith(".json"))
				.map((file) => path.join(identityDirectory, file)),
		];
		const snapshot = () =>
			Promise.all(
				paths.map(async (file) => ({
					bytes: await readFile(path.join(projectDir, file)),
					mtime: (await stat(path.join(projectDir, file))).mtimeMs,
				})),
			);
		const beforeExport = await snapshot();
		const exported = await runPraxityCli(args, runtime);
		expect(exported.exitCode).toBe(0);
		expect(await snapshot()).toEqual(beforeExport);
		const zip = new AdmZip(await readFile(output));
		const html = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => zip.readAsText(entry))
			.join("\n");
		expect(html).toContain("First lesson.");
		expect(html).toContain("Second lesson.");
	});

	it("routes an invalid addition to source repair without suggesting re-derivation", async () => {
		await writeFile(path.join(projectDir, "lesson-1.prax"), "# First\n\nOriginal paragraph.\n");
		const runtime = { appVersion: "1.0.0", exportAssetsDir };
		expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
		const before = await loadIdentityStore(projectDir);
		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"# First\n\nOriginal paragraph.\n\n::: note\nUnclosed addition\n",
		);
		const refused = await runPraxityCli(
			[
				"export",
				projectDir,
				"--format",
				"html",
				"--output",
				path.join(exportAssetsDir, "invalid.zip"),
			],
			runtime,
		);
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).not.toContain("--rederive");
		expect((await runPraxityCli(["identity", "init", projectDir], runtime)).stderr).toContain(
			"lesson-1.prax:5 contains a source error",
		);
		expect(await loadIdentityStore(projectDir)).toEqual(before);
	});

	it.each(["append", "insert"])(
		"records two hand-added headings, %s, preserving every saved ID",
		async (placement) => {
			const original = "# First\n\nOriginal paragraph.\n\n## Existing heading\n\nLast paragraph.\n";
			const additions = "## Added one\n\n## Added two\n\n";
			await writeFile(path.join(projectDir, "lesson-1.prax"), original);
			const runtime = { appVersion: "1.0.0", exportAssetsDir };
			expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
			const before = await loadIdentityStore(projectDir);
			const oldIds = before.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes));
			const source =
				placement === "append"
					? original + additions
					: original.replace("## Existing", `${additions}## Existing`);
			await writeFile(path.join(projectDir, "lesson-1.prax"), source);
			const args = [
				"export",
				projectDir,
				"--format",
				"html",
				"--output",
				path.join(exportAssetsDir, "additions.zip"),
			];
			for (const locale of ["en", "fr"]) {
				const refused = await runPraxityCli([...args, "--lang", locale], runtime);
				expect(refused.exitCode).toBe(1);
				expect(refused.stderr).toContain("praxity identity init");
				expect(refused.stderr).not.toContain("--rederive");
				const line = placement === "append" ? 8 : 5;
				expect(refused.stderr).toContain(`lesson-1.prax:${line}`);
				expect(refused.stderr).toContain(`lesson-1.prax:${line + 2}`);
				expect(refused.stderr).toContain('"First"');
			}
			expect(await loadIdentityStore(projectDir)).toEqual(before);
			expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
			const after = await loadIdentityStore(projectDir);
			const nodes = Object.assign({}, ...after.snapshots.map((snapshot) => snapshot.nodes));
			for (const id of oldIds) expect(nodes[id].status).toBe("active");
			const newHeadings = Object.entries(nodes).filter(([, node]) =>
				["Added one", "Added two"].includes((node as { label: string }).label),
			);
			expect(newHeadings).toHaveLength(2);
			for (const [id] of newHeadings) expect(oldIds).not.toContain(id);
			expect(await readFile(path.join(projectDir, "lesson-1.prax"), "utf8")).toBe(source);
			expect((await runPraxityCli(args, runtime)).exitCode).toBe(0);
			expect(
				JSON.parse((await runPraxityCli(["identity", "init", projectDir], runtime)).stdout),
			).toEqual({ ok: true, changed: false });
			expect(await loadIdentityStore(projectDir)).toEqual(after);
		},
	);

	it.each(["en", "fr"])(
		"gives ambiguous duplicate export the duplicate repair route in %s",
		async (locale) => {
			await writeFile(path.join(projectDir, "lesson-1.prax"), "# First\n\nRepeated.\n");
			const runtime = { appVersion: "1.0.0", exportAssetsDir };
			expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# First\n\nRepeated.\n\nRepeated.\n",
			);
			const before = await loadIdentityStore(projectDir);
			const plain = await runPraxityCli(
				["identity", "init", projectDir, "--lang", locale],
				runtime,
			);
			const exported = await runPraxityCli(
				[
					"export",
					projectDir,
					"--format",
					"html",
					"--output",
					path.join(exportAssetsDir, "duplicate.zip"),
					"--lang",
					locale,
				],
				runtime,
			);
			expect(plain.exitCode).toBe(1);
			expect(exported.exitCode).toBe(1);
			expect(JSON.parse(exported.stdout).error.message).toBe(
				locale === "en"
					? `Export refused: lesson-1.prax:5 repeats a block that already has an ID. Change or remove the extra copy, run praxity identity init '${projectDir}', then export again.`
					: `Export refusé : lesson-1.prax:5 répète un bloc qui a déjà un identifiant. Modifiez ou supprimez la copie en trop, lancez praxity identity init '${projectDir}', puis relancez l'export.`,
			);
			expect(exported.stderr).not.toContain("--rederive");
			expect(exported.stderr).not.toContain('block "Repeated."');
			expect(exported.stderr).not.toContain('bloc "Repeated."');
			expect(await loadIdentityStore(projectDir)).toEqual(before);
		},
	);
	describe.each(["en", "fr"])("duplicate settlement exports in %s", (locale) => {
		describe.each([false, true])("saved pending=%s", (savedPending) => {
			let originalId: string;
			const original = "# First\n\nRepeated.\n\nOther subject.\n";
			beforeEach(async () => {
				await writeFile(path.join(projectDir, "lesson-1.prax"), original);
				expect(
					(
						await runPraxityCli(["identity", "init", projectDir], {
							appVersion: "1.0.0",
							exportAssetsDir,
						})
					).exitCode,
				).toBe(0);
				const saved = (await loadIdentityStore(projectDir)).snapshots
					.flatMap((s) => Object.entries(s.nodes))
					.find(([, n]) => n.matchText === "Repeated.");
				if (!saved) throw new Error("Missing durable fixture block");
				originalId = saved[0];
				await writeFile(path.join(projectDir, "lesson-1.prax"), `${original}\nRepeated.\n`);
				if (savedPending) {
					await persistLegacyPendingFixture(projectDir);
					const beforeOpen = await readIdentityFixture(projectDir);
					const session = await createStudioProjectSession(projectDir, "1.0.0");
					await session.close();
					expect(await readIdentityFixture(projectDir)).toEqual(beforeOpen);
					expect(
						(await loadIdentityStore(projectDir)).snapshots
							.flatMap((s) => Object.entries(s.nodes))
							.find(([id]) => id === originalId)?.[1].status,
					).toBe("pending");
				}
			});
			it.each(["removed", "reworded"])(
				"exports after the copy is %s and plain init settles",
				async (change) => {
					const runtime = { appVersion: "1.0.0", exportAssetsDir };
					for (const args of [
						["identity", "init", projectDir],
						[
							"export",
							projectDir,
							"--format",
							"html",
							"--output",
							path.join(exportAssetsDir, "refused.zip"),
						],
					]) {
						const refused = await runPraxityCli([...args, "--lang", locale], runtime);
						expect(refused.exitCode).toBe(1);
						expect(refused.stderr).toContain("lesson-1.prax:7");
					}
					await writeFile(
						path.join(projectDir, "lesson-1.prax"),
						change === "removed" ? original : `${original}\nA distinct copy.\n`,
					);
					const initialized = await runPraxityCli(
						["identity", "init", projectDir, "--lang", locale],
						runtime,
					);
					expect(initialized.exitCode, initialized.stderr).toBe(0);
					expect(
						(await loadIdentityStore(projectDir)).snapshots
							.flatMap((s) => Object.entries(s.nodes))
							.find(([id]) => id === originalId)?.[1].status,
					).toBe("active");
					const output = path.join(exportAssetsDir, "settled.zip");
					const exported = await runPraxityCli(
						["export", projectDir, "--format", "html", "--output", output, "--lang", locale],
						runtime,
					);
					expect(exported.exitCode, exported.stderr).toBe(0);
					expect((await stat(output)).size).toBeGreaterThan(0);
					const unchanged = await runPraxityCli(
						["identity", "init", projectDir, "--lang", locale],
						runtime,
					);
					expect(unchanged.exitCode).toBe(0);
					expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
				},
			);
		});
	});
	describe.each(["en", "fr"])("saved-copy move initialization in %s", (locale) => {
		describe.each(["page", "lesson"])("move to another %s", (destination) => {
			it.each([false, true])(
				"exports the move with only the rewrite retired, rewrite=%s",
				async (rewrite) => {
					const runtime = { appVersion: "1.0.0", exportAssetsDir };
					const init = (...flags: string[]) =>
						runPraxityCli(["identity", "init", projectDir, "--lang", locale, ...flags], runtime);
					const output = path.join(exportAssetsDir, "moved-copy.zip");
					const exportCourse = () =>
						runPraxityCli(
							["export", projectDir, "--format", "html", "--output", output, "--lang", locale],
							runtime,
						);
					const first = "# First\n\nRepeated.\n\nOld subject.\n\nRepeated.\n";
					const second = "# Second\n\nOther subject.\n";
					const firstFile = path.join(projectDir, "lesson-1.prax");
					const secondFile = path.join(projectDir, "lesson-2.prax");
					if (destination === "lesson") {
						await writeFile(
							path.join(projectDir, "course.yaml"),
							"title: Example\nlessons: [lesson-1.prax, lesson-2.prax]\n",
						);
						await writeFile(secondFile, second);
					}
					const baseline = destination === "page" ? `${first}\n${second}` : first;
					await writeFile(firstFile, baseline);
					expect((await init()).exitCode).toBe(0);
					const saved = await loadIdentityStore(projectDir);
					const original = Object.assign({}, ...saved.snapshots.map((s) => s.nodes));
					const donors = Object.keys(original)
						.filter((id) => original[id].kind === "block" && original[id].matchText === "Repeated.")
						.sort((a, b) => original[a].span.start - original[b].span.start);
					expect(donors).toHaveLength(2);
					const reduced = "# First\n\nRepeated.\n\nOld subject.\n";
					const moved = (
						destination === "page" ? `${reduced}\n${second}\nRepeated.\n` : reduced
					).replace("Old subject.", rewrite ? "Unrelated replacement." : "Old subject.");
					await writeFile(firstFile, moved);
					if (destination === "lesson") await writeFile(secondFile, `${second}\nRepeated.\n`);
					const rewrittenId = Object.keys(original).find(
						(id) => original[id].kind === "block" && original[id].matchText === "Old subject.",
					);
					expect(rewrittenId).toBeDefined();
					const beforeRefusal = rewrite ? await projectDiskSnapshot(projectDir) : undefined;
					const initialized = await init();
					if (rewrite) {
						for (const [command, result] of [
							["init", initialized],
							["export", await exportCourse()],
						] as const) {
							expect(result.exitCode).toBe(1);
							expect(JSON.parse(result.stdout).error.message).toBe(
								locale === "en"
									? command === "init"
										? `Identity initialization refused: existing blocks could not be matched. Run praxity identity init '${projectDir}' --rederive --confirm-unpublished only if this course has never been published.`
										: `Export refused: course identity must be recorded or reviewed before export.\nExisting blocks could not be matched. Run praxity identity init '${projectDir}' --rederive --confirm-unpublished only if this course has never been published.\nlesson-1.prax:5: page "First", block "Unrelated replacement."`
									: command === "init"
										? `Initialisation des identités refusée : certains blocs existants n'ont pas pu être associés. Exécutez praxity identity init '${projectDir}' --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié.`
										: `Export refusé : les identités du cours doivent être enregistrées ou examinées avant l'export.\nCertains blocs existants n'ont pas pu être associés. Exécutez praxity identity init '${projectDir}' --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié.\nlesson-1.prax:5 : page "First", bloc "Unrelated replacement."`,
							);
						}
						expect(await loadIdentityStore(projectDir)).toEqual(saved);
						expect(await projectDiskSnapshot(projectDir)).toEqual(beforeRefusal);
						expect((await init("--rederive")).exitCode).toBe(1);
						expect(await projectDiskSnapshot(projectDir)).toEqual(beforeRefusal);
						const confirmed = await init("--rederive", "--confirm-unpublished");
						expect(confirmed.exitCode, confirmed.stderr).toBe(0);
						expect(
							JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id),
						).toEqual([rewrittenId]);
					} else {
						expect(initialized.exitCode, initialized.stderr).toBe(0);
					}
					expect(await readFile(firstFile, "utf8")).toBe(moved);
					if (destination === "lesson")
						expect(await readFile(secondFile, "utf8")).toBe(`${second}\nRepeated.\n`);
					const settled = await init();
					expect(settled.exitCode, settled.stderr).toBe(0);
					const stored = Object.assign(
						{},
						...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
					);
					for (const id of Object.keys(original))
						expect(stored[id].status).toBe(rewrite && id === rewrittenId ? "retired" : "active");
					const exported = await exportCourse();
					expect(exported.exitCode, exported.stderr).toBe(0);
					expect((await stat(output)).size).toBeGreaterThan(0);
					const unchanged = await init();
					expect(unchanged.exitCode).toBe(0);
					expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
				},
			);
		});
	});
	describe.each(["en", "fr"])("complete repair routes in %s", (locale) => {
		it.each([false, true])(
			"completes the unpublished alternative for a durable-copy drop, rewrite=%s",
			async (rewrite) => {
				const runtime = { appVersion: "1.0.0", exportAssetsDir };
				const init = (...flags: string[]) =>
					runPraxityCli(["identity", "init", projectDir, "--lang", locale, ...flags], runtime);
				const file = path.join(projectDir, "lesson-1.prax");
				await writeFile(file, "# First\n\nRepeated.\n\nOther subject.\n\nRepeated.\n");
				expect((await init()).exitCode).toBe(0);
				const prior = (await loadIdentityStore(projectDir)).snapshots.flatMap((s) =>
					Object.entries(s.nodes),
				);
				const copies = prior
					.filter(([, n]) => n.kind === "block" && n.matchText === "Repeated.")
					.sort((a, b) => a[1].span.start - b[1].span.start);
				expect(copies).toHaveLength(2);
				const rewritten = prior.find(
					([, n]) => n.kind === "block" && n.matchText === "Other subject.",
				);
				if (!rewritten) throw new Error("Missing durable rewrite block");
				const reduced = `# First\n\nRepeated.\n\n${rewrite ? "Unrelated replacement." : "Other subject."}\n`;
				await writeFile(file, reduced);
				expect((await init()).exitCode).toBe(1);
				expect((await init("--rederive")).exitCode).toBe(1);
				const confirmed = await init("--rederive", "--confirm-unpublished");
				expect(confirmed.exitCode, confirmed.stderr).toBe(0);
				const retired = [copies[0][0], ...(rewrite ? [rewritten[0]] : []), copies[1][0]];
				expect(JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id)).toEqual(
					retired,
				);
				const exported = await runPraxityCli(
					[
						"export",
						projectDir,
						"--format",
						"html",
						"--output",
						path.join(exportAssetsDir, "rederived-copy.zip"),
						"--lang",
						locale,
					],
					runtime,
				);
				expect(exported.exitCode, exported.stderr).toBe(0);
				const stored = Object.assign(
					{},
					...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
				);
				for (const [id, node] of prior)
					expect(stored[id].status).toBe(retired.includes(id) ? "retired" : node.status);
				const unchanged = await init();
				expect(unchanged.exitCode).toBe(0);
				expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
				expect(await readFile(file, "utf8")).toBe(reduced);
			},
		);
		it.each(["mixed unsaved", "mixed saved", "rule 4", "rule 4 with rewrite", "invalid source"])(
			"follows %s through init, export and unchanged init",
			async (route) => {
				const runtime = { appVersion: "1.0.0", exportAssetsDir };
				const init = (...flags: string[]) =>
					runPraxityCli(["identity", "init", projectDir, "--lang", locale, ...flags], runtime);
				const output = path.join(exportAssetsDir, "repaired.zip");
				const exportCourse = () =>
					runPraxityCli(
						["export", projectDir, "--format", "html", "--output", output, "--lang", locale],
						runtime,
					);
				const file = path.join(projectDir, "lesson-1.prax");
				const rule4 = route.startsWith("rule 4");
				const base = `# First\n\nRepeated.\n\nOther subject.\n${rule4 ? "\nRepeated.\n" : ""}`;
				await writeFile(file, base);
				expect((await init()).exitCode).toBe(0);
				const prior = (await loadIdentityStore(projectDir)).snapshots.flatMap((s) =>
					Object.entries(s.nodes),
				);
				const copies = prior
					.filter(([, n]) => n.kind === "block" && n.matchText === "Repeated.")
					.map(([id]) => id);
				expect(copies).toHaveLength(rule4 ? 2 : 1);
				const rewritten = prior.find(
					([, n]) => n.kind === "block" && n.matchText === "Other subject.",
				);
				if (!rewritten) throw new Error("Missing durable rewrite block");
				if (route === "mixed saved") {
					await writeFile(file, `${base}\nRepeated.\n`);
					const session = await createStudioProjectSession(projectDir, "1.0.0");
					await session.close();
				}
				const rewrite = route.startsWith("mixed") || route === "rule 4 with rewrite";
				const repaired = rewrite ? base.replace("Other subject.", "Unrelated replacement.") : base;
				await writeFile(
					file,
					route === "invalid source"
						? `${base}\n::: note\nUnclosed content\n`
						: rule4
							? repaired.replace(/\nRepeated\.\n$/, "\n")
							: `${repaired}\nRepeated.\n`,
				);
				for (const result of [await init(), await exportCourse()]) {
					expect(result.exitCode).toBe(1);
					expect(result.stderr).toContain("praxity identity init");
					if (route === "invalid source") expect(result.stderr).not.toContain("--rederive");
				}
				await writeFile(file, repaired);
				if (rewrite) {
					for (const result of [await init(), await exportCourse()]) {
						expect(result.exitCode).toBe(1);
						expect(result.stderr).toContain("--rederive --confirm-unpublished");
						expect(result.stderr).not.toContain(locale === "en" ? "repeats" : "répète");
					}
					const confirmed = await init("--rederive", "--confirm-unpublished");
					expect(confirmed.exitCode, confirmed.stderr).toBe(0);
					expect(JSON.parse(confirmed.stdout).retired.map((n: { id: string }) => n.id)).toEqual([
						rewritten[0],
					]);
				}
				const settled = await init();
				expect(settled.exitCode, settled.stderr).toBe(0);
				const exported = await exportCourse();
				expect(exported.exitCode, exported.stderr).toBe(0);
				expect((await stat(output)).size).toBeGreaterThan(0);
				const stored = Object.assign(
					{},
					...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
				);
				for (const id of copies) expect(stored[id].status).toBe("active");
				for (const [id, node] of prior) {
					expect(stored[id].status).toBe(rewrite && id === rewritten[0] ? "retired" : node.status);
				}
				expect(await readFile(file, "utf8")).toBe(repaired);
				const unchanged = await init();
				expect(unchanged.exitCode).toBe(0);
				expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
			},
		);
	});

	it.each(["en", "fr"])(
		"routes mixed short edits and additions to re-derivation in %s",
		async (locale) => {
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# First\n\nAlpha paragraph about safety.\n\nBeta paragraph about tools.\n",
			);
			const runtime = { appVersion: "1.0.0", exportAssetsDir };
			expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# First\n\nAlpha paragraph about safety rules.\n\nBrand new block.\n\nBeta paragraph about tools.\n",
			);
			const before = await loadIdentityStore(projectDir);
			const exported = await runPraxityCli(
				[
					"export",
					projectDir,
					"--format",
					"html",
					"--output",
					path.join(exportAssetsDir, "mixed.zip"),
					"--lang",
					locale,
				],
				runtime,
			);
			expect(exported.exitCode).toBe(1);
			expect(exported.stderr).toContain("--rederive --confirm-unpublished");
			expect(exported.stderr).not.toContain("Studio");
			expect(await loadIdentityStore(projectDir)).toEqual(before);
		},
	);

	it.each([
		["en", "block"],
		["fr", "block"],
		["en", "lesson"],
		["fr", "lesson"],
	])("explains retirement on deletion during export in %s, %s", async (locale, removed) => {
		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"# First\n\nRemoved paragraph.\n\n## Surviving heading\n",
		);
		if (removed === "lesson") {
			await writeFile(path.join(projectDir, "lesson-2.prax"), "# Second\n\nSurviving lesson.\n");
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Example\nlessons: [lesson-1.prax, lesson-2.prax]\n",
			);
		}
		const runtime = { appVersion: "1.0.0", exportAssetsDir };
		expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
		await writeFile(path.join(projectDir, "lesson-1.prax"), "# First\n\n## Surviving heading\n");
		if (removed === "lesson") {
			await rm(path.join(projectDir, "lesson-1.prax"));
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Example\nlessons: [lesson-2.prax]\n",
			);
		}
		const before = await loadIdentityStore(projectDir);
		const exported = await runPraxityCli(
			[
				"export",
				projectDir,
				"--format",
				"html",
				"--output",
				path.join(exportAssetsDir, "deletion.zip"),
				"--lang",
				locale,
			],
			runtime,
		);
		expect(exported.exitCode).toBe(1);
		expect(exported.stderr).toContain(
			locale === "en"
				? "Removed blocks retire their IDs; learner records for them stop mapping"
				: "Les identifiants des blocs supprimés sont retirés",
		);
		expect(exported.stderr).toContain("--rederive --confirm-unpublished");
		expect(exported.stderr).not.toContain("Studio");
		expect(await loadIdentityStore(projectDir)).toEqual(before);
	});

	describe.each([
		[
			"en",
			"Re-deriving gives blocks new IDs. Learner records from any earlier published version will not map to the new blocks. Proceed with --confirm-unpublished only if this course has never been published.",
		],
		[
			"fr",
			"La redérivation attribue de nouveaux identifiants aux blocs. Les données des apprenants de toute version publiée auparavant ne correspondront plus aux nouveaux blocs. Utilisez --confirm-unpublished uniquement si ce cours n'a jamais été publié.",
		],
	])("rewritten unpublished course in %s", (locale, warning) => {
		let runtime: { appVersion: string; exportAssetsDir: string };
		let before: Awaited<ReturnType<typeof loadIdentityStore>>;
		let args: string[];
		beforeEach(async () => {
			await writeFile(path.join(projectDir, "lesson-1.prax"), "# First\n\nOriginal paragraph.\n");
			runtime = { appVersion: "1.0.0", exportAssetsDir };
			expect((await runPraxityCli(["identity", "init", projectDir], runtime)).exitCode).toBe(0);
			before = await loadIdentityStore(projectDir);
			await writeFile(
				path.join(projectDir, "lesson-1.prax"),
				"# First\n\nCompletely rewritten material.\n",
			);
			args = [
				"export",
				projectDir,
				"--format",
				"html",
				"--output",
				path.join(exportAssetsDir, "rewrite.zip"),
				"--lang",
				locale,
			];
		});
		it("refuses init and export with the course argument and no Studio route", async () => {
			const refused = await runPraxityCli(args, runtime);
			const plain = await runPraxityCli(
				["identity", "init", projectDir, "--lang", locale],
				runtime,
			);
			for (const result of [refused, plain]) {
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(
					`praxity identity init '${projectDir}' --rederive --confirm-unpublished`,
				);
				expect(result.stderr).not.toContain("Studio");
			}
			expect(await loadIdentityStore(projectDir)).toEqual(before);
		});
		it("requires the literal unpublished confirmation warning", async () => {
			const result = await runPraxityCli(
				["identity", "init", projectDir, "--rederive", "--lang", locale],
				runtime,
			);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(`${warning}\n`);
			expect(await loadIdentityStore(projectDir)).toEqual(before);
		});
		it("lists retired and added identities, then exports the confirmed rewrite", async () => {
			const initialized = await runPraxityCli(
				["identity", "init", projectDir, "--rederive", "--confirm-unpublished", "--lang", locale],
				runtime,
			);
			expect(initialized.exitCode).toBe(0);
			expect(initialized.stderr).toContain(warning);
			const output = JSON.parse(initialized.stdout);
			expect(output.added).toEqual([
				{
					file: "lesson-1.prax",
					page: "First",
					line: 3,
					label: "Completely rewritten material.",
					id: expect.any(String),
				},
			]);
			expect(initialized.stderr).toContain("lesson-1.prax:3");
			expect(initialized.stderr).toContain('"First"');
			const oldIds = before.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes));
			expect(oldIds).not.toContain(output.added[0].id);
			expect((await runPraxityCli(args, runtime)).exitCode).toBe(0);

			expect(output.retired).toEqual([
				expect.objectContaining({
					file: "lesson-1.prax",
					page: "First",
					line: null,
					label: "Original paragraph.",
				}),
			]);
		});
		it("leaves a confirmed rerun unchanged", async () => {
			expect(
				(
					await runPraxityCli(
						[
							"identity",
							"init",
							projectDir,
							"--rederive",
							"--confirm-unpublished",
							"--lang",
							locale,
						],
						runtime,
					)
				).exitCode,
			).toBe(0);
			const after = await loadIdentityStore(projectDir);
			const again = await runPraxityCli(
				["identity", "init", projectDir, "--rederive", "--confirm-unpublished", "--lang", locale],
				runtime,
			);
			expect(JSON.parse(again.stdout)).toEqual({
				ok: true,
				changed: false,
				added: [],
				retired: [],
			});
			expect(again.stderr).toContain(
				locale === "fr"
					? "Aucun bloc ne re\u00e7oit un nouvel identifiant."
					: "No blocks receive new IDs.",
			);
			expect(await loadIdentityStore(projectDir)).toEqual(after);
		});
	});

	it.each([
		[
			"en",
			'Project recovery required. Reopen the course in Studio or run praxity recovery run "<project-dir>"',
		],
		[
			"fr",
			'Récupération du projet nécessaire. Rouvrez le cours dans Studio ou exécutez praxity recovery run "<project-dir>"',
		],
	])(
		"names a recovery route after an interrupted write in %s without changing the journal",
		async (locale, advice) => {
			const runtime = { appVersion: "1.0.0", exportAssetsDir };
			const source = "# Interrupted\n\nBody.\n";
			await rm(path.join(projectDir, "lesson-1.prax"));
			await writeFile(
				path.join(projectDir, "course.yaml"),
				"title: Example\nlessons: [lesson.prax]\n",
			);
			await writeFile(path.join(projectDir, "lesson.prax"), source);
			expect(
				(await runPraxityCli(["identity", "init", projectDir, "--lang", locale], runtime)).exitCode,
			).toBe(0);
			const originalIds = (await loadIdentityStore(projectDir)).snapshots.flatMap((s) =>
				Object.keys(s.nodes),
			);
			await writeFile(path.join(projectDir, "lesson.prax"), `${source}\nBody.\n`);
			await killJournalWriter(projectDir, "identity-first");
			const journal = path.join(projectDir, ".praxity-transaction.json");
			const before = await readFile(journal);
			const unconfirmed = await runPraxityCli(
				["identity", "init", projectDir, "--rederive", "--lang", locale],
				{ appVersion: "1.0.0", exportAssetsDir },
			);
			expect(unconfirmed.exitCode).toBe(1);
			expect(JSON.parse(unconfirmed.stdout).error.code).toBe("ERECOVERYREQUIRED");
			expect(unconfirmed.stderr).toContain(advice);
			expect(await readFile(journal)).toEqual(before);
			await expect(
				exportProject({
					projectDir,
					format: "html",
					exportAssetsDir,
					scope: "course",
					fallbackCompletionThreshold: 0.8,
					enforceAccessibility: false,
				}),
			).rejects.toMatchObject({ cause: { code: "ERECOVERYREQUIRED" } });
			expect(await readFile(journal)).toEqual(before);
			const result = await runPraxityCli(
				[
					"export",
					projectDir,
					"--format",
					"html",
					"--output",
					path.join(exportAssetsDir, "interrupted.zip"),
					"--lang",
					locale,
				],
				{ appVersion: "1.0.0", exportAssetsDir },
			);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe("ERECOVERYREQUIRED");
			expect(JSON.parse(result.stdout).error.message).toContain(advice);
			expect(result.stderr).toContain(advice);
			expect(await readFile(journal)).toEqual(before);
			expect(
				(
					await runPraxityCli(["recovery", "run", projectDir], {
						appVersion: "1.0.0",
						exportAssetsDir,
					})
				).exitCode,
			).toBe(0);
			const pending = await runPraxityCli(
				["identity", "init", projectDir, "--lang", locale],
				runtime,
			);
			expect(pending.exitCode).toBe(1);
			expect(pending.stderr).toContain("lesson.prax:5");
			await writeFile(path.join(projectDir, "lesson.prax"), source);
			const initialized = await runPraxityCli(
				["identity", "init", projectDir, "--lang", locale],
				runtime,
			);
			expect(initialized.exitCode, initialized.stderr).toBe(0);
			const exported = await runPraxityCli(
				[
					"export",
					projectDir,
					"--format",
					"html",
					"--output",
					path.join(exportAssetsDir, "recovered.zip"),
					"--lang",
					locale,
				],
				runtime,
			);
			expect(exported.exitCode, exported.stderr).toBe(0);
			const stored = Object.assign(
				{},
				...(await loadIdentityStore(projectDir)).snapshots.map((s) => s.nodes),
			);
			for (const id of originalIds) expect(stored[id].status).toBe("active");
			const unchanged = await runPraxityCli(
				["identity", "init", projectDir, "--lang", locale],
				runtime,
			);
			expect(unchanged.exitCode).toBe(0);
			expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
		},
	);

	it("exports decorative card images without an accessibility override", async () => {
		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"# Untitled {hideTitle}\n\n::: cards Decorative cards {layout=grid}\n:: Safety\n![](/assets/safety.webp){decorative}\n\n::: back\n![](/assets/safety.webp){decorative}\n:::\n:::\n",
		);
		const result = await exportProject({
			manifestPolicy: "write" as const,
			projectDir,
			format: "html",
			exportAssetsDir,
			scope: "course",
			fallbackCompletionThreshold: 1,
			enforceAccessibility: true,
		});
		expect(result.criticalAccessibilityIssues).toEqual([]);
		const zip = new AdmZip(result.zip);
		const html = zip
			.getEntries()
			.filter((entry) => entry.entryName.endsWith(".html"))
			.map((entry) => zip.readAsText(entry))
			.join("\n");
		expect(html).toContain("praxity-card");
		expect(html.match(/<img[^>]*alt=""[^>]*role="presentation"/g)).toHaveLength(2);
	}, 20_000);

	it("SCORM 1.2: produces a valid package with required files", async () => {
		const exportInput = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath: path.join(exportAssetsDir, "viewer.version.json"),
			lessonFilename: "lesson-1.prax",
		});

		const result = await buildScormPackage(exportInput, {
			mode: "desktop",
			format: "scorm12",
			prebuiltAssetsDir: exportAssetsDir,
			projectDir,
		});

		expect(result.pageCount).toBeGreaterThanOrEqual(1);

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		expect(entries).toContain("imsmanifest.xml");
		expect(zip.readAsText("PRAXITY-COURSE-RUNTIME-LICENSE.txt")).toBe(
			await fixtureCourseRuntimeLicense(),
		);
		expect(entries).not.toContain("viewer.css");
		expect(entries.some((entry) => /^styles\.[a-f0-9]{12}\.css$/.test(entry))).toBe(true);
		expect(entries).toContain(SHELL_FILENAME);
		expect(entries).toContain(RESUME_FILENAME);
		expect(entries).toContain(HOST_FILENAMES.scorm12);
		expect(entries).not.toContain(HOST_FILENAMES.electronPreview);
		expect(entries).not.toContain(HOST_FILENAMES.scorm2004);
		expect(entries).not.toContain(HOST_FILENAMES.xapi);
		expect(entries).not.toContain("scorm-runtime.js");
		expect(entries).toContain("adlcp_rootv1p2.xsd");
		expect(entries.some((entry) => entry === "viewer.js" || /^viewer\..*\.js$/.test(entry))).toBe(
			false,
		);
		expect(entries).toContain("assets/safety.webp");

		const manifest = zip.readAsText("imsmanifest.xml");
		expect(manifest).toContain("1.2");
		expect(manifest).toContain("Workplace Safety 101");
		expect(manifest).toContain('adlcp:scormtype="sco"');
	}, 20_000);

	it("exports authored content in a SCORM 2004 4th Edition package", async () => {
		const result = await exportProject({
			manifestPolicy: "write" as const,
			projectDir,
			format: "scorm-2004",
			scorm2004Edition: "4th",
			exportAssetsDir,
			scope: "lesson",
			lessonFilename: "lesson-1.prax",
			fallbackCompletionThreshold: 1,
			enforceAccessibility: true,
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		expect(entries).toContain("adlcp_v1p3.xsd");
		expect(entries).toContain(HOST_FILENAMES.scorm2004);
		expect(entries).not.toContain(HOST_FILENAMES.scorm12);
		expect(entries).not.toContain(HOST_FILENAMES.xapi);
		expect(entries).not.toContain("scorm-runtime.js");
		const manifest = zip.readAsText("imsmanifest.xml");
		expect(manifest).toContain("2004 4th Edition");
		expect(manifest).toContain("imscp_v1p1");
		expect(manifest).toContain('adlcp:scormType="sco"');
		expect(
			zip
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))
				.some((entry) => zip.readAsText(entry).includes("Welcome to workplace safety training.")),
		).toBe(true);
	}, 20_000);

	it("packages a cast avatar in static dialogue HTML", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Dialogue\nlocale: en\ncast:\n  roger:\n    name: Roger\n    avatar: assets/roger.png\nlessons:\n  - lesson-1.prax\n",
		);
		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"---\n{ cast: { roger: {} } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- roger: Hi\n:::\n",
		);
		await copyFile(
			new URL(
				"../../../../../packages/export-pipeline/src/__tests__/fixtures/opaque-wide.png",
				import.meta.url,
			),
			path.join(projectDir, "assets", "roger.png"),
		);
		const result = await exportProject({
			manifestPolicy: "write" as const,
			projectDir,
			format: "html",
			exportAssetsDir,
			scope: "lesson",
			lessonFilename: "lesson-1.prax",
			fallbackCompletionThreshold: 1,
			enforceAccessibility: true,
		});
		const zip = new AdmZip(result.zip);
		const avatar = zip.getEntries().find((entry) => entry.entryName.endsWith("assets/roger.png"));
		expect(avatar).toBeTruthy();
		const page = zip
			.getEntries()
			.find(
				(entry) =>
					entry.entryName.endsWith(".html") && zip.readAsText(entry).includes("praxity-dialogue"),
			);
		expect(page).toBeTruthy();
		if (!page) throw new Error("Missing dialogue page");
		const html = zip.readAsText(page);
		expect(html).toContain("<bdi>Roger</bdi>");
		expect(html).toContain(
			`<img class="praxity-dialogue-avatar" src="${avatar?.entryName}" alt="" role="presentation" />`,
		);
	}, 15_000);

	it("exports a local avatar: none override without an image asset", async () => {
		await writeFile(
			path.join(projectDir, "course.yaml"),
			"title: Dialogue\nlocale: en\ncast:\n  roger:\n    name: Roger\n    avatar: assets/roger.png\nlessons:\n  - lesson-1.prax\n",
		);
		await writeFile(
			path.join(projectDir, "lesson-1.prax"),
			"---\n{ cast: { roger: { avatar: none } } }\n---\n\n# Untitled {hideTitle}\n\n::: dialogue\n- roger: Hi\n:::\n",
		);
		await copyFile(
			new URL(
				"../../../../../packages/export-pipeline/src/__tests__/fixtures/opaque-wide.png",
				import.meta.url,
			),
			path.join(projectDir, "assets", "roger.png"),
		);
		const result = await exportProject({
			manifestPolicy: "write" as const,
			projectDir,
			format: "html",
			exportAssetsDir,
			scope: "lesson",
			lessonFilename: "lesson-1.prax",
			fallbackCompletionThreshold: 1,
			enforceAccessibility: true,
		});
		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries();
		expect(entries.some((entry) => entry.entryName.endsWith("assets/none"))).toBe(false);
		expect(entries.some((entry) => entry.entryName.endsWith("assets/roger.png"))).toBe(false);
		const page = entries.find(
			(entry) =>
				entry.entryName.endsWith(".html") && zip.readAsText(entry).includes("praxity-dialogue"),
		);
		expect(page).toBeTruthy();
		if (!page) throw new Error("Missing dialogue page");
		const html = zip.readAsText(page);
		expect(html).toContain("<bdi>Roger</bdi>");
		expect(html).not.toMatch(/<img\b/u);
	}, 15_000);

	it("HTML: produces a zip without SCORM manifest/runtime", async () => {
		const exportInput = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath: path.join(exportAssetsDir, "viewer.version.json"),
			lessonFilename: "lesson-1.prax",
		});

		const result = await buildScormPackage(exportInput, {
			mode: "desktop",
			format: "html",
			prebuiltAssetsDir: exportAssetsDir,
			projectDir,
		});

		const zip = new AdmZip(result.zip);
		const entries = zip.getEntries().map((entry) => entry.entryName);
		expect(entries).not.toContain("imsmanifest.xml");
		expect(entries).not.toContain("scorm-runtime.js");
		expect(entries).not.toContain(HOST_FILENAMES.scorm12);
		expect(entries).not.toContain(HOST_FILENAMES.scorm2004);
		expect(entries).not.toContain(HOST_FILENAMES.xapi);
		expect(entries).not.toContain("viewer.css");
		expect(entries.some((entry) => /^styles\.[a-f0-9]{12}\.css$/.test(entry))).toBe(true);
		expect(entries).toContain("assets/safety.webp");
	}, 20_000);

	it("handles missing assets directory gracefully", async () => {
		await rm(path.join(projectDir, "assets"), { recursive: true, force: true });

		const exportInput = await buildExportInputFromProject({
			manifestPolicy: "write" as const,
			projectDir,
			completionThreshold: 0.8,
			viewerVersionPath: path.join(exportAssetsDir, "viewer.version.json"),
			lessonFilename: "lesson-1.prax",
		});

		const result = await buildScormPackage(exportInput, {
			mode: "desktop",
			format: "scorm12",
			prebuiltAssetsDir: exportAssetsDir,
			projectDir,
		});

		expect(result.zip.length).toBeGreaterThan(0);
	}, 20_000);
});
