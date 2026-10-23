import { createHash } from "node:crypto";
import type {
	OperationRefusal,
	OperationRequest,
	OperationTarget,
} from "@praxity/grammar/src/operations/contract.ts";
import type { TreeNode } from "@praxity/grammar/src/v4/tree/index.ts";
import { canvasTextField, canvasTextRefusal } from "@praxity/operations";
import { locateTree } from "@praxity/operations/src/ranges.ts";
import { blocksToText, optionFeedbackHtml } from "@praxity/shared-blocks/assessment-content";
import { flattenLogicBlocks } from "@praxity/shared-blocks/logic/flatten-blocks";
import { sanitizeHtml } from "@praxity/shared-blocks/sanitize";
import type { AssessmentBlockData, ChoiceResponse } from "@praxity/shared-blocks/types";
import type { CanvasPageScope } from "../../shared/editor-session";
import { type ResolvedCourseIdentity, resolveReadIdentityId } from "../identity-store";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export interface CanvasFeedback {
	html: string;
	place: { option: string } | { block: string; result: "correct" | "incorrect" | "any" };
	alsoIncorrect?: true;
}

export function canvasTextBindings(current: ResolvedCourseIdentity) {
	return [...current.lessons].flatMap(([file, lesson]) => {
		const source = lesson.tree.stream.source;
		const baseRevision = digest(source);
		const entries = new Map(locateTree(lesson.tree).map((entry) => [entry.node, entry]));
		const feedback = new Map<TreeNode, { role: string; presentation: CanvasFeedback }>();
		for (const block of flattenLogicBlocks(lesson.blocks)) {
			if (block.type !== "assessment") continue;
			const data = block.data as unknown as AssessmentBlockData & {
				_feedbackOptionIds?: { incorrect?: string };
			};
			const choice =
				data.response.type === "choice" ? (data.response as ChoiceResponse) : undefined;
			const resultOwner = (result: "correct" | "incorrect") => {
				const id = data.feedback?.[result]?.[0]?.id;
				return id ? lesson.nodes.get(id)?.node : undefined;
			};
			for (const result of ["correct", "incorrect"] as const) {
				const owner = resultOwner(result);
				if (!owner || entries.get(owner)?.parent?.node.kind === "option" || feedback.has(owner))
					continue;
				feedback.set(owner, {
					role: result,
					presentation: {
						html: sanitizeHtml(blocksToText(data.feedback[result])),
						place: {
							block: block.id,
							result:
								resultOwner("correct") === resultOwner("incorrect") ||
								(choice && !choice.options.some((option) => option.isCorrect))
									? "any"
									: result,
						},
					},
				});
			}
			for (const option of choice?.options ?? []) {
				const owner = lesson.nodes
					.get(option.id)
					?.node.children.find((node) => node.kind === "part" && node.name === "feedback");
				if (!owner || !option.feedback) continue;
				feedback.set(owner, {
					role: "option-feedback",
					presentation: {
						html: sanitizeHtml(optionFeedbackHtml(data, option)),
						place: { option: option.id },
						...(data._feedbackOptionIds?.incorrect === option.id
							? { alsoIncorrect: true as const }
							: {}),
					},
				});
			}
		}
		const mappings = current.identity.sourceMappings.filter((mapping) => mapping.file === file);
		const lessonId = mappings.find((mapping) => mapping.path.length === 0)?.id;
		const pages = mappings
			.filter(
				(mapping) =>
					mapping.path.length === 1 && lesson.tree.root.children[mapping.path[0]]?.kind === "page",
			)
			.sort((left, right) => left.path[0] - right.path[0]);
		return [...lesson.nodes.values()].flatMap((record) => {
			const entry = entries.get(record.node);
			const field = canvasTextField(
				record.node,
				record.role,
				lesson.tree.stream,
				entry?.parent?.node,
			);
			if (!field || !entry) return [];
			const owners = mappings.filter((mapping) => mapping.path.join() === entry.path.join());
			const owner = owners[0];
			// A rendered ID and its sole authored owner must both belong to this admission.
			if (
				!owner ||
				owners.length !== 1 ||
				mappings.filter((mapping) => mapping.id === record.id).length !== 1
			)
				return [];
			const page = mappings.find(
				(mapping) => mapping.path.length === 1 && mapping.path[0] === entry.path[0],
			);
			if (!page || !lessonId) return [];
			const target: OperationTarget = {
				file,
				ref: {
					kind: "node",
					nodeId: current.readView?.runtimeIds.includes(owner.id) ? null : owner.id,
					path: owner.path,
					fingerprint: owner.fingerprint,
				},
				expectedText: source.slice(owner.span.start, owner.span.end),
			};
			const presented = feedback.get(record.node);
			return [
				{
					...field,
					file,
					nodeId: record.id,
					ownerId: owner.id,
					pageId: page.id,
					lessonId,
					pageIndex: pages.indexOf(page),
					kind: record.node.kind,
					...(record.node.kind === "part" ? { name: record.node.name } : {}),
					...(presented && presented.role === record.role
						? { feedback: presented.presentation }
						: {}),
					baseRevision,
					node: record.node,
					role: record.role,
					target,
				},
			];
		});
	});
}

export function canvasPageAdmission(
	current: ResolvedCourseIdentity,
	fields: readonly CanvasPageScope[],
	captured: CanvasPageScope,
) {
	const scope = {
		...captured,
		lessonId: resolveReadIdentityId(current, captured.lessonId),
		pageId: resolveReadIdentityId(current, captured.pageId),
		pageIds: captured.pageIds?.map((id) => resolveReadIdentityId(current, id)),
	};
	// Position is only a fallback for a retired transient ID, such as an outside title edit.
	const pageIndex =
		fields.find((field) => field.lessonId === scope.lessonId && field.pageId === scope.pageId)
			?.pageIndex ?? scope.pageIndex;
	const candidate = fields.find(
		(field) => field.lessonId === scope.lessonId && field.pageIndex === pageIndex,
	);
	const removed =
		candidate && candidate.pageId !== scope.pageId && scope.pageIds?.includes(candidate.pageId);
	const selected = candidate && !removed ? pageIndex : 0;
	return (field: CanvasPageScope) =>
		field.lessonId === scope.lessonId && (scope.allLessonPages || field.pageIndex === selected);
}

export function canvasTextSnapshotFields(current: ResolvedCourseIdentity, scope?: CanvasPageScope) {
	const fields = canvasTextBindings(current);
	const admits = scope ? canvasPageAdmission(current, fields, scope) : () => true;
	return fields
		.filter(admits)
		.map(({ node: _node, role: _role, target: _target, ...field }) => field);
}

/** Both authoring hosts admit the same rendered field before ordinary operation planning. */
export function admitCanvasText(
	current: ResolvedCourseIdentity,
	input: {
		transactionId: string;
		operation: "setText";
		file: string;
		nodeId: string;
		baseRevision: string;
		expectedText: string;
		field: string;
		text: string;
	},
	scope?: CanvasPageScope,
): OperationRequest | OperationRefusal {
	const refuse = (code: OperationRefusal["code"]): OperationRefusal => ({
		ok: false,
		transactionId: input.transactionId,
		code,
		message: { key: `op.${code}`, params: {} },
	});
	const fields = canvasTextBindings(current);
	const nodeId = resolveReadIdentityId(current, input.nodeId);
	const matches = fields.filter((field) => field.file === input.file && field.nodeId === nodeId);
	const binding = matches[0];
	if (!binding || matches.length !== 1) return refuse(matches.length ? "ambiguous" : "orphaned");
	if (scope && !canvasPageAdmission(current, fields, scope)(binding)) return refuse("not-allowed");
	const lesson = current.lessons.get(binding.file);
	if (!lesson || input.field !== binding.field) return refuse("not-allowed");
	if (binding.baseRevision !== input.baseRevision || binding.text !== input.expectedText)
		return refuse("stale");
	const invalid = canvasTextRefusal(
		lesson.tree.stream.source,
		binding.node,
		binding.role,
		input.text,
	);
	if (invalid) return refuse(invalid);
	return {
		transactionId: input.transactionId,
		operation: input.operation,
		files: [{ path: input.file, baseRevision: input.baseRevision }],
		targets: [binding.target],
		args: { field: binding.field, text: input.text },
	};
}
