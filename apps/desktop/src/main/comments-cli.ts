import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type ListThreadsOptions,
	parseReviewUuid,
	REVIEW_LIMITS,
	type ReviewRefusalCode,
	type ReviewThread,
} from "@praxity/review-share/review";
import type { CliExecution } from "./cli";
import en from "./cli-messages/en.json" with { type: "json" };
import fr from "./cli-messages/fr.json" with { type: "json" };
import { COURSE_MANIFEST_FILENAME } from "./course-manifest-io";
import {
	isLinkedReviewWorktree,
	openReviewStore,
	ReviewStoreError,
	type ReviewStoreErrorCode,
} from "./studio/review-store";

const messages = { en: en.comments, fr: fr.comments };
type Language = keyof typeof messages;

// Keep statuses beside help; codes and JSON keys never depend on language.
export const commentsExitCodes = {
	ok: 0,
	failed: 1,
	"invalid-args": 2,
	stale_version: 3,
	not_found: 4,
	forbidden: 5,
	request_id_reused: 6,
	wrong_review: 7,
	invalid_input: 8,
	snapshot_changed: 9,
	invalid_cursor: 10,
	"text-file-missing": 11,
	"text-file-unreadable": 12,
	"invalid-utf8": 13,
	"empty-text": 14,
	"whitespace-only": 15,
	"text-too-large": 16,
	"lone-surrogate": 17,
	"list-too-large": 18,
	"corrupt-json": 19,
	"invalid-state": 20,
	"newer-schema": 21,
	"unsafe-path": 22,
	"read-only": 23,
	"disk-error": 24,
	"interrupted-write": 25,
	"tracked-storage": 26,
	"not-initialized": 27,
	busy: 28,
	"recovery-required": 29,
	"git-unavailable": 30,
	"filesystem-unsupported": 31,
	"course-not-found": 32,
	"course-not-directory": 33,
	"course-manifest-missing": 34,
	"course-manifest-not-file": 35,
	limit_reached: 36,
} as const satisfies Record<ReviewRefusalCode | ReviewStoreErrorCode, number> &
	Record<string, number>;
type RefusalCode = Exclude<keyof typeof commentsExitCodes, "ok">;
export type CommentsExitCode = (typeof commentsExitCodes)[keyof typeof commentsExitCodes];
export const COMMENTS_LIST_MAX_BYTES = 8 * 1024 * 1024;
const snapshotAttempts = 3;

export const commentsRefusalCatalogue = Object.fromEntries(
	Object.entries(commentsExitCodes)
		.filter(([code]) => code !== "ok")
		.map(([code, exitCode]) => [
			code,
			{ en: messages.en[code as RefusalCode], fr: messages.fr[code as RefusalCode], exitCode },
		]),
);

function languageFromArgs(args: string[]): Language {
	return args[args.indexOf("--lang") + 1] === "fr" ? "fr" : "en";
}
export function commentsHelp(args: string[]): string {
	return `${messages[languageFromArgs(args)].usage}\n${messages[
		languageFromArgs(args)
	].exitCodes.replace(
		"{codes}",
		Object.entries(commentsExitCodes)
			.map(([code, value]) => `${value}=${code}`)
			.join(", "),
	)}`;
}

class CommentsRefusal extends Error {
	constructor(
		readonly code: RefusalCode,
		readonly detail: Record<string, string | number> = {},
	) {
		super(code);
	}
}
function invalid(flag?: string): never {
	throw new CommentsRefusal("invalid-args", flag ? { flag } : {});
}

async function courseDirectory(input: string): Promise<string> {
	let root: string;
	try {
		root = await realpath(resolve(input));
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
			throw new CommentsRefusal("course-not-found");
		throw error;
	}
	if (!(await stat(root)).isDirectory()) throw new CommentsRefusal("course-not-directory");
	try {
		if (!(await lstat(join(root, COURSE_MANIFEST_FILENAME))).isFile())
			throw new CommentsRefusal("course-manifest-not-file");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			throw new CommentsRefusal("course-manifest-missing");
		throw error;
	}
	return root;
}

async function textFile(path: string): Promise<string> {
	try {
		// A FIFO must reach the regular-file check without waiting for a writer.
		const file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
		let bytes: Buffer;
		try {
			if (!(await file.stat()).isFile()) throw new CommentsRefusal("text-file-unreadable");
			// Three UTF-8 bytes per UTF-16 unit bounds the read even if the file grows.
			const buffer = Buffer.alloc(REVIEW_LIMITS.body * 3 + 1);
			let length = 0;
			while (length < buffer.length) {
				const { bytesRead } = await file.read(buffer, length, buffer.length - length);
				if (!bytesRead) break;
				length += bytesRead;
			}
			if (length === buffer.length)
				throw new CommentsRefusal("text-too-large", { limit: REVIEW_LIMITS.body, unit: "utf16" });
			bytes = buffer.subarray(0, length);
		} finally {
			await file.close();
		}
		// UTF-8 cannot encode surrogates. Give these malformed encodings their own refusal.
		if (
			bytes.some(
				(byte, i) =>
					byte === 0xed &&
					bytes[i + 1] >= 0xa0 &&
					bytes[i + 1] <= 0xbf &&
					bytes[i + 2] >= 0x80 &&
					bytes[i + 2] <= 0xbf,
			)
		)
			throw new CommentsRefusal("lone-surrogate");
		let body: string;
		try {
			body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		} catch {
			throw new CommentsRefusal("invalid-utf8");
		}
		if (body.length > REVIEW_LIMITS.body)
			throw new CommentsRefusal("text-too-large", { limit: REVIEW_LIMITS.body, unit: "utf16" });
		if (!body.length) throw new CommentsRefusal("empty-text");
		if (!body.trim()) throw new CommentsRefusal("whitespace-only");
		return body;
	} catch (error) {
		if (error instanceof CommentsRefusal) throw error;
		throw new CommentsRefusal(
			(error as NodeJS.ErrnoException).code === "ENOENT"
				? "text-file-missing"
				: "text-file-unreadable",
		);
	}
}

export async function runCommentsCli(
	args: string[],
	openStore = openReviewStore,
): Promise<CliExecution> {
	const result = await executeCommentsCli(args, openStore);
	if (
		["list", "reply", "resolve", "reopen"].includes(args[1]) &&
		args[2] &&
		(await isLinkedReviewWorktree(resolve(args[2])))
	) {
		const catalogue = languageFromArgs(args) === "fr" ? fr : en;
		result.stderr = `${catalogue.reviewWorktreeWarning}\n${result.stderr}`;
	}
	return result;
}

const outputControls =
	/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
function escapeText(value: string): string {
	return value.replace(
		outputControls,
		(char) => `\\u{${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}}`,
	);
}
const jsonShortEscapes: Record<string, string> = {
	"\\b": "0008",
	"\\f": "000C",
	"\\n": "000A",
	"\\r": "000D",
	"\\t": "0009",
};
function outputJson(value: unknown): string {
	// Match complete JSON escapes first so a literal backslash followed by n stays literal.
	return JSON.stringify(value).replace(
		/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu,
		(token) => {
			if (jsonShortEscapes[token]) return `\\u${jsonShortEscapes[token]}`;
			return token.startsWith("\\")
				? token
				: `\\u${token.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
		},
	);
}

async function executeCommentsCli(
	args: string[],
	openStore: typeof openReviewStore,
): Promise<CliExecution> {
	const language = languageFromArgs(args);
	const json = args.includes("--json");
	try {
		const command = args[1];
		if (
			!["list", "reply", "resolve", "reopen"].includes(command) ||
			!args[2] ||
			args[2].startsWith("-")
		)
			invalid();
		const list = command === "list";
		const allowed = [
			"--json",
			"--lang",
			...(list
				? ["--status", "--page"]
				: [
						"--expect-version",
						"--request-id",
						...(command === "reply"
							? ["--text-file"]
							: command === "resolve"
								? ["--reply-file"]
								: []),
					]),
		];
		const options = new Map<string, string>();
		for (let i = list ? 3 : 4; i < args.length; i++) {
			const key = args[i];
			if (!allowed.includes(key)) invalid();
			if (options.has(key)) invalid(key);
			const value = key === "--json" ? "" : args[++i];
			if (value === undefined || value.startsWith("--")) invalid(key);
			options.set(key, value);
		}
		if (options.has("--lang") && !["en", "fr"].includes(options.get("--lang") ?? ""))
			invalid("--lang");
		const status = options.get("--status");
		if (status !== undefined && status !== "open" && status !== "resolved") invalid("--status");
		if (options.has("--page") && !options.get("--page")) invalid("--page");
		let payload: { threadId: string; requestId: string; expectVersion: number } | undefined;
		let textPath: string | undefined;
		if (!list) {
			const requestId = options.get("--request-id") ?? "";
			const version = options.get("--expect-version") ?? "";
			payload = { threadId: args[3], requestId, expectVersion: Number(version) };
			if (!/^[1-9][0-9]*$/u.test(version) || !Number.isSafeInteger(payload.expectVersion))
				invalid("--expect-version");
			if (!parseReviewUuid(requestId).ok) invalid("--request-id");
			if (!parseReviewUuid(payload.threadId).ok) invalid("<threadId>");
			if (command !== "reopen") {
				const flag = command === "reply" ? "--text-file" : "--reply-file";
				textPath = options.get(flag);
				if (!textPath) invalid(flag);
			}
		}
		const root = await courseDirectory(args[2]);
		const body = textPath === undefined ? undefined : await textFile(textPath);
		const store = await openStore(root, undefined, { createIfMissing: false });
		const principal = await store.principalFor("author", "local-cli");
		if (list) {
			const filters: ListThreadsOptions = {
				status,
				pageId: options.get("--page"),
				limit: REVIEW_LIMITS.listLimit,
			};
			for (let attempt = 0; attempt < snapshotAttempts; attempt++) {
				const threads: ReviewThread[] = [];
				let cursor: string | undefined;
				let bytes = 0;
				do {
					const page = await store.list(principal, { ...filters, cursor });
					if ("ok" in page) {
						if (page.code === "snapshot_changed" || (page.code === "invalid_cursor" && cursor))
							break;
						throw new CommentsRefusal(page.code, page.detail);
					}
					for (const thread of page.threads) {
						bytes += Buffer.byteLength(outputJson(thread)) + (threads.length ? 1 : 0);
						threads.push(thread);
					}
					const output = {
						schema: 1,
						ok: true,
						reviewId: page.reviewId,
						changeSeq: page.changeSeq,
						threads,
					};
					const overhead = Buffer.byteLength(outputJson({ ...output, threads: [] }));
					if (bytes + overhead > COMMENTS_LIST_MAX_BYTES)
						throw new CommentsRefusal("list-too-large", {
							limit: COMMENTS_LIST_MAX_BYTES,
							unit: "utf8-bytes",
						});
					cursor = page.nextCursor ?? undefined;
					if (!cursor)
						return {
							exitCode: 0,
							stdout: json
								? `${outputJson(output)}\n`
								: `${messages[language].listed.replace("{count}", String(threads.length))}\n${threads.map((thread) => threadLine(thread, language)).join("")}`,
							stderr: "",
						};
				} while (cursor);
			}
			throw new CommentsRefusal("snapshot_changed", { attempts: snapshotAttempts });
		}
		const request = {
			...payload,
			reviewId: store.reviewId,
			...(body === undefined ? {} : { body }),
		};
		const result =
			command === "reply"
				? await store.reply(principal, request)
				: command === "resolve"
					? await store.resolve(principal, request)
					: await store.reopen(principal, request);
		if (!result.ok) throw new CommentsRefusal(result.code, result.detail);
		const output = {
			schema: 1,
			ok: true,
			reviewId: store.reviewId,
			thread: result.thread,
			receipt: result.receipt,
			replayed: result.replayed,
			...(result.cleanupError ? { cleanupPending: true } : {}),
		};
		return {
			exitCode: 0,
			stdout: json
				? `${outputJson(output)}\n`
				: `${result.thread ? threadLine(result.thread, language) : `${messages[language].hiddenThread}\n`}${result.replayed ? `${messages[language].replayed}\n` : ""}`,
			stderr: !json && result.cleanupError ? `${messages[language].cleanupPending}\n` : "",
		};
	} catch (error) {
		const code =
			error instanceof CommentsRefusal || error instanceof ReviewStoreError ? error.code : "failed";
		if (args[1] === "list" && code === "not-initialized")
			return {
				exitCode: 0,
				stdout: json
					? `${outputJson({ schema: 1, ok: true, reviewId: null, changeSeq: 0, threads: [] })}\n`
					: `${messages[language].listed.replace("{count}", "0")}\n`,
				stderr: "",
			};
		// Never render raw filesystem errors, paths, causes or request arguments.
		const detail: Record<string, string | number> =
			error instanceof CommentsRefusal
				? error.detail
				: error instanceof ReviewStoreError && error.reason === "unfinished-init"
					? { reason: error.reason }
					: {};
		let message = commentsRefusalCatalogue[code][language].replace(
			"{limit}",
			String(detail.limit ?? ""),
		);
		if (code === "recovery-required" && detail.reason === "unfinished-init")
			message = messages[language].unfinishedInit;
		if (code === "invalid-args" && detail.flag) {
			message = messages[language].invalidFlag.replace("{flag}", escapeText(String(detail.flag)));
			if (detail.flag === "--request-id" || detail.flag === "<threadId>")
				message += ` ${messages[language].lowercaseUuid}`;
		}
		return {
			exitCode: commentsExitCodes[code],
			stdout: json ? `${outputJson({ schema: 1, ok: false, code, detail })}\n` : "",
			stderr: json ? "" : `${message}\n`,
		};
	}
}

function threadLine(thread: ReviewThread, language: Language): string {
	return `${messages[language].thread.replace("{threadId}", escapeText(thread.id)).replace("{status}", messages[language][thread.status]).replace("{version}", String(thread.version))}\n`;
}
