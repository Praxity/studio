import { LocalStorageRuntime } from "../../../src/scorm/local-storage-runtime";
import { initializeCourseHost, prepareStandaloneResume } from "./course-host";

export function initializeStandaloneHost(): boolean {
	return initializeCourseHost({
		format: "standalone",
		createRuntime: (page) => new LocalStorageRuntime(undefined, page.courseId, "default"),
		prepareResume: prepareStandaloneResume,
		installLifecycle: (_runtime, _page, environment) => {
			// Native hrefs carry explicit arrival through middle activation and browser
			// menus too. Arrival consumes the marker before the course becomes ready.
			const decorate = (href: string) => {
				const url = new URL(href, environment.location.href);
				if (!url.searchParams.has("praxity-resume")) url.searchParams.set("praxity-resume", "0");
				return url.href;
			};
			environment.win.__praxityDecoratePageHref = decorate;
			for (const link of environment.doc.querySelectorAll<HTMLAnchorElement>(
				"a[data-page-slug],a[data-page-direction]",
			)) {
				if (link.hasAttribute("href")) link.href = decorate(link.href);
			}
			return false;
		},
	});
}

initializeStandaloneHost();
