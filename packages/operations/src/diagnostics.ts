import type {
	CanonicalDescriptor,
	IdentityResolution,
	ParsedDocument,
} from "@praxity/content-identity";
import type { OperationDiagnostic } from "@praxity/grammar/src/operations/contract.ts";

const below = (a: readonly number[], b: readonly number[]) =>
	a.length >= b.length && b.every((v, i) => a[i] === v);
const samePath = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && below(a, b);
/** Parser and descriptor diagnostics share one representation for forward and inverse results. */
export function sourceDiagnostics(
	documents: readonly ParsedDocument[],
	identity: IdentityResolution,
	descriptors: readonly CanonicalDescriptor[],
): OperationDiagnostic[] {
	const diagnostics: OperationDiagnostic[] = documents.flatMap((d) =>
		d.tree.diagnostics.map((diag) => {
			const params: Record<string, string | number> = { line: diag.line, column: diag.column };
			for (const [name, value] of Object.entries(diag.message.args))
				if (typeof value === "string" || typeof value === "number") params[name] = value;
			return {
				file: d.path,
				ref: null,
				severity: diag.severity,
				message: {
					key: ["op", "diagnostic", diag.code].join(".") as `op.${string}`,
					params,
				},
				range: { start: diag.span.start, end: diag.span.end },
			};
		}),
	);
	for (const document of documents) {
		// Reader projections have no source node and never replace syntax diagnostics.
		const invalid = descriptors.filter(
			(d) => d.file === document.path && !d.valid && !d.type.startsWith("reader-role:"),
		);
		for (const descriptor of invalid.filter(
			(d) =>
				!invalid.some((child) => child.path.length > d.path.length && below(child.path, d.path)),
		)) {
			if (
				diagnostics.some(
					(d) =>
						d.file === document.path &&
						d.range &&
						d.range.start >= descriptor.span.start &&
						d.range.start < descriptor.span.end,
				)
			)
				continue;
			const map = identity.sourceMappings.find(
				(m) => m.file === document.path && samePath(m.path, descriptor.path),
			);
			diagnostics.push({
				file: document.path,
				ref: map
					? { kind: "node", nodeId: map.id, path: map.path, fingerprint: map.fingerprint }
					: null,
				severity: "error",
				message: { key: "op.diagnostic.invalid-source", params: {} },
				range: { start: descriptor.span.start, end: descriptor.span.end },
			});
		}
	}

	return diagnostics;
}
