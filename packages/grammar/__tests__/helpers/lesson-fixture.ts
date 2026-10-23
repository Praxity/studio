import { findFrontmatterEndOffset } from "../../src/frontmatter.ts";
import { type ReadLessonResult, readLesson } from "../../src/read-lesson.ts";
import starters from "../fixtures/grammar4-starters.json" with { type: "json" };

export function grammar4Starter(keyword: string): string {
	const source = starters[keyword as keyof typeof starters];
	if (!source) throw new Error(`No converted grammar 4 starter fixture for ${keyword}`);
	return source;
}

/** Change an authored setting on the first explicit block in a G4 fixture. */
export function withFixtureSetting(source: string, key: string, value?: string): string {
	return source.replace(
		/^(:::\s+[^\n{]+)(?:\s+\{([^}]*)\})?$/m,
		(_match, prefix: string, settings = "") => {
			const omitted = settings
				.replace(new RegExp(`(?:^|\\s)${key}(?:=(?:"[^"]*"|[^\\s}]+))?(?=\\s|$)\\s*`), " ")
				.trim();
			const updated = [omitted, value === undefined ? "" : `${key}=${value}`]
				.filter(Boolean)
				.join(" ");
			return prefix.trimEnd() + (updated ? ` {${updated}}` : "");
		},
	);
}

/** Block-focused fixtures omit page boundaries. IDs are explicit test allocations,
 * so reparsing can compare semantic data without random transient UUIDs. */
export function readLessonFixture(source: string) {
	let sequence = 0;
	return readLesson(source, {
		ids: Object.assign(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, {
			transient: true,
		}),
	});
}

export function readBlockFixture(source: string) {
	// Fragment fixtures belong to one explicit, hidden-title page. Their block
	// syntax is still read by G4; this does not translate legacy declarations.
	if (!/^#\s/m.test(source) && source.slice(findFrontmatterEndOffset(source)).trim()) {
		const body = findFrontmatterEndOffset(source);
		source = `${source.slice(0, body)}# Fixture {hideTitle}\n\n${source.slice(body)}`;
	}
	const read = readLessonFixture(source);
	return { ...read, blocks: read.blocks.filter((block) => block.type !== "pageBreak") };
}

/** Grammar 4 saves the token stream, including trivia, rather than renderer data. */
export function replayLesson(read: ReadLessonResult): string {
	return read.tree.stream.tokens.map((token) => token.raw).join("");
}

/** Identity-only wrappers do not change a list's learner-visible HTML. */
export function withoutNodeIdentity(html: unknown): string {
	const wrappers: boolean[] = [];
	return String(html)
		.replace(/<div\b[^>]*>|<\/div>/g, (tag) => {
			if (tag === "</div>") return wrappers.pop() ? "" : tag;
			const identity = /^<div data-node-id="[^"]+">$/.test(tag);
			wrappers.push(identity);
			return identity ? "" : tag;
		})
		.replace(/ data-node-id="[^"]+"/g, "");
}
