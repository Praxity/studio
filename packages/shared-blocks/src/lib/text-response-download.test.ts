import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createTextResponsesDocx, downloadTextResponses } from "./text-response-download";

describe("createTextResponsesDocx", () => {
	it("creates a valid OOXML archive containing escaped question and response text", () => {
		const files = unzipSync(
			createTextResponsesDocx([{ question: "Optics & light", response: "First <line>\nSecond" }]),
		);
		const document = strFromU8(files["word/document.xml"]);
		expect(document).toContain("Optics &amp; light");
		expect(document).toContain("First &lt;line&gt;");
		expect(document).toContain("Second");
		expect(files["[Content_Types].xml"]).toBeTruthy();
	});
});

it("downloads journal prompts and answers in authored order in TXT and DOCX", async () => {
	const entries = [
		{ question: "Reflection", response: "Think today" },
		{ question: "Action plan", response: "Act tomorrow" },
	];
	const documentXml = strFromU8(unzipSync(createTextResponsesDocx(entries))["word/document.xml"]);
	expect(documentXml.indexOf("Reflection")).toBeLessThan(documentXml.indexOf("Think today"));
	expect(documentXml.indexOf("Think today")).toBeLessThan(documentXml.indexOf("Action plan"));
	expect(documentXml.indexOf("Action plan")).toBeLessThan(documentXml.indexOf("Act tomorrow"));
	let blob: Blob | undefined;
	const create = vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
		blob = value as Blob;
		return "blob:journal";
	});
	const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	downloadTextResponses("txt", "Journal", entries);
	expect(await blob?.text()).toBe("Reflection\n\nThink today\n\nAction plan\n\nAct tomorrow\n");
	create.mockRestore();
	click.mockRestore();
});
