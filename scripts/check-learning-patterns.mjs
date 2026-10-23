import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	admissionDigest,
	inventoryLearningPatterns,
	learningPatternsBundleInventory,
	manifestPath,
	requireVerificationReceipt,
	verificationReceipt,
	verifyLearningPatterns,
} from "./learning-patterns-admission.mjs";

export * from "./learning-patterns-admission.mjs";

const verifierPath = "scripts/check-learning-patterns.mjs";
const ownerPath = "scripts/learning-patterns-admission.mjs";
const git = (root, ...args) =>
	execFileSync("git", ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...args], {
		cwd: root,
		encoding: "utf8",
	});
export async function verifyTrustedBase(root, base) {
	const revision = git(root, "rev-parse", "--verify", `${base}^{commit}`).trim();
	if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A pinned trusted base is required");
	const directory = await mkdtemp(
		path.join(process.env.RUNNER_TEMP ?? tmpdir(), "learning-patterns-base-"),
	);
	try {
		const repository = path.join(directory, "repository");
		git(directory, "init", "--bare", "--quiet", repository);
		const config = path.resolve(root, git(root, "rev-parse", "--git-common-dir").trim(), "config");
		// An empty object database forces contact even when the checkout already
		// has the SHA. Include its authentication config without copying credentials.
		// Keep shallow-fetch boundaries entirely outside the candidate checkout.
		git(
			repository,
			"-c",
			`include.path=${config}`,
			"-c",
			"core.bare=true",
			"fetch",
			"--no-tags",
			"--depth=1",
			"origin",
			revision,
		);
		const trusted = path.join(directory, "verifier.mjs");
		await writeFile(trusted, git(repository, "show", `${revision}:${verifierPath}`));
		await writeFile(
			path.join(directory, "learning-patterns-admission.mjs"),
			git(repository, "show", `${revision}:${ownerPath}`),
		);
		const stdout = execFileSync(process.execPath, [trusted, "--root", root], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
		});
		requireVerificationReceipt(stdout);
		process.stdout.write(stdout);
		return stdout;
	} finally {
		await rm(directory, { recursive: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	try {
		const { values } = parseArgs({
			options: {
				root: { type: "string" },
				"trusted-base": { type: "string" },
				regenerate: { type: "boolean" },
				digest: { type: "boolean" },
				"bundle-inputs": { type: "string" },
				"inspection-inputs": { type: "string" },
			},
		});
		const root = path.resolve(
			values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
		);
		if (values["trusted-base"]) {
			if (values.regenerate) throw new Error("Trusted verification cannot regenerate the manifest");
			await verifyTrustedBase(root, values["trusted-base"]);
		} else if (values.regenerate) {
			const manifest = await inventoryLearningPatterns(root);
			await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, "\t")}\n`);
			let inputs;
			let inspectionInputs;
			if (values["bundle-inputs"] || values["inspection-inputs"]) {
				if (!values["bundle-inputs"] || !values["inspection-inputs"])
					throw new Error("Retained inputs require both --bundle-inputs and --inspection-inputs");
				inputs = JSON.parse(await readFile(values["bundle-inputs"], "utf8"));
				inspectionInputs = JSON.parse(await readFile(values["inspection-inputs"], "utf8"));
			} else {
				const directory = await mkdtemp(path.join(tmpdir(), "learning-patterns-inventory-"));
				try {
					const { bundleViewer } = await import("../packages/export-pipeline/src/bundle-viewer.ts");
					try {
						await bundleViewer(directory, (files) => {
							inputs = files;
						});
					} catch (error) {
						if (error.code !== "LEARNING_PATTERNS_ADMISSION" || !inputs) throw error;
					}
					const { bundleInspectionFrame } = await import(
						"../apps/desktop/scripts/prebuild-viewer.ts"
					);
					try {
						await bundleInspectionFrame(root, directory, (files) => {
							inspectionInputs = files;
						});
					} catch (error) {
						if (error.code !== "LEARNING_PATTERNS_ADMISSION" || !inspectionInputs) throw error;
					}
				} finally {
					await rm(directory, { recursive: true });
				}
			}
			const bundled = [];
			for (const [role, files] of [
				["learner-bundle", inputs],
				["studio-browser", inspectionInputs],
			])
				bundled.push(
					...(await learningPatternsBundleInventory(
						root,
						[{ inputs: Object.fromEntries(files.map((file) => [file, {}])) }],
						role,
						process.cwd(),
					)),
				);
			for (const input of bundled) {
				let file = manifest.files.find((file) => file.path === input.path);
				if (!file) {
					file = {
						...input,
						sourceCommit: manifest.files[0].sourceCommit,
						reviewer: "",
						reviewDate: "",
						reviewReceipt: "",
					};
					manifest.files.push(file);
				}
				file.roles = [...new Set([...file.roles, ...input.roles])].sort();
			}
			manifest.files.sort((a, b) => a.path.localeCompare(b.path, "en"));
			await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, "\t")}\n`);
			console.log(
				`Regenerated learning-patterns admission; every review field is blank. manifest-sha256 ${admissionDigest(manifest)}`,
			);
		} else if (values.digest) {
			const manifest = JSON.parse(await readFile(path.join(root, manifestPath), "utf8"));
			console.log(
				`learning-patterns admission digest: ${manifest.files[0].sourceCommit} manifest-sha256 ${admissionDigest(manifest)}`,
			);
		} else {
			console.log(verificationReceipt(await verifyLearningPatterns(root)));
		}
	} catch (error) {
		console.error(`learning-patterns admission failed: ${error.message}`);
		process.exitCode = 1;
	}
}
