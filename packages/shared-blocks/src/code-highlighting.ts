import type { PrismTheme } from "prism-react-renderer";

const LANGUAGE_NAMES: Record<string, string> = {
	javascript: "JavaScript",
	typescript: "TypeScript",
	python: "Python",
	html: "HTML",
	css: "CSS",
	json: "JSON",
	sql: "SQL",
	java: "Java",
	cpp: "C/C++",
	rust: "Rust",
	php: "PHP",
	xml: "XML",
	markdown: "Markdown",
	yaml: "YAML",
	ruby: "Ruby",
	go: "Go",
	bash: "Bash",
	plain: "Plain Text",
};

const PRISM_LANGUAGES: Record<string, string> = {
	html: "markup",
	xml: "markup",
	plain: "plain",
};

// Four roles, resolved by the containing course palette in either mode.
export const LIGHT_THEME: PrismTheme = {
	plain: { color: "var(--ink)", backgroundColor: "transparent" },
	styles: [
		{
			types: ["comment", "prolog", "doctype", "cdata"],
			style: { color: "var(--syntax-comment)", fontStyle: "italic" },
		},
		{
			types: ["keyword", "tag", "atrule"],
			style: { color: "var(--syntax-keyword)" },
		},
		{
			types: ["string", "char", "attr-value", "regex"],
			style: { color: "var(--syntax-string)" },
		},
		{
			types: ["function", "class-name", "number", "boolean", "constant", "symbol"],
			style: { color: "var(--syntax-function)" },
		},
	],
};
export const DARK_THEME = LIGHT_THEME;

export function codeLanguageName(language: string): string {
	return LANGUAGE_NAMES[language] ?? language;
}

export function prismLanguageName(language: string): string {
	return PRISM_LANGUAGES[language] ?? language;
}
