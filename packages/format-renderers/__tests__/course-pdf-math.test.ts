import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPdfEquation } from "../src/pipelines/course-pdf-math.ts";
import { compileTypstNative } from "../src/pipelines/typst-native-compiler.ts";

const fail = (message: string): never => {
	throw new Error(message);
};
const equation = (latex: unknown, alt?: unknown, locale = "en") =>
	renderPdfEquation(latex, alt, locale, true, fail);
const matrix = String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`;

describe("PDF equation validation", () => {
	it("renders fractions and sums with escaped source and generated speech", () => {
		const source = equation(String.raw`\frac{1}{2}+\sum_{i=1}^{3} i`);
		expect(source).toContain('#mitex("\\\\frac');
		expect(source).toContain("block: true, alt:");
		expect(source).not.toContain('alt: ""');
	});
	it.each([
		String.raw`\hspace{panic("INJECTED")}`,
		String.raw`\raisebox{panic("INJECTED")}{x}`,
		String.raw`\vspace{read("/etc/passwd")}`,
		String.raw`\text{\hspace{1pt}}`,
		String.raw`\\hspace\hspace{1pt}`,
		String.raw`\def\x{a}\x`,
		String.raw`\tag{lost} x`,
		String.raw`\phantom{lost}`,
		String.raw`\relax x`,
		String.raw`\begin{array}{cc}1&2\end{array}`,
		String.raw`\begin{pmatrix}1\end{bmatrix}`,
		"x % comment",
		"$x$",
		String.raw`\(x\)`,
		"x\u0000",
		"x\\",
		String.raw`\frac{1}`,
		`${"{".repeat(65)}x${"}".repeat(65)}`,
		"x".repeat(8193),
	])("rejects unsafe, lost, malformed or excessive content %s", (latex) => {
		expect(() => equation(latex, "Alternative cannot bypass validation")).toThrow();
	});
	it("accepts escaped percent and braces without treating them as comments or nesting", () => {
		expect(equation(String.raw`\{x\}\%`, "A set followed by percent")).toContain("#mitex");
		expect(() => equation(String.raw`\\% comment`, "alt")).toThrow("comments");
	});
	it("requires authored matrix and non-English alternatives", () => {
		expect(() => equation(matrix)).toThrow("authored text alternative");
		expect(equation(matrix, "Two by two matrix with rows one, two and three, four")).toContain(
			"#mitex",
		);
		expect(() => equation("x^2", undefined, "fr-CA")).toThrow("authored text alternative");
		expect(equation("x^2", "x au carré", "fr-CA")).toContain("x au carré");
	});
	it("validates unknown input, alternatives and locale", () => {
		for (const latex of [undefined, 42, " "]) expect(() => equation(latex)).toThrow();
		expect(() => equation("x", {})).toThrow("must be text");
		expect(() => equation("x", "x", "invalid_locale")).toThrow("language");
	});
});

it.skipIf(!process.env.PRAXITY_TEST_TYPST)(
	"compiles permitted equations with bundled MiTeX and real Typst",
	async () => {
		const executablePath = process.env.PRAXITY_TEST_TYPST as string;
		const files = new Map<string, Uint8Array>();
		for (const file of [
			"lib.typ",
			"mitex.typ",
			"mitex.wasm",
			"specs/mod.typ",
			"specs/prelude.typ",
			"specs/latex/standard.typ",
		]) {
			files.set(
				`mitex/${file}`,
				await readFile(path.join(path.dirname(executablePath), "mitex", file)),
			);
		}
		const source = `#import "mitex/lib.typ": mitex\n#set document(title: "Math validation")\n#set text(lang: "en")\n${equation(String.raw`\frac{1}{2}+\sum_{i=1}^{3} i`)}\n${equation(matrix, "Two by two matrix, rows one two and three four")}\n${equation(String.raw`\text{\#panic("INJECTED")}`, "Literal text")}`;
		const pdf = await compileTypstNative(source, { executablePath, files, pdfStandard: "ua-1" });
		expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
	},
);
