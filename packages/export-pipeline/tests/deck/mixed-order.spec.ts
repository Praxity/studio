import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { buildCourseExportInput } from "../../../../apps/desktop/src/main/export/build-export-input-from-project";
import { deckPresentationData } from "../../../../apps/desktop/src/shared/module-deck";
import { resolveDesignSettings } from "../../../../apps/desktop/src/shared/settings-inheritance";
import { persistFixtureIdentity } from "../../../../apps/desktop/src/test-utils/identity-fixture";
import { compileCourse, deployCourse } from "../../src/build";
import type { SCORMRuntime } from "../../src/scorm/types";
import { serveFixtureBytes } from "../fixtures/http-bytes";
import { moduleDeckFixture } from "../fixtures/module-deck";
import { test } from "../muted-test";

let server: Server;
let base: string;
const entries = new Map<
	string,
	{ first: string; second: string; firstId: string; secondId: string; lastFirstId: string }
>();
test.use({ viewport: { width: 1280, height: 900 } });

async function outline(page: Page) {
	const toggle = page.locator("#deck-outline-toggle");
	if (!(await toggle.isVisible())) await page.locator("#deck-more-toggle").click();
	await toggle.click();
}

async function realCourse(courseOrder?: boolean) {
	const root = await mkdtemp(join(tmpdir(), "mixed-order-"));
	try {
		await writeFile(
			join(root, "course.yaml"),
			`title: Mixed\nmoduleDeck: true\nlessons: [first.prax, second.prax]\n${courseOrder === undefined ? "" : `design: {deck: {sequentialLessons: ${courseOrder}}}\n`}`,
		);
		await writeFile(
			join(root, "first.prax"),
			"---\ntitle: First\n---\n\n# Start\n\nRead this.\n\n# More\n\nRead more.\n",
		);
		await writeFile(
			join(root, "second.prax"),
			`---\ntitle: Second\n${courseOrder === undefined ? "" : `design: {deck: {sequentialLessons: ${!courseOrder}}}\n`}---\n\n# Later\n\nRead this later.\n`,
		);
		await persistFixtureIdentity(root);
		return await buildCourseExportInput({
			projectDir: root,
			scope: "course",
			viewerVersionPath: join(root, "viewer.version.json"),
			completionThreshold: 0.8,
			manifestPolicy: "read-only",
			inheritWorkspaceSettings: false,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test.beforeAll(async () => {
	const files = new Map<string, Buffer>();
	for (const source of ["model", "real"] as const)
		for (const courseOrder of [false, true]) {
			const key = `${source}-${courseOrder}`;
			const course = moduleDeckFixture();
			course.id = key;
			course.moduleDeck = {};
			course.deckDesign = { sequentialLessons: courseOrder };
			const settings = { title: "Mixed", lessons: [], design: { deck: course.deckDesign } };
			for (const slide of course.content) {
				slide.blocks = slide.blocks.filter(
					(block) => !["image", "assessment"].includes(block.type),
				);
				const design = resolveDesignSettings(
					null,
					settings,
					slide.lessonId === "module-one"
						? {}
						: { design: { deck: { sequentialLessons: !courseOrder } } },
				).design;
				slide.data = { ...slide.data, ...deckPresentationData(true, design) };
			}
			const artifact = await compileCourse(
				source === "real" ? await realCourse(courseOrder) : course,
				{ mode: "source" },
			);
			try {
				const deployment = await deployCourse(artifact, { format: "html" });
				if (!("zip" in deployment)) throw new Error("Expected HTML package");
				for (const file of new AdmZip(deployment.zip).getEntries())
					if (!file.isDirectory) files.set(`/${key}/${file.entryName}`, file.getData());
				const second = artifact.manifest.pages[source === "real" ? 2 : 4];
				entries.set(key, {
					first: `/${key}/${artifact.manifest.pages[0].slug}.html`,
					second: `/${key}/${second.slug}.html`,
					firstId: artifact.manifest.pages[0].id,
					secondId: second.id,
					lastFirstId: artifact.manifest.pages[source === "real" ? 1 : 3].id,
				});
			} finally {
				await artifact.dispose();
			}
		}
	const artifact = await compileCourse(await realCourse(), { mode: "source" });
	try {
		for (const format of ["scorm12", "scorm2004"] as const) {
			const deployment = await deployCourse(artifact, { format });
			if (!("zip" in deployment)) throw new Error("Expected SCORM package");
			for (const file of new AdmZip(deployment.zip).getEntries())
				if (!file.isDirectory) files.set(`/${format}/${file.entryName}`, file.getData());
			entries.set(format, {
				first: `/${format}/index.html`,
				second: `/${format}/${artifact.manifest.pages[2].slug}.html`,
				firstId: artifact.manifest.pages[0].id,
				secondId: artifact.manifest.pages[2].id,
				lastFirstId: artifact.manifest.pages[1].id,
			});
		}
	} finally {
		await artifact.dispose();
	}
	files.set(
		"/lms.html",
		Buffer.from(`<!doctype html><html><body><iframe title="Course" style="width:100%;height:100vh"></iframe><script>
const p=new URLSearchParams(location.search),version=p.get('version'),target=p.get('target'),entry=p.get('entry');
const values={'cmi.core.entry':entry,'cmi.entry':entry,'cmi.core.lesson_location':p.get('bookmark')||'','cmi.location':p.get('bookmark')||'','cmi.suspend_data':JSON.stringify({visitedPages:[],interactions:[]})};
const get=n=>values[n]||'',set=(n,v)=>{values[n]=String(v);return 'true'};
window[version==='scorm12'?'API':'API_1484_11']=version==='scorm12'?{LMSInitialize:()=> 'true',LMSGetValue:get,LMSSetValue:set,LMSCommit:()=> 'true',LMSFinish:()=> 'true',LMSGetLastError:()=> '0',LMSGetErrorString:()=> '',LMSGetDiagnostic:()=> ''}:{Initialize:()=> 'true',GetValue:get,SetValue:set,Commit:()=> 'true',Terminate:()=> 'true',GetLastError:()=> '0',GetErrorString:()=> '',GetDiagnostic:()=> ''};
document.querySelector('iframe').src=target;
</script></body></html>`),
	);
	server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
		const bytes = files.get(path);
		if (!bytes) {
			response.writeHead(404).end();
			return;
		}

		const types: Record<string, string> = {
			html: "text/html",
			js: "text/javascript",
			css: "text/css",
			json: "application/json",
			woff2: "font/woff2",
		};
		response.setHeader(
			"Content-Type",
			types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
		);
		serveFixtureBytes(request, response, bytes);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture address");
	base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

for (const source of ["model", "real"])
	for (const courseOrder of [false, true]) {
		test(`${source} course ordering ${courseOrder} applies destination override to outline and arrival`, async ({
			page,
		}) => {
			const entry = entries.get(`${source}-${courseOrder}`);
			if (!entry) throw new Error("Missing fixture");
			await page.goto(base + entry.first);
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await outline(page);
			const link = page.locator(`[data-deck-page="${entry.secondId}"]`);
			await expect(link).toHaveAttribute("aria-disabled", String(!courseOrder));
			if (courseOrder) await expect(link.locator("[data-deck-lock]")).toBeHidden();
			else await expect(link.locator("[data-deck-lock]")).toBeVisible();
			await link.press("Enter");
			if (courseOrder) {
				await expect(page.locator(`[data-deck-slide="${entry.secondId}"]`)).toBeVisible();
				await expect(page.locator("#deck-status")).toBeEmpty();
				expect(new URL(page.url()).searchParams.has("praxity-deck-redirect")).toBe(false);
				await page.goBack();
				await expect(page.locator(`[data-deck-slide="${entry.firstId}"]`)).toBeVisible();
				await page.goForward();
				await expect(page.locator(`[data-deck-slide="${entry.secondId}"]`)).toBeVisible();
				await expect(page.locator("#deck-status")).toBeEmpty();
			} else {
				await expect(page.locator(`[data-deck-slide="${entry.firstId}"]`)).toBeVisible();
				await expect(page.locator("#deck-status")).toHaveText(
					"Continue through the earlier slides to reach this one.",
				);
			}
			// A fresh browser state proves arrival uses the same policy as the outgoing outline.
			await page.evaluate(() => {
				sessionStorage.clear();
				localStorage.clear();
			});
			await page.goto(`${base}${entry.second}#${entry.secondId}`);
			if (courseOrder) {
				await expect(page.locator(`[data-deck-slide="${entry.secondId}"]`)).toBeVisible();
				await expect(page.locator("#deck-status")).toBeEmpty();
			} else {
				await expect(page.locator(`[data-deck-slide="${entry.firstId}"]`)).toBeVisible();
				await expect(page.locator("#deck-status")).toHaveText(
					"Continue through the earlier slides to reach this one.",
				);
			}
			// Select the first slide explicitly; a bare entry now resumes the stored bookmark.
			await page.goto(`${base}${entry.first}#${entry.firstId}`);
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.locator(`[data-deck-slide="${entry.firstId}"]`)).toBeVisible();
			await page.evaluate((id) => {
				location.hash = id;
			}, entry.secondId);
			await expect(
				page.locator(`[data-deck-slide="${courseOrder ? entry.secondId : entry.firstId}"]`),
			).toBeVisible();
			await expect(page.locator("#deck-status")).toHaveText(
				courseOrder ? "" : "Continue through the earlier slides to reach this one.",
			);
			// Once the earlier slides have been visited, Next admits both override directions.
			await page.goto(`${base}${entry.first}#${entry.firstId}`);
			await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(page.locator(`[data-deck-slide="${entry.firstId}"]`)).toBeVisible();
			for (let index = 1; index < (source === "real" ? 2 : 4); index++)
				await page.locator("#deck-next").click();
			await expect(page.locator(`[data-deck-slide="${entry.lastFirstId}"]`)).toBeVisible();
			await page.locator("#deck-next").click();
			await expect(page.locator("#deck-completion")).toBeVisible();
			await page.locator("#deck-next").click();
			await expect(page.locator(`[data-deck-slide="${entry.secondId}"]`)).toBeVisible();
			await expect(page.locator("#deck-status")).toBeEmpty();
		});
	}

for (const source of ["model", "real"]) {
	test(`${source} ordered HTML deck shows module completion with a stored bookmark`, async ({
		page,
	}) => {
		const entry = entries.get(`${source}-true`);
		if (!entry) throw new Error("Missing fixture");
		await page.goto(base + entry.first);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		for (let index = 1; index < (source === "real" ? 2 : 4); index++)
			await page.locator("#deck-next").click();
		await expect(page.locator(`[data-deck-slide="${entry.lastFirstId}"]`)).toBeVisible();
		// Reload retains the current slide without resume orientation.
		// Gecko's automation reload treats history-replaced URLs as navigation.
		// Use the same native reload as the standalone resume journeys.
		await Promise.all([page.waitForNavigation(), page.evaluate(() => location.reload())]);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(`[data-deck-slide="${entry.lastFirstId}"]`)).toBeVisible();
		await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await expect(page.locator("body")).toBeFocused();
		// A fresh course entry still restores the bookmark before Next shows completion.
		await page.goto("about:blank");
		await page.goto(base + entry.first);
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(`[data-deck-slide="${entry.lastFirstId}"]`)).toBeVisible();
		const cue = page.locator(
			source === "model" ? ".praxity-resume-summary" : ".praxity-resume-prefix",
		);
		await expect(cue).toBeVisible();
		await expect(source === "model" ? cue : cue.locator("..")).toBeFocused();
		expect(
			await page.evaluate(() =>
				(window.__praxityRuntime as SCORMRuntime | undefined)?.getBookmark(),
			),
		).toBe(`index.html?praxity-page=${encodeURIComponent(entry.lastFirstId)}`);
		// Even a different module's bookmark must not redirect an active module-end action.
		await page.evaluate((id) => {
			const runtime = window.__praxityRuntime as SCORMRuntime | undefined;
			if (!runtime) throw new Error("Missing runtime");
			runtime.setBookmark(id);
		}, entry.secondId);
		await page.locator("#deck-next").click();
		await expect(page.locator("#deck-completion")).toBeVisible();
		await expect(page.locator("#deck-completion h1")).toBeFocused();
		await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await page.locator("#deck-next").click();
		await expect(page.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
		await expect(page.locator(`[data-deck-slide="${entry.secondId}"]`)).toBeVisible();
		await expect(page.locator(".praxity-resume-prefix,.praxity-resume-summary")).toHaveCount(0);
		await expect(page.locator("#deck-status")).toBeEmpty();
	});
}

for (const format of ["scorm12", "scorm2004"])
	for (const resume of [false, true]) {
		test(`${format} absent ordering admits fresh ${resume ? "sparse resume" : "deep link"} to second lesson`, async ({
			page,
		}) => {
			const entry = entries.get(format);
			if (!entry) throw new Error("Missing SCORM fixture");
			const target =
				entry.first + (resume ? "" : `?praxity-page=${encodeURIComponent(entry.secondId)}`);
			await page.goto(
				`${base}/lms.html?${new URLSearchParams({ version: format, target, entry: resume ? "resume" : "ab-initio", bookmark: resume ? entry.secondId : "" })}`,
			);
			const frame = page.frameLocator("iframe");
			await expect(frame.locator(".praxity-deck")).toHaveAttribute("data-ready", "true");
			await expect(frame.locator(`[data-deck-slide="${entry.secondId}"]`)).toBeVisible();
			await expect(frame.locator("#deck-status")).toBeEmpty();
		});
	}
