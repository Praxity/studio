import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	comparePackages,
	comparePdf,
	firstDifference,
	literal,
	normalizePdfBytes,
	normalizePdfMetadata,
	zipPayloads,
} from "./equivalence/nonvisual-compare.mjs";

import {
	assertLoadedSources,
	assertNodeModules,
	assertNonvisualEntry,
	selectCourses,
} from "./equivalence/nonvisual-isolation.mjs";

import { validateCheckouts } from "./equivalence/provenance.mjs";

const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const AdmZip = require("adm-zip");
const zip = (files) => {
	const archive = new AdmZip();
	for (const [name, value] of Object.entries(files)) archive.addFile(name, Buffer.from(value));
	return archive.toBuffer();
};

test("ZIP DOS timestamp normalization changes only parsed header timestamps", () => {
	const original = zip({ "imsmanifest.xml": "manifest", "index.html": "PK\u0003\u0004payload" });
	const changed = Buffer.from(original);
	// Central offsets identify records even when a payload contains the same signature.
	const end = changed.length - 22;
	let offset = changed.readUInt32LE(end + 16);
	for (let i = 0; i < changed.readUInt16LE(end + 10); i++) {
		const local = changed.readUInt32LE(offset + 42);
		changed.writeUInt32LE(0x12345678, local + 10);
		changed.writeUInt32LE(0x12345678, offset + 12);
		offset +=
			46 +
			changed.readUInt16LE(offset + 28) +
			changed.readUInt16LE(offset + 30) +
			changed.readUInt16LE(offset + 32);
	}
	assert.equal(comparePackages(original, changed).pass, true);
	assert.equal(
		comparePackages(
			original,
			zip({ "imsmanifest.xml": "manifesu", "index.html": "PK\u0003\u0004payload" }),
		).pass,
		false,
	);
});

test("a fingerprint rename without manifest mapping fails even with identical bytes", () => {
	const base = zip({
		"viewer-aaaa.js": "same",
		"viewer-manifest.json": '{"loader":"viewer-aaaa.js"}',
	});
	const candidate = zip({
		"viewer-bbbb.js": "same",
		"viewer-manifest.json": '{"loader":"viewer-aaaa.js"}',
	});
	assert.equal(comparePackages(base, candidate).pass, false);
});

test("ZIP comments and non-timestamp header changes are not normalized away", () => {
	const original = zip({ "index.html": "same" });
	const changed = Buffer.from(original);
	changed.writeUInt16LE(changed.readUInt16LE(4) + 1, 4);
	assert.equal(comparePackages(original, changed).pass, false);
	assert.throws(() => zipPayloads(Buffer.from("missing")));
	assert.throws(() => zipPayloads(zip({})));
});

test("stage dumps retain nav labels, fragment IDs, markup, ordering, Maps and status", () => {
	const base = literal({
		pages: [{ id: "p", title: "Title", blocks: [{ id: "b", html: "<p>literal</p>" }] }],
		plans: new Map([["p", { islands: ["nav", "narration"] }]]),
		stale: false,
	});
	for (const mutation of [
		(value) => {
			value.pages[0].title = "Changed";
		},
		(value) => {
			value.pages[0].blocks[0].id = "changed";
		},
		(value) => {
			value.pages[0].blocks[0].html += " ";
		},
		(value) => {
			value.plans.$map[0][1].islands.reverse();
		},
		(value) => {
			value.stale = true;
		},
	]) {
		const changed = structuredClone(base);
		mutation(changed);
		assert.ok(firstDifference(base, changed));
	}
	assert.equal(firstDifference(base, structuredClone(base)), null);
	assert.ok(firstDifference({ expected: [] }, {}));
});

const fixture = new URL("./equivalence/fixtures/figure.pdf", import.meta.url);
const nativePdf = () => readFile(fixture);
const structure = await readFile(
	new URL("./equivalence/fixtures/figure.structure.txt", import.meta.url),
	"utf8",
);
const extracted = (bytes) => ({ bytes, text: "Fixture\n", structure });

test("native PDF bytes catch figure alt changes absent from real Poppler output", async () => {
	const bytes = await nativePdf();
	const changed = Buffer.from(bytes);
	const alt = "Gate figure original";
	// Poppler 24.02 -struct-text omits the native /Alt value.
	const position = changed.indexOf(alt);
	assert.ok(position >= 0, "native fixture contains /Alt bytes");
	changed[position] = changed[position] === 0x34 ? 0x35 : 0x34;
	assert.equal(comparePdf(extracted(bytes), extracted(bytes)), null);
	assert.equal(comparePdf(extracted(bytes), extracted(changed)).path, "$pdf");
});

test("PDF text/tag order and diagnostics remain literal localisation aids", async () => {
	const base = extracted(await nativePdf());
	assert.ok(comparePdf(base, { ...base, text: "reordered\nFixture\n" }));
	assert.ok(comparePdf(base, { ...base, structure: `${base.structure} P extra\n` }));
	assert.throws(() => comparePdf(base, { ...base, structure: "" }));
	assert.throws(() => comparePdf(base, { ...base, bytes: Buffer.from("%PDF-invalid") }));
	assert.ok(firstDifference({ diagnostics: [] }, { diagnostics: [{ message: "new" }] }));
});

test("native PDF normalization preserves length, content, offsets and nonvolatile metadata", async () => {
	const bytes = await nativePdf();
	const changed = Buffer.from(bytes);
	for (const field of [
		"xmp:CreateDate",
		"xmp:ModifyDate",
		"xmpMM:DocumentID",
		"xmpMM:InstanceID",
	]) {
		const marker = `<${field}>`;
		const offset = changed.indexOf(marker) + marker.length;
		assert.ok(offset >= marker.length);
		const end = changed.indexOf(`<`, offset);
		// Keep trailer IDs matched to XMP IDs.
		if (field.includes("ID")) {
			const value = changed.subarray(offset, end).toString();
			let at = changed.indexOf(value);
			while (at >= 0) {
				changed.fill(0x41, at, at + value.length);
				at = changed.indexOf(value, at + value.length);
			}
		} else changed.fill(0x32, offset, end);
	}
	const infoDate = changed.indexOf("/CreationDate(D:") + "/CreationDate(D:".length;
	assert.ok(infoDate > 0);
	changed[infoDate] = 0x31;
	assert.equal(normalizePdfBytes(bytes).length, bytes.length);
	assert.deepEqual(normalizePdfBytes(bytes), normalizePdfBytes(changed));
	const title = Buffer.from(bytes);
	title[title.indexOf("Typst 0.15.1")] = 0x58;
	assert.notDeepEqual(normalizePdfBytes(bytes), normalizePdfBytes(title));
});

test("native PDF normalization accepts UTC Info dates", async () => {
	// Same figure.typ compiled with TZ=UTC: Typst writes D:...Z instead of an offset.
	const bytes = await readFile(new URL("./equivalence/fixtures/figure-utc.pdf", import.meta.url));
	const changed = Buffer.from(bytes);
	for (const field of ["/CreationDate(D:", "/ModDate(D:"]) {
		const at = changed.indexOf(field) + field.length;
		assert.ok(at >= field.length);
		assert.equal(changed[at + 14], 0x5a);
		changed[at] = changed[at] === 0x31 ? 0x32 : 0x31;
	}
	assert.deepEqual(normalizePdfBytes(bytes), normalizePdfBytes(changed));
});

test("PDF metadata normalization names only observed volatile fields", () => {
	const base =
		"<x:xmpmeta><xmp:CreateDate>one</xmp:CreateDate><xmp:ModifyDate>one</xmp:ModifyDate><xmpMM:DocumentID>id1</xmpMM:DocumentID><xmpMM:InstanceID>id1</xmpMM:InstanceID><dc:title>literal</dc:title></x:xmpmeta>";
	const changed = base.replaceAll("one", "two").replaceAll("id1", "id2");
	assert.equal(normalizePdfMetadata(base), normalizePdfMetadata(changed));
	assert.notEqual(
		normalizePdfMetadata(base),
		normalizePdfMetadata(base.replace("literal", "changed")),
	);
	assert.throws(() => normalizePdfMetadata(""));
});

test("literal encoding cannot collide with author data or erase non-JSON values", () => {
	assert.notDeepEqual(literal(undefined), literal({ $undefined: true }));
	assert.notDeepEqual(literal(new Map([["a", 1]])), literal({ $map: [["a", 1]] }));
	assert.notDeepEqual(literal(NaN), literal(null));
	assert.notDeepEqual(literal(-0), literal(0));
	assert.throws(() => literal(() => {}));
});

test("missing stage owner fails loudly naming its path and required entry", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "nonvisual-owner-"));
	try {
		await writeFile(path.join(root, "package.json"), '{"type":"module"}');
		const adapter = fileURLToPath(new URL("./equivalence/nonvisual-build.mjs", import.meta.url));
		const result = spawnSync(
			process.execPath,
			[adapter, "stages", root, path.join(root, "output"), root, root],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/Required owner apps\/desktop\/src\/main\/export\/build-export-input-from-project.ts::buildCourseExportInput/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("symlinked node_modules and workspace source escaping the checkout refuse", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "nonvisual-isolation-"));
	try {
		const base = path.join(root, "base"),
			candidate = path.join(root, "candidate");
		await mkdir(path.join(base, "node_modules"), { recursive: true });
		await mkdir(candidate);
		await symlink(path.join(base, "node_modules"), path.join(candidate, "node_modules"));
		assert.throws(() => assertNodeModules(candidate), /node_modules resolves outside/);
		await rm(path.join(candidate, "node_modules"));
		await mkdir(path.join(candidate, "node_modules"));
		assertNodeModules(candidate);
		await mkdir(path.join(base, "packages/owner"), { recursive: true });
		await writeFile(
			path.join(base, "packages/owner/index.cjs"),
			"throw new Error('ESCAPED OWNER EXECUTED')",
		);
		await symlink(path.join(base, "packages/owner"), path.join(candidate, "node_modules/owner"));
		const runner = path.join(root, "probe.cjs");
		await writeFile(
			runner,
			`require(${JSON.stringify(path.join(candidate, "node_modules/owner/index.cjs"))})`,
		);
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				fileURLToPath(new URL("./equivalence/nonvisual-isolation.mjs", import.meta.url)),
				runner,
			],
			{ encoding: "utf8", env: { ...process.env, PRAXITY_EQUIVALENCE_CHECKOUT: candidate } },
		);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /Production module resolves outside selected checkout/);
		assert.doesNotMatch(result.stderr, /Error: ESCAPED OWNER EXECUTED/);

		// Workspace requests must also reject a target whose realpath has no apps/packages segment.
		await mkdir(path.join(root, "foreign"));
		await writeFile(
			path.join(root, "foreign/index.cjs"),
			"throw new Error('ESCAPED OWNER EXECUTED')",
		);
		await mkdir(path.join(candidate, "packages"));
		await symlink(path.join(root, "foreign"), path.join(candidate, "packages/foreign"));
		await writeFile(
			runner,
			`require("node:module").createRequire(${JSON.stringify(path.join(candidate, "package.json"))})("./packages/foreign/index.cjs")`,
		);
		const redirected = spawnSync(
			process.execPath,
			[
				"--import",
				fileURLToPath(new URL("./equivalence/nonvisual-isolation.mjs", import.meta.url)),
				runner,
			],
			{ encoding: "utf8", env: { ...process.env, PRAXITY_EQUIVALENCE_CHECKOUT: candidate } },
		);
		assert.equal(redirected.status, 1);
		assert.match(redirected.stderr, /Production module resolves outside selected checkout/);
		assert.doesNotMatch(redirected.stderr, /Error: ESCAPED OWNER EXECUTED/);
		const source = createRequire(import.meta.url);
		const external = path.join(base, "packages/owner/index.cjs");
		source.cache[external] = { exports: {} };
		try {
			assert.throws(() => assertLoadedSources(candidate), /Production module resolves outside/);
		} finally {
			delete source.cache[external];
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("all pinned courses are mandatory unless subset is explicit", () => {
	const inputs = { courses: { leadership: {}, toolkit: {} } };
	assert.throws(
		() => selectCourses(inputs, ["toolkit"], false),
		/Missing required courses: leadership/,
	);
	assert.deepEqual(selectCourses(inputs, ["toolkit"], true), ["toolkit"]);
	assert.deepEqual(selectCourses(inputs, ["leadership", "toolkit"], false), [
		"leadership",
		"toolkit",
	]);
});

test("trusted nonvisual entry requires its exact realpath", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "nonvisual-entry-"));
	try {
		await mkdir(path.join(root, "scripts/equivalence"), { recursive: true });
		const gate = path.join(root, "scripts/equivalence/nonvisual-gate.mjs");
		const impostor = path.join(root, "impostor.mjs");
		await writeFile(gate, "");
		await writeFile(impostor, "");
		assertNonvisualEntry(root, gate);
		assert.throws(() => assertNonvisualEntry(root, impostor), /exact trusted base/);
		await symlink(gate, path.join(root, "alias.mjs"));
		assertNonvisualEntry(root, path.join(root, "alias.mjs"));
		await rm(gate);
		await symlink(impostor, gate);
		assert.throws(() => assertNonvisualEntry(root, gate), /exact trusted base/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("nonvisual inherits F2 exact-entry, module, dirty-base and ancestry guards", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "nonvisual-provenance-"));
	const git = (cwd, ...args) => {
		const result = spawnSync("git", args, { cwd, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	try {
		const base = path.join(root, "base"),
			candidate = path.join(root, "candidate");
		await mkdir(path.join(base, "scripts/equivalence"), { recursive: true });
		const gate = path.join(base, "scripts/equivalence/nonvisual-gate.mjs");
		for (const name of [
			"nonvisual-gate",
			"build",
			"nonvisual-build",
			"nonvisual-compare",
			"nonvisual-isolation",
			"provenance",
			"verify-inputs",
		])
			await writeFile(path.join(base, `scripts/equivalence/${name}.mjs`), "trusted");
		git(base, "init");
		git(base, "add", ".");
		git(base, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base");
		git(base, "update-ref", "refs/remotes/origin/main", "HEAD");
		git(root, "clone", base, candidate);
		const options = { control: true, entryPoint: "nonvisual-gate" };
		const guard = await validateCheckouts(base, candidate, gate, options);
		assert.equal(guard.baseIsOriginMain, true);
		assert.equal(guard.baseIsAncestor, true);
		await assert.rejects(
			validateCheckouts(
				base,
				candidate,
				path.join(candidate, "scripts/equivalence/nonvisual-gate.mjs"),
				options,
			),
			/exact --base entry point/,
		);
		await assert.rejects(
			validateCheckouts(base, candidate, gate, { ...options, entryPoint: "other" }),
			/Unknown gate entry/,
		);
		await writeFile(path.join(base, "dirty.txt"), "reviewed bootstrap");
		await assert.rejects(validateCheckouts(base, candidate, gate, options), /Dirty base refused/);
		await validateCheckouts(base, candidate, gate, { ...options, allowDirtyBase: true });
		await rm(path.join(base, "dirty.txt"));
		git(candidate, "switch", "--orphan", "unrelated");
		await writeFile(path.join(candidate, "unrelated.txt"), "unrelated");
		git(candidate, "add", ".");
		git(
			candidate,
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"unrelated",
		);
		await assert.rejects(
			validateCheckouts(base, candidate, gate, { ...options, control: false }),
			/Base must be an ancestor/,
		);
		await writeFile(path.join(root, "foreign.mjs"), "untrusted");
		await rm(path.join(base, "scripts/equivalence/nonvisual-compare.mjs"));
		await symlink(
			path.join(root, "foreign.mjs"),
			path.join(base, "scripts/equivalence/nonvisual-compare.mjs"),
		);
		await assert.rejects(
			validateCheckouts(base, candidate, gate, { ...options, allowDirtyBase: true }),
			/Untrusted gate module realpath/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
