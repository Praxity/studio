import {
	link,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	loadIdentityStore,
	mergeCourseIdentity,
	persistCourseIdentity,
	readCourseIdentity,
	resolveCourseIdentity,
} from "../identity-store";
import {
	applyProjectFilePlan,
	withProjectFileTransaction,
	writeProjectFiles,
} from "../project-file-transactions";

const filesystem = vi.hoisted(() => ({
	path: "",
	beforeStat: undefined as ((path: string, big: boolean) => Promise<void>) | undefined,
	fact: "" as "" | "volume" | "special" | "zero-links" | "directory-links",
	onLink: undefined as ((target: string) => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		lstat: async (...args: Parameters<typeof fs.lstat>) => {
			await filesystem.beforeStat?.(resolve(String(args[0])), !!args[1]?.bigint);
			const info = await fs.lstat(...args);
			if (resolve(String(args[0])) === filesystem.path) {
				if (filesystem.fact === "volume")
					info.dev = typeof info.dev === "bigint" ? info.dev + 1n : info.dev + 1;
				if (filesystem.fact === "special") {
					info.isFile = () => false;
					info.isDirectory = () => false;
				}
				if (filesystem.fact === "zero-links") info.nlink = typeof info.nlink === "bigint" ? 0n : 0;
				if (filesystem.fact === "directory-links")
					info.nlink = typeof info.nlink === "bigint" ? 10n : 10;
			}
			return info;
		},
		link: async (...args: Parameters<typeof fs.link>) => {
			await fs.link(...args);
			await filesystem.onLink?.(String(args[1]));
		},
	};
});

const roots: string[] = [];
const options = { lessonPaths: ["a.prax"] };
const key = "desktop.identity.plainStoreRequired";
afterEach(async () => {
	filesystem.path = "";
	filesystem.beforeStat = undefined;
	filesystem.fact = "";
	filesystem.onLink = undefined;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(saved = true) {
	const root = await mkdtemp(join(tmpdir(), "i4-plain-"));
	roots.push(root);
	await writeFile(join(root, "a.prax"), "# Page\n\nKeep the original IDs.\n");
	if (saved) {
		await withProjectFileTransaction(
			root,
			async () => persistCourseIdentity(root, await resolveCourseIdentity(root, options)),
			"write",
		);
		await withProjectFileTransaction(root, async () => {}, "write");
	}
	return root;
}

async function bytes(root: string, path = ""): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	for (const name of (await readdir(join(root, path))).sort()) {
		const child = path ? `${path}/${name}` : name;
		const info = await lstat(join(root, child));
		if (info.isSymbolicLink()) result[child] = `link:${await readlink(join(root, child))}`;
		else if (info.isDirectory()) {
			result[child] = "directory";
			Object.assign(result, await bytes(root, child));
		} else result[child] = (await readFile(join(root, child))).toString("base64");
	}
	return result;
}

async function refuses(work: () => Promise<unknown>, path: string) {
	const error = await work().then(
		() => null,
		(error: unknown) => error,
	);
	expect(error).toMatchObject({ code: "EIDENTITY", messageRef: { key, args: { path } } });
}

for (const path of [
	".praxity",
	".praxity/identity",
	".praxity/identity/lessons",
	".praxity/identity/snapshots",
	".praxity/identity/course.json",
	".praxity/content-identity.json",
	"narration.yaml",
	".praxity/review",
	".praxity/review/nested/record.json",
])
	it(`I4 refuses a linked lineage path ${path} before allocating or persisting`, async () => {
		const root = await project();
		if (path === ".praxity/review" || path.includes("/review/"))
			await mkdir(join(root, ".praxity/review/nested"), { recursive: true });
		if (
			[
				".praxity/content-identity.json",
				"narration.yaml",
				".praxity/review/nested/record.json",
			].includes(path)
		)
			await writeFile(join(root, path), "original");
		const saved = join(root, "saved-lineage");
		const directory = (await lstat(join(root, path))).isDirectory();
		await rename(join(root, path), saved);
		await symlink(saved, join(root, path), directory ? "junction" : "file");
		const before = await bytes(root);
		await refuses(() => resolveCourseIdentity(root, options), path);
		expect(await bytes(root)).toEqual(before);
	});

for (const kind of ["course", "head", "snapshot", "narration", "review", "legacy"] as const)
	it(`I4 refuses a hard-linked ${kind} file with unchanged store bytes`, async () => {
		const root = await project();
		let path = ".praxity/identity/course.json";
		if (kind === "head" || kind === "snapshot") {
			const directory = `.praxity/identity/${kind === "head" ? "lessons" : "snapshots"}`;
			path = `${directory}/${(await readdir(join(root, directory)))[0]}`;
		}
		if (kind === "narration" || kind === "legacy" || kind === "review") {
			path =
				kind === "narration"
					? "narration.yaml"
					: kind === "legacy"
						? ".praxity/content-identity.json"
						: ".praxity/review/record.json";
			await mkdir(join(root, ".praxity/review"), { recursive: true });
			await writeFile(join(root, path), "original");
		}
		await link(join(root, path), join(root, "saved-lineage.json"));
		expect((await lstat(join(root, path))).nlink).toBe(2);
		const before = await bytes(root);
		await refuses(() => resolveCourseIdentity(root, options), path);
		expect(await bytes(root)).toEqual(before);
	});

for (const fact of ["volume", "special"] as const)
	it(`I4 refuses ${fact} lineage before minting with unchanged bytes`, async () => {
		const root = await project(false);
		await mkdir(join(root, ".praxity"));
		const before = await bytes(root);
		filesystem.path = resolve(root, ".praxity");
		filesystem.fact = fact;
		await refuses(() => resolveCourseIdentity(root, options), ".praxity");
		filesystem.path = "";
		expect(await bytes(root)).toEqual(before);
	});

it("I4 rechecks the plain store before persistence after a candidate was issued", async () => {
	const root = await project();
	await withProjectFileTransaction(
		root,
		async () => {
			const candidate = await resolveCourseIdentity(root, options);
			await link(join(root, ".praxity/identity/course.json"), join(root, "saved-course.json"));
			const before = await bytes(root);
			await refuses(() => persistCourseIdentity(root, candidate), ".praxity/identity/course.json");
			expect(await bytes(root)).toEqual(before);
		},
		"write",
	);
});

for (const fact of ["zero-links", "directory-links"] as const)
	it(`I4 admits ${fact} filesystem metadata`, async () => {
		const root = await project();
		const expected = await loadIdentityStore(root);
		filesystem.path = resolve(
			root,
			fact === "zero-links" ? ".praxity/identity/course.json" : ".praxity/identity",
		);
		filesystem.fact = fact;
		expect((await resolveCourseIdentity(root, options)).identity.course).toEqual(expected.course);
	});

it("I4 merge refuses a hard-linked working store before resolving identities", async () => {
	const root = await project();
	const files = new Map<string, string>();
	for (const [path, content] of Object.entries(await bytes(root)))
		if (path.startsWith(".praxity/identity/") && path.endsWith(".json"))
			files.set(path, Buffer.from(content, "base64").toString("utf8"));
	await link(join(root, ".praxity/identity/course.json"), join(root, "saved-course.json"));
	// Admission must refuse before the merge resolver inspects even a conflicted source.
	await writeFile(
		join(root, "a.prax"),
		"<<<<<<< ours\n# Ours\n=======\n# Theirs\n>>>>>>> theirs\n",
	);
	const before = await bytes(root);
	await refuses(
		() =>
			mergeCourseIdentity(root, { base: files, ours: files, theirs: files }, options.lessonPaths),
		".praxity/identity/course.json",
	);
	expect(await bytes(root)).toEqual(before);
});

it("T1 isolates a leftover publication alias before I4's next write admission", async () => {
	const root = await project();
	const live = join(root, ".praxity/identity/course.json");
	const original = await readFile(live);
	const expected = await loadIdentityStore(root);
	await withProjectFileTransaction(
		root,
		() =>
			applyProjectFilePlan(root, [{ path: ".praxity/identity/course.json", content: original }]),
		"write",
		false,
	);
	const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
	if (!stage) throw new Error("Missing committed archive");
	// Recreate the namespace left by death between link() and publication retirement.
	await link(live, join(root, stage, "install-0"));
	expect((await lstat(live)).nlink).toBe(2);
	expect((await readCourseIdentity(root, options)).identity.course).toEqual(expected.course);
	expect((await lstat(live)).nlink).toBe(2);
	expect((await resolveCourseIdentity(root, options)).identity.course).toEqual(expected.course);
	expect((await lstat(live)).nlink).toBe(1);
	expect(await readFile(live)).toEqual(original);
});

it("T1 publication's live nlink 2 is allowed after I4 write admission and by I4 read admission", async () => {
	const root = await project();
	let observed = 0;
	await withProjectFileTransaction(
		root,
		async () => {
			const candidate = await resolveCourseIdentity(root, options);
			filesystem.onLink = async (target) => {
				if (target !== join(root, ".praxity/identity/course.json")) return;
				observed = (await lstat(target)).nlink;
				expect(observed).toBe(2);
				expect((await readCourseIdentity(root, options)).identity.course).toEqual(
					candidate.identity.course,
				);
			};
			await applyProjectFilePlan(root, [
				{
					path: ".praxity/identity/course.json",
					content: await readFile(join(root, ".praxity/identity/course.json")),
				},
			]);
		},
		"write",
		false,
	);
	expect(observed).toBe(2);
	filesystem.onLink = undefined;
	expect((await resolveCourseIdentity(root, options)).identity.course).toEqual(
		(await loadIdentityStore(root)).course,
	);
});

for (const directoryOnly of [false, true])
	it(`T1 refuses a protected lexical target outside its folder, directories ${directoryOnly}`, async () => {
		const root = await project(false);
		await mkdir(join(root, "saved-sidecar"));
		await symlink(join(root, "saved-sidecar"), join(root, ".praxity"), "junction");
		const before = await bytes(root);
		await refuses(
			() =>
				withProjectFileTransaction(
					root,
					(canonical) =>
						applyProjectFilePlan(
							canonical,
							directoryOnly ? [] : [{ path: ".praxity/identity/course.json", content: "new" }],
							{ createDirectories: [".praxity/identity"] },
						),
					"write",
					false,
				),
			".praxity",
		);
		expect(await bytes(root)).toEqual(before);
	});

for (const path of [".praxity/identity/course.json", "narration.yaml"])
	it(`T1 translates a protected file link refusal at ${path} without staging`, async () => {
		const root = await project();
		if (path === "narration.yaml") await writeFile(join(root, path), "original");
		await rename(join(root, path), join(root, "saved-record"));
		await symlink(join(root, "saved-record"), join(root, path), "file");
		const before = await bytes(root);
		await refuses(() => writeProjectFiles(root, [{ path, content: "replacement" }]), path);
		expect(await bytes(root)).toEqual(before);
	});

it("T1 refuses an existing protected directory alias before staging a regular file", async () => {
	const root = await project();
	await rename(join(root, ".praxity/identity"), join(root, "saved-identity"));
	await symlink(join(root, "saved-identity"), join(root, ".praxity/identity"), "junction");
	const before = await bytes(root);
	await refuses(
		() =>
			writeProjectFiles(root, [{ path: ".praxity/identity/course.json", content: "replacement" }]),
		".praxity/identity",
	);
	expect(await bytes(root)).toEqual(before);
});

it("T1 still saves window state and local drafts through a linked sidecar", async () => {
	const root = await project(false);
	await mkdir(join(root, "saved-sidecar/local/drafts"), { recursive: true });
	await symlink(join(root, "saved-sidecar"), join(root, ".praxity"), "junction");
	await writeProjectFiles(root, [
		{ path: ".praxity/state.json", content: "state" },
		{ path: ".praxity/local/drafts/a.json", content: "draft" },
	]);
	expect(await readFile(join(root, "saved-sidecar/state.json"), "utf8")).toBe("state");
	expect(await readFile(join(root, "saved-sidecar/local/drafts/a.json"), "utf8")).toBe("draft");
});

it("I4 ignores links in window state and local drafts under a plain sidecar", async () => {
	const root = await project();
	const expected = await loadIdentityStore(root);
	await mkdir(join(root, "saved-local/drafts"), { recursive: true });
	await symlink(join(root, "saved-local"), join(root, ".praxity/local"), "junction");
	await writeFile(join(root, "saved-state.json"), "window state");
	await link(join(root, "saved-state.json"), join(root, ".praxity/state.json"));
	const before = await bytes(root);
	expect((await resolveCourseIdentity(root, options)).identity.course).toEqual(expected.course);
	expect(await bytes(root)).toEqual(before);
});

it("I4 merge rechecks an alias introduced between preparation and installation", async () => {
	const root = await project();
	const files = new Map<string, string>();
	for (const [path, content] of Object.entries(await bytes(root)))
		if (path.startsWith(".praxity/identity/") && path.endsWith(".json"))
			files.set(path, Buffer.from(content, "base64").toString("utf8"));
	let checks = 0;
	let before: Record<string, string> | undefined;
	filesystem.beforeStat = async (path, big) => {
		if (path !== resolve(root, ".praxity") || !big) return;
		if (++checks === 2) {
			await link(join(root, ".praxity/identity/course.json"), join(root, "late-alias.json"));
			filesystem.beforeStat = undefined;
			before = await bytes(root);
		}
	};
	await refuses(
		() =>
			mergeCourseIdentity(root, { base: files, ours: files, theirs: files }, options.lessonPaths),
		".praxity/identity/course.json",
	);
	expect(checks).toBe(2);
	expect(before).toBeDefined();
	expect(await bytes(root)).toEqual(before);
});

it("I4 merge write preparation isolates a leftover publication alias", async () => {
	const root = await project();
	const live = join(root, ".praxity/identity/course.json");
	const original = await readFile(live);
	const files = new Map<string, string>();
	for (const [path, content] of Object.entries(await bytes(root)))
		if (path.startsWith(".praxity/identity/") && path.endsWith(".json"))
			files.set(path, Buffer.from(content, "base64").toString("utf8"));
	await withProjectFileTransaction(
		root,
		() =>
			applyProjectFilePlan(root, [{ path: ".praxity/identity/course.json", content: original }]),
		"write",
		false,
	);
	const stage = (await readdir(root)).find((name) => name.startsWith(".praxity-write-"));
	if (!stage) throw new Error("Missing committed archive");
	await link(live, join(root, stage, "install-0"));
	expect((await lstat(live)).nlink).toBe(2);
	await expect(
		mergeCourseIdentity(root, { base: files, ours: files, theirs: files }, options.lessonPaths),
	).resolves.toMatchObject({
		conflicts: [],
		resolution: { course: JSON.parse(original.toString("utf8")) },
	});
	expect((await lstat(live)).nlink).toBe(1);
	expect(await readFile(live)).toEqual(original);
});
