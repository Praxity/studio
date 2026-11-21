import type { ProjectConfig } from "../types/project";

export interface StorageAdapter {
	readGrammar(): Promise<string>;
	writeGrammar(source: string): Promise<void>;

	readAsset(relativePath: string): Promise<Uint8Array>;
	writeAsset(relativePath: string, data: Uint8Array): Promise<string>;
	listAssets(): Promise<string[]>;
	resolveAssetUrl(relativePath: string): string;

	readProjectConfig(): Promise<ProjectConfig>;
	writeProjectConfig(config: ProjectConfig): Promise<void>;
}
