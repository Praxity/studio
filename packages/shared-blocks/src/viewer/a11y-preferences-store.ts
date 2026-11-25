const STORAGE_KEY = "praxity-a11y";

export type A11yTextSize = "default" | "large";

export interface StoredA11yPreferences {
	textSize?: A11yTextSize;
	focusChoice: boolean | null;
	motionChoice?: "off";
}

let memoryStore: string | null = null;

function readRaw(): string | null {
	if (memoryStore !== null) return memoryStore;
	let value: string | null = null;
	try {
		value = localStorage.getItem(STORAGE_KEY);
	} catch {}
	if (value !== null) return value;
	try {
		value = sessionStorage.getItem(STORAGE_KEY);
	} catch {}
	return value ?? memoryStore;
}

export function readA11yPreferences(): StoredA11yPreferences {
	try {
		const raw = readRaw();
		if (!raw) return { focusChoice: null };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const storedSize = parsed.textSize;
		return {
			...(parsed.motionChoice === "off" ? { motionChoice: "off" as const } : {}),
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
		focusMode: preferences.focusChoice === true,
	});
	memoryStore = value;
	try {
		localStorage.setItem(STORAGE_KEY, value);
		memoryStore = null;
		return;
	} catch {}
	try {
		sessionStorage.setItem(STORAGE_KEY, value);
		return;
	} catch {}
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

export function setMotionChoice(choice: "off" | null): void {
	const preferences = readA11yPreferences();
	if (choice === "off") preferences.motionChoice = choice;
	else delete preferences.motionChoice;
	writeA11yPreferences(preferences);
	applyMotionPreferences(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

export function applyMotionPreferences(deviceReduces: boolean): void {
	const reduced = deviceReduces || readA11yPreferences().motionChoice === "off";
	for (const target of preferenceTargets()) {
		if (reduced) target.dataset.praxityReducedMotion = "true";
		else delete target.dataset.praxityReducedMotion;
	}
}

export function announcePreference(message: string): void {
	const region = document.getElementById("praxity-live-region");
	if (region) region.textContent = message;
}
