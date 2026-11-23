import * as nativeFs from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { admissionFilesystem } from "./admission-filesystem";

it("admission handles support positioned reads and streams as well as whole-file IO", async () => {
	const root = await fs.mkdtemp(join(tmpdir(), "admission-handle-"));
	const fixtureFs = admissionFilesystem(fs, nativeFs);
	try {
		const file = join(root, "lesson.prax");
		const writer = await fixtureFs.open(file, "w");
		try {
			await writer.writeFile("abcdef");
		} finally {
			await writer.close();
		}
		const reader = await fixtureFs.open(file, "r");
		try {
			const buffer = Buffer.alloc(2);
			expect((await reader.read(buffer, 0, 2, 2)).bytesRead).toBe(2);
			expect(buffer.toString()).toBe("cd");
			const chunks: Buffer[] = [];
			for await (const chunk of reader.createReadStream({ start: 1, end: 3, autoClose: false }))
				chunks.push(Buffer.from(chunk));
			expect(Buffer.concat(chunks).toString()).toBe("bcd");
		} finally {
			await reader.close();
		}
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
