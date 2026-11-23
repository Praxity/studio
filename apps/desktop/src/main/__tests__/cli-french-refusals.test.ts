import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runPraxityCli } from "../cli";
import en from "../cli-messages/en.json";
import fr from "../cli-messages/fr.json";
import { createStudioProjectSession } from "../studio/project-session";
import { type StudioServer, startStudioServer } from "../studio/server";
import { sessionResult } from "./fixtures/studio-session";

const mocks = vi.hoisted(() => ({ exportProject: vi.fn() }));
vi.mock("../export/export-project", () => ({
	exportProject: mocks.exportProject,
	ProjectExportError: class extends Error {},
}));
const roots: string[] = [];
const servers: StudioServer[] = [];
const runtime = { appVersion: "0.3.0", exportAssetsDir: "unused" };
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "cli-french-"));
	roots.push(root);
	const projectDir = join(root, "course");
	await mkdir(projectDir);

	await writeFile(
		join(projectDir, "lesson.prax"),
		"---\nid: french-cli\ntitle: Test\n---\n# Hello\n",
	);

	return { projectDir };
}
it.each([
	[["export"], "Le dossier du projet est manquant."],
	[["studio"], "Le dossier du projet est manquant."],
	[["export", "course"], "L’option --format est manquante."],
	[["export", "course", "--format", "html"], "L’option --output est manquante."],
	[["export", "--format"], "L’option --format exige une valeur."],
	[["export", "--output"], "L’option --output exige une valeur."],
	[["export", "--format", "bad"], "Format non pris en charge : bad"],
	[
		["export", "--format", "html", "--format", "html"],
		"L’option --format ne peut être fournie qu’une seule fois.",
	],
	[
		["export", "--output", "a.zip", "--output", "b.zip"],
		"L’option --output ne peut être fournie qu’une seule fois.",
	],
	[
		["export", "--include-answer-sheet", "--include-answer-sheet"],
		"L’option --include-answer-sheet ne peut être fournie qu’une seule fois.",
	],
	[
		["export", "--allow-critical-a11y-issues", "--allow-critical-a11y-issues"],
		"L’option --allow-critical-a11y-issues ne peut être fournie qu’une seule fois.",
	],
	[
		["export", "--paper-size", "bad"],
		"L’option --paper-size exige a4 ou letter et ne peut être fournie qu’une seule fois.",
	],
	[["export", "--bad"], "Option inconnue : --bad"],
	[["export", "course", "extra"], "Argument inattendu : extra"],
	[
		["export", "course", "--format", "html", "--output", "a.pdf"],
		"--output doit désigner un fichier .zip.",
	],
	[
		["export", "course", "--format", "html", "--output", "a.zip", "--include-answer-sheet"],
		"Les options PDF exigent --format pdf.",
	],
	[
		["studio", "course", "--port", "0"],
		"L’option --port exige un nombre entier de 1 à 65535 et ne peut être fournie qu’une seule fois.",
	],
	[
		["studio", "course", "--port"],
		"L’option --port exige un nombre entier de 1 à 65535 et ne peut être fournie qu’une seule fois.",
	],
	[
		["studio", "course", "--bad"],
		"Utilisation : praxity studio <project-dir> [--review] [--port <n>] [--no-open]",
	],
	[["inspect"], "Utilisation : praxity inspect <project-dir> [--schema 0|1]"],
] as const)("localizes refusal %j with --lang before or after it", async (args, message) => {
	for (const argv of [
		[...args, "--lang", "fr"],
		[args[0], "--lang", "fr", ...args.slice(1)],
	]) {
		const result = await runPraxityCli(argv, runtime);
		expect(result.exitCode).not.toBe(0);
		expect(JSON.parse(result.stdout).error.message).toBe(message);
		expect(result.stderr).toContain(message);
	}
});
it("localizes unavailable project paths", async () => {
	const f = await fixture();
	const missing = join(f.projectDir, "missing");
	const result = await runPraxityCli(["studio", missing, "--lang", "fr"], {
		...runtime,
	});
	expect(JSON.parse(result.stdout).error.message).toBe(
		`Le dossier du projet n’est pas accessible : ${missing}`,
	);
});
it.each([true, false])("localizes occupied-port refusal (Studio: %s)", async (studio) => {
	const f = await fixture();
	const holder = createServer((_req, res) =>
		res.end(
			studio
				? JSON.stringify({ service: "praxity-studio", projectDir: f.projectDir })
				: "Other program",
		),
	);
	await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
	try {
		const address = holder.address();
		if (!address || typeof address === "string") throw new Error("No port");
		const result = await runPraxityCli(
			["studio", f.projectDir, "--port", String(address.port), "--lang", "fr"],
			{ ...runtime },
		);
		const message = studio
			? `Le port ${address.port} est déjà utilisé par Studio pour le cours « ${f.projectDir} ». Arrêtez cette instance de Studio ou choisissez un autre port avec --port.`
			: `Le port ${address.port} est déjà utilisé par un autre programme. Arrêtez ce programme ou choisissez un autre port avec --port.`;
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.message).toBe(message);
		expect(result.stderr).toContain(message);
	} finally {
		holder.closeAllConnections();
		await new Promise<void>((resolve) => holder.close(() => resolve()));
	}
});
it("keeps catalogue keys and ICU placeholders paired", () => {
	function leaves(value: object, prefix = ""): Record<string, string> {
		return Object.fromEntries(
			Object.entries(value).flatMap(([key, v]) =>
				typeof v === "string" ? [[prefix + key, v]] : Object.entries(leaves(v, `${prefix + key}.`)),
			),
		);
	}
	const english = leaves(en),
		french = leaves(fr);
	expect(Object.keys(french).sort()).toEqual(Object.keys(english).sort());
	for (const [key, value] of Object.entries(english))
		expect(french[key].match(/\{\w+/g)?.sort(), key).toEqual(value.match(/\{\w+/g)?.sort());
	for (const section of [fr.refusals, fr.serverRefusals])
		for (const value of Object.values(section)) expect(value).not.toContain("?");
});
it.each([
	["/missing", "GET", {}, "La ressource n’est pas disponible"],
	["/api/identity", "POST", {}, "La route d’identité exige GET"],
	["/", "POST", {}, "Le lancement exige GET"],
	["/api/rpc", "GET", {}, "La ressource n’est pas disponible"],
	["/api/rpc", "POST", {}, "Les fichiers statiques sont en lecture seule"],
	["/api/session", "GET", {}, "La ressource n’est pas disponible"],
	["/missing", "GET", { Origin: "https://example.invalid" }, "L’origine n’est pas autorisée"],
	["/missing", "TRACE", {}, "La méthode HTTP n’est pas disponible"],
	["/canvas", "GET", {}, "L’autorisation de lancement du canevas est requise"],
] as const)(
	"localizes HTTP refusal %s %s headers=%j (fr)",
	async (url, method, headers, message) => {
		const f = await fixture();
		const server = await startStudioServer({ ...f, appVersion: "0.3.0", locale: "fr" });
		servers.push(server);
		const { request } = await import("node:http");
		const body = await new Promise<string>((resolve, reject) => {
			const req = request(server.origin + url, { method, headers }, (res) => {
				let text = "";
				res.on("data", (chunk) => (text += chunk));
				res.on("end", () => resolve(text));
			});
			req.on("error", reject);
			req.end();
		});
		expect(JSON.parse(body).error.message).toBe(message);
	},
);

it("localizes help without losing command syntax", async () => {
	const result = await runPraxityCli(["--help", "--lang", "fr"], runtime);
	expect(result.stdout).toContain("Utilisation :");
	expect(result.stdout).toContain("Afficher cette aide");
	expect(result.stdout).toContain("studio démarre un serveur local");
});
it.each(["output", "write", "accessibility", "warning", "storageAnswers", "storageCourse"])(
	"localizes export advice: %s",
	async (kind) => {
		const f = await fixture();
		const output =
			kind === "output" ? join(f.projectDir, "missing", "out.zip") : join(f.projectDir, "out.zip");
		mocks.exportProject.mockResolvedValue({
			zip: Buffer.from("zip"),
			pageCount: 1,
			criticalAccessibilityIssues: kind === "warning" ? [{}] : [],
			...(kind.startsWith("storage")
				? {
						scorm12Storage: {
							atRisk: true,
							estimatedLength: 5000,
							limit: 4096,
							reportingSelfCheckCount: kind === "storageAnswers" ? 1 : 0,
						},
					}
				: {}),
		});
		if (kind === "write") await writeFile(output, "existing");
		if (kind === "write")
			mocks.exportProject.mockImplementation(async () => {
				await rm(output);
				await mkdir(output);
				return { zip: Buffer.from("zip"), pageCount: 1, criticalAccessibilityIssues: [] };
			});
		if (kind === "accessibility") {
			const { ExportAccessibilityError } = await import("../export/accessibility-enforcement");
			mocks.exportProject.mockRejectedValue(
				new ExportAccessibilityError([
					{
						severity: "critical",
						rule: "image-alt",
						outcome: "failed",
						sourceLocation: "lesson.prax:1",
						message: "Alt",
					},
				]),
			);
		}
		const result = await runPraxityCli(
			["export", f.projectDir, "--format", "html", "--output", output, "--lang", "fr"],
			runtime,
		);
		if (kind === "output" || kind === "write")
			expect(JSON.parse(result.stdout).error.message).toBe(
				kind === "output"
					? `Le chemin de sortie n’est pas accessible : ${output}`
					: `Impossible d’enregistrer le fichier exporté : ${output}`,
			);
		else if (kind === "accessibility") {
			expect(JSON.parse(result.stdout).error.message).toBe(
				"Des problèmes d’accessibilité empêchent l’exportation. Corrigez les problèmes signalés, puis réessayez.",
			);
			expect(result.stderr).toContain(
				"La commande praxity export a échoué : Des problèmes d’accessibilité empêchent l’exportation. Corrigez les problèmes signalés, puis réessayez.",
			);
		} else if (kind === "warning")
			expect(result.stderr).toContain(
				"Attention : exportation effectuée malgré 1 problème critique d’accessibilité.",
			);
		else {
			expect(result.stderr).toContain(
				"Attention : une tentative complète exige environ 5000 caractères",
			);
			if (kind === "storageAnswers")
				expect(result.stderr).toContain(
					"ou choisissez le stockage sur l’appareil uniquement pour les réponses d’autoévaluation.",
				);
			expect(result.stderr).toContain(
				kind === "storageAnswers"
					? "La progression et le texte des réponses"
					: "Ce cours est peut-être trop long",
			);
		}
	},
);

it("localizes an unexpected non-Error startup failure", async () => {
	const studio = await import("../studio/server");
	const start = vi.spyOn(studio, "startStudioServer").mockRejectedValueOnce("startup failed");
	try {
		const f = await fixture();
		const result = await runPraxityCli(["studio", f.projectDir, "--lang", "fr"], {
			...runtime,
		});
		expect(JSON.parse(result.stdout).error.message).toBe("Le démarrage de Studio a échoué");
	} finally {
		start.mockRestore();
	}
});

it.each(["empty", "ambiguous"])("localizes project-session startup refusal: %s", async (kind) => {
	const f = await fixture();
	if (kind === "empty") await rm(join(f.projectDir, "lesson.prax"));
	else await writeFile(join(f.projectDir, "other.prax"), "# Other\n");
	const result = await runPraxityCli(["studio", f.projectDir, "--lang", "fr"], {
		...runtime,
	});
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).error.message).toBe(
		"Ce dossier n’a pas de fichier course.yaml : ajoutez-en un ou n’y laissez qu’une seule leçon .prax",
	);
});
it.each([
	["/api/rpc", { method: "missing", args: {} }, "La méthode n’est pas disponible"],
] as const)("localizes retained %s session refusal body=%j (fr)", async (url, body, message) => {
	const f = await fixture();
	const result = await runPraxityCli(["studio", f.projectDir, "--lang", "fr"], {
		...runtime,
	});
	if (!result.studioServer) throw new Error(result.stderr);
	servers.push(result.studioServer);
	const session = await createStudioProjectSession(
		f.projectDir,
		"test",
		undefined,
		undefined,
		"fr",
	);
	try {
		const response = await sessionResult(session, body.method, body.args);
		expect(response.error.message).toBe(message);
	} finally {
		await session.close();
	}
});

it.each([
	["en", "Project has no readable lessons"],
	["fr", "Le projet n’a aucune leçon lisible"],
] as const)(
	"refuses a manifest-backed course without readable lessons (%s)",
	async (locale, message) => {
		const f = await fixture();
		await rm(join(f.projectDir, "lesson.prax"));
		await writeFile(join(f.projectDir, "course.yaml"), "title: Empty\nlessons: []\n");
		const result = await runPraxityCli(["studio", f.projectDir, "--lang", locale], {
			...runtime,
		});
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.message).toBe(message);
		expect(result.stderr).toContain(message);
	},
);
it.each([
	[
		"accessibility",
		0,
		"La commande praxity export a échoué : Des problèmes d’accessibilité empêchent l’exportation. Corrigez les problèmes signalés, puis réessayez.",
	],
	[
		"accessibility",
		1,
		"La commande praxity export a échoué : Des problèmes d’accessibilité empêchent l’exportation. Corrigez les problèmes signalés, puis réessayez.",
	],
	[
		"accessibility",
		2,
		"La commande praxity export a échoué : Des problèmes d’accessibilité empêchent l’exportation. Corrigez les problèmes signalés, puis réessayez.",
	],
	["warning", 1, "Attention : exportation effectuée malgré 1 problème critique d’accessibilité."],
	["warning", 2, "Attention : exportation effectuée malgré 2 problèmes critiques d’accessibilité."],
] as const)(
	"localizes %s response with %i accessibility issues (fr)",
	async (kind, count, message) => {
		const f = await fixture();
		const issues = Array.from({ length: count }, () => ({
			severity: "critical" as const,
			rule: "image-alt",
			outcome: "failed" as const,
			sourceLocation: "lesson.prax:1",
			message: "Alt",
		}));
		if (kind === "accessibility") {
			const { ExportAccessibilityError } = await import("../export/accessibility-enforcement");
			mocks.exportProject.mockRejectedValue(new ExportAccessibilityError(issues));
		} else
			mocks.exportProject.mockResolvedValue({
				zip: Buffer.from("zip"),
				pageCount: 1,
				criticalAccessibilityIssues: issues,
			});
		const result = await runPraxityCli(
			[
				"export",
				f.projectDir,
				"--format",
				"html",
				"--output",
				join(f.projectDir, "out.zip"),
				"--lang",
				"fr",
			],
			runtime,
		);
		expect(result.exitCode).toBe(kind === "accessibility" ? 1 : 0);
		if (kind === "accessibility")
			expect(JSON.parse(result.stdout).error.details.criticalIssueCount).toBe(count);
		expect(result.stderr).toContain(message);
	},
);
