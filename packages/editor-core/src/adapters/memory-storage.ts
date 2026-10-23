import type { ProjectConfig } from "../types/project";
import { DEFAULT_PROJECT_CONFIG } from "../types/project";
import type { StorageAdapter } from "./storage";

export class MemoryStorage implements StorageAdapter {
	private grammar: string;
	private assets = new Map<string, Uint8Array>();
	private config: ProjectConfig;

	constructor(initialGrammar = "", initialConfig?: ProjectConfig) {
		this.grammar = initialGrammar;
		this.config = initialConfig ?? { ...DEFAULT_PROJECT_CONFIG };
	}

	async readGrammar(): Promise<string> {
		return this.grammar;
	}

	async writeGrammar(source: string): Promise<void> {
		this.grammar = source;
	}

	async readAsset(relativePath: string): Promise<Uint8Array> {
		const data = this.assets.get(relativePath);
		if (!data) {
			throw new Error(`Asset not found: ${relativePath}`);
		}
		return data;
	}

	async writeAsset(relativePath: string, data: Uint8Array): Promise<string> {
		const fullPath = relativePath.startsWith("assets/") ? relativePath : `assets/${relativePath}`;
		this.assets.set(fullPath, data);
		return fullPath;
	}

	async listAssets(): Promise<string[]> {
		return [...this.assets.keys()];
	}

	resolveAssetUrl(relativePath: string): string {
		const data = this.assets.get(relativePath);
		if (!data) {
			return "";
		}

		const base64 = btoa(String.fromCharCode(...data));
		const extension = relativePath.split(".").pop()?.toLowerCase() ?? "bin";
		const mime =
			extension === "png"
				? "image/png"
				: extension === "jpg" || extension === "jpeg"
					? "image/jpeg"
					: extension === "webp"
						? "image/webp"
						: extension === "svg"
							? "image/svg+xml"
							: extension === "gif"
								? "image/gif"
								: "application/octet-stream";
		return `data:${mime};base64,${base64}`;
	}

	async readProjectConfig(): Promise<ProjectConfig> {
		return { ...this.config };
	}

	async writeProjectConfig(config: ProjectConfig): Promise<void> {
		this.config = { ...config };
	}
}
