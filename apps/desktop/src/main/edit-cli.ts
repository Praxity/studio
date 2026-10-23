import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
	type OperationRefusalCode,
	operationRefusalCodes,
} from "@praxity/grammar/src/operations/contract.ts";
import { projectIdentityRecoveryAdvice } from "../shared/project-write-errors";
import type { CliExecution } from "./cli";
import en from "./cli-messages/en.json" with { type: "json" };
import fr from "./cli-messages/fr.json" with { type: "json" };
import type { PageSelectionRefusal } from "./operations/block-inspection";
import type { OperationService } from "./operations/operation-service";

const messages = { en: en.edit, fr: fr.edit };
type Language = keyof typeof messages;

// Keep process statuses and the help contract together; refusal JSON keeps the
// grammar's code names so callers never have to parse localized messages.
export const editExitCodes = {
	ok: 0,
	failed: 1,
	"invalid-args": 2,
	"empty-text": 9,
	"line-break": 10,
	"unsupported-syntax": 11,
	"list-marker": 12,
	settings: 13,
	"source-invalid": 14,
	"bad-yaml": 15,
	"identity-retirement-pending": 16,
	orphaned: 3,
	ambiguous: 4,
	stale: 5,
	"not-allowed": 6,
	conflict: 7,
	"escapes-range": 8,
} as const satisfies Record<OperationRefusalCode | "failed" | "ok", number>;
export type EditExitCode = (typeof editExitCodes)[keyof typeof editExitCodes];

/** Each process status is a refusal class, shared by JSON, text and help output. */
export const editRefusalCatalogue = Object.fromEntries(
	([...operationRefusalCodes, "failed"] as const).map((code) => [
		code,
		{
			en: messages.en[code],
			fr: messages.fr[code],
			exitCode: editExitCodes[code],
		},
	]),
) as Record<OperationRefusalCode | "failed", { en: string; fr: string; exitCode: EditExitCode }>;

function languageFromArgs(args: string[]): Language {
	return args[args.indexOf("--lang") + 1] === "fr" ? "fr" : "en";
}

class EditRefusal extends Error {
	constructor(
		readonly code: OperationRefusalCode | "failed",
		readonly pageSelection?: PageSelectionRefusal,
	) {
		super(code);
	}
}
function invalid(): never {
	throw new EditRefusal("invalid-args");
}

export function editHelp(args: string[]): string {
	const codes = Object.entries(editExitCodes)
		.map(([code, status]) => `${status}=${code}`)
		.join(", ");
	return `  praxity edit <course> <operation> [--at <address|uuid|rendered-node-id> | --line <file:line[-end]> | --page <name|number|file:page> --block <number> | --find <text>] [--rendered] [--arg k=v] [--dry-run] [--expect-revision <sha256>] [--json] [--lang en|fr]\n\n${messages[languageFromArgs(args)].renderedUsage}\n${messages[languageFromArgs(args)].exitCodes.replace("{codes}", codes)}`;
}

export async function runInspectBlocksCli(args: string[]): Promise<CliExecution> {
	const language = languageFromArgs(args);
	try {
		if (!args[1] || args[1].startsWith("-") || !["--blocks", "--text-fields"].includes(args[2]))
			invalid();
		const seen = new Set<string>();
		for (let i = 3; i < args.length; i++) {
			const option = args[i];
			if (seen.has(option)) invalid();
			seen.add(option);
			if (option === "--json") continue;
			if (option === "--eligibility" && args[2] === "--blocks") continue;
			if (option !== "--lang" || !["en", "fr"].includes(args[++i])) invalid();
		}
		const { inspectBlocks, inspectTextFields } = await import("./operations/block-inspection");
		const inventory =
			args[2] === "--text-fields"
				? await inspectTextFields(resolve(args[1]))
				: await inspectBlocks(resolve(args[1]), seen.has("--eligibility"));
		return {
			exitCode: editExitCodes.ok,
			stdout: `${JSON.stringify(inventory)}\n`,
			stderr: "",
		};
	} catch (error) {
		return failure(error, language, true, messages[language].inspectUsage);
	}
}

export async function runEditCli(args: string[]): Promise<CliExecution> {
	// Select copy before parsing: an earlier refusal must honor a later --lang.
	const language = languageFromArgs(args);
	const json = args.includes("--json");
	try {
		// Atomic multi-operation persistence needs a batch adapter in S1. Refuse
		// before reading or applying members until that adapter exists.
		if (args.includes("--batch")) throw new EditRefusal("not-allowed");
		const options = new Map<string, string>();
		const values: Record<string, unknown> = {};
		let dryRun = false;
		for (let i = 3; i < args.length; i++) {
			const key = args[i];
			if (key === "--json" || key === "--dry-run" || key === "--rendered") {
				if (options.has(key)) invalid();
				options.set(key, "");
				if (key === "--dry-run") dryRun = true;
				continue;
			}
			if (
				![
					"--at",
					"--line",
					"--page",
					"--block",
					"--find",
					"--arg",
					"--expect-revision",
					"--lang",
				].includes(key)
			)
				invalid();
			const value = args[++i];
			if (value === undefined || value.startsWith("--")) invalid();
			if (key === "--arg") {
				const separator = value.indexOf("=");
				const name = value.slice(0, separator);
				if (
					separator < 1 ||
					["__proto__", "prototype", "constructor"].includes(name) ||
					Object.hasOwn(values, name)
				)
					invalid();
				const raw = value.slice(separator + 1);
				let parsed: unknown = raw;
				try {
					parsed = JSON.parse(raw);
				} catch {
					/* Unquoted arguments are strings. */
				}
				values[name] = parsed;
			} else {
				if (options.has(key)) invalid();
				options.set(key, value);
				if (key === "--lang") {
					if (value !== "en" && value !== "fr") invalid();
				}
			}
		}
		if (!args[1] || args[1].startsWith("-") || !args[2] || args[2].startsWith("-")) invalid();
		if (
			["--at", "--line", "--page", "--find"].filter((key) => options.has(key)).length !== 1 ||
			options.has("--page") !== options.has("--block")
		)
			invalid();
		if (options.has("--rendered") && (args[2] !== "setText" || !options.has("--at"))) invalid();
		const expected = options.get("--expect-revision");
		if (expected !== undefined && !/^[a-f0-9]{64}$/u.test(expected)) invalid();
		const root = resolve(args[1]);
		const { readBlockInventory, selectPageBlocks, PageSelectionRefusal } = await import(
			"./operations/block-inspection"
		);
		const { OperationService } = await import("./operations/operation-service");
		const inventory = await readBlockInventory(root);
		const service = new OperationService(root);
		const fields =
			args[2] === "setText" &&
			options.has("--at") &&
			(options.has("--rendered") ||
				!inventory.blocks.some((block) => block.nodeId === options.get("--at")))
				? inventory.textFields.filter((field) => field.nodeId === options.get("--at"))
				: [];
		if (fields.length > 1) throw new EditRefusal("ambiguous");
		const field = fields[0];
		if (options.has("--rendered") && !field) throw new EditRefusal("orphaned");
		let result:
			| Awaited<ReturnType<OperationService["resolve"]>>
			| Awaited<ReturnType<OperationService["apply"]>>;
		const summary = messages[language].applied.replace("{operation}", args[2]);
		if (field) {
			if (!expected || Object.keys(values).some((key) => !["field", "text"].includes(key)))
				invalid();
			const request = {
				transactionId: randomUUID(),
				operation: "setText",
				file: field.file,
				nodeId: field.nodeId,
				baseRevision: expected,
				expectedText: field.text,
				field: values.field,
				text: values.text,
			};
			result = dryRun
				? await service.canvasTextResolve(request)
				: await service.canvasTextApply(request);
		} else {
			let candidates = inventory.blocks;
			if (options.has("--at"))
				candidates = candidates.filter(
					(b) => b.address === options.get("--at") || b.nodeId === options.get("--at"),
				);
			if (options.has("--find")) {
				const text = options.get("--find") ?? "";
				if (!text) invalid();
				candidates = candidates.filter((b) => b.kind !== "page" && b.source.includes(text));
			}
			if (options.has("--line")) {
				const match = /^(.+):(\d+)(?:-(\d+))?$/u.exec(options.get("--line") ?? "");
				if (!match) invalid();
				const start = Number(match[2]);
				const end = Number(match[3] ?? match[2]);
				if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)
					invalid();
				candidates = candidates.filter(
					(b) => b.file === match[1] && b.startLine <= start && b.endLine >= end,
				);
				// A copied block's range belongs to the deepest containing source node.
				const depth = Math.max(...candidates.map((b) => b.path.length));
				candidates = candidates.filter((b) => b.path.length === depth);
			}
			if (options.has("--page")) {
				const page = options.get("--page") ?? "";
				const block = options.get("--block") ?? "";
				if (!/^[1-9]\d*$/u.test(block) || !Number.isSafeInteger(Number(block))) invalid();
				try {
					candidates = selectPageBlocks(inventory, page, Number(block));
				} catch (error) {
					if (error instanceof PageSelectionRefusal) throw new EditRefusal(error.code, error);
					throw error;
				}
			}
			if (!candidates.length) throw new EditRefusal("orphaned");
			if (candidates.length !== 1) throw new EditRefusal("ambiguous");
			const selected = candidates[0];
			const request = {
				transactionId: randomUUID(),
				operation: args[2],
				files: inventory.files,
				targets: [selected.target],
				args: values,
			};
			result = dryRun
				? await service.resolve(request, {
						expectedRevision: expected
							? { path: selected.file, baseRevision: expected }
							: undefined,
					})
				: await service.apply(request, {
						expectedRevision: expected
							? { path: selected.file, baseRevision: expected }
							: undefined,
					});
		}
		if (!result.ok) throw new EditRefusal(result.code);
		const output = {
			schema: 1,
			ok: true,
			dryRun,
			operation: args[2],
			files: result.files,
			intent: result.intent,
			mapping: result.mapping,
			summary: result.summary,
			diagnostics: result.diagnostics,
			focus: result.focus,
		};
		return {
			exitCode: editExitCodes.ok,
			stdout: json
				? `${JSON.stringify(output)}\n`
				: `${dryRun ? messages[language].dryRun : summary}\n`,
			stderr:
				"writeResult" in result &&
				typeof result.writeResult === "object" &&
				result.writeResult !== null &&
				"cleanupError" in result.writeResult &&
				result.writeResult.cleanupError
					? `${messages[language].cleanup}\n`
					: "",
		};
	} catch (error) {
		return failure(error, language, json);
	}
}

function failure(
	error: unknown,
	language: Language,
	json: boolean,
	invalidMessage?: string,
): CliExecution {
	const code = error instanceof EditRefusal ? error.code : "failed";
	const pageSelection = error instanceof EditRefusal ? error.pageSelection : undefined;
	const message = pageSelection
		? messages[language][pageSelection.key].replace(/\{(\w+)\}/gu, (match, key) =>
				String(pageSelection.params[key] ?? match),
			)
		: code === "invalid-args" && invalidMessage
			? invalidMessage
			: editRefusalCatalogue[code][language];
	const exitCode = editExitCodes[code];
	const candidates = pageSelection?.candidates;
	const details =
		code === "failed"
			? {
					reason:
						projectIdentityRecoveryAdvice(error, language) ??
						(error instanceof Error ? error.message : String(error)),
				}
			: undefined;
	return {
		exitCode,
		stdout: json
			? `${JSON.stringify({ schema: 1, ok: false, code, message, ...(candidates ? { candidates } : {}), ...(details ? { details } : {}) })}\n`
			: "",
		stderr: json ? "" : `${message}\n${details ? `${details.reason}\n` : ""}`,
	};
}
