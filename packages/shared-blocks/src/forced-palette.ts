/** Forced-color styles and script fallbacks require an engine that forces a palette. */
export function forcedPalette(): boolean {
	return (
		typeof matchMedia === "function" &&
		matchMedia("(forced-colors: active)").matches &&
		typeof CSS !== "undefined" &&
		typeof CSS.supports === "function" &&
		CSS.supports("forced-color-adjust", "auto")
	);
}
