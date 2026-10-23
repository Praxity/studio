import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	clippedFocusables,
	initialScrollPositions,
	islandsReady,
	narrationReady,
	scrollRegions,
	trackNetworkRequests,
	unprovenMediaCancellations,
} from "./equivalence/capture.mjs";
import { compareCaptures, comparePng, encodePng } from "./equivalence/compare.mjs";
import { compareInventories, deriveInventory, inventory } from "./equivalence/inventory.mjs";
import {
	checkoutState,
	freshBuildEnvironment,
	validateCheckouts,
} from "./equivalence/provenance.mjs";

const html = (config) =>
	`<script type="application/json" id="praxity-config">${JSON.stringify(config)}</script>`;
const document = (file, config) => ({ file, html: config ? html(config) : "<html></html>" });
const image = async (width, height, values = []) => {
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	for (const [index, value] of values) data[index] = value;
	return encodePng({ width, height, data });
};

test("capture waits for narration duration verification rather than a transient loading slider", () => {
	const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
	const { JSDOM } = require("jsdom");
	const dom = new JSDOM(
		'<div class="praxity-narration-position"><input type="range" max="1" value="0" disabled></div>',
	);
	try {
		assert.equal(narrationReady(dom.window.document), false);
		const input = dom.window.document.querySelector("input");
		input.max = "120";
		input.value = "60";
		input.disabled = false;
		assert.equal(narrationReady(dom.window.document), true);
		dom.window.document.body.innerHTML = '<input type="range" disabled>';
		assert.equal(narrationReady(dom.window.document), true);
	} finally {
		dom.window.close();
	}
});

test("PNG comparator: identical pixels pass; one pixel and alpha changes fail", async () => {
	const base = await image(2, 2);
	assert.equal((await comparePng(base, base)).pass, true);
	for (const channel of [0, 3]) {
		const result = await comparePng(base, await image(2, 2, [[channel, 254]]));
		assert.equal(result.pass, false);
		assert.equal(result.changedPixels, 1);
		assert.deepEqual(result.bounds, [0, 0, 1, 1]);
		assert.ok(result.diff.length > 0);
	}
});

test("PNG comparator: a dimension change fails even with identical overlapping pixels", async () => {
	const result = await comparePng(await image(1, 1), await image(2, 1));
	assert.equal(result.pass, false);
	assert.equal(result.changedPixels, 1);
	assert.deepEqual(result.baseSize, [1, 1]);
	assert.deepEqual(result.candidateSize, [2, 1]);
});

test("inventory includes every document and every module-local slide, including unknown utilities", () => {
	const deckPages = [
		{ id: "intro", title: "Intro", moduleSlug: "start" },
		{ id: "next", title: "Next", moduleSlug: "next-module" },
	];
	const views = deriveInventory([
		document("start.html", { deckPages }),
		document("next-module.html", { deckPages }),
		document("nested/article.html", { pageTitle: "Article" }),
		document("glossary.html"),
		document("resources.html"),
		document("index.html"),
		document("redirect.html"),
	]);
	assert.deepEqual(
		views.map((view) => view.key),
		[
			"document:glossary.html",
			"document:index.html",
			"document:nested/article.html",
			"document:next-module.html",
			"document:redirect.html",
			"document:resources.html",
			"document:start.html",
			"slide:next-module.html#next",
			"slide:start.html#intro",
		],
	);
	assert.equal(views.at(-1).url, "start.html?praxity-inspect=1#intro");
});

test("inventory refuses missing deck modules, duplicate slide IDs and invalid config", () => {
	assert.throws(
		() =>
			deriveInventory([document("one.html", { deckPages: [{ id: "x", moduleSlug: "absent" }] })]),
		/missing module/,
	);
	assert.throws(
		() =>
			deriveInventory([
				document("one.html", {
					deckPages: [
						{ id: "x", moduleSlug: "one" },
						{ id: "x", moduleSlug: "one" },
					],
				}),
			]),
		/duplicate slide/,
	);
	assert.throws(
		() => deriveInventory([{ file: "one.html", html: html({}).replace("{}", "broken") }]),
		/JSON/,
	);
	assert.throws(() => deriveInventory([]), /no HTML/);
});

test("independent inventories fail for missing, extra and renamed views", () => {
	const base = deriveInventory([document("index.html"), document("glossary.html")]);
	assert.deepEqual(compareInventories(base, base), []);
	assert.deepEqual(compareInventories(base, base.slice(1)), [
		{ key: "document:glossary.html", reason: "missing candidate view" },
	]);
	assert.deepEqual(compareInventories(base.slice(1), base), [
		{ key: "document:glossary.html", reason: "extra candidate view" },
	]);
	const renamed = deriveInventory([document("index.html"), document("resources.html")]);
	assert.equal(compareInventories(base, renamed).length, 2);
});

test("recursive inventory discovers nested HTML beneath the output root", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-inventory-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const { mkdir } = await import("node:fs/promises");
	await mkdir(path.join(root, "nested"));
	await writeFile(path.join(root, "nested", "page.HTML"), "<html></html>");
	assert.deepEqual(
		(await inventory(root)).map((view) => view.key),
		["document:nested/page.HTML"],
	);
});

test("capture comparison fails closed for page errors, broken images, missing PNGs and unfinished views", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-capture-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const view = {
		key: "document:index.html",
		url: "index.html",
		title: "Index",
		status: "captured",
		errors: [],
		screenshot: "view.png",
	};
	await writeFile(path.join(root, "view.png"), await image(1, 1));
	for (const change of [
		{ errors: ["uncaught exception"] },
		{ brokenImages: ["missing.png"] },
		{ screenshot: "absent.png" },
		{ status: "pending" },
	]) {
		const result = await compareCaptures(
			root,
			root,
			path.join(root, "diff"),
			[view],
			[{ ...view, ...change }],
		);
		assert.equal(result.pass, false);
		assert.equal(result.views.length, 1);
	}
});

test("comparator CLI exits nonzero for planted pixel, dimension, missing and extra views", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-cli-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const { mkdir } = await import("node:fs/promises");
	for (const side of ["base", "candidate"]) {
		await mkdir(path.join(root, side));
		await writeFile(path.join(root, side, "view.png"), await image(1, 1));
	}
	const view = {
		key: "document:index.html",
		url: "index.html",
		title: "Index",
		status: "captured",
		errors: [],
		screenshot: "view.png",
	};
	const run = () =>
		spawnSync(
			process.execPath,
			[
				"scripts/equivalence/compare.mjs",
				"--base",
				path.join(root, "base"),
				"--candidate",
				path.join(root, "candidate"),
				"--out",
				path.join(root, "results"),
			],
			{ encoding: "utf8" },
		);
	await writeFile(path.join(root, "base", "capture.json"), JSON.stringify([view]));
	await writeFile(path.join(root, "candidate", "capture.json"), JSON.stringify([view]));
	assert.equal(run().status, 0);
	for (const bytes of [await image(1, 1, [[0, 0]]), await image(2, 1)]) {
		await writeFile(path.join(root, "candidate", "view.png"), bytes);
		assert.equal(run().status, 1);
	}
	await writeFile(path.join(root, "candidate", "view.png"), await image(1, 1));
	await writeFile(
		path.join(root, "base", "capture.json"),
		JSON.stringify([view, { ...view, key: "missing" }]),
	);
	assert.equal(run().status, 1);
	assert.ok(
		JSON.parse(await readFile(path.join(root, "results", "results.json"))).views.some(
			(row) => row.key === "missing" && row.reason === "missing candidate view",
		),
	);
	await writeFile(path.join(root, "base", "capture.json"), JSON.stringify([view]));
	await writeFile(
		path.join(root, "candidate", "capture.json"),
		JSON.stringify([view, { ...view, key: "extra" }]),
	);
	assert.equal(run().status, 1);
	assert.ok(
		JSON.parse(await readFile(path.join(root, "results", "results.json"))).views.some(
			(row) => row.key === "extra" && row.reason === "extra candidate view",
		),
	);
});

test("P1-2: build environments start empty and cannot share persistent or compiler caches", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-environments-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const base = await freshBuildEnvironment(path.join(root, "base"));
	await writeFile(path.join(base.HOME, "cached-image"), "base encoder bytes");
	const candidate = await freshBuildEnvironment(path.join(root, "candidate"));
	for (const key of ["HOME", "XDG_CACHE_HOME", "LOCALAPPDATA", "TMPDIR"])
		assert.notEqual(base[key], candidate[key]);
	await assert.rejects(readFile(path.join(candidate.HOME, "cached-image")), /ENOENT/);
	assert.equal(candidate.TSX_DISABLE_CACHE, "1");
	assert.equal(candidate.NODE_DISABLE_COMPILE_CACHE, "1");
	assert.equal(candidate.NODE_COMPILE_CACHE, undefined);
	await assert.rejects(freshBuildEnvironment(path.join(root, "base")), /EEXIST/);
});

test("P1-3/P2-4: trusted base tooling, explicit controls, committed/uncommitted/untracked gate edits", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-provenance-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const { mkdir } = await import("node:fs/promises");
	const git = (cwd, ...args) => {
		const result = spawnSync("git", args, { cwd, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	const base = path.join(root, "base"),
		candidate = path.join(root, "candidate");
	await mkdir(path.join(base, "scripts/equivalence"), { recursive: true });
	const script = path.join(base, "scripts/equivalence/pixel-gate.mjs");
	await writeFile(script, "trusted base");
	for (const name of ["build", "capture", "compare", "inventory", "provenance"])
		await writeFile(path.join(base, `scripts/equivalence/${name}.mjs`), "trusted module");
	git(base, "init");
	git(base, "add", ".");
	git(base, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
	git(base, "update-ref", "refs/remotes/origin/main", "HEAD");
	git(root, "clone", base, candidate);
	await assert.rejects(
		validateCheckouts(base, candidate, path.join(candidate, "scripts/equivalence/pixel-gate.mjs"), {
			control: true,
		}),
		/trusted tooling/,
	);
	await assert.rejects(validateCheckouts(base, candidate, script), /--control/);
	await assert.rejects(validateCheckouts(base, base, script), /--control/);
	await validateCheckouts(base, candidate, script, { control: true });
	const baseline = git(base, "rev-parse", "HEAD");
	await writeFile(path.join(base, "production.txt"), "dirty base");
	await assert.rejects(validateCheckouts(base, candidate, script, { control: true }), /Dirty base/);
	const acknowledged = await validateCheckouts(base, candidate, script, {
		control: true,
		allowDirtyBase: true,
	});
	assert.equal(acknowledged.states.base.dirty, true);
	assert.equal(acknowledged.baseIsOriginMain, true);
	git(base, "add", ".");
	git(
		base,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"-m",
		"base advances",
	);
	git(candidate, "fetch", "origin");
	await assert.rejects(validateCheckouts(base, candidate, script), /ancestor/);
	assert.equal(
		(await validateCheckouts(base, candidate, script, { control: true })).baseIsOriginMain,
		false,
	);
	git(base, "reset", "--hard", baseline);
	const nested = path.join(base, ".claude/worktrees/candidate");
	git(root, "clone", base, nested);
	await assert.rejects(
		validateCheckouts(base, nested, path.join(nested, "scripts/equivalence/pixel-gate.mjs"), {
			control: true,
			allowGateChange: true,
			allowDirtyBase: true,
		}),
		/trusted tooling/,
	);
	await rm(path.join(base, ".claude"), { recursive: true });
	const { symlink } = await import("node:fs/promises");
	const module = path.join(base, "scripts/equivalence/capture.mjs");
	await rm(module);
	await symlink(path.join(candidate, "scripts/equivalence/capture.mjs"), module);
	await assert.rejects(
		validateCheckouts(base, candidate, script, { control: true, allowDirtyBase: true }),
		/module realpath/,
	);
	await rm(module);
	git(base, "restore", "scripts/equivalence/capture.mjs");
	await writeFile(path.join(base, "scripts/equivalence/new.mjs"), "dirty base gate");
	await assert.rejects(validateCheckouts(base, candidate, script, { control: true }), /Dirty base/);
	await rm(path.join(base, "scripts/equivalence/new.mjs"));
	const before = await checkoutState(candidate);
	await writeFile(path.join(candidate, "scripts/equivalence/pixel-gate.mjs"), "weakened gate");
	assert.notEqual((await checkoutState(candidate)).diffSha256, before.diffSha256);
	await assert.rejects(
		validateCheckouts(base, candidate, script),
		/Candidate edits equivalence tooling/,
	);
	assert.match(
		(await validateCheckouts(base, candidate, script, { allowGateChange: true })).gateDiff,
		/pixel-gate/,
	);
	git(candidate, "add", ".");
	git(
		candidate,
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"-m",
		"weaken gate",
	);
	await assert.rejects(
		validateCheckouts(base, candidate, script),
		/Candidate edits equivalence tooling/,
	);
	git(candidate, "reset", "--hard", before.commit);
	await writeFile(path.join(candidate, "scripts/equivalence/new.mjs"), "untracked gate");
	assert.notEqual((await checkoutState(candidate)).untrackedSha256, before.untrackedSha256);
	await assert.rejects(
		validateCheckouts(base, candidate, script),
		/Candidate edits equivalence tooling/,
	);
});

test("P3-6: a redirected final URL differs even when pixels match", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-redirect-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(path.join(root, "view.png"), await image(1, 1));
	const view = {
		key: "document:index.html",
		url: "index.html",
		title: "Index",
		status: "captured",
		errors: [],
		screenshot: "view.png",
		finalUrl: "/a.html",
	};
	const result = await compareCaptures(
		root,
		root,
		path.join(root, "diff"),
		[view],
		[{ ...view, finalUrl: "/b.html" }],
	);
	assert.equal(result.pass, false);
	assert.match(result.views[0].reason, /final URL differs/);
});

test("P3-7: cancelled media requires a completed request for that exact URL", () => {
	assert.deepEqual(
		unprovenMediaCancellations(["/a.mp3", "/a.mp3", "/b.mp3"], ["/b.mp3", "/c.mp3"]),
		["/a.mp3"],
	);
	assert.deepEqual(unprovenMediaCancellations(["/a.mp3"], ["/a.mp3"]), []);
});

test("P1-1: nested scroll regions are audited independently of document full-page size", () => {
	const node = {
		tagName: "MAIN",
		id: "main-content",
		classList: [],
		clientHeight: 762,
		scrollHeight: 1606,
		clientWidth: 1280,
		scrollWidth: 1280,
		getBoundingClientRect: () => ({ width: 1280, height: 762 }),
	};
	const doc = {
		querySelectorAll: () => [node],
		defaultView: {
			getComputedStyle: () => ({ overflowY: "auto", overflowX: "auto", visibility: "visible" }),
		},
	};
	assert.equal(scrollRegions(doc)[0].scrollHeight - scrollRegions(doc)[0].clientHeight, 844);
	node.clientHeight = 1606;
	assert.deepEqual(scrollRegions(doc), []);
	node.scrollWidth = 1300;
	assert.equal(scrollRegions(doc)[0].horizontal, true);
	node.getBoundingClientRect = () => ({ width: 0, height: 0 });
	assert.deepEqual(scrollRegions(doc), []);
});

test("P2-5: each rendered island needs its runtime hydration marker", () => {
	let hydrated = false;
	const node = {
		hasAttribute: () => hydrated,
		getBoundingClientRect: () => ({ width: 1280, height: 100 }),
	};
	const doc = {
		querySelectorAll: () => [node],
		defaultView: { getComputedStyle: () => ({ visibility: "visible" }) },
	};
	assert.equal(islandsReady(doc), false);
	hydrated = true;
	assert.equal(islandsReady(doc), true);
	hydrated = false;
	node.getBoundingClientRect = () => ({ width: 0, height: 0 });
	assert.equal(islandsReady(doc), true);
});

test("isolated long temporary paths work through the pinned tsx import hook without a CLI socket", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-long-tmp-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const env = await freshBuildEnvironment(
		path.join(root, "long-isolated-environment-directory-for-prepare-and-export"),
	);
	const source = path.join(root, "probe.ts");
	await writeFile(source, 'const value: string = "fresh compiler"; console.log(value);');
	const result = spawnSync(
		process.execPath,
		["--import", new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href, source],
		{ env, encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "fresh compiler");
});

test("R2-P2a: requests after initial idle restart quiet time; unfinished requests time out", async () => {
	const page = new EventEmitter();
	const tracker = trackNetworkRequests(page);
	assert.equal(trackNetworkRequests(page), tracker);
	await tracker.waitForQuiet({ quietMs: 1 });
	const request = { url: () => "http://local/resize-background.png" };
	page.emit("request", request);
	await assert.rejects(tracker.waitForQuiet({ quietMs: 1, timeoutMs: 10 }), /resize-background/);
	page.emit("requestfinished", request);
	await tracker.waitForQuiet({ quietMs: 1 });
	page.emit("request", request);
	page.emit("requestfailed", request);
	await tracker.waitForQuiet({ quietMs: 1 });
	const start = performance.now();
	setTimeout(() => page.emit("request", request), 10);
	setTimeout(() => page.emit("requestfinished", request), 40);
	await tracker.waitForQuiet({ quietMs: 30 });
	assert.ok(performance.now() - start >= 70);
});

test("R2-P1: initial viewport and scroll offsets are independently required", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-initial-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(path.join(root, "full.png"), await image(1, 1));
	await writeFile(path.join(root, "initial.png"), await image(1, 1));
	await writeFile(path.join(root, "changed.png"), await image(1, 1, [[0, 1]]));
	const view = {
		key: "document:index.html",
		url: "index.html",
		title: "Index",
		status: "captured",
		errors: [],
		screenshot: "full.png",
		initialScreenshot: "initial.png",
		initialScrollPositions: [{ element: "main", top: 0, left: 0 }],
	};
	assert.equal(
		(await compareCaptures(root, root, path.join(root, "same"), [view], [view])).pass,
		true,
	);
	for (const other of [
		{ ...view, initialScreenshot: "changed.png" },
		{ ...view, initialScreenshot: "absent.png" },
		{ ...view, initialScreenshot: undefined },
		{ ...view, initialScrollPositions: [{ element: "main", top: 125, left: 0 }] },
	])
		assert.equal(
			(await compareCaptures(root, root, path.join(root, "diff"), [view], [other])).pass,
			false,
		);
});

test("R2-P1: initial offsets include nonzero document and nested scrollers without resetting", () => {
	const make = (top, overflowY) => ({
		tagName: "MAIN",
		id: "",
		classList: [],
		scrollTop: top,
		scrollLeft: 0,
		getBoundingClientRect: () => ({ width: 1280, height: 900 }),
		style: { overflowY, overflowX: "visible" },
	});
	const nodes = [make(80, "visible"), make(125, "auto"), make(0, "hidden"), make(0, "visible")];
	const doc = {
		scrollingElement: nodes[0],
		querySelectorAll: () => nodes,
		defaultView: { getComputedStyle: (node) => node.style },
	};
	assert.deepEqual(
		initialScrollPositions(doc).map(({ top }) => top),
		[80, 125],
	);
	assert.equal(nodes[1].scrollTop, 125);
});

test("R2-P3c: diagnose clipped focusable content; ordinary scrolling is covered separately", () => {
	const parent = {
		tagName: "DIV",
		clientLeft: 0,
		clientTop: 0,
		clientWidth: 1280,
		clientHeight: 900,
		scrollWidth: 1280,
		scrollHeight: 1600,
		parentElement: null,
		getBoundingClientRect: () => ({ left: 0, top: 0 }),
		style: { overflowX: "hidden", overflowY: "hidden" },
	};
	const link = {
		tagName: "A",
		textContent: "hidden",
		getAttribute: (name) => (name === "href" ? "#" : null),
		tabIndex: 0,
		closest: () => null,
		parentElement: parent,
		outerHTML: '<a href="#">hidden</a>',
		getBoundingClientRect: () => ({
			width: 100,
			height: 20,
			left: 0,
			right: 100,
			top: 1500,
			bottom: 1520,
		}),
		style: {},
	};
	const doc = {
		querySelectorAll: () => [link],
		defaultView: { getComputedStyle: (node) => node.style },
	};
	assert.deepEqual(
		clippedFocusables(doc).map(({ tag, href, text, bounds }) => ({ tag, href, text, bounds })),
		[
			{
				tag: "a",
				href: "#",
				text: "hidden",
				bounds: { left: 0, top: 1500, right: 100, bottom: 1520 },
			},
		],
	);
	parent.style.overflowY = "clip";
	assert.equal(clippedFocusables(doc).length, 1);
	parent.style.overflowY = "auto";
	assert.deepEqual(clippedFocusables(doc), []);
	parent.style.overflowY = "hidden";
	link.tabIndex = -1;
	assert.deepEqual(clippedFocusables(doc), []);
});

test("R2-P3b: existing HTML aliases require explicit --control", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-html-alias-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const { mkdir, symlink } = await import("node:fs/promises");
	const base = path.resolve(new URL("..", import.meta.url).pathname);
	const html = path.join(root, "html"),
		alias = path.join(root, "alias");
	await mkdir(html);
	await symlink(html, alias);
	const run = spawnSync(
		process.execPath,
		[
			"scripts/equivalence/pixel-gate.mjs",
			"--base",
			base,
			"--allow-dirty-base",
			"--allow-gate-change",
			"--base-html",
			html,
			"--candidate-html",
			alias,
			"--out",
			path.join(root, "out"),
		],
		{ cwd: base, encoding: "utf8" },
	);
	assert.equal(run.status, 1);
	assert.match(run.stderr, /Identical HTML realpaths require --control/);
});

test("R3-P2: head and zero-offset scroller changes pass; changed nonzero offsets fail", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-scroll-keys-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(path.join(root, "view.png"), await image(1, 1));
	const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
	const { JSDOM } = require("jsdom");
	const positions = (head, extra = "", top = 125) => {
		const dom = new JSDOM(
			`<head>${head}</head><body>${extra}<div id="s" class="scroll content" style="overflow-y:auto"></div></body>`,
		);
		try {
			for (const node of dom.window.document.querySelectorAll("div"))
				node.getBoundingClientRect = () => ({ width: 100, height: 100 });
			const scroller = dom.window.document.getElementById("s");
			scroller.scrollTop = top;
			return initialScrollPositions(dom.window.document);
		} finally {
			dom.window.close();
		}
	};
	const view = {
		key: "document:index.html",
		url: "index.html",
		title: "Index",
		status: "captured",
		errors: [],
		screenshot: "view.png",
		initialScrollPositions: positions(""),
	};
	for (const offsets of [
		positions('<meta name="x" content="y">'),
		positions("", '<div style="overflow-y:hidden"></div>'),
	]) {
		const result = await compareCaptures(
			root,
			root,
			path.join(root, "same"),
			[view],
			[{ ...view, initialScrollPositions: offsets }],
		);
		assert.equal(result.pass, true);
	}
	assert.deepEqual(view.initialScrollPositions, [
		{ element: "0:div#s.content.scroll", top: 125, left: 0 },
	]);
	for (const offsets of [positions("", "", 80), positions("", "", 0)]) {
		const result = await compareCaptures(
			root,
			root,
			path.join(root, "changed"),
			[view],
			[{ ...view, initialScrollPositions: offsets }],
		);
		assert.equal(result.pass, false);
		assert.match(result.views[0].reason, /initial scroll positions differ/);
	}
});

test("R3-P3: compare normalized clipped focusables in both capture phases", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "equivalence-clipped-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(path.join(root, "view.png"), await image(1, 1));
	const clipped = {
		tag: "a",
		href: "#content",
		text: "Skip to content",
		bounds: { left: 0, top: -900, right: 100, bottom: -880 },
		element: '<a href="#content">Skip to content</a>',
		ancestor: "body",
	};
	const view = {
		key: "document:index.html",
		url: "index.html",
		title: "Index",
		status: "captured",
		errors: [],
		screenshot: "view.png",
		clippedFocusables: [clipped],
		finalClippedFocusables: [clipped],
	};
	const equivalent = {
		...clipped,
		text: "  Skip  to\ncontent ",
		element: '<a class="new" href="#content">Skip to content</a>',
		ancestor: "div",
		bounds: { bottom: -880, right: 100, top: -900, left: 0 },
	};
	assert.equal(
		(
			await compareCaptures(
				root,
				root,
				path.join(root, "same"),
				[view],
				[{ ...view, clippedFocusables: [equivalent], finalClippedFocusables: [equivalent] }],
			)
		).pass,
		true,
	);
	for (const field of ["clippedFocusables", "finalClippedFocusables"]) {
		for (const list of [
			[],
			[{ ...clipped, tag: "button" }],
			[{ ...clipped, href: "#other" }],
			[{ ...clipped, text: "Other destination" }],
			[{ ...clipped, bounds: { ...clipped.bounds, top: -800 } }],
		]) {
			const result = await compareCaptures(
				root,
				root,
				path.join(root, "diff"),
				[view],
				[{ ...view, [field]: list }],
			);
			assert.equal(result.pass, false, `${field}: ${JSON.stringify(list)}`);
			assert.match(result.views[0].reason, /clipped focusables differ/);
		}
	}
});
