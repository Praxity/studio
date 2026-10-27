import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { ZodError, z } from "zod";
import type { CanvasPageScope } from "../../shared/editor-session";
import { studioPortSchema } from "../../shared/ipc-schemas";
import { isDesktopSubPath } from "../../shared/path-utils";
import {
	isProjectBusyError,
	isProjectFileBusyError,
	projectPlainStorePath,
	projectReadErrorKey,
} from "../../shared/project-write-errors";
import { DEFAULT_APP_SETTINGS } from "../../shared/types";
import { CoursePreviewService } from "../course-preview-service";
import { CoursePreviewStateStore } from "../course-preview-state-store";
import { assertPlainIdentityStore } from "../identity-store";
import { assertAllowedProjectRoot, readFileWithin } from "../path-security";
import {
	assertProjectWritesAllowed,
	withProjectFileTransaction,
} from "../project-file-transactions";
import { ownHttpResponse } from "../response-stream";
import { serveStudioAuthorDocument } from "./author-document";
import { renderIdentityReview } from "./identity-review";
import { createStudioProjectSession, StudioSessionError } from "./project-session";
import { startStudioReadOnlyServer } from "./read-only-server";
import { prepareStudioTemporaryOutputs } from "./temporary-outputs";

// Replaced with a build-owned literal in the standalone CLI; never read from the environment.
declare const __PRAXITY_CANVAS_SHA256__: string;

const MAX_BODY_BYTES = 10_500_000;
const MAX_QUEUED_EVENT_BYTES = 20_000_000;
// Avoid Rubato's reserved 41700-41999 ports and their +1000 learner ports.
const DEFAULT_PORT_START = 45000;
const DEFAULT_PORT_COUNT = 1000;
const RPC_ENVELOPE = z.object({ method: z.string().min(1).max(80), args: z.unknown() }).strict();
const STUDIO_IDENTITY = z
	.object({
		service: z.literal("praxity-studio"),
		projectDir: z
			.string()
			.min(1)
			.max(4096)
			.refine((value) => path.isAbsolute(value))
			// Escape untrusted terminal controls before this value can enter any message.
			.transform((value) =>
				value.replace(
					/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu,
					(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
				),
			),
	})
	.strict();

export interface StudioServerOptions {
	projectDir: string;
	appVersion: string;
	editorAssetsDir: string;
	port?: number;
	onPortFallback?: () => void;
	exportAssetsDir?: string;
	typstExecutablePath?: string;
	review?: Parameters<typeof startStudioReadOnlyServer>[0]["review"];
}

export interface StudioServer {
	readonly origin: string;
	readonly readyUrl: string;
	close(): Promise<void>;
}

class RequestError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

function json(res: ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

function reject(status: number, code: string, message: string): never {
	throw new RequestError(status, code, message);
}

// An occupied port is untrusted. Never follow redirects or let its response stall startup.
function identifyStudio(port: number): Promise<string | null> {
	return new Promise((resolve) => {
		let finished = false;
		let response: IncomingMessage | undefined;
		const chunks: Buffer[] = [];
		const finish = (projectDir: string | null) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			chunks.length = 0;
			// Close without injecting an error into a socket that Node may have detached.
			response?.destroy();
			req.destroy();
			resolve(projectDir);
		};
		const req = request(`http://127.0.0.1:${port}/api/identity`, { agent: false }, (res) => {
			response = res;
			res.once("error", () => finish(null));
			res.once("aborted", () => finish(null));
			res.once("close", () => finish(null));
			if (finished || res.statusCode !== 200) {
				res.destroy();
				finish(null);
				return;
			}
			let size = 0;
			res.on("data", (chunk: Buffer) => {
				if (finished) return;
				size += chunk.byteLength;
				if (size > 16_384) finish(null);
				else chunks.push(chunk);
			});
			res.once("end", () => {
				if (finished) return;
				try {
					const identity = STUDIO_IDENTITY.safeParse(JSON.parse(Buffer.concat(chunks).toString()));
					finish(identity.success ? identity.data.projectDir : null);
				} catch {
					finish(null);
				}
			});
		});
		// A total deadline also bounds peers that keep sending bytes without ending.
		const timer = setTimeout(() => finish(null), 1000);
		req.once("error", () => finish(null));
		req.once("close", () => finish(null));
		req.once("socket", (socket) => socket.once("error", () => finish(null)));
		req.end();
	});
}

async function readBody(req: IncomingMessage): Promise<unknown> {
	if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "")) {
		reject(415, "media_type", "Use application/json");
	}
	if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
		reject(415, "content_encoding", "Encoded bodies are not accepted");
	}
	if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
		reject(413, "body_too_large", "Request body is too large");
	}
	const body = await new Promise<Buffer>((resolve, rejectBody) => {
		let size = 0;
		let oversized = false;
		const chunks: Buffer[] = [];
		const cleanup = () => {
			req.removeListener("data", data);
			req.removeListener("end", end);
			req.removeListener("error", fail);
			req.removeListener("aborted", abort);
		};
		const fail = (error: Error) => {
			cleanup();
			rejectBody(error);
		};
		const abort = () =>
			fail(new RequestError(400, "request_aborted", "Request body was interrupted"));
		const data = (chunk: Buffer) => {
			size += chunk.byteLength;
			if (size > MAX_BODY_BYTES) {
				oversized = true;
				chunks.length = 0;
			} else chunks.push(chunk);
		};
		const end = () => {
			cleanup();
			// Drain oversized chunked uploads without retaining them. Closing while the
			// client is still sending can reset its socket before it receives the 413.
			if (oversized)
				rejectBody(new RequestError(413, "body_too_large", "Request body is too large"));
			else resolve(Buffer.concat(chunks));
		};
		req.on("data", data).once("end", end).once("error", fail).once("aborted", abort);
	});
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
	} catch {
		reject(400, "invalid_json", "Request must contain valid UTF-8 JSON");
	}
}

// Capture only trusted build output. Project files never participate in editor routing.
async function uiFiles(editorAssetsDir: string) {
	let root: string;
	try {
		root = await realpath(editorAssetsDir);
		if (!(await stat(root)).isDirectory()) throw new Error("Missing canvas directory");
	} catch (cause) {
		throw new Error("Browser editor assets are unavailable. Rebuild the standalone CLI.", {
			cause,
		});
	}
	return { root };
}

export function defaultStudioPort(canonicalRoot: string): number {
	return (
		DEFAULT_PORT_START +
		(createHash("sha256").update(canonicalRoot).digest().readUInt32BE(0) % DEFAULT_PORT_COUNT)
	);
}

export async function startStudioServer(options: StudioServerOptions): Promise<StudioServer> {
	assertProjectWritesAllowed();
	const explicitPort =
		options.port === undefined ? undefined : studioPortSchema.parse(options.port);
	const projectRoot = await assertAllowedProjectRoot(options.projectDir);
	const ui = await uiFiles(options.editorAssetsDir);
	const canonical = (root: string) => (process.platform === "win32" ? root.toLowerCase() : root);
	const port = explicitPort ?? defaultStudioPort(canonical(projectRoot));
	if (
		isDesktopSubPath(canonical(projectRoot), canonical(ui.root)) ||
		isDesktopSubPath(canonical(ui.root), canonical(projectRoot))
	) {
		throw new Error("Editor assets and project files must have separate roots");
	}
	let canvasScript: string;
	try {
		const bytes = await readFileWithin(ui.root, path.join(ui.root, "canvas.js"));
		const expectedDigest =
			typeof __PRAXITY_CANVAS_SHA256__ === "undefined"
				? String(await readFileWithin(ui.root, path.join(ui.root, "canvas.sha256"), "utf8")).trim()
				: __PRAXITY_CANVAS_SHA256__;
		if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest)
			throw new Error("Canvas SHA-256 mismatch");
		canvasScript = String(bytes);
		if (!canvasScript.trim()) throw new Error("Empty canvas.js");
	} catch (cause) {
		throw new Error("Canvas assets are unavailable. Rebuild the standalone CLI.", { cause });
	}
	// Claim the port before identity persistence, preview compilation and watcher startup.
	const server = createServer({
		maxHeaderSize: 16_384,
		requestTimeout: 15_000,
		headersTimeout: 10_000,
	});
	const refuseDuringStartup = (socket: Socket) => socket.destroy();
	server.on("connection", refuseDuringStartup);
	function listen(port: number) {
		return new Promise<void>((resolve, rejectListen) => {
			const failed = (error: Error) => {
				server.off("listening", ready);
				rejectListen(error);
			};
			const ready = () => {
				server.off("error", failed);
				resolve();
			};
			server.once("error", failed);
			server.once("listening", ready);
			server.listen(port, "127.0.0.1");
		});
	}
	try {
		await listen(port);
	} catch (error) {
		if (explicitPort === undefined) {
			await listen(0);
			options.onPortFallback?.();
		} else {
			if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
			const holder = await identifyStudio(port);
			throw new Error(
				holder
					? `Port ${port} is already used by Studio for course "${holder}". Stop that Studio or choose another --port.`
					: `Port ${port} is already used by another program. Stop it or choose another --port.`,
				{ cause: error },
			);
		}
	}
	try {
		let origin = "";
		let preview: CoursePreviewService | undefined;
		// Refuse linked lineage before temporary-output setup can touch the sidecar.
		await withProjectFileTransaction(projectRoot, assertPlainIdentityStore, "write", false);
		const readOnly = await startStudioReadOnlyServer({
			projectDir: projectRoot,
			preferredPort: explicitPort === undefined || options.review ? port + 1000 : undefined,
			review: options.review,
			getEditorOrigin: () => origin,
			getCanvasHead: () => preview?.canvasHead(),
			getInspectionScript: options.exportAssetsDir
				? () => readFile(path.join(options.exportAssetsDir ?? "", "inspection-frame.js"), "utf8")
				: undefined,
		});
		const values = new Map<string, string>();
		const exportAssetsDir = options.exportAssetsDir;
		let temporary: Awaited<ReturnType<typeof prepareStudioTemporaryOutputs>> | undefined;
		try {
			if (exportAssetsDir) temporary = await prepareStudioTemporaryOutputs(projectRoot);
		} catch (error) {
			await readOnly.close();
			throw error;
		}
		preview = exportAssetsDir
			? new CoursePreviewService({
					getProjectDir: () => projectRoot,
					getExportAssetsDir: () => exportAssetsDir,
					getWorkspacePath: () => null,
					getFallbackCompletionThreshold: () => DEFAULT_APP_SETTINGS.defaultCompletionThreshold,
					inheritWorkspaceSettings: false,
					manifestPolicy: "read-only",
					temporaryRoot: temporary?.directory,
					stateStore: new CoursePreviewStateStore({
						get: (key) => values.get(key),
						set: (key, value) => {
							values.set(key, value);
						},
					}),
					hostCourseArtifact: readOnly.hostCourseArtifact,
				})
			: undefined;
		let session: Awaited<ReturnType<typeof createStudioProjectSession>>;
		try {
			session = await createStudioProjectSession(
				options.projectDir,
				options.appVersion,
				preview,
				exportAssetsDir
					? {
							projectDir: projectRoot,
							exportAssetsDir,
							temporaryRoot: temporary?.directory,
							recordOutputStage: temporary?.recordOutputStage,
							typstExecutablePath: options.typstExecutablePath,
							registerDownload: readOnly.registerDownload,
						}
					: undefined,
			);
		} catch (error) {
			try {
				await readOnly.close();
			} finally {
				await temporary?.dispose();
			}
			throw error;
		}
		const token = randomBytes(32).toString("base64url");
		const streams = new Set<ServerResponse>();
		const pending = new Set<Promise<void>>();
		let closing = false;
		const canvasAdmissions = new Map<string, { read: boolean; expires: number }>();
		function expireCanvasAdmissions() {
			for (const [route, admission] of canvasAdmissions)
				if (admission.expires <= Date.now()) canvasAdmissions.delete(route);
		}
		let canvasBuilding: Promise<string | undefined> | undefined;
		const csp = [
			"default-src 'none'",
			"script-src 'self'",
			"script-src-attr 'none'",
			"style-src 'self' 'unsafe-inline'",
			`img-src 'self' data: blob: ${readOnly.origin}`,
			"font-src 'self'",
			`connect-src 'self' ${readOnly.origin}`,
			`media-src ${readOnly.origin} blob:`,
			`frame-src ${readOnly.origin}`,
			"object-src 'none'",
			"base-uri 'none'",
			"form-action 'none'",
			"frame-ancestors 'none'",
		].join("; ");
		const privateHeaders = {
			"Content-Security-Policy": csp,
			"Referrer-Policy": "no-referrer",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"Cross-Origin-Opener-Policy": "same-origin",
		};

		function authenticate(req: IncomingMessage) {
			const supplied = req.headers.authorization ?? "";
			const expected = `Bearer ${token}`;
			if (
				Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
				!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
			) {
				reject(401, "unauthorized", "Session capability is required");
			}
		}
		function requireLocalLaunch(req: IncomingMessage) {
			// Isolated Read uses another loopback port; its Edit link is a same-site navigation.
			const sameSiteDocument =
				req.headers["sec-fetch-site"] === "same-site" &&
				req.headers["sec-fetch-mode"] === "navigate" &&
				req.headers["sec-fetch-dest"] === "document";
			if (
				req.headers["sec-fetch-site"] !== undefined &&
				!["none", "same-origin"].includes(String(req.headers["sec-fetch-site"])) &&
				!sameSiteDocument
			)
				reject(403, "origin_forbidden", "Canvas compilation requires a local launch");
		}
		async function serveIdentityGate(req: IncomingMessage, res: ServerResponse) {
			requireLocalLaunch(req);
			const review = await session.identityReview();
			if (!review.retirements.length) return false;
			const page = renderIdentityReview(review, token);
			res.setHeader(
				"Content-Security-Policy",
				csp.replace("script-src 'self'", `script-src 'nonce-${page.nonce}'`),
			);
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(page.html);
			return true;
		}

		async function retryCanvasNavigation(req: IncomingMessage, res: ServerResponse) {
			if (req.method !== "GET" || req.headers["sec-fetch-dest"] !== "document") return false;
			// Stale document links restart admission after the active build settles.
			await canvasBuilding;
			res.writeHead(303, { Location: "/#" });
			res.end();
			return true;
		}

		function redirectCanvasDocument(res: ServerResponse, read: boolean, entry: string) {
			// Issue author fragments only after compilation; Read clears them before changing origin.
			res.writeHead(303, {
				Location: read
					? `${readOnly.origin}/canvas${entry}?praxity-resume=0#`
					: `/launch?canvas=${encodeURIComponent(entry)}`,
			});
			res.end();
		}

		async function handle(req: IncomingMessage, res: ServerResponse, signal: AbortSignal) {
			for (const [name, value] of Object.entries(privateHeaders)) res.setHeader(name, value);
			try {
				if (closing) reject(503, "session_closed", "Studio session is closing");
				for (const name of ["host", "origin", "authorization", "content-type"]) {
					let count = 0;
					for (let i = 0; i < req.rawHeaders.length; i += 2) {
						if (req.rawHeaders[i].toLowerCase() === name) count++;
					}
					if (count > 1) reject(400, "duplicate_header", "Duplicate security header");
				}
				if (req.headers.host !== new URL(origin).host)
					reject(403, "host_forbidden", "Host is not authorized");
				if (req.headers.origin !== undefined && req.headers.origin !== origin)
					reject(403, "origin_forbidden", "Origin is not authorized");
				if (!["GET", "HEAD", "POST"].includes(req.method ?? ""))
					reject(405, "http_method", "HTTP method is not available");
				const route = req.url ?? "";
				if (route === "/") {
					if (req.method !== "GET") reject(405, "http_method", "Launch requires GET");
					// An explicit empty fragment prevents the ready URL's bearer reaching learner HTML.
					res.writeHead(303, { Location: "/launch?canvas=read#" });
					res.end();
					return;
				}
				if (route.startsWith("/launch?canvas=")) {
					if (req.method !== "GET") reject(405, "http_method", "Launch requires GET");
					const encoded = route.slice("/launch?canvas=".length);
					let target = "";
					try {
						target = decodeURIComponent(encoded);
					} catch {
						reject(404, "not_found", "Resource is not available");
					}
					if (
						encodeURIComponent(target) !== encoded ||
						(target !== "1" &&
							target !== "read" &&
							!readOnly.hasCanvasDocument(target) &&
							!readOnly.currentCanvasDocument(target))
					)
						reject(404, "not_found", "Resource is not available");
					const compile = target === "1" || target === "read";
					if (target !== "read" && (await serveIdentityGate(req, res))) return;
					let destination = `/canvas${readOnly.currentCanvasDocument(target) ?? target}#session=${token}`;
					if (compile) {
						expireCanvasAdmissions();
						// Six simultaneous tabs fit without replacing each other's one-use admission.
						if (canvasAdmissions.size >= 8) {
							const oldest = canvasAdmissions.keys().next().value;
							if (oldest !== undefined) canvasAdmissions.delete(oldest);
						}
						destination = `/canvas?admission=${randomBytes(32).toString("base64url")}`;
						canvasAdmissions.set(destination, {
							read: target === "read",
							expires: Date.now() + 30_000,
						});
					}
					res.writeHead(303, {
						Location: destination,
					});
					res.end();
					return;
				}
				if (route === "/launch") {
					if (req.method !== "GET") reject(405, "http_method", "Launch requires GET");
					if (await serveIdentityGate(req, res)) return;
					res.writeHead(303, { Location: "/launch?canvas=1" });
					res.end();
					return;
				}
				if (route === "/api/identity/confirm") {
					if (req.method !== "POST") reject(405, "http_method", "Confirmation requires POST");
					if (req.headers.origin !== origin)
						reject(403, "origin_required", "Confirmation requires the editor Origin");
					authenticate(req);
					const { revision } = z
						.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) })
						.strict()
						.parse(await readBody(req));
					await session.confirmIdentityRetirements(revision);
					res.writeHead(303, { Location: "/launch" });
					res.end();
					return;
				}
				if (route === "/api/identity") {
					if (req.method !== "GET") reject(405, "http_method", "Identity requires GET");
					json(res, 200, { service: "praxity-studio", projectDir: projectRoot });
					return;
				}
				if (route === "/api/rpc") {
					if (req.method !== "POST") reject(405, "http_method", "RPC requires POST");
					if (req.headers.origin !== origin)
						reject(403, "origin_required", "RPC requires the editor Origin");
					authenticate(req);
					const input = RPC_ENVELOPE.parse(await readBody(req));
					let canvasPageScope: CanvasPageScope | undefined;
					if (input.method === "canvasTextSnapshot" || input.method === "canvasTextApply") {
						const documentPath = req.headers["x-praxity-canvas"];
						canvasPageScope =
							typeof documentPath === "string" && documentPath.startsWith("/canvas/")
								? readOnly.canvasPageScope(documentPath.slice("/canvas".length))
								: undefined;
						if (!canvasPageScope)
							reject(403, "canvas_page_required", "Canvas requires an admitted page");
					}
					json(res, 200, {
						ok: true,
						result: await session.invoke(input.method, input.args, canvasPageScope),
					});
					return;
				}
				if (route === "/api/session" || route === "/api/events") {
					if (req.method !== "GET") reject(405, "http_method", "This API requires GET");
					authenticate(req);
					if (route === "/api/session") {
						json(res, 200, {
							ok: true,
							result: { ...(await session.readSnapshot()), mediaBaseUrl: readOnly.mediaBaseUrl },
						});
						return;
					}
					if (streams.size >= 8) reject(429, "stream_limit", "Too many event streams");
					res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
					streams.add(res);
					const send = (event: unknown) => {
						if (res.destroyed || res.writableEnded) return;
						// XHR progress delivers small records without fetch's WebKit padding workaround.
						const line = `${JSON.stringify(event)}\n`;
						// write(false) means backpressure, including a healthy large lesson. Bound
						// queued bytes rather than dropping that lesson at the first false result.
						if (res.writableLength + Buffer.byteLength(line) > MAX_QUEUED_EVENT_BYTES)
							res.destroy();
						else res.write(line);
					};
					send({ type: "ready" });
					const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15_000);
					const unsubscribe = session.subscribe(send);
					res.once("close", () => {
						clearInterval(heartbeat);
						unsubscribe();
						streams.delete(res);
					});
					return;
				}
				if (req.method !== "GET" && req.method !== "HEAD")
					reject(405, "http_method", "Static assets are read-only");
				if (route === "/canvas" || route.startsWith("/canvas?")) {
					expireCanvasAdmissions();
					const admission = canvasAdmissions.get(route);
					if (!admission) {
						if (await retryCanvasNavigation(req, res)) return;
						reject(401, "unauthorized", "Canvas launch admission is required");
					}
					requireLocalLaunch(req);
					const read = admission.read;
					canvasAdmissions.delete(route);
					if (req.method !== "GET") reject(405, "http_method", "Canvas launch requires GET");
					if (canvasBuilding) {
						if (req.headers["sec-fetch-dest"] !== "document")
							reject(409, "canvas_busy", "Canvas compilation is already running");
						const entry = await canvasBuilding;
						if (!entry || signal.aborted || closing)
							reject(503, "session_closed", "Canvas launch was cancelled");
						// Share the in-flight capture so queued tabs cannot release each other's output.
						redirectCanvasDocument(res, read, entry);
						return;
					}
					if (!preview) reject(503, "preview_unavailable", "Course preview is unavailable");
					let finishBuild: (entry?: string) => void = () => {};
					canvasBuilding = new Promise<string | undefined>((resolve) => {
						finishBuild = resolve;
					});
					let completedEntry: string | undefined;
					try {
						const built = (await session.invoke("canvasPreviewBuild", {})) as {
							entryUrl: string;
							pages: Array<{ slug: string }>;
						};
						if (signal.aborted || closing)
							reject(503, "session_closed", "Canvas launch was cancelled");
						const page = built.pages[0];
						if (!page) reject(404, "not_found", "Course has no preview page");
						const entry = new URL(`${encodeURIComponent(page.slug)}.html`, built.entryUrl);
						redirectCanvasDocument(res, read, entry.pathname);
						completedEntry = entry.pathname;
					} finally {
						canvasBuilding = undefined;
						finishBuild(completedEntry);
					}
					return;
				}
				if (route.startsWith("/canvas/")) {
					// Background projections are transient reads; entering an author document still reviews identity.
					if (req.headers["sec-fetch-dest"] === "empty") requireLocalLaunch(req);
					else if (await serveIdentityGate(req, res)) return;
					const requested = new URL(route, origin);
					const relativeUrl = requested.pathname.slice("/canvas".length);
					if (!readOnly.hasCanvasDocument(relativeUrl)) {
						const current = readOnly.currentCanvasDocument(relativeUrl);
						if (current) {
							res.writeHead(303, { Location: `/canvas${current}${requested.search}` });
							res.end();
							return;
						}
					}
					const html = await readOnly.readCanvasDocument(relativeUrl, signal);
					if (html === null) reject(404, "not_found", "Resource is not available");
					const response = await serveStudioAuthorDocument(
						new Request(`${origin}${route}`, { method: req.method }),
						html,
						`${readOnly.origin}/canvas${relativeUrl}`,
						canvasScript,
					);
					for (const [name, value] of response.headers) res.setHeader(name, value);
					res.writeHead(200);
					res.end(req.method === "HEAD" ? undefined : await response.text());
					return;
				}
				if (await retryCanvasNavigation(req, res)) return;
				reject(404, "not_found", "Resource is not available");
			} catch (error) {
				const known = error instanceof RequestError || error instanceof StudioSessionError;
				// Zod includes unrecognized input keys in its message; they cannot classify project errors.
				const schemaError = error instanceof ZodError;
				const fileBusy = !schemaError && isProjectFileBusyError(error);
				const busy = !schemaError && isProjectBusyError(error);
				const cacheOverlap = !schemaError && projectReadErrorKey(error) === "privateLockCache";
				const recoveryConflict =
					!schemaError && projectReadErrorKey(error) === "projectRecoveryConflict";
				const recoveryRequired =
					!schemaError && projectReadErrorKey(error) === "projectRecoveryRequired";
				const plainYaml = !schemaError && projectReadErrorKey(error) === "plainYamlRequired";
				const unsupportedFilesystem =
					!schemaError && projectReadErrorKey(error) === "projectFilesystemUnsupported";
				const plainStorePath = !schemaError ? projectPlainStorePath(error) : undefined;
				const status =
					plainStorePath !== undefined
						? 400
						: known
							? error.status
							: busy || fileBusy || recoveryConflict || recoveryRequired
								? 503
								: cacheOverlap
									? 403
									: schemaError || plainYaml || unsupportedFilesystem
										? 400
										: 500;
				const code =
					plainStorePath !== undefined
						? "EIDENTITY"
						: known
							? error.code
							: unsupportedFilesystem
								? "EPROJECTFILESYSTEM"
								: recoveryRequired
									? "ERECOVERYREQUIRED"
									: recoveryConflict
										? "EPROJECTRECOVERY"
										: fileBusy
											? "EFILEBUSY"
											: busy
												? "EPROJECTBUSY"
												: cacheOverlap
													? "ELOCKCACHE"
													: plainYaml
														? "EPLAINYAML"
														: schemaError
															? "bad_schema"
															: "operation_failed";
				const message =
					plainStorePath !== undefined
						? String(error)
						: known
							? error.message
							: recoveryConflict || recoveryRequired || unsupportedFilesystem
								? String(error)
								: fileBusy
									? "File is in use by another program. Try saving again."
									: schemaError
										? "Request does not match the input schema"
										: "Project operation failed";
				if (status === 500) console.error("[studio] Project operation failed", error);
				if (res.headersSent) {
					res.destroy();
					return;
				}
				res.setHeader("Connection", "close");
				req.resume();
				json(res, status, {
					ok: false,
					error: {
						code,
						message,
						...(code === "identity_retirement_pending" ? { reviewUrl: "/launch" } : {}),
						...(plainStorePath !== undefined
							? {
									messageRef: {
										key: "desktop.identity.plainStoreRequired",
										args: { path: plainStorePath },
									},
								}
							: {}),
						...(error instanceof StudioSessionError && error.details
							? { details: error.details }
							: {}),
					},
				});
			}
		}
		server.on("request", (req, res) => {
			const signal = ownHttpResponse(req, res);
			const task = handle(req, res, signal);
			pending.add(task);
			void task.then(
				() => pending.delete(task),
				(error) => {
					pending.delete(task);
					res.destroy();
					console.error("[studio] Response failed", error);
				},
			);
		});
		// Keep raw headers available for duplicate checks; the byte limit still bounds parsing.
		server.maxHeadersCount = 0;
		// Reject expectations explicitly so Node cannot send headerless 417 or 100 responses.
		const rejectExpectation = (req: IncomingMessage, res: ServerResponse) => {
			ownHttpResponse(req, res);
			res.writeHead(417, { ...privateHeaders, Connection: "close", "Content-Length": 0 });
			res.end();
		};
		server.on("checkExpectation", rejectExpectation);
		server.on("checkContinue", rejectExpectation);
		server.on("clientError", (error, socket) => {
			if (!socket.writable) return;
			const status =
				(error as NodeJS.ErrnoException).code === "HPE_HEADER_OVERFLOW"
					? "431 Request Header Fields Too Large"
					: "400 Bad Request";
			const headers = Object.entries(privateHeaders)
				.map(([name, value]) => `${name}: ${value}`)
				.join("\r\n");
			socket.end(
				`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n${headers}\r\n\r\n`,
			);
		});
		server.on("upgrade", (_req, socket) => {
			socket.destroy();
		});
		server.on("connect", (_req, socket) => {
			socket.destroy();
		});
		server.off("connection", refuseDuringStartup);
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Studio listener did not bind");
		origin = `http://127.0.0.1:${address.port}`;
		let closePromise: Promise<void> | undefined;
		return {
			origin,
			readyUrl: `${origin}/#session=${token}`,
			close() {
				closePromise ??= (async () => {
					closing = true;
					session.cancelExport();
					for (const stream of streams) stream.end();
					const stopped = new Promise<void>((resolve, rejectClose) =>
						server.close((error) => (error ? rejectClose(error) : resolve())),
					);
					server.closeAllConnections();
					// HTTP's callback must not gate cancellation or owned-file cleanup.
					const cleaned = (async () => {
						// Existing preview leases can be released while an unrelated export is still draining.
						const results = await Promise.allSettled([
							session.close(),
							readOnly.close(),
							Promise.allSettled([...pending]),
						]);
						// Admitted preview builds may finish during close; release their late leases too.
						results.push(...(await Promise.allSettled([preview?.dispose()])));
						results.push(...(await Promise.allSettled([temporary?.dispose()])));
						const errors = results.flatMap((result) =>
							result.status === "rejected" ? [result.reason] : [],
						);
						if (errors.length) throw new AggregateError(errors, "Studio resource cleanup failed");
					})();
					const results = await Promise.allSettled([stopped, cleaned]);
					const errors = results.flatMap((result) =>
						result.status === "rejected" ? [result.reason] : [],
					);
					if (errors.length) throw new AggregateError(errors, "Studio shutdown failed");
				})();
				return closePromise;
			},
		};
	} catch (error) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		throw error;
	}
}
