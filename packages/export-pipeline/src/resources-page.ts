import { externalLinkIndicatorHtml } from "@praxity/shared-blocks/external-link-utils";
import { getStrings } from "@praxity/shared-blocks/i18n/strings";
import { sanitizeHtml } from "@praxity/shared-blocks/sanitize";

export interface ResourcePageEntry {
	title: string;
	description: string;
	url: string;
	resourceType: "file" | "link" | "lessonPdf" | "document";
	lessonTitle?: string;
	lessonSlug?: string;
}

interface ResourcesPageOptions {
	entries: ResourcePageEntry[];
	courseTitle: string;
	locale?: string;
}

/** Escape characters that are unsafe in HTML text/attribute contexts. */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Extract uppercase file extension from URL (e.g. "PDF" from ".../file.pdf"). */
function getFileTypeBadge(url: string): string | undefined {
	try {
		const pathname = new URL(url).pathname;
		const lastDot = pathname.lastIndexOf(".");
		if (lastDot === -1) return undefined;
		const ext = pathname.slice(lastDot + 1).toLowerCase();
		return ext && ext.length <= 5 ? ext.toUpperCase() : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Generate the body HTML for the resources page.
 * Returns an empty string when no entries are provided.
 */
export function generateResourcesPageHtml(opts: ResourcesPageOptions): string {
	const { entries } = opts;
	const strings = getStrings(opts.locale ?? "en");
	if (entries.length === 0) return "";

	// Group by type
	const files = entries.filter((e) => e.resourceType === "file");
	const links = entries.filter((e) => e.resourceType === "link");
	const lessonPdfs = entries.filter((e) => e.resourceType === "lessonPdf");
	const documents = entries.filter((e) => e.resourceType === "document");

	function renderSection(title: string, items: ResourcePageEntry[]): string {
		if (items.length === 0) return "";
		const listItems = items
			.map((item) => {
				const sanitizedDesc = item.description ? sanitizeHtml(item.description) : "";
				const fileType = getFileTypeBadge(item.url);
				const badge = fileType
					? ` <span class="praxity-resource-badge">${escapeHtml(fileType)}</span>`
					: "";
				const isExternal =
					item.resourceType === "link" ||
					(item.resourceType === "document" && /^https:\/\//i.test(item.url));
				const linkAttrs = isExternal
					? `href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer"`
					: `href="${escapeHtml(item.url)}" download`;
				const sourceLine =
					item.lessonTitle && item.lessonSlug
						? `<p class="praxity-resource-source"><a href="${escapeHtml(item.lessonSlug)}.html">${escapeHtml(strings.resourceFromLesson.replace("{lesson}", item.lessonTitle))}</a></p>`
						: "";
				return `
				<li class="praxity-resource-item">
					<div class="praxity-resource-item-content">
						<span class="praxity-resource-item-title">
							<a ${linkAttrs}>${escapeHtml(item.title || strings.untitledResource)}${badge}${isExternal ? externalLinkIndicatorHtml(strings.opensInNewTab) : ""}</a>
						</span>
						${sanitizedDesc ? `<p class="praxity-resource-item-description">${sanitizedDesc}</p>` : ""}
						${sourceLine}
					</div>
				</li>`;
			})
			.join("\n");

		return `
			<section class="praxity-resources-section">
				<h2>${escapeHtml(title)}</h2>
				<ul>
					${listItems}
				</ul>
			</section>`;
	}

	const sections = [
		renderSection(strings.resourceDocumentsHeading, files),
		renderSection(strings.resourceExternalLinksHeading, links),
		renderSection(strings.resourceLessonPdfsHeading, lessonPdfs),
		renderSection(strings.resourceCourseDocumentsHeading, documents),
	]
		.filter(Boolean)
		.join("\n");

	return `
		<div class="praxity-resources-page">
			${sections}
		</div>`;
}
