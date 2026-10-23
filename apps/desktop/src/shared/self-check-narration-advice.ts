import {
	type ReadLessonResult,
	readSelfCheckContent,
	SelfCheckContentError,
} from "@praxity/grammar";
import {
	narrationScriptText,
	normalizeNarrationScript,
	type resolveNarrationV2,
} from "@praxity/shared-blocks/narration";

export interface SelfCheckNarrationWarning {
	code: "ENARRATIONSELFCHECKSPOILER";
	/** One-based line in the lesson source, never quoted content. */
	line: number;
}

// Eight characters avoid advice for common short words such as "answer" or "is".
const minimumExcerptLength = 8;
const normalize = (text: string) =>
	normalizeNarrationScript(narrationScriptText(text))
		.normalize("NFC")
		.toLowerCase()
		.replace(/[‘’]/gu, "'")
		.replace(/[“”]/gu, '"');

/** Only this author owner reads full Content; callers receive code and location. */
export function selfCheckNarrationAdvice(
	read: ReadLessonResult,
	resolved: ReturnType<typeof resolveNarrationV2>,
): SelfCheckNarrationWarning[] {
	const warnings = new Map<string, SelfCheckNarrationWarning>();
	const checks = [...read.nodes.values()].filter(
		(record) => !record.role && record.node.type === "self-check",
	);
	for (const page of resolved.pages) {
		if (!page.enabled) continue;
		for (const segment of page.segments) {
			if (
				!segment.custom ||
				segment.disabled ||
				(segment.containerPart === "intro" && !segment.wholeContainer) ||
				segment.kind === "pageTitle"
			)
				continue;
			const owner = read.nodes.get(segment.blockId ?? segment.target.id);
			if (!owner)
				throw Object.assign(new Error("Narration has no source identity."), {
					code: "ENARRATIONTARGET",
				});
			const script = normalize(segment.script);
			if (script.length < minimumExcerptLength) continue;
			const excerpts = [
				script,
				...Array.from(script.matchAll(/"([^"]+)"|'([^']+)'|«([^»]+)»/gu), (match) =>
					(match[1] ?? match[2] ?? match[3]).trim(),
				),
			].filter((text) => text.length >= minimumExcerptLength);
			for (const check of checks) {
				if (
					warnings.has(check.id) ||
					check.node.span.start < owner.node.span.start ||
					check.node.span.end > owner.node.span.end
				)
					continue;
				let content: ReturnType<typeof readSelfCheckContent>;
				try {
					content = readSelfCheckContent(read, check.id);
				} catch (error) {
					// Grammar already reports this draft error. Identity/accessor failures must still refuse.
					if (error instanceof SelfCheckContentError && error.code === "self-check-content-invalid")
						continue;
					throw error;
				}
				const quotations = [
					content.model,
					...content.parts.flatMap((part) => [part.missed, part.evidence]),
				];
				if (
					!quotations.some((text) => {
						const quote = text === null ? "" : normalize(text);
						return (
							quote.length >= minimumExcerptLength &&
							(script.includes(quote) || excerpts.some((excerpt) => quote.includes(excerpt)))
						);
					})
				)
					continue;
				const span = read.spans.get(check.id);
				if (!span)
					throw Object.assign(new Error("Self-check narration has no source location."), {
						code: "ENARRATIONLOCATION",
					});
				warnings.set(check.id, { code: "ENARRATIONSELFCHECKSPOILER", line: span.startLine + 1 });
			}
		}
	}
	return [...warnings.values()].sort((a, b) => a.line - b.line);
}
