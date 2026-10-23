import { strToU8, zipSync } from "fflate";

export type TextResponseDownloadFormat = "txt" | "docx";

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function paragraphs(value: string, style?: string): string {
	return value
		.split(/\r?\n/)
		.map(
			(line) =>
				`<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(line || " ")}</w:t></w:r></w:p>`,
		)
		.join("");
}

export function createTextResponsesDocx(
	entries: Array<{ question: string; response: string; savedDate?: string }>,
): Uint8Array {
	const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${entries.map(({ question, response, savedDate }) => paragraphs(question, "Heading1") + paragraphs(response) + (savedDate ? paragraphs(savedDate) : "")).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
	return zipSync(
		{
			"[Content_Types].xml": strToU8(
				'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
			),
			"_rels/.rels": strToU8(
				'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
			),
			"word/document.xml": strToU8(documentXml),
		},
		{ level: 6 },
	);
}

function safeFilename(question: string, extension: TextResponseDownloadFormat): string {
	const stem = question
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60)
		.toLowerCase();
	return `${stem || "response"}.${extension}`;
}

export function downloadTextResponse(
	format: TextResponseDownloadFormat,
	question: string,
	response: string,
	savedDate?: string,
): void {
	downloadTextResponses(format, question, [{ question, response, savedDate }]);
}

export function downloadTextResponses(
	format: TextResponseDownloadFormat,
	title: string,
	entries: Array<{ question: string; response: string; savedDate?: string }>,
): void {
	const blob =
		format === "docx"
			? new Blob([createTextResponsesDocx(entries).slice().buffer as ArrayBuffer], {
					type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				})
			: new Blob(
					[
						entries
							.map(
								({ question, response, savedDate }) =>
									`${question}\n\n${response}\n${savedDate ? `${savedDate}\n` : ""}`,
							)
							.join("\n"),
					],
					{ type: "text/plain;charset=utf-8" },
				);
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = safeFilename(title, format);
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadAssessmentGroup(
	format: TextResponseDownloadFormat,
	title: string,
	members: HTMLElement[],
	fallback: string,
): void {
	downloadTextResponses(
		format,
		title,
		members.map((member, index) => ({
			savedDate: member.querySelector("[data-journal-saved-date]")?.textContent?.trim(),
			question: [
				member
					.querySelector(".praxity-assessment-stem-content, .praxity-assessment-stem")
					?.textContent?.trim()
					.replace(/\s*required$/i, "") || fallback.replace("{index}", String(index + 1)),
				...[...(member.querySelector(".praxity-assessment-stem-body")?.childNodes ?? [])]
					.map((paragraph) => paragraph.textContent?.trim())
					.filter((paragraph): paragraph is string => Boolean(paragraph)),
			].join("\n\n"),
			response:
				member.querySelector<HTMLInputElement | HTMLTextAreaElement>(
					"textarea,input:not([type=hidden])",
				)?.value ?? "",
		})),
	);
}
