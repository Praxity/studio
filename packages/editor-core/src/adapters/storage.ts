import type { ProjectConfig } from "../types/project";

export interface StorageAdapter {
	// --- Grammar (content) ---
	readGrammar(): Promise<string>;
	writeGrammar(source: string): Promise<void>;

	// --- Assets (binary media) ---
	readAsset(relativePath: string): Promise<Uint8Array>;
	writeAsset(relativePath: string, data: Uint8Array): Promise<string>;
	listAssets(): Promise<string[]>;
	resolveAssetUrl(relativePath: string): string;

	// --- Project config (metadata) ---
	readProjectConfig(): Promise<ProjectConfig>;
	writeProjectConfig(config: ProjectConfig): Promise<void>;
}
