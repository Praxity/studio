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

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xml(files: Record<string, Uint8Array>, path: string): Document {
	const bytes = files[path];
	if (!bytes) throw new Error(`Missing archive part ${path}`);
	const parsed = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
	expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
	return parsed;
}

function expectResolvedStyles(archive: Uint8Array): Document {
	const files = unzipSync(archive);
	const types = xml(files, "[Content_Types].xml");
	const overrides = new Map(
		[...types.getElementsByTagName("Override")].map((node) => [
			node.getAttribute("PartName"),
			node.getAttribute("ContentType"),
		]),
	);
	expect(overrides.get("/word/styles.xml")).toBe(
		"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
	);
	const relationships = [
		...xml(files, "word/_rels/document.xml.rels").getElementsByTagName("Relationship"),
	];
	const styleTargets = relationships
		.filter(
			(node) =>
				node.getAttribute("Type") ===
				"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
		)
		.map((node) => `word/${node.getAttribute("Target")}`);
	expect(styleTargets).toEqual(["word/styles.xml"]);
	const styles = xml(files, "word/styles.xml");
	const paragraphStyles = new Map(
		[...styles.getElementsByTagNameNS(W, "style")]
			.filter((node) => node.getAttributeNS(W, "type") === "paragraph")
			.map((node) => [node.getAttributeNS(W, "styleId"), node]),
	);
	const normal = paragraphStyles.get("Normal");
	expect(normal?.getAttributeNS(W, "default")).toBe("1");
	const heading = paragraphStyles.get("Heading1");
	expect(heading?.getElementsByTagNameNS(W, "basedOn")[0]?.getAttributeNS(W, "val")).toBe("Normal");
	expect(heading?.getElementsByTagNameNS(W, "outlineLvl")[0]?.getAttributeNS(W, "val")).toBe("0");
	const document = xml(files, "word/document.xml");
	for (const reference of document.getElementsByTagNameNS(W, "pStyle")) {
		expect(paragraphStyles.has(reference.getAttributeNS(W, "val"))).toBe(true);
	}
	return document;
}

function paragraphsOf(document: Document) {
	return [...document.getElementsByTagNameNS(W, "p")].map((paragraph) => ({
		style: paragraph.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") ?? null,
		text: paragraph.textContent,
	}));
}

const frenchEntries = [
	{
		question: "Réflexion : « sécurité » & <confiance>",
		response: "Première idée\nDeuxième étape — à faire",
		savedDate: "Enregistré le 21 novembre 2026 à 10 h 05",
	},
	{ question: "Plan d'action", response: "Agir demain" },
];

const frenchParagraphs = [
	{ style: "Heading1", text: "Réflexion : « sécurité » & <confiance>" },
	{ style: null, text: "Première idée" },
	{ style: null, text: "Deuxième étape — à faire" },
	{ style: null, text: "Enregistré le 21 novembre 2026 à 10 h 05" },
	{ style: "Heading1", text: "Plan d'action" },
	{ style: null, text: "Agir demain" },
];

it("resolves every paragraph style in the DOCX archive and keeps headings, text and order", () => {
	expect(paragraphsOf(expectResolvedStyles(createTextResponsesDocx(frenchEntries)))).toEqual(
		frenchParagraphs,
	);
});

it("downloads a DOCX whose paragraph styles resolve inside the archive", async () => {
	let blob: Blob | undefined;
	const create = vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
		blob = value as Blob;
		return "blob:journal";
	});
	const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
	downloadTextResponses("docx", "Journal", frenchEntries);
	const archive = new Uint8Array(await (blob as Blob).arrayBuffer());
	expect(paragraphsOf(expectResolvedStyles(archive))).toEqual(frenchParagraphs);
	create.mockRestore();
	click.mockRestore();
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
