#!/usr/bin/env -S node --import tsx

import { readFileSync } from "node:fs";
import { readLesson } from "../read-lesson.ts";
import { validate } from "../validation/validate.ts";

const filePath = process.argv[2];

if (!filePath) {
	console.error("Usage: grammar-validate <file.md>");
	process.exit(2);
}

let source: string;
try {
	source = readFileSync(filePath, "utf-8");
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Unable to read file: ${message}`);
	process.exit(2);
}

if (source === undefined) {
	process.exit(2);
}

const lesson = readLesson(source);
const { blocks } = lesson;
const result = validate(blocks, source, {
	strictness: "strict",
});

const blockingErrors = [...lesson.errors, ...result.errors].filter(
	(error) => error.level === "error" || error.level === "critical",
);

if (blockingErrors.length > 0) {
	console.error(`\n${blockingErrors.length} blocking issue(s) found\n`);
	for (const error of blockingErrors) {
		const lineSuffix = error.line ? `:${error.line}` : "";
		console.error(`${error.level.toUpperCase()} ${error.id}${lineSuffix} ${error.message}`);
	}
	process.exit(1);
}

console.error(`\nOK (${result.counts.warning} warning(s))\n`);
process.exit(0);
