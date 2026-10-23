import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeLesson } from "../../grammar/src/v4/lex";
import { getDefinition } from "../../grammar/src/v4/schema";
import { analyzeLessonTree } from "../../grammar/src/v4/tree";
import {
	describeDocument,
	type IdentityResolution,
	lexicalScore,
	resolveIdentity,
} from "../src/index";
import rejectedStages from "./fixtures/rejected-stages.json";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const fixture = (path: string) =>
	readFileSync(
		new URL(`../../grammar/__tests__/fixtures/v4/${path}.prax`, import.meta.url),
		"utf8",
	);
const welcome = fixture("toolkit/welcome");
const leadership = fixture("leadership/02-quatre-cavaliers");
const paragraph = "Praxity tools run on your computer.";
const longParagraph = leadership.match(/Le psychologue [^\n]+/u)?.[0];
if (!longParagraph) throw new Error("Missing study paragraph in converted leadership fixture");
const words = longParagraph.split(" ");
const cut = Math.floor((words.length - 1) * 0.9) + 1;
const longBase = welcome.replace(paragraph, longParagraph);
const longSplit = longBase.replace(
	longParagraph,
	`${words.slice(0, cut).join(" ")}\n\n${words.slice(cut).join(" ")}`,
);
const doc = (source: string, path: string) => ({
	path,
	tree: analyzeLessonTree(tokenizeLesson(source), { definition: getDefinition }),
});
const address = (file: string, path: readonly number[]) => `${file}:${path.join("/")}`;
function session(old: Record<string, string>, next: Record<string, string>) {
	let n = 1;
	const deps = {
		digest,
		allocateId: () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`,
	};
	const documents = (sources: Record<string, string>) =>
		Object.entries(sources).map(([path, source]) => doc(source, path));
	const before = resolveIdentity({ parsedDocuments: documents(old), priorSnapshots: [] }, deps);
	const apply = (state: IdentityResolution, sources: Record<string, string>) =>
		resolveIdentity(
			{
				course: state.course,
				parsedDocuments: documents(sources),
				priorSnapshots: state.snapshots,
				priorHeads: state.heads,
			},
			deps,
		);
	return { before, after: apply(before, next), apply };
}
function ids(state: IdentityResolution, file?: string) {
	return state.sourceMappings.filter((m) => !file || m.file === file).map((m) => m.id);
}
function idAt(state: IdentityResolution, path: number[], file = "welcome.prax") {
	const mapping = state.sourceMappings.find((m) => address(m.file, m.path) === address(file, path));
	if (!mapping) throw new Error(`Missing ${address(file, path)}`);
	return mapping.id;
}
const base = { "welcome.prax": welcome };

describe("I2 study controlled cases on converted courses", () => {
	it.each([
		["toolkit typo", welcome.replace("computer.", "computre.")],
		["toolkit title rename", welcome.replace("Welcome", "Getting started")],
		["toolkit LF to CRLF", welcome.replaceAll("\n", "\r\n")],
	])("%s keeps identities", (_, source) => {
		const { before, after } = session(base, { "welcome.prax": source });
		expect(ids(after)).toEqual(ids(before));
		expect(after.exportable).toBe(true);
	});
	it("toolkit short reword stays below the score threshold", () => {
		const { before, after } = session(base, {
			"welcome.prax": welcome.replace(
				paragraph,
				"The Praxity tools work locally on your computer.",
			),
		});
		expect(idAt(after, [1, 1])).not.toBe(idAt(before, [1, 1]));
	});
	it.each([
		["toolkit", welcome],
		["leadership", leadership],
	])("%s file rename keeps identities", (_, source) => {
		const { before, after } = session({ "lesson.prax": source }, { "renamed.prax": source });
		expect(ids(after)).toEqual(ids(before));
	});
	it("toolkit file copy keeps the original and allocates every copied node", () => {
		const { before, after } = session(base, { ...base, "copy.prax": welcome });
		expect(ids(after, "welcome.prax")).toEqual(ids(before));
		for (const id of ids(after, "copy.prax")) expect(ids(before)).not.toContain(id);
	});
	it("toolkit paragraph inserted before keeps the original through its new path", () => {
		const source = welcome.replace("## One idea", "This course is ready to edit.\n\n## One idea");
		const { before, after } = session(base, { "welcome.prax": source });
		expect(idAt(after, [1, 2])).toBe(idAt(before, [1, 1]));
		expect(ids(before)).not.toContain(idAt(after, [1, 0]));
	});
	it("toolkit paragraph duplicated before leaves both copies pending", () => {
		const source = welcome.replace("## One idea", `${paragraph}\n\n## One idea`);
		const { before, after, apply } = session(base, { "welcome.prax": source });
		const original = idAt(before, [1, 1]);
		expect(idAt(after, [1, 0])).not.toBe(original);
		expect(idAt(after, [1, 2])).not.toBe(original);
		expect(after.unresolved.filter((u) => u.candidates.includes(original))).toHaveLength(2);
		expect(after.exportable).toBe(false);
		// Saving the unresolved source again cannot turn provisional copies into a winner.
		const saved = apply(after, { "welcome.prax": source });
		expect(saved.exportable).toBe(false);
	});
	it("toolkit paragraph replaced completely allocates a fresh paragraph", () => {
		const { before, after } = session(base, {
			"welcome.prax": welcome.replace(
				paragraph,
				"A manager resolves a disagreement with a colleague.",
			),
		});
		expect(idAt(after, [1, 1])).not.toBe(idAt(before, [1, 1]));
	});
	it.each([
		[
			"toolkit paragraph split",
			welcome,
			welcome.replace(paragraph, "Praxity tools run.\n\nOn your computer."),
		],
		[
			"toolkit paragraphs merged",
			welcome.replace(paragraph, "Praxity tools run.\n\nOn your computer."),
			welcome,
		],
		["leadership dominant paragraph split", longBase, longSplit],
		["leadership dominant paragraphs merged", longSplit, longBase],
	])("%s allocates fresh paragraphs without a recorded survivor", (_, old, next) => {
		const { before, after } = session({ "welcome.prax": old }, { "welcome.prax": next });
		const oldParagraphs = before.sourceMappings.filter((m) => m.path[0] === 1 && m.path[1] >= 1);
		const newParagraphs = after.sourceMappings.filter((m) => m.path[0] === 1 && m.path[1] >= 1);
		for (const target of newParagraphs)
			expect(oldParagraphs.map((m) => m.id)).not.toContain(target.id);
	});
	it("leadership page move keeps every entity", () => {
		const pages = leadership.split(/(?=^# )/mu);
		const old = pages[0] + pages[1] + pages[2];
		const next = pages[0] + pages[2] + pages[1];
		const { before, after } = session({ "lesson.prax": old }, { "lesson.prax": next });
		expect([...ids(after)].sort()).toEqual([...ids(before)].sort());
	});
	it.each([
		[
			"leadership two parallel source edits",
			leadership
				.replace("Retournez chaque carte", "Tournez chaque carte")
				.replace("collaborateurs ont observé", "collègues ont observé"),
		],
		[
			"leadership card wording changed",
			leadership.replace("Exprimez votre préoccupation", "Formulez votre préoccupation"),
		],
	])("%s keeps every descendant", (_, source) => {
		const { before, after } = session({ "lesson.prax": leadership }, { "lesson.prax": source });
		expect(source).not.toBe(leadership);
		expect(ids(after)).toEqual(ids(before));
		expect(after.exportable).toBe(true);
	});
	it("missing sidecar starts fresh", () => {
		const { before, after } = session({}, base);
		expect(ids(before)).toHaveLength(0);
		expect(after.mapping.every((m) => m.fate === "new")).toBe(true);
	});
	it("stale sidecar unrelated content keeps only I1's recorded lesson namespace", () => {
		const { before, after } = session(base, {
			"welcome.prax": welcome
				.replaceAll("Welcome", "Conflit")
				.replace("One idea", "Gérer un conflit")
				.replace(paragraph, "Écoutez les collègues et réglez les désaccords ensemble."),
		});
		expect(idAt(after, [])).toBe(idAt(before, []));
		for (const id of ids(after).slice(1)) expect(ids(before)).not.toContain(id);
	});
	it("known wrong match: indistinguishable replacement has the typo's exact bytes", () => {
		// The study labels this edit as replacement, although its bytes equal the typo.
		// Content alone cannot distinguish intent. A recorded replace mapping is required.
		const { before, after } = session(base, {
			"welcome.prax": welcome.replace("computer.", "computre."),
		});
		expect(idAt(after, [1, 1])).toBe(idAt(before, [1, 1]));
	});
});

const prose =
	"Authors carefully prepare practical lessons for learners who need clear examples and useful exercises every working day.";
const page = (text: string) => `# Page\n${text}\n`;
describe("I2 reconciliation boundaries", () => {
	it.each(["\u0085", "\uFEFF", "\u202F"])(
		"Unicode whitespace %j folds in lexical scoring",
		(space) => {
			expect(lexicalScore(`alpha${space}beta`, "alpha beta")).toBe(1);
		},
	);
	it("U+001C remains a character rather than whitespace", () => {
		expect(lexicalScore("alpha\u001Cbeta", "alpha beta")).toBe(0.8125);
	});
	it.each(rejectedStages)(
		"saved study case $iteration never retries a rejected sibling",
		({ oldSource, newSource }) => {
			const { before, after } = session({ "a.prax": oldSource }, { "a.prax": newSource });
			expect(idAt(after, [0, 0], "a.prax")).toBe(idAt(before, [0, 0], "a.prax"));
			expect(ids(before)).not.toContain(idAt(after, [0, 1], "a.prax"));
		},
	);
	const tokens = Array.from({ length: 100 }, (_, i) => `word${String(i).padStart(3, "0")}`);
	it("short donors also reject exact contiguous split/merge coverage", () => {
		const donor = tokens.slice(0, 9);
		const chunks = `${donor.slice(0, 8).join(" ")}\n\n${donor[8]}`;
		for (const [old, next] of [
			[donor.join(" "), chunks],
			[chunks, donor.join(" ")],
		]) {
			const { before, after } = session({ "a.prax": page(old) }, { "a.prax": page(next) });
			for (const mapping of after.sourceMappings.filter((m) => m.path.length === 2))
				expect(ids(before)).not.toContain(mapping.id);
		}
	});
	it("a repeated one-word tail still proves contiguous split/merge coverage", () => {
		const donor = [...tokens.slice(0, 99), tokens[98]];
		const chunks = `${donor.slice(0, 99).join(" ")}\n\n${donor[99]}`;
		for (const [old, next] of [
			[donor.join(" "), chunks],
			[chunks, donor.join(" ")],
		]) {
			const { before, after } = session({ "a.prax": page(old) }, { "a.prax": page(next) });
			for (const mapping of after.sourceMappings.filter((m) => m.path.length === 2))
				expect(ids(before)).not.toContain(mapping.id);
		}
	});
	it.each([
		[94, 3, 3],
		[96, 4],
		[98, 1, 1],
		[99, 1],
	])("small fragments %j require a recorded survivor in both directions", (...sizes) => {
		let offset = 0;
		const chunks = sizes.map((size) => {
			const chunk = tokens.slice(offset, offset + size).join(" ");
			offset += size;
			return chunk;
		});
		for (const [old, next] of [
			[tokens.join(" "), chunks.join("\n\n")],
			[chunks.join("\n\n"), tokens.join(" ")],
		]) {
			const { before, after } = session({ "a.prax": page(old) }, { "a.prax": page(next) });
			for (const mapping of after.sourceMappings.filter((m) => m.path.length === 2))
				expect(ids(before)).not.toContain(mapping.id);
		}
	});
	it.each(["\u0085", "\uFEFF", "\u001C", "\u202F"])(
		"fragment detection shares lexical normalization for %j",
		(space) => {
			const whole = tokens.join(space);
			const chunks = [
				tokens.slice(0, 94).join(space),
				tokens.slice(94, 97).join(space),
				tokens.slice(97).join(space),
			].join("\n\n");
			for (const [old, next] of [
				[whole, chunks],
				[chunks, whole],
			]) {
				const { before, after } = session({ "a.prax": page(old) }, { "a.prax": page(next) });
				for (const mapping of after.sourceMappings.filter((m) => m.path.length === 2))
					expect(ids(before)).not.toContain(mapping.id);
			}
		},
	);
	it("a dominant edit with unrelated extra prose remains a non-split match", () => {
		const old = tokens.join(" ");
		const next = `${tokens.slice(0, 94).join(" ")}\n\nUnrelated extra prose.`;
		const { before, after } = session({ "a.prax": page(old) }, { "a.prax": page(next) });
		expect(idAt(after, [0, 0], "a.prax")).toBe(idAt(before, [0, 0], "a.prax"));
	});
	it("retired IDs never return through exact or fuzzy matching", () => {
		const { before, after, apply } = session({ "a.prax": page(prose) }, { "a.prax": "# Page\n" });
		const oldId = idAt(before, [0, 0], "a.prax");
		const restored = apply(after, { "a.prax": page(prose.replace("carefully", "carefuly")) });
		expect(idAt(restored, [0, 0], "a.prax")).not.toBe(oldId);
		expect(restored.snapshots[0].nodes[oldId].status).toBe("retired");
	});
	it.each([
		[
			"owner-bound start and end",
			page(prose),
			page(prose.replace("carefully", "carefuly")),
			[0, 0],
		],
		[
			"two matched neighbours",
			page(`First anchor.\n\n${prose}\n\nLast anchor.`),
			page(`First anchor.\n\n${prose.replace("carefully", "carefuly")}\n\nLast anchor.`),
			[0, 1],
		],
	])("%s supplies anchor evidence", (_, old, next, path) => {
		const { before, after } = session({ "a.prax": old }, { "a.prax": next });
		expect(idAt(after, path as number[], "a.prax")).toBe(idAt(before, path as number[], "a.prax"));
	});
	it("an owner alone cannot rescue a candidate below S=.90", () => {
		const next = prose.replace("Authors carefully prepare", "Writers slowly develop");
		expect(lexicalScore(prose, next)).toBeGreaterThanOrEqual(0.8);
		expect(0.7 * lexicalScore(prose, next) + 0.3).toBeLessThan(0.9);
		const { before, after } = session({ "a.prax": page(prose) }, { "a.prax": page(next) });
		expect(idAt(after, [0, 0], "a.prax")).not.toBe(idAt(before, [0, 0], "a.prax"));
	});
	it("S=.90 is inclusive with an owner and no neighbouring anchors", () => {
		const old = "# Page\nFirst words.\n\n::: note {tone=info}\nShared words.\n:::\n\nLast words.\n";
		const next =
			"# Page\nUnrelated prelude.\n\n::: note {tone=warning}\nShared words.\n:::\n\nUnrelated ending.\n";
		const { before, after } = session({ "a.prax": old }, { "a.prax": next });
		expect(idAt(after, [0, 1], "a.prax")).toBe(idAt(before, [0, 1], "a.prax"));
	});
	it("a unique unchanged page label supplies both anchor hints", () => {
		const old = `# First\n# Shared {hideTitle}\n${prose}\n# Last\n`;
		const next = `# New beginning\n# Shared {hideTitle=false}\n${prose.replace("carefully", "carefuly")}\n# New ending\n`;
		const { before, after } = session({ "a.prax": old }, { "a.prax": next });
		expect(idAt(after, [1], "a.prax")).toBe(idAt(before, [1], "a.prax"));
	});
	it.each([false, true])("mutual margin checks every candidate, reverse=%s", (reverse) => {
		const a = prose.replace("every working day", "throughout the entire week");
		const b = prose.replace("clear examples", "simple illustrations");
		const next = prose.replace("carefully", "carefuly");
		const old = page(reverse ? prose : `${prose}\n\n${b}`);
		const source = page(reverse ? `${next}\n\n${a}` : next);
		const { before, after } = session({ "a.prax": old }, { "a.prax": source });
		expect(idAt(after, [0, 0], "a.prax")).not.toBe(idAt(before, [0, 0], "a.prax"));
	});
	it("the .15 margin is inclusive against a sub-threshold competitor", () => {
		const x = "%".repeat(23);
		const y = "%".repeat(8) + "!".repeat(7) + "%".repeat(8);
		expect(lexicalScore(x, y)).toBe(11 / 14);
		const old = `# Page\n::: note {tone=info}\n${x}\n:::\n::: note {tone=warning}\n${y}\n:::\n`;
		const next = `# Page\n::: note {tone=success}\n${x}\n:::\n`;
		// Best S=.95, competing S=.80. Its lexical score is below .80 too.
		const { before, after } = session({ "a.prax": old }, { "a.prax": next });
		expect(idAt(after, [0, 0], "a.prax")).toBe(idAt(before, [0, 0], "a.prax"));
	});
	it.each([
		["high-confidence", prose.replace("carefully", "carefuly"), true],
		["below .96", prose.replace("carefully prepare", "thoughtfully prepare"), false],
	])("ownerless move %s", (_, next, keep) => {
		const l = lexicalScore(prose, next);
		if (keep) expect(l).toBeGreaterThanOrEqual(0.96);
		else expect(l).toBeLessThan(0.96);
		const { before, after } = session(
			{ "a.prax": `# From\n${prose}\n# To\n` },
			{ "a.prax": `# From\n# To\n${next}\n` },
		);
		expect(idAt(after, [1, 0], "a.prax") === idAt(before, [0, 0], "a.prax")).toBe(keep);
	});
	it.each([
		[2, 0.96, true],
		[3, 0.95, false],
	])("ownerless L boundary with %s changed characters", (count, l, keep) => {
		const oldText = "%".repeat(52);
		const next = "%".repeat(25) + "!".repeat(count) + "%".repeat(27 - count);
		expect(lexicalScore(oldText, next)).toBe(l);
		const { before, after } = session(
			{ "a.prax": `# From\n${oldText}\n# To\n` },
			{ "a.prax": `# From\n# To\n${next}\n` },
		);
		expect(idAt(after, [1, 0], "a.prax") === idAt(before, [0, 0], "a.prax")).toBe(keep);
	});
	it("invalid inline drafts never become fuzzy continuations", () => {
		const old = page(`${prose} @icon{mail}`);
		const next = old.replace("@icon{mail}", "@icon{INVALID}");
		const { before, after } = session({ "a.prax": old }, { "a.prax": next });
		expect(idAt(after, [0, 0], "a.prax")).not.toBe(idAt(before, [0, 0], "a.prax"));
		expect(after.exportable).toBe(false);
	});
	it("all converted course fixtures parse into valid descriptors", () => {
		for (const path of [
			"toolkit/welcome",
			"leadership/00-avant-de-commencer",
			"leadership/01-affirmez-vous",
			"leadership/02-quatre-cavaliers",
			"leadership/03-resoudre-un-conflit",
		])
			expect(describeDocument(doc(fixture(path), `${path}.prax`)).every((d) => d.valid)).toBe(true);
	});
});
