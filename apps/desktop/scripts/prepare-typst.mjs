import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";
import { FONT_LIST } from "../../../packages/grammar/src/font-catalog.ts";

export const TYPST_VERSION = "0.15.1";
export const MITEX_SHA256 = "0159e214845e49cbdc332d9d572da112dae5ad248072e0a7680d38c8307c2e15";
export const MITEX_FILES = [
	"lib.typ",
	"mitex.typ",
	"mitex.wasm",
	"specs/mod.typ",
	"specs/prelude.typ",
	"specs/latex/standard.typ",
	"LICENSE",
	"typst.toml",
];
// GitHub release asset digests, https://api.github.com/repos/typst/typst/releases/tags/v0.15.1
export const TYPST_RELEASES = {
	arm64: {
		target: "aarch64-apple-darwin",
		sha256: "48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a",
		cpu: 0x0100000c,
	},
	x64: {
		target: "x86_64-apple-darwin",
		sha256: "7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa",
		cpu: 0x01000007,
	},
};
const WINDOWS_TYPST_RELEASES = {
	x64: {
		target: "x86_64-pc-windows-msvc",
		sha256: "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736",
		binarySha256: "081217a463adb006f8894b44227fe4b9c9e91fc85f5463d5948e8370db9bb31e",
		machine: 0x8664,
	},
};
const LINUX_TYPST_RELEASES = {
	x64: {
		target: "x86_64-unknown-linux-musl",
		sha256: "a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c",
		machine: 0x3e,
	},
};
const desktopDir = fileURLToPath(new URL("../", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function selectTypstRelease(platform, arch) {
	const releases =
		platform === "darwin"
			? TYPST_RELEASES
			: platform === "win32"
				? WINDOWS_TYPST_RELEASES
				: platform === "linux"
					? LINUX_TYPST_RELEASES
					: undefined;
	if (!releases) throw new Error(`Unsupported Typst platform: ${platform}`);
	if (!Object.hasOwn(releases, arch))
		throw new Error(`Unsupported Typst architecture: ${platform}/${arch}`);
	return releases[arch];
}

// Keep the existing two-argument verification API scoped to Darwin.
export function verifyArchive(bytes, arch, platform = "darwin") {
	const release = selectTypstRelease(platform, arch);
	if (digest(bytes) !== release.sha256) throw new Error(`Typst ${arch} archive checksum mismatch`);
}

export function verifyBinary(bytes, arch, platform = "darwin") {
	const release = selectTypstRelease(platform, arch);
	if (platform === "win32") {
		const pe = bytes.length >= 64 ? bytes.readUInt32LE(0x3c) : 0;
		if (
			bytes.length < 64 ||
			bytes.readUInt16LE(0) !== 0x5a4d ||
			pe < 64 ||
			pe > bytes.length - 26 ||
			bytes.readUInt32LE(pe) !== 0x4550 ||
			bytes.readUInt16LE(pe + 4) !== release.machine ||
			bytes.readUInt16LE(pe + 24) !== 0x20b
		)
			throw new Error(`Typst binary is not PE ${arch}`);
	} else if (platform === "linux") {
		if (
			bytes.length < 64 ||
			bytes.toString("latin1", 0, 4) !== "\x7fELF" ||
			bytes[4] !== 2 ||
			bytes[5] !== 1 ||
			bytes.readUInt16LE(18) !== release.machine
		)
			throw new Error(`Typst binary is not ELF ${arch}`);
	} else {
		if (
			bytes.length < 8 ||
			bytes.readUInt32LE(0) !== 0xfeedfacf ||
			bytes.readUInt32LE(4) !== release.cpu
		)
			throw new Error(`Typst binary is not Mach-O ${arch}`);
	}
	if (!bytes.includes(Buffer.from(TYPST_VERSION)))
		throw new Error("Typst binary version marker missing");
	if (release.binarySha256 && digest(bytes) !== release.binarySha256)
		throw new Error(`Typst ${arch} binary checksum mismatch`);
}

/** WOFF 1.0 is zlib-wrapped SFNT; Typst reads only the unwrapped TrueType/OpenType form. */
export function woffToSfnt(woff) {
	if (woff.toString("latin1", 0, 4) !== "wOFF") throw new Error("Not a WOFF font");
	const count = woff.readUInt16BE(12);
	const power = 2 ** Math.floor(Math.log2(count));
	const header = Buffer.alloc(12 + count * 16);
	woff.copy(header, 0, 4, 8);
	header.writeUInt16BE(count, 4);
	header.writeUInt16BE(power * 16, 6);
	header.writeUInt16BE(Math.log2(power), 8);
	header.writeUInt16BE((count - power) * 16, 10);
	const chunks = [header];
	let offset = header.length;
	for (let i = 0; i < count; i++) {
		const entry = 44 + i * 20;
		const [start, compressed, length] = [4, 8, 12].map((n) => woff.readUInt32BE(entry + n));
		const raw = woff.subarray(start, start + compressed);
		const data = compressed < length ? inflateSync(raw) : raw;
		if (data.length !== length) throw new Error("Corrupt WOFF table");
		woff.copy(header, 12 + i * 16, entry, entry + 4);
		header.writeUInt32BE(woff.readUInt32BE(entry + 16), 16 + i * 16);
		header.writeUInt32BE(offset, 20 + i * 16);
		header.writeUInt32BE(length, 24 + i * 16);
		const padded = Buffer.alloc((length + 3) & ~3);
		data.copy(padded);
		chunks.push(padded);
		offset += padded.length;
	}
	return Buffer.concat(chunks);
}

/** Theme fonts for PDF: the same pinned Fontsource latin files that HTML exports ship as WOFF2. */
export async function stageThemeFonts(target) {
	const exportPipeline = path.join(desktopDir, "../../packages/export-pipeline/package.json");
	const require = createRequire(exportPipeline);
	const { dependencies } = JSON.parse(await readFile(exportPipeline, "utf8"));
	for (const name of Object.keys(dependencies).filter((d) => d.startsWith("@fontsource/"))) {
		const root = path.dirname(require.resolve(`${name}/package.json`));
		const slug = name.slice("@fontsource/".length);
		const weights = FONT_LIST.find((font) => font.fontsource === name)?.faces?.weights ?? [
			400, 700,
		];
		await mkdir(path.join(target, slug), { recursive: true });
		for (const file of await readdir(path.join(root, "files"))) {
			const face = /-latin-(\d+)-(normal|italic)\.woff$/.exec(file);
			if (!face || !weights.includes(Number(face[1]))) continue;
			await writeFile(
				path.join(target, slug, `${face[1]}-${face[2]}.ttf`),
				woffToSfnt(await readFile(path.join(root, "files", file))),
				{ flag: "wx" },
			);
		}
		await writeFile(path.join(target, slug, "LICENSE"), await readFile(path.join(root, "LICENSE")));
	}
}

/** Build-time only. Runtime exports never import this downloader. */
export async function prepareTypst({
	platform = process.platform,
	arch = process.env.TYPST_ARCH ?? process.arch,
	output = path.join(desktopDir, "resources/typst"),
	archive,
	mitexArchive,
	cache = path.join(desktopDir, "resources/.typst-cache"),
} = {}) {
	const release = selectTypstRelease(platform, arch);
	const extension = platform === "win32" ? "zip" : "tar.xz";
	const binary = platform === "win32" ? "typst.exe" : "typst";
	const tar =
		process.platform === "win32"
			? path.join(
					process.env.SystemRoot ??
						path.join(process.env.SystemDrive ?? path.parse(process.execPath).root, "Windows"),
					"System32/tar.exe",
				)
			: "/usr/bin/tar";
	const name = `typst-${release.target}`;
	const archivePath = archive ?? path.join(cache, `${name}-${TYPST_VERSION}.${extension}`);
	let bytes;
	try {
		bytes = await readFile(archivePath);
	} catch (error) {
		if (archive || error.code !== "ENOENT") throw error;
		const response = await fetch(
			`https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/${name}.${extension}`,
			{ signal: AbortSignal.timeout(120_000) },
		);
		if (!response.ok) throw new Error(`Typst download failed: ${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer());
		verifyArchive(bytes, arch, platform);
		await mkdir(cache, { recursive: true });
		const pending = `${archivePath}.${randomUUID()}.tmp`;
		try {
			await writeFile(pending, bytes, { flag: "wx" });
			await rename(pending, archivePath);
		} finally {
			await rm(pending, { force: true });
		}
	}
	verifyArchive(bytes, arch, platform);
	if (archive) {
		await mkdir(cache, { recursive: true });
		const cached = path.join(cache, `${name}-${TYPST_VERSION}.${extension}`);
		const pending = `${cached}.${randomUUID()}.tmp`;
		try {
			await writeFile(pending, bytes, { flag: "wx" });
			await rename(pending, cached);
		} finally {
			await rm(pending, { force: true });
		}
	}
	await mkdir(path.dirname(output), { recursive: true });
	const mitexCache = path.join(cache, "mitex-0.2.7.tar.gz");
	let mitexBytes;
	try {
		mitexBytes = await readFile(mitexArchive ?? mitexCache);
	} catch (error) {
		if (mitexArchive || error.code !== "ENOENT") throw error;
		const response = await fetch("https://packages.typst.org/preview/mitex-0.2.7.tar.gz", {
			signal: AbortSignal.timeout(120_000),
		});
		if (!response.ok) throw new Error(`MiTeX download failed: ${response.status}`);
		mitexBytes = Buffer.from(await response.arrayBuffer());
	}
	if (digest(mitexBytes) !== MITEX_SHA256) throw new Error("MiTeX archive checksum mismatch");
	await mkdir(cache, { recursive: true });
	const mitexPending = `${mitexCache}.${randomUUID()}.tmp`;
	try {
		await writeFile(mitexPending, mitexBytes, { flag: "wx" });
		await rename(mitexPending, mitexCache);
	} finally {
		await rm(mitexPending, { force: true });
	}
	const staging = await mkdtemp(path.join(path.dirname(output), ".typst-stage-"));
	try {
		for (const file of MITEX_FILES) {
			const content = execFileSync(tar, ["-xzOf", "-", file], {
				input: mitexBytes,
				maxBuffer: 20 * 1024 * 1024,
			});
			const target = path.join(staging, "mitex", file);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, content, { flag: "wx" });
		}
		// ZIP extraction needs a seekable file. Use the verified bytes, not a reopened input archive.
		const zip = platform === "win32" ? path.join(staging, ".typst.zip") : undefined;
		if (zip) await writeFile(zip, bytes, { flag: "wx" });
		// Extract selected bytes only. No archive paths or links are created on disk.
		for (const file of [binary, "LICENSE", "NOTICE"]) {
			// GNU tar cannot detect compression on stdin, so name xz explicitly; bsdtar accepts -J too.
			const content = execFileSync(tar, [zip ? "-xOf" : "-xJOf", zip ?? "-", `${name}/${file}`], {
				input: zip ? undefined : bytes,
				maxBuffer: 100 * 1024 * 1024,
			});
			if (file === binary) verifyBinary(content, arch, platform);
			await writeFile(path.join(staging, file), content, { flag: "wx" });
		}
		if (zip) await rm(zip);
		if (platform !== "win32") await chmod(path.join(staging, binary), 0o755);
		await stageThemeFonts(path.join(staging, "fonts"));
		let version = `typst ${TYPST_VERSION} (pinned archive; cross-architecture build)`;
		if (platform === process.platform && arch === process.arch) {
			version = execFileSync(path.join(staging, binary), ["--version"], {
				encoding: "utf8",
				timeout: 10_000,
			}).trim();
			if (version !== "typst 0.15.1 (9dfd3a08)")
				throw new Error(`Unexpected Typst version: ${version}`);
		}
		await writeFile(
			path.join(staging, "FONT-NOTICE"),
			await readFile(
				path.join(desktopDir, "resources/third-party-notices/typst-assets-0.15.1/NOTICE"),
			),
		);
		await writeFile(
			path.join(staging, "version.json"),
			`${JSON.stringify({ version: TYPST_VERSION, platform, arch, archiveSha256: release.sha256, binarySha256: digest(await readFile(path.join(staging, binary))), reportedVersion: version }, null, 2)}\n`,
		);
		// Rename the complete generation only after all checks pass; restore on failure.
		const previous = `${output}.${randomUUID()}.old`;
		let moved = false;
		try {
			await rename(output, previous);
			moved = true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		try {
			await rename(staging, output);
		} catch (error) {
			if (moved) await rename(previous, output);
			throw error;
		}
		if (moved) await rm(previous, { recursive: true, force: true });
		return output;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			platform: { type: "string" },
			arch: { type: "string" },
			output: { type: "string" },
			archive: { type: "string" },
			mitexArchive: { type: "string" },
			cache: { type: "string" },
		},
	});
	console.log(await prepareTypst(values));
}
