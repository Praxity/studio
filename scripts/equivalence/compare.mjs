import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { compareInventories } from "./inventory.mjs";

const require = createRequire(
	new URL("../../packages/export-pipeline/package.json", import.meta.url),
);
const decoder = require("@jsquash/png/decode.js");
const encoder = require("@jsquash/png/encode.js");
const wasm = await readFile(require.resolve("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
await decoder.init(wasm);
await encoder.init(wasm);

export const encodePng = async (image) => Buffer.from(await encoder.default(image));
export const screenshotName = (key) => `${createHash("sha256").update(key).digest("hex")}.png`;

/** Compare all RGBA channels exactly; dimension-only pixels also differ. */
export async function comparePng(baseBytes, candidateBytes) {
	const base = await decoder.default(baseBytes);
	const candidate = await decoder.default(candidateBytes);
	const width = Math.max(base.width, candidate.width);
	const height = Math.max(base.height, candidate.height);
	const data = new Uint8ClampedArray(width * height * 4);
	let changedPixels = 0;
	let bounds = [width, height, 0, 0];
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = (y * base.width + x) * 4;
			const b = (y * candidate.width + x) * 4;
			const offset = (y * width + x) * 4;
			const absent =
				x >= base.width || y >= base.height || x >= candidate.width || y >= candidate.height;
			const changed =
				absent ||
				[0, 1, 2, 3].some((channel) => base.data[a + channel] !== candidate.data[b + channel]);
			if (changed) {
				changedPixels++;
				bounds = [
					Math.min(bounds[0], x),
					Math.min(bounds[1], y),
					Math.max(bounds[2], x + 1),
					Math.max(bounds[3], y + 1),
				];
			}
			data.set(changed ? [224, 0, 96, 255] : [240, 240, 240, 255], offset);
		}
	}
	const pass =
		base.width === candidate.width && base.height === candidate.height && changedPixels === 0;
	return {
		pass,
		baseSize: [base.width, base.height],
		candidateSize: [candidate.width, candidate.height],
		changedPixels,
		bounds: changedPixels ? bounds : null,
		diff: pass ? undefined : await encodePng({ width, height, data }),
	};
}

function captureErrors(view) {
	return [
		...(view.status === "captured" ? [] : [`capture ${view.status || "incomplete"}`]),
		...(!Array.isArray(view.errors) ? ["missing error ledger"] : view.errors),
		...(view.brokenImages || []).map((url) => `broken image: ${url}`),
		...(!view.screenshot ? ["missing screenshot"] : []),
	];
}

function normalizedClippedFocusables(list = []) {
	return list.map(({ tag, href, text, bounds }) => ({
		tag,
		href,
		text: (text || "").replaceAll(/\s+/g, " ").trim(),
		bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
	}));
}

export async function compareCaptures(baseRoot, candidateRoot, out, base, candidate) {
	base ??= JSON.parse(await readFile(path.join(baseRoot, "capture.json"), "utf8"));
	candidate ??= JSON.parse(await readFile(path.join(candidateRoot, "capture.json"), "utf8"));
	await mkdir(out, { recursive: true });
	const inventoryFailures = compareInventories(base, candidate);
	const views = inventoryFailures.map((view) => ({ ...view, pass: false }));
	if (!base.length || !candidate.length)
		views.push({ key: "inventory", pass: false, reason: "empty capture inventory" });
	const mismatched = new Set(views.map((view) => view.key));
	const right = new Map(candidate.map((view) => [view.key, view]));
	for (const view of base) {
		if (mismatched.has(view.key) || !right.has(view.key)) continue;
		const other = right.get(view.key);
		const errors = [
			...captureErrors(view).map((error) => `base: ${error}`),
			...captureErrors(other).map((error) => `candidate: ${error}`),
			...["clippedFocusables", "finalClippedFocusables"].flatMap((field) =>
				JSON.stringify(normalizedClippedFocusables(view[field])) !==
				JSON.stringify(normalizedClippedFocusables(other[field]))
					? [`${field === "clippedFocusables" ? "initial" : "final"} clipped focusables differ`]
					: [],
			),
			...(JSON.stringify(view.initialScrollPositions) !==
			JSON.stringify(other.initialScrollPositions)
				? ["initial scroll positions differ"]
				: []),
			...(Boolean(view.initialScreenshot) !== Boolean(other.initialScreenshot)
				? ["missing initial viewport screenshot"]
				: []),
			...(view.finalUrl !== other.finalUrl
				? [`final URL differs: ${view.finalUrl} -> ${other.finalUrl}`]
				: []),
		];
		let result = { key: view.key, pass: false, reason: errors.join("; ") };
		if (!errors.length) {
			try {
				if (view.initialScreenshot) {
					const { diff: initialDiff, ...initial } = await comparePng(
						await readFile(path.join(baseRoot, view.initialScreenshot)),
						await readFile(path.join(candidateRoot, other.initialScreenshot)),
					);
					if (!initial.pass) {
						const differenceImage = `initial-${screenshotName(view.key)}`;
						await writeFile(path.join(out, differenceImage), initialDiff);
						views.push({
							key: view.key,
							...initial,
							differenceImage,
							reason: `initial viewport: ${initial.changedPixels} changed pixels; ${initial.baseSize.join("x")} -> ${initial.candidateSize.join("x")}`,
						});
						continue;
					}
				}
				const { diff, ...comparison } = await comparePng(
					await readFile(path.join(baseRoot, view.screenshot)),
					await readFile(path.join(candidateRoot, other.screenshot)),
				);
				result = { key: view.key, ...comparison };
				if (diff) {
					result.differenceImage = screenshotName(view.key);
					await writeFile(path.join(out, result.differenceImage), diff);
					result.reason = `${comparison.changedPixels} changed pixels; ${comparison.baseSize.join("x")} -> ${comparison.candidateSize.join("x")}`;
				}
			} catch (error) {
				result.reason = `incomplete/unreadable screenshot: ${error.message}`;
			}
		}
		views.push(result);
	}
	const result = {
		pass: views.length > 0 && views.every((view) => view.pass),
		baseViews: base.length,
		candidateViews: candidate.length,
		views,
	};
	await writeFile(path.join(out, "results.json"), JSON.stringify(result, null, 2));
	return result;
}

export function printComparison(result, prefix = "") {
	for (const view of result.views.filter((view) => !view.pass))
		console.error(`FAIL ${prefix}${view.key}: ${view.reason.replaceAll(/\s+/g, " ")}`);
	console.log(
		`${result.pass ? "PASS" : "FAIL"} ${prefix}${result.baseViews}/${result.candidateViews} views; ${result.views.filter((view) => !view.pass).length} failures`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		const { values } = parseArgs({
			options: { base: { type: "string" }, candidate: { type: "string" }, out: { type: "string" } },
		});
		if (!values.base || !values.candidate || !values.out)
			throw new Error(
				"Required: --base <capture-dir> --candidate <capture-dir> --out <results-dir>",
			);
		const result = await compareCaptures(values.base, values.candidate, values.out);
		printComparison(result);
		if (!result.pass) process.exitCode = 1;
	} catch (error) {
		console.error(`FAIL comparison: ${error.message}`);
		process.exitCode = 1;
	}
}
