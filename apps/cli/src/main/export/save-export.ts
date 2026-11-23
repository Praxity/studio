export { writeFileAtomicallyWithin as saveExport } from "../path-security";

export function isExportStageFilename(filename: string): boolean {
	return /^\..+\.[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\.tmp$/.test(filename);
}
