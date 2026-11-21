import { findFrontmatterEndOffset } from "../../src/frontmatter.ts";
import { type ReadLessonResult, readLesson } from "../../src/read-lesson.ts";
import starters from "../fixtures/grammar4-starters.json" with { type: "json" };

export function grammar4Starter(keyword: string): string {
	const source = starters[keyword as keyof typeof starters];
	if (!source) throw new Error(`No converted grammar 4 starter fixture for ${keyword}`);
	return source;
}

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

export function readLessonFixture(source: string) {
	let sequence = 0;
	return readLesson(source, {
		ids: Object.assign(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, {
			transient: true,
		}),
	});
}

export function readBlockFixture(source: string) {
	if (!/^#\s/m.test(source) && source.slice(findFrontmatterEndOffset(source)).trim()) {
		const body = findFrontmatterEndOffset(source);
		source = `${source.slice(0, body)}# Fixture {hideTitle}\n\n${source.slice(body)}`;
	}
	const read = readLessonFixture(source);
	return { ...read, blocks: read.blocks.filter((block) => block.type !== "pageBreak") };
}

export function replayLesson(read: ReadLessonResult): string {
	return read.tree.stream.tokens.map((token) => token.raw).join("");
}

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
