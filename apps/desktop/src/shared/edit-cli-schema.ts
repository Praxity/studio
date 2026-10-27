import { isDisplayNodeId, isIdentityNodeId } from "@praxity/shared-blocks/types";
import { z } from "zod";

const range = z
	.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
	.strict();
const message = z
	.object({ key: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) })
	.strict();
const nullableId = z.string().refine(isDisplayNodeId).nullable();

/** Schema 1 omits session transaction/history IDs and executable inverses. Operation
 * vocabulary and eligibility still belong to grammar's contract and the registry. */
export const editCliOutputSchema = z
	.discriminatedUnion("ok", [
		z
			.object({
				schema: z.literal(1),
				ok: z.literal(true),
				dryRun: z.boolean(),
				operation: z.string(),
				files: z.array(
					z
						.object({
							path: z.string(),
							fromRevision: z.string(),
							toRevision: z.string(),
							edits: z.array(range.extend({ text: z.string() })),
						})
						.strict(),
				),
				intent: z.string(),
				mapping: z.array(
					z.object({ oldId: nullableId, newId: nullableId, fate: z.string() }).strict(),
				),
				summary: message,
				diagnostics: z.array(
					z
						.object({
							file: z.string(),
							ref: z.record(z.string(), z.unknown()).nullable(),
							severity: z.string(),
							message,
							range: range.optional(),
						})
						.strict(),
				),
				focus: z.object({ file: z.string(), nodeId: nullableId, role: z.string() }).strict(),
			})
			.strict(),
		z
			.object({
				schema: z.literal(1),
				ok: z.literal(false),
				code: z.string(),
				message: z.string(),
				candidates: z
					.array(z.object({ selector: z.string(), title: z.string() }).strict())
					.optional(),
				details: z.object({ reason: z.string() }).strict().optional(),
			})
			.strict(),
	])
	.superRefine((result, context) => {
		if (!result.ok || result.dryRun) return;
		const ids = [
			...result.mapping.flatMap((mapping) => [mapping.oldId, mapping.newId]),
			result.focus.nodeId,
		];
		if (ids.some((id) => id !== null && !isIdentityNodeId(id)))
			context.addIssue({ code: "custom", message: "Invalid durable operation output identity" });
	});
