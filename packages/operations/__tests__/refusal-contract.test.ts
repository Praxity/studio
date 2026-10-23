import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runPraxityCli } from "../../../apps/desktop/src/main/cli.ts";
import en from "../../../apps/desktop/src/main/cli-messages/en.json";
import fr from "../../../apps/desktop/src/main/cli-messages/fr.json";
import {
	editExitCodes,
	editHelp,
	editRefusalCatalogue,
} from "../../../apps/desktop/src/main/edit-cli.ts";
import { readBlockInventory } from "../../../apps/desktop/src/main/operations/block-inspection.ts";
import { OperationService } from "../../../apps/desktop/src/main/operations/operation-service.ts";
import { editCliOutputSchema } from "../../../apps/desktop/src/shared/edit-cli-schema.ts";
import { persistFixtureIdentity } from "../../../apps/desktop/src/test-utils/identity-fixture.ts";
import editorFr from "../../editor-core/src/messages/fr.json";
import { operationRefusalCodes } from "../../grammar/src/operations/contract.ts";
import { operationRegistry } from "../src/index.ts";

const hostile = ["__proto__", "constructor", "toString"];
// Free author text and titles are content, not names used for registry lookup.
const nameArguments = new Set(["name", "field", "type", "direction", "position", "rename"]);
const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const source =
	"# First\n::: note Advisory {tone=info}\nKeep safe.\n:::\n\n# Second\n::: note Other {tone=info}\nKeep safe.\n:::\n";
let root: string;
let inventory: Awaited<ReturnType<typeof readBlockInventory>>;
let service: OperationService;
let before: Record<string, string>;

async function bytes(dir: string, prefix = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await bytes(dir, path));
		else result[path] = (await readFile(join(dir, path))).toString("base64");
	}
	return result;
}

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), "refusal-contract-"));
	await writeFile(join(root, "lesson.prax"), source);
	await writeFile(join(root, "course.yaml"), "title: Course\nlessons: [lesson.prax]\n");
	await persistFixtureIdentity(root);
	inventory = await readBlockInventory(root);
	service = new OperationService(root);
	before = await bytes(root);
});
afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});

it("the refusal catalogue covers every grammar code in both languages and distinct exit classes", () => {
	const codes = [...operationRefusalCodes, "failed"] as const;
	expect(Object.keys(editRefusalCatalogue).sort()).toEqual([...codes].sort());
	for (const code of Object.keys(editExitCodes).filter((code) => code !== "ok"))
		expect(Object.hasOwn(editRefusalCatalogue, code), code).toBe(true);
	for (const code of codes) {
		const entry = editRefusalCatalogue[code];
		expect(entry.en).toBe(en.edit[code]);
		expect(entry.fr).toBe(fr.edit[code]);
		expect(entry.en.trim().length).toBeGreaterThan(0);
		expect(entry.fr.trim().length).toBeGreaterThan(0);
		expect(entry.en).not.toBe(entry.fr);
		expect(entry.exitCode).toBeGreaterThan(0);
		expect(Number.isInteger(entry.exitCode)).toBe(true);
		expect(editHelp([])).toContain(`${entry.exitCode}=${code}`);
	}
	expect(new Set(codes.map((code) => editRefusalCatalogue[code].exitCode)).size).toBe(codes.length);
	expect(editRefusalCatalogue.orphaned.exitCode).not.toBe(editRefusalCatalogue.ambiguous.exitCode);
});

it("C06a review French refusal catalogues retain accents without replacement characters", () => {
	for (const catalogue of [fr.edit, editorFr.op]) {
		expect(catalogue.settings).toContain("paramètres");
		for (const text of Object.values(catalogue)) {
			if (typeof text === "string") expect(text).not.toMatch(/\p{L}[?\uFFFD]\p{L}/u);
		}
	}
});

it("valid names reach the service planner", async () => {
	const note = inventory.blocks.find((block) => block.type === "note");
	if (!note) throw new Error("Missing fixture note");
	expect(
		await service.resolve({
			transactionId: "control",
			operation: "setProperty",
			files: inventory.files,
			targets: [note.target],
			args: { name: "tone", value: "warning" },
		}),
	).toMatchObject({ ok: true });
});

for (const [operation, argumentsAllowed] of Object.entries(operationRegistry)) {
	const cases = hostile.flatMap((name) => [
		{ label: `key=${name}`, args: JSON.parse(`{"${name}":"hostile"}`) as Record<string, unknown> },
		...argumentsAllowed
			.filter((arg) => nameArguments.has(arg))
			.map((arg) => ({
				label: `${arg}=${name}`,
				args: { text: "::: note Changed\nFresh.\n:::\n", value: "warning", [arg]: name } as Record<
					string,
					unknown
				>,
			})),
	]);
	for (const entry of cases) {
		it(`${operation} refuses ${entry.label} through service and CLI`, async () => {
			const note = inventory.blocks.find((block) => block.type === "note");
			const page = inventory.blocks.find((block) => block.kind === "page");
			if (!note || !page) throw new Error("Missing fixture target");
			// Supply only declared arguments so a lookup-name test cannot pass on an extra-key refusal.
			if (!entry.label.startsWith("key="))
				for (const key of Object.keys(entry.args))
					if (!argumentsAllowed.includes(key)) delete entry.args[key];
			const target =
				operation === "insertBlock"
					? {
							file: note.file,
							ref: {
								kind: "insertion" as const,
								parentId: page.nodeId,
								after: note.nodeId,
								before: null,
							},
						}
					: note.target;
			const result = await service.apply({
				transactionId: `${operation}:${entry.label}`,
				operation,
				files: inventory.files,
				targets: [target],
				args: entry.args,
			});
			expect(result, entry.label).toMatchObject({
				ok: false,
				code: expect.stringMatching(/^(invalid-args|not-allowed)$/),
				message: { key: expect.stringMatching(/^op\./) },
			});
			const cli = await runPraxityCli(
				[
					"edit",
					root,
					operation,
					"--at",
					note.address,
					...Object.entries(entry.args).flatMap(([key, value]) => [
						"--arg",
						`${key}=${JSON.stringify(value)}`,
					]),
					"--json",
					"--lang",
					"fr",
				],
				runtime,
			);
			const output = editCliOutputSchema.parse(JSON.parse(cli.stdout));
			expect(output, entry.label).toMatchObject({
				ok: false,
				code: expect.stringMatching(/^(invalid-args|not-allowed)$/),
			});
			if (output.ok) throw new Error("Hostile name was acknowledged");
			expect(output.message).toBe(fr.edit[output.code as keyof typeof fr.edit]);
			expect(cli.exitCode).toBe(editExitCodes[output.code as keyof typeof editExitCodes]);
			expect(await bytes(root)).toEqual(before);
		});
	}
}

it.each(hostile)("refuses the operation name %s through service and CLI", async (operation) => {
	const note = inventory.blocks.find((block) => block.type === "note");
	if (!note) throw new Error("Missing fixture note");
	expect(
		await service.apply({
			transactionId: operation,
			operation,
			files: inventory.files,
			targets: [note.target],
			args: {},
		}),
	).toMatchObject({ ok: false, code: "invalid-args" });
	const cli = await runPraxityCli(
		["edit", root, operation, "--at", note.address, "--json"],
		runtime,
	);
	expect(JSON.parse(cli.stdout)).toMatchObject({
		ok: false,
		code: "invalid-args",
		message: en.edit["invalid-args"],
	});
	expect(cli.exitCode).toBe(editExitCodes["invalid-args"]);
	expect(await bytes(root)).toEqual(before);
});

it("wrong targets and ambiguous targets produce separate localized refusals", async () => {
	for (const language of ["en", "fr"] as const) {
		for (const [selector, value, code] of [
			["--at", "missing", "orphaned"],
			["--find", "Keep safe.", "ambiguous"],
		] as const) {
			const cli = await runPraxityCli(
				["edit", root, "setProperty", selector, value, "--json", "--lang", language],
				runtime,
			);
			expect(JSON.parse(cli.stdout)).toMatchObject({
				ok: false,
				code,
				message: editRefusalCatalogue[code][language],
			});
			expect(cli.exitCode).toBe(editRefusalCatalogue[code].exitCode);
		}
	}
	expect(await bytes(root)).toEqual(before);
});

for (const language of ["en", "fr"] as const) {
	it(`break-ui B CLI reports list markers and settings in ${language} without writes`, async () => {
		for (const [kind, field, text, code, exitCode] of [
			["body", "text", "2026. Une ann\u00e9e", "list-marker", 12],
			["body", "text", "1. Lisez", "list-marker", 12],
			["page", "subject", "Voir {page 3}", "settings", 13],
		] as const) {
			const block = inventory.blocks.find((block) => block.kind === kind);
			if (!block) throw new Error(`Missing ${kind}`);
			const cli = await runPraxityCli(
				[
					"edit",
					root,
					"setText",
					"--at",
					block.address,
					"--arg",
					`field=${JSON.stringify(field)}`,
					"--arg",
					`text=${JSON.stringify(text)}`,
					"--json",
					"--lang",
					language,
				],
				runtime,
			);
			const expected =
				language === "en"
					? code === "list-marker"
						? "This line would become a list item. Remove the list marker to keep it as text."
						: "Braces would become heading settings. Remove the braces to keep this as text."
					: code === "list-marker"
						? "Cette ligne deviendrait un \u00e9l\u00e9ment de liste. Retirez le marqueur de liste pour la garder comme texte."
						: "Les accolades deviendraient des param\u00e8tres du titre. Retirez les accolades pour garder ce contenu comme texte.";
			expect(JSON.parse(cli.stdout)).toMatchObject({ ok: false, code, message: expected });
			expect(cli.exitCode).toBe(exitCode);
			expect(await bytes(root)).toEqual(before);
		}
	});
}
