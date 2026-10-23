import { spawn } from "node:child_process";
import { cp, mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
	comparePackages,
	comparePdf,
	firstDifference,
	normalizePdfMetadata,
	zipPayloads,
} from "./nonvisual-compare.mjs";
import { assertNodeModules, assertNonvisualEntry, selectCourses } from "./nonvisual-isolation.mjs";
import { freshBuildEnvironment, hash, validateCheckouts } from "./provenance.mjs";
import { verifyInput } from "./verify-inputs.mjs";

const categories = [
	"pages",
	"nav",
	"narration",
	"runtime",
	"fragments",
	"playlist",
	"html",
	"scorm-1.2",
	"scorm-2004",
	"pdf-source",
	"pdf",
];
const script = fileURLToPath(new URL("./nonvisual-build.mjs", import.meta.url));
const prepareScript = fileURLToPath(new URL("./build.mjs", import.meta.url));
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const save = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

async function processRun(checkout, command, args, log, separateStderr = false) {
	const env = await freshBuildEnvironment(`${log}.environment`);
	const handle = await open(log, "w");
	const stderr = separateStderr ? await open(`${log}.stderr`, "w") : handle;
	try {
		await new Promise((resolve, reject) => {
			const child = spawn(command, args, {
				cwd: checkout,
				env: { ...env, PRAXITY_EQUIVALENCE_CHECKOUT: checkout },
				stdio: ["ignore", handle.fd, stderr.fd],
				detached: process.platform !== "win32",
			});
			let expired = false;
			const deadline = setTimeout(() => {
				expired = true;
				if (process.platform === "win32") child.kill("SIGKILL");
				else process.kill(-child.pid, "SIGKILL");
			}, 600_000);
			child.once("error", (error) => {
				clearTimeout(deadline);
				reject(error);
			});
			child.once("exit", async (code, signal) => {
				clearTimeout(deadline);
				if (expired || code !== 0) {
					const detail = await readFile(log, "utf8").catch(() => "");
					reject(
						new Error(
							`${expired ? "TIMEOUT" : `Exit ${signal ?? code}`}: ${log}\n${detail.slice(-8000)}`,
						),
					);
				} else resolve();
			});
		});
	} finally {
		await handle.close();
		if (separateStderr) await stderr.close();
	}
}
const run = (checkout, adapter, args, log) =>
	processRun(
		checkout,
		process.execPath,
		[
			"--import",
			pathToFileURL(path.join(checkout, "node_modules/tsx/dist/loader.mjs")).href,
			"--import",
			fileURLToPath(new URL("./nonvisual-isolation.mjs", import.meta.url)),
			adapter,
			...args,
		],
		log,
	);

function playlists(bytes, require) {
	const { JSDOM } = require("jsdom");
	const result = [];
	for (const entry of zipPayloads(bytes).entries.filter((entry) => entry.name.endsWith(".html"))) {
		const dom = new JSDOM(entry.payload.toString("utf8"));
		try {
			const configs = dom.window.document.querySelectorAll("script#praxity-config");
			if (configs.length > 1) throw new Error(`Duplicate config: ${entry.name}`);
			if (!configs.length) continue; // Redirect documents have no playback config.
			const config = JSON.parse(configs[0].textContent);
			result.push({
				file: entry.name,
				narrationPlaylist: config.narrationPlaylist ?? null,
				deckPages: config.deckPages ?? null,
			});
		} finally {
			dom.window.close();
		}
	}
	if (!result.length) throw new Error("No emitted playback configs");
	return result;
}

async function main() {
	const { values } = parseArgs({
		options: {
			base: { type: "string" },
			candidate: { type: "string" },
			out: { type: "string" },
			course: { type: "string", multiple: true },
			subset: { type: "boolean", default: false },
			control: { type: "boolean", default: false },
			"allow-gate-change": { type: "boolean", default: false },
			"allow-dirty-base": { type: "boolean", default: false },
			typst: { type: "string" },
			"pdf-tools": { type: "string" },
		},
	});
	if (!values.base || !values.candidate || !values.out || !values.course?.length)
		throw new Error(
			"Required --base --candidate --course <pin-name=course-directory> [--course ...] --out; PDF requires --typst <executable> --pdf-tools <Poppler bin>",
		);
	const base = await realpath(values.base),
		candidate = await realpath(values.candidate);
	assertNonvisualEntry(base, fileURLToPath(import.meta.url));
	const guard = await validateCheckouts(base, candidate, fileURLToPath(import.meta.url), {
		entryPoint: "nonvisual-gate",
		allowDirtyBase: values["allow-dirty-base"],
		control: values.control,
		allowGateChange: values["allow-gate-change"],
	});
	for (const checkout of [base, candidate]) assertNodeModules(checkout);
	const inputs = await json(path.join(base, "scripts/equivalence/inputs.json"));
	if (inputs.version !== 1) throw new Error("Unsupported pinned inputs manifest");
	const courses = await Promise.all(
		values.course.map(async (value) => {
			const split = value.indexOf("=");
			if (split < 1 || !Object.hasOwn(inputs.courses, value.slice(0, split)))
				throw new Error(`Unknown course pin: ${value}`);
			return { name: value.slice(0, split), directory: await realpath(value.slice(split + 1)) };
		}),
	);
	if (new Set(courses.map((course) => course.name)).size !== courses.length)
		throw new Error("Duplicate course pin");
	const selected = selectCourses(
		inputs,
		courses.map((course) => course.name),
		values.subset,
	);
	console.log(
		`Courses: ${selected.join(", ")}${values.subset ? " (explicit subset)" : " (all pinned courses)"}`,
	);
	const out = path.resolve(values.out);
	for (const directory of [
		base,
		candidate,
		...(await Promise.all(courses.map((course) => realpath(course.directory)))),
	])
		if (
			out === directory ||
			out.startsWith(`${directory}${path.sep}`) ||
			directory.startsWith(`${out}${path.sep}`)
		)
			throw new Error("Output must be outside checkouts and inputs");
	await mkdir(path.dirname(out), { recursive: true });
	await mkdir(out);
	const started = performance.now();
	const summary = {
		pass: false,
		expectedCategories: categories,
		selectedCourses: selected,
		subset: values.subset,
		courses: [],
	};
	try {
		const lock = hash(await readFile(path.join(base, "pnpm-lock.yaml")));
		if (lock !== hash(await readFile(path.join(candidate, "pnpm-lock.yaml"))))
			throw new Error("Lockfiles differ");
		await save(path.join(out, "provenance.json"), {
			...guard,
			node: process.version,
			lockSha256: lock,
			inputsSha256: hash(await readFile(path.join(base, "scripts/equivalence/inputs.json"))),
			typst: values.typst,
			pdfTools: values["pdf-tools"],
		});
		for (const course of courses) {
			const problems = await verifyInput(inputs.courses[course.name], course.directory);
			await save(path.join(out, `${course.name}-inputs.json`), { problems });
			if (problems.length) throw new Error(`${course.name}: pinned inputs differ: ${problems[0]}`);
		}
		let pdfToolError;
		try {
			if (!values.typst || !values["pdf-tools"])
				throw new Error("Typst and Poppler paths required");
			const versions = [];
			for (const [name, binary, args, expected] of [
				["typst", values.typst, ["--version"], "typst 0.15.1 (9dfd3a08)"],
				["pdfinfo", path.join(values["pdf-tools"], "pdfinfo"), ["-v"], "pdfinfo version 24.02.0"],
				[
					"pdftotext",
					path.join(values["pdf-tools"], "pdftotext"),
					["-v"],
					"pdftotext version 24.02.0",
				],
			]) {
				const log = path.join(out, `${name}-version.log`);
				await processRun(base, binary, args, log);
				const version = (await readFile(log, "utf8")).split("\n")[0];
				if (version !== expected) throw new Error(`Unpinned ${name}: ${version}`);
				versions.push({ name, version, sha256: hash(await readFile(binary)) });
			}
			await save(path.join(out, "pdf-toolchain.json"), versions);
		} catch (error) {
			pdfToolError = `BLOCKED PDF: ${error}`;
		}
		const prepareErrors = {};
		for (const [side, checkout] of [
			["base", base],
			["candidate", candidate],
		]) {
			try {
				await run(
					checkout,
					prepareScript,
					["prepare", checkout, path.join(out, `${side}-assets`)],
					path.join(out, `${side}-prepare.log`),
				);
			} catch (error) {
				prepareErrors[side] = String(error);
			}
		}
		const require = createRequire(path.join(base, "apps/desktop/package.json"));
		for (const course of courses) {
			const tick = performance.now();
			const directory = path.join(out, course.name);
			await mkdir(directory);
			const errors = {};
			for (const [side, checkout] of [
				["base", base],
				["candidate", candidate],
			]) {
				const root = path.join(directory, side);
				await mkdir(root);
				const project = path.join(root, "course");
				await cp(course.directory, project, {
					recursive: true,
					dereference: false,
					filter: (file) => ![".git", "node_modules"].includes(path.basename(file)),
				});
				// Independently verify every copied pinned byte before any build can write scratch.
				for (const files of Object.values(inputs.courses[course.name].files))
					for (const [file, expected] of Object.entries(files))
						if (hash(await readFile(path.join(project, file))) !== expected)
							throw new Error(`${side} copy drift: ${file}`);
				for (const mode of ["stages", "html", "scorm-1.2", "scorm-2004", "pdf-source", "pdf"]) {
					try {
						if (prepareErrors[side]) throw new Error(prepareErrors[side]);
						if (mode.startsWith("pdf") && pdfToolError) throw new Error(pdfToolError);
						await run(
							checkout,
							script,
							[
								mode,
								checkout,
								path.join(root, mode),
								project,
								path.join(out, `${side}-assets`),
								values.typst ?? "",
							],
							path.join(root, `${mode}.log`),
						);
						if (mode === "pdf")
							for (const [tool, args, name] of [
								["pdftotext", ["-enc", "UTF-8", path.join(root, mode, "course.pdf"), "-"], "text"],
								["pdfinfo", ["-struct-text", path.join(root, mode, "course.pdf")], "structure"],
								["pdfinfo", ["-meta", path.join(root, mode, "course.pdf")], "metadata"],
							])
								await processRun(
									checkout,
									path.join(values["pdf-tools"], tool),
									args,
									path.join(root, mode, `${name}.txt`),
									true,
								);
					} catch (error) {
						errors[`${side}:${mode}`] = String(error);
					}
				}
			}
			const results = [];
			for (const category of categories) {
				const mode = ["pages", "nav", "narration", "runtime", "fragments"].includes(category)
					? "stages"
					: category === "playlist"
						? "html"
						: category;
				let result;
				try {
					if (errors[`base:${mode}`] || errors[`candidate:${mode}`])
						throw new Error(
							JSON.stringify({
								base: errors[`base:${mode}`],
								candidate: errors[`candidate:${mode}`],
							}),
						);
					const file = (side, name) => path.join(directory, side, mode, name);
					if (["html", "scorm-1.2", "scorm-2004"].includes(category))
						result = comparePackages(
							await readFile(file("base", "course.zip")),
							await readFile(file("candidate", "course.zip")),
						);
					else {
						let left, right;
						if (category === "pdf") {
							const extract = async (side) => ({
								bytes: await readFile(file(side, "course.pdf")),
								text: await readFile(file(side, "text.txt"), "utf8"),
								structure: await readFile(file(side, "structure.txt"), "utf8"),
								diagnostics: await json(file(side, "metadata.json")),
								extractionDiagnostics: await Promise.all(
									["text", "structure", "metadata"].map((name) =>
										readFile(file(side, `${name}.txt.stderr`), "utf8"),
									),
								),
								metadata: normalizePdfMetadata(await readFile(file(side, "metadata.txt"), "utf8")),
							});
							left = await extract("base");
							right = await extract("candidate");
						} else if (category === "playlist") {
							left = playlists(await readFile(file("base", "course.zip")), require);
							right = playlists(await readFile(file("candidate", "course.zip")), require);
						} else {
							left = await json(file("base", `${category}.json`));
							right = await json(file("candidate", `${category}.json`));
						}
						const difference =
							category === "pdf" ? comparePdf(left, right) : firstDifference(left, right);
						result = {
							pass: !difference,
							difference,
							count: Array.isArray(left) ? left.length : Object.keys(left).length,
						};
					}
				} catch (error) {
					result = { pass: false, error: String(error) };
				}
				await save(path.join(directory, `${category}-result.json`), result);
				results.push({ category, ...result, base: undefined, candidate: undefined });
				console.log(
					`${course.name} ${category}: ${result.pass ? "PASS" : "FAIL"} ${JSON.stringify(result.difference ?? result.error ?? result.files ?? result.count)}`,
				);
			}
			const pass = results.length === categories.length && results.every((result) => result.pass);
			summary.courses.push({
				course: course.name,
				pass,
				results,
				wallSeconds: (performance.now() - tick) / 1000,
			});
		}
		summary.pass =
			summary.courses.length === courses.length && summary.courses.every((course) => course.pass);
	} catch (error) {
		summary.error = String(error);
		console.error(summary.error);
	} finally {
		summary.wallSeconds = (performance.now() - started) / 1000;
		await save(path.join(out, "results.json"), summary);
	}
	if (!summary.pass) process.exitCode = 1;
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
