/// <reference path="./picomatch.d.ts" />
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import picomatch from "picomatch";
import { applyEdits, type Node, type ParseError, parseTree } from "#jsonc-parser";
import {
	assertFileWritableWithin,
	FileNotWritableError,
	resolveWritablePathWithin,
	writeFileAtomicallyWithin,
} from "./path-security";
import {
	assertProjectWritesAllowed,
	excludeProjectFilesFromGit,
} from "./project-file-transactions";

const hiddenNames = [".praxity", ".praxity-write-*"];
const sections = ["files.exclude", "search.exclude"];

export class InitSettingsError extends Error {}

export class InitTargetError extends Error {
	readonly notWritable: boolean;
	constructor(
		readonly target: "settings" | "git",
		cause: unknown,
		readonly settings?: "updated" | "unchanged",
	) {
		super("Initialization target refused", { cause });
		this.notWritable =
			cause instanceof FileNotWritableError ||
			["EACCES", "EPERM", "EROFS"].includes((cause as NodeJS.ErrnoException)?.code ?? "");
	}
}

function property(object: Node, name: string): Node | undefined {
	const matches = object.children?.filter((child) => child.children?.[0].value === name) ?? [];
	if (matches.length > 1) throw new InitSettingsError();
	return matches[0]?.children?.[1];
}

/** Insert only: existing comments, values, whitespace and line endings keep their bytes. */
function insertProperties(text: string, object: Node, entries: string[]): string {
	if (!entries.length) return text;
	const eol = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
	const lineStart = (offset: number) =>
		Math.max(text.lastIndexOf("\n", offset - 1), text.lastIndexOf("\r", offset - 1)) + 1;
	const base = /^[ \t]*/.exec(text.slice(lineStart(object.offset), object.offset))?.[0] ?? "";
	const first = object.children?.[0];
	const existingIndent = first && text.slice(lineStart(first.offset), first.offset);
	const unit = /(?:^|[\r\n])([ \t]+)"/.exec(text)?.[1] ?? "\t";
	const indent = existingIndent && /^[ \t]+$/.test(existingIndent) ? existingIndent : base + unit;
	const close = object.offset + object.length - 1;
	const closeLine = lineStart(close);
	const ownLine = closeLine > object.offset && !text.slice(closeLine, close).trim();
	const last = object.children?.at(-1);
	const edits = [];
	if (last) {
		const end = last.offset + last.length;
		const tail = text
			.slice(end, close)
			.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "")
			.trim();
		if (!tail.startsWith(",")) edits.push({ offset: end, length: 0, content: "," });
	}
	edits.push({
		offset: ownLine ? closeLine : close,
		length: 0,
		content: `${ownLine ? "" : eol}${indent}${entries.join(`,${eol}${indent}`)}${eol}${ownLine ? "" : base}`,
	});
	return applyEdits(text, edits);
}

function matchesHiddenName(pattern: string, name: string): boolean {
	// Folder spellings also express an author's choice for the folder's contents.
	const folder = pattern.replace(/(?:\/\*\*)?\/?$/, "");
	const matches = picomatch(folder, { dot: true });
	// A recovery wildcard denotes every suffix. Preserve uncertain intersections too.
	const relativePattern = folder.replace(/^(?:\*\*\/)+/, "");
	const literalPrefix = relativePattern.split(/[*?{[\]\\]/)[0];
	return (
		matches(name) ||
		(name === ".praxity-write-*" &&
			((literalPrefix !== relativePattern && ".praxity-write-".startsWith(literalPrefix)) ||
				literalPrefix.startsWith(".praxity-write-")))
	);
}

function settingsTree(text: string): Node {
	const errors: ParseError[] = [];
	const root = parseTree(text, errors, { allowTrailingComma: true });
	if (root?.type !== "object" || errors.length) throw new InitSettingsError();
	return root;
}

function settingsPlan(original: string) {
	const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
	let text = original.slice(bom.length);
	if (!text.trim()) text += "{}\n";
	const retained: string[] = [];
	const originalRoot = settingsTree(text);
	const falsePatterns = sections.flatMap((section) => {
		const existing = property(originalRoot, section);
		if (existing && existing.type !== "object") throw new InitSettingsError();
		return (existing?.children ?? [])
			.filter((child) => child.children?.[1].value === false)
			.map((child) => ({ section, pattern: child.children?.[0].value as string }));
	});
	const names = hiddenNames.map((name) => ({
		name,
		status: "already" as "already" | "hidden" | "retained",
	}));
	for (const section of sections) {
		const root = settingsTree(text);
		const existing = property(root, section);
		if (existing && existing.type !== "object") throw new InitSettingsError();
		if (existing)
			for (const child of existing.children ?? []) property(existing, child.children?.[0].value);
		const entries: string[] = [];
		for (const outcome of names) {
			const { name } = outcome;
			const entry = existing && property(existing, name);
			const overrides = falsePatterns.filter(({ pattern }) => matchesHiddenName(pattern, name));
			if (overrides.length || (entry && entry.value !== true)) {
				outcome.status = "retained";
				if (overrides.length)
					for (const override of overrides)
						retained.push(`${override.section}[${JSON.stringify(override.pattern)}]`);
				else retained.push(`${section}[${JSON.stringify(name)}]`);
			} else if (!entry) {
				entries.push(`${JSON.stringify(name)}: true`);
				if (outcome.status !== "retained") outcome.status = "hidden";
			}
		}
		text = existing
			? insertProperties(text, existing, entries)
			: entries.length
				? insertProperties(text, root, [`${JSON.stringify(section)}: {${entries.join(", ")}}`])
				: text;
	}
	return { text: bom + text, retained: [...new Set(retained)], names };
}

export async function initCourse(root: string) {
	assertProjectWritesAllowed();
	const settingsPath = join(root, ".vscode/settings.json");
	let original: string | null;
	try {
		original = await readFile(settingsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return null;
		});
		if (original !== null) await assertFileWritableWithin(root, settingsPath);
	} catch (error) {
		throw new InitTargetError("settings", error);
	}
	const plan = settingsPlan(original ?? "{}\n");
	const settings = original === plan.text ? "unchanged" : "updated";
	try {
		await excludeProjectFilesFromGit(root, "check");
	} catch (error) {
		throw new InitTargetError("git", error);
	}
	if (settings === "updated") {
		try {
			await mkdir(await resolveWritablePathWithin(root, join(root, ".vscode")), {
				recursive: true,
			});
			await writeFileAtomicallyWithin(root, settingsPath, Buffer.from(plan.text));
		} catch (error) {
			throw new InitTargetError("settings", error);
		}
	}
	try {
		const git = await excludeProjectFilesFromGit(root, "replace");
		return { settings, git, retained: plan.retained, names: plan.names };
	} catch (error) {
		throw new InitTargetError("git", error, settings);
	}
}
