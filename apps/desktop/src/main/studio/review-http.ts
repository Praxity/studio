import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	type ListThreadsOptions,
	parseCommandPayload,
	REVIEW_LIMITS,
	type ReviewRefusal,
} from "@praxity/review-share/review";
import { type ReviewStore, ReviewStoreError } from "./review-store";

export const refusalStatuses: Record<ReviewRefusal["code"], number> = {
	invalid_input: 422,
	forbidden: 403,
	wrong_review: 404,
	not_found: 404,
	stale_version: 409,
	request_id_reused: 409,
	snapshot_changed: 409,
	invalid_cursor: 400,
	limit_reached: 409,
};

class AdmissionError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}
function refuse(status: number, code: string): never {
	throw new AdmissionError(status, code);
}
function json(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		const cleanup = () => {
			req.off("data", data);
			req.off("end", end);
			req.off("aborted", aborted);
			req.off("error", aborted);
			signal.removeEventListener("abort", aborted);
		};
		const aborted = () => {
			cleanup();
			reject(new AdmissionError(400, "invalid_body"));
		};
		const data = (chunk: Buffer) => {
			size += chunk.length;
			if (size > REVIEW_LIMITS.requestBodyBytes) {
				cleanup();
				req.pause();
				// The refusal closes the connection, without consuming an unbounded remainder.
				reject(new AdmissionError(413, "body_too_large"));
			} else chunks.push(chunk);
		};
		const end = () => {
			cleanup();
			try {
				resolve(
					JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
				);
			} catch {
				reject(new AdmissionError(400, "invalid_json"));
			}
		};
		if (req.destroyed || req.readableAborted || signal.aborted) return aborted();
		req.on("data", data);
		req.on("end", end);
		req.on("aborted", aborted);
		req.on("error", aborted);
		signal.addEventListener("abort", aborted, { once: true });
	});
}

/** The host mints a fresh random credential for each listener; never persist it. */
export function createReviewHttp(store: ReviewStore, capability: string) {
	if (
		typeof capability !== "string" ||
		!/^[A-Za-z0-9_-]+$/.test(capability) ||
		Buffer.from(capability, "base64url").byteLength < 32 ||
		Buffer.from(capability, "base64url").toString("base64url") !== capability
	)
		throw new Error(
			"Review capability must encode at least 32 random bytes as canonical base64url",
		);
	const expected = Buffer.from(capability);
	return {
		isRequest(target: string) {
			// Inspect raw and normalized paths so dot segments cannot escape admission.
			if (target.startsWith("/api/reviews")) return true;
			try {
				return new URL(target, "http://review.invalid").pathname.startsWith("/api/reviews");
			} catch {
				return false;
			}
		},
		async handle(req: IncomingMessage, res: ServerResponse, origin: string, signal: AbortSignal) {
			const sendRefusal = (result: ReviewRefusal) =>
				json(res, refusalStatuses[result.code], result);
			try {
				for (const name of [
					"host",
					"origin",
					"authorization",
					"content-type",
					"x-praxity-review",
					"range",
				]) {
					let count = 0;
					for (let index = 0; index < req.rawHeaders.length; index += 2)
						if (req.rawHeaders[index].toLowerCase() === name) count++;
					if (count > 1) refuse(400, "duplicate_header");
				}
				if (req.headers.host !== new URL(origin).host) refuse(403, "forbidden");
				if (req.headers.authorization !== undefined) refuse(403, "forbidden");
				const supplied = req.headers["x-praxity-review"];
				if (typeof supplied !== "string") refuse(401, "unauthorized");
				const bytes = Buffer.from(supplied);
				if (bytes.length !== expected.length || !timingSafeEqual(bytes, expected))
					refuse(401, "unauthorized");
				if (req.headers["service-worker"] !== undefined) refuse(403, "forbidden");
				if (
					req.method === "POST"
						? req.headers.origin !== origin
						: req.headers.origin !== undefined && req.headers.origin !== origin
				)
					refuse(403, "forbidden");
				if (
					req.method === "POST" &&
					(typeof req.headers["content-type"] !== "string" ||
						!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"]))
				)
					refuse(415, "unsupported_media_type");
				if (
					req.headers["sec-fetch-site"] !== undefined &&
					req.headers["sec-fetch-site"] !== "same-origin"
				)
					refuse(403, "forbidden");
				if (req.headers["content-encoding"] !== undefined) refuse(415, "unsupported_media_type");
				const target = req.url ?? "";
				const rawPath = target.split("?")[0];
				// Canonical UUIDs and literal separators only; never decode or normalize route identity.
				const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
				const route = new RegExp(
					`^/api/reviews/(${uuid})/comments(?:/(${uuid})/(reply|reopen))?$`,
				).exec(rawPath);
				if (!route || route[1] !== store.reviewId) refuse(404, "not_found");
				if (req.method !== "POST" && (req.method !== "GET" || route[2])) refuse(405, "http_method");
				const url = new URL(target, origin);
				const principal = await store.principalFor("reviewer", "local-preview");
				if (req.method === "GET") {
					const options: ListThreadsOptions = {};
					const seen = new Set<string>();
					for (const [key, value] of url.searchParams) {
						if (seen.has(key)) refuse(422, "invalid_input");
						seen.add(key);
						switch (key) {
							case "page":
								options.pageId = value;
								break;
							case "status":
								if (value !== "open" && value !== "resolved") refuse(422, "invalid_input");
								options.status = value;
								break;
							case "cursor":
								options.cursor = value;
								break;
							case "limit":
								if (!/^[1-9][0-9]*$/.test(value)) refuse(422, "invalid_input");
								options.limit = Number(value);
								break;
							default:
								refuse(422, "invalid_input");
						}
					}
					const result = await store.list(principal, options);
					if ("ok" in result) return sendRefusal(result);
					return json(res, 200, {
						ok: true,
						...result,
						principal: { id: principal.id, role: principal.role },
					});
				}
				if (url.search) refuse(422, "invalid_input");
				const kind = route[3] === "reply" ? "reply" : route[3] === "reopen" ? "reopen" : "create";
				// Admit the envelope here; the store checks new text or verifies a historical receipt.
				const parsed = parseCommandPayload(kind, await readBody(req, signal), true);
				if (!parsed.ok) return sendRefusal(parsed);
				if (parsed.value.reviewId !== store.reviewId) refuse(404, "not_found");
				if ("threadId" in parsed.value && parsed.value.threadId !== route[2])
					refuse(422, "invalid_input");
				const result = await store[kind](principal, parsed.value);
				if (!result.ok) return sendRefusal(result);
				const { thread, receipt, replayed } = result;
				if (!thread) refuse(404, "not_found");
				json(res, 200, { ok: true, thread, receipt, replayed });
			} catch (error) {
				if (signal.aborted || res.destroyed) return;
				res.setHeader("Connection", "close");
				const code: string =
					error instanceof AdmissionError || error instanceof ReviewStoreError
						? error.code
						: "store_failure";
				let status = error instanceof AdmissionError ? error.status : 500;
				if (code === "busy") {
					status = 503;
					res.setHeader("Retry-After", "1");
				}
				json(res, status, { ok: false, code, detail: {} });
			}
		},
	};
}
