import { createServer, type Server } from "node:http";
import { test as base, expect } from "@playwright/test";
import { readLesson } from "@praxity/grammar";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import AdmZip from "adm-zip";
import { type CourseExportInput, compileCourse, deployCourse } from "../../src/build";
import { serveFixtureBytes } from "./http-bytes";
import { silentWav } from "./silent-audio";

export { expect };
export const test = base.extend<Record<never, never>, { publishedNavigation: string }>({
	publishedNavigation: [
		async ({ browserName: _browserName }, use) => {
			const files = new Map<string, Buffer>();
			for (const mode of [
				"deck",
				"pages",
				"headless",
				"narrated",
				"deck-entities",
				"pages-entities",
			] as const) {
				for (const locale of ["en", "fr"] as const) {
					if (["deck-entities", "pages-entities"].includes(mode) && locale !== "en") continue;
					const parsed = readLesson(
						"---\ntitle: Navigation course\nlang: en\n---\n\n# First slide\n\nRead [support]{Help when you need it.}.\n\n# Second slide\n\n## Section heading\n\nMore content.\n\n# Third slide\n\nEnd of the first lesson.\n\n# Destination heading\n\nSecond lesson content.\n",
					);
					const content = splitBlocksIntoPages(parsed.blocks, "Navigation course");
					for (const [index, page] of content.entries()) {
						page.id = `page-${index + 1}`;
						page.lessonId = index < 3 ? "first-lesson" : "second-lesson";
						page.lessonTitle = index < 3 ? "First lesson" : "Destination lesson";
						page.isFirstPageOfLesson = index === 0 || index === 3;
						if (mode.endsWith("-entities") && index < 2)
							page.title = index === 0 ? "First &amp;amp; slide" : "Second &amp; slide";
						if (mode === "narrated") {
							page.narrationEnabled = true;
							page.data = {
								...page.data,
								narrationAudio: "https://navigation.example/fixture.wav",
							};
							// Narrate titles only, so one completed segment advances one slide.
							for (const block of page.blocks) block.data.narrationDisabled = true;
						}
					}
					if (mode === "headless")
						content[1].blocks = content[1].blocks.filter((block) => block.type !== "heading");
					const course: CourseExportInput = {
						id: `navigation-${mode}-${locale}`,
						title: "Navigation course",
						sourceLocale: locale,
						content,
						navigationStyle: mode.startsWith("pages") ? "sidebar" : "slides",
						...(mode.startsWith("pages") ? {} : { moduleDeck: {} }),
					};
					if (mode === "narrated")
						course.deckDesign = { autoAdvance: true, followNarration: false };
					const originalFetch = globalThis.fetch;
					if (mode === "narrated") {
						const audio = new Uint8Array(silentWav(2));
						globalThis.fetch = (input, options) =>
							String(input) === "https://navigation.example/fixture.wav"
								? Promise.resolve(new Response(audio, { headers: { "Content-Type": "audio/wav" } }))
								: originalFetch(input, options);
					}
					let artifact: Awaited<ReturnType<typeof compileCourse>>;
					try {
						artifact = await compileCourse(course, { mode: "source" });
					} finally {
						globalThis.fetch = originalFetch;
					}
					try {
						for (const format of mode === "deck" && locale === "en"
							? (["html", "scorm2004"] as const)
							: (["html"] as const)) {
							const deployment = await deployCourse(artifact, { format });
							if (!("zip" in deployment)) throw new Error("Expected published package");
							for (const file of new AdmZip(deployment.zip).getEntries())
								if (!file.isDirectory)
									files.set(
										`/${mode}-${locale}${format === "html" ? "" : "-scorm"}/${file.entryName}`,
										file.getData(),
									);
						}
					} finally {
						await artifact.dispose();
					}
				}
			}
			const server: Server = createServer((request, response) => {
				const path = new URL(request.url ?? "/", "http://localhost").pathname;
				const bytes = files.get(path);
				if (!bytes) {
					response.writeHead(404).end();
					return;
				}
				const types: Record<string, string> = {
					html: "text/html",
					js: "text/javascript",
					css: "text/css",
					json: "application/json",
				};
				response.setHeader(
					"Content-Type",
					types[path.split(".").at(-1) ?? ""] ?? "application/octet-stream",
				);
				serveFixtureBytes(request, response, bytes);
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			try {
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("Missing fixture address");
				await use(`http://127.0.0.1:${address.port}`);
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
		{ scope: "worker" },
	],
});
