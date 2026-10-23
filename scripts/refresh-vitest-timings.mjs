import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));

export function timingEntries(
	text,
	projectDirectory = (project) => {
		for (const directory of ["apps", "packages"])
			if (existsSync(resolve(root, directory, project))) return `${directory}/${project}`;
		throw new Error(`Unknown Vitest project: ${project}`);
	},
) {
	const clean = stripVTControlCharacters(text);
	if (clean.trimStart().startsWith("{")) {
		const report = JSON.parse(clean);
		return report.testResults.map((file) => ({
			file: file.name.replaceAll("\\", "/").replace(/^.*\/(?=(?:apps|packages)\/)/, ""),
			duration: file.endTime - file.startTime,
		}));
	}
	const entries = [];
	for (const line of clean.split(/\r?\n/)) {
		const marker = line.indexOf("Vitest file timing: ");
		if (marker >= 0) entries.push(JSON.parse(line.slice(marker + "Vitest file timing: ".length)));
	}
	if (entries.length) return entries;
	// Bootstrap older CI runs which predate the JSON-line reporter.
	for (const line of clean.split(/\r?\n/)) {
		const match = line.match(
			/Z\s+\S+\s+([\w-]+)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\(.+\)\s+([\d.]+)(ms|s)\s*$/,
		);
		if (match)
			entries.push({
				file: `${projectDirectory(match[1])}/${match[2]}`,
				duration: Number(match[3]) * (match[4] === "s" ? 1000 : 1),
			});
	}
	if (!entries.length) throw new Error("No Vitest file timings found");
	return entries;
}

export function timingMap(entries) {
	if (!entries.length) throw new Error("No Vitest file timings found");
	const files = {};
	for (const { file, duration } of entries) {
		if (
			typeof file !== "string" ||
			posix.normalize(file) !== file ||
			file.includes("\\") ||
			!/^(apps|packages)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
		)
			throw new Error(`Invalid repo-relative test path: ${file}`);
		if (!Number.isFinite(duration) || duration < 0)
			throw new Error(`Invalid file duration: ${file}`);
		files[file] = Math.max(files[file] ?? 0, Math.ceil(duration));
	}
	return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const { values, positionals } = parseArgs({
		options: {
			source: { type: "string" },
			output: { type: "string", default: "scripts/vitest-timings.json" },
		},
		allowPositionals: true,
	});
	if (!values.source || !positionals.length)
		throw new Error(
			"Usage: node scripts/refresh-vitest-timings.mjs --source <CI run URL> <logs-or-json>...",
		);
	const files = timingMap(positionals.flatMap((file) => timingEntries(readFileSync(file, "utf8"))));
	const { workers } = JSON.parse(
		readFileSync(new URL("./vitest-timings.json", import.meta.url), "utf8"),
	);
	writeFileSync(
		values.output,
		`${JSON.stringify({ source: values.source, workers, files }, null, "\t")}\n`,
	);
	console.log(`Wrote ${Object.keys(files).length} file timings to ${values.output}`);
}
