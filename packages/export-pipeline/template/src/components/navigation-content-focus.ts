/** CSS fallback for browsers without checkVisibility. */
function cssVisible(element: HTMLElement | null): boolean {
	if (!element) return true;
	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	if (!style) return true;
	return (
		!/none|hidden|collapse/u.test(style.display + style.visibility + style.contentVisibility) &&
		cssVisible(element.parentElement)
	);
}

/** Arrival never sends focus into hidden author content or a closed disclosure. */
export function resumeFocusTarget(content: HTMLElement, headings = "h1, h2"): HTMLElement {
	return (
		[...content.querySelectorAll<HTMLElement>(headings)].find((heading) => {
			if (
				heading.closest(
					"[hidden],[inert],[aria-hidden='true'],.praxity-sr-only,details:not([open])",
				)
			)
				return false;
			return heading.checkVisibility?.({ visibilityProperty: true }) ?? cssVisible(heading);
		}) ?? content
	);
}

/** Temporarily orient content without changing authored keyboard navigation. */
export function focusNavigationContent(target: HTMLElement, main: HTMLElement): () => void {
	const tabindex = target.getAttribute("tabindex");
	const hadClass = target.classList.contains("praxity-navigation-focus");
	if (target !== main || tabindex === null) target.tabIndex = -1;
	target.classList.add("praxity-navigation-focus");
	const release = () => {
		target.removeEventListener("blur", release);
		window.removeEventListener("pagehide", release);
		if (tabindex === null) target.removeAttribute("tabindex");
		else target.setAttribute("tabindex", tabindex);
		if (!hadClass) target.classList.remove("praxity-navigation-focus");
	};
	target.addEventListener("blur", release, { once: true });
	window.addEventListener("pagehide", release, { once: true });
	target.focus({ preventScroll: true });
	return release;
}
