import type { PraxityBlock } from "@praxity/shared-blocks/types";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { delegateDeckControls } from "../components/deck-control-activation";

export type ViewerConfigLike = {
	sourceLocale?: string;
	colorShades?: {
		accent?: string[];
		success?: string[];
		error?: string[];
		warning?: string[];
	} | null;
};

export function readViewerConfig(): ViewerConfigLike {
	const configEl = document.getElementById("praxity-config");
	if (!configEl?.textContent) return {};
	try {
		const value = JSON.parse(configEl.textContent);
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return value as ViewerConfigLike;
	} catch {
		return {};
	}
}

export function parseBlockJson(el: HTMLElement): PraxityBlock | null {
	const raw = el.getAttribute("data-block-json");
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PraxityBlock;
	} catch {
		return null;
	}
}

export function renderIsland(el: HTMLElement, content: ReactNode): () => void {
	const root = createRoot(el);
	flushSync(() => root.render(content));
	// Rendered authored content can link to course slides inside a Guided deck.
	delegateDeckControls(el);
	el.setAttribute("data-hydrated", "");
	return () => root.unmount();
}
