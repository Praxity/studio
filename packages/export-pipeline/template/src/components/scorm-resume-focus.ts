import { resumeFocusTarget } from "./navigation-content-focus";

export { resumeFocusTarget } from "./navigation-content-focus";

export interface ScormResumeCueOptions {
	pageTitle: string;
	positionPrefix: string;
	summary: string;
}

const resumeCues = new WeakMap<
	HTMLElement,
	[node: HTMLElement, target: HTMLElement, focused?: boolean]
>();

export function presentScormResumeCue(
	content: HTMLElement,
	options: ScormResumeCueOptions,
): HTMLElement {
	const existing = resumeCues.get(content);
	if (existing && content.contains(existing[0])) return existing[1];

	const heading = resumeFocusTarget(content);
	const useHeading =
		heading !== content &&
		!heading.matches("[aria-label],[aria-labelledby]") &&
		heading.textContent?.trim() === options.pageTitle.trim();
	const node = content.ownerDocument.createElement(useHeading ? "span" : "p");
	node.className = useHeading ? "praxity-resume-prefix" : "praxity-resume-summary";
	node.textContent = useHeading
		? options.positionPrefix
		: options.positionPrefix.replace(/\s*:\s*$/u, "");
	if (!useHeading) {
		const title = content.ownerDocument.createElement("span");
		title.className = "praxity-a11y-sr-only";
		title.textContent = options.summary.slice(node.textContent.length);
		node.append(title);
	}
	const target = useHeading ? heading : node;
	(useHeading ? heading : content).prepend(node);
	resumeCues.set(content, [node, target]);
	return target;
}

export function removeScormResumeCue(content: HTMLElement): void {
	for (const owner of [content, ...content.querySelectorAll<HTMLElement>("*")]) {
		resumeCues.get(owner)?.[0].remove();
		resumeCues.delete(owner);
	}
}

export function focusScormResumePage(doc: Document, options: ScormResumeCueOptions): void {
	const main = doc.querySelector<HTMLElement>("main, [role=main]") ?? doc.body;
	const target = presentScormResumeCue(main, options);
	// biome-ignore lint/style/noNonNullAssertion: presentScormResumeCue always registers this cue.
	const cue = resumeCues.get(main)!;
	if (cue[2]) return;
	cue[2] = true;
	target.tabIndex = -1;
	target.focus();
	doc.defaultView?.addEventListener("pagehide", () => cue[0].remove());
}
