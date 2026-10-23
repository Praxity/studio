import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { normalizePdfOutput, stagedAnswerOutputInvariant } from "./fixtures/staged-answer-output";

it.each(["SC", "WD"] as const)(
	"%s never completes an EOF marker with a decoded base64 string",
	(prefix) => {
		const { assertOutput } = stagedAnswerOutputInvariant(prefix);
		const marker = `${prefix}_en_TOP_MODEL_UNIQUE`;
		const encoded = Buffer.from(`EL_UNIQUE ${marker}`).toString("base64");
		const bytes = Buffer.from(`x "${encoded}" ${prefix}_en_TOP_MOD`);
		expect(() => assertOutput("explicit/planted-eof", bytes, [marker])).toThrow();
	},
);

it.each(["SC", "WD"] as const)("%s scans decoded strings independently", (prefix) => {
	const { assertOutput } = stagedAnswerOutputInvariant(prefix);
	const marker = `${prefix}_en_TOP_MODEL_UNIQUE`;
	const encoded = [`${prefix}_en_TOP_MOD`, `EL_UNIQUE ${marker}`].map((text) =>
		Buffer.from(text).toString("base64"),
	);
	expect(() =>
		assertOutput("explicit/planted-decodes", Buffer.from(encoded.join(' " ')), [marker]),
	).toThrow();
	expect(() =>
		assertOutput("explicit/allowed", Buffer.from(Buffer.from(marker).toString("base64")), [marker]),
	).not.toThrow();
});

it.each(["SC", "WD"] as const)(
	"%s detects base64 after token prefixes at every alignment",
	(prefix) => {
		const { assertOutput } = stagedAnswerOutputInvariant(prefix);
		for (const tokenPrefix of ["x-", "sha256-", "x", "xy", "xyz", "xxxx"])
			for (const padding of ["", "a", "ab"])
				expect(() =>
					assertOutput(
						"planted/prefixed-base64",
						Buffer.from(
							`${tokenPrefix}${Buffer.from(`${padding}${prefix}_en_TOP_MODEL_UNIQUE`).toString("base64")}`,
						),
					),
				).toThrow();
	},
);

const pdfUtf16 = (text: string) => `FEFF${Buffer.from(text, "utf16le").swap16().toString("hex")}`;
it.each([false, true])("PDF scanner rejects UTF-16 hex metadata, compressed=%s", (compressed) => {
	const body = Buffer.from(`/Title<${pdfUtf16("WD_en_TAB_RIGHT_UNIQUE café")}>`);
	const bytes = compressed
		? Buffer.concat([
				Buffer.from("%PDF-1.7\n<< /Filter /FlateDecode >>\nstream\n"),
				deflateSync(body),
				Buffer.from("\nendstream"),
			])
		: Buffer.concat([Buffer.from("%PDF-1.7\n"), body]);
	expect(() => stagedAnswerOutputInvariant("WD").assertOutput("planted/pdf", bytes)).toThrow();
});
it("PDF scanner rejects octal UTF-16 literal metadata", () => {
	const literal = [...Buffer.from("WD_fr_TAB_RIGHT_UNIQUE déjà", "utf16le").swap16()]
		.map((byte) => `\\${byte.toString(8).padStart(3, "0")}`)
		.join("");
	expect(() =>
		stagedAnswerOutputInvariant("WD").assertOutput(
			"planted/pdf",
			Buffer.from(`%PDF-1.7\n/ActualText(\\376\\377${literal})`),
		),
	).toThrow();
});

it("PDF normalization exposes accented outline and literal strings", () => {
	const pdf = Buffer.from(
		`%PDF-1.7\n/Title<${pdfUtf16("Corrigé café")}> /ActualText(\\376\\377\\000d\\000\\351\\000j\\000\\340)`,
	);
	expect(normalizePdfOutput(pdf)).toContain("Corrigé café");
	expect(normalizePdfOutput(pdf)).toContain("déjà");
});

it.each([false, true])("PDF scanner handles nested dictionaries before filter=%s", (before) => {
	const filter = "/Filter /FlateDecode";
	const nested = "/DecodeParms << /Predictor 1 >>";
	const compressed = deflateSync(Buffer.from(`/ActualText<${pdfUtf16("WD_fr_NESTED_CAFÉ")}>`));
	const bytes = Buffer.concat([
		Buffer.from(
			`%PDF-1.7\n<< /Length ${compressed.length} ${before ? `${nested} ${filter}` : `${filter} ${nested}`} >>\nstream\n`,
		),
		compressed,
		Buffer.from("\nendstream"),
	]);
	expect(normalizePdfOutput(bytes)).toContain("WD_fr_NESTED_CAFÉ");
	expect(() =>
		stagedAnswerOutputInvariant("WD").assertOutput("planted/nested-pdf", bytes),
	).toThrow();
});
