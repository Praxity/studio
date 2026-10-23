import { isNonemptyString, isString } from "../../../src/scorm/types";
export function readJsonElement(doc: Document, id: string): Record<string, unknown> | null {
	return parseJsonRecord(doc.getElementById(id)?.textContent);
}

export function parseJsonRecord(text: string | null | undefined): Record<string, unknown> | null {
	if (!text) return null;
	try {
		const value = JSON.parse(text) as unknown;
		return isRecord(value) ? value : null;
	} catch {
		return null;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every(isString);
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(isNonemptyString);
}
