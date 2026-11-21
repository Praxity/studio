import { PassThrough } from "node:stream";
import { ZipArchive } from "archiver";

export async function createZip(
	distDir: string,
	manifestXml: string | null,
	rootFiles?: Array<{ name: string; content: Buffer }>,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const archive = new ZipArchive({ zlib: { level: 6 } });
		const chunks: Buffer[] = [];

		const passthrough = new PassThrough();
		passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
		passthrough.on("end", () => resolve(Buffer.concat(chunks)));
		passthrough.on("error", reject);

		archive.pipe(passthrough);

		if (manifestXml) {
			archive.append(manifestXml, { name: "imsmanifest.xml" });
		}

		if (rootFiles) {
			for (const file of rootFiles) {
				archive.append(file.content, { name: file.name });
			}
		}

		archive.directory(distDir, false);

		archive.finalize();
	});
}
