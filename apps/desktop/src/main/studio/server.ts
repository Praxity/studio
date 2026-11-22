import { createHash, randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { createTranslator } from "use-intl/core";
import { ZodError, z } from "zod";
import { studioPortSchema } from "../../shared/ipc-schemas";
import { isDesktopSubPath } from "../../shared/path-utils";
import {
	isProjectBusyError,
	isProjectFileBusyError,
	projectPlainStorePath,
	projectReadErrorKey,
} from "../../shared/project-write-errors";
import { DEFAULT_APP_SETTINGS } from "../../shared/types";
import cliEn from "../cli-messages/en.json" with { type: "json" };
import cliFr from "../cli-messages/fr.json" with { type: "json" };
import { CoursePreviewService } from "../course-preview-service";
import { CoursePreviewStateStore } from "../course-preview-state-store";
import { assertPlainIdentityStore } from "../identity-store";
import { assertAllowedProjectRoot, readFileWithin } from "../path-security";
import {
	assertProjectWritesAllowed,
	withProjectFileTransaction,
} from "../project-file-transactions";
import { ownHttpResponse } from "../response-stream";
import { createStudioProjectSession, StudioSessionError } from "./project-session";
import { startStudioReadOnlyServer } from "./read-only-server";
import { prepareStudioTemporaryOutputs } from "./temporary-outputs";

declare const __PRAXITY_CANVAS_SHA256__: string;

const DEFAULT_PORT_START = 45000;
const DEFAULT_PORT_COUNT = 1000;
const STUDIO_IDENTITY = z
	.object({
		service: z.literal("praxity-studio"),
		projectDir: z
			.string()
			.min(1)
			.max(4096)
			.refine((value) => path.isAbsolute(value))
			.transform((value) =>
				value.replace(
					/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu,
					(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
				),
			),
	})
	.strict();

export interface StudioServerOptions {
	locale?: "en" | "fr";
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
		const timer = setTimeout(() => finish(null), 1000);
		req.once("error", () => finish(null));
		req.once("close", () => finish(null));
		req.once("socket", (socket) => socket.once("error", () => finish(null)));
		req.end();
	});
}

async function uiFiles(editorAssetsDir: string, t: ReturnType<typeof createTranslator>) {
	let root: string;
	try {
		root = await realpath(editorAssetsDir);
		if (!(await stat(root)).isDirectory()) throw new Error("Missing canvas directory");
	} catch (cause) {
		throw new Error(t("serverRefusals.browserAssets"), {
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
	const locale = options.locale ?? "en";
	const t = createTranslator({ locale, messages: locale === "fr" ? cliFr : cliEn });
	assertProjectWritesAllowed();
	const explicitPort =
		options.port === undefined ? undefined : studioPortSchema.parse(options.port);
	const projectRoot = await assertAllowedProjectRoot(options.projectDir);
	const ui = await uiFiles(options.editorAssetsDir, t);
	const canonical = (root: string) => (process.platform === "win32" ? root.toLowerCase() : root);
	const port = explicitPort ?? defaultStudioPort(canonical(projectRoot));
	if (
		isDesktopSubPath(canonical(projectRoot), canonical(ui.root)) ||
		isDesktopSubPath(canonical(ui.root), canonical(projectRoot))
	) {
		throw new Error(t("serverRefusals.roots"));
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
		throw new Error(t("serverRefusals.canvasAssets"), { cause });
	}
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
					? t("serverRefusals.studioPort", { port, holder })
					: t("serverRefusals.foreignPort", { port }),
				{ cause: error },
			);
		}
	}
	try {
		let origin = "";
		let preview: CoursePreviewService | undefined;
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
				locale,
			);
		} catch (error) {
			try {
				await readOnly.close();
			} finally {
				await temporary?.dispose();
			}
			throw error;
		}
		const pending = new Set<Promise<void>>();
		let closing = false;
		const canvasAdmissions = new Map<string, { expires: number }>();
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

		function requireLocalLaunch(req: IncomingMessage) {
			const sameSiteDocument =
				req.headers["sec-fetch-site"] === "same-site" &&
				req.headers["sec-fetch-mode"] === "navigate" &&
				req.headers["sec-fetch-dest"] === "document";
			if (
				req.headers["sec-fetch-site"] !== undefined &&
				!["none", "same-origin"].includes(String(req.headers["sec-fetch-site"])) &&
				!sameSiteDocument
			)
				reject(403, "origin_forbidden", t("serverRefusals.localLaunch"));
		}
		async function retryCanvasNavigation(req: IncomingMessage, res: ServerResponse) {
			if (req.method !== "GET" || req.headers["sec-fetch-dest"] !== "document") return false;
			await canvasBuilding;
			res.writeHead(303, { Location: "/#" });
			res.end();
			return true;
		}

		function redirectCanvasDocument(res: ServerResponse, entry: string) {
			res.writeHead(303, {
				Location: `${readOnly.origin}/canvas${entry}?praxity-resume=0#`,
			});
			res.end();
		}

		async function handle(req: IncomingMessage, res: ServerResponse, signal: AbortSignal) {
			for (const [name, value] of Object.entries(privateHeaders)) res.setHeader(name, value);
			try {
				if (closing) reject(503, "session_closed", t("serverRefusals.closing"));
				for (const name of ["host", "origin", "authorization", "content-type"]) {
					let count = 0;
					for (let i = 0; i < req.rawHeaders.length; i += 2) {
						if (req.rawHeaders[i].toLowerCase() === name) count++;
					}
					if (count > 1) reject(400, "duplicate_header", t("serverRefusals.header"));
				}
				if (req.headers.host !== new URL(origin).host)
					reject(403, "host_forbidden", t("serverRefusals.host"));
				if (req.headers.origin !== undefined && req.headers.origin !== origin)
					reject(403, "origin_forbidden", t("serverRefusals.origin"));
				if (!["GET", "HEAD", "POST"].includes(req.method ?? ""))
					reject(405, "http_method", t("serverRefusals.method"));
				const route = req.url ?? "";
				if (route === "/" || route === "/launch") {
					if (req.method !== "GET") reject(405, "http_method", t("serverRefusals.launchGet"));
					res.writeHead(303, { Location: "/launch?canvas=read#" });
					res.end();
					return;
				}
				if (route.startsWith("/launch?canvas=")) {
					if (req.method !== "GET") reject(405, "http_method", t("serverRefusals.launchGet"));
					const encoded = route.slice("/launch?canvas=".length);
					let target = "";
					try {
						target = decodeURIComponent(encoded);
					} catch {
						reject(404, "not_found", t("serverRefusals.resource"));
					}
					if (
						encodeURIComponent(target) !== encoded ||
						(target !== "read" &&
							!readOnly.hasCanvasDocument(target) &&
							!readOnly.currentCanvasDocument(target))
					)
						reject(404, "not_found", t("serverRefusals.resource"));
					const compile = target === "read";
					requireLocalLaunch(req);
					let destination = `${readOnly.origin}/canvas${readOnly.currentCanvasDocument(target) ?? target}?praxity-resume=0#`;
					if (compile) {
						expireCanvasAdmissions();
						if (canvasAdmissions.size >= 8) {
							const oldest = canvasAdmissions.keys().next().value;
							if (oldest !== undefined) canvasAdmissions.delete(oldest);
						}
						destination = `/canvas?admission=${randomBytes(32).toString("base64url")}`;
						canvasAdmissions.set(destination, {
							expires: Date.now() + 30_000,
						});
					}
					res.writeHead(303, {
						Location: destination,
					});
					res.end();
					return;
				}
				if (route === "/api/identity") {
					if (req.method !== "GET") reject(405, "http_method", t("serverRefusals.identityGet"));
					json(res, 200, { service: "praxity-studio", projectDir: projectRoot });
					return;
				}
				if (req.method !== "GET" && req.method !== "HEAD")
					reject(405, "http_method", t("serverRefusals.readOnly"));
				if (route === "/canvas" || route.startsWith("/canvas?")) {
					expireCanvasAdmissions();
					const admission = canvasAdmissions.get(route);
					if (!admission) {
						if (await retryCanvasNavigation(req, res)) return;
						reject(401, "unauthorized", t("serverRefusals.admission"));
					}
					requireLocalLaunch(req);
					canvasAdmissions.delete(route);
					if (req.method !== "GET") reject(405, "http_method", t("serverRefusals.canvasGet"));
					if (canvasBuilding) {
						if (req.headers["sec-fetch-dest"] !== "document")
							reject(409, "canvas_busy", t("serverRefusals.compiling"));
						const entry = await canvasBuilding;
						if (!entry || signal.aborted || closing)
							reject(503, "session_closed", t("serverRefusals.cancelled"));
						redirectCanvasDocument(res, entry);
						return;
					}
					if (!preview) reject(503, "preview_unavailable", t("serverRefusals.preview"));
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
							reject(503, "session_closed", t("serverRefusals.cancelled"));
						const page = built.pages[0];
						if (!page) reject(404, "not_found", t("serverRefusals.noPage"));
						const entry = new URL(`${encodeURIComponent(page.slug)}.html`, built.entryUrl);
						redirectCanvasDocument(res, entry.pathname);
						completedEntry = entry.pathname;
					} finally {
						canvasBuilding = undefined;
						finishBuild(completedEntry);
					}
					return;
				}
				if (route.startsWith("/canvas/")) {
					reject(404, "not_found", t("serverRefusals.resource"));
				}
				if (await retryCanvasNavigation(req, res)) return;
				reject(404, "not_found", t("serverRefusals.resource"));
			} catch (error) {
				const known = error instanceof RequestError || error instanceof StudioSessionError;
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
									? t("serverRefusals.fileBusy")
									: schemaError
										? t("serverRefusals.schema")
										: t("serverRefusals.operation");
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
		server.maxHeadersCount = 0;
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
		if (!address || typeof address === "string") throw new Error(t("serverRefusals.listener"));
		origin = `http://127.0.0.1:${address.port}`;
		let closePromise: Promise<void> | undefined;
		return {
			origin,
			readyUrl: `${origin}/`,
			close() {
				closePromise ??= (async () => {
					closing = true;
					session.cancelExport();
					const stopped = new Promise<void>((resolve, rejectClose) =>
						server.close((error) => (error ? rejectClose(error) : resolve())),
					);
					server.closeAllConnections();
					const cleaned = (async () => {
						const results = await Promise.allSettled([
							session.close(),
							readOnly.close(),
							Promise.allSettled([...pending]),
						]);
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
