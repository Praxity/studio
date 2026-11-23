import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function downloadCandidate(
	{ releaseId, repository, outputDir, names, digests, arch },
	execute = execFileSync,
) {
	if (!/^[1-9][0-9]*$/.test(releaseId)) throw new Error("Invalid candidate release ID");
	const architectures = arch ? [arch] : ["arm64", "x64"];
	for (const architecture of architectures) {
		if (!["arm64", "x64"].includes(architecture) || !/^[a-f0-9]{64}$/.test(digests?.[architecture]))
			throw new Error("Expected build digest is required");
		if (
			!new RegExp(`^praxity-cli-[A-Za-z0-9.-]+-macos-${architecture}\\.tar\\.gz$`).test(
				names?.[architecture],
			)
		)
			throw new Error("Invalid expected asset name");
	}
	const pages = JSON.parse(
		execute(
			"gh",
			[
				"api",
				"--paginate",
				"--slurp",
				`repos/${repository}/releases/${releaseId}/assets?per_page=100`,
			],
			{ encoding: "utf8" },
		),
	);
	const assets = pages.flat();
	mkdirSync(outputDir);
	for (const architecture of architectures) {
		const matching = assets.filter((asset) => asset.name === names[architecture]);
		if (matching.length !== 1 || !Number.isSafeInteger(matching[0].id) || matching[0].id < 1)
			throw new Error("Missing, duplicate or invalid candidate asset");
		const bytes = execute(
			"gh",
			[
				"api",
				"-H",
				"Accept: application/octet-stream",
				`repos/${repository}/releases/assets/${matching[0].id}`,
			],
			{ maxBuffer: 512 * 1024 * 1024 },
		);
		if (createHash("sha256").update(bytes).digest("hex") !== digests[architecture])
			throw new Error("Candidate build digest mismatch");
		writeFileSync(join(outputDir, names[architecture]), bytes, { flag: "wx" });
		writeFileSync(
			join(outputDir, `${names[architecture]}.sha256`),
			`${digests[architecture]}  ${names[architecture]}\n`,
			{ flag: "wx" },
		);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		downloadCandidate({
			releaseId: process.env.CANDIDATE_RELEASE_ID,
			repository: process.env.GITHUB_REPOSITORY,
			outputDir: join(process.env.RUNNER_TEMP, "candidate"),
			arch: process.env.NATIVE_ARCH,
			names: { arm64: process.env.EXPECTED_ARM64_NAME, x64: process.env.EXPECTED_X64_NAME },
			digests: { arm64: process.env.EXPECTED_ARM64_SHA256, x64: process.env.EXPECTED_X64_SHA256 },
		});
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
