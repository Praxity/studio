import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { readLesson, readSelfCheckContent } from "@praxity/grammar";
import AdmZip from "adm-zip";
import { compileCourse, deployCourse, selfCheckContentInput } from "../../src/build";

let root: string;
let base: string;
let entry: string;
let server: Server;
test.beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "self-check-assets-"));
	const read = readLesson(
		"# Practice\n::: self-check Write an answer.\nmodel: OWNED_MODÈLE café 😀\n:: OWNED_ÉTIQUETTE\nmissed: OWNED_INDICE déjà\n:::\n",
	);
	const block = read.blocks.find((block) => block.type === "selfCheck");
	if (!block) throw new Error("Missing activity fixture");
	const artifact = await compileCourse({
		id: "course",
		title: "Practice",
		sourceLocale: "en",
		content: read.pages,
		selfCheckContents: [selfCheckContentInput(block.id, readSelfCheckContent(read, block.id))],
	});
	let files: Set<string>;
	try {
		entry = `${artifact.manifest.pages[0].slug}.html`;
		const zip = new AdmZip((await deployCourse(artifact, { format: "html" })).zip);
		files = new Set(zip.getEntries().map((file) => file.entryName));
		zip.extractAllTo(root);
	} finally {
		await artifact.dispose();
	}
	server = createServer(async (request, response) => {
		try {
			const file = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
			if (!files.has(file)) throw new Error("missing");
			const bytes = await readFile(join(root, file));
			response.writeHead(200, {
				"Content-Type": file.endsWith(".js")
					? "text/javascript; charset=ISO-8859-1"
					: file.endsWith(".css")
						? "text/css; charset=utf-8"
						: "text/html; charset=utf-8",
			});
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}/${entry}`;
});
test.afterAll(async () => {
	if (server)
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	if (root) await rm(root, { recursive: true, force: true });
});

for (const protocol of ["http", "file"] as const) {
	test(`loads the shipped self-check island and asset through ${protocol} without revealing it`, async ({
		page,
	}) => {
		await page.goto(protocol === "http" ? base : pathToFileURL(join(root, entry)).href);
		await expect(page.locator('[data-island="selfCheck"]')).toHaveAttribute("data-hydrated", "");
		expect(await page.locator("body").innerText()).not.toMatch(/OWNED_/);
		const scripts = await page.locator("script").count();
		const result = await page.evaluate(async () => {
			const mount = document.querySelector<HTMLElement>("[data-self-check-src]");
			if (!mount) throw new Error("Missing asset reference");
			const reference = {
				blockId: mount.dataset.selfCheckId,
				contentRevision: mount.dataset.selfCheckRevision,
				path: mount.dataset.selfCheckSrc,
			};
			const loader =
				location.protocol === "file:"
					? Reflect.get(window, "PraxitySelfCheckIsland")
					: await import(
							new URL(
								document.documentElement.getAttribute("data-island-self-check") ?? "",
								document.baseURI,
							).href
						);
			const payload = await loader.loadSelfCheckAsset(reference);
			let stale: string;
			try {
				await loader.loadSelfCheckAsset({ ...reference, contentRevision: "old" });
				stale = "accepted";
			} catch (error) {
				stale = (error as Error).message;
			}
			return { payload, stale };
		});
		expect(result.payload).toMatchObject({
			content: {
				model: "OWNED_MODÈLE café 😀",
				parts: [{ label: "OWNED_ÉTIQUETTE", missed: "OWNED_INDICE déjà" }],
			},
		});
		expect(result.stale).toBe("self-check-asset-revision");
		expect(await page.locator("body").innerText()).not.toMatch(/OWNED_/);
		expect(await page.locator("script").count()).toBe(scripts);
	});
}
