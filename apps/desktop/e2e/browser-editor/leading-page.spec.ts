import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import AdmZip from "adm-zip";
import { runPraxityCli } from "../../src/main/cli";
import { persistFixtureIdentity } from "../../src/test-utils/identity-fixture";

const source =
	"---\ntitle: Welcome\nlang: en\n---\n\n# Welcome {hideTitle}\n\n## One idea\n\nPraxity tools run on your computer.\n";

test("leading page agrees across CLI inspect, HTML and PDF exports", async () => {
	const testInfo = test.info();
	const scratch = process.env.PRAXITY_TEST_ARTIFACTS ?? tmpdir();
	await mkdir(scratch, { recursive: true });
	const root = await mkdtemp(join(scratch, "leading-page-"));
	await writeFile(
		join(root, "course.yaml"),
		"id: course-leading-page\ntitle: Welcome\nlessons: [second.prax]\n",
	);
	await writeFile(join(root, "second.prax"), source);
	await persistFixtureIdentity(root);
	const artifact = process.env.PRAXITY_BROWSER_ARTIFACT;
	async function cli(args: string[]) {
		if (artifact)
			return execFileSync(process.execPath, [join(artifact, "praxity.mjs"), ...args], {
				encoding: "utf8",
				windowsHide: true,
			});
		const result = await runPraxityCli(args, {
			appVersion: "0.3.0",
			exportAssetsDir: resolve(import.meta.dirname, "../../resources/export-assets"),
			typstExecutablePath: process.env.PRAXITY_TEST_TYPST,
		});
		expect(result.exitCode, result.stderr).toBe(0);
		return result.stdout;
	}
	const inspected = JSON.parse(await cli(["inspect", root]));
	expect(inspected.lessons[0].pages).toHaveLength(1);
	expect(inspected.lessons[0].pages[0]).toMatchObject({ title: "Welcome" });
	expect(inspected.lessons[0].pages[0].blocks).toHaveLength(2);
	const htmlPath = testInfo.outputPath("welcome.zip");
	await cli(["export", root, "--format", "html", "--output", htmlPath]);
	const html = new AdmZip(htmlPath)
		.getEntries()
		.filter((entry) => entry.entryName.endsWith(".html"));
	// index.html and page-1.html are compatibility redirects to the authored page.
	expect(html.map((entry) => entry.entryName)).toEqual([
		"index.html",
		"page-1.html",
		"welcome.html",
	]);
	expect(
		html
			.find((entry) => entry.entryName === "welcome.html")
			?.getData()
			.toString(),
	).toContain("Praxity tools run on your computer.");
	const pdfPath = testInfo.outputPath("welcome.pdf");
	const result = JSON.parse(await cli(["export", root, "--format", "pdf", "--output", pdfPath]));
	expect(result.pageCount).toBe(1);
	// The workbook adds a cover/contents sheet to the single authored page.
	expect((await readFile(pdfPath)).toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
	await testInfo.attach("inspect", {
		body: JSON.stringify(inspected),
		contentType: "application/json",
	});
});
