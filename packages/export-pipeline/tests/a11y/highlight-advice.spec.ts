import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";

let directory: string,
	url: string,
	server: ReturnType<typeof createServer>,
	context: BrowserContext,
	page: Page;
test.beforeAll(async ({ browser }) => {
	directory = await mkdtemp(join(tmpdir(), "highlight-advice-"));
	await build({
		entryPoints: [
			resolve(
				import.meta.dirname,
				"../../../editor-core/src/components/__tests__/fixtures/highlight-advice.tsx",
			),
		],
		bundle: true,
		nodePaths: [resolve(import.meta.dirname, "../../../editor-core/node_modules")],
		format: "iife",
		outfile: join(directory, "advice.js"),
		define: { "process.env.NODE_ENV": '"production"' },
		loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
	});
	await writeFile(
		join(directory, "index.html"),
		'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="advice.css"><style>body{margin:24px;background:white;color:#222}#root{width:480px;max-width:100%;--panel-text:#222;--panel-text-secondary:#555;--panel-control-bg:#fff;--panel-control-border-color:#bbb}</style></head><body><div id="root"></div><script src="advice.js"></script></body></html>',
	);
	server = createServer(async (req, res) => {
		const file = resolve(directory, `.${new URL(req.url ?? "/", "http://localhost").pathname}`);
		if (!file.startsWith(directory + sep)) {
			res.writeHead(403).end();
			return;
		}
		try {
			res.setHeader(
				"Content-Type",
				file.endsWith(".js")
					? "text/javascript"
					: file.endsWith(".css")
						? "text/css"
						: "text/html; charset=utf-8",
			);
			res.end(await readFile(file));
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	context = await browser.newContext();
	page = await context.newPage();
	await page.goto(`${url}/index.html`);
	await expect(page.getByText("Highlight practice support", { exact: true })).toBeVisible();
});
test.afterAll(async () => {
	await context?.close();
	if (server)
		await new Promise<void>((done, reject) => server.close((e) => (e ? reject(e) : done())));
	if (directory) await rm(directory, { recursive: true });
});
for (const [lang, title, description] of [
	[
		"en",
		"Highlight practice support",
		"Highlight is optional, unsaved practice with visible text. Edit its source and print through the browser. Native PDF and block narration are unavailable.",
	],
	[
		"fr",
		"Prise en charge de l'exercice de surlignage",
		"L'exercice de surlignage est une pratique facultative, non enregistrée, avec le texte visible. Modifiez sa source et imprimez depuis le navigateur. Le PDF natif et la narration de bloc ne sont pas disponibles.",
	],
] as const) {
	test(`${lang}: explicit author Check presents support information`, async ({ browserName }) => {
		await page.goto(`${url}/index.html?lang=${lang}`);
		await expect(page.getByText(title, { exact: true })).toBeVisible();
		await expect(page.getByText(description, { exact: true })).toBeVisible();
		await expect(page.locator("[data-highlight]")).toHaveCount(0);
		const evidence = process.env.PRAXITY_HIGHLIGHT_EVIDENCE_DIR;
		if (evidence && browserName === "chromium") {
			await mkdir(evidence, { recursive: true });
			await page.screenshot({ path: join(evidence, `author-check-${lang}.png`), fullPage: true });
		}
	});
}
