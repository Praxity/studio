import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CourseArtifactFile } from "./build.ts";

export interface AuthoredContentAsset {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: Buffer;
	readonly manifest: CourseArtifactFile;
}

/** Call only after the pattern owner has validated and copied the payload. */
export function encodeAuthoredContentAsset(
	directory: "self-check" | "write-distractors",
	callback: "__praxitySelfCheckAsset" | "__praxityWriteDistractorsAsset",
	input: unknown,
): AuthoredContentAsset {
	const payload = JSON.stringify(input)
		.replaceAll("<", "\\u003c")
		.replace(
			/[\u007f-\uffff]/g,
			(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
	const bytes = Buffer.from(`globalThis.${callback}?.(${payload});\n`);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const path = `${directory}/${sha256}.js`;
	return {
		path,
		sha256,
		bytes,
		manifest: {
			path,
			sha256,
			byteLength: bytes.length,
			mediaType: "text/javascript; charset=utf-8",
		},
	};
}

export async function writeAuthoredContentAssets(
	assets: readonly AuthoredContentAsset[],
	distDir: string,
): Promise<CourseArtifactFile[]> {
	for (const asset of assets) {
		const target = join(distDir, asset.path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, asset.bytes);
	}
	return assets.map((asset) => ({ ...asset.manifest }));
}
