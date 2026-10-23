import { classicIslandFilename } from "../../src/classic-island-filename";

export function islandNamesForPreview(names: Iterable<string>, isSmallPreview: boolean): string[] {
	const unique = [...new Set(names)];
	if (!isSmallPreview) return unique;
	return unique.filter((name) => name === "code" || name === "table" || name === "assessmentGroup");
}

export function loadBrowserModule(
	moduleUrl: string,
	useClassic = false,
	ownerDocument = document,
): Promise<unknown> {
	if (useClassic) {
		return new Promise<void>((resolve, reject) => {
			const script = ownerDocument.createElement("script");
			script.src = classicIslandFilename(moduleUrl);
			script.onload = () => {
				script.remove();
				resolve();
			};
			script.onerror = () => {
				script.remove();
				reject(new Error(`Could not load ${script.src}`));
			};
			ownerDocument.head.append(script);
		});
	}
	return import(moduleUrl);
}
