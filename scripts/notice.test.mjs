import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const notice = await readFile(new URL("NOTICE", root), "utf8");
const mappings = [
	[
		"packages/export-pipeline/schemas/",
		[
			"packages/export-pipeline/schemas/license.txt",
			"IMS, ADL, IEEE LOM and W3C",
			"embedded notices",
		],
	],
	[
		"apps/desktop/resources/third-party-notices/",
		[
			"upstream licence and notice",
			"image-codecs",
			"react-remove-scroll-bar",
			"saxes",
			"typst-assets-0.15.1",
			"Feather",
		],
	],
	["apps/desktop/resources/sample-course/", ["TABLER-LICENSE.txt", "Tabler", "MIT"]],
	[
		"packages/grammar/__tests__/fixtures/v4/leadership/",
		["00-avant-de-commencer.prax", "CC BY 4.0", "https://doi.org/10.5281/zenodo.14714410"],
	],
	[
		"apps/desktop/resources/typst/",
		["LICENSE, NOTICE and FONT-NOTICE", "mitex/LICENSE", "OFL", "fonts/<family>/LICENSE"],
	],
	[
		"apps/desktop/resources/export-assets/",
		["viewer-manifest.json", "upstream licence texts", "third-party-notices/"],
	],
	["docs/prax-format/", ["docs/prax-format/LICENSE", "CC BY 4.0", "CC0 1.0", "MIT"]],
	[
		"packages/export-pipeline/template/COURSE-RUNTIME-LICENSE.txt",
		["Praxity delivery runtime permissions"],
	],
	[
		"packages/shared-blocks/src/blocks/shared-blocks.css",
		[
			"Feather",
			"4.29.2",
			"edit-2",
			"MIT",
			"apps/desktop/resources/third-party-notices/feather-icons@4.29.2/LICENSE",
		],
	],
	...[
		"packages/export-pipeline/src/__tests__/fixtures/pilot-pattern-renderers.json",
		"packages/shared-blocks/src/scene-header.tsx",
		"packages/export-pipeline/src/html-gen.ts",
		"packages/export-pipeline/template/src/components/course-completion-result.ts",
	].map((path) => [
		path,
		["Tabler", "3.46.0", "MIT", "apps/desktop/resources/sample-course/TABLER-LICENSE.txt"],
	]),
];

function assertMapping(text, path, terms) {
	const entry = text
		.split(/\n(?=- )/)
		.find((entry) => entry.startsWith("- ") && entry.includes(path));
	assert.ok(entry, `Missing vendored path in NOTICE: ${path}`);
	for (const term of terms)
		assert.ok(entry.includes(term), `Missing terms mapping for ${path}: ${term}`);
}

for (const [path, terms] of mappings) {
	test(`NOTICE maps ${path} to its terms`, () => assertMapping(notice, path, terms));
	test(`path alone cannot satisfy the notice for ${path}`, () => {
		assert.throws(
			() => assertMapping(`- ${path}\n- Unrelated work: ${terms.join(", ")}\n`, path, terms),
			/Missing terms mapping/,
		);
	});
}

test("root notice distinguishes Praxity code and is linked from README", async () => {
	assert.match(notice, /PolyForm Perimeter[^\n]*Praxity-authored code only/);
	assert.match(await readFile(new URL("README.md", root), "utf8"), /\[NOTICE\]\(NOTICE\)/);
});

test("signature cursor records its source beside the unchanged geometry", async () => {
	const css = await readFile(
		new URL("packages/shared-blocks/src/blocks/shared-blocks.css", root),
		"utf8",
	);
	assert.match(css, /Feather v4\.29\.2 edit-2 \(MIT\)[^\n]*\n\s*cursor:/);
	assert.ok(css.includes("M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"));
});

test("cursor notice retains the complete pinned upstream MIT text", async () => {
	const license = await readFile(
		new URL("apps/desktop/resources/third-party-notices/feather-icons@4.29.2/LICENSE", root),
	);
	// https://github.com/feathericons/feather/blob/v4.29.2/LICENSE, LF line endings.
	assert.equal(
		createHash("sha256").update(license.toString("utf8").replaceAll("\r\n", "\n")).digest("hex"),
		"308028e93fcf84972523cdf6e616f73168546b4953895f516d01287f16fe7bee",
	);
});

test("shipped schema notice includes only applicable upstream notices", async () => {
	const schema = await readFile(
		new URL("packages/export-pipeline/schemas/license.txt", root),
		"utf8",
	);
	assert.doesNotMatch(schema, /unverified|SPECIFICATION (?:DOCUMENT LICENSE|LICENSE AGREEMENT)/i);
	assert.ok(schema.includes("https://www.imsglobal.org/license.html"));
	assert.ok(schema.startsWith("Sections for files absent from this package do not apply.\n"));
});

test("schema notice preserves the complete IMS distribution terms", async () => {
	const schema = await readFile(
		new URL("packages/export-pipeline/schemas/license.txt", root),
		"utf8",
	);
	for (const text of [
		"IPR, License and Distribution Notices",
		"Copyright © IMS Global Learning Consortium 1999-2007. All Rights Reserved.",
		"complete a valid license registration with IMS and receive an email from IMS granting the license",
		"complete a valid profile registration with IMS and receive an email from IMS granting the license",
		"The limited permissions granted above are perpetual and will not be revoked by IMS or its successors or assigns.",
		"FROM THE USE OF THIS SPECIFICATION.",
	])
		assert.ok(schema.replace(/\s+/gu, " ").includes(text), `Missing IMS terms: ${text}`);
});

test("schema notice retains ADL, LOM and W3C attribution and full Apache text", async () => {
	const schema = await readFile(
		new URL("packages/export-pipeline/schemas/license.txt", root),
		"utf8",
	);
	const apache = schema.slice(
		schema.indexOf("Apache License\n"),
		schema.indexOf("\nIEEE Learning Technology Standards Committee"),
	);
	// https://www.apache.org/licenses/LICENSE-2.0.txt, retrieved 2026-10-19.
	assert.equal(
		createHash("sha256").update(apache.replace(/\s+/gu, " ").trim()).digest("hex"),
		"0ffddef9e48f8a09aed5caf2d44f7ba1c1be2d9b8e0a6f693b1635b2d5566645",
	);
	for (const text of [
		"Copyright 2014 Advanced Distributed Learning",
		"IEEE LTSC LOM XML 1.0, Learning Object Metadata XML schemas",
		"http://standards.ieee.org/reading/ieee/downloads/LOM/lomv1.0/xsd/",
		"https://creativecommons.org/licenses/by-sa/2.0/legalcode.en",
		"W3C® SOFTWARE NOTICE AND LICENSE",
		"https://www.w3.org/copyright/document-license-2002/",
		"http://www.w3.org/2001/03/xml.xsd",
		"http://www.w3.org/2001/XMLSchema.dtd",
		"http://www.w3.org/2001/datatypes.dtd",
	])
		assert.ok(schema.includes(text), `Missing schema attribution: ${text}`);
	// Complete licence and disclaimers from the dated W3C document licence source above.
	const documentLicense = schema.slice(schema.indexOf("By using and/or copying this document"));
	assert.equal(
		createHash("sha256").update(documentLicense.replace(/\s+/gu, " ").trim()).digest("hex"),
		"c1ff2b650a0c4a61cf0546a11e89a5ba096e4737aa75725e31184e0b9457fda8",
	);
});

test("schema notice preserves the complete ADL SCORM 1.2 grant and disclaimer", async () => {
	const schema = await readFile(
		new URL("packages/export-pipeline/schemas/license.txt", root),
		"utf8",
	);
	const expected = `ADL SCORM 1.2 schema: adlcp_rootv1p2.xsd
Advanced Distributed Learning Co-Laboratory (ADL Co-Lab)
Unmodified schema from SCORM Version 1.2 Conformance Test Suite
Version 1.2.7 (Self Test), xml/xsd/adlcp_rootv1p2.xsd.
Source: https://www.adlnet.gov/assets/uploads/SCORM1_2_TestSuite1_2_7ST.zip
SHA-256: 173decaf9cd31ea847e6ff6853c702137974aca6b56567151aa4a885e0aa4883
The following ADL terms apply to this schema.

Advanced Distributed Learning Co-Laboratory (ADL Co-Lab) grants you
("Licensee") a non-exclusive, royalty free, license to use and redistribute
this software, provided that i) this copyright notice and license appear
on all copies of the software; and ii) Licensee does not utilize the
software in a manner which is disparaging to ADL Co-Lab and Licensee
agrees not to reverse-engineer any of the software, object code or source
code for this software.

This software is provided "AS IS," without a warranty of any kind. ALL
EXPRESS OR IMPLIED CONDITIONS, REPRESENTATIONS AND WARRANTIES, INCLUDING
ANY IMPLIED WARRANTY OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
OR NON-INFRINGEMENT, ARE HEREBY EXCLUDED. ADL Co-Lab AND ITS LICENSORS
SHALL NOT BE LIABLE FOR ANY DAMAGES SUFFERED BY LICENSEE AS A RESULT OF
USING, MODIFYING OR DISTRIBUTING THE SOFTWARE OR ITS DERIVATIVES. IN NO
EVENT WILL ADL Co-Lab OR ITS LICENSORS BE LIABLE FOR ANY LOST REVENUE,
PROFIT OR DATA, OR FOR DIRECT, INDIRECT, SPECIAL, CONSEQUENTIAL,
INCIDENTAL OR PUNITIVE DAMAGES, HOWEVER CAUSED AND REGARDLESS OF THE
THEORY OF LIABILITY, ARISING OUT OF THE USE OF OR INABILITY TO USE
SOFTWARE, EVEN IF ADL Co-Lab HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH
DAMAGES.`;
	assert.ok(schema.includes(expected), "Missing complete ADL SCORM 1.2 notice");
});
