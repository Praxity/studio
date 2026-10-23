import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_CONFIG } from "../../types/project";
import { MemoryStorage } from "../memory-storage";

describe("MemoryStorage", () => {
	it("reads initial grammar source", async () => {
		const storage = new MemoryStorage("# Hello");
		expect(await storage.readGrammar()).toBe("# Hello");
	});

	it("writes and reads grammar", async () => {
		const storage = new MemoryStorage("");
		await storage.writeGrammar("# Updated");
		expect(await storage.readGrammar()).toBe("# Updated");
	});

	it("writes and reads assets", async () => {
		const storage = new MemoryStorage("");
		const data = new Uint8Array([1, 2, 3]);
		const path = await storage.writeAsset("test.png", data);
		expect(path).toBe("assets/test.png");
		const read = await storage.readAsset("assets/test.png");
		expect(read).toEqual(data);
	});

	it("lists assets", async () => {
		const storage = new MemoryStorage("");
		await storage.writeAsset("a.png", new Uint8Array([1]));
		await storage.writeAsset("b.jpg", new Uint8Array([2]));
		const list = await storage.listAssets();
		expect(list).toContain("assets/a.png");
		expect(list).toContain("assets/b.jpg");
	});

	it("resolves asset URLs as data URIs", async () => {
		const storage = new MemoryStorage("");
		await storage.writeAsset("test.png", new Uint8Array([1, 2, 3]));
		const url = storage.resolveAssetUrl("assets/test.png");
		expect(url).toMatch(/^data:/);
	});

	it("reads default project config", async () => {
		const storage = new MemoryStorage("");
		const config = await storage.readProjectConfig();
		expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
	});

	it("writes and reads project config", async () => {
		const storage = new MemoryStorage("");
		const custom = {
			...DEFAULT_PROJECT_CONFIG,
			export: { ...DEFAULT_PROJECT_CONFIG.export, completionThreshold: 1 },
		};
		await storage.writeProjectConfig(custom);
		expect(await storage.readProjectConfig()).toEqual(custom);
	});
});
