import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const sorted = (views) => views.sort((a, b) => a.key.localeCompare(b.key, "en"));

/** Each physical document is a view, even a redirect or an unfamiliar utility. */
export function deriveInventory(documents) {
	const { JSDOM } = require("jsdom");
	if (!documents.length) throw new Error("Build emitted no HTML documents");
	const files = new Set(documents.map(({ file }) => file));
	if (files.size !== documents.length) throw new Error("Duplicate HTML document");
	const views = [];
	for (const { file, html } of documents) {
		const dom = new JSDOM(html);
		try {
			const doc = dom.window.document;
			const configs = doc.querySelectorAll("script#praxity-config");
			if (configs.length > 1) throw new Error(`${file}: duplicate config`);
			const config = configs.length ? JSON.parse(configs[0].textContent) : {};
			const url = file.split("/").map(encodeURIComponent).join("/");
			views.push({
				key: `document:${file}`,
				url,
				title: doc.title || config.pageTitle || config.title || file,
			});
			if (config.deckPages === undefined) continue;
			if (!Array.isArray(config.deckPages) || !config.deckPages.length)
				throw new Error(`${file}: invalid deckPages`);
			const ids = new Set();
			for (const slide of config.deckPages) {
				if (
					typeof slide.id !== "string" ||
					!slide.id ||
					typeof slide.moduleSlug !== "string" ||
					!slide.moduleSlug
				)
					throw new Error(`${file}: invalid deck slide`);
				if (ids.has(slide.id)) throw new Error(`${file}: duplicate slide ${slide.id}`);
				ids.add(slide.id);
				const moduleFile = `${slide.moduleSlug}.html`;
				if (!files.has(moduleFile)) throw new Error(`${file}: missing module ${moduleFile}`);
				// Configs repeat the course-wide deck list. Capture each slide under its owner.
				if (moduleFile === file)
					views.push({
						key: `slide:${file}#${slide.id}`,
						url: `${url}?praxity-inspect=1#${encodeURIComponent(slide.id)}`,
						title: slide.title || slide.id,
						id: slide.id,
					});
			}
		} finally {
			dom.window.close();
		}
	}
	return sorted(views);
}

export async function inventory(root) {
	const documents = [];
	async function visit(directory, prefix = "") {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const file = `${prefix}${entry.name}`;
			if (entry.isDirectory()) await visit(path.join(directory, entry.name), `${file}/`);
			else if (/\.html$/i.test(entry.name))
				documents.push({ file, html: await readFile(path.join(directory, entry.name), "utf8") });
		}
	}
	await visit(root);
	return deriveInventory(documents);
}

export function compareInventories(base, candidate) {
	const left = new Map(base.map((view) => [view.key, view]));
	const right = new Map(candidate.map((view) => [view.key, view]));
	if (left.size !== base.length || right.size !== candidate.length)
		throw new Error("Duplicate capture view");
	const failures = [];
	for (const key of new Set([...left.keys(), ...right.keys()])) {
		if (!right.has(key)) failures.push({ key, reason: "missing candidate view" });
		else if (!left.has(key)) failures.push({ key, reason: "extra candidate view" });
		else if (
			left.get(key).url !== right.get(key).url ||
			left.get(key).title !== right.get(key).title
		)
			failures.push({ key, reason: "view URL/title differs" });
	}
	return sorted(failures);
}
