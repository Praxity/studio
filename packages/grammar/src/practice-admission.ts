import { choiceFactError } from "@praxity/content-model";
import { practiceDiagnosticMessage } from "./practice-diagnostics.ts";
import type { ReadLessonResult } from "./read-lesson.ts";
import { lineColumn } from "./v4/lex/index.ts";
import { type CourseLesson, validateCourse } from "./v4/schema.ts";
import type { MessageRef, TreeNode } from "./v4/tree/types.ts";

export interface PracticeSourceDiagnostic {
	code:
		| "practice-no-tracking"
		| "choice-invalid-attempts"
		| "private-choice-practice-only"
		| "unsupported-runtime"
		| "highlight-native-pdf-unsupported";
	message: string;
	messageRef: MessageRef;
	file: string;
	line: number;
	column: number;
	/** UTF-16 source offsets, not rendered text or a learner value. */
	span: { start: number; end: number };
}

export type PracticeAdmissionLesson = CourseLesson | { path: string; read: ReadLessonResult };

/** Selective publication admission. Existing course diagnostics remain advisory
 * to these hosts; never turn validateCourse's entire result into a build gate. */
export function practiceAdmissionDiagnostics(
	lessons: readonly PracticeAdmissionLesson[],
	locale = "en",
	format: "runtime" | "native-pdf" = "runtime",
): PracticeSourceDiagnostic[] {
	const diagnostics: PracticeSourceDiagnostic[] = validateCourse(
		lessons.map((lesson) => ({
			path: lesson.path,
			tree: "read" in lesson ? lesson.read.tree : lesson.tree,
		})),
	).diagnostics.flatMap((diagnostic) => {
		if (
			diagnostic.code !== "practice-no-tracking" &&
			diagnostic.code !== "private-choice-practice-only"
		)
			return [];
		return [
			{
				code: diagnostic.code,
				message: practiceDiagnosticMessage(diagnostic.code, locale),
				messageRef: diagnostic.message,
				file: diagnostic.path,
				line: diagnostic.line,
				column: diagnostic.column,
				span: { start: diagnostic.span.start, end: diagnostic.span.end },
			},
		];
	});
	// Rejected settings disappear from the renderer projection. Carry their source
	// refusal through the same located error path as the other admission codes.
	for (const lesson of lessons) {
		if (!("read" in lesson)) continue;
		for (const error of lesson.read.errors) {
			if (
				error.messageRef.key !== "grammar.v4.bad-setting-value" ||
				error.messageRef.args.type !== "choice" ||
				error.attribute !== "attempts"
			)
				continue;
			const line = error.line ?? lineColumn(lesson.read.tree.stream.source, error.start).line;
			const code = "choice-invalid-attempts";
			diagnostics.push({
				code,
				message: choiceFactError(error.blockId, "attempts", locale).message,
				messageRef: {
					key: `grammar.v4.${code}`,
					args: { blockId: error.blockId, line, column: error.column },
				},
				file: lesson.path,
				line,
				column: error.column,
				span: { start: error.start, end: error.end },
			});
		}
	}
	// Native PDF admission is separate from grammar validity. Retain
	// lossless source locations even when a malformed ancestor has no projection.
	for (const lesson of format === "native-pdf" ? lessons : []) {
		const tree = "read" in lesson ? lesson.read.tree : lesson.tree;
		const visit = (node: TreeNode): void => {
			if (node.type === "highlight") {
				const span = node.header ?? node.span;
				const position = lineColumn(tree.stream.source, span.start);
				const code = "highlight-native-pdf-unsupported";
				diagnostics.push({
					code,
					message: practiceDiagnosticMessage(code, locale),
					messageRef: { key: `grammar.v4.${code}`, args: { ...position, type: "highlight" } },
					file: lesson.path,
					...position,
					span: { start: span.start, end: span.end },
				});
				return;
			}
			node.children.forEach(visit);
		};
		visit(tree.root);
	}
	return diagnostics;
}

export class CoursePracticeAdmissionError extends Error {
	readonly code: PracticeSourceDiagnostic["code"];
	constructor(readonly diagnostics: PracticeSourceDiagnostic[]) {
		super(
			diagnostics.map((d) => `${d.file}:${d.line}:${d.column}: ${d.code}: ${d.message}`).join("\n"),
		);
		this.name = "CoursePracticeAdmissionError";
		this.code = diagnostics[0].code;
	}
}

export function assertCoursePracticeAdmission(
	lessons: readonly PracticeAdmissionLesson[],
	locale = "en",
	format: "runtime" | "native-pdf" = "runtime",
): void {
	const diagnostics = practiceAdmissionDiagnostics(lessons, locale, format);
	if (diagnostics.length) throw new CoursePracticeAdmissionError(diagnostics);
}
