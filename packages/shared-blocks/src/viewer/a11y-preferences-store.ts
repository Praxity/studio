const STORAGE_KEY = "praxity-a11y";

export type A11yTextSize = "default" | "large";

export interface StoredA11yPreferences {
	textSize?: A11yTextSize;
	/** Learner's explicit focus choice. null = never chose (page default applies). */
	focusChoice: boolean | null;
}

// ponytail: module-level fallback is per-document only; packages launched with
// both web stores blocked lose the choice after a full-page navigation.
let memoryStore: string | null = null;

function readRaw(): string | null {
	let value: string | null = null;
	try {
		value = localStorage.getItem(STORAGE_KEY);
	} catch {
		// localStorage can be unavailable in locked-down LMS frames.
	}
	if (value !== null) return value;
	try {
		value = sessionStorage.getItem(STORAGE_KEY);
	} catch {
		// sessionStorage can be unavailable too.
	}
	return value ?? memoryStore;
}

export function readA11yPreferences(): StoredA11yPreferences {
	try {
		const raw = readRaw();
		if (!raw) return { focusChoice: null };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const storedSize = parsed.textSize;
		return {
			textSize:
				storedSize === "large" || storedSize === "x-large"
					? "large"
					: storedSize === "default"
						? "default"
						: undefined,
			focusChoice:
				typeof parsed.focusChoice === "boolean"
					? parsed.focusChoice
					: parsed.focusMode === true
						? true
						: null,
		};
	} catch {
		return { focusChoice: null };
	}
}

export function writeA11yPreferences(preferences: StoredA11yPreferences): void {
	const value = JSON.stringify({
		...preferences,
		// Older packages read focusMode. Author defaults must never be persisted.
		focusMode: preferences.focusChoice === true,
	});
	try {
		localStorage.setItem(STORAGE_KEY, value);
		return;
	} catch {
		// Fall through to session storage.
	}
	try {
		sessionStorage.setItem(STORAGE_KEY, value);
		return;
	} catch {
		memoryStore = value;
	}
}

function preferenceTargets(): HTMLElement[] {
	return [
		...new Set<HTMLElement>([
			document.documentElement,
			...document.querySelectorAll<HTMLElement>("[data-praxity-root]"),
		]),
	];
}

export function applyA11yPreferences(textSize: A11yTextSize, focusMode: boolean): void {
	for (const target of preferenceTargets()) {
		if (textSize === "large") target.dataset.praxityTextSize = "large";
		else delete target.dataset.praxityTextSize;
		if (focusMode) target.dataset.praxityFocusMode = "true";
		else delete target.dataset.praxityFocusMode;
	}
}

export function applyReducedMotion(reduced: boolean): void {
	for (const target of preferenceTargets()) {
		if (reduced) target.dataset.praxityReducedMotion = "true";
		else delete target.dataset.praxityReducedMotion;
	}
}

export function announcePreference(message: string): void {
	const region = document.getElementById("praxity-live-region");
	if (region) region.textContent = message;
}
