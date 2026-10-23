/**
 * Local SCORM test harness using the Rustici SCORM Driver.
 *
 * Takes a SCORM zip buffer, extracts it to a temp directory, copies the
 * appropriate driver files alongside, and starts an HTTP server. Returns
 * the URL to `scormdriver/indexAPI.html` and a cleanup function.
 *
 * Expected layout on disk (mirrors the driver's own directory convention):
 *
 *   <tmp>/
 *     scormdriver/         <- copied driver files (indexAPI.html, scormdriver.js, ...)
 *     scormcontent/        <- extracted SCORM package (index.html, welcome.html, ...)
 *
 * The driver's indexAPI.html references `../scormcontent/index.html`, which
 * resolves correctly with this layout when served from the same HTTP origin.
 */

import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
import handler from "serve-handler";
import { RUSTICI_FILES, rusticiDriverDir } from "../gate-prerequisites";

export type ScormFormat = "scorm12" | "scorm2004";

/** Paths to the Rustici driver files, relative to this file's directory. */
const DRIVER_DIRS: Record<ScormFormat, string> = {
	scorm12: rusticiDriverDir("scorm12"),
	scorm2004: rusticiDriverDir("scorm2004"),
};

export interface LocalHarness {
	/** URL pointing to `scormdriver/indexAPI.html`. Navigate Playwright here. */
	url: string;
	/** Call this to stop the server and delete the temp directory. */
	cleanup: () => Promise<void>;
}

/** A strict same-origin LMS for lifecycle journeys, independent of proprietary drivers. */
export async function createLifecycleHarness(
	zipBuffer: Buffer,
	format: ScormFormat,
	options: { failedStatusEndsAttempt?: boolean } = {},
): Promise<LocalHarness> {
	const files = new Map(
		new AdmZip(zipBuffer)
			.getEntries()
			.filter((entry) => !entry.isDirectory)
			.map((entry) => [`/course/${entry.entryName}`, entry.getData()]),
	);
	const lms = `<!doctype html><html lang="en"><title>Lifecycle LMS</title><body>
<button id="exit" type="button">Return to LMS</button><button id="launch" type="button">Launch course</button>
<iframe title="Course" style="width:100%;height:800px"></iframe><script>
const format = ${JSON.stringify(format)};
const is12 = format === 'scorm12';
// Opt-in test LMS policy: final failed status ends the attempt despite suspend.
const failedStatusEndsAttempt = ${JSON.stringify(options.failedStatusEndsAttempt ?? false)};
const calls = []; const errors = []; const values = {};
let state = 'new', error = '0', saved = {}, entry = 'ab-initio', commitFailure = null;
const ok = () => { error = '0'; return 'true'; };
const fail = code => { error = code; errors.push(code); return 'false'; };
const initialize = arg => {
 calls.push(['initialize', arg]);
 if (state !== 'new') return fail(is12 ? '101' : state === 'closed' ? '104' : '103');
 state = 'active'; return ok();
};
const get = key => {
 calls.push(['get', key]);
 if (state !== 'active') { fail(is12 ? '301' : '123'); return ''; }
 ok(); return key === (is12 ? 'cmi.core.entry' : 'cmi.entry') ? entry : values[key] || '';
};
const set = (key, value) => {
 calls.push(['set', key, value]);
 if (state !== 'active') return fail(is12 ? '301' : '133');
 values[key] = value; return ok();
};
const commit = arg => {
 calls.push(['commit', arg]);
 if (state !== 'active') return fail(is12 ? '301' : '143');
 if (commitFailure) {
  const failure = commitFailure; commitFailure = null;
  if (failure === 'throw') throw new Error('LMS commit transport unavailable');
  return fail(is12 ? '101' : '391');
 }
 saved = {...values}; return ok();
};
const terminate = arg => {
 calls.push(['terminate', arg]);
 if (state !== 'active') return fail(is12 ? '301' : '113');
 saved = {...values}; state = 'closed'; return ok();
};
const api = is12
 ? { LMSInitialize: initialize, LMSGetValue: get, LMSSetValue: set, LMSCommit: commit, LMSFinish: terminate, LMSGetLastError: () => error, LMSGetErrorString: code => code, LMSGetDiagnostic: code => code }
 : { Initialize: initialize, GetValue: get, SetValue: set, Commit: commit, Terminate: terminate, GetLastError: () => error, GetErrorString: code => code, GetDiagnostic: code => code };
window[is12 ? 'API' : 'API_1484_11'] = api;
window.lifecycle = { calls, errors, failNextCommit: mode => { commitFailure = mode; }, snapshot: () => ({state, entry, saved: {...saved}, values: {...values}}) };
const frame = document.querySelector('iframe');
const launch = () => {
 const exit = saved[is12 ? 'cmi.core.exit' : 'cmi.exit'];
 const finalFailure = failedStatusEndsAttempt && (is12
  ? saved['cmi.core.lesson_status'] === 'failed'
  : saved['cmi.completion_status'] === 'completed' && saved['cmi.success_status'] === 'failed');
 entry = exit === 'suspend' && !finalFailure ? 'resume' : Object.keys(saved).length ? '' : 'ab-initio';
 state = 'new'; error = '0'; Object.assign(values, saved);
 frame.src = '/course/index.html';
};
document.getElementById('exit').onclick = () => { frame.src = '/away.html'; };
document.getElementById('launch').onclick = launch;
launch();
</script></body></html>`;
	files.set("/lms.html", Buffer.from(lms));
	files.set(
		"/away.html",
		Buffer.from("<!doctype html><title>Returned</title><p>Returned to LMS</p>"),
	);
	const server = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		if (pathname === "/course/redirect.html") {
			res.writeHead(302, { Location: "/course/two.html" });
			res.end();
			return;
		}
		const bytes = files.get(pathname);
		res.writeHead(bytes ? 200 : 404, {
			"Content-Type": pathname.endsWith(".js")
				? "text/javascript"
				: pathname.endsWith(".css")
					? "text/css"
					: "text/html",
		});
		res.end(bytes ?? "Not found");
	});
	const port = await new Promise<number>((resolvePort, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolvePort((server.address() as AddressInfo).port));
	});
	return {
		url: `http://127.0.0.1:${port}/lms.html`,
		cleanup: () =>
			new Promise<void>((resolveClose, reject) => {
				server.close((error) => (error ? reject(error) : resolveClose()));
				server.closeAllConnections();
			}),
	};
}

/**
 * Check whether the driver files are present on disk.
 * Returns false (and logs a hint) when they are missing so tests can skip.
 */
export async function isDriverAvailable(
	format: ScormFormat,
	driverDir = DRIVER_DIRS[format],
): Promise<boolean> {
	const indexPath = join(driverDir, "indexAPI.html");
	if (process.env.PRAXITY_GATE === "1") {
		for (const file of RUSTICI_FILES) {
			const path = join(driverDir, file);
			try {
				if (!(await stat(path)).isFile()) throw new Error("Not a file");
			} catch {
				throw new Error(`Missing Rustici driver for ${format}: ${path}`);
			}
		}
		return true;
	}
	try {
		await stat(indexPath);
		return true;
	} catch {
		console.warn(
			`[local-harness] Driver not found for ${format}: ${indexPath}\n` +
				`  Copy the scormdriver/ directory from the Rustici SCORM Driver download into:\n` +
				`    packages/export-pipeline/tests/scorm-local/drivers/${format}/`,
		);
		return false;
	}
}

/**
 * Set up a fully self-contained local SCORM player for a given zip buffer.
 *
 * @param zipBuffer - Buffer of the SCORM zip to serve
 * @param format    - "scorm12" or "scorm2004" — selects which driver to use
 */
export async function createLocalHarness(
	zipBuffer: Buffer,
	format: ScormFormat,
): Promise<LocalHarness> {
	const driverDir = DRIVER_DIRS[format];

	// Temp root: two sibling dirs — scormdriver/ and scormcontent/
	const tmpRoot = await mkdtemp(resolve(tmpdir(), "praxity-scorm-local-"));
	const scormDriverDir = join(tmpRoot, "scormdriver");
	const scormContentDir = join(tmpRoot, "scormcontent");

	await mkdir(scormDriverDir, { recursive: true });
	await mkdir(scormContentDir, { recursive: true });

	// Copy driver files into scormdriver/
	await cp(driverDir, scormDriverDir, { recursive: true });

	// Extract SCORM zip into scormcontent/
	const zip = new AdmZip(zipBuffer);
	zip.extractAllTo(scormContentDir, /* overwrite */ true);

	// Serve the entire tmpRoot so both scormdriver/ and scormcontent/ are reachable
	const server = createServer((req, res) => {
		void handler(req, res, { public: tmpRoot, cleanUrls: false });
	});

	const port = await new Promise<number>((resolvePort, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolvePort((server.address() as AddressInfo).port);
		});
	});

	const url = `http://127.0.0.1:${port}/scormdriver/indexAPI.html`;

	const cleanup = async (): Promise<void> => {
		server.closeAllConnections();
		await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
		await rm(tmpRoot, { recursive: true, force: true });
	};

	return { url, cleanup };
}
