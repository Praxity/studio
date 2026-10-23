import type { CanvasMessages } from "../../shared/canvas-messages";
import { projectPlainStoreMessage, projectPlainStorePath } from "../../shared/project-write-errors";
import type {
	CanvasTextBinding,
	createCanvasTextSession,
	mountCanvasTextFields,
} from "./canvas-text";
import type { openBrowserEventStream } from "./event-stream";

/** Runs from the packaged nonce-bearing entry before any course element is parsed. */
export function startStudioAuthor(
	editorOrigin: string,
	readUrl: string,
	messages: CanvasMessages,
	mountFields: typeof mountCanvasTextFields,
	makeSession: typeof createCanvasTextSession,
	styles: Record<"light" | "dark", string>,
	openEvents: typeof openBrowserEventStream,
	eventLimit: number,
) {
	const fragment = location.hash;
	// The learner base must never affect history, and cleanup precedes storage or DOM work.
	history.replaceState(null, "", `${editorOrigin}${location.pathname}`);
	const createElement = Document.prototype.createElement.bind(document);
	const querySelector = Document.prototype.querySelector.bind(document);
	const importNode = Document.prototype.importNode.bind(document);
	const queryAll = Document.prototype.querySelectorAll;
	const query = Document.prototype.querySelector;
	const activeGetter = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")?.get;
	const root = querySelector("html");
	if (!(root instanceof HTMLElement) || !activeGetter) throw new Error("Document unavailable");
	const documentRoot = root;
	const activeElement = activeGetter.bind(document);
	const parser = new DOMParser();
	const readArrivalUrl = (url: string) => {
		const arrival = new URL(url);
		arrival.searchParams.set("praxity-resume", "0");
		return arrival.href;
	};
	const request = window.fetch.bind(window);
	const requestTimeoutMs = 10_000;
	const fetchEvents = navigator.userAgent.includes("Firefox") ? request : undefined;
	let documentPath = location.pathname;
	const controller = new AbortController();
	let token = "";
	let fallbackToken: string | null = null;
	let sessionError: unknown;
	try {
		const tokenShape = /^[\w-]{43}$/;
		const stored = sessionStorage.getItem("praxity.studio.session");
		const supplied = new URLSearchParams(fragment.slice(1)).get("session");
		token = supplied && tokenShape.test(supplied) ? supplied : (stored ?? "");
		if (!token || !tokenShape.test(token)) throw new Error("Session unavailable");
		if (stored && stored !== token && tokenShape.test(stored)) fallbackToken = stored;
	} catch (error) {
		sessionError = error;
	}
	window.addEventListener(
		"pagehide",
		() => {
			controller.abort();
		},
		{ once: true },
	);
	// Start in the next task after parsing. Course images must never gate author controls.
	window.addEventListener(
		"DOMContentLoaded",
		async () => {
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			let status: HTMLSpanElement | undefined;
			let toggle: HTMLButtonElement | undefined;
			let mountedFields: ReturnType<typeof mountCanvasTextFields> | undefined;
			try {
				// Use the compiler's course appearance, even when Studio's system theme differs.
				const controlStyles =
					styles[documentRoot.dataset.praxityMode === "dark" ? "dark" : "light"];
				// The document root remains an ancestor even of protected top-layer controls.
				for (const [property, value] of [
					["display", "block"],
					["visibility", "visible"],
					["content-visibility", "visible"],
					["interactivity", "auto"],
					["zoom", "1"],
					["opacity", "1"],
					["filter", "none"],
				] as const)
					documentRoot?.style.setProperty(property, value, "important");
				const host = createElement("div");
				host.setAttribute("popover", "manual");
				// Inline important geometry wins against authored layers, animations and selectors.
				host.style.cssText =
					"all:initial!important;display:block!important;position:absolute!important;inset:8px 8px auto 8px!important;margin:0!important;padding:0!important;border:0!important;opacity:1!important;visibility:visible!important;transform:none!important;zoom:1!important;animation:none!important;transition:none!important;pointer-events:auto!important;";
				const shadow = host.attachShadow({ mode: "open" });
				const style = createElement("style");
				style.textContent = controlStyles;
				const controls = createElement("nav");
				controls.className = "studio";
				controls.setAttribute("aria-label", messages.edit);
				toggle = createElement("button");
				const modeToggle = toggle;
				toggle.type = "button";
				toggle.textContent = messages.enter;
				toggle.setAttribute("aria-pressed", "false");
				toggle.disabled = true;
				toggle.setAttribute("aria-describedby", "studio-status");
				const link = createElement("a");
				let destination = readArrivalUrl(readUrl);
				link.href = destination;
				link.setAttribute("role", "link");
				link.tabIndex = 0;
				link.textContent = messages.read;
				// Reserve the localized loading label before it can move course click targets.
				const readSize = createElement("span");
				readSize.className = "read-size";
				readSize.setAttribute("aria-hidden", "true");
				readSize.textContent = messages.readUpdating;
				status = createElement("span");
				status.id = "studio-status";
				status.setAttribute("role", "status");
				status.setAttribute("aria-live", "polite");
				status.setAttribute("aria-atomic", "true");
				status.textContent = messages.connecting;
				const statusSlot = createElement("div");
				statusSlot.className = "status-slot";
				const review = createElement("a");
				review.href = `${editorOrigin}/launch`;
				review.textContent = messages.reviewChanges;
				review.hidden = true;
				statusSlot.append(status, document.createTextNode(" "), review);
				controls.append(toggle, link, readSize, statusSlot);
				shadow.append(style, controls);
				const protectedHost = createElement("div");
				protectedHost.style.cssText =
					"all:initial!important;display:block!important;visibility:visible!important;content-visibility:visible!important;animation:none!important;transition:none!important;";
				const protectedRoot = protectedHost.attachShadow({ mode: "open" });
				protectedRoot.append(host);
				documentRoot?.prepend(protectedHost);
				host.showPopover();
				// Author panel decision, 2026-10-17: reserve a band and scroll it with the course.
				// Floating controls covered the header; a shared status row moved the toggle.
				// ResizeObserver alone left a frame of overlap after localized text wrapped.
				const courseBody = querySelector("body");
				const courseMargin = courseBody
					? Math.max(0, Number.parseFloat(getComputedStyle(courseBody).marginTop) || 0)
					: 0;
				const reservePanel = () => {
					// A body positioned out of flow still needs the author's reserved header band.
					if (courseBody instanceof HTMLElement)
						courseBody.style.setProperty(
							"margin-top",
							`${courseMargin + host.getBoundingClientRect().height + 16}px`,
							"important",
						);
				};
				const panelObserver = new ResizeObserver(reservePanel);
				panelObserver.observe(host);
				// Text can wrap before ResizeObserver delivers; reserve it in the same microtask.
				const panelContentObserver = new MutationObserver(reservePanel);
				panelContentObserver.observe(controls, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: ["class"],
				});
				window.addEventListener(
					"pagehide",
					() => {
						panelObserver.disconnect();
						panelContentObserver.disconnect();
					},
					{ once: true },
				);
				reservePanel();
				if (sessionError) throw sessionError;
				async function rpc(method: string, args: unknown) {
					const deadline = new AbortController();
					// An absent reply is unknown, never a no-write refusal or an automatic replay.
					const timer = setTimeout(() => deadline.abort(), requestTimeoutMs);
					try {
						const response = await request(`${editorOrigin}/api/rpc`, {
							method: "POST",
							headers: {
								Authorization: `Bearer ${token}`,
								"Content-Type": "application/json",
								"X-Praxity-Canvas": documentPath,
							},
							credentials: "omit",
							signal: AbortSignal.any([controller.signal, deadline.signal]),
							body: JSON.stringify({ method, args }),
						});
						if (!response.ok) {
							const reply = await response.json();
							if (
								method === "canvasTextApply" &&
								reply.error?.code === "identity_retirement_pending"
							)
								return { ok: false, code: "identity-retirement-pending" };
							if (projectPlainStorePath(reply.error) !== undefined) {
								if (method === "canvasTextApply")
									return {
										ok: false,
										code: "plain-store-required",
										messageRef: reply.error.messageRef,
									};
								throw Object.assign(new Error("Plain store required", { cause: response.status }), {
									messageRef: reply.error.messageRef,
								});
							}
							throw new Error("RPC unavailable", { cause: response.status });
						}
						const reply = await response.json();
						if (reply.ok !== true) throw new Error("RPC refused");
						return reply.result;
					} finally {
						clearTimeout(timer);
					}
				}
				try {
					await rpc("configRead", {});
				} catch (error) {
					if (!(error instanceof Error) || error.cause !== 401 || !fallbackToken) throw error;
					token = fallbackToken;
					await rpc("configRead", {});
				}
				// Authentication owns replacement. A forged fragment cannot overwrite a working session.
				sessionStorage.setItem("praxity.studio.session", token);
				let generation = 0;
				let invalidate = () => {
					generation++;
				};
				let eventSeq = -1;
				await new Promise<void>((resolve, reject) => {
					let connected = false;
					async function listen() {
						while (!controller.signal.aborted) {
							let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
							try {
								const response = await openEvents(
									token,
									controller.signal,
									eventLimit,
									`${editorOrigin}/api/events`,
									fetchEvents,
								);
								if (response.status !== 200 || !response.body)
									throw new Error("Events unavailable");
								reader = response.body.getReader();
								const decoder = new TextDecoder("utf-8", { fatal: true });
								let pending = "";
								while (!controller.signal.aborted) {
									const chunk = await reader.read();
									if (chunk.done) throw new Error("Events closed");
									pending += decoder.decode(chunk.value, { stream: true });
									const lines = pending.split("\n");
									pending = lines.pop() ?? "";
									for (const line of lines) {
										const event = JSON.parse(line);
										if (!connected && event.type !== "ready") throw new Error("Events unavailable");
										if (event.type === "ready") {
											if (connected) invalidate();
											connected = true;
											resolve();
										} else if (
											event.type === "editorChanged" &&
											Number.isSafeInteger(event.seq) &&
											event.seq > eventSeq
										) {
											eventSeq = event.seq;
											invalidate();
										}
									}
								}
							} catch (error) {
								if (controller.signal.aborted) return;
								if (!connected) {
									reject(error);
									return;
								}
								console.error("[studio] Canvas event stream interrupted", error);
							} finally {
								try {
									await reader?.cancel();
								} catch (error) {
									if (!controller.signal.aborted)
										console.error("[studio] Canvas event stream cleanup failed", error);
								}
							}
							// Reconnection invalidates output, including changes missed in the gap.
							await new Promise<void>((resolve) => {
								const abort = () => {
									clearTimeout(timer);
									resolve();
								};
								const timer = setTimeout(() => {
									controller.signal.removeEventListener("abort", abort);
									resolve();
								}, 1_000);
								controller.signal.addEventListener("abort", abort, { once: true });
							});
						}
					}
					void listen().catch(reject);
				});
				const port = {
					snapshot: () => rpc("canvasTextSnapshot", {}),
					apply: (input: unknown) => rpc("canvasTextApply", input),
				};
				const snapshot = await port.snapshot();
				eventSeq = Math.max(eventSeq, snapshot.seq);
				const liveStatus = status;
				let refreshing = false;
				let editedPageId: string | undefined;
				let refreshed = Promise.resolve();
				let finishRefresh: (() => void) | undefined;
				const lifecycle = {
					editingChanged(editing: boolean, focusHidden: boolean) {
						modeToggle.setAttribute("aria-pressed", String(editing));
						if (!editing && focusHidden) modeToggle.focus({ preventScroll: true });
					},
					opened() {
						generation++;
					},
					closed(binding?: CanvasTextBinding) {
						editedPageId = binding?.pageId ?? editedPageId;
						invalidate();
					},
					async destination(anchor: HTMLAnchorElement | HTMLAreaElement) {
						if (anchor !== link) return;
						while (finishRefresh) await refreshed;
						return destination;
					},
				};
				const view = mountFields(
					snapshot.fields,
					port,
					messages,
					controlStyles,
					status,
					makeSession,
					createElement,
					documentRoot,
					modeToggle,
					lifecycle,
				);
				mountedFields = view;
				modeToggle.disabled = false;
				modeToggle.setAttribute("aria-pressed", "true");
				modeToggle.removeAttribute("aria-describedby");
				modeToggle.addEventListener("click", async (event) => {
					if (!event.isTrusted) return;
					const editing = modeToggle.getAttribute("aria-pressed") !== "true";
					await view.setEditing(editing);
					modeToggle.setAttribute("aria-pressed", String(view.isEditing()));
				});

				async function refresh() {
					if (refreshing || view.isOpen() || controller.signal.aborted) return;
					refreshing = true;
					// Removing the destination also blocks auxiliary clicks and browser link menus.
					link.removeAttribute("href");
					link.setAttribute("aria-busy", "true");
					link.setAttribute("aria-disabled", "true");
					link.textContent = messages.readUpdating;
					// One wait spans discarded builds and refreshes deferred by an open field.
					if (!finishRefresh)
						refreshed = new Promise<void>((resolve) => {
							finishRefresh = resolve;
						});
					const requested = generation;
					const stagedStyles: HTMLLinkElement[] = [];
					const styleAbort = new AbortController();
					let styleTimer: ReturnType<typeof setTimeout> | undefined;
					try {
						// Rebuild from a fresh read admission, never from an event's HTML or the old artifact.
						const before = await port.snapshot();
						async function readCurrent() {
							const current = await port.snapshot();
							if (requested !== generation || controller.signal.aborted) return;
							if (JSON.stringify(before.fields) !== JSON.stringify(current.fields)) {
								generation++;
								return;
							}
							return current;
						}
						const built = await rpc("canvasPreviewBuild", {});
						const pageId = before.fields.find(
							(field: { kind: string }) => field.kind === "page",
						)?.ownerId;
						const page = built.pages.find((page: { id: string }) => page.id === pageId);
						if (!page) throw new Error("Saved page is unavailable");
						const entry = new URL(`${encodeURIComponent(page.slug)}.html`, built.entryUrl);
						const authorUrl = `${editorOrigin}/canvas${entry.pathname}`;
						const response = await request(authorUrl, {
							signal: controller.signal,
							credentials: "omit",
						});
						if (!response.ok) throw new Error("Saved page is unavailable");
						const html = await response.text();
						if (requested !== generation || view.isOpen() || controller.signal.aborted) return;
						// The response already passed the author projection; its bootstrap never executes twice.
						const fresh = parser.parseFromString(html, "text/html");
						// Missing Fetch Metadata can send the author-entry gate on this read.
						if (query.call(fresh, "#review-heading")) {
							review.hidden = false;
							liveStatus.textContent = messages.identityReviewPending;
							return;
						}
						for (const script of queryAll.call(fresh, "script")) script.remove();
						const remembered = built.pages.find(
							(candidate: { id: string }) => candidate.id === editedPageId,
						);
						if (!remembered) editedPageId = undefined;
						const readPage = remembered ?? page;
						// The compiler alias owns the destination and fragment for a later deck slide.
						const readEntry = new URL(`${encodeURIComponent(readPage.slug)}.html`, built.entryUrl);
						const savedReadUrl = `${new URL(readUrl).origin}/canvas${readEntry.pathname}`;
						// Firefox may resolve a connected head link before its replacement base takes effect.
						for (const resource of queryAll.call(fresh, "link[href]"))
							resource.setAttribute(
								"href",
								new URL(resource.getAttribute("href") ?? "", savedReadUrl).href,
							);
						const body = querySelector("body");
						const freshBody = query.call(fresh, "body");
						const head = querySelector("head");
						const freshHead = query.call(fresh, "head");
						if (!body || !freshBody || !head || !freshHead)
							throw new Error("Saved document unavailable");
						// Keep the current sheets active until their revision replacements are loaded.
						const stylesBySource = new Map<Node, HTMLLinkElement>();
						styleTimer = setTimeout(
							() => styleAbort.abort(new Error("Saved stylesheet timed out")),
							requestTimeoutMs,
						);
						const styleSignal = AbortSignal.any([controller.signal, styleAbort.signal]);
						const oldStyles = [...head.querySelectorAll('link[rel="stylesheet"]')];
						function loadStyle(sheet: HTMLLinkElement, activate: () => void) {
							return new Promise<void>((resolve, reject) => {
								styleSignal.throwIfAborted();
								sheet.addEventListener("load", () => resolve(), {
									once: true,
									signal: styleSignal,
								});
								sheet.addEventListener(
									"error",
									() => reject(new Error("Saved stylesheet is unavailable")),
									{ once: true, signal: styleSignal },
								);
								styleSignal.addEventListener("abort", () => reject(styleSignal.reason), {
									once: true,
								});
								activate();
							});
						}
						await Promise.all(
							[...freshHead.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
								(source, index) => {
									// Retain as through activation and reconciliation to avoid warnings and refetches.
									source.as = "style";
									const sheet = importNode(source, true) as HTMLLinkElement;
									// Changing an inactive sheet's media makes WebKit fetch it again on activation.
									sheet.rel = "preload";
									stagedStyles.push(sheet);
									stylesBySource.set(source, sheet);
									return loadStyle(sheet, () => {
										const previous = oldStyles[index];
										if (previous) previous.after(sheet);
										else head.append(sheet);
									});
								},
							),
						);
						if (requested !== generation || view.isOpen() || controller.signal.aborted) return;
						if (!(await readCurrent())) return;
						await Promise.all(
							stagedStyles.map((sheet) =>
								loadStyle(sheet, () => {
									sheet.rel = "stylesheet";
								}),
							),
						);
						// A background tab can pause painting after its stylesheet load has completed.
						clearTimeout(styleTimer);
						styleTimer = undefined;
						// Keep old CSS through WebKit's rendering update and head reconciliation.
						await new Promise<void>((resolve, reject) => {
							styleSignal.throwIfAborted();
							styleSignal.addEventListener("abort", () => reject(styleSignal.reason), {
								once: true,
							});
							requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
						});
						const current = await readCurrent();
						if (!current) return;
						const focusedBinding = view.focusedBinding();
						const focused = activeElement() as Element | null;
						const focusedId = focused?.id;
						const focusedName = focused?.getAttribute("aria-label") ?? focused?.textContent;
						const focusedHref = focused instanceof HTMLAnchorElement ? focused.href : undefined;
						const position = { left: scrollX, top: scrollY };
						const directories = [
							new URL(".", location.href).href,
							new URL(".", authorUrl).href,
							new URL(".", querySelector("base")?.getAttribute("href") ?? readUrl).href,
							new URL(".", savedReadUrl).href,
						];
						const comparable = (node: Node) => {
							let markup =
								node instanceof Element
									? node.outerHTML.replace(/ data-node-id="[^"]*"/g, "")
									: node.nodeValue;
							for (const directory of directories)
								markup = markup?.replaceAll(directory, "") ?? null;
							return markup;
						};
						const normalizeHref = (href: string) =>
							directories.reduce((value, directory) => value.replaceAll(directory, ""), href);
						// Reuse course nodes and owned buttons. Unrelated edits must not rebuild the AT buffer.
						function sync(target: Node, source: Node) {
							if (target instanceof Element && source instanceof Element) {
								for (const attribute of [...target.attributes])
									if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
								for (const attribute of source.attributes)
									if (target.getAttribute(attribute.name) !== attribute.value)
										target.setAttribute(attribute.name, attribute.value);
							} else if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
							const old = [...target.childNodes].filter((node) => !view.owns(node));
							const next = [...source.childNodes];
							const used = new Set<Node>();
							const key = (node: Node) =>
								node instanceof Element ? node.id || node.getAttribute("data-node-id") : null;
							const pairs = next.map((node) => {
								const match =
									stylesBySource.get(node) ??
									old.find(
										(candidate) =>
											!used.has(candidate) &&
											(candidate.isEqualNode(node) ||
												(candidate.nodeName === node.nodeName &&
													comparable(candidate) === comparable(node))),
									);
								if (match) used.add(match);
								return match;
							});
							// Preserve unchanged content before IDs: a transient ID can be rebound after an insertion.
							for (const [index, node] of next.entries()) {
								if (pairs[index] || !key(node)) continue;
								const match = old.find(
									(candidate) =>
										!used.has(candidate) &&
										key(node) === key(candidate) &&
										candidate.nodeName === node.nodeName,
								);
								if (match) {
									pairs[index] = match;
									used.add(match);
								}
							}
							let cursor = target.firstChild;
							for (const [index, node] of next.entries()) {
								let match = pairs[index];
								const candidate = old[index];
								if (
									!match &&
									candidate &&
									!used.has(candidate) &&
									candidate.nodeName === node.nodeName
								) {
									match = candidate;
									used.add(match);
								}
								while (cursor && view.owns(cursor)) cursor = cursor.nextSibling;
								const retained = match ?? importNode(node, true);
								// A loaded stylesheet must stay connected while old sheets are retired.
								if (retained !== cursor && !stylesBySource.has(node))
									target.insertBefore(retained, cursor);
								if (match) sync(match, node);
								cursor = retained.nextSibling;
							}
							for (const node of old) if (!used.has(node)) target.removeChild(node);
						}
						sync(head, freshHead);
						stagedStyles.length = 0;
						sync(body, freshBody);
						reservePanel();
						const freshRoot = query.call(fresh, "html");
						for (const attribute of freshRoot?.attributes ?? [])
							if (attribute.name !== "style")
								documentRoot.setAttribute(attribute.name, attribute.value);
						history.replaceState(null, "", authorUrl);
						documentPath = new URL(authorUrl).pathname;
						destination = readArrivalUrl(savedReadUrl);
						view.update(current.fields);
						const announcement = liveStatus.textContent;
						const nextStatus = view.unmapped
							? messages.unmapped
							: announcement &&
									announcement !== messages.unmapped &&
									announcement !== messages.refreshFailed
								? announcement
								: messages.connected;
						review.hidden = true;
						if (liveStatus.textContent !== nextStatus) liveStatus.textContent = nextStatus;
						scrollTo(position);
						if (focusedBinding) view.focusBinding(focusedBinding);
						else if (focused && activeElement() !== focused) {
							if (focused instanceof HTMLElement && focused.isConnected)
								focused.focus({ preventScroll: true });
							else {
								const matches = [
									...queryAll.call(document, "a,button,input,select,textarea,[tabindex]"),
								].filter(
									(element) =>
										element.tagName === focused.tagName &&
										(focusedId
											? element.id === focusedId
											: (element.getAttribute("aria-label") ?? element.textContent) ===
													focusedName &&
												(!focusedHref ||
													(element instanceof HTMLAnchorElement &&
														normalizeHref(element.href) === normalizeHref(focusedHref)))),
								);
								if (matches.length === 1 && matches[0] instanceof HTMLElement)
									matches[0].focus({ preventScroll: true });
							}
						}
					} catch (error) {
						if (!controller.signal.aborted) {
							console.error("[studio] Canvas refresh failed", error);
							if (status) status.textContent = messages.refreshFailed;
						}
					} finally {
						clearTimeout(styleTimer);
						styleAbort.abort();
						for (const sheet of stagedStyles) sheet.remove();
						refreshing = false;
						if (requested !== generation) void refresh();
						else {
							link.href = destination;
							link.textContent = messages.read;
							link.removeAttribute("aria-busy");
							link.removeAttribute("aria-disabled");
							const finished = finishRefresh;
							finishRefresh = undefined;
							finished?.();
						}
					}
				}
				invalidate = () => {
					generation++;
					void refresh();
				};
				status.textContent = view.unmapped ? messages.unmapped : messages.connected;
				// A watcher may arrive while the first reply is held. Compare fresh bytes, not its sequence alone.
				const startupSnapshot = eventSeq > snapshot.seq ? await port.snapshot() : snapshot;
				if (
					startupSnapshot.servedSourceRevisions
						? Object.keys(startupSnapshot.sourceRevisions).length !==
								Object.keys(startupSnapshot.servedSourceRevisions).length ||
							Object.entries(startupSnapshot.sourceRevisions).some(
								([file, revision]) => startupSnapshot.servedSourceRevisions[file] !== revision,
							)
						: generation || startupSnapshot.seq !== startupSnapshot.servedSeq
				)
					void refresh();
			} catch (error) {
				console.error("[studio] Canvas startup failed", error);
				mountedFields?.dispose();
				if (toggle) {
					toggle.disabled = true;
					toggle.setAttribute("aria-pressed", "false");
					toggle.setAttribute("aria-describedby", "studio-status");
				}
				controller.abort();
				if (status) {
					const path = projectPlainStorePath(error);
					status.textContent =
						path === undefined
							? messages.failed
							: projectPlainStoreMessage(path, documentRoot.lang.startsWith("fr") ? "fr" : "en");
					if (path !== undefined) {
						status.setAttribute("role", "alert");
						status.style.cssText = "white-space:pre-wrap;max-height:70vh;overflow:auto";
					}
				}
			}
		},
		{ once: true },
	);
}
