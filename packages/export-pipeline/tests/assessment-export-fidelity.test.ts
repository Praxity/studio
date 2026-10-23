import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";
import { buildScormPackage, type CourseExportInput } from "../src/build";

function makeAssessmentCourse(): CourseExportInput {
	return {
		id: "assessment-export-fidelity",
		title: "Assessment Export Fidelity",
		sourceLocale: "en",
		content: [
			{
				id: "page-assessments",
				title: "Assessments",
				blocks: [
					{
						id: "matrix-1",
						type: "assessment",
						data: {
							assessmentType: "matrix",
							stem: [
								{
									id: "matrix-stem",
									type: "text",
									data: { content: "<p>How confident are you?</p>" },
								},
							],
							response: {
								type: "matrix",
								selectionMode: "single",
								statements: [
									{ id: "s1", text: "Using PPE correctly" },
									{ id: "s2", text: "Reading warning labels" },
								],
								scalePoints: [
									{ id: "not-confident", value: 1, label: "Not confident" },
									{ id: "confident", value: 2, label: "Confident" },
								],
							},
							feedback: {},
							gradingMode: "none",
						},
					},
					{
						id: "hotspot-1",
						type: "assessment",
						data: {
							assessmentType: "hotspot",
							stem: [
								{
									id: "hotspot-stem",
									type: "text",
									data: { content: "<p>Select the pressure gauge.</p>" },
								},
							],
							response: {
								type: "hotspot",
								image: "/assets/test-hotspot.webp",
								imageAlt: "Fire extinguisher diagram",
								mode: "select",
								selectionMode: "single",
								hotspots: [
									{
										id: "pressure-gauge",
										shape: "ellipse",
										coords: [30, 15, 6],
										label: "Pressure gauge",
										isCorrect: true,
									},
								],
							},
							feedback: {},
							gradingMode: "none",
						},
					},
					{
						id: "categorize-1",
						type: "assessment",
						data: {
							assessmentType: "categorize",
							stem: [
								{
									id: "categorize-stem",
									type: "text",
									data: { content: "<p>Sort by PPE category.</p>" },
								},
							],
							response: {
								type: "categorize",
								categories: [
									{
										id: "head",
										name: "Head Protection",
										image: "/assets/test-hotspot.webp",
										imageAlt: "Hard hat",
										items: ["Hard hat"],
										itemIds: ["hard-hat"],
									},
									{
										id: "eye",
										name: "Eye Protection",
										items: ["Safety goggles"],
										itemIds: ["goggles"],
									},
								],
							},
							feedback: {},
							gradingMode: "none",
						},
					},
					{
						id: "card-1",
						type: "card",
						data: {
							layout: "flip",
							items: [
								{
									id: "card-item-1",
									backId: "card-item-back",
									label: "Card front",
									front: [
										{
											id: "card-front-text",
											type: "text",
											data: { content: "<p>Front content</p>" },
										},
									],
									back: [
										{
											id: "card-back-text",
											type: "text",
											data: { content: "<p>Back content</p>" },
										},
									],
								},
							],
						},
					},
				],
			},
		],
	};
}

function readCanonicalHtml(zipBuffer: Buffer): string {
	const zip = new AdmZip(zipBuffer);
	const htmlEntry = zip
		.getEntries()
		.find((entry) => entry.entryName.endsWith(".html") && entry.entryName !== "index.html");
	if (!htmlEntry) {
		throw new Error("No course HTML page found in export package");
	}
	return zip.readAsText(htmlEntry.entryName);
}

function getBlockDataById(html: string, blockId: string): Record<string, unknown> {
	const dom = new JSDOM(html);
	const configScript = dom.window.document.getElementById("praxity-config");
	expect(configScript).toBeTruthy();
	const config = JSON.parse(configScript?.textContent ?? "{}") as {
		blocks?: Array<{ id?: string; data?: Record<string, unknown> }>;
	};
	const block = config.blocks?.find((item) => item.id === blockId);
	expect(block, `missing block ${blockId}`).toBeTruthy();
	return block?.data ?? {};
}

describe("assessment export fidelity", () => {
	test.each(["html", "scorm12", "scorm2004"] as const)(
		"%s package preserves matrix, hotspot, categorize, and card block data",
		async (format) => {
			const result = await buildScormPackage(makeAssessmentCourse(), { format });
			const html = readCanonicalHtml(result.zip);
			const dom = new JSDOM(html);

			expect(dom.window.document.querySelector("[data-block-id='matrix-1']")).toBeTruthy();
			expect(dom.window.document.querySelector("[data-block-id='hotspot-1']")).toBeTruthy();
			expect(dom.window.document.querySelector("[data-block-id='categorize-1']")).toBeTruthy();
			expect(dom.window.document.querySelector("[data-block-id='card-1']")).toBeTruthy();

			const matrix = getBlockDataById(html, "matrix-1");
			expect(matrix.assessmentType).toBe("matrix");
			expect(matrix).toHaveProperty("response");
			expect(JSON.stringify(matrix.response)).toContain("Using PPE correctly");
			expect(JSON.stringify(matrix.response)).toContain("Not confident");

			const hotspot = getBlockDataById(html, "hotspot-1");
			expect(hotspot.assessmentType).toBe("hotspot");
			expect(JSON.stringify(hotspot.response)).toContain("Pressure gauge");
			expect(JSON.stringify(hotspot.response)).toContain("Fire extinguisher diagram");

			const categorize = getBlockDataById(html, "categorize-1");
			expect(categorize.assessmentType).toBe("categorize");
			expect(JSON.stringify(categorize.response)).toContain("Head Protection");
			expect(JSON.stringify(categorize.response)).toContain("Hard hat");

			const card = getBlockDataById(html, "card-1");
			expect(JSON.stringify(card.items)).toContain("Front content");
			expect(JSON.stringify(card.items)).toContain("Back content");
		},
	);
});
