import { constants } from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";
import { writeLessonSource } from "../../lesson-source";
import {
	applyProjectFilePlan,
	defaultProjectFileFlushes,
	withProjectFileFlushes,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../../project-file-transactions";

const [root, stop, fixtureSources] = process.argv.slice(2);
const sources: string[] = fixtureSources
	? JSON.parse(fixtureSources)
	: ["# Café 😀\r\nOld words.\nKeep this.\rLast line", "second old"];
// A pending Promise alone does not keep Node alive. Hold the IPC channel open
// until the parent kills this writer at the requested fault checkpoint.
process.on("message", () => {});
if (stop === "identity-before-link" || stop === "protected:before-link") {
	const link = fsp.link;
	fsp.link = async (...args) => {
		if (basename(String(args[1])) === ".praxity-transaction.json") {
			process.send?.({ paused: true });
			await new Promise<void>(() => {});
		}
		return link(...args);
	};
	syncBuiltinESMExports();
}
if (stop === "cleanup-orphan") {
	const rename = fsp.rename;
	fsp.rename = async (...args) => {
		await rename(...args);
		if (basename(String(args[1])) === "journal.retired") {
			process.send?.({ paused: true });
			await new Promise<void>(() => {});
		}
	};
	syncBuiltinESMExports();
}
if (stop.startsWith("marker:")) {
	const [, marker, phase] = stop.split(":");
	const open = fsp.open;
	fsp.open = async (...args) => {
		const file = await open(...args);
		if (
			[marker, `${marker}.tmp`].includes(basename(String(args[0]))) &&
			Number(args[1]) & constants.O_TRUNC
		) {
			if (phase === "partial") await file.write("partial");
			process.send?.({ paused: true });
			await new Promise<void>(() => {});
		}
		return file;
	};
	syncBuiltinESMExports();
}
try {
	if (stop === "identity-first" || stop === "identity-before-link") {
		const { persistCourseIdentity, resolveCourseIdentity } = await import("../../identity-store");
		await withProjectFileTransaction(
			root,
			async () => {
				await persistCourseIdentity(
					root,
					await resolveCourseIdentity(root, { lessonPaths: ["lesson.prax"] }),
					[],
					{
						// Crash fixtures exercise the confirmed writer that can retire identities.
						retirements: "confirmed",
						onStep: async ({ kind, index }) => {
							if (stop === "identity-before-link") return;
							if (kind !== "installed" || index !== 0) return;
							process.send?.({ paused: true });
							await new Promise<void>(() => {});
						},
					},
				);
			},
			"write",
			false,
		);
	} else if (stop.startsWith("protected:")) {
		await writeProjectFiles(
			root,
			[
				{ path: "narration.yaml", content: "next narration" },
				{ path: ".praxity/review/state.json", content: "next review" },
			],
			{
				onStep: async ({ kind, index }) => {
					if (stop !== `protected:${kind}:${index ?? ""}`) return;
					process.send?.({ paused: true });
					await new Promise<void>(() => {});
				},
			},
		);
	} else if (stop === "committed-save") {
		const changes = sources.map((source) => JSON.parse(source));
		await withProjectFileTransaction(
			root,
			async (canonical) =>
				applyProjectFilePlan(canonical, changes, {
					onStep: async ({ kind, index }) => {
						if (!["installed", "head"].includes(kind) || index !== changes.length - 1) return;
						process.send?.({ paused: true });
						await new Promise<void>(() => {});
					},
				}),
			"write",
			false,
		);
	} else if (stop.startsWith("design:")) {
		if (stop === "design:link" || stop === "design:recover-link") {
			const link = fsp.link;
			fsp.link = async (...args) => {
				await link(...args);
				if (String(args[1]) === join(root, "a.prax")) {
					process.send?.({ paused: true });
					await new Promise<void>(() => {});
				}
			};
			syncBuiltinESMExports();
		}
		if (stop === "design:reclaim") {
			const rename = fsp.rename;
			fsp.rename = async (...args) => {
				await rename(...args);
				if (
					basename(String(args[0])).startsWith(".praxity-write-") &&
					String(args[1]).includes(".reclaim-")
				) {
					process.send?.({ paused: true });
					await new Promise<void>(() => {});
				}
			};
			syncBuiltinESMExports();
		}
		if (stop === "design:reclaim" || stop === "design:recover-link") {
			await withProjectFileTransaction(root, async () => {}, "write");
			throw new Error(`Did not reach ${stop}`);
		}
		let captureFlushes: number | undefined;
		if (stop.startsWith("design:capture")) {
			const rename = fsp.rename;
			fsp.rename = async (...args) => {
				await rename(...args);
				if (String(args[0]) === join(root, stop === "design:capture-b" ? "b.prax" : "a.prax")) {
					captureFlushes = 0;
					if (stop === "design:capture" || stop === "design:capture-b") {
						process.send?.({ paused: true });
						await new Promise<void>(() => {});
					}
				}
			};
			syncBuiltinESMExports();
		}
		await withProjectFileFlushes(
			{
				...defaultProjectFileFlushes,
				async syncDirectory(path) {
					await defaultProjectFileFlushes.syncDirectory(path);
					if (
						captureFlushes !== undefined &&
						stop === `design:capture-directory-${++captureFlushes}`
					) {
						process.send?.({ paused: true });
						await new Promise<void>(() => {});
					}
				},
			},
			() =>
				writeProjectFiles(
					root,
					[
						{ path: "a.prax", content: "A1", expectedContent: "A0" },
						{ path: "b.prax", content: "B1", expectedContent: "B0", head: true },
					],
					{
						onStep: async ({ kind, index }) => {
							if (`design:${kind}:${index}` !== stop) return;
							process.send?.({ paused: true });
							await new Promise<void>(() => {});
						},
					},
				),
		);
	} else if (stop.startsWith("marker:conflict:")) {
		await withProjectFileTransaction(root, async () => {}, "write");
	} else if (stop === "recovery") {
		const link = fsp.link;
		fsp.link = async (from, to) => {
			await link(from, to);
			if (String(to).endsWith("lesson.prax")) {
				process.send?.({ paused: true });
				await new Promise<void>(() => {});
			}
		};
		syncBuiltinESMExports();
		await withProjectFileTransaction(root, async () => {}, "write");
	} else if (stop.startsWith("lesson-")) {
		const rename = fsp.rename;
		fsp.rename = async (...args) => {
			await rename(...args);
			if (
				stop === "lesson-head" &&
				String(args[1]).includes("installed-") &&
				Number(basename(String(args[1])).slice(10)) ===
					JSON.parse(await fsp.readFile(join(root, ".praxity-transaction.json"), "utf8")).plan.files
						.length -
						1
			) {
				process.send?.({ paused: true });
				await new Promise<void>(() => {});
			}
		};
		const link = fsp.link;
		fsp.link = async (from, to) => {
			await link(from, to);
			// The head checkpoint follows its durable installed marker. A raw link
			// alone is an unfinished installation under marker-based recovery.
			if (
				(stop === "lesson-source" && String(to).endsWith("lesson.prax")) ||
				(stop === "lesson-head" &&
					String(to).includes("installed-") &&
					Number(basename(String(to)).slice(10)) ===
						JSON.parse(await fsp.readFile(join(root, ".praxity-transaction.json"), "utf8")).plan
							.files.length -
							1)
			) {
				process.send?.({ paused: true });
				await new Promise<void>(() => {});
			}
		};
		syncBuiltinESMExports();
		const source = await fsp.readFile(join(root, "lesson.prax"), "utf8");
		await writeLessonSource(
			root,
			"lesson.prax",
			source.replace("Old words.", "New words."),
			source,
		);
	} else if (stop === "binary" || stop === "first-head") {
		const changes =
			stop === "binary"
				? [
						{ path: "data.bin", content: Buffer.from([0, 255, 128]), expectedContent: null },
						{ path: "second.prax", content: null, expectedContent: "second old" },
						{ path: "head.json", content: "head new", expectedContent: "head old", head: true },
					]
				: [
						{ path: "head.json", content: "head new", expectedContent: "head old", head: true },
						{
							path: "lesson.prax",
							content: "new lesson",
							expectedContent: "# Café 😀\r\nOld words.\nKeep this.\rLast line",
						},
						{
							path: "second.prax",
							content: "second new",
							expectedContent: "second old",
							head: true,
						},
					];
		await writeProjectFiles(root, changes, {
			onStep: async ({ kind, index }) => {
				if (
					(stop === "binary" && kind === "installed" && index === 1) ||
					(stop === "first-head" && kind === "head" && index === 0)
				) {
					process.send?.({ paused: true });
					await new Promise<void>(() => {});
				}
			},
		});
	} else if (stop === "temporary-name") {
		await writeProjectFiles(
			root,
			[
				{ path: "install.tmp", content: "new", expectedContent: "old" },
				{ path: "head.json", content: "head new", expectedContent: "head old", head: true },
			],
			{
				onStep: async ({ kind }) => {
					if (kind === "installed") {
						process.send?.({ paused: true });
						await new Promise<void>(() => {});
					}
				},
			},
		);
	} else {
		if (stop === "abort") {
			const rename = fsp.rename;
			fsp.rename = async (...args) => {
				await rename(...args);
				if (basename(String(args[1])) === "abort") {
					process.send?.({ paused: true });
					await new Promise<void>(() => {});
				}
			};
			syncBuiltinESMExports();
		}
		await writeProjectFiles(
			root,
			[
				{
					path: "lesson.prax",
					content: sources[0].replace("Old words.", "New words."),
					expectedContent: sources[0],
				},
				{ path: "second.prax", content: "second new", expectedContent: sources[1] },
				{ path: "head.json", content: "head new", expectedContent: "head old", head: true },
			],
			{
				onStep: async ({ kind, index }) => {
					if (stop.startsWith("marker:abort:") && kind === "head")
						throw new Error("Refuse after head");
					if (stop === "abort" && kind === "head") throw new Error("Refused after last head");
					if ((index === undefined ? kind : `${kind}:${index}`) !== stop) return;
					process.send?.({ paused: true });
					await new Promise<void>(() => {});
				},
			},
		);
	}
	process.send?.({ error: `Did not reach ${stop}` });
} catch (error) {
	process.send?.({ error: String(error) });
}
process.disconnect();
