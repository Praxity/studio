export const INSPECTION_INVOKER_ATTRIBUTES = [
	"command",
	"commandfor",
	"popovertarget",
	"popovertargetaction",
	"interestfor",
] as const;

export function bindInspectionFragmentLinks(
	root: Document | DocumentFragment,
	documentUrl: string,
): void {
	for (const anchor of root.querySelectorAll("a[href],area[href]")) {
		const href = anchor.getAttribute("href")?.trim();
		if (href?.startsWith("#")) anchor.setAttribute("href", `${documentUrl}${href}`);
	}
}

export function stripInspectionMarkup(
	root: Document | DocumentFragment,
	authorDocument = false,
): void {
	for (const element of root.querySelectorAll("script"))
		if (element.getAttribute("type") !== "application/json") element.remove();
	for (const element of root.querySelectorAll("[nonce]")) element.removeAttribute("nonce");
	if (authorDocument) {
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
	for (const element of root.querySelectorAll("meta[http-equiv]"))
		if (element.getAttribute("http-equiv")?.trim().toLowerCase() === "refresh") element.remove();
	for (const template of root.querySelectorAll("template")) {
		template.removeAttribute("shadowrootmode");
		template.removeAttribute("shadowroot");
		stripInspectionMarkup(template.content, authorDocument);
	}
}
