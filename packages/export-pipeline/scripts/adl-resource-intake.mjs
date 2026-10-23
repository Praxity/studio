#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(scriptDir, "..");
const manifestPath = join(packageDir, "tests", "fixtures", "adl", "resources.json");
const cacheDir = join(packageDir, ".adl-cache", "official");
const metadataPath = join(cacheDir, "metadata.generated.json");

const args = new Set(process.argv.slice(2));
const shouldDownload = args.has("--download");
const insecure = args.has("--insecure");

function usage() {
	console.log(`Usage:
  node scripts/adl-resource-intake.mjs
  node scripts/adl-resource-intake.mjs --download [--insecure]

Default mode validates the ADL resource manifest and reports pending URLs.
--download fetches resources with downloadUrl into packages/export-pipeline/.adl-cache/official/.
--insecure disables TLS certificate verification for legacy ADL hosting issues.`);
}

if (args.has("--help") || args.has("-h")) {
	usage();
	process.exit(0);
}

function validateManifest(manifest) {
	if (!manifest || typeof manifest !== "object") {
		throw new Error("ADL resource manifest must be an object.");
	}
	if (!Array.isArray(manifest.resources)) {
		throw new Error("ADL resource manifest must include a resources array.");
	}

	const ids = new Set();
	for (const resource of manifest.resources) {
		for (const field of ["id", "scormVersion", "category", "title", "sourceLabel", "status"]) {
			if (typeof resource[field] !== "string" || resource[field].length === 0) {
				throw new Error(`Resource is missing string field "${field}": ${JSON.stringify(resource)}`);
			}
		}
		if (ids.has(resource.id)) {
			throw new Error(`Duplicate ADL resource id: ${resource.id}`);
		}
		ids.add(resource.id);
		if (!["1.2", "2004-4th"].includes(resource.scormVersion)) {
			throw new Error(`Unsupported SCORM version for ${resource.id}: ${resource.scormVersion}`);
		}
		if (!["ready", "pending-url"].includes(resource.status)) {
			throw new Error(`Unsupported status for ${resource.id}: ${resource.status}`);
		}
		if (resource.status === "ready" && !resource.downloadUrl) {
			throw new Error(`Ready resource must include downloadUrl: ${resource.id}`);
		}
		if (resource.downloadUrl !== null) {
			new URL(resource.downloadUrl);
		}
		if (resource.sha256 && !/^[a-f0-9]{64}$/.test(resource.sha256)) {
			throw new Error(`Invalid SHA-256 for ${resource.id}: ${resource.sha256}`);
		}
	}
}

function download(url, targetPath) {
	return new Promise((resolve, reject) => {
		const request = httpsGet(url, { rejectUnauthorized: !insecure }, (response) => {
			if (
				response.statusCode &&
				response.statusCode >= 300 &&
				response.statusCode < 400 &&
				response.headers.location
			) {
				const redirected = new URL(response.headers.location, url).toString();
				response.resume();
				download(redirected, targetPath).then(resolve, reject);
				return;
			}

			if (response.statusCode !== 200) {
				response.resume();
				reject(new Error(`HTTP ${response.statusCode} for ${url}`));
				return;
			}

			const file = createWriteStream(targetPath);
			response.pipe(file);
			file.on("finish", () => file.close(resolve));
			file.on("error", reject);
		});
		request.on("error", reject);
	});
}

async function sha256File(path) {
	const hash = createHash("sha256");
	const bytes = await readFile(path);
	hash.update(bytes);
	return hash.digest("hex");
}

async function downloadResource(resource) {
	const url = new URL(resource.downloadUrl);
	const filename = basename(url.pathname) || `${resource.id}.download`;
	const resourceDir = join(cacheDir, resource.id);
	const targetPath = join(resourceDir, filename);
	const tmpPath = `${targetPath}.tmp`;

	await mkdir(resourceDir, { recursive: true });
	await rm(tmpPath, { force: true });
	await download(resource.downloadUrl, tmpPath);
	await rename(tmpPath, targetPath);

	const fileStat = await stat(targetPath);
	const sha256 = await sha256File(targetPath);
	return {
		...resource,
		filename,
		path: targetPath,
		sizeBytes: fileStat.size,
		sha256,
		downloadedAt: new Date().toISOString(),
	};
}

const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
validateManifest(manifest);

const ready = manifest.resources.filter((resource) => resource.downloadUrl);
const pending = manifest.resources.filter((resource) => !resource.downloadUrl);

console.log(`[adl-intake] ${manifest.resources.length} resources indexed.`);
console.log(`[adl-intake] ${ready.length} resources have download URLs.`);
console.log(`[adl-intake] ${pending.length} resources still need URL confirmation.`);

if (pending.length > 0) {
	for (const resource of pending) {
		console.log(`[adl-intake] pending-url ${resource.id} (${resource.sourceLabel})`);
	}
}

if (!shouldDownload) {
	process.exit(0);
}

if (ready.length === 0) {
	console.log("[adl-intake] no resources have confirmed download URLs; nothing to download.");
	process.exit(0);
}

await mkdir(cacheDir, { recursive: true });
const downloads = [];
for (const resource of ready) {
	console.log(`[adl-intake] downloading ${resource.id}`);
	downloads.push(await downloadResource(resource));
}

await writeFile(
	metadataPath,
	`${JSON.stringify(
		{
			canonicalPage: manifest.canonicalPage,
			generatedAt: new Date().toISOString(),
			resources: downloads,
		},
		null,
		2,
	)}\n`,
);
console.log(`[adl-intake] wrote ${metadataPath}`);
