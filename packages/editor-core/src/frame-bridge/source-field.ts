import { sourceField as english } from "../messages/en.json";
import { sourceField as french } from "../messages/fr.json";
import { measureOrigins, positionFixed } from "./geometry";
import type { FrameFocus, FrameSource } from "./protocol";

/** Native field lifetime; admission and trust-marker reads stay in the Page lens. */
export function mountSourceField(options: {
	document: Document;
	source: FrameSource;
	file: string;
	descriptionId: string;
	guardLayer: string;
	token: (theme: "light" | "dark", name: string) => string;
	anchor: HTMLElement;
	registerChrome: (element: Element, kind?: "geometry" | "popup") => void;
	registerControl: (element: HTMLElement, focus: FrameFocus) => void;
}) {
	const { document: doc, registerChrome, registerControl } = options;
	const defaultView = doc.defaultView;
	if (!defaultView) throw new Error("Source field needs a live document");
	const win = defaultView;
	const slot = doc.createElement("div");
	slot.setAttribute("data-praxity-chrome", "source-slot");
	registerChrome(slot);
	const group = doc.createElement("div");
	group.setAttribute("data-praxity-chrome", "source-group");
	registerChrome(group);
	// The root's display mode stays admitted for this editing transaction. The body
	// remains course-owned, including flex/grid layout and deliberate hiding.
	const display = win.getComputedStyle(doc.documentElement).display;
	const rootGuard = doc.createElement("style");
	registerChrome(rootGuard);
	rootGuard.textContent = `@layer ${options.guardLayer} {
:root:has(> [data-praxity-chrome="source-group"]) { display:${display === "none" || !display ? "block" : display} !important; content-visibility:visible !important; transition:none !important; }
}`;
	doc.head.append(rootGuard);
	const root = group.attachShadow({ mode: "open" });
	const presentation = doc.createElement("style");
	presentation.textContent = sourceFieldShadowCss(options.token);
	root.append(presentation);
	const geometryStyle = doc.createElement("style");
	const geometryText = doc.createTextNode("");
	geometryStyle.append(geometryText);
	root.append(geometryStyle);
	const inner = doc.createElement("div");
	inner.setAttribute("role", "group");
	root.append(inner);
	function syncGeometry() {
		// Important shadow rules outrank even inline host geometry in the outer tree.
		const next = `:host { ${group.style.cssText} }`;
		if (geometryText.data !== next) geometryText.data = next;
	}
	const caption = doc.createElement("div");
	const captionText = doc.createTextNode("");
	caption.append(captionText);
	caption.setAttribute("data-praxity-chrome", "source-caption");
	caption.id = options.descriptionId;
	registerChrome(caption);
	const description = doc.createElement("div");
	description.id = `${options.descriptionId}-context`;
	description.hidden = true;
	const descriptionText = doc.createTextNode("");
	description.append(descriptionText);
	const field = doc.createElement("textarea");
	field.spellcheck = false;
	// The native field owns text and editing history until this draft closes.
	field.value = options.source.value;
	field.setSelectionRange(0, 0);
	field.setAttribute("aria-describedby", description.id);
	const closer = doc.createElement("div");
	const diagnostic = doc.createElement("div");
	// Preserve native typing groups across repeated diagnostic projections.
	const diagnosticText = doc.createTextNode("");
	diagnostic.append(diagnosticText);
	diagnostic.setAttribute("data-praxity-chrome", "source-diagnostic");
	diagnostic.id = `${options.descriptionId}-diagnostic`;
	let baseText = options.source.baseText ?? options.source.value;
	closer.setAttribute("data-praxity-chrome", "source-closer");
	closer.setAttribute("aria-hidden", "true");
	closer.textContent = ":::";
	registerChrome(closer);
	inner.append(description, caption, field);
	// Course patches may replace or move the slot, never the native editing group.
	doc.documentElement.append(group);
	registerControl(field, { file: options.file, nodeId: options.source.nodeId, role: "source" });
	let anchor = options.anchor;
	let originalStyle = anchor.getAttribute("style");
	let originalHidden = anchor.getAttribute("aria-hidden");
	let lastBox = { left: 8, top: 8, width: Math.max(1, win.innerWidth - 16) };
	let presenting = true;
	let disposed = false;
	let lastOrigin = new win.DOMRect(0, 0, 100, 100);
	const geometryProbes = new Map<Element | null, HTMLElement>();
	const popover = typeof group.showPopover === "function";
	if (popover) group.setAttribute("popover", "manual");
	function restore() {
		if (originalStyle === null) anchor.removeAttribute("style");
		else anchor.setAttribute("style", originalStyle);
		if (originalHidden === null) anchor.removeAttribute("aria-hidden");
		else anchor.setAttribute("aria-hidden", originalHidden);
	}
	function attach(next: HTMLElement | undefined) {
		if (!next) {
			slot.hidden = true;
			return;
		}
		slot.hidden = false;
		if (next !== anchor) {
			restore();
			anchor = next;
			originalStyle = anchor.getAttribute("style");
			originalHidden = anchor.getAttribute("aria-hidden");
		}
		if (!slot.isConnected) anchor.before(slot);
		if (
			anchor.style.getPropertyValue("display") !== "none" ||
			anchor.style.getPropertyPriority("display") !== "important"
		)
			anchor.style.setProperty("display", "none", "important");
		if (anchor.getAttribute("aria-hidden") !== "true") anchor.setAttribute("aria-hidden", "true");
	}
	function update(source: FrameSource, language: "en" | "fr", theme: "light" | "dark") {
		baseText = source.baseText ?? baseText;
		if (source.diagnostic) {
			if (diagnosticText.data !== source.diagnostic) diagnosticText.data = source.diagnostic;
			if (!diagnostic.isConnected) field.after(diagnostic);
			if (source.invalid) {
				if (field.getAttribute("aria-invalid") !== "true")
					field.setAttribute("aria-invalid", "true");
			} else field.removeAttribute("aria-invalid");
		} else {
			if (diagnosticText.data) diagnosticText.data = "";
			field.removeAttribute("aria-invalid");
		}
		const describedBy = source.diagnostic ? `${description.id} ${diagnostic.id}` : description.id;
		if (field.getAttribute("aria-describedby") !== describedBy)
			field.setAttribute("aria-describedby", describedBy);
		if (group.lang !== language) group.lang = language;
		if (group.getAttribute("data-source-theme") !== theme)
			group.setAttribute("data-source-theme", theme);
		if (inner.lang !== language) inner.lang = language;
		const groupName = (language === "fr" ? french : english).group;
		if (inner.getAttribute("aria-label") !== groupName) inner.setAttribute("aria-label", groupName);
		if (field.getAttribute("aria-label") !== source.name)
			field.setAttribute("aria-label", source.name);
		if (descriptionText.data !== (source.description ?? ""))
			descriptionText.data = source.description ?? "";
		if (captionText.data !== source.caption) captionText.data = source.caption;
		if (source.closer && !closer.isConnected) inner.append(closer);
		closer.hidden = !source.closer;
		const rows = Math.max(3, Math.min(20, source.value.split("\n").length));
		if (field.rows !== rows) field.rows = rows;
	}
	function position() {
		if (!presenting || disposed) return;
		if (popover && !group.matches(":popover-open")) group.showPopover();
		const box = slot.getBoundingClientRect();
		if (box.width > 0) lastBox = { left: box.left, top: box.top, width: box.width };
		const viewport = win.visualViewport;
		const viewportWidth = viewport?.width ?? win.innerWidth;
		const viewportHeight = viewport?.height ?? win.innerHeight;
		const left = viewport?.offsetLeft ?? 0;
		const top = viewport?.offsetTop ?? 0;
		const availableWidth = Math.max(1, viewportWidth - 16);
		const width = Math.min(availableWidth, Math.max(320, lastBox.width));
		for (const [name, value] of [
			["width", `${width}px`],
			["max-height", `${Math.max(1, viewportHeight - 16)}px`],
			["height", "auto"],
		])
			if (
				group.style.getPropertyValue(name) !== value ||
				group.style.getPropertyPriority(name) !== "important"
			)
				group.style.setProperty(name, value, "important");
		syncGeometry();
		const height = group.getBoundingClientRect().height;
		const measured = measureOrigins([group], registerChrome, geometryProbes).get(
			group.parentElement,
		);
		if (measured && measured.width > 0 && measured.height > 0) lastOrigin = measured;
		positionFixed(
			group,
			{
				left: Math.max(left + 8, Math.min(lastBox.left, left + viewportWidth - width - 8)),
				top: Math.max(top + 8, Math.min(lastBox.top, top + viewportHeight - height - 8)),
				width,
				height: "auto",
			},
			registerChrome,
			false,
			new Map([[group.parentElement, lastOrigin]]),
		);
		syncGeometry();
		if (
			slot.style.getPropertyValue("height") !== `${height}px` ||
			slot.style.getPropertyPriority("height") !== "important"
		)
			slot.style.setProperty("height", `${height}px`, "important");
	}
	attach(anchor);
	return {
		slot,
		field,
		group,
		attach,
		update,
		position,
		atBase: () => field.value === baseText,
		setPresenting(active: boolean) {
			if (disposed) return;
			presenting = active;
			if (!active && root.activeElement === field) field.blur();
			field.disabled = !active;
			group.inert = !active;
			group.setAttribute("data-suspended", String(!active));
			if (!active && popover && group.matches(":popover-open")) group.hidePopover();
			if (active) position();
		},
		dispose() {
			disposed = true;
			restore();
			slot.remove();
			group.remove();
			rootGuard.remove();
			for (const probe of geometryProbes.values()) probe.remove();
		},
	};
}

/** Included in the lens's first, nonce-named important layer. */
export function sourceFieldGuardCss() {
	return '[data-praxity-chrome="source-slot"] { all:initial; display:block; box-sizing:border-box; width:100%; margin:4px 0 12px; pointer-events:none; } [data-praxity-chrome="source-slot"][hidden] { display:none; }';
}

function sourceFieldShadowCss(token: (theme: "light" | "dark", name: string) => string) {
	const group = ":host";
	const field = "textarea";
	const rules = `
${group} { all:initial; direction:ltr; unicode-bidi:isolate; position:fixed; display:block; box-sizing:border-box; margin:0; padding:4px; border:0; border-radius:6px; opacity:1; visibility:visible; overflow:auto; scrollbar-width:thin; pointer-events:auto; isolation:isolate; font:13px/1.45 sans-serif; }
:host([data-suspended="true"]) { display:none; pointer-events:none; }
${group}, * { filter:none; transform:none; scale:none; rotate:none; clip-path:none; mask:none; content-visibility:visible; animation:none; transition:none; }
${group}::before, ${group}::after, ${group}::backdrop, *::before, *::after { all:initial; content:none; display:none; pointer-events:none; }
:host::scroll-button(*) { content:none; display:none; }
div { all:initial; direction:ltr; unicode-bidi:isolate; display:block; opacity:1; visibility:visible; font:12px/1.5 sans-serif; overflow-wrap:anywhere; }
div::first-line, div::first-letter { all:initial; color:inherit; font:inherit; }
div[hidden] { display:none; }
[data-praxity-chrome="source-caption"] { margin:0 0 6px; }
${field} { all:initial; direction:ltr; unicode-bidi:isolate; display:block; box-sizing:border-box; width:100%; min-height:88px; padding:10px 14px; border:1px solid; border-radius:6px; opacity:1; visibility:visible; pointer-events:auto; resize:vertical; white-space:pre-wrap; overflow:auto; scrollbar-width:thin; overflow-wrap:anywhere; font:14px/1.5 monospace; }
${field}:focus { outline:2px solid; outline-offset:2px; }
[data-praxity-chrome="source-closer"] { margin-top:6px; font:14px/1.5 monospace; }
[data-praxity-chrome="source-closer"][hidden] { display:none; }
[data-praxity-chrome="source-diagnostic"]:empty { display:none; }
${(["light", "dark"] as const)
	.map((theme) => {
		const root = `:host([data-source-theme="${theme}"])`;
		return `${root} { background:${token(theme, "--paper")}; color-scheme:${theme}; }
${root} div { color:${token(theme, "--ink-2")}; }
${root} ${field} { background:${token(theme, "--paper")}; color:${token(theme, "--ink")}; caret-color:${token(theme, "--ink")}; border-color:${token(theme, "--edge")}; }
${root} ${field}:focus { outline-color:${token(theme, "--focus")}; }
${root} ${field}[aria-invalid="true"] { box-shadow:inset 3px 0 ${token(theme, "--danger")}; }
${root} [data-praxity-chrome="source-diagnostic"] { color:${token(theme, "--danger")}; margin-top:6px; }
${root} ${field}::selection { color:${token(theme, "--paper")}; background:${token(theme, "--focus")}; text-shadow:none; }`;
	})
	.join("\n")}`;
	return rules.replaceAll(";", " !important;");
}
