import {
	inlineIconPlaceholder,
	renderInlineIcons,
	replaceInlineIconMarkup,
} from "@praxity/content-model/inline-icons";
import DOMPurify, { type Config, type HookName } from "isomorphic-dompurify";

type HeadingContent = { heading: string; body: string };
type SanitizedContent = string | HeadingContent;

// These policies contain only data. Reject mutable RegExps and callbacks rather
// than freezing them: Object.freeze does not prevent RegExp.compile mutations.
function freezePolicy<T extends Config>(policy: T): T {
	function freeze(value: unknown) {
		if (typeof value === "function" || value instanceof RegExp) {
			throw new Error("Memo policies must contain only immutable data");
		}
		if (!value || typeof value !== "object") return;
		for (const item of Object.values(value)) freeze(item);
		Object.freeze(value);
	}
	freeze(policy);
	return policy;
}

const PLAIN_TEXT_POLICY = freezePolicy({
	RETURN_DOM: true,
	USE_PROFILES: { html: true, svg: true, mathMl: true },
	FORBID_TAGS: ["script", "style"],
} satisfies Config);
const HEADING_POLICY = freezePolicy({
	RETURN_DOM: true,
	USE_PROFILES: { html: true, svg: true, mathMl: true },
} satisfies Config);
const HTML_POLICY = freezePolicy({
	USE_PROFILES: { html: true },
	FORBID_TAGS: ["script", "style", "iframe", "form", "input", "textarea", "select"],
	// USE_PROFILES already strips on* handlers. This is supplementary protection.
	FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
} satisfies Config);
const TOOLTIP_TEXT_POLICY = freezePolicy({ ALLOWED_TAGS: [], ALLOWED_ATTR: [] } satisfies Config);
const NONINTERACTIVE_POLICY = freezePolicy({
	FORBID_TAGS: ["a", "button", "summary", "audio", "video"],
	FORBID_ATTR: [
		"tabindex",
		"role",
		"data-tooltip-content",
		"data-tooltip-enhanced",
		"aria-expanded",
		"aria-controls",
	],
} satisfies Config);

// One LRU across all three helpers: at most 256 entries and 4 MiB of UTF-16
// input/output strings. Cache strings only, never DOM nodes or caller-owned objects.
const MAX_MEMO_ENTRIES = 256;
const MAX_MEMO_BYTES = 4 * 1024 * 1024;
const memo = new Map<string, { value: SanitizedContent; bytes: number }>();
let memoBytes = 0;
let lastRemoved: typeof DOMPurify.removed | undefined;

const HOOK_NAMES: HookName[] = [
	"beforeSanitizeElements",
	"uponSanitizeElement",
	"afterSanitizeElements",
	"beforeSanitizeAttributes",
	"uponSanitizeAttribute",
	"afterSanitizeAttributes",
	"beforeSanitizeShadowDOM",
	"uponSanitizeShadowNode",
	"afterSanitizeShadowDOM",
];

function clearMemo() {
	memo.clear();
	memoBytes = 0;
}

function hasHooks(): boolean {
	// Peek and restore the last hook in each stack without running any callbacks.
	const removeHook = DOMPurify.removeHook as (name: HookName) => unknown;
	const addHook = DOMPurify.addHook as (name: HookName, hook: unknown) => void;
	return HOOK_NAMES.some((name) => {
		const hook = removeHook(name);
		if (!hook) return false;
		addHook(name, hook);
		return true;
	});
}

function usesOwnedPolicies(): boolean {
	// The DOMPurify patch exposes persistent policies, including captured setters
	// and retained Trusted Types callbacks. Without it, bypass caching. Probing
	// by sanitizing would execute caller callbacks extra times.
	return Reflect.get(DOMPurify, "hasPersistentConfig") === false && !hasHooks();
}

function memoized<T extends SanitizedContent>(key: string, compute: () => T): T {
	// External sanitization or clearWindow replaces this public array. Discard
	// old results before considering a cache hit.
	if (DOMPurify.removed !== lastRemoved) {
		clearMemo();
	}
	if (!usesOwnedPolicies()) {
		clearMemo();
		try {
			return compute();
		} finally {
			lastRemoved = DOMPurify.removed;
		}
	}
	const cached = memo.get(key);
	if (cached) {
		memo.delete(key);
		memo.set(key, cached);
		return (typeof cached.value === "string" ? cached.value : { ...cached.value }) as T;
	}
	let value: T;
	try {
		value = compute();
	} finally {
		lastRemoved = DOMPurify.removed;
	}
	if (usesOwnedPolicies()) {
		const bytes =
			2 *
			(key.length +
				(typeof value === "string" ? value.length : value.heading.length + value.body.length));
		if (bytes <= MAX_MEMO_BYTES) {
			while (memo.size >= MAX_MEMO_ENTRIES || memoBytes + bytes > MAX_MEMO_BYTES) {
				const oldest = memo.keys().next().value;
				if (oldest === undefined) break;
				const entry = memo.get(oldest);
				if (entry) memoBytes -= entry.bytes;
				memo.delete(oldest);
			}
			memo.set(key, {
				value: typeof value === "string" ? value : { ...value },
				bytes,
			});
			memoBytes += bytes;
		}
	}
	return value;
}

function* descendants(root: Element): Generator<Element> {
	const pending = Array.from(root.children).reverse();
	while (pending.length) {
		const element = pending.pop();
		if (!element) break;
		yield element;
		for (let i = element.children.length - 1; i >= 0; i--) {
			const child = element.children.item(i);
			if (child) pending.push(child);
		}
	}
}

/** Plain DOM text for React children and labels. Escape only when emitting HTML. */
export function htmlToPlainText(html: string): string {
	return memoized(`text:${html}`, () => plainText(html));
}

function plainText(html: string): string {
	const sanitized = DOMPurify.sanitize(html, PLAIN_TEXT_POLICY);
	if (sanitized.nodeType !== 1) throw new Error("Expected sanitized HTML element");
	const root = sanitized as Element;
	// Preserve the spacing formerly supplied by stripped tags without serializing
	// entities back into text. French non-breaking spaces remain authored characters.
	for (const element of descendants(root)) {
		element.before(" ");
		element.after(" ");
	}
	return (root.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ").trim();
}

const TOOLTIP_TRIGGER_RE =
	/<([a-z][\w-]*)([^>]*\bdata-tooltip-content="([^"]*)"[^>]*)>([\s\S]*?)<\/\1>/giu;

function addTooltipFallbacks(html: string): string {
	return html.replace(TOOLTIP_TRIGGER_RE, (match, tag, attributes, definition, content) => {
		if (String(content).includes("inline-tooltip-fallback")) return match;
		const text = DOMPurify.sanitize(String(definition), TOOLTIP_TEXT_POLICY);
		return `<${tag}${attributes}>${content}<span class="inline-tooltip-fallback"> (${text})</span></${tag}>`;
	});
}

function preserveInlineIconSvg(html: string): string {
	return replaceInlineIconMarkup(html, (source, _spec, nodes, tag, original) => {
		if (tag !== "svg") return original;
		return nodes ? (inlineIconPlaceholder(source, nodes) ?? original) : `@icon{${source}}`;
	});
}

/**
 * Sanitize HTML content for safe rendering with dangerouslySetInnerHTML.
 * Strips scripts, iframes, forms, and dangerous event handlers.
 * Build-generated inline-icon markers are reconstructed only after DOMPurify
 * has removed authored SVG and other unsafe markup. Pass
 * `{ renderInlineIcons: false }` when preserving markers in inert JSON.
 *
 * Note: `data-tooltip-content` attributes carry user-authored HTML (from the
 * inline tooltip TipTap mark). The attribute value passes through DOMPurify
 * here because data-* attributes are allowed by default. The shared tooltip
 * enhancer applies a narrow element and attribute allowlist before injecting it
 * into the DOM.
 */
export function sanitizeHtml(
	html: string,
	options?: { renderInlineIcons?: boolean; interactive?: boolean },
): string {
	// Caller objects may have getters or mutate while sanitization runs.
	if (options !== undefined) return sanitizedHtml(html, options);
	return memoized(`html:${html}`, () => sanitizedHtml(html));
}

function sanitizedHtml(
	html: string,
	options?: { renderInlineIcons?: boolean; interactive?: boolean },
): string {
	const sanitized = DOMPurify.sanitize(preserveInlineIconSvg(html), HTML_POLICY);
	let withTooltipFallbacks = addTooltipFallbacks(sanitized);
	if (options?.interactive === false) {
		// Labels inside controls cannot contain another focus target. Keep tooltip
		// definitions as ordinary text, including legacy HTML and prepared caches.
		withTooltipFallbacks = DOMPurify.sanitize(withTooltipFallbacks, NONINTERACTIVE_POLICY);
	}
	return options?.renderInlineIcons === false
		? withTooltipFallbacks
		: renderInlineIcons(withTooltipFallbacks);
}

export const BLOCK_NAMES = new Set(
	"address,article,aside,blockquote,caption,center,col,colgroup,dd,details,dialog,dir,div,dl,dt,fieldset,figcaption,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hgroup,hr,legend,li,main,menu,nav,ol,p,pre,search,section,summary,table,tbody,td,tfoot,th,thead,tr,ul".split(
		",",
	),
);

function containsBlock(root: Element): boolean {
	for (const element of descendants(root)) {
		if (BLOCK_NAMES.has(element.localName)) return true;
	}
	return false;
}

/** Split a rich question into a phrasing-only heading and its supporting blocks. */
export function splitHeadingContent(html: string): HeadingContent {
	return memoized(`heading:${html}`, () => headingContent(html));
}

function headingContent(html: string): HeadingContent {
	const sanitized = DOMPurify.sanitize(html, HEADING_POLICY);
	if (sanitized.nodeType !== 1) throw new Error("Expected sanitized HTML element");
	const root = sanitized as Element;
	const first = root.firstElementChild;
	const firstContent = Array.from(root.childNodes).find(
		(node) => node.nodeType === 1 || node.textContent?.trim(),
	);
	if (
		first &&
		firstContent === first &&
		/^(p|div|h[1-6])$/.test(first.localName) &&
		!containsBlock(first)
	) {
		const heading = first.innerHTML;
		first.remove();
		return { heading, body: root.innerHTML.trim() };
	}
	const heading = root.ownerDocument.createElement("span");
	while (root.firstChild) {
		const node = root.firstChild;
		if (
			node.nodeType === 1 &&
			(BLOCK_NAMES.has((node as Element).localName) || containsBlock(node as Element))
		)
			break;
		heading.appendChild(node);
	}
	return { heading: heading.innerHTML.trim(), body: root.innerHTML.trim() };
}
