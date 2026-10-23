import { expect, it } from "vitest";
import { buildScormPackage, createCourseContext, type DesktopExportInput } from "../build";

for (const locale of ["en", "fr"]) {
	const desktop: DesktopExportInput = {
		courseId: "empty",
		frontmatter: { title: "Empty", lang: locale },
		locale,
		blocks: [],
		config: { completionThreshold: 1 },
		resolvedAssets: new Map(),
		viewerVersion: "test",
	};
	it(`keeps empty ${locale} course contexts available to editor previews`, async () => {
		const context = await createCourseContext(desktop);
		expect(context.pages).toEqual([]);
	});
	it(`refuses empty source and desktop publications with a localized code in ${locale}`, async () => {
		const message =
			locale === "fr"
				? "Impossible de publier un cours sans pages de contenu. Ajoutez au moins une page."
				: "Cannot publish a course with no content pages. Add at least one page.";
		for (const course of [
			desktop,
			{ id: "empty", title: "Empty", sourceLocale: locale, content: [] },
		]) {
			for (const format of ["html", "scorm12", "scorm2004", "xapi"] as const) {
				await expect(buildScormPackage(course, { mode: "source", format })).rejects.toMatchObject({
					code: "EEMPTYCOURSE",
					message,
				});
			}
		}
	});
}
