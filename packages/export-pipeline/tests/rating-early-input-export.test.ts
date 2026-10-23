import path from "node:path";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";
import {
	buildScormPackage,
	type CourseExportInput,
	compileCourse,
	deployCourse,
} from "../src/build";

function ratingOwner(document: Document) {
	const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"));
	const owners = scripts.filter((script) =>
		/(?:^|\/)self-check-lifetime-[A-Z0-9]{8}\.classic\.js$/u.test(script.getAttribute("src") ?? ""),
	);
	expect(owners).toHaveLength(1);
	const owner = owners[0];
	// Capture must start before the parser exposes native rating controls.
	expect(owner.parentElement).toBe(document.head);
	expect(owner.defer).toBe(false);
	expect(owner.async).toBeFalsy();
	const host = scripts.findIndex((script) => /(?:^|\/)host-[^/]+\.js$/u.test(script.src));
	expect(host).toBeGreaterThan(scripts.indexOf(owner));
	return owner.getAttribute("src") ?? "";
}

describe.each([false, true])("rating-only export (deck=%s)", (deck) => {
	test.each(["html", "scorm12", "scorm2004", "xapi"] as const)(
		"%s starts and packages the document owner before the host",
		async (format) => {
			const course: CourseExportInput = {
				id: "rating-early-input",
				title: "Rating",
				sourceLocale: "en",
				...(deck ? { moduleDeck: { gates: {} } } : {}),
				content: [
					{
						id: "rating-page",
						title: "Rating",
						blocks: [
							{
								id: "rating",
								type: "rating",
								data: { label: "Confidence", maxValue: 3, style: "numeric", required: !deck },
							},
						],
					},
				],
			};
			const result = await buildScormPackage(course, { format });
			const zip = new AdmZip(result.zip);
			const pages = zip
				.getEntries()
				.filter((entry) => entry.entryName.endsWith(".html"))
				.map((entry) => ({ entry, dom: new JSDOM(zip.readAsText(entry)) }))
				.filter(({ dom }) => dom.window.document.querySelector('[data-island="rating"]'));
			expect(pages).toHaveLength(1);
			for (const { entry, dom } of pages) {
				const document = dom.window.document;
				expect(document.querySelector('[data-island="selfCheck"]')).toBeNull();
				const ownerPath = path.posix.join(
					path.posix.dirname(entry.entryName),
					ratingOwner(document),
				);
				expect(zip.getEntry(ownerPath), ownerPath).not.toBeNull();
				dom.window.close();
			}
			expect(
				zip
					.getEntries()
					.some((entry) => /\/self-check-document-[^/]+\.classic\.js$/u.test(entry.entryName)),
			).toBe(false);
		},
	);

	test("Electron preview starts and packages capture before the host", async () => {
		const artifact = await compileCourse({
			id: "rating-preview",
			title: "Rating",
			sourceLocale: "en",
			...(deck ? { moduleDeck: { gates: {} } } : {}),
			content: [
				{
					id: "rating-page",
					title: "Rating",
					blocks: [
						{
							id: "rating",
							type: "rating",
							data: { label: "Confidence", maxValue: 3, style: "numeric" },
						},
					],
				},
			],
		});
		try {
			const preview = await deployCourse(artifact, { format: "electron-preview" });
			try {
				let ratings = 0;
				for (const file of preview.manifest.files.filter((file) => file.path.endsWith(".html"))) {
					const chunks: Buffer[] = [];
					for await (const chunk of await preview.openFile(file.path))
						chunks.push(Buffer.from(chunk));
					const dom = new JSDOM(Buffer.concat(chunks).toString());
					try {
						if (!dom.window.document.querySelector('[data-island="rating"]')) continue;
						ratings++;
						const owner = path.posix.join(
							path.posix.dirname(file.path),
							ratingOwner(dom.window.document),
						);
						expect(preview.manifest.files.some((file) => file.path === owner)).toBe(true);
					} finally {
						dom.window.close();
					}
				}
				expect(ratings).toBe(1);
			} finally {
				await preview.dispose();
			}
		} finally {
			await artifact.dispose();
		}
	});
});
