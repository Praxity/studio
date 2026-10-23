import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
	type IdentityMergeConflict,
	type IdentityMergeState,
	type IdentityNode,
	isDurableIdentity,
	serializeIdentity,
} from "@praxity/content-identity";
import {
	type ProjectWriteResult,
	projectIdentityRecoveryAdvice,
	projectPlainStoreMessage,
	projectPlainStorePath,
} from "../shared/project-write-errors";
import type { CliExecution } from "./cli";
import en from "./cli-messages/en.json" with { type: "json" };
import fr from "./cli-messages/fr.json" with { type: "json" };
import { readCourseManifestData } from "./course-manifest-io";
import {
	identityDiagnosticLabel,
	mergeCourseIdentity,
	readIdentityRevision,
} from "./identity-store";

const execute = promisify(execFile);
const catalogs = [en.identityMerge, fr.identityMerge];
type Catalog = typeof en.identityMerge;
const format = (template: string, args: Record<string, string> = {}) =>
	template.replace(/\{(\w+)\}/gu, (match, key: string) => args[key] ?? match);
const bilingual = (key: keyof Catalog, args?: Record<string, string>) =>
	catalogs.map((catalog) => format(catalog[key], args)).join("\n");
export const identityMergeHelp = `${bilingual("usage")}\n${bilingual("help")}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function describeConflict(
	conflict: IdentityMergeConflict,
	states: ReturnType<typeof readIdentityRevision>[],
): string {
	const locate = (state: IdentityMergeState, id: string) => {
		const snapshot = state.snapshots.find((snapshot) => snapshot.nodes[id]);
		const node = snapshot?.nodes[id];
		let page = node;
		const visited = new Set<string>();
		while (page && page.kind !== "page" && page.parent && !visited.has(page.parent)) {
			visited.add(page.parent);
			page = snapshot?.nodes[page.parent];
		}
		return {
			node,
			label: snapshot && node ? identityDiagnosticLabel(snapshot.nodes, id) : undefined,
			page,
			file: snapshot
				? state.heads.find((head) => head.head === hash(serializeIdentity(snapshot)))?.path
				: undefined,
		};
	};
	return catalogs
		.map((catalog) => {
			const action = (
				id: string,
				history: ReadonlySet<string>,
				node: IdentityNode | undefined,
				before: IdentityNode | undefined,
				file?: string,
				label?: string,
			) => {
				if (!node) return catalog.missing;
				const key =
					node.status === "retired" && isDurableIdentity(id, node, history)
						? "deleted"
						: !before
							? "added"
							: serializeIdentity(node) === serializeIdentity(before)
								? "unchanged"
								: "changed";
				return format(catalog[key], {
					content: `${node.type} ${JSON.stringify(label)}${file ? ` [${file}]` : ""}`,
				});
			};
			return conflict.ids
				.map((id) => {
					const [base, ours, theirs] = states.map((state) => locate(state, id));
					const address = ours.node ? ours : theirs.node ? theirs : base;
					return format(catalog.conflict, {
						lesson: conflict.file ?? address.file ?? catalog.lesson,
						page: address.page?.kind === "page" ? address.page.label : catalog.page,
						block: address.node?.type ?? catalog.entity,
						ids: conflict.ids.join(", "),
						reason: catalog[conflict.reason],
						ours: action(
							id,
							states[1].activeHistoryIds,
							ours.node,
							base.node,
							ours.file,
							ours.label,
						),
						theirs: action(
							id,
							states[2].activeHistoryIds,
							theirs.node,
							base.node,
							theirs.file,
							theirs.label,
						),
					});
				})
				.join("\n");
		})
		.join("\n");
}

export async function runIdentityMergeCli(args: string[]): Promise<CliExecution> {
	const result = (
		exitCode: CliExecution["exitCode"],
		code: string,
		message: string,
		writeResult?: ProjectWriteResult,
	): CliExecution => ({
		exitCode,
		stdout: `${JSON.stringify(exitCode === 0 ? { ok: true, ...writeResult } : { ok: false, error: { code, message } })}\n`,
		stderr: `${message}\n`,
	});
	if (args[1] !== "merge" || args.length > 3 || args[2]?.startsWith("-"))
		return result(2, "invalid_arguments", bilingual("usage"));
	try {
		const course = await realpath(resolve(args[2] ?? "."));
		const git = async (...argv: string[]) => {
			const { stdout } = await execute("git", ["-C", course, ...argv], {
				encoding: "buffer",
				maxBuffer: 32 * 1024 * 1024,
				windowsHide: true,
			});
			return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdout);
		};
		// Resolve immutable object IDs once. No command changes git's working tree or index.
		const root = (await git("rev-parse", "--show-toplevel")).trim();
		let theirs: string;
		try {
			theirs = (await git("rev-parse", "--verify", "MERGE_HEAD")).trim();
		} catch (error) {
			if ((error as { code?: unknown }).code === 128)
				return result(1, "identity_not_merging", bilingual("notMerging"));
			throw error;
		}
		if (!/^[a-f0-9]{40,64}$/u.test(theirs))
			return result(1, "identity_merge_failed", bilingual("multipleHeads"));
		const ours = (await git("rev-parse", "--verify", "HEAD")).trim();
		const mergeHeadPath = (await git("rev-parse", "--git-path", "MERGE_HEAD")).trim();
		const mergeHeads = (await readFile(resolve(course, mergeHeadPath), "utf8"))
			.trim()
			.split(/\s+/u);
		if (mergeHeads.length !== 1 || mergeHeads[0] !== theirs)
			return result(1, "identity_merge_failed", bilingual("multipleHeads"));
		const base = (await git("merge-base", ours, theirs)).trim();
		const path = relative(root, course).replaceAll("\\", "/");
		if (isAbsolute(path) || path === ".." || path.startsWith("../"))
			throw new Error(bilingual("outsideRepository"));
		const prefix = path ? `${path}/` : "";
		const revision = async (ref: string) => {
			const files = new Map<string, string>();
			// git show on a tree lists its immediate children. Identity filenames are owned by the store.
			const list = async (directory: string) => {
				const tree = await git("show", `${ref}:${prefix}${directory}`);
				const separator = tree.indexOf("\n\n");
				if (separator < 0) throw new Error(bilingual("invalidTree", { directory }));
				return tree
					.slice(separator + 2)
					.trimEnd()
					.split("\n")
					.filter(Boolean);
			};
			for (const name of await list(".praxity/identity")) {
				if (!["course.json", "lessons/", "snapshots/"].includes(name))
					throw new Error(bilingual("unexpectedEntry", { name }));
			}
			const names = [".praxity/identity/course.json"];
			for (const directory of ["lessons", "snapshots"]) {
				for (const name of await list(`.praxity/identity/${directory}`))
					names.push(`.praxity/identity/${directory}/${name}`);
			}
			for (const name of names) files.set(name, await git("show", `${ref}:${prefix}${name}`));
			return files;
		};
		const revisions = {
			base: await revision(base),
			ours: await revision(ours),
			theirs: await revision(theirs),
		};
		const states = [revisions.base, revisions.ours, revisions.theirs].map(readIdentityRevision);
		const { orderedLessons, lessonFilesOnDisk } = await readCourseManifestData(course, {
			requireManifest: true,
		});
		const merged = await mergeCourseIdentity(course, revisions, [
			...new Set([...orderedLessons, ...lessonFilesOnDisk]),
		]);
		if (!merged.resolution)
			return result(
				3,
				"identity_conflicts",
				merged.conflicts.map((conflict) => describeConflict(conflict, states)).join("\n"),
			);
		return result(0, "", bilingual("success"), merged.writeResult);
	} catch (error) {
		const advice = (["en", "fr"] as const)
			.map((locale) => projectIdentityRecoveryAdvice(error, locale))
			.filter((message) => message !== undefined);
		if (advice.length) return result(1, "EIDENTITY", advice.join("\n"));
		const path = projectPlainStorePath(error);
		if (path !== undefined)
			return result(
				1,
				"EIDENTITY",
				["en", "fr"]
					.map((locale) => projectPlainStoreMessage(path, locale as "en" | "fr"))
					.join("\n"),
			);
		// The pure identity owner rejects source markers before it can return a merge result.
		if (error instanceof Error && error.message === "Identity: source conflict markers")
			return result(3, "identity_conflicts", bilingual("sourceConflicts"));
		return result(
			1,
			"identity_merge_failed",
			bilingual("failed", { reason: error instanceof Error ? error.message : String(error) }),
		);
	}
}
