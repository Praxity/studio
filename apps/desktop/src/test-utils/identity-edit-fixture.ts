import { createHash } from "node:crypto";
import type { IdentityOperation } from "@praxity/content-identity";
import { resolveLessonSources } from "../main/lesson-source";

/** These fixtures change text without changing tree paths. Bind the explicit
 * modify intent to the saved snapshot; no positional matching reaches hosts. */
export async function identityEditFixture(
	root: string,
	file: string,
	source: string,
): Promise<IdentityOperation> {
	const prior = await resolveLessonSources(root);
	const head = prior.identity.heads.find((head) => head.path === file);
	const parsed = prior.lessons.get(file);
	if (!head || !parsed) throw new Error(`Missing edit fixture: ${file}`);
	const nodes = prior.identity.sourceMappings.filter((node) => node.file === file);
	return {
		intent: "modify",
		files: [
			{
				path: file,
				fromRevision: createHash("sha256").update(parsed.tree.stream.source).digest("hex"),
				toRevision: createHash("sha256").update(source).digest("hex"),
				fromSnapshot: head.head,
			},
		],
		mapping: nodes.map((node) => ({ oldId: node.id, newId: node.id, fate: "kept" })),
		placements: nodes.map((node, mappingIndex) => ({ mappingIndex, file, path: node.path })),
	};
}
