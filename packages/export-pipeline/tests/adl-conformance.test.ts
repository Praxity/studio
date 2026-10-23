import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import type { CourseExportInput } from "../src/build";
import { resolveXmllint } from "./gate-prerequisites";

vi.mock("../src/asset-resolver", () => ({
	resolveAssets: vi.fn((pages: unknown[]) => Promise.resolve(pages)),
}));

const { buildScormPackage } = await import("../src/build");

const course: CourseExportInput = {
	id: "adl-conformance-smoke",
	title: "ADL Conformance Smoke",
	sourceLocale: "en",
	description: "Generated package used for deterministic ADL-derived package checks.",
	content: [
		{
			id: "intro",
			title: "Intro",
			blocks: [{ id: "intro-text", type: "text", data: { content: "<p>Intro</p>" } }],
		},
		{
			id: "quiz",
			title: "Quiz",
			blocks: [
				{
					id: "question",
					type: "assessment",
					data: {
						assessmentType: "choice",
						response: {
							type: "choice",
							selectionMode: "single",
							options: [
								{ id: "a", label: "A", isCorrect: true },
								{ id: "b", label: "B", isCorrect: false },
							],
						},
					},
				},
			],
		},
	],
};

/** The same course graded against a pass mark, which adds mastery and sequencing elements. */
const passMarkCourse: CourseExportInput = {
	...course,
	passingScore: 50,
	content: course.content.map((page) => ({
		...page,
		blocks: page.blocks.map((block) =>
			block.type === "assessment"
				? { ...block, data: { ...block.data, gradingMode: "exact" } }
				: block,
		),
	})),
};

interface ParsedManifest {
	document: Document;
	xml: string;
}

interface PackageCase {
	format: "scorm12" | "scorm2004";
	expectedSchemaVersion: string;
	expectedDefaultNamespace: string;
	expectedAdlcpNamespace: string;
	expectedScormTypeAttribute: "adlcp:scormtype" | "adlcp:scormType";
	forbiddenScormTypeAttribute: "adlcp:scormtype" | "adlcp:scormType";
	expectedHostPattern: RegExp;
	expectedSchemas: string[];
	rootSchema: string;
	imports: Array<{ namespace: string; schema: string }>;
	forbiddenFragments: string[];
}

const cases: PackageCase[] = [
	{
		format: "scorm12",
		expectedSchemaVersion: "1.2",
		expectedDefaultNamespace: "http://www.imsproject.org/xsd/imscp_rootv1p1p2",
		expectedAdlcpNamespace: "http://www.adlnet.org/xsd/adlcp_rootv1p2",
		expectedScormTypeAttribute: "adlcp:scormtype",
		forbiddenScormTypeAttribute: "adlcp:scormType",
		expectedHostPattern: /^host-scorm12-[A-Z0-9]{8}\.js$/u,
		expectedSchemas: ["imscp_rootv1p1p2.xsd", "adlcp_rootv1p2.xsd"],
		rootSchema: "imscp_rootv1p1p2.xsd",
		imports: [
			{
				namespace: "http://www.imsproject.org/xsd/imscp_rootv1p1p2",
				schema: "imscp_rootv1p1p2.xsd",
			},
			{ namespace: "http://www.adlnet.org/xsd/adlcp_rootv1p2", schema: "adlcp_rootv1p2.xsd" },
		],
		forbiddenFragments: [
			"http://www.imsglobal.org/xsd/imscp_v1p1",
			"2004 3rd Edition",
			"2004 4th Edition",
		],
	},
	{
		format: "scorm2004",
		expectedSchemaVersion: "2004 3rd Edition",
		expectedDefaultNamespace: "http://www.imsglobal.org/xsd/imscp_v1p1",
		expectedAdlcpNamespace: "http://www.adlnet.org/xsd/adlcp_v1p3",
		expectedScormTypeAttribute: "adlcp:scormType",
		forbiddenScormTypeAttribute: "adlcp:scormtype",
		expectedHostPattern: /^host-scorm2004-[A-Z0-9]{8}\.js$/u,
		expectedSchemas: ["imscp_v1p1.xsd", "adlcp_v1p3.xsd", "imsss_v1p0.xsd", "adlnav_v1p3.xsd"],
		rootSchema: "imscp_v1p1.xsd",
		imports: [
			{ namespace: "http://www.imsglobal.org/xsd/imscp_v1p1", schema: "imscp_v1p1.xsd" },
			{ namespace: "http://www.adlnet.org/xsd/adlcp_v1p3", schema: "adlcp_v1p3.xsd" },
			{ namespace: "http://www.imsglobal.org/xsd/imsss", schema: "imsss_v1p0.xsd" },
			{ namespace: "http://www.adlnet.org/xsd/adlnav_v1p3", schema: "adlnav_v1p3.xsd" },
			{ namespace: "http://ltsc.ieee.org/xsd/LOM", schema: "lom.xsd" },
		],
		forbiddenFragments: ["http://www.imsproject.org/xsd/imscp_rootv1p1p2", "<schemaversion>1.2"],
	},
];

const xmllint = resolveXmllint();
const xmllintAvailable = spawnSync(xmllint, ["--version"], { encoding: "utf-8" }).status === 0;

function parseManifest(zip: AdmZip): ParsedManifest {
	const manifest = zip.getEntry("imsmanifest.xml");
	expect(manifest, "imsmanifest.xml must be at the package root").toBeTruthy();

	const xml = zip.readAsText("imsmanifest.xml");
	const dom = new JSDOM(xml, { contentType: "text/xml" });
	const parserErrors = dom.window.document.getElementsByTagName("parsererror");
	expect(parserErrors.length, parserErrors.item(0)?.textContent ?? "manifest XML parse error").toBe(
		0,
	);

	return { document: dom.window.document, xml };
}

function entryNames(zip: AdmZip): Set<string> {
	return new Set(
		zip
			.getEntries()
			.filter((entry) => !entry.isDirectory)
			.map((entry) => entry.entryName),
	);
}

function textContent(document: Document, tagName: string): string {
	const element = document.getElementsByTagName(tagName).item(0);
	expect(element, `Missing <${tagName}>`).toBeTruthy();
	return element?.textContent?.trim() ?? "";
}

async function writeValidationWrapper(tempDir: string, testCase: PackageCase): Promise<string> {
	const imports = testCase.imports
		.map(
			(entry) => `  <xsd:import namespace="${entry.namespace}" schemaLocation="${entry.schema}"/>`,
		)
		.join("\n");
	const wrapperPath = join(tempDir, "praxity-validation-wrapper.xsd");
	await writeFile(
		wrapperPath,
		`<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
${imports}
</xsd:schema>
`,
	);
	return wrapperPath;
}

async function applyScorm12XmllintShim(tempDir: string): Promise<void> {
	const xmlSchemaPath = join(tempDir, "ims_xml.xsd");
	const source = await readFile(xmlSchemaPath, "utf-8");
	await writeFile(
		xmlSchemaPath,
		source.replace('xmlns="http://www.w3.org/XML/1998/namespace"', ""),
	);
}

describe("ADL-derived SCORM package conformance checks", () => {
	it("ships the complete publisher IMS sequencing schemas and distribution notices", async () => {
		const result = await buildScormPackage(course, { format: "scorm2004" });
		const zip = new AdmZip(result.zip);
		// https://www.imsglobal.org/xsd/<filename>, retrieved 2026-10-19, exact bytes.
		for (const [file, sha256] of [
			["imsss_v1p0.xsd", "62f77530b4898d88470778b73c95bd7acfdc86617ef65e7a6cd39b85542c2f67"],
			[
				"imsss_v1p0auxresource.xsd",
				"0ae955f2aaad171a9cfdc44d594760e0603f720287e91e74a826f408657df1e6",
			],
			["imsss_v1p0control.xsd", "2ad17e6cf1a5cc3b6ef1c53a4a46ecd01d19aca3a266dd7ca45cd405386cf4bb"],
			[
				"imsss_v1p0delivery.xsd",
				"1decbd57c376729b009e77bf99847d305b796e983df24d391c691c85fd958f51",
			],
			["imsss_v1p0limit.xsd", "3d40084a6b382d9cb3f4f711b7b01dd68ca9e8c55aae362b6fae7f1941e3fea0"],
			[
				"imsss_v1p0objective.xsd",
				"2703b15398f51ae58d3c9ae9d0767c3c0faaacfd6c6608c82060cd41c64c300c",
			],
			["imsss_v1p0random.xsd", "27d8c87448f0b82cae102ede5b3cb69d856c7d8cbc817585cd90a7e2f40d1614"],
			["imsss_v1p0rollup.xsd", "833d9294344abb81181fcbbaea768cf4834734f9828e5f40158df21080196165"],
			["imsss_v1p0seqrule.xsd", "7cb11eb050ad67e0fdc30341b87f4044ceeab85b22de8b10aad829dcc39fca6e"],
			["imsss_v1p0util.xsd", "022f7d1af7ae40bed9cbab411ef4881c7360e1b6f0790b6979615a8e6b5dcccd"],
		]) {
			const bytes = zip.readFile(file);
			expect(bytes, file).not.toBeNull();
			expect(
				createHash("sha256")
					.update(bytes as Buffer)
					.digest("hex"),
				file,
			).toBe(sha256);
			const header = (bytes as Buffer)
				.toString("utf8")
				.replaceAll("\r\n", "\n")
				.match(/<!--([\s\S]*?)-->/u)?.[1];
			expect(header, file).toContain("IPR, License and Distribution Notices");
			expect(zip.readAsText("license.txt"), file).toContain(header?.trim() ?? "missing header");
		}
	});

	it("ships the unmodified ADL SCORM 1.2 schema with its grant and complete disclaimer", async () => {
		const result = await buildScormPackage(course, { format: "scorm12" });
		const zip = new AdmZip(result.zip);
		const schema = zip.readFile("adlcp_rootv1p2.xsd");
		expect(schema).not.toBeNull();
		expect(
			createHash("sha256")
				.update(schema as Buffer)
				.digest("hex"),
		).toBe("173decaf9cd31ea847e6ff6853c702137974aca6b56567151aa4a885e0aa4883");
		const notices = zip.readAsText("license.txt");
		for (const text of [
			"ADL SCORM 1.2 schema: adlcp_rootv1p2.xsd",
			'("Licensee") a non-exclusive, royalty free, license to use and redistribute',
			"agrees not to reverse-engineer any of the software, object code or source",
			"SOFTWARE, EVEN IF ADL Co-Lab HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH\nDAMAGES.",
		])
			expect(notices).toContain(text);
	});

	it("ships the unmodified W3C 2001/03 XML namespace schema", async () => {
		const result = await buildScormPackage(course, { format: "scorm2004" });
		const xml = new AdmZip(result.zip).readFile("xml.xsd");
		expect(xml).not.toBeNull();
		// https://www.w3.org/2001/03/xml.xsd, retrieved 2026-10-19.
		expect(
			createHash("sha256")
				.update(xml as Buffer)
				.digest("hex"),
		).toBe("0ed94db44402526e7a683424d0bd4b65e5bc50e65d9b9a762b11b30bae06d0c8");
	});

	it.each([
		["scorm12", "3rd"],
		["scorm2004", "3rd"],
		["scorm2004", "4th"],
		["xapi", "3rd"],
	] as const)(
		"ships upstream notices for every schema family in the %s %s export",
		async (format, scorm2004Edition) => {
			const result = await buildScormPackage(course, { format, scorm2004Edition });
			const zip = new AdmZip(result.zip);
			const notices = zip.readAsText("license.txt");
			for (const [schema, attribution, source] of [
				[
					format === "scorm12" ? "imscp_rootv1p1p2.xsd" : "imscp_v1p1.xsd",
					"IMS Global Learning Consortium",
					"https://www.imsglobal.org/license.html",
				],
				[
					format === "scorm12" ? "adlcp_rootv1p2.xsd" : "adlcp_v1p3.xsd",
					"Advanced Distributed Learning",
					format === "scorm12"
						? "https://www.adlnet.gov/assets/uploads/SCORM1_2_TestSuite1_2_7ST.zip"
						: "https://www.apache.org/licenses/LICENSE-2.0.txt",
				],
				...(format === "scorm12"
					? []
					: [
							[
								"lom.xsd",
								"IEEE LTSC LOM XML 1.0",
								"https://creativecommons.org/licenses/by-sa/2.0/",
							],
							[
								"xml.xsd",
								"W3C® SOFTWARE NOTICE AND LICENSE",
								"https://www.w3.org/Consortium/Legal/copyright-software-19980720",
							],
						]),
			]) {
				expect(zip.getEntry(schema), `${schema} must be shipped`).toBeTruthy();
				expect(notices, `${schema} must have its attribution`).toContain(attribution);
				expect(notices, `${schema} must have its licence source`).toContain(source);
			}
			expect(notices).toBe(
				await readFile(new URL("../schemas/license.txt", import.meta.url), "utf8"),
			);
		},
	);

	it.each([
		["scorm12", "3rd"],
		["scorm2004", "3rd"],
		["scorm2004", "4th"],
		["xapi", "3rd"],
	] as const)(
		"maps every content namespace in the exported %s %s schemaLocation",
		async (format, edition) => {
			const result = await buildScormPackage(passMarkCourse, { format, scorm2004Edition: edition });
			const zip = new AdmZip(result.zip);
			const { document } = parseManifest(zip);
			const tokens = (
				document.documentElement.getAttributeNS(
					"http://www.w3.org/2001/XMLSchema-instance",
					"schemaLocation",
				) ?? ""
			)
				.trim()
				.split(/\s+/u);
			expect(tokens.length % 2).toBe(0);
			const mappings = new Map<string, string>();
			for (let index = 0; index < tokens.length; index += 2)
				mappings.set(tokens[index], tokens[index + 1]);
			const expected =
				format === "scorm12"
					? new Map([
							["http://www.imsproject.org/xsd/imscp_rootv1p1p2", "imscp_rootv1p1p2.xsd"],
							["http://www.adlnet.org/xsd/adlcp_rootv1p2", "adlcp_rootv1p2.xsd"],
						])
					: new Map([
							["http://www.imsglobal.org/xsd/imscp_v1p1", "imscp_v1p1.xsd"],
							["http://www.adlnet.org/xsd/adlcp_v1p3", "adlcp_v1p3.xsd"],
							["http://www.imsglobal.org/xsd/imsss", "imsss_v1p0.xsd"],
							["http://www.adlnet.org/xsd/adlnav_v1p3", "adlnav_v1p3.xsd"],
							["http://ltsc.ieee.org/xsd/LOM", "lom.xsd"],
						]);
			expect(mappings).toEqual(expected);
			for (const schema of mappings.values()) expect(zip.getEntry(schema)).toBeTruthy();
			for (const element of Array.from(document.getElementsByTagName("*"))) {
				for (const node of [element, ...Array.from(element.attributes)]) {
					const namespace = node.namespaceURI;
					// XML, namespace declarations and XSI are built-in XML machinery.
					if (
						!namespace ||
						[
							"http://www.w3.org/2000/xmlns/",
							"http://www.w3.org/XML/1998/namespace",
							"http://www.w3.org/2001/XMLSchema-instance",
						].includes(namespace)
					)
						continue;
					expect(mappings.has(namespace), `Missing controlling document for ${namespace}`).toBe(
						true,
					);
				}
			}
		},
	);

	for (const testCase of cases) {
		it(`builds a ${testCase.format} PIF with version-correct manifest and resources`, async () => {
			const result = await buildScormPackage(course, { format: testCase.format });
			const zip = new AdmZip(result.zip);
			const names = entryNames(zip);
			const { document, xml } = parseManifest(zip);
			const manifest = document.documentElement;

			expect(manifest.localName).toBe("manifest");
			expect(manifest.getAttribute("xmlns")).toBe(testCase.expectedDefaultNamespace);
			expect(manifest.getAttribute("xmlns:adlcp")).toBe(testCase.expectedAdlcpNamespace);
			expect(textContent(document, "schema")).toBe("ADL SCORM");
			expect(textContent(document, "schemaversion")).toBe(testCase.expectedSchemaVersion);

			const organization = document.getElementsByTagName("organization").item(0);
			const item = document.getElementsByTagName("item").item(0);
			const resource = document.getElementsByTagName("resource").item(0);
			expect(organization?.getAttribute("identifier")).toBe("praxity-org");
			expect(item?.getAttribute("identifierref")).toBe("praxity-resource");
			expect(resource?.getAttribute("identifier")).toBe("praxity-resource");
			expect(resource?.getAttribute("type")).toBe("webcontent");
			expect(resource?.getAttribute("href")).toBe("index.html");
			expect(resource?.getAttribute(testCase.expectedScormTypeAttribute)).toBe("sco");
			expect(resource?.hasAttribute(testCase.forbiddenScormTypeAttribute)).toBe(false);

			for (const fragment of testCase.forbiddenFragments) {
				expect(xml).not.toContain(fragment);
			}

			const schemaLocation = manifest.getAttribute("xsi:schemaLocation") ?? "";
			for (const schema of testCase.expectedSchemas) {
				expect(schemaLocation).toContain(schema);
				expect(names.has(schema), `${schema} must be bundled in the PIF`).toBe(true);
			}

			const declaredFiles = Array.from(document.getElementsByTagName("file")).map((file) =>
				file.getAttribute("href"),
			);
			const hostFiles = [...names].filter((name) => name.startsWith("host-"));
			expect(hostFiles).toHaveLength(1);
			const selectedHost = hostFiles[0];
			expect(selectedHost).toMatch(testCase.expectedHostPattern);
			expect(declaredFiles.length).toBeGreaterThan(0);
			expect(declaredFiles).toContain("index.html");
			expect(declaredFiles).toContain(selectedHost);
			expect(declaredFiles).not.toContain("scorm-runtime.js");

			for (const href of declaredFiles) {
				expect(href, "manifest <file> href must be non-empty").toBeTruthy();
				expect(names.has(href ?? ""), `Manifest declares missing file: ${href}`).toBe(true);
			}

			expect(names.has("imsmanifest.xml")).toBe(true);
			expect(names.has("index.html")).toBe(true);
			expect(names.has("scorm-runtime.js")).toBe(false);
		});

		it.each([
			["completion-only", course],
			["pass-mark", passMarkCourse],
		] as const)(
			`validates ${testCase.format} %s imsmanifest.xml against bundled XSDs`,
			async (_label, input) => {
				if (!xmllintAvailable) {
					if (process.env.PRAXITY_GATE === "1") {
						throw new Error(`Missing xmllint: ${xmllint}`);
					}
					console.warn("[adl-conformance] xmllint not available; skipping XSD validation.");
					return;
				}

				const result = await buildScormPackage(input, { format: testCase.format });
				const zip = new AdmZip(result.zip);
				const tempDir = await mkdtemp(join(tmpdir(), "praxity-adl-xsd-"));

				try {
					if (input === passMarkCourse)
						expect(zip.readAsText("imsmanifest.xml")).toMatch(
							testCase.format === "scorm12"
								? /<adlcp:masteryscore>50<\/adlcp:masteryscore>/
								: /<imsss:minNormalizedMeasure>0\.5<\/imsss:minNormalizedMeasure>/,
						);
					zip.extractAllTo(tempDir, true);
					if (testCase.format === "scorm12") {
						await applyScorm12XmllintShim(tempDir);
					}
					const wrapperPath = await writeValidationWrapper(tempDir, testCase);
					const validation = spawnSync(
						xmllint,
						["--noout", "--schema", wrapperPath, join(tempDir, "imsmanifest.xml")],
						{ encoding: "utf-8" },
					);

					expect(
						validation.status,
						`xmllint failed for ${testCase.format}:\n${validation.stdout}\n${validation.stderr}`,
					).toBe(0);
				} finally {
					await rm(tempDir, { recursive: true, force: true });
				}
			},
		);
	}
});
