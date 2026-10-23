import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enumerateFiles, generateManifest } from "../src/scorm/manifest";

// ---------------------------------------------------------------------------
// generateManifest — SCORM 1.2
// ---------------------------------------------------------------------------

describe("generateManifest — SCORM 1.2", () => {
	const files = ["index.html", "page-1.html", "_astro/styles.css"];

	it("produces valid XML with the correct XML declaration", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
	});

	it("uses the imscp_rootv1p1p2 namespace", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain("http://www.imsproject.org/xsd/imscp_rootv1p1p2");
	});

	it("uses the adlcp_rootv1p2 namespace", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain("http://www.adlnet.org/xsd/adlcp_rootv1p2");
	});

	it("sets schemaversion to 1.2", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain("<schemaversion>1.2</schemaversion>");
	});

	it('uses lowercase scormtype="sco"', () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain('adlcp:scormtype="sco"');
	});

	it("includes the course identifier", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain('identifier="com.praxity.course-1"');
	});

	it("includes the course title in <title> elements", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain("<title>My Course</title>");
	});

	it('sets href="index.html" on the resource element', () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toMatch(/<resource[^>]*href="index\.html"/);
	});

	it("includes all files as <file> elements", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).toContain('<file href="index.html"/>');
		expect(xml).toContain('<file href="page-1.html"/>');
		expect(xml).toContain('<file href="_astro/styles.css"/>');
	});

	it("does not include SCORM 2004-specific elements", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", files);
		expect(xml).not.toContain("timeLimitAction");
		expect(xml).not.toContain("scormType"); // capital T is 2004 only
	});

	it("includes xsi:schemaLocation for SCORM 1.2", () => {
		const xml = generateManifest("scorm12", "course-1", "My Course", ["index.html"]);
		expect(xml).toContain("xsi:schemaLocation");
		expect(xml).toContain("imscp_rootv1p1p2.xsd");
		expect(xml).toContain("adlcp_rootv1p2.xsd");
	});
});

// ---------------------------------------------------------------------------
// generateManifest — SCORM 2004
// ---------------------------------------------------------------------------

describe("generateManifest — SCORM 2004", () => {
	const files = ["index.html", "page-1.html", "_astro/styles.css"];

	it("produces valid XML with the correct XML declaration", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
	});

	it("uses the imscp_v1p1 namespace", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain("http://www.imsglobal.org/xsd/imscp_v1p1");
	});

	it("uses the adlcp_v1p3 namespace", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain("http://www.adlnet.org/xsd/adlcp_v1p3");
	});

	it("sets schemaversion to 2004 3rd Edition", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain("<schemaversion>2004 3rd Edition</schemaversion>");
	});

	it("sets schemaversion to 2004 4th Edition when requested", () => {
		const xml = generateManifest(
			"scorm2004",
			"course-2",
			"Advanced Course",
			files,
			undefined,
			"4th",
		);
		expect(xml).toContain("<schemaversion>2004 4th Edition</schemaversion>");
		expect(xml).not.toContain("2004 3rd Edition");
	});

	it('uses capital-T scormType="sco"', () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain('adlcp:scormType="sco"');
	});

	it("includes the timeLimitAction element", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain("<adlcp:timeLimitAction>continue,no message</adlcp:timeLimitAction>");
	});

	it("includes the course identifier", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain('identifier="com.praxity.course-2"');
	});

	it("includes the course title in <title> elements", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain("<title>Advanced Course</title>");
	});

	it('sets href="index.html" on the resource element', () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toMatch(/<resource[^>]*href="index\.html"/);
	});

	it("includes all files as <file> elements", () => {
		const xml = generateManifest("scorm2004", "course-2", "Advanced Course", files);
		expect(xml).toContain('<file href="index.html"/>');
		expect(xml).toContain('<file href="page-1.html"/>');
		expect(xml).toContain('<file href="_astro/styles.css"/>');
	});

	it("includes xsi:schemaLocation for SCORM 2004", () => {
		const xml = generateManifest("scorm2004", "course-1", "My Course", ["index.html"]);
		expect(xml).toContain("xsi:schemaLocation");
		expect(xml).toContain("imscp_v1p1.xsd");
		expect(xml).toContain("adlcp_v1p3.xsd");
		expect(xml).toContain("imsss_v1p0.xsd");
		expect(xml).toContain("adlnav_v1p3.xsd");
	});
});

// ---------------------------------------------------------------------------
// generateManifest — xAPI
// ---------------------------------------------------------------------------

describe("generateManifest — xAPI", () => {
	const files = ["index.html", "xapi-wrapper.js"];

	it("produces SCORM 2004-style XML (xAPI wrapped in SCORM)", () => {
		const xml = generateManifest("xapi", "course-3", "xAPI Course", files);
		expect(xml).toContain("http://www.imsglobal.org/xsd/imscp_v1p1");
		expect(xml).toContain("http://www.adlnet.org/xsd/adlcp_v1p3");
		expect(xml).toContain("<schemaversion>2004 3rd Edition</schemaversion>");
		expect(xml).toContain('adlcp:scormType="sco"');
	});

	it("includes the xAPI files as <file> elements", () => {
		const xml = generateManifest("xapi", "course-3", "xAPI Course", files);
		expect(xml).toContain('<file href="index.html"/>');
		expect(xml).toContain('<file href="xapi-wrapper.js"/>');
	});
});

describe("generateManifest — LOM metadata", () => {
	it("omits LOM metadata from SCORM 1.2 manifests", () => {
		const xml = generateManifest("scorm12", "course-1", "Safety Training", ["index.html"], {
			title: "Safety Training",
			lang: "en",
			description: "Workplace safety fundamentals",
		});
		expect(xml).not.toContain('xmlns:lom="http://ltsc.ieee.org/xsd/LOM"');
		expect(xml).not.toContain("<lom:lom");
		expect(xml).toContain("<schema>ADL SCORM</schema>");
		expect(xml).toContain("<schemaversion>1.2</schemaversion>");
	});

	it("includes LOM title and language when frontmatter provided", () => {
		const xml = generateManifest("scorm2004", "course-1", "Safety Training", ["index.html"], {
			title: "Safety Training",
			lang: "en",
			description: "Workplace safety fundamentals",
		});
		expect(xml).toContain('xmlns:lom="http://ltsc.ieee.org/xsd/LOM"');
		expect(xml).toContain("<lom:lom");
		expect(xml).toContain("<lom:title>");
		expect(xml).toContain("Safety Training");
		expect(xml).toContain("<lom:language>en</lom:language>");
		expect(xml).toContain("Workplace safety fundamentals");
	});

	it("includes LOM description even when only description is provided", () => {
		const xml = generateManifest("scorm2004", "course-1", "My Course", ["index.html"], {
			description: "Description only metadata",
		});
		expect(xml).toContain("<lom:description>");
		expect(xml).toContain("Description only metadata");
	});

	it("omits description when not present in frontmatter", () => {
		const xml = generateManifest("scorm2004", "course-1", "My Course", ["index.html"], {
			title: "My Course",
			lang: "fr",
		});
		expect(xml).toContain("<lom:language>fr</lom:language>");
		expect(xml).not.toContain("<lom:description>");
	});

	it("omits LOM section entirely when no frontmatter provided", () => {
		const xml = generateManifest("scorm2004", "course-1", "My Course", ["index.html"]);
		expect(xml).not.toContain("ltsc.ieee.org");
	});
});

// ---------------------------------------------------------------------------
// generateManifest — XML escaping in title
// ---------------------------------------------------------------------------

describe("generateManifest — XML escaping", () => {
	it("escapes XML-special characters in course identifier", () => {
		const xml = generateManifest("scorm12", 'test" onload="alert(1)', "Test", ["index.html"]);
		expect(xml).not.toContain('test"');
		expect(xml).toContain("test&quot;");
	});

	it("escapes identifier in SCORM 2004 manifest", () => {
		const xml = generateManifest("scorm2004", "id&<>", "Test", ["index.html"]);
		expect(xml).toContain("com.praxity.id&amp;&lt;&gt;");
		expect(xml).not.toContain('com.praxity.id&<>"');
	});

	it("escapes special characters in the course title", () => {
		const xml = generateManifest(
			"scorm12",
			"course-5",
			`Safety & Health: "Risks" <Level 1> O'Brien's Guide`,
			["index.html"],
		);
		expect(xml).toContain(
			"Safety &amp; Health: &quot;Risks&quot; &lt;Level 1&gt; O&apos;Brien&apos;s Guide",
		);
		// The raw unescaped title must not appear anywhere in the output
		expect(xml).not.toContain(`Safety & Health: "Risks" <Level 1> O'Brien's Guide`);
	});
});

// ---------------------------------------------------------------------------
// enumerateFiles
// ---------------------------------------------------------------------------

describe("enumerateFiles", () => {
	const tmpDirs: string[] = [];

	afterEach(async () => {
		for (const dir of tmpDirs) {
			await rm(dir, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	async function createTmpDir(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "praxity-manifest-test-"));
		tmpDirs.push(dir);
		return dir;
	}

	it("returns sorted relative paths for all files", async () => {
		const dir = await createTmpDir();
		await mkdir(join(dir, "_astro"), { recursive: true });
		await writeFile(join(dir, "index.html"), "<html></html>");
		await writeFile(join(dir, "page-1.html"), "<html></html>");
		await writeFile(join(dir, "_astro", "styles.css"), "body{}");
		await writeFile(join(dir, "_astro", "chunk.js"), "//js");

		const files = await enumerateFiles(dir);

		expect(files).toEqual(["_astro/chunk.js", "_astro/styles.css", "index.html", "page-1.html"]);
	});

	it("skips hidden files (names starting with .)", async () => {
		const dir = await createTmpDir();
		await writeFile(join(dir, "index.html"), "<html></html>");
		await writeFile(join(dir, ".DS_Store"), "");
		await writeFile(join(dir, ".hidden"), "");

		const files = await enumerateFiles(dir);

		expect(files).toEqual(["index.html"]);
		expect(files).not.toContain(".DS_Store");
		expect(files).not.toContain(".hidden");
	});

	it("skips hidden directories and their contents", async () => {
		const dir = await createTmpDir();
		await mkdir(join(dir, ".git"), { recursive: true });
		await writeFile(join(dir, ".git", "config"), "");
		await writeFile(join(dir, "index.html"), "<html></html>");

		const files = await enumerateFiles(dir);

		expect(files).toEqual(["index.html"]);
	});

	it("returns an empty array for an empty directory", async () => {
		const dir = await createTmpDir();

		const files = await enumerateFiles(dir);

		expect(files).toEqual([]);
	});

	it("handles deeply nested directory structures", async () => {
		const dir = await createTmpDir();
		await mkdir(join(dir, "assets", "images", "icons"), { recursive: true });
		await writeFile(join(dir, "assets", "images", "icons", "logo.svg"), "<svg/>");
		await writeFile(join(dir, "assets", "images", "hero.png"), "");
		await writeFile(join(dir, "index.html"), "<html></html>");

		const files = await enumerateFiles(dir);

		expect(files).toEqual(["assets/images/hero.png", "assets/images/icons/logo.svg", "index.html"]);
	});
});

describe("course pass mark in the manifest", () => {
	const files = ["index.html"];

	it("declares a SCORM 1.2 mastery score after the item title", () => {
		const xml = generateManifest("scorm12", "c", "Course", files, undefined, "3rd", 50);
		expect(xml).toMatch(
			/<title>Course<\/title>\s*<adlcp:masteryscore>50<\/adlcp:masteryscore>\s*<\/item>/,
		);
	});

	it("declares a SCORM 2004 primary objective satisfied by the scaled score", () => {
		const xml = generateManifest("scorm2004", "c", "Course", files, undefined, "4th", 66.5);
		expect(xml).toMatch(
			/<adlcp:timeLimitAction>[^<]*<\/adlcp:timeLimitAction>\s*<imsss:sequencing>/,
		);
		expect(xml).toContain(
			'<imsss:primaryObjective objectiveID="praxity-course-result" satisfiedByMeasure="true">',
		);
		expect(xml).toContain("<imsss:minNormalizedMeasure>0.665</imsss:minNormalizedMeasure>");
	});

	it("adds nothing for completion-only courses", () => {
		for (const format of ["scorm12", "scorm2004"] as const) {
			const xml = generateManifest(format, "c", "Course", files);
			expect(xml).not.toMatch(/masteryscore|imsss:sequencing/);
		}
	});
});
