import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, expect, it } from "vitest";
import { runPraxityCli } from "../cli";
import {
	identityRetirements,
	initializeCourseIdentity,
	loadIdentityStore,
	resolveCourseIdentity,
} from "../identity-store";
import { withProjectFileTransaction } from "../project-file-transactions";
import { renderIdentityReview } from "../studio/identity-review";
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
	const editorAssetsDir = join(root, "editor");
	await mkdir(projectDir);
	await mkdir(editorAssetsDir);
	await writeFile(join(editorAssetsDir, "canvas.js"), "void 0;");
	await writeFile(
		join(editorAssetsDir, "canvas.sha256"),
		"4f56045c295617d094843daf46a0b666472d5613d232b9fe302224248ed4d362\n",
	);
	await writeFile(
		join(projectDir, "course.yaml"),
		`title: Test\nlocale: ${locale}\nlessons: [first.prax]\n`,
	);
	await writeFile(join(projectDir, "first.prax"), before);
	await initializeCourseIdentity(projectDir, ["first.prax"]);
	await writeFile(join(projectDir, "first.prax"), after);
	return { projectDir, editorAssetsDir, appVersion: "test" };
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

function documentRequest(url: string, headers: Record<string, string> = {}) {
	return new Promise<{ status: number | undefined; html: string }>((resolve, reject) => {
		get(url, { headers }, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("error", reject);
			response.on("end", () =>
				resolve({ status: response.statusCode, html: Buffer.concat(chunks).toString("utf8") }),
			);
		}).on("error", reject);
	});
}

it.each(cases)(
	"holds %s without changing source, identity or snapshots",
	async (_name, before, after) => {
		const { projectDir } = await fixture(before, after);
		const original = await bytes(projectDir);
		const session = await createStudioProjectSession(projectDir, "test");
		sessions.push(session);
		expect(await bytes(projectDir)).toEqual(original);
		const review = await session.identityReview();
		expect(review.retirements.length).toBeGreaterThan(0);
		expect(
			review.retirements.every((node) => node.file === "first.prax" && node.line === null),
		).toBe(true);
		expect((await session.identityReview()).revision).toBe(review.revision);
		expect((await session.readSnapshot()).project.grammar).toBe(after);
		expect(await bytes(projectDir)).toEqual(original);
		await expect(
			session.invoke("projectSave", { grammar: `${after}\n`, expectedGrammar: after }),
		).rejects.toMatchObject({ code: "identity_retirement_pending" });
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
	expect((await session.identityReview()).retirements).toEqual([]);
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
	expect((await reopened.identityReview()).retirements).toEqual([]);
	expect(await bytes(projectDir)).toEqual(stable);
});

it.each(["en", "fr"])(
	"refuses %s writes after an outside retirement until confirmation",
	async (locale) => {
		const before = "# First\n\n## Heading\n\nOriginal body.\n";
		const after = "# First\n\n## Heading\n\nA wholly different explanation.\n";
		const { projectDir } = await fixture(before, before, locale);
		const session = await createStudioProjectSession(projectDir, "test");
		sessions.push(session);
		await writeFile(join(projectDir, "first.prax"), after);
		const original = await bytes(projectDir);
		expect((await session.readSnapshot()).project.grammar).toBe(after);
		await expect(
			session.invoke("projectSave", {
				grammar: after.replace("Heading", "Saved heading"),
				expectedGrammar: after,
			}),
		).rejects.toMatchObject({ code: "identity_retirement_pending" });
		expect(await bytes(projectDir)).toEqual(original);
		const review = await session.identityReview();
		expect(review.retirements.map((item) => item.label)).toEqual(["Original body."]);
		await session.confirmIdentityRetirements(review.revision);
		await session.invoke("projectSave", {
			grammar: `${after}\nA further block.\n`,
			expectedGrammar: after,
		});
		expect(await readFile(join(projectDir, "first.prax"), "utf8")).toBe(
			"# First\n\n## Heading\n\nA wholly different explanation.\n\nA further block.\n",
		);
	},
);

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

it.each(
	["en", "fr"].flatMap((locale) =>
		["projectSave", "courseWriteLesson"].flatMap((method) =>
			[false, true].map((outsideAddition) => ({ locale, method, outsideAddition })),
		),
	),
)(
	"refuses a $locale $method draft retirement honestly and admits an addition, outside addition $outsideAddition",
	async ({ locale, method, outsideAddition }) => {
		const files = await fixture(paragraph, paragraph, locale);
		const server = await startStudioServer(files);
		servers.push(server);
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const current = outsideAddition ? `${paragraph}\nAn outside addition.\n` : paragraph;
		if (outsideAddition) await writeFile(join(files.projectDir, "first.prax"), current);
		const original = await bytes(files.projectDir);
		const save = (grammar: string) =>
			fetch(`${server.origin}/api/rpc`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
					Origin: server.origin,
				},
				body: JSON.stringify({
					method,
					args: {
						...(method === "courseWriteLesson"
							? { courseDir: files.projectDir, filename: "first.prax" }
							: {}),
						grammar,
						expectedGrammar: current,
					},
				}),
			});
		const refused = await save(
			current.replace("Alpha paragraph about safety.", "A completely different explanation."),
		);
		expect(refused.status).toBe(409);
		const body = await refused.json();
		expect(body.error).toMatchObject({
			code: "identity_draft_retirement",
			message:
				locale === "fr"
					? 'Cet enregistrement retirerait du contenu enregistré : first.prax: First; "Alpha paragraph about safety.". Gardez ce texte, ou faites la modification dans le canevas, où Studio en garde la trace.'
					: 'This save would remove saved content: first.prax: First; "Alpha paragraph about safety.". Keep that text, or make the change in the canvas, where Studio keeps track of it.',
			details: {
				retirements: [
					{ file: "first.prax", page: "First", label: "Alpha paragraph about safety.", line: null },
				],
			},
		});
		expect(body.error).not.toHaveProperty("reviewUrl");
		expect(await bytes(files.projectDir)).toEqual(original);
		expect((await fetch(`${server.origin}/launch`, { redirect: "manual" })).status).toBe(303);
		const addition = `${current}\nA new block.\n`;
		expect((await save(addition)).status).toBe(200);
		expect(await readFile(join(files.projectDir, "first.prax"), "utf8")).toBe(addition);
	},
);

it.each(["source save", "recorded canvas edit"])(
	"refuses an outside deletion in another lesson before %s",
	async (writer) => {
		const first = "# First\n\n## Heading\n\nFirst body.\n";
		const { projectDir } = await fixture(first, first);
		await writeFile(
			join(projectDir, "course.yaml"),
			"title: Test\nlessons: [first.prax, second.prax]\n",
		);
		await writeFile(
			join(projectDir, "second.prax"),
			"# Second\n\nRetained body.\n\nRemoved body.\n",
		);
		await initializeCourseIdentity(projectDir, ["first.prax", "second.prax"]);
		const session = await createStudioProjectSession(projectDir, "test");
		sessions.push(session);
		const snapshot = (await session.invoke("canvasTextSnapshot", {})) as {
			fields: { file: string; nodeId: string; field: string; text: string; baseRevision: string }[];
		};
		const heading = snapshot.fields.find((field) => field.text === "Heading");
		if (!heading) throw new Error("Missing heading fixture binding");
		await writeFile(join(projectDir, "second.prax"), "# Second\n\nRetained body.\n");
		const before = await bytes(projectDir);
		const saving =
			writer === "source save"
				? session.invoke("courseWriteLesson", {
						courseDir: projectDir,
						filename: "first.prax",
						grammar: `${first}\nNew paragraph.\n`,
						expectedGrammar: first,
					})
				: session.invoke("canvasTextApply", {
						transactionId: randomUUID(),
						operation: "setText",
						file: heading.file,
						nodeId: heading.nodeId,
						field: heading.field,
						baseRevision: heading.baseRevision,
						expectedText: heading.text,
						text: "Saved heading",
					});
		if (writer === "source save")
			await expect(saving).rejects.toMatchObject({ code: "identity_retirement_pending" });
		else
			await expect(saving).resolves.toMatchObject({
				ok: false,
				code: "identity-retirement-pending",
				reviewUrl: "/launch",
				retirements: [{ file: "second.prax", page: "Second", label: "Removed body.", line: null }],
			});
		expect(await bytes(projectDir)).toEqual(before);
	},
);

it("validates malformed frontmatter before confirmation and opens it without persisting", async () => {
	const malformed = "---\ntitle: Broken\n\n# Changed\n";
	const { projectDir } = await fixture(paragraph, malformed);
	const before = await bytes(projectDir);
	const session = await createStudioProjectSession(projectDir, "test");
	sessions.push(session);
	expect((await session.readSnapshot()).project.grammar).toBe(malformed);
	const review = await session.identityReview();
	expect(review.retirements).toEqual([]);
	await expect(session.confirmIdentityRetirements(review.revision)).rejects.toMatchObject({
		code: "bad_yaml",
	});
	expect(
		await session.invoke("manifestEdit", {
			file: "first.prax",
			baseRevision: createHash("sha256").update(malformed).digest("hex"),
			path: ["design", "colorAccent"],
			value: "#123456",
		}),
	).toMatchObject({ ok: false, code: "invalid-args" });
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
	expect((await fetch(`${server.origin}/launch?canvas=1`, { redirect: "manual" })).status).toBe(
		303,
	);
	const preview = await fetch(`${server.origin}/launch?canvas=read`);
	expect(preview.status).toBe(200);
	expect(await preview.text()).toContain("Alpha paragraph about safety.");
	expect(await authored()).toEqual(before);
	expect(await bytes(join(projectDir, ".praxity/identity"))).toEqual(identity);
});

it("admits author entry and an HTTP edit to a valid lesson while another stays invalid and opaque", async () => {
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
	for (const entry of ["/launch", "/launch?canvas=1"])
		expect((await fetch(`${server.origin}${entry}`, { redirect: "manual" })).status).toBe(303);
	const document = await fetch(`${server.origin}/launch?canvas=1`);
	expect(document.status).toBe(200);
	expect(await document.text()).toContain("Heading");
	expect(await bytes(join(projectDir, ".praxity/identity"))).toEqual(original);
	const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
	const rpc = (method: string, args: unknown) =>
		fetch(`${server.origin}/api/rpc`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				Origin: server.origin,
				"X-Praxity-Canvas": new URL(document.url).pathname,
			},
			body: JSON.stringify({ method, args }),
		});
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

it.each(["en", "fr"])(
	"shows located %s source repair in a blocked retirement gate",
	async (locale) => {
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
		await writeFile(join(projectDir, "second.prax"), "# Second\n\n::: nosuch\n:::\n");
		const identity = await bytes(join(projectDir, ".praxity/identity"));
		const authored = () =>
			Promise.all(
				["course.yaml", "first.prax", "second.prax"].map((file) =>
					readFile(join(projectDir, file)),
				),
			);
		const before = await authored();
		for (const route of ["/launch", "/launch?canvas=1", new URL(read.url).pathname]) {
			const gate = await fetch(`${server.origin}${route}`, { redirect: "manual" });
			expect(gate.status).toBe(200);
			expect(gate.headers.get("content-type")).toContain("text/html");
			const dom = new JSDOM(await gate.text(), { runScripts: "outside-only" });
			try {
				const document = dom.window.document;
				dom.window.eval(document.querySelector("script")?.textContent ?? "");
				expect(document.activeElement?.id).toBe("review-heading");
				expect(
					document.querySelector("#review-heading")?.getAttribute("aria-describedby"),
				).toContain("review-source-error");
				expect(document.querySelector("#review-source-error")?.textContent).toBe(
					locale === "fr"
						? "second.prax: Ligne 3. Corrigez les erreurs du texte source avant d'examiner les modifications du contenu."
						: "second.prax: Line 3. Fix the source errors before reviewing content changes.",
				);
				expect(document.querySelector("main > ul")?.textContent).toContain(
					"Alpha paragraph about safety.",
				);
				expect(document.querySelector("form")).toBeNull();
				expect(document.querySelector('a[href="/launch?canvas=read"]')?.textContent).toBe(
					locale === "fr" ? "Lire" : "Read",
				);
				expect(document.querySelector('a[href="/"]')?.textContent).toBe(
					locale === "fr" ? "Fermer" : "Close",
				);
			} finally {
				dom.window.close();
			}
		}
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const confirmation = await fetch(`${server.origin}/api/identity/confirm`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: server.origin,
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ revision: "0".repeat(64) }),
		});
		expect(confirmation.status).toBe(422);
		expect(await confirmation.json()).toMatchObject({ error: { code: "source_invalid" } });
		const preview = await fetch(`${server.origin}/launch?canvas=read`);
		expect(preview.status).toBe(200);
		expect(await preview.text()).toContain("Beta paragraph about tools.");
		expect(await authored()).toEqual(before);
		expect(await bytes(join(projectDir, ".praxity/identity"))).toEqual(identity);
	},
);

it("admits same-site document entry while refusing cross-site documents and same-site fetches", async () => {
	const files = await fixture();
	const original = await bytes(join(files.projectDir, ".praxity/identity"));
	const authored = () =>
		Promise.all(
			["course.yaml", "first.prax"].map((file) => readFile(join(files.projectDir, file))),
		);
	const source = await authored();
	const server = await startStudioServer({
		...files,
		exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
	});
	servers.push(server);
	const read = await fetch(`${server.origin}/launch?canvas=read`);
	expect(read.status).toBe(200);
	for (const route of ["/launch", "/launch?canvas=1", new URL(read.url).pathname]) {
		for (const site of ["same-site", "cross-site"]) {
			const response = await documentRequest(`${server.origin}${route}`, {
				"Sec-Fetch-Site": site,
				"Sec-Fetch-Mode": "navigate",
				"Sec-Fetch-Dest": "document",
			});
			expect(response.status).toBe(site === "same-site" ? 200 : 403);
			if (site === "same-site") expect(response.html).toContain('id="review-heading"');
			else expect(JSON.parse(response.html)).toMatchObject({ error: { code: "origin_forbidden" } });
		}
		for (const [mode, destination] of [
			["cors", "empty"],
			["navigate", "empty"],
			["cors", "document"],
		]) {
			const refused = await documentRequest(`${server.origin}${route}`, {
				"Sec-Fetch-Site": "same-site",
				"Sec-Fetch-Mode": mode,
				"Sec-Fetch-Dest": destination,
			});
			expect(refused.status).toBe(403);
			expect(JSON.parse(refused.html)).toMatchObject({ error: { code: "origin_forbidden" } });
		}
	}
	expect(await bytes(join(files.projectDir, ".praxity/identity"))).toEqual(original);
	expect(await authored()).toEqual(source);
});

it("refuses cross-site document entry before serving an identity gate", async () => {
	const files = await fixture();
	const identityRoot = join(files.projectDir, ".praxity/identity");
	const original = await bytes(identityRoot);
	const authored = () =>
		Promise.all(
			["course.yaml", "first.prax"].map((file) => readFile(join(files.projectDir, file))),
		);
	const source = await authored();
	const server = await startStudioServer({
		...files,
		exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
	});
	servers.push(server);
	const read = await fetch(`${server.origin}/launch?canvas=read`);
	expect(read.status).toBe(200);
	for (const site of ["cross-site", "same-site"])
		for (const entry of ["/launch", "/launch?canvas=1", new URL(read.url).pathname]) {
			const denied = await fetch(`${server.origin}${entry}`, {
				redirect: "manual",
				headers: { "Sec-Fetch-Site": site, "Sec-Fetch-Dest": "document" },
			});
			expect(denied.status).toBe(403);
			expect(await denied.json()).toMatchObject({
				ok: false,
				error: { code: "origin_forbidden" },
			});
		}
	expect(await bytes(identityRoot)).toEqual(original);
	expect(await authored()).toEqual(source);
});

it.each(["en", "fr"])(
	"refuses %s duplicate plus rewrite without retiring the duplicate",
	async (locale) => {
		const after =
			"# First\n\nAlpha paragraph about safety.\n\nA wholly different explanation.\n\nAlpha paragraph about safety.\n";
		const files = await fixture(paragraph, after, locale);
		const { projectDir } = files;
		const original = await bytes(projectDir);
		const session = await createStudioProjectSession(projectDir, "test");
		sessions.push(session);
		const review = await session.identityReview();
		expect(review.retirements.map((node) => node.label)).toEqual(["Beta paragraph about tools."]);
		await expect(
			session.invoke("projectSave", { grammar: after, expectedGrammar: after }),
		).rejects.toMatchObject({ code: "identity_retirement_pending" });
		await expect(session.confirmIdentityRetirements(review.revision)).rejects.toMatchObject({
			code: "identity_duplicate_pending",
		});
		await session.close();
		sessions.pop();
		const server = await startStudioServer(files);
		servers.push(server);
		const response = await fetch(`${server.origin}/launch`);
		expect(response.status).toBe(200);
		const dom = new JSDOM(await response.text());
		const message =
			locale === "fr"
				? "Initialisation des identités refusée : first.prax:3 répète un texte existant. Rendez-le unique, puis lancez praxity identity init <course>. Si d'autres modifications restent à traiter, lancez cette commande avec --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié."
				: "Identity initialization refused: first.prax:3 repeats existing text. Make it unique, then run praxity identity init <course>. If other changes remain, run it with --rederive --confirm-unpublished only if this course has never been published.";
		try {
			expect(dom.window.document.querySelector("ul")?.textContent).toContain(
				"Beta paragraph about tools.",
			);
			expect(dom.window.document.querySelector("ul")?.textContent).not.toContain(
				"Alpha paragraph about safety.",
			);
			expect(dom.window.document.querySelector("button")).toBeNull();
			expect(dom.window.document.querySelector("#review-duplicates")?.textContent).toBe(message);
		} finally {
			dom.window.close();
		}
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const refused = await fetch(`${server.origin}/api/identity/confirm`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				Origin: server.origin,
			},
			body: JSON.stringify({ revision: review.revision }),
			redirect: "manual",
		});
		expect(refused.status).toBe(409);
		expect(await refused.json()).toMatchObject({
			error: { code: "identity_duplicate_pending", message },
		});
		expect(await bytes(projectDir)).toEqual(original);
	},
);

it.each(["en", "fr"])(
	"serves a %s gate, declines without writes, and rejects untrusted confirmation",
	async (locale) => {
		const files = await fixture(undefined, undefined, locale);
		const original = await bytes(files.projectDir);
		const server = await startStudioServer(files);
		servers.push(server);
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		for (const route of ["/launch", "/launch?canvas=1"]) {
			const gate = await fetch(`${server.origin}${route}`, { redirect: "manual" });
			expect(gate.status).toBe(200);
			const html = await gate.text();
			expect(html).toContain(`<html lang="${locale}">`);
			expect(html).toContain(
				locale === "fr" ? "Certains blocs recevraient" : "Some blocks would get new IDs",
			);
			expect(html).toContain("first.prax");
			const document = new JSDOM(html);
			try {
				expect(document.window.document.body.textContent).toContain(
					locale === "fr" ? "praxity identity init <cours>" : "praxity identity init <course>",
				);
			} finally {
				document.window.close();
			}
			expect(html).toContain("Alpha paragraph about safety.");
			expect(html).toContain('href="/"');
		}
		expect((await fetch(`${server.origin}/`, { redirect: "manual" })).status).toBe(303);
		for (const [authorization, origin, status] of [
			[undefined, server.origin, 401],
			["Bearer wrong", server.origin, 401],
			[`Bearer ${token}`, "https://example.com", 403],
			[`Bearer ${token}`, undefined, 403],
		] as const) {
			const response = await fetch(`${server.origin}/api/identity/confirm`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(authorization ? { Authorization: authorization } : {}),
					...(origin ? { Origin: origin } : {}),
				},
				body: JSON.stringify({ revision: "0".repeat(64) }),
				redirect: "manual",
			});
			expect(response.status).toBe(status);
		}
		const bypass = await fetch(`${server.origin}/api/rpc`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				Origin: server.origin,
			},
			body: JSON.stringify({
				method: "projectSave",
				args: {
					grammar: "# Replacement\n",
					expectedGrammar: paragraph.replace("Alpha paragraph about safety.\n\n", ""),
				},
			}),
		});
		expect(bypass.status).toBe(409);
		expect(await bypass.json()).toMatchObject({
			error: {
				code: "identity_retirement_pending",
				message:
					locale === "fr"
						? "Ce cours a été modifié hors de Studio, et du contenu enregistré a été retiré. Examinez les modifications avant de modifier. Copiez d'abord votre texte si vous voulez le garder."
						: "This course changed outside Studio, and some saved content was removed. Review the changes before you edit. Copy your text first if you want to keep it.",
				reviewUrl: "/launch",
			},
		});
		expect(await bytes(files.projectDir)).toEqual(original);
	},
);

it("gates a captured author document without Fetch Metadata while background reads stay transient", async () => {
	const files = await fixture(paragraph, paragraph);
	const server = await startStudioServer({
		...files,
		exportAssetsDir: join(import.meta.dirname, "../../../resources/export-assets"),
	});
	servers.push(server);
	const read = await fetch(`${server.origin}/launch?canvas=read`);
	expect(read.status).toBe(200);
	const authorUrl = `${server.origin}${new URL(read.url).pathname}`;
	await writeFile(
		join(files.projectDir, "first.prax"),
		paragraph.replace("Alpha paragraph about safety.\n\n", ""),
	);
	const original = await bytes(join(files.projectDir, ".praxity/identity"));
	// Raw HTTP sends no Sec-Fetch-* headers; absence cannot bypass author-entry review.
	const gated = await documentRequest(authorUrl);
	expect(gated.status).toBe(200);
	expect(gated.html).toContain('id="review-heading"');
	const background = await fetch(authorUrl, {
		headers: {
			"Sec-Fetch-Dest": "empty",
			"Sec-Fetch-Mode": "cors",
			"Sec-Fetch-Site": "same-origin",
		},
	});
	expect(background.status).toBe(200);
	const html = await background.text();
	expect(html).toContain("<base href=");
	expect(html).not.toContain('id="review-heading"');
	expect(await bytes(join(files.projectDir, ".praxity/identity"))).toEqual(original);
});

it("escapes located source repair text in the blocked gate", () => {
	const page = renderIdentityReview(
		{
			locale: "en",
			revision: "0".repeat(64),
			confirmationBlocked: true,
			retirements: [],
			sourceError: {
				code: "source_invalid",
				file: "<img src=x>.prax",
				line: 3,
				message: "Fix <script>text</script>.",
			},
		},
		"token",
	);
	const dom = new JSDOM(page.html);
	try {
		expect(dom.window.document.querySelector("#review-source-error")?.textContent).toBe(
			"<img src=x>.prax: Line 3. Fix <script>text</script>.",
		);
		expect(dom.window.document.querySelector("img")).toBeNull();
		expect(dom.window.document.querySelectorAll("script")).toHaveLength(1);
	} finally {
		dom.window.close();
	}
});

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

it.each([false, true])(
	"renders hostile diagnostic text without admitting authored HTML or scripts, mixed %s",
	(confirmationBlocked) => {
		const payload =
			'</li><img src=x onerror="globalThis.attacked=true"><script>globalThis.attacked=true</script>';
		const page = renderIdentityReview(
			{
				locale: "en",
				revision: "0".repeat(64),
				confirmationBlocked,
				duplicate: { file: payload, line: 1 },
				retirements: [
					{
						file: payload,
						kind: "block",
						page: payload,
						label: payload,
						id: "old-id",
						line: null,
						span: { start: 0, end: 1 },
					},
				],
			},
			payload,
		);
		const dom = new JSDOM(page.html);
		try {
			expect(dom.window.document.querySelector("ul")?.textContent).toContain(payload);
			if (confirmationBlocked)
				expect(dom.window.document.querySelector("#review-duplicates")?.textContent).toContain(
					payload,
				);
			expect(dom.window.document.querySelectorAll("img")).toHaveLength(0);
			expect(dom.window.document.querySelectorAll("script")).toHaveLength(1);
			expect(dom.window.document.querySelector("script")?.getAttribute("nonce")).toBe(page.nonce);
		} finally {
			dom.window.close();
		}
	},
);

it("confirmed retirement matches CLI re-derivation and preserves source and kept IDs", async () => {
	const after =
		"# First\n\nAlpha paragraph about safety rules.\n\nBrand new block.\n\nBeta paragraph about tools.\n";
	const { projectDir } = await fixture(paragraph, after);
	const reference = await mkdtemp(join(tmpdir(), "studio-identity-reference-"));
	roots.push(reference);
	await cp(projectDir, reference, { recursive: true });
	const oldIds = new Set(
		(await loadIdentityStore(projectDir)).snapshots.flatMap((snapshot) =>
			Object.keys(snapshot.nodes),
		),
	);
	const original = await bytes(projectDir);
	const session = await createStudioProjectSession(projectDir, "test");
	sessions.push(session);
	const review = await session.identityReview();
	expect(await bytes(projectDir)).toEqual(original);
	expect(await session.confirmIdentityRetirements(review.revision)).toMatchObject({
		changed: true,
	});
	const confirmed = await loadIdentityStore(projectDir);
	const nodes = Object.fromEntries(
		confirmed.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)),
	);
	for (const item of review.retirements) expect(nodes[item.id]?.status).toBe("retired");
	expect(Object.keys(nodes).filter((id) => !oldIds.has(id))).toHaveLength(2);
	expect((await session.identityReview()).retirements).toEqual([]);
	expect(await readFile(join(projectDir, "first.prax"), "utf8")).toBe(after);
	const cli = await runPraxityCli(
		["identity", "init", reference, "--rederive", "--confirm-unpublished"],
		{ appVersion: "test", exportAssetsDir: "unused" },
	);
	expect(cli.exitCode).toBe(0);
	const normalize = (store: typeof confirmed) => {
		const ids = new Map(store.heads.map((head) => [head.head, `head:${head.path}`]));
		for (const snapshot of store.snapshots)
			for (const [id, node] of Object.entries(snapshot.nodes))
				if (!oldIds.has(id))
					ids.set(
						id,
						`new:${node.kind}:${node.type}:${node.span.start}:${node.span.end}:${node.order}`,
					);
		const replace = (value: unknown): unknown => {
			if (typeof value === "string") return ids.get(value) ?? value;
			if (Array.isArray(value)) return value.map(replace);
			if (value && typeof value === "object")
				return Object.fromEntries(
					Object.entries(value).map(([key, item]) => [ids.get(key) ?? key, replace(item)]),
				);
			return value;
		};
		return replace({
			...store,
			heads: [...store.heads].sort((a, b) => a.path.localeCompare(b.path)),
			snapshots: [...store.snapshots].sort((a, b) => a.lessonId.localeCompare(b.lessonId)),
		});
	};
	expect(normalize(confirmed)).toEqual(normalize(await loadIdentityStore(reference)));
	const stable = await bytes(projectDir);
	await session.close();
	sessions.pop();
	const reopened = await createStudioProjectSession(projectDir, "test");
	sessions.push(reopened);
	expect((await reopened.identityReview()).retirements).toEqual([]);
	expect(await bytes(projectDir)).toEqual(stable);
});

function reviewedRevision(html: string) {
	const dom = new JSDOM(html);
	try {
		const revision = dom.window.document
			.querySelector('input[name="revision"]')
			?.getAttribute("value");
		if (!revision) throw new Error("Missing reviewed revision");
		return revision;
	} finally {
		dom.window.close();
	}
}

it.each(["en", "fr"])(
	"confirms through the authenticated %s endpoint and redirects to author entry",
	async (locale) => {
		const files = await fixture(undefined, undefined, locale);
		const original = await bytes(files.projectDir);
		const server = await startStudioServer(files);
		servers.push(server);
		const revision = reviewedRevision(await (await fetch(`${server.origin}/launch`)).text());
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const response = await fetch(`${server.origin}/api/identity/confirm`, {
			method: "POST",
			headers: {
				Origin: server.origin,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ revision }),
			redirect: "manual",
		});
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/launch");
		expect(await bytes(files.projectDir)).not.toEqual(original);
		expect((await fetch(`${server.origin}/launch`, { redirect: "manual" })).status).toBe(303);
		expect(await readFile(join(files.projectDir, "first.prax"), "utf8")).toBe(
			"# First\n\nBeta paragraph about tools.\n",
		);
	},
);

it.each(["en", "fr"])(
	"refuses a stale %s review without writing any course files",
	async (locale) => {
		const files = await fixture(undefined, undefined, locale);
		const server = await startStudioServer(files);
		servers.push(server);
		const revision = reviewedRevision(await (await fetch(`${server.origin}/launch`)).text());
		await writeFile(
			join(files.projectDir, "first.prax"),
			"# First\n\nBeta paragraph about tools.\n\nA later addition.\n",
		);
		const original = await bytes(files.projectDir);
		const token = new URLSearchParams(new URL(server.readyUrl).hash.slice(1)).get("session");
		const response = await fetch(`${server.origin}/api/identity/confirm`, {
			method: "POST",
			headers: {
				Origin: server.origin,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ revision }),
			redirect: "manual",
		});
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: {
				code: "identity_review_changed",
				message:
					locale === "fr"
						? "Le cours a changé. Rouvrez Modifier le texte pour vérifier les blocs actuels."
						: "The course changed. Reopen Edit text to review the current blocks.",
			},
		});
		expect(await bytes(files.projectDir)).toEqual(original);
	},
);
