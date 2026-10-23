export interface AdmissionFile {
	path: string;
	sha256: string;
	sourceCommit: string;
	roles: string[];
	reviewer: string;
	reviewDate: string;
	reviewReceipt: string;
}
export interface AdmissionManifest {
	version: number;
	package: string;
	files: AdmissionFile[];
}
export function assertLearningPatternsBundleInputs(
	root: string,
	metafiles: { inputs: Record<string, unknown> }[],
	role: string,
	workingDirectory?: string,
): Promise<unknown[]>;
export function verifyAdmittedFiles(root: string): Promise<AdmissionManifest>;

export function installedLearningPatternsDigest(root: string): Promise<string>;
