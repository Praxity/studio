import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readLesson } from "../src/read-lesson";
import { BLOCK_SCHEMA, getDefinition, SPOT_SETTINGS, validateCourse } from "../src/v4/schema";

const docs = resolve(__dirname, "../../../docs/prax-format");
const files = readdirSync(docs, { recursive: true }).filter((file) => /\.(md|prax)$/.test(file));
const read = (file: string) => readFileSync(resolve(docs, file), "utf8");

// Fences are full lessons, including a page. Error examples declare every expected
// diagnostic as code@line:column in their fence info, in source order.
function fences(file: string) {
	const result: { title: string; source: string; expected: string[] }[] = [];
	const lines = read(file).split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const opener = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[index]);
		if (!opener) continue;
		const start = index;
		const body: string[] = [];
		while (++index < lines.length) {
			const closer = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[index]);
			if (closer && closer[1][0] === opener[1][0] && closer[1].length >= opener[1].length) break;
			body.push(lines[index]);
		}
		if (!/^prax(?:\s|$)/.test(opener[2].trim())) continue;
		const info = opener[2].trim();
		if (!/^prax(?: error=[\w-]+@\d+:\d+(?:,[\w-]+@\d+:\d+)*)?$/.test(info))
			throw new Error(`${file}:${start + 1}: invalid prax fence annotation`);
		if (index === lines.length) throw new Error(`${file}:${start + 1}: unclosed prax fence`);
		result.push({
			title: `${file}:${start + 1}`,
			source: `${body.join("\n")}\n`,
			expected: info.includes(" error=") ? info.split(" error=")[1].split(",") : [],
		});
	}
	return result;
}

const examples = files.flatMap((file) =>
	file.endsWith(".prax")
		? [{ title: file, source: read(file), expected: [] as string[] }]
		: fences(file),
);

describe("D1 grammar-4 documentation", () => {
	it.each(examples)("$title has exactly its documented diagnostics", ({ source, expected }) => {
		expect(readLesson(source).diagnostics.map((d) => `${d.code}@${d.line}:${d.column}`)).toEqual(
			expected,
		);
	});
	it("validates the dialogue patterns with their authored course cast", () => {
		const manifest = parseYaml(read("examples/patterns/course.yaml")) as {
			lessons: string[];
			cast: Record<string, unknown>;
		};
		const lessons = manifest.lessons.map((path) => ({
			path,
			tree: readLesson(read(`examples/patterns/${path}`)).tree,
		}));
		expect(validateCourse(lessons, { cast: manifest.cast }).diagnostics).toEqual([]);
	});

	const reference = files
		.filter((file) => /^reference[\\/].*\.md$/.test(file))
		// Example headings and tables cannot count as reference entries.
		.map((file) => read(file).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, ""))
		.join("\n");
	const sections = [...reference.matchAll(/^## ([^\r\n]+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
	const section = (type: string) => {
		const matches = sections.filter(
			(match) => match[1].toLowerCase().replaceAll(" ", "-") === type,
		);
		expect(matches, `${type} needs one owning reference section`).toHaveLength(1);
		return matches[0]?.[2] ?? "";
	};
	const keys = (text: string, colon = "") =>
		[...text.matchAll(new RegExp(`^\\| \\x60([\\w-]+)${colon}\\x60 \\|`, "gm"))].map(
			(match) => match[1],
		);
	it.each(Object.entries(BLOCK_SCHEMA))(
		"%s documents every schema setting and part",
		(type, definition) => {
			const own = section(type);
			const shared = own.includes("[Shared block settings]")
				? section("shared-block-settings")
				: "";
			const question = own.includes("[Shared question settings and parts]")
				? section("shared-question-settings-and-parts")
				: "";
			const content = `${own}\n${shared}\n${question}`;
			expect([...new Set(keys(content))].sort(), `${type} settings`).toEqual(
				Object.keys(definition.settings).sort(),
			);
			expect([...new Set(keys(content, ":"))].sort(), `${type} parts`).toEqual(
				[...(definition.parts ?? [])].sort(),
			);
			if (definition.itemDefinition) {
				const item = section(`${type}-item`);
				const itemShared = item.includes("[Shared block settings]")
					? section("shared-block-settings")
					: "";
				expect(keys(`${item}\n${itemShared}`).sort(), `${type} item settings`).toEqual(
					Object.keys(definition.itemDefinition.settings).sort(),
				);
				expect(keys(item, ":").sort(), `${type} item parts`).toEqual(
					[...(definition.itemDefinition.parts ?? [])].sort(),
				);
			}
		},
	);
	it("documents the back face and every hotspot setting", () => {
		const back = getDefinition("back");
		expect(back).toBeDefined();
		const own = section("back");
		const shared = own.includes("[Shared block settings]") ? section("shared-block-settings") : "";
		expect(keys(`${own}\n${shared}`).sort()).toEqual(Object.keys(back?.settings ?? {}).sort());
		expect(keys(own, ":").sort()).toEqual([...(back?.parts ?? [])].sort());
		expect(keys(section("hotspot-spot")).sort()).toEqual(Object.keys(SPOT_SETTINGS).sort());
	});
});
