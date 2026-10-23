import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cp, mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { capturePair } from "./capture.mjs";
import { compareCaptures, printComparison } from "./compare.mjs";
import { freshBuildEnvironment, hash, validateCheckouts } from "./provenance.mjs";

const buildScript = fileURLToPath(new URL("./build.mjs", import.meta.url));
async function run(checkout, args, log) {
	const env = await freshBuildEnvironment(`${log}.environment`);
	const handle = await open(log, "w");
	try {
		await new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					pathToFileURL(path.join(checkout, "node_modules/tsx/dist/loader.mjs")).href,
					buildScript,
					...args,
				],
				{
					cwd: checkout,
					stdio: ["ignore", handle.fd, handle.fd],
					env,
				},
			);
			child.once("error", reject);
			child.once("exit", (code, signal) =>
				code === 0 ? resolve() : reject(new Error(`Build failed (${signal || code}); see ${log}`)),
			);
		});
	} finally {
		await handle.close();
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			control: { type: "boolean", default: false },
			"allow-gate-change": { type: "boolean", default: false },
			"allow-dirty-base": { type: "boolean", default: false },
			base: { type: "string" },
			candidate: { type: "string" },
			course: { type: "string", multiple: true },
			out: { type: "string" },
			"base-html": { type: "string" },
			"candidate-html": { type: "string" },
		},
	});
	const existing = values["base-html"] && values["candidate-html"];
	if (
		!values.base ||
		!values.out ||
		(!existing && (!values.candidate || !values.course?.length)) ||
		Boolean(values["base-html"]) !== Boolean(values["candidate-html"])
	)
		throw new Error(
			"Required: --base <checkout> --candidate <checkout> --course <directory> [--course ...] --out <new-scratch-dir>. Or --base <checkout> --base-html <directory> --candidate-html <directory> --out <new-scratch-dir>.",
		);
	const base = await realpath(values.base);
	const candidate = existing ? base : await realpath(values.candidate);
	const guard = await validateCheckouts(base, candidate, fileURLToPath(import.meta.url), {
		control: values.control,
		allowGateChange: values["allow-gate-change"],
		allowDirtyBase: values["allow-dirty-base"],
		existing: Boolean(existing),
	});
	if (
		existing &&
		!values.control &&
		(await realpath(values["base-html"])) === (await realpath(values["candidate-html"]))
	)
		throw new Error("Identical HTML realpaths require --control");
	const out = path.resolve(values.out);
	for (const directory of [
		base,
		candidate,
		...(values.course || []).map((course) => path.resolve(course)),
		...(existing
			? [path.resolve(values["base-html"]), path.resolve(values["candidate-html"])]
			: []),
	]) {
		if (
			out === directory ||
			out.startsWith(`${directory}${path.sep}`) ||
			directory.startsWith(`${out}${path.sep}`)
		)
			throw new Error("Output must be outside checkouts, course inputs and existing builds");
	}
	await mkdir(path.dirname(out), { recursive: true });
	await mkdir(out); // Refuse reuse: stale PNGs must never satisfy a failed capture.
	const started = performance.now();
	const summary = { pass: false, courses: [] };
	try {
		if (process.platform === "darwin") {
			const probe = spawnSync("pgrep", ["-f", "VoiceOver"], { encoding: "utf8" });
			if (probe.status === 0) throw new Error("VoiceOver active; wait before running captures");
			if (probe.status !== 1) throw new Error(`VoiceOver probe failed: ${probe.stderr}`);
		}
		const baseRequire = createRequire(path.join(base, "packages/export-pipeline/package.json"));
		const { chromium } = baseRequire("@playwright/test");
		const provenance = {
			base,
			candidate,
			...guard,
			baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: base,
				encoding: "utf8",
			}).trim(),
			candidateCommit: execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: candidate,
				encoding: "utf8",
			}).trim(),
			node: process.version,
			lockSha256: hash(await readFile(path.join(base, "pnpm-lock.yaml"))),
			playwright: baseRequire("@playwright/test/package.json").version,
			existingBuilds: Boolean(existing),
		};
		if (hash(await readFile(path.join(candidate, "pnpm-lock.yaml"))) !== provenance.lockSha256)
			throw new Error("Base and candidate lockfiles differ; install the same pinned dependencies");
		await writeFile(path.join(out, "provenance.json"), JSON.stringify(provenance, null, 2));
		if (!existing) {
			await run(
				base,
				["prepare", base, path.join(out, "base-assets")],
				path.join(out, "base-prepare.log"),
			);
			await run(
				candidate,
				["prepare", candidate, path.join(out, "candidate-assets")],
				path.join(out, "candidate-prepare.log"),
			);
		}
		for (const [index, course] of (existing ? ["existing-build"] : values.course).entries()) {
			const courseStart = performance.now();
			const name = `${String(index + 1).padStart(2, "0")}-${path.basename(course)}`;
			const directory = path.join(out, name);
			await mkdir(directory);
			let baseHtml = path.resolve(values["base-html"] || path.join(directory, "base", "html"));
			let candidateHtml = path.resolve(
				values["candidate-html"] || path.join(directory, "candidate", "html"),
			);
			if (!existing) {
				const frozen = path.join(directory, "input");
				await cp(await realpath(course), frozen, {
					recursive: true,
					dereference: true,
					filter: (source) => ![".git", "node_modules"].includes(path.basename(source)),
				});
				for (const [side, checkout] of [
					["base", base],
					["candidate", candidate],
				]) {
					const project = path.join(directory, side, "course");
					await cp(frozen, project, { recursive: true });
					await run(
						checkout,
						[
							"export",
							checkout,
							path.join(directory, side, "html"),
							project,
							path.join(out, `${side}-assets`),
						],
						path.join(directory, `${side}-build.log`),
					);
				}
				baseHtml = path.join(directory, "base", "html");
				candidateHtml = path.join(directory, "candidate", "html");
			}
			await capturePair(chromium, baseHtml, candidateHtml, path.join(directory, "screens"));
			const result = await compareCaptures(
				path.join(directory, "screens", "base"),
				path.join(directory, "screens", "candidate"),
				path.join(directory, "diff"),
			);
			printComparison(result, `${name} `);
			summary.courses.push({
				course,
				name,
				pass: result.pass,
				views: result.baseViews,
				wallSeconds: Math.round((performance.now() - courseStart) / 100) / 10,
			});
		}
		summary.pass = summary.courses.length > 0 && summary.courses.every((course) => course.pass);
	} catch (error) {
		summary.error = String(error);
		console.error(`FAIL gate: ${error.message}`);
	} finally {
		summary.wallSeconds = Math.round((performance.now() - started) / 100) / 10;
		await writeFile(path.join(out, "results.json"), JSON.stringify(summary, null, 2));
	}
	if (!summary.pass) process.exitCode = 1;
}

main().catch((error) => {
	console.error(`FAIL gate: ${error.message}`);
	process.exitCode = 1;
});
