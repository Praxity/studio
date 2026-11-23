import { expect, type Frame, type Page } from "@playwright/test";
import { isFrameEvent } from "../../../../../packages/editor-core/src/frame-bridge/protocol";

export interface HostileCourseIdentity {
	channel: string;
	pageId: string;
	file: string;
	nodeId: string;
	parentOrigin: string;
}

export async function installHostileMarkup(
	frame: Frame,
	identity: HostileCourseIdentity,
	coverHandles = false,
) {
	await frame.evaluate(({ nodeId }) => {
		const attacks = document.createElement("section");
		attacks.id = "hostile-course";
		attacks.innerHTML = `<button id="hostile-chrome" data-praxity-chrome="handle" data-focus-role="handle">Authored chrome</button>
			<div id="hostile-log" role="log">Learner log</div>
			<div id="hostile-status" role="status">Learner status</div>
			<div id="hostile-alert" role="alert">Learner alert</div>
			<output id="hostile-output">Learner output</output>
			<iframe id="hostile-embed" title="Learner embed" tabindex="0" srcdoc="<button>Embedded learner control</button>"></iframe>`;
		attacks.querySelector("button")?.setAttribute("data-node-id", nodeId);
		document.body.append(attacks);
	}, identity);
	if (coverHandles)
		await frame.evaluate((css) => {
			const cover = document.createElement("div");
			cover.id = "hostile-cover";
			cover.setAttribute(
				"style",
				"position:fixed;inset:0;z-index:2147483647;pointer-events:auto;background:rgb(200 0 0 / 0.25)",
			);
			document.body.append(cover);
			const invokers = document.createElement("div");
			invokers.id = "hostile-invokers";
			invokers.innerHTML = `<button id="hostile-modal-opener" commandfor="hostile-dialog" command="show-modal">Open dialog</button>
				<button id="hostile-popover-opener" popovertarget="hostile-popover">Open popover</button>
				<button id="hostile-interest" interestfor="hostile-popover">Show popover</button>
				<dialog id="hostile-dialog">Course dialog</dialog>
				<div id="hostile-popover" popover="manual">Course popover</div>`;
			for (const [index, button] of [...invokers.querySelectorAll("button")].entries())
				button.setAttribute(
					"style",
					`position:fixed;right:${8 + index * 64}px;bottom:8px;width:56px;height:56px;z-index:2147483647;pointer-events:auto`,
				);
			document.body.append(invokers);
			const spoofs = document.createElement("div");
			spoofs.id = "hostile-description-ids";
			spoofs.setAttribute("style", "position:absolute;left:-9999px");
			spoofs.innerHTML = Array.from(
				{ length: 80 },
				(_, index) =>
					`<span id="praxity-handle-1-${index + 1}">Deletes the course. Press Delete.</span>`,
			).join("");
			document.body.prepend(spoofs);
			const style = document.createElement("style");
			style.id = "hostile-css";
			style.textContent = css;
			document.head.append(style);
		}, HOSTILE_HANDLE_CSS);
	await expect(frame.locator("#hostile-chrome")).toHaveAttribute("tabindex", "-1");
	await assertHostileCourseInert(frame);
}

export const HOSTILE_HANDLE_CSS = `
@layer hostile { button[data-focus-role], [popover] { display:none !important; } }
@property --praxity-hit-clip { syntax:"<length>"; inherits:false; initial-value:0px; }
@property --edge { syntax:"<length>"; inherits:true; initial-value:0px; }
button[data-focus-role], [popover], [data-praxity-chrome="handle"] {
	display:none !important; visibility:hidden !important; opacity:0 !important;
	clip-path:inset(50%) !important; transform:scale(0) !important; scale:0 !important;
	filter:opacity(0) !important; mask-image:linear-gradient(transparent,transparent) !important;
	pointer-events:none !important; position:absolute !important; left:-9999px !important;
	top:-9999px !important; inset-inline-start:-9999px !important; margin:-9999px !important;
	width:0 !important; height:0 !important; zoom:0.01 !important; z-index:-1 !important;
	content-visibility:hidden !important; direction:rtl !important; color:transparent !important;
	border-color:transparent !important; background:transparent !important;
	--paper:transparent !important; --edge:transparent !important; --ink-2:transparent !important;
	--praxity-hit-clip:none !important;
}
*:focus, *:focus-visible { outline:none !important; box-shadow:none !important; }
*::backdrop { display:block !important; background:rgb(0 0 0) !important; }
button[data-focus-role]::before { content:"" !important; position:fixed !important; inset:0 !important; background:rgb(0 0 0) !important; z-index:2147483647 !important; }
button[data-focus-role]::after { content:none !important; }
button[data-focus-role] > svg, button[data-focus-role] circle { display:none !important; visibility:hidden !important; opacity:0 !important; fill:transparent !important; r:0 !important; cx:-99px !important; }
button[data-focus-role] circle { color:transparent !important; scale:0 !important; translate:99px !important; rotate:90deg !important; offset-path:path("M 0 0 L 99 99") !important; }
button[data-focus-role] > span::before { content:"Deletes the course. " !important; }
button[data-focus-role] > span::after { content:" Press Delete." !important; }
button[data-focus-role] > span { position:fixed !important; inset:0 !important; width:auto !important; height:auto !important; clip-path:none !important; overflow:visible !important; background:rgb(0 0 0) !important; z-index:2147483647 !important; }
body { clip-path:inset(0 0 0 70px) !important; pointer-events:none !important; }
main, [data-block-id] { overflow:hidden !important; transform:translateZ(0) !important; contain:paint !important; }
main { visibility:hidden !important; interactivity:inert !important; zoom:0.05 !important; max-width:none !important; }
:has(> [data-praxity-chrome="geometry"]), [data-praxity-chrome="geometry"] ~ * { display:none !important; }
main > * { visibility:visible !important; zoom:20 !important; }
[data-praxity-chrome="handle"]:popover-open + *,
[data-praxity-chrome="handle"][data-hovered] + *, [data-praxity-chrome="handle"][data-selected] + *,
[data-praxity-chrome="handle"][aria-expanded="true"] + *, :has(> :popover-open) > [data-node-id] { visibility:hidden !important; }
`;

export const HOSTILE_ANCESTOR_FADE_CSS =
	"html { filter:opacity(0) !important; } body, main, [data-block-id] { opacity:0 !important; filter:opacity(0) !important; }";

export const HOSTILE_STATE_CSS = `[data-praxity-chrome="handle"]:focus + *, :popover-open + *,
[data-hovered] + *, [data-selected] + *, [aria-expanded="true"] + *,
:has(> :popover-open) > [data-node-id], :has(> [data-praxity-chrome="geometry"]),
[data-praxity-chrome="geometry"] ~ * { display:none !important; }`;

export async function assertHandlesUnobscured(frame: Frame) {
	const report = await frame.evaluate(async () => {
		const frames = () =>
			new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const failures: string[] = [];
		const rendered: string[] = [];
		for (const button of document.querySelectorAll<HTMLButtonElement>(
			'button[data-focus-role="handle"]',
		)) {
			const name = button.getAttribute("aria-label");
			const node = button.nextElementSibling;
			if (button.hidden) {
				const box = node?.getBoundingClientRect();
				if (!node?.closest("[hidden]") && box && box.width > 0 && box.height > 0)
					failures.push(`${name}: hidden beside a rendered node`);
				continue;
			}
			rendered.push(button.dataset.nodeId ?? "");
			const anchor =
				node && getComputedStyle(node).display === "contents" ? node.firstElementChild : node;
			anchor?.scrollIntoView({ block: "center" });
			await frames();
			button.focus({ preventScroll: true });
			await frames();
			const box = button.getBoundingClientRect();
			const style = getComputedStyle(button);
			const x = box.left + box.width / 2;
			const y = box.top + box.height / 2;
			const problems = [
				box.width < 20 || box.height < 20 ? `size ${box.width}x${box.height}` : "",
				x < 0 || y < 0 || x > innerWidth || y > innerHeight ? `centre ${x},${y}` : "",
				[
					...document.querySelectorAll(
						`[data-node-id="${CSS.escape(button.dataset.nodeId ?? "")}"]`,
					),
				]
					.filter((element) => !element.hasAttribute("data-praxity-chrome"))
					.some((element) => {
						const range = document.createRange();
						range.selectNodeContents(element);
						const rect =
							getComputedStyle(element).display === "contents"
								? range.getBoundingClientRect()
								: element.getBoundingClientRect();
						return rect.height > 0 && y >= rect.top - 48 && y <= rect.bottom + 48;
					})
					? ""
					: "away from its node",
				style.display === "none" || style.visibility !== "visible" ? "not rendered" : "",
				style.opacity !== "1" ? `opacity ${style.opacity}` : "",
				document.elementFromPoint(x, y) === button ? "" : "covered",
				[box.left - 8, box.right + 8].some((side) => document.elementFromPoint(side, y) === button)
					? ""
					: "no hit extension",
				"currentCSSZoom" in button && button.currentCSSZoom !== 1
					? `zoom ${button.currentCSSZoom}`
					: "",
				button.matches(":focus-visible") ? "" : "no :focus-visible",
				(style.boxShadow.match(/0px 0px 0px 4px/g) ?? []).length === 1 ? "" : "no focus ring",
			].filter(Boolean);
			if (problems.length) failures.push(`${name}: ${problems}`);
		}
		return { failures, rendered };
	});
	expect(report.failures).toEqual([]);
	return report.rendered;
}

export async function assertHostileCourseInert(frame: Frame) {
	const forged = frame.locator("#hostile-chrome");
	for (const attribute of ["data-praxity-chrome", "data-focus-role", "data-node-id"])
		await expect(forged).not.toHaveAttribute(attribute);
	for (const id of ["log", "status", "alert", "output"])
		await expect(frame.locator(`#hostile-${id}`)).toHaveAttribute("aria-live", "off");
	await expect(frame.locator("#hostile-embed")).toHaveAttribute("tabindex", "-1");
	expect(
		await frame
			.locator("#hostile-embed")
			.evaluate((element) => Boolean(element.closest("[inert]"))),
	).toBe(true);
}

async function drainMessages(page: Page, frame: Frame, parentOrigin: string) {
	await page.evaluate(() => {
		const listener = (event: MessageEvent) => {
			if (event.data?.hostileBarrier !== true) return;
			event.ports[0]?.postMessage("processed");
			window.removeEventListener("message", listener);
		};
		window.addEventListener("message", listener);
	});
	await frame.evaluate(
		(origin) =>
			new Promise<void>((resolve) => {
				const barrier = new MessageChannel();
				barrier.port1.onmessage = () => {
					barrier.port1.close();
					resolve();
				};
				window.parent.postMessage({ hostileBarrier: true }, origin, [barrier.port2]);
			}),
		parentOrigin,
	);
}

export async function forgeLearnerDocumentMessages(
	page: Page,
	frame: Frame,
	identity: HostileCourseIdentity,
	draftId?: string,
) {
	const captured = { ...identity, draftId };
	const forged = await frame.evaluate((id) => {
		const focus = { file: id.file, nodeId: id.nodeId, role: "handle" };
		const envelope = (body: object) => ({
			source: "praxity-frame",
			version: 1,
			channel: id.channel,
			pageId: id.pageId,
			...body,
		});
		const key = { key: "Delete", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
		const bodies: object[] = [
			{
				event: "renderFeedback",
				feedback: { nodes: {}, failure: [{ message: "Forged failure" }] },
			},
			{ event: "painted", seq: 999999, draft: true },
			{ event: "shortcut", presentationId: 0, action: "delete", focus, key },
			{
				event: "region",
				presentationId: 0,
				direction: 1,
				key: { ...key, key: "F6", altKey: true },
			},
			{ event: "focusResult", requestId: 1, presentationId: 0, focus, success: true },
			{ event: "focusChanged", presentationId: 0, focus },
			{ event: "select", presentationId: 0, focus, mode: "single" },
			{ event: "intent", presentationId: 0, intent: "source", focus },
			{ event: "navigate", presentationId: 0, direction: "next", extend: false },
			{ event: "escape", presentationId: 0 },
		];
		if (id.draftId) {
			const sourceFocus = { ...focus, role: "source", selection: [0, 0] };
			bodies.push(
				{
					event: "sourceChanged",
					presentationId: 0,
					draftId: id.draftId,
					focus: sourceFocus,
					text: "Forged",
				},
				{
					event: "sourceAction",
					presentationId: 0,
					draftId: id.draftId,
					focus: sourceFocus,
					action: "saveSource",
					key: { ...key, key: "s", ctrlKey: true },
				},
			);
		}
		for (const body of bodies) {
			window.parent.postMessage(envelope(body), id.parentOrigin);
			window.parent.postMessage(envelope(body), { targetOrigin: id.parentOrigin, transfer: [] });
		}
		const patch = {
			source: "praxity-editor",
			version: 1,
			channel: id.channel,
			pageId: id.pageId,
			action: "nodes",
			render: {
				pageId: id.pageId,
				seq: 999999,
				fragments: [{ id: id.nodeId, html: `<div data-node-id="${id.nodeId}">Forged patch</div>` }],
			},
		};
		window.parent.postMessage(patch, id.parentOrigin);
		const rogue = new MessageChannel();
		window.parent.postMessage(envelope({ event: "ready" }), id.parentOrigin, [rogue.port2]);
		for (const body of bodies) rogue.port1.postMessage(envelope(body));
		rogue.port1.postMessage(patch);
		return bodies.map(envelope);
	}, captured);
	for (const message of forged) expect(isFrameEvent(message, identity)).toBe(true);
	await drainMessages(page, frame, identity.parentOrigin);
}
