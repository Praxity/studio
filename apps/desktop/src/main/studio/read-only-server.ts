import { randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { CanvasPageScope } from "../../shared/editor-session";
import { createCourseArtifactHost } from "../course-artifact-host";
import { getMimeType, serveCourseFile, serveOpenedFile } from "../course-file-response";
import type { CanvasPreviewDescriptor, HostedCourseDeployment } from "../course-preview-service";
import { resolveExistingPathWithin } from "../path-security";
import { openProjectAsset } from "../project-assets";
import { withProjectFileTransaction } from "../project-file-transactions";
import { ownHttpResponse, ResponseStreamOwner, sendResponse } from "../response-stream";
import { addStudioReadModeLink } from "./author-document";
import { createReviewHttp } from "./review-http";
import type { ReviewStore } from "./review-store";

const ASSET_CSP =
	"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export class ReviewAssetsError extends Error {
	constructor(
		readonly filename: string,
		cause: unknown,
	) {
		super(filename, { cause });
	}
}

function capabilityMatches(supplied: string, expected: string) {
	return (
		Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
		timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
	);
}

/** Only media and captured compiled manifests live here. No editor API or project mount. */
export async function startStudioReadOnlyServer(options: {
	projectDir: string;
	getEditorOrigin: () => string;
	getInspectionScript?: () => Promise<string>;
	getCanvasHead?: () => CanvasPreviewDescriptor | undefined;
	review?: {
		store: ReviewStore;
		capability: string;
		assetsDir?: string;
		preferredPort?: number;
		onPortFallback?: () => void;
	};
}) {
	const review =
		options.review && createReviewHttp(options.review.store, options.review.capability);
	// API-only callers need no browser assets. The CLI always supplies the shipped directory.
	const reviewAssets = options.review?.assetsDir;
	if (reviewAssets !== undefined) {
		for (const name of ["review-comments.js", "review-comments.css"]) {
			try {
				const file = await stat(path.join(reviewAssets, name));
				if (!file.isFile() || file.size === 0) throw new Error("Invalid asset");
			} catch (cause) {
				throw new ReviewAssetsError(name, cause);
			}
		}
	}
	const mediaToken = randomBytes(32).toString("base64url");
	const previewToken = randomBytes(32).toString("base64url");
	const downloads = new Map<string, { filePath: string; filename: string; byteLength: number }>();
	let origin = "";
	let draftOriginChanged = false;
	let closing = false;
	const pending = new Set<Promise<void>>();
	const streams = new ResponseStreamOwner();
	type CanvasRevision = Pick<HostedCourseDeployment, "editorSeq" | "sourceRevisions"> & {
		pages: HostedCourseDeployment["manifest"]["pages"];
	};
	const pageIdentities = new Map<string, CanvasRevision>();
	const host = createCourseArtifactHost({
		entryBaseUrl: (token, revision) => `${origin}/preview/${previewToken}/${token}/r/${revision}/`,
		resolveIdentity(url) {
			if (url.origin !== origin || url.username || url.password) return null;
			let parts: string[];
			try {
				parts = decodeURIComponent(url.pathname).split("/");
			} catch {
				return { status: 400 };
			}
			const [, kind, capability, courseToken, marker, revision, ...files] = parts;
			if (
				kind !== "preview" ||
				!capabilityMatches(capability ?? "", previewToken) ||
				!/^[a-f0-9]{32}$/.test(courseToken ?? "") ||
				marker !== "r" ||
				!/^[a-f0-9]{64}$/.test(revision ?? "")
			)
				return null;
			return { courseToken, revision, relativePath: files.join("/") };
		},
	});
	const headers = () => ({
		"Content-Security-Policy": ASSET_CSP,
		"Referrer-Policy": "no-referrer",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	async function handle(req: IncomingMessage, res: ServerResponse, signal: AbortSignal) {
		for (const [key, value] of Object.entries(headers())) res.setHeader(key, value);
		const fail = (status: number) => {
			res.writeHead(status);
			res.end();
		};
		try {
			if (closing) return fail(503);
			if (review?.isRequest(req.url ?? "")) return await review.handle(req, res, origin, signal);
			// Learner preview shares this origin. Never let it install a worker that can replace inspection responses.
			if (req.headers["service-worker"] !== undefined) return fail(403);
			for (const name of ["host", "origin", "authorization", "range"]) {
				let count = 0;
				for (let i = 0; i < req.rawHeaders.length; i += 2)
					if (req.rawHeaders[i].toLowerCase() === name) count++;
				if (count > 1) return fail(400);
			}
			if (req.headers.host !== new URL(origin).host) return fail(403);
			const editorOrigin = options.getEditorOrigin();
			const url = new URL(req.url ?? "", origin);
			// Relative learner links keep this namespace, including their captured resources.
			const canvas = url.pathname.startsWith("/canvas/preview/");
			const artifactUrl = new URL(url);
			if (canvas) artifactUrl.pathname = url.pathname.slice("/canvas".length);
			if (
				req.headers.origin !== undefined &&
				req.headers.origin !== origin &&
				req.headers.origin !== editorOrigin &&
				!(req.headers.origin === "null" && url.pathname.startsWith("/preview/"))
			)
				return fail(403);
			// Bearer credentials, including the editor capability, have no meaning here.
			if (req.headers.authorization !== undefined) return fail(403);
			if (req.method !== "GET" && req.method !== "HEAD") return fail(405);
			if (url.origin !== origin) return fail(403);
			if (reviewAssets !== undefined && url.pathname.startsWith("/_praxity/review/")) {
				const name = (req.url ?? "").slice("/_praxity/review/".length);
				if (name !== "review-comments.js" && name !== "review-comments.css") return fail(404);
				try {
					const bytes = await readFile(path.join(reviewAssets, name));
					if (!bytes.length) return fail(503);
					res.writeHead(200, {
						"Content-Type": name.endsWith(".js")
							? "text/javascript; charset=utf-8"
							: "text/css; charset=utf-8",
						"Content-Length": bytes.length,
					});
					res.end(req.method === "HEAD" ? undefined : bytes);
				} catch {
					return fail(503);
				}
				return;
			}
			const request = new Request(artifactUrl, {
				method: req.method,
				headers: {
					...(req.headers.range ? { range: req.headers.range } : {}),
					...(req.headers.origin ? { origin: req.headers.origin } : {}),
				},
				signal,
			});
			let response: Response;
			let closeFile: (() => Promise<void>) | undefined;
			if (url.pathname.startsWith("/media/") || url.pathname.startsWith("/download/")) {
				let parts: string[];
				try {
					parts = decodeURIComponent(url.pathname).split("/");
				} catch {
					return fail(400);
				}
				const [, , capability, ...segments] = parts;
				const download = url.pathname.startsWith("/download/")
					? downloads.get(capability ?? "")
					: undefined;
				if (
					url.pathname.startsWith("/download/") &&
					(!download || segments.join("/") !== download.filename)
				)
					return fail(401);
				if (!download && !capabilityMatches(capability ?? "", mediaToken)) return fail(401);
				if (
					!download &&
					(segments[0] !== "assets" ||
						segments.some(
							(part) => !part || part === "." || part === ".." || /[\\\x00-\x1f:]/u.test(part),
						))
				)
					return fail(403);
				// Keep the descriptor, not the mutable path, after admission ends.
				const { file, filePath } = await withProjectFileTransaction(
					options.projectDir,
					async (root) => {
						const assetsRoot = await resolveExistingPathWithin(
							root,
							path.join(root, download ? "exports" : "assets"),
						);
						const filePath = await resolveExistingPathWithin(
							assetsRoot,
							download?.filePath ?? path.join(options.projectDir, ...segments),
						);
						const file = download
							? await open(
									filePath,
									constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
								)
							: await openProjectAsset(root, path.join(root, ...segments));
						closeFile = () => file.close();
						return { file, filePath };
					},
					"read",
				).catch(async (error: unknown) => {
					// Admission can fail during release after the descriptor was opened.
					await closeFile?.();
					throw error;
				});
				try {
					const info = await file.stat();
					if (!info.isFile()) return fail(404);
					if (download && info.size !== download.byteLength) return fail(404);
					// serveOpenedFile now owns cleanup on every outcome.
					closeFile = undefined;
					response = await serveOpenedFile(
						request,
						file,
						{
							byteLength: info.size,
							mediaType: download
								? download.filename.endsWith(".pdf")
									? "application/pdf"
									: "application/zip"
								: path.extname(filePath).toLowerCase() === ".html"
									? "text/html; charset=utf-8"
									: getMimeType(filePath),
							sha256: "",
						},
						"no-store",
						streams,
					);
					// Canvas and binary asset reads get only this exact, read-only origin grant.
					if (!download && req.headers.origin === editorOrigin) {
						res.setHeader("Access-Control-Allow-Origin", editorOrigin);
						res.setHeader("Vary", "Origin");
					}
					if (download)
						res.setHeader(
							"Content-Disposition",
							`attachment; filename="${download.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
						);
					await sendResponse(response, res);
				} finally {
					await closeFile?.();
				}
				return;
			}
			const resolved = host.resolveCourseUrl(artifactUrl.href);
			if ("status" in resolved) {
				const current = canvas && currentCanvasDocument(artifactUrl.pathname);
				if (current) {
					// A released document's bookmark must not override its retained slide fragment.
					if (!url.searchParams.has("praxity-resume")) url.searchParams.set("praxity-resume", "0");
					// Omit a fragment so native navigation carries a deck's current slide.
					res.writeHead(303, { Location: `/canvas${current}${url.search}` });
					res.end();
					return;
				}
				return fail(url.pathname.startsWith("/preview/") ? resolved.status : 404);
			}
			const reviewPage =
				canvas &&
				resolved.file.mediaType.startsWith("text/html") &&
				options.review &&
				reviewAssets !== undefined &&
				url.searchParams.get("praxity-inspect") !== "1"
					? {
							reviewId: options.review.store.reviewId,
							capability: options.review.capability,
							page: canvasPageScope(artifactUrl.pathname),
							pages: resolved.hosted.deployment.manifest.pages.map((page) => ({
								id: page.id,
								title: page.title,
								href: `/canvas${new URL(`${encodeURIComponent(page.slug)}.html`, artifactUrl).pathname}?praxity-resume=0#${encodeURIComponent(page.id)}`,
							})),
							...(draftOriginChanged ? { draftOriginChanged: true } : {}),
						}
					: undefined;
			response = await serveCourseFile(
				// Canvas HTML is transformed as a complete document, including on HEAD.
				canvas && resolved.file.mediaType.startsWith("text/html")
					? new Request(request, { method: "GET", headers: {} })
					: request,
				resolved.file,
				(range) => resolved.hosted.deployment.openFile(resolved.relativePath, range),
				"no-store",
				resolved.hosted.streams,
				options.getInspectionScript,
				// Bound at listen time; requests whose Host or URL names another origin were refused above.
				origin,
			);
			if (canvas && resolved.file.mediaType.startsWith("text/html")) {
				const editUrl = `${editorOrigin}/launch?canvas=${encodeURIComponent(artifactUrl.pathname)}`;
				const captured = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
					await response.arrayBuffer(),
				);
				const html = await addStudioReadModeLink(captured, editUrl, reviewPage);
				response = new Response(req.method === "HEAD" ? null : html, { headers: response.headers });
				response.headers.delete("Content-Length");
				response.headers.delete("ETag");
				response.headers.delete("Accept-Ranges");
			}
			// Author CSS/fonts remain captured learner resources, with only this exact CORS grant.
			if (req.headers.origin === editorOrigin && !resolved.file.mediaType.startsWith("text/html")) {
				response.headers.set("Access-Control-Allow-Origin", editorOrigin);
				response.headers.set("Vary", "Origin");
			}
			if (
				resolved.file.mediaType.startsWith("text/html") ||
				/(?:javascript|css|font\/)/.test(resolved.file.mediaType)
			) {
				const sandbox =
					url.searchParams.get("praxity-inspect") === "1"
						? ""
						: "; sandbox allow-scripts allow-same-origin allow-forms allow-presentation allow-downloads";
				response.headers.set(
					"Content-Security-Policy",
					`${response.headers.get("Content-Security-Policy")}; frame-ancestors ${editorOrigin}${sandbox}`,
				);
			} else response.headers.set("Content-Security-Policy", ASSET_CSP);
			await sendResponse(response, res);
		} catch {
			if (res.headersSent) res.destroy();
			else fail(404);
		}
	}
	const server = createServer(
		{ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 },
		(req, res) => {
			const task = handle(req, res, ownHttpResponse(req, res));
			pending.add(task);
			void task.then(
				() => pending.delete(task),
				(error) => {
					pending.delete(task);
					res.destroy();
					console.error("[studio] Response failed", error);
				},
			);
		},
	);
	server.maxHeadersCount = 0;
	// Reject expectations explicitly so Node cannot send headerless 417 or 100 responses.
	const rejectExpectation = (req: IncomingMessage, res: ServerResponse) => {
		ownHttpResponse(req, res);
		res.writeHead(417, { ...headers(), Connection: "close", "Content-Length": 0 });
		res.end();
	};
	server.on("checkExpectation", rejectExpectation);
	server.on("checkContinue", rejectExpectation);
	server.on("clientError", (error, socket) => {
		if (!socket.writable) return;
		const status = (error as NodeJS.ErrnoException).code === "HPE_HEADER_OVERFLOW" ? 431 : 400;
		socket.end(
			`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n${Object.entries(
				headers(),
			)
				.map(([key, value]) => `${key}: ${value}`)
				.join("\r\n")}\r\n\r\n`,
		);
	});
	server.on("upgrade", (_req, socket) => socket.destroy());
	server.on("connect", (_req, socket) => socket.destroy());
	function listen(port: number) {
		return new Promise<void>((resolve, reject) => {
			const failed = (error: Error) => {
				server.off("listening", ready);
				server.off("error", failed);
				reject(error);
			};
			const ready = () => {
				server.off("error", failed);
				resolve();
			};
			server.once("error", failed);
			server.once("listening", ready);
			try {
				server.listen(port, "127.0.0.1");
			} catch (error) {
				failed(error as Error);
			}
		});
	}
	const preferred = options.review?.preferredPort;
	if (
		preferred !== undefined &&
		(!Number.isInteger(preferred) || preferred < 1 || preferred > 65535)
	)
		draftOriginChanged = true;
	if (preferred === undefined || draftOriginChanged) await listen(0);
	else {
		try {
			await listen(preferred);
		} catch {
			draftOriginChanged = true;
			await listen(0);
		}
	}
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Read-only listener did not bind");
	if (draftOriginChanged) options.review?.onPortFallback?.();
	origin = `http://127.0.0.1:${address.port}`;
	let closePromise: Promise<void> | undefined;
	function resolveCanvasDocument(relativeUrl: string) {
		if (!relativeUrl.startsWith("/preview/") || /[?#]/.test(relativeUrl)) return null;
		if (new URL(relativeUrl, origin).pathname !== relativeUrl) return null;
		const resolved = host.resolveCourseUrl(new URL(relativeUrl, origin).href);
		return "status" in resolved || !resolved.file.mediaType.startsWith("text/html")
			? null
			: resolved;
	}
	function recordedDocument(relativeUrl: string) {
		if (!relativeUrl.startsWith("/preview/") || /[?#]/.test(relativeUrl)) return;
		const url = new URL(relativeUrl, origin);
		if (url.pathname !== relativeUrl) return;
		const key = new URL(".", url).pathname;
		const recorded = pageIdentities.get(key);
		if (!recorded) return;
		const page = recorded.pages.find(
			(page) => `${encodeURIComponent(page.slug)}.html` === url.pathname.slice(key.length),
		);
		if (!page) return;
		pageIdentities.delete(key);
		pageIdentities.set(key, recorded);
		return { ...recorded, page };
	}
	function currentCanvasDocument(relativeUrl: string): string | undefined {
		const previous = recordedDocument(relativeUrl);
		const head = options.getCanvasHead?.();
		if (!previous || !head) return;
		const entry = new URL(head.entryUrl);
		const current = pageIdentities.get(new URL(".", entry).pathname);
		if (!current) return;
		const page =
			current.pages.find((page) => page.id === previous.page.id) ??
			current.pages.find((page) => page.lessonId === previous.page.lessonId) ??
			current.pages[0];
		if (!page) return;
		const target = new URL(`${encodeURIComponent(page.slug)}.html`, entry).pathname;
		return target !== relativeUrl ? target : undefined;
	}
	function canvasPageScope(relativeUrl: string): CanvasPageScope | undefined {
		const resolved = resolveCanvasDocument(relativeUrl);
		const recorded = recordedDocument(relativeUrl);
		const pages = resolved?.hosted.deployment.manifest.pages ?? recorded?.pages;
		const page = resolved
			? pages?.find((page) => `${page.slug}.html` === resolved.relativePath)
			: recorded?.page;
		if (!pages) return;
		if (!page?.lessonId) return;
		return {
			pageId: page.id,
			editorSeq: resolved?.hosted.deployment.editorSeq ?? recorded?.editorSeq,
			lessonId: page.lessonId,
			pageIds: pages
				.filter((candidate) => candidate.lessonId === page.lessonId)
				.map((candidate) => candidate.id),
			sourceRevisions: resolved?.hosted.deployment.sourceRevisions ?? recorded?.sourceRevisions,
			pageIndex: pages.filter((candidate) => candidate.lessonId === page.lessonId).indexOf(page),
			allLessonPages: page.runtime.islands.includes("deck"),
		};
	}
	return {
		origin,
		currentCanvasDocument,
		canvasPageScope,
		hasCanvasDocument(relativeUrl: string): boolean {
			return resolveCanvasDocument(relativeUrl) !== null;
		},
		async readCanvasDocument(relativeUrl: string, signal: AbortSignal): Promise<string | null> {
			const resolved = resolveCanvasDocument(relativeUrl);
			if (!resolved) return null;
			const body = await resolved.hosted.streams.body(
				() => resolved.hosted.deployment.openFile(resolved.relativePath),
				signal,
			);
			return new Response(body).text();
		},
		mediaBaseUrl: `${origin}/media/${mediaToken}/`,
		async hostCourseArtifact(deployment: HostedCourseDeployment) {
			const hosted = await host.hostCourseArtifact(deployment);
			const key = new URL(".", hosted.entryUrl).pathname;
			pageIdentities.delete(key);
			pageIdentities.set(key, {
				pages: structuredClone(deployment.manifest.pages),
				editorSeq: deployment.editorSeq,
				sourceRevisions: deployment.sourceRevisions && { ...deployment.sourceRevisions },
			});
			if (pageIdentities.size > 256) {
				const oldest = pageIdentities.keys().next().value;
				if (oldest !== undefined) pageIdentities.delete(oldest);
			}
			return hosted;
		},
		registerDownload(filePath: string, filename: string, byteLength: number) {
			const capability = randomBytes(32).toString("base64url");
			downloads.set(capability, { filePath, filename, byteLength });
			return `${origin}/download/${capability}/${encodeURIComponent(filename)}`;
		},
		close() {
			closePromise ??= (async () => {
				closing = true;
				pageIdentities.clear();
				downloads.clear();
				const stopped = new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
				server.closeAllConnections();
				const cleaned = (async () => {
					await Promise.allSettled([...pending]);
					try {
						await streams.close();
					} finally {
						await host.dispose();
					}
				})();
				const results = await Promise.allSettled([stopped, cleaned]);
				const errors = results.flatMap((result) =>
					result.status === "rejected" ? [result.reason] : [],
				);
				if (errors.length) throw new AggregateError(errors, "Studio read-only shutdown failed");
			})();
			return closePromise;
		},
	};
}
