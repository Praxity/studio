import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
	hasInlineIconMarkup,
	isInlineProjectionMetadataKey,
	materializeInlineIcons,
} from "@praxity/shared-blocks/inline-markdown";
import type { PraxityPage } from "@praxity/shared-blocks/types";
import { NOTE_ICON_NAME_PATTERN } from "@praxity/shared-blocks/types";

type IconNodes = Record<string, unknown>;

const catalogPromises = new Map<string, Promise<IconNodes>>();

function defaultCatalogPath(variant: "outline" | "filled"): string {
	const require = createRequire(import.meta.url);
	const icon =
		variant === "filled" ? "@tabler/icons/filled/mail.svg" : "@tabler/icons/outline/bulb.svg";
	return path.resolve(path.dirname(require.resolve(icon)), "../..", `tabler-nodes-${variant}.json`);
}

function loadCatalog(variant: "outline" | "filled", catalogPath?: string): Promise<IconNodes> {
	const requestedPath = catalogPath ?? defaultCatalogPath(variant);
	const cacheKey = `${variant}:${requestedPath}`;
	let catalog = catalogPromises.get(cacheKey);
	if (!catalog) {
		catalog = readFile(requestedPath, "utf8").then((json) => JSON.parse(json) as IconNodes);
		catalogPromises.set(cacheKey, catalog);
	}
	return catalog;
}

function loadOutlineNodes(catalogPath?: string): Promise<IconNodes> {
	return loadCatalog("outline", catalogPath);
}

function collectNotes(value: unknown, notes: Array<Record<string, unknown>>): void {
	if (Array.isArray(value)) {
		for (const item of value) collectNotes(item, notes);
		return;
	}
	if (!value || typeof value !== "object") return;
	const record = value as Record<string, unknown>;
	if (record.type === "note" && record.data && typeof record.data === "object") {
		notes.push(record.data as Record<string, unknown>);
	}
	for (const [key, item] of Object.entries(record)) {
		if (key !== "_tablerIconNodes" && !isInlineProjectionMetadataKey(key, { keepDisplay: true }))
			collectNotes(item, notes);
	}
}

/** Embed only the Tabler path data referenced by this course. */
export async function embedTablerNoteIcons(
	pages: PraxityPage[],
	catalogPath?: string,
): Promise<void> {
	const notes: Array<Record<string, unknown>> = [];
	collectNotes(pages, notes);
	const names = new Set(
		notes
			.map((data) => data.icon)
			.filter((icon): icon is string => typeof icon === "string" && icon !== "none"),
	);
	if (names.size === 0) return;

	const catalog = await loadOutlineNodes(catalogPath);
	for (const name of names) {
		if (!NOTE_ICON_NAME_PATTERN.test(name) || !catalog[name]) {
			throw new Error(`Unknown Tabler outline icon "${name}".`);
		}
	}
	for (const data of notes) {
		const name = data.icon;
		if (typeof name === "string" && name !== "none") data._tablerIconNodes = catalog[name];
	}
}

/** Load the build-time catalogs and embed only icons referenced by this course. */
export async function embedTablerInlineIcons(
	pages: PraxityPage[],
	outlineCatalogPath?: string,
	filledCatalogPath?: string,
): Promise<void> {
	if (!hasInlineIconMarkup(pages)) return;
	const [outline, filled] = await Promise.all([
		loadCatalog("outline", outlineCatalogPath),
		loadCatalog("filled", filledCatalogPath),
	]);
	const catalogs = { outline, filled };
	materializeInlineIcons(pages, catalogs);
}
