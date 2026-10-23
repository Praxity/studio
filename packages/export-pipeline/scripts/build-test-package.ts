#!/usr/bin/env npx tsx
/** Build a package for the official ADL validator through the production pipeline. */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildScormPackage, type CourseExportInput } from "../src/build.ts";

const format = process.argv[2] ?? "scorm12";
if (format !== "scorm12" && format !== "scorm2004") {
	throw new Error("Usage: build-test-package.ts [scorm12|scorm2004]");
}

const course: CourseExportInput = {
	id: "adl-conformance-smoke",
	title: "Praxity Studio SCORM Test Course",
	sourceLocale: "en",
	content: [
		{
			id: "welcome",
			title: "Welcome",
			blocks: [
				{
					id: "welcome-text",
					type: "text",
					data: { content: "<p>This package validates the production SCORM pipeline.</p>" },
				},
			],
		},
	],
};

const result = await buildScormPackage(course, { format });
const outputPath = path.resolve(import.meta.dirname, `../test-course-${format}.zip`);
await writeFile(outputPath, result.zip);
console.log(`${format}: ${result.pageCount} page, ${result.zip.byteLength} bytes -> ${outputPath}`);
