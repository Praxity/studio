import { execFileSync } from "node:child_process";
import {
	appendFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeIdentity } from "@praxity/content-identity";
import {
	digest,
	legacyFixture,
	version2Fixture,
} from "@praxity/content-identity/__tests__/legacy-store-fixture.ts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runPraxityCli } from "../cli.ts";
import { initializeCourseIdentity, loadIdentityStore } from "../identity-store.ts";

// Startup import cost belongs to suite setup; the cold-store test still runs in a fresh process.
beforeAll(async () => {
	await import("../studio/server");
});

const roots: string[] = [];
const versionAdvice = {
	en: "This identity store uses canonical version 2. Open it with a Studio version that supports version-2 matching. Keep the identity files. No files changed.",
	fr: "Ce stockage d'identité utilise la version canonique 2. Ouvrez-le avec une version de Studio qui prend en charge la correspondance de version 2. Conservez les fichiers d'identité. Aucun fichier modifié.",
};
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(versioned = false, cleanup = roots) {
	const legacy = versioned ? version2Fixture() : legacyFixture("reader-roles");
	if (versioned) {
		// Own-content refusal needs one snapshot; historical refusal has its own test.
		legacy.snapshot.parents = [];
		legacy.head.head = digest(serializeIdentity(legacy.snapshot));
	}
	const root = await mkdtemp(join(tmpdir(), "identity-legacy-"));
	cleanup.push(root);
	const store = join(root, ".praxity/identity");
	await mkdir(join(store, "lessons"), { recursive: true });
	await mkdir(join(store, "snapshots"));
	await writeFile(join(root, "course.yaml"), "title: Synthetic\nlessons: [lesson.prax]\n");
	await writeFile(join(root, "lesson.prax"), legacy.source);
	await writeFile(join(store, "course.json"), legacy.read("course.json"));
	await writeFile(
		join(store, "lessons", `${legacy.expected.lessonId}.json`),
		serializeIdentity(legacy.head),
	);
	for (const hash of versioned ? [] : legacy.expected.history)
		await writeFile(
			join(store, "snapshots", `${hash}.json`),
			legacy.read(`snapshots/${hash}.json`),
		);
	if (versioned)
		await writeFile(
			join(store, "snapshots", `${legacy.head.head}.json`),
			serializeIdentity(legacy.snapshot),
		);
	return { root, store, legacy };
}

async function files(
	root: string,
	prefix = "",
): Promise<Record<string, { bytes: string; mtime: number }>> {
	const result: Awaited<ReturnType<typeof files>> = {};
	for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
		const file = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) Object.assign(result, await files(root, file));
		else
			result[file] = {
				bytes: await readFile(join(root, file), "base64"),
				mtime: (await stat(join(root, file))).mtimeMs,
			};
	}
	return result;
}

it("cold initialization of the pinned reader store and its second init write nothing", async () => {
	const { root, legacy } = await fixture();
	const before = await files(root);
	const result = JSON.parse(
		execFileSync(
			process.execPath,
			[
				"--import",
				"tsx",
				fileURLToPath(new URL("./fixtures/legacy-identity-init.ts", import.meta.url)),
				root,
			],
			{ encoding: "utf8" },
		),
	);
	expect(result.first).toEqual({ changed: false });
	expect(result.second).toEqual({ changed: false });
	expect(result.store).toEqual({
		course: legacy.course,
		heads: [legacy.head],
		snapshots: [legacy.snapshot],
	});
	expect(await files(root)).toEqual(before);
});

it("initialization refuses a correctly hashed own-content version-2 store with zero writes", async () => {
	const { root } = await fixture(true);
	const before = await files(root);
	for (const admission of [
		() => loadIdentityStore(root),
		() => initializeCourseIdentity(root, ["lesson.prax"]),
	])
		await expect(admission()).rejects.toMatchObject({
			code: "EIDENTITY",
			cause: { code: "EIDENTITY_CANONICAL_VERSION" },
		});
	expect(await files(root)).toEqual(before);
});

it.each(["en", "fr"] as const)(
	"CLI initialization reports the version refusal in %s without writing",
	async (locale) => {
		const { root } = await fixture(true);
		const before = await files(root);
		const result = await runPraxityCli(["identity", "init", root, "--lang", locale], {
			appVersion: "test",
			exportAssetsDir: "unused",
		});
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("identity_init_failed");
		expect(result.stderr).toBe(`${versionAdvice[locale]}\n`);
		expect(await files(root)).toEqual(before);
	},
);

it("Studio preserves version-refusal advice in both requested languages without writing", async () => {
	const { root } = await fixture(true);
	const assets = await mkdtemp(join(tmpdir(), "identity-legacy-canvas-"));
	roots.push(assets);
	await writeFile(join(assets, "index.html"), "<!doctype html><title>Fixture</title>");
	await writeFile(join(assets, "canvas.js"), "void 0;");
	await writeFile(join(assets, "canvas.sha256"), digest("void 0;"));
	const before = await files(root);
	for (const locale of ["en", "fr"] as const) {
		const result = await runPraxityCli(["studio", root, "--no-open", "--lang", locale], {
			appVersion: "test",
			exportAssetsDir: "unused",
			editorAssetsDir: assets,
		});
		await result.studioServer?.close();
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("EIDENTITY");
		expect(JSON.parse(result.stdout).error.message).toBe(versionAdvice[locale]);
		expect(result.stderr).toBe(
			locale === "fr"
				? `Échec de Praxity studio : ${versionAdvice.fr}\n`
				: `Praxity studio failed: ${versionAdvice.en}\n`,
		);
	}
	expect(await files(root)).toEqual(before);
});

describe("version-refusal merge", () => {
	const templates: string[] = [];
	let root: string;
	beforeAll(async () => {
		({ root } = await fixture(true, templates));
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
		git("init", "-b", "main");
		// Configure the synthetic repository in one write instead of six Git processes.
		await appendFile(
			join(root, ".git/config"),
			"\n[user]\nname = Identity merge fixture\nemail = fixture@example.invalid\n[core]\nautocrlf = false\nfsmonitor = false\n[gc]\nauto = 0\n[maintenance]\nauto = false\n",
		);
		git("add", ".");
		git("commit", "-m", "Synthetic versioned identity");
		git("checkout", "-b", "theirs");
		await writeFile(join(root, "theirs.txt"), "Their unrelated edit.");
		git("add", "theirs.txt");
		git("commit", "-m", "Their unrelated edit");
		git("checkout", "main");
		await writeFile(join(root, "ours.txt"), "Our unrelated edit.");
		git("add", "ours.txt");
		git("commit", "-m", "Our unrelated edit");
		git("merge", "--no-commit", "theirs");
	});
	afterAll(async () => {
		await Promise.all(templates.map((root) => rm(root, { recursive: true, force: true })));
	});
	it("identity merge preserves bilingual version-refusal advice and all merge bytes", async () => {
		const before = await files(root);
		const result = await runPraxityCli(["identity", "merge", root], {
			appVersion: "test",
			exportAssetsDir: "unused",
		});
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error.code).toBe("EIDENTITY");
		expect(result.stderr).toBe(`${versionAdvice.en}\n${versionAdvice.fr}\n`);
		expect(await files(root)).toEqual(before);
	});
});

it("admission also refuses correctly addressed version-2 historical records without writing", async () => {
	const { root, store } = await fixture();
	const versioned = version2Fixture();
	await writeFile(
		join(store, "snapshots", `${versioned.head.head}.json`),
		serializeIdentity(versioned.snapshot),
	);
	const before = await files(root);
	await expect(initializeCourseIdentity(root, ["lesson.prax"])).rejects.toMatchObject({
		code: "EIDENTITY",
		cause: { code: "EIDENTITY_CANONICAL_VERSION" },
	});
	expect(await files(root)).toEqual(before);
});

it("the store reader refuses a changed immutable ancestor and leaves every file intact", async () => {
	const { root, store, legacy } = await fixture();
	const ancestor = legacy.history[0];
	const node = Object.values(ancestor.nodes).find((node) => node.type === "choice");
	if (!node) throw new Error("Missing choice fixture");
	node.canonicalVersion = 2;
	await writeFile(
		join(store, "snapshots", `${legacy.expected.history[0]}.json`),
		serializeIdentity(ancestor),
	);
	const before = await files(root);
	await expect(loadIdentityStore(root)).rejects.toThrow(/snapshot hash mismatch/);
	expect(await files(root)).toEqual(before);
});
