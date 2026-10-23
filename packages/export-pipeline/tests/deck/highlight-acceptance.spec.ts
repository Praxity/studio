import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { bundleViewer, computeViewerSourceHash } from "../../src/bundle-viewer";
import { prepareDesktopExportInputs } from "../../src/export-assets";
import { readCachedViewer, VIEWER_CACHE_DIR } from "../../src/viewer-cache";
import { highlightPublisher } from "../a11y/fixtures/highlight-published";

const evidence = process.env.PRAXITY_HIGHLIGHT_ACCEPTANCE_EVIDENCE;
const layouts = ["pages", "deck"] as const;
const formats = ["preview", "html", "scorm-1.2", "scorm-2004", "xapi"] as const;
const locales = ["en", "fr"] as const;
const deliveries = ["esm", "classic"] as const;
const examples = resolve(import.meta.dirname, "../../../../docs/prax-format/examples/highlight");
let root: string, base: string, server: Server;
let entries: Record<string, string>;
const copy = {
	en: {
		check: "Check",
		restart: "Start over",
		answer: "Answer",
		counts: ["0 of 2 marked", "1 of 2 marked", "2 of 2 marked"],
		memory: "Your marks reset when this page reloads.",
		labels: ["Not a key idea: This explains the pause.", "Key idea", "Missed", ""],
		limit: "You can mark up to 2 passages. Unmark one to choose another.",
		unavailable: "Marking is unavailable. Read the passage and open Answer.",
		key: "You found 1 of 2 key ideas.",
		evidence: "You found 1 of 2 passages that answer the question.",
		notes: [
			"This explains the pause.",
			"A return time reduces uncertainty.",
			"Agree before leaving.",
			"Colour does not explain the return time.",
		],
	},
	fr: {
		check: "Vérifier",
		restart: "Recommencer",
		answer: "Réponse",
		counts: [
			"Passages marqués\u00a0: 0 sur 2",
			"Passages marqués\u00a0: 1 sur 2",
			"Passages marqués\u00a0: 2 sur 2",
		],
		memory: "Vos marques sont effacées au rechargement de cette page.",
		labels: [
			"Ce n'est pas une idée clé\u202f: Ce détail décrit la pause.",
			"Idée clé",
			"Manqué",
			"",
		],
		limit: "Vous pouvez marquer jusqu'à 2 passages. Enlevez une marque pour en choisir un autre.",
		unavailable: "Le surlignage n'est pas disponible. Lisez le texte et ouvrez Réponse.",
		key: "Idées clés trouvées\u00a0: 1 sur 2.",
		evidence: "Passages trouvés pour cette question\u00a0: 1 sur 2.",
		notes: [
			"Ce détail décrit la pause.",
			"Une heure précise réduit l’incertitude.",
			"Convenez de l’heure avant de partir.",
			"La couleur n’explique pas l’heure du retour.",
		],
	},
};
const key = (layout: string, format: string, locale: string) => `${layout}-${format}-${locale}`;
function url(
	layout: string,
	format: string,
	locale: string,
	delivery = "esm",
	unavailable = false,
) {
	const original = entries[key(layout, format, locale)];
	const file = unavailable ? original.replace(/^published-/, "denied-") : original;
	const address = delivery === "classic" ? pathToFileURL(join(root, file)).href : `${base}/${file}`;
	return (
		address +
		(format === "xapi"
			? `?actor=${encodeURIComponent(JSON.stringify({ name: "Acceptance", mbox: "mailto:acceptance@example.com" }))}`
			: "")
	);
}
function roots(page: Page) {
	return page.locator("[data-highlight]");
}
function chunks(root: Locator) {
	return root.locator("[data-highlight-chunk]");
}
async function offlineFile(page: Page, browserName: string) {
	// WebKit offline emulation rejects even plain file: pages. Deny every HTTP(S)
	// request at the network seam; the other engines also expose offline state.
	await page.route(/^https?:\/\//, (route) => route.abort());
	if (browserName !== "webkit") await page.context().setOffline(true);
}

// One production CLI and viewer per file. Reuse retained bytes only when their source hash matches.
test.beforeAll(async ({ browser }, info) => {
	test.setTimeout(120_000); // timeout: docs/context/testing-strategy.md shared real CLI/export acceptance fixture
	root =
		process.env.PRAXITY_HIGHLIGHT_ACCEPTANCE_BUILD ??
		(await mkdtemp(join(tmpdir(), "highlight-acceptance-")));
	await mkdir(root, { recursive: true });
	if (evidence) await mkdir(evidence, { recursive: true });
	const sourceHash = await computeViewerSourceHash();
	const sourceDigest = createHash("sha256");
	for (const file of ["course.yaml", "en.prax", "fr.prax"])
		sourceDigest.update(await readFile(join(examples, file)));
	const inputHash = sourceDigest.digest("hex");
	let retained:
		| { sourceHash: string; inputHash: string; entries: Record<string, string> }
		| undefined;
	try {
		retained = JSON.parse(await readFile(join(root, "acceptance-index.json"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (retained) {
		expect(retained.sourceHash).toBe(sourceHash);
		expect(retained.inputHash).toBe(inputHash);
		entries = retained.entries;
		const hashes: Record<string, string> = JSON.parse(
			await readFile(join(root, "artifact-sha256.json"), "utf8"),
		);
		for (const [file, expected] of Object.entries(hashes))
			expect(
				createHash("sha256")
					.update(await readFile(join(root, file)))
					.digest("hex"),
				file,
			).toBe(expected);
	} else {
		const assets = join(root, "prepared");
		const cached = await readCachedViewer(VIEWER_CACHE_DIR, sourceHash);
		if (cached) await cp(cached.directory, assets, { recursive: true });
		else await bundleViewer(assets);
		await prepareDesktopExportInputs(assets);
		await writeFile(
			join(assets, "viewer.version.json"),
			JSON.stringify({ appVersion: "0.3.0", viewerSourceHash: sourceHash.slice(0, 12) }),
		);
		const publish = await highlightPublisher(root, assets);
		entries = {};
		const sources: Record<string, string> = Object.fromEntries(
			await Promise.all(
				locales.map(async (locale) => [
					`${locale}.prax`,
					await readFile(join(examples, `${locale}.prax`), "utf8"),
				]),
			),
		);
		const hashes: Record<string, string> = {};
		for (const layout of layouts) {
			const packages = await publish(
				layout,
				layout === "deck"
					? Object.fromEntries(
							Object.entries(sources).map(([file, source]) => [
								file,
								source
									.replace("variables:\n  publicFlag: false\n", "")
									.replace(/::: rule\n[\s\S]*?:::\n/g, ""),
							]),
						)
					: sources,
				formats,
				layout === "deck",
				"design:\n  colorMode: auto\n",
			);
			for (const [format, zip] of packages) {
				const output = `published-${layout}-${format}`;
				zip.extractAllTo(join(root, output));
				for (const file of zip.getEntries()) {
					if (file.isDirectory) continue;
					const bytes = zip.readFile(file);
					if (!bytes) throw new Error(`Missing packaged bytes: ${file.entryName}`);
					hashes[`${output}/${file.entryName}`] = createHash("sha256").update(bytes).digest("hex");
				}
				for (const locale of locales) {
					const entry = zip
						.getEntries()
						.find(
							(file) =>
								file.entryName.endsWith(".html") &&
								zip.readAsText(file).includes(`<html lang="${locale}"`) &&
								zip.readAsText(file).includes("data-highlight-fallback"),
						);
					if (!entry) throw new Error(`Missing ${layout}/${format}/${locale}`);
					entries[key(layout, format, locale)] = `${output}/${entry.entryName}`;
				}
			}
		}
		await writeFile(join(root, "artifact-sha256.json"), JSON.stringify(hashes, null, 2));
		await writeFile(
			join(root, "acceptance-index.json"),
			JSON.stringify({ sourceHash, inputHash, entries }, null, 2),
		);
	}
	// Firefox does not expose/intercept file: requests. Preserve the real package
	// bytes in a second directory, omitting only the two unavailable adapters.
	const canonicalHashes: Record<string, string> = JSON.parse(
		await readFile(join(root, "artifact-sha256.json"), "utf8"),
	);
	for (const layout of layouts)
		for (const format of formats)
			await cp(
				join(root, `published-${layout}-${format}`),
				join(root, `denied-${layout}-${format}`),
				{
					recursive: true,
					filter: (file) => !/^island-highlight.*\.js$/.test(basename(file)),
				},
			);
	const omitted: string[] = [];
	for (const [file, hash] of Object.entries(canonicalHashes)) {
		const denied = file.replace(/^published-/, "denied-");
		if (/^island-highlight.*\.js$/.test(basename(file))) {
			await expect(readFile(join(root, denied))).rejects.toMatchObject({ code: "ENOENT" });
			omitted.push(denied);
		} else
			expect(
				createHash("sha256")
					.update(await readFile(join(root, denied)))
					.digest("hex"),
				denied,
			).toBe(hash);
	}
	await writeFile(
		join(root, "denied-assets.json"),
		JSON.stringify(
			{ omitted, unchangedFiles: Object.keys(canonicalHashes).length - omitted.length },
			null,
			2,
		),
	);
	for (const locale of locales) {
		const title = locale === "en" ? "Local SCORM 2004 player" : "Lecteur SCORM 2004 local";
		await writeFile(
			join(root, `scorm2004-player-${locale}.html`),
			`<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><script>window.API_1484_11={Initialize:()=>"true",Terminate:()=>"true",Commit:()=>"true",GetValue:key=>key==="cmi.learner_id"?"acceptance":key==="cmi.entry"?"ab-initio":key==="cmi.interactions._count"?"0":"",SetValue:()=>"true",GetLastError:()=>"0",GetErrorString:()=>"",GetDiagnostic:()=>""};</script><iframe title="${title}" src="${entries[key("pages", "scorm-2004", locale)]}" style="width:100%;height:1800px;border:1px solid"></iframe></html>`,
		);
	}
	server = createServer(async (req, res) => {
		const path = resolve(root, `.${new URL(req.url ?? "/", "http://localhost").pathname}`);
		if (!path.startsWith(root + sep)) {
			res.writeHead(403).end();
			return;
		}
		try {
			const bytes = await readFile(path);
			res.setHeader(
				"Content-Type",
				path.endsWith(".js")
					? "text/javascript"
					: path.endsWith(".css")
						? "text/css"
						: path.endsWith(".woff2")
							? "font/woff2"
							: "text/html; charset=utf-8",
			);
			res.end(bytes);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			res.writeHead(404).end();
		}
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing server address");
	base = `http://127.0.0.1:${address.port}`;
	if (evidence)
		await writeFile(
			join(evidence, `${info.project.name}-browser.json`),
			JSON.stringify({ browser: browser.version(), sourceHash, inputHash, entries }, null, 2),
		);
});

test.beforeEach(async ({ page }) => {
	// Isolate all external network while allowing actual local/file resources.
	await page.route(/^https?:\/\//, (route) =>
		route.request().url().startsWith(base) ? route.continue() : route.abort(),
	);
	await page.addInitScript(() => {
		const values: Record<string, string> = {
			"cmi.core.student_id": "acceptance",
			"cmi.learner_id": "acceptance",
			"cmi.core.entry": "ab-initio",
			"cmi.entry": "ab-initio",
			"cmi.interactions._count": "0",
		};
		const api: Record<string, (...args: string[]) => string> = {};
		for (const method of [
			"Initialize",
			"Finish",
			"Terminate",
			"Commit",
			"GetValue",
			"SetValue",
			"GetLastError",
			"GetErrorString",
			"GetDiagnostic",
		])
			api[method] = (...args) => {
				if (method === "SetValue") values[args[0]] = args[1];
				return method === "GetValue"
					? (values[args[0]] ?? "")
					: method === "GetLastError"
						? "0"
						: "true";
			};
		Reflect.set(window, "API_1484_11", api);
		Reflect.set(
			window,
			"API",
			Object.fromEntries(Object.entries(api).map(([name, fn]) => [`LMS${name}`, fn])),
		);
	});
});

for (const layout of layouts)
	for (const format of formats)
		for (const locale of locales)
			for (const delivery of deliveries) {
				const label = `${layout} ${format} ${locale} ${delivery}`,
					text = copy[locale];
				test(`${label}: independent marks, limit, Check, Answer and reset`, async ({
					page,
					browserName,
				}) => {
					const requests: string[] = [];
					page.on("request", (request) => {
						if (request.url().includes("island-highlight")) requests.push(request.url());
					});
					if (delivery === "classic") await offlineFile(page, browserName);
					await page.goto(url(layout, format, locale, delivery));
					const first = roots(page).nth(0),
						second = roots(page).nth(1),
						memories = page.locator("[data-highlight-memory-notice]");
					await expect(chunks(first).first()).toHaveAttribute("aria-pressed", "false");
					await expect(first.locator("[data-highlight-count]")).toHaveText(text.counts[0]);
					await expect(memories).toHaveText([text.memory, text.memory]);
					await expect(first.locator("[data-highlight-memory-notice]")).toHaveCount(1);
					await expect(second.locator("[data-highlight-memory-notice]")).toHaveCount(1);
					await expect(first.locator("[data-highlight-fallback]")).toBeHidden();
					await chunks(first).nth(0).click();
					await expect(first.locator("[data-highlight-count]")).toHaveText(text.counts[1]);
					await chunks(first).nth(1).press("Enter");
					await expect(chunks(first).nth(1)).toHaveAttribute("aria-pressed", "true");
					await chunks(first).nth(3).press("Enter");
					await expect(first.locator("[data-highlight-count]")).toHaveText(text.counts[2]);
					await expect(first.locator("[data-highlight-limit]")).toHaveText(text.limit);
					await expect(chunks(first).nth(3)).toHaveAttribute("aria-pressed", "false");
					await expect(chunks(second).nth(0)).toHaveAttribute("aria-pressed", "false");
					await chunks(second).nth(2).press("Enter");
					await first.getByRole("button", { name: text.check, exact: true }).click();
					const restart = first.getByRole("button", { name: text.restart, exact: true });
					await expect(restart).toBeFocused();
					await expect(restart).toHaveAccessibleDescription(text.key);
					await expect(first.locator("[data-highlight-status]")).toBeEmpty();
					await expect(first.locator("[data-highlight-check]")).toBeHidden();
					for (const chunk of await chunks(first).all())
						await expect(chunk).toHaveAttribute("aria-disabled", "true");
					await expect(chunks(first).nth(0)).toHaveAccessibleDescription(text.labels[0]);
					await expect(chunks(first).nth(1)).toHaveAccessibleDescription(text.labels[1]);
					await expect(first.locator("[data-highlight-feedback]")).toHaveText(text.labels);
					await expect(chunks(first).nth(3)).not.toHaveAttribute("aria-describedby");
					await expect(memories.nth(0)).toBeVisible();
					await expect(first.locator("[data-highlight-fallback]")).toHaveAttribute("open", "");
					for (const note of text.notes)
						await expect(first.locator("[data-highlight-fallback]")).toContainText(note);
					await first.locator("summary").press("Space");
					await expect(first.locator("[data-highlight-fallback]")).not.toHaveAttribute("open");
					await first.locator("summary").press("Space");
					await restart.press("Enter");
					await expect(chunks(first).first()).toBeFocused();
					await expect(first.locator("[data-highlight-fallback]")).toBeHidden();
					await expect(chunks(first).nth(0)).toHaveAttribute("aria-pressed", "false");
					await expect(first.locator("[data-highlight-count]")).toHaveText(text.counts[0]);
					await expect(first.locator("[data-highlight-restart]")).toBeHidden();
					await expect(first.locator("[data-highlight-summary]")).toBeEmpty();
					await expect(first.locator("[data-highlight-summary]")).toBeHidden();
					await expect(first.locator("[data-highlight-limit]")).toBeEmpty();
					await expect(first.locator("[data-highlight-check]")).toBeVisible();
					await expect(memories).toHaveText([text.memory, text.memory]);
					await expect(memories.nth(0)).toBeVisible();
					await expect(chunks(second).nth(2)).toHaveAttribute("aria-pressed", "true");
					await second.getByRole("button", { name: text.check, exact: true }).press("Enter");
					await expect(
						second.getByRole("button", { name: text.restart, exact: true }),
					).toHaveAccessibleDescription(text.evidence);
					if (delivery === "classic")
						expect(
							await page.evaluate(() => typeof window.PraxityHighlightIsland?.attachIsland),
						).toBe("function");
					else
						expect(
							requests.some(
								(request) => request.endsWith(".js") && !request.endsWith(".classic.js"),
							),
						).toBe(true);
				});
				test(`${label}: no-JS baseline`, async ({ browser, browserName }) => {
					const context = await browser.newContext({
						javaScriptEnabled: false,
					});
					try {
						const page = await context.newPage();
						if (delivery === "classic") await offlineFile(page, browserName);
						await page.goto(url(layout, format, locale, delivery));
						await expect(roots(page)).toHaveCount(2);
						for (const activity of await roots(page).all()) {
							await expect(chunks(activity).first()).toBeVisible();
							await expect(activity.locator("[data-highlight-flow]")).toBeHidden();
							await activity.locator("summary").press("Space");
							await expect(activity.locator("[data-highlight-fallback]")).toHaveAttribute(
								"open",
								"",
							);
							for (const note of text.notes)
								await expect(activity.locator("[data-highlight-fallback]")).toContainText(note);
							await expect(activity.locator("[data-highlight-status]")).toBeEmpty();
						}
					} finally {
						await context.close();
					}
				});
				test(`${label}: denied assets preserve baseline and show failure`, async ({
					page,
					browserName,
				}) => {
					const denied: string[] = [];
					await page.route("**/*island-highlight*", (route) => {
						denied.push(route.request().url());
						return route.abort();
					});
					if (delivery === "classic") await offlineFile(page, browserName);
					await page.goto(url(layout, format, locale, delivery, delivery === "classic"));
					for (const activity of await roots(page).all()) {
						const status = activity.locator("[data-highlight-status]");
						await expect(status).toHaveText(text.unavailable);
						await expect(status).toBeVisible();
						await expect(status).not.toHaveClass(/praxity-sr-only/);
						await expect(activity.locator("[data-highlight-flow]")).toBeHidden();
						await expect(chunks(activity).first()).toBeVisible();
						await activity.locator("summary").press("Space");
						await expect(activity.locator("[data-highlight-fallback]")).toHaveAttribute("open", "");
						for (const note of text.notes)
							await expect(activity.locator("[data-highlight-fallback]")).toContainText(note);
					}
					if (delivery === "esm") expect(denied.length).toBeGreaterThan(0);
					else
						expect(await page.evaluate(() => typeof window.PraxityHighlightIsland)).toBe(
							"undefined",
						);
				});
				test(`${label}: print before and after Check keeps complete passage and Answer`, async ({
					page,
					browserName,
				}) => {
					if (delivery === "classic") await offlineFile(page, browserName);
					await page.goto(url(layout, format, locale, delivery));
					await expect(chunks(roots(page).first()).first()).toHaveAttribute("role", "button");
					for (const checked of [false, true]) {
						if (checked)
							for (const activity of await roots(page).all()) {
								await chunks(activity).nth(1).press("Enter");
								await activity
									.getByRole("button", { name: text.check, exact: true })
									.press("Enter");
							}
						await page.emulateMedia({ media: "print" });
						for (const activity of await roots(page).all()) {
							await expect(chunks(activity).first()).toBeVisible();
							await expect(activity.locator("[data-highlight-print-answer]")).toBeVisible();
							for (const note of text.notes)
								await expect(activity.locator("[data-highlight-print-answer]")).toContainText(note);
							await expect(activity.locator("[data-highlight-controls]")).toBeHidden();
							await expect(activity.locator("[data-highlight-flow]")).toBeHidden();
							await expect(activity.locator("[data-highlight-fallback]")).toBeHidden();
							if (checked) {
								await expect(activity.locator("[data-highlight-feedback]:visible")).toHaveCount(0);
								await expect(chunks(activity).nth(1)).toHaveCSS(
									"background-color",
									"rgba(0, 0, 0, 0)",
								);
								await expect(chunks(activity).nth(2)).toHaveCSS("text-decoration-line", "none");
							}
						}
						for (const memory of await page.locator("[data-highlight-memory-notice]").all())
							await expect(memory).toBeHidden();
						await page.emulateMedia({ media: "screen" });
						if (checked)
							for (const activity of await roots(page).all()) {
								await expect(activity.locator("[data-highlight-restart]")).toBeVisible();
								await expect(chunks(activity).nth(1)).toHaveAttribute("aria-pressed", "true");
							}
					}
				});
			}

for (const locale of locales)
	for (const mode of [0, 1]) {
		test(`${locale} ${mode === 0 ? "key" : "evidence"}: keyboard order, repeated keys and result focus`, async ({
			page,
			browserName,
		}) => {
			const tab = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
			const backTab = tab === "Alt+Tab" ? "Alt+Shift+Tab" : "Shift+Tab";
			await page.goto(url("pages", "html", locale));
			const activity = roots(page).nth(mode),
				passages = chunks(activity),
				text = copy[locale];
			await expect(passages.first()).toHaveAttribute("role", "button");
			await passages.first().focus();
			await page.keyboard.press("Space");
			await expect(passages.first()).toHaveAttribute("aria-pressed", "true");
			await page.keyboard.down("Space");
			await page.keyboard.down("Space");
			await page.keyboard.up("Space");
			await expect(passages.first()).toHaveAttribute("aria-pressed", "false");
			await page.keyboard.press("Enter");
			await expect(passages.first()).toHaveAttribute("aria-pressed", "true");
			await page.keyboard.down("Enter");
			await page.keyboard.down("Enter");
			await page.keyboard.up("Enter");
			await expect(passages.first()).toHaveAttribute("aria-pressed", "false");
			await page.keyboard.press("ArrowRight");
			await expect(passages.nth(1)).toBeFocused();
			await page.keyboard.press("ArrowLeft");
			await expect(passages.first()).toBeFocused();
			await page.keyboard.press("ArrowLeft");
			await expect(passages.last()).toBeFocused();
			await page.keyboard.press("ArrowRight");
			await expect(passages.first()).toBeFocused();
			await page.keyboard.press("ArrowUp");
			await expect(passages.last()).toBeFocused();
			await page.keyboard.press("ArrowDown");
			await expect(passages.first()).toBeFocused();
			await page.keyboard.press("End");
			await expect(passages.last()).toBeFocused();
			await page.keyboard.press("Home");
			await expect(passages.first()).toBeFocused();
			for (let i = 1; i < 4; i++) {
				await page.keyboard.press(tab);
				await expect(passages.nth(i)).toBeFocused();
			}
			for (let i = 2; i >= 0; i--) {
				await page.keyboard.press(backTab);
				await expect(passages.nth(i)).toBeFocused();
			}
			await page.keyboard.press("End");
			await expect(passages.last()).toBeFocused();
			await page.keyboard.press(tab);
			await expect(activity.getByRole("button", { name: text.check, exact: true })).toBeFocused();
			await page.keyboard.press("Enter");
			const restart = activity.getByRole("button", { name: text.restart, exact: true });
			await expect(restart).toBeFocused();
			await expect(restart).toHaveAccessibleDescription(
				mode === 0
					? locale === "en"
						? "You found 0 of 2 key ideas."
						: "Idées clés trouvées\u00a0: 0 sur 2."
					: locale === "en"
						? "You found 0 of 2 passages that answer the question."
						: "Passages trouvés pour cette question\u00a0: 0 sur 2.",
			);
			await page.keyboard.press(tab);
			await expect(activity.locator("summary")).toBeFocused();
			await page.keyboard.press("Space");
			await expect(activity.locator("details")).not.toHaveAttribute("open");
			await page.keyboard.press("Enter");
			await expect(activity.locator("details")).toHaveAttribute("open", "");
			await page.keyboard.press(backTab);
			await expect(restart).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(passages.first()).toBeFocused();
			await expect(activity.locator("[data-highlight-restart]")).not.toHaveAttribute(
				"aria-describedby",
			);
		});
	}

for (const layout of layouts)
	for (const format of formats)
		test(`${layout} ${format}: packaged MIT attribution`, async ({ browserName }) => {
			test.skip(browserName !== "chromium", "Packaged notice bytes are identical across engines.");
			const directory = join(root, `published-${layout}-${format}`);
			const notices = await readFile(
				join(directory, "third-party-notices/learning-patterns@0.1.0.txt"),
				"utf8",
			);
			expect(notices).toContain("learning-patterns");
			expect(notices).toContain("Permission is hereby granted");
			expect(notices).toContain("Ariel Harlap");
		});

test.afterAll(async ({ browser }, info) => {
	test.setTimeout(120_000); // timeout: docs/context/testing-strategy.md shared real CLI/export acceptance fixture
	if (server && evidence && info.project.name === "chromium") {
		const context = await browser.newContext({ reducedMotion: "reduce" });
		const page = await context.newPage();
		try {
			const capture = async (name: string) => {
				await page.evaluate(() => document.fonts.ready);
				await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
			};
			for (const [locale, colorScheme, width] of [
				["en", "light", 1280],
				["en", "light", 320],
				["fr", "dark", 320],
			] as const) {
				await page.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ colorScheme });
				await page.goto(url("pages", "html", locale));
				const activity = roots(page).first(),
					text = copy[locale],
					prefix = `${locale}-${colorScheme}-${width}`;
				await expect(chunks(activity).first()).toHaveAttribute("role", "button");
				await capture(`${prefix}-initial`);
				await chunks(activity).nth(0).click();
				await chunks(activity).nth(1).click();
				await capture(`${prefix}-marked`);
				await chunks(activity).nth(3).click();
				await capture(`${prefix}-limit`);
				await activity.getByRole("button", { name: text.check, exact: true }).click();
				await capture(`${prefix}-checked`);
				await activity.locator("summary").click();
				await capture(`${prefix}-answer-closed`);
				await activity.locator("summary").click();
				await capture(`${prefix}-answer-open`);
				await activity.getByRole("button", { name: text.restart, exact: true }).click();
				await capture(`${prefix}-reset`);
				await page.route("**/*island-highlight*", (route) => route.abort());
				await page.reload();
				await expect(activity.locator("[data-highlight-status]")).toHaveText(text.unavailable);
				await capture(`${prefix}-failure`);
				await page.unroute("**/*island-highlight*");
			}
			await page.setViewportSize({ width: 1280, height: 900 });
			await page.emulateMedia({ colorScheme: "light" });
			for (const [layout, format, name] of [
				["pages", "scorm-2004", "scorm2004-checked"],
				["deck", "html", "deck-checked"],
			]) {
				await page.goto(url(layout, format, "en"));
				const activity = roots(page).first();
				await activity.getByRole("button", { name: "Check", exact: true }).click();
				await capture(name);
			}
			await page.goto(`${base}/scorm2004-player-en.html`);
			const player = page.frameLocator("iframe");
			await player
				.locator("[data-highlight]")
				.first()
				.getByRole("button", { name: "Check", exact: true })
				.click();
			await capture("scorm2004-player-checked");
			await page.goto(url("pages", "html", "en"));
			await expect(chunks(roots(page).first()).first()).toHaveAttribute("role", "button");
			await page.emulateMedia({ media: "print" });
			await capture("print-preview");
			await page.pdf({ path: join(evidence, "browser-print.pdf"), format: "A4" });
			const printed = execFileSync(
				"pdftotext",
				["-layout", join(evidence, "browser-print.pdf"), "-"],
				{ encoding: "utf8" },
			);
			for (const note of copy.en.notes) expect(printed).toContain(note);
			await writeFile(join(evidence, "browser-print.txt"), printed);
			await page.emulateMedia({ media: "screen" });
			// A 1280 × 900 display at 400% has a 320 × 225 CSS-pixel viewport.
			const zoom = await browser.newContext({
				viewport: { width: 320, height: 225 },
				deviceScaleFactor: 4,
			});
			try {
				const zoomPage = await zoom.newPage();
				await zoomPage.goto(url("pages", "html", "en"));
				await expect(chunks(roots(zoomPage).first()).first()).toHaveAttribute("role", "button");
				await zoomPage.evaluate(() => document.fonts.ready);
				await zoomPage.screenshot({ path: join(evidence, "zoom-400-percent.png"), fullPage: true });
			} finally {
				await zoom.close();
			}
			await page.setViewportSize({ width: 1280, height: 900 });
			await page.emulateMedia({ forcedColors: "active" });
			await capture("forced-colours");
		} finally {
			await context.close();
		}
		const baseline = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await baseline.newPage();
			await page.goto(url("pages", "html", "en"));
			await page.screenshot({ path: join(evidence, "no-js.png"), fullPage: true });
		} finally {
			await baseline.close();
		}
	}
	if (server)
		await new Promise<void>((done, reject) =>
			server.close((error) => (error ? reject(error) : done())),
		);
	if (root && !process.env.PRAXITY_HIGHLIGHT_ACCEPTANCE_BUILD) await rm(root, { recursive: true });
});
