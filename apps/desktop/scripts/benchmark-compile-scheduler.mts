import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CompileQueue } from "@praxity/export-pipeline";
import { lessonSourceText } from "@praxity/grammar";
import type { OperationRequest } from "@praxity/grammar/src/operations/contract.ts";
import { resolveLessonSources } from "../src/main/lesson-source.ts";
import {
	createStudioProjectSession,
	type StudioEvent,
} from "../src/main/studio/project-session.ts";
import type {
	EditorOperationResult,
	PreviewRenderDraftResult,
} from "../src/shared/editor-session.ts";
import {
	diskPreflight,
	evaluateGate,
	evaluateRun,
	gateRule,
	monitorCpu,
	monitorWindowsCpu,
	preflightReasons,
	processCpuShare,
	readFilesystem,
	summarize,
} from "./compile-scheduler-gate.mjs";

// SOURCE is read-only; SCRATCH holds fresh run-N/course copies and evidence.
// Usage: node --import tsx .../benchmark-compile-scheduler.mts SOURCE SCRATCH [COMMITS] [RUNS]
const [sourceArg, scratchArg] = process.argv.slice(2);
if (!sourceArg || !scratchArg)
	throw new Error("Usage: benchmark-compile-scheduler.mts SOURCE SCRATCH [COMMITS] [RUNS]");
const course = resolve(sourceArg);
const scratchRoot = resolve(scratchArg);
const samples = Number(process.argv[4] ?? gateRule.commits);
const runCount = Number(process.argv[5] ?? gateRule.runs);
if (
	![samples, runCount].every((value) => Number.isInteger(value) && value > 0) ||
	samples > gateRule.commits ||
	runCount > gateRule.runs
)
	throw new Error(
		`Use 1-${gateRule.commits} commits and 1-${gateRule.runs} runs; shorter runs are smoke checks with no gate verdict`,
	);
await mkdir(scratchRoot);

interface Sample {
	kind: "T2a-main" | "T2b" | "T6-main";
	sample: number;
	ms: number;
	seq?: number;
	watcherMs?: number;
	mainMs?: number;
	stats: { outsideTiming?: { watcherEventAt: number }; timings: { compileMs: number } };
}
async function measure(output: string, rows: Sample[]) {
	await mkdir(output);
	const scratch = join(output, "course");
	await cp(course, scratch, { recursive: true });
	const session = await createStudioProjectSession(scratch, "scheduler-benchmark");
	const digest = (text: string) => createHash("sha256").update(text).digest("hex");
	let waiters: Array<(event: StudioEvent) => void> = [];
	const unsubscribe = session.subscribe((event) => {
		for (const waiter of waiters) waiter(event);
	});
	function nextCompiled(pageId: string, trigger: () => Promise<unknown>) {
		return new Promise<StudioEvent>((done, reject) => {
			const timeout = setTimeout(() => {
				waiters = waiters.filter((candidate) => candidate !== waiter);
				reject(new Error("No compiled event within 5 s"));
			}, 5000);
			const waiter = (event: StudioEvent) => {
				if (
					(event.type === "pageCompiled" && event.patch.pageId === pageId) ||
					event.type === "compileFailed"
				) {
					clearTimeout(timeout);
					waiters = waiters.filter((candidate) => candidate !== waiter);
					done(event);
				}
			};
			waiters.push(waiter);
			trigger().catch((error) => {
				clearTimeout(timeout);
				waiters = waiters.filter((candidate) => candidate !== waiter);
				reject(error);
			});
		});
	}
	try {
		const navigation = (await session.invoke("previewSelectPage", {})) as {
			pages: { id: string }[];
		};
		const pageId = navigation.pages[16]?.id;
		if (!pageId) throw new Error("Course has no page 17");
		await nextCompiled(pageId, () => session.invoke("previewSelectPage", { pageId }));
		for (let sample = 0; sample < samples; sample++) {
			const identity = await resolveLessonSources(scratch);
			const [file, lesson] =
				[...identity.lessons].find(([, read]) => read.pages.some((page) => page.id === pageId)) ??
				[];
			const page = lesson?.pages.find((page) => page.id === pageId);
			const block = page?.blocks.find((block) => block.type === "text");
			const mapping = identity.identity.sourceMappings.find(
				(node) => node.file === file && node.id === block?.id,
			);
			if (!file || !lesson || !mapping) throw new Error("Page 17 has no text target");
			const source = lessonSourceText(lesson);
			const oldText = source.slice(mapping.span.start, mapping.span.end);
			const edited = `Scheduler sample ${sample}.`;
			const request: OperationRequest = {
				transactionId: randomUUID(),
				operation: "editSource",
				files: [{ path: file, baseRevision: digest(source) }],
				targets: [
					{
						file,
						ref: {
							kind: "node",
							nodeId: mapping.id,
							path: mapping.path,
							fingerprint: mapping.fingerprint,
						},
						expectedText: oldText,
					},
				],
				args: { text: edited },
			};
			const start = performance.now();
			const draftRequest = {
				transactionId: request.transactionId,
				pageId,
				nodeId: mapping.id,
				seq: sample + 1,
				source: edited,
			};
			const draftPromise = session.invoke("previewRenderDraft", draftRequest);
			const commitPromise = session.invoke("operationApply", request);
			const draft = (await draftPromise) as PreviewRenderDraftResult;
			const draftElapsed = performance.now() - start;
			if (!draft.ok || !draft.render.fragments.some((fragment) => fragment.html.includes(edited)))
				throw new Error(`Missing draft HTML at sample ${sample}`);
			const result = (await commitPromise) as EditorOperationResult;
			const elapsed = performance.now() - start;
			if (
				!result.ok ||
				result.render?.fragments.length !== 1 ||
				!result.render.fragments.some((fragment) => fragment.html.includes(edited))
			)
				throw new Error(`Missing node-only durable HTML at sample ${sample}`);
			rows.push(
				{
					kind: "T2a-main",
					sample,
					ms: draftElapsed,
					seq: draft.render.seq,
					stats: (await session.invoke("previewStats", {})) as Sample["stats"],
				},
				{
					kind: "T2b",
					sample,
					ms: elapsed,
					seq: result.seq,
					stats: (await session.invoke("previewStats", {})) as Sample["stats"],
				},
			);
			await writeFile(join(output, "samples.json"), JSON.stringify(rows, null, 2));
		}
		// A refused commit must restore the saved fragment without deleting S2's
		// persisted draft. P3b consumes this typed event to patch and announce it.
		const refusalIdentity = await resolveLessonSources(scratch);
		const [refusalFile, refusalLesson] =
			[...refusalIdentity.lessons].find(([, read]) =>
				read.pages.some((page) => page.id === pageId),
			) ?? [];
		const refusalPage = refusalLesson?.pages.find((page) => page.id === pageId);
		const refusalBlock = refusalPage?.blocks.find((block) => block.type === "text");
		const refusalNode = refusalIdentity.identity.sourceMappings.find(
			(node) => node.file === refusalFile && node.id === refusalBlock?.id,
		);
		if (!refusalFile || !refusalLesson || !refusalNode) throw new Error("Missing refusal target");
		const refusalSource = lessonSourceText(refusalLesson);
		const refusedTransaction = randomUUID();
		const refusedRef = {
			kind: "node" as const,
			nodeId: refusalNode.id,
			path: refusalNode.path,
			fingerprint: refusalNode.fingerprint,
		};
		const refusedText = "Refused draft kept.";
		const expectedText = refusalSource.slice(refusalNode.span.start, refusalNode.span.end);
		await session.invoke("draftPut", {
			draft: {
				id: "t2-refusal",
				file: refusalFile,
				target: refusedRef,
				baseRevision: digest(refusalSource),
				expectedText,
				editableText: expectedText,
				baseText: expectedText,
				text: refusedText,
				selection: [0, 0],
				generation: 1,
				status: "dirty",
				diagnostics: [],
				changedAt: Date.now(),
				validatedGeneration: 1,
				persistedGeneration: -1,
			},
		});
		let revert: StudioEvent | undefined;
		const stopRefusal = session.subscribe((event) => {
			if (
				event.type === "draftRendered" &&
				event.render.transactionId === refusedTransaction &&
				event.render.state === "reverted"
			)
				revert = event;
		});
		await session.invoke("previewRenderDraft", {
			transactionId: refusedTransaction,
			pageId,
			nodeId: refusalNode.id,
			seq: samples + 1,
			source: refusedText,
		});
		const refused = (await session.invoke("operationApply", {
			transactionId: refusedTransaction,
			operation: "editSource",
			files: [{ path: refusalFile, baseRevision: digest(refusalSource) }],
			targets: [{ file: refusalFile, ref: refusedRef, expectedText: "Incorrect saved bytes" }],
			args: { text: refusedText },
		})) as EditorOperationResult;
		stopRefusal();
		const kept = (await session.invoke("draftList", {})) as { text: string }[];
		if (
			refused.ok ||
			!revert ||
			revert.type !== "draftRendered" ||
			!revert.render.fragments.some((fragment) =>
				fragment.html.includes(`Scheduler sample ${samples - 1}.`),
			) ||
			!kept.some((draft) => draft.text === refusedText) ||
			(await readFile(join(scratch, refusalFile), "utf8")) !== refusalSource
		)
			throw new Error("Refusal did not restore saved HTML and keep the draft");
		await writeFile(
			join(output, "refusal.json"),
			JSON.stringify({ refused, revert, draftKept: true, sourceUnchanged: true }, null, 2),
		);
		// Use lesson 01, the 55-block lesson from T6, with the visible page containing
		// its first text block. Admission is driven by the real chokidar watcher.
		const identity = await resolveLessonSources(scratch);
		const [file, lesson] = [...identity.lessons].find(([file]) => file.startsWith("01-")) ?? [];
		const page = lesson?.pages.find((page) => page.blocks.some((block) => block.type === "text"));
		const block = page?.blocks.find((block) => block.type === "text");
		const mapping = identity.identity.sourceMappings.find(
			(node) => node.file === file && node.id === block?.id,
		);
		if (!file || !lesson || !page || !mapping) throw new Error("No lesson 01 paragraph");
		await nextCompiled(page.id, () => session.invoke("previewSelectPage", { pageId: page.id }));
		const before = await readFile(join(scratch, file), "utf8");
		for (let sample = 0; sample < samples; sample++) {
			const start = performance.now();
			const event = await nextCompiled(page.id, () =>
				writeFile(
					join(scratch, file),
					`${before.slice(0, mapping.span.start)}Outside sample ${sample}.\n${before.slice(mapping.span.end)}`,
				),
			);
			if (
				event.type !== "pageCompiled" ||
				!event.patch.fragments.some((fragment) =>
					fragment.html.includes(`Outside sample ${sample}.`),
				)
			)
				throw new Error("Missing outside HTML");
			const completedAt = performance.now();
			const stats = (await session.invoke("previewStats", {})) as Sample["stats"];
			if (!stats.outsideTiming) throw new Error("Missing outside timing split");
			rows.push({
				kind: "T6-main",
				sample,
				ms: completedAt - start,
				watcherMs: stats.outsideTiming.watcherEventAt - start,
				mainMs: completedAt - stats.outsideTiming.watcherEventAt,
				stats,
			});
			await writeFile(join(output, "samples.json"), JSON.stringify(rows, null, 2));
		}
		const summarizeKind = (kind: string, values: number[]) => ({ kind, ...summarize(values) });
		const summary = [
			...["T2a-main", "T2b", "T6-main"].map((kind) =>
				summarizeKind(
					kind,
					rows.filter((row) => row.kind === kind).map((row) => row.ms),
				),
			),
			...["T2a-main", "T2b"].map((kind) =>
				summarizeKind(
					`${kind}-gate-${gateRule.gateCommits}`,
					rows
						.filter((row) => row.kind === kind && row.sample < gateRule.gateCommits)
						.map((row) => row.ms),
				),
			),
			summarizeKind(
				"T6-watcher",
				rows.flatMap((row) => (row.watcherMs === undefined ? [] : [row.watcherMs])),
			),
			summarizeKind(
				"T6-after-watcher",
				rows.flatMap((row) => (row.mainMs === undefined ? [] : [row.mainMs])),
			),
			summarizeKind(
				"compile",
				rows.map((row) => row.stats.timings.compileMs),
			),
		];
		const measuredCost = summary.find((entry) => entry.kind === "compile")?.p95 ?? 0;
		const bursts = [0, measuredCost].map((cost) => {
			let now = 0;
			const queue = new CompileQueue(() => now);
			let job: ReturnType<typeof queue.next> = null;
			let finish = 0;
			for (now = 0; now <= 500 + cost * 2; now++) {
				if (job && now >= finish) {
					queue.complete(job, job.seq);
					job = null;
				}
				if (now <= 80 && now % 20 === 0)
					queue.request({ seq: now / 20 + 1, pageIds: [pageId], visiblePageId: pageId });
				if (!job) {
					job = queue.next();
					if (job) finish = now + cost;
				}
			}
			if (queue.stats().compiles > 2) throw new Error("T3 exceeded two compiles");
			return { cost, ...queue.stats() };
		});
		await writeFile(join(output, "bursts.json"), JSON.stringify(bursts, null, 2));
		await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
		return rows;
	} finally {
		unsubscribe();
		await session.close();
	}
}

let filesystem: string | null = null;
let filesystemError: string | null = null;
try {
	filesystem = await readFilesystem(scratchRoot);
} catch (failure) {
	filesystemError = String(failure);
}
const runs: (ReturnType<typeof evaluateRun> & { ownCpuMean?: number })[] = [];
let measurementError: string | null = null;
let eligibleRuns = 0;
// Smoke runs (fewer commits) can never be eligible, so they make exactly runCount attempts.
const attempts = samples < gateRule.commits ? runCount : gateRule.maxAttempts;
for (let run = 1; run <= attempts && eligibleRuns < runCount; run++) {
	let disk = await diskPreflight();
	let refusals = preflightReasons(disk, filesystem);
	for (
		let tries = 1;
		refusals.length && !disk.error && filesystem && tries < gateRule.preflightTries;
		tries++
	) {
		console.error(`Attempt ${run} waiting: ${refusals.join("; ")}`);
		disk = await diskPreflight();
		refusals = preflightReasons(disk, filesystem);
	}
	if (refusals.length) {
		runs.push(
			evaluateRun({
				cpu: { samples: [], error: "Not started: preflight refused" },
				disk,
				filesystem,
				t2a: [],
				t2b: [],
			}),
		);
		console.error(
			`INELIGIBLE run ${run}: ${refusals.join("; ")}${filesystemError ? `; ${filesystemError}` : ""}. Does not count toward pass or fail.`,
		);
		// A missing probe will not recover; a busy disk may on the next attempt.
		if (disk.error || !filesystem) break;
		continue;
	}
	const stopCpu = process.platform === "win32" ? await monitorWindowsCpu() : monitorCpu();
	const rows: Sample[] = [];
	let cpu: Awaited<ReturnType<typeof stopCpu>>;
	const ownStart = process.cpuUsage();
	const wallStart = performance.now();
	let ownCpuMean = 0;
	try {
		await measure(join(scratchRoot, `run-${run}`), rows);
	} catch (failure) {
		measurementError = String(failure);
	} finally {
		ownCpuMean = processCpuShare(process.cpuUsage(ownStart), performance.now() - wallStart);
		cpu = await stopCpu();
	}
	const result = evaluateRun({
		cpu,
		ownCpuMean,
		disk,
		filesystem,
		t2a: rows.filter((row) => row.kind === "T2a-main").map((row) => row.ms),
		t2b: rows.filter((row) => row.kind === "T2b").map((row) => row.ms),
	});
	runs.push({ ...result, ownCpuMean });
	console.log(
		`Run ${run}: ${result.eligible ? "ELIGIBLE" : "INELIGIBLE"}; T2b first-${gateRule.gateCommits} p95 ${result.t2b.p95} ms; max ${result.t2b.max} ms; CPU mean/max ${result.cpu.mean}/${result.cpu.max}% (benchmark's own mean ${ownCpuMean.toFixed(1)}%); filesystem ${filesystem}`,
	);
	if (!result.eligible)
		console.error(`INELIGIBLE: ${result.reasons.join("; ")}. Does not count toward pass or fail.`);
	if (measurementError) {
		await writeFile(join(scratchRoot, "measurement-error.txt"), measurementError);
		console.error(measurementError);
		break;
	}
	if (result.eligible) eligibleRuns++;
}
const gate = { ...evaluateGate(runs), filesystem, filesystemError, measurementError };
if (measurementError) {
	gate.verdict = null;
	gate.exitCode = runs.at(-1)?.eligible ? 1 : gateRule.ineligibleExitCode;
}
await writeFile(join(scratchRoot, "summary.json"), JSON.stringify(gate, null, 2));
console.log(
	`T2b ${gate.verdict?.toUpperCase() ?? "NO VERDICT"}: ${gate.eligibleRuns}/${gateRule.runs} eligible runs; median p95 ${gate.medianP95} ms; filesystem ${filesystem}. Exit ${gate.exitCode}.`,
);
process.exitCode = gate.exitCode;
