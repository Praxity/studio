import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IdentityNode } from "@praxity/content-identity";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectDiskSnapshot } from "../../test-utils/interrupted-project-write";
import { runPraxityCli } from "../cli";
import { loadIdentityStore, resolveCourseIdentity } from "../identity-store";
import { createStudioProjectSession } from "../studio/project-session";

const runtime = { appVersion: "test", exportAssetsDir: "unused" };
const roots: string[] = [];
const original = "# First\n\nRepeated.\n\nOld subject.\n";
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(file = "first.prax") {
	const root = await mkdtemp(join(tmpdir(), "identity-routing-{file}-{line}-"));
	roots.push(root);
	await writeFile(join(root, "course.yaml"), `title: Example\nlessons: [${file}, second.prax]\n`);
	await writeFile(join(root, file), original);
	await writeFile(join(root, "second.prax"), "# Second\n\nOther subject.\n");
	expect((await runPraxityCli(["identity", "init", root], runtime)).exitCode).toBe(0);
	return root;
}
async function identityBytes(root: string, prefix = ".praxity/identity"): Promise<object> {
	return Object.fromEntries(
		await Promise.all(
			(await readdir(join(root, prefix), { withFileTypes: true })).map(async (entry) => {
				const file = `${prefix}/${entry.name}`;
				return [
					file,
					entry.isDirectory()
						? await identityBytes(root, file)
						: await readFile(join(root, file), "utf8"),
				];
			}),
		),
	);
}
const run = (root: string, command: string, locale: string) =>
	runPraxityCli(
		command === "init"
			? ["identity", "init", root, "--lang", locale]
			: ["export", root, "--format", "pdf", "--output", join(root, "course.pdf"), "--lang", locale],
		runtime,
	);
describe.each(["en", "fr"])("identity routing in %s", (locale) => {
	describe.each(["page", "lesson"])("saved copy moved to another %s", (destination) => {
		let root: string;
		let originalNodes: Record<string, IdentityNode>;
		const file = "first{course}{line}{file}.prax";
		beforeEach(async () => {
			root = await mkdtemp(join(tmpdir(), "identity-moved-{file}-{line}-"));
			roots.push(root);
			await writeFile(
				join(root, "course.yaml"),
				`title: Example\nlessons: ["${file}", second.prax]\n`,
			);
			const second = "# Second\n\nOther subject.\n";
			const first = `${original}\nRepeated.\n`;
			await writeFile(join(root, file), destination === "page" ? `${first}\n${second}` : first);
			await writeFile(
				join(root, "second.prax"),
				destination === "page" ? "# Third\n\nLast subject.\n" : second,
			);
			expect((await run(root, "init", locale)).exitCode).toBe(0);
			originalNodes = Object.assign(
				{},
				...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes),
			);
			await writeFile(
				join(root, file),
				destination === "page" ? `${original}\n${second}\nRepeated.\n` : original,
			);
			if (destination === "lesson")
				await writeFile(join(root, "second.prax"), `${second}\nRepeated.\n`);
		});
		it("initializes the move with every saved ID active", async () => {
			const source = await readFile(join(root, file), "utf8");
			const initialized = await run(root, "init", locale);
			expect(initialized.exitCode, initialized.stderr).toBe(0);
			const stored = Object.assign(
				{},
				...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes),
			);
			for (const id of Object.keys(originalNodes)) expect(stored[id].status).toBe("active");
			expect(await readFile(join(root, file), "utf8")).toBe(source);
			const unchanged = await run(root, "init", locale);
			expect(unchanged.exitCode).toBe(0);
			expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
		});
		it.each(["init", "export"])(
			"gives %s ordinary rederive advice for a move with a rewrite, then retires only the rewrite",
			async (command) => {
				await writeFile(
					join(root, file),
					(await readFile(join(root, file), "utf8")).replace(
						"Old subject.",
						"Unrelated replacement.",
					),
				);
				const before = await identityBytes(root);
				const source = await readFile(join(root, file), "utf8");
				const beforeRefusal = await projectDiskSnapshot(root);
				const result = await run(root, command, locale);
				expect(result.exitCode).toBe(1);
				expect(JSON.parse(result.stdout).error.message).toBe(
					locale === "en"
						? command === "init"
							? `Identity initialization refused: existing blocks could not be matched. Run praxity identity init '${root}' --rederive --confirm-unpublished only if this course has never been published.`
							: `Export refused: course identity must be recorded or reviewed before export.\nExisting blocks could not be matched. Run praxity identity init '${root}' --rederive --confirm-unpublished only if this course has never been published.\n${file}:5: page "First", block "Unrelated replacement."`
						: command === "init"
							? `Initialisation des identités refusée : certains blocs existants n'ont pas pu être associés. Exécutez praxity identity init '${root}' --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié.`
							: `Export refusé : les identités du cours doivent être enregistrées ou examinées avant l'export.\nCertains blocs existants n'ont pas pu être associés. Exécutez praxity identity init '${root}' --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié.\n${file}:5 : page "First", bloc "Unrelated replacement."`,
				);
				expect(await identityBytes(root)).toEqual(before);
				expect(await readFile(join(root, file), "utf8")).toBe(source);
				expect(await projectDiskSnapshot(root)).toEqual(beforeRefusal);
				const rewrittenId = Object.keys(originalNodes).find(
					(id) =>
						originalNodes[id].kind === "block" && originalNodes[id].matchText === "Old subject.",
				);
				expect(rewrittenId).toBeDefined();
				const confirmed = await runPraxityCli(
					["identity", "init", root, "--rederive", "--confirm-unpublished", "--lang", locale],
					runtime,
				);
				expect(confirmed.exitCode, confirmed.stderr).toBe(0);
				expect(JSON.parse(confirmed.stdout).retired.map((node: { id: string }) => node.id)).toEqual(
					[rewrittenId],
				);
				const stored = Object.assign(
					{},
					...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes),
				);
				for (const id of Object.keys(originalNodes))
					expect(stored[id].status).toBe(id === rewrittenId ? "retired" : "active");
				const unchanged = await run(root, "init", locale);
				expect(unchanged.exitCode).toBe(0);
				expect(JSON.parse(unchanged.stdout)).toEqual({ ok: true, changed: false });
			},
		);
		it.each(["init", "export"])(
			"keeps actual extra copies on %s's extra-copy route",
			async (command) => {
				await writeFile(
					join(root, file),
					`${original}\nRepeated.\n\nRepeated.\n${destination === "page" ? "\n# Second\n\nOther subject.\n" : ""}`,
				);
				if (destination === "lesson")
					await writeFile(join(root, "second.prax"), "# Second\n\nOther subject.\n");
				const before = await identityBytes(root);
				const result = await run(root, command, locale);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(locale === "en" ? "extra copy" : "copie en trop");
				expect(result.stderr).not.toContain(
					locale === "en" ? "which identical copy moved" : "quelle copie identique a été déplacée",
				);
				expect(await identityBytes(root)).toEqual(before);
			},
		);
	});
	describe.each(["same lesson", "different lessons"])(
		"duplicate and rewrite in %s",
		(placement) => {
			let root: string;
			let before: object;
			beforeEach(async () => {
				root = await fixture();
				await writeFile(
					join(root, "first.prax"),
					`# First\n\nRepeated.\n\nRepeated.\n\n${placement === "same lesson" ? "Unrelated replacement." : "Old subject."}\n`,
				);
				if (placement === "different lessons")
					await writeFile(join(root, "second.prax"), "# Second\n\nUnrelated replacement.\n");
				before = await identityBytes(root);
			});
			it.each(["init", "export"])("refuses %s with the mixed rederive route", async (command) => {
				const result = await run(root, command, locale);
				expect(result.exitCode).toBe(1);
				expect(JSON.parse(result.stdout).error.message).toBe(
					locale === "en"
						? `${command === "init" ? "Identity initialization refused" : "Export refused"}: first.prax:5 repeats existing text. Make it unique, then run praxity identity init '${root}'. If other changes remain, run it with --rederive --confirm-unpublished only if this course has never been published.`
						: `${command === "init" ? "Initialisation des identités refusée" : "Export refusé"} : first.prax:5 répète un texte existant. Rendez-le unique, puis lancez praxity identity init '${root}'. Si d'autres modifications restent à traiter, lancez cette commande avec --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié.`,
				);
				expect(result.stderr).not.toContain("Studio");
				expect(result.stderr).not.toContain('block "Repeated."');
				expect(await identityBytes(root)).toEqual(before);
			});
		},
	);
	describe.each([false, true])("saved pending=%s", (savedPending) => {
		describe.each(["reworded", "removed"])("copy %s", (change) => {
			let root: string;
			let originalId: string;
			beforeEach(async () => {
				root = await fixture();
				const prior = await loadIdentityStore(root);
				const saved = prior.snapshots
					.flatMap((s) => Object.entries(s.nodes))
					.find(([, n]) => n.matchText === "Repeated.");
				if (!saved) throw new Error("Missing original paragraph");
				originalId = saved[0];
				await writeFile(join(root, "first.prax"), `${original}\nRepeated.\n`);
				if (savedPending) {
					const studio = await createStudioProjectSession(root, "test");
					await studio.invoke("courseWriteLesson", {
						courseDir: root,
						filename: "first.prax",
						grammar: `${original}\nRepeated.\n`,
						expectedGrammar: `${original}\nRepeated.\n`,
					});
					await studio.close();
					const pending = await loadIdentityStore(root);
					expect(
						pending.snapshots
							.flatMap((s) => Object.entries(s.nodes))
							.find(([id]) => id === originalId)?.[1].status,
					).toBe("pending");
				}
				await writeFile(
					join(root, "first.prax"),
					change === "removed" ? original : `${original}\nA distinct copy.\n`,
				);
			});
			it("settles on plain init with the durable original active and export admitted", async () => {
				if (change === "removed")
					expect(await readFile(join(root, "first.prax"), "utf8")).toBe(original);
				const result = await run(root, "init", locale);
				expect(result.exitCode, result.stderr).toBe(0);
				const store = await loadIdentityStore(root);
				const nodes: Record<string, IdentityNode> = Object.assign(
					{},
					...store.snapshots.map((snapshot) => snapshot.nodes),
				);
				expect(nodes[originalId].status).toBe("active");
				expect(Object.values(nodes).filter((node) => node.status === "pending")).toEqual([]);
				await resolveCourseIdentity(root, {
					lessonPaths: ["first.prax", "second.prax"],
					strict: true,
				});
			});
		});
	});
	describe.each([false, true])("duplicate refusal, saved pending=%s", (savedPending) => {
		let root: string;
		let before: object;
		beforeEach(async () => {
			root = await fixture();
			await writeFile(join(root, "first.prax"), `${original}\nRepeated.\n`);
			if (savedPending) {
				const session = await createStudioProjectSession(root, "test");
				await session.invoke("courseWriteLesson", {
					courseDir: root,
					filename: "first.prax",
					grammar: `${original}\nRepeated.\n`,
					expectedGrammar: `${original}\nRepeated.\n`,
				});
				await session.close();
			}
			before = await identityBytes(root);
		});
		it.each(["init", "export"])("gives %s the literal duplicate advice", async (command) => {
			const result = await run(root, command, locale);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.message).toBe(
				locale === "en"
					? command === "init"
						? `Identity initialization refused: first.prax:7 repeats a block that already has an ID, so Praxity can't tell which copy keeps it. Change or remove the extra copy, then run praxity identity init '${root}'. The copy with the unchanged text keeps the original ID.`
						: `Export refused: first.prax:7 repeats a block that already has an ID. Change or remove the extra copy, run praxity identity init '${root}', then export again.`
					: command === "init"
						? `Initialisation des identités refusée : first.prax:7 répète un bloc qui a déjà un identifiant ; Praxity ne peut pas savoir quelle copie le garde. Modifiez ou supprimez la copie en trop, puis lancez praxity identity init '${root}'. La copie dont le texte n'a pas changé garde l'identifiant d'origine.`
						: `Export refusé : first.prax:7 répète un bloc qui a déjà un identifiant. Modifiez ou supprimez la copie en trop, lancez praxity identity init '${root}', puis relancez l'export.`,
			);
			expect(await identityBytes(root)).toEqual(before);
		});
	});
	describe("settled duplicate with a rewritten durable block", () => {
		let root: string;
		let originalId: string;
		let rewrittenId: string;
		let provisionalIds: string[];
		beforeEach(async () => {
			root = await fixture();
			const prior = (await loadIdentityStore(root)).snapshots.flatMap((s) =>
				Object.entries(s.nodes),
			);
			const savedOriginal = prior.find(([, n]) => n.matchText === "Repeated.");
			const rewritten = prior.find(([, n]) => n.matchText === "Old subject.");
			if (!savedOriginal || !rewritten) throw new Error("Missing durable fixture blocks");
			originalId = savedOriginal[0];
			rewrittenId = rewritten[0];
			await writeFile(join(root, "first.prax"), `${original}\nRepeated.\n`);
			const session = await createStudioProjectSession(root, "test");
			await session.invoke("courseWriteLesson", {
				courseDir: root,
				filename: "first.prax",
				grammar: `${original}\nRepeated.\n`,
				expectedGrammar: `${original}\nRepeated.\n`,
			});
			await session.close();
			provisionalIds = (await loadIdentityStore(root)).snapshots
				.flatMap((s) => Object.keys(s.nodes))
				.filter((id) => !prior.some(([saved]) => saved === id));
			await writeFile(
				join(root, "first.prax"),
				"# First\n\nRepeated.\n\nUnrelated replacement.\n\nA distinct copy.\n",
			);
		});
		it.each(["init", "export"])(
			"moves %s to plain rederive advice after making text unique",
			async (command) => {
				const before = await identityBytes(root);
				const result = await run(root, command, locale);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain(
					locale === "en"
						? `existing blocks could not be matched. Run praxity identity init '${root}' --rederive --confirm-unpublished only if this course has never been published.`.replace(
								"existing",
								command === "export" ? "Existing" : "existing",
							)
						: `certains blocs existants n'ont pas pu être associés. Exécutez praxity identity init '${root}' --rederive --confirm-unpublished uniquement si ce cours n'a jamais été publié.`.replace(
								"certains",
								command === "export" ? "Certains" : "certains",
							),
				);
				expect(result.stderr).not.toContain(
					locale === "en" ? "repeats existing text" : "répète un texte existant",
				);
				expect(await identityBytes(root)).toEqual(before);
			},
		);
		it("retires only the rewritten durable block on confirmed rederive", async () => {
			const result = await runPraxityCli(
				["identity", "init", root, "--rederive", "--confirm-unpublished", "--lang", locale],
				runtime,
			);
			expect(result.exitCode, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout).retired).toEqual([
				{
					file: "first.prax",
					kind: "block",
					page: "First",
					line: null,
					span: { start: 20, end: 33 },
					label: "Old subject.",
					id: rewrittenId,
				},
			]);
			const nodes: Record<string, IdentityNode> = Object.assign(
				{},
				...(await loadIdentityStore(root)).snapshots.map((s) => s.nodes),
			);
			expect(nodes[originalId].status).toBe("active");
			expect(nodes[rewrittenId].status).toBe("retired");
			for (const id of provisionalIds) expect(nodes[id].status).toBe("retired");
			await resolveCourseIdentity(root, {
				lessonPaths: ["first.prax", "second.prax"],
				strict: true,
			});
		});
	});
	it.each(["init", "export"])(
		"keeps a recovery-shaped filename on %s's source-repair route",
		async (command) => {
			const file = "Project recovery required.prax";
			const root = await fixture(file);
			await writeFile(
				join(root, file),
				"# Project recovery required\n::: note\nUnclosed content\n",
			);
			const before = await identityBytes(root);
			const result = await run(root, command, locale);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.code).toBe(
				command === "init" ? "identity_init_failed" : "project_invalid",
			);
			expect(JSON.parse(result.stdout).error.message).toBe(
				locale === "en"
					? command === "init"
						? `Identity initialization refused: ${file}:2 contains a source error. Fix the source, then run praxity identity init '${root}'.`
						: `Export refused: ${file}:2 contains a source error. Fix it, run praxity identity init '${root}', then export again.`
					: command === "init"
						? `Initialisation des identités refusée : ${file}:2 contient une erreur de source. Corrigez la source, puis lancez praxity identity init '${root}'.`
						: `Export refusé : ${file}:2 contient une erreur de source. Corrigez-la, lancez praxity identity init '${root}', puis relancez l'export.`,
			);
			expect(result.stderr).toContain(`${file}:2`);
			expect(result.stderr).toContain(
				locale === "en" ? "contains a source error" : "contient une erreur de source",
			);
			expect(result.stderr).not.toContain("Studio");
			expect(result.stderr).not.toContain("--rederive");
			expect(result.stderr).not.toContain(locale === "en" ? 'block "' : 'bloc "');
			expect(await identityBytes(root)).toEqual(before);
		},
	);
	it.each(["init", "export"])(
		"puts source errors before duplicate advice on %s",
		async (command) => {
			const root = await fixture();
			await writeFile(join(root, "first.prax"), `${original}\nRepeated.\n`);
			await writeFile(join(root, "second.prax"), "# Second\n::: note\nUnclosed content\n");
			const before = await identityBytes(root);
			const result = await run(root, command, locale);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.message).toBe(
				locale === "en"
					? command === "init"
						? `Identity initialization refused: second.prax:2 contains a source error. Fix the source, then run praxity identity init '${root}'.`
						: `Export refused: second.prax:2 contains a source error. Fix it, run praxity identity init '${root}', then export again.`
					: command === "init"
						? `Initialisation des identités refusée : second.prax:2 contient une erreur de source. Corrigez la source, puis lancez praxity identity init '${root}'.`
						: `Export refusé : second.prax:2 contient une erreur de source. Corrigez-la, lancez praxity identity init '${root}', puis relancez l'export.`,
			);
			expect(await identityBytes(root)).toEqual(before);
		},
	);
	it.each([
		["init", false],
		["export", false],
		["init", true],
		["export", true],
	] as const)(
		"keeps two durable copies dropping to one refused on %s and repeated init, with rewrite=%s",
		async (command, rewritten) => {
			// Initialize both copies as durable in a fresh store, rather than saving a provisional copy.
			const fresh = await mkdtemp(join(tmpdir(), "identity-durable-copies-"));
			roots.push(fresh);
			await writeFile(join(fresh, "course.yaml"), "title: Example\nlessons: [first.prax]\n");
			await writeFile(join(fresh, "first.prax"), `${original}\nRepeated.\n`);
			expect((await run(fresh, "init", locale)).exitCode).toBe(0);
			await writeFile(
				join(fresh, "first.prax"),
				rewritten ? "# First\n\nRepeated.\n\nUnrelated replacement.\n" : original,
			);
			const before = await identityBytes(fresh);
			const result = await run(fresh, command, locale);
			expect(result.exitCode).toBe(1);
			expect(JSON.parse(result.stdout).error.message).toBe(
				locale === "en"
					? `${command === "init" ? "Identity initialization refused" : "Export refused"}: first.prax:3: several saved blocks had this text and fewer copies remain, so Praxity can't tell which you removed. Restore the removed copy, ${command === "init" ? "then run" : "run"} praxity identity init '${fresh}'${command === "init" ? "." : ", then export again."} If this course has never been published, you can instead run it with --rederive --confirm-unpublished; these blocks then get new IDs.`
					: `${command === "init" ? "Initialisation des identités refusée" : "Export refusé"} : first.prax:3 : plusieurs blocs enregistrés avaient ce texte et il reste moins de copies ; Praxity ne peut pas savoir laquelle vous avez supprimée. Restaurez la copie supprimée, ${command === "init" ? "puis lancez" : "lancez"} praxity identity init '${fresh}'${command === "init" ? "." : ", puis relancez l'export."} Si ce cours n'a jamais été publié, vous pouvez plutôt lancer cette commande avec --rederive --confirm-unpublished ; ces blocs recevront alors de nouveaux identifiants.`,
			);
			expect((await run(fresh, "init", locale)).exitCode).toBe(1);
			expect(await identityBytes(fresh)).toEqual(before);
		},
	);
});
