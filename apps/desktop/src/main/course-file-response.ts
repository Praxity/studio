import { randomBytes } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { extname } from "node:path";
import type { Readable } from "node:stream";
import type { CourseArtifactByteRange, CourseArtifactFile } from "@praxity/export-pipeline";
import { EMBED_FRAME_CSP_SOURCES } from "@praxity/shared-blocks/embed-url-utils";
import { stripInspectionMarkup } from "@praxity/shared-blocks/inspection-markup";
import { ResponseStreamOwner } from "./response-stream";

/**
 * `self` replaces every `'self'` source. CourseArtifactFrame's iframe sandbox makes the inspection
 * origin opaque from creation, and WebKit then matches `'self'` against nothing, refusing course
 * CSS, fonts, images and media. The server's own origin grants exactly what `'self'` grants an
 * unsandboxed document. Electron keeps `'self'`: its Chromium matches it against the URL's origin.
 */
function courseCsp(nonce?: string, self = "'self'") {
	return [
		`default-src ${self}`,
		nonce ? `script-src 'nonce-${nonce}'` : "script-src 'self'",
		"script-src-attr 'none'",
		`style-src ${self} 'unsafe-inline'`,
		`img-src ${self} https: data:`,
		`media-src ${self} https: data:`,
		`font-src ${self} data:`,
		`connect-src ${self}`,
		`frame-src ${EMBED_FRAME_CSP_SOURCES.join(" ")}`,
		"object-src 'none'",
		"base-uri 'none'",
		// Nonces are readable by same-origin documents. Every inspection response
		// must isolate its document, including direct navigation and popups.
		...(nonce ? ["sandbox allow-scripts"] : []),
	].join("; ");
}

export const COURSE_CSP = courseCsp();

/** Inspection transforms captured bytes only. Learner serving retains its validators and ranges. */
export async function serveCourseFile(
	request: Request,
	file: Pick<CourseArtifactFile, "byteLength" | "mediaType" | "sha256">,
	open: (range?: CourseArtifactByteRange) => Promise<Readable> | Readable,
	cacheControl: string,
	streams: ResponseStreamOwner,
	getInspectionScript?: () => Promise<string>,
	/** The server's bound origin, never one read from the request. Inspection names it for `'self'`. */
	inspectionOrigin?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const inspection = url.searchParams.get("praxity-inspect") === "1";
	const nonce = inspection ? randomBytes(32).toString("base64") : undefined;
	const csp = courseCsp(nonce, inspection ? inspectionOrigin : undefined);
	if (!inspection || !file.mediaType.startsWith("text/html")) {
		const response = await serveFile(request, file, open, cacheControl, streams);
		response.headers.set("Content-Security-Policy", csp);
		response.headers.set("Vary", "Origin");
		// Only captured artifact bytes reach this owner. Opaque inspection fonts
		// and other CORS-mode resources need this exact, credential-free grant.
		if (request.headers.get("origin") === "null") {
			response.headers.set("Access-Control-Allow-Origin", "null");
		}
		return response;
	}
	const headers = { "Content-Security-Policy": csp, "Cache-Control": "no-store" };
	if (request.method !== "GET" && request.method !== "HEAD")
		return new Response("Method not allowed", {
			status: 405,
			headers: { ...headers, Allow: "GET, HEAD" },
		});
	if (!getInspectionScript) throw new Error("Inspection bridge is unavailable");
	const script = await getInspectionScript();
	// Learner requests do not load the HTML parser.
	const { JSDOM } = await import("jsdom");
	const body = await streams.body(() => open(), request.signal);
	const html = await new Response(body).text();
	// Use the HTML parser, including SVG and template contents. Parsing never executes course code.
	const dom = new JSDOM(html, { runScripts: "outside-only" });
	try {
		const doc = dom.window.document;
		stripInspectionMarkup(doc);
		const bridge = doc.createElement("script");
		bridge.setAttribute("nonce", nonce ?? "");
		bridge.textContent = script.replace(/<\/script/gi, "<\\/script");
		doc.head.prepend(bridge);
		const output = dom.serialize();
		return new Response(request.method === "HEAD" ? null : output, {
			headers: {
				...headers,
				"Content-Type": file.mediaType,
				"Content-Length": String(Buffer.byteLength(output)),
			},
		});
	} finally {
		dom.window.close();
	}
}

const MIME_TYPES: Record<string, string> = {
	".aac": "audio/aac",
	".avif": "image/avif",
	".flac": "audio/flac",
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".m4a": "audio/mp4",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".ogg": "audio/ogg",
	".ogv": "video/ogg",
	".opus": "audio/ogg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".vtt": "text/vtt; charset=utf-8",
	".wav": "audio/wav",
	".webm": "video/webm",
	".webp": "image/webp",
};

export function getMimeType(filePath: string): string {
	return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function parseRange(
	rangeHeader: string | null,
	size: number,
): CourseArtifactByteRange | "invalid" | null {
	if (!rangeHeader) return null;
	if (size === 0) return "invalid";

	const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return "invalid";

	const [, rawStart, rawEnd] = match;
	if (!rawStart && !rawEnd) return "invalid";

	if (!rawStart) {
		const suffixLength = Number(rawEnd);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
		return { start: Math.max(size - suffixLength, 0), end: size - 1 };
	}

	const start = Number(rawStart);
	const end = rawEnd ? Number(rawEnd) : size - 1;
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start < 0 ||
		start >= size ||
		end < start
	) {
		return "invalid";
	}

	return { start, end: Math.min(end, size - 1) };
}

export async function serveFile(
	request: Request,
	file: Pick<CourseArtifactFile, "byteLength" | "mediaType" | "sha256">,
	open: (range?: CourseArtifactByteRange) => Promise<Readable> | Readable,
	cacheControl = "no-cache",
	streams = new ResponseStreamOwner(),
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
	}

	const etag = file.sha256 ? `"${file.sha256}"` : undefined;
	if (
		etag &&
		request.headers
			.get("if-none-match")
			?.split(",")
			.some((candidate) => candidate.trim() === etag || candidate.trim() === "*")
	) {
		return new Response(null, {
			status: 304,
			headers: { "Cache-Control": cacheControl, ETag: etag },
		});
	}

	const range = parseRange(request.headers.get("range"), file.byteLength);
	if (range === "invalid") {
		return new Response(null, {
			status: 416,
			headers: {
				"Accept-Ranges": "bytes",
				"Content-Range": `bytes */${file.byteLength}`,
			},
		});
	}

	const contentLength = range ? range.end - range.start + 1 : file.byteLength;
	const headers: Record<string, string> = {
		"Accept-Ranges": "bytes",
		"Cache-Control": cacheControl,
		"Content-Length": String(contentLength),
		"Content-Type": file.mediaType,
	};
	if (etag) headers.ETag = etag;
	if (range) {
		headers["Content-Range"] = `bytes ${range.start}-${range.end}/${file.byteLength}`;
	}

	const body =
		request.method === "HEAD"
			? null
			: await streams.body(() => open(range ?? undefined), request.signal);
	return new Response(body as BodyInit | null, { status: range ? 206 : 200, headers });
}

/** Transfer an admitted descriptor to the body, or close it if no body is opened. */
export async function serveOpenedFile(
	request: Request,
	file: FileHandle,
	metadata: Pick<CourseArtifactFile, "byteLength" | "mediaType" | "sha256">,
	cacheControl = "no-cache",
	streams = new ResponseStreamOwner(),
): Promise<Response> {
	let transferred = false;
	try {
		return await serveFile(
			request,
			metadata,
			(range) => {
				const stream = file.createReadStream(range);
				transferred = true;
				return stream;
			},
			cacheControl,
			streams,
		);
	} finally {
		// destroy() closes even an autoClose:false FileHandle stream. Giving the
		// stream sole ownership avoids a second close, and closes only after pending IO.
		if (!transferred) await file.close();
	}
}
