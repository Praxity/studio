import { createHash } from "node:crypto";
import { assertPath } from "@praxity/content-identity/src/files.ts";
import type {
	OperationRequest,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import { lineColumn } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition, TURN_INTO, WRAP_IN } from "@praxity/grammar/src/v4/schema.ts";
import { definitionOf } from "@praxity/grammar/src/v4/tree/index.ts";
import { draftRange, locateTree } from "@praxity/operations/src/ranges.ts";
import { buildSlugMap } from "@praxity/shared-blocks/viewer/page-slug";
import { splitBlocksIntoPages } from "@praxity/shared-blocks/viewer/split-pages";
import { type EditorSnapshot, prepareEditorSnapshot } from "../../shared/editor-session";
import { readCourseManifestData } from "../course-manifest-io";
import {
	type CourseIdentitySession,
	loadIdentityStore,
	planReadIdentity,
	type ResolvedCourseIdentity,
} from "../identity-store";
import { resolveLessonSources } from "../lesson-source";
import { withProjectFileTransaction } from "../project-file-transactions";

import { canvasTextBindings } from "./canvas-text-bindings";

const digest = (source: string) => createHash("sha256").update(source).digest("hex");

/** One complete I4 read view supplies both outline identity and exact source ranges. */
export async function readEditorSnapshot(
	root: string,
	identitySession: CourseIdentitySession,
	sequence: () => number,
) {
	return withProjectFileTransaction(
		root,
		async (admitted) => {
			const seq = sequence();
			const current = await resolveLessonSources(admitted, {}, { identitySession });
			const stored = await loadIdentityStore(admitted);
			const storedIds = new Set(
				stored.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes)),
			);
			const records = new Map(
				current.identity.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)),
			);
			const { orderedLessons, unlistedLessons } = await readCourseManifestData(admitted);
			const snapshot: EditorSnapshot = {
				schema: 1,
				seq,
				transientIdentity: current.transientIds,
				lessons: [...orderedLessons, ...unlistedLessons].map((file) => {
					const lesson = current.lessons.get(file);
					if (!lesson) throw new Error("Missing inspected lesson");
					const mappings = current.identity.sourceMappings.filter(
						(mapping) => mapping.file === file,
					);
					const byPath = new Map(mappings.map((mapping) => [mapping.path.join(), mapping]));
					const lessonMapping = byPath.get("");
					const lessonRecord = lessonMapping && records.get(lessonMapping.id);
					if (!lessonMapping || !lessonRecord) throw new Error("Missing inspected lesson identity");
					const source = lesson.tree.stream.source;
					const target = (mapping: (typeof mappings)[number]) => ({
						kind: "node" as const,
						nodeId: storedIds.has(mapping.id) ? mapping.id : null,
						path: mapping.path,
						fingerprint: mapping.fingerprint,
					});
					return {
						id: lessonMapping.id,
						file,
						source,
						baseRevision: digest(source),
						listed: orderedLessons.includes(file),
						label: lessonRecord.label,
						revision: lessonRecord.revision,
						seed: {
							target: target(lessonMapping),
							expected: { start: 0, end: source.length },
							editable: { start: 0, end: source.length },
							scope: "file" as const,
						},
						nodes: locateTree(lesson.tree).flatMap((entry) => {
							if (!entry.path.length || entry.node.kind === "frontmatter") return [];
							const mapping = byPath.get(entry.path.join());
							const record = mapping && records.get(mapping.id);
							const page = byPath.get(String(entry.path[0]));
							if (!mapping || !record || !page) throw new Error("Missing inspected node identity");
							return [
								{
									id: mapping.id,
									parentId: record.parent === lessonMapping.id ? null : record.parent,
									pageId: page.id,
									kind: entry.node.kind,
									type: entry.node.type ?? entry.node.kind,
									label: record.label,
									revision: record.revision,
									seed: {
										target: target(mapping),
										expected: { start: mapping.span.start, end: mapping.span.end },
										editable: draftRange(entry.node),
										scope: "node" as const,
									},
								},
							];
						}),
					};
				}),
			};
			return prepareEditorSnapshot(snapshot);
		},
		"read",
		false,
	);
}

/** Source addresses are one-based tree paths, qualified by the lesson path. */
export async function readBlockInventory(root: string, includeOperations = false) {
	return withProjectFileTransaction(
		root,
		async (admitted) => {
			const current = await resolveLessonSources(admitted);
			const { orderedLessons } = await readCourseManifestData(admitted);
			// Publishing allocates visible page filenames across the manifest's lesson order.
			const exportSlugs = buildSlugMap(
				orderedLessons.flatMap((file) => {
					const lesson = current.lessons.get(file);
					if (!lesson) throw new Error("Missing inspected lesson");
					return splitBlocksIntoPages(lesson.blocks, "");
				}),
			);
			const stored = await loadIdentityStore(admitted);
			const storedIds = new Set(
				stored.snapshots.flatMap((snapshot) => Object.keys(snapshot.nodes)),
			);
			const identities = new Map(
				current.identity.snapshots.flatMap((snapshot) => Object.entries(snapshot.nodes)),
			);
			const mappings = new Map(
				current.identity.sourceMappings.map((mapping) => [
					JSON.stringify([mapping.file, mapping.path]),
					mapping,
				]),
			);
			const files = [...current.lessons].map(([path, lesson]) => ({
				path,
				source: lesson.tree.stream.source,
			}));
			const bases = files.map((file) => ({ path: file.path, baseRevision: digest(file.source) }));
			const blocks = [];
			for (const [file, lesson] of current.lessons) {
				const source = lesson.tree.stream.source;
				const fileRevision = digest(source);
				const nodes = locateTree(lesson.tree);
				const entriesByNode = new Map(nodes.map((entry) => [entry.node, entry]));
				const lineAt = (offset: number) => {
					if (offset === source.length) return lineColumn(source, offset).line;
					const lines = lesson.tree.stream.lines;
					let low = 0;
					let high = lines.length;
					while (low < high) {
						const mid = Math.floor((low + high) / 2);
						if (lines[mid].start <= offset) low = mid + 1;
						else high = mid;
					}
					return low || 1;
				};
				// Reader pages omit frontmatter and retain pages with hidden titles.
				// Renderer blocks include generated titles/declarations and can project
				// one source child several times. Count distinct direct source nodes.
				const pages = new Map(
					lesson.pages.map((page, index) => {
						const record = lesson.nodes.get(page.id);
						const entry = record && entriesByNode.get(record.node);
						if (!entry) throw new Error("Missing inspected page node");
						const directChildren = new Set(entry.node.children);
						const children = new Set(
							page.blocks
								.map((block) => {
									const record = lesson.nodes.get(block.id);
									if (!record) throw new Error("Missing inspected block node");
									return record.node;
								})
								.filter((node) => directChildren.has(node)),
						);
						const blockNumbers = new Map([...children].map((node, index) => [node, index + 1]));
						return [entry.path[0], { ...entry, number: index + 1, blockNumbers }] as const;
					}),
				);
				for (const entry of nodes) {
					if (!entry.path.length || entry.node.kind === "frontmatter") continue;
					const mapping = mappings.get(JSON.stringify([file, entry.path]));
					if (!mapping) continue;
					const identity = identities.get(mapping.id);
					if (!identity) throw new Error("Missing inspected identity");
					const target: OperationTarget = {
						file,
						ref: {
							kind: "node",
							nodeId: storedIds.has(mapping.id) ? mapping.id : null,
							path: mapping.path,
							fingerprint: mapping.fingerprint,
						},
						expectedText: source.slice(mapping.span.start, mapping.span.end),
					};
					const type = entry.node.type ?? entry.node.kind;
					const definition = definitionOf(entry.node, entry.parent?.node, getDefinition);
					const settings = Object.fromEntries(
						Object.entries(definition?.settings ?? {}).map(
							([name, { accepts: _accepts, ...declaration }]) => {
								const value = entry.node.settings.find((s) => s.name === name)?.value.value;
								return [name, { ...declaration, value: value ?? null }];
							},
						),
					);
					const operations = new Set<string>();
					if (includeOperations) {
						const range = draftRange(entry.node);
						// Probe the registry rather than duplicating its eligibility rules in the host.
						// This first inventory covers node edits; insertion, inline and clipboard need their own targets.
						const probes: Array<{ operation: string; args: OperationRequest["args"] }> = [
							{ operation: "editSource", args: { text: source.slice(range.start, range.end) } },
							{ operation: "deleteBlocks", args: {} },
							{ operation: "duplicateBlocks", args: {} },
							{ operation: "moveBlocks", args: { direction: "up" } },
							{ operation: "moveBlocks", args: { direction: "down" } },
							{ operation: "wrapInColumns", args: {} },
							{ operation: "unwrapColumns", args: {} },
							{ operation: "wrapIn", args: { unwrap: true } },
							{
								operation: "replaceBlock",
								args: { text: source.slice(entry.node.span.start, entry.node.span.end) },
							},
							{ operation: "addItem", args: { text: ":: item" } },
							...(TURN_INTO[type] ?? []).map((conversion) => ({
								operation: "turnInto",
								args: { type: conversion.target, title: entry.node.subject?.value ?? "page" },
							})),
							...(WRAP_IN[type] ?? []).map((type) => ({ operation: "wrapIn", args: { type } })),
							...Object.entries(definition?.settings ?? {}).map(([name, setting]) => ({
								operation: "setProperty",
								args: {
									name,
									value:
										entry.node.settings.find((s) => s.name === name)?.value.value ??
										setting.default ??
										setting.values?.[0] ??
										null,
								},
							})),
						];
						for (const field of [
							"subject",
							"value",
							"text",
							"answer",
							"alt",
							"source",
							"speaker",
						] as const) {
							const value = entry.node[field];
							if (value && typeof value.value === "string")
								probes.push({ operation: "setText", args: { field, text: value.raw } });
						}
						if (entry.node.kind === "page") {
							probes.push(
								{ operation: "setPageTitle", args: { title: entry.node.subject?.value ?? "" } },
								{ operation: "deletePage", args: {} },
								{ operation: "mergePage", args: {} },
								{ operation: "movePage", args: { direction: "up" } },
								{ operation: "movePage", args: { direction: "down" } },
							);
						}
						if (entry.node.kind === "item")
							probes.push(
								{ operation: "removeItem", args: {} },
								{ operation: "moveItem", args: { direction: "up" } },
								{ operation: "moveItem", args: { direction: "down" } },
							);
						if (type === "columns")
							probes.push({
								operation: "setColumnWeights",
								args: {
									weights: entry.node.children
										.filter((child) => child.kind === "item")
										.map(() => 1),
								},
							});
						for (const probe of probes) {
							if (operations.has(probe.operation)) continue;
							// Probes use this admitted snapshot's IDs, even when they are provisional.
							const probeTarget = {
								...target,
								ref: {
									kind: "node" as const,
									nodeId: mapping.id,
									path: mapping.path,
									fingerprint: mapping.fingerprint,
								},
							};
							if (
								planReadIdentity(current, {
									transactionId: "inspection",
									...probe,
									targets: [probeTarget],
									files: bases,
								}).ok
							)
								operations.add(probe.operation);
						}
					}
					const page = pages.get(entry.path[0]);
					const pageId = page ? mappings.get(JSON.stringify([file, page.path]))?.id : undefined;
					blocks.push({
						address: `${file}#${entry.path.map((index) => index + 1).join(".")}`,
						file,
						nodeId: mapping.id,
						label: identity.label,
						revision: identity.revision,
						fileRevision,
						type,
						kind: entry.node.kind,
						page: page?.node.subject?.value ?? null,
						pageNumber: page?.number ?? null,
						blockNumber: page?.blockNumbers.get(entry.node) ?? null,
						slug: pageId ? (exportSlugs.get(pageId) ?? null) : null,
						identitySlug: pageId ? (identities.get(pageId)?.slug ?? null) : null,
						startLine: lineAt(entry.node.span.start),
						endLine: lineAt(Math.max(entry.node.span.start, entry.node.span.end - 1)),
						source: target.expectedText ?? "",
						operations: [...operations],
						settings,
						path: entry.path,
						target,
					});
				}
			}

			return {
				schema: 1 as const,
				transientIdentity: current.transientIds,
				files: bases,
				blocks,
				textFields: inspectTextBindings(current),
			};
		},
		"read",
		false,
	);
}

export class PageSelectionRefusal extends Error {
	constructor(
		readonly code: "invalid-args" | "orphaned" | "ambiguous",
		readonly key: "pagePath" | "pageNumber" | "lessonMissing" | "pageMissing" | "pageAmbiguous",
		readonly params: Record<string, string | number>,
		readonly candidates?: Array<{ selector: string; title: string }>,
	) {
		super(key);
	}
}

/** Resolve pages before blocks so a missing block cannot hide another matching page. */
export function selectPageBlocks(
	inventory: Awaited<ReturnType<typeof readBlockInventory>>,
	selector: string,
	blockNumber: number,
) {
	const qualified = /^(.+\.prax):(.*)$/u.exec(selector);
	let file: string | undefined;
	let page = selector;
	if (qualified) {
		file = qualified[1];
		page = qualified[2];
		try {
			assertPath(file);
		} catch {
			throw new PageSelectionRefusal("invalid-args", "pagePath", {});
		}
		if (!/^[1-9]\d*$/u.test(page) || !Number.isSafeInteger(Number(page)))
			throw new PageSelectionRefusal("invalid-args", "pageNumber", {});
		// Only the admitted inventory can supply a lesson; never read a selector path.
		if (!inventory.files.some((entry) => entry.path === file))
			throw new PageSelectionRefusal("orphaned", "lessonMissing", { file });
	}
	let pages = inventory.blocks.filter(
		(entry) =>
			entry.kind === "page" &&
			(file
				? entry.file === file && String(entry.pageNumber) === page
				: entry.page === page || entry.slug === page || String(entry.pageNumber) === page),
	);
	if (!file && !pages.length)
		pages = inventory.blocks.filter(
			(entry) => entry.kind === "page" && entry.identitySlug === page,
		);
	if (!pages.length && file)
		throw new PageSelectionRefusal("orphaned", "pageMissing", { file, page });
	if (!pages.length) {
		const almostQualified = /^(.+):\d+$/u.exec(selector);
		if (almostQualified)
			throw new PageSelectionRefusal("orphaned", "lessonMissing", { file: almostQualified[1] });
	}
	if (pages.length > 1) {
		const candidates = pages.map((entry) => ({
			selector: `${entry.file}:${entry.pageNumber}`,
			title: String(entry.page ?? ""),
		}));
		throw new PageSelectionRefusal(
			"ambiguous",
			"pageAmbiguous",
			{
				page,
				count: pages.length,
				candidates: candidates
					.map((entry) => `${entry.selector} ${JSON.stringify(entry.title)}`)
					.join(", "),
			},
			candidates,
		);
	}
	const selected = pages[0];
	return inventory.blocks.filter(
		(entry) =>
			selected &&
			entry.file === selected.file &&
			entry.pageNumber === selected.pageNumber &&
			entry.blockNumber === blockNumber,
	);
}

export async function inspectBlocks(root: string, includeOperations = false) {
	const inventory = await readBlockInventory(root, includeOperations);
	return {
		schema: inventory.schema,
		transientIdentity: inventory.transientIdentity,
		textFields: inventory.textFields,
		blocks: inventory.blocks.map(({ target: _target, path: _path, operations, ...block }) => ({
			...block,
			...(includeOperations ? { operations } : {}),
		})),
	};
}

function inspectTextBindings(current: ResolvedCourseIdentity) {
	return canvasTextBindings(current).map(
		({ node: _node, role: _role, target: _target, baseRevision, ...field }) => ({
			...field,
			fileRevision: baseRevision,
		}),
	);
}

/** Canvas fields need no structural-operation inventory or eligibility probes. */
export async function inspectTextFields(root: string) {
	return withProjectFileTransaction(
		root,
		async (admitted) => {
			const current = await resolveLessonSources(admitted);
			return {
				schema: 1 as const,
				transientIdentity: current.transientIds,
				files: [...current.lessons].map(([path, lesson]) => ({
					path,
					baseRevision: digest(lesson.tree.stream.source),
				})),
				textFields: inspectTextBindings(current),
			};
		},
		"read",
		false,
	);
}
