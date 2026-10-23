/**
 * Shared SCORM API discovery for the runtime bundle and published viewer.
 *
 * LMSs normally expose their API on a parent or opener window rather than on
 * the SCO itself. Keep that traversal in one place so detection cannot drift
 * between runtime initialization and accessibility resume handling.
 */

export interface WindowLike {
	API_1484_11?: unknown;
	API?: unknown;
	parent?: WindowLike | null;
	opener?: WindowLike | null;
}

export interface Scorm2004ApiLike {
	GetValue?: (element: string) => string;
}

export interface Scorm12ApiLike {
	LMSGetValue?: (element: string) => string;
}

export type ScormVersion = "1.2" | "2004";

export type DiscoveredScormApi =
	| { version: "2004"; api: Scorm2004ApiLike }
	| { version: "1.2"; api: Scorm12ApiLike };

const MAX_SEARCH_DEPTH = 10;

/**
 * Walk the window.opener and window.parent chains looking for a named property.
 */
export function findWindowProperty(win: WindowLike, propertyName: string): unknown {
	try {
		if (win.opener) {
			const result = scanChain(win.opener, propertyName);
			if (result) return result;
		}
	} catch {
		// Cross-origin access may throw.
	}

	return scanChain(win, propertyName);
}

function scanChain(win: WindowLike, propertyName: string): unknown {
	let current: WindowLike = win;
	for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth++) {
		try {
			const value = (current as Record<string, unknown>)[propertyName];
			if (value) return value;
		} catch {
			// A cross-origin boundary ends this chain.
			return null;
		}

		try {
			if (!current.parent || current.parent === current) break;
			current = current.parent;
		} catch {
			break;
		}
	}
	return null;
}

/**
 * Discover only the API required by the package. LMS compatibility aliases do
 * not identify the package version and cannot substitute for its required API.
 */
export function findScormApi(win: WindowLike, version: ScormVersion): DiscoveredScormApi | null {
	if (version === "2004") {
		const api = findWindowProperty(win, "API_1484_11");
		return api ? { version, api: api as Scorm2004ApiLike } : null;
	}
	const api = findWindowProperty(win, "API");
	return api ? { version, api: api as Scorm12ApiLike } : null;
}

/**
 * Read the LMS entry mode after the runtime has initialized.
 */
export function readScormEntry(discovered: DiscoveredScormApi): string | null {
	try {
		const entry =
			discovered.version === "2004"
				? discovered.api.GetValue?.("cmi.entry")
				: discovered.api.LMSGetValue?.("cmi.core.entry");
		return typeof entry === "string" && entry !== "" ? entry : null;
	} catch {
		return null;
	}
}

/**
 * Return a bookmark only when it still names a page in the current package.
 */
export function resolveScormResumeTarget(
	bookmark: string | null,
	currentSlug: string,
	availableSlugs: readonly string[],
): string | null {
	if (!bookmark || bookmark === currentSlug || !availableSlugs.includes(bookmark)) {
		return null;
	}
	return bookmark;
}
