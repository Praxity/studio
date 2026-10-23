import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { passMarkPercent } from "./tracking.ts";
import type { ExportFormat, Scorm2004Edition } from "./types";

// See docs/context/scorm-xapi-standards.md for spec references

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

/**
 * Escape the five XML special characters so that arbitrary strings can be
 * safely embedded in XML attribute values and text nodes.
 */
export function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// File enumeration
// ---------------------------------------------------------------------------

/**
 * Recursively walk `distDir` and return every file as a relative path
 * (e.g. `"index.html"`, `"_astro/chunk.js"`).
 *
 * - Hidden files/directories (names starting with `.`) are skipped.
 * - Results are sorted alphabetically for deterministic output.
 */
export async function enumerateFiles(distDir: string): Promise<string[]> {
	const results: string[] = [];

	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else {
				results.push(relative(distDir, fullPath).split(sep).join("/"));
			}
		}
	}

	await walk(distDir);
	results.sort();
	return results;
}

// ---------------------------------------------------------------------------
// Manifest generation
// ---------------------------------------------------------------------------

/**
 * Generate an `imsmanifest.xml` string for the given export format.
 *
 * - `scorm12`  -- SCORM 1.2 manifest (`imscp_rootv1p1p2`, `adlcp_rootv1p2`)
 * - `scorm2004` -- SCORM 2004 manifest (`imscp_v1p1`, `adlcp_v1p3`)
 * - `xapi`     -- Same as SCORM 2004 (xAPI courses are often SCORM-wrapped for LMS delivery)
 * - `web`      -- Returns an empty string (standalone web builds need no manifest)
 */
export function generateManifest(
	format: ExportFormat,
	courseId: string,
	courseTitle: string,
	files: string[],
	frontmatter?: ManifestFrontmatter,
	scorm2004Edition: Scorm2004Edition = "3rd",
	/** Course pass mark (0-100) for LMS-side judgement; omitted for completion-only courses. */
	passingScore?: number,
): string {
	const safeTitle = escapeXml(courseTitle);
	const fileElements = files.map((f) => `      <file href="${escapeXml(f)}"/>`).join("\n");
	const lomXml = format !== "scorm12" && frontmatter ? buildLomMetadata(frontmatter) : "";

	const passMark =
		passingScore !== undefined && Number.isFinite(passingScore) && passingScore > 0
			? passMarkPercent(passingScore)
			: undefined;
	if (format === "scorm12") {
		return buildScorm12Manifest(courseId, safeTitle, fileElements, lomXml, passMark);
	}

	// scorm2004 and xapi both use the SCORM 2004 manifest structure
	return buildScorm2004Manifest(
		courseId,
		safeTitle,
		fileElements,
		lomXml,
		scorm2004Edition,
		passMark,
	);
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

export interface ManifestFrontmatter {
	title?: string;
	lang?: string;
	description?: string;
}

function buildLomMetadata(fm: ManifestFrontmatter): string {
	if (!fm.title && !fm.lang && !fm.description) return "";

	const parts: string[] = [];
	parts.push("    <lom:general>");
	if (fm.title) {
		parts.push(
			`      <lom:title><lom:string language="${escapeXml(fm.lang || "en")}">${escapeXml(fm.title)}</lom:string></lom:title>`,
		);
	}
	if (fm.lang) {
		parts.push(`      <lom:language>${escapeXml(fm.lang)}</lom:language>`);
	}
	if (fm.description) {
		parts.push(
			`      <lom:description><lom:string language="${escapeXml(fm.lang || "en")}">${escapeXml(fm.description)}</lom:string></lom:description>`,
		);
	}
	parts.push("    </lom:general>");
	return `  <lom:lom xmlns:lom="http://ltsc.ieee.org/xsd/LOM">\n${parts.join("\n")}\n  </lom:lom>`;
}

function buildScorm12Manifest(
	courseId: string,
	safeTitle: string,
	fileElements: string,
	lomXml: string,
	passMark?: number,
): string {
	const safeId = escapeXml(courseId);
	return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="com.praxity.${safeId}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
${lomXml}
  </metadata>
  <organizations default="praxity-org">
    <organization identifier="praxity-org">
      <title>${safeTitle}</title>
      <item identifier="praxity-item" identifierref="praxity-resource">
        <title>${safeTitle}</title>${
					passMark === undefined
						? ""
						: `
        <adlcp:masteryscore>${passMark}</adlcp:masteryscore>`
				}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="praxity-resource" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileElements}
    </resource>
  </resources>
</manifest>`;
}

function buildScorm2004Manifest(
	courseId: string,
	safeTitle: string,
	fileElements: string,
	lomXml: string,
	scorm2004Edition: Scorm2004Edition,
	passMark?: number,
): string {
	const safeId = escapeXml(courseId);
	return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="com.praxity.${safeId}" version="1.0"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd${lomXml ? " http://ltsc.ieee.org/xsd/LOM lom.xsd" : ""}">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 ${scorm2004Edition} Edition</schemaversion>
${lomXml}
  </metadata>
  <organizations default="praxity-org">
    <organization identifier="praxity-org">
      <title>${safeTitle}</title>
      <item identifier="praxity-item" identifierref="praxity-resource">
        <title>${safeTitle}</title>
        <adlcp:timeLimitAction>continue,no message</adlcp:timeLimitAction>${
					passMark === undefined
						? ""
						: `
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="praxity-course-result" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${passMark / 100}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>
        </imsss:sequencing>`
				}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="praxity-resource" type="webcontent" adlcp:scormType="sco" href="index.html">
${fileElements}
    </resource>
  </resources>
</manifest>`;
}
