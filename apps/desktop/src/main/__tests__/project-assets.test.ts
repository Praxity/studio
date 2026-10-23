import { copyFile, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, type TestContext, vi } from "vitest";
import { assetInspector } from "../export/inspection-evidence";
import { ProjectAssetInventory } from "../export/project-asset-inventory";
import { resolvePdfAssets } from "../export/resolve-pdf-assets";
import { listProjectAssets, openProjectAsset, resolveProjectAsset } from "../project-assets";
import { startStudioReadOnlyServer } from "../studio/read-only-server";

let root: string;
const fsProbe = vi.hoisted(() => ({
	walks: [] as string[],
	unreadable: "",
	afterOpen: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		readdir: async (...args: Parameters<typeof fs.readdir>) => {
			fsProbe.walks.push(String(args[0]));
			if (String(args[0]) === fsProbe.unreadable)
				throw Object.assign(new Error("PRIVATE_DIRECTORY_ERROR"), { code: "EACCES" });
			return fs.readdir(...args);
		},
		open: async (...args: Parameters<typeof fs.open>) => {
			const handle = await fs.open(...args);
			await fsProbe.afterOpen?.();
			return handle;
		},
	};
});
beforeEach(async () => {
	fsProbe.walks = [];
	fsProbe.unreadable = "";
	fsProbe.afterOpen = undefined;
	root = await mkdtemp(join(tmpdir(), "project-assets-admission-"));
	await mkdir(join(root, "assets"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const privateFiles = [
	["narration.yaml", "asset-internal-refused"],
	["lesson.prax", "asset-source-refused"],
	[".praxity/identity/snapshots/history.json", "asset-internal-refused"],
	[".praxity/content-identity.json", "asset-internal-refused"],
	[".praxity/review/accepted/lesson.prax", "asset-internal-refused"],
	[".praxity/review/state.json", "asset-internal-refused"],
	[".praxity/notes/check.json", "asset-internal-refused"],
	[".praxity/local/drafts/draft.json", "asset-internal-refused"],
	[".praxity-write-test/install-0", "asset-internal-refused"],
	[".praxity-write-test/captures/lesson", "asset-internal-refused"],
	[".praxity-transaction.json", "asset-internal-refused"],
	["old/.praxity-write-test/install-0", "asset-internal-refused"],
] as const;

it.each([".git", "node_modules"])(
	"refuses hardlinks to the whole .praxity store aliased to %s",
	async (name) => {
		await mkdir(join(root, name, ".praxity-write-x"), { recursive: true });
		await symlink(join(root, name), join(root, ".praxity"), "junction");
		for (const file of [".praxity-write-x/install-0", "state.json"]) {
			await writeFile(join(root, ".praxity", file), "PRIVATE_STORE_MARKER");
			const asset = join(root, "assets", file.replaceAll("/", "-"));
			await link(join(root, ".praxity", file), asset);
			await expect(resolveProjectAsset(root, asset)).rejects.toMatchObject({
				code: "asset-internal-refused",
			});
			await expect(openProjectAsset(root, asset)).rejects.toMatchObject({
				code: "asset-internal-refused",
			});
		}
		// The inventory's write-probe already refuses this linked storage layout.
		await expect(new ProjectAssetInventory(root).read()).rejects.toThrowError(
			"Symbolic links are not allowed",
		);
	},
);

it.each([".git", "node_modules"])("refuses canonical assets under root %s", async (name) => {
	await mkdir(join(root, name));
	await writeFile(join(root, name, "private.txt"), "PRIVATE_SOURCE");
	await symlink(join(root, name), join(root, "assets/alias"), "junction");
	const asset = join(root, "assets/alias/private.txt");
	await expect(resolveProjectAsset(root, asset)).rejects.toMatchObject({
		code: "asset-internal-refused",
		message: "asset-internal-refused: assets/alias/private.txt",
	});
	await expect(openProjectAsset(root, asset)).rejects.toMatchObject({
		code: "asset-internal-refused",
	});
});

for (const name of ["node_modules", ".git", ".praxity-write-optional"]) {
	for (const kind of ["escaping", "dangling"] as const) {
		it(`admits plain and hardlinked assets with an ${kind} root ${name} link`, async (context) => {
			const outside = await mkdtemp(join(tmpdir(), "optional-asset-store-"));
			try {
				await symlink(
					kind === "escaping" ? outside : join(root, "missing"),
					join(root, name),
					"junction",
				);
				await writeFile(join(root, "assets/public.png"), "abc");
				await writeFile(join(root, "assets/public.pdf"), "public PDF");
				await makeLink(
					"hardlink",
					join(root, "assets/public.pdf"),
					join(root, "copy.pdf"),
					context,
				);
				expect(await resolveProjectAsset(root, join(root, "assets/public.png"))).toBe(
					join(root, "assets/public.png"),
				);
				const file = await openProjectAsset(root, join(root, "assets/public.png"));
				try {
					expect((await file.readFile()).toString()).toBe("abc");
				} finally {
					await file.close();
				}
				const assets = await new ProjectAssetInventory(root).read();
				expect(Buffer.from(assets.bytes.get("assets/public.pdf") ?? []).toString()).toBe(
					"public PDF",
				);
			} finally {
				await rm(outside, { recursive: true, force: true });
			}
		});
	}
}

it.each(["escaping", "dangling"])(
	"names an %s .praxity link when its store cannot be resolved",
	async (kind) => {
		const outside = await mkdtemp(join(tmpdir(), "required-asset-store-"));
		try {
			await symlink(
				kind === "escaping" ? outside : join(root, "missing"),
				join(root, ".praxity"),
				"junction",
			);
			await writeFile(join(root, "assets/public.png"), "public");
			try {
				await resolveProjectAsset(root, join(root, "assets/public.png"));
				throw new Error("Expected refusal");
			} catch (error) {
				expect(error).toMatchObject({
					code: "asset-store-unavailable",
					message: "asset-store-unavailable: .praxity",
				});
				expect(error).not.toHaveProperty("cause");
			}
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	},
);

it("skips canonical .git and node_modules identities through a linked project root", async (context) => {
	await writeFile(join(root, "assets/public.png"), "abc");
	await makeLink(
		"hardlink",
		join(root, "assets/public.png"),
		join(root, "public-copy.png"),
		context,
	);
	for (const name of [".git", "node_modules"]) await mkdir(join(root, name));
	await symlink(root, join(root, "alias"), "junction");
	fsProbe.unreadable = join(root, ".git");
	const inspector = assetInspector(join(root, "alias"));
	expect(await inspector.read("assets/public.png")).toEqual({
		uri: "assets/public.png",
		availability: "present",
		sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	});
	await inspector.finish();
	expect(
		fsProbe.walks.filter((p) => [join(root, ".git"), join(root, "node_modules")].includes(p)),
	).toEqual([]);
});

for (const reader of ["inspection", "PDF"] as const) {
	it(`refuses a late protected hardlink before finishing a ${reader} read`, async (context) => {
		const asset = join(root, "assets/image.png");
		await writeFile(asset, "abc");
		await makeLink("hardlink", asset, join(root, "public-copy.png"), context);
		fsProbe.afterOpen = async () => {
			fsProbe.afterOpen = undefined;
			await link(asset, join(root, "new.prax"));
		};
		const refusal = {
			code: "asset-source-refused",
			message: "asset-source-refused: assets/image.png",
		};
		if (reader === "inspection") {
			const inspector = assetInspector(root);
			expect(await inspector.read("assets/image.png")).toMatchObject({ availability: "present" });
			await expect(inspector.finish()).rejects.toMatchObject(refusal);
		} else {
			await expect(
				resolvePdfAssets(
					root,
					[
						{
							id: "lesson",
							title: "Lesson",
							locale: "en",
							blocks: [
								{ id: "image", type: "image", data: { src: "assets/image.png", alt: "An image" } },
							],
						},
					],
					false,
				),
			).rejects.toMatchObject(refusal);
		}
	});
}

for (const reader of ["inspection", "PDF"] as const) {
	it(`shares one identity scan and one final rescan across a ${reader} read`, async (context) => {
		await mkdir(join(root, "old"));
		await writeFile(join(root, "old/lesson.prax"), "PRIVATE_SOURCE");
		await writeFile(join(root, "assets/image-0.png"), "abc");
		for (let i = 1; i < 4; i++)
			await makeLink(
				"hardlink",
				join(root, "assets/image-0.png"),
				join(root, `assets/image-${i}.png`),
				context,
			);
		if (reader === "inspection") {
			const inspector = assetInspector(root);
			for (let i = 0; i < 4; i++)
				expect(await inspector.read(`assets/image-${i}.png`)).toMatchObject({
					availability: "present",
				});
			expect(fsProbe.walks.filter((p) => p === join(root, "old"))).toHaveLength(1);
			await inspector.finish();
		} else {
			const assets = await resolvePdfAssets(
				root,
				[
					{
						id: "lesson",
						title: "Lesson",
						locale: "en",
						blocks: Array.from({ length: 4 }, (_, i) => ({
							id: `image-${i}`,
							type: "image" as const,
							data: { src: `assets/image-${i}.png`, alt: "An image" },
						})),
					},
				],
				false,
			);
			expect(assets.size).toBe(4);
		}
		expect(fsProbe.walks.filter((p) => p === join(root, "old"))).toHaveLength(2);
	});
}

for (const protectedPath of [
	"new.prax",
	".praxity/review/new.json",
	".praxity-write-late/install-0",
]) {
	it(`refuses an outside writer's ${protectedPath} hardlink added after the shared scan`, async (context) => {
		const asset = join(root, "assets/image.png");
		await writeFile(asset, "previously public");
		await makeLink("hardlink", asset, join(root, "public-copy.png"), context);
		let linked = false;
		const inventory = new ProjectAssetInventory(root, async (handle) => {
			const bytes = await handle.readFile();
			if (!linked) {
				linked = true;
				const target = join(root, protectedPath);
				await mkdir(dirname(target), { recursive: true });
				await link(asset, target);
			}
			return bytes;
		});
		await expect(inventory.read()).rejects.toMatchObject({
			code: protectedPath === "new.prax" ? "asset-source-refused" : "asset-internal-refused",
			message: `${protectedPath === "new.prax" ? "asset-source-refused" : "asset-internal-refused"}: assets/image.png`,
		});
	});
}

async function makeLink(
	kind: "symlink" | "hardlink",
	source: string,
	asset: string,
	context: TestContext,
) {
	try {
		if (kind === "hardlink") await link(source, asset);
		else await symlink(source, asset, "file");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EPERM"].includes(code ?? ""))
			context.skip(true, `${kind} unavailable on this filesystem: ${code}`);
		throw error;
	}
}

it("scans protected file identities twice per inventory read, only for hardlinked files", async (context) => {
	await mkdir(join(root, "old"));
	await writeFile(join(root, "old/lesson.prax"), "PRIVATE_SOURCE");
	await mkdir(join(root, ".praxity/identity"), { recursive: true });
	await writeFile(join(root, ".praxity/identity/course.json"), "PRIVATE_IDENTITY");
	await writeFile(join(root, "assets/original.png"), "public image");
	const inventory = new ProjectAssetInventory(root);
	await inventory.read();
	expect(fsProbe.walks.filter((p) => p === join(root, "old"))).toHaveLength(0);
	for (let i = 0; i < 12; i++)
		await makeLink(
			"hardlink",
			join(root, "assets/original.png"),
			join(root, `assets/copy-${i}.png`),
			context,
		);
	for (let read = 0; read < 2; read++) {
		fsProbe.walks = [];
		expect((await inventory.read()).bytes.size).toBe(13);
		expect(fsProbe.walks.filter((p) => p === join(root, "old"))).toHaveLength(2);
		expect(fsProbe.walks.filter((p) => p === join(root, ".praxity/identity"))).toHaveLength(2);
	}
});

for (const failure of ["dangling", "escaping", "unreadable"] as const) {
	it(`codes ${failure} authored-scan failures without a cause`, async (context) => {
		await writeFile(join(root, "assets/original.pdf"), "public PDF");
		await makeLink(
			"hardlink",
			join(root, "assets/original.pdf"),
			join(root, "assets/copy.pdf"),
			context,
		);
		await mkdir(join(root, "old"));
		if (failure === "unreadable") fsProbe.unreadable = join(root, "old");
		else
			await makeLink(
				"symlink",
				failure === "dangling" ? join(root, "gone.prax") : tmpdir(),
				join(root, "old/lesson.prax"),
				context,
			);
		try {
			await resolveProjectAsset(root, join(root, "assets/copy.pdf"));
			throw new Error("Expected refusal");
		} catch (error) {
			expect(error).toMatchObject({
				code: "asset-identity-unavailable",
				message: "asset-identity-unavailable: assets/copy.pdf",
			});
			expect(error).not.toHaveProperty("cause");
		}
	});
}

it("fails the whole inventory for an unreferenced source with its path and code", async () => {
	await writeFile(join(root, "assets/public.png"), "public");
	await mkdir(join(root, "assets/templates"));
	await writeFile(join(root, "assets/templates/starter.prax"), "PRIVATE_SOURCE");
	const refusal = {
		code: "asset-source-refused",
		message: "asset-source-refused: assets/templates/starter.prax",
	};
	await expect(new ProjectAssetInventory(root).read()).rejects.toMatchObject(refusal);
	await expect(listProjectAssets(root)).rejects.toMatchObject(refusal);
});

it("refuses asset-changed when the path is replaced after opening", async () => {
	const asset = join(root, "assets/image.png");
	await writeFile(asset, "public image");
	fsProbe.afterOpen = async () => {
		fsProbe.afterOpen = undefined;
		await rename(asset, join(root, "original.png"));
		await writeFile(asset, "replacement image");
	};
	await expect(openProjectAsset(root, asset)).rejects.toMatchObject({
		code: "asset-changed",
		message: "asset-changed: assets/image.png",
	});
});

for (const [file] of privateFiles) {
	it(`inspection blocks ${file} and its hardlink without a digest`, async (context) => {
		const source = join(root, file);
		await mkdir(dirname(source), { recursive: true });
		await writeFile(source, "PRIVATE_SOURCE");
		await makeLink("hardlink", source, join(root, "assets/alias.txt"), context);
		const inspector = assetInspector(root);
		for (const uri of [file, "assets/alias.txt"])
			expect(await inspector.read(uri)).toEqual({ uri, availability: "blocked", sha256: null });
	});
}

it("inspection preserves the digest of an admitted public resource", async () => {
	await writeFile(join(root, "assets/public.txt"), "abc");
	expect(await assetInspector(root).read("assets/public.txt")).toEqual({
		uri: "assets/public.txt",
		availability: "present",
		sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
	});
});

for (const kind of ["symlink", "hardlink"] as const) {
	for (const [file, code] of privateFiles) {
		it(`refuses a ${kind} to ${file} before admitting any bytes`, async (context) => {
			const source = join(root, file);
			await mkdir(dirname(source), { recursive: true });
			await writeFile(source, "PRIVATE_MODEL_HINT_AND_REVIEW_EVIDENCE");
			const asset = join(root, "assets/disguised.txt");
			await makeLink(kind, source, asset, context);
			const refusal = { code, message: `${code}: assets/disguised.txt` };
			await expect(resolveProjectAsset(root, asset)).rejects.toMatchObject(refusal);
			await expect(openProjectAsset(root, asset)).rejects.toMatchObject(refusal);
			await expect(listProjectAssets(root)).rejects.toMatchObject(
				file === ".praxity-transaction.json" ? { code: "ERECOVERYREQUIRED" } : refusal,
			);
			await expect(new ProjectAssetInventory(root).read()).rejects.toMatchObject(refusal);
		});
	}
}

it.each(["lesson.prax", "lesson.PRAX"])("refuses source copies named %s", async (name) => {
	await writeFile(join(root, "lesson.prax"), "PRIVATE_SOURCE");
	const asset = join(root, "assets", name);
	await copyFile(join(root, "lesson.prax"), asset);
	await expect(resolveProjectAsset(root, asset)).rejects.toMatchObject({
		code: "asset-source-refused",
		message: `asset-source-refused: assets/${name}`,
	});
});

it.each(["identity", "review", "local"])(
	"refuses a moved %s directory still named by internal storage",
	async (name) => {
		const internal = join(root, ".praxity", name);
		await mkdir(internal, { recursive: true });
		await writeFile(join(internal, "record.json"), "PRIVATE_EVIDENCE");
		const moved = join(root, "assets/private");
		await rename(internal, moved);
		await symlink(moved, internal, "junction");
		await expect(resolveProjectAsset(root, join(moved, "record.json"))).rejects.toMatchObject({
			code: "asset-internal-refused",
			message: "asset-internal-refused: assets/private/record.json",
		});
	},
);

it("refuses a moved legacy registry still named by internal storage", async () => {
	await mkdir(join(root, ".praxity"));
	const internal = join(root, ".praxity/content-identity.json");
	const moved = join(root, "assets/registry.json");
	await writeFile(internal, "PRIVATE_REGISTRY");
	await rename(internal, moved);
	await symlink(moved, internal, "file");
	await expect(resolveProjectAsset(root, moved)).rejects.toMatchObject({
		code: "asset-internal-refused",
		message: "asset-internal-refused: assets/registry.json",
	});
});

it("refuses narration itself as an asset", async () => {
	await writeFile(join(root, "narration.yaml"), "PRIVATE_NARRATION");
	await expect(resolveProjectAsset(root, join(root, "narration.yaml"))).rejects.toMatchObject({
		code: "asset-internal-refused",
		message: "asset-internal-refused: narration.yaml",
	});
});

it("refuses a cached image replaced with a hardlink to lesson source", async (context) => {
	const asset = join(root, "assets/image.png");
	await writeFile(asset, "public image");
	const inventory = new ProjectAssetInventory(root);
	await inventory.read();
	await writeFile(join(root, "lesson.prax"), "PRIVATE_SOURCE");
	await rm(asset);
	await makeLink("hardlink", join(root, "lesson.prax"), asset, context);
	await expect(inventory.read()).rejects.toMatchObject({
		code: "asset-source-refused",
		message: "asset-source-refused: assets/image.png",
	});
	await expect(
		resolvePdfAssets(
			root,
			[
				{
					id: "lesson",
					title: "Lesson",
					locale: "en",
					blocks: [
						{ id: "image", type: "image", data: { src: "assets/image.png", alt: "An image" } },
					],
				},
			],
			false,
		),
	).rejects.toMatchObject({ code: "asset-source-refused" });
});

it("admits normal images, PDFs and contained aliases", async (context) => {
	await writeFile(join(root, "lesson.prax"), "private lesson");
	await mkdir(join(root, ".praxity/identity"), { recursive: true });
	await writeFile(join(root, ".praxity/identity/course.json"), "private identity");
	await writeFile(join(root, "assets/image.png"), "public image");
	await writeFile(join(root, "assets/handout.pdf"), "public PDF");
	await makeLink(
		"hardlink",
		join(root, "assets/handout.pdf"),
		join(root, "assets/copy.pdf"),
		context,
	);
	await symlink(join(root, "assets/image.png"), join(root, "assets/alias.png"), "file");
	const inventory = await new ProjectAssetInventory(root).read();
	expect([...(await listProjectAssets(root))]).toEqual([
		"assets/alias.png",
		"assets/copy.pdf",
		"assets/handout.pdf",
		"assets/image.png",
	]);
	expect(Buffer.from(inventory.bytes.get("assets/copy.pdf") ?? []).toString()).toBe("public PDF");
	expect(Buffer.from(inventory.bytes.get("assets/alias.png") ?? []).toString()).toBe(
		"public image",
	);
});

it("rechecks a cached file that gains a lesson source name without replacing its inode", async (context) => {
	const asset = join(root, "assets/download.txt");
	await writeFile(asset, "previously public text");
	const inventory = new ProjectAssetInventory(root);
	await inventory.read();
	await makeLink("hardlink", asset, join(root, "lesson.prax"), context);
	await expect(inventory.read()).rejects.toMatchObject({
		code: "asset-source-refused",
		message: "asset-source-refused: assets/download.txt",
	});
});

it("documents that a renamed independent source copy has no source file identity", async () => {
	await writeFile(join(root, "lesson.prax"), "intentionally duplicated public text");
	const asset = join(root, "assets/download.txt");
	await copyFile(join(root, "lesson.prax"), asset);
	expect(await resolveProjectAsset(root, asset)).toBe(asset);
	expect(
		Buffer.from(
			(await new ProjectAssetInventory(root).read()).bytes.get("assets/download.txt") ?? [],
		).toString(),
	).toBe("intentionally duplicated public text");
});

for (const [file] of privateFiles) {
	it(`refuses hardlinked ${file} through browser media admission`, async (context) => {
		const source = join(root, file);
		await mkdir(dirname(source), { recursive: true });
		await writeFile(source, "PRIVATE_MODEL_HINT_AND_REVIEW_EVIDENCE");
		await makeLink("hardlink", source, join(root, "assets/alias.txt"), context);
		const server = await startStudioReadOnlyServer({
			projectDir: root,
			getEditorOrigin: () => "http://127.0.0.1:1",
		});
		try {
			const response = await fetch(`${server.mediaBaseUrl}assets/alias.txt`);
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("");
		} finally {
			await server.close();
		}
	});
}
