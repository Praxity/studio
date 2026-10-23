import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StudioServer } from "./studio/server";

const args = process.argv.slice(2);
// This identity belongs to this spawn, not to browser/export subprocesses.
const expectedParent = process.env.PRAXITY_PARENT_PID;
delete process.env.PRAXITY_PARENT_PID;
let server: StudioServer | undefined;
let exitCode: number | undefined;
let parentWatch: NodeJS.Timeout | undefined;
let checkParent: (() => void) | undefined;
let forcedExit: NodeJS.Timeout | undefined;
let closeStarted = false;
const parentDisconnected = () => stop("SIGHUP");

function close() {
	if (!server || closeStarted) return;
	closeStarted = true;
	void server.close().then(
		() => {
			clearTimeout(forcedExit);
			process.exit(exitCode);
		},
		(error: unknown) => {
			process.stderr.write(
				"Praxity studio failed to shut down cleanly.\nPraxity studio n'a pas pu s'arrêter correctement.\n",
			);
			console.error(error);
			process.exit(exitCode);
		},
	);
}

function stop(signal: "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT") {
	if (exitCode !== undefined) return;
	exitCode = 128 + { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGTERM: 15 }[signal];
	clearInterval(parentWatch);
	// Includes stuck startup; a hung filesystem operation can still exceed this allowance.
	forcedExit = setTimeout(() => {
		process.stderr.write(
			"Praxity studio shutdown timed out.\nLe délai d'arrêt de Praxity studio est dépassé.\n",
		);
		process.exit(exitCode);
	}, 10_000);
	close();
}

if (args[0] === "studio" && !args.includes("--help") && !args.includes("-h")) {
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
		process.on(signal, () => stop(signal));
	}
	// IPC retains EOF even if the launcher dies before this bootstrap runs.
	if (process.connected !== undefined) {
		process.on("disconnect", parentDisconnected);
		if (!process.connected) stop("SIGHUP");
	}
	// An expected PID covers early Unix reparenting; IPC EOF identifies the launcher on Windows.
	if (expectedParent !== undefined && !/^[1-9]\d*$/.test(expectedParent)) {
		throw new Error("PRAXITY_PARENT_PID must be a positive integer");
	}
	const parentPid = expectedParent === undefined ? process.ppid : Number(expectedParent);
	if (!Number.isSafeInteger(parentPid)) throw new Error("PRAXITY_PARENT_PID is out of range");
	if (process.connected === undefined && (expectedParent !== undefined || parentPid > 1)) {
		checkParent = () => {
			if (process.platform !== "win32") {
				if (process.ppid !== parentPid) stop("SIGHUP");
				return;
			}
			// shortcut: PID-only Windows launchers are best effort because IDs can be reused.
			// Launch with an IPC channel for reliable EOF, or hold an OS handle if that is unavailable.
			try {
				process.kill(parentPid, 0);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
				stop("SIGHUP");
			}
		};
		parentWatch = setInterval(checkParent, 1_000);
		parentWatch.unref();
		checkParent();
	}
}

if (exitCode !== undefined) process.exit(exitCode);
// Keep expensive imports outside the bootstrap, including in the packaged artifact.
const { runPraxityCli } = await import("./cli");
if (exitCode !== undefined) process.exit(exitCode);
const result = await runPraxityCli(args, {
	writeIdentityNotice: (text) =>
		new Promise((resolve, reject) =>
			process.stderr.write(text, (error) => (error ? reject(error) : resolve())),
		),
	appVersion: process.env.PRAXITY_APP_VERSION ?? "unknown",
	exportAssetsDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "export-assets"),
	editorAssetsDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "editor"),
	expectedAppVersion: process.env.PRAXITY_APP_VERSION,
	expectedViewerSourceHash: process.env.PRAXITY_VIEWER_SOURCE_HASH,
});
checkParent?.();
server = result.studioServer;
if (exitCode !== undefined) {
	if (server) close();
	else process.exit(exitCode);
} else {
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	process.exitCode = result.exitCode;
	if (!server) {
		clearInterval(parentWatch);
		process.off("disconnect", parentDisconnected);
		process.channel?.unref();
	}
	if (server && result.openBrowser) {
		const command =
			process.platform === "win32"
				? "rundll32.exe"
				: process.platform === "darwin"
					? "open"
					: "xdg-open";
		const browserArgs =
			process.platform === "win32"
				? ["url.dll,FileProtocolHandler", server.readyUrl]
				: [server.readyUrl];
		execFile(command, browserArgs, { windowsHide: true }, (error) => {
			if (error) process.stderr.write("Browser launch failed. Open the ready URL printed above.\n");
		});
	}
}
