import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	prepareTypst,
	selectTypstRelease,
	stageThemeFonts,
	TYPST_RELEASES,
	verifyArchive,
	verifyBinary,
	woffToSfnt,
} from "./prepare-typst.mjs";

test("selects pinned Windows x64 and preserves Darwin targets", () => {
	const windows = selectTypstRelease("win32", "x64");
	assert.equal(windows.target, "x86_64-pc-windows-msvc");
	assert.equal(windows.sha256, "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736");
	assert.equal(
		windows.binarySha256,
		"081217a463adb006f8894b44227fe4b9c9e91fc85f5463d5948e8370db9bb31e",
	);
	assert.equal(selectTypstRelease("darwin", "arm64"), TYPST_RELEASES.arm64);
	assert.equal(selectTypstRelease("darwin", "x64"), TYPST_RELEASES.x64);
	assert.equal(TYPST_RELEASES.arm64.target, "aarch64-apple-darwin");
	assert.equal(TYPST_RELEASES.x64.target, "x86_64-apple-darwin");
	assert.throws(() => selectTypstRelease("win32", "arm64"), /Unsupported.*win32\/arm64/);
	assert.throws(() => selectTypstRelease("freebsd", "x64"), /Unsupported Typst platform/);
	assert.throws(() => selectTypstRelease("darwin", "toString"), /Unsupported/);
});

test("selects the pinned Linux CI compiler and rejects unsupported architectures", () => {
	const linux = selectTypstRelease("linux", "x64");
	assert.equal(linux.target, "x86_64-unknown-linux-musl");
	assert.equal(linux.sha256, "a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c");
	assert.throws(() => selectTypstRelease("linux", "arm64"), /Unsupported.*linux\/arm64/);
	assert.throws(() => verifyArchive(Buffer.from("tampered"), "x64", "linux"), /checksum mismatch/);
});

test("validates Linux ELF architecture, bitness, byte order and version", () => {
	const binary = Buffer.alloc(80);
	binary.write("\x7fELF", 0, "latin1");
	binary[4] = 2;
	binary[5] = 1;
	binary.writeUInt16LE(0x3e, 18);
	binary.write("0.15.1", 64);
	verifyBinary(binary, "x64", "linux");
	assert.throws(() => verifyBinary(binary.subarray(0, 32), "x64", "linux"), /not ELF/);
	for (const [offset, value] of [
		[0, 0],
		[4, 1],
		[5, 2],
		[18, 0xb7],
	]) {
		const altered = Buffer.from(binary);
		altered[offset] = value;
		assert.throws(() => verifyBinary(altered, "x64", "linux"), /not ELF/);
	}
	binary.fill(0, 64);
	assert.throws(() => verifyBinary(binary, "x64", "linux"), /version marker missing/);
});

test("rejects altered archives and incorrect binary architecture", () => {
	assert.throws(() => verifyArchive(Buffer.from("tampered"), "arm64"), /checksum mismatch/);
	assert.throws(() => verifyArchive(Buffer.alloc(0), "universal"), /Unsupported/);
	const binary = Buffer.alloc(32);
	binary.writeUInt32LE(0xfeedfacf, 0);
	binary.writeUInt32LE(0x0100000c, 4);
	binary.write("0.15.1", 8);
	verifyBinary(binary, "arm64");
	assert.throws(() => verifyBinary(binary, "x64"), /not Mach-O/);
	assert.throws(() => verifyBinary(binary, "x64", "win32"), /not PE/);
	binary.writeUInt32LE(0x01000007, 4);
	verifyBinary(binary, "x64");
	binary.fill(0, 8);
	assert.throws(() => verifyBinary(binary, "x64"), /version marker missing/);
});

test("rejects malformed, wrong-architecture and altered Windows executables", () => {
	const binary = Buffer.alloc(160);
	binary.writeUInt16LE(0x5a4d, 0);
	binary.writeUInt32LE(64, 0x3c);
	binary.writeUInt32LE(0x4550, 64);
	binary.writeUInt16LE(0x8664, 68);
	binary.writeUInt16LE(0x20b, 88);
	binary.write("0.15.1", 100);
	assert.throws(() => verifyBinary(binary, "x64", "win32"), /binary checksum mismatch/);
	assert.throws(() => verifyBinary(binary, "x64"), /not Mach-O/);
	assert.throws(() => verifyBinary(binary.subarray(0, 30), "x64", "win32"), /not PE/);
	assert.throws(() => verifyBinary(binary.subarray(0, 80), "x64", "win32"), /not PE/);
	binary.writeUInt32LE(0xffffffff, 0x3c);
	assert.throws(() => verifyBinary(binary, "x64", "win32"), /not PE/);
	binary.writeUInt32LE(64, 0x3c);
	binary.writeUInt16LE(0xaa64, 68);
	assert.throws(() => verifyBinary(binary, "x64", "win32"), /not PE/);
	binary.writeUInt16LE(0x8664, 68);
	binary.writeUInt16LE(0x10b, 88);
	assert.throws(() => verifyBinary(binary, "x64", "win32"), /not PE/);
	binary.writeUInt16LE(0x20b, 88);
	binary.fill(0, 100);
	assert.throws(() => verifyBinary(binary, "x64", "win32"), /version marker missing/);
});

test("checksum failure preserves the previous installation without network", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "typst-prepare-test-"));
	try {
		const archive = path.join(directory, "bad.tar.xz");
		const output = path.join(directory, "installed");
		await writeFile(archive, "altered archive");
		await writeFile(output, "previous bytes");
		await assert.rejects(
			prepareTypst({ archive, output, arch: "arm64", platform: "darwin" }),
			/checksum mismatch/,
		);
		assert.equal(await readFile(output, "utf8"), "previous bytes");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Windows checksum and unsupported target failures preserve the previous installation", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "typst-prepare-windows-test-"));
	try {
		const archive = path.join(directory, "bad.zip");
		const output = path.join(directory, "installed");
		const cache = path.join(directory, "cache");
		await writeFile(archive, "altered Windows archive");
		await writeFile(output, "previous bytes");
		await assert.rejects(
			prepareTypst({ archive, output, cache, arch: "x64", platform: "win32" }),
			/checksum mismatch/,
		);
		await assert.rejects(
			prepareTypst({ archive, output, cache, arch: "arm64", platform: "win32" }),
			/Unsupported.*win32\/arm64/,
		);
		await assert.rejects(readFile(path.join(cache, "typst-x86_64-pc-windows-msvc-0.15.1.zip")), {
			code: "ENOENT",
		});
		assert.equal(await readFile(output, "utf8"), "previous bytes");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("unwraps WOFF theme fonts into checksummed TrueType tables", async () => {
	const require = createRequire(
		new URL("../../../packages/export-pipeline/package.json", import.meta.url),
	);
	const woff = await readFile(
		require.resolve("@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff"),
	);
	const font = woffToSfnt(woff);
	const count = font.readUInt16BE(4);
	assert.equal(count, woff.readUInt16BE(12));
	for (let i = 0; i < count; i++) {
		const record = 12 + i * 16;
		const [checksum, offset, length] = [4, 8, 12].map((n) => font.readUInt32BE(record + n));
		if (font.toString("latin1", record, record + 4) === "head") continue;
		let sum = 0;
		for (let at = offset; at < offset + ((length + 3) & ~3); at += 4)
			sum = (sum + font.readUInt32BE(at)) >>> 0;
		assert.equal(sum, checksum);
	}
	assert.throws(() => woffToSfnt(Buffer.from("not a font")), /Not a WOFF/);
});

test("stages all Clear reading and ExtraBold faces for PDF without changing other families", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "clear-pdf-fonts-"));
	try {
		await stageThemeFonts(directory);
		assert.deepEqual((await readdir(path.join(directory, "atkinson-hyperlegible-next"))).sort(), [
			"400-italic.ttf",
			"400-normal.ttf",
			"600-italic.ttf",
			"600-normal.ttf",
			"700-italic.ttf",
			"700-normal.ttf",
			"800-italic.ttf",
			"800-normal.ttf",
			"LICENSE",
		]);
		assert.deepEqual((await readdir(path.join(directory, "source-sans-3"))).sort(), [
			"400-italic.ttf",
			"400-normal.ttf",
			"700-italic.ttf",
			"700-normal.ttf",
			"LICENSE",
		]);
		assert.match(
			await readFile(path.join(directory, "atkinson-hyperlegible-next/LICENSE"), "utf8"),
			/SIL OPEN FONT LICENSE/,
		);
		for (const weight of [400, 600, 700, 800]) {
			for (const style of ["normal", "italic"]) {
				const font = await readFile(
					path.join(directory, "atkinson-hyperlegible-next", `${weight}-${style}.ttf`),
				);
				const records = Array.from({ length: font.readUInt16BE(4) }, (_, index) => 12 + index * 16);
				const os2 = records.find(
					(offset) => font.toString("latin1", offset, offset + 4) === "OS/2",
				);
				assert.notEqual(os2, undefined);
				const table = font.readUInt32BE(os2 + 8);
				assert.equal(font.readUInt16BE(table + 4), weight);
				assert.equal(Boolean(font.readUInt16BE(table + 62) & 1), style === "italic");
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
