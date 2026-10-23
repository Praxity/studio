import { type DefaultTreeAdapterMap, parseFragment } from "parse5";
import { escapeTypst, typstString } from "./escaping.ts";

type HtmlNode = DefaultTreeAdapterMap["childNode"];
export interface TypstHtmlOptions {
	/** Return undefined to use the shared semantic HTML mapping. */
	element?: (node: DefaultTreeAdapterMap["element"], content: string) => string | undefined;
}

export { escapeTypst, typstString } from "./escaping.ts";

/** Only external web/email links. Unsafe targets retain their visible content. */
export function safeTypstLink(url: string, content: string): string {
	if (!/^(https?:|mailto:)/i.test(url) || /[\u0000-\u0020\u007f-\u009f]/.test(url)) {
		return content;
	}
	try {
		new URL(url);
		return `#link(${typstString(url)})[${content}]`;
	} catch {
		return content;
	}
}

function plainNode(node: HtmlNode): string {
	if ("value" in node) return node.value;
	if (!("tagName" in node)) return "";
	if (["script", "style", "template"].includes(node.tagName)) return "";
	const content = node.childNodes.map(plainNode).join("");
	if (node.tagName === "br") return "\n";
	if (node.tagName === "li") return `- ${content}\n`;
	if (["p", "div", "blockquote"].includes(node.tagName)) return `${content}\n\n`;
	return content;
}

export function decodeHtmlEntities(text: string): string {
	return parseFragment(text.replaceAll("<", "&lt;")).childNodes.map(plainNode).join("");
}

// Trim layout whitespace without removing intentional no-break spaces.
function trimLayout(text: string): string {
	return text.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
}

export function stripHtml(html: string): string {
	return trimLayout(parseFragment(html).childNodes.map(plainNode).join(""));
}

function attribute(node: DefaultTreeAdapterMap["element"], name: string): string | undefined {
	return node.attrs.find((attr) => attr.name === name)?.value;
}

function integer(value: string | undefined): number | undefined {
	if (value === undefined || !/^[+-]?\d+$/.test(value.trim())) return undefined;
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : undefined;
}

export function typstLanguage(locale: string): string {
	const language = new Intl.Locale(locale);
	return `lang: ${typstString(language.language)}, region: ${language.region ? typstString(language.region) : "none"}`;
}

function typstNode(node: HtmlNode, options?: TypstHtmlOptions): string {
	const content = renderTypstNode(node, options);
	const locale = "tagName" in node ? attribute(node, "lang") : undefined;
	return locale ? `#text(${typstLanguage(locale)})[${content}]` : content;
}

function renderTypstNode(node: HtmlNode, options?: TypstHtmlOptions): string {
	if ("value" in node) return escapeTypst(node.value.replace(/[\t\n\r ]+/g, " "));
	if (!("tagName" in node)) return "";
	const tag = node.tagName;
	if (["script", "style", "template"].includes(tag)) return "";
	if (tag === "code" || tag === "pre") {
		return `#raw(${typstString(node.childNodes.map(plainNode).join(""))}${tag === "pre" ? ", block: true" : ""})`;
	}
	if (tag === "ol" || tag === "ul") {
		const items = node.childNodes.filter(
			(child): child is DefaultTreeAdapterMap["element"] =>
				"tagName" in child && child.tagName === "li",
		);
		const ordered = tag === "ol";
		const reversed = attribute(node, "reversed") !== undefined;
		let number = integer(attribute(node, "start")) ?? (reversed ? items.length : 1);
		const numbers = items.map((item) => {
			number = integer(attribute(item, "value")) ?? number;
			const current = number;
			number += reversed ? -1 : 1;
			return current;
		});
		// Typst item numbers cannot be negative; retain HTML labels via its numbering function.
		const signed = ordered && numbers.some((value) => value < 0);
		const numbering = signed
			? `numbering: n => (${numbers.map((value) => typstString(`${value}.`)).join(", ")},).at(n - 1), `
			: "";
		const entries = items.map((item, index) => {
			const content = trimLayout(typstNode(item, options));
			if (!ordered) return `[${content}]`;
			return `enum.item(${signed ? index + 1 : numbers[index]}, [${content}])`;
		});
		return `\n\n#${ordered ? "enum" : "list"}(${numbering}${entries.join(", ")})\n\n`;
	}
	const content = node.childNodes.map((child) => typstNode(child, options)).join("");
	const custom = options?.element?.(node, content);
	if (custom !== undefined) return custom;
	switch (tag) {
		case "strong":
		case "b":
			return `#strong[${content}]`;
		case "em":
		case "i":
			return `#emph[${content}]`;
		case "s":
		case "del":
			return `#strike[${content}]`;
		case "u":
			return `#underline[${content}]`;
		case "sup":
			return `#super[${content}]`;
		case "sub":
			return `#sub[${content}]`;
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6":
			return `\n\n#heading(level: ${tag[1]})[${content}]\n\n`;
		case "a":
			return safeTypstLink(attribute(node, "href") ?? "", content);
		case "br":
			return "#linebreak()";
		case "p":
		case "div":
			return `\n\n${content}\n\n`;
		case "blockquote":
			return `\n\n#quote(block: true)[${trimLayout(content)}]\n\n`;
		default:
			return content;
	}
}

export function htmlToTypst(html: string, options?: TypstHtmlOptions): string {
	return trimLayout(
		parseFragment(html)
			.childNodes.map((node) => typstNode(node, options))
			.join(""),
	);
}
