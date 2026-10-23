import { createHash } from "node:crypto";
import { readLesson } from "@praxity/grammar";
import { expect, it } from "vitest";
import { createIdentityResolver, resolveIdentity, serializeIdentity } from "../src/index";

const dependencies = (start = 1000) => {
	let id = start;
	return {
		digest: (text: string) => createHash("sha256").update(text).digest("hex"),
		allocateId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
	};
};
const documents = (sources: Record<string, string>) =>
	Object.entries(sources).map(([path, source]) => ({ path, tree: readLesson(source).tree }));
const alpha =
	"# Alpha\n\nA clear emergency exit must remain accessible.\n\nDistinct donor.\n\n# Other\n\nRepeated.\n\nRepeated.\n";
const beta = "# Beta\n\nUse the appropriate safety equipment.\n\nRepeated.\n\nRepeated.\n";
const priorSources = { "a.prax": alpha, "b.prax": beta };
const cases: [string, Record<string, string>][] = [
	["unchanged", priorSources],
	["paragraph edit", { ...priorSources, "b.prax": beta.replace("appropriate", "correct") }],
	[
		"move within lesson",
		{ ...priorSources, "a.prax": `${alpha.replace("Distinct donor.\n\n", "")}\nDistinct donor.\n` },
	],
	[
		"move across lessons",
		{ "a.prax": alpha.replace("Distinct donor.\n\n", ""), "b.prax": `${beta}\nDistinct donor.\n` },
	],
	["copy from unchanged lesson", { ...priorSources, "b.prax": `${beta}\nDistinct donor.\n` }],
	["duplicate across lessons", { ...priorSources, "b.prax": `${beta}\nRepeated.\n` }],
	[
		"duplicate page title reserves slug",
		{ ...priorSources, "b.prax": `${beta}\n# Alpha\n\nAnother page.\n` },
	],
	["lesson add", { ...priorSources, "c.prax": "# Alpha\n\nNew lesson.\n" }],
	["lesson copy", { ...priorSources, "c.prax": alpha }],
	["lesson delete", { "b.prax": beta }],
	["lesson rename", { "renamed.prax": alpha, "b.prax": beta }],
	["invalid source", { ...priorSources, "b.prax": `${beta}\n::: note\nUnclosed.\n` }],
];
for (const [name, sources] of cases) {
	it(`retained admission equals full admission byte for byte for ${name}`, () => {
		const seed = resolveIdentity(
			{ parsedDocuments: documents(priorSources), priorSnapshots: [], readerRoles: true },
			dependencies(0),
		);
		const input = {
			course: seed.course,
			priorHeads: seed.heads,
			priorSnapshots: seed.snapshots,
			parsedDocuments: documents(priorSources),
			readerRoles: true,
		};
		const retained = createIdentityResolver(input, dependencies());
		const next = documents(sources);
		const actual = retained.resolve(next);
		const expected = resolveIdentity({ ...input, parsedDocuments: next }, dependencies());
		expect(serializeIdentity(actual)).toBe(serializeIdentity(expected));
	});
}

it("retained admission owns its input and every returned result", () => {
	const seed = resolveIdentity(
		{ parsedDocuments: documents(priorSources), priorSnapshots: [], readerRoles: true },
		dependencies(0),
	);
	const input = {
		course: seed.course,
		priorHeads: seed.heads,
		priorSnapshots: seed.snapshots,
		parsedDocuments: documents(priorSources),
		readerRoles: true,
	};
	const retained = createIdentityResolver(input, dependencies());
	const expected = serializeIdentity(resolveIdentity(input, dependencies()));
	input.priorSnapshots[0].sourceHash = "0".repeat(64);
	input.parsedDocuments[0].tree.stream.source = "tampered";
	retained.initial.snapshots[0].nodes = {};
	const result = retained.resolve(documents(priorSources));
	expect(serializeIdentity(result)).toBe(expected);
	result.snapshots[0].nodes = {};
	expect(serializeIdentity(retained.resolve(documents(priorSources)))).toBe(expected);
});

it("retained admission owns mutable configuration and dependency hooks", () => {
	const seed = resolveIdentity(
		{ parsedDocuments: documents(priorSources), priorSnapshots: [], readerRoles: true },
		dependencies(0),
	);
	const input = {
		course: seed.course,
		priorHeads: seed.heads,
		priorSnapshots: seed.snapshots,
		parsedDocuments: documents(priorSources),
		readerRoles: true,
	};
	const hooks = dependencies();
	const retained = createIdentityResolver(input, hooks);
	const next = documents({ ...priorSources, "b.prax": beta.replace("appropriate", "correct") });
	const expected = serializeIdentity(
		resolveIdentity({ ...input, parsedDocuments: next }, dependencies()),
	);
	input.readerRoles = false;
	hooks.digest = () => {
		throw new Error("replaced hook");
	};
	hooks.allocateId = () => {
		throw new Error("replaced hook");
	};
	expect(serializeIdentity(retained.resolve(next))).toBe(expected);
});

it("uses full admission when duplicate retired records prevent a stable baseline", () => {
	const seed = resolveIdentity(
		{ parsedDocuments: documents(priorSources), priorSnapshots: [], readerRoles: true },
		dependencies(0),
	);
	const sources = { ...priorSources, "a.prax": alpha.replace("Distinct donor.\n\n", "") };
	const deleted = resolveIdentity(
		{
			course: seed.course,
			priorHeads: seed.heads,
			priorSnapshots: seed.snapshots,
			parsedDocuments: documents(sources),
			readerRoles: true,
		},
		dependencies(),
	);
	const donor = seed.sourceMappings.find((m) => m.file === "a.prax" && m.path.join("/") === "0/1");
	const from = deleted.snapshots.find((s) => donor && s.nodes[donor.id]?.status === "retired");
	const to = deleted.snapshots.find((s) => s !== from);
	const page = to && Object.entries(to.nodes).find(([, n]) => n.kind === "page");
	if (!donor || !from || !to || !page) throw new Error("Missing retired fixture");
	to.nodes[donor.id] = { ...structuredClone(from.nodes[donor.id]), parent: page[0] };
	const head = deleted.heads.find((h) => h.path === "b.prax");
	if (!head) throw new Error("Missing fixture head");
	head.head = dependencies().digest(serializeIdentity(to));
	const input = {
		course: deleted.course,
		priorHeads: deleted.heads,
		priorSnapshots: deleted.snapshots,
		parsedDocuments: documents(sources),
		readerRoles: true,
	};
	const retained = createIdentityResolver(input, dependencies());
	expect(retained.initial.heads).not.toEqual(input.priorHeads);
	const next = documents({ ...sources, "b.prax": beta.replace("appropriate", "correct") });
	expect(serializeIdentity(retained.resolve(next))).toBe(
		serializeIdentity(resolveIdentity({ ...input, parsedDocuments: next }, dependencies())),
	);
});
