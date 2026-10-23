import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readProjectConfig, resolveCompletionSettings } from "../project-config";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "praxity-config-policy-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const defaults = {
	version: 1,
	export: { format: "scorm-1.2", completionThreshold: 1, requireKnowledgeChecks: false },
};
const fallback = {
	completionThreshold: 0.65,
	requireKnowledgeChecks: false,
	passingScore: undefined,
};
const completion = () =>
	resolveCompletionSettings({ projectDir: root, fallbackCompletionThreshold: 0.65 });

it("keeps config defaults distinct from the caller's completion fallback without creating files", async () => {
	expect(await readProjectConfig(root)).toEqual(defaults);
	expect(await completion()).toEqual(fallback);
	expect(await readdir(root)).toEqual([]);
});

it("refuses malformed JSON for project config and tolerates it for completion", async () => {
	await writeFile(join(root, "praxity.json"), "{");
	await expect(readProjectConfig(root)).rejects.toThrow(SyntaxError);
	expect(await completion()).toEqual(fallback);
	expect(await readFile(join(root, "praxity.json"), "utf8")).toBe("{");
});

it("uses each operation's defaults for an invalid schema despite a valid raw pass mark", async () => {
	await writeFile(
		join(root, "praxity.json"),
		'{"version":1,"export":{"format":"pdf","completionThreshold":0.9,"passingScore":0.8}}',
	);
	expect(await readProjectConfig(root)).toEqual(defaults);
	expect(await completion()).toEqual(fallback);
});

it("reads saved rules and lets explicit zero, false and pass mark overrides win", async () => {
	const saved =
		'{"version":1,"export":{"format":"scorm-2004","completionThreshold":0.9,"requireKnowledgeChecks":true,"passingScore":0.8}}';
	await writeFile(join(root, "praxity.json"), saved);
	expect(await readProjectConfig(root)).toEqual({
		version: 1,
		export: {
			format: "scorm-2004",
			completionThreshold: 0.9,
			requireKnowledgeChecks: true,
			passingScore: 0.8,
		},
	});
	expect(await completion()).toEqual({
		completionThreshold: 0.9,
		requireKnowledgeChecks: true,
		passingScore: 0.8,
	});
	expect(
		await resolveCompletionSettings({
			projectDir: root,
			fallbackCompletionThreshold: 0.65,
			completionThreshold: 0,
			requireKnowledgeChecks: false,
			passingScore: 1,
		}),
	).toEqual({ completionThreshold: 0, requireKnowledgeChecks: false, passingScore: 1 });
	expect(await readFile(join(root, "praxity.json"), "utf8")).toBe(saved);
});

it.each([0, 1.5, "0.8", -1])(
	"refuses saved pass mark %s unless explicitly overridden",
	async (passingScore) => {
		await writeFile(
			join(root, "praxity.json"),
			JSON.stringify({
				version: 1,
				export: {
					format: "scorm-1.2",
					completionThreshold: 0.9,
					requireKnowledgeChecks: true,
					passingScore,
				},
			}),
		);
		expect(await readProjectConfig(root)).toEqual(defaults);
		await expect(completion()).rejects.toThrow(
			"praxity.json export.passingScore must be a fraction above 0 through 1, such as 0.8. Fix or remove it.",
		);
		expect(
			await resolveCompletionSettings({
				projectDir: root,
				fallbackCompletionThreshold: 0.65,
				passingScore: 0.5,
			}),
		).toEqual({ completionThreshold: 0.65, requireKnowledgeChecks: false, passingScore: 0.5 });
	},
);
