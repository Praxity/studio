/**
 * Declarative invokers open a modal dialog or a popover in the top layer without any
 * script, above the Page lens handles; an interest invoker does so on hover alone.
 * The editing lens removes them while mounted and restores them on disposal. The
 * read-only page view keeps them: it has no handles and keeps learner behaviour.
 */
export const INSPECTION_INVOKER_ATTRIBUTES = [
	"command",
	"commandfor",
	"popovertarget",
	"popovertargetaction",
	"interestfor",
] as const;

/** The author document's base points at learner assets; fragments stay with its visible page. */
export function bindInspectionFragmentLinks(
	root: Document | DocumentFragment,
	documentUrl: string,
): void {
	for (const anchor of root.querySelectorAll("a[href],area[href]")) {
		const href = anchor.getAttribute("href")?.trim();
		if (href?.startsWith("#")) anchor.setAttribute("href", `${documentUrl}${href}`);
	}
}

/**
 * Markup a Page inspection never admits, in the served document and in every node
 * patch: executable scripts, CSP nonces, refreshes and declarative shadow roots.
 * Works on any DOM (jsdom on the server, the inspection document in the browser).
 */
export function stripInspectionMarkup(
	root: Document | DocumentFragment,
	authorDocument = false,
): void {
	// JSON data blocks never execute. The Page lens reads its logic config from them.
	for (const element of root.querySelectorAll("script"))
		if (element.getAttribute("type") !== "application/json") element.remove();
	for (const element of root.querySelectorAll("[nonce]")) element.removeAttribute("nonce");
	if (authorDocument) {
		// noscript changes parsing mode in a browser; never serialize its hidden markup.
		for (const element of root.querySelectorAll("noscript")) element.remove();
		for (const element of root.querySelectorAll("meta[name]"))
			if (element.getAttribute("name")?.trim().toLowerCase() === "referrer") element.remove();
		for (const element of root.querySelectorAll("*")) {
			for (const attribute of [...element.attributes]) {
				const name = attribute.name.toLowerCase();
				if (
					name.startsWith("on") ||
					name.startsWith("data-praxity-author-") ||
					name === "data-focus-role" ||
					name === "referrerpolicy" ||
					INSPECTION_INVOKER_ATTRIBUTES.some((invoker) => invoker === name)
				)
					element.removeAttribute(attribute.name);
			}
		}
	}
	// Only the host navigates the Page lens. A refresh would load a learner page there.
	for (const element of root.querySelectorAll("meta[http-equiv]"))
		if (element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") element.remove();
	for (const template of root.querySelectorAll("template")) {
		// A declared shadow root would hide its links from the bridge's click guard.
		template.removeAttribute("shadowrootmode");
		template.removeAttribute("shadowroot");
		stripInspectionMarkup(template.content, authorDocument);
	}
}
