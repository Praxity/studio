const MAX_SLUG_LENGTH = 64;

export function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function slugify(title: string): string {
	const slug = title
		.replace(/\s*&\s*/g, " and ")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-$/, "");
	return slug || "course";
}

export function pageSlug(title: string, index: number): string {
	const trimmed = decodeHtmlEntities(title).trim();
	if (!trimmed) return `page-${index + 1}`;
	return slugify(trimmed);
}

export function buildSlugMap(
	pages: Array<{ id: string; title: string }>,
	reserved: Iterable<string> = [],
): Map<string, string> {
	const slugMap = new Map<string, string>();
	const usedFinalSlugs = new Set<string>(["index", "glossary", "resources", ...reserved]);
	const baseCounts = new Map<string, number>();
	baseCounts.set("index", 1);

	for (let index = 0; index < pages.length; index++) {
		let slug = pageSlug(pages[index].title, index);

		if (usedFinalSlugs.has(slug)) {
			const base = slug;
			let count = (baseCounts.get(base) ?? 1) + 1;
			slug = `${base}-${count}`;
			while (usedFinalSlugs.has(slug)) {
				count++;
				slug = `${base}-${count}`;
			}
			baseCounts.set(base, count);
		} else {
			baseCounts.set(slug, 1);
		}

		usedFinalSlugs.add(slug);
		slugMap.set(pages[index].id, slug);
	}

	return slugMap;
}
