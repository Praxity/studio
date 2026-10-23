import { createHash } from "node:crypto";
import { tokenizeLesson } from "@praxity/grammar/src/v4/lex/index.ts";
import { getDefinition, suggestType } from "@praxity/grammar/src/v4/schema.ts";
import { analyzeLessonTree } from "@praxity/grammar/src/v4/tree/index.ts";
import { draftRange, locateTree } from "@praxity/operations/src/ranges.ts";
import { isRuntimeNodeId } from "@praxity/shared-blocks/types";
import type { EditorSnapshot } from "../../../shared/editor-session";
import type { ResolvedCourseIdentity } from "../../identity-store";

// Size caps don't block working features (owner rule): covers the longest schema type (`write-distractors`) plus margin; tighten during final size work.
export const nodeMetadataBudget = 832;

/** Test adapter only. Production snapshot assembly belongs to the service slice. */
export function snapshotFixture(current: ResolvedCourseIdentity): EditorSnapshot {
	const records = new Map(current.identity.snapshots.flatMap((s) => Object.entries(s.nodes)));
	return {
		schema: 1,
		seq: 0,
		transientIdentity: current.transientIds,
		lessons: [...current.lessons].map(([file, lesson]) => {
			const mappings = current.identity.sourceMappings.filter((m) => m.file === file);
			const byPath = new Map(mappings.map((mapping) => [mapping.path.join(), mapping]));
			const pages = new Map(
				mappings
					.filter((mapping) => mapping.path.length === 1)
					.map((mapping) => [mapping.path[0], mapping]),
			);
			const root = mappings.find((m) => m.path.length === 0);
			if (!root) throw new Error("Missing fixture lesson");
			const source = lesson.tree.stream.source;
			const target = (mapping: (typeof mappings)[number]) => ({
				kind: "node" as const,
				nodeId: isRuntimeNodeId(mapping.id) ? null : mapping.id,
				path: mapping.path,
				fingerprint: mapping.fingerprint,
			});
			return {
				id: root.id,
				file,
				baseRevision: createHash("sha256").update(source).digest("hex"),
				source,
				listed: true,
				label: records.get(root.id)?.label ?? "",
				revision: records.get(root.id)?.revision ?? "",
				seed: {
					target: target(root),
					expected: { start: 0, end: source.length },
					editable: { start: 0, end: source.length },
					scope: "file" as const,
				},
				nodes: locateTree(lesson.tree).flatMap((entry) => {
					if (!entry.path.length || entry.node.kind === "frontmatter") return [];
					const mapping = byPath.get(entry.path.join());
					const page = pages.get(entry.path[0]);
					const record = mapping && records.get(mapping.id);
					if (!mapping || !record || !page) throw new Error("Missing fixture node");
					return [
						{
							id: mapping.id,
							parentId: record.parent === root.id ? null : record.parent,
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
}

/** Transport stress data uses grammar ranges and literal opaque metadata, without an I4 setup benchmark. */
export function largeSnapshotFixture(source: string): EditorSnapshot {
	// Transport fixtures need the admitted grammar tree, without rendering every block.
	const tree = analyzeLessonTree(tokenizeLesson(source), {
		definition: getDefinition,
		suggestType,
	});
	const entries = locateTree(tree).filter(
		(entry) => entry.path.length && entry.node.kind !== "frontmatter",
	);
	const id = (index: number) => `rt-${index.toString(16).padStart(32, "0")}`;
	const ids = new Map(entries.map((entry, index) => [entry.path.join(), id(index + 2)]));
	const revision = "0".repeat(64);
	const lessonId = id(1);
	return {
		schema: 1,
		seq: 0,
		transientIdentity: true,
		lessons: [
			{
				id: lessonId,
				file: "a.prax",
				baseRevision: createHash("sha256").update(source).digest("hex"),
				source,
				listed: true,
				label: "Large lesson",
				revision,
				seed: {
					target: { kind: "node", nodeId: null, path: [], fingerprint: revision },
					expected: { start: 0, end: source.length },
					editable: { start: 0, end: source.length },
					scope: "file",
				},
				nodes: entries.map((entry, index) => ({
					id: id(index + 2),
					parentId: entry.parent?.path.length ? (ids.get(entry.parent.path.join()) ?? null) : null,
					pageId: ids.get(String(entry.path[0])) ?? lessonId,
					kind: entry.node.kind,
					type: entry.node.type ?? entry.node.kind,
					label: "Node",
					revision,
					seed: {
						target: { kind: "node", nodeId: null, path: entry.path, fingerprint: revision },
						expected: { start: entry.node.span.start, end: entry.node.span.end },
						editable: draftRange(entry.node),
						scope: "node",
					},
				})),
			},
		],
	};
}
