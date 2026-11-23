import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	identityRetirements,
	identitySourceError,
	identityWriteRetirements,
	initializeCourseIdentity,
	loadIdentityStore,
	resolveCourseIdentity,
} from "../identity-store";
import { resolveLessonSourcesForWrite } from "../lesson-source";
import { OperationService } from "../operations/operation-service";
import { withProjectFileTransaction } from "../project-file-transactions";
import { sourceErrorMessage } from "../studio/identity-review";
import { createStudioProjectSession } from "../studio/project-session";
import { type StudioServer, startStudioServer } from "../studio/server";

const paragraph = "# First\n\nAlpha paragraph about safety.\n\nBeta paragraph about tools.\n";
const accordion = "# First\n\n::: accordion\n:: One\nFirst body.\n:: Two\nSecond body.\n:::\n";
const choice = "# First\n\n::: choice Pick one?\n(x) Yes\n( ) No\n:::\n";
const list = "# First\n\n- First entry\n- Second entry\n";
const cases = [
	[
		"edited short block plus an addition",
		paragraph,
		paragraph
			.replace("about safety.", "about safety rules.")
			.replace("Beta", "Brand new block.\n\nBeta"),
	],
	["deleted block", paragraph, paragraph.replace("Alpha paragraph about safety.\n\n", "")],
	["rewritten lesson", paragraph, "# Replacement\n\nAn entirely different lesson.\n"],
	["added accordion item", accordion, accordion.replace(":::\n", ":: Three\nThird body.\n:::\n")],
	["added choice option", choice, choice.replace(":::\n", "( ) Maybe\n:::\n")],
	["added list entry", list, `${list}- Third entry\n`],
] as const;
const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof createStudioProjectSession>>[] = [];
const servers: StudioServer[] = [];
afterEach(async () => {
	await Promise.all(sessions.splice(0).map((session) => session.close()));
	await Promise.all(servers.splice(0).map((server) => server.close()));
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
	before = paragraph,
	after = paragraph.replace("Alpha paragraph about safety.\n\n", ""),
	locale = "en",
) {
	const root = await mkdtemp(join(tmpdir(), "studio-identity-review-"));
	roots.push(root);
	const projectDir = join(root, "course");
	await mkdir(projectDir);

	await writeFile(
		join(projectDir, "course.yaml"),
		`title: Test\nlocale: ${locale}\nlessons: [first.prax]\n`,
	);
	await writeFile(join(projectDir, "first.prax"), before);
	await initializeCourseIdentity(projectDir, ["first.prax"]);
	await writeFile(join(projectDir, "first.prax"), after);
	return { projectDir, appVersion: "test" };
}

async function bytes(root: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(root, file));
		else result[file] = (await readFile(join(root, file))).toString("base64");
	}
	return result;
}

it.each(cases)(
	"holds %s without changing source, identity or snapshots",
	async (_name, before, after) => {
		const { projectDir } = await fixture(before, after);
		const original = await bytes(projectDir);
		const session = await createStudioProjectSession(projectDir, "test");
		sessions.push(session);
		expect(await bytes(projectDir)).toEqual(original);
		const retirements = await withProjectFileTransaction(
			projectDir,
			async () => identityWriteRetirements(await resolveLessonSourcesForWrite(projectDir)),
			"write",
			false,
		);
		expect(retirements.length).toBeGreaterThan(0);
		expect(retirements.every((node) => node.file === "first.prax" && node.line === null)).toBe(
			true,
		);
		expect((await session.readSnapshot()).project.grammar).toBe(after);
		expect(await bytes(projectDir)).toEqual(original);

		expect(await bytes(projectDir)).toEqual(original);
		await session.close();
		sessions.splice(sessions.indexOf(session), 1);
		expect(await bytes(projectDir)).toEqual(original);
	},
);

it.each([
	["appended", `${paragraph}\nA new block.\n`],
	["inserted", paragraph.replace("Beta paragraph", "A new block.\n\nBeta paragraph")],
])("persists a pure %s addition without asking and keeps existing IDs", async (_name, after) => {
	const { projectDir } = await fixture(paragraph, after);
	const prior = (await loadIdentityStore(projectDir)).snapshots.flatMap((snapshot) =>
		Object.entries(snapshot.nodes),
	);
	const original = await bytes(projectDir);
	const session = await createStudioProjectSession(projectDir, "test");
	sessions.push(session);
	expect(
		await withProjectFileTransaction(
			projectDir,
			async () => identityWriteRetirements(await resolveLessonSourcesForWrite(projectDir)),
			"write",
			false,
		),
	).toEqual([]);
	expect(await bytes(projectDir)).not.toEqual(original);
	const current = Object.fromEntries(
		(await loadIdentityStore(projectDir)).snapshots.flatMap((snapshot) =>
			Object.entries(snapshot.nodes),
		),
	);
	for (const [id, node] of prior) expect(current[id]?.status).toBe(node.status);
	expect(Object.keys(current)).toHaveLength(prior.length + 1);
	const stable = await bytes(projectDir);
	await session.close();
	sessions.pop();
	const reopened = await createStudioProjectSession(projectDir, "test");
	sessions.push(reopened);
	expect(
		await withProjectFileTransaction(
			projectDir,
			async () => identityWriteRetirements(await resolveLessonSourcesForWrite(projectDir)),
			"write",
			false,
		),
	).toEqual([]);
	expect(await bytes(projectDir)).toEqual(stable);
});

it("keeps an ambiguous duplicate transient without a retirement gate", async () => {
	const after = `${paragraph}\nAlpha paragraph about safety.\n`;
	const files = await fixture(paragraph, after);
	const original = await bytes(files.projectDir);
	const prior = (await loadIdentityStore(files.projectDir)).snapshots.flatMap((snapshot) =>
		Object.entries(snapshot.nodes),
	);
	const alphaId = prior.find(
		([, node]) =>
			node.kind === "block" &&
			paragraph.slice(node.span.start, node.span.end).trim() === "Alpha paragraph about safety.",
	)?.[0];
	if (!alphaId) throw new Error("Fixture lacks the original Alpha block");
	const server = await startStudioServer(files);
	servers.push(server);
	expect((await fetch(`${server.origin}/launch`, { redirect: "manual" })).status).toBe(303);
	const current = Object.fromEntries(
		(await loadIdentityStore(files.projectDir)).snapshots.flatMap((snapshot) =>
			Object.entries(snapshot.nodes),
		),
	);
	expect(current[alphaId]?.status).toBe("active");
	expect(await bytes(files.projectDir)).toEqual(original);
	expect(await readFile(join(files.projectDir, "first.prax"), "utf8")).toBe(after);
});

it("validates malformed frontmatter before confirmation and opens it without persisting", async () => {
	const malformed = "---\ntitle: Broken\n\n# Changed\n";
	const { projectDir } = await fixture(paragraph, malformed);
	const before = await bytes(projectDir);
	const session = await createStudioProjectSession(projectDir, "test");
	sessions.push(session);
	expect((await session.readSnapshot()).project.grammar).toBe(malformed);
	const retirements = await withProjectFileTransaction(
		projectDir,
		async () => identityWriteRetirements(await resolveLessonSourcesForWrite(projectDir)),
		"write",
		false,
	);
	expect(retirements).toEqual([]);

	expect(await bytes(projectDir)).toEqual(before);
});

it("opens and renders preview beside fresh invalid source without writing it or identity", async () => {
	const source = "# Second\n\n::: nosuch\n:::\n";
	const files = await fixture(paragraph, paragraph);
	const { projectDir } = files;
	await writeFile(
		join(projectDir, "course.yaml"),
		"title: Test\nlessons: [first.prax, second.prax]\n",
	);
	await writeFile(join(projectDir, "second.prax"), source);
	const identity = await bytes(join(projectDir, ".praxity/identity"));
	const authored = () =>
		Promise.all(
			["course.yaml", "first.prax", "second.prax"].map((file) => readFile(join(projectDir, file))),
		);
	const before = await authored();
	const server = await startStudioServer({
		...files,
		exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
	});
	servers.push(server);
	expect((await fetch(`${server.origin}/launch?canvas=read`, { redirect: "manual" })).status).toBe(
		303,
	);
	const preview = await fetch(`${server.origin}/launch?canvas=read`);
	expect(preview.status).toBe(200);
	expect(await preview.text()).toContain("Alpha paragraph about safety.");
	expect(await authored()).toEqual(before);
	expect(await bytes(join(projectDir, ".praxity/identity"))).toEqual(identity);
});

const svgDataImage = "![Chart](data:image/svg+xml,%3Csvg%3E%3C/svg%3E)";
it.each([
	["en", "::: nosuch\n:::", "Fix the source errors before reviewing content changes."],
	[
		"fr",
		"::: nosuch\n:::",
		"Corrigez les erreurs du texte source avant d'examiner les modifications du contenu.",
	],
	[
		"en",
		svgDataImage,
		"SVG can’t be embedded as a data: URL because it can carry scripts. Use an image file in the project’s assets folder, or a PNG or JPEG data: URL.",
	],
	[
		"fr",
		svgDataImage,
		"Une image SVG ne peut pas être intégrée comme URL data:, car elle peut contenir des scripts. Utilisez un fichier image du dossier assets du projet, ou une URL data: PNG ou JPEG.",
	],
])(
	"reports located %s source repair through the retained identity owner for %j",
	async (locale, invalidBlock, repair) => {
		const files = await fixture(paragraph, paragraph, locale);
		const { projectDir } = files;
		await writeFile(
			join(projectDir, "course.yaml"),
			`title: Test\nlocale: ${locale}\nlessons: [first.prax, second.prax]\n`,
		);
		await writeFile(join(projectDir, "second.prax"), "# Second\n\nOther saved text.\n");
		await initializeCourseIdentity(projectDir, ["first.prax", "second.prax"]);
		const server = await startStudioServer({
			...files,
			exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
		});
		servers.push(server);
		const read = await fetch(`${server.origin}/launch?canvas=read`);
		expect(read.status).toBe(200);
		await writeFile(
			join(projectDir, "first.prax"),
			paragraph.replace("Alpha paragraph about safety.\n\n", ""),
		);
		await writeFile(join(projectDir, "second.prax"), `# Second\n\n${invalidBlock}\n`);
		const identity = await bytes(join(projectDir, ".praxity/identity"));
		const authored = () =>
			Promise.all(
				["course.yaml", "first.prax", "second.prax"].map((file) =>
					readFile(join(projectDir, file)),
				),
			);
		const before = await authored();
		const session = await createStudioProjectSession(
			projectDir,
			"test",
			undefined,
			undefined,
			locale as "en" | "fr",
		);
		sessions.push(session);
		const { retirements, problem } = await withProjectFileTransaction(
			projectDir,
			async () => {
				const admitted = await resolveLessonSourcesForWrite(projectDir);
				return {
					retirements: identityWriteRetirements(admitted),
					problem: identitySourceError(admitted),
				};
			},
			"write",
			false,
		);
		expect(problem).toMatchObject({ file: "second.prax", line: 3 });
		if (!problem) throw new Error("Missing source problem");
		expect(sourceErrorMessage(locale as "en" | "fr", problem)).toBe(repair);
		expect(retirements.map((item) => item.label)).toContain("Alpha paragraph about safety.");
		const preview = await fetch(`${server.origin}/launch?canvas=read`);
		expect(preview.status).toBe(200);
		expect(await preview.text()).toContain("Beta paragraph about tools.");
		expect(await authored()).toEqual(before);
		expect(await bytes(join(projectDir, ".praxity/identity"))).toEqual(identity);
	},
);

it("reports retirements through the shared owner without UUID labels", async () => {
	const { projectDir } = await fixture(accordion, "# First\n\nA replacement.\n");
	await withProjectFileTransaction(
		projectDir,
		async () => {
			const result = await resolveCourseIdentity(projectDir, { lessonPaths: ["first.prax"] });
			const retired = identityRetirements(result);
			expect(retired.some((node) => node.label.includes("One"))).toBe(true);
			expect(retired.every((node) => node.label !== node.id)).toBe(true);
			expect(retired.every((node) => node.line === null)).toBe(true);
		},
		"write",
	);
});

it.each(["en", "fr"] as const)(
	"Read with pending identity in %s never confirms through old author routes",
	async (locale) => {
		const files = await fixture(undefined, undefined, locale);

		const initialIdentity = await bytes(join(files.projectDir, ".praxity/identity"));
		const initialSources = await Promise.all(
			["course.yaml", "first.prax"].map((file) => readFile(join(files.projectDir, file))),
		);
		const server = await startStudioServer({
			...files,
			exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
		});
		servers.push(server);
		const token = "a".repeat(43);
		const read = await fetch(`${server.origin}/launch?canvas=read`);
		expect(read.status).toBe(200);
		expect(await read.text()).toContain("Beta paragraph about tools.");
		expect(await bytes(join(files.projectDir, ".praxity/identity"))).toEqual(initialIdentity);
		expect(
			await Promise.all(
				["course.yaml", "first.prax"].map((file) => readFile(join(files.projectDir, file))),
			),
		).toEqual(initialSources);
		const original = await bytes(files.projectDir);
		for (const route of ["/launch?canvas=1", new URL(read.url).pathname]) {
			const response = await fetch(`${server.origin}${route}`, { redirect: "manual" });
			expect(response.status).toBe(404);
		}
		for (const route of ["/api/identity/confirm", "/api/rpc"]) {
			const response = await fetch(`${server.origin}${route}`, {
				method: "POST",
				headers: {
					Origin: server.origin,
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ revision: "0".repeat(64) }),
				redirect: "manual",
			});
			expect(response.status).toBe(405);
		}
		expect(await bytes(files.projectDir)).toEqual(original);
	},
);

it("admits Read and a retained service edit to a valid lesson while another stays invalid and opaque", async () => {
	const first = "# First\n\n## Heading\n\nStable saved paragraph.\n";
	const second = "# Second\n\nSaved other paragraph.\n";
	const invalid = "# Second\n\n::: note\nUnclosed.\n";
	const files = await fixture(first, first);
	const { projectDir } = files;
	await writeFile(
		join(projectDir, "course.yaml"),
		"title: Test\nlessons: [first.prax, second.prax]\n",
	);
	await writeFile(join(projectDir, "second.prax"), second);
	await initializeCourseIdentity(projectDir, ["first.prax", "second.prax"]);
	const head = (await loadIdentityStore(projectDir)).heads.find(
		(item) => item.path === "second.prax",
	);
	if (!head) throw new Error("Missing invalid lesson fixture head");
	const snapshotPath = join(projectDir, ".praxity/identity/snapshots", `${head.head}.json`);
	const { lessonId } = JSON.parse(await readFile(snapshotPath, "utf8")) as { lessonId: string };
	const opaquePaths = [
		join(projectDir, ".praxity/identity/lessons", `${lessonId}.json`),
		snapshotPath,
	];
	const opaque = await Promise.all(opaquePaths.map((path) => readFile(path)));
	await writeFile(join(projectDir, "second.prax"), invalid);
	const original = await bytes(join(projectDir, ".praxity/identity"));
	const server = await startStudioServer({
		...files,
		exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
	});
	servers.push(server);
	const document = await fetch(`${server.origin}/launch?canvas=read`);
	expect(document.status).toBe(200);
	const html = await document.text();
	expect(html).toContain("Heading");
	expect(await bytes(join(projectDir, ".praxity/identity"))).toEqual(original);
	const session = await createStudioProjectSession(projectDir, "test");
	sessions.push(session);
	const firstHead = (await loadIdentityStore(projectDir)).heads.find(
		(head) => head.path === "first.prax",
	);
	if (!firstHead) throw new Error("Missing valid lesson identity");
	const firstSnapshot = JSON.parse(
		await readFile(
			join(projectDir, ".praxity/identity/snapshots", `${firstHead.head}.json`),
			"utf8",
		),
	);
	const service = new OperationService(projectDir);
	const rpc = async (method: string, args: unknown) => {
		const result =
			method === "canvasTextSnapshot"
				? await service.canvasTextSnapshot({
						file: "first.prax",
						lessonId: firstSnapshot.lessonId,
						pageId: "first",
						pageIndex: 0,
					})
				: await service.canvasTextApply(args);
		return { status: 200, json: async () => ({ ok: true, result }) };
	};
	const snapshotResponse = await rpc("canvasTextSnapshot", {});
	expect(snapshotResponse.status).toBe(200);
	const snapshot = (await snapshotResponse.json()).result as {
		fields: { file: string; nodeId: string; field: string; text: string; baseRevision: string }[];
	};
	expect(snapshot.fields.every((field) => field.file === "first.prax")).toBe(true);
	const heading = snapshot.fields.find((field) => field.text === "Heading");
	if (!heading) throw new Error("Missing valid heading fixture binding");
	const saved = await rpc("canvasTextApply", {
		transactionId: randomUUID(),
		operation: "setText",
		file: heading.file,
		nodeId: heading.nodeId,
		field: heading.field,
		baseRevision: heading.baseRevision,
		expectedText: heading.text,
		text: "Saved heading",
	});
	expect(saved.status).toBe(200);
	expect(await saved.json()).toMatchObject({ ok: true, result: { ok: true } });
	expect(await readFile(join(projectDir, "first.prax"), "utf8")).toBe(
		first.replace("## Heading", "## Saved heading"),
	);
	expect(await readFile(join(projectDir, "second.prax"), "utf8")).toBe(invalid);
	expect(await Promise.all(opaquePaths.map((path) => readFile(path)))).toEqual(opaque);
});
