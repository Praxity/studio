import { renderMath } from "@praxity/shared-blocks/math";
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";
import { typstString } from "../renderers/typst/escaping.ts";

// Reviewed against MiTeX 0.2.7. Unknown commands fail rather than reaching its
// dimension eval handlers or commands that silently discard authored content.
const commands = new Set(
	`
frac dfrac tfrac binom dbinom tbinom sqrt left right
hat widehat tilde widetilde bar vec dot ddot
overline underline overbrace underbrace overset underset
text textbf textit textrm mathrm mathbf mathit mathsf mathtt mathbb mathcal mathfrak operatorname
alpha beta gamma delta epsilon varepsilon theta vartheta lambda mu pi rho sigma tau phi varphi chi psi omega
Gamma Delta Theta Lambda Pi Sigma Phi Psi Omega
sin cos tan ln log exp lim min max det gcd sum prod int iint iiint oint
infty partial nabla ell le leq ge geq neq approx equiv sim times div pm mp cdot
in notin subset subseteq supset supseteq cup cap emptyset forall exists
to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow
ldots cdots vdots ddots langle rangle lvert rvert lVert rVert quad qquad
begin end
`
		.trim()
		.split(/\s+/),
);
const environments = new Set([
	"matrix",
	"pmatrix",
	"bmatrix",
	"Bmatrix",
	"vmatrix",
	"Vmatrix",
	"cases",
]);
const escapedCharacters = new Set([
	"\\",
	"{",
	"}",
	"_",
	"%",
	"#",
	"&",
	"$",
	",",
	";",
	":",
	"!",
	"|",
	" ",
]);

export function renderPdfEquation(
	latex: unknown,
	alt: unknown,
	locale: string,
	block: boolean,
	fail: (message: string) => never,
): string {
	if (typeof latex !== "string" || !latex.trim() || latex.length > 8192) {
		return fail("Equations need nonempty LaTeX of at most 8192 characters.");
	}
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(latex)) {
		return fail("Equation LaTeX contains control characters.");
	}
	let depth = 0;
	const environmentStack: string[] = [];
	for (let index = 0; index < latex.length; index++) {
		const char = latex[index];
		if (char === "%" || char === "$")
			return fail("Equation comments and math delimiters are unsupported.");
		if (char === "{") {
			if (++depth + environmentStack.length > 64)
				return fail("Equation nesting exceeds 64 levels.");
		} else if (char === "}") {
			if (--depth < 0) return fail("Equation braces are unbalanced.");
		} else if (char === "\\") {
			const command = /^[A-Za-z]+/.exec(latex.slice(index + 1))?.[0];
			if (!command) {
				if (!escapedCharacters.has(latex[++index])) return fail("Unsupported equation escape.");
				continue;
			}
			if (!commands.has(command)) return fail(`Unsupported equation command: \\${command}.`);
			index += command.length;
			if (command === "begin" || command === "end") {
				const match = /^\s*\{([A-Za-z]+)\}/.exec(latex.slice(index + 1));
				if (!match || !environments.has(match[1])) return fail("Unsupported equation environment.");
				if (command === "begin") {
					environmentStack.push(match[1]);
					if (depth + environmentStack.length > 64)
						return fail("Equation nesting exceeds 64 levels.");
				} else if (environmentStack.pop() !== match[1])
					return fail("Equation environments are unbalanced.");
				index += match[0].length;
			}
		}
	}
	if (depth || environmentStack.length)
		return fail("Equation braces or environments are unbalanced.");
	if (alt != null && typeof alt !== "string") return fail("Equation alternatives must be text.");
	const authoredAlt = typeof alt === "string" ? alt.trim() : "";
	let english = false;
	try {
		english = new Intl.Locale(locale).language === "en";
	} catch {
		return fail("Equation language is invalid.");
	}

	let speech: string | undefined;
	function inspect(node: DefaultTreeAdapterMap["childNode"]): void {
		if (!("tagName" in node)) return;
		const classes = node.attrs.find((attr) => attr.name === "class")?.value.split(/\s+/) ?? [];
		if (classes.some((name) => name === "katex-error" || name === "praxity-math-error")) {
			fail("Equation LaTeX is invalid.");
		}
		if (node.attrs.some((attr) => attr.name === "role" && attr.value === "math")) {
			speech ??= node.attrs.find((attr) => attr.name === "aria-label")?.value.trim();
		}
		for (const child of node.childNodes) inspect(child);
	}
	for (const node of parseFragment(renderMath(latex, block)).childNodes) inspect(node);
	if (!authoredAlt && (!english || !speech)) {
		return fail("This equation needs an authored text alternative in its content language.");
	}
	return `#mitex(${typstString(latex)}, block: ${block}, alt: ${typstString(authoredAlt || speech || "")})`;
}
