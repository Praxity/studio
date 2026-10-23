import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";
import { StudioExportService } from "../studio/export-service";
import { startStudioServer } from "../studio/server";

const roots: string[] = [];
const servers: { close(): Promise<void> }[] = [];
const resourcesDir = fileURLToPath(new URL("../../../resources/", import.meta.url));
const literalResult = {
	zip: Buffer.from("ZIP"),
	title: "Course",
	pageCount: 1,
	blockCount: 1,
	criticalAccessibilityIssues: [],
};
async function fixture() {
	const root = await mkdtemp(
		join(process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir(), "studio-export-"),
	);
	roots.push(root);
	const projectDir = join(root, "project");
	const editorAssetsDir = join(root, "editor");
	await mkdir(projectDir);
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "index.html"), "<!doctype html><title>Editor</title>");
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	await writeFile(
		join(projectDir, "lesson.prax"),
		"---\ntitle: Course\n---\n\n# Course\n\nExport body.\n",
	);
	await writeFile(join(root, "workspace.praxity.yaml"), "defaultLocale: fr\n");
	return { root, projectDir, editorAssetsDir };
}
async function serverFixture(source?: string, locale?: string) {
	const files = await fixture();
	if (source !== undefined) await writeFile(join(files.projectDir, "lesson.prax"), source);
	if (locale)
		await writeFile(
			join(files.projectDir, "course.yaml"),
			`title: Empty\nlocale: ${locale}\nlessons: [lesson.prax]\n`,
		);
	const server = await startStudioServer({
		...files,
		appVersion: "0.3.0",
		exportAssetsDir: join(resourcesDir, "export-assets"),
		typstExecutablePath:
			process.env.PRAXITY_TEST_TYPST ??
			join(resourcesDir, "typst", process.platform === "win32" ? "typst.exe" : "typst"),
	});
	servers.push(server);
	const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
	const rpc = async (method: string, args: unknown = {}) => {
		const response = await fetch(`${server.origin}/api/rpc`, {
			method: "POST",
			headers: {
				Origin: server.origin,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ method, args }),
		});
		return { status: response.status, ...(await response.json()) };
	};
	return { ...files, server, token, rpc };
}
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("Studio exports", () => {
	describe("write-distractors RPC publication", () => {
		const publications: Array<{
			locale: string;
			format: string;
			scope: string;
			answers: boolean;
			response: Awaited<ReturnType<Awaited<ReturnType<typeof serverFixture>>["rpc"]>>;
			text: string;
		}> = [];
		const refusalKinds = [
			"condition",
			"require",
			"requireContainer",
			"required",
			"deckGate",
			"group",
			"setting",
		];
		const refusals = new Map<
			string,
			Awaited<ReturnType<Awaited<ReturnType<typeof serverFixture>>["rpc"]>>
		>();
		const fixtures: Awaited<ReturnType<typeof serverFixture>>[] = [];
		const source =
			"# Practice\n::: write-distractors PrivateQuestion {name=wd}\nanswer: RPC_PRIVATE_ANSWER\n:: RPC_PRIVATE_LABEL\noption: RPC_PRIVATE_OPTION\n:::\n";
		beforeAll(async () => {
			for (const locale of ["en", "fr"]) {
				const files = await serverFixture(source, locale);
				fixtures.push(files);
				servers.splice(servers.indexOf(files.server), 1);
				roots.splice(roots.indexOf(files.root), 1);
				for (const format of ["html", "pdf"])
					for (const scope of ["course", "lesson"])
						for (const answers of format === "pdf" ? [false, true] : [false]) {
							const response = await files.rpc("exportScorm", {
								format,
								scope,
								locale,
								...(answers ? { includeAnswerSheet: true } : {}),
							});
							let text = "";
							if (response.status === 200) {
								const path = join(files.projectDir, response.result.outputPath);
								text =
									format === "pdf"
										? execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" })
										: new AdmZip(await readFile(path))
												.getEntries()
												.filter((e) => e.entryName.endsWith(".html"))
												.map((e) => e.getData().toString())
												.join("\n");
							}
							publications.push({ locale, format, scope, answers, response, text });
						}
			}
			for (const kind of refusalKinds) refusals.set(kind, await prepareRefusal(kind));
			const first = fixtures[0];
			if (!first) throw new Error("Missing RPC fixture");
			refusals.set(
				"locale",
				await first.rpc("exportScorm", { format: "pdf", scope: "course", locale: "de" }),
			);
		}, 120_000);
		afterAll(async () => {
			await Promise.all(fixtures.map((f) => f.server.close()));
			await Promise.all(fixtures.map((f) => rm(f.root, { recursive: true, force: true })));
		});
		for (const locale of ["en", "fr"])
			for (const format of ["html", "pdf"])
				for (const scope of ["course", "lesson"])
					for (const answers of format === "pdf" ? [false, true] : [false]) {
						it(`publishes distractors ${locale} ${format} ${scope} answers=${answers}`, () => {
							const output = publications.find(
								(p) =>
									p.locale === locale &&
									p.format === format &&
									p.scope === scope &&
									p.answers === answers,
							);
							if (!output) throw new Error("Missing shared RPC output");
							expect(output.response).toMatchObject({
								status: 200,
								ok: true,
								result: { outputPath: expect.stringMatching(/^exports\//) },
							});
							expect(output.text).toContain("PrivateQuestion");
							for (const value of [
								"RPC_PRIVATE_ANSWER",
								"RPC_PRIVATE_LABEL",
								"RPC_PRIVATE_OPTION",
							]) {
								if (answers) expect(output.text).toContain(value);
								else expect(output.text).not.toContain(value);
							}
						});
					}
		it("RPC retains the unsupported UI locale refusal", () => {
			expect(refusals.get("locale")?.status).toBe(400);
		});
		async function prepareRefusal(kind: string) {
			const contained = ["requireContainer", "required", "deckGate"].includes(kind);
			let body = source.slice(source.indexOf(":::"));
			if (kind === "setting") body = body.replace("name=wd", "name=wd private=true");
			if (contained)
				body = `::: accordion {name=outer ${kind === "required" ? "required=true" : kind === "deckGate" ? "deckGate=attempt" : ""}}\n:: Panel\n${body}:::\n`;
			if (kind === "group")
				body = `::: group Practice {mode=all}\n::: choice Public {required=false}\n(x) Yes\n( ) No\n:::\n${body}:::\n`;
			if (["condition", "require", "requireContainer"].includes(kind))
				body += `::: rule\nif: ${kind === "condition" ? "@wd.isCompleted" : "picked"} is true\nthen: ${kind === "condition" ? "set picked = true" : kind === "require" ? "require @wd" : "require @outer"}\n:::\n`;
			const files = await serverFixture(
				`---\nvariables:\n  picked: false\n---\n# Practice\n${body}`,
			);
			fixtures.push(files);
			servers.splice(servers.indexOf(files.server), 1);
			roots.splice(roots.indexOf(files.root), 1);
			return files.rpc("exportScorm", { format: "html", scope: "course" });
		}
		it.each(refusalKinds)("RPC retains distractor %s refusal", (kind) => {
			const response = refusals.get(kind);
			if (!response) throw new Error("Missing shared RPC refusal");

			expect(response.status).toBe(422);
			if (["group", "setting"].includes(kind))
				expect(response.error).toMatchObject({
					code: "project_invalid",
					message: `lesson.prax:${kind === "group" ? 11 : 6}`,
				});
			else expect(response.error.code).toBe("practice-no-tracking");
		});
	});

	const retrievalFixtures: Awaited<ReturnType<typeof serverFixture>>[] = [];
	const retrievalPublications: {
		locale: string;
		format: string;
		scope: string;
		response: Awaited<ReturnType<Awaited<ReturnType<typeof serverFixture>>["rpc"]>>;
		bytes: Buffer;
		source: string;
	}[] = [];
	const retrievalSource =
		"# Practice\n::: retrieval-sheet Recall\n:: Question\nanswer: Answer\n:::\n";
	beforeAll(async () => {
		for (const locale of ["en", "fr"] as const) {
			const files = await serverFixture(retrievalSource, locale === "fr" ? "en" : "fr");
			retrievalFixtures.push(files);
			servers.splice(servers.indexOf(files.server), 1);
			roots.splice(roots.indexOf(files.root), 1);
			for (const format of ["html", "pdf"] as const) {
				for (const scope of ["course", "lesson"] as const) {
					const response = await files.rpc("exportScorm", { format, scope, locale });
					retrievalPublications.push({
						locale,
						format,
						scope,
						response,
						bytes:
							response.status === 200
								? await readFile(join(files.projectDir, response.result.outputPath))
								: Buffer.alloc(0),
						source: await readFile(join(files.projectDir, "lesson.prax"), "utf8"),
					});
				}
			}
		}
	});
	afterAll(async () => {
		await Promise.all(retrievalFixtures.map((files) => files.server.close()));
		await Promise.all(
			retrievalFixtures.map((files) => rm(files.root, { recursive: true, force: true })),
		);
	});
	it.each(["html", "pdf"])("%s RPC retains the located private-choice refusal", async (format) => {
		const { rpc } = await serverFixture(
			"# Practice\n::: choice Question {private required}\n(x) Answer\n( ) Other\n:::\n",
		);
		for (const scope of ["course", "lesson"]) {
			const response = await rpc("exportScorm", { format, scope });
			expect(response.status).toBe(422);
			expect(response.error.message).toBe(
				"lesson.prax:2:1: private-choice-practice-only: A private choice must be optional, unscored, outside assessment groups and without a gate.",
			);
		}
	});

	for (const locale of ["en", "fr"]) {
		for (const format of ["html", "pdf"]) {
			it.each(["course", "lesson"])(
				`publishes a retrieval sheet through ${format} RPC in UI ${locale} at %s scope`,
				(scope) => {
					const output = retrievalPublications.find(
						(output) =>
							output.locale === locale && output.format === format && output.scope === scope,
					);
					if (!output) throw new Error("Missing shared RPC publication");
					expect(output.response.status, JSON.stringify(output.response)).toBe(200);
					expect(output.response).toMatchObject({
						ok: true,
						result: { outputPath: expect.stringMatching(/^exports\//) },
					});
					expect(output.bytes.subarray(0, format === "pdf" ? 4 : 2).toString()).toBe(
						format === "pdf" ? "%PDF" : "PK",
					);
					expect(output.source).toBe(retrievalSource);
					if (format !== "pdf") {
						const html = new AdmZip(output.bytes)
							.getEntries()
							.filter((entry) => entry.entryName.endsWith(".html"))
							.map((entry) => entry.getData().toString())
							.join("\n");
						expect(html).toContain('data-retrieval-side="front"');
						expect(html).toContain('data-retrieval-side="back"');
						expect(html).toContain("<p>Question</p>");
						expect(html).toContain("<p>Answer</p>");
					}
				},
			);
		}
	}

	for (const locale of ["en", "fr"]) {
		it(`keeps an empty ${locale} project editable and exposes its coded publication refusal`, async () => {
			const { rpc } = await serverFixture("", locale);
			for (const [method, args] of [
				["coursePreviewBuild", {}],
				["exportScorm", { format: "html", scope: "course" }],
			] as const) {
				const response = await rpc(method, args);
				expect(response.status, JSON.stringify(response)).toBe(422);
				expect(response.error).toEqual({
					code: "EEMPTYCOURSE",
					message:
						locale === "fr"
							? "Impossible de publier un cours sans pages de contenu. Ajoutez au moins une page."
							: "Cannot publish a course with no content pages. Add at least one page.",
				});
				expect(response.result).toBeUndefined();
			}
		});
		it(`CLI preserves the empty ${locale} refusal and an existing output`, async () => {
			const { projectDir, root } = await serverFixture("", locale);
			for (const format of ["html", "scorm-1.2", "scorm-2004", "pdf"]) {
				const output = join(root, format === "pdf" ? "previous.pdf" : "previous.zip");
				await writeFile(output, "previous output");
				const result = await runPraxityCli(
					["export", projectDir, "--format", format, "--output", output],
					{
						appVersion: "0.3.0",
						exportAssetsDir: join(resourcesDir, "export-assets"),
						typstExecutablePath: process.env.PRAXITY_TEST_TYPST,
					},
				);
				expect(result.exitCode).toBe(1);
				expect(JSON.parse(result.stdout)).toEqual({
					ok: false,
					error: {
						code: "EEMPTYCOURSE",
						message:
							locale === "fr"
								? "Impossible de publier un cours sans pages de contenu. Ajoutez au moins une page."
								: "Cannot publish a course with no content pages. Add at least one page.",
					},
				});
				expect(await readFile(output, "utf8")).toBe("previous output");
			}
		});
	}
	it("writes HTML ZIP and native PDF under exports and authenticates attachment downloads", async () => {
		const { rpc, projectDir, server, token } = await serverFixture();
		for (const format of ["html", "pdf"] as const) {
			const response = await rpc("exportScorm", { format, scope: "course" });
			expect(response.status, JSON.stringify(response)).toBe(200);
			expect(response.result.outputPath).toMatch(
				new RegExp(`^exports/[^/]+\\.${format === "pdf" ? "pdf" : "zip"}$`),
			);
			const file = await readFile(join(projectDir, response.result.outputPath));
			expect(file.subarray(0, format === "pdf" ? 4 : 2).toString()).toBe(
				format === "pdf" ? "%PDF" : "PK",
			);
			const url = new URL(response.result.downloadUrl);
			expect(url.origin).not.toBe(server.origin);
			const download = await fetch(url);
			expect(download.status).toBe(200);
			expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
			expect(download.headers.get("content-type")).toBe(
				format === "pdf" ? "application/pdf" : "application/zip",
			);
			expect(download.headers.get("x-content-type-options")).toBe("nosniff");
			expect(download.headers.get("referrer-policy")).toBe("no-referrer");
			expect(Buffer.from(await download.arrayBuffer())).toEqual(file);
			const path = url.pathname.split("/");
			path[2] = token ?? "";
			expect((await fetch(new URL(path.join("/"), url))).status).toBe(401);
			expect((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(
				403,
			);
			expect((await fetch(new URL(url.pathname, server.origin))).status).toBe(404);
			expect((await fetch(new URL(`${url.pathname}/extra`, url))).status).toBe(401);
			const cap = url.pathname.split("/")[2];
			expect(
				(
					await fetch(`${server.origin}/api/session`, {
						headers: { Authorization: `Bearer ${cap}` },
					})
				).status,
			).toBe(401);
		}
		await expect(readFile(join(projectDir, "course.yaml"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	}, 60_000);
	it("keeps the accessibility gate, requires explicit override and rejects option/schema bypasses", async () => {
		const { rpc } = await serverFixture(
			"---\ntitle: Course\n---\n\n# Course\n\nRead [ ](https://example.com) before starting.\n",
		);
		const blocked = await rpc("exportScorm", { format: "html", scope: "course" });
		expect(blocked.status).toBe(422);
		expect(blocked.error.message).toMatch(/^export_accessibility_blocked:\d+$/);
		for (const args of [
			{ enforced: false },
			{ enforced: false, confirmed: false },
			{ enforced: false, confirmed: true, extra: true },
		])
			expect((await rpc("setAccessibilityExportEnforcement", args)).status).toBe(400);
		expect((await rpc("exportScorm", { format: "html", enforceAccessibility: false })).status).toBe(
			400,
		);
		expect((await rpc("exportScorm", { format: "scorm-1.2" })).status).toBe(400);
		expect(
			(await rpc("setAccessibilityExportEnforcement", { enforced: false, confirmed: true })).status,
		).toBe(200);
		const allowed = await rpc("exportScorm", { format: "html", scope: "course" });
		expect(allowed.status, JSON.stringify(allowed)).toBe(200);
		expect(allowed.result.accessibilityOverride.criticalIssueCount).toBeGreaterThan(0);
		await rpc("setAccessibilityExportEnforcement", { enforced: true });
		expect((await rpc("exportScorm", { format: "html", scope: "course" })).status).toBe(422);
	}, 60_000);
	it("refuses arbitrary destinations and escaping exports links without outside writes", async () => {
		const { rpc, root, projectDir } = await serverFixture();
		const outside = join(root, "outside");
		await mkdir(outside);
		expect((await rpc("exportScorm", { format: "html", outputDir: outside })).status).toBe(422);
		await symlink(
			outside,
			join(projectDir, "exports"),
			process.platform === "win32" ? "junction" : "dir",
		);
		expect((await rpc("exportScorm", { format: "html" })).status).toBe(422);
		expect(await readdir(outside)).toEqual([]);
	}, 60_000);
	it("cancels and closes admitted jobs with no output, then accepts a new job", async () => {
		const { projectDir } = await fixture();
		let entered!: () => void;
		let finish!: (result: typeof literalResult) => void;
		const enteredJob = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let optionsSeen:
			| Parameters<
					NonNullable<ConstructorParameters<typeof StudioExportService>[0]["runExport"]>
			  >[0]
			| undefined;
		const service = new StudioExportService({
			projectDir,
			exportAssetsDir: "runtime",
			registerDownload: () => "download",
			onProgress: () => {},
			runExport: async (options) => {
				optionsSeen = options;
				entered();
				return new Promise((resolve) => {
					finish = resolve;
					options.signal?.addEventListener("abort", () => resolve(literalResult), { once: true });
				});
			},
		});
		const running = service.run({ format: "html", scope: "course" });
		await enteredJob;
		expect(() => service.run({ format: "html", scope: "course" })).toThrow("already running");
		expect(optionsSeen).toMatchObject({
			inheritWorkspaceSettings: false,
			manifestPolicy: "read-only",
			enforceAccessibility: true,
		});
		service.cancel();
		expect(await running).toBeNull();
		await expect(readdir(join(projectDir, "exports"))).rejects.toMatchObject({ code: "ENOENT" });
		const second = service.run({ format: "html", scope: "course" });
		finish(literalResult);
		expect(await second).toMatchObject({ outputPath: expect.stringMatching(/^exports\//) });
		const third = service.run({ format: "html", scope: "course" });
		await service.close();
		expect(await third).toBeNull();
		expect((await readdir(join(projectDir, "exports"))).length).toBe(1);
	});
	it("discloses environment credential availability without exposing or persisting secrets", async () => {
		const { rpc, projectDir, server, token } = await serverFixture();
		vi.stubEnv("SONIOX_API_KEY", "");
		vi.stubEnv("SONIOX_REGION", "eu");
		expect((await rpc("narrationStatus")).result).toEqual({
			configured: false,
			region: "eu",
			disclosureRequired: true,
		});
		vi.stubEnv("SONIOX_API_KEY", "SYNTHETIC-SECRET");
		vi.stubEnv("SONIOX_REGION", "us");
		expect((await rpc("narrationStatus")).result).toEqual({
			configured: true,
			region: "us",
			disclosureRequired: true,
		});
		vi.stubEnv("SONIOX_REGION", "jp");
		expect((await rpc("narrationStatus")).result).toEqual({
			configured: true,
			region: "jp",
			disclosureRequired: true,
		});
		const snapshot = await (
			await fetch(`${server.origin}/api/session`, { headers: { Authorization: `Bearer ${token}` } })
		).text();
		expect(snapshot).not.toContain("SYNTHETIC-SECRET");
		expect((await rpc("narrationConfigure", { apiKey: "SYNTHETIC-SECRET" })).status).toBe(404);
		expect(await readdir(projectDir)).not.toContain("settings.json");
	});
});

describe("highlight RPC publication", () => {
	let files: Awaited<ReturnType<typeof serverFixture>> | undefined;
	beforeAll(async () => {
		files = await serverFixture("# Practice\n::: highlight Title\n:: Target {key}\n:::\n");
		servers.splice(servers.indexOf(files.server), 1);
		roots.splice(roots.indexOf(files.root), 1);
	});
	afterAll(async () => {
		if (!files) return;
		await files.server.close();
		await rm(files.root, { recursive: true, force: true });
	});
	it.each(["html", "pdf"] as const)(
		"%s RPC publishes HTML or preserves the native PDF refusal",
		async (format) => {
			if (!files) throw new Error("Missing highlight RPC fixture");
			const exports = join(files.projectDir, "exports");
			const before = await readdir(exports).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return [];
				throw error;
			});
			const response = await files.rpc("exportScorm", { format, scope: "course" });
			if (format === "pdf") {
				expect(response.status).toBe(422);
				expect(
					await readdir(exports).catch((error: NodeJS.ErrnoException) => {
						if (error.code === "ENOENT") return [];
						throw error;
					}),
				).toEqual(before);
				expect(before.some((file) => file.endsWith(".pdf"))).toBe(false);
				expect(response.error).toMatchObject({ code: "highlight-native-pdf-unsupported" });
				expect(response.error.message).toContain(
					"lesson.prax:2:1: highlight-native-pdf-unsupported:",
				);
			} else {
				expect(response.status).toBe(200);
				const filesWritten = await readdir(join(files.projectDir, "exports"));
				const zip = new AdmZip(await readFile(join(files.projectDir, "exports", filesWritten[0])));
				const html = zip
					.getEntries()
					.filter((e) => e.entryName.endsWith(".html"))
					.map((e) => zip.readAsText(e))
					.join("");
				expect(html).toContain("data-highlight");
				expect(html).toContain("Target");
			}
		},
	);
});
