import type { FileHandle } from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_PROJECT_CONFIG } from "@praxity/editor-core/types";
import type { CoursePdfLesson } from "@praxity/format-renderers/pipelines/course-pdf";
import { afterEach, expect, it, vi } from "vitest";
import { resolvePdfAssets } from "../export/resolve-pdf-assets";
import { readProjectConfig, resolveCompletionSettings } from "../project-config";
import { withProjectFileTransaction, writeProjectFiles } from "../project-file-transactions";
import { readProjectTree } from "../project-tree";
import { createStudioProjectSession } from "../studio/project-session";
import { startStudioReadOnlyServer } from "../studio/read-only-server";
import { detectWorkspaceType, readWorkspaceConfig, scanWorkspace } from "../workspace";

const capture = vi.hoisted(() => ({
	target: "",
	arrived: () => {},
	gate: Promise.resolve(),
	holdMs: 0,
}));
const pathRead = vi.hoisted(() => ({
	target: "",
	calls: 0,
	arrived: () => {},
	gate: Promise.resolve(),
}));
const mediaRead = vi.hoisted(() => ({ target: "", file: undefined as FileHandle | undefined }));
vi.mock("node:fs", async (original) => {
	const fs = await original<typeof import("node:fs")>();
	return {
		...fs,
		realpath: Object.assign((...args: Parameters<typeof fs.realpath>) => fs.realpath(...args), {
			native: (...args: Parameters<typeof fs.realpath.native>) => {
				// Stop at the same final authorization path check through native resolution.
				if (String(args[0]) === pathRead.target && ++pathRead.calls === 3) {
					pathRead.arrived();
					void pathRead.gate.then(() => fs.realpath.native(...args));
				} else fs.realpath.native(...args);
			},
		}),
	};
});
vi.mock("node:fs/promises", async (original) => {
	const fs = await original<typeof import("node:fs/promises")>();
	return {
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			if (String(args[0]) === mediaRead.target) mediaRead.file = file;
			return file;
		},
		rename: async (...args: Parameters<typeof fs.rename>) => {
			await fs.rename(...args);
			if (capture.holdMs && String(args[1]).includes(".capture-")) await delay(capture.holdMs);
			if (String(args[0]) === capture.target && String(args[1]).includes(".capture-")) {
				capture.arrived();
				await capture.gate;
			}
		},
	};
});
const roots: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	if (mediaRead.file && mediaRead.file.fd !== -1) await mediaRead.file.close();
	mediaRead.target = "";
	mediaRead.file = undefined;
	capture.target = "";
	capture.holdMs = 0;
	pathRead.target = "";
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["browser"] as const)(
	"closes the %s media descriptor when admission cleanup fails",
	async (host) => {
		const { root } = await fixture();
		// Strict first reads create no lock. Establish one before faulting its release.
		await withProjectFileTransaction(root, async () => {}, "write");
		const server = await startStudioReadOnlyServer({
			projectDir: root,
			getEditorOrigin: () => "http://127.0.0.1:1",
		});
		mediaRead.target = join(root, "assets", "hero.png");
		const close = DatabaseSync.prototype.close;
		vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(function (this: DatabaseSync) {
			close.call(this);
			throw new Error("Reported admission cleanup failure");
		});
		try {
			const response = await fetch(`${server.mediaBaseUrl}assets/hero.png`);
			expect(response.status).toBe(404);
			expect(mediaRead.file, "The real media descriptor was opened").toBeDefined();
			expect(mediaRead.file?.fd).toBe(-1);
		} finally {
			await server.close();
		}
	},
);

it("browser lesson authorization holds admission through its final path check", async () => {
	const { root } = await fixture();
	const session = await createStudioProjectSession(root, "test");
	let releasePath = () => {};
	let releaseCapture = () => {};
	pathRead.calls = 0;
	pathRead.target = join(root, "course.prax");
	const pathPaused = new Promise<void>((resolve) => {
		pathRead.arrived = resolve;
	});
	pathRead.gate = new Promise<void>((resolve) => {
		releasePath = resolve;
	});
	capture.target = pathRead.target;
	capture.gate = new Promise<void>((resolve) => {
		releaseCapture = resolve;
	});
	let captured = false;
	capture.arrived = () => {
		captured = true;
	};
	const read = session
		.invoke("courseReadLesson", { courseDir: root, filename: "course.prax" })
		.then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
	await pathPaused;
	const write = writeProjectFiles(root, [{ path: "course.prax", content: `${source}\nSaved.\n` }]);
	try {
		await delay(100);
		expect(captured, "Writer displaced a lesson during its authorization read").toBe(false);
	} finally {
		releasePath();
		releaseCapture();
		await write;
		await session.close();
	}
	expect(await read).toEqual({
		value: expect.objectContaining({ grammar: expect.stringContaining("Authored bytes") }),
	});
}, 15_000);
const source = "---\nid: reader\ntitle: Saved\n---\n\n# First\n\nAuthored bytes.\n";
const config = JSON.stringify({
	...DEFAULT_PROJECT_CONFIG,
	export: { ...DEFAULT_PROJECT_CONFIG.export, completionThreshold: 0.87 },
});
const state = JSON.stringify({
	cursor: { line: 2, ch: 3 },
	panelLayout: "editor-only",
	activePanel: "files",
	panelWidths: { left: 240, right: 300 },
	recentExportPath: null,
});
const pdfLessons: CoursePdfLesson[] = [
	{
		id: "reader",
		title: "Saved",
		locale: "en",
		blocks: [{ id: "hero", type: "image", data: { src: "/assets/hero.png", alt: "Diagram" } }],
	},
];

async function fixture() {
	const parent = await mkdtemp(join(tmpdir(), "project-readers-"));
	roots.push(parent);
	const root = join(parent, "course");
	await mkdir(join(root, "assets"), { recursive: true });
	await mkdir(join(root, ".praxity"));
	await Promise.all([
		writeFile(join(root, "course.prax"), source),
		writeFile(join(root, "course.yaml"), "id: reader\nlessons: [course.prax]\n"),
		writeFile(join(root, "praxity.json"), config),
		writeFile(join(root, "assets", "hero.png"), "AUTHORED ASSET"),
		writeFile(join(root, ".praxity", "state.json"), state),
		writeFile(join(root, "workspace.praxity.yaml"), "name: Saved workspace\n"),
	]);
	return { root, parent };
}

// Hold the real capture operation open. The product reader must wait, retain its
// value, and resume after installation. No filesystem read is mocked.
async function duringCapture(
	root: string,
	target: string,
	content: string,
	read: () => Promise<unknown>,
	hold = 75,
) {
	let release = () => {};
	const arrived = new Promise<void>((resolve) => {
		capture.arrived = resolve;
	});
	capture.gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	capture.target = join(root, target);
	const write = writeProjectFiles(root, [{ path: target, content }]);
	await arrived;
	let settled = false;
	const result = read()
		.then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		)
		.finally(() => {
			settled = true;
		});
	try {
		await delay(hold);
		expect(settled, "Reader completed while the authored target was captured").toBe(false);
	} finally {
		release();
		await write;
	}
	return result;
}

const cases = [
	["file tree", "course.prax"],
	["workspace scan", "course.prax"],
	["workspace detection", "course.prax"],
	["workspace config", "workspace.praxity.yaml"],
	["config", "praxity.json"],
	["completion settings", "praxity.json"],
	["PDF asset", "assets/hero.png"],
] as const;
for (const [name, target] of cases) {
	it(`admits ${name} reads during a journal capture`, async () => {
		const { root, parent } = await fixture();
		if (name === "workspace detection") await rm(join(root, "workspace.praxity.yaml"));
		const readers: Record<string, () => Promise<unknown>> = {
			"file tree": () => readProjectTree(root),
			"workspace scan": () => scanWorkspace(parent),
			"workspace detection": () => detectWorkspaceType(root),
			"workspace config": () => readWorkspaceConfig(root),
			config: () => readProjectConfig(root),
			"completion settings": () =>
				resolveCompletionSettings({ projectDir: root, fallbackCompletionThreshold: 0.5 }),
			"PDF asset": () => resolvePdfAssets(root, pdfLessons, false),
		};
		const content = await readFile(join(root, target), "utf8");
		const result = await duringCapture(root, target, content, readers[name]);
		const expected = await readers[name]();
		expect(result).toEqual({ value: expected });
	});
}

it("stress polls authored files through the reader interfaces while saving", async () => {
	const { root, parent } = await fixture();
	const server = await startStudioReadOnlyServer({
		projectDir: root,
		getEditorOrigin: () => "http://127.0.0.1:1",
	});
	const hasLesson = (tree: unknown) =>
		Array.isArray(tree) && tree.some((node) => node.name === "course.prax");
	const readers: Record<string, () => Promise<boolean>> = {
		"raw disk": async () =>
			(await readFile(join(root, "course.prax"), "utf8")).includes("Authored bytes"),
		"file tree": async () => hasLesson(await readProjectTree(root)),
		"workspace scan": async () => (await scanWorkspace(parent)).length === 1,
		"workspace detection": async () => (await detectWorkspaceType(parent)) === "project",
		"workspace config": async () => (await readWorkspaceConfig(root)).name === "Saved workspace",
		config: async () => (await readProjectConfig(root)).export.completionThreshold === 0.87,
		"completion settings": async () =>
			(await resolveCompletionSettings({ projectDir: root, fallbackCompletionThreshold: 0.5 }))
				.completionThreshold === 0.87,
		"PDF asset": async () =>
			Buffer.from(
				(await resolvePdfAssets(root, pdfLessons, false)).get("/assets/hero.png") ?? [],
			).toString() === "AUTHORED ASSET",
		"browser media": async () =>
			(await fetch(`${server.mediaBaseUrl}assets/hero.png`)).status === 200,
	};
	const rates = Object.fromEntries(
		Object.keys(readers).map((name) => [name, { reads: 0, failures: 0 }]),
	);
	let running = true;
	const polls = Object.entries(readers).map(async ([name, read]) => {
		while (running) {
			rates[name].reads++;
			try {
				if (!(await read())) rates[name].failures++;
			} catch {
				rates[name].failures++;
			}
			await delay(1);
		}
	});
	// Extend the actual filesystem interval, without substituting authored reads.
	capture.holdMs = 10;
	try {
		for (let index = 0; index < Number(process.env.PRAXITY_READER_STRESS_SAVES ?? 3); index++) {
			await writeProjectFiles(root, [
				{ path: "course.prax", content: `${source}\nSave ${index}.\n` },
				{ path: "praxity.json", content: config },
				{ path: "assets/hero.png", content: "AUTHORED ASSET" },
				{ path: ".praxity/state.json", content: state },
				{ path: "workspace.praxity.yaml", content: "name: Saved workspace\n" },
			]);
		}
	} finally {
		running = false;
		await Promise.all(polls);
		await server.close();
	}
	console.log("READER_STRESS", JSON.stringify(rates));
	if (process.env.PRAXITY_READER_STRESS_OUTPUT)
		await writeFile(process.env.PRAXITY_READER_STRESS_OUTPUT, JSON.stringify(rates, null, 2));
	for (const [name, rate] of Object.entries(rates)) {
		expect(rate.reads, name).toBeGreaterThan(0);
		if (name !== "raw disk") expect(rate.failures, name).toBe(0);
	}
}, 60000);

it("admits browser media open during a journal capture", async () => {
	const { root } = await fixture();
	const server = await startStudioReadOnlyServer({
		projectDir: root,
		getEditorOrigin: () => "http://127.0.0.1:1",
	});
	try {
		const result = await duringCapture(root, "assets/hero.png", "NEW ASSET", async () => {
			const response = await fetch(`${server.mediaBaseUrl}assets/hero.png`);
			return { status: response.status, bytes: await response.text() };
		});
		expect(result).toEqual({ value: { status: 200, bytes: "NEW ASSET" } });
	} finally {
		await server.close();
	}
});
